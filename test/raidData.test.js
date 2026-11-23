import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAID_FAMILIES,
  ALL_KNOWN_BOSSES,
  getRaidFamilyForBoss,
  getFriendlyBossName,
  getBossNameForGateAtDifficulty,
} from '../src/notify/raidFamilies.js';
import { getGoldEstimate, splitGold } from '../src/notify/goldEstimate.js';
import { getMinIlvl } from '../src/notify/minIlvl.js';
import { getBossImagePath } from '../src/notify/bossImages.js';
import fs from 'node:fs';

test('every gate of every family has gold and min iLvl at every difficulty', () => {
  const missing = [];
  for (const family of RAID_FAMILIES) {
    for (const difficulty of family.difficulties) {
      family.gates.forEach((_, gateIndex) => {
        const boss = getBossNameForGateAtDifficulty(family, gateIndex, difficulty);
        if (!boss) return missing.push(`${family.key} gate ${gateIndex + 1} ${difficulty}: no boss name`);
        if (getGoldEstimate(boss, difficulty) === null) missing.push(`${boss} ${difficulty}: gold`);
        if (getMinIlvl(boss, difficulty) === null) missing.push(`${boss} ${difficulty}: min iLvl`);
      });
    }
  }
  assert.deepEqual(missing, []);
});

test('every known boss has an image file that exists', () => {
  for (const boss of ALL_KNOWN_BOSSES) {
    assert.ok(fs.existsSync(getBossImagePath(boss)), `${boss} image missing`);
  }
});

test('a boss name shared by two families is told apart by difficulty', () => {
  assert.equal(getRaidFamilyForBoss('Mordum, the Abyssal Punisher', 'Hard').family.key, 'mordum');
  assert.equal(getRaidFamilyForBoss('Mordum, the Abyssal Punisher', 'Extreme Hard').family.key, 'mordum-extreme');
  assert.equal(getRaidFamilyForBoss('Aegir, the Oppressor', 'Normal').family.key, 'aegir');
  assert.equal(getRaidFamilyForBoss('Aegir, the Oppressor', 'Extreme Nightmare').family.key, 'aegir-extreme');
  assert.equal(getRaidFamilyForBoss('Unknown Boss', 'Hard'), null);
});

test('Belgardin gates and friendly names', () => {
  assert.equal(getFriendlyBossName('Belgardin, Arbiter of Death', 'Hard'), 'Belgardin Gate 1');
  assert.equal(getFriendlyBossName('Phaetus An Kragma', 'Nightmare'), 'Belgardin Gate 2');
  assert.equal(getFriendlyBossName('Mordum, the Abyssal Punisher', 'Extreme Normal'), 'Mordum Extreme');
  assert.equal(getFriendlyBossName('Someone New', 'Hard'), 'Someone New');
});

test('gold split rules', () => {
  assert.deepEqual(splitGold('cathedral', 'Level 3', 50_000), { character: 50_000, roster: 0, unbound: 0 });
  assert.deepEqual(splitGold('mordum-extreme', null, 50_000), { character: 0, roster: 0, unbound: 50_000 });
  assert.deepEqual(splitGold('serca', 'Nightmare', 54_000), { character: 0, roster: 0, unbound: 54_000 });
  assert.deepEqual(splitGold('serca', 'Normal', 32_000), { character: 0, roster: 16_000, unbound: 16_000 });
  assert.deepEqual(splitGold('belgardin', 'Hard', 62_000), { character: 0, roster: 31_000, unbound: 31_000 });
});
