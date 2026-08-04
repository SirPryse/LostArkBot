import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { getBossImagePath } from './bossImages.js';

const SUPPORT_COLOR = 0x57f287; // Discord green
const DPS_COLOR = 0xed4245; // Discord red
const FALLBACK_COLOR = 0x5865f2; // Discord blurple

const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/** 2-decimal float, with M/B suffix for large stats (damage-scale numbers). */
function formatStat(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(2);
}

/** Fractions (0-1) as a percentage, e.g. 0.0503 -> "5.03%". */
function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  return `${(fraction * 100).toFixed(2)}%`;
}

/**
 * Colored circle emoji per percentile tier — renders identically across
 * every client/theme, unlike Discord's ansi code-block colors (whose
 * background palette doesn't have true green/gold options and can be
 * unreadable depending on the viewer's theme).
 */
function percentileTierEmoji(fraction) {
  const p = fraction * 100;
  if (p >= 100) return '⭐';
  if (p >= 95) return '🔴';
  if (p >= 90) return '🟡';
  if (p >= 70) return '🟣';
  if (p >= 40) return '🔵';
  if (p >= 10) return '🟢';
  return '⚪';
}

/** Percentile fields get a tier dot; plain contribution fractions (not a
 * ranking against other parses) don't. */
function formatPercentile(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  return `${percentileTierEmoji(fraction)} ${formatPercent(fraction)}`;
}

function getRole(logEntry) {
  if ('bdps' in logEntry) return 'support';
  if ('udps' in logEntry) return 'dps';
  return 'unknown';
}

/** Joins labeled stat pairs onto one horizontal row, same "coupling" style
 * used for the buff line below. */
function coupledField(name, parts) {
  return { name, value: parts.map(([label, value]) => `**${label}**: ${value}`).join('  |  '), inline: false };
}

function buildBuffFields(buffs) {
  if (!Array.isArray(buffs) || buffs.length === 0) return [];
  return [coupledField('Buff Uptimes', buffs.map((value, i) => [BUFF_LABELS[i] ?? `Buff ${i + 1}`, formatPercent(value)]))];
}

function buildStatFields(logEntry, role) {
  if (role === 'support') {
    return [
      coupledField('Contribution', [
        ['rDPS', formatStat(logEntry.rdps)],
        ['Raid Contribution', formatPercent(logEntry.rContribution)],
      ]),
      coupledField('Percentile', [
        ['Uptime', formatPercentile(logEntry.percentile)],
        ['Contribution', formatPercentile(logEntry.contributionPercentile)],
      ]),
      ...buildBuffFields(logEntry.buffs),
    ];
  }

  if (role === 'dps') {
    return [
      coupledField('Damage', [
        ['DPS', formatStat(logEntry.dps)],
        ['UDPS', formatStat(logEntry.udps)],
      ]),
      { name: 'Percentile', value: formatPercentile(logEntry.overallPercentile), inline: true },
    ];
  }

  return [{ name: 'DPS', value: formatStat(logEntry.dps), inline: true }];
}

/**
 * `compact` (the default for a newly tracked character) shows just
 * Difficulty/Class/Gear Score/Combat Power — already the embed description
 * — plus Duration and the log link. `competitive` adds the full DPS/support
 * stat breakdown on top of that.
 */
export function buildClearMessage(logEntry, viewMode = 'competitive') {
  const role = getRole(logEntry);
  const color = role === 'support' ? SUPPORT_COLOR : role === 'dps' ? DPS_COLOR : FALLBACK_COLOR;

  const fields = [
    ...(viewMode === 'competitive' ? buildStatFields(logEntry, role) : []),
    { name: 'Duration', value: formatDuration(logEntry.duration), inline: true },
    { name: 'Log', value: `https://lostark.bible/logs/${logEntry.id}`, inline: false },
  ];

  const attachment = new AttachmentBuilder(getBossImagePath(logEntry.boss), { name: 'boss.png' });

  const embed = new EmbedBuilder()
    .setTitle(`${logEntry.name} cleared ${logEntry.boss}`)
    .setDescription(
      `Difficulty: **${logEntry.difficulty}**\nClass: **${logEntry.class} (${logEntry.spec})**\nGear Score: **${formatStat(logEntry.gearScore)}**\nCombat Power: **${formatStat(logEntry.combatPower)}**`,
    )
    .addFields(fields)
    .setThumbnail('attachment://boss.png')
    .setTimestamp(new Date(logEntry.timestamp))
    .setColor(color);

  return { embeds: [embed], files: [attachment] };
}
