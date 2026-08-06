import { getCharacterLogs } from './client.js';

// Logs are recent-first, so a page fully older than the boundary means
// we're done. This just caps how far we're willing to page for one
// character before giving up, in case something's off.
const MAX_PAGES_PER_CHARACTER = 10;

/**
 * All log entries for a character with `timestamp >= boundaryMs`. Shared by
 * /roster-status and /bonk so both agree on what "since the reset" means.
 */
export async function fetchLogsSince(accessToken, characterName, region, boundaryMs) {
  const entries = [];
  for (let page = 1; page <= MAX_PAGES_PER_CHARACTER; page++) {
    const batch = await getCharacterLogs(accessToken, characterName, region, { page });
    if (!batch || batch.length === 0) break;

    for (const entry of batch) {
      if (entry.timestamp < boundaryMs) return entries; // crossed the reset boundary
      entries.push(entry);
    }
  }
  return entries;
}
