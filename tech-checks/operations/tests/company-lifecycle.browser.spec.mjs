import { test, expect } from '@playwright/test';
import { auditDarkPresentation } from './dark-presentation-audit.mjs';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const operations = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = resolve(operations, 'src/WorkspaceOverview.tsx');
const fixtureJobs = [
  { id: 'synthetic-job-a', jobNumber: 'FIX-2042', customer: 'Fixture customer', site: 'East entrance', jobType: 'Delivery', status: 'Unscheduled', stage: 'IT Prep', visitType: 'IT_PREP', visitId: 'synthetic-visit-a', equipment: 'Sniper', equipmentUnitTag: 'FIX-07', quoteNumber: 'FIX-Q2042', scheduled: 'Not scheduled', technician: 'Unassigned', photos: [], techCheckHistory: [], billingReady: false, activity: ['Operational status: planning'] },
  { id: 'synthetic-job-b', jobNumber: 'FIX-2043', customer: 'Fixture second customer', site: 'West gate', jobType: 'Service', status: 'Owner Review', stage: 'Owner Review', equipmentUnitTag: 'FIX-08', quoteNumber: null, billingReady: false, notes: [] },
];
const compiled = buildSync({ stdin: { contents: `import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import WorkspaceOverview from ${JSON.stringify(entry)};function Fixture(){const[jobs,setJobs]=useState(${JSON.stringify(fixtureJobs)});const [route,setRoute]=useState({id:'',detail:false});const [target,setTarget]=useState('');useEffect(()=>{const pop=()=>setRoute(history.state?.route||{id:'',detail:false});addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop)},[]);const select=id=>{history.replaceState({route:{id,detail:false}},'',location.pathname);history.pushState({route:{id,detail:true}},'',location.pathname+'?job='+id);setRoute({id,detail:true})};return <div className='operations-shell company-shell'><main className='owner-it-main'><button onClick={()=>setJobs(jobs.filter(job=>job.id!==route.id))}>Simulate record removal</button><output aria-label='Selected action'>{target}</output><WorkspaceOverview jobs={jobs} openWorkspace={name=>setTarget('workspace:'+name)} openJob={(id,workspace='Jobs')=>setTarget(id+':'+workspace)} selectedJobId={route.id} detailOpen={route.detail} selectJob={select} backToJobs={()=>history.back()}/></main></div>}createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: 'tsx', resolveDir: operations }, bundle: true, write: false, outfile: '/tmp/company-lifecycle-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const script = compiled.outputFiles.find(file => file.path.endsWith('.js')).text;
// Mirror native import order; retired workspace.css must not supply missing layout rules.
const css = compiled.outputFiles.find(file => file.path.endsWith('.css')).text + ['continuation.css', 'index.css', 'shell.css', 'companyTheme.css'].map(file => readFileSync(resolve(operations, 'src', file), 'utf8')).join('\n');
async function mount(page) {
  // Every request is local synthetic markup or blocked. No production records or writes.
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:4173/company-lifecycle-fixture') ? route.fulfill({ contentType: 'text/html', body: `<html data-theme='dark'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}*{box-sizing:border-box}${css}</style><div id='root'></div><script>${script}</script></html>` }) : route.abort('blockedbyclient'));
  await page.goto('/company-lifecycle-fixture');
}

test('connected stages and tabs preserve truthful unknowns and exact selected job action', async ({ page }, info) => {
  await mount(page);
  await page.getByRole('button', { name: /Delivery · FIX-2042/ }).click();
  const details = page.getByRole('complementary', { name: 'Selected job details' });
  await expect(details.getByRole('heading', { name: 'East entrance', exact: true })).toBeFocused();
  await expect(details.getByRole('navigation', { name: 'Job lifecycle stages' }).getByRole('button')).toHaveCount(8);
  await expect(details.getByRole('tab')).toHaveCount(6);
  await expect(details.getByText('Quote record linked', { exact: true })).toBeVisible();
  await expect(details.getByText('Quote accepted', { exact: true })).toHaveCount(0);
  await details.getByRole('tab', { name: 'Documents', exact: true }).click();
  await expect(details.getByRole('tabpanel')).toContainText('FIX-Q2042');
  await expect(details.getByRole('tabpanel')).toContainText('Agreement and signed agreement unavailable');
  await details.getByRole('tab', { name: 'Parts', exact: true }).click();
  await expect(details.getByRole('tabpanel')).toContainText('Parts list not connected');
  await details.getByRole('tab', { name: 'Parts', exact: true }).press('ArrowRight');
  await expect(details.getByRole('tab', { name: 'Tech Check', exact: true })).toBeFocused();
  await expect(details.getByRole('tabpanel')).toContainText('Empty history or photo fields do not establish that evidence is missing');
  await details.getByRole('tab', { name: 'Stage details', exact: true }).click();
  await details.getByRole('button', { name: 'Schedule this job →', exact: true }).click();
  await expect(page.getByLabel('Selected action')).toHaveText('synthetic-job-a:Unscheduled');
  await details.getByRole('button', { name: 'Open job & actions →', exact: true }).click();
  await expect(page.getByLabel('Selected action')).toHaveText('synthetic-job-a:Jobs');
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(size.content).toBeLessThanOrEqual(size.width + 1);
  expect((await auditDarkPresentation(details)).failures).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('company-lifecycle-detail.png'), fullPage: true });
});

test('Back and Forward preserve identity and focus; selecting another job resets tabs', async ({ page }) => {
  await mount(page);
  const first = page.getByRole('button', { name: /Delivery · FIX-2042/ });
  await first.click();
  await page.getByRole('tab', { name: 'Parts', exact: true }).click();
  await page.getByRole('button', { name: '← Back to jobs', exact: true }).click();
  await expect(first).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'East entrance', exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: /Service · FIX-2043/ }).click();
  await expect(page.getByRole('heading', { name: 'West gate', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Stage details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Tech Check', exact: true }).click();
  await page.getByRole('button', { name: 'View this job in Owner Review →', exact: true }).click();
  await expect(page.getByLabel('Selected action')).toHaveText('synthetic-job-b:Owner Review');
});

test('a removed selected record never silently switches detail or action to another job', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: /Delivery · FIX-2042/ }).click();
  await page.getByRole('button', { name: 'Simulate record removal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selected job is unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open job & actions →', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Selected job details' })).not.toContainText('West gate');
  await page.getByRole('button', { name: '← Back to jobs', exact: true }).click();
  await expect(page.getByRole('button', { name: /Service · FIX-2043/ })).toBeVisible();
});


test('job rows fill the available list width without the retired workspace stylesheet', async ({ page }, info) => {
  await mount(page);
  for (const width of [320, 701, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    const layout = await page.locator('.workspace-job-list').evaluate(list => {
      const bounds = list.getBoundingClientRect();
      return { list: { left: bounds.left, right: bounds.right, width: bounds.width }, viewport: innerWidth, document: document.documentElement.scrollWidth, rows: [...list.querySelectorAll('.company-flow-row')].map(row => { const rect = row.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; }) };
    });
    expect(layout.rows).toHaveLength(2);
    expect(layout.document, `Document width at ${width}`).toBeLessThanOrEqual(width + 1);
    for (const row of layout.rows) {
      expect(Math.abs(row.left - layout.list.left), `Row left edge at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(row.right - layout.list.right), `Row right edge at ${width}`).toBeLessThanOrEqual(1);
      expect(Math.abs(row.width - layout.list.width), `Row width at ${width}`).toBeLessThanOrEqual(1);
    }
    if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`company-job-list-${width}.png`), fullPage: true });
  }
});
