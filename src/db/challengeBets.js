import { pool } from './pool.js';

/** Places or updates one Discord user's bet on one challenge — an upsert
 * (not an insert) so someone can change their mind any time before the
 * challenge resolves, per the unique (challenge_id, discord_user_id)
 * constraint. Self-betting is blocked in challenge.js's button handler,
 * before this is ever called, not here. */
export async function upsertBet(challengeId, discordUserId, predictedOutcome) {
  const { rows } = await pool.query(
    `insert into challenge_bets (challenge_id, discord_user_id, predicted_outcome)
     values ($1, $2, $3)
     on conflict (challenge_id, discord_user_id) do update
       set predicted_outcome = excluded.predicted_outcome, updated_at = now()
     returning *`,
    [challengeId, discordUserId, predictedOutcome],
  );
  return rows[0];
}

/** Live tally for one challenge's public bet post — redrawn onto the
 * button labels after every bet (see challenge.js) and again, final, when
 * poller.js locks the message at resolution. */
export async function getBetCounts(challengeId) {
  const { rows } = await pool.query(
    `select predicted_outcome, count(*)::int as count
     from challenge_bets where challenge_id = $1
     group by predicted_outcome`,
    [challengeId],
  );
  const counts = { success: 0, failure: 0 };
  for (const row of rows) counts[row.predicted_outcome] = row.count;
  return counts;
}

/**
 * Lifetime prediction accuracy for one Discord user, across every bet
 * they've placed on *someone else's* challenge that has since resolved —
 * a still-active challenge doesn't count yet (the outcome isn't known), and
 * there's no "abandoned" case here since a bet can only ever be placed on
 * an active challenge and abandonment only happens via a same-gate re-accept
 * (see createChallenge), which simply orphans any bets already placed on
 * the abandoned row — they stay un-resolved forever rather than counting
 * against anyone, since that challenge was replaced, not decided.
 * Correctness is computed here rather than stored, comparing each bet's
 * predicted_outcome against the parent challenge's final status
 * ('completed' -> the 'success' bets were right, 'failed' -> the 'failure'
 * bets were right) — see /my-stats' Challenges section. */
export async function getPredictionStats(discordUserId) {
  const { rows } = await pool.query(
    `select
       count(*)::int as total,
       count(*) filter (
         where (c.status = 'completed' and b.predicted_outcome = 'success')
            or (c.status = 'failed' and b.predicted_outcome = 'failure')
       )::int as correct
     from challenge_bets b
     join challenges c on c.id = b.challenge_id
     where b.discord_user_id = $1 and c.status in ('completed', 'failed')`,
    [discordUserId],
  );
  return rows[0] ?? { total: 0, correct: 0 };
}
