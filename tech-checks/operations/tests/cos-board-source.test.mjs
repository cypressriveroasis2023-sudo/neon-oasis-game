import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/cosBoard/boardApp.ts');
const style = read('../src/cosBoard/boardStyle.ts');
const data = read('../src/cosBoard/boardData.ts');

test('the board carries no fleet data and reads nothing itself', () => {
  // This repository is public. Unit names, customers, addresses and IPs reach the board from the signed-in feed only.
  const files = readdirSync(new URL('../src/cosBoard/', import.meta.url), {recursive: true}).map(name => String(name).replace(/\\/g, '/')).sort();
  assert.deepEqual(files, [
    'boardApp.ts', 'boardData.ts', 'boardEdit.ts', 'boardFonts.ts', 'boardMap.json', 'boardPower.ts', 'boardStyle.ts', 'boardTrouble.ts',
    'fonts', 'fonts/OFL.txt', 'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-tight-latin-wght-normal.woff2',
  ]);
  const map = JSON.parse(read('../src/cosBoard/boardMap.json'));
  // A plain base map of Texas and its projection numbers. No pins, units or sites.
  assert.deepEqual(Object.keys(map).sort(), ['N', 'W', 'counties', 'h', 'hl', 'hwy', 'kx', 'lakes', 'land', 'places', 'rivers', 'roads', 'states', 'urban', 'w']);
  for (const source of [app, read('../src/cosBoard/boardData.ts'), read('../src/cosBoard/boardEdit.ts'), read('../src/cosBoard/boardStyle.ts'), read('../src/cosBoard/boardFonts.ts'), read('../src/cosBoard/boardPower.ts')]) {
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
  // Exactly four sends, each named here on purpose: the hand fix, checking one unit on demand, sending a
  // Troubleshoot result to IT (James, 25 Nov: it goes on the next IT sheet instead of being copied by hand; it
  // schedules nothing and changes no unit), and linking an A# by hand (James, 25 Nov: "build a# button"; Tech Check
  // checks the person and the A#), and applying one Moved in VCC item (James, 25 Nov: "build move in VCC"; Tech Check
  // works the list out again and refuses anything no longer listed), and swapping a unit's router (James, 25 Nov:
  // "build router swap"; Tech Check checks again first), and closing a Send to IT report with a note (James, 26 Nov:
  // close the loop; the report itself is never changed), and asking COS to run the camera checks now when Refresh is
  // tapped (James, 27 Nov: "click refresh and it will refresh and update"; it sends no data, Tech Check checks the
  // person and will not start a second check on top of one). The count stays exact so a ninth has to be argued for here.
  assert.equal(landing.split('api.post(').length - 1, 8);
  assert.equal(landing.split("api.post('/api/unit-camera-status/check-now', {})").length - 1, 1);
  assert.match(app, /await hooks\.onRefresh\(text =>/);
  assert.equal(landing.split("api.post('/api/unit-camera-status/troubleshoot-close', {id, outcome, note})").length - 1, 1);
  assert.match(app, /await hooks\.onTroubleClose\(r\.id, outcome, said\)/);
  assert.equal(landing.split("api.post('/api/unit-camera-status/router-swap', {key})").length - 1, 1);
  assert.match(app, /await hooks\.onRouterSwap\(it\.key\)/);
  assert.equal(landing.split("api.post('/api/unit-camera-status/vcc-move', {key})").length - 1, 1);
  assert.match(app, /await hooks\.onVccMove\(it\.key\)/);
  assert.equal(landing.split("api.post('/api/unit-camera-status/link-a', {unitKey, productId})").length - 1, 1);
  assert.match(app, /await hooks\.onLinkA\(v\.k, pid\)/);
  assert.equal(landing.split("api.post('/api/unit-camera-status/troubleshoot', report)").length - 1, 1);
  assert.match(app, /await hooks\.onSendTrouble\(\{requestId: tr\.sent\.id/);
  assert.equal(landing.split("api.post('/api/product-connections/verify', {productIds: [productId]})").length - 1, 1);
  // The work log and the board's own tech check form would need that store, so they are off.
  assert.match(app, /function logBox\(\)\{ return null; \}/);
  assert.doesNotMatch(app, /drawTechForm|techCard|sendTech/);
  // Links open outside the app's own frame.
  const links = app.match(/h\("a",\{class:"(?:lk|mgshot)[^}]*\}/g) || [];
  // On a unit's page: the system and port links, and each camera's Web and HTTPS page; on the manager view a
  // handoff's signed report and each of its photos; on the Punch list, Router far from site's map link.
  assert.equal(links.length, 7);
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
  // The map now lives on the board on a phone too, so the desk case names boardSide and the phone case boardMain.
  assert.match(app, /const block=\$\("mapBlock"\), home = side \? \$\("boardSide"\) : onBoard \? \$\("boardMain"\) : \$\("viewMap"\);/);
  assert.equal(app.split('id=\\"mapSvg\\"').length - 1, 1);
  assert.match(app, /function sideFilter\(\)\{ if\(!W\.side\) return; const f=\["down","issues","unknown","up"\]\.includes\(S\.filter\) \? S\.filter : "all";/);
  assert.match(app, /if\(!withList\) M\.f="all";/);
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
  // The board's tiles count what its family chips are showing; the TV has no chips and counts every unit.
  assert.match(app, /for\(const v of \(TV\.on \? vs : vs\.filter\(inFamily\)\)\) c\[v\.status\]\+\+;\n  if\(TV\.on\)\{ drawTv\(vs, c\); return; \}/);
  assert.match(app, /const inFamily = \(v:any\) => S\.fam === "all" \|\| v\.fam === S\.fam;/);
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
  assert.ok(fleet.includes(' onFeed={setCameraUnits} notice={selectionNotice} unitAsked={boardAsk.n?boardAsk:null}/>}'));
  // A unit asked for from another screen opens on the board's own card, not the older details drawer (James, 25 Nov).
  assert.ok(fleet.includes('if(boardShownHere()&&(matches.length===1||initialUnitLabel)){'));
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
  assert.match(app, /const kinds=\["down","issues","unknown","up","nm"\]\.filter\(k=>by\[k\]\), mixed=kinds\.length>1;/);
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
  // Fixing the record sits after troubleshooting and the unit's own pages, and the save waits for the saved reading before saying how the count moved.
  assert.ok(app.includes('body.splice(body.indexOf(ob)+1,0,fx);'));
  assert.equal(app.includes('body.push(fx);'), false);
  assert.match(app, /S\.saved=\{was, said: said \|\| "Saved\.", unit:v\.id, ip:steps\.some\(x=>x\.field==="public_ip"\)\}; clearTimeout\(savedTimer\); savedTimer=setTimeout\(saidSaved, 1500\);/);
  // A corrected IP is kept for every unit, and the save names the system that still decides Up or Down.
  assert.match(app, /still = !moved\.length && ip && v && \["down","issues","unknown"\]\.includes\(v\.status\);/);
  assert.ok(app.includes('b("Correct IP","ip",true),'));
  assert.equal(app.includes('u.s==="v" ? b("Correct IP","ip",true) : null'), false);
  assert.ok(app.includes("Up or Down comes from COS's own check of this unit, so it clears at the next check that finds its cameras online."));
  assert.ok(app.includes("Up or Down comes from the Recon cloud's own reading, so it clears when Recon sees the cameras online."));
  // A Sniper with no IP saved is Unknown for good, and the card says so and sends him to the fix.
  assert.match(app, /if\(v\.status==="unknown"\) return v\.u\.s==="a" && !v\.u\.ip/);
  assert.ok(app.includes('COS has no IP address for this unit, so it cannot be checked at all. That is why it shows Unknown and not Down.'));
  assert.ok(app.includes('Add the IP under Fix the record. COS checks the address within the hour and the unit stops being Unknown.'));
  assert.ok(app.includes('COS has no IP address saved for this unit, so there is nothing to check.'));
  // The reading is COS's own check of the address. COS has no Avigilon feed.
  assert.equal(app.includes('Avigilon check'), false);
  assert.ok(app.includes('No IP address saved, so COS has never checked it'));
  // The family is still called Avigilon, because that is what the units are.
  assert.ok(app.includes('const FAM = { v:"Alibi", a:"Avigilon", r:"Recon II", x:"Other" };'));

  // The other COS screens open from the board itself, named as IT sees them.
  assert.ok(app.includes('const SCREENS = [["Camera Health","Camera Health"],["InHand Routers","InHand Routers"],["Victron VRM","Victron Power"],["Unit Tracker","2027 Unit Tracker"]];'));
  assert.match(app, /function screensRow\(\)\{[\s\S]*?hooks\.onScreen\(workspace\)/);
  assert.ok(app.includes('<div class=\\"screens\\" id=\\"screensRow\\">'));
  // The Tech check tab goes where this sign-in's checks are: an IT sign-in, known by its refused manager read, goes to its own.
  assert.ok(app.includes('$("tabTech").addEventListener("click",()=>hooks.onTechCheck(MG.on===true || MG.state!=="failed"))'));
  // The board says in one line why the three counts in COS differ.
  assert.ok(app.includes('mHelp\u2019s own field total is higher because it counts stands and poles as well.'));
  // What a person set by hand is settled: off the open punch list for as long as the hand fix stands.
  assert.match(app, /sec:"place", fixed:!!v\.hand\.place,/);
  assert.match(app, /sec:"name", fixed:!!v\.hand\.name,/);
  assert.match(app, /const settled=i=>!!\(done\[i\.id\] \|\| i\.fixed\);\n  const open=items\.filter\(i=>!settled\(i\)\)/);
  assert.ok(app.includes('["done","Fixed by hand","Set by hand in COS, so these are off the list and stay off.'));
  // The card says in so many words that a hand fix is kept.
  assert.ok(app.includes('A fix made by hand wins in COS and stays until someone undoes it. No new reading from mHelp or Star4Live replaces it.'));
  assert.match(app, /render\(\);\n  announce\(\);\n  saidSaved\(\);\n  if\(S\.ask\) openByName\(S\.ask\);\n\}/);
  assert.ok(app.includes('" The count changed: "+moved.join(", ")+"."'));
});

test('checking one unit asks the app, never the network, and never fakes a reading', () => {
  // The board draws; the app around it is the only thing that sends. Checking is no exception.
  assert.match(app, /await hooks\.onCheckUnit\(v\.k, checkPid\(v\)\)/);
  assert.doesNotMatch(app, /product-connections\/verify/);

  // A button that cannot do anything is worse than no button: drawn only where the app supplies the hook.
  assert.match(app, /typeof hooks\.onCheckUnit==="function"/);
  // And only where there is an A# to check against, rather than silently checking nothing.
  assert.match(app, /nothing to check it against/);

  // A failed check reports the failure. It must not fall through to a success message.
  assert.match(app, /catch\(err\)\{\s*S\.chk=\{unit:v\.id, state:"fail"/);

  // Checking must not run while a hand fix is in flight, and must not run twice at once.
  assert.match(app, /if\(S\.busy \|\| v\.mhOnly \|\| !hooks \|\| typeof hooks\.onCheckUnit!=="function"\) return;/);
  // Checking sits right before Troubleshoot, which tells the tech to use it; fixing the record comes later on the card.
  assert.match(app, /body\.splice\(body\.indexOf\(tbx\),0,cb\);/);

  // Felix: the green "Checked just now" showed when no check had run. Green only when the check came back online;
  // a check with no answer says so instead of a success line.
  assert.doesNotMatch(app, /Checked just now/);
  assert.match(app, /c\.tone==="up" \? " s-up"/);
  assert.doesNotMatch(app, /s-"\+\(c\.state==="fail"\?"down":"up"\)/);
  // Felix: it could check the wrong unit. The unit's own A# comes first, and a fuzzy mHelp name match is never used.
  assert.match(app, /if\(v\.u\.pid\) return v\.u\.pid;/);
  assert.match(app, /mm && !mm\.fuzzy && mm\.rec && mm\.rec\.id/);
});

test('each camera links its own page through the forwarded port, and the card has a VCC button', () => {
  // James, 25 Nov: "a VCC button also and a link to each cameras interface directly."
  assert.match(app, /sys\.push\(lk\("VCC","https:\/\/www\.vigilantcontrolcenter\.com\/login"\)\)/);
  assert.match(app, /href:"http:\/\/"\+ip\+":"\+c\.p/);
  assert.match(app, /href:"https:\/\/"\+ip\+":"\+\(c\.p\+43\)/);
  // Only the standard forwarded ports are linked; anything else gets no link rather than a guess.
  assert.match(data, /\[1400, 1500, 1600, 1700, 1900\]\.includes\(camera\.port\)/);
});

test('the card keeps its Star4Live button', () => {
  // James, 25 Nov: "keep star4live button." Troubleshoot never sends a tech there; the button stays for when they choose to.
  assert.match(app, /sys\.push\(lk\("Star4Live","https:\/\/global\.star4live\.com\/userWeb\/device\/device-management"\)\)/);
});

test('a full battery with a Victron alarm is not called out of power', () => {
  // Felix: 95% was flagged as a power problem, because a level-2 Victron alarm turns the shared tone "low".
  // On the board, out of power means the battery reading itself is under 20%, from a current reading.
  assert.match(app, /function lowBattery\(pw\)\{ return !!\(pw && pw\.q!=="off" && pw\.q!=="stale" && pw\.q!=="none" && typeof pw\.b==="number" && pw\.b<20\); \}/);
  assert.match(app, /fs==="down" && lowBattery\(u\.pw\)/);
  assert.match(app, /power: live \? \{low:lowBattery\(pw\), battery:pw\.b, nightLow:/);
  assert.doesNotMatch(app, /u\.pw\.q==="low"\) cause/);
});

test('the app checks one unit with the same verify the rest of COS uses, then re-reads the board', () => {
  const landing = read('../src/CosBoardLanding.tsx');
  assert.match(landing, /onCheckUnit: async/);
  // The existing endpoint, not a new path of its own.
  assert.match(landing, /api\.post\('\/api\/product-connections\/verify', \{productIds: \[productId\]\}\)/);
  // A check is only worth anything if the card then shows what came back.
  assert.match(landing, /api\.get\('\/api\/unit-camera-status'\)/);
  // A save in flight and a board that moved on are both refused rather than guessed at.
  assert.match(landing, /A save is still in progress/);
  assert.match(landing, /started !== generation\.current/);

  // What the check found is read with the same contract Verify now uses; an unknown answer is not a check.
  assert.match(landing, /readSingleVerification\(\(await api\.post\('\/api\/product-connections\/verify'/);
  assert.match(landing, /item\.status === 'unknown'\) throw new Error\('The check did not reach the cameras'/);
  assert.doesNotMatch(landing, /Checked just now/);
});

test('the camera-systems count is shown but marked, never passed off as the official one', () => {
  // James read two different counts within a minute. The earlier one came before the mHelp list arrived and was
  // honest, just not official. It still shows, because a board with no numbers is worse than a marked one, but
  // the mark is on the numbers rather than in a sentence above them, which a glance skips.
  assert.match(app, /\$\("kpi"\)\.classList\.toggle\("prov", !S\.mh\);/);
  assert.match(app, /\$\("provNote"\)\.textContent = S\.mh \? "" : "Not the official count\./);
  assert.match(app, /\$\("provNote"\)\.hidden = Boolean\(S\.mh\);/);
  // The wall screen is read from across the shop, so the whole block dims there too.
  assert.match(app, /\$\("tvKpi"\)\.classList\.toggle\("prov", !S\.mh\);/);
  assert.match(app, /Not the official count: what the camera systems see, until mHelp has loaded\./);
  // Dimmed and dashed, so the difference carries without reading a word of it.
  assert.match(style, /\.kpi\.prov \.tile,\.kpi\.prov \.mini\{opacity:\.6;border-style:dashed\}/);
  assert.match(style, /\.tvleft\.prov \.tvtiles,\.tvleft\.prov \.tvminis\{opacity:\.6\}/);
});

test('the map is on the board itself, on a phone as well as a desk', () => {
  // James: "I wish this would show me the map and all units online and offline in the field right when I log in
  // and go to the home page." On a desk the map already sat beside the list; on a phone it was a tab away.
  assert.match(app, /const side = W\.wide && S\.view==="board", onBoard = !W\.wide && S\.view==="board";/);
  // On a phone it goes under the counts and above the list, not after it.
  assert.match(app, /if\(onBoard\) \$\("boardMain"\)\.insertBefore\(block, \$\("boardList"\)\);/);
  // One map, moved: never a second copy drawn somewhere else.
  assert.equal(app.split('id=\\"mapSvg\\"').length - 1, 1);
  // The count tiles filter the map in both places, so tapping Down shows the down units on the map too.
  assert.match(app, /const withList = side \|\| onBoard;/);
  assert.match(app, /if\(W\.side!==withList\)\{ W\.side=withList;/);
  // On the board the map shows only the map: its own tab keeps the filters and the list under it.
  assert.match(style, /#mapBlock\.onboard #mapChips,#mapBlock\.onboard #mapNote,#mapBlock\.onboard #mapList\{display:none\}/);
});

test('the Open box has the SIM and cell signal tools', () => {
  // James, 25 Nov: Coverage map and Downdetector to troubleshoot SIM placement, and Simetry to work on the SIMs.
  assert.match(app, /lk\("Coverage map","https:\/\/map\.coveragemap\.com\/"\)/);
  assert.match(app, /lk\("Downdetector","https:\/\/downdetector\.com\/"\)/);
  // Simetry's own sign-in page, never a pasted sign-in link with a token in it.
  assert.match(app, /lk\("Simetry","https:\/\/simetry\.onelogin\.com\/login2\/"\)/);
  assert.doesNotMatch(app, /simetry\.onelogin\.com\/login2\/\?return=/);
});
