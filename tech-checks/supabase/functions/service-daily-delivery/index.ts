import {summaryPdf,summaryHtml} from './summary.ts';
import {DRIVE_FOLDER,RECIPIENT,reportHtml,rawEmail} from './report.ts';
import {summaryPdf as receiptPdf} from '../techcheck-transfer-delivery/report.ts';
const ORIGINS=new Set(['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']);
export function createDeliveryHandler({admin,userClient,env,fetch:request=fetch}:any) {
 const call=async(name:string,args:any)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('Daily delivery database operation failed.');return data;};
 return async(req:Request)=>{
  const origin=req.headers.get('origin');
  const cors:Record<string,string>={'Content-Type':'application/json','Vary':'Origin'};
  if(origin && ORIGINS.has(origin)){cors['Access-Control-Allow-Origin']=origin;cors['Access-Control-Allow-Headers']='authorization, apikey, x-client-info, content-type';cors['Access-Control-Allow-Methods']='POST, OPTIONS';}
  const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  if(origin && !ORIGINS.has(origin))return response({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return response({error:'POST required.'},405);
  let report:any=null;
  try {
   let actor:string|null=null;
   const cron=req.headers.get('x-techcheck-cron');
   if(cron){if(!(await call('service_daily_cron_authorized_v1',{p_secret:cron})))return response({error:'Not authorized.'},401);}
   else {
    const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return response({error:'Sign in required.'},401);
    const {data,error}=await userClient.auth.getUser(token);
    if(error||!data?.user?.id)return response({error:'Sign in required.'},401);
    actor=data.user.id;
   }
   let body;try{body=await req.json();}catch{return response({error:'Invalid request.'},400);}
   if(!cron && (typeof body.report_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.report_id)))return response({error:'Report ID required.'},400);
   report=await call('service_daily_delivery_v1',{p_action:'claim',p_id:cron?null:body.report_id,p_actor:actor});
   if(!report)return response({accepted:true,status:'pending_or_finished'});
   const queue=(action:string,data:any)=>call('service_daily_delivery_v1',{p_action:action,p_id:report.id,p_lease:report.lease_token,p_data:data});
   const finish=(status:string,error?:string)=>queue('finish',{status,error});
   const credentials=['TECHCHECK_GOOGLE_CLIENT_ID','TECHCHECK_GOOGLE_CLIENT_SECRET','TECHCHECK_GOOGLE_REFRESH_TOKEN'].map(name=>String(env(name)||''));
   if(credentials.some(v=>!v)) {await finish('blocked','Google Drive and email connection required.');return response({accepted:true,status:'blocked'});}
   const google=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials[0],client_secret:credentials[1],refresh_token:credentials[2],grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
   const tokenData=await google.json();if(!google.ok||!tokenData.access_token)throw new Error('Google connection needs reconnection.');
   const auth={Authorization:'Bearer '+tokenData.access_token};
   const api=async(url:string,options:any={})=>{
    const r=await request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error('Google archive request failed ('+r.status+').');return r.json();
   };
   // Require James's actual account. Never deliver using a guessed sender/account.
   const profile=await api('https://openidconnect.googleapis.com/v1/userinfo');
   if(profile.email?.toLowerCase()!==RECIPIENT || profile.email_verified!==true) {await finish('blocked','Connect the Operations Manager Google account.');return response({accepted:true,status:'blocked'});}
   await api('https://www.googleapis.com/drive/v3/files/'+DRIVE_FOLDER+'?fields=id,mimeType&supportsAllDrives=true');
   const manifest=report.drive_manifest||{};
   const checkpoint=async()=>queue('checkpoint',{drive_manifest:manifest});
   // Persist provider-generated IDs before creating anything. Retrying a Drive
   // upload uses the same ID; a 409 means the earlier create already succeeded.
   const reserve=async(key:string)=>{
    if(!manifest[key]){const ids=await api('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');manifest[key]={id:ids.ids[0]};await checkpoint();}
    return manifest[key];
   };
   const create=async(key:string,name:string,parent:string,type:string,media?:Blob)=>{
    const entry=await reserve(key);if(entry.done)return entry.id;
    const metadata={id:entry.id,name,parents:[parent],mimeType:type,appProperties:{techcheck_report_id:report.id,techcheck_part:key}};
    let options:any,url:string;
    if(media){const boundary='techcheck_'+crypto.randomUUID();options={method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+type+'\r\n\r\n',media,'\r\n--'+boundary+'--'],{type:'multipart/related'})};url='https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';}
    else {options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)};url='https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';}
    const r=await request(url,{...options,headers:{...auth,...options.headers},signal:AbortSignal.timeout(30000)});
    if(!r.ok&&r.status!==409)throw new Error('Drive upload failed ('+r.status+').');
    const verify=await api('https://www.googleapis.com/drive/v3/files/'+entry.id+'?fields=id,appProperties,parents&supportsAllDrives=true');
    if(verify.appProperties?.techcheck_report_id!==report.id || verify.appProperties?.techcheck_part!==key || !verify.parents?.includes(parent))throw new Error('Drive archive verification failed.');
    entry.done=true;await checkpoint();return entry.id;
   };
   const folder=await create('folder',report.check_date+' · '+report.actor_name+' · '+report.id.slice(0,8),DRIVE_FOLDER,'application/vnd.google-apps.folder');
   const links:Record<string,string>={};
   for(let n=0;n<report.photos.length;n++){
    const p=report.photos[n],part='photo_'+n;
    if(!manifest[part]?.done){const {data,error}=await admin.storage.from('service-daily-evidence').download(p.path);if(error||!data)throw new Error('Saved photo could not be read.');await create(part,p.category+' - '+p.view+'.jpg',folder,'image/jpeg',data);}
    links[p.category+':'+p.view]='https://drive.google.com/file/d/'+manifest[part].id+'/view';
   }
   const html=reportHtml(report,links);
   await create('report','TechCheck '+report.check_date+'.html',folder,'text/html',new Blob([html],{type:'text/html'}));
   await create('answers','TechCheck '+report.check_date+'.json',folder,'application/json',new Blob([JSON.stringify({id:report.id,actor_name:report.actor_name,check_date:report.check_date,submitted_at:report.submitted_at,snapshot:report.snapshot,photos:report.photos.map((p:any)=>({category:p.category,view:p.view,url:links[p.category+':'+p.view]}))},null,2)],{type:'application/json'}));
   let signature:Uint8Array|undefined;
   const signaturePhoto=report.photos.find((p:any)=>p.category==='Technician signature'&&p.view==='signature');
   if(report.snapshot.signature?.method==='drawn'){
    if(!signaturePhoto)throw new Error('Saved signature missing.');
    const {data,error}=await admin.storage.from('service-daily-evidence').download(signaturePhoto.path);
    if(error||!data)throw new Error('Saved signature could not be read.');
    signature=new Uint8Array(await data.arrayBuffer());
   }
   const pdf=summaryPdf(report,signature);
   const summaryId=await create('summary_pdf_v1','READ ME - TechCheck '+report.check_date+' - Summary.pdf',folder,'application/pdf',new Blob([pdf as BlobPart],{type:'application/pdf'}));
   // The concise daily PDF remains one page; each linked signed receipt has
   // a readable appendix PDF with exact event/revision and equipment details.
   for(const receipt of report.snapshot.transfer_receipts||[]){
    let ink:Uint8Array|undefined;
    if(receipt.snapshot.signature.method==='drawn'){
     const {data,error}=await admin.storage.from('techcheck-transfer-evidence').download(receipt.snapshot.signature.path);
     if(error||!data)throw new Error('Saved handoff signature could not be read.');
     ink=new Uint8Array(await data.arrayBuffer());
    }
    const appendix=receiptPdf({id:receipt.event_id,kind:'receipt',submitted_at:receipt.signed_at,snapshot:receipt.snapshot},ink);
    await create('receipt_'+receipt.event_id,'Equipment receipt '+receipt.event_id+' - revision '+receipt.revision+'.pdf',folder,'application/pdf',new Blob([appendix as BlobPart],{type:'application/pdf'}));
   }
   const emailHtml=summaryHtml(report,folder,'https://drive.google.com/file/d/'+summaryId+'/view');
   manifest.complete=true;await checkpoint();
   if(report.email_state==='sending'||report.email_state==='review'){
    // A timeout after send may have delivered. Do not send a second copy.
    await finish('review','Drive archive complete; verify email delivery before retrying.');return response({accepted:true,status:'review'});
   }
   if(report.email_state!=='sent'){
    await queue('checkpoint',{email_state:'sending'});report.email_state='sending';
    const sent=await api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:rawEmail(report,emailHtml,folder,signature,pdf)})});
    if(!sent.id)throw new Error('Email delivery confirmation missing.');
    await queue('checkpoint',{email_state:'sent',email_id:sent.id});report.email_state='sent';
   }
   await finish('sent');return response({accepted:true,status:'sent'});
  }catch {
   // Never echo provider bodies, OAuth secrets, SIMs or image paths into logs.
   if(report)try{await call('service_daily_delivery_v1',{p_action:'finish',p_id:report.id,p_lease:report.lease_token,p_data:{status:report.email_state==='sending'?'review':'retry',error:report.email_state==='sending'?'Verify email delivery before retrying.':'Delivery interrupted; saved report will retry.'}});}catch{}
   return response({accepted:Boolean(report),status:report?'pending':'unavailable'},report?202:503);
  }
 };
}
