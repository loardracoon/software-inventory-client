// Weekly cycle and daily retry windows in the tenant time zone (scan_settings), with Intl only.
// Weekday is ISO: 1 = Monday ... 7 = Sunday. Times come from Postgres as "HH:MM" or "HH:MM:SS".
// Runtime-neutral (Deno and Node).

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function wallTime(instant: Date, timeZone: string): WallTime {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
}

// UTC instant of a wall-clock time in a zone. Two passes settle the offset around DST changes.
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    const w = wallTime(new Date(utc), timeZone);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    utc += target - asUtc;
  }
  return new Date(utc);
}

export function parseTime(value: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}"`);
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Invalid time "${value}"`);
  return { hour, minute, second };
}

// Calendar date `days` after a wall date (handles month and year ends).
function addDays(w: WallTime, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function at(date: { year: number; month: number; day: number }, time: string, timeZone: string): Date {
  const t = parseTime(time);
  return zonedTimeToUtc(date.year, date.month, date.day, t.hour, t.minute, t.second, timeZone);
}

// Start of the weekly period that contains `now`: the latest weekday+time at or before now.
export function cycleStartAtOrBefore(now: Date, weekday: number, time: string, timeZone: string): Date {
  const w = wallTime(now, timeZone);
  const back = (w.weekday - weekday + 7) % 7;
  let start = at(addDays(w, -back), time, timeZone);
  if (start.getTime() > now.getTime()) start = at(addDays(w, -back - 7), time, timeZone);
  return start;
}

// The next period start after a period start: when the cycle closes.
export function nextCycleStart(periodStart: Date, time: string, timeZone: string): Date {
  return at(addDays(wallTime(periodStart, timeZone), 7), time, timeZone);
}

// Next daily retry window: today at retryTime, or tomorrow when today's window has passed.
export function nextRetryAt(now: Date, retryTime: string, timeZone: string): Date {
  const w = wallTime(now, timeZone);
  const today = at(addDays(w, 0), retryTime, timeZone);
  return today.getTime() > now.getTime() ? today : at(addDays(w, 1), retryTime, timeZone);
}

export const OFFLINE_RECHECK_MINUTES = 60;

// When an offline computer is tried again: later the same day (in the tenant time zone), every
// OFFLINE_RECHECK_MINUTES; once the day is over, at the next daily retry window. Checking whether a
// computer is online costs no Live Discover run, so hourly checks spend no budget.
export function nextOfflineCheck(now: Date, retryTime: string, timeZone: string, recheckMinutes = OFFLINE_RECHECK_MINUTES): Date {
  const later = new Date(now.getTime() + recheckMinutes * 60_000);
  const a = wallTime(now, timeZone);
  const b = wallTime(later, timeZone);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return later;
  return nextRetryAt(later, retryTime, timeZone);
}
