import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/service-daily-delivery/index.ts';
import {reportHtml,RECIPIENT,DRIVE_FOLDER} from '../../supabase/functions/service-daily-delivery/report.ts';
const id='00000000-0000-4000-8000-000000000003';
function fixture({configured=true,sendTimeout=false,uploadFailure=false}={}){
 const report={id,actor_name:'Synthetic <script> & Tech',check_date:'2026-10-16',submitted_at:'2026-10-16T12:00:00Z',lease_token:'lease',drive_manifest:{},email_state:'pending',photos:[{category:'Sniper',view:'front',path:'private/photo.jpg'}],snapshot:{truck_checks:Object.fromEntries(Array.from({length:8},(_,i)=>['truck_'+(i+1),true])),taking_trailer:false,trailer_checks:{},inventory:{units:[{equipment_type:'Sniper',unit_tag:'SN-0001'}],sims:[{slot_no:1,sim_number:'00123456789012345670'}],stock:{recon_battery_qty:25,agm_12v_110ah_qty:4,litime_12v_100ah_qty:2,battery_12v_35ah_qty:4}}}};
 const calls=[],files=new Map();let status='queued',counter=0;
 const admin={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='service_daily_cron_authorized_v1')return {data:args.p_secret==='trusted'};
  if(args.p_action==='claim')return {data:status==='sent'||status==='review'?null:structuredClone(report)};
  if(args.p_action==='checkpoint'){Object.assign(report,structuredClone(args.p_data));return {data:{ok:true}};}
  if(args.p_action==='finish'){status=args.p_data.status;return {data:{ok:true}};}
 },storage:{from:()=>({download:async()=>({data:new Blob(['synthetic image'],{type:'image/jpeg'})})})}};
 const fetch=async(url,opts={})=>{
  calls.push({url,method:opts.method||'GET'});
  const result=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  if(url.includes('oauth2.googleapis.com'))return result({access_token:'synthetic-token'});
  if(url.endsWith('/userinfo'))return result({email:RECIPIENT,email_verified:true});
  if(url.includes('generateIds'))return result({ids:['generated-'+(++counter)]});
  if(url.includes('messages/send')){if(sendTimeout)throw new Error('synthetic timeout');return result({id:'message-id'});}
  if(url.includes('/files/'+DRIVE_FOLDER))return result({id:DRIVE_FOLDER});
  if(opts.method==='POST'){
   let metadata;
   if(typeof opts.body==='string')metadata=JSON.parse(opts.body);else metadata=JSON.parse((await opts.body.text()).split('\r\n\r\n')[1].split('\r\n--')[0]);
   if(uploadFailure&&metadata.mimeType==='image/jpeg')throw new Error('synthetic interruption');
   if(files.has(metadata.id))return new Response('{}',{status:409});files.set(metadata.id,metadata);return result(metadata);
  }
  const fileId=url.split('/files/')[1]?.split('?')[0];return result(files.get(fileId));
 };
 const handler=createDeliveryHandler({admin,userClient:{auth:{getUser:async token=>token==='good'?{data:{user:{id:'actor'}}}:{error:{}}}},env:()=>configured?'synthetic-credential':undefined,fetch});
 const post=(headers={authorization:'Bearer good'})=>handler(new Request('https://function.example',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({report_id:id})}));
 return {post,report,calls,files,status:()=>status};
}
test('requires user or authenticated scheduler and rejects unknown origins',async()=>{
 const f=fixture();assert.equal((await f.post({})).status,401);assert.equal((await f.post({'x-techcheck-cron':'bad'})).status,401);assert.equal((await f.post({origin:'https://evil.example'})).status,403);assert.equal(f.calls.some(c=>c.args?.p_action==='claim'),false);
});
test('missing Google configuration persists blocked status and never claims sent',async()=>{
 const f=fixture({configured:false});const r=await f.post();assert.equal((await r.json()).status,'blocked');assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url),false);
});
test('archives report, exact answers and private photos before one verified email',async()=>{
 const f=fixture();const result=await (await f.post()).json();assert.equal(result.status,'sent');assert.equal(f.status(),'sent');assert.equal(f.files.size,4);
 const email=f.calls.findIndex(c=>c.url?.includes('messages/send'));const archive=f.calls.findIndex(c=>c.args?.p_data?.drive_manifest?.complete);assert.ok(archive<email);
 assert.equal(f.report.email_state,'sent');assert.equal(f.report.email_id,'message-id');await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('messages/send')).length,1);
 const html=reportHtml(f.report);assert.ok(html.includes('00123456789012345670'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('trailer inspection not required'));
});
test('archive interruption preserves reserved IDs for a retry without sending email',async()=>{
 const f=fixture({uploadFailure:true});assert.equal((await f.post()).status,202);assert.equal(f.status(),'retry');assert.ok(f.report.drive_manifest.photo_0.id);assert.equal(f.calls.some(c=>c.url?.includes('messages/send')),false);
});
test('ambiguous email timeout stops for review and does not resend',async()=>{
 const f=fixture({sendTimeout:true});await f.post();assert.equal(f.status(),'review');assert.equal(f.report.email_state,'sending');await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('messages/send')).length,1);
});
