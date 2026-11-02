import {workspaceLabel} from './workspaceNavigation';
import {approvedToolGroups,visibleApprovedTools} from './approvedCosNavigation';

export default function OperationsAreas({navigate,trackerVisible=false}:{navigate:(workspace:string)=>void;trackerVisible?:boolean}) {
  return <section className='operations-directory cos-approved-tools' aria-label='Operations workspaces'>
    <p className='cos-approved-tools-note'>Open an existing COS tool. Service jobs are created in mHelp.</p>
    {approvedToolGroups.map(group=><details className='cos-approved-tool-group' key={group.label}>
      <summary>{group.label}</summary>
      <div className='operations-directory-links'>{visibleApprovedTools(group.items,trackerVisible).map(name=><button type='button' className='secondary' key={name} onClick={()=>navigate(name)}>{name==='Units On Hand'?'Shop inventory':workspaceLabel(name)}</button>)}</div>
    </details>)}
  </section>;
}
