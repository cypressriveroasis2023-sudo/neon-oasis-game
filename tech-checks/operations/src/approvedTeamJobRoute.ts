import {workspaceHash} from './workspaceNavigation';

/** Link only the ID supplied by the existing jobs response. Never infer an equipment ID. */
export function approvedTeamJobRoute(jobId: unknown): string | null {
  if (typeof jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return null;
  if (jobId === '00000000-0000-0000-0000-000000000000') return null;
  return workspaceHash({workspace:'Jobs', jobId, detail:false});
}
