import { Actor, log } from 'apify';
import { XMLParser } from 'fast-xml-parser';

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const SEARCH_PAGE_LIMIT = 200; // hard maximum of the iTunes Search API
const LOOKUP_BATCH = 100;
const FEED_CONCURRENCY = 5;
const FEED_TIMEOUT_MS = 20_000;
const API_TIMEOUT_MS = 30_000;
const USER_AGENT = 'apify-podcast-directory-scraper/0.1 (+https://apify.com; podcast directory and RSS scraper)';
const DESCRIPTION_MAX_CHARS = 2000;
const EVENT_SHOW = 'show';
const EVENT_EPISODE = 'episode';

class NoRetryError extends Error {}

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    searchTerms = [],
    podcastIds = [],
    feedUrls = [],
    country = 'US',
    genreId = '',
    maxShows = 50,
    includeEpisodes = true,
    maxEpisodesPerShow = 50,
    episodesPublishedAfter,
} = input;

const storefront = String(country || 'US').trim().toUpperCase();
// Outside pay-per-event runs (e.g. local development) the SDK reports chargedCount 0 for every call,
// so episode truncation is only applied when the Actor really runs with per-event pricing.
const isPayPerEvent = Actor.getChargingManager().getPricingInfo().isPayPerEvent === true;
const publishedAfterTs = toTimestamp(episodesPublishedAfter);

if (searchTerms.length === 0 && podcastIds.length === 0 && feedUrls.length === 0) {
    throw new Error('Provide at least one of searchTerms, podcastIds or feedUrls.');
}

log.info('Starting podcast directory scrape', {
    searchTerms, podcastIds: podcastIds.length, feedUrls: feedUrls.length, country: storefront, genreId, maxShows, includeEpisodes, maxEpisodesPerShow,
});

const xml = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    htmlEntities: true,
    removeNSPrefix: false,
    isArray: (_name, jpath) => jpath === 'rss.channel.item'
        || jpath === 'rss.channel.itunes:category'
        || jpath === 'rss.channel.itunes:category.itunes:category'
        || jpath === 'rss.channel.category'
        || jpath === 'rss.channel.item.enclosure',
});

// 1. Collect candidate shows from the Apple directory and from raw feed URLs.
const candidates = await collectCandidates();
log.info(`Collected ${candidates.length} unique shows (limit ${maxShows})`);

// 2. Fetch and parse each show's RSS feed with bounded concurrency.
const records = await mapWithConcurrency(candidates, FEED_CONCURRENCY, (c) => buildRecord(c));

// 3. Charge and push in the original order; truncate episodes to what was actually charged.
let pushedShows = 0;
let pushedEpisodes = 0;
for (const record of records) {
    if (!record) continue;
    const showCharge = await Actor.charge({ eventName: EVENT_SHOW, count: 1 });
    if (showCharge.eventChargeLimitReached) {
        log.warning('Charge limit for "show" reached, stopping before pushing more results.');
        break;
    }

    let stopAfterThis = false;
    if (record.episodes.length > 0) {
        const epCharge = await Actor.charge({ eventName: EVENT_EPISODE, count: record.episodes.length });
        const charged = isPayPerEvent && typeof epCharge.chargedCount === 'number' ? epCharge.chargedCount : record.episodes.length;
        if (charged < record.episodes.length) {
            log.warning(`Only ${charged} of ${record.episodes.length} episodes could be charged for "${record.title}", truncating.`);
            record.episodes = record.episodes.slice(0, Math.max(0, charged));
        }
        if (epCharge.eventChargeLimitReached) {
            log.warning('Charge limit for "episode" reached, this is the last show pushed.');
            stopAfterThis = true;
        }
    }

    await Actor.pushData(record);
    pushedShows += 1;
    pushedEpisodes += record.episodes.length;
    if (stopAfterThis) break;
}

log.info(`Done. Pushed ${pushedShows} shows and ${pushedEpisodes} episodes.`);
await Actor.exit();

// ---------------------------------------------------------------------------
// Candidate discovery

