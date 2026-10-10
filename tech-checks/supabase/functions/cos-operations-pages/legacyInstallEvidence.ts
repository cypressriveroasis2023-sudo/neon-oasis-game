/** Saved legacy evidence only. This projector never changes jobs, equipment, maps or billing. */
type Row = Record<string, any>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEGACY_INSTALL_CONTRACT='cos.legacy-install-evidence.v1';
export const LEGACY_INSTALL_LIMIT=10;
export const HELIOS_FIELD_CHECKS=[
  ['helios_field_box_mounted_ok','Box mounted'],['helios_field_pv_connected_ok','PV connected'],
  ['helios_field_ptz_secured_ok','PTZ secured'],['helios_field_switch_pv_ok','Switch on PV'],
  ['helios_field_unit_battery_on_ok','Unit and battery on'],['helios_field_it_online_verified_ok','IT verified online'],
  ['helios_field_cameras_aimed_ok','Cameras aimed and focused'],['helios_field_recording_ok','Recording verified'],
  ['helios_field_tower_20ft_ok','Tower height checked'],['helios_field_mast_lock_bolt_ok','Mast locking bolt secured'],
  ['helios_field_panel_45deg_ok','Panel angle checked'],['helios_field_panel_bolt_ok','Panel bolt secured'],
  ['helios_field_4_sandbags_ok','Four sandbags'],
] as const;
export class LegacyInstallEvidenceError extends Error {
  constructor(public readonly status=503){super(status===403?'Your Owner evidence access could not be verified.':'Legacy installation evidence could not be verified. Refresh to try again.');}
}
const fail=():never=>{throw new LegacyInstallEvidenceError();};
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
function rows(value:unknown,max:number):Row[]{
  if(!Array.isArray(value)||value.length>max||Array.from(value).some(row=>!object(row)))fail();
  return value as Row[];
}
function id(value:unknown):string {if(typeof value!=='string'||!UUID.test(value))fail();return value as string;}
function timestamp(value:unknown):string|null {
  return typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
}
function label(value:unknown,max=120):string {
  if(typeof value!=='string')return '';
  const text=value.trim();
  // No contact instructions, URLs, private evidence paths or free-form payloads in this DTO.
  return text.length<=max&&!/[\x00-\x1f<>]|https?:|www\.|@|bearer\s|(?:password|token|secret|api[_ -]?key)\s*[:=]/i.test(text)?text:'';
}
function ticket(value:unknown):string {if(typeof value!=='string'||!/^\d{1,24}$/.test(value.trim()))fail();return value.trim();}
const selectPrep='id,ticket_no,site,status,created_at,released_at,closed_at,is_test,work_type';
const selectSolar='id,prep_ticket_id,handoff_accepted_at,helios_field_completed_at,helios_owner_verified_at,updated_at,'+HELIOS_FIELD_CHECKS.map(([key])=>key).join(',');
const selectItem='id,prep_ticket_id,equipment_type,purpose,unit_tag,verified_at,service_unit_confirmed,service_verified_at,power_ok,functions_ok,safe_ok,swap_outcome,swap_outcome_at,spare_outcome,ranger_field_victron_updated_ok,ranger_field_victron_updated_at';
const membership=(values:string[])=>'in.('+values.map(value=>'"'+value+'"').join(',')+')';
const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=100000?Number(value):fail();
function unique(records:Row[],key='id'){const seen=new Set<string>();for(const row of records){const value=id(row[key]);if(seen.has(value))fail();seen.add(value);}return records;}
function evidenceCount(records:Row[],stage:string){
  const selected=records.filter(row=>row.stage===stage||row.category===stage);
  return {stage,photos:selected.filter(row=>row.kind==='photo').length,signatures:selected.filter(row=>row.kind==='signature').length,
    signedAt:selected.filter(row=>row.kind==='signature').map(row=>timestamp(row.created_at)).filter(Boolean).sort().at(-1)||null};
}
/** All identities remain exact prep/item UUID + full family/tag. No bare-number or site-text matching. */
export function projectLegacyInstallRecord(input:{prep:Row;items:Row[];solar:Row[];handoff:Row[];field:Row[];summary:Row;newerPrep:boolean},now:string){
  const {prep,summary}=input,prepId=id(prep.id),ticketNumber=ticket(prep.ticket_no);
  if(prep.is_test!==false||!['closed','released'].includes(prep.status)||summary.found!==true||summary.ticket_no!==ticketNumber||!object(summary.counts))fail();
  const items=unique(rows(input.items,100)),solar=unique(rows(input.solar,1)),handoff=unique(rows(input.handoff,300)),field=unique(rows(input.field,300));
  for(const row of [...items,...solar,...handoff,...field])if(row.prep_ticket_id!==prepId)fail();
  const recordedBefore=(value:unknown,before=now)=>{const time=timestamp(value);return time&&Date.parse(time)<=Date.parse(before)?time:null;};
  const check=solar[0]||{},submittedAt=timestamp(check.helios_field_completed_at),completedAt=recordedBefore(check.helios_field_completed_at);
  const handoffAt=completedAt?recordedBefore(check.handoff_accepted_at,completedAt):null;
  const ownerTime=recordedBefore(check.helios_owner_verified_at),ownerVerifiedAt=ownerTime&&completedAt&&Date.parse(ownerTime)>=Date.parse(completedAt)?ownerTime:null;
  const fieldEvidence=evidenceCount(field,'helios_install');
  const heliosInstalled=items.filter(row=>row.equipment_type==='Helios'&&(row.purpose==='DELIVERY'||row.purpose==='SWAP'&&row.swap_outcome==='installed'));
  const fieldChecks=HELIOS_FIELD_CHECKS.map(([key,name])=>({name,passed:check[key]===true}));
  const identities=items.map(row=>JSON.stringify([label(row.equipment_type),label(row.unit_tag)]));
  const duplicateIdentity=identities.some((key,index)=>identities.indexOf(key)!==index);
  const signatureAt=timestamp(fieldEvidence.signedAt);
  const completedProof=Boolean(completedAt&&handoffAt&&
    heliosInstalled.length>0&&fieldChecks.every(row=>row.passed)&&fieldEvidence.photos>=heliosInstalled.length&&signatureAt&&Date.parse(signatureAt)<=Date.parse(completedAt)&&
    field.every(row=>{const time=timestamp(row.created_at);return time&&Date.parse(time)>=Date.parse(handoffAt)&&Date.parse(time)<=Date.parse(completedAt);})&&
    !items.some(row=>row.equipment_type==='Helios'&&row.purpose==='SWAP'&&!['installed','returned_unused'].includes(row.swap_outcome)));
  const counts=summary.counts;
  const blockers:string[]=[];
  if(input.newerPrep)blockers.push('A newer preparation exists for this ticket. This is historical evidence.');
  if(summary.review_status==='correction_requested')blockers.push('The Owner requested corrections. Review the current Tech Check before closeout.');
  if(duplicateIdentity)blockers.push('Duplicate family and unit tags need identity review.');
  if(count(counts.active_assignments))blockers.push('IT or Service assignments remain open.');
  if(count(counts.open_returns))blockers.push('Equipment returns still require intake.');
  if(count(counts.open_offline_unit_escalations))blockers.push('Offline-unit escalations remain open.');
  if(count(counts.pending_swap_outcomes))blockers.push('SWAP results remain undecided.');
  if(count(counts.missing_required_swap_returns))blockers.push('Required SWAP returns are missing.');
  if(count(counts.pending_swap_site_registrations))blockers.push('Installed SWAP equipment still needs IT site registration.');
  if(submittedAt&&!completedProof)blockers.push('The saved Helios submission has incomplete or inconsistent field evidence.');
  if(check.helios_owner_verified_at&&!ownerVerifiedAt)blockers.push('The Owner verification timestamp needs review.');
  const units=items.map(row=>{
    const family=label(row.equipment_type,60),unitTag=label(row.unit_tag,80),purpose=['DELIVERY','SWAP','BACKUP'].includes(row.purpose)?row.purpose:'UNKNOWN';
    let disposition='handoff_only';
    if(purpose==='BACKUP')disposition='truck_spare';
    else if(purpose==='SWAP'&&row.swap_outcome==='returned_unused')disposition='unused_replacement';
    else if(!family||!unitTag||duplicateIdentity||purpose==='UNKNOWN'||purpose==='SWAP'&&row.swap_outcome!=='installed')disposition='review_needed';
    else if(family==='Helios'&&completedProof)disposition='installation_recorded';
    else if(purpose==='SWAP'&&row.swap_outcome==='installed')disposition='swap_installation_recorded';
    return {itemId:id(row.id),family:family||'Equipment family needs review',unitTag:unitTag||'Unit tag needs review',purpose,disposition,
      itVerifiedAt:recordedBefore(row.verified_at),serviceReceiptAt:row.service_unit_confirmed===true?recordedBefore(row.service_verified_at):null,
      itChecks:[{name:'Power',passed:row.power_ok===true},{name:'Functions',passed:row.functions_ok===true},{name:'Safety',passed:row.safe_ok===true}],
      rangerFieldUpdateAt:family==='Ranger'&&row.ranger_field_victron_updated_ok===true?recordedBefore(row.ranger_field_victron_updated_at):null};
  });
  return {prepId,ticketNumber,siteLabel:label(prep.site,180)||'Site needs review',prepStatus:prep.status,
    recordedAt:[completedAt,recordedBefore(prep.closed_at)].filter(Boolean).sort().at(-1)||null,fieldCompletedAt:completedProof?completedAt:null,ownerVerifiedAt:completedProof?ownerVerifiedAt:null,
    historical:input.newerPrep,reviewStatus:['ready','not_ready','correction_requested','closed'].includes(summary.review_status)?summary.review_status:'review_needed',
    readyForOwnerReview:summary.ready_for_owner_review===true&&summary.review_status==='ready'&&prep.status==='closed'&&blockers.length===0,
    units,heliosChecks:submittedAt?fieldChecks:[],evidence:[evidenceCount(handoff,'it'),evidenceCount(handoff,'service'),fieldEvidence].map(e=>({...e,signedAt:recordedBefore(e.signedAt)})),blockers,
    fieldMapStatus:'pending_exact_link',fieldMapNote:'Native equipment and site linkage is unverified. This evidence does not move or place a Field Map unit.'};
}

