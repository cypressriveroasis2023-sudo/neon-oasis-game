import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {deliverTransfer} from '../../supabase/functions/service-daily-delivery/transfer-delivery.ts';
import {createDeliveryHandler} from '../../supabase/functions/service-daily-delivery/index.ts';
import {RECIPIENT,DRIVE_FOLDER} from '../../supabase/functions/service-daily-delivery/report.ts';
import {deliveryFixture,signatureJpeg} from './helpers/transfer-delivery-fixture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(options={}){
 const d=deliveryFixture({kind:options.kind||'receipt',drawn:true});
 for(const event of d.events){for(const p of event.photos)p.path=event.actor_id+'/'+event.id+'/'+sha(signatureJpeg)+'.jpg';event.snapshot.signature.path=event.photos.find(p=>p.kind==='signature').path;}
 const json=JSON.stringify(d),row={event_id:d.event_id,transfer_id:d.transfer_id,snapshot_text:json,snapshot_sha256:sha(json),delivery_snapshot:d,drive_manifest:{parts:{}},email_state:'pending',lease_token:randomUUID()};
 const calls=[],files=new Map();let status='queued',number=0,uploadLost=false;
 const admin={rpc:async(name,args)=>{
  calls.push({rpc:name,args:structuredClone(args)});
  if(name==='service_daily_cron_authorized_v1')return {data:args.p_secret==='trusted'};
  if(name==='service_daily_delivery_v1')return {data:null};
  if(args.p_action==='claim')return {data:['sent','review'].includes(status)?null:structuredClone(row)};
  if(args.p_action==='checkpoint'){Object.assign(row,structuredClone(args.p_data));return {data:{ok:true}};}
  if(args.p_action==='finish'){status=args.p_data.status;return {data:{ok:true}};}
 },storage:{from:bucket=>({download:async path=>{
  assert.equal(bucket,'techcheck-transfer-evidence');assert.ok(d.events.some(e=>e.photos.some(p=>p.path===path)));
  calls.push({download:path});return {data:new Blob([options.corruptImage?'bad':signatureJpeg],{type:'image/jpeg'})};
 }})}};
 const result=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const request=async(url,opts={})=>{
  calls.push({url,method:opts.method||'GET'});
  if(url.includes('oauth2.googleapis.com'))return result({access_token:'synthetic-token'});
  if(url.endsWith('/userinfo'))return result({email:options.wrongOwner?'wrong@example.invalid':RECIPIENT,email_verified:true});
  if(url.includes('generateIds'))return result({ids:['provider_'+(++number)]});
  if(url.includes('messages/send')){calls.push({email:JSON.parse(opts.body).raw});if(options.sendTimeout)throw Error('secret provider body must not escape');return result(options.noEmailId?{}:{id:'confirmed_message'});}
  if(url.includes('/files/'+DRIVE_FOLDER+'?'))return result({id:DRIVE_FOLDER,mimeType:'application/vnd.google-apps.folder',trashed:false});
  if(opts.method==='POST'){
   let metadata,bytes;
   if(typeof opts.body==='string')metadata=JSON.parse(opts.body);
   else{
    const body=Buffer.from(await opts.body.arrayBuffer()),boundary=opts.headers['Content-Type'].split('boundary=')[1],text=body.toString('latin1');
    const chunks=text.split('\r\n\r\n');metadata=JSON.parse(chunks[1].split('\r\n--')[0]);
    const start=text.indexOf('\r\n\r\n',text.indexOf('\r\n--'+boundary))+4;bytes=body.subarray(start,text.lastIndexOf('\r\n--'+boundary+'--'));
   }
   if(files.has(metadata.id))return new Response('{}',{status:409});
   files.set(metadata.id,{...metadata,bytes,sha256Checksum:bytes?sha(bytes):undefined});
   if(options.loseUpload&&!uploadLost&&metadata.mimeType==='image/jpeg'){uploadLost=true;throw Error('Synthetic response lost after upload');}
   return result({id:metadata.id});
  }
  const id=url.split('/files/')[1]?.split('?')[0],file=files.get(id);assert.ok(file,'Known provider file');
  if(url.includes('alt=media'))return new Response(file.bytes);
  return result({...file,bytes:undefined,sha256Checksum:options.badArchiveHash?'f'.repeat(64):options.noChecksum?undefined:file.sha256Checksum,appProperties:options.wrongArchiveIdentity?{...file.appProperties,techcheck_event_id:randomUUID()}:file.appProperties});
 };
 const env=()=>options.unconfigured?undefined:'synthetic-credential';
 const run=()=>deliverTransfer({admin,env,request,eventId:d.event_id,actor:d.service_actor});
 const handler=createDeliveryHandler({admin,env,fetch:request,userClient:{auth:{getUser:async token=>token==='good'?{data:{user:{id:d.service_actor}}}:{error:{}}}}});
 const post=(body={transfer_event_id:d.event_id},headers={authorization:'Bearer good'})=>handler(new Request('https://function.invalid',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
 return {d,row,calls,files,run,post,status:()=>status};
}
test('immutable checkout and receipt archives verify content and linked signatures before one email',async()=>{
 const f=fixture();assert.equal((await f.run()).status,'sent');assert.equal(f.status(),'sent');assert.equal(f.files.size,8);
 const firstSend=f.calls.findIndex(c=>c.url?.includes('messages/send')),complete=f.calls.findIndex(c=>c.args?.p_data?.drive_manifest?.complete);assert.ok(complete>0&&complete<firstSend);
 const archived=[...f.files.values()].find(v=>v.mimeType==='application/json');assert.equal(archived.bytes.toString(),f.row.snapshot_text);
 const pdf=[...f.files.values()].find(v=>v.mimeType==='application/pdf').bytes.toString();assert.equal((pdf.match(/\/Subtype \/Image/g)||[]).length,2);
 assert.equal(f.row.email_id,'confirmed_message');await f.run();assert.equal(f.calls.filter(c=>c.email).length,1);
});
test('lost Drive response resumes same persisted provider IDs and verifies 409 before sending',async()=>{
 const f=fixture({loseUpload:true});assert.equal((await f.run()).status,'pending');const reserved=f.row.drive_manifest.parts.photo_0.id;assert.equal(f.calls.filter(c=>c.email).length,0);
 assert.equal((await f.run()).status,'sent');assert.equal(f.row.drive_manifest.parts.photo_0.id,reserved);assert.equal(f.files.size,8);assert.equal(f.calls.filter(c=>c.email).length,1);
});
test('missing provider checksum falls back to reading and hashing actual archived bytes',async()=>{
 const f=fixture({noChecksum:true});assert.equal((await f.run()).status,'sent');assert.equal(f.calls.filter(c=>c.url?.includes('alt=media')).length,7);
});
test('corrupt evidence, wrong archive content or foreign file identity never send email',async()=>{
 for(const option of ['corruptImage','badArchiveHash','wrongArchiveIdentity']){const f=fixture({[option]:true});assert.equal((await f.run()).status,'pending',option);assert.equal(f.calls.filter(c=>c.email).length,0);assert.equal(f.status(),'retry');}
 const f=fixture();f.row.snapshot_text+=' ';assert.equal((await f.run()).status,'pending');assert.equal(f.calls.some(c=>c.url),false);
});
test('missing connection or wrong sender account blocks delivery without provider writes',async()=>{
 for(const option of ['unconfigured','wrongOwner']){const f=fixture({[option]:true});assert.equal((await f.run()).status,'blocked');assert.equal(f.files.size,0);assert.equal(f.calls.filter(c=>c.email).length,0);}
});
test('ambiguous send or missing provider receipt holds for review and never resends',async()=>{
 for(const option of ['sendTimeout','noEmailId']){const f=fixture({[option]:true});assert.equal((await f.run()).status,'review');assert.equal(f.status(),'review');assert.equal(f.row.email_state,'sending');await f.run();assert.equal(f.calls.filter(c=>c.email).length,1);}
 const f=fixture();f.row.email_state='sending';assert.equal((await f.run()).status,'review');assert.equal(f.calls.some(c=>c.url),false);
});
test('shared endpoint authenticates handoff requests and rejects ambiguous routing or bad origins',async()=>{
 const f=fixture();assert.equal((await f.post(undefined,{})).status,401);assert.equal((await f.post(undefined,{authorization:'Bearer good',origin:'https://evil.invalid'})).status,403);
 assert.equal((await f.post({transfer_event_id:f.d.event_id,report_id:f.d.transfer_id})).status,400);assert.equal((await f.post(null)).status,400);assert.equal((await f.post({transfer_event_id:'not-an-id'})).status,400);
 assert.equal(f.calls.some(c=>c.args?.p_action==='claim'),false);assert.equal((await (await f.post()).json()).status,'sent');
});
test('authenticated scheduler drains handoff queue when no daily report is pending',async()=>{
 const f=fixture();assert.equal((await (await f.post({}, {'x-techcheck-cron':'trusted'})).json()).status,'sent');
 const claim=f.calls.find(c=>c.rpc==='techcheck_transfer_delivery_v3'&&c.args.p_action==='claim');assert.equal(claim.args.p_actor,null);assert.equal(claim.args.p_id,null);
});
