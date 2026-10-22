import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCorrectionDeliveryHandler} from '../../supabase/functions/techcheck-correction-delivery/index.ts';
import {correctionRecord,correctionHtml,correctionAnswers,correctionPdf,correctionRawEmail,evidenceSource,RECIPIENT} from '../../supabase/functions/techcheck-correction-delivery/report.ts';

const id='00000000-0000-4000-8000-000000000101',transfer='00000000-0000-4000-8000-000000000102',event='00000000-0000-4000-8000-000000000103';
const owner={id:'00000000-0000-4000-8000-000000000104',name:'Synthetic Owner'},tech={id:'00000000-0000-4000-8000-000000000105',name:'Synthetic IT'},service={id:'00000000-0000-4000-8000-000000000106',name:'Synthetic Service'};
const photo=Buffer.from([255,216,255,224,0,4,0,0,255,217]),sha=b=>createHash('sha256').update(b).digest('hex');
const item=tag=>({equipment_key:'solar_spotter:'+tag,family:'Solar Spotter',unit_tag:tag,sims:[],battery_count:4,battery_configuration:'agm_4x_12v_110ah',required_battery_count:4,parts:[]});
export function syntheticCorrection(){
 const confirmed_at='2026-10-21T17:01:00Z';
 const photos=['tag','unit'].map(kind=>({kind,equipment_key:'solar_spotter:002',path:owner.id+'/'+id+'/'+sha(photo)+'.jpg'}));
 return {id,correction_id:id,transfer_id:transfer,revision:2,purpose:'installation',purpose_revision:1,created_at:'2026-10-21T17:05:00Z',submitted_at:'2026-10-21T17:05:00Z',original_submitted_at:'2026-10-21T16:00:00Z',original_check_date:'2026-10-21',original_event_id:event,actor_id:owner.id,actor_name:owner.name,original_technician:tech,service_recipient:service,applied_by:owner,confirmed_by:{...tech,mode:'cited',confirmed_at},confirmation_recorded_by:owner.id,confirmation:{mode:'cited',technician_id:tech.id,technician_name:tech.name,confirmed_at,recorded_by:owner.id,technician_reply:'I physically checked the tag and confirm unit 002. The new tag photo matches.',evidence_reference:'https://mail.google.com/mail/u/0/#inbox/synthetic-confirmation'},mode:'cited',reason:'Technician confirmed the correct equipment tag after reviewing the photographed unit.',technician_reply:'I physically checked the tag and confirm unit 002. The new tag photo matches.',evidence_reference:'https://mail.google.com/mail/u/0/#inbox/synthetic-confirmation',before:[item('001')],after:[item('002')],state:'awaiting_service',photos,original_drive_manifest:{complete:true,folder:{id:'original-folder',done:true},summary_pdf_v1:{id:'original-summary',done:true},answers:{id:'original-answers',done:true},photo_0:{id:'original-photo',done:true}},drive_manifest:{},email_state:'pending',email_id:null,lease_token:'00000000-0000-4000-8000-000000000107'};
}
export const sampleLinks={originalFolder:'https://drive.google.com/drive/folders/original-folder',originalPdf:'https://drive.google.com/file/d/original-summary/view',correctionFolder:'https://drive.google.com/drive/folders/correction-folder',correctionPdf:'https://drive.google.com/file/d/correction-summary/view',answers:'https://drive.google.com/file/d/correction-json/view',evidence:[{label:'Matching tag photo',url:'https://drive.google.com/file/d/correction-photo/view'},{label:'Matching whole-unit photo',url:'https://drive.google.com/file/d/correction-photo/view'}]};

