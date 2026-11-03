import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {insertArchiveReaderOverlay} from '../scripts/prepareArchivedWallEReaderRuntime.mjs';
import {buildTrackerReachabilityOverlay,patchReachabilityFiles,prepareTrackerReachabilityRuntime,sha256,savedCall,targetCall,configBefore,configAfter} from '../scripts/prepareTrackerReachabilityRuntime.mjs';
const docs=new URL('../docs/',import.meta.url);
const baseManifest=JSON.parse(await readFile(new URL('tracker-archive-reader-20261102/native-manifest.json',docs),'utf8'));
const archive=await readFile(new URL('tracker-archive-reader-20261102/reader-overlay.js',docs),'utf8');
const old134=await readFile(new URL('../../docs/deployed-cos-operations-pages-v134/source/productTcpRuntime.ts',import.meta.url),'utf8');
const old138=insertArchiveReaderOverlay(old134,archive,baseManifest);
const overlay=await readFile(new URL('tracker-ip-reachability-20261102/reader-overlay.js',docs),'utf8');
const manifest=JSON.parse(await readFile(new URL('tracker-ip-reachability-20261102/native-manifest.json',docs),'utf8'));
const candidate=old138.replace('export {\n',overlay+'export {\n  buildTrackerIpReachability,\n');
const temp=await mkdtemp(join(tmpdir(),'cos-tracker-reach-'));
await writeFile(join(temp,'before.mjs'),old138);await writeFile(join(temp,'after.mjs'),candidate);
const before=await import(pathToFileURL(join(temp,'before.mjs')).href),after=await import(pathToFileURL(join(temp,'after.mjs')).href);
test.after(async()=>{await rm(temp,{recursive:true,force:true});});
test('native package adds only a new reachability export and preserves original exports and archive repair',async()=>{
 assert.equal(await buildTrackerReachabilityOverlay(),overlay);assert.equal(sha256(candidate),manifest.expectedAfter['productTcpRuntime.ts']);
 assert.equal(candidate.replace(overlay,'').replace('export {\n  buildTrackerIpReachability,\n','export {\n'),old138);
 for(const key of Object.keys(before))assert.equal(after[key].toString(),before[key].toString(),key);
 assert.deepEqual(Object.keys(after).filter(k=>!Object.hasOwn(before,k)),['buildTrackerIpReachability']);
});
test('two-file patch and rollback are exact; unrelated drift or repeated application is rejected',()=>{
 const serve='start\n'+savedCall+';\n'+configBefore+'source\nend';
 const files=[{name:'serve.ts',content:serve},{name:'productTcpRuntime.ts',content:old138},...['trackerEndpointRead.mjs','trackerEndpointProducer.mjs','deno.json'].map(name=>({name,content:'unchanged '+name}))];
 const expectedBefore=Object.fromEntries(files.map(f=>[f.name,sha256(f.content)])),expectedAfter={...expectedBefore,
  'serve.ts':sha256(serve.replace(savedCall,targetCall).replace(configBefore,configAfter)),'productTcpRuntime.ts':sha256(candidate)};
 const m={...manifest,expectedBefore,expectedAfter};
 const patched=patchReachabilityFiles(files,overlay,m);assert.deepEqual(patchReachabilityFiles(patched,overlay,m,true),files);
 assert.throws(()=>patchReachabilityFiles(patched,overlay,m));
 assert.throws(()=>patchReachabilityFiles([...files.slice(0,4),files[0]],overlay,m));
 assert.throws(()=>patchReachabilityFiles(files,overlay+'\n',m));
 const drift=structuredClone(files);drift[2].content+='x';assert.throws(()=>patchReachabilityFiles(drift,overlay,m));
});
test('native runtime classifies current tracker-IP checks without native membership but retains strict physical attribution',()=>{
 const now=Date.parse('2026-11-03T00:30:00Z'),at=new Date(now-60000).toISOString(),hash='a'.repeat(64);
 const accepted={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:hash,receivedAt:at,
  summary:{totalRecords:1,fieldRecords:1,shopRecords:0,unflaggedFieldRecords:1,doNotUseRecords:0,missingRecords:0},
  records:[{productId:'11',recordId:'mhelp_product:11',placement:'FIELD',uploadLifecycle:'UNFLAGGED'}]};
 const tracker={contract:'COS_VERIFIED_2027_PRODUCT_IPS_V2',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',expectedMhelpSourceSha256:hash,verifiedAt:at,trackerSourceSha256:'b'.repeat(64),sourceExport:'ServiceItem_List_20261023135432.csv',
  records:[{productId:'11',recordId:'mhelp_product:11',placement:'FIELD',publicIp:'8.8.8.8',sourceRow:2,reviewReasons:[]}]};
 const devices=[{deviceId:536,publicIp:'8.8.8.8',expectedPorts:[80],connectionRevision:1,monitoringEnabled:true,activationState:'active',portStatus:{80:{online:true,attempted:true},_connection:{ip:'8.8.8.8',revision:1,checkedAt:at,status:'online',reachable:true}}}];
 assert.equal(after.buildTrackerIpReachability(accepted,tracker,devices,now).items[0].status,'online');
 assert.equal(after.buildExactProductConnections(accepted,tracker,devices,now).items[0].status,'unknown');
 devices[0].portStatus[80].online=false;devices[0].portStatus._connection.status='offline';devices[0].portStatus._connection.reachable=false;
 assert.equal(after.buildTrackerIpReachability(accepted,tracker,devices,now).items[0].status,'offline');
 tracker.records[0].reviewReasons=['tracker_restriction'];assert.equal(after.buildTrackerIpReachability(accepted,tracker,devices,now).items[0].status,'unknown');
});
test('preparer refuses a different deployed revision before inspecting payload bytes',async()=>{
 await assert.rejects(prepareTrackerReachabilityRuntime({slug:'cos-operations-pages',status:'ACTIVE',version:139,verify_jwt:false}));
});
