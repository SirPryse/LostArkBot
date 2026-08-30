# Architecture — commands and the logic behind them

A full read-through reference: what every command does, what data/logic it
leans on, and *why* it's built that way. `SCHEMA.md` documents the DB tables
themselves; this doc is about the code that reads/writes them. `RAID_ECONOMY.md`
is planning notes for features that don't exist yet — this doc is everything
that's actually shipped.

## Process shape

One Node process (`src/index.js`) runs four independent things side by side:

1. **Discord gateway client** (`src/discord/client.js`) — slash commands and
   button interactions.
2. **In-process poller** (`src/scheduler/poller.js`) — checks every tracked
   character for new clears on a timer, no job queue.
3. **Weekly reset scheduler** (`src/scheduler/weeklyReset.js`) — fires once at
   Wednesday 10:00 UTC.
4. **A tiny raw-`http` OAuth callback server** (`src/web/server.js`) — the one
   HTTP endpoint the bot needs since Discord bots can't receive a redirect
   themselves.

All four share one Postgres pool (`src/db/pool.js`) and the same process
lifetime — there's no BullMQ/Redis anymore (an earlier design used one; see
`poller.js`'s comments) and no separate web app (`SCHEMA.md`'s header explains
why the OAuth flow lives here instead of a standalone project). `index.js`
wires graceful shutdown (`SIGTERM`/`SIGINT`) and a crash safety net
(`uncaughtException`/`unhandledRejection`) around all four, both routed
through `closeAllActiveRounds()` so a deploy or a crash can't orphan an open
`/guess-parse` round (see that section below for why this needed a dedicated
fix).

## Shared building blocks

These aren't commands, but almost every command leans on at least one:

- **`src/notify/raidFamilies.js`** — the canonical map of boss name -> raid
  family + gate. Every "which raid was this" question in the codebase
  (announcements, `/bonk`, `/guess-parse`, `/recent-raids` friendly names)
  goes through `getRaidFamilyForBoss`/`getFriendlyBossName`. Also exports
  `ALL_KNOWN_BOSSES`, which exists purely because lostark.bible's log
  pagination silently no-ops without a `bosses` filter — passing every known
  boss name is what makes paging past page 1 actually work at all.
- **`src/notify/minDps.js`** — per-boss-per-difficulty minimum solo DPS,
  community-sourced. Compared against a live log entry's `dps` wherever a
  clear is shown (announcements, `/guess-parse`'s Min. DPS cell), never
  against `tracked_characters` — it's a per-clear check, not a per-character
  one. `null` means "no recorded value yet," not "no requirement."
- **`src/notify/percentileTiers.js`** — the 🏆/pink/orange/purple/blue/green/
  grey badge tiers, shared by clear announcements and every badge tally
  (`/character-page`, `/my-stats`).
- **`src/notify/classIcons.js`** — translates lostark.bible's class *display
  name* (e.g. "Slayer") to both a local icon file and a bot-owned Application
  Emoji id. Needs a translation table (not a simple lowercase) because the
  API's display names, the rosters API's snake_case keys, and even the
  logs API's own occasional misspellings ("Guardianknight", "Arcanist") all
  disagree with each other — `normalize()` handles spacing/case drift,
  `DISPLAY_NAME_ALIASES` handles genuinely different spellings.
- **`src/notify/clearMessage.js`** — builds the Components-V2 message for a
  real clear announcement, and is where `getRole()` (support vs. dps vs.
  unknown, inferred from whether the entry has `bdps` or `udps`) lives —
  every other command that needs a role calls this same function rather than
  re-deriving it. Also owns the "consolidate multiple party members from the
  same raid into one message" logic (`containerHasMember`/
  `buildAppendedClearMessage`), since lostark.bible assigns the same log `id`
  to every party member of the same clear.
- **`src/notify/raidWeek.js`** — `lastWednesdayReset()`, the shared "what
  counts as this week" boundary for `/bonk`/`/bonk-hard`. UTC-anchored
  (10:00 UTC every Wednesday, confirmed against Lost Ark's own daily-reset
  data), not the Node process's local timezone — that was an earlier, wrong
  assumption.
