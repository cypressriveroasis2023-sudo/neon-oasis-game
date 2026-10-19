/** Strict Google Sheet reader for the one existing 2027 tracker workbook.
 * Reads only public operational cells A,B,D,E,F (special solar poles A,F,E,C,D)
 * and Product-ID index A,B; never touches LIVE STATUS, IPs, passwords or notes.
 */
import {COS_2027_WORKBOOK,OPERATIONAL_SHEETS_TABS,type IndexRow,type SheetRow,type Fields} from '../cos-sheets-placement-publish/operationalSyncModel.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'?v:null;
const safe=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/^[-+=@]/.test(v);
const HEADER='MHELP MATCH INDEX',INDEX_ID=1900169011;
const COLS=OPERATIONAL_SHEETS_TABS.map(tab=>({
 ...tab,headers:tab.title==='SOLAR POLES & SKIDS'?
 ['Unit','Status','Customer','Site Name / Project','Location / Address']:
 ['UNIT #','PLACEMENT','CUSTOMER','SITE / PROJECT','PHYSICAL ADDRESS']
}));
export type WorkbookState={index:IndexRow[];sheet:SheetRow[];count:number};
const escaped=(name:string)=>"'"+name.replaceAll("'","''")+"'";
function cells(snapshot:Row,tab:Row,expected:number[],grid:Row):Row[][]{
 if(!Array.isArray(grid.data)||grid.data.length!==expected.length)throw Error('Incomplete protected equipment columns');
 const arrays=new Map<number,Row[]>();
 for(const g of grid.data){
  if(!object(g)||!Number.isSafeInteger(g.startColumn??0)||!expected.includes(g.startColumn??0)
    ||(g.startRow??0)!==0||arrays.has(g.startColumn??0)
    ||!Array.isArray(g.rowData)||g.rowData.length>tab.gridProperties.rowCount)
   throw Error('Tracker column range changed');
  arrays.set(g.startColumn,g.rowData.map((r:Row)=>{
   if(!object(r)||r.values!==undefined&&(!Array.isArray(r.values)||r.values.length>1))
    throw Error('Malformed Google cell range');
   const c=r.values?.[0];
   if(c!==undefined&&!object(c))throw Error('Malformed Google cell');
   return c??{};
  }));
 }
 return expected.map(c=>arrays.get(c)??[]);
}
function value(v:Row):string|null{
 const entered=v.userEnteredValue;
 if(entered==null)return '';
 if(!object(entered)||Object.keys(entered).length!==1||typeof entered.stringValue!=='string')return null;
 if(v.chipRuns?.length||v.textFormatRuns?.length)return null;
 return entered.stringValue;
}
function checkMetadata(metadata:Row){
 if(!object(metadata)||metadata.spreadsheetId!==COS_2027_WORKBOOK||metadata.properties?.title!=='2027 UNIT TRACKER'
   ||!Array.isArray(metadata.sheets))throw Error('Wrong tracker workbook');
 const tabs=new Map<number,Row>();
 for(const ref of [...COLS,{id:INDEX_ID,title:HEADER,columns:[0,1]}]){
  const matches=metadata.sheets.filter((sheet:Row)=>sheet?.properties?.sheetId===ref.id);
  const p=matches[0]?.properties;
  if(matches.length!==1||p.title!==ref.title||p.hidden===true||p.sheetType!=='GRID'
    ||!Number.isSafeInteger(p.gridProperties?.rowCount)
    ||p.gridProperties.rowCount<2||p.gridProperties.rowCount>10000
    ||p.gridProperties.columnCount<(ref.title===HEADER?2:6))
   throw Error('Tracker family layout changed');
  tabs.set(ref.id,p);
 }
 return tabs;
}
export function operationalRanges(metadata:Row):string[]{
 const tabs=checkMetadata(metadata),ranges:string[]=[];
 for(const tab of COLS){
  const p=tabs.get(tab.id)!;
  for(const col of tab.columns){
   ranges.push(escaped(tab.title)+'!'+String.fromCharCode(65+col)+'1:'+String.fromCharCode(65+col)+p.gridProperties.rowCount);
  }
 }
 const p=tabs.get(INDEX_ID)!;
 for(const col of [0,1])ranges.push(escaped(HEADER)+'!'+String.fromCharCode(65+col)+'1:'+String.fromCharCode(65+col)+p.gridProperties.rowCount);
 return ranges;
}
export function readOperationalWorkbook(metadata:Row,grid:Row):WorkbookState{
 const tabs=checkMetadata(metadata);
 if(!object(grid)||grid.spreadsheetId!==COS_2027_WORKBOOK||grid.properties?.title!=='2027 UNIT TRACKER'
   ||!Array.isArray(grid.sheets))throw Error('Incomplete 2027 tracker read');
 const indexed=grid.sheets.filter((s:Row)=>s?.properties?.sheetId===INDEX_ID);
 if(indexed.length!==1||JSON.stringify(indexed[0].properties)!==JSON.stringify(tabs.get(INDEX_ID)))
   throw Error('Tracker index changed during read');
 const indexColumns=cells(metadata,tabs.get(INDEX_ID)!,[0,1],indexed[0]);
 if(value(indexColumns[0]?.[0]??{})!=='TRACKER MATCH KEY'
   ||value(indexColumns[1]?.[0]??{})!=='MHELP EQUIPMENT ID')
   throw Error('Tracker Product-ID index headers changed');
 const index:IndexRow[]=[],pidSet=new Set<string>(),keySet=new Set<string>();
 for(let i=1;i<Math.max(indexColumns[0].length,indexColumns[1].length);i++){
  const key=value(indexColumns[0]?.[i]??{}),pid=value(indexColumns[1]?.[i]??{});
  if(key===null||pid===null)throw Error('Formula or rich identity cell in tracker index');
  if(!key&&!pid)continue;
  if(!key||!pid||!/^([1-9]\d{0,14})$/.test(pid)||keySet.has(key)||pidSet.has(pid))
   throw Error('Duplicate or changed Product-ID index');
  keySet.add(key);pidSet.add(pid);index.push({key,productId:pid});
 }
 if(index.length<1||index.length>1200)throw Error('Incomplete equipment index');
 const sheet:SheetRow[]=[],seen=new Set<string>();
 for(const spec of COLS){
  const p=tabs.get(spec.id)!;
  const matched=grid.sheets.filter((s:Row)=>s?.properties?.sheetId===spec.id);
  if(matched.length!==1||JSON.stringify(matched[0].properties)!==JSON.stringify(p))
   throw Error('Tracker equipment tab changed during read');
  const cols=cells(metadata,p,spec.columns,matched[0]);
  for(let i=0;i<spec.headers.length;i++)if(value(cols[i]?.[0]??{})!==spec.headers[i])
   throw Error('Tracker equipment headers changed');
  for(let i=1;i<cols[0].length;i++){
   const label=value(cols[0]?.[i]??{});if(label===null)throw Error('Formula or nontext unit identity');
   if(!label)continue;
   const key=spec.title+'|'+label;
   if(seen.has(key))throw Error('Duplicate family and unit label');
   seen.add(key);
   const vals=cols.slice(1).map(col=>value(col[i]??{}));
   if(vals.some(v=>v===null))throw Error('Unsupported formula or rich operational cell');
   const fields:Fields={placement:vals[0] as Fields['placement'],customer:vals[1]!,site:vals[2]!,address:vals[3]!};
   if(!safe(label,250)||Object.values(fields).some(v=>!safe(v,600)))
    throw Error('Unsafe operational values');
   const selected=cols.slice(1).map(col=>col[i]??{});
   const hasFormula=selected.some(c=>c.userEnteredValue?.formulaValue!==undefined||c.chipRuns?.length||c.textFormatRuns?.length);
   sheet.push({sheetId:spec.id,row:i+1,label,fields,formula:hasFormula});
  }
 }
 const matched=index.filter(r=>sheet.some(s=>{
   const t=COLS.find(t=>t.id===s.sheetId);
   return t?.title+'|'+s.label===r.key;
 }));
 if(matched.length!==index.length||index.length!==sheet.length)
  throw Error('Not every Product ID has one current equipment row');
 return {index,sheet,count:index.length};
}
