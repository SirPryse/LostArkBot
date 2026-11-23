// Shared HTTP plumbing for every lostark.bible call (API + OAuth).

// No request may hang forever: the poller runs one tier at a time behind an
// "already running" flag, so a single stuck request used to freeze that
// whole tier until the process restarted.
export const REQUEST_TIMEOUT_MS = 15_000;

/** fetch() with a hard timeout. A timeout rejects with a TimeoutError. */
export function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

const MAX_RETRY_AFTER_MS = 60_000;

/**
 * How long to wait before retrying a 429. `Retry-After` may be delta
 * seconds or an HTTP date; anything unparseable (or missing) falls back to
 * exponential backoff. Capped so a bogus header can't park a caller for
 * minutes. Previously a date-form header became NaN and retried instantly.
 */
export function retryAfterMs(header, attempt, now = Date.now()) {
  const backoff = 2 ** attempt * 1000;
  if (!header) return backoff;
  const seconds = Number(header);
  let ms;
  if (Number.isFinite(seconds)) {
    ms = seconds * 1000;
  } else {
    const date = Date.parse(header);
    ms = Number.isFinite(date) ? date - now : NaN;
  }
  if (!Number.isFinite(ms) || ms < 0) return backoff;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
