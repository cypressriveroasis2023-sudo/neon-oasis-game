import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CameraHealthOverview from '../src/CameraHealthOverview.tsx';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {fleetDashboardRows,fleetDashboardSummary,filterFleetDashboard,initialFleetFilters} from '../src/fleetDashboardModel.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';

const kpis=html=>[...html.matchAll(/<button[^>]*class="camera-unit-kpi[^\"]*"[^>]*><span>[^<]+<\/span><b[^>]*>(.*?)<\/b>/g)].map(match=>match[1]);
const render=(f,units=f.units)=>renderToStaticMarkup(React.createElement(CameraHealthOverview,{health:f.health,units,now:f.now,roster:f.roster}));

test('broader provider review records cannot inflate the Field unverified headline',()=>{
 const f=fieldProductFixture();
 f.health=snapshot([...f.health.rows,...Array.from({length:385},(_,i)=>resource(100+i,'Unresolved '+i,{scope:'unknown'}))]);
 const before=structuredClone(f);
 assert(cameraOverview(f.health,f.now,f.units).operational.unknown>380);
 const count=fleetDashboardSummary(filterFleetDashboard(fleetDashboardRows(f.units,f.health,null,null,f.now),initialFleetFilters,'fleet'));
 const html=render(f);
 assert.deepEqual(kpis(html),[String(count.online+count.offline+count.unknown),String(count.online),String(count.offline),String(count.unknown)]);
 assert.deepEqual(kpis(html),['3','1','1','1']);
 assert.match(html,/1 online \+ 1 offline \+ 1 unverified = 3 Field camera units/);
 assert.match(html,/<details class="camera-record-breakdown"[^>]*><summary>Provider and camera record details/);
 assert.doesNotMatch(html,/<details class="camera-record-breakdown"[^>]*open/);
 assert.deepEqual(f,before);
});

test('support and inactive equipment stay out of the camera-unit partition',()=>{
 const f=fieldProductFixture();
 f.units[0].activeInventoryEligible=false;
 // The reviewed roster independently excludes the now-inactive unit.
 f.roster=undefined;
 assert.deepEqual(kpis(render(f)),['2','0','1','1']);
});

test('unavailable paired inventory never certifies a provider total as Field equipment',()=>{
 const f=fieldProductFixture();
 assert.deepEqual(kpis(render(f,null)),['—','—','—','—']);
});
