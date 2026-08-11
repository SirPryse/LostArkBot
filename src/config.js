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
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES || 10),
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
