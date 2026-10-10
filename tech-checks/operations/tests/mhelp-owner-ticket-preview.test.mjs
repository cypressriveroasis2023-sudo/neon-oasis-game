import test from 'node:test';
import assert from 'node:assert/strict';
import {MhelpTokenRenewalError} from '../../supabase/functions/cos-operations-pages/mhelpTokenSession.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {mhelpTodayPreviewWindow,mhelpPreviousDayPreviewWindow} from '../../supabase/functions/cos-operations-pages/mhelpTicketDay.ts';
const evidence='operational_structure_v1';
const endpoint='/api/mhelpdesk/partner/tickets/preview',portal='224643',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const request=(body={},method='POST',origin='https://cos-vision-integration-preview.pages.dev')=>new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-session','Content-Type':'application/json',Origin:origin},body:JSON.stringify({path:endpoint,method,body})});
function fixture(change={}) {
 const calls=[],diagnostics=[];let configReads=0;
 const technician=change.id==='4f7044b5-86b6-411f-8898-39bb64b4ddbc'?{actor:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',code:'it_technician'}:change.id==='78e54fbd-c2db-4d18-8e3d-a9740adcf285'?{actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',code:'service_technician'}:null;
 const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-server',now:()=>new Date('2026-10-09T22:00:00Z'),reportTicketPreviewFailure:entry=>{diagnostics.push(entry);if(change.logFailure)throw Error('private logger failure');},mhelpPartner:{renewAccess:change.renewAccess,getConfig:()=>{configReads++;if(change.configFailure)throw Error('private synthetic-mhelp configuration');return {portalId:portal,accessToken:'synthetic-mhelp'};}},fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url.includes('/auth/v1/user'))return change.invalid?json({},401):json({id:change.id||owner});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:change.id||owner,full_name:technician?.name||'Synthetic',role:change.role||technician?.department||'owner',active:!change.inactive,archived_at:change.archived?'2026-01-01':null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:technician?.actor||actor,display_name:technician?.name||'Synthetic',department:technician?.department||'owner',active:!change.nativeInactive}]);
  if(url.includes('/rest/v1/user_roles?'))return json(change.revoked?[]:[{role_id:'11111111-1111-1111-1111-111111111111',roles:{code:technician?.code||'owner',organization_id:org}}]);
  if(url==='https://connect.mhelpdesk.com/api/v1.0/users/me')return json({portalId:Number(portal),private:'do-not-export'},change.accountHttp||200);
  if(url.endsWith('/tickettypes'))return change.invalidTypes?json({private:'synthetic-mhelp'}):json({totalRows:1,data:[{portalId:Number(portal),typeId:1,typeName:'Service',isActive:true}]});
  if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'New',displayText:'New',parentId:null,canBeParent:true}]);
  if(url.includes('/Appointments?'))return json(change.appointments||{TotalRows:0,results:[]});
  if(url.includes('/Tickets/'))return change.detailHttp?json({private:'synthetic-mhelp'},change.detailHttp):json(change.detail||change.rows?.[0]);
  if(url.includes('/Tickets?')){
   const u=new URL(url);if(change.privateSample){assert.equal(u.searchParams.get('appointmentStart'),'2026-10-10T05:00:00.000Z');assert.equal(u.searchParams.get('appointmentEnd'),'2026-10-11T05:00:00.000Z');assert.equal(u.searchParams.get('pageSize'),'500');assert(!u.searchParams.has('createStart'));}else {assert.equal(u.searchParams.get('createStart'),change.previous?'2026-10-08T05:00:00.000Z':'2026-10-09T05:00:00.000Z');assert.equal(u.searchParams.get('createEnd'),change.previous?'2026-10-09T05:00:00.000Z':'2026-10-09T22:00:00.000Z');}
   if(change.providerError)return json({private:'synthetic-mhelp'},change.providerError===true?429:change.providerError);
   return json({totalRows:change.rows?.length||0,data:change.rows||[],private:'do-not-export'});
  }
  throw Error('Unexpected transport');
 }});
 return {handler,calls,diagnostics,configReads:()=>configReads};
}
test('Owner ticket preview uses existing authenticated bridge, server-local day and aggregate-only reader',async()=>{
 const f=fixture(),response=await f.handler(request()),data=await response.json();assert.equal(response.status,200);
 assert.equal(data.contract,'cos-mhelpdesk-ticket-preview-v1');assert.equal(data.automaticSync,false);assert.equal(data.ticketWrites,false);assert.equal(data.previewCount,0);assert.equal(data.types[0].typeId,'1');
 assert.equal(f.configReads(),1);assert(f.calls.every(c=>c.method==='GET'));assert(!JSON.stringify(data).includes('do-not-export'));assert(!JSON.stringify(data).includes('synthetic-mhelp'));
 assert(!f.calls.some(c=>c.url.includes('/rpc/')||c.url.includes('vault')));
 assert.deepEqual(f.diagnostics,[]);
});
test('IT, Service, unmapped, inactive and revoked sessions fail before mHelp config or provider reads',async()=>{
 for(const change of [{role:'it'},{role:'service'},{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},{id:'22222222-2222-2222-2222-222222222222'},{invalid:true},{inactive:true},{archived:true},{nativeInactive:true},{revoked:true}]){
  const f=fixture(change),r=await f.handler(request());assert([401,403].includes(r.status),JSON.stringify(change));assert.equal(f.configReads(),0);assert(!f.calls.some(c=>c.url.includes('mhelpdesk.com')));assert.deepEqual(f.diagnostics,[]);
 }
});
test('Owner preview rejects caller windows, identities, credentials, URLs and activation before provider access',async()=>{
 for(const body of [{createdAfter:'2020-01-01T00:00:00Z'},{createdBefore:'2027-01-01T00:00:00Z'},{maxTickets:500},{actorId:actor},{portalId:portal},{token:'private'},{url:'https://elsewhere.invalid'},{activate:true},{day:'today'},{day:'2020-01-01'},{day:null},{day:'previous',createdAfter:'2020-01-01T00:00:00Z'},{evidence:'all'},{evidence:null},{evidence:true},{evidence:{fields:['summary']}},{evidence,fields:['summary']},{evidence,maxTickets:1}]){
  const f=fixture();assert.equal((await f.handler(request(body))).status,400);assert.equal(f.configReads(),0);assert.deepEqual(f.diagnostics,[]);
 }
 const f=fixture();assert.equal((await f.handler(request({},'GET'))).status,405);assert.equal(f.configReads(),0);
 const origin=fixture();assert.equal((await origin.handler(request({},'POST','https://elsewhere.invalid'))).status,403);assert.equal(origin.configReads(),0);
});
test('provider failure is a sanitized failed read, without leaking a token or reporting intake activation',async()=>{
 const f=fixture({providerError:true}),r=await f.handler(request());assert.equal(r.status,429);const data=await r.json();assert.equal(data.error,'MHELP_PREVIEW_RATE_LIMIT');assert(!JSON.stringify(data).includes('synthetic-mhelp'));assert(!('previewCount'in data));
 assert.deepEqual(f.diagnostics.map(({schema,...entry})=>entry),[{event:'mhelp_ticket_preview_failed',code:'RATE_LIMIT',httpStatus:429,operation:'ticket_read',providerHttpStatus:429}]);
 assert.equal(f.diagnostics[0].schema.ticketTypes.data.length,1);assert.equal(f.diagnostics[0].schema.tickets,undefined);assert(!JSON.stringify(f.diagnostics).includes('synthetic-mhelp'));
});
test('real parser failures expose a fixed category and log no source response or request details',async()=>{
 for(const [change,code,operation,providerHttpStatus] of [[{invalidTypes:true},'TYPE_DICTIONARY_INCOMPLETE',null,null],[{providerError:403},'PROVIDER_HTTP','ticket_read',403],[{configFailure:true},'CONFIG_UNAVAILABLE',null,null],[{invalidTypes:true,logFailure:true},'TYPE_DICTIONARY_INCOMPLETE',null,null]]){
  const f=fixture(change),r=await f.handler(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'MHELP_PREVIEW_'+code});
  assert.deepEqual(f.diagnostics.map(({schema,...entry})=>entry),[{event:'mhelp_ticket_preview_failed',code,httpStatus:503,operation,providerHttpStatus}]);
  if(change.invalidTypes){assert.equal(f.diagnostics[0].schema.ticketTypes.data.kind,'absent');assert.equal(f.diagnostics[0].schema.tickets.data.length,0);}
  if(change.configFailure)assert.equal(f.diagnostics[0].schema,undefined);
  assert(!JSON.stringify(f.diagnostics).includes('synthetic-mhelp'));assert(!JSON.stringify(f.diagnostics).includes('private'));assert(!f.calls.some(c=>c.method!=='GET'));
 }
});
test('Chicago today start is DST-safe and independent of the executor timezone',()=>{
 for(const [now,start] of [['2026-10-09T22:00:00Z','2026-10-09T05:00:00.000Z'],['2026-01-09T22:00:00Z','2026-01-09T06:00:00.000Z'],['2026-03-08T22:00:00Z','2026-03-08T06:00:00.000Z'],['2026-11-01T22:00:00Z','2026-11-01T05:00:00.000Z'],['2026-10-10T02:00:00Z','2026-10-09T05:00:00.000Z']])assert.equal(mhelpTodayPreviewWindow(new Date(now)).createdAfter,start);
 assert.throws(()=>mhelpTodayPreviewWindow(new Date('invalid')));assert.throws(()=>mhelpTodayPreviewWindow(new Date('2026-10-09T05:00:00Z')));
});

