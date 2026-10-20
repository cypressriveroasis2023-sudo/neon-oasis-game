import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOperationalFleet} from '../../supabase/functions/cos-operations-pages/operationalFleetOverlay.ts';
import {currentOperationalMhelp} from '../src/operationalMhelpDisplay.ts';
const sourceSha='a'.repeat(64),now='2026-10-19T12:34:00Z';
const source={sourceSha256:sourceSha,records:[
 {productId:'101',unitNumber:'Ranger 028',lifecycle:'UNFLAGGED',placement:'FIELD',sourceAddress:{street:'1 Old St',city:'Houston',state:'TX',zip:'77002'}},
 {productId:'102',unitNumber:'Spotter 304HDC4',lifecycle:'UNFLAGGED',placement:'SHOP',sourceAddress:{street:'COS Shop',city:'Houston',state:'TX',zip:'77064'}}
]};
const native={id:'22222222-2222-4222-8222-222222222222',unitNumber:'Spotter 304HDC4',placement:'SHOP',currentLocationType:'shop',status:'available',customer:'Cameras OnSite',address:'COS Shop',
 latitude:29.2,longitude:-95.1,hasUnitGps:true,coordinateSource:'verified',locationHistoryId:'33333333-3333-4333-8333-333333333333',activeInventoryEligible:true,
 effectivePlacement:{contract:'COS_EFFECTIVE_FLEET_PLACEMENT_V1',state:'shop',source:'mhelpdesk',observedAt:now,freshness:'recorded',reason:null}};
const sourceRecord={id:'mhelp_product:101',kind:'source_equipment',unitId:null,unit:null,unitNumber:'Ranger 028',placement:'field',active:true,lifecycle:'active',
 source:'mhelpdesk_api',sourceAddress:source.records[0].sourceAddress,customer:'Synthetic Builder',observedAt:now,productIds:['101'],sourceRecordIds:['mhelp_product:101'],representedUnitIds:[],reviewReason:null};
const linkedRecord={id:'cos_unit:'+native.id,kind:'unit',unitId:native.id,unit:native,unitNumber:native.unitNumber,placement:'shop',active:true,lifecycle:'active',
 source:'mhelpdesk_api',sourceAddress:source.records[1].sourceAddress,customer:'Cameras OnSite',observedAt:now,productIds:['102'],sourceRecordIds:['mhelp_product:102'],representedUnitIds:[native.id],reviewReason:null};
const snapshot={uploadInventory:source,inventoryItems:[native],items:[],fleetRoster:{contract:'COS_COMBINED_FLEET_ROSTER_V1',items:[sourceRecord,linkedRecord],summary:{}},
 placementSummary:{fieldUnits:0,shopUnits:1,reviewUnits:0},summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0,addressUnits:0}};
const overrides={contract:'COS_OPERATIONAL_OVERRIDES_V1',sourceSha256:sourceSha,held:0,items:[
 {productId:'101',unitNumber:'Ranger 028',revision:1,placement:'SHOP',customer:'Cameras OnSite',site:'SHOP',address:'9949 W Sam Houston Pkwy N, Houston, TX',syncState:'pending',updatedAt:now},
 {productId:'102',unitNumber:'Spotter 304HDC4',revision:1,placement:'FIELD',customer:'Client',site:'Worksite',address:'300 New Rd, Houston, TX',syncState:'pending',updatedAt:now}
]};
test('exact Product-ID owner movement updates both linked and unlinked Fleet without changing stored source or camera identity',()=>{
 const before=structuredClone(snapshot);
 const result=projectOperationalFleet(snapshot,overrides);
 assert.equal(result.fleetRoster.summary.field,1);
 assert.equal(result.fleetRoster.summary.shop,1);
 assert.equal(result.items.length,1);
 const ranger=result.fleetRoster.items[0],spotter=result.fleetRoster.items[1];
 assert.equal(ranger.placement,'shop');assert.equal(ranger.unit,null);assert.equal(ranger.source,'owner');
 assert.equal(spotter.placement,'field');assert.equal(spotter.unit.id,native.id);
 assert.equal(spotter.unit.address,'300 New Rd, Houston, TX');
 assert.equal(spotter.unit.latitude,null);assert.equal(spotter.unit.locationHistoryId,null);
 assert.equal(snapshot.inventoryItems[0].latitude,29.2);
 assert.equal(snapshot.inventoryItems[0].locationHistoryId,native.locationHistoryId);
 assert.deepEqual(snapshot,before);
});
test('a saved old mHelp address pin is not shown after an Owner transfer',()=>{
 const raw={sourceSha256:sourceSha,payloadSha256:'b'.repeat(64),totalField:1,matched:1,addressReview:0,unlocated:0,reviews:[],pins:[{id:'mhelp_product:101',productId:'101',state:'matched',point:[29.2,-95.1]}]};
 const view=currentOperationalMhelp(source,overrides,raw);
 assert.equal(view.display.pins.length,0);
 assert.equal(view.field,1);assert.equal(view.shop,1);
 assert.equal(view.moved.size,2);
 assert.equal(raw.pins.length,1);
});
test('source-hash drift and forged Product ID cannot substitute a different piece of equipment',()=>{
 assert.throws(()=>projectOperationalFleet(snapshot,{...overrides,sourceSha256:'b'.repeat(64)}),/source changed/);
 assert.throws(()=>projectOperationalFleet(snapshot,{...overrides,items:[{...overrides.items[0],productId:'999'}]}),/identity changed/);
});
