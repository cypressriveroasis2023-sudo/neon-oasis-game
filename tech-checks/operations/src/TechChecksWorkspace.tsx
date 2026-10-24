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
    <div className='panelhead'><h2>Technician oversight</h2><span>Equipment custody, outstanding checks and saved evidence</span></div>
    <div className='operations-tool-grid'>
      <button onClick={()=>openLegacy('it')}><b>IT</b><span>Check equipment out and check returns back into IT</span></button>
      <button onClick={()=>openLegacy('service')}><b>Service</b><span>Receive equipment, review assigned equipment and return to IT</span></button>
    </div>
    <p className='tech-check-record-note'>Pending handoffs do not establish received custody. Review the existing signed records and Owner completion audit before resolving an exception.</p>
    <h3>Review technicians and equipment</h3>
    <div className='operations-tool-grid'>{tools.filter(tool=>['team','review','handoffs','attention','history'].includes(tool.route)).map(tool=><button className='secondary' key={tool.route} onClick={()=>openLegacy(tool.route)}><b>{tool.title}</b><span>{tool.description}</span></button>)}</div>
    <details className='cos-owner-advanced'><summary>Advanced check administration</summary><div className='operations-tool-grid'>{tools.filter(tool=>!['team','review','handoffs','attention','history'].includes(tool.route)).map(tool=><button className='secondary' key={tool.route} onClick={()=>openLegacy(tool.route)}><b>{tool.title}</b><span>{tool.description}</span></button>)}</div></details>
  </section>;
}
