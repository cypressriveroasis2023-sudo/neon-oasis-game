import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticTicketPdf } from './fixtures/mhelpSyntheticPdf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ids={customer:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',site:'20000000-0000-4000-8000-000000000001',otherSite:'20000000-0000-4000-8000-000000000002',org:'30000000-0000-4000-8000-000000000001',attachment:'40000000-0000-4000-8000-000000000001',job:'50000000-0000-4000-8000-000000000001'};
const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from'./MhelpTicketImport';function Test(){const[visible,setVisible]=useState(true);return <div id="root-shell" className="operations-shell"><button onClick={()=>setVisible(!visible)}>Navigate elsewhere</button>{visible&&<Panel show={message=>{window.__notice=message}} openJob={id=>{window.__openedJob=id}}/>}</div>}createRoot(document.getElementById('root')).render(<Test/>);`,resolveDir:root+'/src',loader:'tsx'},bundle:true,write:false,format:'esm',outfile:'flow.js',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-api-worker',setup(build){build.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:'pdf-worker-url',namespace:'fixture-worker'}));build.onLoad({filter:/.*/,namespace:'fixture-worker'},()=>({contents:'export default "/mhelp-pdf-worker.mjs";',loader:'js'}));build.onResolve({filter:/^\.\/api$/},()=>({path:'fixture-api',namespace:'fixture-api'}));build.onLoad({filter:/.*/,namespace:'fixture-api'},()=>({contents:'export const api={get:async path=>({data:await window.__api(path,"GET")}),post:async(path,body)=>({data:await window.__api(path,"POST",body)})};',loader:'js'}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const worker=fs.readFileSync(root+'/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','utf8');
test.beforeEach(async({page})=>{
  await page.addInitScript(({ids})=>{
    window.__mode='success';window.__requests=[];window.__attachment=null;window.__saved=null;window.__source=null;window.__bytes='';
    window.__api=async(path,method,body)=>{
      window.__requests.push({path,method,body});
      if(path==='/api/customers')return{items:[{id:ids.customer,name:'Fixture Builders',status:'active'},{id:ids.other,name:'Different Customer',status:'active'}]};
      if(path==='/api/sites')return{items:[{id:ids.site,customerId:ids.customer,name:'Fixture Site',addressLine1:'300 Service Road',city:'Example',stateRegion:'TX',postalCode:'77001',status:'active'},{id:ids.otherSite,customerId:ids.other,name:'Wrong customer site',status:'active'}]};
      if(path==='/api/mhelpdesk/imports/stage'){
        window.__source=body.source;window.__bytes=body.bytesBase64;
        window.__attachment={id:ids.attachment,organizationId:ids.org,sha256:body.source.sha256,byteLength:body.source.byteLength,state:'staged',recoverable:true,attemptId:body.attemptId,source:structuredClone(body.source)};
        if(window.__mode==='stage-timeout')throw new Error('Synthetic upload timeout');
        return structuredClone(window.__attachment);
      }
      if(path==='/api/mhelpdesk/imports/commit'){
        if(['duplicate','duplicate-timeout'].includes(window.__mode)){window.__attachment.jobId=ids.job;window.__attachment.disposition='duplicate';if(window.__mode==='duplicate-timeout')throw new Error('Synthetic duplicate response lost');return{jobId:ids.job,disposition:'duplicate'};}
        window.__saved={jobId:ids.job,organizationId:ids.org,attachmentId:ids.attachment,status:'saved',ticket:structuredClone(body.ticket)};
        window.__attachment.jobId=ids.job;
        if(window.__mode==='commit-timeout')throw new Error('Synthetic save timeout');
        return{jobId:ids.job,disposition:'created'};
      }
      if(path==='/api/mhelpdesk/imports/jobs/'+ids.job){
        const result=structuredClone(window.__saved);
        if(window.__mode==='readback-mismatch')result.ticket.contactInstructions='';
        return result;
      }
      if(path.endsWith('/trash')){
        if(window.__mode==='trash-timeout')throw new Error('Synthetic trash timeout');
        window.__attachment.state='trash';return structuredClone(window.__attachment);
      }
      if(path.endsWith('/restore')){window.__attachment.state='staged';return structuredClone(window.__attachment);}
      if(path.endsWith('/download'))return{filename:window.__source.filename,mimeType:'application/pdf',sha256:window.__source.sha256,bytesBase64:window.__bytes};
      if(path.includes('/attempt/'))return structuredClone(window.__attachment);
      if(path==='/api/mhelpdesk/imports/attachments/'+ids.attachment)return structuredClone(window.__attachment);
      if(path==='/api/mhelpdesk/imports')return{complete:true,items:window.__attachment?[{...window.__attachment,filename:window.__source.filename,sourceTicketId:window.__source.sourceTicketId,createdAt:'2026-01-01T00:00:00Z'}]:[]};
      throw new Error('Unexpected fixture route: '+path);
    };
  },{ids});
  await page.route('**/*',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/mhelp-flow-test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px;background:#10212b;color:#eef7ff;font:14px sans-serif}button,input,select,textarea{font:inherit}button{min-height:44px}label{display:block;margin:14px 0}input,select,textarea{max-width:100%;width:100%}input[type=checkbox]{width:auto}.quote-detail-grid{display:grid;gap:10px}.purchase-actions{display:flex;flex-wrap:wrap;gap:8px}.quote-card{padding:12px}.panelhead,.quote-section-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}${css}</style><div id="root"></div><script type="module" src="/flow.js"></script>`});
    if(pathname==='/flow.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(pathname==='/mhelp-pdf-worker.mjs')return route.fulfill({contentType:'application/javascript',body:worker});
    return route.abort();
  });
});
async function loadDraft(page){
  await page.goto('/mhelp-flow-test');
  await page.locator('input[type=file]').setInputFiles({name:'Ticket123456_999.pdf',mimeType:'application/pdf',buffer:syntheticTicketPdf()});
  await expect(page.getByRole('heading',{name:'Review Work Order 009001'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Fixture Builders',exact:true})).toBeEnabled();
}
async function reviewDraft(page){
  await page.getByRole('button',{name:'Fixture Builders',exact:true}).click();
  await page.getByLabel('Existing service site').selectOption(ids.site);
  await page.getByRole('checkbox',{name:/I checked the source information/}).check();
}
const writes=page=>page.evaluate(()=>window.__requests.filter(row=>row.method==='POST'));

test('drop autofills all source fields without saving or choosing an association',async({page})=>{
  await loadDraft(page);
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Fixture Site');
  await expect(page.getByLabel('Workflow',{exact:true})).toHaveValue('DELIVERY');
  await expect(page.getByLabel('Priority',{exact:true})).toHaveValue('normal');
  await expect(page.getByLabel('Existing service site')).toHaveValue('');
  await expect(page.getByRole('button',{name:'Save imported ticket'})).toBeDisabled();
  await expect(page.getByLabel('Source contact instructions and restrictions')).toHaveValue(/Do not add Excluded Person/);
  await expect(page.getByLabel('Other imported information / line items')).toHaveValue(/01hr 00min/);
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button',{name:'Cancel draft'}).click();
  await expect(page.getByRole('button',{name:'Choose ticket file'})).toBeVisible();
  expect(await writes(page)).toEqual([]);
});

test('explicit save stages once, verifies every field, trashes only app copy, restores and downloads',async({page})=>{
  await loadDraft(page);await reviewDraft(page);
  await page.getByRole('button',{name:'Save imported ticket'}).dblclick();
  await expect(page.getByText('The ticket was saved and verified. The imported copy is in recoverable app trash.')).toBeVisible();
  const requests=await writes(page);
  expect(requests.map(row=>row.path)).toEqual(['/api/mhelpdesk/imports/stage','/api/mhelpdesk/imports/commit','/api/mhelpdesk/imports/attachments/'+ids.attachment+'/trash']);
  expect(requests[1].body.ticket.source.sourceTicketId).toBe('009001');expect(requests[1].body.ticket.unitIds).toEqual([]);
  await page.getByRole('button',{name:'Imported copies / Trash',exact:true}).click();
  await expect(page.getByRole('button',{name:'Restore copy'})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download original copy'}).click();
  expect((await download).suggestedFilename()).toBe('Ticket123456_999.pdf');
  await page.getByRole('button',{name:'Restore copy'}).click();
  await expect(page.getByText('The imported copy was restored. The saved COS job is unchanged.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Restore copy'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('customer change clears site and review; no cross-customer option is offered',async({page})=>{
  await loadDraft(page);await reviewDraft(page);
  await page.getByLabel('Search existing COS customers').fill('Different');
  await page.getByRole('button',{name:'Different Customer',exact:true}).click();
  await expect(page.getByLabel('Existing service site')).toHaveValue('');
  await expect(page.getByRole('checkbox',{name:/I checked the source information/})).not.toBeChecked();
  await expect(page.getByRole('option',{name:/Fixture Site/})).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
});

test('unverified field readback retains file, blocks retry, and recovers without another job creation',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='readback-mismatch');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByRole('alert')).toContainText('complete saved ticket could not be verified');
  await expect(page.getByRole('button',{name:'Save imported ticket'})).toBeDisabled();
  expect((await writes(page)).map(row=>row.path)).toEqual(['/api/mhelpdesk/imports/stage','/api/mhelpdesk/imports/commit']);
  await page.evaluate(()=>window.__mode='success');
  await page.getByRole('button',{name:'Check this import’s saved result'}).click();
  await expect(page.getByRole('button',{name:'Schedule saved ticket'})).toBeVisible();
  expect((await writes(page)).filter(row=>row.path.endsWith('/commit'))).toHaveLength(1);
  await page.getByRole('button',{name:'Move verified copy to recoverable trash'}).click();
  await expect(page.getByText('The imported copy is in recoverable app trash.',{exact:true})).toBeVisible();
});

test('uncertain upload is recovered with the same attempt and never creates a duplicate staged copy',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='stage-timeout');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic upload timeout');
  await page.evaluate(()=>window.__mode='success');await page.getByRole('button',{name:'Check this import’s saved result'}).click();
  await expect(page.getByRole('button',{name:'Save imported ticket'})).toBeEnabled();
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByRole('button',{name:'Schedule saved ticket'})).toBeVisible();
  expect((await writes(page)).filter(row=>row.path.endsWith('/stage'))).toHaveLength(1);
});

test('server duplicate opens existing job and retains imported source without trash',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='duplicate');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByText(/already linked to a COS job/)).toBeVisible();
  await page.getByRole('button',{name:'Open existing job'}).click();
  expect(await page.evaluate(()=>window.__openedJob)).toBe(ids.job);
  expect((await writes(page)).some(row=>row.path.endsWith('/trash'))).toBe(false);
});

