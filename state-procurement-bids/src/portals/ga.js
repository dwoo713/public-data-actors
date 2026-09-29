/**
 * Georgia Procurement Registry (GPR): public DataTables JSON endpoint POST /gpr/eventSearch
 * plus public /gpr/eventDetails pages. Covers state agencies and local governments.
 */
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { createClient, formBody, mapWithConcurrency, MAX_CONCURRENCY_PER_PORTAL } from '../lib/http.js';
import { checkRobots } from '../lib/robots.js';
import { parseLocalDateTime, onOrAfter } from '../lib/dates.js';
import { oneLine, truncate, elementText, classifySolicitationType, extractEmail, extractPhone, absoluteUrl, makeRecord } from '../lib/normalize.js';

const BASE = 'https://ssl.doas.state.ga.us';
const HOME = `${BASE}/gpr/`;
const SEARCH = `${BASE}/gpr/eventSearch`;
const TZ = 'America/New_York';
const PAGE_SIZE = 100;

const GOV_TYPE = { county: 'county', city: 'city', school: 'school district', state: 'state agency', other: 'other' };

function detailUrl(hit) {
    return `${BASE}/gpr/eventDetails?eSourceNumber=${encodeURIComponent(hit.esourceNumberKey ?? hit.esourceNumber)}&sourceSystemType=${encodeURIComponent(hit.sourceId ?? 'gpr20')}`;
}

function baseRecord(hit) {
    const close = parseLocalDateTime(hit.closingDateStr ?? hit.closingDate, TZ);
    const posted = parseLocalDateTime(hit.postingDateStr ?? hit.postingDate, TZ);
    const gov = String(hit.governmentType ?? '').toLowerCase();
    return makeRecord({
        portal: 'ga-gpr',
        state: 'GA',
        solicitationId: hit.esourceNumberKey ?? hit.esourceNumber,
        solicitationNumber: hit.esourceNumber,
        title: oneLine(hit.title),
        agency: oneLine(hit.agencyName),
        agencyType: GOV_TYPE[gov] ?? (gov ? 'other' : null),
        solicitationType: classifySolicitationType(hit.bidProcessType, hit.title),
        status: String(hit.status ?? 'open').toLowerCase(),
        postedDate: posted.iso,
        closeDate: close.iso,
        closeTime: close.time,
        categories: [],
        sourceUrl: detailUrl(hit),
    });
}

async function enrich(client, hit) {
    const rec = baseRecord(hit);
    let res;
    try {
        res = await client.request(rec.sourceUrl);
    } catch (err) {
        log.warning(`GPR: detail fetch failed for ${hit.esourceNumber}: ${err.message}`);
        return rec;
    }
    const $ = cheerio.load(res.text);
    const cell = (header) => oneLine($(`.td[data-header="${header}"]`).first().text());

    const description = truncate(elementText($, $('.paragraph.description').first()) ?? elementText($, $('h3.section-title:contains("Description")').first().next('p')));

    const contactBlock = $('h3:contains("Buyer Contact")').first().next('p');
    const contactText = oneLine(contactBlock.text()) ?? '';
    const contactEmail = contactBlock.find('a[href^="mailto:"]').first().attr('href')?.replace(/^mailto:/i, '').trim() || extractEmail(contactText);
    const contactPhone = extractPhone(contactText);
    let contactName = contactText;
    if (contactEmail) contactName = contactName.replace(contactEmail, '');
    if (contactPhone) contactName = contactName.replace(contactPhone, '');
    contactName = oneLine(contactName.replace(/[|,;]+/g, ' ')) ?? null;

    const categories = [];
    $('#nigp table tbody tr, table.nigp_table tbody tr').each((_, tr) => {
        const tds = $(tr).children('td');
        const code = oneLine(tds.eq(0).text());
        if (code && !categories.some((c) => c.code === code)) categories.push({ system: 'NIGP', code, label: oneLine(tds.eq(1).text()) });
    });
    const categoryType = cell('Category Type:');
    if (categoryType) categories.push({ system: 'GPR category', code: null, label: categoryType });

    const attachments = [];
    $('a[href*="downloadAttachment"]').each((_, a) => {
        const label = oneLine($(a).text());
        const url = absoluteUrl($(a).attr('href'), HOME);
        if (label && url && !attachments.some((x) => x.url === url)) attachments.push({ name: label, url });
    });
    const agencySite = $('.td[data-header="Agency Site:"] a').first().attr('href');
    if (agencySite) attachments.push({ name: 'Agency posting (external site)', url: agencySite });

    const eventType = cell('Event Type:');
    const purchaseType = cell('Purchase Type:');
    const agencyHeading = oneLine($('h4.mt-3').first().text());
    const agency = agencyHeading ? agencyHeading.replace(/^\d+\s+/, '') : rec.agency;

    return {
        ...rec,
        agency: agency ?? rec.agency,
        solicitationType: classifySolicitationType(hit.bidProcessType, eventType, purchaseType, rec.title, description),
        status: (cell('Event Status:') ?? rec.status).toLowerCase(),
        description,
        categories,
        contactName,
        contactEmail: contactEmail ?? null,
        contactPhone,
        attachments,
    };
}

