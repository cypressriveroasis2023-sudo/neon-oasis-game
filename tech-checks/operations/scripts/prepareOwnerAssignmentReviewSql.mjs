import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function prepareOwnerAssignmentReviewSql(installed){
 const stage='public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)';
 const commit='public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text)';
 const once=(s,a,b)=>{if(typeof s!=='string'||s.split(a).length!==2)throw Error('Installed assignment review anchors changed');return s.replace(a,b);};
 const staged=once(installed[stage],'return existing.review_receipt;',"if existing.review_receipt ? 'assignmentReview' then perform cos_mhelp_placement_private.assert_assignment_review(existing.id);end if;\n   return existing.review_receipt;");
 const committed=once(installed[commit],'applied:=cos_mhelp_placement_private.review_upload(',"perform cos_mhelp_placement_private.assert_assignment_review(stage.id);\n applied:=cos_mhelp_placement_private.review_upload(");
 const checks=[stage,commit].map(n=>`if encode(sha256(convert_to(pg_get_functiondef('${n}'::regprocedure),'UTF8')),'hex')<>'${createHash('sha256').update(installed[n]).digest('hex')}' then raise exception 'Installed source changed';end if;`).join('\n');
 return 'begin;\nset local lock_timeout=\'5s\';\ndo $$begin\n'+checks+'\nend $$;\n'+await readFile(new URL('../docs/drafts/cos-owner-assignment-review.sql',import.meta.url),'utf8')+'\n'+staged+';\n'+committed+';\ncommit;';
}
