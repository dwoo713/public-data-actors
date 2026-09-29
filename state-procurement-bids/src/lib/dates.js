const pad = (n, w = 2) => String(n).padStart(w, '0');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function offsetMinutes(tz, instant) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(instant);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Local wall-clock components in an IANA zone -> ISO 8601 string with the correct UTC offset (DST aware). */
export function zonedIso({ y, mo, d, h = null, mi = 0, s = 0 }, tz) {
    if (h === null || h === undefined) return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
    if (y > 9000) return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`; // JS Date cannot represent sentinel years reliably
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    let off = offsetMinutes(tz, new Date(guess));
    off = offsetMinutes(tz, new Date(guess - off * 60_000));
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "3:00 PM", "03:00:00 PM", "10:00:00 AM CT", "14:30" -> { h, mi, s } or null */
export function parseTime(str) {
    if (!str) return null;
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/.exec(str);
    if (!m) return null;
    let h = Number(m[1]);
    const mi = Number(m[2]);
    const s = Number(m[3] ?? 0);
    const ap = m[4]?.toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { h, mi, s };
}

/** "10/13/2026", "10/13/2026 03:00:00 PM", "2026-10-13", "Sep 29, 2026 @ 02:00 PM", "September 29, 2026" */
export function parseDateParts(str) {
    if (!str) return null;
    const t = String(str).trim();
    let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
    if (m) return { y: Number(m[3]), mo: Number(m[1]), d: Number(m[2]), rest: t.slice(m.index + m[0].length) };
    m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), rest: t.slice(m.index + m[0].length) };
    m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
    if (m) {
        const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (mo) return { y: Number(m[3]), mo, d: Number(m[2]), rest: t.slice(m.index + m[0].length) };
    }
    return null;
}

/**
 * Parses a free-form date (optionally followed by a time) as local time in `tz`.
 * Returns { iso, date, time } where iso is a full datetime with offset when a time was present,
 * otherwise a plain YYYY-MM-DD. `timeStr` may supply the time separately.
 */
export function parseLocalDateTime(dateStr, tz, timeStr = null) {
    const p = parseDateParts(dateStr);
    if (!p) return { iso: null, date: null, time: null };
    const time = parseTime(timeStr ?? p.rest);
    const date = `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
    if (!time) return { iso: date, date, time: null };
    return { iso: zonedIso({ ...p, ...time }, tz), date, time: `${pad(time.h)}:${pad(time.mi)}` };
}

/** .NET JSON date "/Date(1789412400000)/" -> ISO in tz */
export function dotNetDateToIso(value, tz) {
    const m = /\/Date\((-?\d+)\)\//.exec(String(value ?? ''));
    if (!m) return { iso: null, date: null, time: null };
    const instant = new Date(Number(m[1]));
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
            .formatToParts(instant).map((x) => [x.type, x.value]),
    );
    const comp = { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute), s: Number(parts.second) };
    return { iso: zonedIso(comp, tz), date: `${pad(comp.y, 4)}-${pad(comp.mo)}-${pad(comp.d)}`, time: `${pad(comp.h)}:${pad(comp.mi)}` };
}

export function isoDatePart(iso) {
    return iso ? String(iso).slice(0, 10) : null;
}

export function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

/** true when the ISO date/datetime `iso` falls on or after the ISO day `dayIso`. Unknown dates pass. */
export function onOrAfter(iso, dayIso) {
    if (!iso || !dayIso) return true;
    return isoDatePart(iso) >= dayIso;
}
