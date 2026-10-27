/** Server-only read of actual 2027 tracker Product IDs and their IP cells.
 * This is separate from the existing owner CSV admission verifier, which
 * remains unchanged. Never return the raw IP census to the browser.
 */
import {UNIT_TRACKER_WORKBOOK} from './unitTracker.ts';
import {parseSheetsAccount,readSheetsJson,type SheetsAssertionSigner} from './googleSheets.ts';
import {verify2027ConnectionCensus} from './mhelp2027ConnectionCensus.ts';
import type {EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';
import type {VerifiedTrackerIpCensusV2} from '../../../operations/src/exactProductConnection.ts';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
const OVERVIEW={id:1132540236,title:'UNIT OVERVIEW'};
const INDEX={id:1900169011,title:'MHELP MATCH INDEX'};
const failure=():never=>{throw Error('Protected 2027 Product-ID/IP evidence is unavailable or changed.');};
export async function read2027ProductIpsFromGoogle(options:{
 getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch;
 candidate:readonly EquipmentCsvRow[];expectedMhelpSourceSha256:string;now?:()=>number;
}):Promise<VerifiedTrackerIpCensusV2>{
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
  // The first six ranges preserve the full grounded Product-ID census;
  // current assignment conflicts are explicit per-ID holds. H is the actual
  // operational tracker IP, never a mHelpDesk IP note or router URL.
  const names=[`'UNIT OVERVIEW'!A1:E${n}`,`'UNIT OVERVIEW'!O1:O${n}`,`'UNIT OVERVIEW'!Q1:R${n}`,
   `'MHELP MATCH INDEX'!A1:B${m}`,`'MHELP MATCH INDEX'!D1:E${m}`,`'MHELP MATCH INDEX'!H1:H${m}`,`'UNIT OVERVIEW'!H1:H${n}`];
  const query=new URLSearchParams();for(const name of names)query.append('ranges',name);query.set('valueRenderOption','FORMATTED_VALUE');
  const result=await read(base+'/values:batchGet?'+query,2200000,signed.access_token);
  if(!Array.isArray(result.valueRanges)||result.valueRanges.length!==7)return failure();
  return verify2027ConnectionCensus(result.valueRanges,names,options.candidate,options.expectedMhelpSourceSha256,new Date(at()).toISOString());
 }catch{return failure();}
 finally{clearTimeout(timer);controller.abort();}
}
