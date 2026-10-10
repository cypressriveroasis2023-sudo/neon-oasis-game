import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTicketReader} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {mhelpPrivateAppointmentDay} from '../../supabase/functions/cos-operations-pages/mhelpTicketDay.ts';
import {MHELP_PRIVATE_APPOINTMENT_FIELDS,MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS,MHELP_PRIVATE_ITEM_FIELDS,validateMhelpPrivateSampleRequest,projectMhelpPrivateSample} from '../../supabase/functions/cos-operations-pages/mhelpTicketPrivateSample.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
const now=new Date('2026-10-10T18:00:00Z'),request={ticketNumber:'6302',appointmentDay:'2026-10-10'};
const secret='private-forbidden-marker',portalId='431';
const ticket=(change={})=>({portalId:431,ticketId:8741,ticketNumber:6302,typeId:2,typeName:'Service',statusId:1,customStatusId:null,deleted:false,creationDate:'2026-07-02T15:00:00Z',lastModDate:'2026-10-09T14:00:00Z',assignedTo:null,customerId:351,serviceLocationId:452,...change});
const detail=(change={})=>ticket({items:[{name:'Synthetic tower service',description:'Original old date\nLeave this text as recorded.\r\nThird line',notes:'Inspect connections\nKeep source wording.',quantity:6,durationSeconds:21600,rate:123.45,amount:740.7,customer:{name:secret},invoiceId:976,customFields:[secret],attachments:[secret]}],subject:secret,summary:secret,comment:secret,equipment:[],contacts:[secret],...change});
const appointment=(change={})=>({ID:981,TicketId:8741,PortalId:431,UserId:'synthetic.technician@example.invalid',StartUTC:'2026-10-10T14:00:00Z',EndUTC:'2026-10-10T20:00:00Z',Subject:'Synthetic planned visit',subject:'Different literal lower-case subject',Description:'First source line\nSecond source line',description:'Preserve lower-case description',IsDeleted:false,IsHidden:false,attachments:[secret],...change});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function fixture(change={}) {
 const calls=[];let configs=0,renewals=0;
 const reader=createMhelpTicketReader({getConfig:async()=>{configs++;return {portalId,accessToken:change.accessToken??secret};},renewAccess:async()=>{renewals++;return {portalId,accessToken:'synthetic-renewal'};},fetch:async(url,init)=>{
  calls.push({url,init});const custom=await change.fetcher?.(url,init,calls);if(custom)return custom;
  if(url.endsWith('/users/me'))return json({portalId:431});
  if(url.includes('/Tickets?'))return json(change.page??{totalRows:1,results:[ticket()]});
  if(url.includes('/Tickets/'))return json(change.detail??detail());
  if(url.includes('/Appointments?'))return json(change.appointments??{TotalRows:1,results:[appointment()]});
  if(url.endsWith('/tickettypes'))return json({totalRows:0,data:[]});
  if(url.endsWith('/ticketstatus'))return json([]);
  throw Error('Unexpected synthetic read');
 }});
 return {...reader,calls,configs:()=>configs,renewals:()=>renewals};
}
const sample=f=>f.sample(request,now);
const assertNoPrivate=value=>{const serialized=JSON.stringify(value);for(const forbidden of [secret,'rate','amount','invoiceId','customer','contacts','attachments','customFields','rawSource','351','452'])assert(!serialized.includes(forbidden),forbidden);};

