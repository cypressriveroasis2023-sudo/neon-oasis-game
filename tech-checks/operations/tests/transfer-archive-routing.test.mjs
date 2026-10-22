import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 ArchiveDestinationBlocked,TECHNICIANS_ROOT,TECHNICIAN_FOLDERS,
 resolveTechnicianArchiveDestination,verifyTechnicianArchiveConnection,
} from '../../supabase/functions/_shared/technicianArchive.ts';
import {createDeliveryHandler as transferHandler} from '../../supabase/functions/techcheck-transfer-delivery/index.ts';
import {createDeliveryHandler as dailyHandler} from '../../supabase/functions/service-daily-delivery/index.ts';
import {RECIPIENT} from '../../supabase/functions/service-daily-delivery/report.ts';

const FOLDER='application/vnd.google-apps.folder';
const actor='00000000-0000-4000-8000-000000000081';
const technician=TECHNICIAN_FOLDERS.find(folder=>folder.name==='Josh Mireles');
const date='2026-10-21';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const folder=(id,name,parent,appProperties={})=>({id,name,mimeType:FOLDER,parents:parent?[parent]:[],trashed:false,appProperties});
const clone=value=>structuredClone(value);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

// Synthetic Drive and a service-only registry contract. Nothing in this file
// calls a network provider, claims a live job or contains a real handoff UUID.
function fixture({enabled=true,contextOverride={},denyRpc=false}={}){
 const files=new Map([[TECHNICIANS_ROOT.id,folder(TECHNICIANS_ROOT.id,TECHNICIANS_ROOT.name)]]);
 for(const tech of TECHNICIAN_FOLDERS)files.set(tech.id,folder(tech.id,tech.name,TECHNICIANS_ROOT.id));
 const jobs=new Map(),registry=new Map(),calls=[],checkpoints=[];
 let sequence=0,loseCreate=null,conflictCreate=null;
 const category=source=>source==='transfer'?'Equipment Transfers':'Truck Inspections';
 const key=(kind,source)=>kind==='date'?'date':category(source);
 const context=job=>({version:1,enabled,ready:enabled,status:enabled?'ready':'disabled',source:job.source,source_id:job.report.id,
  actor_id:actor,actor_name:'Saved synthetic technician',check_date:date,category:category(job.source),
  root_folder:{...TECHNICIANS_ROOT,adopted:true},technician_folder:{...technician,parent_id:TECHNICIANS_ROOT.id,adopted:true},
  date_folder:clone(registry.get('date')||null),category_folder:clone(registry.get(category(job.source))||null),...contextOverride});
 const call=async(name,args)=>{
  calls.push({rpc:name,args:clone(args)});
  if(name!=='techcheck_archive_destination_v1')throw new Error('Unexpected RPC.');
  if(denyRpc)throw new Error('Server access required.');
  const job=jobs.get(args.p_id);
  if(!job||args.p_source!==job.source||args.p_lease!==job.report.lease_token)throw new Error('Invalid source lease.');
  if(args.p_action==='context')return context(job);
  if(args.p_action!=='reserve'||!enabled)throw new Error('Archive routing is awaiting release approval.');
  const p=args.p_data,expectedParent=p.kind==='date'?technician.id:registry.get('date')?.id;
  assert.equal(p.parent_id,expectedParent);assert.deepEqual(Object.keys(p).sort(),['adopted','candidate_id','kind','parent_id']);
  const slotKey=key(p.kind,job.source);
  if(!registry.has(slotKey))registry.set(slotKey,{id:p.candidate_id,parent_id:expectedParent,name:p.kind==='date'?date:category(job.source),adopted:p.adopted});
  return clone(registry.get(slotKey));
 };
 const request=async(input,options={})=>{
  const url=new URL(String(input)),method=options.method||'GET';
  calls.push({url:url.href,method});
  if(url.hostname==='oauth2.googleapis.com')return json({access_token:'synthetic'});
  if(url.pathname==='/v1/userinfo')return json({email:RECIPIENT,email_verified:true});
  if(url.hostname==='gmail.googleapis.com')return json({id:'synthetic-message'});
  if(url.pathname.endsWith('/generateIds'))return json({ids:['reserved-'+(++sequence)]});
  if(method==='GET'&&url.pathname==='/drive/v3/files'){
   const query=url.searchParams.get('q')||'',parent=query.match(/^'([^']+)' in parents/)?.[1],name=query.match(/ and name = '([^']+)'$/)?.[1];
   assert.ok(parent&&name,'Expected a bounded exact parent/name folder query.');
   return json({files:[...files.values()].filter(file=>file.parents?.[0]===parent&&file.name===name&&file.mimeType===FOLDER&&!file.trashed)});
  }
  if(method==='POST'){
   let metadata;
   if(typeof options.body==='string')metadata=JSON.parse(options.body);
   else metadata=JSON.parse((await options.body.text()).split('\r\n\r\n')[1].split('\r\n--')[0]);
   assert.ok(!url.href.includes('/permissions'),'Never change sharing.');
   assert.notEqual(metadata.mimeType,'application/vnd.google-apps.document','Never create link indexes.');
   calls.at(-1).metadata=clone(metadata);
   if(files.has(metadata.id))return json({},409);
   files.set(metadata.id,{...metadata,trashed:false});
   if(loseCreate===metadata.appProperties?.techcheck_archive_kind){loseCreate=null;throw new Error('Synthetic lost create acknowledgement.');}
   if(conflictCreate===metadata.appProperties?.techcheck_archive_kind){conflictCreate=null;return json({},409);}
   return json(metadata);
  }
  const fileId=url.pathname.split('/files/')[1];
  if(method==='GET'&&fileId)return files.has(fileId)?json(files.get(fileId)):json({error:'not found'},404);
  throw new Error('Unexpected provider operation: '+method+' '+url.pathname);
 };
 const job=(source='transfer',n=1,manifest={})=>{
  const report={id:uuid(n),lease_token:uuid(n+100),check_date:date,drive_manifest:manifest};
  const value={source,report,manifest};jobs.set(report.id,value);return value;
 };
 const resolve=value=>resolveTechnicianArchiveDestination({...value,request,auth:{Authorization:'Bearer synthetic'},call,
  checkpoint:async()=>{checkpoints.push({id:value.report.id,manifest:clone(value.manifest)});}});
 const adopt=(kind,id,parent,source='transfer')=>{
  const name=kind==='date'?date:category(source);files.set(id,folder(id,name,parent));
  const slot={id,parent_id:parent,name,adopted:true};registry.set(key(kind,source),slot);return slot;
 };
 const createCalls=()=>calls.filter(entry=>entry.metadata);
 return {files,jobs,registry,calls,checkpoints,job,resolve,call,request,adopt,createCalls,
  loseCreate:kind=>{loseCreate=kind;},conflictCreate:kind=>{conflictCreate=kind;}};
}

