import {originalFleetViewMarkup} from './approved-fleet-view-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// The accepted behavior baseline includes the saved snapshot repair. Session,
// cadence and cache behavior are exercised in the API and refresh suites.
const expected={
  "FleetDashboard.tsx": "558ad28ecc4162b231db766ecd1d3cd1a8145164",
  "FleetUnitHealth.tsx": "5d3a33000b951c1442771a63be7aed1cdd5e4e35",
  "FleetCameraTools.tsx": "338a98fc2f9042d06a9d725384b2a95e3099a5bd",
  "FleetBatterySummary.tsx": "32d829373e64b6a848dad85d24270aa83b404ebc",
  "LastKnownCameraStatus.tsx": "40b4218e51b13c8e15d5f5e7ad81be410df4663d",
  "fleetDashboardModel.ts": "1dd8bb50e29355b3a0e8ab3c5f2ef247e4f64054",
  "fieldCameraHealth.ts": "4ceb9709701c961342d09ae7b39335051f59a725",
  "cameraEvidence.ts": "a2000d04cae3516e5a99f0f9024742ac4931b1c4",
  "api.ts": "5d207a3f5b690bb8f2a60a0b0b1839cd72de0434",
  "useCameraHealth.ts": "bb47877da4e46ebbf37fb7c8d9ab5755116d1303",
  "refreshCadence.ts": "a5989a95272738fb309dce5b52e2f992e6d4e05e",
  "workspaceNavigation.ts": "b367196dda9a1dfe814d7871ee068f1599fabd47",
  "App.tsx": "340003125f6376b5512524f5ad1e91acf4d7f8e5",
  "fleetDashboard.css": "2264d502ee4f8f34989722630cef8b2d0712f08a",
  "fleetAppearance.css": "72d26de6af0f7be19268998515c953fa7d58a23f",
  "fleetSimpleCards.css": "289a23208e902651cd9f3afcf9ff7a7a9ccbc3c5",
  "fleetBoardLayout.css": "8c4962032a589287f75854b581dfc57f5d579b8f"
};
for (const [name,sha] of Object.entries(expected)) test('unit presentation preserves '+name,()=>{
 const raw=readFileSync(new URL('../src/'+name,import.meta.url));
 const b=name==='FleetDashboard.tsx'?Buffer.from(originalFleetViewMarkup(raw.toString('utf8'))):raw;
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
