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
  // Fleet and Camera Health are the two ways into this screen, and both open on the board.
  assert.ok(fleet.includes("{(view==='map'||view==='fleet')&&<PhoneFleetBoard "));
  assert.ok(fleet.indexOf('<PhoneFleetBoard ') < fleet.indexOf('<ApprovedFleetViews compact>'));
  const landing = read('../src/CosBoardLanding.tsx');
  assert.match(landing, /if \(!feed\) return null;\s+const clock = cameraFeedClock\(feed, now\);\s+const census = cameraFeedCensus\(feed, recorderLinksFromHealth\(recorderRows\), clock, fieldMap\) \|\| \[\];\s+return boardData\(\{feed, census, now: clock, /);
  // Nothing is drawn from a feed that is not there.
  assert.match(landing, /useEffect\(\(\) => \{ if \(data\) board\.current\?\.update\(data\); \}, \[data\]\);/);
  assert.match(read('../src/PhoneFleetBoard.tsx'), /export \{default\} from '\.\/FleetBoard';/);
});

test('the board is the Fleet screen, and the older screen only stands in when there is no board', () => {
  const fleet = read('../src/FleetDashboard.tsx');
  const board = read('../src/FleetBoard.tsx');
  const css = read('../src/sourceAttention.css');
  // Fleet hands the board what it needs and one thing more: why a unit asked for from another screen could not be opened.
  assert.ok(fleet.includes(' onFeed={setCameraUnits} notice={selectionNotice}/>}'));
  assert.match(board, /\{notice && <p className='cos-board-notice' role='status'>\{notice\}<\/p>\}\s*<Suspense /);
  assert.ok(css.includes("#root#root .cos-fleet-dashboard:has(>.cos-board-landing>.cos-board-notice)>.cos-fleet-content>p.cos-fleet-message[role='status']{display:none}"));
  // While the board is on screen the older view, its jump button and its row of tabs are all out of sight. One rule each, nothing else.
  const on = "#root#root .cos-fleet-dashboard:has(>.cos-board-landing[data-board='on']):not(:has(>.cos-fleet-drawer[hidden]))>";
  assert.ok(css.includes(on + '.cos-fleet-content,\n' + on + '.cos-fleet-map-jump,\n' + on + 'nav.cos-fleet-tabs{display:none}'));
  // There is no button anywhere that brings the older screen back.
  assert.doesNotMatch(board, /older Fleet view|cos-board-older|aria-expanded|matchMedia/);
  assert.doesNotMatch(css, /cos-board-older|data-older-view/);
  assert.equal((board.match(/<button /g) || []).length, 1);
  assert.match(board, /The board could not be loaded, so this is the older Fleet screen\. <button type='button' onClick=\{\(\) => \{ setFailed\(false\); setKnown\(true\); \}\}>Try again<\/button>/);
  // The one exception: a spot being picked on the older map. The board steps aside until that is done.
  assert.ok(css.includes('#root#root .cos-fleet-dashboard:has(>.cos-fleet-drawer[hidden])>.cos-board-landing{display:none}'));
  assert.ok(fleet.includes('<div hidden={Boolean(locationPicker)} ref={dialog} onFocusCapture='));
  assert.ok(fleet.includes("+' unit intelligence'} className='cos-fleet-drawer'>"));
  // The board is on once it is on screen, or from the first moment on a device that has shown it before.
  assert.match(board, /<div className='cos-board-landing' data-board=\{ready \|\| known \? 'on' : 'off'\}>/);
  assert.match(board, /const \[ready, setReady\] = useState\(false\), \[known, setKnown\] = useState\(recall\), \[failed, setFailed\] = useState\(false\);/);
  assert.match(board, /useEffect\(\(\) => \{ if \(feed && ready\) \{ remember\(true\); setFailed\(false\); \} \}, \[feed, ready\]\);/);
  // With no feed and no reason to expect one there is nothing true to draw: Fleet shows as before.
  assert.match(board, /if \(!feed && !known\) \{/);
  assert.match(board, /<\/p>\s*<\/div> : null;/);
  // A known device does not wait for ever. If the feed cannot be read, or does not come, the older screen stands in and the device is forgotten.
  assert.match(board, /const giveUp = \(\) => \{ remember\(false\); setFailed\(known\); setKnown\(false\); \};/);
  assert.match(board, /const waiting = known && !\(feed && ready\);/);
  assert.match(board, /const timer = window\.setTimeout\(giveUp, WAIT_MS\);/);
  assert.match(board, /onNone=\{giveUp\}/);
  assert.match(landing_none(), /if \(!held\.current\) none\.current\?\.\(\);/);
  // A board that cannot be shown steps aside. It must never take the Fleet screen down with it.
  assert.match(board, /<ViewErrorBoundary fallback=\{\(\) => <Forget\/>\}>\s*<div className='cos-board-landing' /);
  // A device can have the board switched off. Nothing in COS offers that switch.
  assert.match(board, /const \[off\] = useState\(switchedOff\);\s+return off \? null : <Board \{\.\.\.props\}\/>;/);
  assert.equal(board.split("'cos.fleetBoard.off'").length - 1, 1);
});

function landing_none() { return read('../src/CosBoardLanding.tsx'); }

test('the map is held in its box, and the message clears the bottom bar', () => {
  // Every repaint goes through the hold first, so no drag, zoom or resize can leave the drawing part-way out of its box.
  assert.match(app, /function paint\(\)\{ hold\(\); cancelAnimationFrame\(M\.raf\); M\.raf=requestAnimationFrame\(paintNow\); \}/);
  assert.equal(app.split('requestAnimationFrame(paintNow)').length - 1, 1);
  assert.match(app, /M\.tx = cw<=M\.w \? \(M\.w-cw\)\/2-x0\*M\.z : Math\.min\(-x0\*M\.z, Math\.max\(M\.w-x1\*M\.z, M\.tx\)\);/);
  assert.match(app, /M\.ty = ch<=M\.h \? \(M\.h-ch\)\/2-y0\*M\.z : Math\.min\(-y0\*M\.z, Math\.max\(M\.h-y1\*M\.z, M\.ty\)\);/);
  // Pins beyond the drawn map still count as part of it, so no unit is ever out of reach.
  assert.match(app, /for\(const q of M\.pts\)\{ x0=Math\.min\(x0,q\.x-8\); y0=Math\.min\(y0,q\.y-8\); x1=Math\.max\(x1,q\.x\+8\); y1=Math\.max\(y1,q\.y\+8\); \}/);
  // When the whole drawing fits top to bottom, an up-or-down swipe is left to the page.
  assert.match(app, /\$\("mapSvg"\)\.style\.touchAction = ch>M\.h\+\.5 \? "none" : "pan-y";/);
  const style = read('../src/cosBoard/boardStyle.ts');
  assert.ok(style.includes('.toast{bottom:calc(16px + var(--cos-board-clear,0px))}'));
  const landing = read('../src/CosBoardLanding.tsx');
  assert.match(landing, /element\.style\.setProperty\('--cos-board-clear', /);
  assert.match(landing, /document\.querySelector\('\.operations-bottom-nav'\)/);
  // A reading that is the same one is not called new.
  assert.match(app, /at===S\.before \? "No newer Star4Live reading yet\. Last read "\+when\(at\)\+"\." : "New reading: Star4Live "\+when\(at\)\+"\."/);
  assert.match(app, /S\.before = S\.meta \? S\.meta\.v : null;/);
});
