/** Client-only aggregate contract. Never import the server token or ticket reader modules here. */
export const ticketPreviewMetrics = ['deletedTickets','assignedTickets','missingAssignmentFields','missingTypeIds','unknownTypeIds','unknownStatusIds','unknownCustomStatusIds','missingCustomerIds','missingServiceLocationIds','ticketsWithUnknownFields','unknownFieldOccurrences','typeLabelMismatches','duplicateTypeNames'] as const;
export type TicketPreviewMetrics = Record<typeof ticketPreviewMetrics[number],number>;
export type MhelpTicketPreview = {
  contract:'cos-mhelpdesk-ticket-preview-v1';state:'preview_verified';liveAccessVerified:true;automaticSync:false;ticketWrites:false;
  verifiedPortalId:string;readAt:string;window:{createdAfter:string;createdBefore:string};totalRows:number;previewCount:number;partial:false;
  types:{typeId:string;portalId:string;typeName:string;isActive:boolean;count:number}[];
  statuses:{statusId:string;statusText:string;displayText:string;parentId:string|null;canBeParent:boolean;statusCount:number;customStatusCount:number}[];
  metrics:TicketPreviewMetrics;
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
/** Reject schema changes or partial/fabricated success before displaying any aggregate. */
export function checkedMhelpTicketPreview(value:unknown):MhelpTicketPreview {
  const row=record(value,['contract','state','liveAccessVerified','automaticSync','ticketWrites','verifiedPortalId','readAt','window','totalRows','previewCount','partial','types','statuses','metrics']);
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
    verifiedPortalId,readAt,window:{createdAfter,createdBefore},totalRows,previewCount:totalRows,partial:false,types,statuses,metrics};
}
export function ticketPreviewGaps(preview:MhelpTicketPreview):string[] {
  const labels:Partial<Record<keyof TicketPreviewMetrics,string>>={missingAssignmentFields:'tickets with an unknown assignment field',missingTypeIds:'tickets missing a type ID',unknownTypeIds:'tickets with an unrecognized type ID',unknownStatusIds:'tickets with an unrecognized status ID',unknownCustomStatusIds:'tickets with an unrecognized custom status ID',missingCustomerIds:'tickets missing a customer ID',missingServiceLocationIds:'tickets missing a service-location ID',ticketsWithUnknownFields:'tickets with unrecognized source fields',typeLabelMismatches:'tickets whose type label differs from the type list',duplicateTypeNames:'duplicate type names requiring review'};
  return Object.entries(labels).filter(([key])=>preview.metrics[key as keyof TicketPreviewMetrics]>0).map(([key,label])=>{
    const n=preview.metrics[key as keyof TicketPreviewMetrics];
    return `${n} ${n===1?label.replace(/^tickets\b/,'ticket').replace(/^duplicate type names\b/,'duplicate type name'):label}`;
  });
}
