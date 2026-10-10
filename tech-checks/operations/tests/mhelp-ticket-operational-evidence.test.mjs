import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMhelpOperationalEvidence,projectMhelpOperationalEvidence,MHELP_OPERATIONAL_EVIDENCE} from '../../supabase/functions/cos-operations-pages/mhelpTicketSchema.ts';
import {createMhelpTicketReader,projectMhelpTicketPreview} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
const secret='synthetic-private-do-not-export',portalId='224643';
const window={createdAfter:'2026-10-08T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'};
const ticket=(overrides={})=>({ticketId:1,ticketNumber:101,portalId:224643,typeId:12,statusId:1,customStatusId:null,deleted:false,
 creationDate:'2026-10-09T12:00:00Z',lastModDate:'2026-10-09T12:00:00Z',assignedTo:null,serviceLocationId:333777,
 subject:secret,summary:' ',comment:secret,scheduledDate:'2026-10-09T15:00:00-05:00',neededBy:null,
 items:[{ticketItemId:989898,priceListId:989899,priceListTypeId:989900,name:secret,description:secret,quantity:2,amount:999999,contact:secret,unknownKey:secret}],
 customFields:[{customFieldId:777777,fieldLabel:secret,fieldValue:secret,unknownKey:secret}],billing:secret,attachments:[secret],unknownKey:secret,...overrides});
