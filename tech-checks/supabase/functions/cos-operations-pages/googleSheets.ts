import {UNIT_TRACKER_WORKBOOK} from './unitTracker.ts';

/** Only the existing 2027 workbook. No public sharing, impersonation, Drive
 * discovery, spreadsheet writes, source imports, or health inference. */
export const SHEETS_CONNECTION_CONTRACT='cos-google-sheets-connection-v1';
export const SHEETS_SECRET_NAME='COS_GOOGLE_SERVICE_ACCOUNT_JSON';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/spreadsheets.readonly';
export const TRACKER_TABS=Object.freeze([
 {id:568394918,title:'SOLAR SPOTTERS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:2017346590,title:'SPOTTERS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:426115083,title:'HELIOS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:386511683,title:'RANGERS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:826256700,title:'SNIPERS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:651684134,title:'CAM V & RSU',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:451969219,title:'RECONS',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:135363149,title:'RECON II',columns:2,headers:['UNIT #','PLACEMENT']},
 {id:1975227208,title:'SOLAR STANDS 72',columns:2,headers:['UNIT #','PLACEMENT']},
 // Its second column is an installation date, not placement. Never infer it.
 {id:828079282,title:'SOLAR POLES & SKIDS',columns:1,headers:['Unit']},
]);
type Row=Record<string,any>;
type Account={client_email:string;private_key:string;private_key_id:string};
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
export class SheetsConnectionError extends Error {
 constructor(message:string,public status=503){super(message);this.name='SheetsConnectionError';}
}
const fail=(message:string,status=503):never=>{throw new SheetsConnectionError(message,status);};
function account(raw:unknown):Account|null {
 if(raw===undefined||raw===null||raw==='')return null;
 if(typeof raw!=='string'||raw.length>32768)return fail('The Google service-account secret needs correction in Supabase.');
 let v:Row;try{v=JSON.parse(raw);}catch{fail('The Google service-account secret must be the complete JSON key file.');}
 if(!object(v)||v.type!=='service_account'||typeof v.client_email!=='string'||v.client_email.length>254
  ||!/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(v.client_email)
  ||v.token_uri!==TOKEN_URL||typeof v.private_key_id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(v.private_key_id)
  ||typeof v.private_key!=='string'||v.private_key.length>16384||!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(v.private_key))
  fail('Use a Google service-account JSON key, not a password, API key, or mHelpDesk token.');
 return {client_email:v.client_email,private_key:v.private_key,private_key_id:v.private_key_id};
}
async function boundedJson(response:Response,limit:number,signal:AbortSignal):Promise<Row> {
 if(signal.aborted)fail('The Sheets connection check timed out. Retry the check.');
 const declared=Number(response.headers.get('Content-Length'));
 if(Number.isFinite(declared)&&declared>limit){await response.body?.cancel();fail('Google returned an oversized connection response.');}
 const reader=response.body?.getReader();if(!reader)fail('Google returned an incomplete connection response.');
 const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){const {value,done}=await reader.read();if(signal.aborted)fail('The Sheets connection check timed out. Retry the check.');if(done)break;size+=value.byteLength;if(size>limit)fail('Google returned an oversized connection response.');chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  let v;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('Google returned an unreadable connection response.');}
  if(!object(v))fail('Google returned an incomplete connection response.');return v;
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
function cellText(v:unknown):string {
 if(!object(v))return '';
 if(typeof v.formattedValue==='string')return v.formattedValue;
 // Text only. A numeric label would lose significant displayed leading zeros.
 return typeof v.effectiveValue?.stringValue==='string'?v.effectiveValue.stringValue:'';
}
function projectWorkbook(v:Row,expectedRows:Map<number,number>){
 if(v.spreadsheetId!==UNIT_TRACKER_WORKBOOK||v.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(v.sheets))fail('Google returned a different tracker. No connection was verified.');
 const tabs:Row[]=[];const seen=new Set<string>();let rows=0,duplicates=0,formulaRows=0,placementReviewRows=0;
 for(const expected of TRACKER_TABS){
  const matches=v.sheets.filter((s:Row)=>s?.properties?.sheetId===expected.id);
  if(matches.length!==1)fail('An expected 2027 equipment tab is missing or duplicated.');
  const sheet=matches[0],p=sheet.properties;
  if(p.title!==expected.title||p.sheetType!=='GRID'||p.hidden===true||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount!==expectedRows.get(expected.id))fail('An equipment tab changed during the read. Retry its connection check.');
  const grids=sheet.data;if(!Array.isArray(grids)||grids.length!==1)fail('Google did not return the complete equipment identity range.');
  const grid=grids[0];if((grid.startRow??0)!==0||(grid.startColumn??0)!==0||!Array.isArray(grid.rowData)||grid.rowData.length>p.gridProperties.rowCount)fail('Google returned an unexpected equipment range.');
  const header=grid.rowData[0]?.values;
  if(!Array.isArray(header)||header.length!==expected.columns||expected.headers.some((h,i)=>cellText(header[i])!==h||header[i]?.userEnteredValue?.formulaValue))fail('The equipment identity or placement headers changed. Review the tracker.');
  let count=0,tabFormulaRows=0,tabPlacementReview=0;
  for(const row of grid.rowData.slice(1)){
   if(!object(row)||row.values!==undefined&&!Array.isArray(row.values))fail('Google returned malformed equipment cells.');
   const cells=row.values??[];if(cells.length>expected.columns)fail('Google returned cells outside the allowed identity range.');
   const label=cellText(cells[0]);if(!label.trim())continue;
   if(label.length>240||/[\x00-\x1f\x7f]/.test(label))fail('An equipment identity is invalid. Review the tracker.');
   count++;if(seen.has(label))duplicates++;seen.add(label);
   if(cells.some((c:Row)=>typeof c?.userEnteredValue?.formulaValue==='string'))tabFormulaRows++;
   if(expected.columns===2&&!['FIELD','SHOP','INACTIVE'].includes(cellText(cells[1])))tabPlacementReview++;
  }
  rows+=count;formulaRows+=tabFormulaRows;placementReviewRows+=tabPlacementReview;
  tabs.push({tabId:expected.id,title:expected.title,equipmentRows:count,formulaRows:tabFormulaRows,placementReviewRows:tabPlacementReview});
 }
 return {tabs,equipmentRows:rows,duplicateLabelRows:duplicates,formulaRows,placementReviewRows};
}
export type SheetsAssertionSigner=(privateKey:string,header:{alg:'RS256';typ:'JWT';kid:string},payload:Row)=>Promise<string>;
export function createSheetsConnection(options:{getServiceAccountJson:()=>unknown;signAssertion?:SheetsAssertionSigner;fetch?:typeof fetch;now?:()=>number}){
 const requestFetch=options.fetch??fetch,now=options.now??Date.now;
 let cached:{config:string;token:string;until:number}|null=null;
 let busy=false;
 const state=(a:Account|null)=>({contract:SHEETS_CONNECTION_CONTRACT,workbookId:UNIT_TRACKER_WORKBOOK,
  state:a?'ready_to_test':'setup_required',credentialConfigured:Boolean(a),serviceAccountEmail:a?.client_email??null,
  readAccessVerified:false,checkedAt:null,mode:'read_only',sheetsPublisher:false,automaticSync:false,
  equipmentRows:0,duplicateLabelRows:0,formulaRows:0,placementReviewRows:0,tabs:[]});
 return async(path:string,method:string,body:unknown)=>{
  if(!['/api/unit-tracker/sheets/status','/api/unit-tracker/sheets/check'].includes(path))fail('Sheets endpoint not found.',404);
  if(method!==(path.endsWith('/status')?'GET':'POST'))fail('Method not supported.',405);
  if(body!==null&&body!==undefined&&(!object(body)||Object.keys(body).length))fail('The Sheets connection check does not accept credentials, ranges, or workbook IDs.',400);
  if(busy)fail('A Sheets check is already running. Wait for it to finish.',409);
  let raw;try{raw=options.getServiceAccountJson();}catch{fail('The Google credential configuration is unavailable.');}
  const a=account(raw),status=state(a);
  if(method==='GET'||!a)return status;
  busy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const config=String(raw);let token=cached?.config===config&&cached.until>now()+60000?cached.token:null;
   if(!token){
    const issuedAt=Math.floor(now()/1000);let assertion;
    try{
     if(!options.signAssertion)fail('The Google signing service is unavailable.');
     assertion=await options.signAssertion(a.private_key,{alg:'RS256',typ:'JWT',kid:a.private_key_id},
      {iss:a.client_email,aud:TOKEN_URL,iat:issuedAt,exp:issuedAt+3600,scope:SCOPE});
     if(typeof assertion!=='string'||assertion.length>16384||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion))fail('Invalid Google assertion.');
    }catch{fail('The Google private key could not be used. Check the protected JSON secret.');}
    let response;try{response=await requestFetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),signal:controller.signal,redirect:'error',cache:'no-store'});}catch{fail('Google authorization is unavailable. Retry the connection check.');}
    if(!response.ok){await response.body?.cancel();cached=null;fail(response.status===429?'Google limited authorization requests. Wait and retry.':'Google rejected the service-account authorization. Check its JSON key and account.',response.status===429?429:503);}
    const data=await boundedJson(response,32768,controller.signal);
    if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>16384||/\s/.test(data.access_token)||data.token_type!=='Bearer'||!Number.isSafeInteger(data.expires_in)||data.expires_in<60||data.expires_in>3600)fail('Google returned incomplete authorization.');
    token=data.access_token;cached={config,token:token!,until:now()+data.expires_in*1000};
   }
   // First verify tab IDs, names, dimensions and visibility before selecting ranges.
   const base='https://sheets.googleapis.com/v4/spreadsheets/'+UNIT_TRACKER_WORKBOOK;
   const read=async(url:string)=>{
    let response;try{response=await requestFetch(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:controller.signal,redirect:'error',cache:'no-store'});}catch{fail('The Google Sheets read failed. Retry the connection check.');}
    if(!response.ok){await response.body?.cancel();if(response.status===401)cached=null;
     fail(response.status===403||response.status===404?'Enable the Google Sheets API and share the 2027 tracker with the service-account email shown here.':response.status===429?'Google limited Sheets requests. Wait and retry.':'The Google Sheets connection could not be verified.',response.status===429?429:503);}
    return boundedJson(response,2*1024*1024,controller.signal);
   };
   const metadata=await read(base+'?fields='+encodeURIComponent('spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))'));
   if(metadata.spreadsheetId!==UNIT_TRACKER_WORKBOOK||metadata.properties?.title!=='2027 UNIT TRACKER'||!Array.isArray(metadata.sheets))fail('The current 2027 workbook could not be verified.');
   const query=new URLSearchParams(),expectedRows=new Map<number,number>();query.set('fields','spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount)),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue))))');
   for(const expected of TRACKER_TABS){
    const matches=metadata.sheets.filter((s:Row)=>s?.properties?.sheetId===expected.id),p=matches[0]?.properties;
    if(matches.length!==1||p.title!==expected.title||p.sheetType!=='GRID'||p.hidden===true||!Number.isSafeInteger(p.gridProperties?.rowCount)||p.gridProperties.rowCount<2||p.gridProperties.rowCount>10000||p.gridProperties.columnCount<expected.columns)fail('The equipment tab layout changed. Review the connection before continuing.');
    query.append('ranges',"'"+expected.title.replaceAll("'","''")+"'!A1:"+(expected.columns===1?'A':'B')+p.gridProperties.rowCount);
    expectedRows.set(expected.id,p.gridProperties.rowCount);
   }
   const projection=projectWorkbook(await read(base+'?'+query),expectedRows);
   return {...status,...projection,state:'read_access_verified',readAccessVerified:true,checkedAt:new Date(now()).toISOString()};
  }finally{clearTimeout(timer);controller.abort();busy=false;}
 };
}
