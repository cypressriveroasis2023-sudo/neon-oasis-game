/** Read-only connection attribution, not equipment admission or relocation.
 * The full Product-ID membership and row/column/source identities must agree.
 * A disagreement in one product's current assignment is a hold on THAT ID,
 * never permission to rewrite placement or use it as another endpoint.
 * The existing all-or-nothing equipment import verifier is not changed.
 */
import {equipmentCustomerPlacement,type EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';
import {TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK,type VerifiedTrackerIpCensusV2,type TrackerConnectionHold} from '../../../operations/src/exactProductConnection.ts';
const ID=/^[1-9][0-9]{0,14}$/;
const HASH=/^[a-f0-9]{64}$/;
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const normalized=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
const fail=():never=>{throw Error('Protected 2027 Product-ID/IP evidence is unavailable or changed.');};
const rangeSpec=(v:unknown)=>{
 if(typeof v!=='string')return null;
 const m=/^(?:'([^']+)'|([^!]+))!([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/.exec(v);
 return m?{sheet:m[1]||m[2],fromCol:m[3],fromRow:Number(m[4]),toCol:m[5],toRow:Number(m[6])}:null;
};
const col=(v:string)=>[...v].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
/** Preserve empty row positions. Only equivalent quoted/unquoted A1 ranges
 * and omission of trailing empty cells are accepted, never shifted columns. */
