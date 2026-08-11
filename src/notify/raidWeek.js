/**
 * Lost Ark's weekly raid reset — confirmed live: a fixed Wednesday 10:00
 * UTC across every region (Game Time Master's game-data.js confirms the
 * daily reset is 10:00 UTC everywhere, DST-proof; Wednesday confirmed
 * directly as the weekly day). Same reset instant scheduler/weeklyReset.js
 * fires on. Returns the most recent reset boundary: this Wednesday
 * 10:00 UTC, or last week's if this week's hasn't happened yet.
 *
 * Previously used local-midnight Wednesday (whatever timezone the Node
 * process happened to be running in) — that was flagged as an unconfirmed
 * assumption and has since been replaced with this UTC-anchored version.
 */
export function lastWednesdayReset(now = new Date()) {
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 0, 0, 0));
  const daysSinceWednesday = (candidate.getUTCDay() - 3 + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() - daysSinceWednesday);
  if (candidate > now) candidate.setUTCDate(candidate.getUTCDate() - 7);
  return candidate;
}
