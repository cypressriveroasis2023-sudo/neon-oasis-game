// Synthetic unit tags, record IDs, hashes, and dates never represent fleet records.
// The organization constant matches the existing public handler contract.
import {cameraSummary} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
export const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',ID='11111111-1111-4111-8111-111111111111',TID='22222222-2222-4222-8222-222222222222',REV='33333333-3333-4333-8333-333333333333';
export const clone=v=>structuredClone(v),now=Date.parse('2001-01-15T12:00:00Z');
export function fixture(name='Helios 990001',family='Helios',tag='990001',kind='equipment_unit'){
 const tracker=[{canonical_family:family,unit_tag:tag,source_label:name,tracker_state:'field_or_unknown',health_provider:null}];
 const source={schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:kind,nativeUnitId:ID,productId:'990000001',unitNumber:name,sourceRevision:REV,eventId:'990000002',sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),nativeGuardSha256:'c'.repeat(64),placement:'SHOP',eligibility:'tombstone',installation:null,addressSha256:null,suppliedComponents:null,nativeSourceIdentity:null};
 if(kind==='equipment_unit')source.nativeSourceIdentity={contract:'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',nativeUnitId:ID,productId:source.productId,unitNumber:name,trackerId:TID,trackerUnitNumber:name,sourceRevision:REV,sourceFileSha256:source.sourceFileSha256,sourceRowSha256:source.sourceRowSha256,nativeGuardSha256:source.nativeGuardSha256};
 const before={inventory:[{id:ID,unitNumber:name,readOnly:kind==='tracker',_sourceField:true}],sources:[source],nativeUnits:kind==='tracker'?[]:[{id:ID,unit_number:name,organization_id:ORG,status:'available'}],devices:[],audits:[],matches:[],ownerClaims:[],identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]}};
 const summary=cameraSummary([],[],now,tracker,[]);
 return {summary,tracker,before,after:clone(before)};
}
export function mhelpReceiptFor(f,changes={}){
 const source=f.before.sources[0],native=source.entityKind==='equipment_unit';
 return {contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:new Date(now).toISOString(),items:[{trackerId:native?source.nativeSourceIdentity.trackerId:source.nativeUnitId,nativeUnitId:native?source.nativeUnitId:null,trackerLabel:source.unitNumber,nativeLabel:native?source.unitNumber:null,guardCurrent:true,state:'confirmed',placement:'SHOP',customerLabel:'Synthetic shop',siteLabel:'Synthetic shop',observedAt:new Date(now).toISOString(),locationReview:false,...changes}]};
}
