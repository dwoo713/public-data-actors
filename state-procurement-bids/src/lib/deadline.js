/**
 * Run-time budgeting. Apify's automated Store checks run every actor with its prefilled input and
 * expect it to SUCCEED within 5 minutes, and real users set run timeouts too. A run that hits the
 * platform timeout is marked TIMED-OUT even if it already pushed thousands of rows, so we stop
 * cleanly a little before the deadline instead.
 */
const SAFETY_MS = 20_000;

/** Absolute epoch-ms deadline for this run, or Infinity when nothing bounds it. */
export function computeRunDeadline(maxRunSeconds = 0, now = Date.now()) {
    const candidates = [];
    for (const name of ['ACTOR_TIMEOUT_AT', 'APIFY_TIMEOUT_AT']) {
        const raw = process.env[name];
        if (!raw) continue;
        const t = Date.parse(raw);
        if (!Number.isNaN(t)) candidates.push(t - SAFETY_MS);
    }
    if (Number(maxRunSeconds) > 0) candidates.push(now + Number(maxRunSeconds) * 1000);
    return candidates.length ? Math.min(...candidates) : Infinity;
}

/** Split the time left before `runDeadline` evenly across the portals that still have to run. */
export function portalDeadline(runDeadline, portalsRemaining, now = Date.now()) {
    if (!Number.isFinite(runDeadline)) return Infinity;
    const remaining = Math.max(0, runDeadline - now);
    return now + Math.floor(remaining / Math.max(1, portalsRemaining));
}

export const pastDeadline = (deadline) => Number.isFinite(deadline) && Date.now() >= deadline;

export const secondsLeft = (deadline) => (Number.isFinite(deadline) ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null);
