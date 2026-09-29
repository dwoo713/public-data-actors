export const DESCRIPTION_MAX = 5000;

export function cleanText(s) {
    if (s === null || s === undefined) return null;
    const t = String(s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    return t.length ? t : null;
}

export function oneLine(s) {
    const t = cleanText(s);
    return t ? t.replace(/\s+/g, ' ') : null;
}

export function truncate(s, max = DESCRIPTION_MAX) {
    if (!s) return null;
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Plain text from a cheerio element: <br> and block ends become newlines. */
export function elementText($, el) {
    const clone = $(el).clone();
    clone.find('script, style').remove();
    clone.find('br').replaceWith('\n');
    clone.find('p, div, li, tr, h1, h2, h3, h4, h5, h6').append('\n');
    return cleanText(clone.text());
}

export function classifySolicitationType(...parts) {
    const text = parts.filter(Boolean).join(' ');
    if (/\bRFP\b|request\s+for\s+proposals?|competitive\s+sealed\s+proposal/i.test(text)) return 'RFP';
    if (/\bIFB\b|\bITB\b|\bRFB\b|invitation\s+(to|for)\s+bids?|request\s+for\s+bids?|competitive\s+sealed\s+bid/i.test(text)) return 'IFB';
    if (/\bRFQ\b|request\s+for\s+quot(e|es|ation|ations)/i.test(text)) return 'RFQ';
    if (/\bRFI\b|request\s+for\s+information/i.test(text)) return 'RFI';
    return 'other';
}

/** state agency | county | city | school district | university | other | null */
export function classifyAgencyType(name, fallback = null) {
    const n = name ?? '';
    if (!n) return fallback;
    if (/university|college|community\s+college|technical\s+college|institute\s+of\s+technology|\bLSU\b|\bUMass\b/i.test(n)) return 'university';
    if (/school|\bISD\b|board\s+of\s+education|academy|regional\s+(vocational|technical)/i.test(n)) return 'school district';
    if (/\bcounty\b|\bparish\b(?!.*(school|sheriff))/i.test(n)) return 'county';
    if (/\b(city|town|village|borough|township)\s+of\b|\bmunicipal(ity)?\b|city\s+council/i.test(n)) return 'city';
    if (/housing\s+authority|water\s+(district|board|authority)|sewer|transit|regional|district|commission\s+on|council\s+of\s+governments|library/i.test(n)) return 'other';
    if (/department|division|office|agency|commission|authority|bureau|board|secretary|\bstate\b|treasur|comptroller|attorney\s+general|governor|legislat|court|corrections|transportation|environmental/i.test(n)) return 'state agency';
    return fallback;
}

export function extractEmail(text) {
    const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text ?? '');
    return m ? m[0].replace(/[.,;:]+$/, '') : null;
}

export function extractPhone(text) {
    const m = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(\s*(x|ext\.?|extension)\s*\d+)?/i.exec(text ?? '');
    return m ? m[0].trim() : null;
}

/** Cloudflare "email-protection" obfuscation: hex string, first byte is the XOR key. */
export function decodeCfEmail(hex) {
    if (!hex || hex.length < 4) return null;
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
}

/** Replaces Cloudflare-protected email spans in a cheerio document with the decoded address. */
export function unprotectEmails($) {
    $('[data-cfemail]').each((_, el) => {
        const decoded = decodeCfEmail($(el).attr('data-cfemail'));
        if (decoded) $(el).replaceWith(decoded);
    });
    $('a[href^="/cdn-cgi/l/email-protection#"]').each((_, el) => {
        const decoded = decodeCfEmail($(el).attr('href').split('#')[1]);
        if (decoded) $(el).attr('href', `mailto:${decoded}`);
    });
}

export function absoluteUrl(href, base) {
    if (!href) return null;
    try { return new URL(href, base).toString(); } catch { return null; }
}

/** Builds the normalized record with every key present (null/[] defaults) in a stable order. */
export function makeRecord(fields) {
    return {
        portal: null,
        state: null,
        solicitationId: null,
        solicitationNumber: null,
        title: null,
        agency: null,
        agencyType: null,
        solicitationType: 'other',
        status: 'open',
        description: null,
        postedDate: null,
        closeDate: null,
        closeTime: null,
        categories: [],
        location: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        attachments: [],
        sourceUrl: null,
        scrapedAt: new Date().toISOString(),
        ...fields,
    };
}
