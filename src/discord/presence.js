import { ActivityType } from 'discord.js';
import { getNextPollTimes } from '../scheduler/poller.js';

// Discord doesn't support a "live" countdown widget — a bot's status is
// just static text until something rewrites it. Redrawn once a minute —
// plenty often for whole-minute precision, and nowhere near Discord's
// presence-update rate limit (roughly 5 updates per 20s per gateway
// connection).
const UPDATE_INTERVAL_MS = 60 * 1000;

/** `275000` -> `"4 minutes"`, `35000` -> `"under a minute"`. Floors rather
 * than rounds so it never claims a tier is due sooner than it actually is.
 * `null`/already-past both read as "now" — the tick fires on the interval
 * regardless of when this last redrew, so a slightly-stale "now" is
 * harmless (worst case the real fire happens a few seconds after the
 * status stops counting down). */
function formatMinutesRemaining(targetMs) {
  if (targetMs === null) return 'soon';
  const remainingMs = targetMs - Date.now();
  if (remainingMs <= 0) return 'now';
  const minutes = Math.floor(remainingMs / 60000);
  if (minutes < 1) return 'under a minute';
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function buildStatusText() {
  const { nextGoldEarnerPollAt, nextOtherPollAt } = getNextPollTimes();
  return (
    `Next gold roster polling in ${formatMinutesRemaining(nextGoldEarnerPollAt)}. ` +
    `Next alt roster polling in ${formatMinutesRemaining(nextOtherPollAt)}.`
  );
}

/** Starts redrawing the bot's Watching-status with a live countdown to
 * each polling tier's next tick — e.g. "Watching Next gold roster polling
 * in 4 minutes. Next alt roster polling in 41 minutes." Purely cosmetic
 * (setActivity failures are logged, never thrown) since losing the status
 * shouldn't take the bot down. */
export function startPresenceUpdates(discordClient) {
  const update = () => {
    try {
      discordClient.user.setActivity(buildStatusText(), { type: ActivityType.Watching });
    } catch (err) {
      console.error('Failed to update bot presence:', err);
    }
  };

  update(); // don't wait a full interval for the first real value to show
  setInterval(update, UPDATE_INTERVAL_MS);
}
