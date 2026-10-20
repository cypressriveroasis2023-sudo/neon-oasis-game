import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import FleetUnitHealth from '../src/FleetUnitHealth.tsx';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import {resource,snapshot,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const unit={id:'00000000-0000-4000-8000-000000000001',unitNumber:'Helios 1',modelName:'Helios',currentLocationType:'field',status:'field'};
const health=snapshot([resource(1,'Helios 1')]);
const observation=(metric,value,source='system',instance=0,unit=metric==='battery_soc'?'%':metric==='battery_voltage'?'V':metric==='battery_current'?'A':'W')=>({metric,value,source,instance,unit,observedAt:fresh});
const vrm={items:[{name:'HELIOS 001',installationId:1001}],power:[{name:'HELIOS 001',installationId:1001,errorCode:null,lastAttemptAt:new Date(now).toISOString(),measurements:[observation('battery_soc',92.7,'battery',278),observation('battery_soc',100),observation('solar_power',190),observation('solar_power',180,'solarcharger',1),observation('load_power',0),observation('battery_power',-75,'battery',278),observation('battery_voltage',12.6,'battery',278),observation('battery_current',-5.9,'battery',278)]}]};
const router={id:'router-fixture',unitKey:'Helios 1',name:'Fixture InHand',model:'IR615',publicIp:'192.0.2.10',match:'exact_name',candidateUnit:{id:unit.id,unitNumber:'Helios 1'},probeStatus:'online',checkedAt:fresh,lastRecoveredAt:fresh,reportedStatus:'Online',reportedAt:fresh};
const row=(power=vrm,routers=[router],at=now,units=[unit])=>fleetDashboardRows(units,health,routers,power,at)[0];
const render=(value,at=now)=>renderToStaticMarkup(React.createElement(FleetUnitHealth,{row:value,now:at}));
const currentMetrics=html=>html.split('aria-label="Recent power measurements"')[1]?.split('</dl>')[0]||'';

test('the unit top card groups camera, exact InHand and Victron evidence without additional reads',()=>{
 const html=render(row());assert(html.indexOf('Camera health')<html.indexOf('Router &amp; connection'));assert(html.indexOf('Router &amp; connection')<html.indexOf('Battery · Victron'));assert.match(html,/Fixture InHand · IR615/);assert.match(html,/192\.0\.2\.10/);assert.match(html,/Port reachable/);assert.match(html,/92\.7%/);assert.match(html,/https:\/\/vrm\.victronenergy\.com\/installation\/1001\/dashboard/);assert.match(html,/Lowest reported charge/);assert.match(html,/2 reported charge sources/);
 const source=readFileSync(new URL('../src/FleetUnitHealth.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"]\.\/api|fetch\(|useEffect\(/);
});
test('power preserves source instances, signed raw readings and verified zero without summing or runtime claims',()=>{
 const html=render(row()),metrics=currentMetrics(html);assert.match(metrics,/190 W/);assert.match(metrics,/180 W/);assert.match(metrics,/System 0/);assert.match(metrics,/Solar charger 1/);assert.match(metrics,/0 W/);assert.match(metrics,/-75 W/);assert.doesNotMatch(metrics,/370 W|hours|Charging|Discharging/);assert.match(html,/DC system load/);assert.match(html,/not total site consumption/);assert.match(html,/12\.6 V/);assert.match(html,/-5\.9 A/);
});
for(const kind of ['stale','provider failure','sync failure','missing'])test('current power metrics fail closed for '+kind,()=>{
 const power=structuredClone(vrm);let at=now;if(kind==='stale')at+=3600000;if(kind==='provider failure')power.power[0].errorCode='provider';if(kind==='sync failure')power.sync={state:'error',error:'Synthetic failure'};if(kind==='missing')power.power[0].measurements=[];
 const html=render(row(power,[router],at),at),metrics=currentMetrics(html);assert.doesNotMatch(metrics,/190 W|180 W|-75 W|0 W/);assert.equal((metrics.match(/Unverified/g)||[]).length,5);assert.doesNotMatch(html.split('aria-label="Selected unit battery charge"')[1]?.split('</strong>')[0]||'',/92\.7%/);
});
test('duplicate unit identity and mismatched router UUID cannot donate associated source data',()=>{
 const html=render(row(vrm,[{...router,candidateUnit:{id:'00000000-0000-4000-8000-999999999999',unitNumber:'Helios 1'}}],now,[unit,{...unit,id:'00000000-0000-4000-8000-000000000002'}]));assert.doesNotMatch(html,/192\.0\.2\.10|92\.7%|190 W/);assert.match(html,/No exact, unique router association/);
});
test('unsupported families keep power unavailable instead of borrowing Helios values',()=>{
 const other={...unit,unitNumber:'Spotter 1',modelName:'Spotter'},html=render(fleetDashboardRows([other],health,[router],vrm,now)[0]);assert.match(html,/Power measurements are not available for this unit family/);assert.doesNotMatch(html,/92\.7%|Recent power measurements/);
});

test('saved alarm types, values, sources and observation age retain installation provenance',()=>{
 const power=structuredClone(vrm);power.power[0].measurements.push(observation('low_voltage_alarm',2,'battery',278,'state'),observation('low_soc_alarm',0,'system',0,'state'),{...observation('high_voltage_alarm',1,'battery',512,'state'),observedAt:'2026-10-01T00:00:00Z'});
 const html=render(row(power));assert.match(html,/Victron installation #1001/);assert.match(html,/Recent Victron battery alarm reported/);assert.match(html,/Low voltage alarm · Battery 278/);assert.match(html,/Alarm 2 · Recent observation/);assert.match(html,/Low charge alarm · System 0/);assert.match(html,/No alarm reported · Recent observation/);assert.match(html,/High voltage alarm · Battery 512/);assert.match(html,/Alarm 1 · Stale \/ unverified/);assert.match(html,/Measured /);
 power.power[0].errorCode='provider';const failed=render(row(power));assert.doesNotMatch(failed,/Recent Victron battery alarm reported/);assert.match(failed,/Alarm 2 · Current reading unverified/);
});
