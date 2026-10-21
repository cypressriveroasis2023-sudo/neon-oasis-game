import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const canonicalEvidenceFunctions={
 stage:'public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)',
 approve:'public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text)',
 snapshot:'cos_mhelp_placement_private.assignment_review_snapshot(jsonb)',
 live:'public.cos_mhelp_live_inventory_session(text,jsonb)',
};
const once=(source,anchor,replacement)=>{
 if(typeof source!=='string'||source.split(anchor).length!==2)throw Error('Installed canonical evidence anchor changed: '+anchor.slice(0,90));
 return source.replace(anchor,replacement);
};

/** Use fresh installed definitions. Preserve auth, ACLs, raw source revisions,
 * immutable batches, shared validation and every protected-field guard. */
export async function prepareOwnerCanonicalEvidenceSql(installed){
 const n=canonicalEvidenceFunctions;
 for(const name of Object.values(n))if(typeof installed[name]!=='string')throw Error('Fresh installed definition required: '+name);
 let stage=installed[n.stage],approve=installed[n.approve],snapshot=installed[n.snapshot],live=installed[n.live];
 stage=once(stage,'continuity_items jsonb; prior_rows jsonb;',
  'identity_evidence jsonb; continuity_items jsonb; prior_rows jsonb;');
 stage=once(stage,'perform cos_mhelp_placement_private.assignment_review_lock();',
  'perform cos_mhelp_placement_private.assignment_review_lock();\n identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(prior_rows);');
 stage=once(stage,"binding:=coalesce(old_row->'binding','null'::jsonb);",
  "binding:=identity_evidence->'bindings'->(old_row->>'productId')->'binding';");
 stage=once(stage,"'items',continuity_items)","'items',continuity_items,'canonicalIdentityRecovery',identity_evidence->'provenance')");
 snapshot=once(snapshot,"'currentLinks',links,'shopReceipt',move,",`'canonicalIdentityEvidence',cos_mhelp_placement_private.recover_identity_evidence(p_record),
  'currentLinks',links,'shopReceipt',move,`);
 approve=once(approve,"adjusted jsonb:='[]';", "identity_evidence jsonb; adjusted jsonb:='[]';");
 approve=once(approve,' for row_data in select value from jsonb_array_elements(s.records) loop',
  ' identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(prior);\n for row_data in select value from jsonb_array_elements(s.records) loop');
 approve=once(approve,"b:=old->'binding';", "b:=identity_evidence->'bindings'->(old->>'productId')->'binding';");
 live=once(live,'baseline jsonb;base_sha text;', 'identity_evidence jsonb;baseline jsonb;base_sha text;');
 live=once(live,'baseline:=cos_mhelp_placement_private.upload_snapshot();',
  "baseline:=cos_mhelp_placement_private.upload_snapshot();\n identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(coalesce(baseline->'apiMissingRecords','[]'::jsonb)||(baseline->'records'));");
 live=once(live,"b:=(old->'binding')-'guardCurrent';", "b:=(identity_evidence->'bindings'->(old->>'productId')->'binding')-'guardCurrent';");
 live=once(live,' -- Re-seal only an already-current reviewed binding, never a changed graph.',
  " select coalesce(jsonb_agg(jsonb_set(x,'{binding}',identity_evidence->'bindings'->(x->>'productId')->'binding')),'[]'::jsonb)\n into missing from jsonb_array_elements(missing) x;\n -- Re-seal only an already-current reviewed binding, never a changed graph.");
 const checks=Object.values(n).map(name=>`if encode(sha256(convert_to(pg_get_functiondef('${name}'::regprocedure),'UTF8')),'hex')<>'${createHash('sha256').update(installed[name]).digest('hex')}' then raise exception 'Installed canonical evidence source changed';end if;`).join('\n');
 const helper=await readFile(new URL('../docs/drafts/cos-owner-canonical-evidence.sql',import.meta.url),'utf8');
 return "begin;\nset local lock_timeout='5s';\ndo $$begin\n"+checks+
  "\nif to_regprocedure('cos_mhelp_placement_private.recover_identity_evidence(jsonb)') is not null or to_regprocedure('cos_mhelp_placement_private.recover_identity_evidence_records(jsonb)') is not null then raise exception 'Canonical identity recovery already exists; inspect installed version';end if;\nend $$;\n"+
  helper+'\n'+[stage,approve,snapshot,live].map(s=>s.trim().replace(/;?$/,';')).join('\n')+'\ncommit;';
}
