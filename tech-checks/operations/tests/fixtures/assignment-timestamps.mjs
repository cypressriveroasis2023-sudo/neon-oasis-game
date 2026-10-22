import {createHash} from 'node:crypto';
import {parseEquipmentCsv} from '../../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';

/** Entirely synthetic identities, assignments and evidence. Only the five
 * regression Product IDs/labels identify the workflow cases under review. */
export const changedProducts=['2226860','2300344','2229407','2229931','2233383'];
const labels=['Spotter 261HDC2','Solar Spotter 054','Solar Spotter 008','Solar Stand 015','Solar Spotter 013'];
const uuid=(kind,index)=>`${kind.repeat(8)}-${kind.repeat(4)}-4${kind.repeat(3)}-8${kind.repeat(3)}-${String(index+1).padStart(12,'0')}`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeAssignment=row=>({placement:row.placement,customer:row.customer,customerId:row.customerId,address:row.sourceAddress});

export function assignmentTimestampFixture(){
 const stageId='11111111-1111-4111-8111-111111111111',actorId='22222222-2222-4222-8222-222222222222',organizationId='33333333-3333-4333-8333-333333333333';
 const filename='ServiceItem_List_20261020172623.csv';
 const csvRows=Array.from({length:1001},(_,index)=>{
  const field=index===4||index>=5&&index<288;
  return {productId:changedProducts[index]||String(8000000+index),unitNumber:labels[index]||`Synthetic unit ${index}`,category:index===3?'Solar Stand':'Camera',customerId:field?'100':'39383726',customer:field?'Synthetic field customer':'Cameras OnSite',sourceAddress:{street:field?'100 Synthetic Way':'200 Synthetic Shop Way',city:'Test City',state:'TX',zip:'77064'}};
 });
 const csv=['ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip',...csvRows.map(r=>[r.productId,r.unitNumber,r.customerId,r.customer,r.category,r.sourceAddress.street,r.sourceAddress.city,r.sourceAddress.state,r.sourceAddress.zip].join(','))].join('\n')+'\n';
 const rows=parseEquipmentCsv(csv),sourceSha256=sha(csv),censusSha256='b'.repeat(64);
 const oldRows=rows.map((row,index)=>index>=5?structuredClone(row):{...structuredClone(row),placement:index===4?'SHOP':'FIELD',customerId:index===4?'39383726':'900',customer:index===4?'Cameras OnSite':'Synthetic old customer'});
 const items=rows.slice(0,354).map((row,index)=>{
  const nativeUnitId=index===3?null:uuid('a',index),trackerId=uuid('b',index),shopReceipt=index===0||index===1;
  const timestampOnly=index===0||index===3||index>=5&&index<347;
  const historical=index===4||index>=347;
  const before=safeAssignment(oldRows[index]),after=safeAssignment(row);
  const currentAssignment={productId:row.productId,customerId:before.customerId,placement:before.placement,serviceLocationId:'synthetic-site-'+index,observedAt:'2026-10-20T17:36:07.336985+00:00'};
  const previousAssignment={...currentAssignment,observedAt:`2026-10-13 08:09:49.${String(600000+index)}+00`,...(historical?{customerId:'999',serviceLocationId:'synthetic-old-site-'+index}:{})};
  return {productId:row.productId,unitNumber:row.unitNumber,before,after,
   identity:{nativeUnitId,nativeLabel:nativeUnitId?row.unitNumber:null,trackerId,trackerLabel:row.unitNumber},
   current:{nativePlacement:nativeUnitId?(shopReceipt?'SHOP':before.placement):null,nativeStatus:nativeUnitId?'available':null,internalTrackerPlacement:before.placement,internalTrackerCustomer:'Synthetic old tracker customer',internalTrackerSite:'Synthetic old tracker site',gpsPresent:index===4,shopReceiptId:shopReceipt?uuid('c',index):null,shopRecordedAt:shopReceipt?'2026-10-20 12:00:00.123456+00':null},
   guardChanged:shopReceipt,eligible:true,blocker:null,sourceAssignmentChanged:index<5,
   continuity:timestampOnly||historical?{kind:historical?'assignment_difference':'timestamp_only',previousAssignment,currentAssignment}:null};
 });
 const review={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId,sourceSha256,censusSha256,reviewDigest:sha(JSON.stringify(items)),approved:false,items};
 const census={contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',sourceSha256:censusSha256,observedAt:'2026-10-21T21:39:00Z',verifiedBy:'cos_sheets_service',productIds:rows.map(r=>r.productId),productRows:rows.map(r=>({productId:r.productId,unitLabel:r.unitNumber,family:r.category,placement:r.placement,customer:r.customer})),total:1001,field:284,shop:717,sourceExport:filename};
 const options={stageId,actorId,organizationId,body:{sourceFilename:filename,bytesBase64:Buffer.from(csv).toString('base64')},previous:{contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'a'.repeat(64),records:oldRows},google:{getServiceAccountJson:()=>null},verifyCensus:async()=>structuredClone(census)};
 return {options,review,rows,census};
}