const json=value=>new Response(JSON.stringify(value));
function fixture(rows,results=true){
 const calls=[];let configReads=0;
 const reader=createMhelpTicketReader({getConfig:()=>{configReads++;return {portalId,accessToken:secret};},fetch:async(url,init)=>{
   calls.push({url,method:init.method});
   if(url.endsWith('/users/me'))return json({portalId:224643});
   if(url.endsWith('/tickettypes'))return json({totalRows:1,[results?'results':'data']:[{portalId:224643,typeId:12,typeName:'Service',isActive:true}]});
   if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'New',displayText:'New',canBeParent:true,parentId:null}]);
   const start=Number(new URL(url).searchParams.get('rowIndex'));
   return json({totalRows:rows.length,[results?'results':'data']:rows.slice(start,start+50)});
 }});
 return {...reader,calls,configReads:()=>configReads};
}
test('success evidence reports only fixed operational structures, never raw data, arbitrary keys, or billing fields',()=>{
 const result=describeMhelpOperationalEvidence([ticket()],1),text=JSON.stringify(result);
 for(const value of [secret,'989898','989899','989900','333777','777777','999999','unknownKey','billing','attachments','amount','contact','2026-10-09'])assert(!text.includes(value),value);
 assert.deepEqual(result.fields.subject.kinds,{string:1});assert.equal(result.fields.subject.nonemptyStrings,1);assert.equal(result.fields.summary.emptyStrings,1);
 assert.deepEqual(result.fields.scheduledDate.formats,{iso_with_zone:1});assert.deepEqual(result.fields.neededBy.kinds,{null:1});assert.equal(result.siteIdTickets,1);
 assert.equal(result.collections.items.totalEntries,1);assert.deepEqual(result.collections.items.fields.priceListId.kinds,{integer:1});
 assert.equal(result.collections.customFields.fields.fieldValue.nonemptyStrings,1);assert.deepEqual(projectMhelpOperationalEvidence(result,1),result);
 assert(new TextEncoder().encode(text).length<12000);
});
test('absent, null, empty, nonempty and non-string fields remain distinct without readiness flags',()=>{
 const rows=[ticket({subject:undefined,summary:null,comment:'',serviceLocationId:0,items:[],customFields:null}),
  ticket({subject:[],summary:{raw:secret},comment:' \t\n',serviceLocationId:null,items:null,customFields:{raw:secret}}),
  ticket({subject:13,summary:false,comment:secret,serviceLocationId:undefined,items:undefined,customFields:[]})];
 const result=describeMhelpOperationalEvidence(rows,3);
 assert.deepEqual(result.fields.subject.kinds,{absent:1,array:1,integer:1});assert.deepEqual(result.fields.summary.kinds,{null:1,object:1,boolean:1});
 assert.equal(result.fields.comment.emptyStrings,2);assert.equal(result.fields.comment.nonemptyStrings,1);assert.equal(result.siteIdTickets,0);
 assert.deepEqual(result.collections.items.kinds,{array:1,null:1,absent:1});assert.equal(result.collections.items.emptyArrays,1);assert.equal(result.collections.items.totalEntries,0);
 assert.deepEqual(result.collections.customFields.kinds,{null:1,object:1,array:1});assert.equal(result.collections.items.sampledEntries,0);
 assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes('ready'));
});
test('nested entries are sampled globally per collection, never 50 for each ticket or every field',()=>{
 const rows=Array.from({length:50},(_,i)=>ticket({ticketId:i+1,items:Array.from({length:60},()=>({name:secret})),customFields:[null,{customFieldId:12},secret]}));
 const result=describeMhelpOperationalEvidence(rows,500);
 assert.equal(result.sampledTickets,50);assert.equal(result.collections.items.totalEntries,3000);assert.equal(result.collections.items.sampledEntries,50);
 assert.deepEqual(result.collections.items.entryKinds,{object:50});assert.deepEqual(result.collections.items.fields.name.kinds,{string:50});
 assert.equal(result.collections.customFields.totalEntries,150);assert.equal(result.collections.customFields.sampledEntries,50);
 assert.deepEqual(result.collections.customFields.entryKinds,{null:17,object:17,string:16});
 assert.deepEqual(result.collections.customFields.fields.customFieldId.kinds,{absent:33,integer:17});
 assert(new TextEncoder().encode(JSON.stringify(result)).length<12000);
});
test('empty source sample is explicit and never invents field availability',()=>{
 const result=describeMhelpOperationalEvidence([],0);assert.equal(result.sampledTickets,0);assert.equal(result.siteIdTickets,0);
 assert.deepEqual(result.fields.subject,{kinds:{},formats:{},emptyStrings:0,nonemptyStrings:0});assert.equal(result.collections.items.totalEntries,0);
 assert.throws(()=>describeMhelpOperationalEvidence([],1));
});
test('server success projector rejects forged extras and inconsistent shapes with a fixed safe error',()=>{
 const changes=[v=>{v.rawTickets=[secret];},v=>{v.scope=secret;},v=>{v.contract=secret;},v=>{v.ticketSampleLimit=51;},v=>{v.nestedSampleLimit=51;},v=>{v.sampledTickets=2;},v=>{v.siteIdTickets=2;},
  v=>{v.fields.unknownKey=secret;},v=>{v.fields.subject.raw=secret;},v=>{v.fields.subject.kinds[secret]=1;},v=>{v.fields.subject.formats[secret]=1;},v=>{v.fields.subject.kinds.string=0;},
  v=>{v.fields.subject.kinds.string=1.5;},v=>{v.fields.subject.nonemptyStrings=0;},v=>{v.fields.subject.emptyStrings=-1;},v=>{v.fields.subject.formats.other=2;},
  v=>{v.collections.extra=secret;},v=>{v.collections.items.raw=secret;},v=>{v.collections.items.fields.amount={kinds:{integer:1},formats:{},emptyStrings:0,nonemptyStrings:0};},
  v=>{v.collections.items.emptyArrays=1;},v=>{v.collections.items.nonemptyArrays=0;},v=>{v.collections.items.totalEntries=1000001;},v=>{v.collections.items.totalEntries=0;},
  v=>{v.collections.items.sampledEntries=0;},v=>{v.collections.items.entryKinds.object=2;},v=>{v.collections.items.fields.name.nonemptyStrings=secret;},
  v=>{v.fields.serviceLocationId.kinds={boolean:1};},v=>{delete v.fields.comment;}];
 for(const change of changes){const value=describeMhelpOperationalEvidence([ticket()],1);change(value);assert.throws(()=>projectMhelpOperationalEvidence(value,1),error=>error.message==='Unsupported mHelpDesk operational evidence.');}
});
test('reader capability preserves default DTO and requests, with evidence from only the first validated page',async()=>{
 const rows=Array.from({length:51},(_,i)=>ticket({ticketId:i+1,ticketNumber:i+1,...(i===50?{subject:[],serviceLocationId:0,items:[secret]}:{})}));
 for(const results of [false,true]){
  const plain=fixture(rows,results),extended=fixture(rows,results),before=await plain.preview(window),after=await extended.preview(window,MHELP_OPERATIONAL_EVIDENCE);
  const {operationalEvidence,...aggregate}=after;assert.equal(before.operationalEvidence,undefined);
  assert.deepEqual({...aggregate,readAt:before.readAt},before);assert.deepEqual(plain.calls,extended.calls);assert.equal(extended.calls.length,5);
  assert.equal(operationalEvidence.sampledTickets,50);assert.deepEqual(operationalEvidence.fields.subject.kinds,{string:50});assert.equal(operationalEvidence.siteIdTickets,50);
  assert.equal(operationalEvidence.collections.items.totalEntries,50);assert(!JSON.stringify(after).includes(secret));
  assert.deepEqual(projectMhelpTicketPreview(after),aggregate);assert.deepEqual(projectMhelpTicketPreview(after,MHELP_OPERATIONAL_EVIDENCE),after);
  assert.throws(()=>projectMhelpTicketPreview(before,MHELP_OPERATIONAL_EVIDENCE));
 }
});
test('invalid internal capability fails before configuration/provider access and never broadens the window',async()=>{
 const f=fixture([ticket()]);for(const value of ['all',null,true,{fields:['summary']}])await assert.rejects(f.preview(window,value),error=>error.status===400);
 assert.equal(f.configReads(),0);assert.deepEqual(f.calls,[]);
 await assert.rejects(f.preview({...window,evidence:MHELP_OPERATIONAL_EVIDENCE}),error=>error.status===400);
 assert.equal(f.configReads(),0);
});