test('new transfer and daily destinations share one Central date and use the exact saved technician/category',async()=>{
 const f=fixture(),transfer=f.job(),daily=f.job('daily',2);
 const transferParent=await f.resolve(transfer),dailyParent=await f.resolve(daily);
 assert.notEqual(transferParent,dailyParent);assert.equal(f.registry.size,3);
 const dateFolder=f.registry.get('date');assert.equal(dateFolder.parent_id,technician.id);assert.equal(dateFolder.name,date);
 for(const [job,parent,category] of [[transfer,transferParent,'Equipment Transfers'],[daily,dailyParent,'Truck Inspections']]){
  const saved=f.files.get(parent);assert.equal(saved.name,category);assert.deepEqual(saved.parents,[dateFolder.id]);
  assert.equal(job.manifest.archive_destination.actor_id,actor);assert.equal(job.manifest.archive_destination.package_parent_id,parent);
  assert.equal(job.manifest.archive_destination.check_date,date);assert.ok(f.checkpoints.some(point=>point.id===job.report.id&&point.manifest.archive_destination?.package_parent_id===parent));
 }
 assert.equal(f.createCalls().length,3);assert.equal(f.calls.some(entry=>entry.url?.includes('/permissions')),false);
});

test('unique existing date/category folders are adopted by ID without app markers or duplicate creation',async()=>{
 const f=fixture();f.files.set('existing-date',folder('existing-date',date,technician.id));
 f.files.set('existing-category',folder('existing-category','Equipment Transfers','existing-date'));
 // A descriptive original package is not the canonical category.
 f.files.set('descriptive-original',folder('descriptive-original','Equipment Transfers - Synthetic transfer','existing-date'));
 assert.equal(await f.resolve(f.job()),'existing-category');assert.equal(f.createCalls().length,0);
 assert.equal(f.registry.get('date').adopted,true);assert.equal(f.registry.get('Equipment Transfers').adopted,true);
});

