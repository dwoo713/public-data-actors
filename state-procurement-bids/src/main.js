import { Actor, log } from 'apify';
import { PORTAL_BY_KEY, ALL_PORTAL_KEYS } from './portals/index.js';
import { todayIso, onOrAfter } from './lib/dates.js';

const EVENT_SOLICITATION = 'solicitation';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    portals = ALL_PORTAL_KEYS,
    keyword = '',
    postedAfter = null,
    closesAfter: closesAfterInput,
    maxResultsPerPortal = 200,
    includeDescription = true,
} = input;
const closesAfter = closesAfterInput === undefined ? todayIso() : (closesAfterInput || null);

log.info('Starting state procurement scrape', { portals, keyword, postedAfter, closesAfter, maxResultsPerPortal, includeDescription });

const summary = {};
let totalPushed = 0;
let chargeLimitReached = false;

for (const key of portals) {
    if (chargeLimitReached) break;
    const portal = PORTAL_BY_KEY[key];
    if (!portal) {
        log.warning(`Unknown portal key "${key}", skipping. Known keys: ${ALL_PORTAL_KEYS.join(', ')}`);
        continue;
    }

    const robots = await portal.robotsOk();
    if (!robots.allowed) {
        log.warning(`${portal.name}: skipped, ${robots.reason}`);
        summary[key] = { pushed: 0, skipped: robots.reason };
        continue;
    }
    log.info(`${portal.name}: ${robots.reason}`);

    let pushed = 0;
    const seen = new Set();
    try {
        for await (const record of portal.listOpen({ keyword, postedAfter, closesAfter, maxResults: maxResultsPerPortal, includeDescription })) {
            if (!record?.solicitationId || seen.has(record.solicitationId)) continue;
            seen.add(record.solicitationId);
            if (closesAfter && !onOrAfter(record.closeDate, closesAfter)) continue;
            if (postedAfter && record.postedDate && !onOrAfter(record.postedDate, postedAfter)) continue;

            const charge = await Actor.charge({ eventName: EVENT_SOLICITATION, count: 1 });
            if (charge.eventChargeLimitReached) {
                log.warning('Charge limit reached, stopping before pushing more results.');
                chargeLimitReached = true;
                break;
            }
            await Actor.pushData(record);
            pushed += 1;
            totalPushed += 1;
            if (pushed >= maxResultsPerPortal) break;
        }
    } catch (err) {
        log.exception(err, `${portal.name}: failed after ${pushed} solicitations`);
        summary[key] = { pushed, error: err.message };
        continue;
    }
    summary[key] = { pushed };
    log.info(`${portal.name}: pushed ${pushed} solicitations`);
}

log.info(`Done. Pushed ${totalPushed} solicitations in total.`, summary);
await Actor.setValue('SUMMARY', summary);
await Actor.exit();