test('maximum kind/format variety stays within the hard evidence response bound',()=>{
 const values=[undefined,null,false,123,1.25,'123','2026-10-09T12:00:00Z','2026-10-09T12:00:00','/Date(123456789)/',secret,[],{private:secret},BigInt(1)];
 const root=['subject','summary','comment','scheduledDate','neededBy','serviceLocationId'];
 const nested=['ticketItemId','priceListId','priceListTypeId','name','description','quantity','customFieldId','fieldValue','fieldLabel'];
 const rows=Array.from({length:50},(_,index)=>({...Object.fromEntries(root.map((key,i)=>[key,values[(i+index)%values.length]])),
  items:[Object.fromEntries(nested.map((key,i)=>[key,values[(i+index)%values.length]]))],
  customFields:[Object.fromEntries(nested.map((key,i)=>[key,values[(i+index)%values.length]]))]}));
 const result=describeMhelpOperationalEvidence(rows,500),serialized=JSON.stringify(result);
 assert(new TextEncoder().encode(serialized).length<=12000);assert(!serialized.includes(secret));
 assert.equal(result.sampledTickets,50);assert.equal(result.collections.items.sampledEntries,50);
 assert.deepEqual(projectMhelpOperationalEvidence(result,500),result);
});

test('unsolicited evidence is stripped by legacy projection; explicit projection rejects all attached private shapes',async()=>{
 const preview=await fixture([ticket()]).preview(window);
 const attached={...preview,operationalEvidence:{rawTickets:[ticket()],token:secret,fields:{[secret]:secret}}};
 assert.deepEqual(projectMhelpTicketPreview(attached),preview);
 assert.throws(()=>projectMhelpTicketPreview(attached,MHELP_OPERATIONAL_EVIDENCE),error=>!error.message.includes(secret));
});
