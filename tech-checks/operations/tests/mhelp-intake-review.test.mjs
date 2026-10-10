import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedIntakeReview,intakeReviewAccess,intakeReviewHealth,intakeReviewErrorMessage,INTAKE_STATUS_STALE_MS,checkedIntakeStatus,checkedPendingScheduleStatus,pendingScheduleHealth} from '../src/mhelpIntakeReviewModel.ts';
const now=Date.parse('2026-10-10T05:00:00.000Z');
const data=(patch={})=>({contract:'cos-mhelp-intake-review-v1',enabled:false,activationAt:null,pendingReviewCount:1,createdCount:2,lastAttemptAt:null,lastSuccessAt:null,failureCount:0,retryAfter:null,lastErrorCode:null,held:[{ticketNumber:'000042',reasonCodes:['source_changed_review_required']}],heldTruncated:false,...patch});
const active=(patch={})=>checkedIntakeReview(data({enabled:true,activationAt:'2026-10-10T04:00:00.000Z',lastAttemptAt:'2026-10-10T04:59:00.000Z',lastSuccessAt:'2026-10-10T04:59:00.000Z',...patch}));
test('exact bounded saved DTO preserves leading-zero printed numbers and independent receipt counts',()=>{
 const result=checkedIntakeReview(data());assert.equal(result.held[0].ticketNumber,'000042');assert.equal(result.pendingReviewCount,1);assert.equal(result.createdCount,2);assert.equal(result.activationAt,null);
 assert.deepEqual(checkedIntakeReview(data({pendingReviewCount:30,heldTruncated:true})).held,result.held);
});
test('missing, extra and unsafe payload fields are rejected rather than displayed',()=>{
 for(const value of [null,[],{...data(),source:{body:'PRIVATE'}},{...data(),contacts:[]},{...data(),contract:'wrong'}])assert.throws(()=>checkedIntakeReview(value));
 for(const key of Object.keys(data())){const value=data();delete value[key];assert.throws(()=>checkedIntakeReview(value),key);}
 for(const value of [{ticketNumber:'42',reasonCodes:[],raw:'PRIVATE'},{ticketNumber:'<script>',reasonCodes:[]},{ticketNumber:'42',reasonCodes:['secret']},{ticketNumber:'42',reasonCodes:['toString']}])assert.throws(()=>checkedIntakeReview(data({held:[value]})));
 assert.throws(()=>checkedIntakeReview(data({lastErrorCode:'PRIVATE ERROR'})));assert.throws(()=>checkedIntakeReview(data({lastErrorCode:'toString'})));
});
test('count bounds, boolean types, truncated coverage and printed-reference bounds fail closed',()=>{
 for(const value of [-1,1.5,NaN,Infinity,'1',100000001])for(const key of ['createdCount','pendingReviewCount'])assert.throws(()=>checkedIntakeReview(data({[key]:value})));
 for(const value of [17,-1,'0'])assert.throws(()=>checkedIntakeReview(data({failureCount:value})));
 for(const patch of [{enabled:'false'},{heldTruncated:'false'},{heldTruncated:true},{pendingReviewCount:0},{pendingReviewCount:2},{pendingReviewCount:26,held:Array.from({length:26},()=>data().held[0])}])assert.throws(()=>checkedIntakeReview(data(patch)));
 assert.throws(()=>checkedIntakeReview(data({held:[{ticketNumber:'1'.repeat(129),reasonCodes:[]}]})));
 assert.throws(()=>checkedIntakeReview(data({held:[{ticketNumber:'42',reasonCodes:Array(41).fill('source_changed_review_required')}]})));
});
test('all status timestamps must be actual canonical UTC milliseconds or explicit null',()=>{
 for(const key of ['activationAt','lastAttemptAt','lastSuccessAt','retryAfter'])for(const value of ['',0,undefined,'2026-10-10T05:00:00Z','2026-02-30T05:00:00.000Z','2026-10-10T05:00:00.000+00:00'])assert.throws(()=>checkedIntakeReview(data({[key]:value})),key+' '+value);
});
test('only the normal verified Owner can render saved review status',()=>{
 const owner={authorized:true,legacyOwner:true,role:'Owner'};assert.equal(intakeReviewAccess(owner),true);
 for(const value of [null,{},[],{...owner,authorized:false},{...owner,legacyOwner:false},{...owner,role:'IT'},{...owner,role:'Service'},{...owner,role:'owner'}])assert.equal(intakeReviewAccess(value),false);
});
test('health distinguishes disabled, unknown, active saved proof and stale success with exact boundary',()=>{
 assert.equal(intakeReviewHealth(checkedIntakeReview(data()),now).state,'disabled');
 for(const patch of [{activationAt:null},{activationAt:'2026-10-10T06:00:00.000Z'},{lastSuccessAt:null},{lastSuccessAt:'2026-10-10T06:00:00.000Z'},{lastAttemptAt:'2026-10-10T06:00:00.000Z'}])assert.equal(intakeReviewHealth(active(patch),now).state,'unknown');
 assert.equal(intakeReviewHealth(active(),now).state,'review');
 assert.equal(intakeReviewHealth(active({pendingReviewCount:0,held:[]}),now).state,'recent');
 assert.equal(intakeReviewHealth(active({lastSuccessAt:new Date(now-INTAKE_STATUS_STALE_MS).toISOString()}),now).state,'review');
 assert.equal(intakeReviewHealth(active({lastSuccessAt:new Date(now-INTAKE_STATUS_STALE_MS-1).toISOString()}),now).state,'stale');
 assert.equal(intakeReviewHealth(active(),NaN).state,'unknown');
});
test('backoff and errors do not become successful because the poll was recently attempted',()=>{
 assert.equal(intakeReviewHealth(active({failureCount:1,retryAfter:'2026-10-10T05:01:00.000Z',lastErrorCode:'SOURCE_UNAVAILABLE'}),now).state,'backoff');
 assert.equal(intakeReviewHealth(active({failureCount:1,retryAfter:'2026-10-10T04:59:00.000Z',lastErrorCode:'SOURCE_UNAVAILABLE'}),now).state,'error');
 assert.equal(intakeReviewHealth(active({failureCount:0,lastErrorCode:'SOURCE_INVALID'}),now).state,'error');
});
test('read errors never expose arbitrary response or exception text',()=>{
 for(const status of [401,403,404,409,503,undefined]){const message=intakeReviewErrorMessage({message:'PRIVATE',response:{status,data:{error:'PRIVATE'}}});assert(!message.includes('PRIVATE'));assert.match(message,/unknown/);}
 assert.match(intakeReviewErrorMessage(null),/unknown/);
});
test('panel has one fixed read-only backend path and no direct RPC, vendor read, run, or mutation controls',()=>{
 const source=readFileSync(new URL('../src/MhelpIntakeReview.tsx',import.meta.url),'utf8');
 assert.deepEqual([...source.matchAll(/api\.get\('([^']+)'\)/g)].map(x=>x[1]),['/api/mhelpdesk/intake/status?capability=pending_schedule_v1']);
 assert.doesNotMatch(source,/api\.post|fetch\(|\.rpc\(|connect\.mhelpdesk|service_role|accessToken|localStorage/);
 assert.match(source,/request !== sequence\.current/);assert.match(source,/setStatus\(null\)/);
 const workspace=readFileSync(new URL('../src/UnitTrackerWorkspace.tsx',import.meta.url),'utf8');assert.match(workspace,/<MhelpIntakeReview session=\{session\}/);
});

test('completed scans distinguish unresolved receipts from assignment creation',()=>{
 const result=intakeReviewHealth(active({createdCount:0}),now);assert.equal(result.state,'review');assert.match(result.text,/source scan completed/);assert.match(result.text,/Saved receipt holds remain/);assert.doesNotMatch(result.text,/successful|created|working/i);
 const source=readFileSync(new URL('../src/MhelpIntakeReview.tsx',import.meta.url),'utf8');assert.match(source,/status.createdCount === 0/);assert.match(source,/No Tech Check assignments have been created by this intake yet/);
});

const pending=(patch={})=>({contract:'cos-mhelp-pending-status-v1',waitingCount:3,dueCount:2,oldestWaitingCreatedAt:'2026-10-10T04:30:00.000Z',lastRefreshAt:'2026-10-10T04:59:00.000Z',lastRefreshState:'deferred',lastRefreshCode:'SOURCE_UNAVAILABLE',...patch});
const extended=(patch={})=>({contract:'cos-mhelp-intake-status-pending-v1',review:data(),pendingSchedule:pending(),...patch});
import {projectIntakeStatus,projectPendingScheduleStatus,projectIntakeReview} from '../../supabase/functions/cos-operations-pages/mhelpIntakeReview.ts';
test('opt-in pending DTO is exact and old v1 preserves unavailable enrichment instead of zero waiting',()=>{
 assert.deepEqual(checkedIntakeStatus(data()),{review:data(),pendingSchedule:null});
 assert.deepEqual(projectIntakeStatus(data()),data());assert.deepEqual(projectIntakeStatus(data(),'pending_schedule_v1'),data());
 assert.deepEqual(checkedIntakeStatus(extended()),{review:data(),pendingSchedule:pending()});
 assert.deepEqual(projectIntakeStatus(extended(),'pending_schedule_v1'),extended());
 assert.deepEqual(checkedIntakeStatus(extended({pendingSchedule:null})),{review:data(),pendingSchedule:null});
 assert.throws(()=>projectIntakeStatus(extended()));assert.throws(()=>projectIntakeStatus(data(),'arbitrary'));
 for(const value of [{...extended(),extra:'PRIVATE'},{...extended(),contract:'wrong'},{...extended(),review:{...data(),source:'PRIVATE'}},{contract:extended().contract,review:data()}]){
  assert.throws(()=>checkedIntakeStatus(value));assert.throws(()=>projectIntakeStatus(value,'pending_schedule_v1'));
 }
});
test('backend and client pending DTOs reject missing/unknown fields, unbounded counts, timestamps and codes',()=>{
 const projectors=[checkedPendingScheduleStatus,projectPendingScheduleStatus];
 for(const project of projectors){
  assert.deepEqual(project(pending()),pending());
  for(const key of Object.keys(pending())){const value=pending();delete value[key];assert.throws(()=>project(value),key);}
  for(const value of [null,[],{...pending(),ticketId:'PRIVATE'},pending({contract:'wrong'})])assert.throws(()=>project(value));
  for(const key of ['waitingCount','dueCount'])for(const value of [-1,1.5,NaN,Infinity,'1',100000001])assert.throws(()=>project(pending({[key]:value})));
  for(const patch of [{dueCount:4},{waitingCount:0,dueCount:0},{oldestWaitingCreatedAt:null},{lastRefreshState:'private'},{lastRefreshState:'toString'},{lastRefreshCode:'private'},{lastRefreshCode:'toString'}])assert.throws(()=>project(pending(patch)));
  for(const key of ['oldestWaitingCreatedAt','lastRefreshAt'])for(const value of ['',0,undefined,'2026-10-10T05:00:00Z','2026-02-30T05:00:00.000Z','2026-10-10T05:00:00.000+00:00'])assert.throws(()=>project(pending({[key]:value})));
  assert.deepEqual(project(pending({waitingCount:0,dueCount:0,oldestWaitingCreatedAt:null,lastRefreshAt:null,lastRefreshState:null,lastRefreshCode:null})),pending({waitingCount:0,dueCount:0,oldestWaitingCreatedAt:null,lastRefreshAt:null,lastRefreshState:null,lastRefreshCode:null}));
  for(const lastRefreshState of [null,'created','existing','review_needed','deferred'])for(const lastRefreshCode of [null,'SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL'])assert.doesNotThrow(()=>project(pending({lastRefreshState,lastRefreshCode})));
 }
});
test('separate pending health stays waiting or unavailable even after successful discovery',()=>{
 assert.equal(intakeReviewHealth(active({pendingReviewCount:0,held:[]}),now).state,'recent');
 assert.equal(pendingScheduleHealth(null,now).state,'unavailable');
 assert.equal(pendingScheduleHealth(pending(),now).state,'deferred');
 assert.equal(pendingScheduleHealth(pending({lastRefreshCode:null,lastRefreshState:'review_needed'}),now).state,'waiting');
 assert.equal(pendingScheduleHealth(pending({waitingCount:0,dueCount:0,oldestWaitingCreatedAt:null,lastRefreshCode:null,lastRefreshState:'created'}),now).state,'empty');
 for(const patch of [{lastRefreshAt:'2026-10-10T06:00:00.000Z'},{oldestWaitingCreatedAt:'2026-10-10T06:00:00.000Z'}])assert.equal(pendingScheduleHealth(pending(patch),now).state,'unknown');
 assert.equal(pendingScheduleHealth(pending(),NaN).state,'unknown');
});
test('identity-change hold reason is fixed and accepted without broadening arbitrary codes',()=>{
 const value=data({held:[{ticketNumber:'000042',reasonCodes:['source_identity_changed_review_required']}]});
 assert.deepEqual(checkedIntakeReview(value),value);assert.deepEqual(projectIntakeReview(value),value);
});
