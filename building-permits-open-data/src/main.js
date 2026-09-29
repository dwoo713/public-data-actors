import { Actor, log } from 'apify';
import { CITIES, buildCustomSource } from './cities.js';

const PAGE_SIZE = 1000;
const EVENT_PERMIT = 'permit';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
const USER_AGENT = 'apify-building-permits-open-data/0.1';

class RetryableError extends Error {}

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    cities = ['chicago', 'nyc'],
    custom = null,
    issuedAfter,
    issuedBefore,
    permitTypeContains = '',
    minEstimatedCost,
    maxResultsPerCity = 500,
    includeRaw = false,
    appToken = '',
} = input;

const issuedAfterTs = toTimestamp(issuedAfter);
const issuedBeforeTs = toTimestamp(issuedBefore);
const typeNeedle = String(permitTypeContains ?? '').trim();
const minCost = Number.isFinite(Number(minEstimatedCost)) && minEstimatedCost !== null && minEstimatedCost !== '' ? Number(minEstimatedCost) : null;

const sources = [];
for (const key of Array.isArray(cities) ? cities : []) {
    const def = CITIES[key];
    if (!def) { log.warning(`Unknown city key "${key}" - skipping. Known keys: ${Object.keys(CITIES).join(', ')}`); continue; }
    sources.push({ key, ...def });
}
if (custom && (custom.domain || custom.datasetId)) sources.push(buildCustomSource(custom));
if (sources.length === 0) {
    log.error('Nothing to do: select at least one city or provide a custom portal.');
    await Actor.exit();
}

log.info('Starting building permits scrape', {
    sources: sources.map((s) => `${s.key} (${s.domain}/${s.datasetId})`),
    issuedAfter, issuedBefore, permitTypeContains: typeNeedle || undefined, minEstimatedCost: minCost ?? undefined, maxResultsPerCity,
});

let totalPushed = 0;
let chargeLimitReached = false;
const summary = [];

for (const source of sources) {
    if (chargeLimitReached) break;
    const pushed = await scrapeSource(source);
    summary.push({ source: source.key, permits: pushed });
    totalPushed += pushed;
}

log.info(`Done. Pushed ${totalPushed} permits.`, { summary });
await Actor.exit();

// ---------------------------------------------------------------------------

async function scrapeSource(source) {
    const where = buildWhere(source);
    const order = source.dateField && source.dateKind !== 'textMDY' ? `${source.dateField} DESC` : ':id';
    let offset = 0;
    let pushed = 0;
    let seen = 0;

    log.info(`[${source.key}] ${source.displayName}: querying ${source.domain}/${source.datasetId}`, { where: where || undefined, order });

    while (pushed < maxResultsPerCity && !chargeLimitReached) {
        const limit = Math.min(PAGE_SIZE, maxResultsPerCity - pushed);
        const url = buildUrl(source, { where, order, offset, limit });
        let rows;
        try {
            rows = await getJson(url);
        } catch (err) {
            log.error(`[${source.key}] request failed, stopping this source: ${err.message}`);
            break;
        }
        if (!Array.isArray(rows)) { log.error(`[${source.key}] unexpected response, stopping.`); break; }
        if (rows.length === 0) break;
        seen += rows.length;

        for (const row of rows) {
            let record;
            try {
                record = normalize(source, row);
            } catch (err) {
                log.warning(`[${source.key}] could not normalize a record: ${err.message}`);
                continue;
            }
            if (!passesClientFilters(source, record)) continue;

            const charge = await Actor.charge({ eventName: EVENT_PERMIT, count: 1 });
            if (charge.eventChargeLimitReached) {
                log.warning('Charge limit reached, stopping before pushing more results.');
                chargeLimitReached = true;
                break;
            }
            await Actor.pushData(record);
            pushed += 1;
            if (pushed >= maxResultsPerCity) break;
        }

        log.info(`[${source.key}] page at offset ${offset}: ${rows.length} rows, ${pushed} permits pushed so far`);
        if (rows.length < limit) break;
        offset += rows.length;
    }

    log.info(`[${source.key}] finished: ${pushed} permits pushed (${seen} rows scanned)`);
    return pushed;
}

