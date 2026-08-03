import { config } from '../config.js';
import { TokenExpiredError, InsufficientScopeError } from './errors.js';

async function request(path, accessToken) {
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
