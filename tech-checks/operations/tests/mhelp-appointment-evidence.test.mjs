import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTicketReader,projectMhelpTicketPreview,MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {MHELP_APPOINTMENT_EVIDENCE as capability,MHELP_APPOINTMENT_FIELDS,describeMhelpAppointments,projectMhelpAppointmentEvidence,unavailableMhelpAppointments} from '../../supabase/functions/cos-operations-pages/mhelpAppointments.ts';
import {mhelpAppointmentPreviewWindow} from '../../supabase/functions/cos-operations-pages/mhelpTicketDay.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
import {syntheticAppointment as appointment,appointmentEvidenceFixture} from './fixtures/mhelpAppointmentPreview.mjs';
const secret='synthetic-private-appointment-do-not-export',portalId='224643';
const window={createdAfter:'2026-10-09T05:00:00.000Z',createdBefore:'2026-10-09T22:00:00.000Z'};
const selected={ticketId:'781234',portalId,deleted:false};
const ticket=(overrides={})=>({portalId:224643,ticketId:781234,ticketNumber:891234,typeId:12,typeName:'Service',statusId:1,customStatusId:null,deleted:false,creationDate:'2026-10-09T12:00:00Z',lastModDate:'2026-10-09T13:00:00Z',customerId:671234,serviceLocationId:561234,assignedTo:null,subject:secret,summary:secret,comment:secret,scheduledDate:null,neededBy:null,...overrides});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture(options={}){
 const calls=[];let configReads=0,renewals=0;
 const rows=options.rows||[ticket()];
 const reader=createMhelpTicketReader({getConfig:async()=>{configReads++;return {portalId,accessToken:secret};},renewAccess:async()=>{renewals++;return {portalId,accessToken:'synthetic-renewed'};},fetch:async(url,init)=>{
  calls.push({url,init});const replacement=await options.fetcher?.(url,init,calls);if(replacement)return replacement;
  if(url.endsWith('/users/me'))return json({portalId:224643});
  if(url.endsWith('/tickettypes'))return json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Service',isActive:true}]});
  if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'Open',displayText:'Open',parentId:null,canBeParent:true}]);
  if(url.includes('/Tickets/'))return json(Object.hasOwn(options,'detail')?options.detail:rows[0]);
  if(url.includes('/Tickets?')){const start=Number(new URL(url).searchParams.get('rowIndex'));return json({totalRows:rows.length,results:rows.slice(start,start+50)});}
  if(url.includes('/Appointments?'))return json(Object.hasOwn(options,'appointments')?options.appointments:{TotalRows:1,results:[appointment({Subject:secret,Description:secret,Location:secret,Annotations:secret,UserId:secret,AppointmentTimeZone:secret,[secret]:secret,apiKey:secret,contacts:[secret]})]});
  throw Error('Unexpected transport');
 }});
 return {...reader,calls,configReads:()=>configReads,renewals:()=>renewals};
}
const appointmentCalls=f=>f.calls.filter(call=>call.url.includes('/Appointments?'));
const detailCalls=f=>f.calls.filter(call=>call.url.includes('/Tickets/'));
const assertRedacted=value=>{const raw=JSON.stringify(value);for(const forbidden of [secret,'991234','781234','891234','671234','561234','2026-10-11T12:00:00Z','2026-10-11T13:00:00Z','"Subject"','"Description"','"Location"','"Annotations"','contacts','apiKey','Authorization','https://'])assert(!raw.includes(forbidden),forbidden);};
const describe=(rows,total=rows.length)=>describeMhelpAppointments({TotalRows:total,results:rows},selected,window.createdAfter);