function fixture(options={}){
 const report=syntheticCorrection(),calls=[],files=new Map(),media=new Map();let status='queued',nextId=0,claimed=false,uploadTimedOut=false;
 for(const [key,entry] of Object.entries(report.original_drive_manifest)){
  if(key==='complete')continue;
  const content=Buffer.from('Original signed content - '+key);media.set(entry.id,content);
  files.set(entry.id,{id:entry.id,mimeType:key==='folder'?'application/vnd.google-apps.folder':key==='summary_pdf_v1'?'application/pdf':key==='answers'?'application/json':'image/jpeg',parents:key==='folder'?['existing-technician-day']:['original-folder'],appProperties:{techcheck_transfer_event_id:event,techcheck_part:key},sha256Checksum:sha(content),size:String(content.length),version:'1',trashed:false});
 }
 const originals=structuredClone([...files]),originalBytes=structuredClone([...media].map(([k,v])=>[k,v.toString('hex')]));
 const admin={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='service_daily_cron_authorized_v1')return {data:args.p_secret==='trusted'};
  assert.equal(name,'techcheck_correction_delivery_v1');
  if(args.p_action==='claim'){
   if(args.p_actor&&args.p_actor!==owner.id)return {error:{code:'42501'}};
   if(claimed||['sent','review'].includes(status))return {data:null};claimed=true;return {data:structuredClone(report)};
  }
  assert.equal(args.p_id,id);assert.equal(args.p_lease,report.lease_token);
  if(args.p_action==='checkpoint'){
   if(options.leaseExpired)return {error:{code:'P0001'}};
   // Exercise persisted jsonb order rather than preserving JavaScript key order.
   Object.assign(report,JSON.parse(JSON.stringify(args.p_data,(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value)));
   if(options.sendingCheckpointTimeout&&args.p_data.email_state==='sending')throw new Error('Synthetic lost checkpoint acknowledgement');
   if(options.sentCheckpointTimeout&&args.p_data.email_state==='sent')throw new Error('Synthetic lost send acknowledgement');
   return {data:{ok:true}};
  }
  if(args.p_action==='finish'){status=args.p_data.status;claimed=false;return {data:{ok:true}};}
  throw new Error('Unexpected RPC action');
 },storage:{from:bucket=>{
  assert.equal(bucket,'techcheck-transfer-evidence');
  return {download:async path=>{calls.push({storage:path});return {data:new Blob([options.photoMismatch?Buffer.from([255,216,1]):photo],{type:'image/jpeg'})};}};
 }}};
 const result=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
 const fetch=async(url,opts={})=>{
  calls.push({url,method:opts.method||'GET',body:typeof opts.body==='string'?opts.body:undefined});
  if(url.includes('oauth2.googleapis.com'))return result({access_token:'synthetic-token'});
  if(url.endsWith('/userinfo'))return result({email:options.wrongGoogleAccount?'wrong@example.invalid':RECIPIENT,email_verified:true});
  if(url.includes('generateIds'))return result({ids:['correction-file-'+(++nextId)]});
  if(url.includes('/messages/send')){if(options.sendTimeout)throw new Error('Synthetic Gmail uncertain result');return result({id:'owner-message-id'});}
  if(opts.method==='POST'){
   let metadata,content=null;
   if(typeof opts.body==='string')metadata=JSON.parse(opts.body);
   else{const bytes=Buffer.from(await opts.body.arrayBuffer()),boundary=opts.headers['Content-Type'].split('boundary=')[1],start=bytes.indexOf('\r\n\r\n')+4,end=bytes.indexOf('\r\n--'+boundary,start);metadata=JSON.parse(bytes.subarray(start,end).toString());const contentStart=bytes.indexOf('\r\n\r\n',end+4)+4,contentEnd=bytes.lastIndexOf('\r\n--'+boundary+'--');content=bytes.subarray(contentStart,contentEnd);}
   assert.ok(!metadata.id.startsWith('original-'),'never create/update any original ID');
   if(files.has(metadata.id))return new Response('{}',{status:409});
   const saved={...metadata,size:content?String(content.length):undefined,sha256Checksum:content?sha(content):undefined,version:'1',trashed:false};files.set(metadata.id,saved);if(content)media.set(metadata.id,content);
   if(options.mutateOriginal&&metadata.mimeType==='application/vnd.google-apps.folder')files.get('original-answers').sha256Checksum='0'.repeat(64);
   if(options.timeoutAfterUpload&&!uploadTimedOut&&metadata.appProperties.techcheck_part===options.timeoutAfterUpload){uploadTimedOut=true;throw new Error('Synthetic upload saved but reply lost');}
   return result(saved);
  }
  assert.equal(opts.method||'GET','GET');
  const fileId=new URL(url).pathname.split('/files/')[1];
  if(url.includes('alt=media'))return new Response(media.get(fileId));
  const file=files.get(fileId);return file?result(options.noSha256?{...file,sha256Checksum:undefined}:file):new Response('{}',{status:404});
 };
 const handler=createCorrectionDeliveryHandler({admin,userClient:{auth:{getUser:async token=>token==='good'?{data:{user:{id:owner.id}}}:token==='service'?{data:{user:{id:service.id}}}:{error:{}}}},env:()=>options.configured===false?undefined:'synthetic-credential',fetch});
 const post=(headers={authorization:'Bearer good'},body={correction_id:id})=>handler(new Request('https://function.invalid',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 return {post,report,calls,files,media,originals,originalBytes,status:()=>status,releaseLease:()=>{claimed=false;}};
}

test('correction delivery requires verified auth, scoped queue permission and fixed request shape',async()=>{
 const f=fixture();assert.equal((await f.post({})).status,401);assert.equal((await f.post({authorization:'Bearer invalid'})).status,401);assert.equal((await f.post({'x-techcheck-cron':'bad'})).status,401);assert.equal((await f.post({authorization:'Bearer good',origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.post(undefined,{correction_id:id,to:'other@example.invalid'})).status,400);
 assert.equal((await f.post({authorization:'Bearer service'})).status,503);assert.equal(f.calls.some(c=>c.url),false);
});

test('archives additive PDF/HTML/JSON/photo inside original package; originals and pending acceptance stay unchanged',async()=>{
 const f=fixture();assert.equal((await (await f.post()).json()).status,'sent');assert.equal(f.status(),'sent');
 assert.deepEqual([...f.files].filter(([id])=>id.startsWith('original-')),f.originals);
 assert.deepEqual([...f.media].filter(([id])=>id.startsWith('original-')).map(([k,v])=>[k,v.toString('hex')]),f.originalBytes);
 const created=[...f.files.values()].filter(x=>!x.id.startsWith('original-'));assert.equal(created.length,5);
 const folder=created.find(x=>x.mimeType==='application/vnd.google-apps.folder');assert.deepEqual(folder.parents,['original-folder']);
 assert.ok(created.filter(x=>x.id!==folder.id).every(x=>x.parents[0]===folder.id));assert.equal(created.some(x=>x.mimeType==='application/vnd.google-apps.document'),false);
 assert.equal(f.report.state,'awaiting_service');assert.equal(f.report.drive_manifest.complete,true);
 assert.equal(f.calls.some(c=>c.name==='techcheck_transfer_delivery_v1'||c.name==='submit_techcheck_transfer_v1'),false);
 for(const file of created.filter(x=>x.id!==folder.id)){assert.equal(file.sha256Checksum,file.appProperties.techcheck_sha256);assert.equal(f.report.drive_manifest[file.appProperties.techcheck_part].readback_sha256,file.sha256Checksum);}
});

test('Owner notification contains before/after, separate actors, timestamps and all links; only James receives it',async()=>{
 const f=fixture();await f.post();const sends=f.calls.filter(c=>c.url?.includes('/messages/send'));assert.equal(sends.length,1);
 const mime=Buffer.from(JSON.parse(sends[0].body).raw,'base64url').toString();assert.match(mime,new RegExp('To: '+RECIPIENT));assert.equal((mime.match(/^To:/gm)||[]).length,1);assert.doesNotMatch(mime,/^(Cc|Bcc):/im);assert.match(mime,/Message-ID: <handoff-correction-/);assert.doesNotMatch(mime,/filename="signature/);
 const html=correctionHtml(f.report,f.report.drive_manifest.links);for(const value of ['Synthetic IT','Synthetic Owner','Synthetic Service','Solar Spotter 001','Solar Spotter 002','Before this correction','After this correction','Technician confirmation time','Correction applied at','Original signed handoff PDF','This correction PDF'])assert.ok(html.includes(value),value);
 assert.match(html,/SIMs listed: None listed/);assert.match(html,/Awaiting Service acceptance when this correction was saved/);assert.doesNotMatch(html,/Signed by Synthetic Owner|accepted by Synthetic Service/);
 const json=JSON.parse(correctionAnswers(f.report,f.report.drive_manifest.links));assert.equal(json.original_unchanged,true);assert.equal(json.service_acceptance_recorded,false);assert.notEqual(json.applied_by.id,json.confirmed_by.id);
 await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('/messages/send')).length,1);assert.equal(f.files.size,9);
});

test('database-shaped unit/tag pair shares one archived photograph without losing either evidence slot',async()=>{
 const f=fixture();f.report.after[0].parts=[{name:'Cable',quantity:0}];await f.post();assert.equal(f.status(),'sent');
 assert.equal(f.calls.filter(c=>c.storage).length,1);assert.equal([...f.files.values()].filter(x=>x.appProperties?.techcheck_correction_id===id&&x.mimeType==='image/jpeg').length,1);
 const audit=JSON.parse(f.media.get(f.report.drive_manifest.answers_json.id).toString());assert.equal(audit.photos.length,2);assert.deepEqual(audit.photos.map(p=>p.kind),['tag','unit']);assert.equal(audit.photos[0].drive_url,audit.photos[1].drive_url);assert.equal(audit.photos[0].sha256,sha(photo));assert.equal(audit.after[0].parts[0].quantity,0);
 const crossed=fixture();crossed.report.after.push(item('003'));crossed.report.photos[1].equipment_key='solar_spotter:003';await crossed.post();assert.equal(crossed.status(),'blocked');assert.equal(crossed.calls.some(c=>c.url),false);
 const duplicate=fixture();duplicate.report.photos[1].kind='tag';await duplicate.post();assert.equal(duplicate.status(),'blocked');assert.equal(duplicate.calls.some(c=>c.url),false);
});

test('saved upload with lost reply resumes with the same IDs and never duplicates original/correction package',async()=>{
 const f=fixture({timeoutAfterUpload:'photo_0'});await f.post();assert.equal(f.status(),'retry');assert.equal(f.calls.some(c=>c.url?.includes('/messages/send')),false);
 const ids=structuredClone(f.report.drive_manifest);await f.post();assert.equal(f.status(),'sent');assert.equal(f.files.size,9);
 for(const key of ['folder','photo_0','summary_pdf_v1','answers_json','report_html'])assert.equal(f.report.drive_manifest[key].id,ids[key].id);
 assert.equal(f.calls.filter(c=>c.url?.includes('/messages/send')).length,1);
});

test('checksum readback fallback verifies actual saved bytes when Drive omits SHA256 metadata',async()=>{
 const f=fixture({noSha256:true});await f.post();assert.equal(f.status(),'sent');assert.equal(f.calls.filter(c=>c.url?.includes('alt=media')).length,4);
});

test('completed correction files are read back on retry and cannot hide changed content',async()=>{
 const f=fixture({timeoutAfterUpload:'report_html'});await f.post();assert.equal(f.status(),'retry');
 const savedPhoto=f.report.drive_manifest.photo_0;assert.equal(savedPhoto.done,true);f.files.get(savedPhoto.id).sha256Checksum='0'.repeat(64);
 await f.post();assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url?.includes('/messages/send')),false);
});

