// Synthetic public Field Map DTOs only. These IDs and source proofs are never sent live.
export const stamp = '2026-10-06T18:00:00Z';
export const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
export const fieldUnit = () => ({id:ids[0], unitNumber:'Ranger 001', modelName:'Ranger', status:'field', currentLocationType:'field', address:'100 Synthetic Road', site:'Synthetic current field site', latitude:29.76, longitude:-95.37, hasUnitGps:true, readOnly:false, coordinateSource:'manual', locationVerification:'owner_verified', gpsRecordedAt:stamp, locationVerifiedAt:stamp});
export function inactiveUnit(index = 1, version = 1, readOnly = false) {
  const unitNumber = index === 1 ? 'Helios 401' : index === 2 ? 'Solar Stand 402' : 'Skid 403';
  return {id:ids[index], unitNumber, modelName:index === 1 ? 'Helios' : 'Support equipment', customer:'Synthetic retired customer', status:'inactive', currentLocationType:'inactive', importedPlacement:'INACTIVE', readOnly,
    placement:null, placementSource:null, placementAuditId:null, site:'INACTIVE / DO NOT USE', address:null, latitude:null, longitude:null, coordinateSource:null, hasUnitGps:false,
    // Old coordinates are allowed in raw inventory; Field Map must never consume them.
    historicalLatitude:30, historicalLongitude:-95, historicalCoordinateSource:'manual',
    importedInstallation:{entityKind:readOnly?'tracker':'equipment_unit',nativeUnitId:ids[index],...(version === 2 ? {sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Skid|403'} : {productId:'123'}),sourceRevision:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',eventId:'42',nativeGuardSha256:'a'.repeat(64),sourceFileSha256:'b'.repeat(64),sourceRowSha256:'c'.repeat(64),placement:'INACTIVE'}};
}
export function inventorySnapshot(inventory = [inactiveUnit(), inactiveUnit(2, 1, true), inactiveUnit(3, 2, true)], items = [fieldUnit()]) {
  return {items, inventoryItems:[...items,...inventory], summary:{fieldUnits:items.length,mappedUnits:items.length,unitGps:items.length,missingGps:0}, generatedAt:stamp};
}
