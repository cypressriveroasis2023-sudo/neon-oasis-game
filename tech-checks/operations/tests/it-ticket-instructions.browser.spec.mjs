import {test, expect} from '@playwright/test';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
import vm from 'node:vm';
const origin='http://127.0.0.1:4173';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const legacy=readFileSync(resolve(repo,'tech-checks/technician-wizard-owner-dashboard-v5.js'),'utf8');
const section=(start,end)=>{const from=legacy.indexOf(start),to=legacy.indexOf(end,from);if(from<0||to<=from)throw new Error('Protected IT fixture section missing');return legacy.slice(from,to);};
// Use the real protected lookup, assignment start/gate, equipment selection,
// showItPrep/renderItUnitStep and complete ITPrepView/ITPrepWizard/ITPrepRules
// helpers. Only persistence, evidence records and identity are synthetic.
const functions=[
 section('function esc(v)','function resetWizardPosition'),
 section('function injectStyles()','function progress(kicker'),
 section('function progress(kicker','async function prepCounts'),
 section('async function assignmentGateState','function assignmentEquipmentCount'),
 section('async function startAssignedJob','async function openAssignmentFromNotification'),
 section('function itCreateCard()','function equipmentManifestText'),
 section('function itEquipmentQtyGrid','function draftedUnitCount'),
 section('function showITJobLookup()','function validateCreateStep'),
 section('function equipmentManifestExpanded','function automaticServiceSolarPlan'),
 section('async function getPrep(id)','async function optimizeEvidencePhoto'),
 section('function itItems()','async function releaseItPrepUnitByUnit'),
 section('function itWizardCard()','async function showITStatus'),
].join('\n');
const helpers=['tech-check-rules.js','it-prep-rules-v1.js','it-prep-view-v1.js','it-prep-wizard-v1.js'].map(name=>'(function(){\n'+readFileSync(resolve(repo,'tech-checks',name),'utf8')+'\n})();').join('\n');
const fixture=`
${helpers}
window.fixture={id:'fixture-it',role:'it',reads:[],actions:[],pending:[],mode:'success',resume:false,prepTicket:'1001',rows:[
 {id:'fixture-a',ticket_no:'1001',assigned_role:'it',assignee_user_id:'fixture-it',assignment_scope:'person',status:'assigned',work_type:'delivery',site:'Fixture north site',requires_it_handoff:false,equipment_manifest:[],requested_unit_count:0,unit_summary:'Helios unit type\\nTechnician chooses the unit.',job_description:'Prepare equipment for the north entrance.\\nTechnician chooses the unit later.',notes:'Delivery instructions: <img src=x onerror=window.fixtureInjected=true>\\nCall the site contact before unloading.'},
 {id:'fixture-b',ticket_no:'1002',assigned_role:'it',assignee_user_id:'fixture-it',assignment_scope:'person',status:'started',work_type:'delivery',site:'Fixture south site',requires_it_handoff:false,equipment_manifest:[],job_description:'Second fixture work',notes:'SECOND TICKET NOTES'}
]};
const liveDb={auth:{onAuthStateChange:fn=>{fixture.auth=fn;return{};},getSession:async()=>({data:{session:fixture.id?{user:{id:fixture.id}}:null}})},from:table=>{
 const read={table,filters:[],columns:''};const query={select:columns=>{read.columns=columns;return query;},eq:(key,value)=>{read.filters.push([key,value]);return query;},in:(key,values)=>{read.filters.push([key,values]);return query;},order:()=>query,limit:()=>query,abortSignal:()=>query,single:()=>{read.single=true;return query;},
 then:(done,fail)=>{fixture.reads.push(read);let rows=table==='job_assignments'?fixture.rows:table==='prep_tickets'&&fixture.resume?[{id:'fixture-prep',ticket_no:fixture.prepTicket,status:'draft',created_by:fixture.id,work_type:'delivery',expected_unit_count:1,equipment_manifest:[{category:'device',label:'Helios',qty:1}],prep_items:[{id:'fixture-item',equipment_type:'Helios',purpose:'DELIVERY',unit_tag:'',created_at:'2026-10-10T12:00:00Z'}]}]:[];
 rows=rows.filter(row=>read.filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):value===row[key]));const result={data:structuredClone(read.single?rows[0]||null:rows)};
 if(read.columns.startsWith('id,ticket_no,assigned_role')){
   if(fixture.mode==='failure')return Promise.resolve({error:{message:'Synthetic unavailable'}}).then(done,fail);
   if(fixture.mode==='pending')return new Promise(resolve=>fixture.pending.push(()=>resolve(result))).then(done,fail);
 }
 return Promise.resolve(result).then(done,fail);}};return query;},rpc:async(name,args)=>{fixture.actions.push({name,args});if(name==='claim_my_department_assignment')fixture.rows.find(row=>row.id===args.p_assignment_id).assignee_user_id=fixture.id;return{data:null,error:null};}};
window.TechCheckContext={db:liveDb,getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getSession:()=>fixture.id?{user:{id:fixture.id}}:null,getProfile:()=>({user_id:fixture.id,role:fixture.role,active:true})};
let activeItPrep=null,pendingAssignmentLinkId=null,pendingAssignmentManifest=[],pendingAssignmentWorkType='service',itCreateStep=0,itExpectedUnits=0,itUnitIndex=0,itQuestionIndex=0,itAnswered=new Set(),itUnitPhase='type',itFinalView='summary',itTypeChoice='',itPurposeChoice='',itReconRequired=1;
const itDraftAnswers=new Map();
window.TechCheckEvidence={rows:async()=>[],unitRows:()=>[],unitSignature:()=>null};
window.TechCheckTruckSpares={load:async()=>[]};
function resetWizardPosition(){}
function ownerTestPreviewContext(){return null;}
function ownerTestPreviewFor(){return null;}
async function currentTechIdentity(){return {id:fixture.id};}
async function setJobAssignmentStatusCompat(id,status){fixture.actions.push({id,status});fixture.rows.find(row=>row.id===id).status=status;return{error:null};}
async function linkAssignmentToPrepCompat(id,prep){fixture.actions.push({id,prep});return{error:null};}
async function sendTechWorkflowBroadcast(){}
async function swapSiteRegistrationRows(){return [];}
function showITHome(){hideChildren(viewIT(),[]);}
${functions}
window.findFixtureTicket=async ticket=>{showITJobLookup();document.getElementById('wlITJobSearch').value=ticket;await itFindJobByTicket();};
window.setFixtureIdentity=(id,role='it')=>{fixture.id=id;fixture.role=role;document.getElementById('appView').classList.toggle('hidden',!id);fixture.auth?.(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null);};
document.addEventListener('click',event=>{if(event.target.closest('[data-wl-it-find-job]'))void itFindJobByTicket();const start=event.target.closest('[data-wl-start-assignment]');if(start)void startAssignedJob(start.dataset.wlStartAssignment);if(event.target.closest('[data-wl-home]')||event.target.closest('[data-wl-create="prev"]'))showITHome();});
injectStyles();
document.getElementById('sessionLoading').remove();document.getElementById('appView').classList.remove('hidden');document.getElementById('view-it').classList.remove('hidden');document.getElementById('whoRole').textContent='IT Technician';showITJobLookup();
`;
new vm.Script(fixture);
const html=readFileSync(resolve(repo,'tech-checks/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${fixture}</script><script type="module" src="./it-ticket-instructions-host.js"></script></body>`);
const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.html':'text/html'};
async function mount(page){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort('blockedbyclient');if(url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:html});const path=resolve(repo,'.'+decodeURIComponent(url.pathname));if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:types[extname(path)]||'application/octet-stream'});return route.abort('blockedbyclient');});
 await page.goto('/tech-checks/');await expect(page.locator('#wlITJobSearch')).toBeVisible();await expect(page.locator('#wizardLiveStyles')).toHaveCount(1);
}
const notes=page=>page.locator('#cosITTicketInstructions');
async function find(page,ticket='1001'){await page.locator('#wlITJobSearch').fill(ticket);await page.locator('[data-wl-it-find-job]').click();}

