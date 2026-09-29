import { log } from 'apify';

export const ACTOR_UA_TOKEN = 'apify-state-procurement-bids';
// Browser-shaped UA so portals with a "supported browser" gate serve their normal HTML;
// the actor name and a contact URL are included so site operators can identify the traffic.
export const USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ${ACTOR_UA_TOKEN}/0.1 (+https://apify.com/actors/state-procurement-bids)`;

export const MAX_CONCURRENCY_PER_PORTAL = 2;
export const MIN_DELAY_MS = 300;

/** Minimal cookie jar: one host per portal, so no domain/path scoping is needed. */
export class CookieJar {
    constructor() { this.cookies = new Map(); }

    store(res) {
        const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        for (const raw of list) {
            const [pair] = raw.split(';');
            const i = pair.indexOf('=');
            if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    }

    header() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
}

/** Polite limiter: at most `concurrency` in flight and at least `minDelayMs` between request starts. */
export class Limiter {
    constructor({ concurrency = MAX_CONCURRENCY_PER_PORTAL, minDelayMs = MIN_DELAY_MS } = {}) {
        this.concurrency = concurrency;
        this.minDelayMs = minDelayMs;
        this.active = 0;
        this.lastStart = 0;
        this.queue = [];
        this.timer = null;
    }

    async schedule(fn) {
        await new Promise((resolve) => { this.queue.push(resolve); this.#next(); });
        try {
            return await fn();
        } finally {
            this.active -= 1;
            this.#next();
        }
    }

    #next() {
        if (this.timer || this.active >= this.concurrency || this.queue.length === 0) return;
        const wait = this.lastStart + this.minDelayMs - Date.now();
        if (wait > 0) {
            this.timer = setTimeout(() => { this.timer = null; this.#next(); }, wait);
            return;
        }
        this.active += 1;
        this.lastStart = Date.now();
        this.queue.shift()();
        this.#next();
    }
}

/**
 * Creates an HTTP client bound to one portal: shared limiter, cookie jar, UA, retry with backoff.
 * request() resolves to { status, url, headers, text } and throws after the last failed attempt.
 */
export function createClient({ limiter = new Limiter(), jar = new CookieJar(), headers: baseHeaders = {} } = {}) {
    async function request(url, { method = 'GET', headers = {}, body, retries = 4, timeoutMs = 60_000, retryOn4xx = false } = {}) {
        let attempt = 0;
        for (;;) {
            attempt += 1;
            try {
                return await limiter.schedule(async () => {
                    const cookie = jar.header();
                    const res = await fetch(url, {
                        method,
                        body,
                        redirect: 'follow',
                        signal: AbortSignal.timeout(timeoutMs),
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            ...baseHeaders,
                            ...headers,
                            ...(cookie ? { Cookie: cookie } : {}),
                        },
                    });
                    jar.store(res);
                    const text = decodeBody(await res.arrayBuffer(), res.headers.get('content-type'));
                    if (res.status >= 500 || res.status === 429 || (retryOn4xx && res.status >= 400)) {
                        const err = new Error(`HTTP ${res.status} for ${url}`);
                        err.status = res.status;
                        throw err;
                    }
                    return { status: res.status, url: res.url, headers: res.headers, text };
                });
            } catch (err) {
                if (attempt > retries) throw err;
                const wait = 500 * 2 ** attempt;
                log.debug(`Request ${method} ${url} failed (${err.message}); retry ${attempt}/${retries} in ${wait}ms`);
                await sleep(wait);
            }
        }
    }

    return { request, jar, limiter };
}

/** fetch().text() always decodes UTF-8; several state portals still serve ISO-8859-1 / windows-1252. */
export function decodeBody(buffer, contentType) {
    const m = /charset=["']?([\w-]+)/i.exec(contentType ?? '');
    let charset = (m?.[1] ?? 'utf-8').toLowerCase();
    if (charset === 'iso-8859-1' || charset === 'latin1') charset = 'windows-1252'; // per WHATWG encoding standard
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch {
        return new TextDecoder('utf-8').decode(buffer);
    }
}

export function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function formBody(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.append(k, String(v));
    return p.toString();
}

export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
