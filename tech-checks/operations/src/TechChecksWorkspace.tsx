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
  return <section className='panel module operations-tools' aria-label='Tech Check workspaces'>
    <div className='panelhead'><h2>Start or continue a check</h2><span>Use your existing account</span></div>
    <div className='operations-tool-grid'>
      <button onClick={()=>openLegacy('it')}><b>IT</b><span>Preparation, readiness, assigned work and checklists</span></button>
      <button onClick={()=>openLegacy('service')}><b>Service</b><span>Truck checks, field work, returns and checklists</span></button>
    </div>
    <p className='tech-check-record-note'>Continue existing IT and Service work here. Check assignments and saved evidence stay with their original records; dispatch jobs are in Operations → Job flow.</p>
    <h3>Manage Tech Checks</h3>
    <div className='operations-tool-grid'>{tools.map(tool=><button className='secondary' key={tool.route} onClick={()=>openLegacy(tool.route)}><b>{tool.title}</b><span>{tool.description}</span></button>)}</div>
  </section>;
}
