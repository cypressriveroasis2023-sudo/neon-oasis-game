/** Owner equipment CSV preflight ONLY. Never admits source authority or writes records.
 * Import commitment requires a separate reviewed, current-guarded database action.
 * In particular, mHelpDesk ProductDesc/IP cannot become a camera endpoint. */
export const EQUIPMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
const ID = /^[1-9][0-9]{0,14}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED = ['ProductId','ProductModel','CustomerId','CustomerName','Category','Address','City','State','Zip'] as const;
const own = (value:object, key:string):boolean => Object.prototype.hasOwnProperty.call(value,key);

type Placement = 'FIELD'|'SHOP';
type Lifecycle = 'UNFLAGGED'|'DO_NOT_USE'|'MISSING';
export type EquipmentCsvRow = {
  productId:string; unitNumber:string; customerId:string; customer:string;
  category:string; placement:Placement; lifecycle:Lifecycle; sourceRow:number;
  sourceAddress:{street:string;city:string;state:string;zip:string};
};
type PreviousRecord = EquipmentCsvRow & {binding?:unknown};
export type EquipmentPreviewChange = {
  kind:'added'|'absent'|'placement'|'customer'|'address'|'lifecycle'|'details'|'identity_review';
  productId:string; unitNumber:string; previousPlacement:Placement|null;
  proposedPlacement:Placement|null; reason:string;
};
export type EquipmentPreview = {
  contract:'COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1';
  previewOnly:true; readyToCommit:false; sourceSha256:string;
  priorSourceSha256:string; inventory:{total:number;field:number;shop:number;inactive:number};
  changes:{unchanged:number;added:number;absent:number;placement:number;customer:number;address:number;lifecycle:number;details:number;identityReview:number};
  samples:EquipmentPreviewChange[];
  guardNotice:string;
};

function reject(message:string):never{throw new Error(`Invalid mHelpDesk equipment CSV: ${message}`);}
function value(v:unknown,max=600):string{
  if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v))reject('a cell has unsupported content');
  return v.trim();
}
function normalize(v:string):string{return v.trim().replace(/\s+/g,' ').toLowerCase();}
/** Exact account allowlist. Prefix matches can misclassify actual customers. */
export function equipmentCustomerPlacement(name:string):Placement {
  const n=normalize(value(name,250)).replace(/[.]/g,'');
  return /^(?:cameras\s+on\s*site)(?:\s+llc|\s*-\s*test\s+units)?$/.test(n)?'SHOP':'FIELD';
}

/** Strict bounded RFC4180 fields, quoted commas and multiline addresses. */
export function parseEquipmentCsv(text:string):EquipmentCsvRow[] {
  if(typeof text!=='string'||!text)reject('the file is empty');
  const s=text.charCodeAt(0)===0xfeff?text.slice(1):text;
  const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false,atStart=true;
  const addField=()=>{if(field.length>8000)reject('a cell is too long');row.push(field);field='';closed=false;atStart=true;if(row.length>80)reject('too many columns');};
  const addRow=()=>{addField();if(row.length===1&&!row[0].trim()){row=[];return;}records.push(row);row=[];if(records.length>10002)reject('too many records');};
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'){if(s[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}
      else field+=ch;
    } else if(ch==='"'&&atStart&&!closed){quoted=true;atStart=false;}
    else if(ch===','){addField();}
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&s[i+1]==='\n')i++;
      addRow();
    } else {
      if(ch==='"'||closed)reject('invalid CSV quoting');
      field+=ch;atStart=false;
    }
  }
  if(quoted)reject('an unterminated quoted cell');
  if(field.length||row.length||closed)addRow();
  if(records.length<2)reject('header or equipment rows missing');
  const header=records.shift()!.map(k=>value(k,120));
  if(new Set(header).size!==header.length)reject('duplicate column headers');
  for(const k of REQUIRED)if(!header.includes(k))reject(`missing column ${k}`);
  const col=(r:string[],key:string)=>value(r[header.indexOf(key)]);
  const seen=new Set<string>();const output:EquipmentCsvRow[]=[];
  for(const r of records){
    if(r.length!==header.length)reject('inconsistent column count');
    const productId=col(r,'ProductId'),unitNumber=col(r,'ProductModel'),customerId=col(r,'CustomerId'),customer=col(r,'CustomerName');
    if(!ID.test(productId)||!ID.test(customerId)||!unitNumber||!customer||seen.has(productId))reject('missing, repeated or invalid Product ID/customer/unit');
    seen.add(productId);
    const category=col(r,'Category');if(!category)reject('equipment category missing');
    const lifecycle=/\bDO\s*NOT\s*USE\b/i.test(unitNumber)?'DO_NOT_USE':/\bMISSING\b/i.test(unitNumber)?'MISSING':'UNFLAGGED';
    output.push({productId,unitNumber,customerId,customer,category,
      placement:equipmentCustomerPlacement(customer),lifecycle,sourceRow:output.length+2,
      sourceAddress:{street:col(r,'Address'),city:col(r,'City'),state:col(r,'State'),zip:col(r,'Zip')}});
  }
  if(output.length>10000)reject('too many equipment rows');
  return output;
}

