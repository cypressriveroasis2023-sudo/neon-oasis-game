import {workspaceHash} from '../../src/workspaceNavigation';
import {savedBoardJob} from './resolveBoardUnitLink';

/** Candidate UI adapter only. Enable only for a matching server-produced contract.
 * Existing Fleet route handles authorization, current-unit lookup and missing units.
 * A link is not a camera-health claim and never selects by product label or IP.
 */
export function boardUnitHref(kind:unknown,record:unknown,link:unknown,sourceUnavailable:boolean):string|null {
  if(sourceUnavailable || !link || typeof link!=='object' || Array.isArray(link))return null;
  const value=link as Record<string,unknown>,job=savedBoardJob(kind,record);
  const uuid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)&&id!=='00000000-0000-0000-0000-000000000000';
  const stamp=(s:unknown)=>typeof s==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
  if(!job||value.contract!=='COS_BOARD_UNIT_LINK_V1'||value.state!=='linked'||value.jobId!==job.jobId||
     value.recordContext!==job.context||value.basis!=='current_job_assignment'||!uuid(value.unitId)||!uuid(value.assignmentId)||
     typeof value.productId!=='string'||!(/^[1-9][0-9]{0,14}$/).test(value.productId)||
     typeof value.sourceSha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.sourceSha256)||
     ![value.assignmentAsOf,value.fleetAsOf,value.productObservedAt].every(stamp))return null;
  return workspaceHash({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId:value.unitId});
}
