/** Pure two-way Product-ID sync planner. No network, credentials or writes.
 * Reads the exact current 2027 workbook's 12 equipment tabs plus MHELP MATCH
 * INDEX. LIVE STATUS is camera telemetry, NEVER an activation command.
 * A Sheet edit may propose a COS transfer only after an observed baseline exists.
 */
export const COS_OPERATIONAL_SHEETS_SYNC='COS_OPERATIONAL_SHEETS_SYNC_V1';
export const COS_2027_WORKBOOK='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
export const OPERATIONAL_SHEETS_TABS=Object.freeze([
 {id:568394918,title:'SOLAR SPOTTERS',columns:[0,1,3,4,5]},
 {id:2017346590,title:'SPOTTERS',columns:[0,1,3,4,5]},
 {id:426115083,title:'HELIOS',columns:[0,1,3,4,5]},
 {id:386511683,title:'RANGERS',columns:[0,1,3,4,5]},
 {id:826256700,title:'SNIPERS',columns:[0,1,3,4,5]},
 {id:651684134,title:'CAM V & RSU',columns:[0,1,3,4,5]},
 {id:451969219,title:'RECONS',columns:[0,1,3,4,5]},
 {id:135363149,title:'RECON II',columns:[0,1,3,4,5]},
 {id:1975227208,title:'SOLAR STANDS 72',columns:[0,1,3,4,5]},
 {id:828079282,title:'SOLAR POLES & SKIDS',columns:[0,5,4,2,3]},
 {id:1900162010,title:'STANDS',columns:[0,1,3,4,5]},
 {id:1900162011,title:'WALL-E',columns:[0,1,3,4,5]},
]);
export type Fields={placement:'FIELD'|'SHOP';customer:string;site:string;address:string};
export type IndexRow={key:string;productId:string};
export type SheetRow={sheetId:number;row:number;label:string;fields:Fields;formula?:boolean;validation?:Record<string,any>};
export type Mirror={productId:string;sheetId:number;row:number;label:string;fields:Fields;revision:number};
export type Pending={productId:string;revision:number;fields:Fields;requestId:string};
export type Inbound={productId:string;expectedMirrorRevision:number;oldFields:Fields;newFields:Fields;sheetId:number;row:number;label:string};
export type Outbound={productId:string;requestId:string;revision:number;oldFields:Fields;newFields:Fields;sheetId:number;row:number;label:string;columns:readonly number[]};
export type SyncPlan={
 contract:typeof COS_OPERATIONAL_SHEETS_SYNC;
 coverage:number;bootstrap:Mirror[];inbound:Inbound[];outbound:Outbound[];
 alreadyPublished:Outbound[];held:{productId:string;reason:string}[];
};
const object=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const product=(s:unknown):s is string=>typeof s==='string'&&/^[1-9][0-9]{0,14}$/.test(s);
const canonical=(f:Fields)=>JSON.stringify([f.placement,f.customer,f.site,f.address]);
const safe=(v:unknown,max:number)=>typeof v==='string'&&v===v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/^[-+=@]/.test(v);
const valid=(f:unknown):f is Fields=>object(f)&&['FIELD','SHOP'].includes(f.placement)
 &&safe(f.customer,250)&&safe(f.site,250)&&safe(f.address,600)
 &&(f.placement==='SHOP'||(f.customer.length>=2&&f.site.length>=2&&f.address.length>=8));