test('explicit previous-day request is fixed server-side and protected by the same Owner gate',async()=>{
 const f=fixture({previous:true}),r=await f.handler(request({day:'previous'}));assert.equal(r.status,200);
 const data=await r.json();assert.deepEqual(data.window,{createdAfter:'2026-10-08T05:00:00.000Z',createdBefore:'2026-10-09T05:00:00.000Z'});
 for(const change of [{role:'it'},{role:'service'},{invalid:true}]){
 const blocked=fixture(change),response=await blocked.handler(request({day:'previous'}));assert([401,403].includes(response.status));assert.equal(blocked.configReads(),0);
 }
});
test('previous Chicago calendar day handles DST, month/year boundaries and exact midnight',()=>{
 for(const [now,start,end] of [
 ['2026-03-09T12:00:00Z','2026-03-08T06:00:00.000Z','2026-03-09T05:00:00.000Z'],
 ['2026-11-02T12:00:00Z','2026-11-01T05:00:00.000Z','2026-11-02T06:00:00.000Z'],
 ['2026-01-01T12:00:00Z','2025-12-31T06:00:00.000Z','2026-01-01T06:00:00.000Z'],
 ['2026-10-10T05:00:00Z','2026-10-09T05:00:00.000Z','2026-10-10T05:00:00.000Z']])assert.deepEqual(mhelpPreviousDayPreviewWindow(new Date(now)),{createdAfter:start,createdBefore:end});
 assert.throws(()=>mhelpPreviousDayPreviewWindow(new Date('invalid')));
});