function sameAddress(a:EquipmentCsvRow['sourceAddress'],b:EquipmentCsvRow['sourceAddress']):boolean {
  return (['street','city','state','zip'] as const).every(k=>normalize(a[k])===normalize(b[k]));
}
function validPrior(v:unknown):{sourceSha256:string;records:PreviousRecord[]}{
  if(!v||typeof v!=='object'||Array.isArray(v))reject('reviewed previous upload missing');
  const prior=v as Record<string,unknown>;
  if(prior.contract!=='COS_MHELP_UPLOAD_V1'||prior.reviewed!==true||typeof prior.sourceSha256!=='string'||!SHA256.test(prior.sourceSha256)||!Array.isArray(prior.records)||prior.records.length<1||prior.records.length>10000)reject('reviewed previous upload unavailable');
  const seen=new Set<string>();
  for(const row of prior.records as PreviousRecord[]){
    if(!row||typeof row!=='object'||!ID.test(row.productId)||seen.has(row.productId)||!['FIELD','SHOP'].includes(row.placement)||!row.sourceAddress||typeof row.sourceAddress!=='object')reject('previous source identities invalid');
    seen.add(row.productId);
  }
  return prior as {sourceSha256:string;records:PreviousRecord[]};
}
/** Pure comparison; never invokes any record, placement, camera or GPS mutation. */
export function compareMhelpEquipmentRows(rows:EquipmentCsvRow[],previous:unknown,sourceSha256:string):EquipmentPreview {
  if(!SHA256.test(sourceSha256))reject('source checksum invalid');
  const old=validPrior(previous);const prior=new Map(old.records.map(r=>[r.productId,r]));
  const current=new Map<string,EquipmentCsvRow>(),samples:EquipmentPreviewChange[]=[];
  const counts={unchanged:0,added:0,absent:0,placement:0,customer:0,address:0,lifecycle:0,details:0,identityReview:0};
  for(const row of rows){if(current.has(row.productId))reject('duplicate Product ID');current.set(row.productId,row);}
  const addedRows=rows.filter(r=>!prior.has(r.productId));
  const absentRows=old.records.filter(r=>!current.has(r.productId));
  // A label shared across newly added and missing Product IDs is an identity
  // collision, NEVER proof that the historical Product ID can be rewritten.
  const disappeared=new Map<string,PreviousRecord[]>();
  for(const r of absentRows){const key=`${normalize(r.category)}|${normalize(r.unitNumber)}`;disappeared.set(key,[...(disappeared.get(key)||[]),r]);}
  const push=(kind:EquipmentPreviewChange['kind'],r:EquipmentCsvRow|PreviousRecord,prev:Placement|null,next:Placement|null,reason:string)=>{
    if(samples.length<40)samples.push({kind,productId:r.productId,unitNumber:r.unitNumber,previousPlacement:prev,proposedPlacement:next,reason});
  };
  for(const row of rows){
    const earlier=prior.get(row.productId);
    if(!earlier){counts.added++;
      const key=`${normalize(row.category)}|${normalize(row.unitNumber)}`;
      if(disappeared.has(key)){counts.identityReview++;push('identity_review',row,null,row.placement,'Product ID changed for similarly labeled equipment; prohibit automatic identity merge');}
      else push('added',row,null,row.placement,'New mHelpDesk Product ID; identity binding requires review');
      continue;
    }
    let changed=false;
    if(earlier.placement!==row.placement){counts.placement++;changed=true;push('placement',row,earlier.placement,row.placement,'Current authority/identity guards required');}
    if(earlier.customerId!==row.customerId||normalize(earlier.customer)!==normalize(row.customer)){counts.customer++;changed=true;push('customer',row,earlier.placement,row.placement,'Assignment changed; validate installation and owner history');}
    if(!sameAddress(earlier.sourceAddress,row.sourceAddress)){counts.address++;changed=true;push('address',row,earlier.placement,row.placement,'Source address changed; not verified installation GPS');}
    if(earlier.lifecycle!==row.lifecycle){counts.lifecycle++;changed=true;push('lifecycle',row,earlier.placement,row.placement,'Lifecycle change requires review');}
    if(normalize(earlier.unitNumber)!==normalize(row.unitNumber)||normalize(earlier.category)!==normalize(row.category)){counts.details++;changed=true;push('details',row,earlier.placement,row.placement,'Unit identity/category changed; hold association');}
    if(!changed)counts.unchanged++;
  }
  for(const r of absentRows){counts.absent++;push('absent',r,r.placement,null,'Missing from latest complete source; preserve historical records and current protected assignments');}
  return {contract:'COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1',previewOnly:true,readyToCommit:false,sourceSha256,priorSourceSha256:old.sourceSha256,
    inventory:{total:rows.length,field:rows.filter(r=>r.placement==='FIELD').length,shop:rows.filter(r=>r.placement==='SHOP').length,inactive:rows.filter(r=>r.lifecycle!=='UNFLAGGED').length},
    changes:counts,samples,guardNotice:'Preview only. No inventory, placement, camera, GPS, IP or history was changed. A separately reviewed, Owner-authenticated current-guarded admission is mandatory.'};
}

