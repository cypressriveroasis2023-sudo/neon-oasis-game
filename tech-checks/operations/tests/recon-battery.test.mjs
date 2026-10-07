import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {reconBatteryEvidence} from '../src/cameraEvidence.ts';
import {ReconBatteryDetails,CameraResourceObservations} from '../src/CameraHealthOverview.tsx';
import {cameraFamily} from '../src/cameraHealthCounts.ts';
import {validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {resource,snapshot,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const ctx=vm.createContext({URL,Intl});
for(const file of ['camera-health-history.js','recon-battery.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),ctx);
const legacy=ctx.ReconBattery;
const old='2026-10-05T01:02:03Z';
function render(battery){return renderToStaticMarkup(React.createElement(ReconBatteryDetails,{battery,now}));}
test('zero is a real battery reading while null, blank, booleans and malformed values are unavailable',()=>{
 for(const value of [0,'0',72,'72',100]){assert.equal(reconBatteryEvidence(value,fresh,null,null).percent,Number(value));assert.equal(legacy.percent(value),Number(value));}
 for(const value of [null,undefined,'',' ',false,true,{},[],['normal'],-1,101,'72%','0x10',Infinity,NaN]){assert.equal(reconBatteryEvidence(value,fresh,null,null).percent,null);assert.equal(legacy.percent(value),null);}
 assert.match(render(reconBatteryEvidence(0,fresh,'critical',fresh)),/>0%</);
 assert.match(render(reconBatteryEvidence(null,null,null,null)),/Percentage not reported/);
 assert.doesNotMatch(legacy.text({battery_percent:null},now),/^0%/);
});
test('battery percentage and condition keep separate observation timestamps',()=>{
 const value=reconBatteryEvidence(72,old,'low',fresh),text=render(value);
 assert.equal(value.percentObservedAt,old);assert.equal(value.statusObservedAt,fresh);assert.match(text,/72%/);assert.match(text,/LOW/);assert.match(text,/older observation; current status unverified/);
 const rendered=legacy.text({battery_percent:72,battery_updated_at:old,battery_status:'low',battery_status_updated_at:fresh},now);
 assert.match(rendered,/older reading; current battery unverified/);assert.match(rendered,/Condition LOW/);assert.match(rendered,/recent vendor reading/);
});
test('missing, future or malformed battery times never inherit a fresh health timestamp',()=>{
 for(const at of [null,'bad','2027-01-01T00:00:00Z','2026-02-30T00:00:00Z']){
  const text=render(reconBatteryEvidence(72,at,'low',at));assert.match(text,/Not recorded \/ invalid/);assert.doesNotMatch(text,/within 15-minute presentation window/);
  assert.match(legacy.text({battery_percent:72,battery_updated_at:at,source_last_seen_at:fresh},now),/current battery unverified/);
 }
});
test('native Recon resource displays battery and actual provider access without suggesting direct ports',()=>{
 const row=resource(1,'RII-001',{type:'detector',batteryEvidence:reconBatteryEvidence(0,fresh,'critical',fresh)});
 const text=renderToStaticMarkup(React.createElement(CameraResourceObservations,{rows:[row],now}));
 assert.match(text,/0%/);assert.match(text,/CRITICAL/);assert.match(text,/Open Recon details &amp; history/);assert.match(text,/href="https:\/\/na.reconeyez.com"/);assert.match(text,/Direct camera IP \/ ports are not provided/);
 assert.doesNotMatch(text,/Open saved IP \/ ports/);
 const untrusted=renderToStaticMarkup(React.createElement(CameraResourceObservations,{rows:[row],now,trusted:false}));assert.doesNotMatch(untrusted,/>0%</);
});
test('native Recon family filter does not depend on online status',()=>{
 for(const unit of ['RI-001','RII-002','Recon 003','Recon 2 004'])assert.equal(cameraFamily([{...resource(1,unit,{type:'detector'}),status:'review'}],'recon'),true);
 for(const unit of ['Recon #003','RI #004','Recon   II 005'])assert.equal(cameraFamily([resource('tracker:'+unit,unit,{type:'tracker_unit',trackerOnly:true,evidence:undefined})],'recon'),true);
 for(const unit of ['RII-007-junk','SNIPER 2 005'])assert.equal(cameraFamily([resource(2,unit,{type:'tracker_unit',trackerOnly:true,evidence:undefined})],'recon'),false);
});
test('battery DTO validation rejects invalid types without inventing data on older responses',()=>{
 const row=resource(1,'RI-001',{type:'detector'});assert.equal(validateCameraHealth(snapshot([row])).rows[0].batteryEvidence,undefined);
 for(const change of [{percent:false},{percent:101},{status:['normal']},{percentObservedAt:42},{source:'Other'}])assert.throws(()=>validateCameraHealth(snapshot([{...row,batteryEvidence:{...reconBatteryEvidence(72,fresh,'normal',fresh),...change}}])),/battery/);
});
test('Recon access links only use the established provider host',()=>{
 assert.equal(legacy.cloudUrl({cloud_url:'https://na.reconeyez.com/events/1'}),'https://na.reconeyez.com/events/1');
 for(const url of ['https://evil.test/x','https://na.reconeyez.com.evil.test','https://user:pass@na.reconeyez.com','http://na.reconeyez.com','javascript:alert(1)','https://na.reconeyez.com:8443/x'])assert.equal(legacy.cloudUrl({cloud_url:url}),'https://na.reconeyez.com');
});
test('legacy sync copy distinguishes inventory from a new device measurement',()=>{
 const source=readFileSync(new URL('../../camera-detail.html',import.meta.url),'utf8');assert.match(source,/Sync Recon inventory/);assert.match(source,/Syncing inventory does not request a new status or battery reading/);assert.match(source,/portKeys=cameraGroup\(device\)==='Reconeyez'\?\[\]/);
 for(const page of ['camera-detail.html','camera-health.html'])assert.match(readFileSync(new URL('../../'+page,import.meta.url),'utf8'),/recon-battery\.js/);
});
