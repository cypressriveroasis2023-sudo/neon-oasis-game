import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const legacy=read('../../technician-wizard-owner-dashboard-v5.js');
const section=(start,end)=>{const from=legacy.indexOf(start),to=legacy.indexOf(end,from);if(from<0||to<=from)throw new Error('Protected IT Home function was not found');return legacy.slice(from,to);};
// Real protected rendering and hideChildren run against synthetic, read-only data.
const renderer=[section('function esc(v)','function resetWizardPosition'),section('function ensureITCommandDashboardStyles()','async function showITHome()'),section('async function showITHome()','function startITCommandClockWeather()')].join('\n');
const styles=['styles.css','vision-platform.css','company-host-theme.css'].map(name=>read('../../'+name)).join('\n');
export function itHomeFixture(role='it',linked=true,options={}){
 const id=linked?(options.secondVerified?'b7cc3cbf-d11e-4d4a-9742-c07701857911':'4f7044b5-86b6-411f-8898-39bb64b4ddbc'):'33333333-3333-4333-8333-333333333333';
 return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="appView"><span id="whoRole" hidden>IT Technician</span><span id="whoName" hidden>Synthetic Technician</span><div id="view-it"><div id="existing-it-tool">Existing IT tool</div></div></div><script>
 window.fixtureTokens=0;window.fixtureRole=${JSON.stringify(role)};window.fixtureSubject=${JSON.stringify(id)};window.fixtureCapability=${options.capability!==false};
 window.TechCheckContext={getProfile:()=>({active:${options.active!==false},archived_at:${options.archived?'"synthetic"':'null'}}),getRole:()=>window.fixtureRole,getEffectiveRole:()=>${options.effectiveRole?JSON.stringify(options.effectiveRole):'window.fixtureRole'},getSession:()=>window.fixtureSubject?({user:{id:window.fixtureSubject}}):null,db:{rpc:async()=>({data:{fleetRead:window.fixtureCapability}}),auth:{onAuthStateChange:fn=>{window.fixtureAuthChanged=fn;},getSession:async()=>{window.fixtureTokens++;return {data:{session:window.fixtureSubject?{user:{id:window.fixtureSubject},access_token:'synthetic-only'}:null}}}}}};
 function resetWizardPosition(){};function startITCommandClockWeather(){};function takeTechCompletion(){return null};function techCompletionBanner(){return ''};function techCheckDateKey(){return '2026-10-09'};function itNextActionHtml(){return ''};function itServiceQueueHtml(){return ''};function techDashboardLoadingHtml(){return '<p>Loading Home</p>'};function techDashboardErrorHtml(role,message){throw new Error(message)};function techDashboardTimeout(value){return value};async function itDayState(){return {}};async function loadITManagedTickets(){return []};
 ${renderer}
 window.renderITHome=showITHome;document.addEventListener('click',event=>{if(event.target.closest('[data-wl-home="it"]'))showITHome();});showITHome();
 </script><script type="module" src="/fleet-host-fixture.js"></script>`;
}