export default {
    key: 'ga-gpr',
    name: 'Georgia Procurement Registry',
    state: 'GA',
    async robotsOk() {
        return checkRobots(createClient(), BASE, ['/gpr/', '/gpr/eventSearch', '/gpr/eventDetails']);
    },
    async *listOpen({ keyword = '', postedAfter = null, closesAfter = null, maxResults = 200, includeDescription = true } = {}) {
        const client = createClient();
        const home = await client.request(HOME); // establishes JSESSIONID
        if (/unsupported\?browser/i.test(home.url)) throw new Error('GPR rejected the user agent as an unsupported browser');

        let start = 0;
        let yielded = 0;
        let total = null;
        let draw = 0;
        const seen = new Set();
        while (yielded < maxResults) {
            draw += 1;
            const body = formBody({
                draw, start, length: PAGE_SIZE,
                responseType: 'ALL', eventStatus: 'OPEN', eventIdTitle: keyword ?? '', govType: 'ALL', govEntity: '', catType: '',
                eventProcessType: 'ALL', dateRangeType: '', rangeStartDate: '', rangeEndDate: '',
                isReset: 'false', persisted: 'false', refreshSearchData: 'true',
                'order[0][column]': '5', 'order[0][dir]': 'asc', // closing date ascending
                'search[value]': '',
            });
            const res = await client.request(SEARCH, {
                method: 'POST', body,
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: HOME, Accept: 'application/json, text/javascript, */*; q=0.01' },
            });
            let json;
            try { json = JSON.parse(res.text); } catch { throw new Error(`GPR: eventSearch did not return JSON (HTTP ${res.status})`); }
            if (total === null) {
                total = Number(json.recordsFiltered ?? json.recordsTotal ?? 0);
                log.info(`GPR: ${total} open events${keyword ? ` matching "${keyword}"` : ''}`);
            }
            const hits = (json.data ?? []).filter((h) => {
                const id = h.esourceNumberKey ?? h.esourceNumber;
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return onOrAfter(parseLocalDateTime(h.closingDate ?? h.closingDateStr, TZ).iso, closesAfter)
                    && (!postedAfter || onOrAfter(parseLocalDateTime(h.postingDate ?? h.postingDateStr, TZ).iso, postedAfter));
            });
            const records = includeDescription
                ? await mapWithConcurrency(hits, MAX_CONCURRENCY_PER_PORTAL, (h) => enrich(client, h))
                : hits.map(baseRecord);
            for (const rec of records) {
                yield rec;
                yielded += 1;
                if (yielded >= maxResults) return;
            }
            start += (json.data ?? []).length;
            if ((json.data ?? []).length === 0 || start >= total) return;
        }
    },
};
