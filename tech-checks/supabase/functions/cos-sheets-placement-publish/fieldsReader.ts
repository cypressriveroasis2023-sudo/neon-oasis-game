import {trackerRanges,projectTracker,equal,cellText,tabLayout,UNIT_TRACKER_WORKBOOK} from './model.ts';
import {INDEX,addressColumn,addressHeader,fieldCell} from './fields.ts';
type Row=Record<string,any>;
function indexMetadata(metadata:Row){
 const list=metadata.sheets?.filter((s:Row)=>s.properties?.sheetId===INDEX.id),p=list?.[0]?.properties;
 if(list?.length!==1||p.title!==INDEX.title||p.sheetType!=='GRID'||p.hidden===true||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount<2||p.gridProperties.rowCount>10000||!Number.isSafeInteger(p.gridProperties.columnCount)||p.gridProperties.columnCount<8)throw Error('Tracker layout changed');
 return p;
}
export function trackerFieldRanges(metadata:Row,bindings:Row[]){
 const result=trackerRanges(metadata,bindings),p=indexMetadata(metadata);
 for(const id of new Set(bindings.filter(b=>b.fields).map(b=>b.sheetId))){
  const tab=tabLayout(id),column=String.fromCharCode(65+addressColumn(id));
  const n=Math.max(...bindings.filter(b=>b.fields&&b.sheetId===id).map(b=>b.row));
  const m=metadata.sheets.find((s:Row)=>s.properties.sheetId===id).properties.gridProperties.rowCount;
  if(n>m)throw Error('Invalid publisher bindings');
  result.push("'"+tab.title+"'!"+column+'1:'+column+n);
 }
 for(const c of INDEX.columns){const col=String.fromCharCode(65+c);result.push("'"+INDEX.title+"'!"+col+'1:'+col+p.gridProperties.rowCount);}
 return result;
}
function column(sheet:Row,c:number,max:number){
 const ranges=sheet.data.filter((g:Row)=>(g.startColumn??0)===c);
 if(ranges.length!==1||(ranges[0].startRow??0)!==0||!Array.isArray(ranges[0].rowData)||ranges[0].rowData.length>max)throw Error('Unexpected tracker range');
 return ranges[0].rowData.map((r:Row)=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||r.values!==undefined&&(!Array.isArray(r.values)||r.values.length>1))throw Error('Unexpected tracker cells');
  return fieldCell(r.values?.[0]);
 });
}
export function projectFieldTracker(metadata:Row,grid:Row,bindings:Row[]){
 trackerFieldRanges(metadata,bindings);
 if(grid?.spreadsheetId!==UNIT_TRACKER_WORKBOOK||!Array.isArray(grid.sheets))throw Error('Incomplete tracker read');
 const legacy={...grid,sheets:grid.sheets.filter((s:Row)=>s.properties?.sheetId!==INDEX.id).map((s:Row)=>({...s,data:s.data?.filter((g:Row)=>(g.startColumn??0)!==addressColumn(s.properties.sheetId))}))};
 const rows:Row[]=projectTracker(metadata,legacy);const p=indexMetadata(metadata),list=grid.sheets.filter((s:Row)=>s.properties?.sheetId===INDEX.id),sheet=list[0];
 if(list.length!==1||!equal(sheet.properties,p)||!Array.isArray(sheet.data)||sheet.data.length!==5)throw Error('Tracker changed during read');
 const cols=INDEX.columns.map(c=>column(sheet,c,p.gridProperties.rowCount));
 if(INDEX.headers.some((h,i)=>cellText(cols[i][0])!==h||cols[i][0]?.rich))throw Error('Tracker headers changed');
 const indexed:Row[]=[],ids=new Set<string>(),keys=new Set<string>();
 for(let i=1;i<Math.max(...cols.map(c=>c.length));i++){
  const cells=cols.map(c=>c[i]??fieldCell(undefined)),values=cells.map(cellText);
  if(values.every(v=>v===''))continue;
  if(values.some(v=>v===null)||cells.some(c=>c.rich)||!values[0]||!values[1]?.match(/^[1-9][0-9]{0,14}$/)||ids.has(values[1])||keys.has(values[0]))throw Error('Tracker changed during read');
  ids.add(values[1]);keys.add(values[0]);indexed.push({row:i+1,cells});
 }
 for(const b of bindings.filter(b=>b.fields)){
  const target=rows.find(r=>r.sheetId===b.sheetId&&r.row===b.row),tab=grid.sheets.find((s:Row)=>s.properties?.sheetId===b.sheetId);
  if(!target)continue;
  if(tab.data.length!==5)throw Error('Unexpected tracker range');
  const cells=column(tab,addressColumn(b.sheetId),tab.properties.gridProperties.rowCount);
  if(cellText(cells[0])!==addressHeader(b.sheetId)||cells[0]?.rich)throw Error('Tracker headers changed');
  const matches=indexed.filter(x=>cellText(x.cells[1])===b.equipmentId&&cellText(x.cells[0])===tabLayout(b.sheetId).title+'|'+target.label);
  if(matches.length===1)target.fields={address:cells[b.row-1]??fieldCell(undefined),index:matches[0]};
 }
 return rows;
}
