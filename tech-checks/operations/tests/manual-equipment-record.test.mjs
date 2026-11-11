import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualEquipment,checkedManualChanges,ManualEquipmentError} from '../../supabase/functions/cos-operations-pages/manualEquipment.ts';

const P='1713914',A='10000000-0000-4000-8000-000000000001',U='00000000-0000-4000-8000-000000000001',proof='a'.repeat(64);
const blank={displayName:null,placement:null,customer:null,siteName:null,address:null,deviceLink:null,note:null};
const unsaved={contract:'COS_MANUAL_EQUIPMENT_V1',productId:P,revision:0,auditId:null,recordedAt:null,recordedBy:null,record:blank,proof};
const saved={contract:'COS_MANUAL_EQUIPMENT_V1',productId:P,revision:1,auditId:A,recordedAt:'2026-11-11T17:00:00Z',recordedBy:U,record:{...blank,placement:'FIELD'},proof:'b'.repeat(64)};
const body={expected:{productId:P,revision:0,auditId:null,proof},reason:'Installed today',requestId:A,changes:{placement:'FIELD'}};
const make=answers=>{const calls=[];return {calls,run:createManualEquipment({actorPayload:{p_actor_user_id:U,p_organization_id:'org'},rpc:async(name,args)=>{calls.push({name,args});const next=answers.shift();if(next instanceof Error)throw next;return next;}})};};
const refuses=async(promise,status,pattern)=>{await assert.rejects(promise,error=>error instanceof ManualEquipmentError&&error.status===status&&(!pattern||pattern.test(error.message)));};

test('reading passes the caller identity and returns only the verified record',async()=>{
 const {run,calls}=make([{...unsaved,extra:'ignored'}]);const r=await run(P,'GET');
 assert.deepEqual(r,unsaved);assert.equal(calls[0].name,'cos_manual_equipment_v1');assert.deepEqual(calls[0].args,{p_actor_user_id:U,p_organization_id:'org',p_product_id:P,p_action:'read'});
});
test('saving sends the reviewed record, then reads back before reporting success',async()=>{
 const {run,calls}=make([{...saved,saved:true,requestId:A,replayed:false,current:true},saved]);const r=await run(P,'POST',body);
 assert.equal(r.saved,true);assert.equal(r.record.placement,'FIELD');assert.equal(r.auditId,A);assert.equal(calls.length,2);
 assert.deepEqual(calls[0].args,{p_actor_user_id:U,p_organization_id:'org',p_product_id:P,p_action:'save',p_request_id:A,p_reason:'Installed today',p_expected:body.expected,p_changes:{placement:'FIELD'}});
 assert.equal(calls[1].args.p_action,'read');
});
test('a save is not reported as successful unless the stored record matches',async()=>{
 await refuses(make([{...saved,saved:true,requestId:A},{...saved,record:{...blank,placement:'SHOP'}}]).run(P,'POST',body),503,/may have been recorded/);
 await refuses(make([{...saved,saved:false,requestId:A}]).run(P,'POST',body),503,/uncertain/);
 await refuses(make([{...saved,saved:true,requestId:'20000000-0000-4000-8000-000000000002'}]).run(P,'POST',body),503,/uncertain/);
 await refuses(make([{...saved,auditId:'20000000-0000-4000-8000-000000000002',saved:true,requestId:A}]).run(P,'POST',body),503,/uncertain/);
});
test('a replayed request that someone has since edited over still reports what it saved',async()=>{
 const later={...saved,revision:2,auditId:'20000000-0000-4000-8000-000000000002',record:{...blank,placement:'SHOP'},proof:'c'.repeat(64)};
 const r=await make([{...saved,saved:true,requestId:A,replayed:true,current:false},later]).run(P,'POST',body);
 assert.equal(r.replayed,true);assert.equal(r.current,false);assert.equal(r.record.placement,'FIELD');
});
test('a stale screen is a conflict the person resolves, not an outage',async()=>{
 await refuses(make([Object.assign(new Error('This record was changed by someone else. Reload it and try again.'),{code:'PT409'})]).run(P,'POST',body),409,/changed by someone else/);
 await assert.rejects(make([Object.assign(new Error('boom'),{code:'XX000'})]).run(P,'POST',body),error=>!(error instanceof ManualEquipmentError));
});
test('malformed requests never reach the database',async()=>{
 for(const [id,method,b] of [['abc','GET'],['0','GET'],[P,'DELETE'],[P,'POST',{...body,reason:' '}],[P,'POST',{...body,requestId:'x'}],[P,'POST',{...body,extra:1}],[P,'POST',{...body,changes:{}}],[P,'POST',{...body,changes:{owner:'x'}}],[P,'POST',{...body,changes:{placement:'UNKNOWN'}}],[P,'POST',{...body,changes:{displayName:5}}],[P,'POST',{...body,changes:{displayName:'x'.repeat(121)}}],[P,'POST',{...body,expected:{...body.expected,productId:'2'}}],[P,'POST',{...body,expected:{...body.expected,proof:'zz'}}]]){
  const {run,calls}=make([unsaved,unsaved]);await assert.rejects(run(id,method,b),ManualEquipmentError,JSON.stringify([id,method,b]));assert.equal(calls.length,0);
 }
 assert.deepEqual(checkedManualChanges({displayName:null,placement:'SHOP'}),{displayName:null,placement:'SHOP'});
});
test('an answer that is not a verified record is refused',async()=>{
 for(const bad of [null,{},{...unsaved,productId:'2'},{...unsaved,proof:'x'},{...unsaved,record:{...blank,placement:'UNKNOWN'}},{...unsaved,record:{placement:null}},{...saved,recordedBy:null},{...unsaved,auditId:A},{...saved,revision:-1}])
  await refuses(make([bad]).run(P,'GET'),503,/could not be verified/);
});
test('history returns who, when, why, before and after',async()=>{
 const item={auditId:A,revision:1,actorId:U,recordedAt:'2026-11-11T17:00:00Z',reason:'Installed today',changes:{placement:'FIELD'},before:blank,after:{...blank,placement:'FIELD'}};
 const {run,calls}=make([{contract:'COS_MANUAL_EQUIPMENT_HISTORY_V1',productId:P,items:[item]}]);const h=await run(P,'GET',undefined,'history');
 assert.deepEqual(h.items,[item]);assert.equal(calls[0].args.p_action,'history');
 await refuses(make([{contract:'COS_MANUAL_EQUIPMENT_HISTORY_V1',productId:P,items:[{...item,actorId:'x'}]}]).run(P,'GET',undefined,'history'),503);
 await refuses(make([]).run(P,'POST',body,'history'),405);
});
