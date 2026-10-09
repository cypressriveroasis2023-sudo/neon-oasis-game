import {createHash} from 'node:crypto';
import {readFile,mkdir,realpath,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
export function statements(records,review,receipt=null){
 if(!Array.isArray(records)||records.length<1||records.length>100||!review||typeof review!=='object')throw new Error('A bounded records array and reviewed evidence object are required.');
 const org="'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid";
 const begin="\\set ON_ERROR_STOP on\nbegin isolation level read committed;\nset local lock_timeout='2s';\nset local statement_timeout='20s';\n";
 const invoke=apply=>'select app_private.cos_support_admit_reviewed('+org+','+literal(records)+','+literal(review)+','+apply+');\n';
 const files={'dry-run.sql':begin+invoke('false')+'rollback;\n','execute.sql':begin+invoke('true')+'commit;\n'};
 if(receipt){
  if(receipt.applied!==true||!Array.isArray(receipt.records)||receipt.records.length!==records.length)throw new Error('A successful execution receipt is required for withdrawal.');
  const expected=new Set(records.map(r=>r.productId)),seen=new Set();
  const identities=receipt.records.map(r=>{
   if(!expected.has(r.productId)||seen.has(r.productId)||!['admitted','already_admitted'].includes(r.status)||![r.trackerId,r.sourceRevision].every(s=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s)))throw new Error('Execution receipt identities do not match the reviewed batch.');
   seen.add(r.productId);return{productId:r.productId,trackerId:r.trackerId,sourceRevision:r.sourceRevision};
  });
  files['withdraw.sql']=begin+'select app_private.cos_support_withdraw_reviewed('+org+','+literal(identities)+');\ncommit;\n';
 }
 return files;
}
async function outside(path){const actual=await realpath(path);
 if(actual===repo||actual.startsWith(repo+'/'))throw new Error('Private input/output must stay outside the repository.');return actual;}
export async function build({recordsPath,reviewPath,outPath,receiptPath}){
 const recordsFile=await outside(recordsPath),reviewFile=await outside(reviewPath);
 // Check the existing parent before making the private output directory.
 await outside(dirname(resolve(outPath)));await mkdir(outPath,{recursive:true,mode:0o700});const out=await outside(outPath);
 const rb=await readFile(recordsFile),vb=await readFile(reviewFile),receipt=receiptPath?JSON.parse(await readFile(await outside(receiptPath),'utf8')):null;
 const files=statements(JSON.parse(rb),JSON.parse(vb),receipt),hashes={};
 for(const[name,content]of Object.entries(files)){await writeFile(resolve(out,name),content,{mode:0o600,flag:'wx'});hashes[name]=sha(content);}
 const manifest={schemaVersion:1,status:'prepared_not_executed',recordsSha256:sha(rb),reviewSha256:sha(vb),recordCount:JSON.parse(rb).length,files:hashes,productionWrites:0,providerCalls:0};
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length<3||args.length>4)throw new Error('Usage: node build-support-admission.mjs RECORDS_JSON REVIEW_JSON PRIVATE_OUTPUT_DIR [EXECUTION_RECEIPT_JSON]');
 console.log(JSON.stringify(await build({recordsPath:args[0],reviewPath:args[1],outPath:args[2],receiptPath:args[3]}),null,2));
}
