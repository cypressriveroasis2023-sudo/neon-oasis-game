import {test,expect} from '@playwright/test';
import {mountTransfers,IT,SERVICE,OWNER} from './helpers/transfer-fixture.mjs';

const photo={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')};
const solar={equipment_key:'solar_spotter:039',family:'Solar Spotter',unit_tag:'039',sims:['00123456789012345670'],battery_count:null,battery_configuration:null,parts:[]};
const sniper={equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:[],battery_count:null,battery_configuration:null,parts:[]};
let f;
test.afterEach(async()=>{await f?.close();f=null;});
async function sign(page,name='Synthetic Service'){
 await page.getByRole('radio',{name:'Type signature',exact:true}).check();
 await page.getByRole('textbox',{name:'Type your full name',exact:true}).fill(name);
 await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
}
async function details(page,{family='Solar spotter',tag='039',sim=solar.sims[0],batteries=null}={}){
 await page.getByLabel('Unit family / name 1',{exact:true}).fill(family);
 await page.getByLabel('Unit number 1',{exact:true}).fill(tag);
 await page.getByLabel('Exact SIM numbers (one per line; blank only when none) 1',{exact:true}).fill(sim);
 await page.getByLabel('Additional parts (one per line: name | quantity) 1',{exact:true}).fill('N/A');
 if(batteries!==null)await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill(batteries);
}
async function asService(page){
 await page.evaluate(async actor=>{
  fixture.actor=actor;fixture.role='service';document.getElementById('appView').hidden=true;
  const root=document.createElement('section');root.id='purpose-service-test';document.body.append(root);
  const {mountTransferDesk}=await import('/tech-checks/transfers/desk.js');window.purposeServiceDispose=mountTransferDesk(root,TechCheckContext,{role:'service'});
 },SERVICE);
}

test('current placement proof travels through mobile installation and signed submission',async({page})=>{
 await page.setViewportSize({width:390,height:844});f=await mountTransfers(page,{placementEvidence:true});
 await page.getByRole('button',{name:'Check Out / Hand Off',exact:true}).click();await page.getByLabel('What is this equipment for?',{exact:true}).selectOption('installation');
 await page.getByLabel('Receiving Service technician').selectOption(SERVICE);await page.getByLabel('Select equipment').selectOption('solar_spotter:039');await page.getByRole('button',{name:'Add unit to handoff',exact:true}).click();
 await expect(page.getByText('Required installation package: 4 × 12V 110Ah per Solar Stand',{exact:true})).toBeVisible();
 await expect(page.getByText(/350Ah/)).toHaveCount(0);
 await details(page,{family:'Solar Spotter',batteries:'3'});for(const check of await page.locator('fieldset input[type=checkbox]').all())await check.check();
 await page.getByLabel('Equipment photo 1',{exact:true}).setInputFiles(photo);await expect(page.locator('.tc-evidence img')).toBeVisible();await sign(page,'Synthetic IT');
 await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();await expect(page.locator('.tc-submit-error')).toContainText('requires 4 × 12V 110Ah');
 expect(f.calls.filter(call=>call.name==='submit_techcheck_transfer_v2')).toHaveLength(0);
 await page.getByLabel('Batteries / battery boxes on this unit 1',{exact:true}).fill('4');await sign(page,'Synthetic IT');await page.getByRole('button',{name:'Sign & send handoff',exact:true}).click();
 await expect(page.getByText('Awaiting Service verification',{exact:true})).toBeVisible();
 const event=(await f.db.query("select snapshot from app_private.techcheck_transfer_events where kind='checkout'")).rows[0].snapshot;
 expect(event.placement_evidence).toHaveLength(1);expect(event.placement_evidence[0].source_sha).toBe('a'.repeat(64));expect(event.purpose).toBe('installation');expect(event.actual[0].battery_count).toBe(4);expect(event.actual[0].battery_configuration).toBe('agm_4x_12v_110ah');
 for(const field of ['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'])expect(event.checks[solar.equipment_key][field]).toBe(true);
 expect(f.errors).toEqual([]);
});

