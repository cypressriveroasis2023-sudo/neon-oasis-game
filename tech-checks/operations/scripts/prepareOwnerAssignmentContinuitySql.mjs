import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const assignmentContinuityFunctions={
 stage:'public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)',
 commit:'public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text)',
 approve:'public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text)',
 review:'cos_mhelp_placement_private.assignment_review(uuid)',
 assert:'cos_mhelp_placement_private.assert_assignment_review(uuid)',
 lock:'cos_mhelp_placement_private.assignment_review_lock()',
};
const once=(source,anchor,replacement)=>{
 if(typeof source!=='string'||source.split(anchor).length!==2)throw Error('Installed assignment continuity anchor changed: '+anchor.slice(0,90));
 return source.replace(anchor,replacement);
};
/** Preserve all existing function headers/configuration/ACLs. The three public
 * RPC boundaries return deterministic conflicts instead of PostgREST14 retries. */
function conflictBoundary(source){
 const delimiter=source.match(/\bAS\s+(\$[a-z_]*\$)/i)?.[1];
 if(!delimiter)throw Error('Installed RPC body delimiter changed');
 const end=source.lastIndexOf(delimiter);
 const before=source.slice(0,end);
 if(!/\bend\s*$/i.test(before)||before.includes("errcode='PT409'"))throw Error('Installed RPC conflict boundary changed');
 return before.replace(/\bend\s*$/i,"exception when serialization_failure then\n raise exception using errcode='PT409',message=SQLERRM;\nend ")+source.slice(end);
}

