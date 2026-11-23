export const shorthands = undefined;

/**
 * Two clear_history fixes:
 *
 * - `log_id` + unique (tracked_character_id, log_id): the lostark.bible log
 *   id the row came from. A poll batch that fails partway is retried in
 *   full on the next tick; the announcement side already skipped members
 *   it had posted, but recordClear() inserted those clears a second time.
 *   With the id stored, a repeat insert is a no-op (ON CONFLICT DO
 *   NOTHING). Null for rows recorded before this column existed — Postgres
 *   treats NULLs as distinct, so they're unaffected by the index.
 *
 * - `cleared_at`: when the clear actually happened (the log's timestamp),
 *   as opposed to `created_at`, when the bot recorded it. Weekly gold
 *   bucketing used created_at, so clears recorded late (catch-up after a
 *   renewed link) all landed in the week they were recorded and broke the
 *   3-raids-per-week cap. Readers use coalesce(cleared_at, created_at);
 *   for older rows the two are within one poll interval of each other.
 */
export async function up(pgm) {
  pgm.addColumns('clear_history', {
    log_id: { type: 'text' },
    cleared_at: { type: 'timestamptz' },
  });
  pgm.createIndex('clear_history', ['tracked_character_id', 'log_id'], {
    name: 'clear_history_character_log_unique',
    unique: true,
  });
}

export async function down(pgm) {
  pgm.dropIndex('clear_history', ['tracked_character_id', 'log_id'], { name: 'clear_history_character_log_unique' });
  pgm.dropColumns('clear_history', ['log_id', 'cleared_at']);
}
