import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
/** Patch only three stage anchors and the outer snapshot JSON expression.
 * Preserve installed headers, timeouts, guards, owners, ACLs and all other bytes.
 * Never run the bootstrap SQL or grant execution to any additional role. */
export async function prepareMhelpShopAddressSql(installed){
 const names=['public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)','cos_mhelp_placement_private.upload_snapshot()'];
 if(!installed||names.some(n=>typeof installed[n]!=='string'||!installed[n].startsWith('CREATE OR REPLACE FUNCTION ')))throw Error('Exact installed definitions required');
 const once=(source,anchor,value)=>{if(source.split(anchor).length!==2)throw Error('Installed source changed; inspect before release');return source.replace(anchor,value);};
 const draft=await readFile(new URL('../docs/drafts/cos-owner-equipment-stage-commit-20261016.sql',import.meta.url),'utf8');
 const begin="or (old_row->'sourceAddress' is distinct from row_data->'sourceAddress' and not coalesce((",end='),false))';
 const at=draft.indexOf(begin),until=draft.indexOf(end,at)+end.length;
 if(at<0||until<end.length)throw Error('Reviewed address predicate unavailable');
 let stage=once(installed[names[0]],'prior_rows jsonb; scoped_revision bigint; scoped_sha text;','prior_rows jsonb; scoped_revision bigint; scoped_sha text; shop_baseline jsonb;');
 stage=once(stage,' -- All business-readable identities'," shop_baseline:=cos_mhelp_placement_private.shop_address_baseline(prior_sha);\n -- All business-readable identities");
 stage=once(stage,"or old_row->'sourceAddress' is distinct from row_data->'sourceAddress'",draft.slice(at,until));
 const snapshot=once(installed[names[1]],"select b.value||jsonb_build_object('apiSync'","select b.value||jsonb_build_object('shopAddressBaseline',cos_mhelp_placement_private.shop_address_baseline(b.value->>'sourceSha256'),'apiSync'");
 const checks=names.map(n=>`if encode(sha256(convert_to(pg_get_functiondef('${n}'::regprocedure),'UTF8')),'hex')<>'${createHash('sha256').update(installed[n]).digest('hex')}' then raise exception 'Installed source changed; inspect before release';end if;`).join('\n');
 return `begin;\ndo $$begin\n${checks}\nend $$;\n`+await readFile(new URL('../docs/drafts/cos-shop-address-evidence.sql',import.meta.url),'utf8')+'\n'+stage+';\n'+snapshot+';\ncommit;\n';
}
