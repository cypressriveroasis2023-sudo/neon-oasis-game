/** Owner-only orchestration for a full private mHelp CSV preview.
 * Injection keeps the 2027 Sheet reader mockable. This has NO write path and
 * a read error can only remove proof, never grant admission.
 */
import {previewMhelpEquipmentCsv,parseEquipmentCsv,type EquipmentPreview} from './mhelpEquipmentCsvPreview.ts';
import {prepareMhelpEquipmentAdmission,summarizeMhelpAdmission} from './mhelpEquipmentAdmissionPlan.ts';
import {read2027CensusFromGoogle,type VerifiedProductCensus} from './mhelp2027ProductCensus.ts';
import type {SheetsAssertionSigner} from './googleSheets.ts';

export type OwnerEquipmentReview = EquipmentPreview & {
  admission:ReturnType<typeof summarizeMhelpAdmission>;
  censusStatus:'verified'|'unavailable';
};
export async function ownerEquipmentCsvReview(args:{
  body:unknown;previous:unknown;
  google:{getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch};
  verifyCensus?:typeof read2027CensusFromGoogle;
}):Promise<OwnerEquipmentReview>{
 const request=args.body as {bytesBase64:string;sourceFilename?:string;expectedSha256?:string};
 const filename=request?.sourceFilename;
 if(typeof filename!=='string'||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(filename))throw Error('Invalid mHelpDesk equipment CSV: source filename required');
 const preview=await previewMhelpEquipmentCsv({bytesBase64:request.bytesBase64,...(request.expectedSha256?{expectedSha256:request.expectedSha256}:{})},args.previous);
 // Parsing twice for the same bounded bytes does not create authority; the
 // first parse includes SHA-256 validation against unmodified source bytes.
 const bytes=Uint8Array.from(atob(request.bytesBase64),x=>x.charCodeAt(0));
 const rows=parseEquipmentCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 let census:VerifiedProductCensus|undefined;
 if(filename){
  try{census=await (args.verifyCensus??read2027CensusFromGoogle)({
   ...args.google,sourceFilename:filename,candidate:rows,
  });}catch{/* Fail closed: preview remains readable; never claim current source authority. */}
 }
 const previous=args.previous as {sourceSha256:string};
 const plan=prepareMhelpEquipmentAdmission(rows,args.previous,{
  sourceSha256:preview.sourceSha256,expectedActiveSourceSha256:previous.sourceSha256,
  ...(census?{tracker:census}:{}),currentNativeGuardsVerified:false,
 });
 return {...preview,admission:summarizeMhelpAdmission(plan),
  censusStatus:census?'verified':'unavailable'};
}