test('operational capability is explicitly opted in on the same bounded Owner route and never expands reads',async()=>{
 for(const previous of [false,true]){
  const base=fixture({previous}),extended=fixture({previous}),body=previous?{day:'previous'}:{};
  const legacy=await (await base.handler(request(body))).json();
  const response=await extended.handler(request({...body,evidence})),value=await response.json();
  assert.equal(response.status,200);assert.equal(legacy.operationalEvidence,undefined);
  const {operationalEvidence,...aggregate}=value;assert.deepEqual({...aggregate,readAt:legacy.readAt},legacy);
  assert.equal(operationalEvidence.contract,'cos-mhelpdesk-operational-evidence-v1');assert.equal(operationalEvidence.sampledTickets,0);assert.equal(operationalEvidence.scope,'first_ticket_page');
  assert.deepEqual(extended.calls,base.calls);assert.deepEqual(extended.diagnostics,[]);
  assert(!JSON.stringify(value).includes('do-not-export'));assert(!JSON.stringify(value).includes('synthetic-mhelp'));
 }
 for(const change of [{role:'it'},{role:'service'},{invalid:true},{revoked:true}]){
  const f=fixture(change),response=await f.handler(request({evidence}));assert([401,403].includes(response.status));assert.equal(f.configReads(),0);assert(!f.calls.some(c=>c.url.includes('mhelpdesk.com')));
 }
});

const detailCapability='ticket_detail_structure_v1';
const singleTicket=(previous=false)=>({portalId:Number(portal),ticketId:781234,ticketNumber:891234,typeId:1,typeName:'Service',statusId:1,customStatusId:null,deleted:false,
 creationDate:previous?'2026-10-08T12:00:00Z':'2026-10-09T12:00:00Z',lastModDate:previous?'2026-10-08T13:00:00Z':'2026-10-09T13:00:00Z',assignedTo:null,customerId:671234,serviceLocationId:561234,
 subject:'synthetic-private-detail',summary:'synthetic-private-detail',comment:null,items:null,customFields:null});
