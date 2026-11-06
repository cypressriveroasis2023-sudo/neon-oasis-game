/** Opt-in extension of the existing publisher, not the separate two-way worker.
 * Column/header mappings follow PR228's reviewed operational Google reader.
 * H remains historical CSV identity; only its reviewed note describes API provenance. */
import {equal,cellText,tabLayout,snapshotCell} from './model.ts';
type Row=Record<string,any>;
export const FIELDS_CONTRACT='COS_PUBLISHER_FIELDS_V1';
export const INDEX={id:1900169011,title:'MHELP MATCH INDEX',columns:[0,1,3,4,7],headers:['TRACKER MATCH KEY','MHELP EQUIPMENT ID','MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE','MHELP SOURCE EXPORT']};
export const addressColumn=(id:number)=>{tabLayout(id);return id===828079282?3:5;};
export const addressHeader=(id:number)=>id===828079282?'Location / Address':'PHYSICAL ADDRESS';
export function fieldCell(v:any){
 if(v?.note!==undefined&&(typeof v.note!=='string'||v.note.length>4096))throw Error('Malformed tracker cell');
 return {...snapshotCell(v),note:v?.note??null};
}
const text=(v:unknown,max=600):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const safe=(c:Row,value:string)=>!c.rich&&cellText(c)!==null&&(!c.validation||c.validation.condition?.type==='ONE_OF_LIST'&&c.validation.condition.values?.some((x:Row)=>x.userEnteredValue===value));
export function validFieldBaseline(v:any,b:Row):boolean{
 return !!v&&Object.keys(v).sort().join(',')==='address,index'&&Array.isArray(v.index?.cells)&&v.index.cells.length===5
  &&Object.keys(v.index).sort().join(',')==='cells,row'&&Number.isSafeInteger(v.index.row)&&v.index.row>=2&&v.index.row<=10000
  &&cellText(v.index.cells[0])===tabLayout(b.sheetId).title+'|'+b.label&&cellText(v.index.cells[1])===b.equipmentId
  &&/^ServiceItem_List_[0-9]{14}\.csv$/.test(cellText(v.index.cells[4])??'')
  &&[v.address,...v.index.cells].every(c=>c&&Object.keys(c).sort().join(',')==='entered,note,rich,validation'
   &&typeof c.rich==='boolean'&&!c.rich&&c.entered&&typeof c.entered==='object'&&!Array.isArray(c.entered)
   &&Object.keys(c.entered).every(k=>k==='stringValue')&&cellText(c)!==null&&text(cellText(c)?.replace(/[\t\r\n]/g,''))
   &&(c.validation===null||typeof c.validation==='object'&&!Array.isArray(c.validation)&&JSON.stringify(c.validation).length<=4096)
   &&(c.note===null||typeof c.note==='string'&&c.note.length<=4096));
}
export function planFields(b:Row,r:Row):{reason?:string;cells?:Row;requests?:Row[]}{
 const f=b.fields;
 if(!f)return {};
 if(f.contract!==FIELDS_CONTRACT||!validFieldBaseline(f.baseline,b)||!validFieldBaseline(r.fields,b))return {reason:'sheet_identity_changed'};
 if(b.pending&&f.pending&&equal(r.fields,f.pending))return {cells:r.fields,requests:[]};
 if(!equal(r.fields,f.baseline))return {reason:'manual_sheet_change'};
 const s=f.source;
 if(!s||s.contract!==FIELDS_CONTRACT||s.equipmentId!==b.equipmentId||typeof s.sourceSha256!=='string'||!s.sourceSha256.match(/^[a-f0-9]{64}$/)||typeof s.payloadSha256!=='string'||!s.payloadSha256.match(/^[a-f0-9]{64}$/)
   ||!text(s.equipmentName)||!s.equipmentName.trim()||!text(s.customerSite)||!s.customerSite.trim()
   ||s.address!==null&&(!text(s.address)||!s.address.trim())||typeof s.provenanceNote!=='string'||s.provenanceNote.length>4096
   ||!s.provenanceNote.includes('COS current mHelp API snapshot\n')||!s.provenanceNote.includes(s.sourceSha256))return {reason:'source_unverified'};
 // Unknown address is not an instruction to erase or to keep an old site's
 // address alongside a newly published assignment. Hold this entire Product ID.
 if(s.address===null&&cellText(f.baseline.address)!=='')return {reason:'source_unverified'};
 const cells=structuredClone(f.baseline),requests:Row[]=[];
 const update=(sheetId:number,row:number,column:number,c:Row,value:string)=>{
  if(cellText(c)===value)return;
  if(!safe(c,value))throw Error('sheet_validation');
  c.entered={stringValue:value};requests.push({updateCells:{range:{sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:column,endColumnIndex:column+1},rows:[{values:[{userEnteredValue:{stringValue:value}}]}],fields:'userEnteredValue'}});
 };
 try{
  if(s.address!==null)update(b.sheetId,b.row,addressColumn(b.sheetId),cells.address,s.address);
  update(INDEX.id,cells.index.row,3,cells.index.cells[2],s.equipmentName);
  update(INDEX.id,cells.index.row,4,cells.index.cells[3],s.customerSite);
  if(cells.index.cells[4].note!==s.provenanceNote){cells.index.cells[4].note=s.provenanceNote;requests.push({updateCells:{range:{sheetId:INDEX.id,startRowIndex:cells.index.row-1,endRowIndex:cells.index.row,startColumnIndex:7,endColumnIndex:8},rows:[{values:[{note:s.provenanceNote}]}],fields:'note'}});}
 }catch{return {reason:'sheet_validation'};}
 if(f.pending&&!equal(cells,f.pending))return {reason:'pending_write_changed'};
 return {cells,requests};
}
export function assertFieldRequest(r:Row):boolean{
 const u=r?.updateCells,g=u?.range;
 if(!u||!g)return false;
 const index=g.sheetId===INDEX.id;
 if(!(index&&[3,4,7].includes(g.startColumnIndex)||!index&&g.startColumnIndex===addressColumn(g.sheetId)))return false;
 const note=index&&g.startColumnIndex===7,field=note?'note':'userEnteredValue',value=u.rows?.[0]?.values?.[0];
 return Object.keys(r).join(',')==='updateCells'&&Object.keys(u).sort().join(',')==='fields,range,rows'
  &&Object.keys(g).sort().join(',')==='endColumnIndex,endRowIndex,sheetId,startColumnIndex,startRowIndex'
  &&Number.isSafeInteger(g.startRowIndex)&&g.startRowIndex>=1&&g.startRowIndex<10000&&g.endRowIndex===g.startRowIndex+1&&g.endColumnIndex===g.startColumnIndex+1
  &&u.fields===field&&u.rows.length===1&&Object.keys(u.rows[0]).join(',')==='values'&&u.rows[0].values.length===1&&value&&Object.keys(value).join(',')===field
  &&(note?typeof value.note==='string'&&value.note.length<=4096&&value.note.includes('COS current mHelp API snapshot\n')
   :value.userEnteredValue&&Object.keys(value.userEnteredValue).join(',')==='stringValue'&&text(value.userEnteredValue.stringValue));
}