test('duplicate exact date or category names block routing instead of choosing a folder',async()=>{
 for(const kind of ['date','category']){
  const f=fixture(),parent=kind==='date'?technician.id:'existing-date',name=kind==='date'?date:'Equipment Transfers';
  if(kind==='category')f.adopt('date','existing-date',technician.id);
  f.files.set('duplicate-one',folder('duplicate-one',name,parent));f.files.set('duplicate-two',folder('duplicate-two',name,parent));
  await assert.rejects(f.resolve(f.job()),error=>error instanceof ArchiveDestinationBlocked&&/Duplicate/.test(error.message));
  assert.equal(f.createCalls().length,0);assert.equal(f.calls.some(entry=>entry.args?.p_action==='reserve'),false);
 }
});

test('disabled gate, unknown mapping, unauthorized RPC and source lease mismatch cannot create a destination',async()=>{
 for(const options of [{enabled:false},{contextOverride:{ready:false,status:'mapping_required',technician_folder:null}},{denyRpc:true}]){
  const f=fixture(options);await assert.rejects(f.resolve(f.job()));assert.equal(f.createCalls().length,0);
  assert.equal(f.calls.some(entry=>entry.args?.p_action==='reserve'),false);
 }
 const f=fixture(),job=f.job();job.report.lease_token='incorrect';
 // Save the authoritative lease separately to model its server-side check.
 f.jobs.set(job.report.id,{...job,report:{...job.report,lease_token:uuid(101)}});
 await assert.rejects(f.resolve(job),/lease/);assert.equal(f.createCalls().length,0);
});

test('canonical mapping, exact root and saved Central date mismatch stop before creating files',async()=>{
 for(const change of [
  {contextOverride:{technician_folder:{id:'unverified-person',name:'Josh Mireles'}}},
  {contextOverride:{check_date:'2026-10-22'}},
  {contextOverride:{category:'IT Checks'}},
 ]){
  const f=fixture(change);await assert.rejects(f.resolve(f.job()),ArchiveDestinationBlocked);assert.equal(f.createCalls().length,0);
 }
 const f=fixture();f.files.get(technician.id).parents=['wrong-root'];
 await assert.rejects(f.resolve(f.job()),/verified technician archive path/);assert.equal(f.createCalls().length,0);
});

test('an Owner-moved original package resumes its exact ID/current parent without canonical routing or old-root access',async()=>{
 for(const source of ['transfer','daily']){
  const f=fixture({enabled:false,denyRpc:true}),job=f.job(source,source==='transfer'?1:2,{folder:{id:'original-package',done:true}});
  const marker=source==='transfer'?'techcheck_transfer_event_id':'techcheck_report_id';
  f.files.set('original-package',folder('original-package','Owner renamed original','owner-chosen-parent',{[marker]:job.report.id,techcheck_part:'folder'}));
  f.files.delete(TECHNICIANS_ROOT.id);assert.equal(await f.resolve(job),'owner-chosen-parent');
  assert.deepEqual(job.manifest.folder,{id:'original-package',done:true,readback_parent_id:'owner-chosen-parent'});
  assert.equal(f.calls.some(entry=>entry.rpc),false);assert.equal(f.calls.length,1);assert.equal(f.createCalls().length,0);
 }
});

test('missing completed package and mismatched original event identity block without recreation',async()=>{
 for(const mode of ['missing','wrong-event','wrong-type','trashed']){
  const f=fixture(),job=f.job('transfer',1,{folder:{id:'original-package',done:true}});
  if(mode!=='missing'){
   const saved=folder('original-package','Saved original','moved-parent',{techcheck_transfer_event_id:mode==='wrong-event'?uuid(99):job.report.id,techcheck_part:'folder'});
   if(mode==='wrong-type')saved.mimeType='application/vnd.google-apps.document';if(mode==='trashed')saved.trashed=true;
   f.files.set(saved.id,saved);
  }
  await assert.rejects(f.resolve(job),ArchiveDestinationBlocked);assert.equal(f.createCalls().length,0);assert.equal(f.calls.some(entry=>entry.rpc),false);
 }
});