test('file dropped elsewhere on Dispatch Board enters one draft and cannot replace an open review',async({page})=>{
  await page.goto('/mhelp-flow-test');
  const bytes=Array.from(syntheticTicketPdf());
  const drop=async()=>{
    const transfer=await page.evaluateHandle(bytes=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'board-drop.pdf',{type:'application/pdf'}));return data;},bytes);
    await page.locator('body').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();
  };
  await drop();await expect(page.getByRole('heading',{name:'Review Work Order 009001'})).toBeVisible();
  await page.getByLabel('Title',{exact:true}).fill('Reviewed draft title');
  await drop();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Reviewed draft title');
  expect(await writes(page)).toEqual([]);
});

test('uncertain trash has a refresh lock and never creates another job',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='trash-timeout');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByText(/attachment trash move could not be confirmed/)).toBeVisible();
  await page.getByRole('button',{name:'Move verified copy to recoverable trash'}).click();
  await expect(page.getByRole('button',{name:'Move verified copy to recoverable trash'})).toBeDisabled();
  await page.evaluate(()=>window.__mode='success');
  await page.getByRole('button',{name:'Check this import’s saved result'}).click();
  await page.getByRole('button',{name:'Move verified copy to recoverable trash'}).click();
  await expect(page.getByText('The imported copy is in recoverable app trash.',{exact:true})).toBeVisible();
  expect((await writes(page)).filter(row=>row.path.endsWith('/commit'))).toHaveLength(1);
});