test('unready or mismatched original archives block before creating correction files',async()=>{
 const f=fixture();f.report.original_drive_manifest.complete=false;await f.post();assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url),false);
 const g=fixture();g.files.get('original-summary').appProperties.techcheck_transfer_event_id='wrong-event';await g.post();assert.equal(g.status(),'blocked');assert.equal(g.files.size,4);assert.equal(g.calls.some(c=>c.url?.includes('/messages/send')),false);
});

test('original mutation during archive blocks notification and records no acceptance',async()=>{
 const f=fixture({mutateOriginal:true});await f.post();assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url?.includes('/messages/send')),false);assert.equal(f.report.state,'awaiting_service');
});

test('mismatched evidence bytes, actor path or signature media cannot produce a correction report email',async()=>{
 const f=fixture({photoMismatch:true});await f.post();assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url?.includes('/messages/send')),false);
 const g=fixture();g.report.photos[0].path=g.report.photos[0].path.replace(owner.id,tech.id);await g.post();assert.equal(g.status(),'blocked');assert.equal(g.calls.some(c=>c.url),false);
 const h=fixture();h.report.photos[0].kind='signature';await h.post();assert.equal(h.status(),'blocked');assert.equal(h.calls.some(c=>c.url),false);
});

test('missing connection, wrong Google account and expired queue lease cannot send',async()=>{
 const f=fixture({configured:false});await f.post();assert.equal(f.status(),'blocked');assert.equal(f.calls.some(c=>c.url),false);
 const g=fixture({wrongGoogleAccount:true});await g.post();assert.equal(g.status(),'blocked');assert.equal(g.files.size,4);
 const h=fixture({leaseExpired:true});await h.post();assert.equal(h.status(),'retry');assert.equal(h.files.size,4);assert.equal(h.calls.some(c=>c.url?.includes('/messages/send')),false);
});