test('single-ticket detail capability reuses active same-person Owner gate and fixed today/previous windows',async()=>{
 for(const previous of [false,true]){
  const row=singleTicket(previous),f=fixture({previous,rows:[row]}),body={evidence:detailCapability,...(previous?{day:'previous'}:{})};
  const response=await f.handler(request(body)),value=await response.json();assert.equal(response.status,200);
  assert.equal(value.detailEvidence.state,'detail_verified');assert.equal(value.operationalEvidence.sampledTickets,1);
  assert.equal(f.calls.filter(call=>call.url.includes('/Tickets/')).length,1);assert.equal(f.calls.at(-1).url,'https://connect.mhelpdesk.com/api/v1.0/portal/'+portal+'/Tickets/781234');
  assert(!JSON.stringify(value).includes('synthetic-private-detail'));assert(!JSON.stringify(value).includes('781234'));assert.deepEqual(f.diagnostics,[]);
  assert(f.calls.every(call=>call.method==='GET'));assert(!f.calls.some(call=>call.url.includes('/rpc/')||call.url.includes('vault')));
 }
 for(const change of [{role:'it'},{role:'service'},{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},{id:'22222222-2222-2222-2222-222222222222'},{invalid:true},{inactive:true},{archived:true},{nativeInactive:true},{revoked:true}]){
  const f=fixture({...change,rows:[singleTicket()]});const response=await f.handler(request({evidence:detailCapability}));
  assert([401,403].includes(response.status));assert.equal(f.configReads(),0);assert(!f.calls.some(call=>call.url.includes('mhelpdesk.com')));assert.deepEqual(f.diagnostics,[]);
 }
});
test('detail capability rejects caller ticket selection, arbitrary destinations and other overrides before configuration',async()=>{
 for(const extra of [{ticketId:781234},{ticket_id:781234},{portalId:portal},{url:'https://elsewhere.invalid'},{path:'/Tickets/781234'},{fields:['summary']},{expand:'items'},{createdAfter:'2026-10-08T00:00:00Z'},{createdBefore:'2026-10-10T00:00:00Z'},{maxTickets:1},{activate:true},{token:'private'},{actorId:actor}]){
  const f=fixture({rows:[singleTicket()]});assert.equal((await f.handler(request({evidence:detailCapability,...extra}))).status,400);assert.equal(f.configReads(),0);assert.deepEqual(f.diagnostics,[]);
 }
});
test('same Owner route makes no detail request for legacy clients or a zero/ambiguous bounded selection',async()=>{
 for(const count of [0,2]){
  const f=fixture({rows:Array.from({length:count},(_,i)=>({...singleTicket(),ticketId:781234+i,ticketNumber:891234+i}))});
  const response=await f.handler(request({evidence:detailCapability})),value=await response.json();assert.equal(response.status,200);
  assert.equal(value.detailEvidence.state,'selection_unavailable');assert.equal(value.detailEvidence.reason,count===0?'empty_window':'ambiguous_window');
  assert(!f.calls.some(call=>call.url.includes('/Tickets/')));
 }
 for(const body of [{},{evidence}]){
  const f=fixture({rows:[singleTicket()]}),value=await (await f.handler(request(body))).json();assert.equal(value.detailEvidence,undefined);assert(!f.calls.some(call=>call.url.includes('/Tickets/')));
 }
});
test('detail failures return only fixed reference codes and log sanitized operation/shape evidence',async()=>{
 for(const [change,code] of [[{detail:{data:singleTicket()}},'DETAIL_SCHEMA'],[{detail:{...singleTicket(),ticketId:781235}},'DETAIL_IDENTITY_MISMATCH'],[{detail:{...singleTicket(),lastModDate:'2026-10-09T15:00:00Z'}},'DETAIL_CHANGED'],[{detailHttp:403},'PROVIDER_HTTP']]){
  const f=fixture({rows:[singleTicket()],...change}),response=await f.handler(request({evidence:detailCapability}));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'MHELP_PREVIEW_'+code});
  assert.equal(f.diagnostics.length,1);assert.equal(f.diagnostics[0].code,code);assert.equal(f.calls.filter(call=>call.url.includes('/Tickets/')).length,1);
  if(change.detailHttp)assert.equal(f.diagnostics[0].operation,'ticket_detail_read');else assert(f.diagnostics[0].detailSchema);
  for(const secret of ['synthetic-mhelp','synthetic-private-detail','781234','891234','671234','561234','https://','Authorization'])assert(!JSON.stringify(f.diagnostics).includes(secret),secret);
 }
});

