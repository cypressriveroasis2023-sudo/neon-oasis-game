import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTicketReader,projectMhelpTicketPreview,MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {MHELP_TICKET_DETAIL_EVIDENCE as capability,describeMhelpTicketDetail,projectMhelpTicketDetailEvidence,unavailableMhelpTicketDetail,describeMhelpTicketDetailFailure,projectMhelpTicketDetailFailure} from '../../supabase/functions/cos-operations-pages/mhelpTicketDetail.ts';
import {MHELP_OPERATIONAL_EVIDENCE} from '../../supabase/functions/cos-operations-pages/mhelpTicketSchema.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
const privateText='synthetic-private-detail-do-not-export',portalId='224643',detailPath='/api/v1.0/portal/224643/Tickets/781234';
const window={createdAfter:'2026-10-09T05:00:00Z',createdBefore:'2026-10-10T05:00:00Z'};
const ticket=(overrides={})=>({portalId:224643,ticketId:781234,ticketNumber:891234,typeId:12,typeName:'Service',statusId:1,customStatusId:null,deleted:false,
 creationDate:'2026-10-09T12:00:00Z',lastModDate:'2026-10-09T13:00:00Z',customerId:671234,serviceLocationId:561234,assignedTo:null,
 subject:privateText,summary:privateText,comment:null,scheduledDate:null,neededBy:null,items:null,customFields:null,...overrides});
const detail=(overrides={})=>ticket({comment:privateText,scheduledDate:'2026-10-10T12:00:00-05:00',appointmentCount:1,
 items:[{ticketItemId:123456,ticketId:781234,portalId:224643,priceListId:991234,priceListTypeId:881234,name:privateText,description:privateText,quantity:3,notes:privateText,startTime:'2026-10-09T12:00:00Z',amount:456789,rate:456789,cost:456789,taxCodeId:456789,invoiceId:456789,estimateId:456789,isBillable:true,contact:privateText,attachments:[privateText]}],
 customFields:[{id:881234,customFieldId:881235,fieldLabel:privateText,fieldValue:privateText,sortOrder:1,isRequired:true}],equipment:[671234],
 contacts:[privateText],billing:privateText,attachments:[privateText],accessToken:privateText,apiKey:privateText,[privateText]:privateText,...overrides});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(options={}){
 const calls=[];let configReads=0,renewals=0;
 const rows=options.rows||[ticket()];
 const reader=createMhelpTicketReader({getConfig:async()=>{configReads++;return options.config||{portalId,accessToken:privateText};},
  renewAccess:async()=>{renewals++;return options.renewConfig||{portalId,accessToken:'synthetic-renewed-token'};},fetch:async(url,init)=>{
   calls.push({url,init});const alternate=await options.fetcher?.(url,init,calls);if(alternate)return alternate;
   if(url.endsWith('/users/me'))return json({portalId:224643});
   if(url.endsWith('/tickettypes'))return json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Service',isActive:true}]});
   if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'Open',displayText:'Open',parentId:null,canBeParent:true}]);
   const u=new URL(url);
   if(u.pathname===detailPath)return json(Object.hasOwn(options,'detail')?options.detail:detail());
   assert.equal(u.pathname,'/api/v1.0/portal/224643/Tickets');
   const start=Number(u.searchParams.get('rowIndex'));
   return json({totalRows:rows.length,results:rows.slice(start,start+50)});
  }});
 return {...reader,calls,configReads:()=>configReads,renewals:()=>renewals};
}
const detailCalls=f=>f.calls.filter(call=>new URL(call.url).pathname===detailPath);
const assertRedacted=value=>{const serialized=JSON.stringify(value);for(const forbidden of [privateText,'781234','891234','671234','561234','123456','991234','881234','456789','contacts','billing','attachments','accessToken','apiKey','invoiceId','estimateId','isBillable','taxCodeId'])assert(!serialized.includes(forbidden),forbidden);};

