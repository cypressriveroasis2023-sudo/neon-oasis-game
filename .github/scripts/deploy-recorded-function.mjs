#!/usr/bin/env node
// Deploys a RECORDED edge-function artifact with an optional, reviewed, single-
// literal patch. It exists because cos-operations-pages v134 is a hand-assembled
// overlay that is NOT main's tech-checks/supabase/functions/cos-operations-pages
// directory: `supabase functions deploy` from this repository would silently
// replace production with a different implementation. This script never reads
// that directory. It deploys only the bytes under the patch's sourceDir, after
// proving they match the recorded hashes, applying the patch's edits exactly
// once each, and proving the result matches the expected-after hashes.
//
// Every stage fails closed. Nothing is deployed unless:
//   1. every source file hashes to expectedBefore;
//   2. every edit's needle occurs exactly `occurrences` times;
//   3. every patched file hashes to expectedAfter;
//   4. the live function matches requireLiveBeforeDeploy (status/version/archive).
// After deployment the script reads the live function back and hashes every
// served file against expectedAfter; a mismatch is a failure, not a warning.
// Live HTTP origin checks run last and are reported separately, because a
// correct byte deployment and a correct CORS response are different facts.
//
// Usage:
//   node deploy-recorded-function.mjs <patch.json> [--dry-run] [--deploy]
// --dry-run performs stages 1-3 only (no network, no credentials needed).
// --deploy requires SUPABASE_ACCESS_TOKEN and performs all stages.
//
// Exit codes: 0 deployed-and-verified (or dry-run OK), 1 precondition or
// verification failure, 2 platform unreadable, 3 no credentials.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

// Stages 1-3. Pure: takes the patch definition and a byte reader, returns the
// exact payload or throws. Never touches the network.
export function preparePayload(patch,readBytes){
  const names=Object.keys(patch.expectedBefore);
  for(const name of names){
    if(!patch.expectedAfter[name]) throw new Error(`patch lists ${name} in expectedBefore but not expectedAfter; stop`);
    if(!patch.deployedFileNames[name]) throw new Error(`patch has no deployed name for ${name}; stop`);
  }
  for(const name of Object.keys(patch.expectedAfter)) if(!patch.expectedBefore[name]) throw new Error(`patch lists ${name} in expectedAfter but not expectedBefore; stop`);
  for(const edit of patch.edits||[]){
    if(!names.includes(edit.file)) throw new Error(`edit targets ${edit.file}, which is not a recorded file; stop`);
    if(!Number.isInteger(edit.occurrences)||edit.occurrences<1) throw new Error(`edit for ${edit.file} must state a positive occurrence count; stop`);
    if(typeof edit.needle!=='string'||edit.needle.length===0) throw new Error(`edit for ${edit.file} has an empty needle; stop`);
    if(typeof edit.replacement!=='string') throw new Error(`edit for ${edit.file} has no replacement; stop`);
  }
  const files=[];
  for(const name of names){
    let data=readBytes(name);
    const before=sha256(data);
    if(before!==patch.expectedBefore[name]) throw new Error(`before hash mismatch for ${name}: expected ${patch.expectedBefore[name].slice(0,12)}..., got ${before.slice(0,12)}...; stop`);
    for(const edit of (patch.edits||[]).filter(e=>e.file===name)){
      const needle=Buffer.from(edit.needle,'utf8');
      const count=countOccurrences(data,needle);
      if(count!==edit.occurrences) throw new Error(`needle for ${name} occurs ${count} times, expected ${edit.occurrences}; stop`);
      data=replaceAll(data,needle,Buffer.from(edit.replacement,'utf8'));
    }
    const after=sha256(data);
    if(after!==patch.expectedAfter[name]) throw new Error(`after hash mismatch for ${name}: expected ${patch.expectedAfter[name].slice(0,12)}..., got ${after.slice(0,12)}...; stop`);
    files.push({name:patch.deployedFileNames[name],recordName:name,content:data,sha256:after,bytes:data.length});
  }
  return files;
}

export function countOccurrences(haystack,needle){
  let count=0,index=0;
  while((index=haystack.indexOf(needle,index))!==-1){count+=1;index+=needle.length;}
  return count;
}

export function replaceAll(haystack,needle,replacement){
  const parts=[];let index=0,found;
  while((found=haystack.indexOf(needle,index))!==-1){parts.push(haystack.subarray(index,found),replacement);index=found+needle.length;}
  parts.push(haystack.subarray(index));
  return Buffer.concat(parts);
}

