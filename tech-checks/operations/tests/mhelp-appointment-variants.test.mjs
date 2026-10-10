import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTicketReader,projectMhelpTicketPreview} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {MHELP_APPOINTMENT_FIELDS,describeMhelpAppointments} from '../../supabase/functions/cos-operations-pages/mhelpAppointments.ts';
import {MHELP_APPOINTMENT_VARIANTS as capability,MHELP_APPOINTMENT_VARIANT_FIELDS,MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS,MHELP_APPOINTMENT_ENVELOPE_KEYS,MHELP_APPOINTMENT_USER_FIELDS,describeMhelpAppointmentVariants as describe,projectMhelpAppointmentVariants as project,unavailableMhelpAppointmentVariants} from '../../supabase/functions/cos-operations-pages/mhelpAppointmentVariants.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
const secret='synthetic-private-do-not-export',window={createdAfter:'2026-10-09T05:00:00.000Z',createdBefore:'2026-10-10T05:00:00.000Z'},selected={ticketId:'781234',portalId:'224643',deleted:false};
const ticket=(extra={})=>({portalId:224643,ticketId:781234,ticketNumber:891234,typeId:12,typeName:'Pickup',statusId:1,customStatusId:null,deleted:false,creationDate:'2026-10-09T12:00:00Z',lastModDate:'2026-10-09T13:00:00Z',customerId:671234,serviceLocationId:561234,assignedTo:null,subject:secret,summary:secret,comment:secret,...extra});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture({source={totalResults:5,results:Array.from({length:5},()=>({id:991234,ticketId:781234,portalId:224643,userId:secret,startUtc:'2026-10-11T12:00:00Z',endUtc:'2026-10-11T13:00:00Z'}))},rows=[ticket()],detail=rows[0],fetcher}={}){
 const calls=[];let configReads=0;
 const reader=createMhelpTicketReader({getConfig:async()=>{configReads++;return {portalId:selected.portalId,accessToken:secret};},fetch:async(url,init)=>{
  calls.push({url,init});const replacement=await fetcher?.(url,init);if(replacement)return replacement;
  if(url.endsWith('/users/me'))return json({portalId:224643});
  if(url.endsWith('/tickettypes'))return json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Pickup',isActive:true}]});
  if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:'Open',displayText:'Open',parentId:null,canBeParent:true}]);
  if(url.includes('/Tickets/'))return json(detail);
  if(url.includes('/Tickets?')){const start=Number(new URL(url).searchParams.get('rowIndex'));return json({totalRows:rows.length,results:rows.slice(start,start+50)});}
  if(url.includes('/Appointments?'))return json(source);throw Error('Unexpected synthetic read');
 }});return {...reader,calls,configReads:()=>configReads};
}
const evidence=(source={totalResults:0,results:[]})=>describe(source,selected,window.createdAfter);
function privateFree(value){assert.doesNotMatch(JSON.stringify(value),/synthetic-private|991234|781234|224643|671234|secret@example|deadbeef|2026-10-11T|Subject|apiKey|customFields|customerName/);}