async function collectCandidates() {
    const seenIds = new Set();
    const seenFeeds = new Set();
    const out = [];

    const add = (apple, feedUrl) => {
        if (out.length >= maxShows) return;
        const id = apple?.collectionId != null ? String(apple.collectionId) : null;
        const feed = normalizeUrl(feedUrl ?? apple?.feedUrl);
        const feedKey = feedDedupeKey(feed);
        if (id && seenIds.has(id)) return;
        if (feedKey && seenFeeds.has(feedKey)) return;
        if (id) seenIds.add(id);
        if (feedKey) seenFeeds.add(feedKey);
        out.push({ apple: apple ?? null, feedUrl: feed });
    };

    for (const term of searchTerms) {
        if (out.length >= maxShows) break;
        const t = String(term ?? '').trim();
        if (!t) continue;
        const params = new URLSearchParams({ term: t, media: 'podcast', entity: 'podcast', limit: String(SEARCH_PAGE_LIMIT), country: storefront });
        if (genreId) params.set('genreId', String(genreId));
        const json = await getJson(`${SEARCH_URL}?${params}`);
        const results = (json.results ?? []).filter((r) => r.kind === 'podcast' || r.wrapperType === 'track');
        log.info(`Search "${t}" returned ${results.length} shows`);
        for (const r of results) add(r, r.feedUrl);
    }

    const ids = podcastIds.map((v) => String(v).replace(/\D/g, '')).filter(Boolean);
    for (let i = 0; i < ids.length && out.length < maxShows; i += LOOKUP_BATCH) {
        const batch = ids.slice(i, i + LOOKUP_BATCH);
        const params = new URLSearchParams({ id: batch.join(','), entity: 'podcast', country: storefront });
        const json = await getJson(`${LOOKUP_URL}?${params}`);
        const results = (json.results ?? []).filter((r) => r.kind === 'podcast' || r.wrapperType === 'track');
        const found = new Set(results.map((r) => String(r.collectionId)));
        for (const id of batch) if (!found.has(id)) log.warning(`Apple podcast ID ${id} not found in the ${storefront} storefront`);
        for (const r of results) add(r, r.feedUrl);
    }

    for (const url of feedUrls) {
        if (out.length >= maxShows) break;
        const u = normalizeUrl(url);
        if (u) add(null, u);
    }

    return out;
}

// ---------------------------------------------------------------------------
// Record building

async function buildRecord({ apple, feedUrl }) {
    let channel = null;
    let feedError = null;
    if (feedUrl) {
        try {
            channel = await fetchFeedChannel(feedUrl);
        } catch (err) {
            feedError = err.message;
            log.warning(`Feed failed for "${apple?.collectionName ?? feedUrl}": ${err.message}`);
        }
    } else {
        feedError = 'No feed URL available';
    }

    if (!apple && !channel) {
        log.warning(`Skipping ${feedUrl}: no Apple metadata and the feed could not be parsed, nothing to push.`);
        return null;
    }

    const items = includeEpisodes && channel ? (channel.item ?? []) : [];
    let episodes = items.map(parseEpisode).filter(Boolean);
    if (publishedAfterTs) episodes = episodes.filter((e) => e.publishedAt && toTimestamp(e.publishedAt) >= publishedAfterTs);
    episodes.sort((a, b) => (toTimestamp(b.publishedAt) ?? 0) - (toTimestamp(a.publishedAt) ?? 0));
    if (maxEpisodesPerShow > 0) episodes = episodes.slice(0, maxEpisodesPerShow);

    const allDates = (channel?.item ?? []).map((it) => toTimestamp(toIsoDateTime(text(it.pubDate)))).filter(Boolean);
    const latestFromFeed = allDates.length ? new Date(Math.max(...allDates)).toISOString() : null;

    const rssImage = channel?.['itunes:image']?.['@_href'] ?? text(channel?.image?.url) ?? null;
    const appleExplicit = parseAppleExplicit(apple?.collectionExplicitness);

    return {
        appleId: apple?.collectionId != null ? String(apple.collectionId) : null,
        title: cleanWhitespace(apple?.collectionName) ?? cleanWhitespace(text(channel?.title)) ?? null,
        publisher: cleanWhitespace(apple?.artistName) ?? cleanWhitespace(text(channel?.['itunes:author'])) ?? null,
        description: stripHtml(text(channel?.description) ?? text(channel?.['itunes:summary']) ?? text(channel?.['itunes:subtitle'])),
        feedUrl: feedUrl ?? null,
        appleUrl: apple?.collectionViewUrl ?? apple?.trackViewUrl ?? null,
        artworkUrl: apple?.artworkUrl600 ?? apple?.artworkUrl100 ?? rssImage,
        websiteUrl: normalizeUrl(text(channel?.link)),
        language: cleanWhitespace(text(channel?.language)) ?? null,
        explicit: appleExplicit ?? parseExplicit(text(channel?.['itunes:explicit'])),
        genres: Array.isArray(apple?.genres) ? apple.genres.filter((g) => g && g !== 'Podcasts') : [],
        categories: parseCategories(channel),
        episodeCount: apple?.trackCount ?? (channel?.item?.length ?? null),
        latestEpisodeDate: toIsoDateTime(apple?.releaseDate) ?? latestFromFeed,
        country: apple ? storefront : null,
        feedError,
        episodes,
        scrapedAt: new Date().toISOString(),
    };
}

function parseEpisode(item) {
    if (!item || typeof item !== 'object') return null;
    const enclosure = firstOf(item.enclosure);
    const rawDesc = text(item['content:encoded']) ?? text(item.description) ?? text(item['itunes:summary']) ?? text(item['itunes:subtitle']);
    const title = cleanWhitespace(text(item.title));
    if (!title && !enclosure) return null;
    return {
        guid: cleanWhitespace(text(item.guid)) ?? null,
        title: title ?? null,
        description: truncate(stripHtml(rawDesc), DESCRIPTION_MAX_CHARS),
        publishedAt: toIsoDateTime(text(item.pubDate)),
        durationSeconds: parseDuration(text(item['itunes:duration'])),
        audioUrl: normalizeUrl(enclosure?.['@_url']),
        audioType: enclosure?.['@_type'] ?? null,
        audioSizeBytes: toInteger(enclosure?.['@_length']),
        episodeNumber: toInteger(text(item['itunes:episode'])),
        seasonNumber: toInteger(text(item['itunes:season'])),
        episodeUrl: normalizeUrl(text(item.link)),
        explicit: parseExplicit(text(item['itunes:explicit'])),
    };
}

