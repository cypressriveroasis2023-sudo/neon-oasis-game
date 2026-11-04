import test from 'node:test';
import assert from 'node:assert/strict';
import {existingNativeProductSourceContext,buildTrackerIpReachability} from '../../docs/fleet-provenance-repair-20261104/source/productTcpRuntime.ts';
const workbook='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',hash='a'.repeat(64),now=Date.parse('2026-11-04T16:00:00Z');
const label='MHelpDesk pull accepted 2026-11-04 06:36 CT';
const credential=JSON.stringify({type:'service_account',token_uri:'https://oauth2.googleapis.com/token',client_email:'synthetic@testing-project.iam.gserviceaccount.com',private_key_id:'synthetickey123',private_key:'-----BEGIN PRIVATE KEY-----\nfake-synthetic-only-not-a-key\n-----END PRIVATE KEY-----\n'});
const candidate=[{productId:'11',unitNumber:'Ranger 001',placement:'FIELD',customer:'Synthetic Customer'},{productId:'12',unitNumber:'Ranger 002',placement:'SHOP',customer:'Cameras Onsite LLC'}];
const names=["'UNIT OVERVIEW'!A1:E1500","'UNIT OVERVIEW'!O1:O1500","'UNIT OVERVIEW'!Q1:R1500","'MHELP MATCH INDEX'!A1:B1200","'MHELP MATCH INDEX'!D1:E1200","'MHELP MATCH INDEX'!H1:H1200","'UNIT OVERVIEW'!H1:H1500"];
function fixture(options={}){
 const values=[
 [['EQUIPMENT TYPE','UNIT #','PLACEMENT','LIVE STATUS','CUSTOMER'],...candidate.map(r=>['RANGERS',r.unitNumber,r.placement,'UNKNOWN',r.customer])],
 [['MHELP EQUIPMENT ID'],...candidate.map(r=>[r.productId])],
 [['TRACKER PLACEMENT','MHELP PLACEMENT'],...candidate.map(r=>[r.placement,r.placement])],
 [['TRACKER MATCH KEY','MHELP EQUIPMENT ID'],...candidate.map(r=>['RANGERS|'+r.unitNumber,r.productId])],
 [['MHELP EQUIPMENT NAME','MHELP CUSTOMER / SITE'],...candidate.map(r=>[r.unitNumber,r.customer])],
 [['MHELP SOURCE EXPORT'],...candidate.map(()=>[options.label??label])],
 [['IP'],['8.8.8.8'],[options.sharedIp?'8.8.8.8':'']]
 ];
 if(options.extra){values[3].push(['REMOVED|Retired unit','99']);values[4].push(['Retired unit','Cameras Onsite LLC']);values[5].push([options.label??label]);}
 const archiveNames=["'WALL-E'!A1:B100","'WALL-E'!G1:G100","'WALL-E'!BE1:BH100"];
 const archiveValues=[[['UNIT #','PLACEMENT']],[['IP']],[['MHELP EQUIPMENT ID','MASTER MEMBERSHIP','MHELP PLACEMENT','LIFECYCLE RESTRICTION']]];
 if(options.archivedIp){archiveValues[0].push(['Archived WALL-E','SHOP']);archiveValues[1].push(['8.8.8.8']);archiveValues[2].push(['98','ARCHIVED','SHOP','DECOMMISSIONED']);}
 const metadata={spreadsheetId:workbook,properties:{title:'2027 UNIT TRACKER'},sheets:[{properties:{sheetId:1132540236,title:'UNIT OVERVIEW',sheetType:'GRID',gridProperties:{rowCount:1500,columnCount:23}}},{properties:{sheetId:1900169011,title:'MHELP MATCH INDEX',sheetType:'GRID',gridProperties:{rowCount:1200,columnCount:9}}},{properties:{sheetId:1900162011,title:'WALL-E',sheetType:'GRID',gridProperties:{rowCount:100,columnCount:65}}}]};
 const calls=[];
 const context=existingNativeProductSourceContext({source:{platformRpc:async(name,signal)=>{calls.push(name);assert.equal(name,'cos_mhelp_placement_snapshot');assert.equal(signal.aborted,false);return {upload:{contract:'COS_MHELP_API_V1',complete:true,sourceSha256:options.changedSource?'b'.repeat(64):hash,apiMissingRecords:(options.absent??[]).map(productId=>({productId}))}};}},now:()=>now,googleSheets:{getServiceAccountJson:()=>credential,signAssertion:async()=> 'synthetic.header.signature',fetch:async(url,init)=>{
 calls.push(String(url));
 if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:3600});
 assert.equal(init.headers.Authorization,'Bearer synthetic-access-token');
 if(String(url).includes('/values:batchGet')){const archive=new URL(String(url)).searchParams.getAll('ranges')[0].includes('WALL-E');return Response.json({valueRanges:(archive?archiveValues:values).map((values,i)=>({range:(archive?archiveNames:names)[i],majorDimension:'ROWS',values}))});}
 return Response.json(metadata);
 }}});
 return {calls,read:signal=>context.tracker(candidate,hash,signal??new AbortController().signal)};
}
const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:hash,receivedAt:new Date(now).toISOString(),summary:{totalRecords:2,fieldRecords:1,shopRecords:1,unflaggedFieldRecords:1,doNotUseRecords:0,missingRecords:0},records:candidate.map(r=>({...r,recordId:'mhelp_product:'+r.productId,uploadLifecycle:'UNFLAGGED'}))};
const device={deviceId:1,publicIp:'8.8.8.8',expectedPorts:[81],connectionRevision:1,monitoringEnabled:true,activationState:'active',portStatus:{81:{online:true,latency_ms:10},_connection:{ip:'8.8.8.8',revision:1,status:'online',reachable:true,checkedAt:new Date(now).toISOString()}}};
test('actual deployed reader and classifier accept truthful API provenance together',async()=>{const f=fixture(),tracker=await f.read();assert.equal(tracker.sourceExport,label);assert.equal(tracker.records.length,2);assert.equal(f.calls[0],'cos_mhelp_placement_snapshot');const result=buildTrackerIpReachability(accepted,tracker,[device],now);assert.equal(result.items.length,1);assert.equal(result.items[0].status,'online');});
test('recorded deployment still accepts legacy CSV provenance',async()=>{const tracker=await fixture({label:'ServiceItem_List_20261016131754.csv'}).read();assert.equal(buildTrackerIpReachability(accepted,tracker,[device],now).items[0].status,'online');});
test('explicitly absent historical index rows do not block current equipment',async()=>{const tracker=await fixture({extra:true,absent:['99']}).read();assert.deepEqual(tracker.records.map(r=>r.productId),['11','12']);});
test('unexplained historical membership is still rejected',async()=>{await assert.rejects(fixture({extra:true}).read());});
test('an active Product ID cannot also be declared absent',async()=>{await assert.rejects(fixture({absent:['11']}).read());});
test('duplicate and invalid absence evidence are rejected',async()=>{for(const absent of [['99','99'],['not-an-id']])await assert.rejects(fixture({absent}).read());});
test('a changed protected source stops before any Google request',async()=>{const f=fixture({changedSource:true});await assert.rejects(f.read());assert.deepEqual(f.calls,['cos_mhelp_placement_snapshot']);});
test('the deployed archive-IP reservation still prevents a positive',async()=>{const tracker=await fixture({archivedIp:true}).read();assert.ok(tracker.records[0].reviewReasons.includes('tracker_restriction'));assert.equal(buildTrackerIpReachability(accepted,tracker,[device],now).items[0].status,'unknown');});
test('a shared Shop IP remains held and Shop is excluded from Field results',async()=>{const tracker=await fixture({sharedIp:true}).read();const result=buildTrackerIpReachability(accepted,tracker,[device],now);assert.equal(result.items.length,1);assert.equal(result.items[0].status,'unknown');});
test('cancellation stops before reading protected inventory',async()=>{const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.read(c.signal));assert.equal(f.calls.length,0);});
