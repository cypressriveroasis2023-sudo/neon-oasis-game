import {processImportedGeocodes} from './importedGeocodeSweep.ts';
import {processGeocodioFallback} from './geocodioFallback.ts';
import {censusAddress} from './censusAddress.ts';
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const origins=new Set(['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']);
type Options={rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;verifyFleetActor:(authorization:string)=>Promise<boolean>;fetch?:typeof fetch;geocodioApiKey?:string;sourceReadKey?:string;now?:()=>number};
const reasonCode=(status:string,reason:string)=>status==='invalid_address'?'invalid_address':status==='no_match'?'no_match':status==='provider_error'?'provider_unavailable':null;
export function createGeocodeHandler(options:Options){return async(req:Request)=>{
 const now=options.now||Date.now,deadlineMs=now()+100000;
 const origin=req.headers.get('origin'),headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 if(origin&&origins.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
 const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Origin denied.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required.'},405);
 try{
  const cron=req.headers.get('x-camera-cron-secret');
  const isCron=cron?await options.rpc('verify_camera_health_cron_secret',{candidate:cron})===true:false;
  if(!isCron&&!await options.verifyFleetActor(req.headers.get('authorization')||''))return reply({error:'An active Owner or approved IT account is required.'},403);
  const reader=req.body?.getReader();let text='';const decoder=new TextDecoder();let size=0;
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();return reply({error:'Request too large.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
  let body:any;try{body=text?JSON.parse(text):{};}catch{return reply({error:'Invalid request.'},400);}
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['unitKey','auditId'].includes(k)))return reply({error:'Unsupported request.'},400);
  if(!isCron&&(typeof body.unitKey!=='string'||body.unitKey.length>250||typeof body.auditId!=='string'||!/^\d+$/.test(body.auditId)))return reply({error:'Saved unit and placement revision are required.'},400);
  // Queue rows are created atomically by the placement audit trigger. A browser never supplies an address.
  const rows=await options.rpc('cos_field_geocode_list_due',{p_organization_id:ORG,p_limit:5,...(!isCron?{p_audit_id:body.auditId,p_unit_key:body.unitKey}:{})});
  if(!Array.isArray(rows)||rows.length>5)throw Error('queue');
  const results=[];
  for(const row of rows){
   if(deadlineMs-now()<35000)break;
   const key={p_organization_id:ORG,p_audit_id:row.auditId,p_unit_key:row.unitKey,p_address:row.address,p_address_sha256:row.addressSha256};
   const claimed=await options.rpc('cos_field_geocode_claim',key);
   if(claimed?.claimed!==true){results.push({auditId:row.auditId,status:claimed?.record?.status||'pending'});continue;}
   const result=await censusAddress(row.address,options.fetch||fetch);
   const saved=await options.rpc('cos_field_geocode_finish',{...key,p_claim_token:claimed.claimToken,p_status:result.status,p_latitude:result.latitude??null,p_longitude:result.longitude??null,p_matched_address:result.matchedAddress??null,p_reason:reasonCode(result.status,result.reason)});
   results.push({auditId:row.auditId,status:saved?.accepted===true?saved.record.status:'superseded'});
  }
  // Existing Census results remain authoritative; fallback only sees current Census no_match rows.
  const fallbackResults=await processGeocodioFallback({...options,deadlineMs},!isCron?{p_audit_id:body.auditId,p_unit_key:body.unitKey}:{});
  let importedResults:unknown=null;
  if(isCron){try{importedResults=await processImportedGeocodes({...options,deadlineMs});}catch{importedResults={status:'unavailable'};}}
  return reply({ok:true,results,fallbackResults,importedResults});
 }catch{return reply({error:'Address lookup could not finish. The saved placement is unchanged; scheduled processing will retry.'},503);}
};}