test('new capability sends exactly one fixed projected GET with every reviewed spelling, never more source reads',async()=>{
 const f=fixture(),value=await f.preview(window,capability),e=value.appointmentEvidence,url=new URL(f.calls.at(-1).url);
 assert.equal(f.calls.length,6);assert.equal(f.configReads(),1);assert.equal(f.calls.filter(c=>c.url.includes('/Appointments?')).length,1);assert.match(f.calls.at(-2).url,/\/Tickets\/781234$/);
 assert.equal(url.pathname,'/api/v1.0/portal/224643/Appointments');assert.deepEqual(Object.fromEntries(url.searchParams),{startDateUtc:'2026-10-09T05:00:00.000Z',endDateUtc:'2026-10-16T05:00:00.000Z',pageSize:'500',sort:'StartUtc',fields:MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS.join(',')});
 assert.equal(MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS.length,53);assert.equal(new Set(MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS).size,53);
 assert.deepEqual(Object.keys(e.fields),[...MHELP_APPOINTMENT_FIELDS]);assert.deepEqual(Object.keys(e.diagnostics.fields),[...MHELP_APPOINTMENT_VARIANT_FIELDS]);assert.deepEqual(Object.keys(e.diagnostics.envelope),[...MHELP_APPOINTMENT_ENVELOPE_KEYS]);
 assert.equal(e.sampledAppointments,5);assert.equal(e.diagnostics.fields.ticketId.kinds.integer,5);assert.equal(e.diagnostics.fields.startUtc.formats.iso_with_zone,5);assert.equal(e.exactMatchCount,0);assert.equal(e.unverifiedLinkageCount,5);assert.equal(e.completeness,'unverified');assert.equal(e.linkage,'unverified');assert.equal(e.diagnostics.envelope.totalResults.integerCount,5);assert.deepEqual(projectMhelpTicketPreview(value,capability),value);privateFree(e);
 for(const c of f.calls){assert.equal(c.init.method,'GET');assert.equal(c.init.redirect,'error');assert.equal(c.init.cache,'no-store');}
});
test('all four old capabilities preserve exact DTOs, fields projection and request counts',async()=>{
 for(const old of [undefined,'operational_structure_v1','ticket_detail_structure_v1','appointment_structure_v1']){
  const f=fixture(),value=await f.preview(window,old);assert.equal(f.calls.length,old==='appointment_structure_v1'?6:old==='ticket_detail_structure_v1'?5:4);
  if(old==='appointment_structure_v1'){assert.deepEqual(value.appointmentEvidence,describeMhelpAppointments({totalResults:5,results:Array.from({length:5},()=>({id:991234,ticketId:781234,portalId:224643,userId:secret,startUtc:'2026-10-11T12:00:00Z',endUtc:'2026-10-11T13:00:00Z'}))},selected,window.createdAfter));assert.equal(new URL(f.calls.at(-1).url).searchParams.get('fields'),MHELP_APPOINTMENT_FIELDS.join(','));assert(!Object.hasOwn(value.appointmentEvidence,'diagnostics'));}
  assert.deepEqual(projectMhelpTicketPreview(value,old),value);
 }
 const value=await fixture().preview(window,capability);assert.throws(()=>projectMhelpTicketPreview(value,'appointment_structure_v1'));assert.throws(()=>projectMhelpTicketPreview(legacyPreview(),capability));
 function legacyPreview(){return {...value,appointmentEvidence:describeMhelpAppointments({TotalRows:0,results:[]},selected,window.createdAfter)};}
});
test('zero and multiple source selections skip both detail and appointment reads under the new capability',async()=>{
 for(const count of [0,2,51,500]){
  const f=fixture({rows:Array.from({length:count},(_,i)=>ticket({ticketId:781234+i,ticketNumber:891234+i}))}),v=await f.preview(window,capability);
  assert(!f.calls.some(c=>c.url.includes('/Appointments?')||c.url.includes('/Tickets/')));assert.deepEqual(v.appointmentEvidence,unavailableMhelpAppointmentVariants(count,window.createdAfter));assert(!Object.hasOwn(v.appointmentEvidence,'diagnostics'));
 }
 assert.throws(()=>unavailableMhelpAppointmentVariants(1,window.createdAfter));
});
test('singleton verification and all caller scope overrides fail before appointment access',async()=>{
 for(const detail of [ticket({portalId:8}),ticket({ticketId:8}),ticket({lastModDate:'2026-10-09T16:00:00Z'}),{data:ticket()}]){const f=fixture({detail});await assert.rejects(f.preview(window,capability));assert(!f.calls.some(c=>c.url.includes('/Appointments?')));}
 for(const extra of [{fields:['subject']},{ticketId:'781234'},{portalId:'224643'},{url:'https://invalid.test'},{startDateUtc:window.createdAfter},{rowIndex:0},{pageSize:500},{scope:'all'}]){const f=fixture();await assert.rejects(f.preview({...window,...extra},capability),e=>e.status===400);assert.equal(f.configReads(),0);assert.equal(f.calls.length,0);}
});
test('envelope diagnostic exposes exact fixed kinds and counts but never promotes malformed or conflicting totals',()=>{
 for(const source of [
  {totalRows:5,results:[{}]},{totalResults:5,results:[{}]},{TotalRows:1,results:[{}]},{TotalRows:1,totalRows:1,totalResults:1,TotalResults:1,results:[{}]},
  {TotalRows:1,totalRows:2,results:[{}]},{TotalRows:'1',totalResults:-1,results:[{}]},{TotalRows:1.5,totalResults:1000001,results:[{}]},
  {TotalRows:NaN,totalRows:Infinity,results:[{}]},{TotalRows:0,Results:[{}]},{TotalResults:1,Data:[{}]},[],null,'private'
 ]){
  const value=evidence(source);assert.equal(value.completeness,'unverified');assert.equal(value.linkage,'unverified');assert.equal(value.diagnostics.contractState,'unresolved');assert.deepEqual(project(value,1,window.createdAfter),value);privateFree(value);
 }
 for(const key of MHELP_APPOINTMENT_ENVELOPE_KEYS){const counter=/total/i.test(key),v=evidence({[key]:counter?7:[{},{}]});assert.equal(v.diagnostics.envelope[key].kind,counter?'integer':'array');assert.equal(v.diagnostics.envelope[key][counter?'integerCount':'arrayEntries'],counter?7:2);}
 for(const raw of [-1,1.5,'7',1000001,Infinity,NaN,null,{},[]])assert.equal(evidence({totalRows:raw}).diagnostics.envelope.totalRows.integerCount,null);
});
test('root/row kinds, empty projection, suppressed names and user-reference formats are bounded structural counts only',()=>{
 const rows=[{},null,[],{customerName:secret,customFields:{userDefinedKey:secret},apiKey:secret,UserId:'123',UserID:'deadbeef-0000-0000-0000-000000000000',userId:'secret@example.test',userID:'bad-reference'},...Array.from({length:2},()=>({id:991234}))];
 const v=evidence({totalResults:rows.length,results:rows,[secret]:secret}),d=v.diagnostics;
 assert.deepEqual(d.rowKinds,{object:4,null:1,array:1});assert.equal(d.emptyObjectRows,1);assert.equal(d.suppressedEnvelopeKeys,1);assert.equal(d.suppressedRowKeys,3);
 assert.deepEqual(d.userReferenceFormats,{UserId:{numeric:1},UserID:{uuid_like:1},userId:{email_like:1},userID:{other:1}});assert.equal(evidence([{},{}]).diagnostics.rootArrayEntries,2);privateFree(v);
 for(const key of MHELP_APPOINTMENT_USER_FIELDS){const data=evidence({results:[{[key]:' '},{[key]:12},{[key]:'bad@'},{[key]:'001'},{[key]:'deadbeef-0000-0000-0000-000000000000'}]});assert.deepEqual(data.diagnostics.userReferenceFormats[key],{other:2,numeric:1,uuid_like:1});}
});
test('every variant includes complete fixed distributions; worst-case 500-row DTO stays below unchanged 16 KiB cap',()=>{
 const values=[undefined,null,true,1,1.5,'123','2026-10-11T12:00:00Z','2026-10-11T12:00:00','/Date(123456)/',secret,' ',[],{},BigInt(1),'deadbeef-0000-0000-0000-000000000000','secret@example.test'];
 const rows=Array.from({length:500},(_,i)=>Object.fromEntries(MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS.map((key,j)=>[key,values[(i+j)%values.length]])));
 const v=evidence({TotalRows:500,results:rows});assert.deepEqual(project(v,1,window.createdAfter),v);assert(Buffer.byteLength(JSON.stringify(v))<16000);privateFree(v);
 for(const key of MHELP_APPOINTMENT_VARIANT_FIELDS){const f=v.diagnostics.fields[key];assert.equal(Object.values(f.kinds).reduce((a,b)=>a+b),500);assert.equal(Object.values(f.formats).reduce((a,b)=>a+b),f.kinds.string);}
 for(const source of [{results:[...rows,{}]},{Results:[...rows,{}]},{data:[...rows,{}]},{Data:[...rows,{}]},[...rows,{}]])assert.throws(()=>evidence(source),/oversized appointment page/);
});
test('full nested allowlists reject extra/removed keys and impossible or forged diagnostic states',()=>{
 const original=evidence({TotalRows:1,results:[{id:991234,userId:secret}]}),paths=[];
 const walk=(v,path=[])=>{if(v&&typeof v==='object'){paths.push(path);for(const [key,next] of Object.entries(v))walk(next,[...path,key]);}};walk(original);
 for(const path of paths){const v=structuredClone(original);path.reduce((r,k)=>r[k],v)[secret]=secret;assert.throws(()=>project(v,1,window.createdAfter));}
 for(const path of [[],['diagnostics'],['diagnostics','fields'],['diagnostics','fields','userId'],['diagnostics','envelope'],['diagnostics','envelope','results'],['diagnostics','userReferenceFormats']]){
  for(const key of Object.keys(path.reduce((r,k)=>r[k],original))){const v=structuredClone(original);delete path.reduce((r,k)=>r[k],v)[key];assert.throws(()=>project(v,1,window.createdAfter),path+'.'+key);}
 }
 for(const change of [
  v=>v.completeness='complete',v=>v.linkage='single_structural_match',v=>v.diagnostics.contractState='verified',v=>v.diagnostics.envelope.results.arrayEntries=2,
  v=>v.diagnostics.envelope.totalRows.integerCount=1,v=>v.diagnostics.envelope.totalRows.arrayEntries=0,v=>v.diagnostics.envelope.results.integerCount=1,v=>v.diagnostics.rootArrayEntries=0,
  v=>v.diagnostics.rowKinds={object:2},v=>v.diagnostics.emptyObjectRows=1,v=>v.diagnostics.suppressedEnvelopeKeys=-1,v=>v.diagnostics.suppressedRowKeys=1000001,
  v=>v.diagnostics.fields.userId.kinds.string=2,v=>v.diagnostics.fields.userId.formats.other=2,v=>v.diagnostics.userReferenceFormats.userId.other=2,
  v=>v.diagnostics.fields.userId.nonemptyStrings=0,v=>v.diagnostics.envelope.TotalRows.integerCount=null,v=>v.diagnostics.extra='x'.repeat(16001)
 ]){const v=structuredClone(original);change(v);assert.throws(()=>project(v,1,window.createdAfter));}
});
test('new capability keeps shared byte and deadline limits, sanitized failures and overlap release',async(t)=>{
 for(const response of [()=>new Response('x'.repeat(1048577)),()=>new Response('{}',{headers:{'Content-Length':'1048577'}}),()=>new Response(Uint8Array.of(0xff)),()=>json({[secret]:secret},403)]){
  const f=fixture({fetcher:url=>url.includes('/Appointments?')?response():undefined});await assert.rejects(f.preview(window,capability),e=>{privateFree(mhelpTicketDiagnostic(e));return true;});assert.equal(f.calls.length,6);
 }
 const padding='x'.repeat(800000),oversized=fixture({rows:[ticket({ignored:padding})],detail:ticket({ignored:padding}),source:{results:[{}],ignored:padding},fetcher:url=>url.endsWith('/tickettypes')?json({totalRows:1,results:[{portalId:224643,typeId:12,typeName:'Pickup',isActive:true}],ignored:padding}):undefined});
 await assert.rejects(oversized.preview(window,capability),/oversized ticket response/);assert.equal(oversized.calls.length,6);
 t.mock.timers.enable({apis:['setTimeout']});let ready,active=true;const started=new Promise(resolve=>{ready=resolve;}),f=fixture({fetcher:url=>url.includes('/Appointments?')&&active?new Promise(()=>ready()):undefined});
 const pending=f.preview(window,capability);await started;await assert.rejects(f.preview(window,capability),e=>e.status===409);const rejected=assert.rejects(pending,e=>mhelpTicketDiagnostic(e).error==='MHELP_PREVIEW_DEADLINE');t.mock.timers.tick(20001);await rejected;active=false;assert.equal((await f.preview(window,capability)).appointmentEvidence.contract,'cos-mhelpdesk-appointment-evidence-v2');
});

