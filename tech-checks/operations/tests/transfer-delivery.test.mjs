import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/techcheck-transfer-delivery/index.ts';
import {summaryPdf,summaryHtml,reportHtml,rawEmail,RECIPIENT,DRIVE_FOLDER} from '../../supabase/functions/techcheck-transfer-delivery/report.ts';
const id='00000000-0000-4000-8000-000000000003';
function fixture({configured=true,sendTimeout=false,uploadFailure=false}={}){
 const report={id,kind:'checkout',actor_name:'Synthetic <script> & Tech',check_date:'2026-10-16',submitted_at:'2026-10-16T12:00:00Z',lease_token:'lease',drive_manifest:{},email_state:'pending',photos:[{category:'Sniper',view:'front',path:'private/photo.jpg'}],snapshot:{truck_checks:Object.fromEntries(Array.from({length:8},(_,i)=>['truck_'+(i+1),true])),taking_trailer:false,trailer_checks:{},inventory:{units:[{equipment_type:'Sniper',unit_tag:'SN-0001'}],sims:[{slot_no:1,sim_number:'00123456789012345670'}],stock:{recon_battery_qty:25,agm_12v_110ah_qty:4,litime_12v_100ah_qty:2,battery_12v_35ah_qty:4}}}};
 report.snapshot={transfer_id:id,state:'awaiting_service',revision:1,it_name:'Synthetic IT',service_name:'Synthetic Service',expected:[],actual:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['00123456789012345670'],battery_count:2,parts:[]}],checks:{},differences:[],notes:'Synthetic only',signature:{name:'Synthetic IT',signed_at:report.submitted_at,method:'typed',statement:'I checked this equipment.'}};
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
test('rejects unsigned requests and untrusted scheduler; missing Google configuration never claims success',async()=>{
 const f=fixture({configured:false});assert.equal((await f.post({})).status,401);assert.equal((await f.post({'x-techcheck-cron':'bad'})).status,401);
 assert.equal((await (await f.post()).json()).status,'blocked');assert.equal(f.calls.some(c=>c.url),false);
});
test('archives signed handoff, exact SIMs and all evidence before one email; retry preserves IDs',async()=>{
 const f=fixture();assert.equal((await (await f.post()).json()).status,'sent');assert.equal(f.files.size,5);
 assert.ok(f.calls.some(c=>c.name==='techcheck_transfer_delivery_v1'));assert.equal(f.report.email_state,'sent');
 assert.match(reportHtml(f.report),/00123456789012345670/);await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('messages/send')).length,1);
 const mime=Buffer.from(rawEmail(f.report,summaryHtml(f.report,'folder','pdf'),'folder',undefined,summaryPdf(f.report)),'base64url').toString();
 assert.match(mime,/Message-ID: <handoff-/);assert.match(mime,/application\/pdf/);assert.match(mime,/filename="Handoff-/);
});
test('interrupted archive retries; ambiguous email delivery stops before any duplicate message',async()=>{
 const f=fixture({uploadFailure:true});await f.post();assert.equal(f.status(),'retry');assert.equal(f.calls.some(c=>c.url?.includes('messages/send')),false);
 const g=fixture({sendTimeout:true});await g.post();assert.equal(g.status(),'review');await g.post();assert.equal(g.calls.filter(c=>c.url?.includes('messages/send')).length,1);
});
test('twenty-unit PDF retains every unit, discrepancies, event revision and the server signature',()=>{
 const r=fixture().report;r.snapshot.actual=Array.from({length:20},(_,i)=>({equipment_key:'sniper:'+i,family:'Sniper',unit_tag:String(i).padStart(3,'0'),sims:['001234'+i],battery_count:2,parts:[]}));
 r.snapshot.differences=[{equipment_key:'sniper:19',field:'battery_count',expected:2,actual:1}];
 const pdf=new TextDecoder().decode(summaryPdf(r));assert.match(pdf,/\/Count 20/);assert.match(pdf,/Sniper 019/);assert.match(pdf,/00123419/);assert.match(pdf,/DISCREPANCIES/);assert.match(pdf,/SIGNED BY Synthetic IT/);
 r.snapshot.signature.method='drawn';assert.throws(()=>summaryPdf(r),/Handwritten signature required/);
});
