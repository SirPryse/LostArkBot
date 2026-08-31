# Shared database contract

This repo (the bot + scheduler) owns the Postgres schema and migrations, and
now also owns the lostark.bible OAuth2+PKCE flow itself — `/link-account`
(`src/discord/commands/linkAccount.js`) starts it, and a small HTTP server
folded into this same process (`src/web/server.js`, just the one
`/oauth/callback` route) completes it. There's no separate "app page"
project anymore — Discord bots can't receive a third-party OAuth redirect
themselves (they only make outbound connections), so *some* real HTTP
endpoint was unavoidable, but it didn't need to be a whole separate
project/deployment; this is the minimal version of that, living in the
bot's own Fly.io deployment. **RaidPlanner** (a different project) shares
the same lostark.bible OAuth app/client_id but is otherwise unrelated —
doesn't read or write anything in this database.

## `linked_accounts`

One row per Discord user who has authorized lostark.bible access.

| column                 | notes                                                                 |
|------------------------|------------------------------------------------------------------------|
| `discord_user_id`      | Discord snowflake, unique                                              |
| `lostarkbible_user_id` | from `GET /api/oauth/user`'s `id` field (that endpoint also returns `discordId`, used to match the row) |
| `access_token`         | **must be encrypted** before insert — see `src/crypto/tokenCipher.js`  |
| `token_expires_at`     | `now() + expires_in` from the token response (currently 90 days)       |
| `scopes`               | space-separated, as returned by the token endpoint                    |
| `status`               | `active` \| `needs_reauth` \| `revoked` — the bot flips to `needs_reauth` on an expired token or a 401 from the API, and back to `active` itself once `/link-account` is re-run |

lostark.bible tokens have **no refresh token**. Re-running `/link-account`
is the only way to refresh one — `upsertLinkedAccount` (`src/db/linkedAccounts.js`)
overwrites the token/expiry/scopes and flips `status` back to `active`.

## `tracked_characters`

One row per character being watched. Written entirely by this bot's own
`/track-character` / `/untrack-character` commands — both just need the
shared `linked_account_id`.

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
Powers the badge tally on that command and /my-stats' Battle Record field.

| column                 | notes                                                     |
|------------------------|--------------------------------------------------------------|
| `tracked_character_id`     | FK to `tracked_characters.id`, cascades on delete          |
| `percentile`               | the clear's `percentile` value ("Uptime" badges), nullable |
| `contribution_percentile`  | the clear's `contributionPercentile` value ("Contribution" badges, support only), nullable |
| `died`                     | from the clear's `isDead` flag                             |
| `below_min_dps`            | whether the clear's `dps` fell under `minDps.js`'s threshold — **nullable**: null means "not applicable" (a support clear, or no threshold defined for that boss/difficulty yet), not "met the threshold". Only ever set for DPS-role clears with a real threshold. |
| `is_bus`                   | the clear's own `isBus` flag from lostark.bible — **nullable**: null means "recorded before this column existed", not "wasn't a bus". Never backfilled for historical rows (same as `class_name`/`gear_score` on `tracked_characters` below) — real values only exist for clears recorded after this column was added. |
| `raid_family_key`          | which `raidFamilies.js` family this clear belongs to (e.g. `'aegir'`), looked up via `getRaidFamilyForBoss()` at record time — **nullable**, same "not applicable/not known" convention as the rest. Only used by `getEstimatedGold*()` (below) to apply the weekly 3-family gold cap. |
| `estimated_gold`           | that gate's gold value from `src/notify/goldEstimate.js` (sourced from `RAID_DATA.md`) — **nullable**, null when no figure is known for that boss/difficulty yet. This is an *estimate*, not a real recorded amount: lostark.bible's log data has no gold field at all. |
| `raid_difficulty`          | the clear's raw difficulty string (e.g. `'Hard'`) — **nullable**, added after `raid_family_key`/`estimated_gold` (see below for why it can't be backfilled). Only used by `splitGold()` to tell apart a family's difficulties that pay 100% Unbound (Serca Hard/Nightmare, Kazeros Hard — confirmed) from the ones that still pay the usual 50/50 default. |

Neither the raw `dps` value nor which boss a clear was for gets stored
directly on this table — `raid_family_key`/`estimated_gold` above are both
*derived* values computed once at record time (from `raidFamilies.js`/
`goldEstimate.js`), not the raw boss/difficulty string itself (`raid_difficulty`
is the one exception — the raw difficulty string itself, not derived). There's
also no link back to the specific lostark.bible log entry a row came from (no
`log_id`). All of this means `below_min_dps`/`is_bus`/`raid_family_key`/
`estimated_gold`/`raid_difficulty` can't be backfilled for old rows after the
fact — confirmed live when asked to backfill the first two, this is a hard
limitation, not just unimplemented. `raid_difficulty` specifically also
can't be safely *reverse-derived* from `raid_family_key`+`estimated_gold`
alone even if it could be backfilled — a family+gold combination isn't
always unique (e.g. Serca's Corvus Tul Rak Normal and Witch of Agony Serca
Nightmare are both 21,000), so an old row's difficulty stays genuinely
unknown rather than guessed.

## `gold_earners`

**Bot-owned.** A roster can designate at most 6 characters as Gold Earners
in-game — only their clears actually pay gold, a real per-character flag
lostark.bible's API has no way to expose. Set via `/gold-earners`
(`src/discord/commands/goldEarners.js`), which replaces the whole set at
once (delete + insert in one transaction) rather than adding one at a time.

