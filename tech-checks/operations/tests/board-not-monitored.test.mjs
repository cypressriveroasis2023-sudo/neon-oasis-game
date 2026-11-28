import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 28 Nov 2026, James: Wall-E goes with a Recon and is just equipment; Spotter 052 and 088 are
// witnesses, watched but not monitored. They count in the field at their mHelp site and on the
// map, but are never Unknown.
const src = readFileSync(new URL('../src/cosBoard/boardApp.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/cosBoard/boardStyle.ts', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); assert.ok(m, String(re)); return m[0]; };

test('only Wall-E and the two named witness Spotters are not monitored', () => {
  const body = pick(/const WITNESS_PIDS = [^\n]+\nconst notMonitored = [^\n]+/);
  const {notMonitored, WITNESS_PIDS} = new Function(body.replace(/^const /gm, 'var ') + '\nreturn {notMonitored, WITNESS_PIDS};')();
  assert.deepEqual(WITNESS_PIDS, {'1713914': 'Spotter 052', '2036036': 'Spotter 088'});
  assert.equal(notMonitored({cat: 'Wall-E', id: '1713609'}), true);
  assert.equal(notMonitored({cat: 'Wall-E', id: '2144841'}), true);
  assert.equal(notMonitored({cat: 'Spotter', id: '1713914'}), true);
  assert.equal(notMonitored({cat: 'Spotter', id: 2036036}), true);
  for (const r of [{cat: 'Spotter', id: '2264694'}, {cat: 'Sniper ES', id: '1832148'}, {cat: 'Recon II', id: '2034052'}, {cat: 'Spotter', id: 'toString'}]) assert.equal(notMonitored(r), false, JSON.stringify(r));
});

test('a not-monitored unit is its own state: field, on the map, never Unknown', () => {
  assert.match(src, /nm:"Not monitored"/);
  assert.match(src, /status: nm \? "nm" : place==="field" \? "unknown" : "shop"/);
  assert.match(src, /const nm = place==="field" && notMonitored\(r\)|nm = place==="field" && notMonitored\(r\)/);
  // The four camera counts and the TV list never include it.
  assert.match(src, /function countNow\(\)\{ const c=\{down:0,issues:0,unknown:0,up:0\};/);
  // It stays on the map with its own colour, and out of the punch list's "Field, no camera feed".
  assert.match(src, /nm:"var\(--nm\)"/);
  assert.match(src, /if\(r\.place==="field" && notMonitored\(r\)\) return;/);
  assert.match(css, /\.s-nm\{--c:var\(--nm\)\}/);
});
