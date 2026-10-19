import {parseSheetsAccount,readSheetsJson,type SheetsAssertionSigner} from '../cos-operations-pages/googleSheets.ts';
import {readOperationalWorkbook,operationalRanges,type WorkbookState} from './googleGrid.ts';
import {planOperationalSync,type Pending,type Mirror,type Outbound,type Fields} from '../cos-sheets-placement-publish/operationalSyncModel.ts';
import {operationalUpdateCells,verifiedOperationalReadback} from '../cos-sheets-placement-publish/operationalSheetsWrites.ts';

type Row=Record<string,any>;
const PRODUCT_URL='https://tughscoxralhofrckvxy.supabase.co';
const AUTH_URL='https://oauth2.googleapis.com/token';
const ACCOUNT='cos-unit-tracker@causal-jigsaw-511211-k9.iam.gserviceaccount.com';
const BOOK='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
const GOOGLE_URL='https://sheets.googleapis.com/v4/spreadsheets/'+BOOK;
const JSON_HEADERS={'Content-Type':'application/json',Accept:'application/json'};
const GRID_FIELDS='spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,dataValidation,chipRuns,textFormatRuns))))';
const META_FIELDS='spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))';
const validObject=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const equals=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const cloneFields=(v:Row):Fields=>({placement:v.placement,customer:v.customer,site:v.site,address:v.address});