test('private sample resolves number through exactly one server-built appointment-day page then detail and projected appointments',async()=>{
 const f=fixture(),value=await sample(f);assert.equal(value.contract,'cos-mhelpdesk-ticket-private-sample-v1');assert.equal(value.state,'sample_reviewed');assert.equal(value.schema,'unverified');assert.equal(value.identityMapping,'unverified');assert.equal(value.sourceToCosMapping,'unverified');assert.equal(value.automaticSync,false);assert.equal(value.ticketWrites,false);assert.equal(f.calls.length,4);assert.equal(f.configs(),1);
 const list=new URL(f.calls[1].url);assert.deepEqual([...list.searchParams],[['appointmentStart','2026-10-10T05:00:00.000Z'],['appointmentEnd','2026-10-11T05:00:00.000Z'],['pageSize','500'],['sort','ticketId']]);assert.equal(f.calls[2].url,'https://connect.mhelpdesk.com/api/v1.0/portal/431/Tickets/8741');
 const appt=new URL(f.calls[3].url);assert.deepEqual([...appt.searchParams],[['startDateUtc','2026-10-10T05:00:00.000Z'],['endDateUtc','2026-10-11T05:00:00.000Z'],['pageSize','500'],['sort','StartUtc'],['fields',MHELP_PRIVATE_APPOINTMENT_FIELDS.join(',')]]);assert.equal(MHELP_PRIVATE_APPOINTMENT_FIELDS.length,57);assert.equal(new Set(MHELP_PRIVATE_APPOINTMENT_FIELDS).size,57);
 for(const call of f.calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert(!call.url.includes(secret));}assertNoPrivate(value);
 assert.deepEqual(projectMhelpPrivateSample(value),value);assert.equal(value.items.rows[0].fields.quantity.value,6);assert.equal(value.items.rows[0].fields.durationSeconds.value,21600);assert.equal(value.items.rows[0].fields.description.value,detail().items[0].description);assert.equal(value.appointments.rows[0].fields.Description.value,appointment().Description);assert.notEqual(value.appointments.rows[0].fields.Subject.value,value.appointments.rows[0].fields.subject.value);assert.equal(value.appointments.rows[0].fields.UserId.value,appointment().UserId);assert.equal(value.readAt,now.toISOString());
});

test('single Chicago day is DST safe and nearest31 calendar days use local today, not UTC or milliseconds',()=>{
 for(const [day,clock,start,end] of [
 ['2026-03-08','2026-03-08T20:00:00Z','2026-03-08T06:00:00.000Z','2026-03-09T05:00:00.000Z'],
 ['2026-11-01','2026-11-01T20:00:00Z','2026-11-01T05:00:00.000Z','2026-11-02T06:00:00.000Z'],
 ['2025-12-31','2026-01-01T02:00:00Z','2025-12-31T06:00:00.000Z','2026-01-01T06:00:00.000Z'],
 ['2026-11-09','2026-10-10T02:00:00Z','2026-11-09T06:00:00.000Z','2026-11-10T06:00:00.000Z']])assert.deepEqual(mhelpPrivateAppointmentDay(day,new Date(clock)),{startDateUtc:start,endDateUtc:end,timeZone:'America/Chicago',calendarDays:1});
 for(const day of ['2026-09-09','2026-11-10'])assert.doesNotThrow(()=>mhelpPrivateAppointmentDay(day,now));
 for(const day of ['2026-09-08','2026-11-11','2026-02-30','2026-10-10T00:00:00Z','2026-1-1','0000-01-01',' 2026-10-10'])assert.throws(()=>mhelpPrivateAppointmentDay(day,now));assert.throws(()=>mhelpPrivateAppointmentDay(request.appointmentDay,new Date('invalid')));
});

test('request accepts only number string and day, with no caller API identity, URL, filter or field expansion',async()=>{
 const f=fixture();for(const extra of [{ticketId:8741},{portalId:'431'},{url:'https://elsewhere.invalid'},{fields:['Subject']},{day:'previous'},{startDateUtc:'2026-10-10T05:00:00Z'},{appointmentStart:'2026-10-10'},{sort:'ID'},{filter:'x'},{pageSize:500},{rowIndex:0},{evidence:'ticket_private_sample_v1'}])await assert.rejects(f.sample({...request,...extra},now),e=>e.status===400);
 for(const ticketNumber of [null,6302,'','0','06302','6302/other',' 6302','6302 ','9999999999999999'])await assert.rejects(f.sample({...request,ticketNumber},now),e=>e.status===400);
 for(const appointmentDay of [null,'','2026-09-08','2026-11-11'])await assert.rejects(f.sample({...request,appointmentDay},now),e=>e.status===400);assert.equal(f.calls.length,0);assert.equal(f.configs(),0);
});