export function planOperationalSync(
 index:IndexRow[],sheet:SheetRow[],mirrors:Mirror[],pending:Pending[]
):SyncPlan{
 if(!Array.isArray(index)||index.length>1200||!Array.isArray(sheet)||sheet.length>1200
 ||!Array.isArray(mirrors)||mirrors.length>1200||!Array.isArray(pending)||pending.length>1200)
  throw Error('Unsupported 2027 tracker proof size');
 const indexByProduct=new Map<string,IndexRow>(),indexByKey=new Map<string,IndexRow>();
 for(const r of index){
  if(!object(r)||!product(r.productId)||typeof r.key!=='string'||!r.key.includes('|')
   ||indexByProduct.has(r.productId)||indexByKey.has(r.key))
   throw Error('Duplicate or malformed 2027 Product-ID match index');
  const [tab,label]=r.key.split(/\|(.+)/).filter(Boolean);
  if(!OPERATIONAL_SHEETS_TABS.some(t=>t.title===tab)||!label||label.length>250)
   throw Error('2027 index contains a non-equipment or malformed label');
  indexByProduct.set(r.productId,r);indexByKey.set(r.key,r);
 }
 const byKey=new Map<string,SheetRow>();
 for(const r of sheet){
  if(!object(r)||!Number.isSafeInteger(r.row)||r.row<2||r.row>10000||typeof r.label!=='string'||!r.label.trim())
   throw Error('Invalid 2027 equipment row');
  const tab=OPERATIONAL_SHEETS_TABS.find(t=>t.id===r.sheetId);
  if(!tab)throw Error('Unexpected 2027 equipment tab');
  const key=tab.title+'|'+r.label;
  if(byKey.has(key))throw Error('Duplicate 2027 family and unit label');
  byKey.set(key,r);
 }
 const mirrorByProduct=new Map<string,Mirror>();
 for(const m of mirrors){
  if(!product(m?.productId)||mirrorByProduct.has(m.productId)||!Number.isSafeInteger(m.revision)||m.revision<0||!valid(m.fields))
   throw Error('Invalid COS Sheets mirror baseline');
  mirrorByProduct.set(m.productId,m);
 }
 const pendingByProduct=new Map<string,Pending>();
 for(const p of pending){
  if(!product(p?.productId)||pendingByProduct.has(p.productId)||!Number.isSafeInteger(p.revision)||p.revision<1
   ||typeof p.requestId!=='string'||!valid(p.fields))
   throw Error('Invalid pending COS placement publication');
  pendingByProduct.set(p.productId,p);
 }
 const result:SyncPlan={contract:COS_OPERATIONAL_SHEETS_SYNC,coverage:0,bootstrap:[],inbound:[],outbound:[],alreadyPublished:[],held:[]};
 for(const [pid,idx] of indexByProduct){
  const row=byKey.get(idx.key),mir=mirrorByProduct.get(pid),command=pendingByProduct.get(pid);
  const hold=(reason:string)=>result.held.push({productId:pid,reason});
  if(!row){hold('sheet_identity_missing');continue;}
  const tab=OPERATIONAL_SHEETS_TABS.find(t=>t.id===row.sheetId)!;
  if(!valid(row.fields)||row.formula===true){hold('unsafe_or_formula_fields');continue;}
  const status=row.fields;
  result.coverage++;
  if(mir&&(mir.sheetId!==row.sheetId||mir.label!==row.label||mir.row!==row.row)){
   hold('mirrored_identity_or_row_changed');continue;
  }
  if(!mir){
   // Never mistake preexisting tracker differences for a new manual command.
   result.bootstrap.push({productId:pid,sheetId:row.sheetId,row:row.row,label:row.label,fields:status,revision:0});
   if(command)hold('mirror_baseline_required_before_publish');
   continue;
  }
  if(command){
   const outgoing:Outbound={productId:pid,requestId:command.requestId,revision:command.revision,
    oldFields:mir.fields,newFields:command.fields,sheetId:row.sheetId,row:row.row,label:row.label,columns:tab.columns};
   if(canonical(status)===canonical(command.fields))result.alreadyPublished.push(outgoing);
   else if(canonical(status)===canonical(mir.fields))result.outbound.push(outgoing);
   else hold('concurrent_sheet_edit_conflicts_with_cos_move');
   continue;
  }
  if(canonical(status)!==canonical(mir.fields))
   result.inbound.push({productId:pid,expectedMirrorRevision:mir.revision,oldFields:mir.fields,newFields:status,sheetId:row.sheetId,row:row.row,label:row.label});
 }
 for(const pid of mirrorByProduct.keys())if(!indexByProduct.has(pid))result.held.push({productId:pid,reason:'indexed_product_removed'});
 for(const pid of pendingByProduct.keys())if(!indexByProduct.has(pid))result.held.push({productId:pid,reason:'pending_product_unindexed'});
 return result;
}
