// Shared between /my-stats and /character-page so both always agree on the
// same thresholds/tone — originally lived only in myStats.js, moved here
// once character-page needed the identical tiered treatment rather than its
// old plain "Died in N raids" line.

// Uploaded to the bot's own application emoji repository (see
// classIcons.js for the rest of that repository) rather than pulled from
// any one server — confirmed live that a guild emoji tag silently degrades
// to plain `:name:` text when the bot isn't a member of that emoji's home
// server, but application emoji have no such dependency; they work in any
// server the bot is in. Reserved for the *top* death tier (see
// deathTierEmoji below) rather than used as a flat icon for every death
// count — earns its place instead of being the default.
const CLOWNSKULL_EMOJI = '<:clownskull:1542205122103222342>';

// The icon itself escalates with the tier, not just the text next to it —
// starts at a plain/normal skull (everyone dies sometimes) and upgrades
// through progressively more dramatic ones, with the custom clownskull
// held back as the top tier's payoff rather than spent on every count.
export function deathTierEmoji(count) {
  if (count === 0) return '🏆';
  if (count <= 5) return '💀';
  if (count <= 15) return '☠️';
  return CLOWNSKULL_EMOJI;
}

// Purely cosmetic tiered commentary — thresholds are loose, tone is
// teasing, not literal judgment. Every one of these is a short flavor
// string next to a real number, never a replacement for it.
export function deathFlavor(count) {
  if (count === 0) return 'Untouchable 😎';
  if (count <= 5) return 'Had a rough week';
  if (count <= 15) return 'Certified feeder';
  return 'The floor is a second home';
}
