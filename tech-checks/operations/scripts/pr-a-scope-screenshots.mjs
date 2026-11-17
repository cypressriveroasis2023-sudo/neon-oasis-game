// Fixture screenshots for the pages-only COS scope change.
// Usage: node scripts/pr-a-scope-screenshots.mjs before|after
import {mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('usage: node scripts/pr-a-scope-screenshots.mjs before|after');
  process.exit(1);
}
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const outDir = `/opt/cursor/artifacts/pr-a-pages/${phase}`;
mkdirSync(outDir, {recursive: true});
const stamp = '2026-11-17T18:00:00.000Z';
const unitId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const visitId = '22222222-2222-4222-8222-222222222222';
const techId = '55555555-5555-4555-8555-555555555555';
const camera = {
  totalDevices: 2, online: 1, offline: 0, review: 1, shopRoot: 0, healthRows: 2, fieldDevices: 2,
  refreshedAt: stamp,
  rows: [
    {id: '1', name: 'Fixture camera 1', unit: 'Helios 1', status: 'online'},
    {id: '2', name: 'Fixture camera 2', unit: 'Helios 2', status: 'review'},
  ],
};
const fieldMap = {
  items: [{id: unitId, unitNumber: 'Helios 1', status: 'field', modelName: 'Helios'}],
  summary: {fieldUnits: 1, mappedUnits: 0, unitGps: 0, missingGps: 1},
  generatedAt: stamp,
  placementReviews: [],
};
const routers = {
  items: [{id: 'r1', unitKey: 'Helios 1', name: 'Fixture router', model: 'IR302', publicIp: null, unitIp: null, port: null, protocol: null, probeStatus: 'unknown', checkedAt: null, lastRecoveredAt: null, reportedStatus: 'Unknown', reportedAt: null, reportedSource: 'Fixture', savedLatencyMs: null, match: 'unmatched', candidateUnit: null, gps: null}],
  generatedAt: stamp, source: 'camera_health', gpsAvailable: false,
};
const dailyBoard = {
  jobs: [{id: jobId, jobNumber: 'FIX-101', customer: 'North Yard', site: 'Gate', status: 'Scheduled', technician: 'Casey Service', department: 'service', scheduled: '2026-11-17 09:00', scheduledEnd: '2026-11-17 11:00', jobType: 'Service', visitId}],
  tasks: [],
  readiness: [{userId: techId, name: 'Casey Service', department: 'service', status: 'completed', checkId: '66666666-6666-4666-8666-666666666666', completedAt: stamp, result: {truck_1: true, truck_2: true, truck_3: true, truck_4: true, truck_5: true, truck_6: true, truck_7: true, truck_8: true, taking_trailer: false, truck_12v_110ah_qty: 4, truck_litime_12v_100ah_qty: 2, truck_12v_110ah_charged: true, truck_litime_12v_100ah_charged: true, backup_unit_type: 'Spotter'}}],
  asOf: new Date().toISOString(),
};
const ownerSession = {authorized: true, legacyOwner: true, role: 'Owner', name: 'Fixture Owner', features: {durableFleetBoard: false, fleetAccess: true, vrmRead: false, legacyInstallEvidence: true, unitTracker: false, mhelpTicketImport: false}};
const itSession = {authorized: true, legacyOwner: false, role: 'IT', name: 'Fixture IT', features: {durableFleetBoard: false, fleetAccess: true, vrmRead: false, unitTracker: false}};
const techSession = {authorized: true, legacyTechnician: true, department: 'service', name: 'Fixture Service', productionTechnicianUserId: techId, role: 'Service'};
const assignments = {profile: {display_name: 'Fixture Service', department: 'service'}, visits: [{visit_id: visitId, job_number: 'FIX-201', customer_name: 'North Yard', site_name: 'Gate', visit_type: 'service', dispatch_status: 'dispatched', scheduled_start: stamp}]};

