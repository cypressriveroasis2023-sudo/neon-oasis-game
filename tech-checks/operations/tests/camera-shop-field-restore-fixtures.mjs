// Entirely synthetic regression data. Never send these identities or addresses to a live service.
export const key='SOLARSPOTTER 987654';
export const unitNumber='Solar Spotter 987654';
export const rowId='98765400-1111-4111-8111-111111111111';
export const otherId='98765400-2222-4222-8222-222222222222';
export const historyId='98765400-3333-4333-8333-333333333333';
export const stamp='2026-10-08T11:00:00.000Z';
export const oldAddress='100 Former Synthetic Fixture Rd, Testville, TX 77001';
export const newAddress='200 New Synthetic Fixture Rd, Testville, TX 77002';
export const site='Synthetic installation destination';
export const deviceIds=['9101','9102','9103','9104'];
export const legacyState=(patch={})=>({unitKey:key,placement:'SHOP',siteLabel:'',streetAddress:'',auditId:null,canMove:true,...patch});
export const nativeRow=(patch={})=>({id:rowId,unitNumber,modelName:'SOLAR SPOTTER',status:'field',currentLocationType:null,installedSiteId:null,activeJobNumber:null,site:'',address:oldAddress,addressSource:'2027 Unit Tracker',readOnly:false,recordSource:'2027 Unit Tracker',hasUnitGps:false,latitude:null,longitude:null,coordinateSource:null,gpsRecordedAt:null,locationVerification:'address_only',locationVerifiedAt:null,locationHistoryId:null,...patch});
export const envelope=(rows=[nativeRow()],fieldRows=rows)=>({items:fieldRows,inventoryItems:rows,placementReviews:[],summary:{fieldUnits:fieldRows.length,mappedUnits:0,unitGps:0,missingGps:fieldRows.length},generatedAt:stamp});
export const healthEnvelope=(patch={})=>({evidenceVersion:2,identityVersion:1,rows:deviceIds.map(id=>({id:Number(id),unit:key,trackerOnly:false,scope:'shop',activationState:'deactivated'})),unitIdentities:[{unitId:rowId,unitNumber,kind:'native_provider',deviceIds:[...deviceIds],unitKeys:[key],proof:'a'.repeat(64)}],identityWarnings:[],...patch});