for(const appointmentCapability of ['appointment_structure_v1','appointment_variants_v1'])test(`${appointmentCapability} uses the same active same-person Owner gate and rejects all caller scope overrides`,async()=>{
 for(const previous of [false,true]){
  const f=fixture({previous,rows:[singleTicket(previous)]}),response=await f.handler(request({evidence:appointmentCapability,...(previous?{day:'previous'}:{})})),value=await response.json();
  assert.equal(response.status,200);assert.equal(value.appointmentEvidence.state,'window_reviewed');assert.equal(value.appointmentEvidence.linkage,appointmentCapability==='appointment_structure_v1'?'no_match_in_window':'unverified');
  assert.equal(value.appointmentEvidence.window.startDateUtc,previous?'2026-10-08T05:00:00.000Z':'2026-10-09T05:00:00.000Z');
  assert.equal(value.appointmentEvidence.window.endDateUtc,previous?'2026-10-15T05:00:00.000Z':'2026-10-16T05:00:00.000Z');
  assert.equal(f.calls.filter(call=>call.url.includes('/Appointments?')).length,1);assert(f.calls.every(call=>call.method==='GET'));assert.deepEqual(f.diagnostics,[]);
 }
 for(const change of [{role:'it'},{role:'service'},{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},{id:'22222222-2222-2222-2222-222222222222'},{invalid:true},{inactive:true},{archived:true},{nativeInactive:true},{revoked:true}]){
  const f=fixture({...change,rows:[singleTicket()]}),response=await f.handler(request({evidence:appointmentCapability}));assert([401,403].includes(response.status));assert.equal(f.configReads(),0);assert(!f.calls.some(call=>call.url.includes('mhelpdesk.com')));assert.deepEqual(f.diagnostics,[]);
 }
 for(const extra of [{appointmentId:991234},{ticketId:781234},{portalId:portal},{url:'https://elsewhere.invalid'},{startDateUtc:'2026-10-09T05:00:00Z'},{endDateUtc:'2026-10-16T05:00:00Z'},{window:{}},{scheduleWindow:{}},{pageSize:500},{rowIndex:0},{fields:['Subject']},{sort:'StartUTC'},{scope:'all'},{activate:true}]){
  const f=fixture({rows:[singleTicket()]});assert.equal((await f.handler(request({evidence:appointmentCapability,...extra}))).status,400);assert.equal(f.configReads(),0);assert.deepEqual(f.diagnostics,[]);
 }
 for(const count of [0,2]){
  const f=fixture({rows:Array.from({length:count},(_,i)=>({...singleTicket(),ticketId:781234+i,ticketNumber:891234+i}))}),value=await(await f.handler(request({evidence:appointmentCapability}))).json();
  assert.equal(value.appointmentEvidence.state,'selection_unavailable');assert(!f.calls.some(call=>call.url.includes('/Appointments?')||call.url.includes('/Tickets/')));
 }
});

