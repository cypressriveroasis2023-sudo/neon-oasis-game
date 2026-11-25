import {expect} from '@playwright/test';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {field, vrm, fresh, now} from './fleet-dashboard-fixtures.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

// The owner's manager view, end to end: the real Tech Check host script around the real built app. Only the
// database client and the camera feed are stand-ins, and every name and number in them is made up.
const origin = 'http://127.0.0.1:4173';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json'};

export const unit = (name, extra = {}) => ({
  unit: name, placement: 'FIELD', site: 'Fixture yard', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh,
  cameraList: [{name: name + ' / Cam 1', status: 'online', atSite: true}], source: 'star4live', ...extra,
});
const feedUnits = [
  unit('HELIOS 001'),
  unit('SPOTTER 002', {state: 'RED', online: 0, offline: 1, site: 'Fixture depot', cameraList: [{name: 'SPOTTER 002 / Cam 1', status: 'offline', atSite: true}]}),
  unit('SPOTTER 003', {state: 'YELLOW', cameras: 2, offline: 1, cameraList: [{name: 'SPOTTER 003 / Cam 1', status: 'online', atSite: true}, {name: 'SPOTTER 003 / Cam 2', status: 'offline', atSite: true}]}),
  unit('SPOTTER 004', {state: 'UNKNOWN', online: 0, unknown: 1, observedAt: '2026-10-01T00:00:00Z', cameraList: [{name: 'SPOTTER 004 / Cam 1', status: 'offline', atSite: true}]}),
  unit('SNIPER 101', {placement: 'SHOP', site: null, source: 'ip_check'}),
];
export const reportOf = rows => ({
  contract: 'COS_STAR_UNIT_STATUS_V1', units: rows, counts: countUnits(rows),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: true, refreshedAt: fresh, source: 'Star4Live',
});
const report = reportOf(feedUnits);

export const AVERY = '00000000-0000-4000-8000-00000000a001', RILEY = '00000000-0000-4000-8000-00000000a002', TEST = '00000000-0000-4000-8000-00000000a003';
export const HANDOFF = '00000000-0000-4000-8000-00000000b001', OPEN_HANDOFF = '00000000-0000-4000-8000-00000000b002';
const kit = (tags, sims, stock) => ({
  units: ['Sniper', 'Ranger', 'Spotter', 'Solar Spotter'].map((equipment_type, index) => ({equipment_type, unit_tag: tags[index]?.[0] ?? null, status: tags[index]?.[1] || (tags[index] ? 'assigned' : 'unassigned'), last_used_ticket_no: tags[index]?.[2] ?? null})),
  sims: [1, 2, 3].map((slot_no, index) => ({slot_no, sim_number: sims[index] ?? null, status: sims[index] ? 'assigned' : 'unassigned'})),
  stock: {recon_battery_qty: stock[0], agm_12v_110ah_qty: stock[1], litime_12v_100ah_qty: stock[2], battery_12v_35ah_qty: stock[3]},
});
const signedAt = '2026-10-06T14:37:00Z';
export const manager = () => ({
  board: {
    date: '2026-10-06', summary: {service_techs: 3, it_techs: 1},
    service_techs: [
      {user_id: AVERY, name: 'Avery Fixture', truck_ready: true,
        inspection: {submitted: true, submitted_at: signedAt, truck_complete: true, taking_trailer: false, trailer_complete: true, trailer_state: 'not_taking'},
        inventory_check: {submitted: true, submitted_at: '2026-10-06T14:45:00Z', ready: true, stock_complete: true, verification_required: false},
        ...kit([['101'], ['007'], ['002'], ['013']], ['10001', '10002', '10003'], [25, 4, 2, 4]), restock_requests: [], jobs: [], missing: []},
      {user_id: RILEY, name: 'Riley Fixture', truck_ready: false,
        inspection: {submitted: false, submitted_at: null, truck_complete: false, taking_trailer: false, trailer_complete: false, trailer_state: 'not_complete'},
        inventory_check: {submitted: false, submitted_at: null, ready: false, stock_complete: false, verification_required: false},
        ...kit([['102'], null, ['055', 'used_restock_due', '7001'], ['014']], ['20001', '20002', null], [25, 3, 2, 4]),
        restock_requests: [{item_type: 'Spotter', status: 'requested'}], jobs: [], missing: []},
      {user_id: TEST, name: 'Test Service', truck_ready: false,
        inspection: {submitted: false, submitted_at: null, truck_complete: false, taking_trailer: false, trailer_complete: false, trailer_state: 'not_complete'},
        inventory_check: {submitted: false, submitted_at: null, ready: false, stock_complete: true, verification_required: true},
        ...kit([['901'], ['902'], ['903'], ['904']], ['90001', '90002', '90003'], [25, 4, 2, 4]), restock_requests: [], jobs: [], missing: []},
    ],
    it_techs: [{user_id: '00000000-0000-4000-8000-00000000c001', name: 'Jordan Fixture', jobs: []}],
  },
  context: {version: 1, role: 'it', equipment: [], technicians: [], transfers: [
    {id: OPEN_HANDOFF, it_name: 'Jordan Fixture', service_name: 'Riley Fixture', state: 'awaiting_service', purpose: 'installation', revision: 1,
      created_at: '2026-10-06T15:00:00Z', updated_at: '2026-10-06T15:00:00Z', manifest: [{family: 'Ranger', unit_tag: '031', equipment_key: 'ranger:031'}],
      events: [{id: '00000000-0000-4000-8000-00000000d003', kind: 'checkout', actor_name: 'Jordan Fixture', signed_at: '2026-10-06T15:00:00Z', snapshot: {differences: []},
        photos: [{kind: 'unit', path: 'fixture-it/handoff-2/unit-photo-0001.jpg', equipment_key: 'ranger:031'}, {kind: 'signature', path: 'fixture-it/handoff-2/signature-0001.jpg', equipment_key: ''}]}]},
    {id: HANDOFF, it_name: 'Jordan Fixture', service_name: 'Avery Fixture', state: 'accepted', purpose: 'truck_replenishment', revision: 2,
      created_at: '2026-10-05T16:00:00Z', updated_at: '2026-10-05T18:00:00Z', manifest: [{family: 'Sniper', unit_tag: '101', equipment_key: 'sniper:101'}],
      events: [
        {id: '00000000-0000-4000-8000-00000000d001', kind: 'checkout', actor_name: 'Jordan Fixture', signed_at: '2026-10-05T16:00:00Z', snapshot: {differences: []},
          photos: [{kind: 'unit', path: 'fixture-it/handoff-1/unit-photo-0001.jpg', equipment_key: 'sniper:101'}, {kind: 'signature', path: 'fixture-it/handoff-1/signature-0001.jpg', equipment_key: ''}]},
        {id: '00000000-0000-4000-8000-00000000d002', kind: 'receipt', actor_name: 'Avery Fixture', signed_at: '2026-10-05T18:00:00Z', snapshot: {differences: [{field: 'battery_count'}]},
          report_url: 'https://drive.google.com/file/d/fixtureReport0001/view',
          photos: [{kind: 'signature', path: 'fixture-service/handoff-1/signature-0002.jpg', equipment_key: ''}, {kind: 'unit', path: '../outside/of-the-bucket.jpg', equipment_key: ''}]},
      ]},
  ]},
});

