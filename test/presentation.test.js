import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/web/server.js';
import { fitFields, buildCharacterField } from '../src/discord/commands/rosterProgress.js';
import { buildNotice } from '../src/notify/reauthNotice.js';

test('escapeHtml neutralizes markup from the callback URL', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("a & 'b'"), 'a &amp; &#39;b&#39;');
});

test('fitFields stays within 25 fields and keeps reserved fields last', () => {
  const cleared = new Map([['belgardin', new Set([0, 1])], ['serca', new Set([0])]]);
  const fields = Array.from({ length: 40 }, (_, i) => buildCharacterField(`Char${i}`, null, 1770, cleared));
  const reserved = [{ name: 'No Clears This Week (2)', value: 'a, b' }];
  const out = fitFields(fields, reserved);
  assert.equal(out.length, 25);
  assert.equal(out.at(-1).name, 'No Clears This Week (2)');
  assert.match(out.at(-2).name, /^…and \d+ more$/);
  assert.ok(out.reduce((n, f) => n + f.name.length + f.value.length, 0) <= 6000);
  assert.equal(fitFields(fields.slice(0, 3)).length, 3);
});

test('re-link notice mentions everyone listed and splits expired from expiring', () => {
  const notice = buildNotice([
    { discord_user_id: '111', token_expires_at: '2026-11-01T00:00:00Z', expired: true, character_count: 12 },
    { discord_user_id: '222', token_expires_at: '2026-11-26T00:00:00Z', expired: false, character_count: 1 },
  ]);
  assert.equal(notice.content, '<@111> <@222>');
  assert.deepEqual(notice.allowedMentions, { users: ['111', '222'] });
  const description = notice.embeds[0].data.description;
  assert.match(description, /Expired — not being tracked\*\*\n<@111> — 12 characters/);
  assert.match(description, /Expiring soon\*\*\n<@222> — 1 character,/);
});