export async function prepareOwnerAssignmentContinuitySql(installed){
 const n=assignmentContinuityFunctions;
 for(const name of Object.values(n))if(typeof installed[name]!=='string')throw Error('Fresh installed definition required: '+name);
 let stage=installed[n.stage],review=installed[n.review],approve=installed[n.approve];
 stage=once(stage,'prior_rows jsonb; scoped_revision bigint;',"continuity_items jsonb; prior_rows jsonb; scoped_revision bigint;");
 stage=once(stage,'shop_baseline:=cos_mhelp_placement_private.shop_address_baseline(prior_sha);',
  'shop_baseline:=cos_mhelp_placement_private.shop_address_baseline(prior_sha);\n perform cos_mhelp_placement_private.assignment_review_lock();');
 stage=once(stage,"  elsif old_row is not null and (\n    (old_row->'binding' is not null",`  elsif old_row->'binding'->'previousAssignment' is not null
    and old_row->'binding'->'previousAssignment'<>'null'::jsonb
    and not exists(select 1 from cos_mhelp_placement_private.links l
      where l.equipment_id=old_row->>'productId'
       and l.tracker_id is not distinct from (old_row->'binding'->>'trackerId')::uuid
       and l.native_unit_id is not distinct from (old_row->'binding'->>'nativeUnitId')::uuid
       and l.full_label=old_row->>'unitNumber'
       and old_row->'binding'->'previousAssignment'->>'productId'=l.equipment_id
       and l.observation->>'state'='confirmed'
       and l.observation->>'customerId'=old_row->'binding'->'previousAssignment'->>'customerId'
       and l.observation->>'placement'=old_row->'binding'->'previousAssignment'->>'placement'
       and l.observation->>'serviceLocationId' is not distinct from old_row->'binding'->'previousAssignment'->>'serviceLocationId'
       and l.observed_at=(old_row->'binding'->'previousAssignment'->>'observedAt')::timestamptz) then
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
      'binding','null'::jsonb,'placementHeld',true,
      'holdReason','Historical assignment evidence requires explicit Owner continuity review'));
  elsif old_row is not null and (
    (old_row->'binding' is not null`);
 stage=once(stage," select coalesce(jsonb_agg(distinct value->>'customerId'),'[]'::jsonb)",` select coalesce(jsonb_agg(cos_mhelp_placement_private.assignment_review_snapshot(p) order by p->>'productId'),'[]'::jsonb)
 into continuity_items from jsonb_array_elements(prior_rows) p
 join jsonb_array_elements(adjusted) a on a->>'productId'=p->>'productId'
 where a->>'placementHeld'='true' and p->'binding' is not null and p->'binding'<>'null'::jsonb;
 select coalesce(jsonb_agg(distinct value->>'customerId'),'[]'::jsonb)`);
 stage=once(stage,"'recordCount','libraryFileId','companyCustomerIds','trackerSource','trackerRecords']",
  "'recordCount','libraryFileId','companyCustomerIds','trackerSource','trackerRecords','assignmentContinuity','assignmentApproval']");
 stage=once(stage,"'trackerRecords',tracker_rows);", "'trackerRecords',tracker_rows,'assignmentContinuity',jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_CONTINUITY_V1','items',continuity_items));");
 stage=once(stage,"if existing.review_receipt ? 'assignmentReview' then", "perform cos_mhelp_placement_private.assignment_review(existing.id);\n   if existing.review_receipt ? 'assignmentReview' then");

 review=once(review,"items jsonb:='[]'; item jsonb;", "snapshot jsonb; items jsonb:='[]'; item jsonb;");
 review=once(review,'  why:=null;move:=null;t:=null;u:=null;',`  select value into snapshot from jsonb_array_elements(coalesce(s.receipt->'assignmentContinuity'->'items','[]'::jsonb))
   where value->>'productId'=r->>'productId';
  if s.receipt->'assignmentContinuity'->>'contract' is distinct from 'COS_OWNER_ASSIGNMENT_CONTINUITY_V1'
   or snapshot is distinct from cos_mhelp_placement_private.assignment_review_snapshot(old)
   or (select count(*) from jsonb_array_elements(s.receipt->'assignmentContinuity'->'items') x where x->>'productId'=r->>'productId')<>1
  then raise exception 'Assignment evidence changed after staging; create a fresh stage' using errcode='40001';end if;
  why:=null;move:=null;t:=null;u:=null;
  if snapshot->>'referenceEligible' is distinct from 'true' then
   why:='Missing, ambiguous or unconfirmed exact assignment evidence; continuity cannot be approved';end if;`);
 review=once(review,"guard:=cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid);", "guard:=snapshot->>'protectedStateSha256';");
 review=once(review,"'productId',r->>'productId','unitNumber',r->>'unitNumber',",`'productId',r->>'productId','unitNumber',r->>'unitNumber',
   'sourceAssignmentChanged',(old->>'placement' is distinct from r->>'placement' or old->>'customerId' is distinct from r->>'customerId' or old->>'customer' is distinct from r->>'customer'),
   'continuity',snapshot->'continuity',`);
 review=once(review,"jsonb_build_object('binding',b,'move',move,'links',", "jsonb_build_object('stageSnapshot',snapshot,'binding',b,'move',move,'links',");

 approve=once(approve,"b:=old->'binding'||jsonb_build_object('expectedGuard',item->>'protectedStateSha256');",`b:=old->'binding';
   if item->>'guardChanged'='true' then b:=b||jsonb_build_object('expectedGuard',item->>'protectedStateSha256');end if;
   if item->'continuity' is not null and item->'continuity'<>'null'::jsonb then
    b:=jsonb_set(b,'{previousAssignment}',item->'continuity'->'currentAssignment');end if;`);
 approve=once(approve,"'productIds',(select jsonb_agg", "'continuity',s.receipt->'assignmentContinuity',\n  'productIds',(select jsonb_agg");
 const changed=[stage,conflictBoundary(installed[n.commit]),conflictBoundary(approve),review];
 changed[0]=conflictBoundary(changed[0]);
 const checks=Object.values(n).map(name=>`if encode(sha256(convert_to(pg_get_functiondef('${name}'::regprocedure),'UTF8')),'hex')<>'${createHash('sha256').update(installed[name]).digest('hex')}' then raise exception 'Installed source changed';end if;`).join('\n');
 const helper=await readFile(new URL('../docs/drafts/cos-owner-assignment-continuity.sql',import.meta.url),'utf8');
 return "begin;\nset local lock_timeout='5s';\ndo $$begin\n"+checks+"\nif to_regprocedure('cos_mhelp_placement_private.assignment_review_snapshot(jsonb)') is not null then raise exception 'Continuity helper already exists; inspect the installed version';end if;\nend $$;\n"+helper+'\n'+changed.map(s=>s.trim().replace(/;?$/,';')).join('\n')+'\ncommit;';
}
