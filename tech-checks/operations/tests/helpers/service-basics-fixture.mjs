import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const legacy = readFileSync(resolve(repo, 'tech-checks/technician-wizard-owner-dashboard-v5.js'), 'utf8');
const section = (start, end) => {
  const from = legacy.indexOf(start), to = legacy.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error('Protected Service fixture section was not found: ' + start);
  return legacy.slice(from, to);
};
// Execute the real protected renderers, inspection branching, inventory writers,
// and delegated answer/save handlers. Only identity, drafts and the data client
// are synthetic. Every browser request is intercepted; no production writes.
const functions = [
  section('const truckLabels = [', 'let itCreateStep'),
  section('let inspection = {', 'let serviceReturn = {'),
  section('function esc(v)', 'function resetWizardPosition'),
  section('function injectStyles()', 'async function prepCounts()'),
  section('async function currentTechIdentity()', 'async function setJobAssignmentStatusCompat'),
  section('async function loadMyServiceTruckReadiness()', 'async function showServiceTruckUsage()'),
  section('async function latestServiceInspectionToday()', 'function showServiceJobLookup()'),
  section('function inspectionQuestion()', 'async function showInspectionHistory()'),
].join('\n');
const inspectionClicks = section("  const ans = e.target.closest('[data-wl-answer]');", '});\nasync function showServiceReturn()');
const saveClick = section("  const truckSaveButton=e.target.closest('[data-wl-save-truck-inventory]');", "  const dashboardRetry=e.target.closest('[data-wl-dashboard-retry]');");
const inventoryInput = section("document.addEventListener('input', e=>{", "document.addEventListener('click', async e => {\n  const truckSaveButton");
const toolClicks = section("  if(e.target.closest('[data-wl-service-trailer-inspection]'))", "  const acceptTruckRestock=e.target.closest('[data-wl-service-accept-truck-restock]');");
const homeClick = section('  if (e.target.closest("[data-wl-home=\'it\']"))', '  const cr = e.target.closest');
const sourceHtml = readFileSync(resolve(repo, 'tech-checks/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const script = `
window.fixture={role:'service',actor:'synthetic-service',online:true,calls:[],alerts:[],draft:null,morning:null,failMorning:false,failSave:false,failRead:false,
  readiness:{inspection_ready:false,inventory_ready:false,units:['Sniper','Ranger','Spotter','Solar Spotter'].map(equipment_type=>({equipment_type,unit_tag:'',status:'unassigned'})),
  sims:[1,2,3].map(slot_no=>({slot_no,sim_number:'',status:'unassigned'})),stock:{recon_battery_qty:0,agm_12v_110ah_qty:0,litime_12v_100ah_qty:0,battery_12v_35ah_qty:0}}};
window.alert=message=>fixture.alerts.push(message);
Object.defineProperty(navigator,'onLine',{get:()=>fixture.online,configurable:true});
const subscriptions=[];
const liveDb={auth:{onAuthStateChange:fn=>{subscriptions.push(fn);return {};},getUser:async()=>({data:{user:{id:fixture.actor}}})},
  rpc:async(name,args)=>{
    fixture.calls.push({name,args:structuredClone(args)});
    if(fixture.role!=='service')return {error:{message:'Active Service Tech required.'}};
    if(name==='service_departure_readiness_v1')return fixture.failRead?{error:{message:'Synthetic unavailable'}}:{data:structuredClone(fixture.readiness)};
    if(name==='submit_morning_check'){
      if(fixture.failMorning)return {error:{message:'Synthetic inspection save failed'}};
      fixture.morning={truck_checks:args.p_truck_checks,taking_trailer:args.p_taking_trailer,trailer_checks:args.p_trailer_checks};
      fixture.readiness.inspection_ready=true;return {data:{}};
    }
    if(name==='service_save_my_truck_inventory_v3'){
      if(fixture.failSave)return {error:{message:'Synthetic inventory save failed'}};
      fixture.readiness.units.forEach(u=>{u.unit_tag=args.p_units[u.equipment_type];u.status=u.unit_tag?'assigned':'unassigned';});
      fixture.readiness.sims.forEach(s=>{s.sim_number=args.p_sims[s.slot_no];s.status=s.sim_number?'assigned':'unassigned';});
      for(const name of ['recon_battery_qty','agm_12v_110ah_qty','litime_12v_100ah_qty','battery_12v_35ah_qty'])fixture.readiness.stock[name]=args['p_'+name];
      fixture.readiness.inventory_ready=false;return {data:structuredClone(fixture.readiness)};
    }
    if(name==='submit_my_service_truck_inventory_check_v3'){
      fixture.readiness.inventory_ready=fixture.readiness.inspection_ready&&fixture.readiness.units.every(u=>u.unit_tag&&args.p_unit_confirmations[u.equipment_type]?.confirmed)&&fixture.readiness.sims.every(s=>s.sim_number&&args.p_sim_confirmations[s.slot_no]?.confirmed)&&args.p_recon_battery_qty>=25&&args.p_agm_12v_110ah_qty>=4&&args.p_litime_12v_100ah_qty>=2&&args.p_battery_12v_35ah_qty>=4;
      return {data:structuredClone(fixture.readiness)};
    }
    throw new Error('Unexpected synthetic RPC '+name);
  },
  from:()=>{const q={select:()=>q,eq:()=>q,gte:()=>q,order:()=>q,limit:async()=>({data:fixture.morning?[structuredClone(fixture.morning)]:[]})};return q;}
};
window.TechCheckContext={db:liveDb,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getSession:()=>fixture.actor?{user:{id:fixture.actor}}:null};
function ownerTestPreviewContext(){return null;}
function ownerTestPreviewFor(){return null;}
function resetWizardPosition(){}
function takeTechCompletion(){return null;}
function techCompletionBanner(){return '';}
function rememberTechCompletion(){}
function techDashboardLoadingHtml(text){return '<p role="status">'+text+'</p>';}
function techDashboardErrorHtml(role,text){return '<p role="alert">'+text+'</p>';}
async function loadDeviceDraft(){return fixture.draft;}
async function saveInspectionDraft(){fixture.draft=structuredClone(inspection);}
async function clearDeviceDraft(){fixture.draft=null;}
const activeItPrep=null,OPS_TEL='+15555550100',OPS_DISPLAY='Synthetic Operations';
${functions}
${inventoryInput}
document.addEventListener('click',async e=>{${saveClick}\n${homeClick}\n${toolClicks}\n${inspectionClicks}});
window.renderServiceHome=showSvcHome;
window.setIdentity=role=>{
  fixture.role=role;fixture.actor=role?'synthetic-'+role:null;
  document.getElementById('whoRole').textContent=role==='owner'?'Owner/Admin':role==='service'?'Service Tech':'IT Technician';
  document.getElementById('appView').classList.toggle('hidden',!role);
  subscriptions.forEach(fn=>fn(role?'SIGNED_IN':'SIGNED_OUT',role?{user:{id:fixture.actor}}:null));
  dispatchEvent(new CustomEvent('techcheck:data-refreshed'));
};
window.show=name=>{for(const n of ['owner','it','svc','morning'])document.getElementById('view-'+n)?.classList.toggle('hidden',name!==n);dispatchEvent(new CustomEvent('techcheck:view-changed',{detail:{view:name}}));};
window.refreshData=()=>renderServiceHome();
window.logout=()=>setIdentity(null);
document.getElementById('sessionLoading').remove();
injectStyles();setIdentity('service');show('svc');renderServiceHome();
`;
const html = sourceHtml.replace('</body>', `<script>${script}</script><script type="module" src="./operations-host.js"></script><script type="module" src="./service-basics-host.js"></script></body>`);

export async function mountServiceBasics(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort('blockedbyclient');
    if (url.pathname === '/tech-checks/') return route.fulfill({contentType:'text/html',body:html});
    const path = resolve(repo, '.' + decodeURIComponent(url.pathname));
    if (path.startsWith(repo + '/') && existsSync(path)) {
      const type = {'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'}[extname(path)];
      return route.fulfill({path,contentType:type || 'application/octet-stream'});
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('/tech-checks/');
}