- **`src/lostarkbible/client.js`** — the only place that actually calls
  lostark.bible's resource endpoints (`getRosters`, `getCharacterLogs`).
  Centralizes 401 → `TokenExpiredError`, 403 → `InsufficientScopeError`, and
  429 → retry-with-backoff (shared app-wide throttle, not per-caller — a
  burst command like `/bonk` can trip it even when the background poller is
  already pacing itself).
- **`src/lostarkbible/weeklyLogs.js`** — `fetchLogsSince()`, shared by
  `/bonk` and `/bonk-hard` so both agree on exactly what "since the reset"
  means; pages forward using `ALL_KNOWN_BOSSES` until a page crosses the
  boundary.
- **`src/crypto/tokenCipher.js`** — AES-256-GCM for `access_token` at rest.
  Only `decryptToken` is actually called anywhere in this repo;
  `encryptToken` exists as the canonical reference for whatever project ends
  up writing tokens (this bot owns the OAuth flow itself now, per
  `SCHEMA.md`, but the function is kept in case that ever changes again).
- **`src/oauth/pendingLinks.js`** — an in-memory `Map` bridging
  `/link-account` (which knows *who* asked) to the OAuth callback route
  (which only gets back an opaque `state` + `code`). Same "single process, so
  in-memory-with-TTL is fine" pattern used for `trackCharacter.js`'s
  `pendingSelections` and `guessParse.js`'s `activeRounds` — losing one on a
  restart just means re-running the command.
- **`src/utils/clearChannel.js`** — bulk-delete for anything under Discord's
  14-day window, slow one-at-a-time delete beyond it (capped at 300 so it
  can't outlast an interaction token's ~15 min edit window). Shared by
  `/nuke` and the weekly reset's channel wipe — same operation, one manual,
  one on a timer.

## Commands

### `/link-account` — `linkAccount.js`
Starts the lostark.bible OAuth2+PKCE flow: generates `state` + a PKCE
`code_verifier`, stores them via `pendingLinks.js`, and replies with a Link
button pointing at `buildAuthorizeUrl()`. PKCE (not a client secret) because
this is registered as a public client — no server-side secret to protect the
exchange with, so proof-of-possession of the verifier is what does that job
instead. The actual token exchange happens later, in `web/server.js`, once
lostark.bible redirects back.