test('all sixteen exact candidate pairs compare only numeric IDs and conflicts remain explicitly unresolved',()=>{
 const ticketKeys=['TicketId','TicketID','ticketId','ticketID'],portalKeys=['PortalId','PortalID','portalId','portalID'];
 for(let t=0;t<4;t++)for(let p=0;p<4;p++){
  const index=t*4+p,row={[ticketKeys[t]]:781234,[portalKeys[p]]:224643},v=evidence({TotalRows:1,results:[row]}),pairs=v.diagnostics.candidatePairs;
  assert.deepEqual(pairs.comparable,Array.from({length:16},(_,i)=>i===index?1:0));assert.deepEqual(pairs.matching,pairs.comparable);assert.equal(pairs.ticketAliasConflicts,0);assert.equal(pairs.portalAliasConflicts,0);assert.equal(v.linkage,'unverified');assert.equal(v.schedule,'unverified_candidate_contract');
  for(const change of [{[ticketKeys[t]]:'781234'},{[portalKeys[p]]:'224643'},{[ticketKeys[t]]:0},{[portalKeys[p]]:-1},{[ticketKeys[t]]:1.5},{[ticketKeys[t]]:{id:781234}},{[ticketKeys[t]]:null}]){
   const bad=evidence({results:[{...row,...change}]}).diagnostics.candidatePairs;assert.equal(bad.comparable[index],0);assert.equal(bad.matching[index],0);
  }
  for(const change of [{[ticketKeys[t]]:781235},{[portalKeys[p]]:8}]){const other=evidence({results:[{...row,...change}]}).diagnostics.candidatePairs;assert.equal(other.comparable[index],1);assert.equal(other.matching[index],0);}
 }
 const aliases={TicketId:781234,ticketId:781235,TicketID:'781234',PortalId:224643,portalId:8},v=evidence({TotalRows:1,results:[aliases]}),pairs=v.diagnostics.candidatePairs;
 assert.equal(pairs.matching[0],1);assert.equal(pairs.matching[8],0);assert.equal(pairs.ticketAliasConflicts,1);assert.equal(pairs.portalAliasConflicts,1);assert.equal(v.linkage,'unverified');privateFree(v);
 for(const mutate of [d=>d.matching[0]=2,d=>d.comparable[0]=0,d=>d.matching[1]=1,d=>d.comparable.pop(),d=>d.matching.push(0),d=>d.ticketAliasConflicts=2,d=>d.portalAliasConflicts=-1,d=>d.raw=secret]){const copy=structuredClone(v);mutate(copy.diagnostics.candidatePairs);assert.throws(()=>project(copy,1,window.createdAfter));}
 const single=evidence({results:[{ticketId:781234,portalId:224643}]});single.diagnostics.candidatePairs.ticketAliasConflicts=1;assert.throws(()=>project(single,1,window.createdAfter));
});

test('candidate arrays reject sparse index replacement and unknown properties',()=>{
 const value=evidence({results:[{ticketId:781234,portalId:224643}]});delete value.diagnostics.candidatePairs.matching[0];value.diagnostics.candidatePairs.matching.raw=secret;assert.throws(()=>project(value,1,window.createdAfter));
});
