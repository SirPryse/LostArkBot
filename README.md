# LostArkBot

Discord bot + scheduler that announces newly completed raids for characters
linked via lostark.bible OAuth. The consent/linking web page is a separate
project — see [SCHEMA.md](SCHEMA.md) for the DB contract between the two.

## Setup

1. **Discord bot**: create an application at the [Discord Developer
   Portal](https://discord.com/developers/applications), add a Bot, copy its
   token and the application's Client ID. Invite it to your server with the
   `applications.commands` and `bot` scopes (Send Messages permission).
2. **Postgres**: create a [Supabase](https://supabase.com) project, grab the
   direct connection string (port 5432) from Database Settings.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`,
   `DISCORD_CLIENT_ID`, `DATABASE_URL`. Generate `ENCRYPTION_KEY` with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Install dependencies and run migrations:
   ```
   npm install
   npm run migrate
   ```
5. Register slash commands (run again any time commands change):
   ```
   npm run deploy-commands
   ```
6. Start the bot:
   ```
   npm run dev
   ```

`npm run check-env` verifies `.env` against Discord, Postgres and
lostark.bible without starting the bot (read-only). `npm test` runs the unit
tests (`test/`), which use dummy settings and never touch the real database
or APIs.

The scheduler polls in-process on two plain intervals — no queue or Redis
involved. Designated Gold Earner characters are checked every
`GOLD_EARNER_POLL_INTERVAL_MINUTES` (default 5); everyone else every
`OTHER_POLL_INTERVAL_MINUTES` (default 60) — Gold Earners are the characters
whose clears actually count toward the estimated-gold stat and drive
`/challenge`, so they get checked far more often. This is a single-instance
bot, so a distributed job queue was pure overhead; it used to run on
BullMQ/Upstash Redis but that got dropped after burning through Upstash's
free-tier request cap in about a week from the per-character job fan-out.

## Manual test

`linked_accounts` / `tracked_characters` rows are normally created via the
[LostArkAppPage](../LostArkAppPage) OAuth consent UI (a separate project —
run that to link an account and pick a character to track). Once a row
exists:

1. Run `/announce-channel` in your test server to set the announcement
   channel (if you haven't already).
2. The first poll for a newly tracked character only records a baseline
   (its newest log id) — nothing is announced until it clears something
   new. After a gap (an expired link renewed with `/link-account`, or the
   bot being down) it pages back to the last clear it saw: clears older
   than 6 hours are recorded for stats/gold silently, newer ones are
   announced. See `processCharacter()` in `src/scheduler/poller.js`.
3. Use `/check-now` to force a poll cycle (both tiers) any time without
   waiting for `GOLD_EARNER_POLL_INTERVAL_MINUTES`/`OTHER_POLL_INTERVAL_MINUTES`.
4. To see it announce again, null out `last_seen_log_id` for that row and run
   `/check-now` — it'll re-post the same recent clears as if seeing them for
   the first time.

## Clear announcement embeds

`src/notify/clearMessage.js` builds the announcement (Components V2), and
infers support vs. DPS role from which fields the API actually returned for
that entry rather than the class name: `bdps` present → support, `udps` or
`ndps` present → DPS. (lostark.bible renamed `udps` to `ndps` in Nov 2026;
`getCharacterLogs()` aliases `ndps` back to `udps` so every consumer keeps
working on both shapes.)

- **Support**: buff uptimes, rDPS / rDPS%, uptime + contribution percentile
- **DPS**: DPS, UDPS, Min. DPS ✅/⚠️ (from `src/notify/minDps.js`),
  percentile

Boss art lives in `assets/bosses/` and is mapped per boss name in
`src/notify/bossImages.js`; anything unmapped falls back to
`assets/bosses/lostark.png`.

## Expired lostark.bible links

Links last 90 days with no refresh token. `src/notify/reauthNotice.js` keeps
one "re-link needed" post per server in the announcement channel, mentioning
everyone whose link has expired or expires within 3 days. It's edited in
place (edits don't re-ping), deleted once nobody needs to re-link, and
re-posted after the weekly channel clear or `/nuke`. Anything that discovers
an expired token should call `flagNeedsReauth()` from that module rather than
`markNeedsReauth()` directly, so the notice updates immediately.
