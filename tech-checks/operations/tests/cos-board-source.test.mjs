import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/cosBoard/boardApp.ts');

test('the board carries no fleet data and reads nothing itself', () => {
  // This repository is public. Unit names, customers, addresses and IPs reach the board from the signed-in feed only.
  const files = readdirSync(new URL('../src/cosBoard/', import.meta.url), {recursive: true}).map(name => String(name).replace(/\\/g, '/')).sort();
  assert.deepEqual(files, [
    'boardApp.ts', 'boardData.ts', 'boardEdit.ts', 'boardFonts.ts', 'boardMap.json', 'boardStyle.ts',
    'fonts', 'fonts/OFL.txt', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-tight-latin-wght-normal.woff2',
  ]);
  const map = JSON.parse(read('../src/cosBoard/boardMap.json'));
  // A plain base map of Texas and its projection numbers. No pins, units or sites.
  assert.deepEqual(Object.keys(map).sort(), ['N', 'W', 'counties', 'h', 'hl', 'hwy', 'kx', 'lakes', 'land', 'places', 'rivers', 'roads', 'states', 'urban', 'w']);
  for (const source of [app, read('../src/cosBoard/boardData.ts'), read('../src/cosBoard/boardEdit.ts'), read('../src/cosBoard/boardStyle.ts'), read('../src/cosBoard/boardFonts.ts')]) {
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|googleapis|gstatic|supabase\.co|execute_sql/i);
  }
});

test('the board is isolated from the rest of COS and sends nothing itself', () => {
  assert.match(app, /attachShadow\(\{mode:'closed'\}\)/);
  assert.doesNotMatch(app, /document\.getElementById|document\.querySelector|window\.claude|location\.hash/);
  // The board's own store is not here. A hand fix is handed to Fleet, which is the only place that sends.
  assert.match(app, /db:null/);
  assert.match(app, /await hooks\.onEdit\(v\.k, steps\)/);
  assert.doesNotMatch(app, /unit-camera-status|\bapi\.(?:get|post)\(|from '\.\.?\/api'/);
  const landing = read('../src/CosBoardLanding.tsx');
  assert.equal(landing.split("api.post('/api/unit-camera-status/edit', handFixRequest(unit, step, crypto.randomUUID()))").length - 1, 1);
  assert.equal(landing.split('api.post(').length - 1, 1);
  // The work log and the board's own tech check form would need that store, so they are off.
  assert.match(app, /function logBox\(\)\{ return null; \}/);
  assert.doesNotMatch(app, /drawTechForm|techCard|sendTech/);
  // Links open outside the app's own frame.
  const links = app.match(/h\("a",\{class:"lk",href:[^}]*\}/g) || [];
  assert.equal(links.length, 2);
  for (const link of links) assert.match(link, /target:"_blank",rel:"noopener noreferrer"/);
});

test('Fleet hands the board the same feed, clock and field map as its headline', () => {
  const fleet = read('../src/FleetDashboard.tsx');
  assert.ok(fleet.includes('fleetCountsFromCameraFeed(cameraUnits,recorderLinksFromHealth(cameras.data?.rows),snapshotNow,map||undefined,phoneTodos)'));
  assert.ok(fleet.includes('<PhoneFleetBoard feed={cameraUnits} recorderRows={cameras.data?.rows} now={snapshotNow} fieldMap={map||undefined} '));
  assert.ok(fleet.includes("{view==='map'&&<PhoneFleetBoard "));
  assert.ok(fleet.indexOf('<PhoneFleetBoard ') < fleet.indexOf('<ApprovedFleetViews compact>'));
  const landing = read('../src/CosBoardLanding.tsx');
  assert.match(landing, /const clock = cameraFeedClock\(feed, now\);\s+const census = cameraFeedCensus\(feed, recorderLinksFromHealth\(recorderRows\), clock, fieldMap\) \|\| \[\];\s+return boardData\(\{feed, census, now: clock, /);
  // With no feed there is nothing true to draw: Fleet shows as before.
  assert.match(read('../src/PhoneFleetBoard.tsx'), /export \{default\} from '\.\/FleetBoard';/);
  const board = read('../src/FleetBoard.tsx');
  assert.match(board, /if \(!feed\) return null;/);
  // A board that cannot be shown steps aside. It must never take the Fleet screen down with it.
  assert.match(board, /<ViewErrorBoundary fallback=\{\(\) => null\}>\s*<div className='cos-board-landing' /);
  // The older Fleet view is folded away only once the board is on screen, and only behind a button that brings it back.
  assert.match(board, /data-older-view=\{ready && !older \? 'closed' : 'open'\}/);
  assert.match(board, /\{ready && <button type='button' className='cos-board-older' aria-expanded=\{older\} onClick=\{toggle\}>/);
  const css = read('../src/sourceAttention.css');
  assert.ok(css.includes("#root#root .cos-fleet-dashboard:has(>.cos-board-landing[data-older-view='closed'])>.cos-fleet-content,"));
  assert.equal(css.split("data-older-view='closed'").length - 1, 2);
});
