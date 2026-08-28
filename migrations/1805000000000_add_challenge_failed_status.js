export const shorthands = undefined;

/**
 * Adds 'failed' as a valid challenges.status — two distinct fail triggers,
 * both handled in src/scheduler/poller.js:
 *   1. A matching clear that falls short of its gate's target (UDPS, or
 *      contribution/any assigned buff for support) fails the *whole*
 *      challenge immediately, not just that gate — no more "keep trying
 *      until it works," a challenge now has real stakes.
 *   2. Not fully completed within 1 week of being accepted (`created_at`)
 *      auto-expires as failed, checked lazily the next time
 *      getActiveChallengeForCharacter() is called for that character
 *      (poller.js runs every 10 min, so this fires within ~10 min of the
 *      deadline rather than needing a dedicated scheduler).
 */
export async function up(pgm) {
  pgm.dropConstraint('challenges', 'challenges_status_check');
  pgm.addConstraint('challenges', 'challenges_status_check', {
    check: "status in ('active', 'completed', 'abandoned', 'failed')",
  });
}

export async function down(pgm) {
  pgm.dropConstraint('challenges', 'challenges_status_check');
  pgm.addConstraint('challenges', 'challenges_status_check', {
    check: "status in ('active', 'completed', 'abandoned')",
  });
}
