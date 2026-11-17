import {beforeFleetCountTrustSource} from './fleet-count-trust-source.mjs';
import {originalItSavedReadingSource} from './it-saved-readings-source.mjs';
import {originalFleetViewMarkup} from './approved-fleet-view-source.mjs';
import {originalFleetConnectionReadSource} from './fleet-connection-read-source.mjs';
import {previousReviewedMainSource} from './approved-current-main-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Baseline: reviewed main 12a2dff071ee545efb6e0d380a0f78abbb5c4088.
// Includes visibility resume and the receipt-only inventory guard, verified by
// saved-camera-refresh-scheduling and source-equipment-pins browser cases.
// These remain exact source guards; behavioral/session/identity suites run separately.
// The reviewed connection-read patch is reversed explicitly; baseline hashes never change.
// Reviewed change, at James's instruction: power readings are judged by their
// own freshness window instead of the camera one. Victron arrives every 15
// minutes already several minutes old, so seven of nine healthy field Helios
// were reading "Unverified". FleetBatterySummary.tsx and fleetDashboardModel.ts
// carry that change and their pins move with it. The camera window is
// untouched, and tests/power-freshness.test.mjs holds both boundaries exactly.
// Reviewed 2026-11-15 at the owner's request: workspaceNavigation.ts drops the
// Finance group and the unused Customers/Schedule entries (routes kept, see
// hiddenWorkspaces); fleetDashboard.css changes three colours from the old blue
// to COS red. Neither touches how a unit is presented or counted.
// Router status moves FleetUnitHealth.tsx, fleetDashboardModel.ts and
// fleetDashboard.css with the badge and the aged label. FleetDashboard.tsx
// keeps its reviewed baseline through a declared reversal.
const expected={
  "FleetDashboard.tsx": "8d711a97853b5f646d892f5552a792656623a9f8",
  "FleetUnitHealth.tsx": "a8f6dfb970989d6b63e0885c6f2098bb87cc361a",
  "FleetCameraTools.tsx": "338a98fc2f9042d06a9d725384b2a95e3099a5bd",
  "FleetBatterySummary.tsx": "278f67abefcc6846876e2ced0862eec9cf1733dd",
  "LastKnownCameraStatus.tsx": "40b4218e51b13c8e15d5f5e7ad81be410df4663d",
  "fleetDashboardModel.ts": "db70ca7b326f95e7b6fd3f3bf6af5e157b65dd36",
  "fieldCameraHealth.ts": "b524d935a9f92619e5e9617e19a5b04c5a924b33",
  "cameraEvidence.ts": "78b71c8e063720a416449b4b6cfa335606191a0a",
  "api.ts": "1647e0a906b2a8845f51c1b06441c591d5babc16",
  "useCameraHealth.ts": "62382e9352b2c17cdafa144a784bc2f64fa04d51",
  "refreshCadence.ts": "c15e6e2959125f33ce43c2c152500062d8f5b167",
  "workspaceNavigation.ts": "a8161174e7cdf3987503c927c66f37c7906c09ec",
  "App.tsx": "dc18ebf3a71b80fee56c7e66b4c111faff734beb",
  "fleetDashboard.css": "2e1d18350c9df9cb3608b933c836836f39312977",
  "fleetAppearance.css": "72d26de6af0f7be19268998515c953fa7d58a23f",
  "fleetSimpleCards.css": "289a23208e902651cd9f3afcf9ff7a7a9ccbc3c5",
  "fleetBoardLayout.css": "8c4962032a589287f75854b581dfc57f5d579b8f"
};
for (const [name,sha] of Object.entries(expected)) test('unit presentation preserves '+name,()=>{
 const raw=readFileSync(new URL('../src/'+name,import.meta.url));
 const reviewed=beforeFleetCountTrustSource(name,raw.toString('utf8'));
 const current=['FleetDashboard.tsx','useCameraHealth.ts'].includes(name)?previousReviewedMainSource(name,reviewed):reviewed;
 const restored=name==='FleetDashboard.tsx'?originalFleetViewMarkup(current):['api.ts','useCameraHealth.ts'].includes(name)?originalFleetConnectionReadSource(name,current):name==='App.tsx'?originalItSavedReadingSource(name,current):null;
 const b=Buffer.from(restored===null?current:restored);
 assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),sha);
});
const css=readFileSync(new URL('../src/approvedFleetUnit.css',import.meta.url),'utf8');
test('all presentation selectors are limited to the approved Owner unit drawer',()=>{
 const rules=[...css.matchAll(/([^{}]+)\{/g)].map(m=>m[1].trim()).filter(s=>!s.startsWith('@')&&!s.startsWith('/*'));
 assert.ok(rules.length>=15);
 for(const selector of rules) assert.ok(selector.startsWith('#root .cos-approved-shell .cos-fleet-drawer:has(.cos-fleet-unit-health-grid)'),selector);
});
test('no status colors, invented content, hidden evidence or reversed reading order',()=>{
 assert.doesNotMatch(css,/\.cos-signal-|\.camera-status-|content\s*:|display\s*:\s*none|visibility\s*:|overflow(?:-[xy])?\s*:\s*(?:hidden|clip)|order\s*:\s*-/i);
});
test('stylesheet is imported once only by approved navigation',()=>{
 const nav=readFileSync(new URL('../src/ApprovedCosNavigation.tsx',import.meta.url),'utf8');
 assert.equal(nav.split("import './approvedFleetUnit.css';").length-1,1);
 assert.ok(nav.startsWith("import './approvedFleetUnit.css';"));
});

test('approved navigation component changes only by its presentation import',()=>{
 const s=readFileSync(new URL('../src/ApprovedCosNavigation.tsx',import.meta.url),'utf8').replace("import './approvedFleetUnit.css';\n",'');
 assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex'),'8bfe64298a899af1c233334c859f831d1b3754f9');
});
