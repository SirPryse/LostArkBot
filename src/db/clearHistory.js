import { pool } from './pool.js';

export async function recordClear(trackedCharacterId, percentile) {
  await pool.query('insert into clear_history (tracked_character_id, percentile) values ($1, $2)', [
    trackedCharacterId,
    percentile,
  ]);
}

/** Total clears logged, plus how many landed at or above each percentile
 * tier's minimum (matches src/notify/percentileTiers.js's TIERS boundaries). */
export async function getStats(trackedCharacterId, tierMins) {
  const { rows } = await pool.query(
    'select percentile from clear_history where tracked_character_id = $1',
    [trackedCharacterId],
  );

  const tierCounts = Object.fromEntries(tierMins.map(({ key }) => [key, 0]));
  for (const row of rows) {
    if (row.percentile === null) continue;
    const p = Number(row.percentile) * 100;
    const tier = tierMins.find((t) => p >= t.min) ?? tierMins[tierMins.length - 1];
    tierCounts[tier.key] += 1;
  }

  return { total: rows.length, tierCounts };
}