test('lost duplicate response recovers existing job and unlocks exit without retry or trash',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='duplicate-timeout');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByRole('button',{name:'Check this import’s saved result'})).toBeVisible();
  await page.evaluate(()=>window.__mode='success');
  await page.getByRole('button',{name:'Check this import’s saved result'}).click();
  await expect(page.getByText(/confirmed as a duplicate/)).toBeVisible();
  await page.getByRole('button',{name:'Open existing job'}).click();
  expect(await page.evaluate(()=>window.__openedJob)).toBe(ids.job);
  await expect(page.getByRole('button',{name:'Move verified copy to recoverable trash'})).toHaveCount(0);
  await page.getByRole('button',{name:'Import another ticket'}).click();
  await expect(page.getByRole('button',{name:'Choose ticket file'})).toBeVisible();
  expect((await writes(page)).map(row=>row.path)).toEqual(['/api/mhelpdesk/imports/stage','/api/mhelpdesk/imports/commit']);
});

test('uncertain save can be explicitly closed while retaining the source and never replaying',async({page})=>{
  await loadDraft(page);await reviewDraft(page);await page.evaluate(()=>window.__mode='readback-mismatch');
  await page.getByRole('button',{name:'Save imported ticket'}).click();
  await expect(page.getByRole('alert')).toContainText('complete saved ticket could not be verified');
  await page.getByRole('button',{name:'Close review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Choose ticket file'})).toBeVisible();
  expect((await writes(page)).map(row=>row.path)).toEqual(['/api/mhelpdesk/imports/stage','/api/mhelpdesk/imports/commit']);
  expect(await page.evaluate(()=>window.__attachment.state)).toBe('staged');
});
