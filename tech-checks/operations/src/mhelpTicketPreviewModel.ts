import {checkedMhelpAppointmentEvidence,type TicketAppointmentEvidence} from './mhelpAppointmentPreviewModel';
/** Client-only aggregate contract. Never import the server token or ticket reader modules here. */
export const ticketPreviewMetrics = ['deletedTickets','assignedTickets','missingAssignmentFields','missingTypeIds','unknownTypeIds','unknownStatusIds','unknownCustomStatusIds','missingCustomerIds','missingServiceLocationIds','ticketsWithUnknownFields','unknownFieldOccurrences','typeLabelMismatches','duplicateTypeNames'] as const;
export type TicketPreviewMetrics = Record<typeof ticketPreviewMetrics[number],number>;
export const ticketEvidenceKinds=['absent','null','boolean','integer','number','string','array','object','other'] as const;
export const ticketEvidenceFormats=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
export const ticketEvidenceFields=['subject','summary','comment','scheduledDate','neededBy','serviceLocationId'] as const;
export const ticketItemEvidenceFields=['ticketItemId','priceListId','priceListTypeId','name','description','quantity'] as const;
export const ticketCustomEvidenceFields=['customFieldId','fieldValue','fieldLabel'] as const;
export const ticketDetailEvidenceCapability='ticket_detail_structure_v1' as const;
export const ticketDetailEvidenceFields=['subject','summary','comment','customerId','serviceLocationId','categoryId','priority','typeId','typeName','statusId','customStatusId','ticketStatus','assignedTo','deleted','creationDate','lastModDate','scheduledDate','neededBy','appointmentCount','estimatedTime','lastCalledDate','nextCallDate','parentTicketId','originalTicketId','recurringRuleId','generatedByRecurring','businessUnitId'] as const;
export const ticketDetailItemEvidenceFields=['ticketItemId','ticketId','portalId','priceListId','priceListTypeId','name','description','quantity','currentStatus','notes','startTime','dateEntry','durationSeconds','groupId','lastUpdateUTC','sortNumber'] as const;
export const ticketDetailCustomEvidenceFields=['id','customFieldId','fieldValue','fieldLabel','sortOrder','isRequired'] as const;
type KindCounts=Partial<Record<typeof ticketEvidenceKinds[number],number>>;
export type TicketFieldEvidence={kinds:KindCounts;formats:Partial<Record<typeof ticketEvidenceFormats[number],number>>;emptyStrings:number;nonemptyStrings:number};
export type TicketCollectionEvidence<K extends string>={kinds:KindCounts;emptyArrays:number;nonemptyArrays:number;totalEntries:number;sampledEntries:number;entryKinds:KindCounts;fields:Record<K,TicketFieldEvidence>};
export type TicketOperationalEvidence={
  contract:'cos-mhelpdesk-operational-evidence-v1';scope:'first_ticket_page';ticketSampleLimit:50;nestedSampleLimit:50;
  sampledTickets:number;siteIdTickets:number;fields:Record<typeof ticketEvidenceFields[number],TicketFieldEvidence>;
  collections:{items:TicketCollectionEvidence<typeof ticketItemEvidenceFields[number]>;customFields:TicketCollectionEvidence<typeof ticketCustomEvidenceFields[number]>};
};
export type TicketDetailEvidence = {
  contract:'cos-mhelpdesk-ticket-detail-evidence-v1';scope:'single_server_selected_ticket';
} & ({state:'selection_unavailable';reason:'empty_window'|'ambiguous_window';sampledTickets:0} | {
  state:'detail_verified';sampledTickets:1;nestedSampleLimit:50;
  fields:Record<typeof ticketDetailEvidenceFields[number],TicketFieldEvidence>;
  collections:{items:TicketCollectionEvidence<typeof ticketDetailItemEvidenceFields[number]>;customFields:TicketCollectionEvidence<typeof ticketDetailCustomEvidenceFields[number]>;equipment:TicketCollectionEvidence<never>};
  availability:{description:'nonempty_text_present'|'nonempty_text_absent';site:'unresolved_no_join';equipment:'unverified_write_model_candidate';schedule:'unverified_deprecated_get_fields';items:'unmapped_structures_only';customFields:'unmapped_structures_only'};
});
export type MhelpTicketPreview = {
  contract:'cos-mhelpdesk-ticket-preview-v1';state:'preview_verified';liveAccessVerified:true;automaticSync:false;ticketWrites:false;
  verifiedPortalId:string;readAt:string;window:{createdAfter:string;createdBefore:string};totalRows:number;previewCount:number;partial:false;
  types:{typeId:string;portalId:string;typeName:string;isActive:boolean;count:number}[];
  statuses:{statusId:string;statusText:string;displayText:string;parentId:string|null;canBeParent:boolean;statusCount:number;customStatusCount:number}[];
  metrics:TicketPreviewMetrics;
  operationalEvidence?:TicketOperationalEvidence;
  detailEvidence?:TicketDetailEvidence;
  appointmentEvidence?:TicketAppointmentEvidence;
};
function invalid():never {throw Error('The ticket preview response could not be verified. Try again.');}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();
  return value as Record<string,unknown>;
}
function id(value:unknown):string {
  if(typeof value!=='string'||!/^[1-9]\d{0,14}$/.test(value)||!Number.isSafeInteger(Number(value)))invalid();
  return value;
}
function count(value:unknown,max=500):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();
  return value;
}
function label(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.length>500||/[\x00-\x1f\x7f]/.test(value))invalid();
  return value;
}
function utc(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==value.slice(0,19))invalid();
  return value;
}
function sparseCounts<K extends string>(value:unknown,keys:readonly K[],sampleSize:number):Partial<Record<K,number>>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key as K)))invalid();
  const result:Partial<Record<K,number>>={};let total=0;
  for(const key of keys){
    if(!Object.prototype.hasOwnProperty.call(value,key))continue;
    const n=count((value as Record<string,unknown>)[key],50);if(n===0)invalid();
    result[key]=n;total+=n;
  }
  if(total!==sampleSize)invalid();
  return result;
}
function fieldEvidence(value:unknown,sampleSize:number):TicketFieldEvidence{
  const row=record(value,['kinds','formats','emptyStrings','nonemptyStrings']);
  const kinds=sparseCounts(row.kinds,ticketEvidenceKinds,sampleSize),strings=kinds.string||0;
  const formats=sparseCounts(row.formats,ticketEvidenceFormats,strings),emptyStrings=count(row.emptyStrings,50),nonemptyStrings=count(row.nonemptyStrings,50);
  if(emptyStrings+nonemptyStrings!==strings)invalid();
  return {kinds,formats,emptyStrings,nonemptyStrings};
}
function evidenceFields<K extends string>(value:unknown,keys:readonly K[],sampleSize:number):Record<K,TicketFieldEvidence>{
  const input=record(value,keys),result={} as Record<K,TicketFieldEvidence>;
  for(const key of keys)result[key]=fieldEvidence(input[key],sampleSize);
  return result;
}
function collectionEvidence<K extends string>(value:unknown,keys:readonly K[],sampleSize:number):TicketCollectionEvidence<K>{
  const row=record(value,['kinds','emptyArrays','nonemptyArrays','totalEntries','sampledEntries','entryKinds','fields']);
  const kinds=sparseCounts(row.kinds,ticketEvidenceKinds,sampleSize),emptyArrays=count(row.emptyArrays,50),nonemptyArrays=count(row.nonemptyArrays,50);
  const totalEntries=count(row.totalEntries,1000000),sampledEntries=count(row.sampledEntries,50);
  if(emptyArrays+nonemptyArrays!==(kinds.array||0)||totalEntries<nonemptyArrays||(totalEntries===0)!==(nonemptyArrays===0)||sampledEntries!==Math.min(totalEntries,50))invalid();
  const entryKinds=sparseCounts(row.entryKinds,ticketEvidenceKinds,sampledEntries),fields=evidenceFields(row.fields,keys,sampledEntries);
  return {kinds,emptyArrays,nonemptyArrays,totalEntries,sampledEntries,entryKinds,fields};
}
function operationalEvidence(value:unknown,previewCount:number):TicketOperationalEvidence{
  const row=record(value,['contract','scope','ticketSampleLimit','nestedSampleLimit','sampledTickets','siteIdTickets','fields','collections']);
  if(row.contract!=='cos-mhelpdesk-operational-evidence-v1'||row.scope!=='first_ticket_page'||row.ticketSampleLimit!==50||row.nestedSampleLimit!==50)invalid();
  const sampledTickets=count(row.sampledTickets,50),siteIdTickets=count(row.siteIdTickets,sampledTickets);
  if(sampledTickets!==Math.min(previewCount,50))invalid();
  const fields=evidenceFields(row.fields,ticketEvidenceFields,sampledTickets),input=record(row.collections,['items','customFields']);
  if(siteIdTickets>(fields.serviceLocationId.kinds.integer||0)+(fields.serviceLocationId.kinds.string||0))invalid();
  const collections={items:collectionEvidence(input.items,ticketItemEvidenceFields,sampledTickets),customFields:collectionEvidence(input.customFields,ticketCustomEvidenceFields,sampledTickets)};
  const result:TicketOperationalEvidence={contract:'cos-mhelpdesk-operational-evidence-v1',scope:'first_ticket_page',ticketSampleLimit:50,nestedSampleLimit:50,sampledTickets,siteIdTickets,fields,collections};
  if(new TextEncoder().encode(JSON.stringify(result)).length>12000)invalid();
  return result;
}
function detailEvidence(value:unknown,previewCount:number):TicketDetailEvidence{
  if(!value||typeof value!=='object'||Array.isArray(value))invalid();
  const unavailable=(value as Record<string,unknown>).state==='selection_unavailable';
  const row=record(value,['contract','scope','state','sampledTickets',...(unavailable?['reason']:['nestedSampleLimit','fields','collections','availability'])]);
  if(row.contract!=='cos-mhelpdesk-ticket-detail-evidence-v1'||row.scope!=='single_server_selected_ticket')invalid();
  if(unavailable){
    if(row.sampledTickets!==0||row.reason!==(previewCount===0?'empty_window':'ambiguous_window')||previewCount===1)invalid();
    return {contract:'cos-mhelpdesk-ticket-detail-evidence-v1',scope:'single_server_selected_ticket',state:'selection_unavailable',reason:previewCount===0?'empty_window':'ambiguous_window',sampledTickets:0};
  }
  if(row.state!=='detail_verified'||previewCount!==1||row.sampledTickets!==1||row.nestedSampleLimit!==50)invalid();
  const fields=evidenceFields(row.fields,ticketDetailEvidenceFields,1),input=record(row.collections,['items','customFields','equipment']);
  const collections={items:collectionEvidence(input.items,ticketDetailItemEvidenceFields,1),customFields:collectionEvidence(input.customFields,ticketDetailCustomEvidenceFields,1),equipment:collectionEvidence(input.equipment,[] as const,1)};
  for(const collection of [collections.items,collections.customFields]){
    if(Object.values(collection.fields).some(field=>(field.kinds.absent||0)<collection.sampledEntries-(collection.entryKinds.object||0)))invalid();
  }
  const availability=record(row.availability,['description','site','equipment','schedule','items','customFields']);
  const description=[fields.subject,fields.summary,fields.comment].some(field=>field.nonemptyStrings>0)?'nonempty_text_present':'nonempty_text_absent';
  if(availability.description!==description||availability.site!=='unresolved_no_join'||availability.equipment!=='unverified_write_model_candidate'||availability.schedule!=='unverified_deprecated_get_fields'||availability.items!=='unmapped_structures_only'||availability.customFields!=='unmapped_structures_only')invalid();
  const result:TicketDetailEvidence={contract:'cos-mhelpdesk-ticket-detail-evidence-v1',scope:'single_server_selected_ticket',state:'detail_verified',sampledTickets:1,nestedSampleLimit:50,fields,collections,
    availability:{description,site:'unresolved_no_join',equipment:'unverified_write_model_candidate',schedule:'unverified_deprecated_get_fields',items:'unmapped_structures_only',customFields:'unmapped_structures_only'}};
  if(new TextEncoder().encode(JSON.stringify(result)).length>16000)invalid();
  return result;
}
/** Reject schema changes or partial/fabricated success before displaying any aggregate. */
export function checkedMhelpTicketPreview(value:unknown):MhelpTicketPreview {
  const hasEvidence=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'operationalEvidence');
  const hasDetail=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'detailEvidence');
  const hasAppointment=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'appointmentEvidence');
  if(hasDetail&&!hasEvidence||hasAppointment&&!hasDetail)invalid();
  const row=record(value,['contract','state','liveAccessVerified','automaticSync','ticketWrites','verifiedPortalId','readAt','window','totalRows','previewCount','partial','types','statuses','metrics',...(hasEvidence?['operationalEvidence']:[]),...(hasDetail?['detailEvidence']:[]),...(hasAppointment?['appointmentEvidence']:[])]);
  if(row.contract!=='cos-mhelpdesk-ticket-preview-v1'||row.state!=='preview_verified'||row.liveAccessVerified!==true||row.automaticSync!==false||row.ticketWrites!==false||row.partial!==false)invalid();
  const verifiedPortalId=id(row.verifiedPortalId),readAt=utc(row.readAt),totalRows=count(row.totalRows);
  if(count(row.previewCount)!==totalRows)invalid();
  const range=record(row.window,['createdAfter','createdBefore']),createdAfter=utc(range.createdAfter),createdBefore=utc(range.createdBefore);
  const duration=Date.parse(createdBefore)-Date.parse(createdAfter);
  if(duration<=0||duration>31*86400000||Date.parse(readAt)<Date.parse(createdBefore))invalid();
  if(!Array.isArray(row.types)||row.types.length>500||!Array.isArray(row.statuses)||row.statuses.length>500)invalid();
  const types=row.types.map(value=>{
    const type=record(value,['typeId','portalId','typeName','isActive','count']);
    if(id(type.portalId)!==verifiedPortalId||typeof type.isActive!=='boolean')invalid();
    return {typeId:id(type.typeId),portalId:verifiedPortalId,typeName:label(type.typeName),isActive:type.isActive,count:count(type.count,totalRows)};
  });
  const statuses=row.statuses.map(value=>{
    const status=record(value,['statusId','statusText','displayText','parentId','canBeParent','statusCount','customStatusCount']);
    if(typeof status.canBeParent!=='boolean')invalid();
    return {statusId:id(status.statusId),statusText:label(status.statusText),displayText:label(status.displayText),parentId:status.parentId===null?null:id(status.parentId),canBeParent:status.canBeParent,statusCount:count(status.statusCount,totalRows),customStatusCount:count(status.customStatusCount,totalRows)};
  });
  const typeIds=new Set(types.map(type=>type.typeId)),statusIds=new Set(statuses.map(status=>status.statusId));
  if(typeIds.size!==types.length||statusIds.size!==statuses.length||statuses.some(status=>status.parentId!==null&&(!statusIds.has(status.parentId)||status.parentId===status.statusId)))invalid();
  const input=record(row.metrics,ticketPreviewMetrics),metrics={} as TicketPreviewMetrics;
  for(const key of ticketPreviewMetrics)metrics[key]=count(input[key],key==='unknownFieldOccurrences'?1000000:key==='duplicateTypeNames'?types.length:totalRows);
  if(types.reduce((n,type)=>n+type.count,0)+metrics.missingTypeIds+metrics.unknownTypeIds!==totalRows ||
    statuses.reduce((n,status)=>n+status.statusCount,0)+metrics.unknownStatusIds!==totalRows ||
    statuses.reduce((n,status)=>n+status.customStatusCount,0)+metrics.unknownCustomStatusIds>totalRows ||
    metrics.assignedTickets+metrics.missingAssignmentFields>totalRows || metrics.unknownFieldOccurrences<metrics.ticketsWithUnknownFields ||
    metrics.duplicateTypeNames!==types.length-new Set(types.map(type=>type.typeName)).size)invalid();
  return {contract:'cos-mhelpdesk-ticket-preview-v1',state:'preview_verified',liveAccessVerified:true,automaticSync:false,ticketWrites:false,
    verifiedPortalId,readAt,window:{createdAfter,createdBefore},totalRows,previewCount:totalRows,partial:false,types,statuses,metrics,...(hasEvidence?{operationalEvidence:operationalEvidence(row.operationalEvidence,totalRows)}:{}),...(hasDetail?{detailEvidence:detailEvidence(row.detailEvidence,totalRows)}:{}),...(hasAppointment?{appointmentEvidence:checkedMhelpAppointmentEvidence(row.appointmentEvidence,totalRows,createdAfter)}:{})};
}
export function ticketPreviewGaps(preview:MhelpTicketPreview):string[] {
  const labels:Partial<Record<keyof TicketPreviewMetrics,string>>={missingAssignmentFields:'tickets with an unknown assignment field',missingTypeIds:'tickets missing a type ID',unknownTypeIds:'tickets with an unrecognized type ID',unknownStatusIds:'tickets with an unrecognized status ID',unknownCustomStatusIds:'tickets with an unrecognized custom status ID',missingCustomerIds:'tickets missing a customer ID',missingServiceLocationIds:'tickets missing a service-location ID',ticketsWithUnknownFields:'tickets with unrecognized source fields',typeLabelMismatches:'tickets whose type label differs from the type list',duplicateTypeNames:'duplicate type names requiring review'};
  return Object.entries(labels).filter(([key])=>preview.metrics[key as keyof TicketPreviewMetrics]>0).map(([key,label])=>{
    const n=preview.metrics[key as keyof TicketPreviewMetrics];
    return `${n} ${n===1?label.replace(/^tickets\b/,'ticket').replace(/^duplicate type names\b/,'duplicate type name'):label}`;
  });
}
