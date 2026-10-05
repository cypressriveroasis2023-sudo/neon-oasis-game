import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedOwnerSnapshot,createOwnerActionSaver,hasConfirmedOwnerAction,truckApprovalDetails} from '../src/ownerActionPersistence.ts';
const old={id:'job-1',jobNumber:'TEST-101',jobType:'DELIVERY',visitId:'it-visit',status:'Unscheduled',department:'it',technician:'Jordan IT'};
const control={sites:[],truckChecks:[],itTechnicians:['Jordan IT'],serviceTechnicians:['Casey Service']};
const snapshot=(jobs=[old],extra={})=>({jobs,control:{...control,...extra}});
const assign={kind:'assign',job:old,body:{technician:'Casey Service'}};
test('owner snapshot rejects missing control collections and duplicate identities',()=>{
 assert.deepEqual(checkedOwnerSnapshot({items:[old]},control),snapshot());
 for(const bad of [{...control,truckChecks:undefined},{...control,truckChecks:[{id:'a'},{id:'a'}]}])assert.throws(()=>checkedOwnerSnapshot({items:[old]},bad));
 assert.throws(()=>checkedOwnerSnapshot({items:[old,old]},control));
});
test('owner create confirms new returned job identity, number, type and active visit',()=>{
 const action={kind:'create',body:{jobType:'DELIVERY'},previousIds:[]},response={job_id:old.id,job_number:old.jobNumber};
 assert.equal(hasConfirmedOwnerAction(snapshot(),action,response),true);
 for(const [state,change] of [[snapshot(),{...action,previousIds:[old.id]}],[snapshot([{...old,visitId:null}]),action],[snapshot([{...old,jobNumber:'wrong'}]),action]])assert.equal(hasConfirmedOwnerAction(state,change,response),false);
});
test('owner assignment requires the same active visit and exact requested technician',()=>{
 assert.equal(hasConfirmedOwnerAction(snapshot([{...old,technician:'Casey Service'}]),assign,{}),true);
 for(const patch of [{technician:'Jordan IT'},{technician:'Casey Service',visitId:'other'},{technician:'Casey Service',status:'Closed'}])assert.equal(hasConfirmedOwnerAction(snapshot([{...old,...patch}]),assign,{}),false);
});
test('owner close requires closed status and no remaining current visit',()=>{
 const action={kind:'close',job:old,body:{reason:'test'}};
 assert.equal(hasConfirmedOwnerAction(snapshot([{...old,status:'Closed',visitId:null}]),action,{}),true);
 assert.equal(hasConfirmedOwnerAction(snapshot([{...old,status:'Closed'}]),action,{}),false);
 assert.equal(hasConfirmedOwnerAction(snapshot([]),action,{}),false);
});
test('owner deletion requires matching receipt and independent absence',()=>{
 const action={kind:'remove',job:old,body:{confirmation:'DELETE TEST-101'}};
 assert.equal(hasConfirmedOwnerAction(snapshot([]),action,{job_id:old.id,deleted:true}),true);
 for(const receipt of [{},{job_id:'wrong',deleted:true},{job_id:old.id,deleted:false}])assert.equal(hasConfirmedOwnerAction(snapshot([]),action,receipt),false);
 assert.equal(hasConfirmedOwnerAction(snapshot(),action,{job_id:old.id,deleted:true}),false);
});
test('owner IT handoff checks the new visit, technician, unit and schedule',()=>{
 const body={serviceTechnician:'Casey Service',unitNumber:'TEST-SN-1',start:'2026-10-05 08:00',end:'2026-10-05 10:00'};
 const action={kind:'advance',job:old,body},response={next_visit_id:'service-visit',next_department:'service'};
 const row={...old,visitId:'service-visit',department:'service',status:'Scheduled',technician:body.serviceTechnician,equipmentUnitTag:body.unitNumber,scheduled:body.start,scheduledEnd:body.end};
 assert.equal(hasConfirmedOwnerAction(snapshot([row]),action,response),true);
 for(const patch of [{visitId:'it-visit'},{department:'it'},{technician:'Other'},{equipmentUnitTag:'Other'},{scheduledEnd:'2026-10-05 11:00'},{status:'Owner Review'}])assert.equal(hasConfirmedOwnerAction(snapshot([{...row,...patch}]),action,response),false);
 assert.equal(hasConfirmedOwnerAction(snapshot([row]),action,{next_department:'service',next_visit_id:null}),false);
});
test('truck approval requires completed and ownerApproved; nested shortages remain visible',()=>{
 const action={kind:'truck',check:{id:'check'},body:{}};
 assert.equal(hasConfirmedOwnerAction(snapshot([],{truckChecks:[{id:'check',ownerApproved:true,status:'completed'}]}),action,{}),true);
 assert.equal(hasConfirmedOwnerAction(snapshot([],{truckChecks:[{id:'check',ownerApproved:false,status:'completed'}]}),action,{}),false);
 assert.deepEqual(truckApprovalDetails({result:{owner_override:true,owner_override_missing_fields:['battery identifier',null]}}),{override:true,missing:['battery identifier']});
});
test('owner uncertainty locks retries until a validated explicit refresh',async()=>{
 let writes=0,reads=0;
 const saver=createOwnerActionSaver({post:async()=>{writes++;throw Error('lost response');}},async()=>{reads++;return snapshot();});
 assert.equal((await saver.save(assign)).status,'unconfirmed');
 assert.equal((await saver.save(assign)).status,'refresh_required');
 assert.equal(writes,1);assert.equal(reads,0);
 assert.throws(()=>saver.acknowledgeRefresh({jobs:[],control:{}}));assert.equal(saver.needsRefresh,true);
 saver.acknowledgeRefresh(snapshot());assert.equal(saver.needsRefresh,false);
 await saver.save(assign);assert.equal(writes,2);
});
test('accepted unchanged reads do not become success and cannot replay',async()=>{
 let writes=0,reads=0;
 const saver=createOwnerActionSaver({post:async()=>{writes++;return {data:{}};}},async()=>{reads++;return snapshot();});
 assert.equal((await saver.save(assign)).status,'accepted_unverified');
 assert.equal((await saver.save(assign)).status,'refresh_required');assert.equal(writes,1);assert.equal(reads,1);
});
test('owner read failure remains accepted unverified, never a failed-write claim',async()=>{
 const saver=createOwnerActionSaver({post:async()=>({data:{}})},async()=>{throw Error('read unavailable');});
 assert.equal((await saver.save(assign)).status,'accepted_unverified');assert.equal(saver.needsRefresh,true);
});
test('owner concurrent clicks send one write and only fresh matching read confirms',async()=>{
 let release,writes=0;const gate=new Promise(resolve=>release=resolve);
 const saver=createOwnerActionSaver({post:async()=>{writes++;await gate;return {data:{}};}},async()=>snapshot([{...old,technician:'Casey Service'}]));
 const first=saver.save(assign);assert.equal((await saver.save(assign)).status,'busy');release();
 assert.equal((await first).status,'confirmed');assert.equal(writes,1);assert.equal(saver.needsRefresh,false);
});
