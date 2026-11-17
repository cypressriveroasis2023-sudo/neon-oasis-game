import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedImportAttachment, mhelpImportClient } from '../src/mhelpImportClient.ts';
const ids={attachment:'10000000-0000-4000-8000-000000000001',org:'20000000-0000-4000-8000-000000000001',job:'30000000-0000-4000-8000-000000000001',attempt:'40000000-0000-4000-8000-000000000001'};
const source={system:'mhelpdesk',sourceTicketId:'000901',sha256:'a'.repeat(64),filename:'synthetic.pdf',byteLength:20,mimeType:'application/pdf',parserId:'synthetic',parserVersion:'1'};
const attachment=()=>({id:ids.attachment,organizationId:ids.org,jobId:ids.job,attemptId:ids.attempt,sha256:source.sha256,byteLength:20,state:'staged',recoverable:true,disposition:'duplicate',source:{...source}});
const ticket=()=>({source:{...source},customerId:'customer',siteId:'site',jobType:'DELIVERY',priority:'normal',title:'Synthetic',description:'Work',contactInstructions:'',unitIds:[],requestedSchedule:'',additionalInformation:'',shopPrep:false,parserData:{sourceTicketId:{value:source.sourceTicketId,sourceLabel:'Work Order No.'},units:[],additionalFields:[],warnings:[],documentText:'Synthetic'}});
test('recovery metadata must identify the requested attempt and a valid disposition',()=>{
  assert.throws(()=>checkedImportAttachment({...attachment(),disposition:'unknown'}),/recovery metadata/);
  assert.throws(()=>checkedImportAttachment({...attachment(),jobId:undefined}),/recovery metadata/);
});
test('mHelp ticket import calls are not reachable',async()=>{
  let calls=0;const client=mhelpImportClient({get:async()=>{calls++;return {data:null};},post:async()=>{calls++;return {data:attachment()};}});
  await assert.rejects(client.recoverSaved(attachment(),ticket()),/not available/);
  await assert.rejects(client.readAttempt(ids.attempt),/not available/);
  await assert.rejects(client.stage(ids.attempt,source,{arrayBuffer:async()=>new Uint8Array(20).buffer}),/not available/);
  await assert.rejects(client.adapter.commit({organizationId:ids.org,attachmentId:ids.attachment,ticket:ticket()}),/not available/);
  assert.equal(calls,0);
});
