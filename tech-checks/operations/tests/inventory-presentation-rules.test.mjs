import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as native from '../../supabase/functions/cos-operations-pages/inventoryPresentationRules.ts';
import {cameraSummary as legacySummary} from '../../supabase/functions/cos-operations-pages/cameraEvidence.ts';
import {cameraSummary as placementSummary} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';

const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../../inventory-presentation-rules.js',import.meta.url),'utf8'),context);
const browser=context.COSInventoryPresentation,at='2026-10-16T12:00:00Z',now=Date.parse(at);
const master=(tag,extra={})=>({canonical_family:'Spotter',unit_tag:String(tag),source_label:'Spotter '+tag,tracker_state:'field_or_unknown',...extra});
const device=(unit,extra={})=>({id:10,device_name:'Original provider name',unit_key:unit,device_type:'IPC',activation_state:'active',organization:'Recorded site',source:'vigilant_control_center',source_status:'online',source_last_seen_at:at,...extra});

for(const [name,api] of [['browser',browser],['native',native]]){
 test(name+' inventory aliases are restricted to the eight explicitly approved integer Spotters',()=>{
  for(const tag of [182,252,253,254,263,285,298,310])for(const label of ['Spotter '+tag,'SOLARSPOTTER '+tag,'Solar_Spotter '+tag,'SS '+tag]){
   assert.equal(api.solarCompatibleSpotterKey(label),'spotter|'+tag);
   assert.equal(api.inventoryLabel(label),'Spotter '+tag);
   assert.equal(api.inventoryTrackerAlias(label,[master(tag)]),'spotter|'+tag);
  }
  for(const label of ['Solar Spotter 181','Solar Spotter 263.0','Spotter 263.1','Solar Spotter 263 DO NOT USE','DO NOT USE Solar Spotter 263','Solar Spotter 263 retired','Solar Spotter 263HDC4','SS Hybrid 263','Ranger 263']){
   assert.equal(api.solarCompatibleSpotterKey(label),null,label);
   assert.equal(api.inventoryTrackerAlias(label,[master(263)]),null,label);
   assert.equal(api.inventoryLabel(label),label);
  }
 });
 test(name+' deduplication preserves conflicting or newer exact inventory identities',()=>{
  const spotter=master(263),solar=master(263,{canonical_family:'Solar Spotter',source_label:'SOLARSPOTTER 263'});
  for(const tracker of [[],[spotter,spotter],[solar],[spotter,solar],[spotter,master('263.0')]]){
   const expected=tracker.length===2&&tracker[1].unit_tag==='263.0'?'spotter|263':null;
   assert.equal(api.inventoryTrackerAlias('SOLARSPOTTER 263',tracker),expected);
  }
  assert.equal(api.inventoryTrackerAlias('SOLARSPOTTER 263',[spotter,master(999,{source_label:'SOLARSPOTTER 263'})]),null);
 });
 test(name+' Witness exception is exact and keeps decimals and restricted source labels intact',()=>{
  for(const label of ['Spotter 046','SPOTTER052','Spotter 88'])assert.equal(api.witnessStatusNotChecked(label),true);
  for(const label of ['Spotter 046.1','Solar Spotter 046','Spotter 146','Spotter 046 DO NOT USE','Spotter 046 Camera 1'])assert.equal(api.witnessStatusNotChecked(label),false,label);
 });
}

for(const [name,summary] of [['legacy',legacySummary],['placement',placementSummary]]){
 test(name+' summary counts an approved provider alias once without changing source names or granting a health parent',()=>{
  const source=device('SOLARSPOTTER 263'),tracker=[master(263)],before=structuredClone({source,tracker});
  const result=summary([source],[],now,tracker);
  assert.equal(result.rows.length,1);assert.equal(result.inventory.trackerOnlyRecords,0);
  assert.equal(result.rows[0].unit,'SOLARSPOTTER 263');assert.equal(result.rows[0].name,'Original provider name');
  assert.deepEqual({source,tracker},before);
  const unit={id:'saved-spotter-263',unitNumber:'Spotter 263',modelName:'Spotter'};
  const info=fieldCameraHealth(unit,[unit],result,now);
  assert.equal(info.state,'unknown');assert.equal(info.rows.length,0);
 });
 test(name+' summary does not collapse decimals, DO NOT USE labels or conflicting newer family records',()=>{
  for(const label of ['SOLARSPOTTER 263.0','SOLARSPOTTER 263 DO NOT USE']){
   const source=device(label),result=summary([source],[],now,[master(263)]);
   assert.equal(result.rows.length,2);assert.equal(result.rows.find(row=>row.id===10).unit,label);
  }
  const tracker=[master(263),master(263,{canonical_family:'Solar Spotter',source_label:'SOLARSPOTTER 263'})];
  const result=summary([device('SOLARSPOTTER 263')],[],now,tracker);
  assert.equal(result.rows.filter(row=>row.trackerOnly).length,1);
  assert.equal(result.rows.find(row=>row.trackerOnly).unit,'Spotter 263');
 });
 test(name+' Witness units reject Star4Live health while retaining separately timed service reachability',()=>{
  for(const tag of ['046','052','088'])for(const status of ['online','offline']){
   const source=device('Spotter '+tag,{source_status:status,public_ip:'8.8.8.8',expected_ports:[443],connection_revision:2});
   const check={camera_device_id:10,checked_at:at,overall_status:'online',ip_reachable:true,consecutive_failures:0,confirmed_outage:false,port_status:{443:{online:true},_connection:{revision:2,ip:'8.8.8.8',checkedAt:at,status:'online',reachable:true,consecutiveFailures:0,confirmedOutage:false}}};
   const before=structuredClone({source,check}),result=summary([source],[check],now,[master(tag)]),row=result.rows[0];
   assert.equal(row.status,'review');assert.equal(result.online,0);assert.equal(result.offline,0);
   assert.equal(row.evidence.source,'Witness status not checked');assert.equal(row.evidence.status,'unknown');assert.equal(row.evidence.observedAt,null);
   assert.equal(row.serviceEvidence.source,'Direct service-port check');assert.equal(row.serviceEvidence.status,'online');assert.equal(row.serviceEvidence.observedAt,at);
   assert.deepEqual({source,check},before);
  }
 });
 test(name+' Witness tracker TCP results never become Witness-provider observations',()=>{
  const tracker=[master('046',{health_provider:'witness'})],integration=[{provider:'witness',units:{'spotter|046':{status:'offline',reachable:false,checked_at:at,confirmed_outage:true,consecutive_failures:3}}}];
  const row=summary([],[],now,tracker,integration).rows[0];
  assert.equal(row.evidence.source,'Witness status not checked');assert.equal(row.evidence.status,'unknown');assert.equal(row.checkedAt,null);
  assert.equal(row.serviceEvidence.source,'Direct service-port check (Witness inventory)');assert.equal(row.serviceEvidence.status,'offline');assert.equal(row.serviceEvidence.observedAt,at);
 });
}
