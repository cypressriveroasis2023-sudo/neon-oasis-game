import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMhelpPartnerHandler,projectPartnerEquipment,reviewPartnerIdentity} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {checkedPartnerPreview,checkedPartnerStatus} from '../src/mhelpPartnerModel.ts';
const portalId='224643',token='synthetic-test-token';
const row=(values={})=>({equipmentId:1001,portalId:Number(portalId),equipmentTypeId:20,name:'Sniper 2 023.1',model:'Sniper 2',customerId:21,serviceLocationId:22,IsActive:true,lastUpdateUTC:'2026-10-09T01:00:00Z',...values});
const native=()=>({id:randomUUID(),unit_number:'Sniper 2 023.1',metadata:{product_id:'1001'}});
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function fixture({config={portalId,accessToken:token},rows=[row()],units=[native()],totalRows=rows.length,fetcher,fullEquipmentReview=false}={}){
 const calls=[];
 const handler=createMhelpPartnerHandler({fullEquipmentReview,getConfig:()=>config,readNativeUnits:async()=>units,fetch:async(url,init)=>{calls.push({url,init});return fetcher?fetcher(url,init):url.endsWith('/me')?json({portalId:Number(portalId),userName:'private-user',email:'private-contact',password:'synthetic-profile-secret'}):json({totalRows,results:rows});}});
 return {handler,calls};
}
test('configuration is default off, reveals only readiness, and never tests credentials through GET',async()=>{
 const f=fixture({config:{}}),s=await f.handler('/api/mhelpdesk/partner/status','GET',{});
 assert.equal(checkedPartnerStatus(s).state,'setup_required');assert.equal(f.calls.length,0);
 await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),/server-held access token/);
 const ready=await fixture().handler('/api/mhelpdesk/partner/status','GET',{});
 assert.equal(checkedPartnerStatus(ready).state,'ready_to_test');assert.equal(ready.liveAccessVerified,false);assert.equal(JSON.stringify(ready).includes(token),false);
});
test('preview uses only the production allowlisted GET endpoint and preserves decimal labels exactly',async()=>{
 const f=fixture({rows:[row({description:'synthetic password must not be exported',CustomFields:[{value:'synthetic secret'}]})],totalRows:120});
 const data=checkedPartnerPreview(await f.handler('/api/mhelpdesk/partner/preview','POST',{name:'Sniper 2 023.1'}));
 assert.equal(data.partial,true);assert.equal(data.items[0].name,'Sniper 2 023.1');assert.equal(data.items[0].active,true);assert.equal('online'in data.items[0],false);
 assert.equal(data.items[0].identity.state,'review_needed');assert.equal(data.automaticSync,false);assert.equal(data.sheetsPublisher,false);
 assert.equal(JSON.stringify(data).includes('secret'),false);assert.equal(JSON.stringify(data).includes('password'),false);
 assert.equal(f.calls[0].url,'https://connect.mhelpdesk.com/api/v1.0/users/me');assert.equal(data.verifiedPortalId,portalId);
 assert.equal(JSON.stringify(data).includes('private-user'),false);assert.equal(JSON.stringify(data).includes('private-contact'),false);
 const request=f.calls[1],url=new URL(request.url);
 assert.equal(url.origin,'https://connect.mhelpdesk.com');assert.equal(url.pathname,'/api/v1.0/portal/'+portalId+'/equipment');assert.equal(url.searchParams.get('Name'),'Sniper 2 023.1');
 assert.equal(url.searchParams.get('Fields').includes('CustomFields'),false);assert.equal(request.init.method,'GET');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer '+token);assert.equal(url.href.includes(token),false);
});
test('token alone resolves the portal through /users/me without mutating config or reading through GET',async()=>{
 const config={accessToken:token},f=fixture({config});
 const status=checkedPartnerStatus(await f.handler('/api/mhelpdesk/partner/status','GET',{}));
 assert.equal(status.tokenConfigured,true);assert.equal(status.portalConfigured,false);assert.equal(f.calls.length,0);
 const preview=checkedPartnerPreview(await f.handler('/api/mhelpdesk/partner/preview','POST',{}));
 assert.equal(preview.verifiedPortalId,portalId);assert.equal(preview.portalConfigured,false);assert.equal(preview.liveAccessVerified,true);
 assert.deepEqual(config,{accessToken:token});assert.equal(f.calls.length,2);
 assert.equal(new URL(f.calls[1].url).pathname,'/api/v1.0/portal/'+portalId+'/equipment');
});
test('server full review checks complete sorted pages for both zero and one based pagination',async()=>{
 const rows=Array.from({length:403},(_,i)=>row({equipmentId:i+1,name:'Sniper 2 '+String(i+1).padStart(3,'0')}));
 for(const indexBase of [0,1]){
  const f=fixture({fullEquipmentReview:true,fetcher:url=>{
   if(url.endsWith('/me'))return json({portalId:Number(portalId)});
   const u=new URL(url);assert.equal(u.searchParams.get('sort'),null);assert.equal(u.searchParams.get('pageSize'),'200');
   const start=Math.max(0,Number(u.searchParams.get('rowIndex'))-indexBase);
   return json({totalRows:rows.length,results:rows.slice(start,start+200)});
  }});
  const review=await f.handler('/api/mhelpdesk/partner/preview','POST',{});
  assert.equal(review.items.length,403);assert.equal(review.partial,false);assert.deepEqual(review.items.map(v=>v.equipmentId),rows.map(v=>String(v.equipmentId)));
 }
});
test('full review rejects ignored cursors, changing totals, unsorted identities and missing rows',async()=>{
 const rows=Array.from({length:201},(_,i)=>row({equipmentId:i+1}));
 for(const mode of ['ignored','changed','unordered','truncated','cross-portal']){
  let pages=0;const f=fixture({fullEquipmentReview:true,fetcher:url=>{
   if(url.endsWith('/me'))return json({portalId:Number(portalId)});
   pages++;let page=pages===1?rows.slice(0,200):rows.slice(200);
   if(mode==='ignored'&&pages>1)page=rows.slice(0,200);
   if(mode==='unordered')page=page.toReversed();
   if(mode==='truncated'&&pages>1)page=[];
   if(mode==='cross-portal'&&pages>1)page=page.map(v=>({...v,portalId:999}));
   return json({totalRows:mode==='changed'&&pages>1?202:201,results:page});
  }});await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}));
 }
 const f=fixture({fullEquipmentReview:true});await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{name:'Sniper 2 023.1'}),/does not accept filters/);
});
test('invalid or conflicting account portal IDs fail before any equipment or native read',async()=>{
 for(const value of [undefined,0,-1,1.5,'username','001','1/other',Number.MAX_SAFE_INTEGER+1]){
  const f=fixture({config:{accessToken:token},fetcher:()=>json({portalId:value,email:token})});
  await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),error=>/valid company portal ID/.test(error.message)&&!error.message.includes(token));
  assert.equal(f.calls.length,1);
 }
 const conflict=fixture({fetcher:()=>json({portalId:999,email:token})});
 await assert.rejects(conflict.handler('/api/mhelpdesk/partner/preview','POST',{}),/does not match/);assert.equal(conflict.calls.length,1);
 const wrongSetting=fixture({config:{portalId:'my username',accessToken:token}});
 await assert.rejects(wrongSetting.handler('/api/mhelpdesk/partner/preview','POST',{}),/numeric company ID/);assert.equal(wrongSetting.calls.length,0);
});
test('account reads are bounded and equipment failures remain sanitized after portal discovery',async()=>{
 const oversized=fixture({config:{accessToken:token},fetcher:()=>new Response('x'.repeat(16385))});
 await assert.rejects(oversized.handler('/api/mhelpdesk/partner/preview','POST',{}),/oversized/);assert.equal(oversized.calls.length,1);
 for(const status of [401,403,429,500]){
  const f=fixture({fetcher:url=>url.endsWith('/me')?json({portalId:Number(portalId)}):json({error:token},status)});
  await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),error=>!error.message.includes(token)&&error.status===(status===429?429:503));assert.equal(f.calls.length,2);
 }
});
test('identity requires explicit equipment ID, portal, full label, and model; legacy Product IDs never bind',()=>{
 const equipment=projectPartnerEquipment(row(),portalId),unit=native();
 assert.equal(reviewPartnerIdentity(equipment,[unit]).state,'review_needed');
 assert.equal(reviewPartnerIdentity(equipment,[{...unit,unit_number:'Sniper 2 023'}]).candidateUnitIds.length,0);
 unit.metadata.mhelpdeskPartner={portalId,equipmentId:'1001',fullLabel:equipment.name,model:equipment.model};
 assert.equal(reviewPartnerIdentity(equipment,[unit]).nativeUnitId,unit.id);
 assert.equal(reviewPartnerIdentity({...equipment,model:'Sniper 1'},[unit]).state,'identity_changed');
 assert.equal(reviewPartnerIdentity(equipment,[unit,{...unit,id:randomUUID()}]).state,'ambiguous');
 assert.equal(reviewPartnerIdentity(equipment,[unit,{...unit,id:randomUUID(),metadata:{}}]).nativeUnitId,null);
});
test('malformed, duplicate, oversized and cross-portal API pages fail before a preview can be shown',async()=>{
 for(const options of [{rows:[row({portalId:999})]},{rows:[row(),row()]},{rows:[row({equipmentId:1.2})]},{rows:[row({IsActive:'true'})]},{rows:[row({name:''})]},{rows:[row()],totalRows:0},{rows:Array(51).fill(row())}]){
  const f=fixture(options);await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}));
 }
 const f=fixture({fetcher:()=>new Response('x'.repeat(1048577))});await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),/oversized/);
});
test('vendor errors and transport failures cannot leak credentials or provider response text',async()=>{
 for(const status of [401,403,429,500]){
  const f=fixture({fetcher:()=>json({error:token},status)});
  await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),error=>!error.message.includes(token)&&error.status===(status===429?429:503));
 }
 const f=fixture({fetcher:()=>{throw Error(token);}});await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),error=>!error.message.includes(token));
});
test('caller cannot provide credentials, a portal, a URL, an actor, or a publication request',async()=>{
 const f=fixture();
 for(const body of [{token},{portalId},{url:'https://other.example'},{actorId:randomUUID()},{publish:true}])await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',body),/unsupported fields/);
 await assert.rejects(f.handler('/api/mhelpdesk/partner/publish','POST',{}),/not found/);
 await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','GET',{}),/Method/);assert.equal(f.calls.length,0);
});
test('duplicate preview requests cannot fan out, and a completed read releases the guard',async()=>{
 let release;const f=fixture({fetcher:url=>url.endsWith('/me')?new Promise(resolve=>{release=()=>resolve(json({portalId:Number(portalId)}));}):json({totalRows:1,results:[row()]})});
 const first=f.handler('/api/mhelpdesk/partner/preview','POST',{});
 await assert.rejects(f.handler('/api/mhelpdesk/partner/preview','POST',{}),error=>error.status===409);release();await first;
 const second=f.handler('/api/mhelpdesk/partner/preview','POST',{});await Promise.resolve();release();await second;assert.equal(f.calls.length,4);
});
test('client rejects fabricated connected states, partial totals, duplicate identities and broken exact links',async()=>{
 const f=fixture(),data=await f.handler('/api/mhelpdesk/partner/preview','POST',{});
 for(const bad of [{...data,automaticSync:true},{...data,liveAccessVerified:false},{...data,partial:true},{...data,portalConfigured:false,verifiedPortalId:undefined},{...data,verifiedPortalId:'999'},{...data,verifiedPortalId:'username'},{...data,items:[data.items[0],data.items[0]],totalRows:2},{...data,items:[{...data.items[0],identity:{state:'verified_link',nativeUnitId:null,candidateUnitIds:[]}}]}])assert.throws(()=>checkedPartnerPreview(bad));
});
test('full bridge rechecks Owner identity and denies IT/Service before config or external access',async()=>{
 for(const who of [
  {legacy:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',dept:'owner',role:'owner'},
  {legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',dept:'it',role:'it_technician'},
  {legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',dept:'service',role:'service_technician'}]){
  let configReads=0;const urls=[];
  const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-key',mhelpPartner:{getConfig:()=>{configReads++;return {}; }},fetch:async(url)=>{
   urls.push(url);
   if(url.includes('/auth/v1/user'))return json({id:who.legacy});
   if(url.includes('/rest/v1/profiles?'))return json([{user_id:who.legacy,full_name:'Synthetic',role:who.dept,active:true,archived_at:null}]);
   if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:who.actor,display_name:'Synthetic',department:who.dept,active:true}]);
   if(url.includes('/rest/v1/user_roles?'))return json([{role_id:randomUUID(),roles:{code:who.role,organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);
   throw Error('Unexpected fixture request');
  }});
  const request=new Request('https://bridge.example',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/mhelpdesk/partner/status',method:'GET',body:{}})});
  const response=await handler(request);assert.equal(response.status,who.dept==='owner'?200:403);assert.equal(configReads,who.dept==='owner'?1:0);assert.equal(urls.some(url=>url.includes('connect.mhelpdesk.com')),false);
 }
});
