// Timestamps are stored in UTC and shown in the tenant time zone (scan_settings.timezone).
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

// "https://api-us01.central.sophos.com" -> "api-us01.central.sophos.com"
export function formatHost(url: string | null | undefined): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function formatDateTime(value: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US").format(value);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// A <input type="date"> value ("2026-10-15") as the end of that day in the time zone, as an ISO
// instant: "installed on" and "as of" include the whole day.
export function endOfDayIso(date: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess + (guess - asUtc)).toISOString();
}
