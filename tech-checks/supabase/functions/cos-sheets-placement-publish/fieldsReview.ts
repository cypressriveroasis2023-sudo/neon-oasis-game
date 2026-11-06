/** Read-only manifest construction. The caller must obtain explicit approval of
 * the exact returned manifest before invoking the private administrator function.
 * Historical row locators are never accepted as current CellData evidence. */
import {equal} from './model.ts';
import {FIELDS_CONTRACT,validFieldBaseline,planFields} from './fields.ts';
type Row=Record<string,any>;
export function reviewPublisherFields(input:{bindings:Row[];first:Row[];second:Row[];readAt:string;now:number;sourceSha256:string}){
 const {bindings,first,second,readAt,now,sourceSha256}=input;
 const at=Date.parse(readAt);
 if(!Number.isFinite(at)||!Number.isFinite(now)||at>now||now-at>120000||!sourceSha256.match(/^[a-f0-9]{64}$/)
 ||!Array.isArray(bindings)||bindings.length<1||bindings.length>434||new Set(bindings.map(b=>b.equipmentId)).size!==bindings.length
 ||!equal(first,second))throw Error('Fresh identical full reads required');
 const items:Row[]=[],held:Row[]=[];
 for(const b of bindings){
  const matches=second.filter(r=>r.sheetId===b.sheetId&&r.row===b.row),r=matches[0];
  const hold=(reason:string)=>held.push({equipmentId:b.equipmentId,reason});
  if(matches.length!==1||!r.unique||r.label!==b.label||!equal(r.cells,b.baseline)||b.pending||b.fields?.pending){hold('binding_or_cell_changed');continue;}
  if(b.fields&&!equal(b.fields.baseline?.index?.cells?.[4]?.note,r.fields?.index?.cells?.[4]?.note)){hold('provenance_note_changed');continue;}
  if(!b.sourceCurrent||b.observation?.state!=='confirmed'||!b.fieldSource||b.fieldSource.sourceSha256!==sourceSha256
   ||!b.authorizationSha256?.match(/^[a-f0-9]{64}$/)||!validFieldBaseline(r.fields,b)){hold('source_or_fields_unverified');continue;}
  const check=planFields({...b,fields:{contract:FIELDS_CONTRACT,baseline:r.fields,pending:null,source:b.fieldSource}},r);
  if(check.reason){hold(check.reason);continue;}
  items.push({equipmentId:b.equipmentId,location:{sheetId:b.sheetId,row:b.row,label:b.label,authorizationSha256:b.authorizationSha256},legacyBaseline:b.baseline,fields:r.fields,source:b.fieldSource});
 }
 return {approvalRequired:true,executable:false,held,manifest:{contract:'COS_PUBLISHER_FIELDS_REVIEW_V1',readAt,sourceSha256,items}};
}