test('empty, missing, ambiguous and incomplete number selections never read detail or appointments',async()=>{
 for(const [page,reason,count] of [[{totalRows:0,data:[]},'ticket_not_found',0],[{totalRows:1,data:[ticket({ticketNumber:6399})]},'ticket_not_found',0],[{totalRows:2,results:[ticket(),ticket({ticketId:8742})]},'ambiguous_ticket_number',2],[{totalRows:2,results:[ticket()]},'incomplete_ticket_page',1],[{totalRows:501,results:[ticket()]},'incomplete_ticket_page',1]]){
  const f=fixture({page}),value=await sample(f);assert.equal(value.state,'selection_unavailable');assert.equal(value.reason,reason);assert.equal(value.selection.matchingTickets,count);assert.equal(value.selection.reportedTotal,page.totalRows);assert.equal(f.calls.length,2);assert(!('selected'in value));assert(!('items'in value));assert.deepEqual(projectMhelpPrivateSample(value),value);
 }
});

test('complete page validates every source row, portal and strict envelope before the selected detail GET',async()=>{
 for(const page of [{totalRows:1,results:[ticket({portalId:432})]},{totalRows:2,results:[ticket(),ticket({ticketId:8742,portalId:432})]}, {totalRows:1,data:[ticket()],results:[ticket()]},{totalRows:1,results:[ticket()],TotalRows:1},{totalRows:1,results:[ticket()],Results:[]},{totalRows:0,results:[ticket()]},{totalRows:1,results:'bad'},{totalRows:1,results:[ticket({ticketId:0})]},{totalRows:2,results:[ticket(),ticket()]},{totalRows:501,results:Array.from({length:501},(_,i)=>ticket({ticketId:8741+i}))}]){
  const f=fixture({page});await assert.rejects(sample(f));assert.equal(f.calls.length,2);
 }
});

test('detail identity and stable snapshot mismatch prevents the appointment GET',async()=>{
 for(const raw of [detail({ticketId:8742}),detail({ticketNumber:6303}),detail({portalId:432}),detail({lastModDate:'2026-10-10T17:00:00Z'}),detail({assignedTo:'different@example.invalid'}),detail({deleted:true}),{data:detail()},detail({statusId:2})]){
  const f=fixture({detail:raw});await assert.rejects(sample(f));assert.equal(f.calls.length,3);assert(!f.calls.some(c=>c.url.includes('/Appointments')));
 }
});

test('all16 exact numeric alias pairs qualify independently; string IDs, foreign/unmatched and conflicting aliases leak no values',async()=>{
 const tickets=['TicketId','TicketID','ticketId','ticketID'],portals=['PortalId','PortalID','portalId','portalID'];
 for(const t of tickets)for(const p of portals){const row={[t]:8741,[p]:431,Subject:'Exact synthetic value'},f=fixture({appointments:{TotalRows:1,results:[row]}}),value=await sample(f);assert.equal(value.appointments.rows.length,1);assert.equal(value.appointments.rows[0].fields.Subject.value,row.Subject);assert.deepEqual(projectMhelpPrivateSample(value),value);}
 const rows=[appointment({TicketId:999,Subject:secret}),appointment({PortalId:999,Subject:secret}),appointment({TicketId:'8741',Subject:secret}),appointment({PortalId:'431',Subject:secret}),appointment({TicketID:999,Subject:secret}),appointment({PortalID:999,Subject:secret}),appointment({Id:999,Subject:secret}),appointment({userId:'another@example.invalid',Subject:secret}),appointment({startUtc:'different',Subject:secret}),appointment({EndUtc:'different',Subject:secret}),{},null,appointment({Subject:'Only eligible value'})];
 const value=await sample(fixture({appointments:{TotalRows:rows.length,results:rows}}));assert.equal(value.appointments.rows.length,1);assert.equal(value.appointments.rows[0].index,12);assert.equal(value.appointments.suppressedAppointments,12);assert(!JSON.stringify(value).includes(secret));assert.equal(value.appointments.structure.candidatePairs.ticketAliasConflicts,1);assert.equal(value.appointments.structure.candidatePairs.portalAliasConflicts,1);assert.deepEqual(value.appointments.structure.aliasConflicts,{identity:1,user:1,start:1,end:1});assert.equal(value.appointments.structure.rowKinds.null,1);assert.equal(value.appointments.structure.emptyObjectRows,1);
});