test('explicit detail capability adds exactly one server-selected GET after a validated bounded preview',async()=>{
 const f=fixture(),value=await f.preview(window,capability);
 assert.equal(f.calls.length,5);assert.equal(detailCalls(f).length,1);assert.equal(f.configReads(),1);assert.equal(f.renewals(),0);
 assert.equal(f.calls.at(-1).url,'https://connect.mhelpdesk.com'+detailPath);
 for(const call of f.calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert(!call.url.includes(privateText));}
 assert.deepEqual([...new URL(f.calls.at(-1).url).searchParams],[]);
 assert.equal(value.contract,'cos-mhelpdesk-ticket-preview-v1');assert.equal(value.automaticSync,false);assert.equal(value.ticketWrites,false);
 assert.equal(value.operationalEvidence.collections.items.kinds.null,1);
 assert.equal(value.detailEvidence.state,'detail_verified');assert.equal(value.detailEvidence.sampledTickets,1);assert.equal(value.detailEvidence.nestedSampleLimit,50);
 assert.equal(value.detailEvidence.collections.items.totalEntries,1);assert.equal(value.detailEvidence.collections.items.fields.notes.nonemptyStrings,1);
 assert.equal(value.detailEvidence.collections.customFields.fields.isRequired.kinds.boolean,1);assert.equal(value.detailEvidence.collections.equipment.entryKinds.integer,1);
 assert.deepEqual(value.detailEvidence.collections.equipment.fields,{});
 assert.equal(value.detailEvidence.availability.site,'unresolved_no_join');assert.equal(value.detailEvidence.availability.schedule,'unverified_deprecated_get_fields');
 assert.equal(value.detailEvidence.availability.equipment,'unverified_write_model_candidate');assert.equal(value.detailEvidence.availability.description,'nonempty_text_present');
 assertRedacted(value.detailEvidence);assert(!JSON.stringify(value).includes(privateText));assert.deepEqual(projectMhelpTicketPreview(value,capability),value);
});
test('legacy and operational-v1 capability make no hidden detail call and preserve aggregate response',async()=>{
 const legacy=fixture(),v1=fixture(),v2=fixture();
 const old=await legacy.preview(window),structural=await v1.preview(window,MHELP_OPERATIONAL_EVIDENCE),extended=await v2.preview(window,capability);
 assert.equal(legacy.calls.length,4);assert.equal(v1.calls.length,4);assert.equal(detailCalls(legacy).length,0);assert.equal(detailCalls(v1).length,0);
 const {detailEvidence,operationalEvidence,...base}=extended;
 assert.deepEqual({...base,readAt:old.readAt},old);assert.deepEqual(operationalEvidence,structural.operationalEvidence);
 assert.deepEqual(projectMhelpTicketPreview(extended),base);
 assert.deepEqual(projectMhelpTicketPreview(extended,MHELP_OPERATIONAL_EVIDENCE),{...base,operationalEvidence});
 assert.throws(()=>projectMhelpTicketPreview(old,capability));assert.throws(()=>projectMhelpTicketPreview(structural,capability));
 assert.deepEqual(projectMhelpTicketPreview({...old,detailEvidence:{raw:privateText}}),old);
});
test('empty and ambiguous validated windows return explicit unavailable states with zero detail calls',async()=>{
 for(const count of [0,2,51,500]){
  const f=fixture({rows:Array.from({length:count},(_,i)=>ticket({ticketId:781234+i,ticketNumber:891234+i}))});
  const value=await f.preview(window,capability);assert.equal(detailCalls(f).length,0);
  assert.deepEqual(value.detailEvidence,{contract:'cos-mhelpdesk-ticket-detail-evidence-v1',scope:'single_server_selected_ticket',state:'selection_unavailable',reason:count===0?'empty_window':'ambiguous_window',sampledTickets:0});
  assert.deepEqual(projectMhelpTicketPreview(value,capability),value);
 }
});
test('malformed list, dictionary, identity and window fail before any detail request',async()=>{
 for(const options of [{rows:[ticket({portalId:999})]},{rows:[ticket({creationDate:window.createdAfter})]},
  {fetcher:url=>url.includes('/Tickets?')?json({totalRows:1,data:[],results:[]}):undefined},
  {fetcher:url=>url.includes('/Tickets?')?json({totalRows:1,results:[]}):undefined},
  {fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:[]}):undefined}]){
  const f=fixture(options);await assert.rejects(f.preview(window,capability));assert.equal(detailCalls(f).length,0);
 }
});
test('caller identities, URLs, fields, expansions and overrides fail before configuration or provider reads',async()=>{
 const f=fixture();
 for(const extra of [{ticketId:781234},{ticket_id:781234},{url:'https://elsewhere.invalid'},{portalId},{accessToken:privateText},{fields:['summary']},{expand:'items'},{detail:true},{evidence:capability}])await assert.rejects(f.preview({...window,...extra},capability),error=>error.status===400);
 for(const invalid of [null,true,'all','ticket_detail_structure_v2',{ticketId:781234}])await assert.rejects(f.preview(window,invalid),error=>error.status===400);
 assert.equal(f.configReads(),0);assert.deepEqual(f.calls,[]);
});
test('detail portal, ticket and ticket-number mismatches or malformed IDs fail closed with fixed diagnostics',async()=>{
 for(const change of [{portalId:999},{ticketId:781235},{ticketNumber:891235},{portalId:'0224643'},{ticketId:'781234/other'},{ticketId:0},{ticketNumber:null},{ticketId:1.5}]){
  const f=fixture({detail:detail(change)});
  await assert.rejects(f.preview(window,capability),error=>{
   const diagnostic=mhelpTicketDiagnostic(error);assert.equal(diagnostic.error,'MHELP_PREVIEW_DETAIL_IDENTITY_MISMATCH');assertRedacted(diagnostic);
   assert.equal(diagnostic.log.detailSchema.root.kind,'object');return true;
  });assert.equal(detailCalls(f).length,1);assert.equal(f.calls.length,5);
 }
});
test('changed source snapshot, source window and malformed flat detail have distinct sanitized failures',async()=>{
 const cases=[
  [detail({creationDate:'2026-10-09T14:00:00Z',lastModDate:'2026-10-09T15:00:00Z'}),'DETAIL_CHANGED'],
  [detail({lastModDate:'2026-10-09T14:00:00Z'}),'DETAIL_CHANGED'],[detail({assignedTo:privateText}),'DETAIL_CHANGED'],
  [detail({statusId:2}),'DETAIL_CHANGED'],[detail({deleted:true}),'DETAIL_CHANGED'],[detail({serviceLocationId:561235}),'DETAIL_CHANGED'],
  [detail({creationDate:window.createdAfter}),'DETAIL_WINDOW_MISMATCH'],
  [detail({creationDate:window.createdBefore,lastModDate:'2026-10-10T06:00:00Z'}),'DETAIL_WINDOW_MISMATCH'],
  [detail({creationDate:'2026-10-09T12:00:00'}),'DETAIL_SCHEMA'],[detail({deleted:'false'}),'DETAIL_SCHEMA'],
  [{data:detail()},'DETAIL_SCHEMA'],[{results:detail()},'DETAIL_SCHEMA'],[{data:[detail()]},'DETAIL_SCHEMA'],[null,'DETAIL_SCHEMA'],[[detail()],'DETAIL_SCHEMA']];
 for(const [response,code] of cases){
  const f=fixture({detail:response});await assert.rejects(f.preview(window,capability),error=>{
   const diagnostic=mhelpTicketDiagnostic(error);assert.equal(diagnostic.error,'MHELP_PREVIEW_'+code);assertRedacted(diagnostic);return true;
  });assert.equal(detailCalls(f).length,1);
 }
});
test('same timestamps expressed with offsets are the same verified snapshot',async()=>{
 const f=fixture({detail:detail({creationDate:'2026-10-09T07:00:00-05:00',lastModDate:'2026-10-09T08:00:00-05:00'})});
 assert.equal((await f.preview(window,capability)).detailEvidence.state,'detail_verified');
});
test('description, null/missing collections, wrong kinds and POST/PUT equipment candidates remain structural only',()=>{
 const input=detail({subject:' ',summary:null,comment:undefined,items:undefined,customFields:{secret:privateText},equipment:[{},privateText,null,1]});
 const result=describeMhelpTicketDetail(input);assert.equal(result.availability.description,'nonempty_text_absent');
 assert.deepEqual(result.fields.subject.kinds,{string:1});assert.equal(result.fields.subject.emptyStrings,1);assert.deepEqual(result.fields.comment.kinds,{absent:1});
 assert.deepEqual(result.collections.items.kinds,{absent:1});assert.equal(result.collections.items.sampledEntries,0);
 assert.deepEqual(result.collections.customFields.kinds,{object:1});assert.equal(result.collections.customFields.sampledEntries,0);
 assert.deepEqual(result.collections.equipment.entryKinds,{object:1,string:1,null:1,integer:1});assert.deepEqual(result.collections.equipment.fields,{});
 assert.equal(result.availability.equipment,'unverified_write_model_candidate');assertRedacted(result);
});
test('all fixed operational and nested structures are collected once with 50-entry caps and bounded output',()=>{
 const fields=['subject','summary','comment','customerId','serviceLocationId','categoryId','priority','typeId','typeName','statusId','customStatusId','ticketStatus','assignedTo','deleted','creationDate','lastModDate','scheduledDate','neededBy','appointmentCount','estimatedTime','lastCalledDate','nextCallDate','parentTicketId','originalTicketId','recurringRuleId','generatedByRecurring','businessUnitId'];
 const itemFields=['ticketItemId','ticketId','portalId','priceListId','priceListTypeId','name','description','quantity','currentStatus','notes','startTime','dateEntry','durationSeconds','groupId','lastUpdateUTC','sortNumber'];
 const customFields=['id','customFieldId','fieldValue','fieldLabel','sortOrder','isRequired'];
 const variants=[null,false,123,1.5,'123','2026-10-09T12:00:00Z','2026-10-09T12:00:00','/Date(123456789)/',privateText,[],{privateText},undefined,BigInt(1)];
 const entries=Array.from({length:72},(_,i)=>Object.fromEntries([...itemFields,...customFields].map((key,j)=>[key,variants[(i+j)%variants.length]])));
 const result=describeMhelpTicketDetail({...Object.fromEntries(fields.map((key,i)=>[key,variants[i%variants.length]])),items:entries,customFields:entries,equipment:variants});
 assert.deepEqual(Object.keys(result.fields),fields);assert.deepEqual(Object.keys(result.collections.items.fields),itemFields);assert.deepEqual(Object.keys(result.collections.customFields.fields),customFields);
 assert.equal(result.collections.items.totalEntries,72);assert.equal(result.collections.items.sampledEntries,50);assert.equal(result.collections.customFields.sampledEntries,50);
 assert(new TextEncoder().encode(JSON.stringify(result)).length<=16000);assertRedacted(result);assert.deepEqual(projectMhelpTicketDetailEvidence(result,1),result);
});
test('projector rejects raw extras, forged keys/counts, invalid availability and selection contradictions',()=>{
 const changes=[v=>{v.raw=privateText;},v=>{v.scope=privateText;},v=>{v.contract=privateText;},v=>{v.sampledTickets=0;},v=>{v.nestedSampleLimit=51;},
  v=>{v.fields.apiKey=privateText;},v=>{v.fields.subject.raw=privateText;},v=>{v.fields.subject.kinds[privateText]=1;},v=>{v.fields.subject.kinds.string=0;},v=>{v.fields.subject.kinds.string=1.5;},
  v=>{v.fields.subject.formats.other=2;},v=>{v.fields.subject.nonemptyStrings=-1;},v=>{v.fields.subject.emptyStrings=1;},v=>{delete v.fields.neededBy;},
  v=>{v.collections.contacts=privateText;},v=>{v.collections.items.raw=privateText;},v=>{v.collections.items.fields.amount=privateText;},v=>{v.collections.equipment.fields.id=privateText;},
  v=>{v.collections.items.totalEntries=1000001;},v=>{v.collections.items.totalEntries=0;},v=>{v.collections.items.sampledEntries=0;},v=>{v.collections.items.entryKinds.object=2;},
  v=>{v.collections.items.emptyArrays=1;},v=>{v.collections.items.entryKinds={null:1};},v=>{v.availability.description='nonempty_text_absent';},v=>{v.availability.site='ready';},v=>{v.availability.equipment='verified';},v=>{v.availability.schedule='ready';}];
 for(const change of changes){const value=describeMhelpTicketDetail(detail());change(value);assert.throws(()=>projectMhelpTicketDetailEvidence(value,1),error=>error.message==='Unsupported mHelpDesk ticket detail evidence.');}
 for(const count of [0,2,500])assert.throws(()=>projectMhelpTicketDetailEvidence(describeMhelpTicketDetail(detail()),count));
 assert.throws(()=>unavailableMhelpTicketDetail(1));assert.throws(()=>unavailableMhelpTicketDetail(501));
 for(const count of [0,2]){
  const value=unavailableMhelpTicketDetail(count);assert.deepEqual(projectMhelpTicketDetailEvidence(value,count),value);
  assert.throws(()=>projectMhelpTicketDetailEvidence({...value,fields:{}},count));assert.throws(()=>projectMhelpTicketDetailEvidence(value,count===0?2:0));
 }
});
test('fixed failure schema only reports root/data/results and core-field kinds, including forged diagnostic input',()=>{
 const evidence=describeMhelpTicketDetailFailure({data:detail(),results:[detail()],[privateText]:privateText});
 assert.equal(evidence.root.fields.ticketId,'absent');assert.equal(evidence.data.fields.ticketId,'integer');assert.equal(evidence.results.kind,'array');assertRedacted(evidence);
 const forged={...evidence,[privateText]:privateText,root:{kind:privateText,fields:{ticketId:privateText,[privateText]:privateText}}};
 assertRedacted(projectMhelpTicketDetailFailure(forged));assert.equal(projectMhelpTicketDetailFailure(forged).root.kind,'other');
 const error=new MhelpTicketError('mHelpDesk returned an unsupported flat ticket detail.');error.detailSchema=forged;
 assertRedacted(mhelpTicketDiagnostic(error));assert.equal(mhelpTicketDiagnostic(error).error,'MHELP_PREVIEW_DETAIL_SCHEMA');
});
test('one account renewal stays bounded and authenticated detail failures never renew or retry',async()=>{
 const f=fixture({fetcher:(url,init)=>url.endsWith('/users/me')&&init.headers.Authorization.endsWith(privateText)?json({secret:privateText},401):undefined});
 await f.preview(window,capability);assert.equal(f.renewals(),1);assert.equal(f.calls.length,6);assert.equal(detailCalls(f).length,1);
 assert.equal(f.calls.at(-1).init.headers.Authorization,'Bearer synthetic-renewed-token');
 for(const status of [401,403,404,429,500]){
  const g=fixture({fetcher:url=>new URL(url).pathname===detailPath?json({secret:privateText},status):undefined});
  await assert.rejects(g.preview(window,capability),error=>{const diagnostic=mhelpTicketDiagnostic(error);assert.equal(diagnostic.log.operation,'ticket_detail_read');assert.equal(diagnostic.log.providerHttpStatus,status);assert.equal(diagnostic.httpStatus,status===429?429:503);assertRedacted(diagnostic);return true;});
  assert.equal(g.calls.length,5);assert.equal(detailCalls(g).length,1);assert.equal(g.renewals(),0);
 }
 const changed=fixture({renewConfig:{portalId:'999',accessToken:'synthetic-new'},fetcher:()=>json({},401)});
 await assert.rejects(changed.preview(window,capability));assert.equal(changed.calls.length,1);assert.equal(detailCalls(changed).length,0);
});
test('detail body bytes, Content-Length, invalid JSON/UTF-8 and transport failures are sanitized',async()=>{
 const bad=[()=>new Response('x'.repeat(1048577)),()=>new Response('{}',{headers:{'Content-Length':'1048577'}}),()=>new Response('{'+privateText),()=>new Response(Uint8Array.of(0xff,0xff)),()=>{throw Error(privateText);}];
 for(const failure of bad){
  const f=fixture({fetcher:url=>new URL(url).pathname===detailPath?failure():undefined});
  await assert.rejects(f.preview(window,capability),error=>{assertRedacted(mhelpTicketDiagnostic(error));assert(error instanceof MhelpTicketError);return true;});assert.equal(detailCalls(f).length,1);
 }
});
test('detail consumes remaining shared 3 MiB response budget without expanding it',async()=>{
 const padding='x'.repeat(800000);
 const f=fixture({detail:detail({ignored:padding}),rows:[ticket({ignored:padding})],fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Service',isActive:true}],ignored:padding}):url.endsWith('/ticketstatus')?json([{statusId:1,statusText:'Open',displayText:'Open',parentId:null,canBeParent:true,ignored:padding}]):undefined});
 await assert.rejects(f.preview(window,capability),/oversized ticket response/);assert.equal(detailCalls(f).length,1);assert.equal(f.calls.length,5);
});
test('shared deadline aborts a detail fetch even if transport ignores AbortSignal, then releases busy guard',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let ready,hang=true;const started=new Promise(resolve=>{ready=resolve;});
 const f=fixture({fetcher:url=>new URL(url).pathname===detailPath&&hang?new Promise(()=>{ready();}):undefined});
 const pending=f.preview(window,capability);await started;const checked=assert.rejects(pending,error=>mhelpTicketDiagnostic(error).error==='MHELP_PREVIEW_DEADLINE');
 t.mock.timers.tick(20001);await checked;assert.equal(detailCalls(f).length,1);assert(f.calls.at(-1).init.signal.aborted);
 hang=false;const next=await f.preview(window,capability);assert.equal(next.detailEvidence.state,'detail_verified');
});
test('shared deadline covers stalled detail response body and does not reset after list read',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let ready;const started=new Promise(resolve=>{ready=resolve;});
 const f=fixture({fetcher:url=>{
  if(url.includes('/Tickets?'))t.mock.timers.tick(19000);
  if(new URL(url).pathname===detailPath)return new Response(new ReadableStream({pull(){ready();return new Promise(()=>{});}}));
 }});
 const pending=f.preview(window,capability);await started;
 const checked=assert.rejects(pending,error=>mhelpTicketDiagnostic(error).error==='MHELP_PREVIEW_DEADLINE');t.mock.timers.tick(1001);await checked;assert.equal(detailCalls(f).length,1);
});
test('detail and legacy previews share the same overlap guard before second configuration access',async()=>{
 let release,ready;const started=new Promise(resolve=>{ready=resolve;});
 const f=fixture({fetcher:url=>new URL(url).pathname===detailPath?new Promise(resolve=>{release=()=>resolve(json(detail()));ready();}):undefined});
 const pending=f.preview(window,capability);await started;
 await assert.rejects(f.preview(window),error=>error.status===409);await assert.rejects(f.preview(window,capability),error=>error.status===409);
 assert.equal(f.configReads(),1);assert.equal(detailCalls(f).length,1);release();await pending;
});

