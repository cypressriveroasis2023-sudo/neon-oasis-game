import {PGlite} from '@electric-sql/pglite';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {snapshot} from '../fixtures/camera-evidence-fixtures.mjs';

// All records and tokens below exist only inside this local intercepted fixture.
export const OWNER='00000000-0000-4000-8000-000000000101';
export const IT='00000000-0000-4000-8000-000000000102';
export const SERVICE='00000000-0000-4000-8000-000000000103';
export const OTHER_IT='00000000-0000-4000-8000-000000000104';
export const OTHER_SERVICE='00000000-0000-4000-8000-000000000105';
export const ORIGINAL_KEY='solar_spotter:101';
export const CORRECTED_KEY='solar_spotter:102';
export const PHOTO={name:'synthetic-confirmed-unit.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
const root=new URL('../../../',import.meta.url).pathname;
const actors={
 [OWNER]:{role:'owner',name:'Synthetic Owner'},
 [IT]:{role:'it',name:'Synthetic IT'},
 [SERVICE]:{role:'service',name:'Synthetic Service'},
 [OTHER_IT]:{role:'it',name:'Unverified IT'},
 [OTHER_SERVICE]:{role:'service',name:'Other Service'},
};

export async function mountCorrectionFixture(page,{actor=OWNER,entry='desk',held=false}={}){
 const db=new PGlite(),calls=[],unexpected=[],errors=[],paths=new Map();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('test.jwt_role',true))$$;
 create table prep_tickets(id uuid primary key,status text,is_test boolean default false);
 create table prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table unit_returns(id uuid,equipment_type text,unit_tag text,status text,service_tech_id uuid);
 create table unit_registry(equipment_type text,unit_tag text,lifecycle_status text,current_holder_id uuid);
 create table app_private.service_daily_reports(id uuid,service_tech_id uuid,check_date date,submitted_at timestamptz default now(),snapshot jsonb);
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${IT}'))$$;
 grant usage on schema auth,app_private,storage to authenticated;
 grant select,insert,update,delete on storage.objects to authenticated;
 `);
 for(const [id,p] of Object.entries(actors))await db.query('insert into profiles values($1,$2,true,null,$3,$4)',[id,p.role,p.name,p.name.toLowerCase().replaceAll(' ','_')]);
 for(const tag of ['101','102','103'])await db.query("insert into equipment_master values($1,$2,'Solar Spotter','Solar Spotter','Solar Spotter',$3,'shop',now())",['solar_spotter:'+tag,tag,'Solar Spotter '+tag]);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql','techcheck-handoff-corrections-v1.sql'])await db.exec(await readFile(root+'database-maintenance/'+name,'utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
 await db.exec(`update app_private.techcheck_transfer_correction_settings set enabled=${!held},reports_ready=${!held}`);
 // One fixture connection is explicitly serialized. This harness cannot prove
 // multi-client PostgreSQL lock behavior; that is a separate release gate.
 let pending=Promise.resolve();
 const run=(who,sql,args=[])=>{const result=pending.then(async()=>{
  await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.query("select set_config('test.jwt_role','authenticated',false)");await db.exec('set role authenticated');
  try{return await db.query(sql,args);}finally{await db.exec('reset role');}
 });pending=result.catch(()=>{});return result;};
 const rpc=async(who,name,args={})=>(await run(who,`select public.${name}(${Object.keys(args).map((key,i)=>key+' => $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;
 const id=randomUUID(),originalPath=IT+'/'+id+'/'+'a'.repeat(64)+'.jpg';
 await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[originalPath]);
 paths.set(originalPath,Buffer.from(PHOTO.buffer));
 const rules=JSON.parse(await readFile(root+'transfers/checklist-contract.json','utf8'));
 const originalRequest={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:SERVICE,p_items:[{equipment_key:ORIGINAL_KEY,family:'Solar Spotter',unit_tag:'101',sims:[],battery_count:1,parts:[]}],p_checks:{[ORIGINAL_KEY]:Object.fromEntries(rules.families['Solar Spotter'].bool_fields.map(field=>[field,true]))},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[{equipment_key:ORIGINAL_KEY,kind:'unit',path:originalPath}],p_notes:'Synthetic pending handoff; no SIM was supplied by IT.'};
 await rpc(IT,'submit_techcheck_transfer_v1',originalRequest);
 await db.query("update app_private.techcheck_transfer_outbox set drive_manifest=$2 where event_id=$1",[id,{summary_pdf_v1:{done:true,id:'synthetic-original-pdf'},folder:{done:true,id:'synthetic-original-folder'},complete:true}]);
 const originalEvent=(await db.query('select to_jsonb(e) as data from app_private.techcheck_transfer_events e where id=$1',[id])).rows[0].data;
 const originalOutbox=(await db.query('select to_jsonb(o) as data from app_private.techcheck_transfer_outbox o where event_id=$1',[id])).rows[0].data;
 const role=actors[actor].role;
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101010;color:#fff;font:16px Arial}.hidden,[hidden]{display:none!important}#appView{padding:10px}button{min-height:44px}#ownerAppPage{min-width:0}</style></head><body><div id="appView"><div id="view-it" class="${role==='it'?'':'hidden'}"><section id="legacy">Legacy IT prep</section></div><div id="view-svc" class="${role==='service'?'':'hidden'}"><div id="wlSvcTruckInventory">Morning truck check</div></div><section id="view-owner" class="${role==='owner'?'':'hidden'}" data-owner-route="today"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy" hidden><div id="ownerAppPage"><div id="ownerRouteView">Existing Owner handoffs</div></div></div></section><div id="view-morning" class="hidden"></div><button id="techMenuButton">Legacy menu</button><main id="correction-test-root"></main></div><script>
 window.fixture={actor:${JSON.stringify(actor)},role:${JSON.stringify(role)},online:true,uploadFail:false,rpcFail:false,loseResponse:false,readbackFail:false,failContextAfterWrite:false,corruptReadback:null,capabilityChecks:0};
 Object.defineProperty(navigator,'onLine',{get:()=>fixture.online});
 const actors=${JSON.stringify(actors)},listeners=[];
 const profile=()=>actors[fixture.actor];const session=()=>fixture.actor?{user:{id:fixture.actor},access_token:'synthetic-only-'+fixture.actor}:null;
 const db={auth:{onAuthStateChange:fn=>{listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:session()}})},rpc:async(name,args={})=>{
  if(name==='cos_verified_fleet_capabilities_v1'){fixture.capabilityChecks++;return {data:{fleetRead:fixture.actor==='${IT}'||fixture.actor==='${OWNER}'}};}
  if(fixture.rpcFail || name==='techcheck_transfer_correction_context_v1'&&fixture.readbackFail)return {error:{message:'Synthetic connection interrupted'}};
  const response=await fetch('/synthetic/rpc',{method:'POST',headers:{'Content-Type':'application/json','x-actor':fixture.actor},body:JSON.stringify({name,args})});const result=await response.json();
  if(name==='submit_techcheck_transfer_correction_v1'&&!result.error){if(fixture.failContextAfterWrite)fixture.readbackFail=true;if(fixture.loseResponse){fixture.loseResponse=false;return {error:{message:'Synthetic correction response lost'}};}}
  if(name==='techcheck_transfer_correction_context_v1'&&fixture.corruptReadback)for(const t of result.data?.transfers||[])for(const c of t.corrections||[]){
   if(fixture.corruptReadback==='provenance')c.confirmed_by.id='${SERVICE}';
   if(fixture.corruptReadback==='photo'&&c.photos?.[0])c.photos[0].path='${OWNER}/00000000-0000-4000-8000-000000000999/'+ 'f'.repeat(64)+'.jpg';
  }
  return result;
 },storage:{from:bucket=>({upload:async(path,blob)=>{if(fixture.uploadFail)return {error:{statusCode:503}};const r=await fetch('/synthetic/storage?name='+encodeURIComponent(path),{method:'POST',headers:{'x-actor':fixture.actor},body:blob});return r.ok?{}:{error:{statusCode:r.status}};},createSignedUrl:async path=>({data:{signedUrl:'/synthetic/photo?name='+encodeURIComponent(path)}})})}};
 window.TechCheckContext={db,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getProfile:()=>({full_name:profile()?.name,username:profile()?.name,user_id:fixture.actor,role:fixture.role,active:!!fixture.actor,archived_at:null}),getSession:session};
 window.show=key=>{for(const v of ['it','svc','owner','morning'])document.getElementById('view-'+v)?.classList.toggle('hidden',key!==v);dispatchEvent(new Event('techcheck:view-changed'));};
 window.logout=()=>{fixture.actor=null;document.getElementById('appView').classList.add('hidden');listeners.forEach(fn=>fn('SIGNED_OUT',null));dispatchEvent(new Event('techcheck:data-refreshed'));};
 window.changeActor=actor=>{fixture.actor=actor;fixture.role=actors[actor].role;listeners.forEach(fn=>fn('SIGNED_IN',session()));dispatchEvent(new Event('techcheck:data-refreshed'));};
 window.confirmSameActor=()=>listeners.forEach(fn=>fn('SIGNED_IN',session()));
 </script>${entry==='desk'?'<script type="module">import {mountCorrectionDesk} from "./transfers/corrections.js";window.fixtureDispose=mountCorrectionDesk(document.getElementById("correction-test-root"),window.TechCheckContext);</script>':entry==='owner'?'<script type="module" src="./handoff-corrections-host.js"></script>':'<script type="module" src="./it-daily-host.js"></script>'}</body></html>`;
 // Host tests exercise the real index markup/styles and actual route bridge.
 // Only the legacy account/data renderer is replaced; its redraw is deliberately
 // destructive so correction drafts must survive outside ownerRouteView.
 const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const parentHtml=entry==='desk'?html:(await readFile(root+'index.html','utf8'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('</body>',`<script>${bootstrap}
   document.getElementById('sessionLoading')?.remove();
   document.getElementById('authView')?.classList.add('hidden');
   document.getElementById('appView').classList.remove('hidden');
   show(${JSON.stringify(role==='service'?'svc':role)});
   window.ownerAppNavigate=route=>{document.getElementById('view-owner').dataset.ownerRoute=route;document.getElementById('ownerRouteView').textContent='Synthetic legacy '+route+' view';};
   window.refreshData=()=>{document.getElementById('ownerRouteView').innerHTML='<p>Refreshed legacy handoffs</p>';dispatchEvent(new Event('techcheck:data-refreshed'));};
   </script>${entry==='owner'?'<script type="module" src="./operations-host.js"></script><script type="module" src="./handoff-corrections-host.js"></script>':'<script type="module" src="./it-daily-host.js"></script>'}</body>`);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin==='https://tile.openstreetmap.org'&&/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname))return route.fulfill({contentType:'image/png',body:PHOTO.buffer});
  if(url.origin==='http://127.0.0.1:4173'&&url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:parentHtml});
  if(url.pathname==='/synthetic/rpc'){
   const {name,args}=req.postDataJSON();calls.push({name,args});
   if(!['techcheck_transfer_readiness_v1','techcheck_transfer_context_v1','submit_techcheck_transfer_v1','techcheck_transfer_correction_context_v1','submit_techcheck_transfer_correction_v1'].includes(name)){unexpected.push(name);return route.abort();}
   try{return route.fulfill({json:{data:await rpc(req.headers()['x-actor'],name,args)}});}catch(error){return route.fulfill({json:{error:{message:error.message,code:error.code==='42883'?'PGRST202':error.code}}});}
  }
  if(url.pathname==='/synthetic/storage'){
   const bytes=req.postDataBuffer(),path=url.searchParams.get('name');
   try{await run(req.headers()['x-actor'],"insert into storage.objects values('techcheck-transfer-evidence',$1,$2)",[path,{mimetype:'image/jpeg',size:bytes.length}]);paths.set(path,Buffer.from(bytes));return route.fulfill({json:{ok:true}});}catch(error){return route.fulfill({status:error.code==='23505'?409:403,json:{error:error.message}});}
  }
  if(url.pathname==='/synthetic/photo'){const bytes=paths.get(url.searchParams.get('name'));return bytes?route.fulfill({contentType:'image/jpeg',body:bytes}):route.fulfill({status:404});}
  if(url.pathname.endsWith('/functions/v1/cos-operations-pages')){
   const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'*'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   const call=req.postDataJSON();calls.push(call);const now=new Date().toISOString();
   const payload=call.path==='/api/session'?{authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',name:actors[actor].name,features:{fleetAccess:true,unitTracker:true,vrmRead:true,fleetPlacementEdit:true,fleetConnectionEdit:true,cameraHealthV2:true}}
    :call.path==='/api/tech/session'?{authorized:true,legacyTechnician:true,department:'it'}
    :call.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:now}
    :call.path==='/api/camera-health/summary-v3'?{...snapshot([]),refreshedAt:now}
    :call.path==='/api/routers'?{items:[],source:'camera_health',generatedAt:now}
    :call.path==='/api/vrm-fleet'?{items:[],sync:{state:'current',scheduleActive:true}}:undefined;
   if(!payload){unexpected.push(call);return route.fulfill({status:403,headers,json:{error:'Unavailable in synthetic fixture'}});}return route.fulfill({headers,json:payload});
  }
  if(url.origin==='http://127.0.0.1:4173'&&url.pathname.startsWith('/tech-checks/')){
   const path=resolve(root,'.'+url.pathname.slice('/tech-checks'.length));
   if(path.startsWith(root)){try{if((await stat(path)).isFile())return route.fulfill({body:await readFile(path),contentType:{'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'});}catch{}}
  }
  unexpected.push(url.pathname);return route.abort();
 });
 await page.goto('http://127.0.0.1:4173/tech-checks/'+(entry==='owner'?'#tech-checks':''));
 return {db,run,rpc,calls,unexpected,errors,paths,transferId:id,originalEvent,originalOutbox,originalPath,close:async()=>{await pending;await db.close();}};
}
