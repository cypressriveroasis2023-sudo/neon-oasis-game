import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CameraHealthOverview from '../src/CameraHealthOverview.tsx';
import {cameraOverview} from '../src/cameraHealthCounts.ts';
import {cameraFieldProducts} from '../src/cameraFieldProducts.ts';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {resource,snapshot} from './fixtures/camera-evidence-fixtures.mjs';

const kpis=html=>[...html.matchAll(/<button[^>]*class="camera-unit-kpi[^\"]*"[^>]*><span>[^<]+<\/span><b[^>]*>(.*?)<\/b>/g)].map(match=>match[1]);
const render=(f,units=f.units)=>renderToStaticMarkup(React.createElement(CameraHealthOverview,{health:f.health,units,now:f.now,fieldMap:units?{...f.field,inventoryItems:units,fleetRoster:f.roster}:undefined}));

test('broader provider review records cannot inflate the Field unverified headline',()=>{
 const f=fieldProductFixture();
 f.health={...f.health,...snapshot([...f.health.rows,...Array.from({length:385},(_,i)=>resource(100+i,'Unresolved '+i,{scope:'unknown'}))]),identityVersion:f.health.identityVersion,unitIdentities:f.health.unitIdentities};
 const before=structuredClone(f);
 assert(cameraOverview(f.health,f.now,f.units).operational.unknown>380);
 const count=buildFleetCommandCenter(f.upload,mhelpFieldHealth(f.upload,f.roster,f.rows,f.now),true,f.rows,null,null,f.now).counts;
 const html=render(f);
 assert.deepEqual(kpis(html),[String(count.online+count.offline+count.unverified),String(count.online),String(count.offline),String(count.unverified)]);
 assert.deepEqual(kpis(html),['6','1','1','4']);
 assert.match(html,/1 online \+ 1 offline \+ 4 unverified = 6 Field camera units/);
 assert.match(html,/<details class="camera-record-breakdown"[^>]*><summary>Provider and camera record details/);
 assert.doesNotMatch(html,/<details class="camera-record-breakdown"[^>]*open/);
 assert.deepEqual(f,before);
});

test('support stays separate and unavailable roster leaves all camera products unverified',()=>{
 const f=fieldProductFixture();
 f.units[0].activeInventoryEligible=false;
 // The reviewed roster independently excludes the now-inactive unit.
 f.roster=undefined;
 assert.deepEqual(kpis(render(f)),['6','0','0','6']);
});

test('unavailable paired inventory never certifies a provider total as Field equipment',()=>{
 const f=fieldProductFixture();
 assert.deepEqual(kpis(render(f,null)),['—','—','—','—']);
});

test('same-name online provider records never bypass Product-ID identity or manual holds',()=>{
 const f=fieldProductFixture(),before=structuredClone(f);
 f.upload.records[0].binding.placementHeld=true;
 const view=cameraFieldProducts(f.field,f.health,f.now);
 assert.equal(view.counts.online,0);assert.equal(view.counts.offline,1);assert.equal(view.counts.unverified,5);
 assert.equal(view.items.find(p=>p.productId==='1001').linked.unitId,null);
 assert.equal(view.items.some(p=>p.productId==='1008'),false);
 assert.equal(view.items.find(p=>p.productId==='1004').status,'not_applicable');
 assert.deepEqual(f.health,before.health);
});
test('failed health read retains the complete Field denominator without an outage claim',()=>{
 const f=fieldProductFixture(),view=cameraFieldProducts(f.field,f.health,f.now,false);
 assert.deepEqual([view.counts.online,view.counts.offline,view.counts.unverified,view.counts.support],[0,0,6,1]);
});
test('incomplete census withholds Field headlines rather than using legacy provider groups',()=>{
 const f=fieldProductFixture();f.upload.records.pop();
 assert.equal(cameraFieldProducts(f.field,f.health,f.now),null);
 assert.deepEqual(kpis(render(f)),['—','—','—','—']);
});

test('201 camera-capable Product IDs reconcile as 72 online + 2 offline + 127 unverified, separately from 83 support and 717 Shop',()=>{
 const f=fieldProductFixture(),records=[],items=[],units=[],healthRows=[],identities=[];
 for(let i=0;i<1001;i++){
  const id=String(3000000+i),field=i<284,support=i>=201&&field,linked=i<74||support;
  const base=linked?(support?3:0):4,unitId='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  const name=(support?'ST ':'Ranger ')+(i+1),unit={...f.units[base===4?0:base],id:unitId,unitNumber:name,modelName:support?'Stand':'Ranger'};
  if(linked)units.push(unit);
  records.push({...f.upload.records[base],productId:id,recordId:'mhelp_product:'+id,unitNumber:name,category:support?'Stand':'Ranger',placement:field?'FIELD':'SHOP',uploadLifecycle:'UNFLAGGED',binding:{state:linked?'linked':'unlinked',unitIds:linked?[unitId]:[],candidateUnitIds:[],placementHeld:false}});
  items.push({...f.roster.items[base],id:linked?'cos_unit:'+unitId:'mhelp_product:'+id,kind:linked?'unit':'source_equipment',unitId:linked?unitId:null,unit:linked?unit:null,unitNumber:name,productIds:[id],sourceRecordIds:['mhelp_product:'+id],representedUnitIds:linked?[unitId]:[],placement:field?'field':'shop',lifecycle:'active',active:true});
  if(i<74){
   const row=resource(i+1,name);if(i>=72)row.evidence={...row.evidence,status:'offline'};
   healthRows.push(row);identities.push({...f.health.unitIdentities[0],unitId,unitNumber:name,deviceIds:[String(i+1)],unitKeys:[name]});
  }
 }
 const upload={...f.upload,records,summary:{totalRecords:1001,fieldRecords:284,shopRecords:717,unflaggedFieldRecords:284,unflaggedShopRecords:717,doNotUseRecords:0,missingRecords:0}};
 const roster={...f.roster,items,summary:{totalRecords:1001,activeRecords:1001,field:284,shop:717,review:0,excludedLifecycle:0,sourceOnlyRecords:844,linkedUnitRecords:157}};
 const health={...snapshot(healthRows),identityVersion:1,unitIdentities:identities,identityWarnings:[]};
 const view=cameraFieldProducts({...f.field,inventoryItems:units,uploadInventory:upload,fleetRoster:roster},health,f.now);
 assert.ok(view);assert.deepEqual([view.counts.online,view.counts.offline,view.counts.unverified,view.counts.support],[72,2,127,83]);
 assert.equal(view.field,284);assert.equal(view.shop,717);assert.equal(view.total,1001);
});

test('manual Shop projection excludes the moved product without changing accepted source or health',async()=>{
 const {projectManualShop}=await import('../../supabase/functions/cos-operations-pages/fleetShopProjection.ts');
 const f=fieldProductFixture(),before=structuredClone(f);
 const map=projectManualShop(f.field,{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[{unitId:f.units[0].id,unitNumber:f.units[0].unitNumber,auditId:'00000000-0000-4000-8000-000000000099',recordedAt:f.fresh,placement:'SHOP'}]});
 const view=cameraFieldProducts(map,f.health,f.now);
 assert.ok(view);assert.equal(view.field,6);assert.equal(view.shop,2);
 assert.equal(view.counts.online,0);assert.equal(view.items.some(p=>p.productId==='1001'),false);
 assert.deepEqual(f,before);
});