test('never-settling, rejecting or throwing stream cleanup cannot exceed deadline or retain busy guard on any read',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const endpoints=['/users/me','/tickettypes','/ticketstatus','/Tickets?',detailPath];
 for(const endpoint of endpoints)for(const mode of ['http','length','bytes','json','utf8','stall'])for(const behavior of ['never','reject','throw']){
  let active=true,ready,cleanups=0;const started=new Promise(resolve=>{ready=resolve;});
  const limit=endpoint==='/users/me'?16384:1048576;
  const f=fixture({fetcher:url=>{
   if(!active||!url.includes(endpoint))return;
   const body=new ReadableStream({
    start(controller){
     if(mode==='bytes')controller.enqueue(new Uint8Array(limit+1));
     if(mode==='json')controller.enqueue(new TextEncoder().encode('{'+privateText));
     if(mode==='utf8')controller.enqueue(Uint8Array.of(0xff));
     if(mode==='json')controller.close();
    },
    pull(){if(mode==='stall'){ready();return new Promise(()=>{});}},
    cancel(){cleanups++;if(behavior==='never')return new Promise(()=>{});if(behavior==='reject')return Promise.reject(Error(privateText));throw Error(privateText);}
   });
   if(mode!=='stall')ready();
   return new Response(body,{status:mode==='http'?403:200,headers:mode==='length'?{'Content-Length':String(limit+1)}:{}});
  }});
  let state='pending',caught;
  const pending=f.preview(window,capability).then(()=>{state='success';},error=>{state='failed';caught=error;});
  await started;for(let i=0;i<30;i++)await Promise.resolve();t.mock.timers.tick(20001);
  // Allow the deadline, response, cleanup and reader-finally microtasks to settle.
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(state,'failed',[endpoint,mode,behavior].join(' '));await pending;
  assert(caught instanceof MhelpTicketError);assertRedacted(mhelpTicketDiagnostic(caught));
  const callCount=f.calls.length;for(let i=0;i<5;i++)await Promise.resolve();assert.equal(f.calls.length,callCount,'no reads after abort');
  assert(f.calls.every(call=>call.init.signal.aborted));
  // Closed invalid-JSON streams need no underlying cancellation, all other paths do.
  if(mode!=='json')assert(cleanups>=1,[endpoint,mode,behavior].join(' '));
  active=false;const result=await f.preview(window,capability);assert.equal(result.detailEvidence.state,'detail_verified');
 }
});
test('account-401 cleanup cannot stall the one existing token renewal or issue reads after deadline',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const behavior of ['never','reject','throw']){
  let first=true;
  const f=fixture({fetcher:url=>{
   if(!first||!url.endsWith('/users/me'))return;first=false;
   return new Response(new ReadableStream({cancel(){if(behavior==='never')return new Promise(()=>{});if(behavior==='reject')return Promise.reject(Error(privateText));throw Error(privateText);}}),{status:401});
  }});
  const result=await f.preview(window,capability);assert.equal(result.detailEvidence.state,'detail_verified');assert.equal(f.renewals(),1);assert.equal(f.calls.length,6);assert.equal(detailCalls(f).length,1);
  t.mock.timers.tick(20001);assert.equal(f.calls.length,6);
  assert.equal((await f.preview(window,capability)).detailEvidence.state,'detail_verified');
 }
});

test('a late ignored-abort detail response is disposed without parsing, retries or holding the next preview',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let late,ready,active=true,cancels=0;const started=new Promise(resolve=>{ready=resolve;});
 const f=fixture({fetcher:url=>{
  if(!active||new URL(url).pathname!==detailPath)return;
  return new Promise(resolve=>{late=()=>resolve(new Response(new ReadableStream({cancel(){cancels++;return Promise.reject(Error(privateText));}})));ready();});
 }});
 const pending=f.preview(window,capability);await started;const rejected=assert.rejects(pending,error=>mhelpTicketDiagnostic(error).error==='MHELP_PREVIEW_DEADLINE');
 t.mock.timers.tick(20001);await rejected;assert.equal(f.calls.length,5);
 active=false;assert.equal((await f.preview(window,capability)).detailEvidence.state,'detail_verified');const before=f.calls.length;
 late();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(cancels,1);assert.equal(f.calls.length,before);assert.equal(f.renewals(),0);
});
