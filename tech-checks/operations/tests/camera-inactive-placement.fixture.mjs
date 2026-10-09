// Synthetic source identity only; no real unit, provider, or saved session data.
import {projectImportedSourceAddresses} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
export const inactiveUnitId='11111111-1111-4111-8111-111111111111';
export function inactiveSource({version=1,tracker=version===2}={}){
 return {schemaVersion:version,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:version===1?'mhelpdesk_product_import':'google_sheet_tracker',entityKind:tracker?'tracker':'equipment_unit',nativeUnitId:inactiveUnitId,...(version===1?{productId:'12345'}:{sourceRecordId:'google_sheet:synthetic_sheet_123:0:Inventory|row_1'}),unitNumber:'Ranger 001',family:'RANGER',variant:null,sourceRevision:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),nativeGuardSha256:'c'.repeat(64),installation:null,suppliedComponents:null,addressSha256:null,eligibility:'tombstone',eventId:'1',placement:'INACTIVE',siteLabel:'Synthetic source inventory'};
}
export async function inactiveSnapshot({version=1,tracker=version===2}={}){
 const raw={id:inactiveUnitId,unitNumber:'Ranger 001',readOnly:tracker,modelName:'RANGER',_sourceField:false,status:'available',site:null,address:null,installedSiteId:null,currentLocationType:null,activeJobNumber:null,hasUnitGps:false,latitude:null,longitude:null,coordinateSource:null,gpsRecordedAt:null,locationVerification:'address_only',locationVerifiedAt:null,locationHistoryId:null,locationNote:null,recordSource:tracker?'Tracker inventory':'Native equipment'};
 const snapshot={items:[],inventoryItems:[raw],placementReviews:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:new Date().toISOString()};
 return projectOwnerPlacement(await projectImportedSourceAddresses(snapshot,[inactiveSource({version,tracker})],[],[]),[],[]);
}
export const inactiveHealth=()=>({evidenceVersion:2,identityVersion:1,rows:[{id:11,unit:'RANGER 001',trackerOnly:false}],unitIdentities:[],identityWarnings:[]});
export const inactiveState=()=>({unitKey:'RANGER 001',placement:'FIELD',auditId:null,siteLabel:'Provider organization only',streetAddress:'',canMove:true});
