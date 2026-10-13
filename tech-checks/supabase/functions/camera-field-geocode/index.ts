import {processImportedGeocodes,importedGeocodeFailure} from './importedGeocodeSweep.ts';
import {processGeocodioFallback} from './geocodioFallback.ts';
import {censusOwnerAddress as censusAddress} from './ownerCensusAddress.ts';
import {checkedOwnerCensusOnlyRow,censusOnlyOwnerAddress,censusOnlyReason,OWNER_ONE_CENSUS_PREFIX,sameOwnerCensusOnlyGuard,validCensusClaimToken,type VerifyOwnerCensusSource} from './ownerCensusOnly.ts';
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const origins=new Set(['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']);
type Options={rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;verifyFleetActor:(authorization:string)=>Promise<boolean>;verifyOwnerCensusSource?:VerifyOwnerCensusSource;fetch?:typeof fetch;geocodioApiKey?:string;sourceReadKey?:string;now?:()=>number};
const reasonCode=(status:string,reason:string)=>status==='invalid_address'?'invalid_address':status==='no_match'?'no_match':status==='provider_error'?'provider_unavailable':null;
export function createGeocodeHandler(options:Options){return async(req:Request)=>{
 const now=options.now||Date.now,startedAt=now();let deadlineMs=startedAt+100000;
 const origin=req.headers.get('origin'),headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&origins.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
 const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Origin denied.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required.'},405);
 let censusOnly=false,allowance:'unknown'|'available'|'consumed'='unknown';
 try{
  const cron=req.headers.get('x-camera-cron-secret');
  const isCron=cron?await options.rpc('verify_camera_health_cron_secret',{candidate:cron})===true:false;
  const authorization=req.headers.get('authorization')||'';
  if(!isCron&&!await options.verifyFleetActor(authorization))return reply({error:'An active Owner or approved IT account is required.'},403);
  const reader=req.body?.getReader();let text='';const decoder=new TextDecoder();let size=0;
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();return reply({error:'Request too large.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
  let body:any;try{body=text?JSON.parse(text):{};}catch{return reply({error:'Invalid request.'},400);}
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['unitKey','auditId'].includes(k)))return reply({error:'Unsupported request.'},400);
  const targeted=!isCron||Object.keys(body).length>0;
  if(targeted&&(typeof body.unitKey!=='string'||!body.unitKey.trim()||body.unitKey.length>250||typeof body.auditId!=='string'||!/^\d+$/.test(body.auditId)))return reply({error:'Saved unit and placement revision are required.'},400);
  // Queue rows are created atomically by the placement audit trigger. A browser never supplies an address.
  const rows=await options.rpc('cos_field_geocode_list_due',{p_organization_id:ORG,p_limit:5,...(targeted?{p_audit_id:body.auditId,p_unit_key:body.unitKey}:{})});
  if(!Array.isArray(rows)||rows.length>5)throw Error('queue');
  // Retain the hold on duplicates, refusals and deadline exits, before any claim or fallback.
  censusOnly=rows.some(row=>row?.censusOnly===true);
  // Only this explicitly enrolled target needs three fresh authenticated native
  // snapshots. Ordinary Owner jobs and scheduled sweeps keep their 100s budget.
  if(censusOnly&&targeted)deadlineMs=startedAt+200000;
  // A secret-authenticated target is a narrow one-Census invocation, never a
  // back door into an ordinary job or the scheduled imported/fallback sweeps.
  if(isCron&&targeted&&(!rows.length||!rows.every(row=>row?.censusOnly===true)))return reply({error:'No enrolled Census-only target is available.'},409);
  if(censusOnly&&targeted&&(rows.length!==1||rows[0].auditId!==body.auditId||rows[0].unitKey!==body.unitKey))throw Error('Census-only target changed');
  const results=[];
  for(const row of rows){
   const guarded=row?.censusOnly===true?await checkedOwnerCensusOnlyRow(row):null;
   if(row?.censusOnly===true&&!guarded)throw Error('Census-only binding unavailable');
   if(guarded){
    if(guarded.censusOnlyState==='consumed')allowance='consumed';
    // Cron and mismatched target responses cannot consume an Owner's explicit allowance.
    if(!targeted||guarded.auditId!==body.auditId||guarded.unitKey!==body.unitKey){results.push({auditId:row.auditId,status:'held',censusOnly:true,allowance});continue;}
    // Only the database clock releases the initial old-worker drain. Neither a
    // caller-supplied timestamp nor this process's clock may advance the state.
    if(guarded.censusOnlyState==='draining'){
     allowance='available';results.push({auditId:row.auditId,status:'draining',censusOnly:true,allowance,...(guarded.censusOnlyNotBefore?{censusOnlyNotBefore:guarded.censusOnlyNotBefore}:{})});continue;
    }
    // An immutable consumed marker is sufficient to refuse any new work. Do not
    // depend on a native read to explain a duplicate, expired lease or crash.
    if(guarded.censusOnlyState==='consumed'){results.push({auditId:row.auditId,status:row.status||'held',censusOnly:true,allowance});continue;}
    if(deadlineMs-now()<170000){results.push({auditId:row.auditId,status:'held',censusOnly:true,allowance});continue;}
    // The native and legacy databases are separate. A missing or failed fresh native
    // proof must never be replaced with an old enrollment proof or a label match.
    if(!options.verifyOwnerCensusSource||!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)throw Error('Owner source verifier unavailable');
    if(await options.verifyOwnerCensusSource(guarded,authorization)!==true){results.push({auditId:row.auditId,status:'superseded',censusOnly:true,allowance});continue;}
   }
   if(deadlineMs-now()<(guarded?125000:35000))break;
   const key={p_organization_id:ORG,p_audit_id:row.auditId,p_unit_key:row.unitKey,p_address:row.address,p_address_sha256:row.addressSha256};
   const claimed=await options.rpc('cos_field_geocode_claim',guarded?{...key,p_audit_id:OWNER_ONE_CENSUS_PREFIX+row.auditId}:key);
   // A policy acquired after list_due also blocks fallback, even when no claim was issued.
   censusOnly||=claimed?.censusOnly===true;
   if(guarded?claimed?.censusOnly!==true||!sameOwnerCensusOnlyGuard(guarded.censusOnlyGuard,claimed?.censusOnlyGuard):claimed?.censusOnly===true)throw Error('Census-only claim policy changed');
   if(guarded&&(claimed?.claimed===true||claimed?.record?.censusOnlyState==='consumed'))allowance='consumed';
   const policy=guarded?{censusOnly:true,allowance}:{};
   if(claimed?.claimed!==true){results.push({auditId:row.auditId,status:claimed?.record?.status||'pending',...policy});continue;}
   if(guarded&&!validCensusClaimToken(claimed.claimToken))throw Error('Census-only claim unavailable');
   const leaseUntil=guarded?Date.parse(claimed?.record?.leaseUntil):NaN;
   if(guarded&&!Number.isFinite(leaseUntil))throw Error('Census-only lease unavailable');
   if(guarded&&leaseUntil-now()<115000){results.push({auditId:row.auditId,status:'held',...policy});continue;}
   // A database lock wait can outlive the pre-claim proof. Recheck the same Owner
   // after consumption, immediately before the only permitted provider send.
   // Any uncertainty burns the allowance; it never authorizes another claim.
   if(guarded&&await options.verifyOwnerCensusSource!(guarded,authorization)!==true){results.push({auditId:row.auditId,status:'superseded',...policy});continue;}
   if(guarded&&(deadlineMs-now()<70000||leaseUntil-now()<70000)){results.push({auditId:row.auditId,status:'held',...policy});continue;}
   const result=await (guarded?censusOnlyOwnerAddress:censusAddress)(row.address,options.fetch||fetch);
   // Do not finish an uncertain/stale native result. The consumed allowance and
   // persistent SQL hold survive crashes, source-read failures and lease expiry.
   if(guarded&&await options.verifyOwnerCensusSource!(guarded,authorization)!==true){results.push({auditId:row.auditId,status:'superseded',...policy});continue;}
   const saved=await options.rpc('cos_field_geocode_finish',{...key,p_claim_token:claimed.claimToken,p_status:result.status,p_latitude:result.latitude??null,p_longitude:result.longitude??null,p_matched_address:result.matchedAddress??null,p_reason:guarded?censusOnlyReason(result):reasonCode(result.status,result.reason)});
   results.push({auditId:row.auditId,status:saved?.accepted===true?saved.record.status:'superseded',...policy});
  }
  // Existing Census results remain authoritative; fallback only sees current Census no_match rows.
  const fallbackResults=censusOnly?[]:await processGeocodioFallback({...options,deadlineMs},!isCron?{p_audit_id:body.auditId,p_unit_key:body.unitKey}:{});
  let importedResults:unknown=null;
  if(isCron&&!targeted){try{importedResults=await processImportedGeocodes({...options,deadlineMs});}catch(error){importedResults=importedGeocodeFailure(error);}}
  return reply({ok:true,results,fallbackResults,importedResults,...(censusOnly?{censusOnly:true,allowance}:{})});
 }catch{return reply({error:censusOnly?'The Census-only lookup could not finish. Its hold remains in place; no automatic retry or fallback is authorized.':'Address lookup could not finish. The saved placement is unchanged; refresh to check its current status.',...(censusOnly?{censusOnly:true,allowance}:{})},503);}
};}
