import { getClassEmoji } from './classIcons.js';

// Small presentation helpers shared across commands, the poller and the
// clear announcements. Previously each file kept its own copy; they had
// already started to drift (two different formatDuration shapes), so they
// live here now. No config/DB imports — safe to use from tests.

/** Support buff-uptime slot labels, in the order lostark.bible's `buffs`
 * array reports them. Challenge targets index into this same order. */
export const BUFF_LABELS = ['AP Buff', 'Brand', 'Identity', 'T'];

/** `<:name:id>` — the inline-text form of a class's custom emoji (distinct
 * from the `{ id, name }` object `.setEmoji()` wants on a component), or ''
 * when the class has no emoji. */
export function emojiTag(classNameOrIconKey) {
  const emoji = getClassEmoji(classNameOrIconKey);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

/** `366000` -> `"6m 6s"`. */
export function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
