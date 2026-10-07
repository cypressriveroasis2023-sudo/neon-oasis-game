import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedImportAttachment, mhelpImportClient } from '../src/mhelpImportClient.ts';
const ids={attachment:'10000000-0000-4000-8000-000000000001',org:'20000000-0000-4000-8000-000000000001',job:'30000000-0000-4000-8000-000000000001',attempt:'40000000-0000-4000-8000-000000000001'};
const source={system:'mhelpdesk',sourceTicketId:'000901',sha256:'a'.repeat(64),filename:'synthetic.pdf',byteLength:20,mimeType:'application/pdf',parserId:'synthetic',parserVersion:'1'};
const attachment=()=>({id:ids.attachment,organizationId:ids.org,jobId:ids.job,attemptId:ids.attempt,sha256:source.sha256,byteLength:20,state:'staged',recoverable:true,disposition:'duplicate',source:{...source}});
const ticket=()=>({source:{...source},customerId:'customer',siteId:'site',jobType:'DELIVERY',priority:'normal',title:'Synthetic',description:'Work',contactInstructions:'',unitIds:[],requestedSchedule:'',additionalInformation:'',shopPrep:false,parserData:{sourceTicketId:{value:source.sourceTicketId,sourceLabel:'Work Order No.'},units:[],additionalFields:[],warnings:[],documentText:'Synthetic'}});
test('confirmed duplicate recovery retains its new copy and returns the existing job without readback or writes',async()=>{
  let calls=0;const client=mhelpImportClient({get:async()=>{calls++;throw Error('Should not require old import readback');},post:async()=>{calls++;throw Error('Must not replay');}});
  assert.deepEqual(await client.recoverSaved(attachment(),ticket()),{status:'duplicate',jobId:ids.job});
  assert.equal(calls,0);
});
test('duplicate recovery rejects unverified source, wrong bytes and wrong printed identity',async()=>{
  const client=mhelpImportClient({get:async()=>{throw Error('No read expected');},post:async()=>{throw Error('No write expected');}});
  for(const changed of [{source:undefined},{sha256:'b'.repeat(64)},{source:{...source,sourceTicketId:'901'}},{source:{...source,filename:'other.pdf'}},{state:'trash'}])await assert.rejects(()=>client.recoverSaved({...attachment(),...changed},ticket()));
});
test('recovery metadata must identify the requested attempt and a valid disposition',async()=>{
  assert.throws(()=>checkedImportAttachment({...attachment(),disposition:'unknown'}),/recovery metadata/);
  assert.throws(()=>checkedImportAttachment({...attachment(),jobId:undefined}),/recovery metadata/);
  const client=mhelpImportClient({get:async()=>({data:{...attachment(),attemptId:ids.attachment}}),post:async()=>{throw Error('No write');}});
  await assert.rejects(()=>client.readAttempt(ids.attempt),/different import attempt/);
});
test('newly created recovery still requires full job and attachment readback',async()=>{
  let record={jobId:ids.job,organizationId:ids.org,attachmentId:ids.attachment,status:'saved',ticket:ticket()};
  const client=mhelpImportClient({get:async()=>({data:record}),post:async()=>{throw Error('No write');}});
  const result=await client.recoverSaved({...attachment(),disposition:'created'},ticket());
  assert.equal(result.status,'saved');assert.equal(result.saved.jobId,ids.job);
  record={...record,attachmentId:ids.attempt};
  await assert.rejects(()=>client.recoverSaved({...attachment(),disposition:'created'},ticket()),/does not match every reviewed field/);
});
