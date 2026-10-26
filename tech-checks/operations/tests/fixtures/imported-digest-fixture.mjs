import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function importedDigestFixture(){
 const binding={schemaVersion:1,organizationId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:'11111111-1111-4111-8111-111111111111',productId:'1',unitNumber:'HELIOS 10001',family:'HELIOS',variant:null,sourceRevision:'22222222-2222-4222-8222-222222222222',sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:hash('1 fixture st, houston, tx 77002'),nativeGuardSha256:'c'.repeat(64),installation:{street:'1 Fixture St',city:'Houston',state:'TX',zip:'77002'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 const row={id:binding.nativeUnitId,unitNumber:binding.unitNumber,readOnly:false,currentLocationType:'field',address:'1 Fixture St, Houston, TX 77002',importedInstallation:binding};
 return {snapshot:{items:[row],inventoryItems:[row],summary:{}},records:[{jobKind:'native_import',binding:structuredClone(binding),legacyGuardSha256:'d'.repeat(64),status:'no_match',verified:false,liveGps:false}],row};
}
