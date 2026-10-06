
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const adapter=readFileSync(new URL('../../vision-workspace.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('../../vision-platform.css',import.meta.url),'utf8');
test('Service has one visible ticket entry and still delegates to the protected readiness handler after redraw',async({page})=>{
  await page.route('**/*',route=>route.abort('blockedbyclient'));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style><div id="appView"><section id="view-svc"><div id="wlSvcHome"></div><div id="lookup"></div></section></div>');
  await page.evaluate(()=>{
    window.calls=[];
    window.ready=false;
    window.redraw=()=>{
      document.getElementById('wlSvcHome').innerHTML='<div class="wl-service-simple-shell"><div class="wl-service-action-list"><button class="wl-service-action-pill" data-wl-service-open-job>Enter Ticket Number</button><button>Truck Inspection</button></div></div>';
      document.querySelector('[data-wl-service-open-job]').onclick=()=>{
        window.calls.push('protected-entry');
        document.getElementById('lookup').innerHTML=window.ready?'<input id="wlServiceJobSearch"><button data-wl-service-find-job>Find job</button>':'<p role="status">Complete readiness first</p>';
        document.querySelector('[data-wl-service-find-job]')?.addEventListener('click',()=>window.calls.push(document.getElementById('wlServiceJobSearch').value));
      };
    };
    window.redraw();
  });
  await page.addScriptTag({type:'module',content:adapter});
  const ticket=page.getByLabel('Ticket number',{exact:true});
  await expect(ticket).toBeVisible();
  await expect(page.getByRole('button',{name:'Enter Ticket Number',exact:true})).toHaveCount(0);
  await ticket.fill('FIX-101');
  await page.getByRole('button',{name:'Open service check →'}).click();
  await expect(page.getByRole('status')).toHaveText('Complete readiness first');
  expect(await page.evaluate(()=>window.calls)).toEqual(['protected-entry']);
  await page.evaluate(()=>{window.ready=true;window.redraw();});
  await expect(ticket).toBeVisible();
  await expect(page.locator('.vision-ticket-entry')).toHaveCount(1);
  await ticket.fill('FIX-102');
  await page.getByRole('button',{name:'Open service check →'}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls)).toEqual(['protected-entry','protected-entry','FIX-102']);
  await expect(page.getByRole('button',{name:'Enter Ticket Number',exact:true})).toHaveCount(0);
});