test('actual IT lookup opens blank-manifest Job Setup with literal original work and delivery notes',async({page},testInfo)=>{
 await mount(page);await find(page);await expect(notes(page)).toContainText('Technician chooses the unit later.');await expect(notes(page)).toContainText('Recorded equipment / unit instructions');await expect(notes(page)).toContainText('Helios unit type');await expect(notes(page)).toContainText('<img src=x onerror=window.fixtureInjected=true>');expect(await notes(page).locator('img').count()).toBe(0);expect(await notes(page).locator('h4').filter({hasText:'Notes / delivery instructions'}).evaluate(node=>node.nextElementSibling.textContent)).toBe(await page.evaluate(()=>fixture.rows[0].notes));expect(await notes(page).locator('h4').filter({hasText:'Recorded equipment / unit instructions'}).evaluate(node=>node.nextElementSibling.textContent)).toBe(await page.evaluate(()=>fixture.rows[0].unit_summary));expect(await page.evaluate(()=>window.fixtureInjected)).toBeUndefined();expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
 await page.locator('[data-wl-start-assignment]').click();await expect(page.locator('#wlCreateHead')).toContainText('Job Setup');await expect(notes(page)).toContainText('Call the site contact before unloading.');await expect(page.locator('#itTicket')).toHaveValue('1001');await expect(page.locator('#wlITEquipmentWrap')).toBeVisible();
 const quantity=page.locator('[data-it-equipment-qty][data-label="Helios"]');await expect(quantity).toHaveValue('0');await quantity.fill('1');await expect(notes(page)).toContainText('Technician chooses the unit later.');await expect(notes(page)).toContainText('Recorded equipment / unit instructions');await expect(notes(page)).toContainText('Helios unit type');await expect(quantity).toHaveValue('1');await expect(page.locator('[data-wl-create="finish"]')).toHaveText('Start Unit 1 →');expect(await page.evaluate(()=>fixture.actions)).toEqual([{id:'fixture-a',status:'started'}]);
 const box=await notes(page).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);
 await page.screenshot({path:testInfo.outputPath('original-ticket-instructions-job-setup.png'),fullPage:true});await page.locator('[data-wl-create="prev"]').click();await expect(notes(page)).toHaveCount(0);
});

