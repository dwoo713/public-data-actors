import { log } from 'apify';
import { ACTOR_UA_TOKEN } from './http.js';

/**
 * Fetches <origin>/robots.txt and checks every path in `paths` for our user-agent token
 * (falling back to the `*` group). Follows RFC 9309: 4xx = no restrictions, 5xx/unreachable =
 * treated as disallowed (the portal is skipped for this run), longest-match rule wins, Allow wins ties.
 * Returns { allowed, reason, status }.
 */
export async function checkRobots(client, origin, paths) {
    const url = `${origin}/robots.txt`;
    let res;
    try {
        res = await client.request(url, { retries: 2 });
    } catch (err) {
        return { allowed: false, status: err.status ?? null, reason: `robots.txt unreachable (${err.message})` };
    }
    if (res.status >= 500) return { allowed: false, status: res.status, reason: `robots.txt returned HTTP ${res.status}` };
    if (res.status >= 400) return { allowed: true, status: res.status, reason: `no robots.txt (HTTP ${res.status}), crawling allowed` };

    const groups = parseRobots(res.text);
    const group = pickGroup(groups, ACTOR_UA_TOKEN);
    if (!group) return { allowed: true, status: res.status, reason: 'robots.txt has no matching group, crawling allowed' };

    for (const path of paths) {
        const verdict = evaluate(group.rules, path);
        if (!verdict.allowed) {
            return { allowed: false, status: res.status, reason: `robots.txt disallows ${path} (rule "${verdict.rule}")` };
        }
    }
    log.debug(`robots.txt at ${res.url} allows ${paths.join(', ')}`);
    return { allowed: true, status: res.status, reason: `robots.txt at ${res.url} allows the required paths` };
}

export function parseRobots(text) {
    const groups = [];
    let current = null;
    let lastWasAgent = false;
    for (let rawLine of text.split(/\r?\n/)) {
        const hash = rawLine.indexOf('#');
        if (hash >= 0) rawLine = rawLine.slice(0, hash);
        const line = rawLine.trim();
        if (!line) continue;
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const field = m[1].toLowerCase();
        const value = m[2].trim();
        if (field === 'user-agent') {
            if (!current || !lastWasAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
        } else if (field === 'allow' || field === 'disallow') {
            if (!current) continue;
            current.rules.push({ type: field, path: value });
            lastWasAgent = false;
        } else {
            lastWasAgent = false;
        }
    }
    return groups;
}

function pickGroup(groups, token) {
    const t = token.toLowerCase();
    const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && (t.includes(a) || a.includes(t))));
    if (specific.length) return mergeGroups(specific);
    const star = groups.filter((g) => g.agents.includes('*'));
    return star.length ? mergeGroups(star) : null;
}

function mergeGroups(list) {
    return { agents: list.flatMap((g) => g.agents), rules: list.flatMap((g) => g.rules) };
}

function evaluate(rules, path) {
    let best = null;
    for (const rule of rules) {
        if (rule.path === '') { // "Disallow:" (empty) means allow everything
            if (rule.type === 'disallow') continue;
        }
        if (!matchesRule(rule.path, path)) continue;
        const len = rule.path.length;
        if (!best || len > best.len || (len === best.len && rule.type === 'allow' && best.type === 'disallow')) {
            best = { len, type: rule.type, rule: `${rule.type}: ${rule.path}` };
        }
    }
    if (!best) return { allowed: true };
    return { allowed: best.type === 'allow', rule: best.rule };
}

function matchesRule(pattern, path) {
    if (pattern === '') return true;
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const re = new RegExp(`^${body.split('*').map(escapeRe).join('.*')}${anchored ? '$' : ''}`);
    return re.test(path);
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
