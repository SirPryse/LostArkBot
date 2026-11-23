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

/** Returns true only when this call actually flipped the account from
 * another status to 'needs_reauth' — lets the poller refresh the re-link
 * notice once on the transition rather than on every character it skips. */
export async function markNeedsReauth(id) {
  const { rowCount } = await pool.query(
    "update linked_accounts set status = 'needs_reauth', updated_at = now() where id = $1 and status <> 'needs_reauth'",
    [id],
  );
  return rowCount > 0;
}

/**
 * Discord users with at least one enabled tracked character in this guild
 * whose lostark.bible link has expired (or been flagged needs_reauth), or
 * will expire within `warnWithinDays`. lostark.bible tokens last 90 days
 * and have no refresh token, so re-running /link-account is the only fix.
 * Revoked accounts are left out — that was a deliberate unlink.
 */
export async function listReauthCandidatesForGuild(guildId, warnWithinDays) {
  const { rows } = await pool.query(
    `select la.discord_user_id,
            la.token_expires_at,
            (la.status = 'needs_reauth' or la.token_expires_at <= now()) as expired,
            count(tc.id)::int as character_count
       from linked_accounts la
       join tracked_characters tc on tc.linked_account_id = la.id
      where tc.guild_id = $1
        and tc.enabled = true
        and la.status <> 'revoked'
        and (la.status = 'needs_reauth' or la.token_expires_at <= now() + make_interval(days => $2))
      group by la.id
      order by la.token_expires_at`,
    [guildId, warnWithinDays],
  );
  return rows;
}
