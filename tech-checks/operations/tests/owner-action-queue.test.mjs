import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnerActionQueue,explicitOverdue} from '../src/ownerActionQueueData.ts';
const NOW=new Date('2026-10-24T21:00:00Z');
const empty=()=>({jobs:[],tasks:[],quotes:[],invoices:[],pos:[],errors:{}});

test('Owner review, quote, invoice and PO approvals are deduplicated within one queue',()=>{
 const d=empty();
 d.jobs=[{id:'j1',jobNumber:'JOB-1',status:'owner_review',needsAttention:true,customer:'Customer A',department:'service',technician:'Assigned Technician',goBack:{required:true}}];
 d.quotes=[{id:'q1',quoteNumber:'Q-1',status:'pending_owner_approval'}];
 d.invoices=[{id:'i1',invoiceNumber:'I-1',status:'pending_owner_approval'}];
 d.pos=[{id:'p1',poNumber:'P-1',status:'pending_owner_po_approval'},{id:'p2',status:'needs_review',match:'exception'}];
 const r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.counts.approval.observed,5);
 assert.equal(r.counts.customers.observed,1);
 assert.equal(r.counts.service.observed,1);
 assert.equal(r.items.filter(x=>x.sourceId==='j1').length,1);
 assert.deepEqual(r.items.find(x=>x.sourceId==='j1').areas,['approval','customers','service']);
 assert.equal(r.counts.approval.complete,true);
});

test('IT, Service, overdue and explicitly incomplete paperwork use real records',()=>{
 const d=empty();
 d.tasks=[
  {id:'it1',title:'Check router',assignedDepartment:'it',dueAt:'2026-10-23',assignedTo:'Actual Technician'},
  {id:'svc1',title:'Upload report',assignedDepartment:'service',techCheck:{complete:false}},
  {id:'other',title:'Department not supplied',status:'open'},
  {id:'done',title:'Done',status:'completed',assignedDepartment:'it'}
 ];
 const r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.counts.it.observed,1);
 assert.equal(r.counts.service.observed,1);
 assert.equal(r.counts.overdue.observed,1);
 assert.equal(r.counts.paperwork.observed,1);
 assert.equal(r.items.length,2);
 assert.equal(r.items.find(x=>x.sourceId==='it1').owner,'Actual Technician');
});

test('partial/unavailable sources never count as confirmed zero',()=>{
 const d=empty();d.jobs=null;d.quotes=null;d.errors={jobs:'unavailable',quotes:'unavailable'};
 const r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.counts.customers.observed,0);assert.equal(r.counts.customers.complete,false);
 assert.equal(r.counts.approval.complete,false);
 assert.deepEqual(r.sourceUnavailable.sort(),['jobs','quotes']);
});

test('reject actions with missing stable identities',()=>{
 const d=empty();d.jobs=[{status:'owner_review',needsAttention:true,customer:'X'}];
 const r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.items.length,0);assert.equal(r.rejectedIdentityCount,1);
 assert.equal(r.counts.approval.complete,false);
});

test('external evidence and photos require HTTPS without embedded credentials',()=>{
 const d=empty();d.tasks=[{id:'1',assignedDepartment:'service',photoUrl:'javascript:alert(1)',evidenceUrl:'https://user:pw@bad.example/1'}];
 let r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.items[0].photoUrl,null);assert.equal(r.items[0].evidenceUrl,null);
 d.tasks=[{id:'1',assignedDepartment:'service',photoUrl:'https://drive.google.com/file/d/abc/view',evidenceUrl:'https://example.com/proof'}];
 r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.items[0].photoUrl,'https://drive.google.com/file/d/abc/view');
 assert.equal(r.items[0].evidenceUrl,'https://example.com/proof');
});

test('date-only deadlines honor Chicago calendar day and invalid dates never become overdue',()=>{
 assert.equal(explicitOverdue('2026-10-24',NOW),false);
 assert.equal(explicitOverdue('2026-10-23',NOW),true);
 assert.equal(explicitOverdue('2026-10-24T19:00:00Z',NOW),true);
 assert.equal(explicitOverdue('2026-10-24T23:00:00Z',NOW),false);
 assert.equal(explicitOverdue('Not scheduled',NOW),false);
 assert.equal(explicitOverdue('2026-02-31',NOW),false);
});

test('provider folder or reported offline is never sufficient to invent a customer outage',()=>{
 const d=empty();d.jobs=[{id:'j1',customer:'Customer Folder',status:'dispatched',cameraStatus:'offline'}];
 const r=buildOwnerActionQueue(d,NOW);
 assert.equal(r.counts.customers.observed,0);assert.equal(r.items.length,0);
});
