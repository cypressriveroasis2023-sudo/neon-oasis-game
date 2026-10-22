import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptDifferences,normalizeManifest,canRecordReceipt,latestReceiptEvent,installationBatteryPlan} from '../../transfers/model.js';
import {transferClient} from '../../transfers/client.js';

const item={equipment_key:'solar_spotter:039',family:'Solar Spotter',unit_tag:'039',sims:['0012345'],battery_count:1,parts:[]};

test('receipt family comparison ignores recognized capitalization without changing signed entries',()=>{
  const actual={...item,family:'Solar spotter'},original=JSON.stringify(actual);
  assert.deepEqual(receiptDifferences([item],[actual]),[]);
  assert.equal(JSON.stringify(actual),original);
  assert.equal(normalizeManifest([actual])[0].family,'Solar spotter');
  for(const family of ['Sniper','Ranger','Spotter','Solar Spotter','Recon 2','Helios']){
    assert.deepEqual(receiptDifferences([{...item,family}],[{...item,family:family.toUpperCase()}]),[]);
  }
  assert.deepEqual(receiptDifferences([item],[{...item,family:'solar   spotter'}]),[]);
  assert.equal(receiptDifferences([{...item,family:'Unknown family'}],[{...item,family:'unknown family'}])[0].field,'family');
});

test('family normalization retains exact unit, SIM, equipment-key and battery discrepancies',()=>{
  const actual={...item,family:'Solar spotter',unit_tag:'39',sims:['12345'],battery_count:4};
  assert.deepEqual(receiptDifferences([item],[actual]).map(diff=>diff.field),['unit_tag','sims','battery_count']);
  assert.deepEqual(receiptDifferences([item],[{...item,equipment_key:'solar_spotter:041'}]).map(diff=>diff.field),['item','item']);
  assert.equal(receiptDifferences([item],[{...item,family:'Spotter'}])[0].field,'family');
});

test('saved receipt revisions remain reviewable and no longer offer ordinary receiving',()=>{
  const old={id:'old',kind:'receipt',snapshot:{revision:2},signed_at:'2026-10-22T13:10:00Z'},latest={id:'latest',kind:'receipt',snapshot:{revision:5},signed_at:'2026-10-22T13:29:00Z'};
  assert.equal(latestReceiptEvent({events:[latest,old]}),latest);
  assert.equal(canRecordReceipt({state:'awaiting_service',purpose:'installation',receipt_required:true,events:[{kind:'checkout'}]}),true);
  for(const state of ['discrepancy','accepted','returned_review','cancelled'])assert.equal(canRecordReceipt({state,events:[]}),false);
  assert.equal(canRecordReceipt({state:'awaiting_service',events:[old]}),false);
  assert.equal(canRecordReceipt({state:'awaiting_service',purpose:null,receipt_required:true,events:[old]}),false);
  assert.equal(canRecordReceipt({state:'awaiting_service',purpose:'truck_replenishment',purpose_revision:6,receipt_required:true,events:[old,latest]}),true);
  assert.equal(canRecordReceipt({state:'awaiting_service',purpose:'truck_replenishment',receipt_required:false,events:[old,latest]}),false);
});

test('truck replenishment records no battery quantity and preserves earlier signed quantities during comparison',()=>{
  const original=JSON.stringify(item),received={...item,family:'Solar spotter',battery_count:null,battery_configuration:null};
  assert.equal(normalizeManifest([received],{purpose:'truck_replenishment'})[0].battery_count,null);
  assert.throws(()=>normalizeManifest([{...received,battery_count:0}],{purpose:'truck_replenishment'}),/does not record a battery count/);
  assert.deepEqual(receiptDifferences([item],[received],{purpose:'truck_replenishment'}),[]);
  assert.equal(JSON.stringify(item),original);
  assert.deepEqual(receiptDifferences([item],[{...received,unit_tag:'39',sims:['12345']}],{purpose:'truck_replenishment'}).map(diff=>diff.field),['unit_tag','sims']);
});

