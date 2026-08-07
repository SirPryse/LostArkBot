import { config } from '../config.js';
import { TokenExpiredError, InsufficientScopeError } from './errors.js';

// 429 ("slow_down") is a shared app-wide throttle, not a per-caller thing —
// callers like /bonk (one big burst of requests for a large roster) can hit
// it even when the background poller is already pacing itself. Retrying
// with backoff here fixes it once for every caller instead of needing
// retry logic duplicated in each command.
const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, accessToken, attempt = 0) {
  const response = await fetch(`${config.laBibleBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    throw new TokenExpiredError();
  }
  if (response.status === 403) {
    throw new InsufficientScopeError();
  }
  if (response.status === 404) {
    return null;
  }
  if (response.status === 429) {
    if (attempt >= MAX_RATE_LIMIT_RETRIES) {
      const body = await response.text().catch(() => '');
      throw new Error(`lostark.bible request failed: 429 ${body}`);
    }
    const retryAfterHeader = response.headers.get('retry-after');
    const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2 ** attempt * 1000;
    await sleep(delayMs);
    return request(path, accessToken, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`lostark.bible request failed: ${response.status} ${body}`);
  }

  return response.json();
}

/** GET /api/oauth/rosters — requires the `rosters` scope. */
export function getRosters(accessToken) {
  return request('/api/oauth/rosters', accessToken);
}

/**
 * GET /api/oauth/logs/{characterName} — requires the `logs` scope.
 * Returns null if the character is hidden or has no public logs.
 * Entries are recent-first by `timestamp` (epoch ms); every entry is a
 * completed clear (the API doesn't surface wipes).
 */
export function getCharacterLogs(accessToken, characterName, region, { page = 1, bosses } = {}) {
  const params = new URLSearchParams({ region, page: String(page) });
  for (const boss of bosses ?? []) {
    params.append('bosses', boss);
  }

  return request(
    `/api/oauth/logs/${encodeURIComponent(characterName)}?${params.toString()}`,
    accessToken,
  );
}