test('appointment capability consolidates existing evidence and adds exactly one projected fixed-endpoint GET after verified detail',async()=>{
 const f=fixture(),result=await f.preview(window,capability),value=result.appointmentEvidence;
 assert.equal(f.calls.length,6);assert.equal(f.configReads(),1);assert.equal(detailCalls(f).length,1);assert.equal(appointmentCalls(f).length,1);assert.equal(f.renewals(),0);
 assert(f.calls.at(-2).url.includes('/Tickets/781234'));
 const url=new URL(f.calls.at(-1).url);assert.equal(url.origin,'https://connect.mhelpdesk.com');assert.equal(url.pathname,'/api/v1.0/portal/224643/Appointments');
 assert.deepEqual(Object.fromEntries(url.searchParams),{startDateUtc:'2026-10-09T05:00:00.000Z',endDateUtc:'2026-10-16T05:00:00.000Z',pageSize:'500',sort:'StartUtc',fields:MHELP_APPOINTMENT_FIELDS.join(',')});
 for(const call of f.calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert(!call.url.includes(secret));}
 assert.equal(result.detailEvidence.state,'detail_verified');assert.equal(result.operationalEvidence.sampledTickets,1);assert.equal(value.state,'window_reviewed');assert.equal(value.completeness,'complete');
 assert.equal(value.exactMatchCount,1);assert.equal(value.linkage,'single_structural_match');assert.equal(value.technician,'unresolved_no_staff_read');assert.equal(value.schedule,'unverified_candidate_contract');
 assert.equal(value.fields.UserId.nonemptyStrings,1);assert.equal(value.fields.StartUTC.formats.iso_with_zone,1);assertRedacted(value);assertRedacted(mhelpTicketDiagnostic(new Error(secret)));
 assert.deepEqual(projectMhelpTicketPreview(result,capability),result);assert.equal(result.ticketWrites,false);assert.equal(result.automaticSync,false);
});
test('all three previous capabilities preserve exact read behavior with no appointment read or extra DTO',async()=>{
 for(const oldCapability of [undefined,'operational_structure_v1','ticket_detail_structure_v1']){
  const f=fixture(),result=await f.preview(window,oldCapability);assert.equal(f.calls.length,oldCapability==='ticket_detail_structure_v1'?5:4);assert.equal(appointmentCalls(f).length,0);assert.equal(result.appointmentEvidence,undefined);
  assert.deepEqual(projectMhelpTicketPreview({...result,appointmentEvidence:{raw:secret}},oldCapability),result);
 }
});
test('empty or ambiguous complete ticket windows never read detail, appointments or staff',async()=>{
 for(const count of [0,2,51,500]){
  const f=fixture({rows:Array.from({length:count},(_,i)=>ticket({ticketId:781234+i,ticketNumber:891234+i}))}),result=await f.preview(window,capability);
  assert.equal(detailCalls(f).length,0);assert.equal(appointmentCalls(f).length,0);assert.equal(result.appointmentEvidence.state,'selection_unavailable');assert.equal(result.appointmentEvidence.reason,count===0?'empty_window':'ambiguous_window');
  assert.deepEqual(projectMhelpTicketPreview(result,capability),result);assertRedacted(result.appointmentEvidence);
 }
});
test('incomplete list, changed detail, identity mismatch, invalid schema and denied detail stop before appointment access',async()=>{
 for(const options of [
  {fetcher:url=>url.includes('/Tickets?')?json({totalRows:1,results:[]}):undefined},
  {detail:ticket({ticketId:781235})},{detail:ticket({portalId:9})},{detail:ticket({lastModDate:'2026-10-09T14:00:00Z'})},{detail:{data:ticket()}},
  {fetcher:url=>url.includes('/Tickets/')?json({secret},403):undefined},
  {fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:[]}):undefined}
 ]){
  const f=fixture(options);await assert.rejects(f.preview(window,capability));assert.equal(appointmentCalls(f).length,0);
 }
});
test('forged caller fields, identities, scope, windows, URL and query overrides fail before configuration',async()=>{
 const f=fixture();
 for(const extra of [{ticketId:781234},{appointmentId:991234},{portalId},{startDateUtc:'2026-10-09T05:00:00Z'},{endDateUtc:'2026-10-16T05:00:00Z'},{scheduleWindow:{}},{rowIndex:0},{row:1},{pageSize:500},{fields:['Subject']},{url:'https://other.invalid'},{activate:true},{scope:'all'}])await assert.rejects(f.preview({...window,...extra},capability),error=>error.status===400);
 for(const invalid of ['appointment_structure_v2','appointments',null,true])await assert.rejects(f.preview(window,invalid),error=>error.status===400);
 assert.equal(f.configReads(),0);assert.equal(f.calls.length,0);
});
test('seven Chicago calendar days are separate from creation cutoff and use DST-safe boundaries',()=>{
 for(const [start,end,hours] of [['2026-03-06T06:00:00.000Z','2026-03-13T05:00:00.000Z',167],['2026-10-30T05:00:00.000Z','2026-11-06T06:00:00.000Z',169],['2026-12-29T06:00:00.000Z','2027-01-05T06:00:00.000Z',168]]){
  const result=mhelpAppointmentPreviewWindow(start);assert.deepEqual(result,{startDateUtc:start,endDateUtc:end,timeZone:'America/Chicago',calendarDays:7});assert.equal((Date.parse(end)-Date.parse(start))/3600000,hours);
 }
 for(const start of ['invalid','2026-10-09T00:00:00Z','2026-10-09T06:00:00Z'])assert.throws(()=>mhelpAppointmentPreviewWindow(start));
});
test('no match only describes this window; incomplete pages and malformed candidate wrappers stay unverified with no retries',async()=>{
 for(const [source,completeness,linkage] of [
  [{TotalRows:0,results:[]},'complete','no_match_in_window'],
  [{TotalRows:1,results:[appointment({TicketId:781235})]},'complete','no_match_in_window'],
  [{TotalRows:501,results:[appointment()]},'incomplete','unverified'],
  [{TotalRows:1,results:[]},'incomplete','unverified'],
  [{totalRows:1,results:[appointment()]},'unverified','unverified'],
  [{totalResults:1,results:[appointment()]},'unverified','unverified'],
  [{TotalRows:1,data:[appointment()]},'unverified','unverified'],
  [{TotalRows:1,results:[appointment()],data:[]},'unverified','unverified'],
  [{TotalRows:0,results:[appointment()]},'unverified','unverified'],
  [{TotalRows:'1',results:[appointment()]},'unverified','unverified'],
  [[], 'unverified','unverified'],[null,'unverified','unverified']
 ]){
  const f=fixture({appointments:source}),result=await f.preview(window,capability);assert.equal(appointmentCalls(f).length,1);assert.equal(result.appointmentEvidence.completeness,completeness);assert.equal(result.appointmentEvidence.linkage,linkage);assertRedacted(result.appointmentEvidence);
  assert.deepEqual(projectMhelpTicketPreview(result,capability),result);
 }
});
test('exact numeric ticket and portal match never coerces identities, names, strings, or linked-resource hints',()=>{
 for(const change of [{TicketId:'781234'},{PortalId:'224643'},{TicketId:1.5},{PortalId:8},{TicketId:undefined},{PortalId:undefined},{TicketId:{id:781234}},{TicketId:'secret'},{TicketId:NaN}]){
  const evidence=describe([appointment(change)]);assert.equal(evidence.exactMatchCount,0);assert.equal(evidence.unverifiedLinkageCount,1);assert.equal(evidence.linkage,'unverified');
 }
 for(const TicketId of [null,0,781235]){const evidence=describe([appointment({TicketId})]);assert.equal(evidence.exactMatchCount,0);assert.equal(evidence.linkage,'no_match_in_window');}
 assert.equal(describe([appointment(),null]).linkage,'unverified');
});
test('multiple, deleted, hidden, team, recurring, all-day, missing and invalid cases never select an assignment or schedule',()=>{
 assert.equal(describe([appointment(),appointment({ID:991235})]).linkage,'ambiguous_matches');
 const cases=[['deleted',{IsDeleted:true}],['hidden',{IsHidden:true}],['team',{TeamId:7}],['team',{TeamId:undefined}],['recurrence',{RecurrenceRule:'FREQ=DAILY'}],['recurrence',{RecurrenceParentID:8}],['recurrence',{RecurrenceStartUTC:'2026-10-11T12:00:00Z'}],['recurrence',{RecurrenceEndUTC:undefined}],['missingFlags',{IsDeleted:null}],['missingFlags',{IsHidden:undefined}],['missingFlags',{IsHidden:'false'}],['missingUser',{UserId:null}],['missingUser',{UserId:123}],['missingUser',{UserId:' '}],['invalidTime',{StartUTC:'2026-10-11T12:00:00'}],['invalidTime',{StartUTC:'/Date(123456)/'}],['invalidTime',{EndUTC:'2026-10-11T11:00:00Z'}],['invalidTime',{StartUTC:'2026-02-30T12:00:00Z'}],['invalidTime',{StartUTC:'2026-10-10T24:00:00Z'}],['invalidTime',{StartUTC:'2026-10-08T12:00:00Z'}],['invalidTime',{StartUTC:'2026-10-16T05:00:00Z',EndUTC:'2026-10-16T06:00:00Z'}],['invalidTime',{IsAllDay:true}],['invalidIdentity',{ID:'991234'}],['invalidIdentity',{ID:0}]];
 for(const [key,change] of cases){const evidence=describe([appointment(change)]);assert.equal(evidence.reviewCounts[key],1,JSON.stringify(change));assert.equal(evidence.linkage,'review_required');assert.equal(evidence.technician,'unresolved_no_staff_read');assert.equal(evidence.schedule,'unverified_candidate_contract');assertRedacted(evidence);}
 assert.equal(describeMhelpAppointments({TotalRows:1,results:[appointment()]},{...selected,deleted:true},window.createdAfter).reviewCounts.deleted,1);
});
test('field kinds and formats are fixed, bounded and never reveal source values or arbitrary keys',()=>{
 const values=[undefined,null,true,1,1.5,'123','2026-10-11T12:00:00Z','2026-10-11T12:00:00','/Date(123456)/',secret,[],{secret},BigInt(1)];
 const rows=Array.from({length:500},(_,i)=>({...Object.fromEntries(MHELP_APPOINTMENT_FIELDS.map((key,j)=>[key,values[(i+j)%values.length]])),[secret]:secret,Subject:secret}));
 const result=describe(rows);assert.equal(result.sampledAppointments,500);assert.deepEqual(Object.keys(result.fields),[...MHELP_APPOINTMENT_FIELDS]);assert(JSON.stringify(result).length<16000);assertRedacted(result);assert.deepEqual(projectMhelpAppointmentEvidence(result,1,window.createdAfter),result);
 assert.throws(()=>describe([...rows,appointment()]),/oversized appointment page/);
});
test('strict projector rejects raw additions, forged fixed keys/counts, inconsistent derived states and window changes',()=>{
 const changes=[v=>v.raw=secret,v=>v.window.startDateUtc='2026-10-08T05:00:00.000Z',v=>v.window.raw=secret,v=>v.scope=secret,v=>v.pageLimit=501,v=>v.sampledAppointments=501,v=>v.reportedTotal=-1,v=>v.completeness='incomplete',v=>v.envelope.raw=secret,v=>v.envelope.resultsKind=secret,v=>v.fields.Subject={},v=>v.fields.UserId.raw=secret,v=>v.fields.UserId.kinds[secret]=1,v=>v.fields.UserId.kinds.string=2,v=>v.fields.UserId.formats.other=2,v=>v.fields.UserId.emptyStrings=1,v=>v.exactMatchCount=2,v=>v.unverifiedLinkageCount=1,v=>v.reviewCounts.hidden=2,v=>v.reviewCounts.raw=secret,v=>v.linkage='scheduled',v=>v.technician='verified',v=>v.schedule='scheduled',v=>delete v.fields.TeamId];
 for(const change of changes){const value=appointmentEvidenceFixture();change(value);assert.throws(()=>projectMhelpAppointmentEvidence(value,1,window.createdAfter),/Unsupported mHelpDesk appointment evidence/);}
 for(const count of [0,2,500]){assert.throws(()=>projectMhelpAppointmentEvidence(appointmentEvidenceFixture(),count,window.createdAfter));const value=unavailableMhelpAppointments(count,window.createdAfter);assert.deepEqual(projectMhelpAppointmentEvidence(value,count,window.createdAfter),value);assert.throws(()=>projectMhelpAppointmentEvidence({...value,raw:secret},count,window.createdAfter));}
 assert.throws(()=>unavailableMhelpAppointments(1,window.createdAfter));
});
test('appointment HTTP failures are sanitized with fixed operation and never renew, retry or fall back to staff',async()=>{
 for(const status of [401,403,404,429,500]){
  const f=fixture({fetcher:url=>url.includes('/Appointments?')?json({secret},status):undefined});
  await assert.rejects(f.preview(window,capability),error=>{const d=mhelpTicketDiagnostic(error);assert.equal(d.log.operation,'appointment_read');assert.equal(d.log.providerHttpStatus,status);assert.equal(d.httpStatus,status===429?429:503);assertRedacted(d);return true;});
  assert.equal(appointmentCalls(f).length,1);assert.equal(f.renewals(),0);assert.equal(f.calls.length,6);
 }
});
test('appointment count, body bytes, content length, invalid JSON/UTF-8 and transport failures are bounded',async()=>{
 for(const response of [()=>json({TotalRows:501,results:Array.from({length:501},()=>appointment())}),()=>new Response('x'.repeat(1048577)),()=>new Response('{}',{headers:{'Content-Length':'1048577'}}),()=>new Response('{'+secret),()=>new Response(Uint8Array.of(0xff)),()=>{throw Error(secret);}]){
  const f=fixture({fetcher:url=>url.includes('/Appointments?')?response():undefined});await assert.rejects(f.preview(window,capability),error=>{assert(error instanceof MhelpTicketError);assertRedacted(mhelpTicketDiagnostic(error));return true;});assert.equal(appointmentCalls(f).length,1);
 }
});
test('appointments consume the existing shared 3 MiB budget rather than obtaining new capacity',async()=>{
 const padding='x'.repeat(800000),f=fixture({rows:[ticket({ignored:padding})],detail:ticket({ignored:padding}),appointments:{TotalRows:1,results:[appointment()],ignored:padding},fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Service',isActive:true}],ignored:padding}):undefined});
 await assert.rejects(f.preview(window,capability),/oversized ticket response/);assert.equal(appointmentCalls(f).length,1);
});
test('shared deadline covers ignored-abort appointment fetch and releases the shared overlap guard',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let ready,active=true,late,cancels=0;const started=new Promise(resolve=>{ready=resolve;});
 const f=fixture({fetcher:url=>url.includes('/Appointments?')&&active?new Promise(resolve=>{late=()=>resolve(new Response(new ReadableStream({cancel(){cancels++;return Promise.reject(Error(secret));}})));ready();}):undefined});
 const pending=f.preview(window,capability);await started;await assert.rejects(f.preview(window),error=>error.status===409);assert.equal(f.configReads(),1);
 const rejected=assert.rejects(pending,error=>mhelpTicketDiagnostic(error).error==='MHELP_PREVIEW_DEADLINE');t.mock.timers.tick(20001);await rejected;assert(f.calls.at(-1).init.signal.aborted);
 active=false;assert.equal((await f.preview(window,capability)).appointmentEvidence.state,'window_reviewed');const count=f.calls.length;late();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(cancels,1);assert.equal(f.calls.length,count);
});
test('appointment body shares the original deadline and never-settling cleanup cannot retain the guard',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const mode of ['http','length','bytes','json','utf8','stall'])for(const behavior of ['never','reject','throw']){
  let active=true,ready;const started=new Promise(resolve=>{ready=resolve;});
  const f=fixture({fetcher:url=>{
   if(!active)return;
   if(url.includes('/Tickets?'))t.mock.timers.tick(19000);
   if(!url.includes('/Appointments?'))return;
   const body=new ReadableStream({start(controller){if(mode==='bytes')controller.enqueue(new Uint8Array(1048577));if(mode==='json'){controller.enqueue(new TextEncoder().encode('{'+secret));controller.close();}if(mode==='utf8')controller.enqueue(Uint8Array.of(0xff));},pull(){if(mode==='stall'){ready();return new Promise(()=>{});}},cancel(){if(behavior==='never')return new Promise(()=>{});if(behavior==='reject')return Promise.reject(Error(secret));throw Error(secret);}});
   if(mode!=='stall')ready();return new Response(body,{status:mode==='http'?403:200,headers:mode==='length'?{'Content-Length':'1048577'}:{}});
  }});
  const pending=f.preview(window,capability),rejected=assert.rejects(pending,error=>{assert(error instanceof MhelpTicketError);assertRedacted(mhelpTicketDiagnostic(error));return true;});await started;t.mock.timers.tick(1001);await rejected;assert.equal(appointmentCalls(f).length,1);assert(f.calls.at(-1).init.signal.aborted);
  active=false;assert.equal((await f.preview(window,capability)).appointmentEvidence.state,'window_reviewed');
 }
});

test('only the existing account renewal is reused and non-midnight internal windows fail before configuration',async()=>{
 const f=fixture({fetcher:(url,init)=>url.endsWith('/users/me')&&init.headers.Authorization.endsWith(secret)?json({secret},401):undefined});
 const value=await f.preview(window,capability);assert.equal(value.appointmentEvidence.state,'window_reviewed');assert.equal(f.renewals(),1);assert.equal(f.calls.length,7);assert.equal(appointmentCalls(f).length,1);assert.equal(f.calls.at(-1).init.headers.Authorization,'Bearer synthetic-renewed');
 const invalid=fixture();await assert.rejects(invalid.preview({...window,createdAfter:'2026-10-09T06:00:00Z'},capability),error=>mhelpTicketDiagnostic(error).error==='MHELP_PREVIEW_APPOINTMENT_WINDOW_INVALID');assert.equal(invalid.configReads(),0);assert.equal(invalid.calls.length,0);
});
