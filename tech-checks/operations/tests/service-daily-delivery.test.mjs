import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/service-daily-delivery/index.ts';
import {summaryPdf,summaryHtml} from '../../supabase/functions/service-daily-delivery/summary.ts';
import {reportHtml,rawEmail,RECIPIENT,DRIVE_FOLDER} from '../../supabase/functions/service-daily-delivery/report.ts';
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
test('daily archive includes exact signed receipt event and revision as a readable PDF appendix',async()=>{
 const f=fixture(),event='00000000-0000-4000-8000-000000000111';
 const snapshot={transfer_id:'handoff-id',state:'accepted',revision:2,it_name:'Synthetic IT',service_name:'Synthetic Service',actual:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['00123456789012345670'],battery_count:2,parts:[]}],expected:[],differences:[],checks:{},signature:{method:'typed',name:'Synthetic Service',signed_at:f.report.submitted_at,statement:'I checked the equipment.'}};
 f.report.snapshot.transfer_receipts=[{event_id:event,revision:2,signed_at:f.report.submitted_at,snapshot}];
 assert.equal((await (await f.post()).json()).status,'sent');
 assert.ok([...f.files.values()].some(v=>v.name==='Equipment receipt '+event+' - revision 2.pdf'));
});
test('missing Google configuration persists blocked status and never claims sent',async()=>{
 const f=fixture({configured:false});const r=await f.post();assert.equal((await r.json()).status,'blocked');assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url),false);
});
test('archives report, exact answers and private photos before one verified email',async()=>{
 const f=fixture();const result=await (await f.post()).json();assert.equal(result.status,'sent');assert.equal(f.status(),'sent');assert.equal(f.files.size,5);
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

test('report ends with authenticated sign-off, Chicago date/time and the signature image link',()=>{
 const f=fixture();f.report.snapshot.signature={name:'Synthetic <Tech>',username:'synthetic.service',signed_by:'bound-account',signed_at:'2026-10-16T14:30:00Z',method:'drawn',statement:'I confirm this report is accurate.'};f.report.photos.push({category:'Additional images',view:'1',filename:'<image>.png'},{category:'Technician signature',view:'signature'});
 const html=reportHtml(f.report,{'Technician signature:signature':'https://drive.google.com/file/d/signature/view'});assert.match(html,/Synthetic &lt;Tech&gt;/);assert.match(html,/synthetic.service/);assert.match(html,/09:30:00/);assert.match(html,/America\/Chicago/);assert.match(html,/View handwritten signature/);assert.match(html,/&lt;image&gt;.png/);assert.ok(html.lastIndexOf('<h2>Technician signature</h2>')>html.lastIndexOf('<h2>Photos and image attachments</h2>'));
});

test('one-page summary includes exact stock, signature timestamp and private PDF attachment',()=>{
 const f=fixture();f.report.snapshot.signature={name:'Synthetic Tech',signed_at:'2026-10-16T14:30:00Z',method:'typed',statement:'I confirm this report is accurate.'};
 const pdf=summaryPdf(f.report);const text=new TextDecoder().decode(pdf);
 assert.match(text,/Count 1/);assert.match(text,/00123456789012345670/);assert.match(text,/Recon batteries: 25/);assert.match(text,/Synthetic Tech/);assert.match(text,/09:30:00/);assert.match(text,/Not taking a trailer/);
 const html=summaryHtml(f.report,'folder','https://drive.google.com/file/d/pdf/view');
 assert.match(html,/TechCheck Daily Summary/);assert.match(html,/8 of 8/);assert.match(html,/one-page PDF/);
 const raw=Buffer.from(rawEmail(f.report,html,'folder',undefined,pdf),'base64url').toString();assert.match(raw,/application\/pdf/);assert.match(raw,/Content-Disposition: attachment/);
 f.report.snapshot.signature.method='drawn';assert.throws(()=>summaryPdf(f.report),/Handwritten signature required/);
 assert.throws(()=>summaryPdf(f.report,new Uint8Array([0,1,2])),/JPEG could not be embedded/);
});

test('drawn sign-off embeds signature bytes in PDF and uses a matching inline email CID',()=>{
 const f=fixture();f.report.snapshot.signature={name:'Synthetic Tech',signed_at:'2026-10-16T14:30:00Z',method:'drawn',statement:'I confirm this report is accurate.'};
 // Minimal RGB JPEG header for binary embedding; the rendered QA uses a full JPEG.
 const jpeg=new Uint8Array([255,216,255,192,0,17,8,0,180,2,88,3,1,17,0,2,17,0,3,17,0,255,217]);
 const pdf=summaryPdf(f.report,jpeg),text=new TextDecoder().decode(pdf);
 assert.match(text,/\/Subtype \/Image \/Width 600 \/Height 180/);assert.match(text,/\/Sig Do/);
 const html=summaryHtml(f.report,'folder','pdf');assert.match(html,/cid:techcheck-signature/);
 const raw=Buffer.from(rawEmail(f.report,html,'folder',jpeg,pdf),'base64url').toString();assert.match(raw,/Content-ID: <techcheck-signature>/);assert.match(raw,/filename="TechCheck-2026-10-16.pdf"/);
});

test('adding summary to an already emailed report preserves sent email state',async()=>{
 const f=fixture();f.report.email_state='sent';f.report.email_id='existing-message';
 assert.equal((await (await f.post()).json()).status,'sent');
 assert.equal(f.calls.some(c=>c.url?.includes('messages/send')),false);
 assert.ok([...f.files.values()].some(v=>v.mimeType==='application/pdf'));
 assert.equal(f.report.email_id,'existing-message');
});