function buildWhere(source) {
    const clauses = [];
    const { dateField, dateKind = 'timestamp', typeField, costField, costIsText } = source;

    if (dateField) {
        if (dateKind === 'textMDY') {
            // Dates stored as MM/DD/YYYY text: restrict by month with LIKE, then filter exactly client-side.
            const months = monthsBetween(issuedAfterTs, issuedBeforeTs);
            if (months) clauses.push(`(${months.map(([m, y]) => `${dateField} like '${m}/%/${y}'`).join(' OR ')})`);
        } else {
            if (issuedAfter) clauses.push(`${dateField} >= '${issuedAfter}T00:00:00'`);
            if (issuedBefore) clauses.push(`${dateField} < '${issuedBefore}T00:00:00'`);
            if (!issuedAfter && !issuedBefore) clauses.push(`${dateField} IS NOT NULL`);
        }
    }
    if (typeNeedle && typeField) clauses.push(`upper(${typeField}) like '%${soqlEscape(typeNeedle.toUpperCase())}%'`);
    if (minCost !== null && costField && !source.isCustom) {
        clauses.push(`${costField}${costIsText ? '::number' : ''} >= ${minCost}`);
    }
    return clauses.join(' AND ');
}

function buildUrl(source, { where, order, offset, limit }) {
    const params = new URLSearchParams();
    params.set('$limit', String(limit));
    params.set('$offset', String(offset));
    params.set('$order', order);
    if (where) params.set('$where', where);
    return `https://${source.domain}/resource/${source.datasetId}.json?${params.toString()}`;
}

function normalize(source, row) {
    const mapped = source.map(row) ?? {};
    const record = {
        permitNumber: null,
        permitType: null,
        permitSubtype: null,
        status: null,
        workDescription: null,
        address: null,
        city: source.city ?? null,
        state: source.state ?? null,
        zip: null,
        latitude: null,
        longitude: null,
        appliedDate: null,
        issuedDate: null,
        completedDate: null,
        expirationDate: null,
        estimatedCost: null,
        fees: null,
        contractorName: null,
        contractorLicense: null,
        unitsOrStories: null,
        recordUrl: null,
        ...mapped,
    };
    for (const k of ['appliedDate', 'issuedDate', 'completedDate', 'expirationDate', 'approvedDate']) {
        if (k in record) record[k] = toIsoDate(record[k]);
    }
    if (record.city === null && source.city) record.city = source.city;
    if (record.state === null && source.state) record.state = source.state;
    if (record.zip) record.zip = String(record.zip).trim().replace(/-$/, '') || null;

    record.sourceKey = source.key;
    record.sourceName = source.displayName;
    record.sourceDomain = source.domain;
    record.sourceDatasetId = source.datasetId;
    record.sourceUrl = source.sourceUrl;
    if (includeRaw) record.raw = row;
    record.scrapedAt = new Date().toISOString();
    return record;
}

function passesClientFilters(source, record) {
    // Server-side filters already did the heavy lifting; these are exact re-checks
    // (needed for text-typed date columns and for custom sources).
    const issued = toTimestamp(record.issuedDate);
    if (issuedAfterTs && (issued === null || issued < issuedAfterTs)) return false;
    if (issuedBeforeTs && (issued === null || issued >= issuedBeforeTs)) return false;
    if (minCost !== null && source.costField) {
        if (record.estimatedCost === null || record.estimatedCost < minCost) return false;
    }
    if (typeNeedle && source.typeField && source.isCustom) {
        if (!String(record.permitType ?? '').toUpperCase().includes(typeNeedle.toUpperCase())) return false;
    }
    return true;
}

async function getJson(url, attempt = 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
        if (appToken) headers['X-App-Token'] = appToken;
        const res = await fetch(url, { headers, signal: controller.signal });
        if (res.status === 429 || res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            let msg = body.slice(0, 300);
            try { msg = JSON.parse(body).message ?? msg; } catch { /* keep text */ }
            throw new Error(`HTTP ${res.status}: ${msg}`);
        }
        return await res.json();
    } catch (err) {
        const retryable = err instanceof RetryableError || err.name === 'AbortError' || err.name === 'TypeError' || /fetch failed|ECONN|ETIMEDOUT|socket/i.test(err.message);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
        const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        log.warning(`Request failed (${err.message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        return getJson(url, attempt + 1);
    } finally {
        clearTimeout(timer);
    }
}


function soqlEscape(s) {
    return String(s).replace(/'/g, "''").replace(/%/g, '');
}

function monthsBetween(afterTs, beforeTs) {
    if (!afterTs && !beforeTs) return null;
    const start = new Date(afterTs ?? Date.now() - 365 * 86_400_000);
    const end = new Date(beforeTs ? beforeTs - 1 : Date.now());
    if (end < start) return [];
    const months = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end && months.length < 60) {
        months.push([String(cursor.getUTCMonth() + 1).padStart(2, '0'), String(cursor.getUTCFullYear())]);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
}

function toIsoDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
    if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toTimestamp(iso) {
    if (!iso) return null;
    const t = Date.parse(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
    return Number.isNaN(t) ? null : t;
}
