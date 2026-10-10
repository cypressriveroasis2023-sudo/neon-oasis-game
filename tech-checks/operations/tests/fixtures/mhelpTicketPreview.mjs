/** Synthetic aggregate only; no customer, ticket, assignee or credential records. */
export function ticketPreviewFixture(){return {
  contract:'cos-mhelpdesk-ticket-preview-v1',state:'preview_verified',liveAccessVerified:true,automaticSync:false,ticketWrites:false,
  verifiedPortalId:'224643',readAt:'2026-10-09T20:00:01.000Z',window:{createdAfter:'2026-10-09T05:00:00.000Z',createdBefore:'2026-10-09T20:00:00.000Z'},
  totalRows:3,previewCount:3,partial:false,
  types:[{typeId:'11',portalId:'224643',typeName:'Installation',isActive:true,count:2},{typeId:'12',portalId:'224643',typeName:'Service',isActive:true,count:1}],
  statuses:[{statusId:'1',statusText:'New',displayText:'New',parentId:null,canBeParent:true,statusCount:3,customStatusCount:0}],
  metrics:{deletedTickets:0,assignedTickets:2,missingAssignmentFields:1,missingTypeIds:0,unknownTypeIds:0,unknownStatusIds:0,unknownCustomStatusIds:0,missingCustomerIds:1,missingServiceLocationIds:1,ticketsWithUnknownFields:1,unknownFieldOccurrences:2,typeLabelMismatches:0,duplicateTypeNames:0}
};}
