// HTTP retry for Sophos Central: 429 and 5xx (and network errors) are retried with exponential
// backoff and jitter (1, 2, 4, 8 s; at most 5 tries), honouring Retry-After.
// Runtime-neutral (Deno and Node) so Vitest can test it.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export const MAX_TRIES = 5;
export const BACKOFF_MS = [1000, 2000, 4000, 8000];
const MAX_RETRY_AFTER_MS = 60_000;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function retryDelayMs(attempt: number, retryAfter: string | null, random: () => number = Math.random): number {
  const fromHeader = parseRetryAfter(retryAfter);
  if (fromHeader !== null) return Math.min(fromHeader, MAX_RETRY_AFTER_MS);
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1];
  return base + Math.floor(random() * base * 0.25);
}

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export type AttemptInfo = { attempt: number; status: number | null; durationMs: number; error?: string };

export async function fetchWithRetry(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  options: { sleep?: Sleep; random?: () => number; onAttempt?: (info: AttemptInfo) => void } = {},
): Promise<Response> {
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchFn(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onAttempt?.({ attempt, status: null, durationMs: Date.now() - started, error: message });
      if (attempt >= MAX_TRIES) throw error;
      await sleep(retryDelayMs(attempt, null, options.random));
      continue;
    }
    options.onAttempt?.({ attempt, status: response.status, durationMs: Date.now() - started });
    if (!isRetryable(response.status) || attempt >= MAX_TRIES) return response;
    const retryAfter = response.headers.get("retry-after");
    await response.body?.cancel();
    await sleep(retryDelayMs(attempt, retryAfter, options.random));
  }
}
