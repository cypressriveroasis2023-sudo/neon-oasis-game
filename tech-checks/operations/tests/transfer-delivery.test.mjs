import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryHandler} from '../../supabase/functions/techcheck-transfer-delivery/index.ts';
import {summaryPdf,summaryHtml,reportHtml,rawEmail,RECIPIENT} from '../../supabase/functions/techcheck-transfer-delivery/report.ts';
import {TECHNICIANS_ROOT,TECHNICIAN_FOLDERS} from '../../supabase/functions/_shared/technicianArchive.ts';
const id='00000000-0000-4000-8000-000000000003';
function fixture({configured=true,sendTimeout=false,uploadFailure=false}={}){
 const report={id,kind:'checkout',actor_name:'Synthetic <script> & Tech',check_date:'2026-10-16',submitted_at:'2026-10-16T12:00:00Z',lease_token:'lease',drive_manifest:{},email_state:'pending',photos:[{category:'Sniper',view:'front',path:'private/photo.jpg'}],snapshot:{truck_checks:Object.fromEntries(Array.from({length:8},(_,i)=>['truck_'+(i+1),true])),taking_trailer:false,trailer_checks:{},inventory:{units:[{equipment_type:'Sniper',unit_tag:'SN-0001'}],sims:[{slot_no:1,sim_number:'00123456789012345670'}],stock:{recon_battery_qty:25,agm_12v_110ah_qty:4,litime_12v_100ah_qty:2,battery_12v_35ah_qty:4}}}};
 report.snapshot={transfer_id:id,state:'awaiting_service',revision:1,it_name:'Synthetic IT',service_name:'Synthetic Service',expected:[],actual:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['00123456789012345670'],battery_count:2,parts:[]}],checks:{},differences:[],notes:'Synthetic only',signature:{name:'Synthetic IT',signed_at:report.submitted_at,method:'typed',statement:'I checked this equipment.'}};
 const calls=[],files=new Map(),downloads=[];let status='queued',counter=0;
 const technician=TECHNICIAN_FOLDERS[0],folder=(id,name,parent)=>({id,name,mimeType:'application/vnd.google-apps.folder',parents:parent?[parent]:[],trashed:false});
 const destinations=new Map([TECHNICIANS_ROOT,...TECHNICIAN_FOLDERS].map(v=>[v.id,folder(v.id,v.name,v.id===TECHNICIANS_ROOT.id?null:TECHNICIANS_ROOT.id)]));
 destinations.set('existing-date',folder('existing-date',report.check_date,technician.id));destinations.set('existing-category',folder('existing-category','Equipment Transfers','existing-date'));
 const admin={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='service_daily_cron_authorized_v1')return {data:args.p_secret==='trusted'};
  if(name==='techcheck_archive_destination_v1')return {data:{version:1,enabled:true,ready:true,source:'transfer',source_id:id,actor_id:'00000000-0000-4000-8000-000000000081',check_date:report.check_date,category:'Equipment Transfers',root_folder:TECHNICIANS_ROOT,technician_folder:technician,date_folder:{id:'existing-date',parent_id:technician.id,name:report.check_date,adopted:true},category_folder:{id:'existing-category',parent_id:'existing-date',name:'Equipment Transfers',adopted:true}}};
  if(args.p_action==='claim')return {data:status==='sent'||status==='review'?null:structuredClone(report)};
  if(args.p_action==='checkpoint'){Object.assign(report,structuredClone(args.p_data));return {data:{ok:true}};}
  if(args.p_action==='finish'){status=args.p_data.status;return {data:{ok:true}};}
 },storage:{from:()=>({download:async(path)=>{downloads.push(path);return {data:new Blob(['synthetic image'],{type:'image/jpeg'})};}})}};
 const fetch=async(url,opts={})=>{
  calls.push({url,method:opts.method||'GET'});
  const result=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  if(url.includes('oauth2.googleapis.com'))return result({access_token:'synthetic-token'});
  if(url.endsWith('/userinfo'))return result({email:RECIPIENT,email_verified:true});
  if(url.includes('generateIds'))return result({ids:['generated-'+(++counter)]});
  if(url.includes('messages/send')){if(sendTimeout)throw new Error('synthetic timeout');return result({id:'message-id'});}
  if((!opts.method||opts.method==='GET')&&new URL(url).pathname==='/drive/v3/files'){
   const q=new URL(url).searchParams.get('q')||'',parent=q.match(/^'([^']+)' in parents/)?.[1],name=q.match(/ and name = '([^']+)'$/)?.[1];
   return result({files:[...destinations.values()].filter(v=>v.parents[0]===parent&&v.name===name)});
  }
  if(opts.method==='POST'){
   let metadata;
   if(typeof opts.body==='string')metadata=JSON.parse(opts.body);else metadata=JSON.parse((await opts.body.text()).split('\r\n\r\n')[1].split('\r\n--')[0]);
   if(uploadFailure&&metadata.mimeType==='image/jpeg')throw new Error('synthetic interruption');
   if(files.has(metadata.id))return new Response('{}',{status:409});files.set(metadata.id,{...metadata,trashed:false});return result(metadata);
  }
  const fileId=url.split('/files/')[1]?.split('?')[0];return files.has(fileId)||destinations.has(fileId)?result(files.get(fileId)||destinations.get(fileId)):new Response('{}',{status:404});
 };
 const handler=createDeliveryHandler({admin,userClient:{auth:{getUser:async token=>token==='good'?{data:{user:{id:'actor'}}}:{error:{}}}},env:()=>configured?'synthetic-credential':undefined,fetch});
 const post=(headers={authorization:'Bearer good'})=>handler(new Request('https://function.example',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({report_id:id})}));
 const checkConnection=()=>handler(new Request('https://function.example',{method:'POST',headers:{'Content-Type':'application/json','x-techcheck-cron':'trusted'},body:JSON.stringify({action:'check_connection'})}));
 return {post,checkConnection,report,calls,files,downloads,status:()=>status};
}
test('rejects unsigned requests and untrusted scheduler; missing Google configuration never claims success',async()=>{
 const f=fixture({configured:false});assert.equal((await f.post({})).status,401);assert.equal((await f.post({'x-techcheck-cron':'bad'})).status,401);
 assert.equal((await (await f.post()).json()).status,'blocked');assert.equal(f.calls.some(c=>c.url),false);
});
test('server connection probe verifies Google and archive without sending email or claiming reports',async()=>{
 const f=fixture();assert.equal((await (await f.checkConnection()).json()).ready,true);
 assert.equal(f.calls.some(c=>c.args?.p_action==='claim'),false);assert.equal(f.files.size,0);assert.equal(f.calls.some(c=>c.url?.includes('messages/send')),false);
 const g=fixture({configured:false});assert.equal((await (await g.checkConnection()).json()).ready,false);
});
test('archives signed handoff, exact SIMs and all evidence before one email; retry preserves IDs',async()=>{
 const f=fixture();assert.equal((await (await f.post()).json()).status,'sent');assert.equal(f.files.size,5);
 assert.deepEqual(f.files.get(f.report.drive_manifest.folder.id).parents,['existing-category']);
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
test('simple replenishment archives original IT photo with provenance and sends only once',async()=>{
 const f=fixture();f.report.kind='receipt';f.report.photos=[];
 f.report.snapshot.purpose='truck_replenishment';f.report.snapshot.actual[0].battery_count=null;
 const original={equipment_key:'sniper:001',kind:'unit',source_actor_id:'00000000-0000-4000-8000-000000000001',source_event_id:'00000000-0000-4000-8000-000000000002',source_actor_name:'Synthetic IT',source_signed_at:'2026-10-15T12:00:00Z'};
 original.path=original.source_actor_id+'/'+original.source_event_id+'/'+'a'.repeat(64)+'.jpg';
 f.report.snapshot.original_evidence=[original];
 assert.equal((await (await f.post()).json()).status,'sent');
 assert.deepEqual(f.downloads,[original.path]);
 assert.ok([...f.files.values()].some(file=>file.name==='Original IT photo - sniper:001 - Synthetic IT.jpg'&&file.appProperties.techcheck_part==='original_it_photo_0'));
 assert.equal(f.report.drive_manifest.original_it_photo_0.done,true);
 await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('messages/send')).length,1);
});
test('purpose amendment archives and delivers without a manufactured signature',async()=>{
 const f=fixture();f.report.kind='purpose_amendment';f.report.photos=[];
 delete f.report.snapshot.signature;
 Object.assign(f.report.snapshot,{purpose:'truck_replenishment',applied_by:{name:'Synthetic Owner',role:'owner'},recorded_at:f.report.submitted_at,statement:'The Service technician must independently confirm receipt.',original_event_id:id,previous_revision:1,previous_state:'awaiting_service'});
 assert.equal((await (await f.post()).json()).status,'sent');
 assert.equal(f.files.size,4);assert.equal(f.downloads.length,0);
 assert.equal(f.calls.filter(c=>c.url?.includes('messages/send')).length,1);
});
