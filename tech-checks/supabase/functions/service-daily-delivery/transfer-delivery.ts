import {DRIVE_FOLDER,RECIPIENT} from './report.ts';
import {transferDelivery,transferReportHtml,transferReportPdf,transferRawEmail} from './transfer-report.ts';

const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
const providerId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);

// Invoked only after the shared handler authenticates the user or scheduler.
// Delivery status is owned by a leased, service-role-only queue RPC.
export async function deliverTransfer({admin,env,request=fetch,actor=null,eventId=null,now=Date.now}:any) {
 let row:any=null;
 const started=now();
 const call=async(args:any)=>{const {data,error}=await admin.rpc('techcheck_transfer_delivery_v3',args);if(error)throw new Error('Handoff delivery database operation failed.');return data;};
 const queue=(action:string,data:any={})=>call({p_action:action,p_id:row.event_id,p_lease:row.lease_token,p_data:data});
 try {
  row=await call({p_action:'claim',p_id:eventId,p_actor:actor});
  if(!row)return {accepted:true,status:'pending_or_finished'};
  if(typeof row.snapshot_text!=='string'||await digest(new TextEncoder().encode(row.snapshot_text))!==row.snapshot_sha256)throw new Error('Immutable delivery digest mismatch.');
  const delivery=transferDelivery(JSON.parse(row.snapshot_text));
  if(delivery.event_id!==row.event_id||delivery.transfer_id!==row.transfer_id)throw new Error('Immutable event identity mismatch.');
  if(['sending','review'].includes(row.email_state)){await queue('finish',{status:'review'});return {accepted:true,status:'review'};}
  const credentials=['TECHCHECK_GOOGLE_CLIENT_ID','TECHCHECK_GOOGLE_CLIENT_SECRET','TECHCHECK_GOOGLE_REFRESH_TOKEN'].map(name=>String(env(name)||''));
  if(credentials.some(v=>!v)){await queue('finish',{status:'blocked'});return {accepted:true,status:'blocked'};}
  const tokenResponse=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials[0],client_secret:credentials[1],refresh_token:credentials[2],grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  const token=await tokenResponse.json();if(!tokenResponse.ok||!token.access_token)throw new Error('Google connection unavailable.');
  const auth={Authorization:'Bearer '+token.access_token};
  const get=async(url:string,options:any={})=>{const r=await request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Archive provider request failed.');return r;};
  const api=async(url:string,options:any={})=>(await get(url,options)).json();
  const profile=await api('https://openidconnect.googleapis.com/v1/userinfo');
  if(profile.email?.toLowerCase()!==RECIPIENT||profile.email_verified!==true){await queue('finish',{status:'blocked'});return {accepted:true,status:'blocked'};}
  const parent=await api('https://www.googleapis.com/drive/v3/files/'+DRIVE_FOLDER+'?fields=id,mimeType,trashed&supportsAllDrives=true');
  if(parent.id!==DRIVE_FOLDER||parent.mimeType!=='application/vnd.google-apps.folder'||parent.trashed)throw new Error('Configured archive folder unavailable.');
  const manifest=row.drive_manifest;
  if(!manifest||typeof manifest.parts!=='object'||Array.isArray(manifest.parts))throw new Error('Invalid saved archive manifest.');
  manifest.snapshot_sha256=row.snapshot_sha256;
  const checkpoint=()=>queue('checkpoint',{drive_manifest:manifest});
  const create=async(key:string,name:string,parentId:string,type:string,media?:Blob,expectedHash?:string)=>{
   if(now()-started>90000)throw new Error('Continue archive on next delivery attempt.');
   let entry=manifest.parts[key];
   if(!entry){const ids=await api('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');if(!providerId(ids.ids?.[0]))throw new Error('Provider file identity missing.');entry=manifest.parts[key]={id:ids.ids[0]};await checkpoint();}
   if(!providerId(entry.id))throw new Error('Invalid reserved archive identity.');
   const hash=expectedHash||(media?await digest(new Uint8Array(await media.arrayBuffer())):null);
   if(!entry.done){
    if(type!=='application/vnd.google-apps.folder'&&!media)throw new Error('Saved archive bytes required.');
    const metadata={id:entry.id,name,parents:[parentId],mimeType:type,appProperties:{techcheck_event_id:delivery.event_id,techcheck_snapshot_sha256:row.snapshot_sha256,techcheck_part:key}};
    const boundary='techcheck_'+crypto.randomUUID();
    const options=media?{method:'POST',headers:{...auth,'Content-Type':'multipart/related; boundary='+boundary},body:new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+type+'\r\n\r\n',media,'\r\n--'+boundary+'--'])}:{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(metadata)};
    const url=media?'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true':'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
    const r=await request(url,{...options,signal:AbortSignal.timeout(30000)});if(!r.ok&&r.status!==409)throw new Error('Archive upload interrupted.');
   }
   // Recheck even completed parts before sending. A lost upload response (409)
   // is success only when identity, parent, MIME and actual bytes all match.
   const verified=await api('https://www.googleapis.com/drive/v3/files/'+entry.id+'?fields=id,mimeType,parents,appProperties,sha256Checksum,trashed&supportsAllDrives=true');
   if(verified.id!==entry.id||verified.trashed||verified.mimeType!==type||verified.parents?.length!==1||verified.parents[0]!==parentId||verified.appProperties?.techcheck_event_id!==delivery.event_id||verified.appProperties?.techcheck_snapshot_sha256!==row.snapshot_sha256||verified.appProperties?.techcheck_part!==key)throw new Error('Archive identity verification failed.');
   if(hash){const actual=verified.sha256Checksum||await digest(new Uint8Array(await (await get('https://www.googleapis.com/drive/v3/files/'+entry.id+'?alt=media&supportsAllDrives=true')).arrayBuffer()));if(actual!==hash)throw new Error('Archive content verification failed.');}
   if(!entry.done){Object.assign(entry,{done:true,sha256:hash});await checkpoint();}
   return entry.id;
  };
  const folder=await create('folder','Handoff '+delivery.kind+' '+delivery.event_id,DRIVE_FOLDER,'application/vnd.google-apps.folder');
  const links:Record<string,string>={},signatures:Record<string,Uint8Array>={};
  const photos=delivery.events.flatMap(e=>e.photos);
  for(let n=0;n<photos.length;n++){
   const p=photos[n],key='photo_'+n,hash=p.path.split('/').at(-1)!.slice(0,-4);let blob:Blob|undefined;
   if(!manifest.parts[key]?.done||p.kind==='signature'){
    const {data,error}=await admin.storage.from('techcheck-transfer-evidence').download(p.path);
    if(error||!data||data.size<1||data.size>5242880)throw new Error('Saved evidence unavailable.');
    const bytes=new Uint8Array(await data.arrayBuffer());
    if(bytes[0]!==255||bytes[1]!==216||await digest(bytes)!==hash)throw new Error('Saved evidence digest mismatch.');
    blob=new Blob([bytes as BlobPart],{type:'image/jpeg'});if(p.kind==='signature')signatures[p.path]=bytes;
   }
   const id=await create(key,(p.equipment_key||'Sign-off')+' - '+p.kind+'.jpg',folder,'image/jpeg',blob,hash);links[p.path]='https://drive.google.com/file/d/'+id+'/view';
  }
  const html=transferReportHtml(delivery,links),pdf=transferReportPdf(delivery,signatures);
  await create('html','Handoff - full signed report.html',folder,'text/html',new Blob([html],{type:'text/html'}));
  await create('json','Handoff - immutable signed answers.json',folder,'application/json',new Blob([row.snapshot_text],{type:'application/json'}),row.snapshot_sha256);
  await create('pdf','READ ME - signed handoff.pdf',folder,'application/pdf',new Blob([pdf as BlobPart],{type:'application/pdf'}));
  manifest.complete=true;await checkpoint();
  if(row.email_state!=='sent'){
   await queue('checkpoint',{email_state:'sending'});row.email_state='sending';
   const sent=await api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:transferRawEmail(delivery,html,folder,pdf)})});
   if(!providerId(sent.id))throw new Error('Email confirmation missing.');
   await queue('checkpoint',{email_state:'sent',email_id:sent.id});row.email_state='sent';
  }
  await queue('finish',{status:'sent'});return {accepted:true,status:'sent'};
 }catch{
  const ambiguous=row?.email_state==='sending'||row?.email_state==='review';
  if(row)try{await queue('finish',{status:ambiguous?'review':'retry'});}catch{}
  // No provider body, image path, SIM, credentials or user-controlled message.
  return {accepted:Boolean(row),status:ambiguous?'review':row?'pending':'unavailable'};
 }
}