test('uncertain Gmail or send-marker acknowledgements stop automatic resend',async()=>{
 for(const options of [{sendTimeout:true},{sendingCheckpointTimeout:true},{sentCheckpointTimeout:true}]){
  const f=fixture(options);await f.post();assert.equal(f.status(),'review');await f.post();assert.equal(f.calls.filter(c=>c.url?.includes('/messages/send')).length,options.sendingCheckpointTimeout?0:1);
 }
});

test('concurrent invocation cannot claim a leased correction twice',async()=>{
 const f=fixture();const results=await Promise.all([f.post(),f.post()]);assert.deepEqual((await Promise.all(results.map(r=>r.json()))).map(r=>r.status).sort(),['pending_or_finished','sent']);assert.equal(f.files.size,9);assert.equal(f.calls.filter(c=>c.url?.includes('/messages/send')).length,1);
});

test('cited/self provenance and safe source links cannot silently impersonate the original technician',()=>{
 const r=syntheticCorrection();assert.equal(correctionRecord(r).applied_by.id,owner.id);
 for(const url of ['javascript:alert(1)','http://drive.google.com/file/d/id','https://drive.google.com.evil.invalid/file/d/id','https://owner@drive.google.com/file/d/id','https://drive.google.com:444/file/d/id'])assert.equal(evidenceSource(url),null);
 const wrong=structuredClone(r);wrong.confirmed_by.id=owner.id;assert.throws(()=>correctionRecord(wrong),/provenance/);
 const self=structuredClone(r);self.mode='self';self.confirmation.mode='self';self.confirmed_by.mode='self';assert.throws(()=>correctionRecord(self),/mode/);self.applied_by=tech;self.actor_id=tech.id;self.confirmation.recorded_by=tech.id;self.confirmation_recorded_by=tech.id;self.evidence_reference=null;self.confirmation.evidence_reference=null;self.technician_reply=null;self.confirmation.technician_reply=null;self.confirmation.statement='I personally verified this corrected equipment and matching photograph.';assert.equal(correctionRecord(self).mode,'self');
 const selfJson=JSON.parse(correctionAnswers(self,sampleLinks));assert.equal(selfJson.confirmation.recorded_by,tech.id);assert.equal(selfJson.confirmation_recorded_by,tech.id);assert.equal(selfJson.confirmation.technician_reply,null);assert.match(correctionHtml(self,sampleLinks),/I personally verified this corrected equipment/);assert.doesNotMatch(correctionHtml(self,sampleLinks),/Open cited technician confirmation/);
 const alias=structuredClone(r);alias.confirmation_recorded_by=tech.id;assert.throws(()=>correctionRecord(alias),/audit/);
 const name=structuredClone(r);name.confirmed_by.name='Wrong technician';assert.throws(()=>correctionRecord(name),/provenance/);
 const injected=structuredClone(r);injected.reason='<script>alert("x")</script> & review';const html=correctionHtml(injected,sampleLinks);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
});

