import { Actor, log } from 'apify';

const SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
const DETAIL_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';
const DETAIL_PAGE = (id) => `https://www.grants.gov/search-results-detail/${id}`;
const ATTACHMENT_URL = (id) => `https://www.grants.gov/grantsws/rest/opportunity/att/download/${id}`;
const PAGE_SIZE = 500;
const DETAIL_CONCURRENCY = 6;
const EVENT_OPPORTUNITY = 'opportunity';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    keyword = '',
    oppStatuses = ['posted'],
    agencies = [],
    fundingCategories = [],
    eligibilities = [],
    fundingInstruments = [],
    cfda = '',
    postedAfter,
    closesAfter,
    maxResults = 100,
    includeDetails = true,
    includeDescriptionHtml = false,
} = input;

const postedAfterTs = toTimestamp(postedAfter);
const closesAfterTs = toTimestamp(closesAfter);

log.info('Starting Grants.gov scrape', { keyword, oppStatuses, agencies, maxResults, includeDetails });

// Grants.gov only filters on sub-agency codes (e.g. DOC-EDA). Expand top-level codes (e.g. HHS, DOE)
// into every sub-agency code using the facet list from an unfiltered search.
const agencyCodes = await expandAgencyCodes(agencies);
if (agencyCodes.length !== agencies.length) log.info(`Expanded agency filter to ${agencyCodes.length} codes`, { agencyCodes });

let pushed = 0;
let start = 0;
let hitCount = null;
let stop = false;

while (!stop) {
    const page = await searchPage(start);
    if (hitCount === null) {
        hitCount = page.hitCount;
        log.info(`Grants.gov reports ${hitCount} matching opportunities`);
    }
    const hits = page.oppHits ?? [];
    if (hits.length === 0) break;

    const candidates = hits.filter((h) => passesDateFilters(h)).slice(0, maxResults - pushed);
    const records = includeDetails
        ? await mapWithConcurrency(candidates, DETAIL_CONCURRENCY, (h) => buildRecord(h))
        : await Promise.all(candidates.map((h) => buildRecord(h, null)));

    for (const record of records) {
        if (!record) continue;
        const charge = await Actor.charge({ eventName: EVENT_OPPORTUNITY, count: 1 });
        if (charge.eventChargeLimitReached) {
            log.warning('Charge limit reached, stopping before pushing more results.');
            stop = true;
            break;
        }
        await Actor.pushData(record);
        pushed += 1;
        if (pushed >= maxResults) { stop = true; break; }
    }

    start += hits.length;
    if (start >= hitCount) break;
}

log.info(`Done. Pushed ${pushed} opportunities.`);
await Actor.exit();

// ---------------------------------------------------------------------------

async function searchPage(startRecordNum) {
    const body = {
        keyword,
        rows: PAGE_SIZE,
        startRecordNum,
        oppStatuses: oppStatuses.join('|'),
        agencies: agencyCodes.join('|'),
        fundingCategories: fundingCategories.join('|'),
        eligibilities: eligibilities.join('|'),
        fundingInstruments: fundingInstruments.join('|'),
        cfda,
        sortBy: 'openDate|desc',
    };
    const json = await postJson(SEARCH_URL, body);
    if (json.errorcode !== 0) throw new Error(`Grants.gov search failed: ${json.msg}`);
    return json.data;
}

async function expandAgencyCodes(codes) {
    if (!codes.length) return [];
    const json = await postJson(SEARCH_URL, { keyword, rows: 1, oppStatuses: oppStatuses.join('|') });
    const facets = json.data?.agencies ?? [];
    const expanded = new Set();
    for (const code of codes) {
        const top = facets.find((a) => a.value === code);
        if (top && (top.subAgencyOptions ?? []).length > 0) {
            for (const sub of top.subAgencyOptions) expanded.add(sub.value);
            continue;
        }
        expanded.add(code);
    }
    return [...expanded];
}

async function fetchDetail(id) {
    const json = await postJson(DETAIL_URL, { opportunityId: Number(id) });
    if (json.errorcode !== 0) {
        log.warning(`Detail fetch failed for ${id}: ${json.msg}`);
        return null;
    }
    return json.data;
}

