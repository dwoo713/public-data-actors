/**
 * Louisiana LaPAC (Office of State Procurement): plain server-rendered ColdFusion pages.
 * deptbids.cfm lists every department with open bids -> dspBid.cfm?search=department&term=N lists them
 * with direct attachment links -> dspBidContact.cfm?bidno=X gives the official buyer contact.
 */
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { createClient, mapWithConcurrency, MAX_CONCURRENCY_PER_PORTAL } from '../lib/http.js';
import { checkRobots } from '../lib/robots.js';
import { parseLocalDateTime, onOrAfter } from '../lib/dates.js';
import { cleanText, oneLine, truncate, classifySolicitationType, unprotectEmails, absoluteUrl, makeRecord } from '../lib/normalize.js';

const BASE = 'https://wwwcfprd.doa.louisiana.gov';
const ROOT = `${BASE}/osp/lapac/`;
const TZ = 'America/Chicago';

function departmentMeta(rawName) {
    const name = oneLine(rawName) ?? '';
    const stripped = name.replace(/\s*-\s*\(\d+\)\s*$/, '');
    let agencyType = 'other';
    let agency = stripped;
    if (/^\*+\s*State Procurement/i.test(stripped)) { agency = 'Office of State Procurement'; agencyType = 'state agency'; }
    else if (/^\+\s*State\s*-\s*/i.test(stripped)) { agency = stripped.replace(/^\+\s*State\s*-\s*/i, ''); agencyType = 'state agency'; }
    else if (/^\+\+\s*University\s*-\s*/i.test(stripped)) { agency = stripped.replace(/^\+\+\s*University\s*-\s*/i, ''); agencyType = 'university'; }
    else if (/^\+-\s*Comm\/Tech College\s*-\s*/i.test(stripped)) { agency = stripped.replace(/^\+-\s*Comm\/Tech College\s*-\s*/i, ''); agencyType = 'university'; }
    else if (/^Non State\s*-\s*/i.test(stripped)) {
        agency = stripped.replace(/^Non State\s*-\s*/i, '');
        if (/school board|school district/i.test(agency)) agencyType = 'school district';
        else if (/\bcity of\b|\btown of\b/i.test(agency)) agencyType = 'city';
        else if (/parish/i.test(agency) && !/sheriff/i.test(agency)) agencyType = 'county';
        else agencyType = 'other';
    }
    return { agency: oneLine(agency.replace(/\s{2,}/g, ' ')), agencyType };
}

function stripLinksText($, td) {
    const clone = $(td).clone();
    clone.find('a, strong').remove();
    clone.find('br').replaceWith('\n');
    return cleanText(clone.text());
}

