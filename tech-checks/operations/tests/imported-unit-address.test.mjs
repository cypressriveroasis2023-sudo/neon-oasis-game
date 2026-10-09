import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedImportedAddress, importedAddressCapability, importedAddressChanged, importedAddressDraft, importedAddressPayload, importedAddressProblem, importedAddressInventory } from '../src/importedUnitAddress.ts';
import { checkedInactiveInventory } from '../src/fieldMapInventory.ts';
import { inactiveUnit, inventorySnapshot } from './inactive-inventory-fixtures.mjs';

const id='11111111-1111-4111-8111-111111111111',source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',request='22222222-2222-4222-8222-222222222222';
const record=()=>({contract:'COS_APP_UNIT_ADDRESS_V1',unitId:id,unitNumber:'Solar Stand 51',sourceIdentity:{sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Stand|51'},sourceRevision:source,revision:null,placementRevision:'a'.repeat(64),placement:'FIELD',installation:{street:'100 Example Road',city:'Houston',state:'TX',zip:'77001'},siteLabel:null,sourceConflict:false,history:[],editable:true});
test('verified partial components can be repaired but malformed and denied reads cannot prefill',()=>{
 const partial={...record(),installation:{street:'100 Example Road',city:null,state:null,zip:null}};
 assert.equal(checkedImportedAddress(partial,id),partial);assert.equal(importedAddressDraft(partial).state,'');assert.match(importedAddressProblem(importedAddressDraft(partial)),/US street/);
 for(const mutate of [r=>r.contract='other',r=>r.unitId=request,r=>r.sourceRevision='bad',r=>r.revision='bad',r=>r.placementRevision='bad',r=>r.editable=false,r=>r.history=null,r=>r.history=[{}],r=>r.sourceIdentity.productId='123',r=>r.sourceIdentity.sourceRecordId='label only',r=>delete r.installation.city,r=>r.installation.city=4,r=>r.placement='SHOP',r=>delete r.sourceConflict]){const r=record();mutate(r);assert.throws(()=>checkedImportedAddress(r,id));}
});
test('no-op and whitespace-only edits create no payload and no provider work',()=>{
 const r=record(),draft=importedAddressDraft(r);assert.equal(importedAddressChanged(r,draft),false);assert.equal(importedAddressPayload(r,draft,request,true),null);
 draft.street='  100  Example Road  ';draft.state='tx';assert.equal(importedAddressChanged(r,draft),false);assert.equal(importedAddressPayload(r,draft,request,true),null);
 for(const revision of [null,request]){const current={...r,revision},caseOnly={...importedAddressDraft(current),street:'100 EXAMPLE road',city:'HOUSTON',state:'tx'};assert.equal(importedAddressChanged(current,caseOnly),false);assert.equal(importedAddressPayload(current,caseOnly,request,true),null);assert.equal(importedAddressChanged({...current,siteLabel:'Example yard'},{...caseOnly,siteLabel:'EXAMPLE YARD'}),true);}
});
test('writes require confirmation, stable revisions, minimal complete address and no customer/IP/GPS data',()=>{
 const r=record(),draft={...importedAddressDraft(r),street:'200 New Road'};
 assert.throws(()=>importedAddressPayload(r,draft,request,false),/Confirm/);assert.throws(()=>importedAddressPayload(r,draft,'label',true),/Confirm/);
 const payload=importedAddressPayload(r,draft,request,true);
 assert.deepEqual(Object.keys(payload).sort(),['requestId','expectedSourceRevision','expectedRevision','expectedPlacementRevision','placement','installation','siteLabel','confirmed'].sort());
 assert.equal(payload.expectedSourceRevision,source);assert.equal(payload.expectedRevision,null);assert.equal(payload.installation.street,'200 New Road');
 for(const patch of [{street:''},{state:'ZZ'},{city:'',zip:''},{street:'100 Main St gate code 1234'},{zip:'123'},{siteLabel:'password 123'}])assert.notEqual(importedAddressProblem({...draft,...patch}),'');
 assert.equal(importedAddressProblem({...draft,city:'',zip:'77001'}),'');assert.equal(importedAddressProblem({...draft,zip:''}),'');
});
test('Shop and Inactive clear current installation; returning to Field needs a fresh complete address',()=>{
 for(const placement of ['SHOP','INACTIVE']){const r=record(),payload=importedAddressPayload(r,{...importedAddressDraft(r),placement},request,true);assert.equal(payload.installation,null);const fresh={...r,placement,installation:null};assert.equal(importedAddressDraft(fresh).street,'');assert.notEqual(importedAddressProblem({...importedAddressDraft(fresh),placement:'FIELD'}),'');}
});
test('capability is default-off and only authorized Owner or verified IT session capability enables address editing',()=>{
 for(const role of ['Owner','IT'])assert.equal(importedAddressCapability({authorized:true,role,features:{importedUnitAddressEdit:true}}),true);
 for(const session of [null,{}, {authorized:true,role:'Service',features:{importedUnitAddressEdit:true}},{authorized:true,role:'Owner',features:{fieldLocationVerification:true}},{authorized:false,role:'Owner',features:{importedUnitAddressEdit:true}}])assert.equal(importedAddressCapability(session),false);
});
test('inventory choice uses UUID readOnly identities, never display-label joins',()=>{
 assert.deepEqual(importedAddressInventory([{id,unitNumber:'Stand 1',status:'shop',readOnly:true},{id:'Stand 2',unitNumber:'Stand 2',status:'shop',readOnly:true},{id:request,unitNumber:'Stand 3',status:'shop',readOnly:false}]).map(row=>row.id),[id]);
});
test('inactive app correction admits exact authority and rejects malformed or mismatched proof',()=>{
 const row=inactiveUnit(2,1,true);row.importedInstallation.addressAuthority={contract:'COS_APP_UNIT_ADDRESS_V1',revision:row.importedInstallation.sourceRevision,legacyUnitKey:null,legacyIdentitySha256:'d'.repeat(64),legacyPlacementSha256:'e'.repeat(64)};
 assert.equal(checkedInactiveInventory(inventorySnapshot([row])).length,1);
 for(const mutate of [r=>r.importedInstallation.addressAuthority.revision=request,r=>r.importedInstallation.addressAuthority.legacyIdentitySha256='bad',r=>r.importedInstallation.addressAuthority.extra=true,r=>r.importedInstallation.addressAuthority.legacyUnitKey='',r=>r.importedInstallation.addressAuthority.contract='wrong']){const bad=structuredClone(row);mutate(bad);assert.throws(()=>checkedInactiveInventory(inventorySnapshot([bad])));}
});