export async function previewMhelpEquipmentCsv(body:unknown,prior:unknown):Promise<EquipmentPreview>{
  if(!body||typeof body!=='object'||Array.isArray(body))reject('invalid request');
  const data=body as Record<string,unknown>;
  if(Object.keys(data).some(k=>!['bytesBase64','expectedSha256','sourceFilename'].includes(k))||typeof data.bytesBase64!=='string'||data.bytesBase64.length>Math.ceil(EQUIPMENT_CSV_MAX_BYTES/3)*4+4||data.bytesBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.bytesBase64))reject('invalid CSV bytes');
  if(data.sourceFilename!==undefined&&(typeof data.sourceFilename!=='string'||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(data.sourceFilename)))reject('invalid mHelp source filename');
  const decoded=atob(data.bytesBase64);if(decoded.length> EQUIPMENT_CSV_MAX_BYTES||decoded.length===0||btoa(decoded)!==data.bytesBase64)reject('non-canonical CSV bytes');
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(data.expectedSha256!==undefined&&(typeof data.expectedSha256!=='string'||!SHA256.test(data.expectedSha256)||data.expectedSha256!==sha))reject('SHA-256 mismatch');
  let csv:string;try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject('file is not UTF-8 CSV');}
  const rows=parseEquipmentCsv(csv!);
  return compareMhelpEquipmentRows(rows,prior,sha);
}
