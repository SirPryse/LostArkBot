import { pool } from './pool.js';

export async function getByDiscordUserId(discordUserId) {
  const { rows } = await pool.query('select * from linked_accounts where discord_user_id = $1', [
    discordUserId,
  ]);
  return rows[0] ?? null;
}

export async function markNeedsReauth(id) {
  await pool.query(
    "update linked_accounts set status = 'needs_reauth', updated_at = now() where id = $1",
    [id],
  );
}
