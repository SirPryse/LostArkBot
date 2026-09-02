import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  databaseUrl: required('DATABASE_URL'),
  laBibleBaseUrl: process.env.LA_BIBLE_BASE_URL || 'https://lostark.bible',
  encryptionKey: required('ENCRYPTION_KEY'),
  // Two-tier polling — Gold Earner characters (see gold_earners table) are
  // checked far more often than everyone else, since they're the ones
  // whose clears actually count toward the estimated-gold stat and drive
  // /challenge. See poller.js's runGoldEarnerPollTick/runOtherPollTick.
  goldEarnerPollIntervalMinutes: Number(process.env.GOLD_EARNER_POLL_INTERVAL_MINUTES || 5),
  otherPollIntervalMinutes: Number(process.env.OTHER_POLL_INTERVAL_MINUTES || 60),
  // Decoupled from both poll tiers above — see poller.js's
  // runChallengeExpiryTick for why a challenge's timeout-failure check
  // can't just piggyback on whichever tier its character happens to be in.
  challengeExpiryCheckIntervalMinutes: Number(process.env.CHALLENGE_EXPIRY_CHECK_INTERVAL_MINUTES || 5),
  // Public client (no client_secret) — lostark.bible's OAuth server supports
  // this via PKCE (confirmed live against its own
  // /.well-known/oauth-authorization-server: token_endpoint_auth_methods_supported
  // includes "none", code_challenge_methods_supported includes "S256"). Same
  // client_id RaidPlanner already uses; redirect URI just needs to be one of
  // the ones already registered for that shared app.
  laBibleClientId: required('LA_BIBLE_CLIENT_ID'),
  oauthPort: Number(process.env.OAUTH_PORT || 3000),
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
};
