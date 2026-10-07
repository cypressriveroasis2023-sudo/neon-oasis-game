import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTicketUnitContext,ticketContextTitle,ticketContextInstructions} from '../src/ticketContext.ts';
const unitId='11111111-1111-4111-8111-111111111111',siteId='22222222-2222-4222-8222-222222222222',customerId='33333333-3333-4333-8333-333333333333',otherId='44444444-4444-4444-8444-444444444444';
const unit={id:unitId,unitNumber:'Fixture unit',modelName:'Fixture model',status:'installed',currentLocationType:'site',installedSiteId:siteId};
const site={id:siteId,name:'Fixture location',customerId,status:'active'},customer={id:customerId,name:'Fixture customer',status:'active'};
const map=items=>({items,summary:{fieldUnits:items.length,mappedUnits:0,unitGps:0,missingGps:items.length},generatedAt:'2026-10-06T12:00:00Z'});
const resolve=(units=[unit],mapped=[unit],sites=[site],customers=[customer],id=unitId)=>resolveTicketUnitContext(id,{items:units},map(mapped),{items:customers},{items:sites});
test('ticket context prefills only a verified unit→installed site→active customer chain',()=>{
 const context=resolve();assert.equal(context.state,'linked');assert.equal(context.unitId,unitId);assert.equal(context.siteId,siteId);assert.equal(context.customerId,customerId);
 assert.equal(ticketContextTitle('SERVICE',context),'Service · Fixture unit');assert.match(ticketContextInstructions(context),/does not assign equipment/);assert.match(ticketContextInstructions(context),new RegExp(unitId));
});
test('an exact-name tracker candidate never substitutes for native equipment identity',()=>{
 const context=resolve([{...unit,id:otherId}],[{...unit,readOnly:true,recordSource:'tracker',installedSiteId:undefined}]);
 assert.equal(context.state,'unresolved');assert.equal(context.source,'tracker');assert.equal(context.siteId,undefined);assert.equal(context.customerId,undefined);
 assert.match(ticketContextInstructions(context),/Read-only tracker record/);
});
for(const [name,units,mapped,sites,customers] of [
 ['unit no longer installed',[{...unit,status:'returning'}],[unit],[site],[customer]],
 ['missing installed FK',[{...unit,installedSiteId:null}],[unit],[site],[customer]],
 ['inactive site',[unit],[unit],[{...site,status:'inactive'}],[customer]],
 ['inactive customer',[unit],[unit],[site],[{...customer,status:'inactive'}]],
 ['map and equipment site disagreement',[unit],[{...unit,installedSiteId:otherId}],[site],[customer]],
])test(name+' leaves customer and site unresolved',()=>{const context=resolve(units,mapped,sites,customers);assert.equal(context.state,'unresolved');assert.equal(context.siteId,undefined);assert.equal(context.customerId,undefined);});
test('unknown, duplicate and conflicting unit identities fail closed',()=>{
 assert.throws(()=>resolve([],[]));assert.throws(()=>resolve([unit,unit]));assert.throws(()=>resolve([unit],[{...unit,readOnly:true}]));assert.throws(()=>resolve(undefined,undefined,undefined,undefined,'not-a-unit'));
});
test('different units with identical labels resolve only the selected UUID',()=>{
 const context=resolve([unit,{...unit,id:otherId,installedSiteId:null}]);assert.equal(context.unitId,unitId);assert.equal(context.siteId,siteId);
});
