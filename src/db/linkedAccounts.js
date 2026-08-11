import { pool } from './pool.js';

/** Creates or re-links a linked_accounts row for this Discord user — same
 * upsert semantics the original app-page plan called for: on conflict
 * (discord_user_id is unique), overwrite the token/scopes/expiry and flip
 * status back to 'active'. Covers both a brand-new link and a re-auth of an
 * account the bot had previously marked 'needs_reauth'.
 *
 * `encryptedAccessToken` must already be encrypted — see tokenCipher.js;
 * this function doesn't do that itself, matching how every other write path
 * in this file (and SCHEMA.md's documented contract) expects the caller to
 * handle encryption before it reaches here. */
export async function upsertLinkedAccount({
  discordUserId,
  lostarkbibleUserId,
  encryptedAccessToken,
  tokenExpiresAt,
  scopes,
}) {
  const { rows } = await pool.query(
    `insert into linked_accounts (discord_user_id, lostarkbible_user_id, access_token, token_expires_at, scopes, status)
     values ($1, $2, $3, $4, $5, 'active')
     on conflict (discord_user_id) do update
       set lostarkbible_user_id = excluded.lostarkbible_user_id,
           access_token = excluded.access_token,
           token_expires_at = excluded.token_expires_at,
           scopes = excluded.scopes,
           status = 'active',
           updated_at = now()
     returning *`,
    [discordUserId, lostarkbibleUserId, encryptedAccessToken, tokenExpiresAt, scopes],
  );
  return rows[0];
}

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
