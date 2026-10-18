/** Operator-enrolled address evidence only; never reads or writes equipment. */
type Obj=Record<string,unknown>;
type Options={rpc:(name:string,args:Obj)=>Promise<unknown>;apiKey?:string;fetch?:typeof fetch;now?:()=>number};
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const text=(v:unknown,max=250):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f<>@=]/.test(v);
const finite=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max?v:null;
const clean=(v:unknown,max=250)=>text(v,max)?v:null;
/** Keep only geocoding evidence. Error bodies, keys and arbitrary fields never persist. */
export function addressEvidence(raw:unknown):Obj|null{
 if(!object(raw)||!Array.isArray(raw.results)||raw.results.length>50)return null;
 const results=[];
 for(const value of raw.results){
  if(!object(value)||!object(value.address_components))return null;
  const a=value.address_components,components:Obj={};
  for(const k of ['number','predirectional','street','suffix','postdirectional','formatted_street','city','state_province','postal_code','country','unit_number','unit_type'])components[k]=clean(a[k]);
  results.push({address_components:components,formatted_address:clean(value.formatted_address,600),
   location:object(value.location)?{lat:finite(value.location.lat,90),lng:finite(value.location.lng,180)}:null,
   accuracy:finite(value.accuracy,1),accuracy_type:clean(value.accuracy_type,80),match_type:clean(value.match_type,80),
   source:clean(value.source,300),warnings:!!value._warnings,secondary:!!value.address_components_secondary});
 }
 return {results,warnings:!!raw._warnings};
}
export function createMhelpAddressGeocodioHandler(options:Options){return async(request:Request)=>{
 const reply=(v:Obj,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply({error:'POST required'},405);
 // Same existing cron credential/verifier as the deployed legacy geocoder.
 // There is no browser route, new credential, role grant or caller address input.
 const secret=request.headers.get('x-camera-cron-secret');
 if(!secret||secret.length>8192)return reply({error:'Operator authentication required'},403);
 try{
  if(await options.rpc('verify_camera_health_cron_secret',{candidate:secret})!==true)return reply({error:'Operator authentication required'},403);
 }catch{return reply({error:'Operator authentication unavailable'},503);}
 let body:unknown;
 try{
  const reader=request.body?.getReader();if(!reader)return reply({error:'Invalid request'},400);let value='',size=0;const decoder=new TextDecoder();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();return reply({error:'Request too large'},413);}value+=decoder.decode(part.value,{stream:true});}
  body=JSON.parse(value+decoder.decode());
 }catch{return reply({error:'Invalid request'},400);}
 if(!object(body)||Object.keys(body).length!==3||!['sourceSha256','payloadSha256','addressSha256'].every(k=>hash(body[k])))return reply({error:'Enrolled source hashes required'},400);
 if(!options.apiKey?.trim()||options.apiKey.length>8192||/[\r\n]/.test(options.apiKey))return reply({error:'Provider is not configured'},503);
 const key={p_source_sha256:body.sourceSha256,p_payload_sha256:body.payloadSha256,p_address_sha256:body.addressSha256};
 let claim:unknown;
 try{claim=await options.rpc('cos_mhelp_address_geocodio_claim_v1',key);}catch{return reply({error:'Address reservation unavailable'},503);}
 if(!object(claim)||claim.claimed!==true)return reply({claimed:false,status:object(claim)?claim.status:'unavailable'});
 const a=claim.address;
 if(!uuid(claim.requestId)||!uuid(claim.reservationToken)||typeof claim.sendBefore!=='string'||!Number.isFinite(Date.parse(claim.sendBefore))
  ||!object(a)||!text(a.street)||!/^\d+[A-Za-z]?\s+/.test(a.street)||!text(a.city,100)||typeof a.state!=='string'||!/^[A-Z]{2}$/.test(a.state)
  ||typeof a.zip!=='string'||!/^\d{5}(-\d{4})?$/.test(a.zip)||Object.keys(a).sort().join(',')!=='city,state,street,zip')return reply({error:'Invalid reserved address'},503);
 const finish=async(status:string,reason:string|null,httpStatus:number|null,receipt:Obj|null,retryAfter:number|null=null)=>{
  const result=await options.rpc('cos_mhelp_address_geocodio_finish_v1',{...key,p_request_id:claim.requestId,p_reservation_token:claim.reservationToken,
   p_status:status,p_reason:reason,p_http_status:httpStatus,p_receipt:receipt,p_retry_after_seconds:retryAfter});
  return object(result)&&result.accepted===true?reply({claimed:true,status}):reply({error:'Address receipt was not accepted'},503);
 };
 const now=options.now||Date.now;
 if(now()>=Date.parse(claim.sendBefore)){
  try{return await finish('provider_error','expired_before_send',null,null);}catch{return reply({error:'Expired address receipt unavailable; do not resend this reservation'},503);}
 }
 const url=new URL('https://api.geocod.io/v2/geocode');
 for(const [k,v] of Object.entries({street:a.street,city:a.city,state_province:a.state,postal_code:a.zip,country:'US'}))if(v)url.searchParams.set(k,v);
 // No enrichment, result limit, retry or identity/customer data is sent.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 let receipt:Obj|null=null,status:number|null=null,reason:string|null=null,retryAfter:number|null=null;
 try{
  const response=await (options.fetch||fetch)(url.toString(),{headers:{Accept:'application/json',Authorization:'Bearer '+options.apiKey},redirect:'error',cache:'no-store',signal:controller.signal});
  status=response.status;
  if(status===401||status===403)reason='provider_forbidden';
  else if(status===429){reason='provider_rate_limited';const seconds=response.headers.get('retry-after');retryAfter=seconds&&/^\d{1,6}$/.test(seconds)?Math.min(86400,Math.max(60,Number(seconds))):86400;}
  else if(status!==200)reason='provider_unavailable';
  else{
   const reader=response.body?.getReader();if(!reader)throw Error('Missing body');const chunks:Uint8Array[]=[];let size=0;
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144){await reader.cancel();throw Error('Large response');}chunks.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   try{receipt=addressEvidence(JSON.parse(new TextDecoder().decode(bytes)));}catch{receipt=null;}
   if(!receipt)reason='invalid_response';
  }
 }catch{reason=controller.signal.aborted?'provider_timeout':'provider_unavailable';}
 finally{clearTimeout(timer);controller.abort();}
 try{return await finish(receipt?'received':'provider_error',reason,status,receipt,retryAfter);}catch{return reply({error:'Address receipt unavailable; do not resend this reservation'},503);}
};}
