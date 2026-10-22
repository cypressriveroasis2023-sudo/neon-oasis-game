import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {reviewOwnerEquipmentAssignments} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts';
import {assignmentTimestampFixture,changedProducts} from './fixtures/assignment-timestamps.mjs';

globalThis.crypto??=webcrypto;
const fixture=assignmentTimestampFixture();
const invalid=/current explicit assignment review required/;
const note='I reviewed these exact existing identities and unchanged evidence.';
async function projected({items=fixture.review.items,extra={},action='read',options={},rpcError,calls=[]}={}){
 return reviewOwnerEquipmentAssignments({...fixture.options,action,...(action==='approve'?{reviewDigest:fixture.review.reviewDigest,confirmationText:note}:{}),...options,
  rpc:async(name,args)=>{calls.push({name,args});if(rpcError)throw rpcError;return {...structuredClone(fixture.review),items:structuredClone(items),approved:action==='approve',...extra};}});
}
const item=()=>structuredClone(fixture.review.items[0]);

test('complete 1001-source / 354-item review preserves exact safe projection, digest and five assignment cases',async()=>{
 assert.equal(fixture.rows.length,1001);assert.equal(fixture.rows.filter(r=>r.placement==='FIELD').length,284);
 assert.equal(fixture.review.items.filter(r=>r.continuity?.kind==='timestamp_only').length,344);
 assert.equal(fixture.review.items.filter(r=>r.continuity?.kind==='assignment_difference').length,8);
 assert.equal(fixture.review.items.filter(r=>r.sourceAssignmentChanged).length,5);
 const protectedInput=()=>({review:fixture.review,rows:fixture.rows,census:fixture.census,body:fixture.options.body,previous:fixture.options.previous});
 const before=structuredClone(protectedInput()),calls=[],out=await projected({calls});
 assert.deepEqual(out,fixture.review);assert.equal(out.reviewDigest,fixture.review.reviewDigest);
 assert.deepEqual(protectedInput(),before);assert.equal(calls.length,1);
 assert.equal(calls[0].name,'cos_owner_mhelp_assignment_review_v1');
 assert.equal(calls[0].args.p_action,'read');assert.equal(calls[0].args.p_actor_user_id,fixture.options.actorId);
 assert.equal(calls[0].args.p_organization_id,fixture.options.organizationId);
 assert.equal(calls[0].args.p_stage_id,fixture.review.stageId);
 assert.equal(calls[0].args.p_source_sha256,fixture.review.sourceSha256);
 assert.equal(calls[0].args.p_current_2027_sha256,fixture.review.censusSha256);
 const five=out.items.filter(r=>changedProducts.includes(r.productId));assert.equal(five.length,5);
 for(const id of changedProducts)assert.equal(five.find(r=>r.productId===id).after.placement,id==='2233383'?'FIELD':'SHOP');
 assert.equal(five.find(r=>r.productId==='2229931').identity.nativeUnitId,null);
 assert.equal(five.find(r=>r.productId==='2233383').current.gpsPresent,true);
 assert.equal(five.filter(r=>r.current.shopReceiptId).length,2);
 assert.equal(five.filter(r=>r.guardChanged).length,2);
});

test('ISO and PostgreSQL timestamp forms retain timezone spelling and microsecond precision',async()=>{
 const valid=[
  '2026-10-13T08:09:49Z','2026-10-13T08:09:49.646709Z','2026-10-13T08:09:49.646709+00:00',
  '2026-10-13T08:09:49.646709-05:00','2026-10-13T08:09:49+05:30',
  '2026-10-13 08:09:49+00','2026-10-13 08:09:49.646709+00',
  '2026-10-13 08:09:49.000001-05','2026-10-13 08:09:49.646709+05:30',
  '2026-10-13 08:09:49.646709+15:59','2026-10-13 08:09:49.646709-15:59',
  '2024-02-29T23:59:59.999999Z','2000-02-29T00:00:00Z','0001-01-01T00:00:00Z','9999-12-31T23:59:59Z'
 ];
 for(const value of valid){
  const r=item();r.continuity.previousAssignment.observedAt=value;r.current.shopRecordedAt=value;
  const out=(await projected({items:[r]})).items[0];
  assert.equal(out.continuity.previousAssignment.observedAt,value);assert.equal(out.current.shopRecordedAt,value);
  r.continuity.previousAssignment.observedAt='1999-01-01T00:00:00Z';r.continuity.currentAssignment.observedAt=value;
  assert.equal((await projected({items:[r]})).items[0].continuity.currentAssignment.observedAt,value);
 }
});