// Stage 4 predicate. Pure.
export function liveMatchesPrecondition(live,required){
  const problems=[];
  if(required.status!==undefined&&live.status!==required.status) problems.push(`status: required ${required.status}, live ${live.status}`);
  if(required.version!==undefined&&live.version!==required.version) problems.push(`version: required ${required.version}, live ${live.version}`);
  if(required.ezbr_sha256!==undefined&&live.ezbr_sha256!==required.ezbr_sha256) problems.push(`archive sha256: required ${required.ezbr_sha256.slice(0,12)}..., live ${String(live.ezbr_sha256).slice(0,12)}...`);
  return problems;
}

// Post-deploy readback comparison. Pure. Served file names are compared by
// their full deployed path first, then by basename only if the platform
// returns bare names; a basename match is reported as such.
export function compareServedFiles(served,expectedFiles){
  const problems=[];
  const byName=new Map(served.map(file=>[file.name,file.content]));
  for(const expected of expectedFiles){
    let content=byName.get(expected.name);
    let matchedBy='path';
    if(content===undefined){
      const base=expected.name.replace(/^.*\//,'');
      const candidates=served.filter(file=>String(file.name).replace(/^.*\//,'')===base);
      if(candidates.length===1){content=candidates[0].content;matchedBy='basename';}
      else if(candidates.length>1){problems.push(`served file name is ambiguous for ${expected.name}`);continue;}
    }
    if(content===undefined){problems.push(`file missing from deployment: ${expected.name}`);continue;}
    const actual=sha256(Buffer.from(content,'utf8'));
    if(actual!==expected.sha256) problems.push(`served sha256 differs for ${expected.name} (expected ${expected.sha256.slice(0,12)}..., served ${actual.slice(0,12)}..., matched by ${matchedBy})`);
  }
  if(served.length!==expectedFiles.length) problems.push(`deployment serves ${served.length} files, expected ${expectedFiles.length}`);
  return problems;
}

async function main(){
  const [patchPath,...flags]=process.argv.slice(2);
  if(!patchPath){console.error('usage: deploy-recorded-function.mjs <patch.json> [--dry-run|--deploy]');process.exit(1);}
  const dryRun=flags.includes('--dry-run');
  const doDeploy=flags.includes('--deploy');
  if(dryRun===doDeploy){console.error('pass exactly one of --dry-run or --deploy');process.exit(1);}
  const patch=JSON.parse(readFileSync(patchPath,'utf8'));

  let files;
  try{files=preparePayload(patch,name=>readFileSync(join(patch.sourceDir,name)));}
  catch(error){console.error(`PRECONDITION FAILED: ${error.message}`);process.exit(1);}
  console.log(`Payload prepared from ${patch.sourceDir} (${(patch.edits||[]).length} edit(s)):`);
  for(const file of files) console.log(`  ${file.name}  ${file.bytes} bytes  ${file.sha256}`);
  if(dryRun){console.log('DRY RUN OK: hashes verified; nothing deployed.');process.exit(0);}

  const token=process.env.SUPABASE_ACCESS_TOKEN;
  if(!token){console.error('SKIPPED: SUPABASE_ACCESS_TOKEN is not set; nothing deployed.');process.exit(3);}
  const api=`https://api.supabase.com/v1/projects/${patch.projectRef}/functions`;
  const auth={Authorization:`Bearer ${token}`};

  // Stage 4: the live function must be the state this patch was approved against.
  const before=await fetch(`${api}/${patch.slug}`,{headers:auth}).catch(cause=>({ok:false,status:String(cause)}));
  if(!before.ok){console.error(`INCONCLUSIVE: could not read live function before deploy (HTTP ${before.status}); nothing deployed.`);process.exit(2);}
  const live=await before.json();
  const pre=liveMatchesPrecondition(live,patch.requireLiveBeforeDeploy||{});
  if(pre.length){console.error('PRECONDITION FAILED: live function does not match the state this patch was approved against:');for(const p of pre)console.error(`  ${p}`);process.exit(1);}
  console.log(`Live before deploy: ${live.slug} v${live.version} ${live.status} archive ${String(live.ezbr_sha256).slice(0,12)}...`);

  // Deploy: multipart to the Management API, exact bytes, exact names.
  const form=new FormData();
  form.append('metadata',JSON.stringify({name:patch.slug,entrypoint_path:patch.entrypointPath,import_map_path:patch.importMapPath,verify_jwt:patch.verifyJwt}));
  for(const file of files) form.append('file',new Blob([file.content],{type:'application/octet-stream'}),file.name);
  const deploy=await fetch(`${api}/deploy?slug=${encodeURIComponent(patch.slug)}`,{method:'POST',headers:auth,body:form}).catch(cause=>({ok:false,status:String(cause),text:async()=>''}));
  const deployText=await deploy.text();
  if(!deploy.ok){console.error(`DEPLOY FAILED: HTTP ${deploy.status} ${deployText.slice(0,500)}`);process.exit(1);}
  let deployed={};try{deployed=JSON.parse(deployText);}catch{}
  console.log(`Deploy accepted: v${deployed.version??'?'} ${deployed.status??''} archive ${String(deployed.ezbr_sha256??'').slice(0,12)}...`);

  // Readback: what is actually serving, hashed file by file.
  const after=await fetch(`${api}/${patch.slug}`,{headers:auth}).catch(cause=>({ok:false,status:String(cause)}));
  if(!after.ok){console.error(`INCONCLUSIVE: deploy was accepted but the live function could not be read back (HTTP ${after.status}). Verify manually before trusting this deployment.`);process.exit(2);}
  const liveAfter=await after.json();
  const body=await fetch(`${api}/${patch.slug}/body`,{headers:auth}).catch(()=>({ok:false,status:'unreachable'}));
  const served=body.ok?await body.json().catch(()=>null):null;
  const servedFiles=Array.isArray(served?.files)?served.files:null;
  if(!servedFiles){console.error(`INCONCLUSIVE: deploy accepted (v${liveAfter.version}) but served source could not be read (HTTP ${body.status}); file-level verification NOT performed.`);process.exit(2);}
  const problems=compareServedFiles(servedFiles,files);
  if(liveAfter.status!=='ACTIVE') problems.push(`live status after deploy is ${liveAfter.status}`);
  if(!(liveAfter.version>live.version)) problems.push(`version did not advance (${live.version} -> ${liveAfter.version})`);
  const record={slug:patch.slug,patch:patchPath,deployedAtUtc:new Date().toISOString(),previous:{version:live.version,ezbr_sha256:live.ezbr_sha256},version:liveAfter.version,status:liveAfter.status,ezbr_sha256:liveAfter.ezbr_sha256,entrypoint_path:liveAfter.entrypoint_path,import_map_path:liveAfter.import_map_path,verify_jwt:liveAfter.verify_jwt,files:files.map(f=>({name:f.recordName,deployedName:f.name,bytes:f.bytes,sha256:f.sha256})),verification:problems.length?problems:'VERIFIED'};
  writeFileSync('deployment-record.json',JSON.stringify(record,null,1)+'\n');
  if(problems.length){console.error('VERIFICATION FAILED after deploy:');for(const p of problems)console.error(`  ${p}`);console.error('The function may be serving unexpected bytes. Roll back with the rollback patch.');process.exit(1);}
  console.log(`VERIFIED: ${patch.slug} v${liveAfter.version} ACTIVE, every served file hashes to expectedAfter. Record written to deployment-record.json.`);

  // Live origin checks: reported, and the approved origin is required to pass.
  const checks=patch.liveChecks;
  if(checks){
    const url=`https://${patch.projectRef}.supabase.co/functions/v1/${patch.slug}${checks.requestPath}`;
    const probe=async(origin,method)=>{const r=await fetch(url,{method,headers:{Origin:origin,...(method==='OPTIONS'?{'Access-Control-Request-Method':'GET'}:{})}}).catch(()=>null);return r?{status:r.status,acao:r.headers.get('access-control-allow-origin')}:{status:'unreachable',acao:null};};
    const rows=[['approved',checks.approvedOrigin,'OPTIONS'],['approved',checks.approvedOrigin,'GET'],['unapproved',checks.unapprovedOrigin,'OPTIONS'],['production',checks.productionOrigin,'GET']];
    let approvedOk=true;
    for(const [label,origin,method] of rows){
      const r=await probe(origin,method);
      console.log(`  live ${method.padEnd(7)} ${label.padEnd(10)} -> ${r.status}  Access-Control-Allow-Origin: ${r.acao??'absent'}`);
      if(label==='approved'&&r.acao!==origin) approvedOk=false;
      if(label==='unapproved'&&r.acao) approvedOk=false;
    }
    if(!approvedOk){console.error('LIVE CHECK FAILED: the approved origin is not being allowed (or an unapproved one is). Bytes verified, behaviour not. Investigate before telling anyone the preview works.');process.exit(1);}
    console.log('Live origin checks passed. Authenticated sign-in on the preview still needs a person to verify.');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
