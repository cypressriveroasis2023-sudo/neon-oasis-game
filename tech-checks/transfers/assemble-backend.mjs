// Pure local assembly. This module never connects to a database or reads keys.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const migrations=Object.freeze(['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-delivery-v3.sql','techcheck-partial-returns-v4.sql','service-daily-receipt-links-v5.sql','techcheck-custody-writer-lock-order-v6.sql','techcheck-shared-custody-v6.sql','techcheck-location-proof-v7.sql']);
export async function assembleBackend(){
 const prerequisites=JSON.parse(await readFile(new URL('./install-prerequisites.json',import.meta.url),'utf8'));
 const preflight=`do $preflight$ declare expected record;actual text;begin
 if to_regclass('app_private.techcheck_transfers') is not null then raise exception 'Fresh-install package only. Reconcile an existing handoff installation before applying.';end if;
 for expected in select * from jsonb_to_recordset($hashes$${JSON.stringify(prerequisites)}$hashes$::jsonb) as x(schema text,name text,arguments text,sha256 text) loop
  select encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') into actual from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=expected.schema and p.proname=expected.name and pg_get_function_identity_arguments(p.oid)=expected.arguments;
  if actual is distinct from expected.sha256 then raise exception 'Reviewed prerequisite changed: %.%',expected.schema,expected.name;end if;
 end loop;
end$preflight$;`;
 const pieces=[];
 for(const name of migrations){const sql=await readFile(new URL('../database-maintenance/'+name,import.meta.url),'utf8');if((sql.match(/^begin;$/gm)||[]).length!==1||(sql.match(/^commit;$/gm)||[]).length!==1)throw Error('Expected one review transaction in '+name);pieces.push('-- '+name+' SHA256 '+createHash('sha256').update(sql).digest('hex')+'\n'+sql.replace(/^begin;\n/m,'').replace(/^commit;\n?/m,''));}
 return '-- HELD REVIEW PACKAGE. Fresh legacy install only; no secret or activation.\nbegin;\n'+preflight+'\n'+pieces.join('\n')+`\ndo $held$ begin
 if exists(select 1 from app_private.techcheck_transfer_settings where enabled or reports_ready or receipt_link_ready or custody_ready) or exists(select 1 from app_private.techcheck_location_keys_v7) then raise exception 'Installation must remain held and contain no key material.';end if;
end$held$;\ncommit;\n`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==3)throw Error('Provide one local output SQL path.');await writeFile(process.argv[2],await assembleBackend(),{flag:'wx',mode:0o600});}