test('reserved uncreated package keeps its ID, and an interrupted canonical create retries the registry winner',async()=>{
 const f=fixture(),job=f.job('transfer',1,{folder:{id:'already-reserved-package'}});f.loseCreate('date');
 await assert.rejects(f.resolve(job),/lost create acknowledgement/);
 const reservedDate=f.registry.get('date').id;assert.ok(f.files.has(reservedDate));assert.equal(job.manifest.folder.id,'already-reserved-package');
 const parent=await f.resolve(job);assert.equal(f.registry.get('date').id,reservedDate);assert.equal(job.manifest.folder.id,'already-reserved-package');
 assert.equal(job.manifest.folder.parent_id,parent);assert.equal(f.createCalls().filter(entry=>entry.metadata.id===reservedDate).length,1);
 const generationCount=f.calls.filter(entry=>entry.url?.includes('generateIds')).length;
 await f.resolve(job);assert.equal(f.calls.filter(entry=>entry.url?.includes('generateIds')).length,generationCount);
 assert.equal(f.createCalls().length,2);
});

test('concurrent jobs converge on one date/category registry identity and 409 readback uses that exact identity',async()=>{
 const f=fixture(),first=f.job('transfer',1),second=f.job('transfer',2);f.conflictCreate('date');
 const parents=await Promise.all([f.resolve(first),f.resolve(second)]);assert.equal(parents[0],parents[1]);assert.equal(f.registry.size,2);
 const creates=f.createCalls();assert.equal(new Set(creates.map(entry=>entry.metadata.id)).size,2);
 assert.equal([...f.files.values()].filter(file=>file.name===date&&file.parents[0]===technician.id).length,1);
 assert.equal([...f.files.values()].filter(file=>file.name==='Equipment Transfers').length,1);
 assert.ok(f.calls.filter(entry=>entry.args?.p_action==='reserve'&&entry.args.p_data.kind==='date').length>=2,'Both new jobs raced before reservation.');
 assert.equal(first.manifest.archive_destination.date_folder_id,second.manifest.archive_destination.date_folder_id);
});

test('missing adopted folders are never recreated, while a pre-reserved new folder requires exact marker readback',async()=>{
 const f=fixture();f.registry.set('date',{id:'missing-adopted',parent_id:technician.id,name:date,adopted:true});
 await assert.rejects(f.resolve(f.job()),/existing date or category folder is missing/);assert.equal(f.createCalls().length,0);
 const g=fixture();g.registry.set('date',{id:'reserved-date',parent_id:technician.id,name:date,adopted:false});
 g.files.set('reserved-date',folder('reserved-date',date,technician.id,{techcheck_archive_kind:'date',techcheck_archive_actor_id:uuid(99),techcheck_archive_date:date}));
 await assert.rejects(g.resolve(g.job()),/readback does not match/);assert.equal(g.createCalls().length,0);
});

test('a manually added same-name folder blocks a reserved date instead of creating a duplicate',async()=>{
 const f=fixture();f.registry.set('date',{id:'reserved-date',parent_id:technician.id,name:date,adopted:false});
 f.files.set('manual-date',folder('manual-date',date,technician.id));
 await assert.rejects(f.resolve(f.job()),/conflicts with the reserved destination/);assert.equal(f.createCalls().length,0);
 assert.equal(f.registry.get('date').id,'reserved-date');
});

test('a pinned package routing decision cannot be silently replaced, even before its package was created',async()=>{
 const f=fixture(),job=f.job('transfer',1,{folder:{id:'reserved-package'}});await f.resolve(job);
 // JSONB key order changes are harmless; values are the immutable contract.
 job.manifest.archive_destination=Object.fromEntries(Object.entries(job.manifest.archive_destination).reverse());
 await f.resolve(job);const count=f.createCalls().length;
 f.registry.set('Equipment Transfers',{id:'different-category',parent_id:f.registry.get('date').id,name:'Equipment Transfers',adopted:false});
 await assert.rejects(f.resolve(job),/Saved package destination changed/);assert.equal(f.createCalls().length,count);assert.equal(f.files.has('different-category'),false);
});

