import {PGlite} from '@electric-sql/pglite';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {snapshot,resource} from '../fixtures/camera-evidence-fixtures.mjs';
export const IT='4f7044b5-86b6-411f-8898-39bb64b4ddbc',SERVICE='00000000-0000-4000-8000-000000000002',OTHER='00000000-0000-4000-8000-000000000003';
const root=new URL('../../../',import.meta.url).pathname;
export async function mountTransfers(page,{role='it',serviceActor=SERVICE,seedHandoff=false}={}){
 const db=new PGlite(),paths=new Map(),calls=[],unexpected=[],errors=[];
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${IT}'))$$;
 insert into profiles values('${IT}','it',true,null,'Synthetic IT','it'),('${SERVICE}','service',true,null,'Synthetic Service','service'),('${OTHER}','service',true,null,'Other Service','other');
 insert into equipment_master values('sniper:001','001','Sniper','Sniper','Sniper','Sniper 001','shop',now()),('ranger:002','002','Ranger','Ranger','Ranger','Ranger 002','shop',now());
 grant usage on schema auth,app_private,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 await db.exec(await readFile(root+'database-maintenance/techcheck-named-handoffs-v1.sql','utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true');
 // Serialize fixture connections exactly; roles cannot bleed between HTTP requests.
 let pending=Promise.resolve();
 const run=(actor,sql,args=[])=>{const result=pending.then(async()=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');try{return await db.query(sql,args);}finally{await db.exec('reset role');}});pending=result.catch(()=>{});return result;};
 let handoff=null;
 if(seedHandoff){const rules=JSON.parse(await readFile(root+'transfers/checklist-contract.json','utf8'));const id=randomUUID(),path=IT+'/'+id+'/'+'a'.repeat(64)+'.jpg';await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[path]);
 const args={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:serviceActor,p_items:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['00123456789012345670'],battery_count:2,parts:[{name:'SD card',quantity:1}]}],p_checks:{'sniper:001':Object.fromEntries(rules.families.Sniper.bool_fields.map(field=>[field,true]))},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[{equipment_key:'sniper:001',kind:'unit',path}],p_notes:'Synthetic equipment checked for the named Service technician.'};
 handoff=(await run(IT,`select submit_techcheck_transfer_v1(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;
 }
 const actor=role==='it'?IT:SERVICE;
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101010;color:#fff;font:16px Arial}.hidden{display:none!important}#appView{padding:10px}button{min-height:44px}</style></head><body><div id="appView"><div id="view-it" class="${role==='it'?'':'hidden'}"><section id="legacy"><button>Legacy IT prep</button></section></div><div id="view-svc" class="${role==='service'?'':'hidden'}"><div id="wlSvcTruckInventory"><h1>Morning truck check</h1><button id="existingDailyComplete">Complete &amp; Send</button></div></div><div id="view-owner" class="hidden">Owner tools</div><div id="view-morning" class="hidden"></div><button id="techMenuButton">Legacy menu</button></div><script>
 window.fixture={actor:${JSON.stringify(actor)},role:${JSON.stringify(role)},online:true,uploadFail:false,rpcFail:false,loseResponse:false};
 Object.defineProperty(navigator,'onLine',{get:()=>fixture.online});
 const listeners=[];const name=()=>fixture.actor==='${IT}'?'Synthetic IT':fixture.actor==='${SERVICE}'?'Synthetic Service':'Other Service';
 const session=()=>({user:{id:fixture.actor},access_token:'synthetic-only-'+fixture.actor});
 const db={auth:{onAuthStateChange:fn=>{listeners.push(fn);return {};},getSession:async()=>({data:{session:session()}})},rpc:async(name,args={})=>{
 if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:fixture.role==='it'}};
 if(fixture.rpcFail)return {error:{message:'Synthetic connection interrupted'}};
 const response=await fetch('/synthetic/rpc',{method:'POST',headers:{'Content-Type':'application/json','x-actor':fixture.actor},body:JSON.stringify({name,args})});const result=await response.json();
 if(name==='submit_techcheck_transfer_v1'&&fixture.loseResponse&&!result.error){fixture.loseResponse=false;return {error:{message:'Synthetic response lost'}};}return result;
 },storage:{from:bucket=>({upload:async(path,blob)=>{if(fixture.uploadFail)return {error:{statusCode:503}};const r=await fetch('/synthetic/storage?name='+encodeURIComponent(path),{method:'POST',headers:{'x-actor':fixture.actor},body:blob});return r.ok?{}:{error:{statusCode:r.status}};},createSignedUrl:async path=>({data:{signedUrl:'/synthetic/photo?name='+encodeURIComponent(path)}})})}};
 window.TechCheckContext={db,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getProfile:()=>({full_name:name(),username:name(),user_id:fixture.actor,role:fixture.role,active:true,archived_at:null}),getSession:session};
 window.show=key=>{for(const v of ['it','svc','owner','morning'])document.getElementById('view-'+v).classList.toggle('hidden',key!==v);dispatchEvent(new Event('techcheck:view-changed'));};
 window.logout=()=>{fixture.actor=null;document.getElementById('appView').classList.add('hidden');listeners.forEach(fn=>fn('SIGNED_OUT'));};
 window.changeActor=actor=>{fixture.actor=actor;listeners.forEach(fn=>fn('SIGNED_IN'));dispatchEvent(new Event('techcheck:data-refreshed'));};
 </script><script type="module" src="./${role==='it'?'it-daily-host.js':'service-transfer-host.js'}"></script></body></html>`;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.origin==='http://127.0.0.1:4173'&&url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:html});
 if(url.pathname==='/synthetic/rpc'){
  const {name,args}=req.postDataJSON();calls.push({name,args});
  if(!['techcheck_transfer_context_v1','submit_techcheck_transfer_v1'].includes(name)){unexpected.push(name);return route.abort();}
  try{const rows=await run(req.headers()['x-actor'],`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args));return route.fulfill({json:{data:rows.rows[0].result}});}catch(e){return route.fulfill({json:{error:{message:e.message,code:e.code}}});}
 }
 if(url.pathname==='/synthetic/storage'){
  const bytes=req.postDataBuffer(),path=url.searchParams.get('name');try{await run(req.headers()['x-actor'],"insert into storage.objects values('techcheck-transfer-evidence',$1,$2)",[path,{mimetype:'image/jpeg',size:bytes.length}]);paths.set(path,bytes);return route.fulfill({json:{ok:true}});}catch(e){return route.fulfill({status:e.code==='23505'?409:403,json:{error:e.message}});}
 }
 if(url.pathname==='/synthetic/photo'){const bytes=paths.get(url.searchParams.get('name'));return bytes?route.fulfill({contentType:'image/jpeg',body:bytes}):route.fulfill({status:404});}
 if(url.pathname.endsWith('/functions/v1/cos-operations-pages')){
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'*'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const call=req.postDataJSON();calls.push(call);const now=new Date().toISOString();
  const payload=call.path==='/api/session'?{authorized:true,legacyOwner:false,role:'IT',name:'Synthetic IT',features:{fleetAccess:true,unitTracker:true,vrmRead:true,fleetPlacementEdit:true,fleetConnectionEdit:true,cameraHealthV2:true}}
   :call.path==='/api/tech/session'?{authorized:true,legacyTechnician:true,department:'it'}
   :call.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:now}
   :call.path==='/api/camera-health/summary-v3'?{...snapshot([]),refreshedAt:now}
   :call.path==='/api/vrm-fleet'?{items:[],sync:{state:'current',scheduleActive:true}}:undefined;
  if(!payload){unexpected.push(call);return route.fulfill({status:403,headers,json:{error:'Unavailable in synthetic fixture'}});}return route.fulfill({headers,json:payload});
 }
 if(url.origin==='http://127.0.0.1:4173'&&url.pathname.startsWith('/tech-checks/')){const path=resolve(root,'.'+url.pathname.slice('/tech-checks'.length));if(path.startsWith(root)){try{if((await stat(path)).isFile())return route.fulfill({body:await readFile(path),contentType:{'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'});}catch{}}}
 unexpected.push(url.pathname);return route.abort();
 });
 await page.goto('http://127.0.0.1:4173/tech-checks/');
 return {db,run,calls,unexpected,errors,handoff,paths,close:async()=>{await pending;await db.close();}};
}
