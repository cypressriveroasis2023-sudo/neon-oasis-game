/** Synthetic aggregate only; no customer, ticket, assignee or credential records. */
export function ticketPreviewFixture(){return {
  contract:'cos-mhelpdesk-ticket-preview-v1',state:'preview_verified',liveAccessVerified:true,automaticSync:false,ticketWrites:false,
  verifiedPortalId:'224643',readAt:'2026-10-09T20:00:01.000Z',window:{createdAfter:'2026-10-09T05:00:00.000Z',createdBefore:'2026-10-09T20:00:00.000Z'},
  totalRows:3,previewCount:3,partial:false,
  types:[{typeId:'11',portalId:'224643',typeName:'Installation',isActive:true,count:2},{typeId:'12',portalId:'224643',typeName:'Service',isActive:true,count:1}],
  statuses:[{statusId:'1',statusText:'New',displayText:'New',parentId:null,canBeParent:true,statusCount:3,customStatusCount:0}],
  metrics:{deletedTickets:0,assignedTickets:2,missingAssignmentFields:1,missingTypeIds:0,unknownTypeIds:0,unknownStatusIds:0,unknownCustomStatusIds:0,missingCustomerIds:1,missingServiceLocationIds:1,ticketsWithUnknownFields:1,unknownFieldOccurrences:2,typeLabelMismatches:0,duplicateTypeNames:0}
};}

/** Synthetic count-only structural evidence, never source values. */
export function operationalEvidenceFixture({ticketCount=3,itemEntries=2,customEntries=1}={}){
  const sampledTickets=Math.min(ticketCount,50);
  const kinds=(kind,n)=>n?{[kind]:n}:{};
  const field=(kind,n=sampledTickets,format='other',emptyStrings=0)=>({kinds:kinds(kind,n),formats:kind==='string'?kinds(format,n):{},emptyStrings:kind==='string'?emptyStrings:0,nonemptyStrings:kind==='string'?n-emptyStrings:0});
  const collection=(totalEntries,shape)=>{
    if(!sampledTickets)totalEntries=0;
    const sampledEntries=Math.min(totalEntries,50),nonemptyArrays=totalEntries>0?1:0;
    return {kinds:kinds('array',sampledTickets),emptyArrays:sampledTickets-nonemptyArrays,nonemptyArrays,totalEntries,sampledEntries,entryKinds:kinds('object',sampledEntries),fields:Object.fromEntries(Object.entries(shape).map(([key,kind])=>[key,field(kind,sampledEntries)]))};
  };
  return {contract:'cos-mhelpdesk-operational-evidence-v1',scope:'first_ticket_page',ticketSampleLimit:50,nestedSampleLimit:50,sampledTickets,siteIdTickets:sampledTickets,
    fields:{subject:field('string',sampledTickets,'other',sampledTickets?1:0),summary:field('absent'),comment:field('null'),scheduledDate:field('string',sampledTickets,'iso_without_zone'),neededBy:field('absent'),serviceLocationId:field('integer')},
    collections:{items:collection(itemEntries,{ticketItemId:'integer',priceListId:'integer',priceListTypeId:'integer',name:'string',description:'absent',quantity:'number'}),customFields:collection(customEntries,{customFieldId:'integer',fieldValue:'string',fieldLabel:'string'})}
  };
}
export function ticketPreviewEvidenceFixture(options={}){
  const preview=ticketPreviewFixture(),ticketCount=options.ticketCount??preview.previewCount;
  if(ticketCount!==preview.previewCount){
    preview.totalRows=ticketCount;preview.previewCount=ticketCount;
    preview.types=preview.types.map((type,index)=>({...type,count:index===0?ticketCount:0}));
    preview.statuses=preview.statuses.map(status=>({...status,statusCount:ticketCount,customStatusCount:0}));
    preview.metrics=Object.fromEntries(Object.keys(preview.metrics).map(key=>[key,0]));
  }
  preview.statuses.push({statusId:'2',statusText:'Awaiting review',displayText:'Review queue',parentId:'1',canBeParent:false,statusCount:0,customStatusCount:ticketCount?1:0});
  return {...preview,operationalEvidence:operationalEvidenceFixture({...options,ticketCount})};
}

/** Synthetic singleton detail evidence. Field names are fixed, never source values. */
export function ticketDetailEvidenceFixture({ticketCount=1,itemEntries=2,customEntries=1,equipmentEntries=2,hasDescription=true}={}){
  const header={contract:'cos-mhelpdesk-ticket-detail-evidence-v1',scope:'single_server_selected_ticket'};
  if(ticketCount!==1)return {...header,state:'selection_unavailable',reason:ticketCount===0?'empty_window':'ambiguous_window',sampledTickets:0};
  const field=(kind,n=1,format='other')=>({kinds:n?{[kind]:n}:{},formats:kind==='string'&&n?{[format]:n}:{},emptyStrings:0,nonemptyStrings:kind==='string'?n:0});
  const fields=Object.fromEntries('subject summary comment customerId serviceLocationId categoryId priority typeId typeName statusId customStatusId ticketStatus assignedTo deleted creationDate lastModDate scheduledDate neededBy appointmentCount estimatedTime lastCalledDate nextCallDate parentTicketId originalTicketId recurringRuleId generatedByRecurring businessUnitId'.split(' ').map(key=>[key,field('absent')]));
  fields.subject=field(hasDescription?'string':'null');fields.customerId=field('integer');fields.serviceLocationId=field('integer');fields.ticketStatus=field('object');fields.deleted=field('boolean');
  fields.creationDate=field('string',1,'iso_with_zone');fields.lastModDate=field('string',1,'iso_with_zone');fields.scheduledDate=field('null');fields.neededBy=field('null');
  const collection=(totalEntries,shape)=>{
    const sampledEntries=Math.min(totalEntries,50);
    return {kinds:{array:1},emptyArrays:totalEntries?0:1,nonemptyArrays:totalEntries?1:0,totalEntries,sampledEntries,entryKinds:sampledEntries?{object:sampledEntries}:{},fields:Object.fromEntries(Object.entries(shape).map(([key,kind])=>[key,field(kind,sampledEntries)]))};
  };
  return {...header,state:'detail_verified',sampledTickets:1,nestedSampleLimit:50,fields,
    collections:{items:collection(itemEntries,{ticketItemId:'integer',ticketId:'integer',portalId:'integer',priceListId:'integer',priceListTypeId:'integer',name:'string',description:'null',quantity:'number',currentStatus:'string',notes:'string',startTime:'null',dateEntry:'null',durationSeconds:'integer',groupId:'integer',lastUpdateUTC:'null',sortNumber:'integer'}),customFields:collection(customEntries,{id:'integer',customFieldId:'integer',fieldValue:'string',fieldLabel:'string',sortOrder:'integer',isRequired:'boolean'}),equipment:collection(equipmentEntries,{})},
    availability:{description:hasDescription?'nonempty_text_present':'nonempty_text_absent',site:'unresolved_no_join',equipment:'unverified_write_model_candidate',schedule:'unverified_deprecated_get_fields',items:'unmapped_structures_only',customFields:'unmapped_structures_only'}};
}
export function ticketPreviewDetailFixture(options={}){
  const ticketCount=options.ticketCount??1;
  return {...ticketPreviewEvidenceFixture({...options,ticketCount}),detailEvidence:ticketDetailEvidenceFixture({...options,ticketCount})};
}
