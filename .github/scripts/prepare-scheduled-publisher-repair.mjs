import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sourceCommit='1ddb5df2228d1a584393884182406bca90efd1d8';
const directory='tech-checks/docs/fleet-scheduled-repair-20261104/source';
const read=p=>execFileSync('git',['show',sourceCommit+':'+p],{encoding:'utf8'});
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Recorded publisher source changed: '+a);return s.replace(a,b);};
const root='tech-checks/supabase/functions/';
// Reproduce the deployed v17 publisher behavior from its unchanged small source
// modules. The deployed heldReasons diagnostic is preserved explicitly.
let index=read(root+'cos-sheets-placement-publish/index.ts');
index=once(index,"from './model.ts'","from '../../../supabase/functions/cos-sheets-placement-publish/model.ts'");
index=once(index,"return reply({state:'current',...done});","return reply({state:'current',...done,heldReasons:plan.results.reduce((counts:Record<string,number>,r:Row)=>{if(r.state==='held')counts[r.reason]=(counts[r.reason]||0)+1;return counts;},Object.create(null))});");
let runtime=read(root+'cos-sheets-placement-publish/runtime.ts');
runtime=once(runtime,"from './model.ts'","from '../../../supabase/functions/cos-sheets-placement-publish/model.ts'");
runtime=runtime.replaceAll("from '../cos-operations-pages/googleSheets.ts'","from '../../../supabase/functions/cos-operations-pages/googleSheets.ts'");
const serve=`import {createScheduledPublisherRuntime} from './runtime.ts';\nimport {createScheduledNativeEndpointSourceRuntime} from './trackerEndpointNativeSource.mjs';\nimport {signSheetsAssertion} from '../../../supabase/functions/cos-operations-pages/googleSheetsRuntime.ts';\nconst options={getEnv:(name:string)=>Deno.env.get(name),fetch,signAssertion:signSheetsAssertion};\nconst publisher=createScheduledPublisherRuntime(options);\nconst endpointSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true});\nconst cameraSnapshotSource=createScheduledNativeEndpointSourceRuntime({...options,enabled:true,snapshotSource:true});\nDeno.serve(request=>new URL(request.url).pathname.endsWith('/camera-snapshot-source')?cameraSnapshotSource(request):new URL(request.url).pathname.endsWith('/endpoint-source')?endpointSource(request):publisher(request));\n`;
fs.mkdirSync(directory,{recursive:true});
for(const [name,content] of Object.entries({'index.ts':index,'runtime.ts':runtime,'serve.ts':serve}))fs.writeFileSync(directory+'/'+name,content);
// Run the existing publisher tests against the candidate handler as well as the
// original module. No production data or credentials are used by these tests.
const original=read('tech-checks/operations/tests/sheets-placement-publisher.test.mjs');
fs.writeFileSync('tech-checks/operations/tests/fleet-scheduled-publisher.test.mjs',once(original,"from '../../supabase/functions/cos-sheets-placement-publish/index.ts'","from '../../docs/fleet-scheduled-repair-20261104/source/index.ts'"));
const files=fs.readdirSync(directory).map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(directory+'/'+name)).digest('hex')}));
fs.writeFileSync('tech-checks/docs/fleet-scheduled-repair-20261104/manifest.json',JSON.stringify({scope:'Candidate, not deployed by this script',previous:{slug:'cos-sheets-placement-publish',version:17,archive:'28b8a0733eff6aa2a14943d42edd309c7d0b98162bc4e29b8a0ccd3c364611f2'},publisherSourceCommit:sourceCommit,preserved:['publisher authentication','publisher bounded request parsing','publisher compare-before-write and readback','heldReasons diagnostic','snapshot-source contract','mHelp freshness and exact-ID holds'],change:'Scheduled source uses the v154 tested tracker reader; deployment must pin this complete commit.',files},null,2)+'\n');