test('long correction PDF retains all before/after units and audit fields without a signature',()=>{
 const r=syntheticCorrection();r.before=Array.from({length:20},(_,n)=>item(String(n).padStart(3,'0')));r.after=Array.from({length:20},(_,n)=>item(String(n+20).padStart(3,'0')));r.reason='A complete recheck confirmed the exact equipment and component counts. '.repeat(20);
 const pdf=new TextDecoder().decode(correctionPdf(r,sampleLinks));assert.ok(pdf.startsWith('%PDF-1.4'));for(const tag of ['000','019','020','039'])assert.match(pdf,new RegExp('Solar Spotter '+tag));assert.match(pdf,/Confirmation supplied by: Synthetic IT/);assert.match(pdf,/Applied by: Synthetic Owner/);assert.match(pdf,/Before this correction - revision 1/);assert.match(pdf,/After this correction - revision 2/);assert.doesNotMatch(pdf,/SIGNED BY|\/Sig|\/Subtype \/Image/);assert.match(pdf,/Page 1 of /);
 assert.match(Buffer.from(correctionRawEmail(r,correctionHtml(r,sampleLinks),correctionPdf(r,sampleLinks)),'base64url').toString(),/application\/pdf/);
});


test('purpose-aware corrections archive replenishment without inventing battery stock or installation acceptance',async()=>{
 const f=fixture();f.report.purpose='truck_replenishment';f.report.purpose_revision=2;f.report.revision=3;
 for(const list of [f.report.before,f.report.after])for(const item of list)Object.assign(item,{battery_count:null,battery_configuration:null,required_battery_count:null});
 assert.equal((await (await f.post()).json()).status,'sent');
 const html=correctionHtml(f.report,f.report.drive_manifest.links),pdf=new TextDecoder().decode(correctionPdf(f.report,f.report.drive_manifest.links));
 for(const output of [html,pdf]){assert.match(output,/Truck replenishment/);assert.match(output,/counted separately in daily truck inventory/);assert.doesNotMatch(output,/Batteries \/ battery boxes: null|Installation package:/);}
 const audit=JSON.parse(f.media.get(f.report.drive_manifest.answers_json.id).toString());
 assert.equal(audit.purpose,'truck_replenishment');assert.equal(audit.purpose_revision,2);assert.equal(audit.before[0].battery_count,null);assert.equal(audit.after[0].battery_count,null);assert.equal(audit.service_acceptance_recorded,false);
 assert.deepEqual([...f.files].filter(([id])=>id.startsWith('original-')),f.originals);
 assert.equal(f.calls.filter(c=>c.url?.includes('/messages/send')).length,1);
});

test('installation correction reports preserve required package details and reject incompatible or missing purpose data',()=>{
 const r=syntheticCorrection(),html=correctionHtml(r,sampleLinks),pdf=new TextDecoder().decode(correctionPdf(r,sampleLinks));
 for(const output of [html,pdf]){assert.match(output,/Installation/);assert.match(output,/4 x 12V 110Ah batteries/);assert.match(output,/agm_4x_12v_110ah/);assert.match(output,/required: 4/);}
 const audit=JSON.parse(correctionAnswers(r,sampleLinks));assert.equal(audit.purpose,'installation');assert.equal(audit.after[0].required_battery_count,4);
 for(const change of [v=>delete v.purpose,v=>v.purpose_revision=v.revision,v=>v.after[0].battery_count=1,v=>v.after[0].battery_configuration='helios_battery_box',v=>v.after[0].required_battery_count=1,v=>{v.purpose='truck_replenishment';}]){
  const invalid=structuredClone(r);change(invalid);assert.throws(()=>correctionRecord(invalid),/provenance/);
 }
});
