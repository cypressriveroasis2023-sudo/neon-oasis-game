import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {preparePayload,liveMatchesPrecondition} from '../../../.github/scripts/deploy-recorded-function.mjs';

const actorPatch=JSON.parse(readFileSync(new URL('../../../.github/function-patches/cos-operations-pages/it-saved-fleet-actor-v154.json',import.meta.url),'utf8'));

// The native release is an immutable capture, not the repository's development
// handler. Reject a different baseline instead of overwriting another release.
export const nativeSavedReadingsBaseline={
  projectId:actorPatch.projectRef,name:actorPatch.slug,version:actorPatch.requireLiveBeforeDeploy.version,
  archiveSha256:actorPatch.requireLiveBeforeDeploy.ezbr_sha256,
  entrypointSha256:'e50c4343f28019ead7919574ac092807c1dd722ef0827f12ac1c7f069dd11e38',
  sourceCommit:actorPatch.sourceCommit,
  sourcePath:actorPatch.sourceDir,
  sha256:actorPatch.expectedBefore,
};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const previousOrigin='https://a5f54cfd.cos-vision-integration-preview.pages.dev';
const currentLivePrecondition={
  status:'ACTIVE',version:155,ezbr_sha256:'9065cf46375d02eb339504dd4d559a95e9e8312eb472b57b1223076f21921121',
  entrypointSha256:'cd88d112b80b46d240500abc6cbed7b1b91bb275a4d4c219c31275e1de7b99d8'
};
function once(source,before,after){
  if(source.split(before).length!==2)throw Error('Native source boundary changed; do not deploy.');
  return source.replace(before,after);
}

export function prepareITSavedReadingsNative(sourceFiles,previewOrigins){
  const baseline=nativeSavedReadingsBaseline;
  if(!sourceFiles||Object.keys(sourceFiles).sort().join('|')!==Object.keys(baseline.sha256).sort().join('|'))throw Error('Native source manifest differs.');
  // Reuse PR361's reviewed identity-only recipe and its before/after hashes.
  const identityFiles=Object.fromEntries(preparePayload(actorPatch,name=>Buffer.from(sourceFiles[name],'utf8')).map(file=>[file.recordName,file.content.toString('utf8')]));
  if(!Array.isArray(previewOrigins)||previewOrigins.length<1||previewOrigins.length>2||new Set(previewOrigins).size!==previewOrigins.length||previewOrigins.some(origin=>typeof origin!=='string'||!/^https:\/\/[a-f0-9]{8}\.cos-vision-integration-preview\.pages\.dev$/.test(origin)))throw Error('Use one or two exact immutable COS preview origins.');
  const origins=[...new Set([previousOrigin,...previewOrigins])];
  const corsEdits=[
    {before:'const COS_PREVIEW_ORIGIN="'+previousOrigin+'";',after:'const COS_PREVIEW_ORIGINS=new Set('+JSON.stringify(origins)+');'},
    {before:'previewOrigin=origin===COS_PREVIEW_ORIGIN,',after:'previewOrigin=COS_PREVIEW_ORIGINS.has(origin),'},
  ];
  const durableEdits=[
  {before:'function fleetFeatures(){return{durableFleetBoard:false,',after:'function fleetFeatures(){return{durableFleetBoard:!0,'},
  {before:'features:{durableFleetBoard:false,unitTracker:!!context.actorId,',after:'features:{durableFleetBoard:!!context.actorId,unitTracker:!!context.actorId,'},
];
  let candidate=identityFiles['serve.ts'];
  for(const edit of corsEdits)candidate=once(candidate,edit.before,edit.after);
  for(const edit of durableEdits)candidate=once(candidate,edit.before,edit.after);
  let reversed=candidate;
  for(const edit of [...durableEdits].reverse())reversed=once(reversed,edit.after,edit.before);
  for(const edit of [...corsEdits].reverse())reversed=once(reversed,edit.after,edit.before);
  if(reversed!==identityFiles['serve.ts'])throw Error('Native preview/durable preservation failed.');
  const identityEdits=actorPatch.edits.map(edit=>({before:edit.needle,after:edit.replacement}));
  for(const edit of [...identityEdits].reverse())reversed=once(reversed,edit.after,edit.before);
  if(reversed!==sourceFiles['serve.ts'])throw Error('Native source preservation failed.');
  const files={...identityFiles,'serve.ts':candidate};
  return {files,manifest:{baselineVersion:baseline.version,baselineArchiveSha256:baseline.archiveSha256,baselineSourceCommit:baseline.sourceCommit,identityRecipe:'.github/function-patches/cos-operations-pages/it-saved-fleet-actor-v154.json',identityServeSha256:actorPatch.expectedAfter['serve.ts'],previewOrigins:origins,previewExpiresAt:'2026-11-09T23:59:59Z',verifyJwt:false,durableFleetBoard:true,edits:[...identityEdits,...corsEdits,...durableEdits],sourceHashes:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,sha256(content)]))}};
}

export function assertNativeSavedReadingsDeployment(deployed){
  const b=nativeSavedReadingsBaseline;
  const files=deployed?.files||[];
  if(!deployed||deployed.name!==b.name||liveMatchesPrecondition(deployed,currentLivePrecondition).length||deployed.verify_jwt!==false||deployed.import_map!==true||files.length!==2||!files.some(file=>file.name==='index.ts'&&sha256(file.content)===currentLivePrecondition.entrypointSha256)||!files.some(file=>file.name==='deno.json'&&sha256(file.content)===b.sha256['deno.json']))throw Error('Current native deployment has changed; re-read and review before applying the patch.');
}
