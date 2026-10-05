import { test, expect } from '@playwright/test';

// Synthetic identity collisions only. Every non-local request is intercepted or blocked.
const origin = 'http://127.0.0.1:4173';
const endpoint = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe id="operations" src="/?theme=classic#team" title="Synthetic team workspace"></iframe><script>addEventListener('message',event=>{const frame=document.getElementById('operations');if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,accessToken:'synthetic-team-token',role:'owner'},location.origin);});</script></body></html>`;

test('Team details and readiness follow authoritative technician UUIDs and active-job counts', async ({ page }) => {
  const writes = [];
  const jobs = [
    { id:'33333333-3333-4333-8333-333333333333', jobNumber:'SYN-OWN', technicianUserId:firstId, technician:'Previous display name', status:'Assigned', site:'Own active site', techCheck:{complete:false,step:1} },
    { id:'44444444-4444-4444-8444-444444444444', jobNumber:'SYN-OTHER', technicianUserId:secondId, technician:'Same Name', status:'Assigned', site:'Other technician site', techCheck:{complete:false,step:2} },
    { id:'55555555-5555-4555-8555-555555555555', jobNumber:'SYN-NO-ID', technician:'Same Name', status:'Assigned', site:'Unverified identity site' },
    ...['closed','cancelled','canceled','complete','completed'].map((status,index)=>({id:`66666666-6666-4666-8666-${String(index).padStart(12,'0')}`,jobNumber:'SYN-TERMINAL-'+index,technicianUserId:firstId,technician:'Same Name',status,site:'Terminal site',techCheck:{complete:false,step:1}})),
  ];
  await page.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === origin + '/team-fixture') return route.fulfill({contentType:'text/html',body:harness});
    if (url.startsWith(origin + '/')) return route.continue();
    if (url !== endpoint) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers});
    const envelope = request.postDataJSON();
    if (envelope.method !== 'GET') {
      writes.push(envelope);
      return route.fulfill({status:405,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic Team is read-only'})});
    }
    let data;
    if (envelope.path === '/api/routers') data = { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() };
    else if (envelope.path === '/api/session') data = {authorized:true,name:'Fixture Owner',role:'Owner'};
    else if (envelope.path === '/api/team-production') data = {items:[
      {userId:firstId,displayName:'Same Name',department:'service',active:true,linked:true},
      {userId:secondId,displayName:'Other Person',department:'it',active:true,linked:true},
    ]};
    else if (envelope.path === '/api/jobs') data = {items:jobs};
    else if (envelope.path === '/api/daily-board') data = {jobs,tasks:[],readiness:[],asOf:'2026-10-05T12:00:00.000Z'};
    else throw new Error('Unexpected synthetic Team read: '+envelope.path);
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/team-fixture');
  const frame = page.frameLocator('#operations');
  const workspace = frame.getByRole('region',{name:'Team Workspace',exact:true});
  const first = workspace.locator('.record.op-record').filter({has:frame.getByText('Same Name',{exact:true})});
  const second = workspace.locator('.record.op-record').filter({has:frame.getByText('Other Person',{exact:true})});
  await expect(first).toContainText('SERVICE Technician · 1 active assigned jobs');
  await expect(first).toContainText('Dispatch blockers: 1');
  await expect(first).toContainText('Tech Checks in progress: 1');
  await expect(first).toContainText('SYN-OWN');
  await expect(first).not.toContainText('SYN-OTHER');
  await expect(first).not.toContainText('SYN-NO-ID');
  await expect(first).not.toContainText('SYN-TERMINAL');
  await expect(second).toContainText('IT Technician · 1 active assigned jobs');
  await expect(second).toContainText('SYN-OTHER');
  await expect(second).not.toContainText('SYN-OWN');
  expect(writes).toHaveLength(0);
});
