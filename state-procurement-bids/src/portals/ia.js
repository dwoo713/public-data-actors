/**
 * State of Iowa Bid Opportunities (bidopportunities.iowa.gov): public DataTables JSON endpoint
 * /Home/DT_HostedBidsSearch plus public /Home/BidInfo detail pages.
 */
import * as cheerio from 'cheerio';
import { log } from 'apify';
import { createClient, mapWithConcurrency, MAX_CONCURRENCY_PER_PORTAL } from '../lib/http.js';
import { checkRobots } from '../lib/robots.js';
import { dotNetDateToIso, onOrAfter } from '../lib/dates.js';
import { cleanText, oneLine, truncate, elementText, classifySolicitationType, classifyAgencyType, unprotectEmails, absoluteUrl, makeRecord } from '../lib/normalize.js';

const BASE = 'https://bidopportunities.iowa.gov';
const TZ = 'America/Chicago';
const PAGE_SIZE = 100;

const TYPE_LABELS = {
    'request for proposals': 'RFP', 'request for proposal': 'RFP',
    'invitation to bid': 'IFB', 'invitation for bid': 'IFB', 'invitation for bids': 'IFB',
    'request for quote': 'RFQ', 'request for quotes': 'RFQ', 'request for quotation': 'RFQ',
    'request for information': 'RFI',
    'request for bids': 'IFB', 'request for bid': 'IFB',
};

function detailUrl(id) {
    return `${BASE}/Home/BidInfo?bidId=${encodeURIComponent(id)}`;
}

function baseRecord(hit) {
    const close = dotNetDateToIso(hit.ExpirationDate, TZ);
    const posted = dotNetDateToIso(hit.EffectiveDate, TZ);
    const agency = oneLine(hit.AgencyName);
    const categories = [];
    if (Array.isArray(hit.Categories)) for (const c of hit.Categories) categories.push({ system: 'Iowa category', code: null, label: oneLine(typeof c === 'string' ? c : c?.Name ?? c?.Description) });
    else if (typeof hit.Categories === 'string' && hit.Categories.trim()) categories.push({ system: 'Iowa category', code: null, label: oneLine(hit.Categories) });
    return makeRecord({
        portal: 'ia-bidopportunities',
        state: 'IA',
        solicitationId: hit.ID,
        solicitationNumber: oneLine(hit.BidNumber),
        title: oneLine(hit.Solicitation),
        agency,
        agencyType: classifyAgencyType(agency, 'state agency'),
        solicitationType: classifySolicitationType(hit.BidNumber, hit.Solicitation, hit.Description),
        status: String(hit.Status ?? 'open').toLowerCase(),
        description: truncate(cleanText(hit.Description)),
        postedDate: posted.iso,
        closeDate: close.iso,
        closeTime: close.time,
        categories,
        location: hit.CountyName ? `${oneLine(hit.CountyName)} County, IA` : null,
        contactName: oneLine(hit.AgencyContactName),
        contactEmail: oneLine(hit.AgencyContactEmail)?.toLowerCase() ?? null,
        contactPhone: oneLine(hit.AgencyContactPhoneNumber),
        sourceUrl: detailUrl(hit.ID),
    });
}

async function enrich(client, hit) {
    const rec = baseRecord(hit);
    let res;
    try {
        res = await client.request(rec.sourceUrl);
    } catch (err) {
        log.warning(`Iowa: detail fetch failed for ${hit.BidNumber}: ${err.message}`);
        return rec;
    }
    const $ = cheerio.load(res.text);
    unprotectEmails($);
    const field = (label) => {
        const lab = $('label').filter((_, el) => oneLine($(el).text())?.toLowerCase() === label.toLowerCase()).first();
        return lab.length ? oneLine(lab.closest('.row').find('.col-md-9').first().text()) : null;
    };
    const typeLabel = field('Solicitation Type');
    const county = field('County');
    const descBody = $('.panel-heading:contains("Description")').first().next('.panel-body');
    const descValue = descBody.find('.col-md-9').first();
    const description = truncate(elementText($, descValue.length ? descValue : descBody)?.replace(/^Description\s*\n/i, '')) ?? rec.description;

    const attachments = [];
    for (const heading of ['Documents/Attachments', 'Links']) {
        $(`.panel-heading:contains("${heading}")`).first().next('.panel-body').find('a[href]').each((_, a) => {
            const url = absoluteUrl($(a).attr('href').trim(), BASE);
            const row = $(a).closest('.row');
            const label = oneLine(row.find('label').first().text()) ?? oneLine($(a).text());
            if (url && !attachments.some((x) => x.url === url)) attachments.push({ name: label ?? url, url });
        });
    }

    return {
        ...rec,
        solicitationType: TYPE_LABELS[(typeLabel ?? '').toLowerCase()] ?? classifySolicitationType(typeLabel, rec.solicitationNumber, rec.title, rec.description),
        description,
        location: county ? `${county} County, IA` : rec.location,
        contactName: field('Contact Name') ?? rec.contactName,
        contactEmail: field('Contact Email')?.toLowerCase() ?? rec.contactEmail,
        contactPhone: field('Contact Phone Number') ?? rec.contactPhone,
        attachments,
    };
}

export default {
    key: 'ia-bidopportunities',
    name: 'State of Iowa Bid Opportunities',
    state: 'IA',
    async robotsOk() {
        return checkRobots(createClient(), BASE, ['/', '/Home/DT_HostedBidsSearch', '/Home/BidInfo']);
    },
    async *listOpen({ keyword = '', postedAfter = null, closesAfter = null, maxResults = 200, includeDescription = true } = {}) {
        const client = createClient();
        let start = 0;
        let yielded = 0;
        let echo = 0;
        const seen = new Set();
        for (;;) {
            echo += 1;
            const url = `${BASE}/Home/DT_HostedBidsSearch?agencyId=&enteredSearchText=${encodeURIComponent(keyword ?? '')}&sEcho=${echo}&iDisplayStart=${start}&iDisplayLength=${PAGE_SIZE}`;
            const res = await client.request(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' } });
            let json;
            try { json = JSON.parse(res.text); } catch { throw new Error(`Iowa: search did not return JSON (HTTP ${res.status})`); }
            const total = Number(json.iTotalDisplayRecords ?? json.iTotalRecords ?? 0);
            if (start === 0) log.info(`Iowa: ${total} active bid opportunities${keyword ? ` matching "${keyword}"` : ''}`);
            const data = json.aaData ?? [];
            const hits = data.filter((h) => {
                if (!h.ID || seen.has(h.ID)) return false;
                seen.add(h.ID);
                return onOrAfter(dotNetDateToIso(h.ExpirationDate, TZ).iso, closesAfter)
                    && (!postedAfter || onOrAfter(dotNetDateToIso(h.EffectiveDate, TZ).iso, postedAfter));
            });
            const records = includeDescription
                ? await mapWithConcurrency(hits, MAX_CONCURRENCY_PER_PORTAL, (h) => enrich(client, h))
                : hits.map(baseRecord);
            for (const rec of records) {
                yield rec;
                yielded += 1;
                if (yielded >= maxResults) return;
            }
            start += data.length;
            if (data.length === 0 || start >= total) return;
        }
    },
};
