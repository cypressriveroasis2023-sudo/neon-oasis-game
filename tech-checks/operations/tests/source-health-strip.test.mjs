import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHealth} from '../src/sourceAttention.ts';
import {sourceStripText} from '../src/SourceHealthStrip.tsx';

const NOW = Date.parse('2026-11-16T22:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('the strip shows the last good time and leaves an unread source off the outage list', () => {
  const rows = sourceHealth({now: NOW, tracker: {verifiedAt: ago(5 * 60 * 1000)}});
  const tracker = rows.find(row => row.id === 'tracker');
  const star = rows.find(row => row.id === 'star4live');
  assert.match(sourceStripText(tracker, NOW), /Tracker sheet Current/);
  assert.match(sourceStripText(star, NOW), /Star4Live Not on this view/);
  assert.doesNotMatch(sourceStripText(star, NOW), /offline|outage/i);
});
