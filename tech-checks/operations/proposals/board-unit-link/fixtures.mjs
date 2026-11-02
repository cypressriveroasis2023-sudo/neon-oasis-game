// Synthetic identifiers and records only.
export const ORG='11111111-1111-4111-8111-111111111111', OTHER='99999999-9999-4999-8999-999999999999';
export const JOB='22222222-2222-4222-8222-222222222222', UNIT='33333333-3333-4333-8333-333333333333';
export const ASSIGN='44444444-4444-4444-8444-444444444444', VISIT='55555555-5555-4555-8555-555555555555';
export const TASK='66666666-6666-4666-8666-666666666666', TRACKER='77777777-7777-4777-8777-777777777777';
export const ASOF='2026-11-02T19:00:00.000Z', OBS='2026-11-02T18:59:00.000Z', HASH='a'.repeat(64), PID='123456789';
export function fixture(){return {
 organizationId:ORG,asOf:ASOF,
 assignments:{contract:'COS_BOARD_ASSIGNMENTS_V1',organizationId:ORG,asOf:ASOF,readState:'current',complete:true,jobIds:[JOB],items:[{
  assignmentId:ASSIGN,jobId:JOB,unitId:UNIT,sameOrganization:true,assignmentType:'primary_job_unit',status:'active',
  releasedAt:null,assignedAt:'2026-11-01T12:00:00Z',unitStatus:'deployed',retiredAt:null
 }]},
 fleet:{organizationId:ORG,readState:'current',asOf:ASOF,value:{inventoryItems:[{
  id:UNIT,unitNumber:'Synthetic unit',status:'deployed',uploadProductId:PID,uploadLifecycle:'UNFLAGGED',uploadActiveInventoryEligible:true,
  uploadPlacementEvidence:{source:'mhelpdesk_api',state:'recorded',productId:PID,sourceSha256:HASH,observedAt:OBS}
 }],uploadInventory:{contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source:'mhelpdesk_api',sourceSha256:HASH,lastApiReadAt:OBS,
  summary:{totalRecords:1},missingProductIds:[],records:[{recordId:'mhelp_product:'+PID,productId:PID,unitNumber:'Different display alias',
   uploadLifecycle:'UNFLAGGED',observedAt:OBS,overlayApplied:true,binding:{state:'linked',unitIds:[UNIT,TRACKER],candidateUnitIds:[],placementHeld:false,matchMethod:'reviewed_product_id',reason:null}}]
 }}}
};}
