/**
 * lostark.bible renamed `udps` (unbuffed DPS) to `ndps` around Nov 2026 —
 * confirmed live: older entries carry `udps`, current ones carry `ndps`
 * with the same meaning, and the website's own log data no longer has a
 * `udps` field at all. Every consumer here (getRole, clear embeds,
 * /challenge targets, /guess-parse) reads `udps`, and without it a DPS
 * entry fell through getRole() to 'unknown' and got the stripped-down
 * embed. Aliasing it once at the API boundary (getCharacterLogs) keeps
 * every caller working against both shapes.
 */
export function normalizeLogEntry(entry) {
  if (entry && entry.udps === undefined && entry.ndps !== undefined) {
    return { ...entry, udps: entry.ndps };
  }
  return entry;
}