test('installation battery plans follow current Owner requirements without an unsupported alternate Solar package',()=>{
  assert.equal(installationBatteryPlan('Solar spotter').configuration,'agm_4x_12v_110ah');
  assert.equal(installationBatteryPlan('Solar Spotter').count,4);
  assert.equal(installationBatteryPlan('Solar Spotter','agm_4x_12v_110ah').count,4);
  assert.equal(installationBatteryPlan('Solar Spotter').selectable,false);
  assert.equal(installationBatteryPlan('Sniper').count,2);
  assert.equal(installationBatteryPlan('Ranger').configuration,'lifepo4_1x');
  assert.equal(installationBatteryPlan('Ranger').description,'1 LiFePO4 battery');
  assert.equal(installationBatteryPlan('Helios').count,1);
  assert.equal(installationBatteryPlan('Recon 2').minimum,1);
  assert.equal(installationBatteryPlan('Recon 2').exact,false);
  assert.equal(installationBatteryPlan('Spotter').count,0);
  assert.throws(()=>normalizeManifest([{...item,battery_configuration:''}],{purpose:'installation'}),/Choose the installation battery setup/);
  assert.throws(()=>normalizeManifest([{...item,battery_configuration:'single_12v_350ah'}],{purpose:'installation'}),/Choose the installation battery setup/);
  assert.deepEqual(receiptDifferences([{...item,battery_count:4,battery_configuration:'agm_4x_12v_110ah'}],[{...item,battery_count:1,battery_configuration:'agm_4x_12v_110ah'}],{purpose:'installation'}).map(diff=>diff.field),['battery_count']);
});

function fixture(transfer,result){
  const calls=[],uploads=[];const actor='00000000-0000-4000-8000-000000000002';
  const context={getSession:()=>({user:{id:actor}}),getRole:()=> 'service',getProfile:()=>({user_id:actor,active:true,archived_at:null}),db:{
    rpc:async(name,args)=>{calls.push({name,args});return {data:name==='techcheck_transfer_readiness_v1'?{version:1,actor_id:actor,role:'service',ready:true,enabled:true,dependencies:{read:true,submit:true,privateEvidence:true},release:{reports:true,receiptLink:true,custody:true}}:name==='techcheck_transfer_context_v1'?{version:1,role:'service',transfers:[transfer],equipment:[],technicians:[]}:result};},
    storage:{from:()=>({upload:async(path,blob)=>{uploads.push({path,blob});return {};}})},
  }};
  return {client:transferClient(context),calls,uploads};
}

test('fresh receipt against a saved discrepancy is blocked before evidence upload or submission',async()=>{
  const f=fixture({id:'transfer',state:'discrepancy',events:[{id:'saved',kind:'receipt',snapshot:{revision:2}}]});
  await assert.rejects(f.client.submit({p_kind:'receipt',p_request_id:'new',p_transfer_id:'transfer',p_photos:[{path:'new.jpg'}]},[{blob:new Blob(['photo'])}]),error=>error.receiptRecorded===true&&error.rejected===true);
  assert.equal(f.uploads.length,0);
  assert.equal(f.calls.some(call=>call.name==='submit_techcheck_transfer_v1'),false);
});

test('lost-response retry verifies its exact saved receipt ID without uploading or creating a new request',async()=>{
  const args={p_kind:'receipt',p_request_id:'saved',p_transfer_id:'transfer',p_photos:[{path:'saved.jpg'}]},result={event_id:'saved',transfer_id:'transfer',revision:2,state:'discrepancy',replayed:true};
  const f=fixture({id:'transfer',state:'discrepancy',events:[{id:'saved',kind:'receipt',snapshot:{revision:2}}]},result);
  assert.equal(await f.client.submit(args,[{blob:new Blob(['photo'])}]),result);
  assert.equal(f.uploads.length,0);
  assert.deepEqual(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v1').map(call=>call.args),[args]);
});

test('purpose-aware exact retry uses v2 without rewriting its frozen signed request',async()=>{
  const args={p_kind:'receipt',p_request_id:'saved',p_transfer_id:'transfer',p_photos:[],p_purpose:'truck_replenishment'},result={event_id:'saved',transfer_id:'transfer',revision:7,state:'accepted',replayed:true};
  const f=fixture({id:'transfer',state:'accepted',purpose:'truck_replenishment',receipt_required:false,events:[{id:'saved',kind:'receipt',snapshot:{revision:7}}]},result);
  assert.equal(await f.client.submit(args,[]),result);
  assert.deepEqual(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2').map(call=>call.args),[args]);
  assert.equal(f.calls.some(call=>call.name==='submit_techcheck_transfer_v1'),false);
});

test('a frozen unsaved receipt cannot cross a new purpose revision or upload stale evidence',async()=>{
  const f=fixture({id:'transfer',state:'awaiting_service',purpose:'truck_replenishment',purpose_revision:6,revision:6,receipt_required:true,events:[]});
  await assert.rejects(f.client.submit({p_kind:'receipt',p_request_id:'not-saved',p_transfer_id:'transfer',p_expected_revision:5,p_photos:[{path:'stale.jpg'}]},[{blob:new Blob(['photo'])}]),error=>error.staleDraft===true&&error.rejected===true);
  assert.equal(f.uploads.length,0);
  assert.equal(f.calls.some(call=>call.name.startsWith('submit_techcheck_transfer_')),false);
});
