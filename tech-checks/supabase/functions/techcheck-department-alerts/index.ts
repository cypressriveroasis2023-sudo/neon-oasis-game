import {MANAGER_EMAIL,makeRawMail,verifiedStaffEmail} from './mail.ts';

type Alert = {
 id:string;lease_token:string;recipient_email:string;subject:string;body:string
};
type Dependencies = {
 admin:{rpc:(method:string,args:Record<string,unknown>)=>Promise<{data:any;error?:any}>};
 env:(name:string)=>string|undefined;
 fetch?:(input:string,init?:RequestInit)=>Promise<Response>;
};

// Scheduled worker only: the existing server-held TechCheck Google connection
// sends mandatory operational alerts to real staff, independent of optional
// in-app/device push toggles. A database lease and durable queue make each
// source event produce one recipient message; uncertain sends require review.
export function createDepartmentAlertHandler({admin,env,fetch:request=fetch}:Dependencies){
 const response=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{
   status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
 });
 const rpc=async(method:string,args:Record<string,unknown>)=>{
   const {data,error}=await admin.rpc(method,args);
   if(error)throw new Error('Department alert queue unavailable.');
   return data;
 };
 const queue=async(action:string,alert?:Alert,email_id?:string)=>rpc(
   'techcheck_department_alert_delivery_v1',{
      p_action:action,p_id:alert?.id||null,p_lease:alert?.lease_token||null,p_email_id:email_id||null
   });
 const googleToken=async()=>{
   const names=['TECHCHECK_GOOGLE_CLIENT_ID','TECHCHECK_GOOGLE_CLIENT_SECRET','TECHCHECK_GOOGLE_REFRESH_TOKEN'];
   const vars=names.map(name=>env(name)||'');
   if(vars.some(value=>!value))throw new Error('Private Google mail connection unavailable.');
   const result=await request('https://oauth2.googleapis.com/token',{
     method:'POST',
     headers:{'Content-Type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({
       client_id:vars[0],client_secret:vars[1],
       refresh_token:vars[2],grant_type:'refresh_token'
     }),
     signal:AbortSignal.timeout(20000)
   });
   if(!result.ok)throw new Error('Google mail renewal unavailable.');
   const body=await result.json();
   if(!body?.access_token)throw new Error('Google mail renewal incomplete.');
   const info=await request('https://openidconnect.googleapis.com/v1/userinfo',{
     headers:{Authorization:'Bearer '+body.access_token},signal:AbortSignal.timeout(20000)
   });
   if(!info.ok)throw new Error('Google sender account verification failed.');
   const profile=await info.json();
   if(profile.email?.toLowerCase()!==MANAGER_EMAIL||profile.email_verified!==true)
     throw new Error('Connected Google sender is not the Operations Manager.');
   return String(body.access_token);
 };
 return async function handler(req:Request):Promise<Response>{
   if(req.method!=='POST')return response({error:'POST required.'},405);
   // Never accept ordinary browser requests, bearer tokens or arbitrary recipients.
   const secret=req.headers.get('x-techcheck-cron');
   if(!secret)return response({error:'Scheduler authorization required.'},401);
   try {
     const allowed=await rpc('service_daily_cron_authorized_v1',{p_secret:secret});
     if(allowed!==true)return response({error:'Scheduler authorization denied.'},401);
   }catch{return response({error:'Scheduler authorization unavailable.'},503);}
   let sent=0,review=0,retry=0;
   for(let n=0;n<12;n++){
     let alert:Alert|null=null,started=false,token:string|null=null;
     try{
       alert=await queue('claim');
       if(!alert)break;
       if(!verifiedStaffEmail(alert.recipient_email))
         throw new Error('Unverified staff email.');
       token=await googleToken();
       const raw=makeRawMail(alert);
       // Persist this boundary before contacting Gmail. If the provider times
       // out after accepting the message, never send a second copy blindly.
       await queue('begin_send',alert);
       started=true;
       const mail=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
          method:'POST',
          headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({raw}),signal:AbortSignal.timeout(30000)
       });
       if(!mail.ok)throw new Error('Google mail request unconfirmed.');
       const receipt=await mail.json();
       if(typeof receipt?.id!=='string'||!receipt.id)
         throw new Error('Gmail did not supply a message ID.');
       await queue('sent',alert,receipt.id);
       sent++;
     }catch{
       if(!alert)return response({error:'Delivery queue read failed.',sent,review,retry},503);
       // A send in flight can have succeeded even when its response failed.
       try{await queue(started?'review':'retry',alert);}catch{}
       if(started)review++;else retry++;
     }
   }
   return response({ok:true,sent,review,retry});
 };
}
