import test from 'node:test';
import assert from 'node:assert/strict';
import { canRequestGoBack, confirmedGoBack, goBackBlockedReason, hasOpenGoBack, validGoBackDraft } from '../src/deliveryGoBackData.ts';
import { createJobActionSaver, visibleJobs } from '../src/operationsWorkflowData.ts';
const jobId='11111111-1111-4111-8111-111111111111', oldVisit='22222222-2222-4222-8222-222222222222', newVisit='33333333-3333-4333-8333-333333333333', requestId='44444444-4444-4444-8444-444444444444';
const draft={requestId,reason:'Finish installation',remainingWork:'Secure cable',partsNeeded:'Clips',returnNotes:'Call at gate'};
const saved={jobId,visitId:newVisit,previousVisitId:oldVisit,...draft,status:'planned',required:true,completionVerified:false,completedAt:null};
const base={id:jobId,jobType:'DELIVERY',status:'Owner Review',goBackAvailable:true,invoiceNumber:null};
const row={...base,visitId:newVisit,status:'Unscheduled',billingReady:false,goBack:saved};
test('completed delivery can request a return but closed, paid, invoices, unrelated jobs and active returns cannot',()=>{
  assert.equal(canRequestGoBack(base),true);
  for(const change of [{goBackAvailable:false},{status:'Closed'},{status:'Paid'},{invoiceNumber:'INV-1'},{jobType:'SERVICE'},{goBack:saved},{status:'Scheduled'}])assert.equal(canRequestGoBack({...base,...change}),false);
  assert.match(goBackBlockedReason({...base,status:'Closed'}),/cannot reopen/);
  assert.equal(canRequestGoBack({...base,status:'Billing Ready'}),true);
});
test('reason or remaining work is required, parts and scheduling remain optional',()=>{
  assert.equal(validGoBackDraft({...draft,reason:'',remainingWork:' ',partsNeeded:'bring cable'}),false);
  assert.equal(validGoBackDraft({...draft,reason:'',remainingWork:'Finish install',partsNeeded:'',returnNotes:''}),true);
  assert.equal(validGoBackDraft({...draft,reason:'x'.repeat(4001)}),false);
});
test('verified persisted identity, new visit, notes and nonbilling state are required',()=>{
  assert.equal(confirmedGoBack([row],jobId,draft),true);
  for(const change of [{status:'Owner Review'},{billingReady:true},{visitId:oldVisit},{goBack:{...saved,requestId:oldVisit}},{goBack:{...saved,previousVisitId:newVisit}},{goBack:{...saved,partsNeeded:'Changed'}},{goBack:{...saved,required:false}}]) assert.equal(confirmedGoBack([{...row,...change}],jobId,draft),false);
});
test('dispatch includes unscheduled go-backs and normal queues retain semantics',()=>{
  const normal={...base,id:'other',status:'Unscheduled'};
  assert.deepEqual(visibleJobs([row,normal],'dispatch'),[row]);
  assert.deepEqual(visibleJobs([row,normal],'unscheduled'),[row,normal]);
  assert.deepEqual(visibleJobs([row,normal],'review'),[]);
});
test('write happens once, repeated clicks lock, uncertainty needs explicit readback',async()=>{
  let writes=0,resolveWrite;const api={post:async()=>{writes++;await new Promise(r=>resolveWrite=r);},get:async()=>({data:{items:[base]}})};
  const saver=createJobActionSaver(api),pending=saver.save('/go-back',draft,rows=>confirmedGoBack(rows,jobId,draft));
  assert.equal((await saver.save('/go-back',draft,()=>true)).status,'busy');resolveWrite();
  assert.equal((await pending).status,'accepted_unverified');
  assert.equal((await saver.save('/go-back',draft,()=>true)).status,'refresh_required');assert.equal(writes,1);
  saver.acknowledgeRefresh({items:[row]});assert.equal(saver.needsRefresh,false);
});


test('an unverified completed return stays visibly open in client guards',()=>{
 const corrupt={...row,goBack:{...saved,status:'completed',required:true,completionVerified:false}};
 assert.equal(hasOpenGoBack(corrupt),true);assert.equal(canRequestGoBack(corrupt),false);
});
