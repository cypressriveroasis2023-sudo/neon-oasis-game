import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const patch=JSON.parse(readFileSync(new URL('../../docs/fleet-connection-reload-patch-20261103.json',import.meta.url),'utf8'));
const digest=v=>createHash('sha256').update(v).digest('hex');
/** Narrow patch against fresh production; never rebuild the recorded overlay. */
export function prepareFleetConnectionReloadDeployment(live){
 if(live?.name!=='cos-operations-pages'||!Number.isInteger(live.version)||typeof live.verify_jwt!=='boolean'||!Array.isArray(live.files))throw Error('Expected live Operations deployment.');
 const file=live.files.find(f=>f.name==='serve.ts');
 if(!file||file.content.split(patch.before).length!==2||!file.content.includes("import {readProductCheckSource} from './productCheckSource.ts';"))throw Error('Live connection route changed; inspect before release.');
 const code=file.content.replace(patch.before,patch.after);
 if(code.replace(patch.after,patch.before)!==file.content)throw Error('Unrelated production bytes changed.');
 return {beforeVersion:live.version,beforeArchive:live.ezbr_sha256,beforeSha256:digest(file.content),afterSha256:digest(code),payload:{name:live.name,entrypoint_path:'serve.ts',import_map_path:'deno.json',verify_jwt:live.verify_jwt,files:live.files.map(f=>({name:f.name,content:f===file?code:f.content}))}};
}
