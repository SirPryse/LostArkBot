import { getCharacterLogs } from './client.js';
import { ALL_KNOWN_BOSSES } from '../notify/raidFamilies.js';

// Logs are recent-first, so a page fully older than the boundary means
// we're done. This just caps how far we're willing to page for one
// character before giving up, in case something's off.
const MAX_PAGES_PER_CHARACTER = 10;

/**
 * All log entries for a character with `timestamp >= boundaryMs`. Shared by
 * /roster-status and /bonk so both agree on what "since the reset" means.
 *
 * Passes ALL_KNOWN_BOSSES as the `bosses` filter — confirmed live that
 * lostark.bible's pagination silently no-ops without one (every page
 * returns the same most-recent-25 window), so without this, a character
 * with more than ~25 mixed log entries in a week would've had this loop
 * quietly re-read page 1 forever instead of reaching real page 2+. Safe to
 * filter this way: bonk.js already discards any entry that doesn't match
 * a known raid family right after this returns, so the result set is
 * identical either way — this filter just makes pagination work too.
 */
export async function fetchLogsSince(accessToken, characterName, region, boundaryMs) {
  const entries = [];
  for (let page = 1; page <= MAX_PAGES_PER_CHARACTER; page++) {
    const batch = await getCharacterLogs(accessToken, characterName, region, { page, bosses: ALL_KNOWN_BOSSES });
    if (!batch || batch.length === 0) break;

    for (const entry of batch) {
      if (entry.timestamp < boundaryMs) return entries; // crossed the reset boundary
      entries.push(entry);
    }
  }
  return entries;
}
