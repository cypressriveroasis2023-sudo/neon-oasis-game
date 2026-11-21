import {planFields,assertFieldRequest} from './fields.ts';
import {UNIT_TRACKER_WORKBOOK} from '../cos-operations-pages/unitTracker.ts';
import {TRACKER_TABS} from '../cos-operations-pages/googleSheets.ts';
export {UNIT_TRACKER_WORKBOOK};
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const equal=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const tabLayout=(id:number)=>{const tab=TRACKER_TABS.find(t=>t.id===id);if(!tab)throw Error('Unsupported tracker tab');return {...tab,columns:[0,...(id===828079282?[5,4,2]:[1,3,4])],headers:id===828079282?['Unit','Status','Customer','Site Name / Project']:['UNIT #','PLACEMENT','CUSTOMER','SITE / PROJECT']};};
export function snapshotCell(v:any){
 if(v!==undefined&&!object(v))throw Error('Malformed tracker cell');
 return {entered:v?.userEnteredValue??{},validation:v?.dataValidation??null,rich:Boolean(v?.chipRuns?.length||v?.textFormatRuns?.length)};
}
export const cellText=(c:Row)=>typeof c?.entered?.stringValue==='string'?c.entered.stringValue:Object.keys(c?.entered??{}).length===0?'':null;
export function trackerRanges(metadata:Row,bindings?:Row[]){
 if(metadata?.spreadsheetId!==UNIT_TRACKER_WORKBOOK||metadata?.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(metadata.sheets))throw Error('Wrong tracker workbook');
 const ranges:string[]=[];
 for(const tab of TRACKER_TABS){const matches=metadata.sheets.filter((s:Row)=>s?.properties?.sheetId===tab.id),p=matches[0]?.properties;
  if(matches.length!==1||p.title!==tab.title||p.sheetType!=='GRID'||p.hidden===true||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount<2||p.gridProperties.rowCount>10000||p.gridProperties.columnCount<6)throw Error('Tracker layout changed');
  const last=bindings?Math.min(p.gridProperties.rowCount,Math.max(1,...bindings.filter(b=>b.sheetId===tab.id).map(b=>b.row))):p.gridProperties.rowCount;
  if(!Number.isSafeInteger(last)||last<1)throw Error('Invalid publisher bindings');
  for(const col of tabLayout(tab.id).columns)ranges.push("'"+tab.title.replaceAll("'","''")+"'!"+String.fromCharCode(65+col)+'1:'+String.fromCharCode(65+col)+(col===0?p.gridProperties.rowCount:last));
 }
 return ranges;
}
export function projectTracker(metadata:Row,grid:Row){
 trackerRanges(metadata);if(grid?.spreadsheetId!==UNIT_TRACKER_WORKBOOK||grid?.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(grid.sheets))throw Error('Incomplete tracker read');
 const result:Row[]=[];
 for(const tab of TRACKER_TABS){
  const p=metadata.sheets.find((s:Row)=>s.properties.sheetId===tab.id).properties;
  const matches=grid.sheets.filter((s:Row)=>s?.properties?.sheetId===tab.id),s=matches[0],layout=tabLayout(tab.id);
  if(matches.length!==1||!equal(s.properties,p)||!Array.isArray(s.data)||s.data.length!==4)throw Error('Tracker changed during read');
  const columns=new Map<number,Row[]>();
  for(const g of s.data){const col=g.startColumn??0;
   if((g.startRow??0)!==0||!layout.columns.includes(col)||columns.has(col)||!Array.isArray(g.rowData)||g.rowData.length>p.gridProperties.rowCount)throw Error('Unexpected tracker range');
   columns.set(col,g.rowData.map((r:Row)=>{if(!object(r)||(r.values!==undefined&&(!Array.isArray(r.values)||r.values.length>1)))throw Error('Unexpected tracker cells');return snapshotCell(r.values?.[0]);}));
  }
  const all=layout.columns.map(c=>columns.get(c)!);
  if(layout.headers.some((h,i)=>cellText(all[i][0])!==h||all[i][0]?.rich))throw Error('Tracker headers changed');
  const seen=new Map<string,number>();
  for(let i=1;i<all[0].length;i++){const label=cellText(all[0][i]);if(label)seen.set(label,(seen.get(label)??0)+1);}
  for(let i=1;i<all[0].length;i++){const label=cellText(all[0][i]);if(label)result.push({sheetId:tab.id,row:i+1,label,unique:seen.get(label)===1,cells:all.map(c=>c[i]??snapshotCell(undefined))});}
 }
 const counts=new Map<string,number>();for(const r of result)counts.set(r.label,(counts.get(r.label)??0)+1);
 return result.map(r=>({...r,unique:r.unique&&counts.get(r.label)===1}));
}
const shop=(s:string)=>['cameras onsite','cameras onsite llc'].includes(s.trim().toLowerCase());
const normalized=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function desiredCustomer(b:Row,o:Row):string{
 const old=b.baseline.map(cellText),customer=o.customerLabel,site=o.siteLabel;
 const oldCustomer=normalized(old[2]??'');
 const combined=b.customerStyle==='combined';
 const desired=o.placement==='FIELD'&&combined?customer+': '+site:customer;
 return oldCustomer===normalized(desired)||(o.placement==='SHOP'&&shop(old[2]??''))?old[2]:desired;
}
function allowed(c:Row,value:string){
 if(c.rich||cellText(c)===null)return false;
 const rule=c.validation;if(!rule)return true;
 return rule.condition?.type==='ONE_OF_LIST'&&Array.isArray(rule.condition.values)&&rule.condition.values.some((x:Row)=>x.userEnteredValue===value);
}
export function planPublishing(bindings:Row[],rows:Row[]){
 if(!Array.isArray(bindings)||bindings.length>1000||new Set(bindings.map(b=>b.equipmentId)).size!==bindings.length)throw Error('Invalid publisher bindings');
 const results:Row[]=[],intents:Row[]=[],requests:Row[]=[];
 for(const b of bindings){
  const matches=rows.filter(r=>r.sheetId===b.sheetId&&r.row===b.row),r=matches[0],o=b.observation;
  const hold=(reason:string)=>results.push({equipmentId:b.equipmentId,state:'held',reason});
  if(matches.length!==1||!r.unique||r.label!==b.label||!Array.isArray(b.baseline)||b.baseline.length!==4){hold('sheet_identity_changed');continue;}
  const extension=planFields(b,r);
  if(extension.reason){hold(extension.reason);continue;}
  const fieldResult=b.fields?{fields:extension.cells}:{};
  if(b.pending&&equal(r.cells,b.pending)&&(!b.fields||b.fields.pending&&equal(r.fields,b.fields.pending))){results.push({equipmentId:b.equipmentId,state:'recovered',cells:r.cells,...fieldResult});continue;}
  if(!equal(r.cells,b.baseline)){hold('manual_sheet_change');continue;}
  if(!b.sourceCurrent||o?.state!=='confirmed'){hold('source_unverified');continue;}
  if(!['SHOP','FIELD'].includes(o.placement)||typeof o.customerLabel!=='string'||typeof o.siteLabel!=='string'||!o.customerLabel.trim()||!o.siteLabel.trim()||(o.placement==='SHOP')!==shop(o.customerLabel)){hold('source_unverified');continue;}
  const old=b.baseline.map(cellText);
  if(old.some((v:any)=>v===null)||b.baseline.some((c:Row)=>c.rich)){hold('unsupported_sheet_cell');continue;}
  const desired=[old[0],o.placement,desiredCustomer(b,o),o.siteLabel];
  // Preserve equivalent existing spelling and the two established Shop accounts.
  if(normalized(old[3]!)===normalized(o.siteLabel)||(o.placement==='SHOP'&&old[1]==='SHOP'&&['shop','main cos shop','cameras onsite shop'].includes(normalized(old[3]!))))desired[3]=old[3];
  const changed=[1,2,3].filter(i=>old[i]!==desired[i]);
  const cells=b.baseline.map((c:Row,i:number)=>changed.includes(i)?{...c,entered:{stringValue:desired[i]}}:c);
  if(b.pending&&!equal(cells,b.pending)){hold('pending_write_changed');continue;}
  if(!changed.length&&!extension.requests?.length){results.push({equipmentId:b.equipmentId,state:'unchanged',cells:r.cells,...fieldResult});continue;}
  if(changed.some(i=>typeof desired[i]!=='string'||desired[i]!.length>250||/[\x00-\x1f\x7f]/.test(desired[i]!)||!allowed(r.cells[i],desired[i]!))){hold('sheet_validation');continue;}
  if(intents.length>=60){hold('batch_limit');continue;}
  intents.push({equipmentId:b.equipmentId,observation:o,cells,...(b.fields?{fields:{source:b.fields.source,cells:extension.cells}}:{})});
  requests.push(...(extension.requests||[]));
  const layout=tabLayout(b.sheetId);
  for(const i of changed){const col=layout.columns[i];requests.push({updateCells:{range:{sheetId:b.sheetId,startRowIndex:b.row-1,endRowIndex:b.row,startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[{userEnteredValue:{stringValue:desired[i]}}]}],fields:'userEnteredValue'}});}
  results.push({equipmentId:b.equipmentId,state:'published',cells,...fieldResult});
 }
 return {results,intents,requests};
}
export function assertPublishRequests(requests:Row[],extended=false){
 if(!Array.isArray(requests)||!requests.length||requests.length>(extended?420:180))throw Error('Invalid publisher batch');
 const seen=new Set<string>();
 for(const r of requests){const u=r?.updateCells,g=u?.range;
  if(extended&&assertFieldRequest(r)){const key=[g.sheetId,g.startRowIndex,g.startColumnIndex].join(':');if(seen.has(key))throw Error('Duplicate publisher cell');seen.add(key);continue;}
  if(!object(r)||Object.keys(r).length!==1||!object(u)||Object.keys(u).some(k=>!['range','rows','fields'].includes(k))||!object(g)
   ||Object.keys(g).some(k=>!['sheetId','startRowIndex','endRowIndex','startColumnIndex','endColumnIndex'].includes(k))
   ||!Number.isSafeInteger(g.startRowIndex)||g.startRowIndex<1||g.startRowIndex>=10000||g.endRowIndex!==g.startRowIndex+1
   ||!tabLayout(g.sheetId).columns.slice(1).includes(g.startColumnIndex)||g.endColumnIndex!==g.startColumnIndex+1
   ||u.fields!=='userEnteredValue'||!Array.isArray(u.rows)||u.rows.length!==1||Object.keys(u.rows[0]).length!==1
   ||!Array.isArray(u.rows[0].values)||u.rows[0].values.length!==1||Object.keys(u.rows[0].values[0]).length!==1
   ||!object(u.rows[0].values[0].userEnteredValue)||Object.keys(u.rows[0].values[0].userEnteredValue).length!==1
   ||typeof u.rows[0].values[0].userEnteredValue.stringValue!=='string'||u.rows[0].values[0].userEnteredValue.stringValue.length>250||/[\x00-\x1f\x7f]/.test(u.rows[0].values[0].userEnteredValue.stringValue))throw Error('Unsupported publisher request');
  const key=[g.sheetId,g.startRowIndex,g.startColumnIndex].join(':');if(seen.has(key))throw Error('Duplicate publisher cell');seen.add(key);
 }
}

/** Request fresh evidence only for otherwise eligible proposed writes. This is
 * not write authority: the normal planner and stage RPC must run again later. */
export function publisherRefreshCandidates(bindings:Row[],rows:Row[]):string[]{
 const candidates=bindings.filter(b=>b.sourceCurrent===false&&!b.pending&&b.observation?.state==='confirmed');
 const planned=planPublishing(candidates.map(b=>({...b,sourceCurrent:true})),rows);
 return planned.intents.map(i=>i.equipmentId).slice(0,60);
}
