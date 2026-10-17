/** Draft Owner-only COS bridge. Not enabled until the independently reviewed
 * cos_owner_mhelp_equipment_stage_v1/commit_v1 migration has passed real
 * PostgreSQL + authenticated integration tests. NO direct table writes.
 */
import {previewMhelpEquipmentCsv,parseEquipmentCsv} from './mhelpEquipmentCsvPreview.ts';
import {read2027CensusFromGoogle,type VerifiedProductCensus} from './mhelp2027ProductCensus.ts';
import type {SheetsAssertionSigner} from './googleSheets.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
export type EquipmentSourceInput={bytesBase64:string;sourceFilename:string;expectedSha256?:string};
export type BridgeGoogle={getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch};
export type BridgeOptions={actorId:string;organizationId:string;previous:unknown;body:unknown;google:BridgeGoogle;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 verifyCensus?:typeof read2027CensusFromGoogle;
};
function invalid(message:string):never{throw new Error('Protected COS equipment admission: '+message);}
function input(body:unknown):EquipmentSourceInput{
 if(!body||typeof body!=='object'||Array.isArray(body))invalid('source file is required');
 const b=body as Record<string,unknown>;
 if(typeof b.bytesBase64!=='string'||typeof b.sourceFilename!=='string'||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(b.sourceFilename))invalid('original mHelp CSV required');
 return {bytesBase64:b.bytesBase64,sourceFilename:b.sourceFilename,
  ...(typeof b.expectedSha256==='string'?{expectedSha256:b.expectedSha256}:{})};
}
async function currentSource(o:BridgeOptions){
 if(!UUID.test(o.actorId)||!UUID.test(o.organizationId))invalid('authenticated actor required');
 const source=input(o.body),preview=await previewMhelpEquipmentCsv(source,o.previous);
 const bytes=Uint8Array.from(atob(source.bytesBase64),v=>v.charCodeAt(0));
 const rows=parseEquipmentCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 let census:VerifiedProductCensus;
 try{census=await (o.verifyCensus||read2027CensusFromGoogle)({...o.google,sourceFilename:source.sourceFilename,candidate:rows});}
 catch{invalid('CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED');}
 if(!census||census.verifiedBy!=='cos_sheets_service'||!HASH.test(census.sourceSha256)||census.total!==rows.length||census.productRows?.length!==rows.length||census.field!==preview.inventory.field||census.shop!==preview.inventory.shop)invalid('current 2027 Product ID membership failed');
 const previous=o.previous as {sourceSha256?:unknown};
 if(!previous||typeof previous.sourceSha256!=='string'||!HASH.test(previous.sourceSha256))invalid('last reviewed source guard unavailable');
 return {source,preview,rows,census,expected:previous.sourceSha256};
}
function stageReceipt(value:unknown,source:string,expectedCount:number):Record<string,unknown>{
 const v=value as Record<string,unknown>;
 if(!v||typeof v!=='object'||v.contract!=='COS_OWNER_EQUIPMENT_STAGE_V1'||v.sourceSha256!==source||v.productIdsMatched!==expectedCount||v.previewOnly!==true||v.readyToCommit!==false||!UUID.test(String(v.stageId||'')))invalid('transactional stage receipt not accepted');
 return {contract:v.contract,stageId:v.stageId,sourceSha256:v.sourceSha256,productIdsMatched:v.productIdsMatched,
  recordedField:v.recordedField,recordedShop:v.recordedShop,expiresInMinutes:v.expiresInMinutes,
  previewOnly:true,readyToCommit:false};
}
export async function stageOwnerEquipmentCsv(o:BridgeOptions&{requestId:string}){
 if(!UUID.test(o.requestId))invalid('stable unique staging request required');
 const {source,preview,rows,census,expected}=await currentSource(o);
 const result=await o.rpc('cos_owner_mhelp_equipment_stage_v1',{
  p_actor_user_id:o.actorId,p_organization_id:o.organizationId,p_request_id:o.requestId,
  p_filename:source.sourceFilename,p_source_sha256:preview.sourceSha256,
  p_expected_active_sha256:expected,p_current_2027_sha256:census.sourceSha256,
  p_current_2027_rows:census.productRows,p_original_bytes_base64:source.bytesBase64,
  p_records:rows,
 });
 const receipt=stageReceipt(result,preview.sourceSha256,rows.length);
 if(receipt.recordedField!==rows.filter(r=>r.placement==='FIELD').length||receipt.recordedShop!==rows.filter(r=>r.placement==='SHOP').length)invalid('stage Field/Shop count disagrees with complete source');
 return receipt;
}
export async function commitOwnerEquipmentCsv(o:BridgeOptions&{stageId:string;confirmationText:string}){
 if(!UUID.test(o.stageId)||typeof o.confirmationText!=='string'||o.confirmationText.trim().length<24||o.confirmationText.length>800)invalid('explicit Owner stage approval required');
 // Full original SHA + fresh current Google 2027 read REPEATED on commit.
 const {preview,census,expected,rows}=await currentSource(o);
 const result=await o.rpc('cos_owner_mhelp_equipment_commit_v1',{
  p_actor_user_id:o.actorId,p_organization_id:o.organizationId,p_stage_id:o.stageId,
  p_expected_previous_source_sha256:expected,p_current_2027_sha256:census.sourceSha256,
  p_confirmation_text:o.confirmationText,
 });
 const v=result as Record<string,unknown>;
 if(!v||v.contract!=='COS_OWNER_EQUIPMENT_COMMIT_V1'||v.sourceSha256!==preview.sourceSha256||v.applied!==true||v.sourceReceiptsApplied!==true||v.records!==rows.length||v.recordedField!==census.field||v.recordedShop!==census.shop)invalid('COS production did not return a complete verified commit receipt');
 return {contract:v.contract,stageId:o.stageId,sourceSha256:v.sourceSha256,
  records:v.records,field:v.recordedField,shop:v.recordedShop,
  applied:true,sourceReceiptsApplied:true};
}