import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {mhelpTodayPreviewWindow} from '../../supabase/functions/cos-operations-pages/mhelpTicketDay.ts';
const endpoint='/api/mhelpdesk/partner/tickets/preview',portal='224643',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const request=(body={},method='POST',origin='https://cos-vision-integration-preview.pages.dev')=>new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-session','Content-Type':'application/json',Origin:origin},body:JSON.stringify({path:endpoint,method,body})});
function fixture(change={}) {
 const calls=[];let configReads=0;
 const technician=change.id==='4f7044b5-86b6-411f-8898-39bb64b4ddbc'?{actor:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',code:'it_technician'}:change.id==='78e54fbd-c2db-4d18-8e3d-a9740adcf285'?{actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',code:'service_technician'}:null;
 const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-server',now:()=>new Date('2026-10-09T22:00:00Z'),mhelpPartner:{getConfig:()=>{configReads++;return {portalId:portal,accessToken:'synthetic-mhelp'};}},fetch:async(url,init={})=>{
  calls.push({url,method:init.method||'GET'});
  if(url.includes('/auth/v1/user'))return change.invalid?json({},401):json({id:change.id||owner});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:change.id||owner,full_name:technician?.name||'Synthetic',role:change.role||technician?.department||'owner',active:!change.inactive,archived_at:change.archived?'2026-01-01':null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:technician?.actor||actor,display_name:technician?.name||'Synthetic',department:technician?.department||'owner',active:!change.nativeInactive}]);
  if(url.includes('/rest/v1/user_roles?'))return json(change.revoked?[]:[{role_id:'11111111-1111-1111-1111-111111111111',roles:{code:technician?.code||'owner',organization_id:org}}]);
  if(url==='https://connect.mhelpdesk.com/api/v1.0/users/me')return json({portalId:Number(portal),private:'do-not-export'});
  if(url.endsWith('/tickettypes'))return json({totalRows:1,data:[{portalId:Number(portal),typeId:1,typeName:'Service',isActive:true}]});
  if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'New',displayText:'New',parentId:null,canBeParent:true}]);
  if(url.includes('/Tickets?')){
   const u=new URL(url);assert.equal(u.searchParams.get('createStart'),'2026-10-09T05:00:00.000Z');assert.equal(u.searchParams.get('createEnd'),'2026-10-09T22:00:00.000Z');
   if(change.providerError)return json({private:'synthetic-mhelp'},429);
   return json({totalRows:0,data:[],private:'do-not-export'});
  }
  throw Error('Unexpected transport');
 }});
 return {handler,calls,configReads:()=>configReads};
}
test('Owner ticket preview uses existing authenticated bridge, server-local day and aggregate-only reader',async()=>{
 const f=fixture(),response=await f.handler(request()),data=await response.json();assert.equal(response.status,200);
 assert.equal(data.contract,'cos-mhelpdesk-ticket-preview-v1');assert.equal(data.automaticSync,false);assert.equal(data.ticketWrites,false);assert.equal(data.previewCount,0);assert.equal(data.types[0].typeId,'1');
 assert.equal(f.configReads(),1);assert(f.calls.every(c=>c.method==='GET'));assert(!JSON.stringify(data).includes('do-not-export'));assert(!JSON.stringify(data).includes('synthetic-mhelp'));
 assert(!f.calls.some(c=>c.url.includes('/rpc/')||c.url.includes('vault')));
});
test('IT, Service, unmapped, inactive and revoked sessions fail before mHelp config or provider reads',async()=>{
 for(const change of [{role:'it'},{role:'service'},{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc'},{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285'},{id:'22222222-2222-2222-2222-222222222222'},{invalid:true},{inactive:true},{archived:true},{nativeInactive:true},{revoked:true}]){
  const f=fixture(change),r=await f.handler(request());assert([401,403].includes(r.status),JSON.stringify(change));assert.equal(f.configReads(),0);assert(!f.calls.some(c=>c.url.includes('mhelpdesk.com')));
 }
});
test('Owner preview rejects caller windows, identities, credentials, URLs and activation before provider access',async()=>{
 for(const body of [{createdAfter:'2020-01-01T00:00:00Z'},{createdBefore:'2027-01-01T00:00:00Z'},{maxTickets:500},{actorId:actor},{portalId:portal},{token:'private'},{url:'https://elsewhere.invalid'},{activate:true}]){
  const f=fixture();assert.equal((await f.handler(request(body))).status,400);assert.equal(f.configReads(),0);
 }
 const f=fixture();assert.equal((await f.handler(request({},'GET'))).status,405);assert.equal(f.configReads(),0);
 const origin=fixture();assert.equal((await origin.handler(request({},'POST','https://elsewhere.invalid'))).status,403);assert.equal(origin.configReads(),0);
});
test('provider failure is a sanitized failed read, without leaking a token or reporting intake activation',async()=>{
 const f=fixture({providerError:true}),r=await f.handler(request());assert.equal(r.status,429);const data=await r.json();assert.match(data.error,/limiting ticket reads/);assert(!JSON.stringify(data).includes('synthetic-mhelp'));assert(!('previewCount'in data));
});
test('Chicago today start is DST-safe and independent of the executor timezone',()=>{
 for(const [now,start] of [['2026-10-09T22:00:00Z','2026-10-09T05:00:00.000Z'],['2026-01-09T22:00:00Z','2026-01-09T06:00:00.000Z'],['2026-03-08T22:00:00Z','2026-03-08T06:00:00.000Z'],['2026-11-01T22:00:00Z','2026-11-01T05:00:00.000Z'],['2026-10-10T02:00:00Z','2026-10-09T05:00:00.000Z']])assert.equal(mhelpTodayPreviewWindow(new Date(now)).createdAfter,start);
 assert.throws(()=>mhelpTodayPreviewWindow(new Date('invalid')));assert.throws(()=>mhelpTodayPreviewWindow(new Date('2026-10-09T05:00:00Z')));
});
