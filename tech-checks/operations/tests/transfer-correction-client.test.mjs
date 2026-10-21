import {test} from 'node:test';
import assert from 'node:assert/strict';
import {centralDateTimeToISO,correctionChanges,draftItems,manifestFromDraft,validateCorrection,SELF_CONFIRMATION,CITED_CONFIRMATION} from '../../transfers/correction-model.js';
import {correctionClient} from '../../transfers/correction-client.js';

const IT='00000000-0000-4000-8000-000000000001',OWNER='00000000-0000-4000-8000-000000000002',SERVICE='00000000-0000-4000-8000-000000000003';
const unit={equipment_key:'Solar Spotter:041',family:'Solar Spotter',unit_tag:'041',sims:[],battery_count:1,parts:[]};
const original={...unit,equipment_key:'Solar Spotter:039',unit_tag:'039'};
const transfer={id:'00000000-0000-4000-8000-000000000010',manifest:[original],original:{actor_id:IT}};
const request={p_request_id:'00000000-0000-4000-8000-000000000011',p_transfer_id:transfer.id,p_expected_revision:1,p_items:[unit],p_photos:[],p_reason:'Synthetic verified tag correction',p_confirmation:{mode:'cited',confirmed:true,technician_id:IT,technician_confirmed_at:'2026-10-21T17:00:00Z',technician_reply:'I physically checked the saved unit and tag.',evidence_reference:'https://drive.google.com/file/d/synthetic-reply/view'}};
const savedResult=(args=request)=>({correction_id:args.p_request_id,transfer_id:args.p_transfer_id,base_revision:args.p_expected_revision,revision:args.p_expected_revision+1,state:'awaiting_service',after:args.p_items,reason:args.p_reason,applied_by:{id:OWNER,role:'owner'},confirmation_recorded_by:OWNER,original_technician:{id:IT},confirmed_by:{id:IT,mode:'cited',confirmed_at:args.p_confirmation.technician_confirmed_at},mode:'cited',confirmation:{...args.p_confirmation,confirmed_at:args.p_confirmation.technician_confirmed_at,recorded_by:OWNER},technician_reply:args.p_confirmation.technician_reply,evidence_reference:args.p_confirmation.evidence_reference,photos:args.p_photos,created_at:'2026-10-21T17:01:00Z'});
globalThis.document={body:{classList:{contains:()=>false}}};
function fixture({response=null,uploadError=null}={}){
  let subject=OWNER,active=true,preview=false,holdRead=null;const calls=[],uploads=[];
  const view=()=>({version:1,actor_id:subject,role:'owner',ready:true,transfers:[],equipment:[unit,original]});
  const context={
    getSession:()=>({user:{id:subject}}),getRole:()=> 'owner',getEffectiveRole:()=>preview?'it':'owner',
    getOwnerTestSession:()=>({preview_role:null}),getProfile:()=>({user_id:subject,role:'owner',active}),
    db:{
      rpc:async(name,args)=>{calls.push({name,args});if(holdRead)return await holdRead();return {data:name==='techcheck_transfer_correction_context_v1'?view():response};},
      storage:{from:()=>({upload:async(path,blob,options)=>{uploads.push({path,blob,options});return uploadError?{error:uploadError}:{};}})}
    }
  };
  return {client:correctionClient(context),context,calls,uploads,view,setSubject:value=>subject=value,setActive:value=>active=value,setPreview:value=>preview=value,holdRead:fn=>holdRead=fn};
}
test('Central confirmation timestamp is independent of device zone and rejects DST gap or repeated clock time',()=>{
  assert.equal(centralDateTimeToISO('2026-10-21T11:39:33'),'2026-10-21T16:39:33.000Z');
  assert.equal(centralDateTimeToISO('2026-12-21T11:39'),'2026-12-21T17:39:00.000Z');
  assert.throws(()=>centralDateTimeToISO('2026-03-08T02:30'),/invalid or repeats/);
  assert.throws(()=>centralDateTimeToISO('2026-11-01T01:30'),/invalid or repeats/);
  assert.throws(()=>centralDateTimeToISO('2026-02-30T01:30'),/invalid or repeats/);
});
test('exact family-qualified identity, optional SIMs and original manifest survive draft editing',()=>{
  const originalBytes=JSON.stringify(transfer),items=manifestFromDraft(draftItems([unit]));
  assert.deepEqual(items,[unit]);assert.equal(items[0].unit_tag,'041');assert.deepEqual(items[0].sims,[]);
  assert.deepEqual(validateCorrection({transfer,items,equipment:[unit,original],reason:request.p_reason,photos:[{equipment_key:unit.equipment_key}],confirmation:request.p_confirmation}),[unit]);
  assert.equal(JSON.stringify(transfer),originalBytes);assert.equal(correctionChanges([original],[unit]).length,2);
  const leading={...unit,sims:['00001234567890123456']};assert.equal(manifestFromDraft(draftItems([leading]))[0].sims[0],leading.sims[0]);
  assert.match(SELF_CONFIRMATION,/physically checked/);assert.match(CITED_CONFIRMATION,/as myself/);
});
test('missing matching evidence, no-op, forged identity and unsafe confirmation references are rejected locally',()=>{
  const args={transfer,items:[unit],equipment:[unit,original],reason:request.p_reason,photos:[{equipment_key:unit.equipment_key}],confirmation:request.p_confirmation};
  assert.throws(()=>validateCorrection({...args,photos:[]}),/matching/);
  assert.throws(()=>validateCorrection({...args,items:[original]}),/must change/);
  assert.throws(()=>validateCorrection({...args,items:[{...unit,unit_tag:'039'}]}),/exact registered/);
  assert.throws(()=>validateCorrection({...args,confirmation:{...args.confirmation,technician_id:OWNER}}),/original submitting technician/);
  for(const evidence_reference of ['javascript:alert(1)','https://drive.google.com.evil.example/file','https://user:password@drive.google.com/file','https://example.com/reply'])assert.throws(()=>validateCorrection({...args,confirmation:{...args.confirmation,evidence_reference}}),/Google Drive/);
  assert.throws(()=>validateCorrection({...args,confirmation:{...args.confirmation,technician_reply:'x'.repeat(5001)}}),/5,000/);
});
test('actual Owner scope is allowed after leaving test preview, while preview or inactive account cannot call correction RPC',async()=>{
  const f=fixture();assert.equal(f.client.current(),true);await f.client.read();assert.equal(f.calls.length,1);
  f.setPreview(true);assert.equal(f.client.current(),false);await assert.rejects(f.client.read(),/account or permissions/);
  f.setPreview(false);f.setActive(false);await assert.rejects(f.client.read(),/account or permissions/);assert.equal(f.calls.length,1);
});
test('read refuses late data after a real account switch and mismatched server actor',async()=>{
  const f=fixture();let resolve;f.holdRead(()=>new Promise(done=>{resolve=done;}));const read=f.client.read();f.setSubject(SERVICE);resolve({data:{...f.view(),actor_id:OWNER}});await assert.rejects(read,/account or permissions/);
  const g=fixture();g.holdRead(async()=>({data:{...g.view(),actor_id:IT}}));await assert.rejects(g.client.read(),/identity could not be verified/);
});
test('evidence path is hashed to the real actor and request; matching unit/tag shares one immutable upload',async()=>{
  const saved=savedResult();
  const f=fixture({response:saved}),photos=[{equipment_key:unit.equipment_key,blob:new Blob(['synthetic JPEG bytes'],{type:'image/jpeg'})}];
  const paths=await f.client.paths(request.p_request_id,photos);assert.equal(paths.length,2);assert.equal(paths[0].path,paths[1].path);assert.match(paths[0].path,new RegExp('^'+OWNER+'/'+request.p_request_id+'/[0-9a-f]{64}\\.jpg$'));
  saved.photos=paths;const result=await f.client.submit({...request,p_photos:paths},photos);assert.equal(result.correction_id,request.p_request_id);assert.equal(f.uploads.length,1);assert.equal(f.uploads[0].options.upsert,false);
  assert.equal(f.calls.at(-1).args.p_request_id,request.p_request_id);assert.equal(f.calls.at(-1).args.p_confirmation.technician_id,IT);
});
test('save reply must match the real actor, revision and exact corrected manifest before it is treated as verified',()=>{
  const f=fixture(),saved=savedResult();
  assert.equal(f.client.verified(saved,request),true);
  for(const changed of [{revision:3},{base_revision:2},{state:'accepted'},{applied_by:{id:IT,role:'it'}},{applied_by:{id:OWNER,role:'service'}},{after:[{...unit,unit_tag:'41'}]},{reason:'Other change'},{correction_id:transfer.id},{confirmed_by:{...saved.confirmed_by,id:OWNER}},{confirmation_recorded_by:IT},{confirmation:{...saved.confirmation,recorded_by:IT}},{mode:'self'},{technician_reply:'Invented reply'},{evidence_reference:'https://drive.google.com/file/d/different/view'},{photos:[{equipment_key:unit.equipment_key,kind:'unit',path:'forged'}]}])assert.equal(f.client.verified({...saved,...changed},request),false);
});
