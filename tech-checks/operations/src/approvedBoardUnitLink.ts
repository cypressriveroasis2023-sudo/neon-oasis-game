import type {BoardCard} from './dailyBoardData';
import {boardRecordDetail,boardSavedInstant} from './boardRecordDetails';
import {workspaceHash} from './workspaceNavigation';

export type BoardUnitSelection = BoardCard & {detailAsOf:string|null};
export type ApprovedBoardUnitTarget = {href:string;productId:string;observedAt:string;completedVisit:boolean};
const row=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)&&value!=='00000000-0000-0000-0000-000000000000';

/** Read-only consumer of server-produced link metadata, not authorization or a binding lookup.
 * Existing Fleet routing rechecks the selected unit. No label/IP matching, provider reads,
 * freshness timer, or fallback to a guessed unit. The producer is not enabled by this view.
 */
export function approvedBoardUnitTarget(card:BoardUnitSelection,sourceUnavailable:boolean):ApprovedBoardUnitTarget|null {
  if(sourceUnavailable||!row(card.record))return null;
  const detail=boardRecordDetail(card),link=card.record.unitLink,asOf=boardSavedInstant(card.detailAsOf);
  if(!detail.jobId||!row(link)||!asOf)return null;
  const context=card.kind==='task'?'task_related_job':detail.completedVisit?'completed_visit_current_job':'job';
  if(link.contract!=='COS_BOARD_UNIT_LINK_V1'||link.state!=='linked'||link.jobId!==detail.jobId||
     link.recordContext!==context||link.basis!=='current_job_assignment'||!uuid(link.unitId)||!uuid(link.assignmentId)||
     typeof link.productId!=='string'||!/^[1-9][0-9]{0,14}$/.test(link.productId)||
     typeof link.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(link.sourceSha256))return null;
  const assignmentAt=boardSavedInstant(link.assignmentAsOf),fleetAt=boardSavedInstant(link.fleetAsOf),observedAt=boardSavedInstant(link.productObservedAt);
  if(!assignmentAt||!fleetAt||!observedAt||Date.parse(assignmentAt)>Date.parse(asOf)||
     Date.parse(fleetAt)>Date.parse(asOf)||Date.parse(observedAt)>Date.parse(fleetAt))return null;
  return {href:workspaceHash({workspace:'Fleet Dashboard',jobId:'',detail:false,unitId:link.unitId}),
    productId:link.productId,observedAt,completedVisit:detail.completedVisit};
}