### `/track-character` — `trackCharacter.js`
Two-step flow: pick character(s) from the live roster (`getRosters()`), then
pick a view mode (**Compact** vs **Competitive**). Requires `/link-account`
first (needs a `linked_accounts` row) and filters out characters already
tracked in *this* guild (a character can be tracked in multiple guilds
independently, per `SCHEMA.md`'s unique constraint). View mode matters
downstream: `poller.js` only calls `recordClear()` for `competitive`
characters, so a `compact` character never populates `clear_history` at all
— that's why `/character-page` explicitly checks `view_mode` before showing
badges. Selections are held in an in-memory `Map` between the select-menu
step and the view-mode buttons (same pattern as `pendingLinks.js`) because a
button's customId can't hold more than one or two full character names.

### `/gold-earners` — `goldEarners.js`
Select-menu picker (same shape as `/track-character`'s first step), up to
`MAX_GOLD_EARNERS` (6) — mirrors the real in-game limit on how many roster
characters can be designated to actually earn gold from raid clears.
Account-scoped, not guild-scoped (`gold_earners` keyed by
`linked_account_id` + character name/region, not a `tracked_characters`
FK) — the same character tracked in two servers is still one earner slot,
not two, since a roster's real gold-earner designation isn't a per-server
concept. Replaces the whole set at once (delete + insert in one
transaction) rather than adding/removing individually, so there's no
window where an independent insert could exceed the cap. Powers the
estimated-gold stat everywhere it shows up (`/my-stats`, `/character-page`,
`/bonk`, `/bonk-hard`, `/challenge`) — see `clearHistory.js`'s
`getEstimatedGold*` functions and `goldEstimate.js`'s file comment for why
this is an *estimate*, never a real recorded number (lostark.bible's log
data has no gold field at all).

### `/challenge` — `challenge.js`
Picks a random **gate** (not a whole raid family — see the `challenges`
table's comment in `SCHEMA.md` for why: a multi-gate challenge could stall
forever on a gate the player never re-clears, e.g. one they already have on
skip) from a selected Gold Earner's current best-3 gold-earning *families*
(by gear score — `challengeRaids.js`'s live version of the same ranking
`RAID_DATA.md`'s "Optimal weekly gold by iLvl" table computes by hand,
verified to produce identical results), flattened into a pool of individual
gates across those 3 families. Sets the target by averaging that
character's last 5 same-difficulty clears on that one gate (fetched live
and filtered client-side, since lostark.bible's `bosses` filter has no
difficulty parameter — same page-and-filter shape as `fetchLogsSince`/
guess-parse's `tryCandidate`). DPS gets a single **UDPS** target
(deliberately not the raw `dps` field — that includes whatever damage
buffs the party's supports happened to be running that raid, so it swings
with party composition; UDPS is comparable raid to raid); support gets
contribution + all 4 buff uptimes. Only offers characters that are *both*
a designated Gold Earner *and* tracked with Competitive view in the
current guild (needs the cached `gear_score`/`role` from
`tracked_characters`, and the earner check itself is what gives this
command its purpose — thematically tied to `/gold-earners` rather than a
generic "pick any character" tool). Zero matching-difficulty clears yet
reads as "first clear sets the bar!" rather than an error — expected for a
gold earner on a raid they've just unlocked.

Gate offers exclude anything the character already has an **active,
completed, or failed** challenge on (`getChallengeExclusionKeysForCharacter`
— every decided-or-in-progress gate is off the table; only `abandoned`
rows, replaced by a same-gate re-accept, leave that gate eligible again).
Accept/Reroll buttons on the result: Reroll re-picks from
the same (already-exclusion-filtered) gate pool, excluding whichever gate
was just shown (falls back to the full available pool if excluding would
leave nothing; if the *exclusion* filter alone empties the pool, that's a
real "nothing left to offer" error instead). Accept is the only path that
actually *persists* anything (`challenges` table, see `SCHEMA.md`) — a
generated-but-never-accepted challenge leaves no trace, and a character
can hold **multiple** accepted challenges at once (one per gate) —
accepting only replaces an existing active challenge for that *exact
same* gate, not any others in progress. The raw target numbers needed to
persist live in an in-memory `pendingChallenges` Map keyed by the message
id (same TTL-Map pattern as `pendingSelections`/`pendingLinks.js`/
guess-parse's `activeRounds`), since Accept is a separate interaction from
whichever one actually built the numbers — losing this (TTL/restart)
degrades Accept to "locks the message, can't track completion" rather than
blocking it outright.

**Accepting posts publicly, with betting.** Right after persisting,
`postPublicChallenge()` posts a second embed to the guild's
`/announce-channel` (if one is configured — otherwise Accept still works,
just without the public/betting side) showing the challenger and the
target, plus **Success**/**Failure** buttons anyone *except* the
challenger can click to bet on the outcome (`challenge_bets` table, one
row per (challenge, better) — re-clicking updates the same row rather than
stacking, so a better can change their mind any time before it resolves).
Button labels carry the live tally (`Success (N)` / `Failure (N)`),
redrawn after every bet. The message id/channel land on the challenge row
itself (`bet_channel_id`/`bet_message_id`, set via `setBetMessage`) so
`poller.js` can find and lock that exact message once the challenge
resolves.

Once accepted, `poller.js`'s `checkChallengeProgress` checks every new
competitive clear against the character's active challenges and announces
the outcome to the guild's `/announce-channel` — with one gate per
challenge, the very first matching clear fully resolves it: falling short
fails it immediately (no unlimited retries), meeting the target completes
it. One not resolved by the next raid reset after acceptance auto-expires
as failed (`expireStaleChallenges`, checked every poll tick). Either path
also calls `finalizeBetMessage()`, which disables the bet buttons and
appends the final tally + result to the public bet post — a no-op if the
challenge was never posted publicly (no announcement channel configured
at Accept time) or the message/channel can no longer be found. Both
outcome embeds carry the boss's image as a real attached thumbnail
(`bossImages.js`, same as clear announcements) and the character's class
emoji inline before its name — for a real clear this comes straight off
the entry (`entry.class`); a timeout failure has no entry to read it
from, so it falls back to a `getNameAndClassById()` lookup (can
legitimately come back empty for a character with no clears logged yet,
in which case the icon and character-name placeholder are just omitted
rather than showing a broken tag).

Prediction accuracy is never stored directly — `getPredictionStats`
(`src/db/challengeBets.js`) compares each of a Discord user's bets against
its parent challenge's resolved `status` at read time, powering `/my-stats`'
Predictions / Right prediction rate line. A bet on a challenge that's still
`active`, or that got `abandoned` by a same-gate re-accept, simply doesn't
count toward anyone's rate yet.

### `/challenge-history` — `challengeHistory.js`
Read-only lookup, usable on *anyone* (not ownership-scoped — the whole
point is letting other people check someone's challenges), defaulting to
the caller if no `user` option is given. `listChallengesForDiscordUser`
joins every challenge across every character that Discord user has tracked
in the current guild, sorted active-first then newest-resolved-first.
`abandoned` rows (replaced by a same-gate re-accept, never actually
decided) are filtered out of the "Recent History" list entirely — showing
them next to real completions/failures would just be noise, not history.

### `/untrack-character` / `/untrack-all` / `/leave-server` — increasing scope
Three tiers of the same idea: `/untrack-character` removes only the calling
user's own characters (`remove()`, scoped by `linked_account_id`);
`/untrack-all` (admin-only, `ManageGuild`) wipes *every* character in the
guild regardless of owner (`removeAllByGuild()`); `/leave-server` does the
same wipe and then calls `guild.leave()`. Both of the latter two show a
confirm/cancel button pair first since they're destructive and
guild-wide — `/untrack-all`'s prompt states the character count up front so
an admin knows the blast radius before confirming.

### `/announce-channel` — `announceChannel.js`
Admin-only (`ManageGuild`). Just `setAnnouncementChannel()` — one row per
guild in `guild_settings`. This is the channel `poller.js` posts real clears
to and `weeklyReset.js` wipes/reposts to; nothing announces anywhere until
this is set once.

### `/check-now` — `checkNow.js`
Admin-only debug command — fires `runPollTick()` immediately instead of
waiting for the timer, fire-and-forget (the reply doesn't block on the full
pass finishing). Exists so a fresh `/track-character` doesn't need to wait up
to `POLL_INTERVAL_MINUTES` to see whether tracking actually worked.

### `/recent-raids` — `recentRaids.js`
Straight passthrough of `getCharacterLogs()` page 1 (no `bosses` filter
needed — this only ever wants the most recent page, so the pagination-no-op
bug doesn't apply), listed newest-first. The simplest command in the repo;
mostly useful as a sanity check that a character's log access actually
works.

### `/registered-users` — `registeredUsers.js`
Admin-only. Lists every `(discord_user_id, character)` pair tracked in the
guild, paginated. The pagination exists specifically because Discord's embed
description cap (4096 chars) is a hard `setDescription()` throw, not a
truncation — confirmed live against a 76-character guild producing a
~4600-char description. `chunkLines()` greedily packs under a conservative
3500-char budget per page rather than trying to hit the cap exactly.

### `/character-page` — `characterPage.js`
Per-character stat page: gear score, combat power, total clears, death
count, and percentile badges (`getStats()` from `clear_history`, tiered via
`percentileTiers.js`). Supports get two separate badge tallies side by side
(Uptime from `percentile`, Contribution from `contribution_percentile`) since
those are genuinely different metrics for that role; DPS only ever has one.
Select-menu -> visibility-buttons flow (same shape as `/my-stats` below) so
the requester chooses whether the result posts publicly or stays ephemeral.
Explicitly blocks `compact`-view characters with an explanatory message
rather than silently showing empty stats, since `compact` characters never
had `clear_history` rows to show in the first place.

### `/my-stats` — `myStats.js`
The combined, humor-flavored version of the above: pools every
`competitive`-view character the *account* has in the guild (`getAggregateStats`
merges DPS and support percentiles into one tally — support's
contribution axis has no DPS equivalent to merge against, so it's dropped
here, unlike `/character-page` which keeps both), plus a **Battle Record**
section (deaths, bus rides, below-min-DPS count — see `clearHistory.js`'s
nullable-boolean design below), a **Guess-Parse** section
(`getLifetimeStats()`, unbounded — a permanent record, unlike the weekly
leaderboard, merged with the weekly podium medal counts), and a **🎲
Challenges** section: `/challenge` badges (dps/support gates completed as
the *challenger*, `getCompletedChallengeCounts`) sitting alongside
Predictions / Right prediction rate (`getPredictionStats` — how often this
user has correctly called *someone else's* challenge outcome via
`/challenge`'s public bet buttons). Two different roles — challenger vs.
better — sharing one section, same "merge related-but-distinct axes"
pattern Guess-Parse already uses for its own two data sources. Both the
death-tier icon and the footer roast line are tiered/branch functions
purely for tone (see inline comments in the file itself for the exact
thresholds) — the underlying numbers are always the real counts, the
flavor text never replaces them.

### `/bonk` / `/bonk-hard` — `bonk.js` / `bonkHard.js`
Both show a roster's raid-family progress since the last Wednesday reset,
sorted by gear score. `/bonk` only lists characters/families with *some*
progress; `/bonk-hard` additionally lists characters sitting at zero clears
this week, grouped into one compact "No Clears" field rather than one all-
zero table each. That's the one place `getRosters()` gets used for something
other than picking characters to track: a character with literally zero
clears ever has no log entries to source class/gear-score from at all, so
`/bonk-hard` falls back to the live roster snapshot for those specifically
(`/bonk` never needs this, since it drops zero-progress characters instead
of trying to display them).

### `/nuke` — `nuke.js`
Renamed from `/clear-channel`. `ManageMessages`-gated, confirm/cancel first,
delegates the actual deletion to `clearChannel.js` (shared with the weekly
reset's own channel wipe). Checks the bot's own permission *before* even
showing the confirm prompt, so the failure message is specific and
actionable rather than falling through to `client.js`'s generic error
handler.

### `/guess-leaderboard` — `guessLeaderboard.js`
Reads `getLeaderboard(guildId, weekStart)` where `weekStart` is
`getLastResetAt()` — the same boundary the weekly reset itself uses, so
"this week" always means the same thing everywhere. `null` for a guild
that's never had a reset yet (shows all-time instead of nothing, so a brand
new server isn't just empty).

### `/guess-parse` — `guessParse.js`
By far the most involved command; the write-up on how it works lives inline
in the file (it's already extensively commented) — the short version:

- **Answer selection is account-first, character-second** (`pickAnswer`) —
  grouping by account before picking a character means an account with a
  dozen alts doesn't dominate the answer pool just by having more entries in
  the flat list.
- **Decoys are gear-score-bucket-matched** (`pickDecoys`, same bucket
  boundaries as the ones documented in `RAID_ECONOMY.md`'s planning notes)
  so three wildly different iLvl choices don't make the real answer obvious
  to anyone who knows the roster — and this reads straight off the
  `tracked_characters.gear_score` column the poller already keeps fresh,
  no extra live API calls needed for decoy selection.
- **Difficulty controls how many fields get redacted** and the base point
  value; a field-redaction *pool* covers both identifying metadata (class,
  gear score, duration, the always-visible-by-design `loggedAt` clue) and
  role-specific performance stats, with `class` always hidden regardless of
  difficulty (too recognizable otherwise) and `loggedAt` never hidden (it
  doesn't identify *who*, so hiding it never added real difficulty).
  `LINKED_HIDES` force DPS and UDPS to hide together since one leaks the
  other numerically.
- **Concurrent guesses are serialized** two different ways: an in-memory
  synchronous claim (`attemptedUsers`/`correctGuessers.push`, no `await` in
  between check-and-claim) so two clicks landing in the same instant can't
  both claim the same rank/multiplier, and a per-round edit queue
  (`queueRoundEdit`) so the *Discord message edits themselves* can't land
  out of order and silently revert a just-revealed round back to hidden.
- **Round state is in-memory** (`activeRounds`), which is exactly why
  `closeAllActiveRounds()` exists and gets called from both the graceful
  shutdown path and the crash-exit path in `index.js` — without it, any
  round open at restart time is orphaned (message stuck locked forever,
  since the `setTimeout` that would reveal it doesn't survive the process
  exit).
- **Scoring writes to `guess_attempts`** (`recordAttempt`), one row per
  guess — both `/guess-leaderboard`'s weekly view and `/my-stats`'s
  lifetime view read the same table with different time filters rather than
  keeping two counters that could drift.

### `/help` — `help.js`
Two modes off one command. No `command` option: lists every other
command's own `SlashCommandBuilder` description verbatim (imported
directly from each command module, not hand-duplicated — a single source
of truth that can't drift out of sync as descriptions change) as one
embed. With a `command` option (a fixed `addChoices()` list, one entry per
command, so there's no "command not found" case to handle): shows a
longer, hand-written `HELP_DETAILS` entry for that command — deliberately
just the user-visible flow (what you'll see, click, or type), never the
backend logic or DB checks behind it. `help` can't import its own
not-yet-declared export for the list view, so its own list entry is a
plain literal appended after the imported ones rather than sourced the
same way.

## Background jobs

### `poller.js`
One pass over every *enabled* tracked character (`listEnabledWithAccount()`),
sequential with a flat 200ms delay between each — replaced an earlier BullMQ
setup that gave per-job isolation for free; that isolation is now explicit
(a per-character try/catch inside `runPollTick`, so one character's failure
doesn't abort the rest of the batch). For each character: fetch page 1,
diff against `last_seen_log_id` to find genuinely new entries, announce each
(`announceClear()`, which also handles the "same log id across party
members" consolidation via `raid_group_posts`' claim-then-append pattern),
and for `competitive` characters, compute and persist `below_min_dps`
(DPS-role + a real `minDps.js` threshold only — `null` otherwise, matching
`clearHistory.js`'s "unknown, not false" philosophy) and pass through the
API's own `isBus` flag. Also checks the character's active `/challenge`(s)
(if any) every tick, fetched once per character rather than per entry — a
character can hold several active challenges at once now, one per gate:
`expireStaleChallenges()` first fails whichever are past their deadline
(the next raid reset after each was Accepted) even if nothing new was
cleared this tick, then each new competitive clear runs through
`checkChallengeProgress()`, which matches at most one active challenge
(duplicates for the same gate are prevented at creation) and fully
resolves it on that first matching clear — falling short fails it, meeting
the target completes it. Both functions also call `finalizeBetMessage()`
on every resolution, locking that challenge's public bet post (if it has
one — see `/challenge`'s betting flow) by disabling its Success/Failure
buttons and appending the final tally + result. Both functions return the
updated list (a resolved entry removed), which carries forward across the
rest of that tick's entries so several gates cleared in one tick still
each get credited correctly. Always calls `updateLastSeen()` at the end
regardless of whether anything
new was found, which is also how `class_name`/`gear_score`/`combat_power`/
`role` stay fresh on `tracked_characters` even between actual clears.

### `weeklyReset.js`
Fires once at Wednesday 10:00 UTC per guild with an announcement channel
configured (`msUntilNextReset()` recomputes from wall-clock each time rather
than a plain 7-day `setInterval`, so a restart never drifts the schedule).
Per guild: capture the outgoing week's boundary (`getLastResetAt`, read
*before* it gets overwritten), atomically claim the reset
(`claimWeeklyReset()` — a real Postgres-level conditional `UPDATE`, not an
in-memory flag, specifically because the double-fire bug this fixed came
from two different processes racing, not one process calling twice), wipe
the channel, award the top-3 guess-parse badges for the week that just
ended, then post the champions embed. No explicit leaderboard "reset" step
exists anymore — moving `last_reset_at` forward is itself what makes next
week's queries stop seeing old rows.

## Bot lifecycle

- **`client.js`** registers every command in one `COMMANDS` array (also the
  source of truth `deployCommands.js` pushes to Discord — the two arrays
  have to be kept in sync manually since they're not the same list) and
  routes every interaction to either a command's `execute()` or a matching
  `componentHandlers[].handle()` by customId prefix. A bare `Events.Error`
  listener exists only because Node's `EventEmitter` throws if an `'error'`
  event has zero listeners — without it, a transient gateway blip would
  crash the whole process instead of just logging and letting discord.js's
  own reconnect logic handle it.
- **`index.js`** wires the crash/shutdown safety net described at the top
  of this doc, and is the one place all four subsystems (Discord client,
  poller, weekly reset, OAuth server) actually get started.