const privateCapability='ticket_private_sample_v1',privateRequest={evidence:privateCapability,ticketNumber:'891234',appointmentDay:'2026-10-10'};
test('private operational sample is explicit and uses the same active mapped Owner boundary without dictionary or native writes',async()=>{
 const row={...singleTicket(),creationDate:'2026-07-01T12:00:00Z'},detail={...row,items:[{name:'Synthetic source item',description:'First line\nSecond source line',notes:'Literal note',quantity:6,durationSeconds:21600,rate:100,amount:600,contacts:['private contact'],attachments:['private attachment']}]};
 const f=fixture({privateSample:true,rows:[row],detail,appointments:{results:[{TicketId:row.ticketId,PortalId:Number(portal),StartUtc:'2026-10-10T12:00:00Z',UserID:'synthetic-technician@example.invalid',Subject:'Synthetic appointment'}]}}),response=await f.handler(request(privateRequest)),value=await response.json();
 assert.equal(response.status,200);assert.equal(value.contract,'cos-mhelpdesk-ticket-private-sample-v1');assert.equal(value.state,'sample_reviewed');assert.equal(value.items.rows[0].fields.description.value,detail.items[0].description);assert.equal(value.appointments.rows.length,1);assert.equal(value.appointments.completeness,'unverified');assert.equal(value.schema,'unverified');assert.equal(value.automaticSync,false);assert.equal(value.ticketWrites,false);assert.equal(f.configReads(),1);assert.deepEqual(f.diagnostics,[]);
 const vendor=f.calls.filter(c=>c.url.includes('mhelpdesk.com'));assert.equal(vendor.length,4);assert(vendor.every(c=>c.method==='GET'));assert(!f.calls.some(c=>c.url.includes('/rpc/')||c.url.includes('/tickettypes')||c.url.includes('/ticketstatus')||c.url.includes('/Staff')||c.url.includes('/History')));for(const valueToHide of ['private contact','private attachment','synthetic-mhelp','rate','amount'])assert(!JSON.stringify(value).includes(valueToHide));
});
test('private sample rejects IT, Service, unmapped, inactive, archived and revoked Owner sessions before source access',async()=>{
 for(const change of [{role:'it'},{role:'service'},{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},{id:'22222222-2222-2222-2222-222222222222'},{invalid:true},{inactive:true},{archived:true},{nativeInactive:true},{revoked:true}]){const f=fixture(change),response=await f.handler(request(privateRequest));assert([401,403].includes(response.status));assert.equal(f.configReads(),0);assert(!f.calls.some(c=>c.url.includes('mhelpdesk.com')));assert.deepEqual(f.diagnostics,[]);}
});
test('private sample refuses caller credentials, API IDs, endpoints, arbitrary dates and fields before any configuration read',async()=>{
 for(const extra of [{ticketId:781234},{portalId:portal},{url:'https://elsewhere.invalid'},{actorId:actor},{token:'private'},{fields:['Subject']},{day:'previous'},{appointmentId:123},{pageSize:500},{createdAfter:'2026-10-01T00:00:00Z'},{activate:true},{appointmentDay:'2026-11-10'},{ticketNumber:891234},{ticketNumber:'891234/other'}]){const f=fixture(),response=await f.handler(request({...privateRequest,...extra}));assert.equal(response.status,400,JSON.stringify(extra));assert.equal(f.configReads(),0);assert.deepEqual(f.diagnostics,[]);}
 for(const body of [{ticketNumber:'891234',appointmentDay:'2026-10-10'},{evidence:privateCapability},{...privateRequest,evidence:'appointment_variants_v1'}]){const f=fixture(),response=await f.handler(request(body));assert.equal(response.status,400);assert.equal(f.configReads(),0);}
 const f=fixture();assert.equal((await f.handler(request(privateRequest,'GET'))).status,400);assert.equal(f.configReads(),0);
});
test('private sample failures log fixed diagnostic categories only, never ticket number, day or source values',async()=>{
 const row=singleTicket(),f=fixture({privateSample:true,rows:[row],detail:{...row,ticketId:781235}}),response=await f.handler(request(privateRequest));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'MHELP_PREVIEW_DETAIL_IDENTITY_MISMATCH'});assert.equal(f.diagnostics.length,1);for(const value of ['891234','781234','2026-10-10','synthetic-mhelp','synthetic-private-detail','Authorization','https://'])assert(!JSON.stringify(f.diagnostics).includes(value));assert(!f.calls.some(c=>c.url.includes('/Appointments')));
});

test('renewal details stay in fixed server diagnostics; aggregate and private Owner responses retain the existing category',async()=>{
 for(const body of [{},{evidence:'ticket_private_sample_v1',ticketNumber:'22835',appointmentDay:'2026-10-10'}]){
  let renewals=0;const f=fixture({accountHttp:401,renewAccess:async()=>{renewals++;throw new MhelpTokenRenewalError('token_response','http_error',400,'invalid_grant');}});
  const r=await f.handler(request(body));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'MHELP_PREVIEW_RENEWAL_FAILED'});
  assert.equal(renewals,1);assert.equal(f.diagnostics.length,1);
  assert.deepEqual(f.diagnostics[0].renewal,{stage:'token_response',reason:'http_error',httpStatus:400,oauthError:'invalid_grant'});
  assert.equal(f.diagnostics[0].code,'RENEWAL_FAILED');assert(!JSON.stringify(f.diagnostics).includes('synthetic-mhelp'));
 }
});