test('invalid calendar, clock, timezone and non-timestamp values fail closed in every evidence timestamp field',async()=>{
 const bad=[null,undefined,{},true,1,'','2026-10-13','2026-10-13T08:09:49','2026-10-13 08:09:49',
  '0000-01-01T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z','2026-01-00T00:00:00Z',
  '2026-04-31T00:00:00Z','2026-02-29T00:00:00Z','1900-02-29T00:00:00Z','2024-02-30T00:00:00Z',
  '2026-10-13T24:00:00Z','2026-10-13T08:60:00Z','2026-10-13T08:09:60Z',
  '2026-10-13T08:09:49z','2026-10-13T08:09:49+16:00','2026-10-13 08:09:49-16',
  '2026-10-13T08:09:49+05:60','2026-10-13T08:09:49+0000','2026-10-13T08:09:49+00',
  '2026-10-13 08:09:49+5','2026-10-13 08:09:49 UTC','2026-10-13 08:09:49+00:00:00',
  '2026-10-13T08:09:49.1234567Z','2026-10-13 08:09:49.1234567+00',
  ' 2026-10-13T08:09:49Z','2026-10-13T08:09:49Z ','2026-10-13T08:09:49Z\n',
  '2026-10-13T08:09:49Z trailing','x'.repeat(65)
 ];
 for(const value of bad){
  const before=item();before.continuity.previousAssignment.observedAt=value;
  await assert.rejects(projected({items:[before]}),invalid,String(value));
  const current=item();current.continuity.currentAssignment.observedAt=value;
  await assert.rejects(projected({items:[current]}),invalid,String(value));
  // Null still means an absent Shop receipt timestamp; it is not a timestamp.
  if(value!==null){const shop=item();shop.current.shopRecordedAt=value;await assert.rejects(projected({items:[shop]}),invalid,String(value));}
 }
});

test('equivalent instants retain distinct historical spellings; no evidence string or review digest is regenerated',async()=>{
 const r=item();r.continuity.previousAssignment.observedAt='2026-10-20 17:36:07.336985+00';
 r.continuity.currentAssignment.observedAt='2026-10-20T17:36:07.336985+00:00';
 const out=await projected({items:[r]});assert.deepEqual(out.items[0],r);assert.equal(out.reviewDigest,fixture.review.reviewDigest);
});

test('projection still excludes private bindings, IPs, SIMs, coordinates, link rows and receipt extensions',async()=>{
 const r=item();r.privateBinding={expectedGuard:'private-guard',sim:'private-sim'};r.identity.ip='192.0.2.99';r.current.latitude=30;
 r.continuity.previousAssignment.rawLink={secret:'private-link'};
 const before=structuredClone(r),out=await projected({items:[r],extra:{rawReceipt:{secret:'private-receipt'}}});
 assert.deepEqual(out.items[0],fixture.review.items[0]);assert.deepEqual(r,before);
 assert.doesNotMatch(JSON.stringify(out),/private-|192\.0\.2\.99|rawReceipt|rawLink|latitude/);
});

test('identity, source, stage, census, digest and continuity conflicts remain rejected',async()=>{
 const mutations=[
  r=>{r.identity.trackerId='invalid'},r=>{r.identity.nativeUnitId='invalid'},
  r=>{r.identity.nativeUnitId=null;r.identity.trackerId=null},r=>{r.identity.trackerLabel=null},
  r=>{r.productId='9999999'},r=>{r.continuity.currentAssignment.productId='9999999'},
  r=>{r.continuity.previousAssignment.customerId='invalid'},r=>{r.continuity.currentAssignment.customerId='99'},
  r=>{r.continuity.kind='assignment_difference'},r=>{r.continuity.previousAssignment.observedAt=r.continuity.currentAssignment.observedAt},
  r=>{r.eligible=false;r.blocker=null},r=>{r.sourceAssignmentChanged='false'}
 ];
 for(const mutate of mutations){const r=item();mutate(r);await assert.rejects(projected({items:[r]}),invalid);}
 await assert.rejects(projected({items:[item(),item()]}),invalid);
 for(const extra of [{stageId:'44444444-4444-4444-8444-444444444444'},{sourceSha256:'c'.repeat(64)},{censusSha256:'c'.repeat(64)},{reviewDigest:'invalid'},{approved:'false'}])await assert.rejects(projected({items:[item()],extra}),invalid);
 const blocked=item();blocked.eligible=false;blocked.blocker='Current protected state changed';
 assert.deepEqual((await projected({items:[blocked]})).items[0],blocked);
 const conflict=Object.assign(new Error('Reviewed assignment evidence changed'),{status:409}),calls=[];
 await assert.rejects(projected({rpcError:conflict,calls}),error=>error===conflict);assert.equal(calls.length,1);
});

test('invalid late item rejects the entire projection; retry preserves the complete read without implicit approval',async()=>{
 const items=structuredClone(fixture.review.items),before=structuredClone(items),calls=[];
 items[300].continuity.previousAssignment.observedAt='2026-02-30 00:00:00+00';
 await assert.rejects(projected({items,calls}),invalid);
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_action,'read');
 const out=await projected({items:before,calls});assert.deepEqual(out,fixture.review);
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.args.p_action==='read'));
 assert.equal(out.approved,false);assert.equal(items[300].continuity.previousAssignment.observedAt,'2026-02-30 00:00:00+00');
});

test('approval sends the original current digest and requires a verified approved response',async()=>{
 const calls=[],out=await projected({action:'approve',calls});
 assert.equal(out.approved,true);assert.deepEqual(out.items,fixture.review.items);assert.equal(out.reviewDigest,fixture.review.reviewDigest);
 assert.equal(calls[0].args.p_expected_digest,fixture.review.reviewDigest);assert.equal(calls[0].args.p_confirmation,note);
 await assert.rejects(projected({action:'approve',extra:{approved:false}}),invalid);
 await assert.rejects(projected({action:'approve',options:{reviewDigest:'bad'}}),invalid);
 await assert.rejects(projected({options:{verifyCensus:async()=>{throw Error('Current Google source unavailable')}}}),/CENSUS_NOT_VERIFIED/);
});
