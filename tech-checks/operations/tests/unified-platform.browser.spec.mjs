import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const operations=resolve(repo,'tech-checks/operations');
const css=readFileSync(resolve(repo,'deployment/appdeploy-unified-vision/vision-platform.css'),'utf8');
const menu=resolve(repo,'deployment/appdeploy-unified-vision/WorkspaceMenu.tsx');
// Compile the actual AppDeploy menu, with synthetic navigation only. No SDK,
// credentials, external transport, account or operational record is involved.
const script=buildSync({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import WorkspaceMenu from ${JSON.stringify(menu)};function Fixture(){const[page,setPage]=useState('Today');return <div className='cos-vision-appdeploy'><header><h1>{page}</h1><WorkspaceMenu items={['Today','Jobs','IT Check','Service Check','Field Map','Billing']} navigate={setPage}/></header></div>}createRoot(document.getElementById('root')).render(<Fixture/>);`,loader:'tsx',resolveDir:operations},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{react:resolve(operations,'node_modules/react'),'react-dom':resolve(operations,'node_modules/react-dom')}}).outputFiles[0].text;

test('AppDeploy menu loads its selected page and supports keyboard dismissal at mobile and desktop widths',async({page},testInfo)=>{
  await page.route('**/*',route=>{
    if(route.request().url()==='http://127.0.0.1:4173/unified-appdeploy-menu')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}</style><div id="root"></div><script>${script}</script>`});
    return route.abort('blockedbyclient');
  });
  await page.goto('/unified-appdeploy-menu');
  const trigger=page.getByRole('button',{name:'☰ Menu'});
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Workspace menu'});
  await expect(dialog.getByRole('button',{name:'Close menu'})).toBeFocused();
  await dialog.getByRole('button',{name:'IT Check',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'IT Check',exact:true})).toBeVisible();
  await trigger.click();
  await dialog.getByRole('button',{name:'Close menu'}).press('Shift+Tab');
  await expect(dialog.getByRole('button',{name:'Billing',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Billing',exact:true}).press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  for(const width of [320,390,1024,1440]){
    await page.setViewportSize({width,height:900});
    const size=await dialog.evaluate(element=>({right:element.getBoundingClientRect().right,width:innerWidth,scroll:document.documentElement.scrollWidth}));
    expect(size.right).toBeLessThanOrEqual(size.width);
    expect(size.scroll).toBeLessThanOrEqual(size.width);
  }
  await page.setViewportSize(testInfo.project.use.viewport);
  await page.screenshot({path:testInfo.outputPath('appdeploy-unified-menu.png')});
});

test('IT technical navigation and forms fit with the real protected IT stylesheet and shared styling',async({page},testInfo)=>{
  const legacy=readFileSync(resolve(repo,'tech-checks/technician-wizard-owner-dashboard-v5.js'),'utf8');
  const start=legacy.indexOf("s.id='wlItCommandDashboardStyles';");
  const styleStart=legacy.indexOf('s.textContent=`',start)+'s.textContent=`'.length;
  const styleEnd=legacy.indexOf('`;',styleStart);
  if(start<0||styleEnd<styleStart)throw Error('Protected IT presentation source not found');
  const protectedCss=legacy.slice(styleStart,styleEnd);
  const shared=readFileSync(resolve(repo,'tech-checks/vision-platform.css'),'utf8');
  await page.route('**/*',route=>{
    if(route.request().url()!=='http://127.0.0.1:4173/unified-it')return route.abort('blockedbyclient');
    return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${protectedCss}${shared}</style><div id="appView"><section id="view-it"><div class="wl-it-command-shell"><aside class="wl-it-command-sidebar"><nav class="wl-it-command-nav"><button class="active">Dashboard</button><button>Create Job</button><button>Managed Tickets</button><button>Truck Inventory</button><button>IT Intake</button><button>Equipment Prep</button></nav></aside><main class="wl-it-command-workspace"><header class="wl-it-command-head"><div><h1>IT workspace</h1><p>Technical preparation</p></div></header><section class="wl-it-command-panel"><label>MHelpDesk Ticket<input aria-label="MHelpDesk Ticket" value=""></label><button type="button" id="open">Open ticket</button><p id="result" role="status"></p></section></main></div></section></div><script>document.getElementById('open').onclick=()=>document.getElementById('result').textContent='Preview ticket '+document.querySelector('input').value;</script>`});
  });
  await page.goto('/unified-it');
  for(const width of [320,390,1024,1440,2560]){
    await page.setViewportSize({width,height:900});
    const layout=await page.locator('.wl-it-command-shell').evaluate(element=>({bg:getComputedStyle(element).backgroundColor,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    expect(layout.bg).toBe('rgb(8, 14, 24)');expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  }
  await page.getByRole('textbox',{name:'MHelpDesk Ticket'}).fill('FIX-IT-01');
  await page.getByRole('button',{name:'Open ticket'}).click();
  await expect(page.getByRole('status')).toHaveText('Preview ticket FIX-IT-01');
  await page.setViewportSize(testInfo.project.use.viewport);
  await page.screenshot({path:testInfo.outputPath('unified-it.png')});
});
