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
| `class_name`        | **bot-owned** — kept fresh from the newest log entry on every poll |
| `role`              | **bot-owned** — `dps` \| `support` \| `unknown`, inferred from the log entry's fields |
| `gear_score`        | **bot-owned** — from the newest log entry, kept fresh every poll  |
| `combat_power`      | **bot-owned** — from the newest log entry, kept fresh every poll  |
| `world`             | Lost Ark server name (e.g. "Arcturus"), from the rosters API's `world` field — set once at `/track-character` time, not re-fetched afterward |

Unique on `(linked_account_id, character_name, region, guild_id)`.

## `clear_history`

**Bot-owned.** One row per clear announced for a `competitive`-view-mode
character (nothing is logged for `compact` characters — see `/character-page`).
Powers the badge tally on that command.

| column                 | notes                                                     |
|------------------------|--------------------------------------------------------------|
| `tracked_character_id`     | FK to `tracked_characters.id`, cascades on delete          |
| `percentile`               | the clear's `percentile` value ("Uptime" badges), nullable |
| `contribution_percentile`  | the clear's `contributionPercentile` value ("Contribution" badges, support only), nullable |
| `died`                     | from the clear's `isDead` flag                             |

## `raid_group_posts`

**Bot-owned.** lostark.bible's log `id` is shared across every tracked
character who cleared the same raid together (confirmed: identical id +
identical millisecond timestamp across different accounts). Primary key
`(guild_id, log_id)` — whoever's poll job inserts first "claims" that raid
clear and posts a fresh Discord message; `message_id` starts null and gets
filled in right after. Later pollers for the same clear see the conflict,
wait briefly for `message_id`, then append their own embed to that message
instead of posting a separate one. See `src/scheduler/poller.js`'s
`announceClear`.

| column       | notes                                          |
|--------------|--------------------------------------------------|
| `guild_id`   | part of the primary key                          |
| `log_id`     | part of the primary key — the shared lostark.bible log id |
| `channel_id` | set once the claiming poller actually posts       |
| `message_id` | set once the claiming poller actually posts; null until then |

## `guild_settings`

Owned entirely by the bot — set via the `/announce-channel` slash command by a
server admin. The app page doesn't need Discord channel-listing permissions;
it only needs to know a `guild_id` when writing `tracked_characters`.