/** All paths are built here, not supplied by the browser. RPC is an existing STABLE Owner read. */
export function createLegacyInstallEvidenceReader(read:(path:string,body?:Row)=>Promise<unknown>,now=()=>new Date()){
  return async()=>{
    const generatedAt=now().toISOString(),windowStart=new Date(Date.parse(generatedAt)-30*86400000).toISOString();
    const [closed,submitted]=await Promise.all([
      read('prep_tickets?select='+selectPrep+'&is_test=eq.false&status=eq.closed&closed_at=gte.'+windowStart+'&order=closed_at.desc,id.asc&limit=11').then(v=>unique(rows(v,11))),
      read('service_solar_checks?select=prep_ticket_id,helios_field_completed_at&helios_field_completed_at=gte.'+windowStart+'&order=helios_field_completed_at.desc,prep_ticket_id.asc&limit=11').then(v=>unique(rows(v,11),'prep_ticket_id')),
    ]);
    for(const row of closed)if(row.is_test!==false||row.status!=='closed'||!timestamp(row.closed_at)||Date.parse(row.closed_at)<Date.parse(windowStart)||Date.parse(row.closed_at)>Date.parse(generatedAt))fail();
    for(const row of submitted)if(!timestamp(row.helios_field_completed_at)||Date.parse(row.helios_field_completed_at)<Date.parse(windowStart)||Date.parse(row.helios_field_completed_at)>Date.parse(generatedAt))fail();
    const ids=[...new Set([...closed.map(row=>id(row.id)),...submitted.map(row=>id(row.prep_ticket_id))])];
    const empty={contract:LEGACY_INSTALL_CONTRACT,readOnly:true,generatedAt,windowStart,limit:LEGACY_INSTALL_LIMIT,hasMore:false,items:[]};
    if(!ids.length)return empty;
    const current=unique(rows(await read('prep_tickets?select='+selectPrep+'&id='+membership(ids)+'&order=id.asc&limit=23'),22));
    if(current.length!==ids.length||current.some(row=>!ids.includes(row.id)))fail();
    // Exclude tests and records reopened since candidate discovery. Never relabel them complete.
    const candidates=current.filter(row=>row.is_test===false&&['released','closed'].includes(row.status)).map(prep=>{
      const completion=submitted.find(row=>row.prep_ticket_id===prep.id)?.helios_field_completed_at;
      return {prep,time:[timestamp(completion),timestamp(prep.closed_at)].filter(Boolean).sort().at(-1)||null};
    }).filter(row=>row.time&&Date.parse(row.time)>=Date.parse(windowStart)&&Date.parse(row.time)<=Date.parse(generatedAt))
      .sort((a,b)=>String(b.time).localeCompare(String(a.time))||a.prep.id.localeCompare(b.prep.id));
    const selected=candidates.slice(0,LEGACY_INSTALL_LIMIT),hasMore=closed.length===11||submitted.length===11||candidates.length>LEGACY_INSTALL_LIMIT;
    const projected=[];
    // Bounded concurrency and collection sizes; no unlimited history scan.
    for(let offset=0;offset<selected.length;offset+=2){
      projected.push(...await Promise.all(selected.slice(offset,offset+2).map(async({prep})=>{
        const prepId=id(prep.id),ticketNumber=ticket(prep.ticket_no),filter='&prep_ticket_id=eq.'+prepId;
        const [items,solar,handoff,field,summary,later]=await Promise.all([
          read('prep_items?select='+selectItem+filter+'&order=item_order.asc,id.asc&limit=101'),
          read('service_solar_checks?select='+selectSolar+filter+'&limit=2'),
          read('handoff_evidence?select=id,prep_ticket_id,stage,kind,created_at'+filter+'&order=created_at.asc,id.asc&limit=301'),
          read('service_solar_evidence?select=id,prep_ticket_id,category,kind,created_at'+filter+'&category=eq.helios_install&order=created_at.asc,id.asc&limit=301'),
          read('rpc/owner_job_closeout_summary_v1',{p_ticket_no:ticketNumber}),
          // The authoritative legacy summary uses btrim(ticket_no). A bounded literal
          // numeric substring scan also detects whitespace variants without guessing a join.
          read('prep_tickets?select=id,ticket_no,created_at&ticket_no=like.*'+ticketNumber+'*&created_at=gte.'+encodeURIComponent(prep.created_at)+'&order=created_at.desc,id.asc&limit=101'),
        ]);
        if(!object(summary))fail();
        const matching=unique(rows(later,100)).filter(row=>typeof row.ticket_no==='string'&&row.ticket_no.trim()===ticketNumber);
        if(!matching.some(row=>row.id===prepId)||matching.some(row=>!timestamp(row.created_at)))fail();
        return projectLegacyInstallRecord({prep,items:rows(items,100),solar:rows(solar,1),handoff:rows(handoff,300),field:rows(field,300),summary,newerPrep:matching.some(row=>row.id!==prepId)},generatedAt);
      })));
    }
    return {...empty,hasMore,items:projected};
  };
}

