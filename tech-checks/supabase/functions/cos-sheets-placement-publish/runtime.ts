import {createPublisherHandler} from './index.ts';
import {UNIT_TRACKER_WORKBOOK,trackerRanges,projectTracker,assertPublishRequests} from './model.ts';
import {parseSheetsAccount,readSheetsJson} from '../cos-operations-pages/googleSheets.ts';
import type {SheetsAssertionSigner} from '../cos-operations-pages/googleSheets.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const EMAIL='cos-unit-tracker@causal-jigsaw-511211-k9.iam.gserviceaccount.com';
const TOKEN='https://oauth2.googleapis.com/token';
const BASE='https://sheets.googleapis.com/v4/spreadsheets/'+UNIT_TRACKER_WORKBOOK;
const PROPERTIES='sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)';
export function createScheduledPublisherRuntime(options:{getEnv:(name:string)=>string|undefined;fetch?:typeof fetch;signAssertion:SheetsAssertionSigner;now?:()=>number}){
const requestFetch=options.fetch??fetch,now=options.now??Date.now;
let cached:{config:string;token:string;until:number}|null=null;
return async(request:Request)=>{
 const deadline=AbortSignal.timeout(90000);
 const json=async(response:Response,max=3145728)=>{if(!response.ok){void response.body?.cancel().catch(()=>{});if(response.status===401)cached=null;throw Error('Service unavailable');}return readSheetsJson(response,max,deadline);};
 const google=async(path:string,body?:unknown)=>{
  const raw=options.getEnv('COS_GOOGLE_SERVICE_ACCOUNT_JSON'),a=parseSheetsAccount(raw);if(!a||a.client_email!==EMAIL)throw Error('Unexpected tracker account');
  if(!cached||cached.config!==raw||cached.until<now()+60000){
   const issued=Math.floor(now()/1000),assertion=await options.signAssertion(a.private_key,{alg:'RS256',typ:'JWT',kid:a.private_key_id},{iss:a.client_email,aud:TOKEN,iat:issued,exp:issued+3600,scope:'https://www.googleapis.com/auth/spreadsheets'});
   const v=await json(await requestFetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)])}),32768);
   if(typeof v.access_token!=='string'||!v.access_token||v.access_token.length>16384||/\s/.test(v.access_token)||v.token_type!=='Bearer'||!Number.isSafeInteger(v.expires_in)||v.expires_in<60||v.expires_in>3600)throw Error('Incomplete authorization');
   cached={config:raw!,token:v.access_token,until:now()+v.expires_in*1000};
  }
  return json(await requestFetch(BASE+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+cached.token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.any([deadline,AbortSignal.timeout(20000)])}));
 };
 return createPublisherHandler({
  authenticate:async req=>{
   if(options.getEnv('SUPABASE_URL')!==NATIVE)return false;
   const secret=req.headers.get('x-camera-cron-secret');if(!secret||secret.length>1024||/\s/.test(secret))return false;
   const v=await json(await requestFetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':secret},body:'{"action":"authenticate"}',redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)])}),128);
   return v.authenticated===true&&Object.keys(v).length===1;
  },
  rpc:async(name,body)=>{
   const key=options.getEnv('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('Backend unavailable');
   return json(await requestFetch(NATIVE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)])}),2097152);
  },
  read:async()=>{
   const metadata=await google('?fields='+encodeURIComponent('spreadsheetId,properties(title),sheets(properties('+PROPERTIES+'))'));
   const query=new URLSearchParams({fields:'spreadsheetId,properties(title),sheets(properties('+PROPERTIES+'),data(startRow,startColumn,rowData(values(userEnteredValue,dataValidation,chipRuns,textFormatRuns))))'});
   for(const range of trackerRanges(metadata))query.append('ranges',range);
   return projectTracker(metadata,await google('?'+query));
  },
  write:async requests=>{
   assertPublishRequests(requests);
   const v=await google(':batchUpdate?fields=spreadsheetId,replies',{requests,includeSpreadsheetInResponse:false});
   if(v.spreadsheetId!==UNIT_TRACKER_WORKBOOK||!Array.isArray(v.replies)||v.replies.length!==requests.length)throw Error('Unverified publisher result');
  }
 })(request);
};
}
