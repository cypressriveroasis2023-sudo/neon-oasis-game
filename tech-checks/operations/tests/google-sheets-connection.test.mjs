import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
import {exportPKCS8,importPKCS8,SignJWT,jwtVerify} from 'jose';
import {createSheetsConnection,TRACKER_TABS} from '../../supabase/functions/cos-operations-pages/googleSheets.ts';
import {UNIT_TRACKER_WORKBOOK as workbook} from '../../supabase/functions/cos-operations-pages/unitTracker.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {createSheetsReadiness} from '../../supabase/functions/cos-sheets-readiness/index.ts';
import {checkedSheetsConnection} from '../src/sheetsConnectionModel.ts';
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const serviceAccount={type:'service_account',client_email:'cos-unit-tracker@synthetic-fixture.iam.gserviceaccount.com',private_key_id:'synthetic-key-id',private_key:await exportPKCS8(pair.privateKey),token_uri:'https://oauth2.googleapis.com/token'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const cell=(text,formula)=>({formattedValue:text,effectiveValue:{stringValue:text},userEnteredValue:formula?{formulaValue:formula}:{stringValue:text}});
function document(grid=false){return {spreadsheetId:workbook,properties:{title:'2027 UNIT TRACKER'},sheets:TRACKER_TABS.map((t,i)=>({properties:{sheetId:t.id,title:t.title,sheetType:'GRID',gridProperties:{rowCount:25,columnCount:50}},...(grid?{data:[{rowData:[{values:t.headers.map(h=>cell(h))},{values:[cell(i===0?'Solar Spotter 023.1':i===1?'Solar Spotter 023.1':t.title+' 029.2'),...(t.columns===2?[cell(i===1?'REVIEW':'FIELD',i===2?'="FIELD"':undefined)]:[])]}]}]}:{})}))};}
function fixture({credential=JSON.stringify(serviceAccount),fetcher,clock=()=>Date.parse('2026-10-09T19:00:00Z')}={}){
 const calls=[];let config=credential,reads=0;
 const handler=createSheetsConnection({getServiceAccountJson:()=>{reads++;return config;},signAssertion:async(key,header,payload)=>new SignJWT(payload).setProtectedHeader(header).sign(await importPKCS8(key,'RS256')),now:clock,fetch:async(url,init)=>{calls.push({url,init});if(fetcher)return fetcher(url,init,calls);return url.endsWith('/token')?json({access_token:'synthetic-only-access-token',token_type:'Bearer',expires_in:3600}):json(document(new URL(url).searchParams.has('ranges')));}});
 return {handler,calls,setConfig:v=>config=v,get reads(){return reads;}};
}
const check=f=>f.handler('/api/unit-tracker/sheets/check','POST',{});
test('status and missing-key checks are honest, bounded configuration reads without a Google request',async()=>{
 const missing=fixture({credential:null}),status=checkedSheetsConnection(await missing.handler('/api/unit-tracker/sheets/status','GET',{}));
 assert.equal(status.state,'setup_required');assert.equal(status.readAccessVerified,false);assert.equal(missing.calls.length,0);
 assert.equal((await check(missing)).state,'setup_required');assert.equal(missing.calls.length,0);
 const configured=fixture(),ready=checkedSheetsConnection(await configured.handler('/api/unit-tracker/sheets/status','GET',{}));
 assert.equal(ready.state,'ready_to_test');assert.equal(ready.serviceAccountEmail,serviceAccount.client_email);assert.equal(configured.calls.length,0);assert.equal(JSON.stringify(ready).includes('PRIVATE KEY'),false);
});
test('real RSA signature has only fixed Google audience/read scope, no delegated user, and a one-hour lifetime',async()=>{
 const f=fixture(),result=checkedSheetsConnection(await check(f));
 const auth=f.calls[0];assert.equal(auth.url,'https://oauth2.googleapis.com/token');assert.equal(auth.init.method,'POST');assert.equal(auth.init.redirect,'error');
 const form=new URLSearchParams(auth.init.body);assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
 const {payload,protectedHeader}=await jwtVerify(form.get('assertion'),pair.publicKey,{algorithms:['RS256'],audience:auth.url,issuer:serviceAccount.client_email,currentDate:new Date('2026-10-09T19:00:00Z')});
 assert.equal(protectedHeader.kid,serviceAccount.private_key_id);assert.equal(payload.scope,'https://www.googleapis.com/auth/spreadsheets.readonly');assert.equal(payload.exp-payload.iat,3600);assert.equal(payload.sub,undefined);
 assert.equal(result.state,'read_access_verified');assert.equal(result.equipmentRows,10);assert.equal(result.duplicateLabelRows,1);assert.equal(result.formulaRows,1);assert.equal(result.placementReviewRows,1);
 assert.equal(result.sheetsPublisher,false);assert.equal(result.automaticSync,false);assert.equal(result.tabs.length,10);
 for(const secret of [serviceAccount.private_key,'synthetic-only-access-token','Solar Spotter 023.1'])assert.equal(JSON.stringify(result).includes(secret),false);
});
test('only the grounded workbook and identity/placement ranges are read; password, date and overview cells never enter transport',async()=>{
 const f=fixture();await check(f);assert.equal(f.calls.length,3);
 for(const {url,init} of f.calls.slice(1)){const u=new URL(url);assert.equal(u.origin,'https://sheets.googleapis.com');assert.equal(u.pathname,'/v4/spreadsheets/'+workbook);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(u.href.includes('synthetic-only-access-token'),false);let depth=0;for(const char of u.searchParams.get('fields')){if(char==='(')depth++;if(char===')')depth--;assert.ok(depth>=0);}assert.equal(depth,0);}
 const ranges=new URL(f.calls[2].url).searchParams.getAll('ranges');assert.equal(ranges.length,10);
 assert.ok(ranges.includes("'SOLAR POLES & SKIDS'!A1:A25"));assert.ok(ranges.includes("'SPOTTERS'!A1:B25"));
 assert.equal(ranges.some(r=>/PASSWORD|ARCHIVE|OVERVIEW|UNMATCHED|!A1:[C-Z]/.test(r)),false);
 assert.ok(new URL(f.calls[2].url).searchParams.get('fields').includes('userEnteredValue'));
});
test('token cache renews when expired or protected configuration changes, while each workbook check remains fresh',async()=>{
 let now=Date.parse('2026-10-09T19:00:00Z');const f=fixture({clock:()=>now});await check(f);await check(f);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,1);assert.equal(f.calls.length,5);
 now+=3600000;await check(f);assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,2);
 f.setConfig(JSON.stringify(serviceAccount)+' ');await check(f);assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,3);
});
test('caller-controlled credentials, workbook, endpoint or range fail before configuration/provider access',async()=>{
 const f=fixture();for(const body of [{token:'ignored'},{workbookId:workbook},{range:'PASSWORDS!A1:Z50'},{actorId:randomUUID()},[]])await assert.rejects(f.handler('/api/unit-tracker/sheets/check','POST',body),e=>e.status===400);
 await assert.rejects(f.handler('/api/unit-tracker/sheets/check','GET',{}),e=>e.status===405);await assert.rejects(f.handler('/api/unit-tracker/sheets/publish','POST',{}),e=>e.status===404);assert.equal(f.reads,0);assert.equal(f.calls.length,0);
});
test('invalid account keys and arbitrary token hosts are rejected without emitting their content',async()=>{
 for(const config of ['synthetic-sensitive-password',JSON.stringify({...serviceAccount,token_uri:'https://evil.example'}),JSON.stringify({...serviceAccount,type:'authorized_user'}),JSON.stringify({...serviceAccount,client_email:'person@example.com'}),'x'.repeat(32769)]){
  const f=fixture({credential:config});await assert.rejects(check(f),e=>!e.message.includes(config));assert.equal(f.calls.length,0);
 }
 const f=fixture({credential:JSON.stringify({...serviceAccount,private_key:'-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----\n'})});await assert.rejects(check(f),/protected JSON secret/);assert.equal(f.calls.length,0);
});
test('changed workbook, tab, grid bounds, identity headers, or extra columns fail before a verified status',async()=>{
 for(const mutation of [v=>v.spreadsheetId='other-workbook',v=>v.properties.title='2026 UNIT TRACKER',v=>v.sheets[0].properties.sheetId=1,v=>v.sheets[0].properties.hidden=true,v=>v.sheets[0].properties.gridProperties.rowCount=10001,v=>v.sheets[0].properties.title='PASSWORDS']){
  const f=fixture({fetcher:url=>{if(url.endsWith('/token'))return json({access_token:'synthetic',token_type:'Bearer',expires_in:3600});const v=document(false);mutation(v);return json(v);}});await assert.rejects(check(f));assert.equal(f.calls.length,2);
 }
 for(const mutation of [v=>v.sheets[0].properties.gridProperties.rowCount=26,v=>v.sheets[0].data[0].rowData[0].values[1]=cell('Modem Pass'),v=>v.sheets[0].data[0].startRow=2,v=>v.sheets[0].data[0].rowData[1].values.push(cell('synthetic-sensitive-password')),v=>v.sheets[0].data=[]]){
  const f=fixture({fetcher:url=>{if(url.endsWith('/token'))return json({access_token:'synthetic',token_type:'Bearer',expires_in:3600});const grid=new URL(url).searchParams.has('ranges'),v=document(grid);if(grid)mutation(v);return json(v);}});await assert.rejects(check(f));
 }
});
test('provider errors, malformed tokens and oversized replies never disclose Google or credential response bodies',async()=>{
 for(const status of [401,403,404,429,500]){
  const f=fixture({fetcher:()=>json({error:'synthetic-sensitive-password'},status)});await assert.rejects(check(f),e=>!e.message.includes('synthetic-sensitive-password')&&e.status===(status===429?429:503));
 }
 for(const token of [{access_token:'bad token',token_type:'Bearer',expires_in:3600},{access_token:'synthetic',token_type:'Other',expires_in:3600},{access_token:'synthetic',token_type:'Bearer',expires_in:7200}])await assert.rejects(check(fixture({fetcher:()=>json(token)})),/incomplete authorization/);
 await assert.rejects(check(fixture({fetcher:()=>new Response('x'.repeat(32769))})),/oversized/);
 await assert.rejects(check(fixture({fetcher:()=>{throw Error(serviceAccount.private_key);}})),e=>!e.message.includes('PRIVATE KEY'));
});
test('a missing workbook share provides actionable sanitized guidance; a failed read does not become connected',async()=>{
 const f=fixture({fetcher:url=>url.endsWith('/token')?json({access_token:'synthetic',token_type:'Bearer',expires_in:3600}):json({error:{message:'synthetic-sensitive-password'}},403)});
 await assert.rejects(check(f),e=>e.message.includes('share the 2027 tracker')&&!e.message.includes('synthetic-sensitive-password'));
 assert.equal((await f.handler('/api/unit-tracker/sheets/status','GET',{})).readAccessVerified,false);
});
test('concurrent checks do not multiply token requests and the guard releases after completion',async()=>{
 let release;const f=fixture({fetcher:url=>url.endsWith('/token')?new Promise(resolve=>{release=()=>resolve(json({access_token:'synthetic',token_type:'Bearer',expires_in:3600}));}):json(document(new URL(url).searchParams.has('ranges')))});
 const first=check(f);while(!release)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(check(f),e=>e.status===409);release();await first;await check(f);assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,1);
});
test('client rejects fabricated publication, incomplete tab coverage, duplicate tabs and incorrect totals',async()=>{
 const good=await check(fixture());assert.equal(checkedSheetsConnection(good).equipmentRows,10);
 for(const change of [{sheetsPublisher:true},{automaticSync:true},{workbookId:'legacy_2026'},{state:'connected'},{checkedAt:null},{readAccessVerified:false},{equipmentRows:99},{tabs:good.tabs.slice(1)},{tabs:[good.tabs[0],...good.tabs.slice(0,9)]},{serviceAccountEmail:'person@example.com'}])assert.throws(()=>checkedSheetsConnection({...good,...change}));
});
test('Owner/IT/Service checks authenticate before reading configuration and preserve the existing IT allowlist',async()=>{
 for(const who of [{legacy:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',dept:'owner',role:'owner'},{legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',dept:'it',role:'it_technician'},{legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',dept:'service',role:'service_technician'}]){
  let configReads=0;const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-key',googleSheets:{getServiceAccountJson:()=>{configReads++;return undefined;}},fetch:async url=>{
   if(url.includes('/auth/v1/user'))return json({id:who.legacy});if(url.includes('/rest/v1/profiles?'))return json([{user_id:who.legacy,full_name:'Synthetic',role:who.dept,active:true,archived_at:null}]);if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:who.actor,display_name:'Synthetic',department:who.dept,active:true}]);if(url.includes('/rest/v1/user_roles?'))return json([{role_id:randomUUID(),roles:{code:who.role,organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);throw Error('Unexpected fixture request');}});
  const req=new Request('https://bridge.example',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/unit-tracker/sheets/check',method:'POST',body:{}})});
  const response=await handler(req);assert.equal(response.status,who.dept==='owner'?200:403);assert.equal(configReads,who.dept==='owner'?1:0);
 }
});
test('maintenance checks reject anonymous access and unsupported bodies before accessing Google configuration',async()=>{
 const f=fixture(),denied=createSheetsReadiness({authenticate:()=>false,sheets:f.handler});
 const request=body=>new Request('https://native.example',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await denied(request({action:'check'}))).status,403);assert.equal(f.reads,0);
 const allowed=createSheetsReadiness({authenticate:()=>true,sheets:f.handler});for(const body of [{action:'publish'},{action:'check',token:'secret'},{action:'check',range:'PASSWORDS!A1'}])assert.equal((await allowed(request(body))).status,400);
 assert.equal(f.reads,0);assert.equal((await allowed(request({action:'status'}))).status,200);assert.equal(f.calls.length,0);
});
