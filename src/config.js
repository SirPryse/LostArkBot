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
  redisUrl: required('REDIS_URL'),
  laBibleBaseUrl: process.env.LA_BIBLE_BASE_URL || 'https://lostark.bible',
  encryptionKey: required('ENCRYPTION_KEY'),
  pollIntervalMinutes: Number(process.env.POLL_INTERVAL_MINUTES || 10),
};