const hostPage = fixture => readFileSync(resolve(repo, 'tech-checks/index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace('</body>', `<script>
    window.fixture=Object.assign({role:'owner',subject:'fixture-person',routes:[],views:[],rpc:[],photos:[],refreshed:0,saveError:null},${JSON.stringify(fixture).replaceAll('<', '\\u003c')});
    document.getElementById('sessionLoading').remove();
    document.getElementById('appView').classList.remove('hidden');
    const column={'Recon Battery':'recon_battery_qty','AGM 12V 110Ah':'agm_12v_110ah_qty','LiTime 12V 100Ah':'litime_12v_100ah_qty','12V 35Ah':'battery_12v_35ah_qty'};
    const rpc=async(name,args)=>{
      fixture.rpc.push(JSON.parse(JSON.stringify({name,args:args??null})));
      if(!fixture.manager)return{data:null,error:{message:'Owner/Admin access required.'}};
      if(name==='owner_tech_command_board_v2')return{data:JSON.parse(JSON.stringify(fixture.manager.board)),error:null};
      if(name==='techcheck_transfer_context_v1')return fixture.manager.context?{data:JSON.parse(JSON.stringify(fixture.manager.context)),error:null}:{data:null,error:{message:'Named handoffs are held for release review.'}};
      if(name==='techcheck_handoff_gaps_v1')return fixture.manager.gaps?{data:JSON.parse(JSON.stringify(fixture.manager.gaps)),error:null}:{data:null,error:{message:'held'}};
      if(name==='owner_save_service_truck_inventory_batch_v1'){
        if(fixture.saveError)return{data:null,error:{message:fixture.saveError}};
        // The stand-in keeps the same rule as the database: every unit slot is cleared first, a blank SIM is left alone.
        const tech=fixture.manager.board.service_techs.find(row=>row.user_id===args.p_service_tech_id);
        for(const item of tech.units){const tag=args.p_payload.units[item.equipment_type];item.unit_tag=tag||null;item.status=tag?'assigned':'unassigned';item.last_used_ticket_no=null;}
        for(const sim of tech.sims){const number=args.p_payload.sims[String(sim.slot_no)];if(number){sim.sim_number=number;sim.status='assigned';}}
        for(const [key,name] of Object.entries(column))tech.stock[name]=args.p_payload.stock[key];
        tech.inventory_check.ready=false;tech.truck_ready=false;
        return{data:{ok:true},error:null};
      }
      return{data:null,error:{message:'Not part of this stand-in.'}};
    };
    const db={auth:{onAuthStateChange:listener=>{fixture.auth=listener;return{}},getSession:async()=>({data:{session:fixture.subject?{user:{id:fixture.subject},access_token:'synthetic-only'}:null}})}};
    if(fixture.client!==false){db.rpc=rpc;db.storage={from:bucket=>({createSignedUrl:async(path,seconds)=>{fixture.photos.push({bucket,path,seconds});return{data:{signedUrl:'https://photos.fixture.test/'+path},error:null}}})};}
    window.TechCheckContext={getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getSession:()=>fixture.subject?{user:{id:fixture.subject}}:null,db};
    for(const [view,label] of [['it','IT'],['svc','Service']])document.getElementById('view-'+view).innerHTML='<section class="card"><h1>'+label+' checklist</h1></section>';
    window.show=view=>{fixture.views.push(view);for(const name of ['owner','it','svc'])document.getElementById('view-'+name).classList.toggle('hidden',name!==view);dispatchEvent(new CustomEvent('techcheck:view-changed',{detail:{view}}))};
    window.ownerAppNavigate=route=>{fixture.routes.push(route);document.getElementById('view-owner').dataset.ownerRoute=route;document.getElementById('ownerRouteView').innerHTML='<section class="card"><h1>'+route+' check tool</h1></section>';};
    window.refreshData=()=>{fixture.refreshed++;dispatchEvent(new CustomEvent('techcheck:data-refreshed'))};
    window.logout=()=>{};
    show('owner');
  </script><script type="module" src="./operations-host.js"></script></body>`);

export async function mount(page, fixture = {manager: manager()}, feed = report) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  const html = hostPage(fixture);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === '/tech-checks/') return route.fulfill({contentType: 'text/html', body: html});
      const file = resolve(repo, '.' + decodeURIComponent(url.pathname));
      if (file.startsWith(repo + '/') && existsSync(file)) return route.fulfill({path: file, contentType: types[extname(file)] || 'application/octet-stream'});
      return route.abort('blockedbyclient');
    }
    if (url.origin === 'https://photos.fixture.test') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9cc4ff"/></svg>'});
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (url.pathname.endsWith('/functions/v1/cos-unit-camera-status')) return route.request().method() === 'OPTIONS' ? route.fulfill({status: 204, headers}) : route.fulfill({headers, json: feed});
    if (url.href !== edge) return route.abort('blockedbyclient');
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const request = route.request().postDataJSON();
    const data = request.path === '/api/session' ? {authorized: true, name: 'Fixture Owner', role: 'Owner', legacyOwner: true, features: {fleetAccess: false, vrmRead: true, unitTracker: true}}
      : request.path === '/api/field-map' ? field : request.path === '/api/vrm-fleet' ? vrm
      : request.path === '/api/routers' ? {items: [], source: 'camera_health', gpsAvailable: false, generatedAt: fresh} : {items: []};
    return route.fulfill({headers, json: data});
  });
  await page.goto('/tech-checks/');
  const frame = page.frameLocator('#cosOperationsFrame');
  const host = frame.locator('.cos-board-host');
  await expect(host).toBeVisible();
  return {frame, host, errors};
}
// The board draws inside a closed shadow root. Tests read it through the host's own handle.
export const inBoard = (host, fn, value) => host.evaluate((element, [source, input]) => (0, eval)('(' + source + ')')(element.cosBoardRoot, input), [fn.toString(), value]);
export const seen = (host, id) => inBoard(host, (root, key) => { const node = root.getElementById(key); return Boolean(node) && !node.hidden && node.getClientRects().length > 0; }, id);
export const textOf = (host, id) => inBoard(host, (root, key) => root.getElementById(key)?.textContent ?? null, id);
export const press = async (host, scope, label) => expect(await inBoard(host, (root, [inside, wanted]) => {
  const button = [...root.querySelectorAll(inside + ' button, ' + inside + ' a')].find(item => item.textContent.trim() === wanted && !item.disabled);
  button?.click(); return Boolean(button);
}, [scope, label])).toBe(true);
export const fill = (host, label, value) => inBoard(host, (root, [wanted, text]) => {
  const field = [...root.querySelectorAll('#mgEdit .mgfield')].find(item => item.querySelector('span').textContent === wanted);
  const input = field.querySelector('input'); input.value = text; input.dispatchEvent(new Event('input', {bubbles: true}));
}, [label, value]);
export const rpcCalls = (page, name) => page.evaluate(wanted => window.fixture.rpc.filter(call => call.name === wanted), name);
export const openManager = async (frame, host) => {
  await expect.poll(() => seen(host, 'tabManager')).toBe(true);
  await inBoard(host, root => root.getElementById('tabManager').click());
  await expect.poll(() => seen(host, 'viewManager')).toBe(true);
  await expect.poll(() => textOf(host, 'mgTrucks')).toContain('Avery Fixture');
};

