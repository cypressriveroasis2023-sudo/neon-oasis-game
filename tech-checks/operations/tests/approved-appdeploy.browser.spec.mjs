import {test,expect} from '@playwright/test';
import {buildSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const operations=resolve(repo,'tech-checks/operations');
const dir=resolve(repo,'deployment/appdeploy-approved-workspace');
const source=JSON.parse(readFileSync(resolve(dir,'technician-presentation.json'),'utf8')).source;
const css=readFileSync(resolve(dir,'vision-platform.css'),'utf8');
const js=buildSync({stdin:{contents:`import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';const api={get:async()=>({data:{}}),post:async()=>{throw Error('Unexpected write')}};const cosPrompt=async()=>null;const cosConfirm=async()=>false;${source}\nwindow.calls=[];function Fixture(){const[ready,setReady]=useState(false);return <div className='cos-vision-appdeploy'><button onClick={()=>setReady(true)}>Fixture readiness complete</button><TechnicianDailyDashboard tech='Fixture Service' day={{profile:{department:'service'},visits:[],truck_check:{completed:ready}}} truck={{status:ready?'completed':'started'}} tasks={[]} busy={false} openVisit={()=>{}} updateTask={()=>{}} show={()=>{}} enterServiceTicket={ticket=>window.calls.push(ticket)}/></div>}createRoot(document.getElementById('root')).render(<Fixture/>);`,loader:'tsx',resolveDir:operations},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{react:resolve(operations,'node_modules/react'),'react-dom':resolve(operations,'node_modules/react-dom')}}).outputFiles[0].text;
test('AppDeploy approved Service form preserves readiness and forwards the exact ticket once',async({page},testInfo)=>{
 await page.route('**/*',route=>route.request().url()==='http://127.0.0.1:4173/approved-appdeploy'?route.fulfill({contentType:'text/html',body:`<meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}*{box-sizing:border-box}${css}</style><div id='root'></div><script>${js}</script>`}):route.abort());
 await page.goto('/approved-appdeploy');
 await page.getByLabel('Ticket number').fill('FIX-204');
 await expect(page.getByRole('button',{name:'Open service check →'})).toBeDisabled();
 expect(await page.evaluate(()=>window.calls)).toEqual([]);
 await page.getByRole('button',{name:'Fixture readiness complete'}).click();
 await page.getByRole('button',{name:'Open service check →'}).click();
 expect(await page.evaluate(()=>window.calls)).toEqual(['FIX-204']);
 for(const width of [320,390,1024,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize(testInfo.project.use.viewport);
 await page.screenshot({path:testInfo.outputPath('approved-appdeploy-service.png'),fullPage:true});
});
