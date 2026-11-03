import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import FleetVictronSummary from '../src/FleetVictronSummary.tsx';
import VrmEnergyFlow from '../src/VrmEnergyFlow.tsx';
import {vrmPortalConfig} from '../../supabase/functions/cos-operations-pages/vrm.ts';
import {discoverVrmInstallations} from '../../supabase/functions/cos-operations-pages/vrmDiscovery.ts';
const now=Date.parse('2026-11-03T17:00:00Z'),at=new Date(now).toISOString();
const unit={id:'00000000-0000-4000-8000-000000000001',unitNumber:'Helios 1',modelName:'Helios',placement:'FIELD',status:'field'};
const installation={installationId:1001,name:'HELIOS 001',portalUrl:'https://vrm.victronenergy.com/installation/1001/dashboard',embedUrl:'https://vrm.victronenergy.com/installation/1001/embed/synthetic-token',sharingEnabled:true,lastSeenAt:at};
const measurement=(metric,value,unit='W')=>({metric,value,unit,observedAt:at,source:'system',instance:0});
const power={installationId:1001,name:'HELIOS 001',errorCode:null,lastAttemptAt:at,measurements:[measurement('solar_power',220),measurement('load_power',82),measurement('battery_soc',76,'%')]};
const vrm={items:[installation],power:[power]};
const row=()=>fleetDashboardRows([unit],null,[],vrm,now)[0];
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('exact unique Helios card contains numeric dashboard and approved matching embed',()=>{
 const html=render(FleetVictronSummary,{row:row(),now});
 for(const text of ['Power overview','220','82','76','Dashboard sharing enabled','All Victron readings','synthetic-token'])assert.ok(html.includes(text),text);
 assert.match(html,/<iframe[^>]+loading="lazy"/);assert.doesNotMatch(html,/id="vrm-native-dashboard"/);
 assert.equal((html.match(/is-flowing/g)||[]).length,2);
});
test('stale, failed and zero readings never animate; missing stays unreported',()=>{
 const flow=props=>render(VrmEnergyFlow,{row:power,now,...props});
 assert.doesNotMatch(flow({now:now+31*60000}),/is-flowing/);
 assert.doesNotMatch(flow({paused:true}),/is-flowing/);
 assert.doesNotMatch(flow({row:{...power,errorCode:'provider'}}),/is-flowing/);
 assert.doesNotMatch(flow({row:{...power,measurements:[measurement('solar_power',0)]}}),/is-flowing/);
 assert.match(flow({row:undefined}),/Not reported/);
});
test('duplicate native or provider identity cannot inherit another unit dashboard',()=>{
 assert.equal(fleetDashboardRows([unit,{...unit,id:'other'}],null,[],vrm,now)[0].vrmInstallation,null);
 assert.equal(fleetDashboardRows([unit],null,[],{...vrm,items:[installation,{...installation,installationId:1002}]},now)[0].vrmInstallation,null);
 const bad={...installation,embedUrl:'https://vrm.victronenergy.com/installation/9999/embed/wrong'};
 assert.equal(fleetDashboardRows([unit],null,[],{...vrm,items:[bad]},now)[0].vrmInstallation.embedUrl,null);
});
test('provider sharing disabled suppresses a previously approved iframe without changing telemetry',()=>{
 const config=vrmPortalConfig(JSON.stringify({'1001':installation.embedUrl}),[{...installation,sharingEnabled:false}]);
 assert.equal(config.items[0].sharingEnabled,false);assert.equal(config.items[0].embedUrl,null);
});
test('discovery automatically reads documented shared boolean; absent or malformed remains unknown',async()=>{
 const records=[{idSite:1001,name:'HELIOS 001',shared:true},{idSite:1002,name:'HELIOS 002',shared:false},{idSite:1003,name:'HELIOS 003',shared:'true'}];
 const calls=[];const fetcher=async(url,options)=>{calls.push([url,options.method]);return Response.json(url.endsWith('/users/me')?{success:true,user:{id:41}}:{success:true,records});};
 const result=await discoverVrmInstallations('synthetic',fetcher);
 assert.deepEqual(result.items.map(i=>i.sharingEnabled),[true,false,undefined]);
 assert.ok(calls.every(c=>c[1]==='GET'));assert.equal(calls.length,2);
});
