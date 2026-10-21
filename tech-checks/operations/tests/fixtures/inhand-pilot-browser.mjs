import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pilotControl, pilotSnapshot } from './inhand-pilot.mjs';
import { routerFixture } from './routers.mjs';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const compiled = buildSync({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import RouterWorkspace from ${JSON.stringify(resolve(root, 'src/RouterWorkspace.tsx'))};function Fixture(){const[show,setShow]=useState(true);return <div className='operations-shell company-shell'><main style={{padding:16,minWidth:0,width:'100%'}}><button onClick={()=>{window.dispatchEvent(new Event('cos-workspace-navigation'));setShow(!show)}}>{show?'Leave router workspace':'Return to router workspace'}</button>{show?<RouterWorkspace openMap={()=>setShow(false)}/>:<p>Other workspace</p>}</main></div>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, outfile: '/tmp/inhand-pilot-browser.js', format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const script = compiled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = compiled.outputFiles.find(file => file.path.endsWith('.css')).text + ['index.css', 'shell.css', 'companyTheme.css'].map(file => readFileSync(resolve(root, 'src', file), 'utf8')).join('\n');
export async function mountInhandPilot(page, options = {}) {
  const state = { requests: [], control: pilotControl(), result: pilotSnapshot(), statusError: 0, runError: 0, statusHold: null, runHold: null, statusDelay: 0, abortRun: false, ...options };
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/inhand-pilot-fixture') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'><style>html,body{margin:0;background:#0b111c}iframe{border:0;display:block;width:100%;height:100dvh}</style><iframe id='pilot' title='Synthetic Owner Operations' src='/inhand-pilot-inner'></iframe><script>window.fixtureRole='owner';addEventListener('message',event=>{const f=document.getElementById('pilot');if(event.origin!==location.origin||event.source!==f?.contentWindow||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:window.fixtureRole,accessToken:window.fixtureRole==='owner'?'synthetic-owner-session':null},location.origin)})</script></html>` });
    if (url === origin + '/inhand-pilot-inner') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme='dark'><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}*{box-sizing:border-box}${css}</style><div id='root'></div><script>${script}</script></html>` });
    if (url !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON(); state.requests.push(request);
    let body, status = 200;
    if (request.path === '/api/routers' && request.method === 'GET') body = routerFixture();
    else if (request.path === '/api/inhand-pilot/status' && request.method === 'GET') {
      if (state.statusHold) await state.statusHold;
      if (state.statusDelay) await new Promise(resolve => setTimeout(resolve, state.statusDelay));
      body = state.control; status = state.statusError || 200;
    } else if (request.path === '/api/inhand-pilot/run' && request.method === 'POST') {
      if (state.runHold) await state.runHold;
      if (state.abortRun) return route.abort('failed');
      body = state.result; status = state.runError || 200;
    } else throw new Error('Unexpected pilot fixture request: ' + JSON.stringify(request));
    return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(status === 200 ? body : { error: 'DO_NOT_DISPLAY_PROVIDER_OR_AUTH_DETAILS' }) });
  });
  await page.goto('/inhand-pilot-fixture');
  return { state, frame: page.frameLocator('#pilot') };
}
export const pilotRequests = state => state.requests.filter(request => request.path.startsWith('/api/inhand-pilot/'));
export const runRequests = state => pilotRequests(state).filter(request => request.method === 'POST');
export const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
