import {approvedTeamJobRoute} from './approvedTeamJobRoute';
import './approvedTeamJobs.css';

type Props = {jobId: unknown; jobNumber: unknown};

/** Existing job navigation only. Authorization and job actions remain in the existing workspace. */
export default function ApprovedTeamJobLink({jobId,jobNumber}: Props) {
  const href = approvedTeamJobRoute(jobId);
  const label = typeof jobNumber === 'string' && jobNumber.trim() ? jobNumber : 'Saved job';
  return href
    ? <a className='cos-team-job-link' href={href} aria-label={'Open saved job '+label}><b>{label}</b><span aria-hidden='true'> →</span></a>
    : <span className='cos-team-job-unlinked'><b>{label}</b><small>Job link unavailable</small></span>;
}