function parseListing($, dept) {
    const records = [];
    let current = null;
    $('table.bid tr').each((_, tr) => {
        const tds = $(tr).children('td');
        if (!tds.length) return;
        const numberSpan = tds.first().find('span').first();
        const descTd = tds.filter('.txt').first();
        if (numberSpan.length && oneLine(numberSpan.text())) {
            const number = oneLine(numberSpan.text());
            const html = descTd.html() ?? '';
            const title = oneLine(cheerio.load(`<div>${html.split(/<br\s*\/?>/i)[0]}</div>`)('div').text());
            const fullText = oneLine(descTd.text()) ?? '';
            const dateIssued = oneLine(tds.eq(2).text());
            const openText = oneLine(tds.eq(3).text());
            const contactMatch = /dspBidContact\.cfm\?bidno=([^'"&]+)/.exec(tds.eq(4).html() ?? '');
            current = {
                number,
                title,
                notes: [stripLinksText($, descTd)].filter(Boolean),
                cancelled: /bid\s+cancell?ed/i.test(fullText),
                dateIssued,
                openText,
                contactUrl: contactMatch ? `${ROOT}dspBidContact.cfm?bidno=${contactMatch[1]}` : null,
                agencyCode: oneLine(tds.eq(4).text()),
                attachments: [],
                dept,
            };
            records.push(current);
            collectLinks($, descTd, current);
        } else if (current && descTd.length) {
            const note = stripLinksText($, descTd);
            if (note) current.notes.push(note);
            if (/bid\s+cancell?ed/i.test(oneLine(descTd.text()) ?? '')) current.cancelled = true;
            collectLinks($, descTd, current);
        }
    });
    return records;
}

function collectLinks($, td, rec) {
    td.find('a[href]').each((_, a) => {
        const url = absoluteUrl($(a).attr('href'), ROOT);
        if (!url || !/\/osp\/lapac\/agency\//i.test(url)) return;
        let label = oneLine($(a).text()) ?? '';
        const prevStrong = $(a).prevAll('strong').first();
        if ((!label || label === rec.number) && prevStrong.length) label = `${oneLine(prevStrong.text()).replace(/:$/, '')} ${rec.number}`.trim();
        if (!rec.attachments.some((x) => x.url === url)) rec.attachments.push({ name: label || url, url });
    });
}

function baseRecord(row) {
    const close = parseLocalDateTime(row.openText, TZ);
    const posted = parseLocalDateTime(row.dateIssued, TZ);
    const description = truncate(row.notes.filter(Boolean).join('\n\n')) ?? row.title;
    return makeRecord({
        portal: 'la-lapac',
        state: 'LA',
        solicitationId: row.number,
        solicitationNumber: row.number,
        title: row.title,
        agency: row.dept.agency,
        agencyType: row.dept.agencyType,
        solicitationType: classifySolicitationType(row.title, description),
        status: row.cancelled ? 'cancelled' : 'open',
        description,
        postedDate: posted.iso,
        closeDate: close.iso,
        closeTime: close.time,
        location: 'Louisiana',
        attachments: row.attachments,
        sourceUrl: `${ROOT}dspBid.cfm?search=bidno&term=${encodeURIComponent(row.number)}`,
    });
}

async function enrich(client, row) {
    const rec = baseRecord(row);
    if (!row.contactUrl) return rec;
    let res;
    try {
        res = await client.request(row.contactUrl);
    } catch (err) {
        log.warning(`LaPAC: contact fetch failed for ${row.number}: ${err.message}`);
        return rec;
    }
    const $ = cheerio.load(res.text);
    unprotectEmails($);
    const fields = {};
    $('table.contact tr').each((_, tr) => {
        const label = oneLine($(tr).find('th').first().text());
        const td = $(tr).find('td').first();
        if (!label || !td.length) return;
        const clone = td.clone();
        clone.find('br').replaceWith(', ');
        fields[label] = oneLine(clone.text());
    });
    const section = fields['Section'];
    const agency = rec.agency === 'Office of State Procurement' && section ? `Office of State Procurement (${section})` : rec.agency;
    return {
        ...rec,
        agency,
        location: fields['Address'] ? oneLine(fields['Address']) : rec.location,
        contactName: fields['Contact'] ?? null,
        contactEmail: fields['Email']?.toLowerCase() ?? null,
        contactPhone: fields['Phone'] ?? null,
    };
}

export default {
    key: 'la-lapac',
    name: 'Louisiana LaPAC',
    state: 'LA',
    async robotsOk() {
        return checkRobots(createClient(), BASE, ['/osp/lapac/deptbids.cfm', '/osp/lapac/dspBid.cfm', '/osp/lapac/dspBidContact.cfm']);
    },
    async *listOpen({ keyword = '', postedAfter = null, closesAfter = null, maxResults = 200, includeDescription = true } = {}) {
        const client = createClient();
        const res = await client.request(`${ROOT}deptbids.cfm`);
        const $ = cheerio.load(res.text);
        const departments = [];
        $('a[href*="dspBid.cfm?search=department&term="]').each((_, a) => {
            const term = /term=(\d+)/.exec($(a).attr('href'))?.[1];
            if (term && !departments.some((d) => d.term === term)) departments.push({ term, ...departmentMeta($(a).text()) });
        });
        log.info(`LaPAC: ${departments.length} departments currently list bids`);
        const words = (keyword ?? '').toLowerCase().split(/\s+/).filter(Boolean);

        let yielded = 0;
        const seen = new Set();
        for (const dept of departments) {
            const listUrl = `${ROOT}dspBid.cfm?search=department&term=${dept.term}`;
            let list;
            try {
                list = await client.request(listUrl);
            } catch (err) {
                log.warning(`LaPAC: listing failed for ${dept.agency}: ${err.message}`);
                continue;
            }
            const rows = parseListing(cheerio.load(list.text), dept).filter((r) => {
                if (seen.has(r.number) || r.cancelled) return false;
                seen.add(r.number);
                if (!onOrAfter(parseLocalDateTime(r.openText, TZ).iso, closesAfter)) return false;
                if (postedAfter && !onOrAfter(parseLocalDateTime(r.dateIssued, TZ).iso, postedAfter)) return false;
                if (words.length) {
                    const hay = `${r.title ?? ''} ${r.notes.join(' ')}`.toLowerCase();
                    if (!words.every((w) => hay.includes(w))) return false;
                }
                return true;
            });
            const records = includeDescription
                ? await mapWithConcurrency(rows, MAX_CONCURRENCY_PER_PORTAL, (r) => enrich(client, r))
                : rows.map(baseRecord);
            for (const rec of records) {
                yield rec;
                yielded += 1;
                if (yielded >= maxResults) return;
            }
        }
    },
};
