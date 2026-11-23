import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBacklog, computeFirstTickDelay } from '../src/scheduler/poller.js';
import { isMissedReset } from '../src/scheduler/weeklyReset.js';
import { retryAfterMs } from '../src/lostarkbible/http.js';

const HOUR = 60 * 60 * 1000;

test('splitBacklog: clears older than 6h are backlog, newer are fresh', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const entries = [{ id: 'a', timestamp: now - HOUR }, { id: 'b', timestamp: now - 7 * HOUR }];
  const { fresh, backlog } = splitBacklog(entries, now);
  assert.deepEqual(fresh.map((e) => e.id), ['a']);
  assert.deepEqual(backlog.map((e) => e.id), ['b']);
});

test('first poll after startup: overdue tiers run soon, recently-checked ones wait', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  const interval = 60 * 60 * 1000;
  // checked 2h ago → overdue → 30s startup delay
  assert.equal(computeFirstTickDelay([new Date(now - 2 * HOUR)], interval, now), 30_000);
  // checked 10 min ago → due in 50 min
  assert.equal(computeFirstTickDelay([new Date(now - 10 * 60 * 1000)], interval, now), 50 * 60 * 1000);
  // never checked → overdue
  assert.equal(computeFirstTickDelay([null], interval, now), 30_000);
  // no characters → just the interval
  assert.equal(computeFirstTickDelay([], interval, now), interval);
});

test('missed weekly reset is caught up only within a day, never for a new guild', () => {
  const wednesdayReset = Date.parse('2026-11-25T10:00:00Z');
  const lastWeek = new Date('2026-11-18T10:00:05Z');
  assert.equal(isMissedReset(lastWeek, new Date(wednesdayReset + HOUR)), true);
  assert.equal(isMissedReset(lastWeek, new Date(wednesdayReset + 30 * HOUR)), false);
  assert.equal(isMissedReset(new Date('2026-11-25T10:00:03Z'), new Date(wednesdayReset + HOUR)), false);
  assert.equal(isMissedReset(null, new Date(wednesdayReset + HOUR)), false);
});

test('Retry-After: seconds, HTTP dates, garbage and caps', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  assert.equal(retryAfterMs('3', 0, now), 3000);
  assert.equal(retryAfterMs(new Date(now + 5000).toUTCString(), 0, now), 5000);
  assert.equal(retryAfterMs('soon', 2, now), 4000); // falls back to 2^attempt s
  assert.equal(retryAfterMs(null, 1, now), 2000);
  assert.equal(retryAfterMs('9999', 0, now), 60_000); // capped
});