function payload(path, role) {
  if (path === '/api/session') return role === 'it' ? itSession : ownerSession;
  if (path === '/api/tech/session') return techSession;
  if (path === '/api/tech/assignments') return assignments;
  if (path === '/api/tech/tasks') return {items: []};
  if (path === '/api/camera-health/summary-v3') return camera;
  if (path === '/api/field-map') return fieldMap;
  if (path === '/api/routers') return routers;
  if (path === '/api/daily-board') return dailyBoard;
  if (path === '/api/team-production') return {items: [{userId: techId, displayName: 'Casey Service', department: 'service', active: true}]};
  if (path === '/api/jobs') return {items: dailyBoard.jobs};
  if (path === '/api/quotes') return {items: [{id: '77777777-7777-4777-8777-777777777777', quoteNumber: 'FIX-Q1', status: 'Pending Owner Approval'}]};
  if (path === '/api/ar') return {items: []};
  if (path === '/api/purchasing') return {items: []};
  if (path === '/api/owner-tasks') return {items: []};
  if (path === '/api/equipment') return {items: [], models: []};
  if (path === '/api/vrm-portal' || path === '/api/vrm-fleet') return {items: []};
  if (path === '/api/product-connections') return {items: []};
  return {items: []};
}

const roles = [
  {key: 'owner', tokenRole: 'owner', query: '', service: false},
  {key: 'it', tokenRole: 'it', query: '?mode=fleet', service: false},
  {key: 'service', tokenRole: 'service', query: '?mode=production-assignments', service: true},
];
const screens = [
  {key: 'today', hash: '#today', ready: /Company overview|assignments|Fleet Dashboard|OPERATIONS CONNECTED/},
  {key: 'daily-board', hash: '#daily-board', ready: /Daily Board|assignments|Fleet Dashboard/},
  {key: 'more', hash: '#today', menu: true, ready: /More|Menu|assignments|Find a tool|Your workspace/},
  {key: 'camera-health', hash: '#camera-health', ready: /Camera Health|assignments|Fleet Dashboard|camera/i},
];
const viewports = [
  {key: 'phone', width: 390, height: 844},
  {key: 'desktop', width: 1440, height: 900},
];

const browser = await chromium.launch();
const seen = new Set();
for (const viewport of viewports) {
  const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, deviceScaleFactor: 1});
  const page = await context.newPage();
  await page.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (!url.startsWith(edge)) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'};
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    let envelope = {};
    try { envelope = request.postDataJSON() || {}; } catch { envelope = {}; }
    const path = String(envelope.path || '');
    seen.add(path);
    const role = request.headers()['authorization']?.includes('service') ? 'service' : request.headers()['authorization']?.includes('it') ? 'it' : 'owner';
    return route.fulfill({status: 200, headers, contentType: 'application/json', body: JSON.stringify(payload(path, role))});
  });
  for (const role of roles) {
    for (const screen of screens) {
      const src = `/${role.query ? role.query + '&' : '?'}shot=${role.key}-${screen.key}${screen.hash}`;
      const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#0b111c}iframe{border:0;width:100vw;height:100vh}</style></head><body><iframe id="operations" src="${src}" title="COS"></iframe><script>addEventListener('message',function(event){var frame=document.getElementById('operations');if(event.origin!==location.origin||event.source!==frame.contentWindow||!event.data||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,accessToken:'synthetic-${role.tokenRole}-session',role:'${role.tokenRole}'},location.origin);});</script></body></html>`;
      await page.route(origin + '/shot-harness', route => route.fulfill({status: 200, contentType: 'text/html', body: harness}));
      await page.goto(origin + '/shot-harness', {waitUntil: 'domcontentloaded'});
      const frame = page.frameLocator('#operations');
      await frame.locator('body').waitFor({state: 'visible', timeout: 15000});
      await page.waitForTimeout(1200);
      if (!role.service && screen.key === 'today') {
        const overview = frame.getByRole('heading', {name: 'Company overview', exact: true});
        if (await overview.count()) await overview.scrollIntoViewIfNeeded();
      }
      if (!role.service && screen.key === 'daily-board') {
        const board = frame.getByRole('heading', {name: 'Daily Board', exact: true});
        if (await board.count()) await board.scrollIntoViewIfNeeded();
      }
      if (!role.service && screen.menu) {
        const more = frame.getByRole('button', {name: /^(More|Menu)$/}).first();
        if (await more.count()) await more.click();
        await page.waitForTimeout(400);
      }
      if (!role.service && screen.key === 'camera-health') {
        const button = frame.getByRole('button', {name: 'Camera Health', exact: true}).first();
        if (await button.count()) { await button.click().catch(() => {}); await page.waitForTimeout(800); }
      }
      const file = `${outDir}/${role.key}-${screen.key}-${viewport.key}.png`;
      const fullPage = !role.service && (screen.key === 'today' || screen.key === 'daily-board');
      await page.screenshot({path: file, fullPage});
      console.log(file);
    }
  }
  await context.close();
}
await browser.close();
console.log('paths', [...seen].sort().join('\n'));
