import { pool } from './pool.js';

// Real in-game cap — a roster can only designate 6 characters as Gold
// Earners. Enforced here (not a DB constraint) since the whole set is
// replaced at once by /gold-earners rather than added to one at a time —
// see setGoldEarners below.
export const MAX_GOLD_EARNERS = 6;

export async function listGoldEarners(linkedAccountId) {
  const { rows } = await pool.query(
    'select character_name, region from gold_earners where linked_account_id = $1 order by character_name',
    [linkedAccountId],
  );
  return rows;
}

/** `name|region` per row — the same composite key clear_history's
 * character_name/region pair uses, so getEstimatedGold() can check
 * membership with a plain Set.has() instead of a second query per clear. */
export async function getGoldEarnerKeySet(linkedAccountId) {
  const rows = await listGoldEarners(linkedAccountId);
  return new Set(rows.map((r) => `${r.character_name}|${r.region}`));
}

/** Replaces the whole gold-earner set for this account in one transaction —
 * /gold-earners is a "pick your 6" select menu, not an incremental
 * add/remove, so there's no independent-insert path a 7th row could sneak
 * in through. `characters` is `{ name, region }[]`, capped at
 * MAX_GOLD_EARNERS by the caller (the select menu's own setMaxValues, plus
 * this defensive check in case that's ever bypassed). */
export async function setGoldEarners(linkedAccountId, characters) {
  if (characters.length > MAX_GOLD_EARNERS) {
    throw new Error(`Cannot set more than ${MAX_GOLD_EARNERS} gold earners`);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from gold_earners where linked_account_id = $1', [linkedAccountId]);
    for (const { name, region } of characters) {
      await client.query(
        'insert into gold_earners (linked_account_id, character_name, region) values ($1, $2, $3)',
        [linkedAccountId, name, region],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
