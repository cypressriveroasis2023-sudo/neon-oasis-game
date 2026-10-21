import {RECIPIENT,correctionRecord,correctionHtml,correctionEmailHtml,correctionAnswers,correctionPdf,correctionRawEmail,type CorrectionLinks} from './report.ts';

const ORIGINS=new Set(['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID=/^[A-Za-z0-9_-]{3,200}$/;
const META_FIELDS='id,mimeType,parents,appProperties,trashed,sha256Checksum,md5Checksum,size,version';
class BlockedDelivery extends Error {}
const digest=async(bytes:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),n=>n.toString(16).padStart(2,'0')).join('');
const fileUrl=(id:string)=>'https://drive.google.com/file/d/'+id+'/view';
const folderUrl=(id:string)=>'https://drive.google.com/drive/folders/'+id;
// Postgres jsonb may reorder object keys between checkpoints and claims.
const canonicalJson=(value:any):string=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);

// Separate leased outbox: never invokes or modifies the original report queue.
export function createCorrectionDeliveryHandler({admin,userClient,env,fetch:request=fetch}:any){
 const call=async(name:string,args:any)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('Correction delivery database operation failed.');return data;};
 return async(req:Request)=>{
  const origin=req.headers.get('origin'),headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin'};
  if(origin&&ORIGINS.has(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization, apikey, x-client-info, content-type';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
  const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!ORIGINS.has(origin))return response({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return response({error:'POST required.'},405);
  let job:any=null,mailUncertain=false;
  try{
   let actor:string|null=null;
   const cron=req.headers.get('x-techcheck-cron');
   if(cron){if(!await call('service_daily_cron_authorized_v1',{p_secret:cron}))return response({error:'Not authorized.'},401);}
   else{const bearer=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!bearer)return response({error:'Sign in required.'},401);const {data,error}=await userClient.auth.getUser(bearer);if(error||!UUID.test(data?.user?.id||''))return response({error:'Sign in required.'},401);actor=data.user.id;}
   let body:any;try{body=await req.json();}catch{return response({error:'Invalid request.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='correction_id')||(!cron&&!UUID.test(body.correction_id||''))||(body.correction_id!==undefined&&!UUID.test(body.correction_id)))return response({error:'A saved correction ID is required.'},400);
   job=await call('techcheck_correction_delivery_v1',{p_action:'claim',p_id:body.correction_id||null,p_actor:actor});
   if(!job)return response({accepted:true,status:'pending_or_finished'});
   const queue=(action:string,data:any)=>call('techcheck_correction_delivery_v1',{p_action:action,p_id:job.id,p_lease:job.lease_token,p_data:data});
   const finish=(status:string,error?:string)=>queue('finish',{status,error});
   if(job.email_state==='sending'||job.email_state==='review'){await finish('review','Verify the earlier Owner email before another send.');return response({accepted:true,status:'review'});}
   let r:any;try{r=correctionRecord(job);}catch{throw new BlockedDelivery('Correction provenance requires review.');}
   if(r.id!==job.id||!UUID.test(job.actor_id||r.applied_by.id)||r.applied_by.id!==(job.actor_id||r.applied_by.id)||!Array.isArray(r.photos)||r.photos.length<1||r.photos.length>40)throw new BlockedDelivery('Correction evidence requires review.');
   const expectedKeys=new Set(r.after.map((item:any)=>item.equipment_key));
   const pathPrefix=r.applied_by.id+'/'+r.id+'/';
   const paths=new Map<string,{equipmentKey:string;kinds:Set<string>;index:number}>();
   for(const [index,photo] of r.photos.entries()){
    if(!['unit','tag'].includes(photo.kind)||!expectedKeys.has(photo.equipment_key)||typeof photo.path!=='string'||!photo.path.startsWith(pathPrefix)||!/^[a-f0-9]{64}\.jpg$/.test(photo.path.slice(pathPrefix.length)))throw new BlockedDelivery('Correction evidence identity requires review.');
    const prior=paths.get(photo.path);
    if(prior){if(prior.equipmentKey!==photo.equipment_key||prior.kinds.has(photo.kind))throw new BlockedDelivery('Correction evidence identity requires review.');prior.kinds.add(photo.kind);}
    else paths.set(photo.path,{equipmentKey:photo.equipment_key,kinds:new Set([photo.kind]),index});
   }
   const original=job.original_drive_manifest;
   if(original?.complete!==true||original.folder?.done!==true||original.summary_pdf_v1?.done!==true||!DRIVE_ID.test(original.folder?.id||'')||!DRIVE_ID.test(original.summary_pdf_v1?.id||''))throw new BlockedDelivery('Original signed archive is not ready.');
   const credentials=['TECHCHECK_GOOGLE_CLIENT_ID','TECHCHECK_GOOGLE_CLIENT_SECRET','TECHCHECK_GOOGLE_REFRESH_TOKEN'].map(name=>String(env(name)||''));
   if(credentials.some(v=>!v))throw new BlockedDelivery('Google Drive and Owner email connection required.');
   const tokenResponse=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials[0],client_secret:credentials[1],refresh_token:credentials[2],grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
   const token=await tokenResponse.json();if(!tokenResponse.ok||!token.access_token)throw new BlockedDelivery('Google connection needs reconnection.');
   const auth={Authorization:'Bearer '+token.access_token};
   const api=async(url:string,options:any={})=>{const result=await request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});if(!result.ok)throw new Error('Google archive request failed.');return result.json();};
   const metadata=async(id:string)=>{if(!DRIVE_ID.test(id))throw new BlockedDelivery('Archive identity requires review.');return api('https://www.googleapis.com/drive/v3/files/'+id+'?fields='+META_FIELDS+'&supportsAllDrives=true');};
   const profile=await api('https://openidconnect.googleapis.com/v1/userinfo');
   if(profile.email?.toLowerCase()!==RECIPIENT||profile.email_verified!==true)throw new BlockedDelivery('Connect the verified Operations Manager account.');
   const manifest=job.drive_manifest||{};
   if(typeof manifest!=='object'||Array.isArray(manifest))throw new BlockedDelivery('Correction archive manifest requires review.');
   const checkpoint=async(data:any={})=>queue('checkpoint',{drive_manifest:manifest,...data});
   const originalReadback=async()=>{
    const entries:Record<string,any>={};
    for(const [key,value] of Object.entries(original) as [string,any][]){
     if(!/^(folder|summary_pdf_v1|report|answers|photo_\d+)$/.test(key)||value?.done!==true)continue;
     const file=await metadata(value.id),isFolder=key==='folder';
     if(file.id!==value.id||file.trashed===true||file.appProperties?.techcheck_transfer_event_id!==r.original_event_id||file.appProperties?.techcheck_part!==key||(isFolder?file.mimeType!=='application/vnd.google-apps.folder':!file.parents?.includes(original.folder.id))||(key==='summary_pdf_v1'&&file.mimeType!=='application/pdf'))throw new BlockedDelivery('Original archive identity changed; review required.');
     // Adding a child can change folder version; compare the signed files instead.
     entries[key]=isFolder?{id:file.id,mimeType:file.mimeType}:{id:file.id,mimeType:file.mimeType,parents:[...file.parents].sort(),sha256:file.sha256Checksum||null,md5:file.md5Checksum||null,size:file.size||null,version:file.version||null};
    }
    return entries;
   };
   const originalBefore=await originalReadback();
   if(manifest.original_readback&&canonicalJson(manifest.original_readback)!==canonicalJson(originalBefore))throw new BlockedDelivery('Original signed files changed since the archive began.');
   manifest.original_readback=originalBefore;manifest.original_folder_id=original.folder.id;manifest.original_pdf_id=original.summary_pdf_v1.id;await checkpoint();
   const reserve=async(key:string)=>{
    if(!manifest[key]){const ids=await api('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');if(!DRIVE_ID.test(ids.ids?.[0]||''))throw new Error('Drive file ID unavailable.');manifest[key]={id:ids.ids[0],done:false};await checkpoint();}
    if(!DRIVE_ID.test(manifest[key].id||''))throw new BlockedDelivery('Correction archive file ID requires review.');return manifest[key];
   };
   const verify=async(key:string,parent:string,type:string,sha:string|null,size:number|null)=>{
    const entry=manifest[key],file=await metadata(entry.id);
    if(file.id!==entry.id||file.trashed===true||file.mimeType!==type||!file.parents?.includes(parent)||file.appProperties?.techcheck_correction_id!==r.id||file.appProperties?.techcheck_original_event_id!==r.original_event_id||file.appProperties?.techcheck_part!==key)throw new BlockedDelivery('Correction archive identity could not be verified.');
    if(sha){
     if(file.appProperties?.techcheck_sha256!==sha||String(file.size)!==String(size))throw new BlockedDelivery('Correction archive content could not be verified.');
     if(file.sha256Checksum){if(file.sha256Checksum!==sha)throw new BlockedDelivery('Correction archive checksum differs.');}
     else{const saved=await request('https://www.googleapis.com/drive/v3/files/'+entry.id+'?alt=media&supportsAllDrives=true',{headers:auth,signal:AbortSignal.timeout(30000)});if(!saved.ok)throw new Error('Correction archive readback failed.');const bytes=await saved.arrayBuffer();if(bytes.byteLength!==size||await digest(bytes)!==sha)throw new BlockedDelivery('Correction archive readback checksum differs.');}
    }
    return file;
   };
   const create=async(key:string,name:string,parent:string,type:string,media?:Blob)=>{
    const entry=await reserve(key),bytes=media?await media.arrayBuffer():null,sha=bytes?await digest(bytes):null;
    if(entry.sha256&&entry.sha256!==sha)throw new BlockedDelivery('Saved correction content changed during retry.');
    if(entry.parent&&entry.parent!==parent)throw new BlockedDelivery('Saved correction destination changed during retry.');
    entry.parent=parent;entry.mimeType=type;if(sha){entry.sha256=sha;entry.size=bytes!.byteLength;}await checkpoint();
    if(!entry.done){
     const properties:any={techcheck_correction_id:r.id,techcheck_original_event_id:r.original_event_id,techcheck_part:key};if(sha)properties.techcheck_sha256=sha;
     const meta={id:entry.id,name,parents:[parent],mimeType:type,appProperties:properties};
     let url:string,options:any;
     if(media){const boundary='correction_'+crypto.randomUUID();url='https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';options={method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+boundary+'\r\nContent-Type: '+type+'\r\n\r\n',bytes!,'\r\n--'+boundary+'--'],{type:'multipart/related'})};}
     else{url='https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)};}
     const result=await request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});if(!result.ok&&result.status!==409)throw new Error('Correction archive upload failed.');
    }
    const file=await verify(key,parent,type,sha,bytes?.byteLength??null);entry.done=true;entry.readback_sha256=sha;entry.readback_version=file.version||null;await checkpoint();return entry.id;
   };
   const folder=await create('folder','Correction - revision '+r.revision+' - '+r.id.slice(0,8),original.folder.id,'application/vnd.google-apps.folder');
   for(const key of ['report_html','answers_json','summary_pdf_v1',...Array.from(paths.values(),p=>'photo_'+p.index)])await reserve(key);
   const evidence:CorrectionLinks['evidence']=[];
   for(const [path,entry] of paths){
    const {data,error}=await admin.storage.from('techcheck-transfer-evidence').download(path);
    if(error||!data||data.size<1||data.size>5*1024*1024)throw new Error('Saved correction photo unavailable.');
    const bytes=await data.arrayBuffer(),sha=await digest(bytes);
    if(sha!==path.slice(pathPrefix.length,-4))throw new BlockedDelivery('Saved correction photo checksum differs.');
    if(new Uint8Array(bytes)[0]!==255||new Uint8Array(bytes)[1]!==216)throw new BlockedDelivery('Correction evidence is not a JPEG photograph.');
    const name=Array.from(entry.kinds).sort().join(' and ')+' - '+entry.equipmentKey.replace(/[\r\n/\\]/g,'-')+'.jpg';
    await create('photo_'+entry.index,name,folder,'image/jpeg',new Blob([bytes],{type:'image/jpeg'}));
   }
   for(const photo of r.photos)evidence.push({label:photo.kind+' photo - '+photo.equipment_key,url:fileUrl(manifest['photo_'+paths.get(photo.path)!.index].id)});
   const links:CorrectionLinks={originalFolder:folderUrl(original.folder.id),originalPdf:fileUrl(original.summary_pdf_v1.id),correctionFolder:folderUrl(folder),correctionPdf:fileUrl(manifest.summary_pdf_v1.id),answers:fileUrl(manifest.answers_json.id),evidence};
   const html=correctionHtml(r,links),answers=correctionAnswers(r,links),pdf=correctionPdf(r,links);
   await create('report_html','Correction revision '+r.revision+'.html',folder,'text/html',new Blob([html],{type:'text/html'}));
   await create('answers_json','Correction revision '+r.revision+' - audit.json',folder,'application/json',new Blob([answers],{type:'application/json'}));
   await create('summary_pdf_v1','Correction revision '+r.revision+' - summary.pdf',folder,'application/pdf',new Blob([pdf as BlobPart],{type:'application/pdf'}));
   if(canonicalJson(await originalReadback())!==canonicalJson(originalBefore))throw new BlockedDelivery('Original signed files changed during archive; review required.');
   manifest.complete=true;manifest.links=links;await checkpoint();
   if(job.email_state!=='sent'){
    // A committed marker is mandatory before Gmail. An uncertain result is held.
    mailUncertain=true;await checkpoint({email_state:'sending'});job.email_state='sending';
    const sent=await api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:correctionRawEmail(r,correctionEmailHtml(r,links),pdf)})});
    if(typeof sent.id!=='string'||!sent.id)throw new Error('Owner email confirmation missing.');
    await checkpoint({email_state:'sent',email_id:sent.id});job.email_state='sent';mailUncertain=false;
   }
   await finish('sent');return response({accepted:true,status:'sent',correction_id:r.id});
  }catch(error){
   const status=mailUncertain||job?.email_state==='sending'?'review':error instanceof BlockedDelivery?'blocked':'retry';
   if(job)try{await call('techcheck_correction_delivery_v1',{p_action:'finish',p_id:job.id,p_lease:job.lease_token,p_data:{status,error:status==='review'?'Verify Owner email delivery before retrying.':status==='blocked'?(error as Error).message:'Correction delivery interrupted; saved archive will retry.'}});}catch{}
   // Do not expose provider bodies, OAuth values, personal replies or paths.
   return response({accepted:Boolean(job),status:job?status:'unavailable'},job?202:503);
  }
 };
}
