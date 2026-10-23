import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {exportPKCS8,importPKCS8,SignJWT,jwtVerify} from 'jose';
import {createScheduledPublisherRuntime} from '../../supabase/functions/cos-sheets-placement-publish/runtime.ts';
import {TRACKER_TABS} from '../../supabase/functions/cos-operations-pages/googleSheets.ts';
import {tabLayout,snapshotCell,planPublishing,assertPublishRequests,UNIT_TRACKER_WORKBOOK} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const native='https://tughscoxralhofrckvxy.supabase.co',email='cos-unit-tracker@causal-jigsaw-511211-k9.iam.gserviceaccount.com';
const now=Date.parse('2026-10-12T18:00:00Z');
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const account={type:'service_account',client_email:email,private_key_id:'synthetic-fixture-key',private_key:await exportPKCS8(pair.privateKey),token_uri:'https://oauth2.googleapis.com/token'};
const cell=s=>snapshotCell({userEnteredValue:{stringValue:s}});
const baseline=['Spotter 023.1','FIELD','Synthetic Builder','Synthetic Job'].map(cell);
const observation={equipmentId:'123',state:'confirmed',placement:'SHOP',customerId:'2',serviceLocationId:null,customerLabel:'Cameras Onsite LLC',siteLabel:'SHOP'};
const request=body=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':'synthetic-cron-secret'},body:JSON.stringify(body??{action:'run'})});
const json=(v,status=200)=>Response.json(v,{status});
function fixture({wrongAccount=false,googleDenied=false,nativeUrl=native}={}){
 let b={equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',baseline,pending:null,observation,sourceCurrent:true},liveCells=baseline;const calls=[];
 const metadata={spreadsheetId:UNIT_TRACKER_WORKBOOK,properties:{title:'2027 UNIT TRACKER'},sheets:TRACKER_TABS.map(t=>({properties:{sheetId:t.id,title:t.title,sheetType:'GRID',gridProperties:{rowCount:5,columnCount:20}}}))};
 const grid=()=>({...metadata,sheets:metadata.sheets.map(s=>({properties:s.properties,data:tabLayout(s.properties.sheetId).columns.map((c,i)=>({startColumn:c,rowData:[{values:[{userEnteredValue:{stringValue:tabLayout(s.properties.sheetId).headers[i]}}]},{values:[s.properties.sheetId===b.sheetId?{userEnteredValue:liveCells[i].entered}:{userEnteredValue:{stringValue:i===0?'Synthetic '+s.properties.sheetId:'FIELD'}}]}]}))}))});
 const env={SUPABASE_URL:nativeUrl,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',COS_GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({...account,...(wrongAccount?{client_email:'other@synthetic-fixture.iam.gserviceaccount.com'}:{})})};
 const handler=createScheduledPublisherRuntime({getEnv:n=>env[n],now:()=>now,signAssertion:async(key,header,payload)=>new SignJWT(payload).setProtectedHeader(header).sign(await importPKCS8(key,'RS256')),fetch:async(url,init)=>{
  calls.push({url:String(url),init});
  if(url==='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness')return json({authenticated:true});
  if(String(url).startsWith(native+'/rest/v1/rpc/')){const name=String(url).split('/').at(-1),v=JSON.parse(init.body);
   if(name.endsWith('begin'))return json({leaseId:'synthetic-lease',bindings:[b]});
   if(name.endsWith('stage')){b={...b,pending:v.p_intents[0].cells};return json({committed:true});}
   if(name.endsWith('request_refresh'))return json({accepted:true});
   if(name.endsWith('finish')){if(v.p_results[0].state==='published')b={...b,baseline:b.pending,pending:null};return json({committed:true,published:v.p_results.filter(x=>x.state==='published').length,held:0,sheetsPublisher:true});}
   if(name.endsWith('fail'))return json(null);throw Error('Unexpected RPC');
  }
  if(url==='https://oauth2.googleapis.com/token')return json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600});
  const u=new URL(url);assert.equal(u.origin,'https://sheets.googleapis.com');assert.equal(u.pathname.split('/')[3],UNIT_TRACKER_WORKBOOK+(init.method==='POST'?':batchUpdate':''));
  if(googleDenied)return new Response('private provider content',{status:403});
  if(init.method==='POST'){const body=JSON.parse(init.body);assertPublishRequests(body.requests);liveCells=b.pending;return json({spreadsheetId:UNIT_TRACKER_WORKBOOK,replies:body.requests.map(()=>({}))});}
  assert.equal(u.searchParams.get('prettyPrint'),'false');
  if(u.searchParams.has('ranges')){assert(u.searchParams.getAll('ranges').includes("'SPOTTERS'!B1:B2"));assert(u.searchParams.getAll('ranges').includes("'SPOTTERS'!A1:A5"));}
  return json(u.searchParams.has('ranges')?grid():metadata);
 }});
 return {handler,calls};
}
test('scheduled runtime signs a fixed Sheet write scope, sends one allowlisted batch and verifies readback; subsequent unchanged runs do not write',async()=>{
 const f=fixture(),response=await f.handler(request());assert.equal(response.status,200);assert.equal((await response.json()).published,1);
 const auth=f.calls.find(x=>x.url==='https://oauth2.googleapis.com/token'),form=new URLSearchParams(auth.init.body);
 const {payload}=await jwtVerify(form.get('assertion'),pair.publicKey,{algorithms:['RS256'],audience:auth.url,issuer:email,currentDate:new Date(now)});
 assert.equal(payload.scope,'https://www.googleapis.com/auth/spreadsheets');assert.equal(payload.exp-payload.iat,3600);assert.equal(payload.sub,undefined);
 const writes=f.calls.filter(x=>x.url.includes(':batchUpdate'));assert.equal(writes.length,1);assert.equal(writes[0].init.redirect,'error');
 assert.deepEqual(JSON.parse(writes[0].init.body).requests.map(x=>x.updateCells.range.startColumnIndex),[1,3,4]);
 for(const c of f.calls){assert(c.init.signal);assert.equal(c.init.redirect,'error');if(c.url.startsWith('https://sheets.googleapis.com'))assert.equal(c.init.headers.Authorization,'Bearer synthetic-access-token');}
 await f.handler(request());assert.equal(f.calls.filter(x=>x.url.includes(':batchUpdate')).length,1);assert.equal(f.calls.filter(x=>x.url===auth.url).length,1);
});
test('wrong native project/account and Google denial cannot publish or reveal credential/provider contents',async()=>{
 for(const opts of [{nativeUrl:'https://other.example.test'},{wrongAccount:true},{googleDenied:true}]){const f=fixture(opts),r=await f.handler(request());assert.equal(r.status,opts.nativeUrl?403:503);const text=await r.text();assert(!text.includes('PRIVATE KEY'));assert(!text.includes('private provider content'));assert.equal(f.calls.filter(x=>x.url.includes(':batchUpdate')).length,0);}
 const f=fixture();assert.equal((await f.handler(request({action:'run',workbookId:'other'}))).status,400);assert.equal(f.calls.filter(x=>x.url.startsWith('https://sheets.googleapis.com')||x.url.includes('/rpc/')).length,0);
});
test('transport preflight rejects any writes to identity, addresses, passwords, date columns or arbitrary operations',()=>{
 const b={equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',baseline,pending:null,observation,sourceCurrent:true},r={sheetId:b.sheetId,row:2,label:b.label,unique:true,cells:baseline};
 const requests=planPublishing([b],[r]).requests;assert.doesNotThrow(()=>assertPublishRequests(requests));
 for(const col of [0,2,5,6,10]){const bad=structuredClone(requests.slice(0,1));bad[0].updateCells.range.startColumnIndex=col;bad[0].updateCells.range.endColumnIndex=col+1;assert.throws(()=>assertPublishRequests(bad));}
 assert.throws(()=>assertPublishRequests([{appendCells:{sheetId:b.sheetId}}]));assert.throws(()=>assertPublishRequests([...requests,requests[0]]));
 const pole=structuredClone(requests.slice(0,1));pole[0].updateCells.range.sheetId=828079282;assert.throws(()=>assertPublishRequests(pole));
});
