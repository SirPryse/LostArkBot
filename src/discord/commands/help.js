import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { announceChannelCommand } from './announceChannel.js';
import { checkNowCommand } from './checkNow.js';
import { recentRaidsCommand } from './recentRaids.js';
import { registeredUsersCommand } from './registeredUsers.js';
import { trackCharacterCommand } from './trackCharacter.js';
import { untrackCharacterCommand } from './untrackCharacter.js';
import { characterPageCommand } from './characterPage.js';
import { bonkCommand } from './bonk.js';
import { bonkHardCommand } from './bonkHard.js';
import { nukeCommand } from './nuke.js';
import { myStatsCommand } from './myStats.js';
import { guessParseCommand } from './guessParse.js';
import { guessLeaderboardCommand } from './guessLeaderboard.js';
import { untrackAllCommand } from './untrackAll.js';
import { leaveServerCommand } from './leaveServer.js';
import { linkAccountCommand } from './linkAccount.js';
import { goldEarnersCommand } from './goldEarners.js';
import { challengeCommand } from './challenge.js';
import { challengeHistoryCommand } from './challengeHistory.js';
import { FALLBACK_COLOR } from '../../notify/clearMessage.js';

// Every other command's own (already-short) SlashCommandBuilder description
// is reused verbatim for the no-argument list view — a single source of
// truth for the "simple definition" instead of hand-duplicating text here
// that could drift out of sync with the actual command. `help` itself is
// appended manually below since it can't import its own not-yet-declared
// export.
const OTHER_COMMANDS = [
  linkAccountCommand,
  trackCharacterCommand,
  untrackCharacterCommand,
  goldEarnersCommand,
  announceChannelCommand,
  challengeCommand,
  challengeHistoryCommand,
  myStatsCommand,
  characterPageCommand,
  bonkCommand,
  bonkHardCommand,
  recentRaidsCommand,
  registeredUsersCommand,
  guessParseCommand,
  guessLeaderboardCommand,
  untrackAllCommand,
  leaveServerCommand,
  nukeCommand,
  checkNowCommand,
].map((c) => ({ name: c.data.name, description: c.data.description }));

const ALL_COMMANDS = [
  ...OTHER_COMMANDS,
  { name: 'help', description: 'List every command, or get detailed usage for one' },
].sort((a, b) => a.name.localeCompare(b.name));

// Longer, purely user-facing usage text for `/help <command>` — what you
// see and can click/type, never the data model or checks happening behind
// it. Deliberately hand-written (not derived from code) since the goal is
// a plain-language walkthrough, not a technical description.
const HELP_DETAILS = {
  'link-account': `Connects your lostark.bible account to the bot.\n\nRun it and click the **Authorize on lostark.bible** button, approve access on their site, then come back to Discord. Once linked, run \`/track-character\` to actually start tracking characters.`,
  'track-character': `Adds one or more of your characters to this server's tracking.\n\nPicks from a menu of your lostark.bible roster, then asks you to choose a view for the announcement post: **Compact** (difficulty/class/gear score/combat power only) or **Competitive** (adds full DPS/support stat breakdowns, and unlocks stat-based commands like \`/character-page\`, \`/my-stats\`, and \`/challenge\`).`,
  'untrack-character': `Stops tracking one or more of your own characters in this server, picked from a menu.`,
  'gold-earners': `Sets which of your characters count as your account's **Gold Earners** — mirrors the in-game rule that only 6 characters per roster can actually earn weekly gold. Pick up to 6 from a menu; this choice feeds every Est. Gold number shown elsewhere (\`/my-stats\`, \`/character-page\`, \`/bonk\`, \`/challenge\`).`,
  'announce-channel': `**Admin only.** Sets the channel where new raid clears and \`/challenge\` announcements get posted for this server. Run it with a channel picked in the \`channel\` option.`,
  challenge: `Gives you a personalized raid-gate challenge for one of your Gold Earner characters — a DPS target or a support contribution/buff target, based on that character's own recent average. Pick a character from the menu, then **Accept** it or **Reroll** for a different gate.\n\nOnce accepted, it's posted publicly in this server's announcement channel with **Success**/**Failure** buttons — anyone else (not you) can bet on whether you'll pull it off, and can change their bet any time before it resolves. When the raid gate is actually cleared (or the week runs out first), the result posts publicly too.`,
  'challenge-history': `Shows someone's \`/challenge\` history in this server — every currently active challenge, plus their recent completed/failed ones. Defaults to you; pass the \`user\` option to look up anyone else.`,
  'my-stats': `Your combined stats across every Competitive-view character you have in this server: total gates cleared, estimated gold, deaths, guess-parse win rate, raid/challenge badges, and prediction accuracy from betting on others' challenges. Choose **Only me** or **Post to everyone** for who sees it.`,
  'character-page': `Clear stats for one specific character of yours: gates cleared, deaths, estimated gold split (character/roster/unbound), and average percentile badges. Pick the character from a menu, then choose **Only me** or **Post to everyone**.`,
  bonk: `Shows a user's raid clears since this week's reset, grouped by raid, with an estimated weekly gold total. Defaults to you; pass the \`user\` option to check anyone else.`,
  'bonk-hard': `Same as \`/bonk\`, but also calls out any of that user's characters still sitting at 0 clears this week.`,
  'recent-raids': `Lists the last 10 raid clears for one character tracked in this server. Pass the character's name in the \`character\` option.`,
  'registered-users': `Lists everyone currently tracking a character in this server, with Prev/Next buttons if the list is long.`,
  'guess-parse': `A minigame: guess which of 3 tracked characters a shown (partially hidden) raid clear belongs to. Optionally pick a \`difficulty\` — harder hides more info but is worth more points if you get it right.`,
  'guess-leaderboard': `Shows the top \`/guess-parse\` guessers in this server for the current week.`,
  'untrack-all': `**Admin only.** Stops tracking every character in this server, for every user — asks for confirmation first since it can't be undone.`,
  'leave-server': `**Admin only.** Untracks everything in this server, then makes the bot leave it entirely — asks for confirmation first since it can't be undone.`,
  nuke: `**Admin only.** Deletes every message in the current channel — asks for confirmation first since it can't be undone.`,
  'check-now': `**Admin/debug.** Forces an immediate check of every tracked character instead of waiting for the next scheduled one. No extra output beyond a confirmation; any new clears found post normally.`,
  help: `Shows this list. Pass the \`command\` option to get a more detailed usage explanation for any one command.`,
};

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List every command, or get detailed usage for one')
    .addStringOption((option) =>
      option
        .setName('command')
        .setDescription('Get detailed usage for this command')
        .addChoices(...ALL_COMMANDS.map((c) => ({ name: `/${c.name}`, value: c.name }))),
    ),

  async execute(interaction) {
    const commandName = interaction.options.getString('command');

    if (!commandName) {
      const lines = ALL_COMMANDS.map((c) => `**/${c.name}** — ${c.description}`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('📖 Command List')
        .setDescription(lines)
        .setColor(FALLBACK_COLOR)
        .setFooter({ text: 'Run /help command:<name> for a more detailed walkthrough of any one of these.' });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const found = ALL_COMMANDS.find((c) => c.name === commandName);
    const embed = new EmbedBuilder()
      .setTitle(`📖 /${commandName}`)
      .setDescription(HELP_DETAILS[commandName] ?? found?.description ?? "No details found for that command.")
      .setColor(FALLBACK_COLOR);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
