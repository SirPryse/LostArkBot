/** Promise-based delay — shared by every rate-limit-pacing loop in this
 * codebase (poller, bonk/bonk-hard, guess-parse's answer search, the
 * lostark.bible retry-with-backoff layer, /clear-channel's individual
 * deletes). Was defined identically in each of those files; consolidated
 * here so there's one copy to change if the pattern ever needs to. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
