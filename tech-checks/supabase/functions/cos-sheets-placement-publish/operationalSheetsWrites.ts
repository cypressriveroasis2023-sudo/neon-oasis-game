import {OPERATIONAL_SHEETS_TABS,type Outbound,type SheetRow,type Fields} from './operationalSyncModel.ts';
type CellRequest={updateCells:{range:{sheetId:number;startRowIndex:number;endRowIndex:number;startColumnIndex:number;endColumnIndex:number};rows:[{values:[{userEnteredValue:{stringValue:string}}]}];fields:'userEnteredValue'}};
const safe=(v:string)=>typeof v==='string'&&v.length<=600&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/^[-+=@]/.test(v);
const fields=['placement','customer','site','address'] as const;
const values=(f:Fields)=>[f.placement,f.customer,f.site,f.address];
/** Up to sixty distinct Product IDs per run, and no identity, camera, IP,
 * SIM, formula, password, background-format or nonoperational Sheet writes. */
export function operationalUpdateCells(outbound:Outbound[]):CellRequest[]{
 if(!Array.isArray(outbound)||outbound.length>60)throw Error('Too many operational writes in one Sheets batch');
 const result:CellRequest[]=[],seen=new Set<string>();
 for(const x of outbound){
  const tab=OPERATIONAL_SHEETS_TABS.find(t=>t.id===x.sheetId);
  if(!tab||x.row<2||x.row>10000||x.columns.join(',')!==tab.columns.join(',')
   ||seen.has(x.productId)||x.revision<1||typeof x.label!=='string'||!x.label)
    throw Error('An operational writer target is not uniquely verified');
  seen.add(x.productId);
  const old=values(x.oldFields),next=values(x.newFields);
  for(let i=0;i<fields.length;i++){
   const value=next[i];if(!safe(value))throw Error('Unsafe operational cell');
   if(i===0&&!['FIELD','SHOP'].includes(value))throw Error('Unsupported operational status');
   if(old[i]===value)continue;
   const col=tab.columns[i+1];
   result.push({updateCells:{range:{sheetId:x.sheetId,startRowIndex:x.row-1,endRowIndex:x.row,
    startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[{userEnteredValue:{stringValue:value}}]}],fields:'userEnteredValue'}});
  }
 }
 return result;
}
/** An acknowledged Google POST is not proof of durable publication.
 * Re-read exact Sheet row identity and all operational values first. */
export function verifiedOperationalReadback(outbound:Outbound[],rows:SheetRow[]){
 const current=new Map(rows.map(r=>[r.sheetId+':'+r.row,r]));
 return outbound.map(x=>{
  const key=x.sheetId+':'+x.row,r=current.get(key);
  const good=r&&r.label===x.label&&r.formula!==true
   &&r.fields.placement===x.newFields.placement&&r.fields.customer===x.newFields.customer
   &&r.fields.site===x.newFields.site&&r.fields.address===x.newFields.address;
  return {productId:x.productId,requestId:x.requestId,revision:x.revision,
   state:good?'published' as const:'readback_mismatch' as const};
 });
}