test('unverified or incomplete appointment totals preserve matching private values while retaining definitive all-row diagnostics',async()=>{
 for(const [envelope,completeness] of [[{results:[appointment()]},'unverified'],[{totalRows:1,results:[appointment()]},'unverified'],[{TotalRows:2,results:[appointment()]},'incomplete'],[{TotalRows:1,results:[appointment()],data:[]},'unverified']]){
  const value=await sample(fixture({appointments:envelope}));assert.equal(value.appointments.completeness,completeness);assert.equal(value.appointments.rows.length,1);assert.equal(value.appointments.matchingAppointments,1);assert.equal(Object.keys(value.appointments.structure.fields).length,57);assert.equal(value.appointments.structure.fields.StartUTC.formats.iso_with_zone,1);assert.equal(value.appointments.structure.userReferenceFormats.UserId.email_like,1);assert.equal(value.appointments.structure.candidatePairs.matching[0],1);assert.deepEqual(projectMhelpPrivateSample(value),value);
 }
 for(const envelope of [{Data:[appointment()],TotalRows:1},[appointment()],{results:[appointment({TicketId:999,Subject:secret})],TotalRows:1}]){const value=await sample(fixture({appointments:envelope}));assert.equal(value.appointments.rows.length,0);assert(!JSON.stringify(value).includes(secret));assert.equal(Object.keys(value.appointments.structure.fields).length,57);}
});

test('operational literal fields are individually screened, never rewritten or inferred; unsupported source kinds remain explicit',async()=>{
 const secrets=['token=synthetic-secret','key: synthetic-value','b9c745bc76454597bdc5751b4e4e899124d850733bf34ba2a13d539fbc3226a5','password: do-not-show','Authorization: Bearer synthetic-value','api_key=synthetic-key','access_token=synthetic-key','https://example.invalid/path?token=synthetic','ghp_abcdefghijklmnopqrstuvwx','eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.synthetic'];
 for(const sensitive of secrets){const d=detail({items:[{name:sensitive,description:sensitive,notes:sensitive,quantity:2,durationSeconds:'1800'}]}),a=appointment({Subject:sensitive,Description:sensitive,UserId:sensitive,StartUTC:sensitive}),value=await sample(fixture({detail:d,appointments:{TotalRows:1,results:[a]}}));for(const key of ['name','description','notes'])assert.equal(value.items.rows[0].fields[key].state,'suppressed');for(const key of ['Subject','Description','UserId','StartUTC'])assert.equal(value.appointments.rows[0].fields[key].state,'suppressed');assert(!JSON.stringify(value).includes(sensitive));assert.deepEqual(projectMhelpPrivateSample(value),value);}
 const value=await sample(fixture({detail:detail({items:[{name:'Exact\nName',description:{private:secret},notes:'bad\u0001control',quantity:'06hr00min00sec',durationSeconds:'21600'},{ticketId:999,name:secret},{name:'x'.repeat(4001),quantity:1e12},null]})}));assert.equal(value.items.rows[0].fields.name.value,'Exact\nName');assert.equal(value.items.rows[0].fields.description.state,'unsupported');assert.equal(value.items.rows[0].fields.notes.state,'unsupported');assert.equal(value.items.rows[0].fields.quantity.state,'unsupported');assert.equal(value.items.rows[0].fields.durationSeconds.value,'21600');assertNoPrivate(value);
 for(const rawItems of [null,{},'bad',undefined]){const raw=detail();if(rawItems===undefined)delete raw.items;else raw.items=rawItems;const value=await sample(fixture({detail:raw}));assert.equal(value.items.rows.length,0);assert.deepEqual(projectMhelpPrivateSample(value),value);}
});

