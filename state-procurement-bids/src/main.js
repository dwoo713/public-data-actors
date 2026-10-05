import { Actor, log } from 'apify';
import { PORTAL_BY_KEY, ALL_PORTAL_KEYS } from './portals/index.js';
import { todayIso, onOrAfter } from './lib/dates.js';
import { computeRunDeadline, portalDeadline, pastDeadline, secondsLeft } from './lib/deadline.js';

const EVENT_SOLICITATION = 'solicitation';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    portals = ALL_PORTAL_KEYS,
    keyword = '',
    postedAfter = null,
    closesAfter: closesAfterInput,
    maxResultsPerPortal = 100,
    includeDescription = true,
    maxRunSeconds = 0,
} = input;
const closesAfter = closesAfterInput === undefined ? todayIso() : (closesAfterInput || null);

const runDeadline = computeRunDeadline(maxRunSeconds);
log.info('Starting state procurement scrape', { portals, keyword, postedAfter, closesAfter, maxResultsPerPortal, includeDescription, maxRunSeconds, runBudgetSeconds: secondsLeft(runDeadline) });

const summary = {};
let totalPushed = 0;
let chargeLimitReached = false;

const validPortals = portals.filter((key) => {
    if (PORTAL_BY_KEY[key]) return true;
    log.warning(`Unknown portal key "${key}", skipping. Known keys: ${ALL_PORTAL_KEYS.join(', ')}`);
    return false;
});

for (const [index, key] of validPortals.entries()) {
    if (chargeLimitReached) break;
    const portal = PORTAL_BY_KEY[key];
    if (pastDeadline(runDeadline)) {
        log.warning(`${portal.name}: skipped, run time budget exhausted before this portal started`);
        summary[key] = { pushed: 0, skipped: 'time budget exhausted' };
        continue;
    }
    // Share the remaining time evenly so one slow portal cannot starve the ones after it.
    const deadline = portalDeadline(runDeadline, validPortals.length - index);

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
        for await (const record of portal.listOpen({ keyword, postedAfter, closesAfter, maxResults: maxResultsPerPortal, includeDescription, deadline })) {
            if (pastDeadline(deadline)) {
                log.warning(`${portal.name}: time budget for this portal reached after ${pushed} solicitations, moving on`);
                summary[key] = { pushed, truncated: 'time budget' };
                break;
            }
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
    summary[key] = { ...(summary[key] ?? {}), pushed };
    log.info(`${portal.name}: pushed ${pushed} solicitations`);
}

log.info(`Done. Pushed ${totalPushed} solicitations in total.`, summary);
await Actor.setValue('SUMMARY', summary);
await Actor.exit();
