import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEstimatedGoldSplit } from '../src/db/clearHistory.js';

const WEEK1 = '2026-11-12T12:00:00Z'; // week starting Wed Nov 11
const WEEK2 = '2026-11-19T12:00:00Z'; // week starting Wed Nov 18
const earner = new Set(['Main|CE']);
const row = (familyKey, gold, createdAt, difficulty = 'Hard', name = 'Main') => ({
  character_name: name,
  region: 'CE',
  raid_family_key: familyKey,
  estimated_gold: gold,
  raid_difficulty: difficulty,
  created_at: createdAt,
});

test('only the 3 best-paying families count per character per week', () => {
  const rows = [
    row('belgardin', 62_000, WEEK1),
    row('serca', 44_000, WEEK1),
    row('kazeros', 48_000, WEEK1),
    row('armoche', 38_000, WEEK1), // 4th family — dropped
  ];
  assert.equal(computeEstimatedGoldSplit(rows, earner).total, 62_000 + 48_000 + 44_000);
});

test('the cap applies per week, so clears in different weeks all count', () => {
  const rows = [
    row('belgardin', 62_000, WEEK1),
    row('serca', 44_000, WEEK1),
    row('kazeros', 48_000, WEEK1),
    row('armoche', 38_000, WEEK2),
  ];
  assert.equal(computeEstimatedGoldSplit(rows, earner).total, 62_000 + 48_000 + 44_000 + 38_000);
});

test('Extreme raids always count, even for non-earners and beyond the cap', () => {
  const rows = [row('mordum-extreme', 50_000, WEEK1, 'Extreme Hard', 'Alt')];
  assert.equal(computeEstimatedGoldSplit(rows, earner).total, 50_000);
});

test("non-earners' regular clears don't count", () => {
  assert.equal(computeEstimatedGoldSplit([row('belgardin', 62_000, WEEK1, 'Hard', 'Alt')], earner).total, 0);
});