test('value rows are capped at50, page500 bound holds, and every field spelling stays separate',async()=>{
 const value=await sample(fixture({detail:detail({items:Array.from({length:51},(_,i)=>({name:'Synthetic item '+i,quantity:i,durationSeconds:0}))}),appointments:{TotalRows:51,results:Array.from({length:51},(_,i)=>appointment({ID:981+i}))}}));assert.equal(value.items.totalEntries,51);assert.equal(value.items.rows.length,50);assert.equal(value.items.truncated,true);assert.equal(value.appointments.matchingAppointments,51);assert.equal(value.appointments.rows.length,50);assert.equal(value.appointments.truncated,true);assert.equal(value.appointments.suppressedAppointments,1);assert.deepEqual(Object.keys(value.items.rows[0].fields),MHELP_PRIVATE_ITEM_FIELDS);assert.deepEqual(Object.keys(value.appointments.rows[0].fields),MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS);assert.deepEqual(projectMhelpPrivateSample(value),value);
 await assert.rejects(sample(fixture({appointments:{TotalRows:501,results:Array.from({length:501},()=>appointment())}})));
 await assert.rejects(sample(fixture({detail:detail({items:Array.from({length:50},()=>({name:'n'.repeat(4000),description:'d'.repeat(4000),notes:'z'.repeat(4000)}))})})),e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_PROJECTION_INVALID');
});

test('private route projector rejects extras, forged mapping authority, unsafe cells and cross-ticket values',async()=>{
 const original=await sample(fixture());
 for(const mutate of [v=>{v.rawSource=secret;},v=>{v.schema='verified';},v=>{v.automaticSync=true;},v=>{v.selected.ticketNumber='6303';},v=>{v.items.rows[0].fields.name={state:'value',value:'password: hidden'};},v=>{v.items.rows[0].fields.rate={state:'value',value:50};},v=>{v.appointments.rows[0].fields.TicketId.value=999;},v=>{v.appointments.rows[0].fields.PortalId.value='431';},v=>{v.appointments.rows[0].fields.UserID={state:'value',value:'another@example.invalid'};},v=>{v.appointments.structure.candidatePairs.matching[0]=2;},v=>{v.appointments.structure.fields.Subject.formats.other=2;},v=>{v.appointments.rows[0].index=999;},v=>{v.appointments.structure.userReferenceFormats.UserId.raw=secret;}]){const value=structuredClone(original);mutate(value);assert.throws(()=>projectMhelpPrivateSample(value));}
});

test('account renewal remains once only; detail failures and logs never expose request or source values',async()=>{
 let account=0;const f=fixture({fetcher:url=>url.endsWith('/users/me')&&account++===0?json({private:secret},401):undefined});await sample(f);assert.equal(f.renewals(),1);assert.equal(f.calls.length,5);
 for(const path of ['/Tickets/','/Appointments?']){const f=fixture({fetcher:url=>url.includes(path)?json({private:secret},401):undefined});await assert.rejects(sample(f),e=>{const diagnostic=mhelpTicketDiagnostic(e);assert.equal(diagnostic.error,'MHELP_PREVIEW_PROVIDER_HTTP');assert(!JSON.stringify(diagnostic).includes(secret));assert(!JSON.stringify(diagnostic).includes('6302'));assert(!JSON.stringify(diagnostic).includes('8741'));return true;});assert.equal(f.renewals(),0);}
});

test('sample and aggregate share a single overlap guard; cancellation releases it with no late reads',async()=>{
 let start;const begun=new Promise(resolve=>start=resolve);let stalled=true;
 const f=fixture({fetcher:url=>{if(url.includes('/Tickets/')&&stalled){start();return new Promise(()=>{});}}}),controller=new AbortController(),pending=f.sample(request,now,controller.signal);await begun;
 await assert.rejects(f.preview({createdAfter:'2026-10-10T05:00:00Z',createdBefore:'2026-10-11T05:00:00Z'}),e=>e.status===409);await assert.rejects(f.sample(request,now),e=>e.status===409);assert.equal(f.configs(),1);controller.abort();await assert.rejects(pending,e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_DEADLINE');assert(!f.calls.some(c=>c.url.includes('/Appointments')));stalled=false;assert.equal((await sample(f)).state,'sample_reviewed');
});

test('private response transport retains oneMiB per-response cap and shared20second deadline',async()=>{
 const tooLarge=fixture({fetcher:url=>url.includes('/Appointments?')?new Response('x',{headers:{'Content-Length':'1048577'}}):undefined});await assert.rejects(sample(tooLarge),e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_RESPONSE_TOO_LARGE');
 const original=globalThis.setTimeout;let deadline;
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms===20000){deadline=fn;return original(()=>{},100000);}return original(fn,ms,...args);};
 try {const f=fixture({fetcher:url=>{if(url.includes('/Appointments?')){queueMicrotask(()=>deadline());return new Promise(()=>{});}}});await assert.rejects(sample(f),e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_DEADLINE');assert.equal(f.calls.length,4);}finally {globalThis.setTimeout=original;}
});


test('private reads consume one shared3MiB budget rather than independent response budgets',async()=>{
 const padded=value=>{const result={...value,padding:''};result.padding='p'.repeat(1048576-JSON.stringify(result).length);assert.equal(Buffer.byteLength(JSON.stringify(result)),1048576);return result;};
 const f=fixture({page:padded({totalRows:1,results:[ticket()]}),detail:padded(detail()),appointments:padded({TotalRows:1,results:[appointment()]})});await assert.rejects(sample(f),e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_RESPONSE_TOO_LARGE');assert.equal(f.calls.length,4);
});

test('projector rejects sparse or extra-property row arrays rather than preserving unknown members',async()=>{
 const original=await sample(fixture());for(const mutate of [v=>{delete v.items.rows[0];},v=>{v.items.rows.private='hidden';},v=>{delete v.appointments.rows[0];},v=>{v.appointments.rows.private='hidden';}]){const v=structuredClone(original);mutate(v);assert.throws(()=>projectMhelpPrivateSample(v));}
});


test('configured credential bytes cannot escape in otherwise permitted operational fields',async()=>{
 const value=await sample(fixture({detail:detail({items:[{name:'Source '+secret,description:secret,notes:secret}]}),appointments:{results:[appointment({Subject:secret,UserId:secret,StartUTC:secret})]}}));for(const key of ['name','description','notes'])assert.equal(value.items.rows[0].fields[key].state,'suppressed');for(const key of ['Subject','UserId','StartUTC'])assert.equal(value.appointments.rows[0].fields[key].state,'suppressed');assert(!JSON.stringify(value).includes(secret));assert.deepEqual(projectMhelpPrivateSample(value),value);
 const short=await sample(fixture({accessToken:'z9Q4',detail:detail({items:[{notes:'Recorded z9Q4 value'}]})}));assert.equal(short.items.rows[0].fields.notes.state,'suppressed');assert(!JSON.stringify(short).includes('z9Q4'));
});


test('all10 fixed item spellings remain separate literal candidates with matching recorded and privacy rules',async()=>{
 const item={name:'lowercase item',Name:'Uppercase item candidate',description:'lowercase description',Description:'Uppercase description\nSecond line',notes:'lowercase notes',Notes:'Uppercase notes',quantity:'2.00',Quantity:7,durationSeconds:3600,DurationSeconds:'7200',Rate:'never-export-price',Price:'never-export-price',Tax:'never-export-price',Customer:{Name:'never-export-contact'}};
 const value=await sample(fixture({detail:detail({items:[item]})})),fields=value.items.rows[0].fields;assert.equal(MHELP_PRIVATE_ITEM_FIELDS.length,10);assert.deepEqual(Object.keys(fields),MHELP_PRIVATE_ITEM_FIELDS);for(const key of MHELP_PRIVATE_ITEM_FIELDS)assert.deepEqual(fields[key],{state:'value',value:item[key]});assert(!JSON.stringify(value).includes('never-export'));assert.deepEqual(projectMhelpPrivateSample(value),value);
 for(const key of ['Name','Description','Notes','Quantity','DurationSeconds']){const value=await sample(fixture({detail:detail({items:[{[key]:'apiKey=synthetic-token'}]})}));assert.equal(value.items.rows[0].fields[key].state,'suppressed');assert.deepEqual(projectMhelpPrivateSample(value),value);}
 const invalid=await sample(fixture({detail:detail({items:[{Quantity:'7 units',DurationSeconds:'06hr00min00sec'}]})}));assert.equal(invalid.items.rows[0].fields.Quantity.state,'unsupported');assert.equal(invalid.items.rows[0].fields.DurationSeconds.state,'unsupported');
});
