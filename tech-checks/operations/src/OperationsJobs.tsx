import LegacyInstallEvidence from './LegacyInstallEvidence';
import type { JobsMode } from './operationsWorkflowData';

type Props={mode:JobsMode;show:(message:string)=>void;initialJobId?:string;clearFocusedJob?:()=>void;openLifecycle?:(id:string)=>void;legacyInstallEvidenceEnabled?:boolean};

/** Job closeout and signatures are not part of COS. Legacy install evidence is the only review surface. */
export default function OperationsJobs({mode,legacyInstallEvidenceEnabled=false}:Props) {
  return <section className='panel module' aria-label='Unavailable workspace' role='status'>
    {mode==='review'&&legacyInstallEvidenceEnabled&&<LegacyInstallEvidence/>}
    <h2>This workspace is not available in COS</h2>
    <p>COS is cameras, locations, troubleshooting and equipment handoff only.</p>
  </section>;
}