function rows(value:unknown,expectedRange:string):string[][]{
 const expected=rangeSpec(expectedRange),actual=object(value)?rangeSpec(value.range):null;
 if(!expected||!actual||!object(value)||actual.sheet!==expected.sheet||actual.fromCol!==expected.fromCol
  ||actual.toCol!==expected.toCol||actual.fromRow!==expected.fromRow
  ||actual.toRow>expected.toRow||actual.toRow<actual.fromRow
  ||value.majorDimension!=='ROWS'||!Array.isArray(value.values)
  ||value.values.length>actual.toRow-actual.fromRow+1)return fail();
 const width=col(expected.toCol)-col(expected.fromCol)+1;
 return value.values.map((row:unknown)=>{
  if(!Array.isArray(row)||row.length>width||row.some(v=>v!==null&&(typeof v!=='string'||v.length>600)))return fail();
  return row.map(v=>v===null?'':v);
 });
}
export async function verify2027ConnectionCensus(
 valueRanges:unknown,rangeNames:readonly string[],candidate:readonly EquipmentCsvRow[],
 expectedMhelpSourceSha256:string,verifiedAt:string
):Promise<VerifiedTrackerIpCensusV2>{
 if(!Array.isArray(valueRanges)||valueRanges.length!==7||rangeNames.length!==7
  ||!HASH.test(expectedMhelpSourceSha256)||!Number.isFinite(Date.parse(verifiedAt))
  ||!Array.isArray(candidate)||!candidate.length||candidate.length>10000)return fail();
 const boundaries=[['UNIT OVERVIEW','A','E'],['UNIT OVERVIEW','O','O'],['UNIT OVERVIEW','Q','R'],
  ['MHELP MATCH INDEX','A','B'],['MHELP MATCH INDEX','D','E'],['MHELP MATCH INDEX','H','H'],['UNIT OVERVIEW','H','H']];
 rangeNames.forEach((name,i)=>{
  const s=rangeSpec(name),b=boundaries[i];
  if(!s||s.sheet!==b[0]||s.fromCol!==b[1]||s.toCol!==b[2]||s.fromRow!==1||s.toRow>12000)return fail();
 });
 const [info,ids,placement,indexIds,indexDetails,exports,ips]=valueRanges.map((v,i)=>rows(v,rangeNames[i]));
 if(info[0]?.[0]!=='EQUIPMENT TYPE'||info[0]?.[1]!=='UNIT #'||info[0]?.[2]!=='PLACEMENT'||info[0]?.[4]!=='CUSTOMER'
  ||ids[0]?.[0]!=='MHELP EQUIPMENT ID'||placement[0]?.[0]!=='TRACKER PLACEMENT'||placement[0]?.[1]!=='MHELP PLACEMENT'
  ||indexIds[0]?.[0]!=='TRACKER MATCH KEY'||indexIds[0]?.[1]!=='MHELP EQUIPMENT ID'
  ||indexDetails[0]?.[0]!=='MHELP EQUIPMENT NAME'||indexDetails[0]?.[1]!=='MHELP CUSTOMER / SITE'
  ||exports[0]?.[0]!=='MHELP SOURCE EXPORT'||ips[0]?.[0]!=='IP'||ips.length>ids.length)return fail();
 const expected=new Map<string,EquipmentCsvRow>();
 for(const r of candidate){
  // Keep the declared complete row type while checking the same object at runtime.
  const sourceRow:EquipmentCsvRow=r;
  if(!object(r)||!ID.test(r.productId)||expected.has(r.productId)||!['FIELD','SHOP'].includes(r.placement)
   ||typeof r.customer!=='string'||!r.customer.trim()||typeof r.unitNumber!=='string'||!r.unitNumber.trim())return fail();
  expected.set(r.productId,sourceRow);
 }
 const indexed=new Map<string,{key:string;model:string;customer:string}>();let sourceExport:string|null=null;
 for(let i=1;i<Math.max(indexIds.length,indexDetails.length,exports.length);i++){
  const a=indexIds[i]||[],d=indexDetails[i]||[],e=exports[i]||[];
  if(![...a,...d,...e].some(v=>v.trim()))continue;
  if(!a[0]||!ID.test(a[1])||indexed.has(a[1])||!d[0]||!d[1]||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(e[0]))return fail();
  if(sourceExport!==null&&sourceExport!==e[0])return fail();
  sourceExport=e[0];indexed.set(a[1],{key:a[0],model:d[0],customer:d[1]});
 }
 const records:VerifiedTrackerIpCensusV2['records']=[],seen=new Set<string>();
 for(let i=1;i<Math.max(info.length,ids.length,placement.length,ips.length);i++){
  const a=info[i]||[],id=ids[i]?.[0]||'',p=placement[i]||[],ip=ips[i]?.[0]||'';
  if(![...a,id,...p,ip].some(v=>v.trim()))continue;
  const [family,label,currentPlacement,,customer]=a;
  // Missing identity/row metadata invalidates the entire census, as before.
  if(!family||!label||!customer||!ID.test(id)||seen.has(id)||!expected.has(id)||!indexed.has(id)
   ||!['FIELD','SHOP'].includes(currentPlacement)||!p[0]||ip.length>80)return fail();
  seen.add(id);
  const source=expected.get(id)!,index=indexed.get(id)!;
  if(index.key!==family+'|'+label)return fail();
  const reviewReasons:TrackerConnectionHold[]=[];
  if(currentPlacement!==source.placement)reviewReasons.push('placement_mismatch');
  if(normalized(customer)!==normalized(source.customer)||normalized(index.customer)!==normalized(source.customer)
   ||equipmentCustomerPlacement(customer)!==currentPlacement)reviewReasons.push('customer_mismatch');
  if(normalized(index.model)!==normalized(source.unitNumber))reviewReasons.push('identity_mismatch');
  if(p[0]!==currentPlacement||Boolean(p[1])&&p[1]!==currentPlacement)reviewReasons.push('tracker_restriction');
  records.push({productId:id,recordId:'mhelp_product:'+id,placement:currentPlacement as 'FIELD'|'SHOP',
   publicIp:ip.trim()||null,reviewReasons,sourceRow:i+1});
 }
 if(!sourceExport||records.length!==expected.size||indexed.size!==expected.size
  ||[...expected.keys()].some(id=>!seen.has(id)||!indexed.has(id)))return fail();
 // A source revision covers the complete exact-ID census including held IP
 // reservations. It is internal provenance, not exported network evidence.
 const bytes=new TextEncoder().encode(JSON.stringify({rangeNames,sourceExport,records}));
 const trackerSourceSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256,
  verifiedAt,trackerSourceSha256,sourceExport,records};
}
