import test from 'node:test';
import assert from 'node:assert/strict';
import {chargeReadings,readDashboardPower,selectReading,dashboardPowerFor,readingIsFresh} from '../src/vrmReadOnlyModel.ts';
const now=Date.now(),at=new Date(now).toISOString();
const unit=(id,name)=>({installationId:id,name,portalUrl:`https://vrm.victronenergy.com/installation/${id}/dashboard`,embedUrl:null});
const units=[unit(1042732,'HELIOS 010'),unit(1041373,'HELIOS 011'),unit(3000123,'HELIOS 012')];
const measurement=(metric,value,extra={})=>({metric,value,unit:metric==='battery_soc'?'%':'W',observedAt:at,instance:0,source:'system',...extra});
const row=(unit,measurements)=>({...unit,measurements,lastAttemptAt:at,errorCode:null});
test('010, 011 and any later discovered Helios installation use exact identity without embed configuration',()=>{
 const {rows,invalid}=readDashboardPower(units.map(u=>row(u,[measurement('battery_soc',80)])),units);
 assert.equal(invalid,false);
 for(const u of units)assert.equal(dashboardPowerFor(u,rows).installationId,u.installationId);
 assert.equal(dashboardPowerFor({...units[0],name:'HELIOS 011'},rows),undefined);
 assert.equal(dashboardPowerFor({...units[0],available:false},rows),undefined);
});
test('zero is reported, missing remains missing, stale has a separate freshness flag',()=>{
 const r=row(units[0],[measurement('solar_power',0),measurement('battery_soc',70,{observedAt:new Date(now-31*60000).toISOString()})]);
 assert.equal(selectReading(r,'solar_power',now).value,0);
 assert.equal(selectReading(r,'load_power',now),undefined);
 assert.equal(readingIsFresh(selectReading(r,'battery_soc',now),now),false);
});
test('system and charger values are not double-counted and fresh readings take priority',()=>{
 const r=row(units[0],[measurement('solar_power',20,{source:'solarcharger',instance:277}),measurement('solar_power',19)]);
 assert.equal(selectReading(r,'solar_power',now).value,19);
 r.measurements[1].observedAt=new Date(now-31*60000).toISOString();
 assert.equal(selectReading(r,'solar_power',now).value,20);
});
test('malformed telemetry fails closed without changing fleet; absent telemetry is a waiting state',()=>{
 assert.deepEqual(readDashboardPower(undefined,units),{rows:[],invalid:false});
 assert.deepEqual(readDashboardPower([{...row(units[0],[]),measurements:[measurement('solar_power','42')]}],units),{rows:[],invalid:true});
 assert.deepEqual(readDashboardPower([row(units[0],[]),row(units[0],[])],units),{rows:[],invalid:true});
});

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import VrmReadOnlyDashboard from '../src/VrmReadOnlyDashboard.tsx';
test('read-only component renders current, stale, unavailable and failure states without controls or external requests',()=>{
 const u=units[0],r=row(u,[measurement('solar_power',0),measurement('battery_soc',80)]);
 const render=props=>renderToStaticMarkup(React.createElement(VrmReadOnlyDashboard,{unit:u,rows:[r],now,...props}));
 assert.match(render({}),/Recent saved readings/);assert.match(render({}),/Not reported/);
 assert.doesNotMatch(render({}),/<(?:button|iframe|script|form)\b/);
 assert.match(render({now:now+31*60000}),/Saved readings · some are stale/);
 assert.match(render({readFailed:true}),/Readings could not be refreshed/);
 assert.match(render({invalid:true,rows:[]}),/Readings could not be refreshed/);
 assert.match(render({rows:[]}),/Waiting for readings/);
 assert.match(render({unit:{...u,available:false}}),/Installation unavailable/);
 assert.doesNotMatch(render({unit:{...u,available:false}}),/>80</);
});

test('charge sources stay separate even when a system value is higher or another bank is stale',()=>{
 const u=units[0],r=row(u,[measurement('battery_soc',100),measurement('battery_soc',92.7,{source:'battery',instance:278}),measurement('battery_soc',83,{source:'battery',instance:512,observedAt:new Date(now-31*60000).toISOString()})]);
 assert.deepEqual(chargeReadings(r,now).map(x=>[x.source,x.instance,x.value]),[['battery',278,92.7],['system',0,100],['battery',512,83]]);
 const markup=renderToStaticMarkup(React.createElement(VrmReadOnlyDashboard,{unit:u,rows:[r],now}));
 for(const text of ['92.7','100','83','battery · instance 278','battery · instance 512','system · instance 0','Separate source readings · no combined charge','Stale'])assert.ok(markup.includes(text),text);
 assert.match(markup,/Saved readings · some are stale/);
});
