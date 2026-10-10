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
