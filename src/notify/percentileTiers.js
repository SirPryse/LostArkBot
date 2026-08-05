/**
 * Standard parse-percentile tiers. Unicode has no pink circle emoji, so 99
 * uses a pink heart instead (breaks the circle shape, gets the color right).
 * Shared between the announcement embeds and /character-page's badge tally
 * so both always agree on the same boundaries.
 */
export const TIERS = [
  { key: 'gold', emoji: '👑', min: 100 },
  { key: 'pink', emoji: '🩷', min: 99 },
  { key: 'orange', emoji: '🟠', min: 95 },
  { key: 'purple', emoji: '🟣', min: 75 },
  { key: 'blue', emoji: '🔵', min: 50 },
  { key: 'green', emoji: '🟢', min: 25 },
  { key: 'grey', emoji: '⚪', min: 0 },
];

export function tierForFraction(fraction) {
  const p = fraction * 100;
  return TIERS.find((t) => p >= t.min) ?? TIERS[TIERS.length - 1];
}
