/**
 * Lost Ark's weekly raid reset lands on Wednesday. Returns the most recent
 * reset boundary — this Wednesday at local midnight, or today at midnight
 * if today IS Wednesday. Ported from RaidPlanner's raid-week.util.ts so both
 * projects agree on what "this week" means.
 *
 * Assumption worth confirming: this uses local-midnight Wednesday, not a
 * specific reset hour (e.g. a fixed UTC time) — adjust here if the actual
 * server reset lands at a different hour.
 */
export function lastWednesdayReset(now = new Date()) {
  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = midnightToday.getDay(); // 0=Sun ... 3=Wed ... 6=Sat
  const daysSinceWednesday = (day - 3 + 7) % 7;
  midnightToday.setDate(midnightToday.getDate() - daysSinceWednesday);
  return midnightToday;
}
