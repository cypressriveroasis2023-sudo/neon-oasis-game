/** Read-only, independent proof of 2027 tracker Product-ID membership.
 * Only exact workbook/tab identities, Product IDs and Field/Shop evidence are
 * consumed; 2026 spreadsheets, operational IP columns and GPS are never read.
 * The verification runs on the COS server's existing Sheets Viewer identity.
 */
import {UNIT_TRACKER_WORKBOOK} from './unitTracker.ts';
import {equipmentCustomerPlacement,type EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';
import {parseSheetsAccount,readSheetsJson,type SheetsAssertionSigner} from './googleSheets.ts';

const ID=/^[1-9][0-9]{0,14}$/;
const HASH=/^[a-f0-9]{64}$/;
const OVERVIEW={id:1132540236,title:'UNIT OVERVIEW'};
const INDEX={id:1900169011,title:'MHELP MATCH INDEX'};
const TOKEN_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
type ObjectRow=Record<string,any>;
const object=(v:unknown):v is ObjectRow=>!!v&&typeof v==='object'&&!Array.isArray(v);
const normalized=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
function fail(msg:string):never{throw new Error('Current 2027 workbook verification failed: '+msg);}
export type VerifiedProductCensus={
  contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1';sourceSha256:string;
  observedAt:string;verifiedBy:'cos_sheets_service';productIds:readonly string[];
  total:number;field:number;shop:number;sourceExport:string;
  productRows:readonly {productId:string;family:string;unitLabel:string;placement:'FIELD'|'SHOP';customer:string}[];
};
function exactIds(cells:unknown[],name:string){
  const ids=[] as string[];for(const value of cells){if(typeof value!=='string'||!ID.test(value))fail(name+' contains invalid Product ID');ids.push(value);}
  if(new Set(ids).size!==ids.length)fail(name+' contains duplicate Product IDs');return ids;
}
function rows(v:unknown,range:string):string[][]{
 // Google can remove quotes and trailing all-empty rows but never shift columns.
 const spec=(x:string)=>{const m=/^(?:'([^']+)'|([^!]+))!([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/.exec(x);return m?{sheet:m[1]||m[2],a:m[3],from:Number(m[4]),b:m[5],to:Number(m[6])}:null;};
 if(!object(v))fail('an expected range was unavailable');
 const response=v as ObjectRow,expected=spec(range),got=typeof response.range==='string'?spec(response.range):null;
 if(!expected||!got||got.sheet!==expected.sheet||got.a!==expected.a||got.b!==expected.b||got.from!==expected.from||got.to>expected.to||got.to<got.from||response.majorDimension!=='ROWS'||!Array.isArray(response.values))fail('an expected range was unavailable');
 return (response.values as unknown[]).map((r:unknown)=>{if(!Array.isArray(r)||r.some(x=>typeof x!=='string'||x.length>600))fail('an equipment row is invalid');return r as string[];});
}

/** Validates a mockable Google `values:batchGet` response with fixed response order.
 * Values are directly pulled from Sheets by the server; never accept client JSON.
 * A product lookup index is NOT authoritative if the 2027 overview disagrees. */
export async function verify2027CensusRanges(valueRanges:unknown,rangeNames:readonly string[],candidate:readonly EquipmentCsvRow[],sourceFilename:string,at:string):Promise<VerifiedProductCensus>{
 if(!Array.isArray(valueRanges)||valueRanges.length!==6||rangeNames.length!==6||!/^ServiceItem_List_[0-9]{14}\.csv$/.test(sourceFilename)||!Number.isFinite(Date.parse(at)))fail('source evidence is incomplete');
 const [info,productColumn,placements,indexProducts,indexNames,indexExports]=valueRanges.map((r,i)=>rows(r,rangeNames[i]));
 if(info[0]?.[0]!=='EQUIPMENT TYPE'||info[0]?.[1]!=='UNIT #'||info[0]?.[2]!=='PLACEMENT'||info[0]?.[4]!=='CUSTOMER'||productColumn[0]?.[0]!=='MHELP EQUIPMENT ID'||placements[0]?.[0]!=='TRACKER PLACEMENT'||placements[0]?.[1]!=='MHELP PLACEMENT'||indexProducts[0]?.[0]!=='TRACKER MATCH KEY'||indexProducts[0]?.[1]!=='MHELP EQUIPMENT ID'||indexNames[0]?.[0]!=='MHELP EQUIPMENT NAME'||indexNames[0]?.[1]!=='MHELP CUSTOMER / SITE'||indexExports[0]?.[0]!=='MHELP SOURCE EXPORT')fail('equipment identity and placement headers differ from 2027 authority');
 // Preserve native row indices: independently filtering blank rows would silently
 // shift a Product ID onto another customer or equipment family.
 const size=Math.max(info.length,productColumn.length,placements.length);
 const list:string[][]=[],ids:string[][]=[],placed:string[][]=[];
 for(let i=1;i<size;i++){
  const a=info[i]||[],b=productColumn[i]||[],c=placements[i]||[];
  if(![...a,...b,...c].some(v=>v.trim()))continue;
  if(!a[0]||!a[1]||!a[2]||!a[4]||!b[0]||!c[0]||!c[1])fail('the 2027 overview has a missing or shifted source row');
  list.push(a);ids.push(b);placed.push(c);
 }
 const indexedSize=Math.max(indexProducts.length,indexNames.length,indexExports.length);
 const indexIds:string[][]=[],details:string[][]=[],exportRows:string[][]=[];
 for(let i=1;i<indexedSize;i++){
  const a=indexProducts[i]||[],b=indexNames[i]||[],c=indexExports[i]||[];
  if(![...a,...b,...c].some(v=>v.trim()))continue;
  if(!a[0]||!a[1]||!b[0]||!b[1]||!c[0])fail('the mHelp index has a missing or shifted source row');
  indexIds.push(a);details.push(b);exportRows.push(c);
 }
 if(!list.length||list.length>10000||ids.length!==list.length||placed.length!==list.length||indexIds.length!==list.length||details.length!==list.length||candidate.length!==list.length)fail('equipment rows are incomplete or the current source has changed');
 const overviewProducts=exactIds(ids.map(r=>r[0]),'2027 overview');const lookupProducts=exactIds(indexIds.map(r=>r[1]),'mHelp index');
 const set=new Set(overviewProducts);if(lookupProducts.some(x=>!set.has(x)))fail('the mHelp index is inconsistent with the current overview');
 const candidates=new Map<string,EquipmentCsvRow>();for(const r of candidate){if(!ID.test(r.productId)||candidates.has(r.productId))fail('source Product IDs are invalid');candidates.set(r.productId,r);}
 if(candidates.size!==overviewProducts.length||overviewProducts.some(id=>!candidates.has(id)))fail('2027 workbook does not match the uploaded mHelp Product IDs');
 let field=0,shop=0;const canonical:string[]=[];
 for(let i=0;i<list.length;i++){
  const [family,label,placement,,customer]=list[i];const [trackerPlacement,mhelpPlacement]=placed[i];const product=overviewProducts[i],source=candidates.get(product)!;
  if(!family||!label||!customer||!['FIELD','SHOP'].includes(placement)||trackerPlacement!==placement||mhelpPlacement!==placement||placement!==source.placement||normalized(customer)!==normalized(source.customer)||equipmentCustomerPlacement(customer)!==placement)fail('current placement or customer assignment disagrees with mHelp');
  if(placement==='FIELD')field++;else shop++;
  canonical.push(product+'|'+family+'|'+label+'|'+placement+'|'+normalized(customer));
 }
 const detailsById=new Map<string,{key:string;model:string;customer:string}>();for(let i=0;i<indexIds.length;i++){
  const pid=lookupProducts[i],model=details[i][0],customer=details[i][1],exportName=exportRows[i][0];
  if(exportName!==sourceFilename||detailsById.has(pid))fail('mHelp source lookup is incomplete or stale');
  detailsById.set(pid,{key:indexIds[i][0],model,customer});
 }
 for(const [pid,item] of detailsById){const source=candidates.get(pid)!;
  if(normalized(source.customer)!==normalized(item.customer)||normalized(source.unitNumber)!==normalized(item.model))fail('mHelp source and indexed identity/customer disagree');
 }
 for(let i=0;i<list.length;i++){
  const x=detailsById.get(overviewProducts[i]);
  if(!x||x.key!==list[i][0]+'|'+list[i][1])fail('the 2027 family-qualified unit identity is inconsistent with the index');
 }
 const data=canonical.sort().join('\n')+'\n'+sourceFilename;
 const bytes=new TextEncoder().encode(data);
 const sourceSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(!HASH.test(sourceSha256))fail('source checksum was unavailable');
 return {contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',sourceSha256,observedAt:at,verifiedBy:'cos_sheets_service',productIds:overviewProducts,total:list.length,field,shop,sourceExport:sourceFilename,
  productRows:list.map((item,i)=>({productId:overviewProducts[i],family:item[0],unitLabel:item[1],placement:item[2] as 'FIELD'|'SHOP',customer:item[4]}))};
}

/** Enforces server-only Google Viewer credentials and bounded native Sheets APIs. */
export async function read2027CensusFromGoogle(options:{
 getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch;
 now?:()=>number;sourceFilename:string;candidate:readonly EquipmentCsvRow[];
}):Promise<VerifiedProductCensus>{
 const now=options.now??Date.now;const requestFetch=options.fetch??fetch;let account:ReturnType<typeof parseSheetsAccount>;
 try{account=parseSheetsAccount(options.getServiceAccountJson());}catch{fail('Google Viewer configuration is invalid');}
 const signAssertion=options.signAssertion;if(!account||!signAssertion)return fail('the protected Google Viewer connection is unavailable');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const issuedAt=Math.floor(now()/1000);let assertion;
  try{assertion=await signAssertion(account.private_key,{alg:'RS256',typ:'JWT',kid:account.private_key_id},{iss:account.client_email,aud:TOKEN_URL,iat:issuedAt,exp:issuedAt+3600,scope:SCOPE});}
  catch{fail('Google Viewer authorization is unavailable');}
  if(typeof assertion!=='string'||assertion.length>16384||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion))fail('Google Viewer assertion was invalid');
  const auth=await requestFetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),signal:controller.signal,redirect:'error',cache:'no-store'});
  if(!auth.ok)fail('Google Viewer could not authenticate');const token=await readSheetsJson(auth,32768,controller.signal);
  if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>16384||/\s/.test(token.access_token)||token.token_type!=='Bearer')fail('Google Viewer did not supply usable authorization');
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+UNIT_TRACKER_WORKBOOK;
  const read=async(uri:string,limit=1400000)=>{
   const result=await requestFetch(uri,{method:'GET',headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'},signal:controller.signal,redirect:'error',cache:'no-store'});
   if(!result.ok)fail('current 2027 workbook could not be read');return readSheetsJson(result,limit,controller.signal);
  };
  const metadata=await read(base+'?fields='+encodeURIComponent('spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))'),250000);
  if(metadata.spreadsheetId!==UNIT_TRACKER_WORKBOOK||metadata.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(metadata.sheets))fail('unexpected workbook');
  const sheetRows=new Map<string,number>();for(const s of [OVERVIEW,INDEX]){
   const matches=metadata.sheets.filter((v:ObjectRow)=>v?.properties?.sheetId===s.id);const p=matches[0]?.properties;
   if(matches.length!==1||p.title!==s.title||p.hidden===true||p.sheetType!=='GRID'||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount<1002||p.gridProperties.rowCount>12000||p.gridProperties.columnCount<(s===INDEX?9:18))fail('the authoritative equipment tabs changed');
   sheetRows.set(s.title,p.gridProperties.rowCount);
  }
  const n=sheetRows.get(OVERVIEW.title)!,m=sheetRows.get(INDEX.title)!;
  const names=[`'UNIT OVERVIEW'!A1:E${n}`,`'UNIT OVERVIEW'!O1:O${n}`,`'UNIT OVERVIEW'!Q1:R${n}`,`'MHELP MATCH INDEX'!A1:B${m}`,`'MHELP MATCH INDEX'!D1:E${m}`,`'MHELP MATCH INDEX'!H1:H${m}`];
  const params=new URLSearchParams();for(const range of names)params.append('ranges',range);params.set('valueRenderOption','FORMATTED_VALUE');
  const fetched=await read(base+'/values:batchGet?'+params.toString());
  return verify2027CensusRanges(fetched.valueRanges,names,options.candidate,options.sourceFilename,new Date(now()).toISOString());
 }catch(e){if(e instanceof Error&&e.message.startsWith('Current 2027 workbook verification failed:'))throw e;return fail('current 2027 workbook verification is unavailable');}
 finally{clearTimeout(timer);controller.abort();}
}