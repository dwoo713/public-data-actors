/**
 * Shared implementation for Periscope S2G "BSO" portals (COMMBUYS, NJSTART, OregonBuys).
 * Public JSF search page -> PrimeFaces partial AJAX (no login) -> public bidDetail.sda pages.
 */
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { createClient, formBody, mapWithConcurrency, MAX_CONCURRENCY_PER_PORTAL } from '../lib/http.js';
import { checkRobots } from '../lib/robots.js';
import { parseLocalDateTime, onOrAfter } from '../lib/dates.js';
import { cleanText, oneLine, truncate, elementText, classifySolicitationType, classifyAgencyType, extractEmail, extractPhone, makeRecord } from '../lib/normalize.js';
import { pastDeadline } from '../lib/deadline.js';

const SEARCH_PATH = '/bso/view/search/external/advancedSearchBid.xhtml';
const DETAIL_PATH = '/bso/external/bidDetail.sda';
const PAGE_SIZE = 25;
const STATUS_SENT = '2BS'; // "Sent" = published and accepting quotes
const RESULTS_TABLE = 'bidSearchResultsForm:bidResultId';
const AJAX_HEADERS = {
    'Faces-Request': 'partial/ajax',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
};

export function createPeriscopePortal({ key, name, state, baseUrl, tz }) {
    const searchUrl = `${baseUrl}${SEARCH_PATH}`;

    async function openSession(client) {
        const res = await client.request(searchUrl);
        const $ = cheerio.load(res.text);
        const viewState = $('input[name="javax.faces.ViewState"]').first().attr('value');
        const csrf = $('input[name="_csrf"]').first().attr('value');
        const m = /initSearchNew\s*=\s*function\s*\(\)\s*\{\s*return\s+PrimeFaces\.ab\(\{s:"([^"]+)"/.exec(res.text);
        if (!viewState || !m) throw new Error(`${name}: could not find JSF ViewState / search action on ${searchUrl}`);
        return { viewState, csrf, searchSource: m[1] };
    }

    async function ajax(client, session, params) {
        const body = formBody({
            'javax.faces.partial.ajax': 'true',
            ...params,
            ...(session.csrf ? { _csrf: session.csrf } : {}),
            'javax.faces.ViewState': session.viewState,
        });
        const res = await client.request(searchUrl, { method: 'POST', body, headers: { ...AJAX_HEADERS, Referer: searchUrl } });
        const vs = /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]*)\]\]>/.exec(res.text);
        if (vs?.[1]) session.viewState = vs[1];
        const err = /<error><error-name>([^<]*)<\/error-name><error-message><!\[CDATA\[([\s\S]*?)\]\]>/.exec(res.text);
        if (err) throw new Error(`${name}: JSF error ${err[1]}: ${err[2].slice(0, 200)}`);
        return res.text;
    }

    function parseResults(xml, knownTitles = []) {
        const blocks = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1]);
        let html = blocks.find((b) => b.includes('data-ri=')) ?? blocks.find((b) => b.includes(RESULTS_TABLE)) ?? '';
        // Sort/pagination updates return bare <tr> rows; an HTML parser drops <tr> outside a table.
        if (/^\s*<tr[\s>]/i.test(html)) html = `<table><tbody>${html}</tbody></table>`;
        const $ = cheerio.load(html);
        let titles = $('thead th').map((_, th) => oneLine($(th).find('.ui-column-title').text() || $(th).text()) ?? '').get();
        if (!titles.length) titles = knownTitles;
        const rows = [];
        $('tbody tr[data-ri]').each((_, tr) => {
            const cells = {};
            $(tr).children('td').each((i, td) => {
                const t = titles[i];
                const text = oneLine($(td).text());
                if (t && (cells[t] === undefined || (!cells[t] && text))) cells[t] = text;
            });
            const href = $(tr).find('a[href*="bidDetail"]').first().attr('href');
            const number = cells['Bid Solicitation #'] ?? oneLine($(tr).find('a').first().text());
            if (!number) return;
            const docId = /docId=([^&"]+)/.exec(href ?? '')?.[1] ?? number;
            rows.push({
                number,
                docId: decodeURIComponent(docId),
                title: cells['Description'] ?? null,
                agency: cells['Organization Name'] ?? null,
                buyer: cells['Buyer'] ?? null,
                openingRaw: cells['Bid Opening Date'] ?? null,
                status: cells['Status'] ?? null,
                alternateId: cells['Alternate Id'] ?? null,
                sourceUrl: `${baseUrl}${DETAIL_PATH}?docId=${encodeURIComponent(docId)}&external=true&parentUrl=close`,
            });
        });
        const pag = oneLine($('.ui-paginator-current').first().text()) ?? '';
        const total = /of\s+([\d,]+)/.exec(pag) ? Number(/of\s+([\d,]+)/.exec(pag)[1].replace(/,/g, '')) : null;
        let sortKey = null;
        $('select[id$="_reflowDD"] option').each((_, o) => {
            if (/Bid Opening Date Descending/i.test($(o).text())) sortKey = ($(o).attr('value') ?? '').replace(/_\d$/, '');
        });
        return { rows, total, sortKey, titles };
    }

    function baseRecord(row) {
        const close = parseLocalDateTime(row.openingRaw, tz);
        return makeRecord({
            portal: key,
            state,
            solicitationId: row.docId,
            solicitationNumber: row.number,
            title: row.title,
            agency: row.agency,
            agencyType: classifyAgencyType(row.agency),
            solicitationType: classifySolicitationType(row.title),
            status: 'open',
            closeDate: close.iso,
            closeTime: close.time,
            contactName: row.buyer,
            sourceUrl: row.sourceUrl,
        });
    }

    async function enrich(client, row) {
        const rec = baseRecord(row);
        let res;
        try {
            res = await client.request(row.sourceUrl);
        } catch (err) {
            log.warning(`${name}: detail fetch failed for ${row.number}: ${err.message}`);
            return rec;
        }
        const $ = cheerio.load(res.text);
        const fields = {};
        $('td.t-head-01').each((_, el) => {
            const label = oneLine($(el).text())?.replace(/\s*:$/, '');
            if (!label || fields[label] !== undefined) return;
            const next = $(el).next('td');
            fields[label] = next.length ? elementText($, next) : null;
        });

        const attachments = [];
        $('a[href^="javascript:downloadFile("]').each((_, a) => {
            const id = /downloadFile\('(\d+)'/.exec($(a).attr('href'))?.[1];
            const label = oneLine($(a).text());
            if (id && label) attachments.push({ name: label, url: `${baseUrl}${DETAIL_PATH}?downloadFileNbr=${id}&docId=${encodeURIComponent(row.docId)}&docType=B&mode=download&external=true` });
        });

        const categories = [];
        const seenCodes = new Set();
        $('td').each((_, td) => {
            const t = oneLine($(td).text()) ?? '';
            const m = /^(NIGP|U\s*N\s*S\s*P\s*S\s*C)\s*Code:?$/i.exec(t);
            if (!m) return;
            let code = oneLine($(td).next('td').text());
            let label = oneLine($(td).next('td').next('td').text());
            if (!code) return;
            const split = /^([\d]{2,3}(?:\s*-\s*\d{2,3})*)\s+(.+)$/.exec(code);
            if (split && !label) { code = split[1]; label = split[2]; }
            code = code.replace(/\s*-\s*/g, '-');
            if (!seenCodes.has(code)) {
                seenCodes.add(code);
                categories.push({ system: /NIGP/i.test(m[1]) ? 'NIGP' : 'UNSPSC', code, label: label ?? null });
            }
        });

        const itemDescriptions = [];
        $('td.t-head-01').each((_, td) => {
            if (!/^Item\s*#/i.test(oneLine($(td).text()) ?? '')) return;
            const t = cleanText(elementText($, $(td).next('td.inputs-01')));
            if (t && !itemDescriptions.includes(t)) itemDescriptions.push(t);
        });
        const bulletin = fields['Bulletin Desc'] ?? '';
        const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
        const descriptionParts = [bulletin, ...itemDescriptions.filter((t) => !bulletin || !norm(bulletin).includes(norm(t)))].filter(Boolean);
        const description = descriptionParts.length ? truncate(descriptionParts.join('\n\n')) : null;

        const title = oneLine(fields['Description']) ?? rec.title;
        const agency = oneLine(fields['Organization']) ?? rec.agency;
        const close = parseLocalDateTime(fields['Bid Opening Date'] ?? row.openingRaw, tz);
        const posted = parseLocalDateTime(fields['Available Date'], tz);
        const infoContact = fields['Info Contact'] ?? '';

        return {
            ...rec,
            title,
            agency,
            agencyType: classifyAgencyType(agency),
            solicitationType: classifySolicitationType(title, fields['Procurement Method'], fields['Type Code'], fields['Discipline Type'], description),
            description,
            postedDate: posted.iso,
            closeDate: close.iso ?? rec.closeDate,
            closeTime: close.time ?? rec.closeTime,
            categories,
            location: oneLine(fields['Location']) ?? null,
            contactName: oneLine(fields['Purchaser']) ?? rec.contactName,
            contactEmail: extractEmail(infoContact),
            contactPhone: extractPhone(infoContact),
            attachments,
        };
    }

    return {
        key,
        name,
        state,
        async robotsOk() {
            return checkRobots(createClient(), baseUrl, [SEARCH_PATH, DETAIL_PATH]);
        },
        async *listOpen({ keyword = '', postedAfter = null, closesAfter = null, maxResults = 200, includeDescription = true, deadline = Infinity } = {}) {
            const client = createClient();
            const session = await openSession(client);

            // Step 1: run the public "Bid Solicitation" search restricted to status Sent (open for quotes).
            let xml = await ajax(client, session, {
                'javax.faces.source': session.searchSource,
                'javax.faces.partial.execute': '@all',
                'javax.faces.partial.render': 'advSearchResults',
                [session.searchSource]: session.searchSource,
                bidSearchForm: 'bidSearchForm',
                'bidSearchForm:status': STATUS_SENT,
                'bidSearchForm:desc': keyword ?? '',
            });
            let page = parseResults(xml);
            log.info(`${name}: ${page.total ?? '?'} solicitations with status Sent${keyword ? ` matching "${keyword}"` : ''}`);

            const tableAjax = (extra) => ajax(client, session, {
                'javax.faces.source': RESULTS_TABLE,
                'javax.faces.partial.execute': RESULTS_TABLE,
                'javax.faces.partial.render': RESULTS_TABLE,
                [RESULTS_TABLE]: RESULTS_TABLE,
                [`${RESULTS_TABLE}_skipChildren`]: 'true',
                [`${RESULTS_TABLE}_encodeFeature`]: 'true',
                bidSearchResultsForm: 'bidSearchResultsForm',
                openBids: 'false',
                ...extra,
            });
            const fetchPage = async (first) => parseResults(await tableAjax({
                [`${RESULTS_TABLE}_pagination`]: 'true',
                [`${RESULTS_TABLE}_first`]: String(first),
                [`${RESULTS_TABLE}_rows`]: String(PAGE_SIZE),
            }), page.titles).rows;
            const rowIsOpen = (r) => onOrAfter(parseLocalDateTime(r.openingRaw, tz).iso, closesAfter);

            // Step 2: sort by Bid Opening Date ascending. The "Sent" pool keeps every bid ever published
            // (69k on COMMBUYS), so we then binary-search the first page whose opening dates reach
            // `closesAfter` and walk forward from there: soonest-closing solicitations come first.
            let sorted = false;
            if (page.sortKey) {
                const s = parseResults(await tableAjax({
                    [`${RESULTS_TABLE}_sorting`]: 'true',
                    [`${RESULTS_TABLE}_sortKey`]: page.sortKey,
                    [`${RESULTS_TABLE}_sortDir`]: '1',
                }), page.titles);
                if (s.rows.length) { page = { ...page, rows: s.rows }; sorted = true; }
            }
            if (!sorted) log.warning(`${name}: could not sort by opening date; falling back to bid-number order`);

            let first = 0;
            let rows = page.rows;
            if (sorted && closesAfter && page.total && page.total > PAGE_SIZE && !rows.some(rowIsOpen)) {
                let lo = 1;
                let hi = Math.ceil(page.total / PAGE_SIZE) - 1;
                let found = null;
                while (lo <= hi) {
                    if (pastDeadline(deadline)) { log.warning(`${name}: time budget reached while locating open bids`); return; }
                    const mid = Math.floor((lo + hi) / 2);
                    const probe = await fetchPage(mid * PAGE_SIZE);
                    if (probe.length && probe.some(rowIsOpen)) { found = { index: mid, rows: probe }; hi = mid - 1; }
                    else lo = mid + 1;
                }
                if (found) { first = found.index * PAGE_SIZE; rows = found.rows; }
                else { first = page.total; rows = []; }
                log.info(`${name}: skipped ${first} bids whose opening date is before ${closesAfter}`);
            }

            let yielded = 0;
            let emptyStreak = 0;
            const seen = new Set();
            for (;;) {
                if (pastDeadline(deadline)) return;
                const candidates = rows.filter((r) => {
                    if (seen.has(r.docId)) return false;
                    seen.add(r.docId);
                    return rowIsOpen(r);
                });
                const records = includeDescription
                    ? await mapWithConcurrency(candidates, MAX_CONCURRENCY_PER_PORTAL, (r) => (pastDeadline(deadline) ? baseRecord(r) : enrich(client, r)))
                    : candidates.map((r) => baseRecord(r));
                for (const rec of records) {
                    if (postedAfter && rec.postedDate && !onOrAfter(rec.postedDate, postedAfter)) continue;
                    yield rec;
                    yielded += 1;
                    if (yielded >= maxResults) return;
                }

                if (rows.length === 0) return;
                emptyStreak = candidates.length === 0 ? emptyStreak + 1 : 0;
                if (!sorted && emptyStreak >= 5) return;

                first += PAGE_SIZE;
                if (page.total !== null && first >= page.total) return;
                rows = await fetchPage(first);
            }
        },
    };
}
