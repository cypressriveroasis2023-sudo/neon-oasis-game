import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
export const repo=resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
const legacy=readFileSync(resolve(repo,'tech-checks/technician-wizard-owner-dashboard-v5.js'),'utf8');
const section=(start,end)=>{const from=legacy.indexOf(start),to=legacy.indexOf(end,from);if(from<0||to<=from)throw Error('Protected Service fixture section missing');return legacy.slice(from,to);};
// Run the real Service home, lookup and handoff gate. Only identity and backend
// responses are synthetic. Start, claim and all action RPCs fail the fixture.
const functions=[
  section('function esc(v)','function resetWizardPosition'),
  section('function injectStyles()','function progress(kicker'),
  section('function progress(kicker','async function prepCounts'),
  section('async function currentTechIdentity()','async function setJobAssignmentStatusCompat'),
  section('async function assignmentGateState','function assignmentEquipmentCount'),
  section('async function loadMyServiceTruckReadiness()','function serviceTruckUnitOrder'),
  section('async function latestServiceInspectionToday()','async function startTrailerInspection'),
  section('async function showSvcHome()','async function serviceTakeVerifiedJob'),
  section('async function showReceiveLookup()','async function myServiceAssignmentForTicket'),
].join('\n');
export const fixture=`
window.fixture={id:'fixture-service',role:'service',effective:'service',active:true,archived:null,profileId:null,reads:[],rpcs:[],actions:[],pending:[],mode:'success',queueMode:'success',handoff:false,readiness:{inspection_ready:true,inventory_ready:true},rows:
 ['service','delivery','swap','pickup'].map((work_type,i)=>({id:'fixture-'+i,ticket_no:String(1001+i),assigned_role:'service',assignee_user_id:'fixture-service',assignment_scope:'technician',status:'assigned',work_type,site:'Fixture site '+i,requires_it_handoff:work_type==='delivery'||work_type==='swap',equipment_manifest:[],requested_unit_count:0,scheduled_for:'2026-10-10',scheduled_time:'09:30:00',job_description:'  Original '+work_type+' work.\\nTechnician chooses the unit later.  ',notes:'Delivery instructions: <img src=x onerror=window.fixtureInjected=true>\\nKeep every original line.  ',unit_summary:'Helios unit type\\n  Technician chooses the unit.  '}))
};
let activeItPrep=null;
const queryResult=(read,kind)=>{
 const query={select:columns=>{read.columns=columns;return query;},eq:(key,value)=>{read.filters.push([key,value]);return query;},gte:()=>query,in:(key,values)=>{read.filters.push([key,values]);return query;},order:()=>query,limit:n=>{read.limit=n;return query;},abortSignal:()=>query,
 then:(done,fail)=>{
  fixture.reads.push(read);
  let rows=kind==='queue'||read.table==='job_assignments'?fixture.rows:read.table==='prep_tickets'&&fixture.handoff?[{id:'released',status:'released',ticket_no:'1002'}]:read.table==='morning_checks'?[{truck_checks:{},taking_trailer:false}]:[];
  if(kind==='queue')rows=fixture.queueRows??rows.filter(row=>row.assigned_role==='service'&&['assigned','started'].includes(row.status)&&(row.assignee_user_id===fixture.id||(row.assignee_user_id===null&&row.assignment_scope==='department'&&row.status==='assigned')));
  rows=rows.filter(row=>read.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):value===row[key]));
  if(read.limit)rows=rows.slice(0,read.limit);
  const result={data:structuredClone(rows)},mode=kind==='queue'?fixture.queueMode:read.columns?.startsWith('id,ticket_no,assigned_role')?fixture.mode:'success';
  if(mode==='failure')return Promise.resolve({error:{message:'Synthetic unavailable'}}).then(done,fail);
  if(mode==='malformed')return Promise.resolve({data:{invalid:true}}).then(done,fail);
  if(mode==='pending')return new Promise(resolve=>fixture.pending.push(()=>resolve(result))).then(done,fail);
  return Promise.resolve(result).then(done,fail);
 }};return query;
};
const liveDb={auth:{onAuthStateChange:fn=>{fixture.auth=fn;return{};},getSession:async()=>({data:{session:fixture.id?{user:{id:fixture.freshId||fixture.id}}:null}}),getUser:async()=>({data:{user:fixture.id?{id:fixture.id}:null}})},
 from:table=>queryResult({table,filters:[]},'table'),
 rpc:(name,args)=>{
  fixture.rpcs.push({name,args});
  if(name==='my_available_assignments')return queryResult({name,args,filters:[]},'queue');
  if(name==='service_departure_readiness_v1')return Promise.resolve({data:fixture.readiness});
  fixture.actions.push({name,args});throw Error('Unexpected action RPC: '+name);
 }
};
window.TechCheckContext={db:liveDb,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.effective,getSession:()=>fixture.id?{user:{id:fixture.id}}:null,getProfile:()=>({user_id:fixture.profileId||fixture.id,role:fixture.role,active:fixture.active,archived_at:fixture.archived})};
function ownerTestPreviewContext(){return null;}
function ownerTestPreviewFor(){return null;}
function resetWizardPosition(){}
function takeTechCompletion(){return null;}
function techCompletionBanner(){return '';}
${functions}
window.findFixtureTicket=async ticket=>{showServiceJobLookup();document.getElementById('wlServiceJobSearch').value=ticket;await serviceFindJobByTicket();};
window.setFixtureIdentity=(id,role='service')=>{fixture.id=id;fixture.role=role;fixture.effective=role;document.getElementById('appView').classList.toggle('hidden',!id);fixture.auth?.(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);};
`;
export const initialize=`
document.addEventListener('click',event=>{if(event.target.closest('[data-wl-service-open-job]'))showServiceJobLookup();if(event.target.closest('[data-wl-service-find-job]'))void serviceFindJobByTicket();if(event.target.closest('[data-wl-home]'))void showSvcHome();});
injectStyles();document.getElementById('sessionLoading').remove();document.getElementById('appView').classList.remove('hidden');document.getElementById('view-svc').classList.remove('hidden');document.getElementById('whoRole').textContent='Service Tech';document.getElementById('whoName').textContent='Fixture Technician';void showSvcHome();
`;
new vm.Script(fixture+initialize);
export const html=readFileSync(resolve(repo,'tech-checks/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${fixture+initialize}</script><script type="module" src="./it-ticket-instructions-host.js"></script></body>`);