test('connection probe reads the exact root and all four technician folders, without a job or write',async()=>{
 const f=fixture();assert.deepEqual(await verifyTechnicianArchiveConnection({request:f.request,auth:{}}),{root_id:TECHNICIANS_ROOT.id,technician_folders_verified:4});
 assert.equal(f.calls.length,5);assert.equal(f.calls.every(entry=>entry.method==='GET'),true);assert.equal(f.registry.size,0);
 f.files.get(TECHNICIAN_FOLDERS[0].id).name='Wrong name';
 await assert.rejects(verifyTechnicianArchiveConnection({request:f.request,auth:{}}),/technician archive folder/);
});

function workerFixture(source,{enabled=false,missing=false}={}){
 const f=fixture({enabled}),job=f.job(source),marker=source==='transfer'?'techcheck_transfer_event_id':'techcheck_report_id';
 const report=Object.assign(job.report,{kind:'checkout',actor_name:'Saved synthetic technician',submitted_at:'2026-10-21T16:39:33Z',
  photos:[],email_state:'sent',email_id:'existing-message',snapshot:{actual:[],expected:[],state:'awaiting_service',revision:1,it_name:'Synthetic IT',service_name:'Synthetic Service',
   truck_checks:{},taking_trailer:false,inventory:{units:[],sims:[],stock:{}},signature:{method:'typed',name:'Synthetic signer',signed_at:'2026-10-21T16:39:33Z',statement:'Synthetic saved sign-off.'}}});
 const parts={folder:'package',report:'html',answers:'json',summary_pdf_v1:'pdf'};
 for(const [part,id] of Object.entries(parts))job.manifest[part]={id:'existing-'+id,done:true};
 job.manifest.complete=true;
 if(!missing)f.files.set('existing-package',folder('existing-package','Original saved package','moved-category',{[marker]:report.id,techcheck_part:'folder'}));
 let status='processing';
 const admin={rpc:async(name,args)=>{
  if(name==='techcheck_archive_destination_v1')return {data:await f.call(name,args)};
  f.calls.push({rpc:name,args:clone(args)});
  if(args.p_action==='claim')return {data:clone(report)};
  if(args.p_action==='checkpoint'){Object.assign(report,clone(args.p_data));return {data:{ok:true}};}
  if(args.p_action==='finish'){status=args.p_data.status;return {data:{ok:true}};}
  throw new Error('Unexpected queue action.');
 },storage:{from:()=>({download:async()=>{throw new Error('No evidence download expected.');}})}};
 const handler=(source==='transfer'?transferHandler:dailyHandler)({admin,userClient:{auth:{getUser:async()=>({data:{user:{id:actor}}})}},env:()=> 'synthetic-config',fetch:f.request});
 const post=()=>handler(new Request('https://function.example',{method:'POST',headers:{authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({report_id:report.id})}));
 return {...f,job,report,post,status:()=>status};
}

test('both original workers resume a moved completed archive with original email ID and no file or email writes',async()=>{
 for(const source of ['transfer','daily']){
  const f=workerFixture(source);assert.equal((await (await f.post()).json()).status,'sent');
  assert.equal(f.status(),'sent');assert.equal(f.report.email_id,'existing-message');assert.equal(f.report.drive_manifest.folder.id,'existing-package');
  assert.equal(f.createCalls().length,0);assert.equal(f.calls.some(entry=>entry.url?.includes('messages/send')),false);
  assert.equal(f.calls.some(entry=>entry.rpc==='techcheck_archive_destination_v1'),false);
  assert.equal(f.report.drive_manifest.folder.readback_parent_id,'moved-category');
 }
});

test('both workers persist routing review blocks without recreating a missing completed original',async()=>{
 for(const source of ['transfer','daily']){
  const f=workerFixture(source,{missing:true});assert.equal((await (await f.post()).json()).status,'blocked');
  assert.equal(f.status(),'blocked');assert.equal(f.report.email_id,'existing-message');assert.equal(f.createCalls().length,0);
  assert.equal(f.calls.some(entry=>entry.url?.includes('messages/send')),false);
 }
});
