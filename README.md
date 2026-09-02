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
2. The first poll for a newly tracked character announces its current most
   recent clear(s) from page 1 (not full history — just what's visible on
   that page), so something shows up in Discord right after registering
   rather than staying silent. See `src/scheduler/poller.js`.
3. Use `/check-now` to force a poll cycle (both tiers) any time without
   waiting for `GOLD_EARNER_POLL_INTERVAL_MINUTES`/`OTHER_POLL_INTERVAL_MINUTES`.
4. To see it announce again, null out `last_seen_log_id` for that row and run
   `/check-now` — it'll re-post the same recent clears as if seeing them for
   the first time.

## Clear announcement embeds

`src/notify/embed.js` builds the announcement, and infers support vs. DPS
role from which fields the API actually returned for that entry (`bdps`
present → support, `udps` present → DPS) rather than the class name:

- **Support**: DPS, Buff Contribution (bDPS — damage their buffs added to
  the raid), Raid Contribution (`rContribution` as a %)
- **DPS**: Total Damage (computed from `dps × duration`), DPS, Contribution
  (rDPS)

Every boss currently gets the same placeholder portrait
(`assets/bosses/placeholder.png`, generated locally — a flat Discord-blurple
square). To use real art: drop a PNG per boss into `assets/bosses/` and point
that boss's entry in `src/notify/bossImages.js` at the new file.
