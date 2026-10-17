// Prepare a bounded patch against the actual deployed bridge. Do not replace
// production-only import type guards or approved Victron embed configuration.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import ts from 'typescript';
const [input,expected,output]=process.argv.slice(2);
if(!input||!expected||!output)throw Error('Usage: input-runtime expected-SHA256 output-directory');
const live=await readFile(input,'utf8'),hash=v=>createHash('sha256').update(v).digest('hex');
if(hash(live)!==expected)throw Error('Production runtime changed; re-read and review it.');
if(live.includes('CosMhelpAddressRelease'))throw Error('Address patch already present.');
const anchor='combined=projectCombinedFleetRoster(effective,freshAudits,freshBundle.identity);';
if(live.split(anchor).length!==2)throw Error('Expected exactly one Field Map insertion boundary.');
const start=live.indexOf(anchor)+anchor.length,end=live.indexOf('if(snapshots[path])',start);
if(end<start)throw Error('Field Map boundary unavailable.');
const before=live.slice(0,start),after=live.slice(end),original=live.slice(start,end);
if(!original.includes('sourceEquipmentAddressCandidates(combined,')||!original.includes('return json('))throw Error('Field Map receipt route changed.');
const helper=await build({entryPoints:[resolve('..','supabase/functions/cos-operations-pages/mhelpAddressMap.ts')],bundle:true,format:'iife',globalName:'CosMhelpAddressRelease',platform:'neutral',minifyWhitespace:true,minifySyntax:true,write:false});
const header=helper.outputFiles[0].text;
const addition="const withMhelpAddress=await CosMhelpAddressRelease.withMhelpAddressMap(combined,mhelpReceipt?.upload,signal=>rpc('cos_mhelp_census_map_snapshot',actorPayload,signal),request.signal);";
const changed=original.replace(/\bcombined\b/g,'withMhelpAddress');
const result=header+before+addition+changed+after;
// Every original byte outside the one optional read/projection remains intact.
if(result.slice(header.length,header.length+before.length)!==before||!result.endsWith(after)
 ||changed.replace(/\bwithMhelpAddress\b/g,'combined')!==original)throw Error('Unrelated runtime changed.');
const parsed=ts.createSourceFile('serve.ts',result,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
if(parsed.parseDiagnostics.length)throw Error('Prepared runtime syntax invalid.');
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'serve.ts'),result);
await writeFile(resolve(output,'helper.js'),header);
await writeFile(resolve(output,'manifest.json'),JSON.stringify({baseSha256:hash(live),runtimeSha256:hash(result),helperSha256:hash(header),insertionBoundary:anchor,onlyFieldMapReadChanged:true,unrelatedBytesPreserved:true},null,2)+'\n');
console.log(JSON.stringify({baseSha256:hash(live),runtimeSha256:hash(result),unrelatedBytesPreserved:true}));