test('instructions never unlock the protected pickup gate and missing notes are explicit',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.rows[0].work_type='pickup';});await find(page);await expect(notes(page)).toContainText('Delivery instructions:');await expect(page.locator('#wlITJobSearchMsg')).toContainText('YOU CANNOT START YET.');await expect(page.locator('[data-wl-start-assignment]')).toHaveCount(0);expect(await page.evaluate(()=>fixture.actions)).toEqual([]);
 await page.evaluate(()=>{fixture.rows[0].notes=null;fixture.rows[0].job_description='';fixture.rows[0].unit_summary=null;});await notes(page).getByRole('button',{name:'Refresh instructions'}).click();await expect(notes(page)).toContainText('No work, delivery or unit instructions were saved');
});

test('pending notes cannot survive newer lookup, Close, logout or a different assignee',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.mode='pending';});await find(page);await expect(notes(page)).toContainText('Loading saved');await page.evaluate(()=>{fixture.mode='success';});await find(page,'1002');await expect(notes(page)).toContainText('SECOND TICKET NOTES');await page.evaluate(()=>{fixture.pending.splice(0).forEach(resolve=>resolve());});await expect(notes(page)).not.toContainText('north entrance');
 await page.evaluate(()=>{fixture.mode='pending';});await notes(page).getByRole('button',{name:'Refresh instructions'}).click();await expect(notes(page)).toContainText('Loading saved');await notes(page).getByRole('button',{name:'Close instructions'}).click();await page.evaluate(()=>{fixture.pending.splice(0).forEach(resolve=>resolve());});await expect(notes(page)).not.toContainText('SECOND TICKET NOTES');await expect(notes(page)).not.toContainText('Loading saved');
 await page.evaluate(()=>setFixtureIdentity(null));await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>{fixture.mode='success';setFixtureIdentity('second-it');});await expect(notes(page)).toContainText('No active IT assignment');await expect(notes(page)).not.toContainText('SECOND TICKET NOTES');
});

test('resumed prep reads the exact actual progress header; redraw and navigation never retain old notes',async({page})=>{
 await mount(page);await page.evaluate(()=>{fixture.resume=true;fixture.rows[0].status='started';});await find(page);await page.locator('[data-wl-start-assignment]').click();await expect(page.locator('#wlItWizardOnly')).toBeVisible();await expect(notes(page)).toContainText('north entrance');
 await expect(page.locator('#wlItUnitValue')).toBeVisible();await page.evaluate(async()=>{itQuestionIndex=1;await renderItUnitStep();});await expect(notes(page)).toContainText('north entrance');await page.evaluate(async()=>{fixture.prepTicket='1002';await showItPrep('fixture-prep');});await expect(notes(page)).toContainText('SECOND TICKET NOTES');await expect(notes(page)).not.toContainText('north entrance');
 await page.evaluate(()=>{const label=document.querySelector('#wlItWizardOnly > .wl-head > .small');label.after(label.cloneNode(true));});await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>renderItUnitStep());await expect(notes(page)).toContainText('SECOND TICKET NOTES');await page.evaluate(()=>{document.querySelector('#wlItWizardOnly > .wl-head > .small').textContent='Different header';});await expect(notes(page)).toHaveCount(0);
 await page.evaluate(()=>findFixtureTicket('1001'));await expect(notes(page)).toContainText('north entrance');await page.evaluate(()=>{history.pushState({},'','#other-view');document.getElementById('view-it').classList.add('hidden');dispatchEvent(new PopStateEvent('popstate'));});await expect(notes(page)).toHaveCount(0);await page.goBack();await page.evaluate(()=>{document.getElementById('view-it').classList.remove('hidden');dispatchEvent(new PopStateEvent('popstate'));});await expect(notes(page)).toContainText('north entrance');
});

test('pagehide blocks observer remount and pageshow requires a fresh current-ticket read',async({page})=>{
 await mount(page);await find(page);await expect(notes(page)).toContainText('north entrance');await page.evaluate(()=>{fixture.mode='pending';});await notes(page).getByRole('button',{name:'Refresh instructions'}).click();await expect(notes(page)).toContainText('Loading saved');
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>{fixture.pending.splice(0).forEach(resolve=>resolve());document.body.dataset.fixtureLifecycle='changed';});await expect(notes(page)).toHaveCount(0);
 await page.evaluate(async()=>{fixture.mode='success';fixture.rows[1].assignee_user_id='restored-user';setFixtureIdentity('restored-user');await findFixtureTicket('1002');});await expect(notes(page)).toHaveCount(0);await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect(notes(page)).toContainText('SECOND TICKET NOTES');await expect(notes(page)).not.toContainText('north entrance');
});
