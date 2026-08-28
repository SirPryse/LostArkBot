import { pool } from './pool.js';

/** Every currently-active challenge for a character — plural now that a
 * character can hold several at once (one per gate; see the migration
 * comment for why a challenge is gate-specific). poller.js calls this once
 * per character per poll tick (not per clear entry). */
export async function getActiveChallengesForCharacter(trackedCharacterId) {
  const { rows } = await pool.query(
    "select * from challenges where tracked_character_id = $1 and status = 'active'",
    [trackedCharacterId],
  );
  return rows;
}

/**
 * Persists an Accepted challenge for one gate. Multiple different-gate
 * challenges can be active on the same character at once — only a
 * still-active challenge for this *exact same* character + boss +
 * difficulty gets abandoned first (a duplicate re-accept of the same gate
 * replaces it rather than stacking two trackers for the same thing; a
 * different gate is left alone entirely).
 */
export async function createChallenge(trackedCharacterId, { familyKey, difficulty, gateIndex, bossName, role, targets, sampleSize }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update challenges set status = 'abandoned'
       where tracked_character_id = $1 and status = 'active' and boss_name = $2 and difficulty = $3`,
      [trackedCharacterId, bossName, difficulty],
    );
    const { rows } = await client.query(
      `insert into challenges
         (tracked_character_id, family_key, difficulty, gate_index, boss_name, role, targets, sample_size)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [trackedCharacterId, familyKey, difficulty, gateIndex, bossName, role, JSON.stringify(targets), sampleSize],
    );
    await client.query('commit');
    return rows[0];
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Completed-challenge counts by role, pooled across every character an
 * account has in one guild — /my-stats' Challenge Badges field. Grouped by
 * the challenge's own stored `role` (its type at creation time), not the
 * character's *current* `role` on tracked_characters — those normally
 * agree, but the challenge's own value is the authoritative "was this a
 * DPS or Support challenge" answer regardless. Only `completed` counts,
 * same "badges are achievements, not participation" rule /character-page's
 * tier badges and /my-stats' Guess-Parse Badges already follow — a failed
 * or abandoned challenge earns nothing here. */
export async function getCompletedChallengeCounts(linkedAccountId, guildId) {
  const { rows } = await pool.query(
    `select c.role, count(*)::int as count
     from challenges c
     join tracked_characters tc on tc.id = c.tracked_character_id
     where tc.linked_account_id = $1 and tc.guild_id = $2 and c.status = 'completed'
     group by c.role`,
    [linkedAccountId, guildId],
  );

  const counts = { dps: 0, support: 0 };
  for (const row of rows) {
    if (row.role === 'dps' || row.role === 'support') counts[row.role] = row.count;
  }
  return counts;
}

/** Resolves a challenge one way or the other — with exactly one gate per
 * challenge now, there's no more "met some, not others" intermediate
 * state: a matching clear either completes it (met) or fails it (missed),
 * full stop. `status` is 'completed' or 'failed'; `completed_at` only ever
 * gets set for a real completion. */
export async function resolveChallenge(challengeId, status) {
  await pool.query(
    `update challenges
     set status = $2, met = ($2 = 'completed'), met_at = now(),
         completed_at = case when $2 = 'completed' then now() else completed_at end
     where id = $1`,
    [challengeId, status],
  );
}