export function createOperationalSheetSyncRuntime(options:{
 getEnv:(name:string)=>string|undefined;fetch?:typeof fetch;signAssertion:SheetsAssertionSigner;
 now?:()=>number
}){
 const requestFetch=options.fetch??fetch,now=options.now??Date.now;
 let cached:{config:string;token:string;until:number}|null=null;
 return async function handler(request:Request):Promise<Response>{
  const reply=(payload:unknown,status=200)=>Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(request.method!=='POST'||new URL(request.url).search||request.headers.has('origin'))
   return reply({error:'Scheduled service request required'},405);
  if(options.getEnv('COS_OPERATIONAL_SHEETS_WORKER_ENABLED')!=='true')
   return reply({state:'disabled'},202);
  const secret=request.headers.get('x-camera-cron-secret');
  if(!secret||secret.length>1024||/\s/.test(secret)||options.getEnv('SUPABASE_URL')!==PRODUCT_URL)
   return reply({error:'Forbidden'},403);
  let input:unknown;
  try{
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw Error();
   const raw=await request.text();
   if(raw.length>64)throw Error();
   input=JSON.parse(raw);
   if(!validObject(input)||Object.keys(input).length!==1||input.action!=='run')throw Error();
  }catch{return reply({error:'Invalid scheduled request'},400);}
  const deadline=AbortSignal.timeout(110000);
  const fetchJson=async(url:string,init:RequestInit,max=9*1024*1024)=>{
   const signal=AbortSignal.any([deadline,AbortSignal.timeout(35000)]);
   let response:Response;
   try{response=await requestFetch(url,{...init,signal,redirect:'error',cache:'no-store'});}
   catch{throw Error('transport');}
   if(!response.ok){
    void response.body?.cancel().catch(()=>{});
    if(response.status===401)cached=null;
    throw Error(response.status===429?'rate_limited':'upstream_'+response.status);
   }
   try{return await readSheetsJson(response,max,signal);}
   catch{throw Error('malformed');}
  };
  let lease:string|null=null,stage='authenticate';
  const fail=(name:string):never=>{throw Error(name)};
  try{
   const allowed=await fetchJson(
    'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',
    {method:'POST',headers:{...JSON_HEADERS,'x-camera-cron-secret':secret},body:'{"action":"authenticate"}'},128);
   if(!validObject(allowed)||allowed.authenticated!==true||Object.keys(allowed).length!==1)
    return reply({error:'Forbidden'},403);
   const serviceKey=options.getEnv('SUPABASE_SERVICE_ROLE_KEY');
   if(!serviceKey)return reply({error:'Service backend not configured'},503);
   const rpc=async(name:string,args:Row={})=>fetchJson(PRODUCT_URL+'/rest/v1/rpc/'+name,
    {method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,...JSON_HEADERS},
     body:JSON.stringify(args)},3*1024*1024);
   stage='claim';const claimed=await rpc('cos_operational_sheet_sync_begin');
   if(claimed?.leaseId===null)return reply({state:claimed.reason==='disabled'?'disabled':'busy'},202);
   if(claimed?.contract!=='COS_OPERATIONAL_SHEETS_LEASE_V1'
    ||typeof claimed.leaseId!=='string'||!/^[0-9a-f-]{36}$/i.test(claimed.leaseId)
    ||!/^[a-f0-9]{64}$/.test(claimed.sourceSha256)
    ||!Array.isArray(claimed.mirrors)||!Array.isArray(claimed.outbox))
    fail('invalid_lease');
   lease=claimed.leaseId;
   const raw=options.getEnv('COS_GOOGLE_SERVICE_ACCOUNT_JSON');
   const account=parseSheetsAccount(raw);
   if(!account||account.client_email!==ACCOUNT)fail('google_account');
   async function token(){
    if(!cached||cached.config!==raw||cached.until<now()+60000){
     const issued=Math.floor(now()/1000);
     const assertion=await options.signAssertion(account!.private_key,
      {alg:'RS256',typ:'JWT',kid:account!.private_key_id},
      {iss:ACCOUNT,aud:AUTH_URL,iat:issued,exp:issued+3600,scope:'https://www.googleapis.com/auth/spreadsheets'});
     const v=await fetchJson(AUTH_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})},32768);
     if(typeof v.access_token!=='string'||!v.access_token||v.token_type!=='Bearer'
       ||!Number.isSafeInteger(v.expires_in)||v.expires_in<60||v.expires_in>3600)
       fail('google_auth');
     cached={config:raw!,token:v.access_token,until:now()+v.expires_in*1000};
    }
    return cached.token;
   }
   const google=async(path:string,body?:Row)=>{
    const bearer=await token();
    return fetchJson(GOOGLE_URL+path,
      {method:body===undefined?'GET':'POST',
       headers:{Authorization:'Bearer '+bearer,...JSON_HEADERS},
       ...(body===undefined?{}:{body:JSON.stringify(body)})});
   };
   stage='metadata';
   const meta=await google('?fields='+encodeURIComponent(META_FIELDS));
   // The parser itself checks exact workbook ID, all 12 equipment tabs and
   // current Product-ID index title/IDs; there is no Drive discovery/write.
   const ranges=operationalRanges(meta);
   async function read():Promise<WorkbookState>{
    const q=new URLSearchParams({fields:GRID_FIELDS});
    for(const r of ranges)q.append('ranges',r);
    return readOperationalWorkbook(meta,await google('?'+q.toString()));
   }
   stage='sheet_read';
   let live=await read();
   if(live.count>1200||live.count<1)fail('incomplete_workbook');
   // Source remains COS's saved mHelp Product-ID identity; bootstrap is a
   // mirror only. Never apply first-run sheet differences to operational COS.
   if(claimed.mirrors.length===0){
    stage='bootstrap_compare';
    const second=await read();if(!equals(live,second))fail('sheet_changed');
    stage='bootstrap';
    const records=second.index.map(x=>{
     const title=x.key.slice(0,x.key.indexOf('|')),label=x.key.slice(x.key.indexOf('|')+1);
     const t=second.sheet.filter(s=>s.label===label).find(s=>
       // Exact sheet id and family, not a bare unit number.
       (awaitTitle(s.sheetId))===title);
     if(!t)throw Error('missing_sheet_row');
     return {productId:x.productId,sheetId:t.sheetId,row:t.row,label:t.label,matchKey:x.key,fields:t.fields};
    });
    function awaitTitle(sheetId:number){
     return [
      [568394918,'SOLAR SPOTTERS'],[2017346590,'SPOTTERS'],[426115083,'HELIOS'],
      [386511683,'RANGERS'],[826256700,'SNIPERS'],[651684134,'CAM V & RSU'],
      [451969219,'RECONS'],[135363149,'RECON II'],[1975227208,'SOLAR STANDS 72'],
      [828079282,'SOLAR POLES & SKIDS'],[1900162010,'STANDS'],[1900162011,'WALL-E']
     ].find(a=>a[0]===sheetId)?.[1];
    }
    const answer=await rpc('cos_operational_sheet_sync_bootstrap',
      {p_lease:lease,p_source_sha:claimed.sourceSha256,p_rows:records});
    if(answer.committed!==true||answer.bootstrapped!==live.count)fail('bootstrap_rejected');
    stage='finish';
    const finished=await rpc('cos_operational_sheet_sync_finish',{p_lease:lease});
    if(finished.committed!==true)fail('lease_expired');
    lease=null;
    return reply({state:'baseline_verified',equipment:live.count,changesApplied:0});
   }
   if(claimed.mirrors.length!==live.count)fail('incomplete_mirror');
   const mirrors=claimed.mirrors as Mirror[];
   const pending=(claimed.outbox as Row[]).map(item=>({
     productId:item.productId,requestId:item.requestId,revision:item.revision,
     fields:cloneFields(item.fields)
   })) as Pending[];
   stage='plan';
   let plan=planOperationalSync(live.index,live.sheet,mirrors,pending);
   if(plan.coverage!==live.count||plan.held.some(x=>x.reason.startsWith('indexed_product')))
     fail('crosswalk_changed');
   stage='verify_again';
   let refreshed=await read();
   if(!equals(live,refreshed))fail('sheet_changed_before_stage');
   live=refreshed;
   // Inbound and outbound never apply to the same Product ID in one cycle.
   // A verified user edit in Sheets carries an exact prior mirror revision.
   stage='inbound';
   let inbound=0,conflicts=plan.held.length;
   for(const op of plan.inbound.slice(0,60)){
    try{
     const receipt=await rpc('cos_operational_sheet_sync_inbound',{
      p_lease:lease,p_source_sha:claimed.sourceSha256,
      p_product_id:op.productId,p_expected_mirror_revision:op.expectedMirrorRevision,
      p_request_id:crypto.randomUUID(),p_before:op.oldFields,p_after:op.newFields
     });
     if(receipt.committed!==true)fail('inbound_receipt');
     inbound++;
    }catch{conflicts++;}
   }
   // A successful Google request is not publication until an independent
   // exact-target Sheet readback is checked and settled into the mirror.
   stage='outbound_stage';let outgoing=0,recovered=0;
   const outbound=plan.outbound.slice(0,60),already=plan.alreadyPublished.slice(0,60-outbound.length);
   const asProof=(list:Outbound[])=>list.map(p=>({
    productId:p.productId,requestId:p.requestId,revision:p.revision,
    oldFields:p.oldFields,newFields:p.newFields
   }));
   if(outbound.length){
    const staged=await rpc('cos_operational_sheet_sync_stage',{
     p_lease:lease,p_source_sha:claimed.sourceSha256,p_requests:asProof(outbound)
    });
    if(staged?.staged!==true||staged.count!==outbound.length)fail('stage_rejected');
    stage='google_write';
    const requests=operationalUpdateCells(outbound);
    if(requests.length){
     const written=await google(':batchUpdate?fields=spreadsheetId,replies',{requests,includeSpreadsheetInResponse:false});
     if(written.spreadsheetId!==BOOK||!Array.isArray(written.replies)||written.replies.length!==requests.length)fail('write_unverified');
    }
   }
   if(outbound.length||already.length){
    stage='readback';
    const verified=await read();
    const results=verifiedOperationalReadback([...outbound,...already],verified.sheet);
    const grouped=[...outbound,...already].map((p,i)=>({...asProof([p])[0],state:results[i].state}));
    stage='ack';
    const outcome=await rpc('cos_operational_sheet_sync_ack',{
     p_lease:lease,p_source_sha:claimed.sourceSha256,p_results:grouped
    });
    if(outcome.committed!==true||outcome.published+outcome.conflict!==grouped.length)fail('readback_not_settled');
    outgoing=outcome.published;
    recovered=results.slice(outbound.length).filter(r=>r.state==='published').length;
    conflicts+=outcome.conflict;
   }
   stage='finish';
   const done=await rpc('cos_operational_sheet_sync_finish',{p_lease:lease});
   if(done.committed!==true)fail('lease_expired');
   lease=null;
   return reply({state:'processed',equipment:live.count,inbound,outbound:outgoing,recovered,conflicts,
     held:plan.held.length});
  }catch(cause){
   // Redact provider bodies, OAuth tokens, customer addresses and row data.
   const reason=stage.startsWith('google')||stage==='readback'?'google_read':
     stage==='metadata'?'google_read':stage==='sheet_read'?'google_read':
     stage==='bootstrap_compare'||stage==='verify_again'?'conflict':'server';
   if(lease){
    try{
     const key=options.getEnv('SUPABASE_SERVICE_ROLE_KEY');
     if(key)await fetchJson(PRODUCT_URL+'/rest/v1/rpc/cos_operational_sheet_sync_fail',{
      method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,...JSON_HEADERS},
      body:JSON.stringify({p_lease:lease,p_error_code:reason})},2048);
    }catch{/* Preserve original failure; next lease naturally expires. */}
   }
   return reply({error:'Operational Sheets sync unavailable',phase:stage,reason},503);
  }
 };
}
