import type {Actor,Run,RunStore} from './avigilonCheckRun.ts';
/** The invoker executes only these fixed private functions. Production must supply
 * an approved existing-credential transport; there is no public-RPC fallback. */
export function durableAvigilonRunStore(actor:Actor,invoke:(operation:'claim'|'read_run'|'save'|'commit_result',args:unknown[])=>Promise<any>):RunStore{
 return {commit:(run,unit,result)=>{if(run.tenantId!==actor.tenantId)throw Error('Run tenant mismatch');return invoke('commit_result',[actor.actorId,actor.tenantId,{runId:run.id,unitId:unit.id,startedAt:run.rows.find(r=>r.unitId===unit.id)?.startedAt,publication:result.publication}]);},claim:run=>{if(run.tenantId!==actor.tenantId)throw Error('Run tenant mismatch');return invoke('claim',[actor.actorId,actor.tenantId,run]);},
 read:(tenant,id)=>{if(tenant!==actor.tenantId)throw Error('Run tenant mismatch');return invoke('read_run',[actor.actorId,tenant,id]);},
 save:(run:Run)=>{if(run.tenantId!==actor.tenantId)throw Error('Run tenant mismatch');return invoke('save',[actor.actorId,actor.tenantId,run]);}};
}
