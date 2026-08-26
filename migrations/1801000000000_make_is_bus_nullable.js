export const shorthands = undefined;

/**
 * Fixes a real bug from the previous migration: is_bus was NOT NULL DEFAULT
 * false, which silently backfilled every pre-existing clear_history row
 * with `false` — indistinguishable from "we checked, and they genuinely
 * weren't carried" even though that data was never tracked before this
 * column existed. Confirmed live: a real account's busCount read as 0 in
 * a way that looked like real "never carried" data but was actually just
 * every historical row defaulting to false. Matches below_min_dps's
 * existing nullable pattern instead — null means "unknown / recorded
 * before this was tracked", not false.
 */
export async function up(pgm) {
  pgm.alterColumn('clear_history', 'is_bus', { notNull: false, default: null });
  // The bug already wrote real `false` values into every existing row —
  // reverting those back to null so they correctly read as "unknown"
  // rather than staying permanently (and incorrectly) recorded as "not a
  // bus". This only touches rows from before this fix; anything the
  // poller already recorded with a genuine is_bus value going forward
  // (there hasn't been time for any yet) would be a real value, not this
  // bug's default — but there's no way to distinguish a genuine `false`
  // from the buggy default after the fact, so this treats every existing
  // row as unknown, which is the safe assumption given the bug's window
  // was only a few minutes.
  pgm.sql('update clear_history set is_bus = null');
}

export async function down(pgm) {
  pgm.sql("update clear_history set is_bus = false where is_bus is null");
  pgm.alterColumn('clear_history', 'is_bus', { notNull: true, default: false });
}