| column               | notes                                                        |
|----------------------|--------------------------------------------------------------|
| `linked_account_id`  | FK to `linked_accounts.id`, cascades on delete                |
| `character_name`     | not a FK to `tracked_characters` — deliberately account-scoped, not guild-scoped (see file comment on the migration for why) |
| `region`              | `CE` or `NA`                                                 |

Unique on `(linked_account_id, character_name, region)`. `getEstimatedGoldForAccount`/
`getEstimatedGoldForCharacter` (`src/db/clearHistory.js`) join `clear_history`
against this table to decide which clears count toward the estimated-gold
stat on `/my-stats`/`/character-page`.

## `challenges`

**Bot-owned.** One row per *Accepted* `/challenge` (`src/discord/commands/challenge.js`)
— a generated-but-not-accepted challenge is never written here at all.
**One gate per row, not a whole raid family** — a multi-gate challenge
could stall forever on a gate the player never re-clears (Lost Ark lets
you skip a gate you've already cleared, which generates no fresh log entry
at all). A character can hold multiple challenges active at once (one per
gate); accepting a new one only abandons a still-*active* challenge for the
exact same character + `boss_name` + `difficulty` — a genuine duplicate,
not every other in-progress challenge (see `src/db/challenges.js`).

| column                 | notes                                                     |
|-------------------------|------------------------------------------------------------|
| `tracked_character_id` | FK to `tracked_characters.id`, cascades on delete           |
| `family_key`           | which `raidFamilies.js` family this gate belongs to (display/context only) |
| `difficulty`           | the difficulty string the target was generated at           |
| `gate_index`           | which gate within the family                                 |
| `boss_name`            | the gate's boss name at this difficulty                      |
| `role`                 | `dps` \| `support` — decides how `targets` is shaped          |
| `targets`              | JSONB — `{ udps }` for DPS (un-buffed DPS, not raw `dps` — deliberately excludes whatever damage buffs the party's supports happened to be running that raid, so it stays comparable across runs), or `{ contribution, buffs: [4 nullable values] }` for support (a `null` buff slot means no historical data existed at generation time and isn't required to meet the target) |
| `sample_size`          | how many recent clears the target was averaged from           |
| `status`               | `active` \| `completed` \| `abandoned` \| `failed`            |
| `met` / `met_at`       | set together once resolved either way                        |
| `completed_at`         | set only on a real `completed`, never on a `failed`           |
| `bet_channel_id`       | channel the public "place your bet" post landed in, null until Accepted with an announcement channel configured |
| `bet_message_id`       | that post's message id — `poller.js` fetches and locks it (disables the buttons, appends the final tally) once this row resolves |

With exactly one gate per row, the very first matching clear fully
resolves it one way or the other — no more "some gates done" intermediate
state. `src/scheduler/poller.js`'s `checkChallengeProgress` checks every
new competitive clear against the character's active challenges (matches
at most one, since duplicates are prevented at creation), and announces
either outcome to the guild's `/announce-channel`.

**`failed` has two distinct triggers, both in `poller.js`:** a matching
clear that *falls short* of the target fails the challenge immediately (no
unlimited retries), and a challenge not completed by the *next* raid reset
after it was Accepted auto-expires as failed (`expireStaleChallenges` — the
deadline is the reset right after `created_at`, not a flat 7 days, so one
taken right before Wednesday's reset doesn't get an almost-double-length
window). Checked lazily every poll tick rather than via a dedicated
scheduler.

## `challenge_bets`

**Bot-owned.** Once a challenge is Accepted, `challenge.js` posts it
publicly (to `bet_channel_id` above) with Success/Failure buttons — anyone
*except* the challenger can bet on the outcome, and can change their bet any
time before the challenge resolves. One row per (challenge, better) pair,
not an event log — re-betting updates the existing row (`upsertBet` in
`src/db/challengeBets.js`) rather than stacking a new one, since only the
*current* pick matters.

| column               | notes                                                        |
|-----------------------|--------------------------------------------------------------|
| `challenge_id`        | FK to `challenges.id`, cascades on delete                     |
| `discord_user_id`     | the better, not the challenger                                |
| `predicted_outcome`   | `success` \| `failure`                                        |
| `created_at` / `updated_at` | `updated_at` bumps on every re-bet                     |

Unique on `(challenge_id, discord_user_id)`. Accuracy is never stored
directly — `getPredictionStats` compares each bet's `predicted_outcome`
against its parent challenge's resolved `status` at read time (`/my-stats`'
Predictions / Right prediction rate), so a bet on a still-`active` or
`abandoned` challenge simply doesn't count toward anyone's rate yet (an
abandoned challenge — replaced by a same-gate re-accept — never actually
gets decided one way or the other, so it never resolves into a right/wrong
answer for anyone who bet on it).

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

## `guess_attempts`

**Bot-owned**, and entirely separate from raid-tracking data — one row per
`/guess-parse` guess attempt (right or wrong), an event log rather than a
running counter. Both `/guess-leaderboard` (weekly, filtered by
`created_at >= guild_settings.last_reset_at`) and `/my-stats`' lifetime
Guess-Parse Stats (unbounded) read this same table with different time
windows — see `src/db/guessGame.js`. Replaced the older `guess_game_scores`
(cumulative points table) and `guess_stats` (lifetime win/loss counts)
tables, both dropped. The app page never touches this table.

| column             | notes                                                        |
|---------------------|--------------------------------------------------------------|
| `guild_id`          |                                                                |
| `discord_user_id`   |                                                                |
| `correct`           | whether this specific guess was right                        |
| `points`            | 0 for a wrong guess; a correct guess is worth more on a harder `/guess-parse` difficulty and more for an earlier correct guesser (rank multiplier) |
| `created_at`         | indexed with `guild_id` — this is what the weekly/lifetime windows filter on |
