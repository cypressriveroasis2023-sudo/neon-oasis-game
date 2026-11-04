import {validateSettings,checkedControl,publicIp,projectOwnerMap,projectOwnerConnections,ownerConnection} from '../../../operations/src/ownerEquipmentCore.ts';
const platform='https://tughscoxralhofrckvxy.supabase.co',legacy=platform+'/functions/v1/cos-operations-pages';
const origins=new Set(['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']);
const proxyPaths=new Set(['/api/field-map','/api/fleet-map-source','/api/product-connections']);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const text=(v:unknown)=>typeof v==='string'&&v.trim()===v;
export type Dependencies={rpc:(name:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<any>;fetch:typeof fetch;tracker:(signal:AbortSignal)=>Promise<{rows:{productId:string|null;ip:string|null}[];observedAt:string}>;probe:(host:string,port:number,signal:AbortSignal)=>Promise<any>;now?:()=>number};
function fail(message:string,status=400):never{throw Object.assign(Error(message),{status});}
export function assertTarget(productId:string,ip:string,controls:any[],tracker:any){
 if(!publicIp(ip)||!tracker||!Array.isArray(tracker.rows)||!Number.isFinite(Date.parse(tracker.observedAt)))fail('Current target ownership cannot be checked.',503);
 const overrides=new Map(controls.filter(c=>checkedControl(c)&&c.active&&c.settings.publicIp).map(c=>[c.productId,c.settings.publicIp]));
 const other=tracker.rows.filter((r:any)=>r.productId!==productId&&(r.productId&&overrides.has(r.productId)?overrides.get(r.productId):r.ip)===ip);
 if(other.length||controls.some(c=>checkedControl(c)&&c.active&&c.productId!==productId&&c.settings.publicIp===ip))fail('Another equipment record claims this IP. Correct its assignment before checking this target.',409);
}
export function createOwnerHandler(d:Dependencies){
 const now=d.now||Date.now;
 const upstream=async(auth:string,path:string,method:string,body:any,signal:AbortSignal)=>d.fetch(legacy,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({path,method,body:body??null}),signal,redirect:'error',cache:'no-store'});
 const authenticate=async(auth:string,signal:AbortSignal,write=true)=>{
  if(!/^Bearer [-A-Za-z0-9_.]+$/.test(auth)||auth.length>16000)fail('Sign in to your existing COS Owner account.',401);
  const response=await upstream(auth,'/api/session','GET',null,signal);
  if(!response.ok)fail(response.status===401?'Your COS sign-in expired.':'Existing Owner authorization could not be confirmed.',response.status===401?401:403);
  const s=await response.json();
  if(!write&&s.authorized===true&&s.legacyOwner===false&&s.role==='IT'&&s.features?.fleetAccess===true)return null;
  if(s.authorized!==true||s.legacyOwner!==true||s.role!=='Owner'||!uuid(s.productionOwnerUserId))fail('An active linked COS Owner account is required.',403);
  return s.productionOwnerUserId as string;
 };
 const check=async(pid:string,signal:AbortSignal)=>{
  const start=await d.rpc('cos_owner_equipment_check_v1',{p_product:pid,p_action:'begin'},signal);
  if(start.state==='already_running')return start;
  if(start.state!=='ready'||!uuid(start.ticket))fail('A saved checking lease could not be established.',503);
  const settings=validateSettings(start.settings);let result:any;
  try{
   const [controls,before]=await Promise.all([d.rpc('cos_owner_equipment_list_v1',{},signal),d.tracker(signal)]);
   assertTarget(pid,settings.publicIp,controls,before);
   const outcomes:any[]=[];let cursor=0;
   await Promise.all(Array.from({length:Math.min(8,settings.ports.length)},async()=>{for(;;){const port=settings.ports[cursor++];if(port===undefined)return;signal.throwIfAborted();const r=await d.probe(settings.publicIp,port,signal);outcomes.push({port,...r});}}));
   if(outcomes.length!==settings.ports.length||outcomes.some(r=>!['responded','no_response'].includes(r.outcome)))fail('A technical error interrupted the check. The last completed result is retained.',503);
   const [current,after]=await Promise.all([d.rpc('cos_owner_equipment_list_v1',{},signal),d.tracker(signal)]);
   assertTarget(pid,settings.publicIp,current,after);
   result={status:outcomes.some(r=>r.outcome==='responded')?'online':'offline',publicIp:settings.publicIp,ports:settings.ports,outcomes:outcomes.sort((a,b)=>a.port-b.port),checkedAt:new Date(now()).toISOString(),sourceReadAt:before.observedAt,sourceRecheckedAt:after.observedAt};
  }catch(e){result={status:'unknown',reason:signal.aborted?'Check cancelled or timed out; last completed reading retained.':e instanceof Error?e.message.slice(0,500):'The check could not complete.'};}
  return d.rpc('cos_owner_equipment_check_v1',{p_product:pid,p_action:'finish',p_ticket:start.ticket,p_revision:start.connectionRevision,p_result:result},AbortSignal.timeout(8000));
 };
 return async(req:Request)=>{
  const origin=req.headers.get('origin'),headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origin&&origins.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
  const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!origins.has(origin))return json({error:'Origin is not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return json({error:'POST required.'},405);
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(110000)]);
  try{
   const cron=req.headers.get('x-cos-owner-cron');
   if(cron){
    if(cron.length!==64||!await d.rpc('cos_owner_equipment_cron_authorized_v1',{p_secret:cron},signal))fail('Forbidden.',403);
    const controls=await d.rpc('cos_owner_equipment_list_v1',{},signal);
    const queue=controls.filter((c:any)=>checkedControl(c)&&c.active&&c.settings.monitoringEnabled&&c.currentSourceEligible===true).sort((a:any,b:any)=>(Date.parse(a.lastAttempt?.at)||0)-(Date.parse(b.lastAttempt?.at)||0));
    const results:any[]=[];let cursor=0;const began=now();
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(now()-began<75000&&!signal.aborted){const c=queue[cursor++];if(!c)return;try{const r=await check(c.productId,signal);results.push({productId:c.productId,checkSaved:r.checkSaved===true,state:r.lastAttempt?.state||r.state});}catch{results.push({productId:c.productId,checkSaved:false,state:'failed'});}}}));
    return json({contract:'COS_OWNER_EQUIPMENT_SWEEP_V1',attempted:results.length,deferred:Math.max(0,queue.length-results.length),completed:results.filter(r=>r.checkSaved).length,results});
   }
   const auth=req.headers.get('authorization')||'';
   if(!auth.startsWith('Bearer ')||auth.length>16000)fail('Sign in to your existing COS account.',401);
   if(Number(req.headers.get('content-length'))>20000)fail('Request too large.',413);
   const raw=await req.text();if(raw.length>20000)fail('Request too large.',413);
   let packet:any;try{packet=JSON.parse(raw);}catch{fail('Invalid request body.');}
   if(!packet||!text(packet.path)||!['GET','POST'].includes(packet.method)||Object.keys(packet).some(k=>!['path','method','body'].includes(k)))fail('Unsupported request.');
   const {path,method,body}=packet;
   if(path==='/api/product-connections/verify'&&method==='POST'){
    await authenticate(auth,signal,false);
    if(!body||Object.keys(body).join(',')!=='productIds'||!Array.isArray(body.productIds)||!body.productIds.length||body.productIds.length>16||new Set(body.productIds).size!==body.productIds.length||body.productIds.some((id:any)=>typeof id!=='string'||!/^[1-9][0-9]{0,14}$/.test(id)))fail('Select 1 to 16 distinct equipment Product IDs.');
    const controls=await d.rpc('cos_owner_equipment_list_v1',{},signal),owned=body.productIds.filter((id:string)=>controls.some((c:any)=>c.productId===id&&c.active&&(c.settings.publicIp||c.settings.ports.length||c.settings.monitoringEnabled)));
    if(!owned.length){const r=await upstream(auth,path,method,body,signal);return json(await r.json(),r.status);}
    const other=body.productIds.filter((id:string)=>!owned.includes(id));let receipt:any=null;const verdicts:any[]=[];
    const existing=other.length?(async()=>{const r=await upstream(auth,path,method,{productIds:other},signal);const v=await r.json();if(r.ok&&v.contract==='COS_VERIFY_PRODUCTS_NOW_V1'){receipt=v.connections;verdicts.push(...v.items);}else verdicts.push(...other.map((id:string)=>({productId:id,status:'unknown',checkedAt:null,reason:'The existing camera checker could not complete. Previously saved results were retained.'})));})().catch(()=>{verdicts.push(...other.filter((id:string)=>!verdicts.some(v=>v.productId===id)).map((id:string)=>({productId:id,status:'unknown',checkedAt:null,reason:'The existing camera checker could not complete. Previous saved readings were retained.'})));}):Promise.resolve();
    let cursor=0;await Promise.all(Array.from({length:Math.min(4,owned.length)},async()=>{for(;;){const id=owned[cursor++];if(!id)return;try{const result=await check(id,signal),c=ownerConnection(result,now());verdicts.push({productId:id,status:result.checkSaved&&c?c.status:'unknown',checkedAt:result.checkSaved&&c?.status!=='unknown'?c?.checkedAt:null,reason:result.checkSaved?c?.reason:result.lastAttempt?.reason||'A new Owner-configured check is not confirmed.'});}catch(e){verdicts.push({productId:id,status:'unknown',checkedAt:null,reason:e instanceof Error?e.message:'Check not confirmed.'});}}}));
    await existing;
    if(!receipt){try{const r=await upstream(auth,'/api/product-connections','GET',null,signal);if(r.ok)receipt=await r.json();}catch{}}
    const latest=await d.rpc('cos_owner_equipment_list_v1',{},signal);
    return json({contract:'COS_VERIFY_PRODUCTS_NOW_V1',items:body.productIds.map((id:string)=>verdicts.find(v=>v.productId===id)),connections:projectOwnerConnections(receipt,latest)});
   }
   if(proxyPaths.has(path)){
    if(method!=='GET')fail('This route only reads saved data.',405);
    const response=await upstream(auth,path,method,null,signal);
    const value=await response.json();if(!response.ok)return json(value,response.status);
    const controls=await d.rpc('cos_owner_equipment_list_v1',{},signal);
    return json(path==='/api/product-connections'?projectOwnerConnections(value,controls):projectOwnerMap(value,controls));
   }
   const m=/^\/api\/owner-equipment\/([1-9][0-9]{0,14})(?:\/(check|tracker))?$/.exec(path);
   if(!m)fail('Unsupported Owner equipment route.',404);
   const actor=await authenticate(auth,signal),pid=m[1];
   if(m[2]==='tracker'&&method==='GET'){
    await d.rpc('cos_owner_equipment_record_v1',{p_product_id:pid},signal);
    const tracker=await d.tracker(signal),matches=tracker.rows.filter(r=>r.productId===pid);
    if(matches.length!==1)fail('The 2027 tracker has no unique row for this exact Product ID.',409);
    return json({productId:pid,publicIp:matches[0].ip,observedAt:tracker.observedAt,source:'2027 UNIT TRACKER',ports:null});
   }
   if(m[2]==='check'&&method==='POST')return json(await check(pid,signal));
   if(m[2])fail('Unsupported method.',405);
   if(method==='GET')return json(await d.rpc('cos_owner_equipment_record_v1',{p_product_id:pid},signal));
   if(!body||Object.keys(body).sort().join('|')!=='action|endpointConfirmed|expectedRevision|reason|requestId|settings'||!uuid(body.requestId)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!['save','release'].includes(body.action)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000||typeof body.endpointConfirmed!=='boolean')fail('Reload settings and provide a correction reason.');
   let settings:any={};try{if(body.action==='save')settings=validateSettings(body.settings);}catch(e){fail(e instanceof Error?e.message:'Invalid settings.',400);}
   if(body.action==='save'&&settings.publicIp&&!body.endpointConfirmed)fail('Confirm that this IP belongs to the selected equipment Product ID.');
   return json(await d.rpc('cos_owner_equipment_save_v1',{p_actor:actor,p_product_id:pid,p_expected:body.expectedRevision,p_request:body.requestId,p_action:body.action,p_settings:settings,p_reason:body.reason.trim()},signal));
  }catch(e:any){
   const code=e?.code,status=e?.status||(['40001','23505'].includes(code)?409:code==='42501'?403:code==='P0002'?404:code==='22023'?400:503);
   const message=typeof e?.message==='string'&&(e.status||['40001','23505','42501','P0002','22023','55000'].includes(code))?e.message:'Owner equipment operation could not complete. Saved settings and previous readings were retained. Reload before retrying.';
   return json({error:message},status);
  }
 };
}
