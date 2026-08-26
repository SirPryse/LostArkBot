import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getByDiscordUserId } from '../../db/linkedAccounts.js';
import { getAggregateStats } from '../../db/clearHistory.js';
import { getBadgeCounts } from '../../db/guessLeaderboardBadges.js';
import { getLifetimeStats } from '../../db/guessGame.js';
import { TIERS } from '../../notify/percentileTiers.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

const VISIBILITY_PREFIX = 'my-stats-vis:';
const WEEKLY_RANK_MEDALS = [
  { rank: 1, emoji: '🥇' },
  { rank: 2, emoji: '🥈' },
  { rank: 3, emoji: '🥉' },
];
// Uploaded to the bot's own application emoji repository (see
// classIcons.js for the rest of that repository) rather than pulled from
// any one server — confirmed live that a guild emoji tag silently
// degrades to plain `:name:` text when the bot isn't a member of that
// emoji's home server, but application emoji have no such dependency;
// they work in any server the bot is in. Reserved for the *top* death
// tier now (see deathTierEmoji below) rather than used as a flat icon
// for every death count — earns its place instead of being the default.
const CLOWNSKULL_EMOJI = '<:clownskull:1542205122103222342>';

/** One tier/rank per line so the counts are actually readable. */
function badgeLines(entries, counts, keyOf) {
  return entries.map((e) => `${e.emoji} **${counts[keyOf(e)]}**`).join('\n');
}

/** '—' rather than "0%" or NaN% when nobody's guessed yet — a made-up 0%
 * would misleadingly read as "always wrong" instead of "hasn't played". */
function formatWinRate(correct, total) {
  if (total === 0) return '—';
  return `${Math.round((correct / total) * 100)}%`;
}

// The icon itself escalates with the tier, not just the text next to it —
// starts at a plain/normal skull (everyone dies sometimes) and upgrades
// through progressively more dramatic ones, with the custom clownskull
// held back as the top tier's payoff rather than spent on every count.
function deathTierEmoji(count) {
  if (count === 0) return '🏆';
  if (count <= 5) return '💀';
  if (count <= 15) return '☠️';
  return CLOWNSKULL_EMOJI;
}

// Purely cosmetic tiered commentary — thresholds are loose, tone is
// teasing, not literal judgment. Every one of these is a short flavor
// string next to a real number, never a replacement for it.
function deathFlavor(count) {
  if (count === 0) return 'Untouchable 😎';
  if (count <= 5) return 'Had a rough week';
  if (count <= 15) return 'Certified feeder';
  return 'The floor is a second home';
}

function busFlavor(count) {
  if (count === 0) return 'Never once a liability';
  if (count <= 5) return 'Occasional passenger';
  if (count <= 15) return 'Bus regular';
  return 'Has a monthly bus pass 🎫';
}

function winRateFlavor(correct, total) {
  if (total === 0) return '';
  const pct = correct / total;
  if (pct < 0.3) return '🎲 Vibes-based guessing';
  if (pct < 0.6) return 'Coin flip energy';
  if (pct < 0.85) return 'Sharp eye';
  return 'Certified detective 🕵️';
}

/** One roast line for the embed footer — checks the funniest/most notable
 * stat first (highest tiers of deaths/bus rides), falls back to a milder
 * jab, and if genuinely nothing stands out, a backhanded compliment rather
 * than nothing at all. Teasing, not actually mean — matches this bot's
 * existing tone elsewhere (guess-parse's "Wall of Shame" for wrong
 * guesses). */
function buildRoastFooter({ diedCount, busCount, correctGuesses, totalGuesses }) {
  if (diedCount >= 16) return `⚰️ ${diedCount} deaths and counting — the floor missed you.`;
  if (busCount >= 16) return `🎫 ${busCount} bus rides — at this point just get a season pass.`;
  if (diedCount >= 6) return `💀 ${diedCount} deaths this lifetime. Maybe watch a guide?`;
  if (busCount >= 6) return `🚌 ${busCount} bus rides — the carry did the heavy lifting.`;
  if (totalGuesses >= 5 && correctGuesses / totalGuesses < 0.3) {
    return `🎲 ${Math.round((correctGuesses / totalGuesses) * 100)}% win rate on /guess-parse — pure chaos guessing.`;
  }
  if (diedCount === 0 && busCount === 0) return '✨ A flawless record. Suspiciously flawless.';
  return '🤝 A perfectly respectable raider. Nothing more to see here.';
}

