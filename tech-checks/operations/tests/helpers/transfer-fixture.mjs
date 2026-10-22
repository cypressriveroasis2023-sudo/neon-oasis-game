import {PGlite} from '@electric-sql/pglite';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {snapshot,resource} from '../fixtures/camera-evidence-fixtures.mjs';
export const IT='4f7044b5-86b6-411f-8898-39bb64b4ddbc',TEST_IT='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf',SERVICE='00000000-0000-4000-8000-000000000002',OTHER='00000000-0000-4000-8000-000000000003';
const linkedIT=new Map([[IT,{name:'Synthetic IT',actorId:'d0757b64-9623-4adc-afff-21cc7853e88a'}],[TEST_IT,{name:'Test IT',actorId:'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'}]]);
const root=new URL('../../../',import.meta.url).pathname;
export async function mountTransfers(page,{role='it',itActor=IT,serviceActor=SERVICE,seedHandoff=false,handoffPurpose='installation',seedItems=null,legacyHandoff=false,legacyReceiptCounts=[],rollout='ready',readinessDelay=0}={}){
 const itIdentity=linkedIT.get(itActor);if(!itIdentity)throw Error('Unknown synthetic IT identity');
 const db=new PGlite(),paths=new Map(),calls=[],unexpected=[],errors=[];
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
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
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id in ('${IT}','${TEST_IT}')))$$;
 insert into profiles values('${itActor}','it',true,null,'${itIdentity.name}','it'),('${SERVICE}','service',true,null,'Synthetic Service','service'),('${OTHER}','service',true,null,'Other Service','other');
 insert into equipment_master values('sniper:001','001','Sniper','Sniper','Sniper','Sniper 001','shop',now()),('ranger:002','002','Ranger','Ranger','Ranger','Ranger 002','shop',now()),('solar_spotter:039','039','Solar Spotter','Solar Spotter','Solar Spotter','Solar Spotter 039','shop',now());
 grant usage on schema auth,app_private,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 await db.exec(await readFile(root+'database-maintenance/techcheck-named-handoffs-v1.sql','utf8'));
 await db.exec(await readFile(root+'database-maintenance/techcheck-transfer-rollout-v2.sql','utf8'));
 await db.exec(await readFile(root+'database-maintenance/techcheck-transfer-integration-v3.sql','utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
 // Serialize fixture connections exactly; roles cannot bleed between HTTP requests.
 let pending=Promise.resolve();
 const run=(actor,sql,args=[])=>{const result=pending.then(async()=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');try{return await db.query(sql,args);}finally{await db.exec('reset role');}});pending=result.catch(()=>{});return result;};
 const purposeMigration=await readFile(root+'database-maintenance/techcheck-transfer-purpose-v2.sql','utf8');
 if(!legacyHandoff)await db.exec(purposeMigration);
 let handoff=null;
 if(seedHandoff){const rules=JSON.parse(await readFile(root+'transfers/checklist-contract.json','utf8'));const id=randomUUID(),path=itActor+'/'+id+'/'+'a'.repeat(64)+'.jpg';await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[path]);
 const items=seedItems||[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['00123456789012345670'],battery_count:!legacyHandoff&&handoffPurpose==='truck_replenishment'?null:2,...(legacyHandoff?{}:{battery_configuration:handoffPurpose==='truck_replenishment'?null:'sniper_2x_12v_35ah'}),parts:[{name:'SD card',quantity:1}]}];
 const checks=Object.fromEntries(items.map(item=>{let fields=rules.families[item.family].bool_fields;if(!legacyHandoff&&handoffPurpose==='installation')fields=fields.concat(item.family==='Helios'?['delivery_monitoring_ok','delivery_customer_email_app_ok']:['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok']);if(!legacyHandoff&&handoffPurpose==='truck_replenishment')fields=fields.filter(field=>!['delivery_batteries_charged_ok','helios_battery_box_installed_ok','helios_battery_120v_charged_ok'].includes(field));return [item.equipment_key,Object.fromEntries(fields.map(field=>[field,true]))];}));
 const photoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64'),photos=[];
 for(let index=0;index<items.length;index++){const photoPath=index===0?path:itActor+'/'+id+'/'+index.toString(16).padStart(64,'0')+'.jpg';if(index>0)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[photoPath]);paths.set(photoPath,photoBytes);photos.push({equipment_key:items[index].equipment_key,kind:'unit',path:photoPath});}
 const args={p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:serviceActor,p_items:items,p_checks:checks,p_signature:{method:'typed',name:itIdentity.name,confirmed:true},p_photos:photos,p_notes:'Synthetic equipment checked for the named Service technician.',...(legacyHandoff?{}:{p_purpose:handoffPurpose})};
 handoff=(await run(itActor,`select ${legacyHandoff?'submit_techcheck_transfer_v1':'submit_techcheck_transfer_v2'}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;
 if(legacyHandoff)for(const count of legacyReceiptCounts){const receiptId=randomUUID(),receiptPath=serviceActor+'/'+receiptId+'/'+'b'.repeat(64)+'.jpg';await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[receiptPath]);paths.set(receiptPath,photoBytes);const receipt={...args,p_request_id:receiptId,p_kind:'receipt',p_expected_revision:handoff.revision,p_items:items.map(item=>({...item,family:item.family==='Solar Spotter'?'Solar spotter':item.family,battery_count:count})),p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:items.map(item=>({equipment_key:item.equipment_key,kind:'unit',path:receiptPath})),p_notes:'Synthetic pre-repair receipt.'};handoff=(await run(serviceActor,`select submit_techcheck_transfer_v1(${Object.keys(receipt).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(receipt))).rows[0].result;}
 }
 if(legacyHandoff)await db.exec(purposeMigration);
 if(rollout==='missing')await db.exec('drop function public.techcheck_transfer_readiness_v1()');
 if(rollout==='disabled')await db.exec('update app_private.techcheck_transfer_settings set enabled=false');
 if(rollout==='reports-held')await db.exec('update app_private.techcheck_transfer_settings set reports_ready=false');
 if(rollout==='missing-submit')await db.exec('alter function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) rename to undeployed_submit');
 const actor=role==='it'?itActor:SERVICE;
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101010;color:#fff;font:16px Arial}.hidden{display:none!important}#appView{padding:10px}button{min-height:44px}</style></head><body><div id="appView"><div id="view-it" class="${role==='it'?'':'hidden'}"><section id="legacy"><button>Legacy IT prep</button></section></div><div id="view-svc" class="${role==='service'?'':'hidden'}"><div id="wlSvcTruckInventory"><h1>Morning truck check</h1><button id="existingDailyComplete">Complete &amp; Send</button></div></div><div id="view-owner" class="hidden">Owner tools</div><div id="view-morning" class="hidden"></div><button id="techMenuButton">Legacy menu</button></div><script>
 window.fixture={actor:${JSON.stringify(actor)},role:${JSON.stringify(role)},online:true,uploadFail:false,rpcFail:false,loseResponse:false};
 Object.defineProperty(navigator,'onLine',{get:()=>fixture.online});
 const listeners=[];const name=()=>fixture.actor==='${IT}'?'Synthetic IT':fixture.actor==='${TEST_IT}'?'Test IT':fixture.actor==='${SERVICE}'?'Synthetic Service':'Other Service';
 const session=()=>({user:{id:fixture.actor},access_token:'synthetic-only-'+fixture.actor});
 const db={auth:{onAuthStateChange:fn=>{listeners.push(fn);return {};},getSession:async()=>({data:{session:session()}})},rpc:async(name,args={})=>{
 if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:fixture.role==='it'&&['${IT}','${TEST_IT}'].includes(fixture.actor)}};
 if(fixture.rpcFail)return {error:{message:'Synthetic connection interrupted'}};
 const response=await fetch('/synthetic/rpc',{method:'POST',headers:{'Content-Type':'application/json','x-actor':fixture.actor},body:JSON.stringify({name,args})});const result=await response.json();
 if(['submit_techcheck_transfer_v1','submit_techcheck_transfer_v2','classify_techcheck_transfer_purpose_v1'].includes(name)&&fixture.loseResponse&&!result.error){fixture.loseResponse=false;return {error:{message:'Synthetic response lost'}};}return result;
 },storage:{from:bucket=>({upload:async(path,blob)=>{if(fixture.uploadFail)return {error:{statusCode:503}};const r=await fetch('/synthetic/storage?name='+encodeURIComponent(path),{method:'POST',headers:{'x-actor':fixture.actor},body:blob});return r.ok?{}:{error:{statusCode:r.status}};},createSignedUrl:async path=>({data:{signedUrl:'/synthetic/photo?name='+encodeURIComponent(path)}})})}};
 window.TechCheckContext={db,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getProfile:()=>({full_name:name(),username:name(),user_id:fixture.actor,role:fixture.role,active:true,archived_at:null}),getSession:session};
 window.show=key=>{for(const v of ['it','svc','owner','morning'])document.getElementById('view-'+v).classList.toggle('hidden',key!==v);dispatchEvent(new Event('techcheck:view-changed'));};
 window.logout=()=>{fixture.actor=null;document.getElementById('appView').classList.add('hidden');listeners.forEach(fn=>fn('SIGNED_OUT'));};
 window.changeActor=actor=>{fixture.actor=actor;listeners.forEach(fn=>fn('SIGNED_IN',session()));dispatchEvent(new Event('techcheck:data-refreshed'));};
 </script><script type="module" src="./${role==='it'?'it-daily-host.js':'service-transfer-host.js'}"></script></body></html>`;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.origin==='http://127.0.0.1:4173'&&url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:html});
 if(url.pathname==='/synthetic/rpc'){
  const {name,args}=req.postDataJSON();calls.push({name,args});
  if(name==='techcheck_transfer_readiness_v1'&&readinessDelay)await new Promise(resolve=>setTimeout(resolve,readinessDelay));
  if(name==='techcheck_transfer_context_v1'&&rollout==='read-cache-missing')return route.fulfill({json:{error:{code:'PGRST202',message:'Synthetic missing schema cache'}}});
  if(!['techcheck_transfer_readiness_v1','techcheck_transfer_context_v1','submit_techcheck_transfer_v1','submit_techcheck_transfer_v2','classify_techcheck_transfer_purpose_v1'].includes(name)){unexpected.push(name);return route.abort();}
  try{const rows=await run(req.headers()['x-actor'],`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args));return route.fulfill({json:{data:rows.rows[0].result}});}catch(e){return route.fulfill({json:{error:{message:e.message,code:e.code==='42883'?'PGRST202':e.code}}});}
 }
 if(url.pathname==='/synthetic/storage'){
  const bytes=req.postDataBuffer(),path=url.searchParams.get('name');try{await run(req.headers()['x-actor'],"insert into storage.objects values('techcheck-transfer-evidence',$1,$2)",[path,{mimetype:'image/jpeg',size:bytes.length}]);paths.set(path,bytes);return route.fulfill({json:{ok:true}});}catch(e){return route.fulfill({status:e.code==='23505'?409:403,json:{error:e.message}});}
 }
 if(url.pathname==='/synthetic/photo'){const bytes=paths.get(url.searchParams.get('name'));return bytes?route.fulfill({contentType:'image/jpeg',body:bytes}):route.fulfill({status:404});}
 if(url.pathname.endsWith('/functions/v1/cos-operations-pages')){
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'*'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const call=req.postDataJSON(),legacyActor=/^Bearer synthetic-only-([a-f0-9-]+)$/i.exec(req.headers().authorization||'')?.[1]||null;
  const identity=linkedIT.get(legacyActor);calls.push({...call,legacyActor,nativeActor:identity?.actorId||null});const now=new Date().toISOString();
  if(!identity)return route.fulfill({status:403,headers,json:{error:'Unverified synthetic Fleet identity'}});
  const payload=call.path==='/api/session'?{authorized:true,legacyOwner:false,role:'IT',name:identity.name,productionOwnerUserId:null,provisioningNeeded:null,reason:null,features:{fleetAccess:true,unitTracker:true,vrmRead:true,fleetPlacementEdit:true,fleetConnectionEdit:true,cameraHealthV2:true}}
   :call.path==='/api/tech/session'?{authorized:true,legacyTechnician:true,department:'it',productionTechnicianUserId:identity.actorId}
   :call.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:now}
   :call.path==='/api/camera-health/summary-v3'?{...snapshot([]),refreshedAt:now}
   // Fleet health uses an authorized, read-only router snapshot even in a
   // Camera Health / Fleet-only IT workspace. Never synthesize router writes.
   :call.path==='/api/routers'?{items:[],source:'camera_health',generatedAt:now}
   :call.path==='/api/vrm-fleet'?{items:[],sync:{state:'current',scheduleActive:true}}:undefined;
  if(!payload){unexpected.push(call);return route.fulfill({status:403,headers,json:{error:'Unavailable in synthetic fixture'}});}return route.fulfill({headers,json:payload});
 }
 if(url.origin==='http://127.0.0.1:4173'&&url.pathname.startsWith('/tech-checks/')){const path=resolve(root,'.'+url.pathname.slice('/tech-checks'.length));if(path.startsWith(root)){try{if((await stat(path)).isFile())return route.fulfill({body:await readFile(path),contentType:{'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'});}catch{}}}
 unexpected.push(url.pathname);return route.abort();
 });
 await page.goto('http://127.0.0.1:4173/tech-checks/');
 return {db,run,calls,unexpected,errors,handoff,paths,close:async()=>{await pending;await db.close();}};
}