function parseCategories(channel) {
    if (!channel) return [];
    const out = new Set();
    for (const cat of channel['itunes:category'] ?? []) {
        const parent = cleanWhitespace(cat?.['@_text']);
        if (!parent) continue;
        const children = cat['itunes:category'] ?? [];
        if (children.length === 0) out.add(parent);
        for (const child of children) {
            const c = cleanWhitespace(child?.['@_text']);
            out.add(c ? `${parent} > ${c}` : parent);
        }
    }
    for (const cat of channel.category ?? []) {
        const c = cleanWhitespace(text(cat));
        if (c) out.add(c);
    }
    return [...out];
}

// ---------------------------------------------------------------------------
// Networking

async function fetchFeedChannel(url) {
    const res = await fetchWithRetry(url, FEED_TIMEOUT_MS, 3);
    const buf = await res.arrayBuffer();
    const body = decodeXml(buf, res.headers.get('content-type'));
    let doc;
    try {
        doc = xml.parse(body);
    } catch (err) {
        throw new Error(`XML parse error: ${err.message}`);
    }
    const channel = doc?.rss?.channel;
    if (!channel) {
        if (doc?.feed) throw new Error('Atom feeds are not supported, only RSS 2.0 podcast feeds');
        throw new Error('Not an RSS feed (no <rss><channel> element)');
    }
    return channel;
}

async function getJson(url) {
    const res = await fetchWithRetry(url, API_TIMEOUT_MS, 4);
    const raw = await res.text();
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Invalid JSON from ${url}`);
    }
}

async function fetchWithRetry(url, timeoutMs, maxAttempts, attempt = 1) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8' },
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 404 || res.status === 410) throw new NoRetryError(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    } catch (err) {
        if (err instanceof NoRetryError || attempt >= maxAttempts) throw err;
        const wait = 500 * 2 ** attempt;
        log.debug(`Request to ${url} failed (${err.message}), retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        return fetchWithRetry(url, timeoutMs, maxAttempts, attempt + 1);
    }
}


function decodeXml(buf, contentType) {
    const bytes = new Uint8Array(buf);
    let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
    if (!charset) {
        const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
        charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1];
    }
    let decoder;
    try {
        decoder = new TextDecoder(charset || 'utf-8', { fatal: false, ignoreBOM: false });
    } catch {
        decoder = new TextDecoder('utf-8', { fatal: false });
    }
    return decoder.decode(bytes).replace(/^﻿/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = await fn(items[i]);
            } catch (err) {
                log.error(`Unexpected failure building record ${i}: ${err.message}`);
                results[i] = null;
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

// ---------------------------------------------------------------------------
// Parsing and cleaning helpers

function firstOf(v) {
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/** Extract the text of a parsed XML node, which may be a string, {#text, @_attr}, or an array. */
function text(v) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return text(v[0]);
    if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : null;
    const s = String(v);
    return s.length ? s : null;
}

function parseDuration(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
    if (/^\d+(:\d+){1,2}(\.\d+)?$/.test(s)) {
        const parts = s.split(':').map(Number);
        const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
        return Number.isFinite(secs) ? Math.round(secs) : null;
    }
    const n = Number(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 && /^\d+(\.\d+)?\s*(s|sec|secs|seconds)$/i.test(s) ? Math.round(n) : null;
}

function parseExplicit(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toLowerCase();
    if (['yes', 'true', 'explicit'].includes(s)) return true;
    if (['no', 'false', 'clean', 'notexplicit', 'not explicit'].includes(s)) return false;
    return null;
}

function parseAppleExplicit(v) {
    if (!v) return null;
    if (v === 'explicit') return true;
    if (v === 'notExplicit' || v === 'cleaned') return false;
    return null;
}

function toIsoDateTime(value) {
    if (!value) return null;
    const d = new Date(String(value).trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toTimestamp(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
}

function toInteger(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
}

/** Key used to recognise the same feed reached through different spellings (scheme, case, trailing slash). */
function feedDedupeKey(u) {
    if (!u) return null;
    try {
        const url = new URL(u);
        return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
    } catch {
        return u.toLowerCase();
    }
}

function normalizeUrl(u) {
    if (!u) return null;
    const s = String(u).trim();
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
}

function truncate(s, max) {
    if (!s) return s ?? null;
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function stripHtml(html) {
    if (!html) return null;
    const out = String(html)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h\d|blockquote|ul|ol)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return out.length ? out : null;
}

function cleanWhitespace(s) {
    if (s === null || s === undefined) return null;
    const out = String(s).replace(/\s+/g, ' ').trim();
    return out.length ? out : null;
}