/** Fixed server-selected host and credentials; bounded time/bytes; fixed error text.
 * Legacy evidence receives caller credentials; native access receives only the existing permission read. */
export function legacyEvidenceTransport(fetcher:typeof fetch,baseUrl:string,headers:Record<string,string>,requestSignal?:AbortSignal){
  const signal=AbortSignal.any([AbortSignal.timeout(15000),...(requestSignal?[requestSignal]:[])]);
  const deadline=<T>(start:()=>Promise<T>)=>new Promise<T>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new LegacyInstallEvidenceError());};
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(start).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
  return async(path:string,body?:Row)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{
      const response=await deadline(()=>fetcher(baseUrl+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal,cache:'no-store',redirect:'error'}));
      if(!response.ok||response.redirected){void response.body?.cancel().catch(()=>{});throw new LegacyInstallEvidenceError([401,403].includes(response.status)?403:503);}
      if(!response.body||Number(response.headers.get('Content-Length'))>262144){void response.body?.cancel().catch(()=>{});fail();}
      reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
      while(true){const next=await deadline(()=>reader!.read());if(next.done)break;size+=next.value.byteLength;if(size>262144)fail();text+=decoder.decode(next.value,{stream:true});}
      text+=decoder.decode();if(signal.aborted)fail();return JSON.parse(text);
    }catch(cause){throw cause instanceof LegacyInstallEvidenceError?cause:new LegacyInstallEvidenceError();}
    finally{if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{ /* best effort */ }}}
  };
}
