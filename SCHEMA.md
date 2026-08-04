# Shared database contract

This repo (the bot + scheduler) owns the Postgres schema and migrations. The
**app page** (separate repo, runs the lostark.bible OAuth2+PKCE flow) is expected
to write to `linked_accounts` and `tracked_characters` directly. If either side
changes shape, both repos need updating together.

## `linked_accounts`

One row per Discord user who has authorized lostark.bible access.

| column                 | notes                                                                 |
|------------------------|------------------------------------------------------------------------|
| `discord_user_id`      | Discord snowflake, unique                                              |
| `lostarkbible_user_id` | from `GET /api/oauth/user`                                             |
| `access_token`         | **must be encrypted** before insert — see `src/crypto/tokenCipher.js`  |
| `token_expires_at`     | `now() + expires_in` from the token response (currently 90 days)       |
| `scopes`               | space-separated, as returned by the token endpoint                    |
| `status`               | `active` \| `needs_reauth` \| `revoked` — the bot flips this, the app page should read it to prompt re-auth |

lostark.bible tokens have **no refresh token**. When the bot marks a row
`needs_reauth` (expired token, or a 401 from the API), the app page is
responsible for re-running the OAuth flow and updating `access_token` /
`token_expires_at` / `status` back to `active`.

## `tracked_characters`

One row per character being watched. Written by either side: the app page's
dashboard used to write this (now read-only there), and the bot's own
`/track-character` / `/untrack-character` commands write it directly now —
both just need the shared `linked_account_id`.

| column              | notes                                                          |
|---------------------|-----------------------------------------------------------------|
| `linked_account_id` | FK to `linked_accounts.id`                                      |
| `character_name`    | matched case-insensitively by the lostark.bible API              |
| `region`            | `CE` or `NA`                                                     |
| `guild_id`          | which Discord server this character's clears announce in         |
| `enabled`           | set `false` to pause without deleting the row                   |
| `view_mode`         | `compact` (Difficulty/Class/Gear Score/Combat Power only) or `competitive` (adds the full DPS/support stat breakdown) — set via the buttons at the end of `/track-character` |
| `last_seen_log_id`  | **bot-owned**, do not write from elsewhere                       |
| `last_checked_at`   | **bot-owned**, do not write from elsewhere                       |

Unique on `(linked_account_id, character_name, region, guild_id)`.

## `guild_settings`

Owned entirely by the bot — set via the `/announce-channel` slash command by a
server admin. The app page doesn't need Discord channel-listing permissions;
it only needs to know a `guild_id` when writing `tracked_characters`.
