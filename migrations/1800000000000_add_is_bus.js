export const shorthands = undefined;

/**
 * lostark.bible's own `isBus` flag on every log entry — real Lost Ark
 * community slang for a clear where the player was carried, not the same
 * signal as below_min_dps (a community DPS-threshold check that only
 * applies to DPS-role clears with a defined threshold). Unlike
 * below_min_dps this always has a real value straight from the log entry,
 * never null — every entry (DPS or support) reports it.
 */
export async function up(pgm) {
  pgm.addColumn('clear_history', {
    is_bus: { type: 'boolean', notNull: true, default: false },
  });
}

export async function down(pgm) {
  pgm.dropColumn('clear_history', 'is_bus');
}
