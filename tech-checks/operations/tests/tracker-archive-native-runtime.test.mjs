import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildArchiveReaderOverlay,insertArchiveReaderOverlay,removeArchiveReaderOverlay,prepareArchivedWallEReaderRuntime,sha256} from '../scripts/prepareArchivedWallEReaderRuntime.mjs';

const folder=new URL('../docs/tracker-archive-reader-20261102/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('native-manifest.json',folder),'utf8'));
const overlay=await readFile(new URL('reader-overlay.js',folder),'utf8');
const original=await readFile(new URL('../../docs/deployed-cos-operations-pages-v134/source/productTcpRuntime.ts',import.meta.url),'utf8');
const candidate=insertArchiveReaderOverlay(original,overlay,manifest);
const temp=await mkdtemp(join(tmpdir(),'cos-archive-native-'));
await writeFile(join(temp,'original.mjs'),original);await writeFile(join(temp,'candidate.mjs'),candidate);
const oldRuntime=await import(pathToFileURL(join(temp,'original.mjs')).href);
const newRuntime=await import(pathToFileURL(join(temp,'candidate.mjs')).href);
test.after(async()=>{await rm(temp,{recursive:true,force:true});});

test('reviewed overlay is reproducible and preserves all original native bytes and exports',async()=>{
 assert.equal(await buildArchiveReaderOverlay(),overlay);
 assert.equal(sha256(candidate),manifest.expectedAfter['productTcpRuntime.ts']);
 assert.equal(candidate.replace(overlay,''),original);
 assert.deepEqual(Object.keys(newRuntime),Object.keys(oldRuntime));
 for(const key of Object.keys(oldRuntime))assert.equal(newRuntime[key].toString(),oldRuntime[key].toString(),key);
 assert.equal(removeArchiveReaderOverlay(candidate,overlay,manifest),original);
});
test('package assembly rejects changed module, overlay, duplicate application or function revision',async()=>{
 assert.throws(()=>insertArchiveReaderOverlay(original+'\n',overlay,manifest));
 assert.throws(()=>insertArchiveReaderOverlay(original,overlay+'\n',manifest));
 assert.throws(()=>insertArchiveReaderOverlay(candidate,overlay,manifest));
 assert.throws(()=>removeArchiveReaderOverlay(candidate+'\n',overlay,manifest));
 await assert.rejects(prepareArchivedWallEReaderRuntime({slug:'cos-operations-pages',status:'ACTIVE',version:138,files:[]}));
});

const at=Date.parse('2026-11-02T23:00:00Z'),hash='a'.repeat(64),filename='ServiceItem_List_20261023135432.csv';
const credential=JSON.stringify({type:'service_account',client_email:'synthetic@testing-project.iam.gserviceaccount.com',
 token_uri:'https://oauth2.googleapis.com/token',private_key_id:'synthetickey123',private_key:'-----BEGIN PRIVATE KEY-----\nfake-synthetic-only-not-a-key\n-----END PRIVATE KEY-----\n'});
function fixture(options={}){
 const products=[{productId:'11',unitNumber:'Ranger 011',customer:'Synthetic Builders',placement:'FIELD'},
  {productId:'12',unitNumber:'Ranger 012',customer:'Synthetic Builders',placement:'FIELD'}];
 const ranges=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500",
  "'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200","'UNIT OVERVIEW'!H1:H1500"];
 const values=[
  [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...products.map(p=>['RANGERS',p.unitNumber,p.placement,'UNKNOWN',p.customer])],
  [['MHELP EQUIPMENT ID'],['11'],['12']],
  [['TRACKER PLACEMENT','MHELP PLACEMENT'],['FIELD','FIELD'],['FIELD','FIELD']],
  [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],['RANGERS|Ranger 011','11'],['RANGERS|Ranger 012','12'],['WALL-E|WA 001','99']],
  [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],['Ranger 011','Synthetic Builders'],['Ranger 012','Synthetic Builders'],['WA 001','Cameras OnSite']],
  [['MHELP SOURCE EXPORT'],[filename],[filename],[filename]],
  [['IP'],['8.8.8.8'],['9.9.9.9']]
 ].map((values,i)=>({range:ranges[i],majorDimension:'ROWS',values}));
 const archiveNames=["'WALL-E'!A1:B1000","'WALL-E'!G1:G1000","'WALL-E'!BE1:BH1000"];
 const archived=[
  [['UNIT #','PLACEMENT'],['WA 001','SHOP']],
  [['IP'],[options.shared?'8.8.8.8':'']],
  [['MHELP EQUIPMENT ID','MASTER MEMBERSHIP','MHELP PLACEMENT','LIFECYCLE RESTRICTION'],['99','ARCHIVED','SHOP',options.badArchive?'':'DECOMMISSIONED']]
 ].map((values,i)=>({range:archiveNames[i],majorDimension:'ROWS',values}));
 const calls=[];
 const fetch=async(url,init)=>{
  calls.push({url:String(url),method:init.method});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer'});
  const parsed=new URL(url);
  assert.equal(parsed.origin,'https://sheets.googleapis.com');assert.equal(init.method,'GET');
  if(parsed.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:parsed.searchParams.getAll('ranges')[0].startsWith("'WALL-E'!")?archived:values});
  return Response.json({spreadsheetId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',properties:{title:'2027 UNIT TRACKER'},sheets:[
   {properties:{sheetId:1132540236,title:'UNIT OVERVIEW',sheetType:'GRID',gridProperties:{rowCount:1500,columnCount:23}}},
   {properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',gridProperties:{rowCount:1200,columnCount:9}}},
   {properties:{sheetId:1900162011,title:'WALL-E',sheetType:'GRID',gridProperties:{rowCount:1000,columnCount:65}}}
  ]});
 };
 const context=runtime=>runtime.existingNativeProductSourceContext({source:{unchanged:'sentinel'},now:()=>at,
  googleSheets:{getServiceAccountJson:()=>credential,signAssertion:async()=> 'synthetic.header.signature',fetch}});
 return {products,calls,context,read:runtime=>context(runtime).tracker(products,hash,new AbortController().signal)};
}
test('actual native adapter uses the new reader, while the original rejects the historical census',async()=>{
 const f=fixture();await assert.rejects(f.read(oldRuntime),/evidence is unavailable/);
 const proof=await f.read(newRuntime);
 assert.equal(proof.records.length,2);assert.equal(proof.records.some(r=>r.productId==='99'),false);
 assert.deepEqual(proof.records.map(r=>r.reviewReasons),[[],[]]);
 assert.equal(f.context(newRuntime).unchanged,'sentinel');
 assert.equal(f.calls.filter(c=>c.method==='POST').every(c=>c.url==='https://oauth2.googleapis.com/token'),true);
});
test('assembled native runtime retains archived shared-IP hold and existing completed-check classifications',async()=>{
 const f=fixture({shared:true}),proof=await f.read(newRuntime),stamp=new Date(at).toISOString();
 const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:hash,receivedAt:stamp,
  summary:{totalRecords:2,fieldRecords:2,shopRecords:0,unflaggedFieldRecords:2,doNotUseRecords:0,missingRecords:0},
  records:f.products.map(p=>({productId:p.productId,recordId:'mhelp_product:'+p.productId,placement:p.placement,uploadLifecycle:'UNFLAGGED'}))};
 const endpoints=[['11','8.8.8.8'],['12','9.9.9.9']].map(([id,ip])=>({deviceId:Number(id),publicIp:ip,expectedPorts:[80],monitoringEnabled:true,connectionRevision:1,
  portStatus:{80:{online:true,attempted:true},_connection:{ip,revision:1,checkedAt:stamp,status:'online',reachable:true}}}));
 const members=new Map([['11',['11']],['12',['12']]]);
 const result=newRuntime.buildExactProductConnections(accepted,proof,endpoints,at,members);
 assert.deepEqual(result.items.map(r=>r.status),['unknown','online']);
 endpoints[1].portStatus[80].online=false;endpoints[1].portStatus._connection.status='offline';endpoints[1].portStatus._connection.reachable=false;
 assert.deepEqual(newRuntime.buildExactProductConnections(accepted,proof,endpoints,at,members).items.map(r=>r.status),['unknown','offline']);
 assert.doesNotMatch(JSON.stringify(result),/8\.8\.8\.8|9\.9\.9\.9|synthetic-access-token/);
});
test('assembled native runtime rejects unconfirmed archive evidence',async()=>{
 await assert.rejects(fixture({badArchive:true}).read(newRuntime),/evidence is unavailable/);
});
