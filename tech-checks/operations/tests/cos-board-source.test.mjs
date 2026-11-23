import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/cosBoard/boardApp.ts');
const style = read('../src/cosBoard/boardStyle.ts');

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
  const links = app.match(/h\("a",\{class:"(?:lk|mgshot)[^}]*\}/g) || [];
  // Two on a unit's page, and on the manager view a handoff's signed report and each of its photos.
  assert.equal(links.length, 4);
  for (const link of links) assert.match(link, /href:[^,}]+,target:"_blank",rel:"noopener noreferrer"/);
});

test('on a desk the board is one screen, with one map that keeps the drawing\'s shape', () => {
  const css = read('../src/sourceAttention.css');
  // No frame and no page title round the board on a desk. The older panel for picking a spot on the older map is still let through.
  assert.match(css, /@media\(min-width:701px\)\{\n #root#root \.operations-shell>main:has\(>\.cos-fleet-dashboard>\.cos-board-landing\[data-board='on'\]\):not\(:has\(>\.cos-fleet-dashboard>\.cos-fleet-drawer\[hidden\]\)\)\{padding:0!important\}/);
  assert.match(css, /:not\(:has\(>\.cos-fleet-dashboard>\.cos-fleet-drawer\[hidden\]\)\)>\.company-utility-bar\{display:none\}/);
  // The board's own width decides, read again whenever it changes.
  assert.match(app, /const across = \$\("cosb"\)\.getBoundingClientRect\(\)\.width, on = across >= 880;/);
  assert.match(app, /\$\("cosb"\)\.classList\.toggle\("roomy", across >= 1200\);/);
  assert.match(app, /new ResizeObserver\(\(\)=>\{ measureWide\(\);/);
  assert.match(app, /cleanups\.push\(\(\)=>seen\.disconnect\(\)\);/);
  // One map. Beside the list on a wide Board tab, otherwise on its own tab; beside the list the count tiles choose what it shows.
  assert.match(app, /const side = W\.wide && S\.view==="board", block=\$\("mapBlock"\), home = side \? \$\("boardSide"\) : \$\("viewMap"\);/);
  assert.equal(app.split('id=\\"mapSvg\\"').length - 1, 1);
  assert.match(app, /function sideFilter\(\)\{ if\(!W\.side\) return; const f=\["down","issues","unknown","up"\]\.includes\(S\.filter\) \? S\.filter : "all";/);
  assert.match(app, /if\(!side\) M\.f="all";/);
  // One screen: the board is as tall as the window, the tabs sit in its top bar, and each tab scrolls inside it.
  assert.match(style, /\.cosb\.wide:not\(\.tv\)\{height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden\}/);
  assert.match(style, /\.cosb\.wide>main>section\{flex:1;min-height:0;overflow-y:auto;/);
  assert.match(app, /if\(W\.wide\)\{ if\(tabs\.parentNode!==bar\) bar\.insertBefore\(tabs, bar\.querySelector\("\.logo"\)\.nextSibling\); \}\n  else if\(tabs\.parentNode!==main\) main\.insertBefore\(tabs, main\.firstChild\);/);
  // The counts are one row, then the list, which scrolls on its own, and the map beside it.
  assert.match(style, /\.cosb\.wide #viewBoard\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;grid-template-rows:auto auto minmax\(0,1fr\);grid-template-areas:\\"kpi kpi\\" \\"mode mode\\" \\"list map\\";/);
  assert.match(style, /\.cosb\.wide #kpi\{grid-area:kpi;display:grid;grid-template-columns:repeat\(4,minmax\(0,1\.3fr\)\);grid-auto-flow:column;grid-auto-columns:minmax\(0,1fr\);/);
  assert.match(style, /\.cosb\.wide #boardList\{grid-area:list;min-width:0;min-height:0;overflow-y:auto;/);
  // The map is as tall as its pane and keeps the drawing's own shape, so the whole of it is on screen. The list keeps room of its own.
  assert.match(style, /\.cosb\.wide \.mapwrap\{aspect-ratio:auto;min-height:0;max-height:none;min-width:0;height:var\(--mh,480px\);width:calc\(var\(--mh,480px\) \* 0\.9841\)\}/);
  assert.match(app, /const size = Math\.floor\(Math\.max\(240, Math\.min\(tall, room \/ 0\.9841\)\)\);/);
  assert.match(app, /room = across - 56 - 18 - \(W\.side \? 480 : 380\);/);
  // A unit opens at the side. The page is never made a positioning box, so the panel and the message stay fixed to the window.
  assert.match(style, /\.cosb\.wide \.panel\{margin:0 0 0 auto;width:min\(620px,48%\);/);
  assert.doesNotMatch(style, /container-type|contain:/);
});

test('the TV board is the board itself drawn large, switched on and off, with no count of its own', () => {
  // One tally, drawn two ways: the TV takes the views and the counts the board has just worked out.
  assert.match(app, /for\(const v of vs\) c\[v\.status\]\+\+;\n  if\(TV\.on\)\{ drawTv\(vs, c\); return; \}/);
  assert.match(app, /const tile=\(key,cls\)=>h\("div",\{class:"tile "\+cls\+\(c\[key\]\?"":" zero"\)\},h\("span",\{class:"num",text:c\[key\]\}\),h\("span",\{class:"lab",text:LABEL\[key\]\}\)\);/);
  // It lists what needs someone: down first, then camera issues. Never a unit in the shop, never an unknown one as down.
  assert.match(app, /TV\.rows=\[\.\.\.vs\.filter\(v=>v\.status==="down"\)\.sort\(byName\), \.\.\.vs\.filter\(v=>v\.status==="issues"\)\.sort\(byName\)\];/);
  // The one map moves onto the TV screen and back to where it was.
  assert.match(app, /\$\("tvMap"\)\.append\(\$\("mapWrap"\)\);/);
  assert.match(app, /\$\("mapBlock"\)\.insertBefore\(\$\("mapWrap"\), \$\("mapNote"\)\);/);
  assert.equal(app.split('id=\\"mapSvg\\"').length - 1, 1);
  // Leaving is always possible: a button, a second button on a small screen, and Escape.
  assert.match(app, /\$\("tvExit"\)\.addEventListener\("click",tvLeave\); \$\("tvExitTop"\)\.addEventListener\("click",tvLeave\);/);
  assert.match(app, /if\(ev\.key==="Escape"\) tvLeave\(\);/);
  assert.match(app, /if\(hooks && typeof hooks\.onTv==="function"\) hooks\.onTv\(false\);/);
  // It stands over the whole frame without making the page a positioning box for anything else.
  assert.match(style, /\.cosb\.tv\{position:fixed;inset:0;z-index:2147482000;overflow:hidden;/);
  const landing = read('../src/CosBoardLanding.tsx'), door = read('../src/BoardsDoor.tsx'), daily = read('../src/DailyBoard.tsx');
  // The app tells the page around the frame with the message the older TV display sends, on this origin only, and takes it back when the board goes.
  assert.match(landing, /window\.parent\.postMessage\(\{type: 'COS_TV_BOARD_DISPLAY_MODE', active: on\}, window\.location\.origin\);/);
  assert.match(landing, /if \(tvOn\.current\) \{ tvOn\.current = false; showTv\(false\); \}/);
  // Boards opens it only on a device that shows the board. Any other keeps the Daily Board page and its older TV display.
  assert.match(door, /const \[leaving\] = useState\(boardShownHere\);/);
  assert.match(door, /return leaving \? <p className='cos-manager-door' role='status'>Opening the TV board…<\/p> : <>\{children\}<\/>;/);
  assert.match(read('../src/FleetBoard.tsx'), /export const boardShownHere = \(\): boolean => recall\(\) && !switchedOff\(\);/);
  assert.equal(daily.split('<BoardsDoor>').length - 1, 2);
  assert.equal(daily.split('</BoardsDoor>').length - 1, 2);
  assert.match(daily, /  if\(tv\)return <BoardsDoor><TechCheckTvBoard /);
  assert.match(daily, /  return <BoardsDoor><section className='cos-daily-board' aria-label='COS Daily Board'>/);
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

test('the map covers its box, and a spot with a mix of states is a ring, not one red circle', () => {
  const app = read('../src/cosBoard/boardApp.ts'), style = read('../src/cosBoard/boardStyle.ts');
  // The drawing can never be smaller than its box, so no part of the box is left empty.
  assert.match(app, /function zMin\(\)\{ if\(!M\.w\) return \.3; const \[x0,y0,x1,y1\]=mapEdges\(\); return Math\.max\(M\.w\/\(x1-x0\), M\.h\/\(y1-y0\)\); \}/);
  assert.match(app, /clampZ = z => Math\.max\(zMin\(\), Math\.min\(ZMAX, z\)\);/);
  assert.match(app, /function hold\(\)\{\n  if\(!M\.w\) return;\n  M\.z=clampZ\(M\.z\);/);
  // A fit that would only zoom in by a hair shows the whole drawing instead, so a swipe on it scrolls the page.
  assert.match(app, /if\(z<zMin\(\)\*1\.25\) z=zMin\(\);/);
  // On a phone the box takes the drawing's own shape. The shape comes from the map file, not a guess.
  const map = JSON.parse(read('../src/cosBoard/boardMap.json'));
  assert.ok(style.includes('.mapwrap{height:auto;min-height:0;max-height:none;aspect-ratio:' + map.w + '/' + map.h.toFixed(1) + '}'));
  // A circle no longer takes the colour of the worst unit in it.
  assert.equal(app.includes('worst is'), false);
  assert.match(app, /const kinds=\["down","issues","unknown","up"\]\.filter\(k=>by\[k\]\), mixed=kinds\.length>1;/);
  assert.match(app, /n\+" units here: "\+kinds\.map\(k=>by\[k\]\+" "\+LABEL\[k\]\)\.join\(", "\)/);
  // The red number is the count of down units at that spot, and only shows where there is one.
  assert.match(app, /if\(by\.down\)\{ const b=R\*\.82; kids\.push\(sv\("circle",\{class:"bad"/);
  assert.match(app, /sv\("text",\{class:"badn",[^}]*text:String\(by\.down\)\}\)/);
  // Town names are placed clear of the pins, or left off.
  assert.match(app, /boxes=cl\.map\(c=>\{ const n=c\.m\.length, r=/);
});

test('the board counts one way, and a hand fix comes first on the card and says what it did to the count', () => {
  const app = read('../src/cosBoard/boardApp.ts');
  // One count. mHelp's list decides it once it has loaded; there is no stored choice and nothing to pick.
  assert.equal(/S\.mode\b|setMode|Count by|Camera systems"\)/.test(app), false);
  assert.equal(app.includes('localStorage.setItem("cos-count-mode"'), false);
  assert.ok(app.includes('try{ localStorage.removeItem("cos-count-mode"); }catch(_){}'));
  assert.ok(app.includes('if(S.mh){'));
  assert.ok(app.includes('One count: mHelp, the official list'));
  assert.ok(app.includes('The mHelp list has not loaded, so this shows only what the camera systems can see. It is not the official count.'));
  // What the camera systems see on their own is only the fallback, and so is its DO NOT USE exclusion.
  assert.ok(app.includes('(v.excl && !S.mh) ? "excl"'));
  assert.ok(app.includes('const feeds = !S.mh;'));
  // Fix it sits right under the diagnosis, and the save waits for the saved reading before saying how the count moved.
  assert.ok(app.includes('body.splice(2,0,fx);'));
  assert.equal(app.includes('body.push(fx);'), false);
  assert.match(app, /S\.saved=\{was, said: said \|\| "Saved\.", unit:v\.id, ip:steps\.some\(x=>x\.field==="public_ip"\)\}; clearTimeout\(savedTimer\); savedTimer=setTimeout\(saidSaved, 1500\);/);
  // A corrected IP is kept, and the save says that Up or Down still comes from Star4Live.
  assert.match(app, /still = !moved\.length && ip && v && v\.u\.s==="v" && \["down","issues","unknown"\]\.includes\(v\.status\);/);
  // What a person set by hand is settled: off the open punch list for as long as the hand fix stands.
  assert.match(app, /sec:"place", fixed:!!v\.hand\.place,/);
  assert.match(app, /sec:"name", fixed:!!v\.hand\.name,/);
  assert.match(app, /const settled=i=>!!\(done\[i\.id\] \|\| i\.fixed\);\n  const open=items\.filter\(i=>!settled\(i\)\)/);
  assert.ok(app.includes('["done","Fixed by hand","Set by hand in COS, so these are off the list and stay off.'));
  // The card says in so many words that a hand fix is kept.
  assert.ok(app.includes('A fix made by hand wins in COS and stays until someone undoes it. No new reading from mHelp or Star4Live replaces it.'));
  assert.match(app, /render\(\);\n  announce\(\);\n  saidSaved\(\);\n\}/);
  assert.ok(app.includes('" The count changed: "+moved.join(", ")+"."'));
});
