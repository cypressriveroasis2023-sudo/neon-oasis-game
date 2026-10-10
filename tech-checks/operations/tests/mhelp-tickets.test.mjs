import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTicketReader,projectPartnerTicket,projectMhelpTicketPreview,MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
const portalId='224643',token='synthetic-private-token';
const window={createdAfter:'2026-10-08T00:00:00Z',createdBefore:'2026-10-10T00:00:00Z'};
const ticket=(overrides={})=>({portalId:Number(portalId),ticketId:10,ticketNumber:100,typeId:11,typeName:'Installation',statusId:1,customStatusId:12,
  deleted:false,creationDate:'2026-10-09T01:00:00-05:00',lastModDate:'2026-10-09T02:00:00-05:00',customerId:20,serviceLocationId:21,
  assignedTo:'synthetic-private-assignee@example.test',subject:'synthetic-private-subject',summary:'synthetic-private-summary',
  customFields:[{fieldValue:'synthetic-private-custom'}],...overrides});
const typeRows=[{portalId:Number(portalId),typeId:11,typeName:'Installation',isActive:true}];
const statusRows=[{statusId:1,statusText:'New',displayText:'New',parentId:null,canBeParent:true},{statusId:12,statusText:'Scheduled',displayText:'New: Scheduled',parentId:1,canBeParent:false}];
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture({config={portalId,accessToken:token},rows=[ticket()],types=typeRows,statuses=statusRows,indexBase=0,fetcher,renewAccess,getConfig}={}){
  const calls=[];
  const reader=createMhelpTicketReader({getConfig:getConfig||(()=>config),renewAccess,fetch:async(url,init)=>{
    calls.push({url,init});
    const override=await fetcher?.(url,init,calls);if(override)return override;
    if(url.endsWith('/users/me'))return json({portalId:Number(portalId),email:'synthetic-private-profile@example.test'});
    if(url.endsWith('/tickettypes'))return json({totalRows:types.length,data:types});
    if(url.endsWith('/ticketstatus'))return json(statuses);
    const parsed=new URL(url);assert.equal(parsed.pathname,'/api/v1.0/portal/'+portalId+'/Tickets');
    const start=Math.max(0,Number(parsed.searchParams.get('rowIndex'))-indexBase);
    return json({totalRows:rows.length,data:rows.slice(start,start+50)});
  }});
  return {...reader,calls};
}
test('bounded ticket preview verifies the existing account and uses only documented production reads',async()=>{
  const f=fixture(),result=await f.preview(window);
  assert.equal(result.previewCount,1);assert.equal(result.totalRows,1);assert.equal(result.partial,false);
  assert.equal(result.automaticSync,false);assert.equal(result.ticketWrites,false);assert.equal(result.verifiedPortalId,portalId);
  assert.equal(result.types[0].typeId,'11');assert.equal(result.types[0].count,1);assert.equal(result.statuses[1].customStatusCount,1);
  assert.equal(result.metrics.assignedTickets,1);
  const serialized=JSON.stringify(result);for(const forbidden of ['synthetic-private','ticketId','ticketNumber','customerId','serviceLocationId','assignedTo','subject','summary','customFields'])assert.equal(serialized.includes(forbidden),false,forbidden);
  assert.equal(f.calls.length,4);assert.equal(f.calls[0].url,'https://connect.mhelpdesk.com/api/v1.0/users/me');
  for(const request of f.calls){const u=new URL(request.url);assert.equal(u.origin,'https://connect.mhelpdesk.com');assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'error');assert.equal(request.init.cache,'no-store');assert.equal(request.init.headers.Authorization,'Bearer '+token);assert.equal(u.href.includes(token),false);}
  const u=new URL(f.calls[3].url);assert.equal(u.searchParams.get('sort'),'ticketId');assert.equal(u.searchParams.get('pageSize'),'50');
  assert.equal(u.searchParams.get('createStart'),'2026-10-08T00:00:00.000Z');assert.equal(u.searchParams.get('createEnd'),'2026-10-10T00:00:00.000Z');assert.equal(u.searchParams.has('Fields'),false);
  assert.deepEqual(projectMhelpTicketPreview(result),result);
});
test('internal ticket DTO preserves source IDs, normalizes offsets, and discards unneeded fields',()=>{
  const dto=projectPartnerTicket(ticket({newPrivateField:'discard-me'}),portalId);
  assert.equal(dto.creationDate,'2026-10-09T06:00:00.000Z');assert.equal(dto.lastModDate,'2026-10-09T07:00:00.000Z');
  assert.equal(dto.ticketId,'10');assert.equal(dto.ticketNumber,'100');assert.equal(dto.unknownFieldCount,1);
  assert.equal(dto.assignedTo,'synthetic-private-assignee@example.test');assert.equal('subject' in dto,false);assert.equal('newPrivateField' in dto,false);
});
test('unknown source fields and unmapped IDs are counted without exporting values or names',async()=>{
  const result=await fixture({rows:[ticket({typeId:99,statusId:0,customStatusId:999,customerId:0,serviceLocationId:0,assignedTo:null,privateApiKey:'discard-me'})]}).preview(window);
  assert.equal(result.metrics.unknownTypeIds,1);assert.equal(result.metrics.unknownStatusIds,1);assert.equal(result.metrics.unknownCustomStatusIds,1);
  assert.equal(result.metrics.missingCustomerIds,1);assert.equal(result.metrics.missingServiceLocationIds,1);assert.equal(result.metrics.assignedTickets,0);
  assert.equal(result.metrics.ticketsWithUnknownFields,1);assert.equal(result.metrics.unknownFieldOccurrences,1);
  assert.equal(JSON.stringify(result).includes('privateApiKey'),false);assert.equal(JSON.stringify(result).includes('discard-me'),false);
});
test('an absent assignment field is unknown, distinct from an explicit unassigned value',async()=>{
  const unknown=ticket();delete unknown.assignedTo;
  assert.equal(projectPartnerTicket(unknown,portalId).assignmentState,'unknown');
  for(const assignedTo of [null,''])assert.equal(projectPartnerTicket(ticket({assignedTo}),portalId).assignmentState,'unassigned');
  assert.equal(projectPartnerTicket(ticket(),portalId).assignmentState,'assigned');
  const result=await fixture({rows:[unknown,ticket({ticketId:11,assignedTo:null}),ticket({ticketId:12})]}).preview(window);
  assert.equal(result.metrics.missingAssignmentFields,1);assert.equal(result.metrics.assignedTickets,1);
});
test('empty creation window returns a complete zero count with real dictionaries',async()=>{
  const result=await fixture({rows:[]}).preview(window);assert.equal(result.totalRows,0);assert.equal(result.types[0].count,0);assert.equal(result.partial,false);
});
test('complete bounded pagination accepts verified zero and one based row indexes',async()=>{
  const rows=Array.from({length:103},(_,i)=>ticket({ticketId:i+1,ticketNumber:i+1}));
  for(const indexBase of [0,1]){
    const f=fixture({rows,indexBase}),result=await f.preview(window);assert.equal(result.previewCount,103);assert.equal(result.types[0].count,103);
    assert.equal(f.calls.filter(v=>v.url.includes('/Tickets')).length,indexBase?4:3);
  }
});
test('repeated pages, changed totals, truncation, unsupported envelope, sorting and cross-portal data fail closed',async()=>{
  const rows=Array.from({length:51},(_,i)=>ticket({ticketId:i+1,ticketNumber:i+1}));
  for(const mode of ['repeat','changed','empty','unordered','envelope','crossportal','outofwindow']){
    let pages=0;
    const f=fixture({rows,fetcher:url=>{
      if(!url.includes('/Tickets'))return;pages++;
      let data=pages===1?rows.slice(0,50):rows.slice(50),totalRows=rows.length;
      if(mode==='repeat'&&pages>1)data=rows.slice(0,50);
      if(mode==='changed'&&pages>1)totalRows++;
      if(mode==='empty'&&pages>1)data=[];
      if(mode==='unordered')data=[...data].reverse();
      if(mode==='envelope')return json({totalRows,results:data});
      if(mode==='crossportal'&&pages>1)data=data.map(row=>({...row,portalId:999}));
      if(mode==='outofwindow')data=data.map(row=>({...row,creationDate:'2026-10-07T00:00:00Z'}));
      return json({totalRows,data});
    }});
    await assert.rejects(f.preview(window),MhelpTicketError,mode);
  }
});
test('caller-controlled URL, credentials, portal, unbounded or malformed windows never read configuration',async()=>{
  let reads=0;const f=fixture({getConfig:()=>{reads++;return {accessToken:token};}});
  for(const input of [{},null,{...window,url:'https://other.test'}, {...window,portalId}, {...window,accessToken:token}, {...window,maxTickets:0}, {...window,maxTickets:501}, {...window,maxTickets:1.5}, {...window,createdBefore:window.createdAfter}, {...window,createdAfter:'2026-01-01T00:00:00Z'}, {...window,createdAfter:'2026-10-08T00:00:00'}, {...window,createdBefore:'2026-02-30T00:00:00Z'}])await assert.rejects(f.preview(input),error=>error.status===400);
  assert.equal(reads,0);assert.equal(f.calls.length,0);
});
test('maximum count stops before incomplete results can be reported',async()=>{
  const rows=Array.from({length:3},(_,i)=>ticket({ticketId:i+1,ticketNumber:i+1}));
  await assert.rejects(fixture({rows}).preview({...window,maxTickets:2}),/maximum count/);
  await assert.rejects(fixture({fetcher:url=>url.includes('/Tickets')?json({totalRows:501,data:[]}):undefined}).preview(window),/maximum count/);
});
test('creation window follows the documented strict greater-than and less-than bounds',async()=>{
  for(const creationDate of [window.createdAfter,window.createdBefore])await assert.rejects(fixture({rows:[ticket({creationDate,lastModDate:'2026-10-10T01:00:00Z'})]}).preview(window),/outside the requested creation window/);
});
test('portal mismatch and bad server config stop before ticket reads',async()=>{
  for(const config of [{},{accessToken:'bad token'},{accessToken:token,portalId:'001'},{accessToken:token,portalId:'999'}]){
    const f=fixture({config});await assert.rejects(f.preview(window));assert(f.calls.length<=1);
  }
  const f=fixture({config:{accessToken:token}});await f.preview(window);assert.equal(f.calls.length,4);
});
test('missing or malformed required ticket identities, timestamps, statuses and assignees are rejected',()=>{
  for(const overrides of [{portalId:999},{ticketId:0},{ticketId:1.5},{ticketId:'001'},{ticketNumber:0},{creationDate:'2026-10-09T00:00:00'},{creationDate:'2026-02-30T00:00:00Z'}, {lastModDate:'2026-10-08T00:00:00Z'}, {statusId:undefined}, {statusId:-1},{deleted:undefined},{deleted:'false'},{assignedTo:['someone']},{assignedTo:'line\nbreak'},{typeId:'10/other'}])assert.throws(()=>projectPartnerTicket(ticket(overrides),portalId),MhelpTicketError);
});
test('dictionary reads require exact documented envelopes, unique IDs and consistent portal/status parents',async()=>{
  for(const options of [{types:[...typeRows,...typeRows]},{types:[{...typeRows[0],portalId:999}]},{types:[{...typeRows[0],isActive:'true'}]},{statuses:[...statusRows,...statusRows]},{statuses:[{...statusRows[1],parentId:999}]}, {fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:2,data:typeRows}):undefined},{fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:typeRows}):undefined},{fetcher:url=>url.endsWith('/ticketstatus')?json({data:statusRows}):undefined}])await assert.rejects(fixture(options).preview(window));
});
test('expired account read renews existing credentials once before further reads',async()=>{
  let renewals=0;const f=fixture({renewAccess:async()=>{renewals++;return {portalId,accessToken:'synthetic-renewed'};},fetcher:(url,init)=>url.endsWith('/users/me')&&init.headers.Authorization.endsWith(token)?json({secret:token},401):undefined});
  await f.preview(window);assert.equal(renewals,1);assert.equal(f.calls.length,5);assert.equal(f.calls[4].init.headers.Authorization,'Bearer synthetic-renewed');
  const denied=fixture({renewAccess:async()=>{renewals++;return {accessToken:'synthetic-renewed'};},fetcher:()=>json({},401)});
  await assert.rejects(denied.preview(window));assert.equal(denied.calls.length,2);
});
test('renewal cannot silently change the configured portal and ticket 401 does not renew',async()=>{
  const changed=fixture({renewAccess:async()=>({portalId:'999',accessToken:'synthetic-new'}),fetcher:()=>json({},401)});
  await assert.rejects(changed.preview(window),/match the saved portal/);assert.equal(changed.calls.length,1);
  let renewals=0;const f=fixture({renewAccess:async()=>{renewals++;return {accessToken:token};},fetcher:url=>url.includes('/Tickets')?json({},401):undefined});
  await assert.rejects(f.preview(window));assert.equal(renewals,0);
});
test('provider errors, configuration and transport failures never expose secret content',async()=>{
  for(const status of [401,403,429,500]){
    const f=fixture({fetcher:()=>json({error:token},status)});
    await assert.rejects(f.preview(window),error=>error instanceof MhelpTicketError&&!error.message.includes(token)&&error.status===(status===429?429:503));
  }
  for(const options of [{fetcher:()=>{throw Error(token);}},{getConfig:()=>{throw Error(token);}},{renewAccess:async()=>{throw Error(token);},fetcher:()=>json({},401)}])await assert.rejects(fixture(options).preview(window),error=>!error.message.includes(token));
});
test('response streams and content length are bounded; incomplete JSON remains sanitized',async()=>{
  for(const fetcher of [()=>new Response('x'.repeat(16385)),url=>url.includes('/Tickets')?new Response('x'.repeat(1048577)):undefined,url=>url.includes('/Tickets')?new Response('{}',{headers:{'Content-Length':'1048577'}}):undefined,url=>url.includes('/Tickets')?new Response('{'+token):undefined])await assert.rejects(fixture({fetcher}).preview(window),error=>!error.message.includes(token));
});
test('a shared response budget bounds total bytes across otherwise individually valid pages',async()=>{
  const rows=Array.from({length:201},(_,i)=>ticket({ticketId:i+1,ticketNumber:i+1,summary:'x'.repeat(17000)}));
  await assert.rejects(fixture({rows}).preview(window),/oversized ticket response/);
});
test('the shared ticket-request deadline aborts an unfinished provider read without leaking its error',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let requested;const started=new Promise(resolve=>{requested=resolve});
  const f=fixture({fetcher:(url,init)=>url.includes('/Tickets')?new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(Error('synthetic-private-aborted-request')),{once:true});requested();
  }):undefined});
  const pending=f.preview(window);await started;
  const checked=assert.rejects(pending,error=>error instanceof MhelpTicketError&&!error.message.includes('synthetic-private'));
  t.mock.timers.tick(20001);await checked;assert.equal(f.calls[3].init.signal.aborted,true);
});
test('concurrent previews are blocked before config access and a failure releases the guard',async()=>{
  let release;const f=fixture({fetcher:url=>url.endsWith('/users/me')?new Promise(resolve=>{release=()=>resolve(json({portalId:Number(portalId)}));}):undefined});
  const first=f.preview(window);await Promise.resolve();await assert.rejects(f.preview(window),error=>error.status===409);release();await first;
  const second=f.preview(window);await Promise.resolve();release();await second;
  let attempts=0;const g=fixture({fetcher:()=>{if(attempts++===0)throw Error('synthetic');}});await assert.rejects(g.preview(window));await g.preview(window);
});
test('maintenance projector strips all extra values recursively and rejects fabricated success',async()=>{
  const preview=await fixture().preview(window),extra={...preview,secret:token,tickets:[ticket()],types:preview.types.map(row=>({...row,private:token})),statuses:preview.statuses.map(row=>({...row,private:token})),metrics:{...preview.metrics,private:token}};
  assert.deepEqual(projectMhelpTicketPreview(extra),preview);assert.equal(JSON.stringify(projectMhelpTicketPreview(extra)).includes(token),false);
  for(const bad of [{...preview,automaticSync:true},{...preview,ticketWrites:true},{...preview,partial:true},{...preview,liveAccessVerified:false},{...preview,totalRows:2},{...preview,types:[{...preview.types[0],count:2}]},{...preview,metrics:{...preview.metrics,assignedTickets:2}},{...preview,verifiedPortalId:'999'}])assert.throws(()=>projectMhelpTicketPreview(bad));
});
