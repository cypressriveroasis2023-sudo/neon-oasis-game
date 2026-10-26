/** Server-only read of actual 2027 tracker Product IDs and their IP cells.
 * This is separate from the existing owner CSV admission verifier, which
 * remains unchanged. Never return the raw IP census to the browser.
 */
import {UNIT_TRACKER_WORKBOOK} from './unitTracker.ts';
import {parseSheetsAccount,readSheetsJson,type SheetsAssertionSigner} from './googleSheets.ts';
import {verify2027CensusRanges} from './mhelp2027ProductCensus.ts';
import type {EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';
import {VERIFIED_TRACKER_IP_CONTRACT,TRACKER_IP_WORKBOOK,type VerifiedTrackerIpCensus} from '../../../operations/src/exactProductConnection.ts';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
const OVERVIEW={id:1132540236,title:'UNIT OVERVIEW'};
const INDEX={id:1900169011,title:'MHELP MATCH INDEX'};
const ID=/^[1-9][0-9]{0,14}$/;
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const failure=():never=>{throw Error('Protected 2027 Product-ID/IP evidence is unavailable or changed.');};
const verifiedRows=(raw:unknown,range:string):string[][]=>{
 if(!object(raw)||raw.range!==range||raw.majorDimension!=='ROWS'||!Array.isArray(raw.values))return failure();
 const data:string[][]=[];
 for(const item of raw.values){
  if(!Array.isArray(item)||item.length>6||item.some(value=>typeof value!=='string'||value.length>600))return failure();
  data.push(item);
 }
 return data;
};
export async function read2027ProductIpsFromGoogle(options:{
 getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch;
 candidate:readonly EquipmentCsvRow[];expectedMhelpSourceSha256:string;now?:()=>number;
}):Promise<VerifiedTrackerIpCensus>{
 if(!/^[a-f0-9]{64}$/.test(options.expectedMhelpSourceSha256)||!Array.isArray(options.candidate)||!options.candidate.length||options.candidate.length>10000)return failure();
 const at=options.now??Date.now,requestFetch=options.fetch??fetch;
 let account:ReturnType<typeof parseSheetsAccount>;
 try{account=parseSheetsAccount(options.getServiceAccountJson());}catch{return failure();}
 if(!account||!options.signAssertion)return failure();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const issuedAt=Math.floor(at()/1000);
  let assertion:string;
  try{assertion=await options.signAssertion(account.private_key,{alg:'RS256',typ:'JWT',kid:account.private_key_id},
    {iss:account.client_email,aud:TOKEN_URL,iat:issuedAt,exp:issuedAt+3600,scope:SCOPE});}
  catch{return failure();}
  if(typeof assertion!=='string'||assertion.length>16384||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion))return failure();
  const read=async(uri:string,limit:number,token:string)=>{
   const response=await requestFetch(uri,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:controller.signal,redirect:'error',cache:'no-store'});
   if(!response.ok)return failure();
   return readSheetsJson(response,limit,controller.signal);
  };
  const authorization=await requestFetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),signal:controller.signal,redirect:'error',cache:'no-store'});
  if(!authorization.ok)return failure();
  const signed=await readSheetsJson(authorization,32768,controller.signal);
  if(typeof signed.access_token!=='string'||!signed.access_token||signed.access_token.length>16384||/\s/.test(signed.access_token)||signed.token_type!=='Bearer')return failure();
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+UNIT_TRACKER_WORKBOOK;
  const metadata=await read(base+'?fields='+encodeURIComponent('spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))'),250000,signed.access_token);
  if(metadata.spreadsheetId!==UNIT_TRACKER_WORKBOOK||metadata.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(metadata.sheets))return failure();
  const count=new Map<string,number>();
  for(const expected of [OVERVIEW,INDEX]){
   const matches=metadata.sheets.filter((s:Record<string,any>)=>s?.properties?.sheetId===expected.id),p=matches[0]?.properties;
   if(matches.length!==1||p.title!==expected.title||p.hidden===true||p.sheetType!=='GRID'
    ||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount<options.candidate.length+1||p.gridProperties.rowCount>12000
    ||p.gridProperties.columnCount<(expected.id===INDEX.id?9:19))return failure();
   count.set(expected.title,p.gridProperties.rowCount);
  }
  const n=count.get(OVERVIEW.title)!,m=count.get(INDEX.title)!;
  // The first six ranges are the existing strict Product-ID census. H is
  // the *operational tracker IP*, not a mHelpDesk IP note or router URL.
  const names=[`'UNIT OVERVIEW'!A1:E${n}`,`'UNIT OVERVIEW'!O1:O${n}`,`'UNIT OVERVIEW'!Q1:R${n}`,
   `'MHELP MATCH INDEX'!A1:B${m}`,`'MHELP MATCH INDEX'!D1:E${m}`,`'MHELP MATCH INDEX'!H1:H${m}`,`'UNIT OVERVIEW'!H1:H${n}`];
  const query=new URLSearchParams();for(const name of names)query.append('ranges',name);query.set('valueRenderOption','FORMATTED_VALUE');
  const result=await read(base+'/values:batchGet?'+query,2200000,signed.access_token);
  if(!Array.isArray(result.valueRanges)||result.valueRanges.length!==7)return failure();
  const exports=verifiedRows(result.valueRanges[5],names[5]);
  const sourceFilename=exports.slice(1).find(row=>row[0]?.trim())?.[0]||'';
  if(!/^ServiceItem_List_[0-9]{14}\.csv$/.test(sourceFilename))return failure();
  const verified=await verify2027CensusRanges(result.valueRanges.slice(0,6),names.slice(0,6),options.candidate,sourceFilename,new Date(at()).toISOString());
  if(verified.total!==options.candidate.length||verified.productIds.length!==verified.total)return failure();
  const ips=verifiedRows(result.valueRanges[6],names[6]);
  const products=verifiedRows(result.valueRanges[1],names[1]);
  const info=verifiedRows(result.valueRanges[0],names[0]);
  if(ips[0]?.[0]!=='IP'||products[0]?.[0]!=='MHELP EQUIPMENT ID')return failure();
  const recordIds=new Set<string>(),records:VerifiedTrackerIpCensus['records'] extends Array<infer T>?T[]:never=[];
  for(let i=1;i<Math.max(products.length,info.length,ips.length);i++){
   const pid=products[i]?.[0]||'',family=info[i]?.[0]||'',label=info[i]?.[1]||'',placement=info[i]?.[2]||'';
   const rawIp=ips[i]?.[0]||'';
   if(!pid&&!family&&!label&&!placement&&!rawIp)continue;
   if(!ID.test(pid)||recordIds.has(pid)||!['FIELD','SHOP'].includes(placement)||rawIp.length>80)return failure();
   recordIds.add(pid);
   records.push({productId:pid,recordId:'mhelp_product:'+pid,placement:placement as 'FIELD'|'SHOP',publicIp:rawIp.trim()||null});
  }
  if(records.length!==verified.total||records.some((record,i)=>record.productId!==verified.productRows[i].productId
   ||record.placement!==verified.productRows[i].placement))return failure();
  return {contract:VERIFIED_TRACKER_IP_CONTRACT,workbookId:TRACKER_IP_WORKBOOK,
   expectedMhelpSourceSha256:options.expectedMhelpSourceSha256,verifiedAt:new Date(at()).toISOString(),records};
 }catch{return failure();}
 finally{clearTimeout(timer);controller.abort();}
}
