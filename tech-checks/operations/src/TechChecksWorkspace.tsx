import { openLegacy } from './api';

// These destinations retain the original authenticated checks and saved evidence.
// They are deliberately not redirected to the separate Operations job database.
const tools = [
  { route:'assign', title:'Check assignments', description:'Assign and manage IT / Service check work' },
  { route:'team', title:'Truck & team readiness', description:'Daily readiness and technician check workload' },
  { route:'review', title:'Review completed checks', description:'Review, correct and close submitted check work' },
  { route:'handoffs', title:'Check handoffs & returns', description:'Equipment moving between IT and Service' },
  { route:'calendar', title:'Check schedule', description:'Existing technician check assignments by date' },
  { route:'attention', title:'Checks needing attention', description:'Overdue checks and readiness blockers' },
  { route:'units', title:'Checked equipment', description:'Equipment records used by the checklists' },
  { route:'history', title:'Check history', description:'Saved technician, unit and site history' },
  { route:'activity', title:'Check activity', description:'The existing IT / Service activity log' },
  { route:'accounts', title:'Technician accounts', description:'Create and manage technician sign-in access' },
  { route:'testcenter', title:'Owner test center', description:'Your existing controlled test workflow' },
] as const;

export default function TechChecksWorkspace() {
  return <section className='panel module operations-tools cos-approved-checks' aria-label='Tech Check workspaces'>
    <div className='panelhead'><h2>Start or continue a check</h2><span>Use your existing account</span></div>
    <div className='operations-tool-grid cos-approved-primary-checks'>
      <button onClick={()=>openLegacy('it')}><b>IT check in / out</b><span>Open your existing equipment preparation and intake workflow</span></button>
      <button onClick={()=>openLegacy('service')}><b>Service handoffs</b><span>Open your existing truck checks, transfers and returns</span></button>
    </div>
    <p className='tech-check-record-note'>Equipment check-in, check-out and transfers stay in your existing workflow. Required checks, photos and signatures still apply. Service jobs are created in mHelp.</p>
    <h3>Handoffs &amp; follow-up</h3>
    <div className='operations-tool-grid'>{tools.filter(tool=>['handoffs','attention','history'].includes(tool.route)).map(tool=><button type='button' className='secondary' key={tool.route} onClick={()=>openLegacy(tool.route)}><b>{tool.title}</b><span>{tool.description}</span></button>)}</div>
    <details className='cos-approved-tool-group'><summary>Manage Tech Checks</summary>
      <div className='operations-tool-grid'>{tools.filter(tool=>!['handoffs','attention','history'].includes(tool.route)).map(tool=><button type='button' className='secondary' key={tool.route} onClick={()=>openLegacy(tool.route)}><b>{tool.title}</b><span>{tool.description}</span></button>)}</div>
    </details>
  </section>;
}
