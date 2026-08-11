// state -> { discordUserId, codeVerifier, expiresAt } — bridges /link-account
// (which starts the flow and knows who asked) to the HTTP server's
// /oauth/callback route (which only gets back whatever lostark.bible sends,
// namely `state` + `code`). Same in-memory-Map-with-TTL pattern already used
// for trackCharacter.js's pendingSelections and guessParse.js's activeRounds
// — single bot process, so this is fine, and losing an in-flight link on a
// restart just means re-running /link-account.
const pending = new Map();

const TTL_MS = 10 * 60 * 1000; // matches how long an OAuth consent screen is realistically still actionable

export function storePendingLink(state, { discordUserId, codeVerifier }) {
  pending.set(state, { discordUserId, codeVerifier, expiresAt: Date.now() + TTL_MS });
  setTimeout(() => pending.delete(state), TTL_MS);
}

/** One-time read — a given `state` can only ever complete the flow once,
 * whether it succeeds or fails, so callers should call this instead of a
 * plain get() even on the error paths. */
export function takePendingLink(state) {
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