/** Weekly guess-parse leaderboard placements — deliberately its own field,
 * not merged into the percentile-tier Raid Badges above (different game,
 * different achievement). See guessLeaderboardBadges.js. Guess-Parse Stats
 * (win rate / total guesses) is a third, separate axis again — an unbounded
 * getLifetimeStats() query (no time filter, unlike the weekly leaderboard),
 * so it's a permanent record never reset by the weekly leaderboard wipe. */
async function buildMyStatsEmbed(linkedAccountId, discordUserId, guildId, user) {
  const [{ total, diedCount, tierCounts, belowMinDpsCount, busCount }, weeklyBadgeCounts, guessStats] = await Promise.all([
    getAggregateStats(linkedAccountId, guildId, TIERS),
    getBadgeCounts(guildId, discordUserId),
    getLifetimeStats(guildId, discordUserId),
  ]);

  const { correct_guesses: correctGuesses, total_guesses: totalGuesses } = guessStats;
  const winRateFlavorText = winRateFlavor(correctGuesses, totalGuesses);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.username}'s Stats`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          {
            // Both this and Guess-Parse Stats below are non-inline and
            // placed first — each forces its own row, so the reading order
            // is battle record, then guess-parse stats, then the badges
            // row, rather than description text floating above everything.
            name: '⚔️ Battle Record',
            value:
              `Total gates cleared: **${total}**\n` +
              `${deathTierEmoji(diedCount)} **${diedCount}** — ${deathFlavor(diedCount)}\n` +
              `🚌 **${busCount}** — ${busFlavor(busCount)}\n` +
              `⚠️ **${belowMinDpsCount}** below Min DPS`,
          },
          {
            name: '🎯 Guess-Parse Stats',
            value:
              `Win Rate: **${formatWinRate(correctGuesses, totalGuesses)}**${winRateFlavorText ? ` — ${winRateFlavorText}` : ''}\n` +
              `Total Guesses: **${totalGuesses}**`,
          },
          { name: '🎖️ Raid Badges', value: badgeLines(TIERS, tierCounts, (t) => t.key), inline: true },
          { name: '🏆 Guess-Parse Badges', value: badgeLines(WEEKLY_RANK_MEDALS, weeklyBadgeCounts, (m) => m.rank), inline: true },
        )
        .setColor(FALLBACK_COLOR)
        .setFooter({ text: buildRoastFooter({ diedCount, busCount, correctGuesses, totalGuesses }) }),
    ],
  };
}

export const myStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('my-stats')
    .setDescription('View your combined clear stats across every competitive character in this server'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const account = await getByDiscordUserId(interaction.user.id);
    if (!account) {
      await interaction.editReply("You don't have any tracked characters in this server.");
      return;
    }

    // No early return on zero clears — Guess-Parse Badges (the weekly
    // leaderboard field) come from guessLeaderboardBadges.js, entirely
    // unrelated to clear_history, so someone with real clears not yet
    // logged (or none at all) can still have those to show.
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${VISIBILITY_PREFIX}self`).setLabel('Only me').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${VISIBILITY_PREFIX}everyone`)
        .setLabel('Post to everyone')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.editReply({ content: 'Your stats are ready. Who should see it?', components: [buttons] });
  },

  componentHandlers: [
    {
      prefix: VISIBILITY_PREFIX,
      async handle(interaction) {
        const visibility = interaction.customId.slice(VISIBILITY_PREFIX.length);

        const account = await getByDiscordUserId(interaction.user.id);
        if (!account) {
          await interaction.update({ content: "You don't have any tracked characters in this server.", components: [] });
          return;
        }

        const payload = await buildMyStatsEmbed(account.id, interaction.user.id, interaction.guildId, interaction.user);

        await interaction.update({ content: 'Here you go!', components: [] });
        await interaction.followUp({
          ...payload,
          flags: visibility === 'everyone' ? undefined : MessageFlags.Ephemeral,
        });
      },
    },
  ],
};
