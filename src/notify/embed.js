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
 * Colored circle emoji per percentile tier (standard parse-percentile
 * ranges: grey/green/blue/purple/orange/pink/gold) — renders identically
 * across every client/theme, unlike Discord's ansi code-block colors (whose
 * background palette doesn't have true green/gold options and can be
 * unreadable depending on the viewer's theme). Unicode has no pink circle
 * emoji, so the 99 tier uses a pink heart instead (breaks the circle shape,
 * but gets the actual color right).
 */
function percentileTierEmoji(fraction) {
  const p = fraction * 100;
  if (p >= 100) return '⭐'; // 100
  if (p >= 99) return '🩷'; // 99 (pink)
  if (p >= 95) return '🟠'; // 98-95
  if (p >= 75) return '🟣'; // 94-75
  if (p >= 50) return '🔵'; // 74-50
  if (p >= 25) return '🟢'; // 49-25
  return '⚪'; // 24-0
}

/** Percentile fields get a tier dot and are framed as "Top X%" — a 0.95
 * percentile means you're better than 95% of parses, i.e. top 5%. Plain
 * contribution fractions (not a ranking against other parses) use
 * formatPercent instead. */
function formatPercentile(fraction) {
  if (fraction === null || fraction === undefined) return 'N/A';
  const topPercent = (100 - fraction * 100).toFixed(2);
  return `${percentileTierEmoji(fraction)} Top ${topPercent}%`;
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
      { name: 'Percentile', value: formatPercentile(logEntry.percentile), inline: true },
    ];
  }

  return [{ name: 'DPS', value: formatStat(logEntry.dps), inline: true }];
}

/**
 * `compact` (the default for a newly tracked character) shows just
 * Difficulty/Class/Gear Score/Combat Power — already the embed description
 * — plus Duration. `competitive` adds the full DPS/support stat breakdown
 * and the lostark.bible log link on top of that.
 */
export function buildClearMessage(logEntry, viewMode = 'competitive') {
  const role = getRole(logEntry);
  const color = role === 'support' ? SUPPORT_COLOR : role === 'dps' ? DPS_COLOR : FALLBACK_COLOR;
  const isCompetitive = viewMode === 'competitive';

  const fields = [
    ...(isCompetitive ? buildStatFields(logEntry, role) : []),
    { name: 'Duration', value: formatDuration(logEntry.duration), inline: true },
    ...(isCompetitive
      ? [{ name: 'Log', value: `https://lostark.bible/logs/${logEntry.id}`, inline: false }]
      : []),
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
