import {censusInstallation} from './importedAddress.ts';
import {geocodioInstallation} from './geocodioAddress.ts';
import {createSourceReader,checkedImportedSource,sourceIdentity,sourceAddress,sameSource,SOURCE_ORG,geocodeDependencyCode,type ImportedSource} from './importedSources.ts';
type Options={rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;sourceReadKey?:string;geocodioApiKey?:string;fetch?:typeof fetch;deadlineMs:number;now?:()=>number};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const org={p_organization_id:SOURCE_ORG};
const postal=(v:string)=>/(\d{5}(?:-\d{4})?)\s*$/.exec(v)?.[1];
const stages=['cursor_read','source_changes','source_sync_read','source_sync','scan_complete','queue_read','queue_binding','source_before','source_invalidate','census_claim','census_provider','geocodio_reserve','geocodio_provider','source_after','census_finish','geocodio_finish'] as const;
const codes=['rpc_error','rpc_transport','rpc_http','rpc_json','source_transport','source_http','source_body','source_json','source_shape','cursor_shape','queue_shape','binding_shape','claim_shape','reservation_shape','unexpected'] as const;
type Stage=typeof stages[number];
type Code=typeof codes[number];
class ImportedSweepError extends Error{
 readonly stage:Stage;readonly code:Code;
 constructor(stage:Stage,code:Code){super('Imported geocode unavailable');this.stage=stage;this.code=code;}
}
/** Operation-local context remains correct when concurrent claims or finishes reject. */
async function atStage<T>(stage:Stage,operation:()=>Promise<T>,fallback:Code='unexpected'):Promise<T>{
 try{return await operation();}catch(error){throw new ImportedSweepError(stage,geocodeDependencyCode(error)??fallback);}
}
/** Only fixed allowlisted fields cross the HTTP boundary, never arbitrary exception data. */
export function importedGeocodeFailure(error:unknown){
 try{if(error instanceof ImportedSweepError){const {stage:rawStage,code:rawCode}=error,stage=stages.find(allowed=>allowed===rawStage),code=codes.find(allowed=>allowed===rawCode);if(stage&&code)return {status:'unavailable',stage,code};}}catch{}
 return {status:'unavailable',stage:'unknown',code:'unexpected'};
}
/** Existing 15-minute cron only. Bounded reads, address dedupe and four in-flight lookups; no new timer/cadence. */
export async function processImportedGeocodes(options:Options){
 const now=options.now||Date.now,remaining=()=>options.deadlineMs-now(),reader=createSourceReader(options.sourceReadKey,options.fetch||fetch);
 const summary={configured:reader.configured,syncedSources:0,consideredAddresses:0,censusSucceeded:0,geocodioSucceeded:0,deferred:0,stale:0};
 if(!reader.configured||remaining()<45000)return summary;
 const rpc=(stage:Stage,name:string,args:Record<string,unknown>)=>atStage(stage,()=>options.rpc(name,args),'rpc_error');
 // A committed source cursor is advanced only with its fully checked corresponding event page.
 const cursor=await rpc('cursor_read','cos_imported_geocode_cursor_read',org);let after=cursor?.eventId;const scanGeneration=cursor?.scanGeneration;const syncStarted=now();
 if(typeof after!=='string'||!/^(0|[1-9]\d{0,18})$/.test(after)||!uuid(scanGeneration))throw new ImportedSweepError('cursor_read','cursor_shape');
 for(let page=0;page<4&&remaining()>60000&&now()-syncStarted<20000;page++){
  const changes=await atStage('source_changes',()=>reader.changes(after,100));
  const current=changes.events.length?await atStage('source_sync_read',()=>reader.currentMany(changes.events.map(sourceIdentity))):[];
  const events=changes.events.map((event,i)=>({eventId:event.eventId,entityKind:event.entityKind,nativeUnitId:event.nativeUnitId,productId:event.productId,sourceRevision:event.sourceRevision,source:event.kind==='tombstone'?null:current[i]}));
  const saved=await rpc('source_sync','cos_imported_geocode_sync',{...org,p_scan_generation:scanGeneration,p_after_event_id:after,p_events:events,p_next_event_id:changes.nextEventId});
  if(saved?.accepted!==true||saved.eventId!==changes.nextEventId||saved.scanGeneration!==scanGeneration)break;
  summary.syncedSources+=saved.applied;after=changes.nextEventId;
  if(changes.events.length<100){await rpc('scan_complete','cos_imported_geocode_scan_complete',{...org,p_after_event_id:after,p_scan_generation:scanGeneration});break;}
 }
 const seen=new Set<string>(),addressesSeen=new Set<string>();
 while(addressesSeen.size<80&&seen.size<160&&remaining()>45000){
  const due=await rpc('queue_read','cos_imported_geocode_list_due',{...org,p_limit:80});
  if(!Array.isArray(due)||due.length>80)throw new ImportedSweepError('queue_read','queue_shape');
  const group:{binding:ImportedSource;stage:'census'|'geocodio'}[]=[];
  for(const job of due){
   const binding=await atStage('queue_binding',()=>checkedImportedSource(job?.binding));if(!binding||!['census','geocodio'].includes(job.stage))throw new ImportedSweepError('queue_binding','binding_shape');
   const key=binding.addressSha256+'|'+job.stage;if(seen.has(key))continue;
   if(job.stage==='geocodio'&&!options.geocodioApiKey?.trim()){summary.deferred++;seen.add(key);continue;}
   if(!addressesSeen.has(binding.addressSha256)&&addressesSeen.size+new Set(group.filter(item=>!addressesSeen.has(item.binding.addressSha256)).map(item=>item.binding.addressSha256)).size>=80)continue;
   group.push({binding,stage:job.stage});seen.add(key);if(group.length===4)break;
  }
  if(!group.length)break;
  const before=await atStage('source_before',()=>reader.currentMany(group.map(job=>sourceIdentity(job.binding))));
  const work=await Promise.all(group.map(async(job,i)=>{
   const {binding,stage}=job,key={...org,p_binding:binding};
   if(!sameSource(binding,before[i])){await rpc('source_invalidate','cos_imported_geocode_invalidate',key);summary.stale++;return null;}
   if(remaining()<40000){summary.deferred++;return null;}
   addressesSeen.add(binding.addressSha256);summary.consideredAddresses=addressesSeen.size;
   if(stage==='census'){
    const claim=await rpc('census_claim','cos_imported_geocode_census_claim',{...key,p_request_id:crypto.randomUUID()});
    if(claim?.claimed!==true){summary.deferred++;return null;}
    if(!uuid(claim.claimToken))throw new ImportedSweepError('census_claim','claim_shape');
    const result=await atStage('census_provider',()=>censusInstallation(binding.installation,options.fetch||fetch));
    return {binding,stage,token:claim.claimToken,result};
   }
   const reservation=await rpc('geocodio_reserve','cos_imported_geocode_reserve',{...key,p_request_id:crypto.randomUUID()});
   if(reservation?.reserved!==true){summary.deferred++;return null;}
   if(!uuid(reservation.reservationToken)||typeof reservation.sendBefore!=='string'||!Number.isFinite(Date.parse(reservation.sendBefore)))throw new ImportedSweepError('geocodio_reserve','reservation_shape');
   if(now()>=Date.parse(reservation.sendBefore)||remaining()<25000){summary.deferred++;return null;}
   const result=await atStage('geocodio_provider',()=>geocodioInstallation(binding.installation,options.geocodioApiKey!,options.fetch||fetch,now));
   return {binding,stage,token:reservation.reservationToken,result};
  }));
  const completed=work.filter(item=>item!==null);
  if(!completed.length)continue;
  // A failed post-read leaves charged leases unresolved. It never authorizes a retry or stale publication.
  const afterSources=await atStage('source_after',()=>reader.currentMany(completed.map(item=>sourceIdentity(item.binding))));
  await Promise.all(completed.map(async(item,i)=>{
   const sourceCurrent=sameSource(item.binding,afterSources[i]),result=item.result;
   const common={...org,p_binding:item.binding,p_source_current:sourceCurrent,p_status:result.status==='invalid_address'?'no_match':result.status,
    p_latitude:result.latitude??null,p_longitude:result.longitude??null,p_matched_address:result.matchedAddress??null};
   let saved;
   if(item.stage==='census')saved=await rpc('census_finish','cos_imported_geocode_census_finish',{...common,p_claim_token:item.token,p_reason:result.status==='success'?null:result.status==='provider_error'?'provider_unavailable':'no_match'});
   else {const geo=result as Awaited<ReturnType<typeof geocodioInstallation>>;saved=await rpc('geocodio_finish','cos_imported_geocode_finish',{...common,p_reservation_token:item.token,p_accuracy_type:geo.accuracyType??null,p_accuracy:geo.accuracy??null,p_match_type:geo.matchType??null,p_reason:geo.reason,p_retry_after_seconds:geo.retryAfterSeconds??null});}
   if(!sourceCurrent||saved?.accepted!==true)summary.stale++;
   else if(result.status==='success'){if(item.stage==='census')summary.censusSucceeded++;else summary.geocodioSucceeded++;}
   else summary.deferred++;
  }));
 }
 return summary;
}
