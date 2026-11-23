import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLogEntry } from '../src/lostarkbible/logEntry.js';
import { getRole } from '../src/notify/clearMessage.js';

test('ndps is aliased to udps (lostark.bible Nov 2026 rename)', () => {
  const entry = normalizeLogEntry({ dps: 10, ndps: 6, rdps: 9 });
  assert.equal(entry.udps, 6);
  assert.equal(entry.ndps, 6);
});

test('an existing udps is never overwritten', () => {
  assert.equal(normalizeLogEntry({ udps: 5, ndps: 7 }).udps, 5);
});

test('entries without either field pass through untouched', () => {
  const entry = { dps: 1 };
  assert.equal(normalizeLogEntry(entry), entry);
  assert.equal(normalizeLogEntry(null), null);
});

test('getRole: bdps means support, udps or ndps means dps, neither is unknown', () => {
  assert.equal(getRole({ bdps: 1, ndps: 1 }), 'support');
  assert.equal(getRole({ dps: 1, ndps: 1, rdps: 1 }), 'dps');
  assert.equal(getRole({ dps: 1, udps: 1 }), 'dps');
  assert.equal(getRole({ dps: 1 }), 'unknown');
});