async function buildRecord(hit, detailOverride) {
    const detail = detailOverride === null ? null : await fetchDetail(hit.id);
    const syn = detail?.synopsis ?? detail?.forecast ?? null;

    const base = {
        opportunityId: String(hit.id),
        opportunityNumber: hit.number ?? null,
        title: hit.title ?? null,
        agencyCode: hit.agencyCode ?? null,
        agencyName: hit.agency ?? null,
        status: hit.oppStatus ?? null,
        docType: hit.docType ?? null,
        postedDate: toIsoDate(hit.openDate),
        closeDate: toIsoDate(hit.closeDate),
        cfdaNumbers: hit.cfdaList ?? [],
        url: DETAIL_PAGE(hit.id),
        scrapedAt: new Date().toISOString(),
    };
    if (!detail) return base;

    const attachments = [];
    for (const folder of detail.synopsisAttachmentFolders ?? []) {
        for (const att of folder.synopsisAttachments ?? []) {
            attachments.push({
                id: att.id,
                fileName: att.fileName ?? null,
                description: att.fileDescription ?? null,
                mimeType: att.mimeType ?? null,
                sizeBytes: att.fileLobSize ?? null,
                folder: folder.folderType ?? null,
                downloadUrl: ATTACHMENT_URL(att.id),
            });
        }
    }

    const descriptionHtml = syn?.synopsisDesc ?? syn?.forecastDesc ?? null;

    return {
        ...base,
        topAgencyName: detail.topAgencyDetails?.agencyName ?? null,
        topAgencyCode: detail.topAgencyDetails?.agencyCode ?? null,
        category: detail.opportunityCategory?.description ?? null,
        archiveDate: toIsoDate(syn?.archiveDateStr, true),
        lastUpdated: syn?.lastUpdatedDate ?? null,
        programTitles: (detail.cfdas ?? []).map((c) => c.programTitle).filter(Boolean),
        fundingInstruments: (syn?.fundingInstruments ?? []).map((f) => f.description),
        fundingCategories: (syn?.fundingActivityCategories ?? []).map((f) => f.description),
        applicantTypes: (syn?.applicantTypes ?? []).map((a) => a.description),
        eligibilityDescription: stripHtml(syn?.applicantEligibilityDesc),
        awardCeiling: toNumber(syn?.awardCeiling),
        awardFloor: toNumber(syn?.awardFloor),
        estimatedTotalFunding: toNumber(syn?.estimatedFunding),
        numberOfAwards: toNumber(syn?.numberOfAwards),
        costSharingRequired: syn?.costSharing === 'Y' ? true : syn?.costSharing === 'N' ? false : null,
        description: stripHtml(descriptionHtml),
        ...(includeDescriptionHtml ? { descriptionHtml } : {}),
        contact: {
            name: cleanWhitespace(syn?.agencyContactName),
            email: syn?.agencyContactEmail ?? null,
            phone: syn?.agencyContactPhone ?? null,
            description: cleanWhitespace(syn?.agencyContactDesc),
        },
        attachments,
        hasApplicationPackage: (detail.opportunityPkgs ?? []).length > 0,
    };
}

function passesDateFilters(hit) {
    if (postedAfterTs && toTimestamp(toIsoDate(hit.openDate)) < postedAfterTs) return false;
    if (closesAfterTs) {
        const close = toTimestamp(toIsoDate(hit.closeDate));
        if (close && close < closesAfterTs) return false;
    }
    return true;
}

async function postJson(url, body, attempt = 1) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'apify-grants-gov-opportunities/0.1' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        if (attempt >= 4) throw err;
        const wait = 500 * 2 ** attempt;
        log.debug(`Request to ${url} failed (${err.message}), retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        return postJson(url, body, attempt + 1);
    }
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

function toIsoDate(value, compact = false) {
    if (!value) return null;
    if (compact) {
        // "2026-11-17-00-00-00"
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }
    // "11/17/2026"
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toTimestamp(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
}

function toNumber(v) {
    if (v === null || v === undefined || v === '' || v === 'none') return null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isNaN(n) ? null : n;
}

function stripHtml(html) {
    if (!html) return null;
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function cleanWhitespace(s) {
    if (!s) return null;
    return s.replace(/\s+/g, ' ').trim();
}
