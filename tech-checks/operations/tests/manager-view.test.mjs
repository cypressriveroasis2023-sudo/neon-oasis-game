import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {parseManagerSnapshot} from '../src/managerBridge.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const hostSource = read('../../operations-host.js');
const app = read('../src/cosBoard/boardApp.ts');
const TECH = '00000000-0000-4000-8000-00000000a001';
const kitOf = (overrides = {}) => ({
  units: {Sniper: '101', Ranger: '', Spotter: '055', 'Solar Spotter': '014'}, sims: {1: '', 2: '', 3: '20003'},
  stock: {'Recon Battery': 25, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4}, ...overrides,
});

// The manager part of the host script, run by itself against a stand-in database client.
function host({role = 'owner', effectiveRole = role, hidden = false, client = true, rpc} = {}) {
  const start = hostSource.indexOf('// ---- Manager view'), end = hostSource.indexOf("window.addEventListener('message', async event => {");
  assert.ok(start > 0 && end > start);
  const calls = [], signed = [], state = {role, effectiveRole, hidden, refreshed: 0};
  const db = client ? {
    rpc: async (name, args) => { calls.push({name, args}); return rpc ? rpc(name, args) : {data: null, error: {message: 'none'}}; },
    storage: {from: bucket => ({createSignedUrl: async (path, seconds) => { signed.push({bucket, path, seconds}); return {data: {signedUrl: 'https://store.example/' + path}, error: null}; }})},
  } : {};
  const sandbox = {
    owner: () => state.role === 'owner' ? 'owner-user' : null,
    context: () => ({getEffectiveRole: () => state.effectiveRole, db}),
    document: {getElementById: () => ({classList: {contains: () => state.hidden}})},
    window: {refreshData: () => { state.refreshed += 1; }},
    Intl, Date, Promise, Set, Object, Number, String, Array, Math,
  };
  vm.runInNewContext(hostSource.slice(start, end) + '\nthis.manager={managerAnswer,managerReady,managerKit,managerTech,managerExchange};', sandbox);
  const plain = value => JSON.parse(JSON.stringify(value));
  return {...sandbox.manager, answer: async data => plain(await sandbox.manager.managerAnswer(data)), calls, signed, state, plain};
}
const boardRow = (extra = {}) => ({
  user_id: TECH, name: 'Riley Fixture', truck_ready: false,
  inspection: {submitted: true, submitted_at: '2026-10-06T14:37:00Z', truck_complete: true, trailer_complete: true, trailer_state: 'complete'},
  inventory_check: {ready: false, stock_complete: true, verification_required: true, submitted_at: null},
  units: [{equipment_type: 'Sniper', unit_tag: '102', status: 'assigned'}, {equipment_type: 'Spotter', unit_tag: '055', status: 'used_restock_due', last_used_ticket_no: '7001'}, {equipment_type: 'Ranger', unit_tag: null, status: 'unassigned'}],
  sims: [{slot_no: 2, sim_number: '20002', status: 'assigned'}],
  stock: {recon_battery_qty: 25, agm_12v_110ah_qty: 3, litime_12v_100ah_qty: '2', battery_12v_35ah_qty: -4},
  restock_requests: [{item_type: 'Spotter', status: 'in_progress'}], ...extra,
});

test('the host hands the manager view only what it draws, in a fixed shape', async () => {
  const transfers = [{id: '00000000-0000-4000-8000-00000000B001', it_name: 'Jordan Fixture', service_name: 'Riley Fixture', state: 'accepted', purpose: 'truck_replenishment',
    updated_at: '2026-10-05T18:00:00Z', manifest: [{family: 'Sniper', unit_tag: '101', equipment_key: 'sniper:101', sims: ['secret-sim']}], it_actor: 'private-id',
    events: [{id: 'e1', kind: 'receipt', actor_name: 'Riley Fixture', signed_at: '2026-10-05T18:00:00Z', request: {signature: {path: 'never-sent'}},
      snapshot: {differences: [{}, {}], signature: {name: 'Riley Fixture'}}, report_url: 'https://evil.example/file/d/abcdefghijkl/view',
      photos: [{kind: 'signature', path: 'fixture-service/handoff-1/signature-0002.jpg'}, {kind: 'unit', path: '../outside/of-the-bucket.jpg'}, {kind: 'unit', path: 'has space/in it.jpg'}]}]}];
  const {answer, calls} = host({rpc: name => name === 'owner_tech_command_board_v2'
    ? {data: {service_techs: [boardRow(), {name: 'No id is dropped'}, boardRow({user_id: '00000000-0000-4000-8000-00000000a009', name: 'Test Service'})], it_techs: [{name: 'Jordan Fixture'}, {name: 'Test IT'}]}, error: null}
    : {data: {transfers}, error: null}});
  const {snapshot} = await answer({kind: 'read'});
  assert.deepEqual(calls.map(call => call.name), ['owner_tech_command_board_v2', 'techcheck_transfer_context_v1', 'techcheck_handoff_gaps_v1', 'sim_drawer_v1']);
  assert.deepEqual(snapshot.gaps, {enforced: true, noHandoff: [], loaded: [], late: []});
  assert.match(calls[0].args.p_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(snapshot.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(snapshot.techs.length, 2);
  assert.deepEqual(snapshot.techs[0], {
    id: TECH, name: 'Riley Fixture', test: false, ready: false,
    inspection: {done: true, at: '2026-10-06T14:37:00.000Z', truck: true, trailer: 'done'},
    stockCheck: {state: 'verify', at: null},
    units: [{type: 'Sniper', tag: '102', status: 'assigned', ticket: ''}, {type: 'Ranger', tag: '', status: 'missing', ticket: ''},
      {type: 'Spotter', tag: '055', status: 'used', ticket: '7001'}, {type: 'Solar Spotter', tag: '', status: 'missing', ticket: ''}],
    sims: [{slot: 1, number: '', status: 'missing', ticket: ''}, {slot: 2, number: '20002', status: 'assigned', ticket: ''}, {slot: 3, number: '', status: 'missing', ticket: ''}],
    stock: [{key: 'Recon Battery', label: 'Recon batteries', have: 25, need: 25}, {key: 'AGM 12V 110Ah', label: 'AGM 12V 110Ah', have: 3, need: 4},
      {key: 'LiTime 12V 100Ah', label: 'LiTime 12V 100Ah', have: 2, need: 2}, {key: '12V 35Ah', label: '12V 35Ah', have: 0, need: 4}],
    restock: [{item: 'Spotter', status: 'in progress'}],
  });
  assert.equal(snapshot.techs[1].test, true);
  assert.deepEqual(snapshot.it, [{name: 'Jordan Fixture', test: false}, {name: 'Test IT', test: true}]);
  // A handoff: names, state and the evidence file names. No signature contents, no account ids, no report link from anywhere but the report store.
  assert.deepEqual(snapshot.exchanges, [{
    id: '00000000-0000-4000-8000-00000000b001', items: ['Sniper 101'], purpose: 'Truck replenishment', from: 'Jordan Fixture', to: 'Riley Fixture', state: 'accepted', at: '2026-10-05T18:00:00.000Z',
    events: [{kind: 'receipt', who: 'Riley Fixture', at: '2026-10-05T18:00:00.000Z', differences: 2, report: null, photos: [{path: 'fixture-service/handoff-1/signature-0002.jpg', kind: 'signature'}]}],
  }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-sim|private-id|never-sent|evil\.example|of-the-bucket/);
});

test('the trucks still come back when the handoff log cannot be read, and nothing comes back when the trucks cannot', async () => {
  const some = host({rpc: name => name === 'owner_tech_command_board_v2' ? {data: {service_techs: [boardRow()]}, error: null} : {data: null, error: {message: 'held'}}});
  const {snapshot} = await some.answer({kind: 'read'});
  assert.equal(snapshot.exchanges, null);
  assert.equal(snapshot.techs.length, 1);
  const none = host({rpc: () => ({data: null, error: {message: 'Owner/Admin access required.'}})});
  await assert.rejects(none.managerAnswer({kind: 'read'}), /unavailable/);
});

test('a photo link is made only for a file the last read listed, from the handoff evidence store, for five minutes', async () => {
  const transfers = [{id: '00000000-0000-4000-8000-00000000b001', manifest: [], events: [{kind: 'checkout', photos: [{kind: 'unit', path: 'fixture-it/handoff-1/unit-photo-0001.jpg'}]}]}];
  const {answer, signed} = host({rpc: name => name === 'owner_tech_command_board_v2' ? {data: {service_techs: []}, error: null} : {data: {transfers}, error: null}});
  assert.deepEqual(await answer({kind: 'photo', path: 'fixture-it/handoff-1/unit-photo-0001.jpg'}), {error: 'invalid'});
  await answer({kind: 'read'});
  assert.deepEqual(await answer({kind: 'photo', path: 'fixture-it/handoff-1/unit-photo-0001.jpg'}), {url: 'https://store.example/fixture-it/handoff-1/unit-photo-0001.jpg'});
  assert.deepEqual(await answer({kind: 'photo', path: 'fixture-it/handoff-1/another-file-0002.jpg'}), {error: 'invalid'});
  assert.deepEqual(await answer({kind: 'photo', path: 7}), {error: 'invalid'});
  assert.deepEqual(signed, [{bucket: 'techcheck-transfer-evidence', path: 'fixture-it/handoff-1/unit-photo-0001.jpg', seconds: 300}]);
});

test('a truck save is the truck editor call with an exact, checked shape, and nothing else is ever written', async () => {
  const {answer, calls, state, managerKit, plain} = host({rpc: name => name === 'owner_save_service_truck_inventory_batch_v1' ? {data: {ok: true}, error: null} : {data: null, error: {message: 'none'}}});
  assert.deepEqual(await answer({kind: 'truck', techId: TECH, kit: kitOf()}), {});
  assert.deepEqual(plain(calls), [{name: 'owner_save_service_truck_inventory_batch_v1', args: {p_service_tech_id: TECH, p_payload: kitOf()}}]);
  assert.equal(state.refreshed, 1);
  // Spaces around a number are dropped the way the database drops them.
  assert.deepEqual(plain(managerKit(kitOf({units: {Sniper: ' 101 ', Ranger: '', Spotter: '055', 'Solar Spotter': '014'}}))).units.Sniper, '101');
  for (const bad of [
    null, [], {}, {...kitOf(), extra: 1},
    kitOf({units: {Sniper: '101', Ranger: '', Spotter: '055'}}), kitOf({units: {Sniper: '101', Ranger: '', Spotter: '055', 'Solar Spotter': '014', Helios: '1'}}),
    kitOf({units: {Sniper: 101, Ranger: '', Spotter: '055', 'Solar Spotter': '014'}}), kitOf({units: {Sniper: 'x'.repeat(41), Ranger: '', Spotter: '', 'Solar Spotter': ''}}),
    kitOf({units: {Sniper: '10\n1', Ranger: '', Spotter: '', 'Solar Spotter': ''}}),
    kitOf({sims: {1: '', 2: ''}}), kitOf({sims: {1: '', 2: '', 3: 5}}),
    kitOf({stock: {'Recon Battery': 25, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2}}), kitOf({stock: {'Recon Battery': '25', 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4}}),
    kitOf({stock: {'Recon Battery': -1, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4}}), kitOf({stock: {'Recon Battery': 2.5, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4}}),
    kitOf({stock: {'Recon Battery': 10000, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4}}),
  ]) assert.deepEqual(await answer({kind: 'truck', techId: TECH, kit: bad}), {error: 'invalid'});
  assert.deepEqual(await answer({kind: 'truck', techId: 'not-an-id', kit: kitOf()}), {error: 'invalid'});
  assert.deepEqual(await answer({kind: 'delete-everything'}), {error: 'invalid'});
  assert.equal(calls.length, 1);
  // The database's own refusal is passed on in its words, and the older screen is not asked to read a change that did not happen.
  const refused = host({rpc: () => ({data: null, error: {message: 'Unit 031 is already assigned to another Service Tech truck.'}})});
  assert.deepEqual(await refused.answer({kind: 'truck', techId: TECH, kit: kitOf()}), {error: 'rejected', message: 'Unit 031 is already assigned to another Service Tech truck.'});
  assert.equal(refused.state.refreshed, 0);
  // Every database call in the manager part is one of these three.
  const block = hostSource.slice(hostSource.indexOf('// ---- Manager view'), hostSource.indexOf("window.addEventListener('message', async event => {"));
  assert.deepEqual([...block.matchAll(/\.rpc\('([a-z0-9_]+)'/g)].map(match => match[1]), ['owner_tech_command_board_v2', 'techcheck_transfer_context_v1', 'techcheck_handoff_gaps_v1', 'sim_drawer_v1', 'sim_drawer_add_v1', 'sim_drawer_mark_v1', 'owner_save_service_truck_inventory_batch_v1']);
  assert.doesNotMatch(block, /\.from\('(?!techcheck-transfer-evidence'\))|\.(?:insert|update|delete|upsert|upload|remove)\(|fetch\(|localStorage|innerHTML/);
});

test('only the signed-in owner, with the app on screen, is answered', () => {
  assert.equal(host().managerReady(), true);
  assert.equal(host({role: 'it'}).managerReady(), false);
  assert.equal(host({role: 'service'}).managerReady(), false);
  // An owner previewing a tech's screens is not acting as the owner.
  assert.equal(host({effectiveRole: 'it'}).managerReady(), false);
  assert.equal(host({hidden: true}).managerReady(), false);
  assert.equal(host({client: false}).managerReady(), false);
  // The request is taken only from the owner's own frame on this origin, and the answer goes only back to it.
  const listener = hostSource.slice(hostSource.indexOf("window.addEventListener('message', async event => {"));
  const guard = listener.indexOf("if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || !owner()) return;");
  const handler = listener.indexOf("if (data.type === 'COS_MANAGER_REQUEST'");
  assert.ok(guard > 0 && handler > guard);
  const body = listener.slice(handler, listener.indexOf("if (data.type === 'COS_OPERATIONS_TOKEN_REQUEST'"));
  assert.match(body, /if \(!managerReady\(\)\) reply = /);
  assert.match(body, /if \(target === frame\?\.contentWindow && requestedUser && owner\(\) === requestedUser && managerReady\(\)\) target\.postMessage\(\{ \.\.\.reply, type:'COS_MANAGER_RESPONSE', requestId:data\.requestId \}, event\.origin\);/);
  assert.equal(body.split('postMessage(').length - 1, 2);
  assert.doesNotMatch(body, /postMessage\([^)]*'\*'\)/);
});

test('the frame trusts nothing it is handed without checking its shape', () => {
  assert.throws(() => parseManagerSnapshot(null), /could not be read/);
  assert.throws(() => parseManagerSnapshot({day: 'today', techs: []}), /could not be read/);
  assert.throws(() => parseManagerSnapshot({day: '2026-10-06'}), /could not be read/);
  const parsed = parseManagerSnapshot({day: '2026-10-06', at: 'junk', it: 'junk', exchanges: 'junk', techs: [
    {id: 'nope', name: 'Dropped'},
    {id: TECH, name: '  Riley\u0000 Fixture  ', test: 'yes', ready: 1, inspection: {done: true, at: 'junk', truck: 'yes', trailer: 'sideways'}, stockCheck: {state: 'odd'},
      units: [{type: 'Sniper', tag: 102, status: 'stolen'}, {tag: 'no type'}], sims: [{slot: 0, number: '1'}, {slot: 2, number: '20002', status: 'used', ticket: '7'}],
      stock: [{key: 'Recon Battery', label: 'Recon batteries', have: 1e9, need: -3}], restock: [{status: 'x'}]},
  ]});
  assert.equal(parsed.exchanges, null);
  assert.deepEqual(parsed.it, []);
  assert.equal(parsed.techs.length, 1);
  assert.deepEqual({...parsed.techs[0]}, {
    id: TECH, name: 'Riley Fixture', test: false, ready: false, inspection: {done: true, at: null, truck: false, trailer: 'not_done'}, stockCheck: {state: 'missing', at: null},
    units: [{type: 'Sniper', tag: '', status: 'missing', ticket: ''}], sims: [{slot: 2, number: '20002', status: 'used', ticket: '7'}],
    stock: [{key: 'Recon Battery', label: 'Recon batteries', have: 9999, need: 0}], restock: [],
  });
  const exchange = parseManagerSnapshot({day: '2026-10-06', techs: [], exchanges: [{id: '00000000-0000-4000-8000-00000000b001', items: ['Sniper 101', 5], state: 'accepted',
    events: [{kind: 'receipt', who: 'Riley Fixture', at: '2026-10-05T18:00:00Z', differences: 2, report: 'javascript:alert(1)', photos: [{path: 'a/b/c-photo-1.jpg', kind: 'signature'}, {path: '../../etc/passwd-file'}, {path: 'short'}]}]}]}).exchanges[0];
  assert.deepEqual(exchange.items, ['Sniper 101']);
  assert.deepEqual(exchange.events[0], {kind: 'receipt', who: 'Riley Fixture', at: '2026-10-05T18:00:00Z', differences: 2, report: null, photos: [{path: 'a/b/c-photo-1.jpg', kind: 'signature'}]});
});

test('the door only wraps the Tech Check page, and the manager view is drawn by the board from what it is handed', () => {
  const door = read('../src/ManagerDoor.tsx'), page = read('../src/TechChecksWorkspace.tsx'), bridge = read('../src/managerBridge.ts'), landing = read('../src/CosBoardLanding.tsx');
  assert.equal(page.split('<ManagerDoor>').length - 1, 1);
  assert.match(page, /return <ManagerDoor><section className='panel module operations-tools cos-approved-checks' aria-label='Tech Check workspaces'>/);
  assert.match(door, /return waiting \? <p className='cos-manager-door' role='status'>Opening the manager view…<\/p> : <>\{children\}<\/>;/);
  // Only a device that has shown the manager view waits for it; any other has the page at once, whatever a timer does.
  assert.match(door, /const \[waiting, setWaiting\] = useState\(\(\) => managerHost\(\) && managerKnown\(\)\);/);
  assert.doesNotMatch(door, /cloneElement|Children\.|openLegacy|api\.|fetch\(|localStorage/);
  // Nothing here reaches the network or a database: the bridge is messages to the page around the frame, on this origin only.
  assert.doesNotMatch(bridge, /fetch\(|XMLHttpRequest|supabase|api\.(?:get|post)|\.rpc\(/);
  assert.equal(bridge.split('postMessage(').length - 1, 1);
  assert.match(bridge, /parent\.postMessage\(\{\.\.\.body, type: 'COS_MANAGER_REQUEST', requestId, kind\}, origin\);/);
  assert.match(bridge, /if \(settled \|\| event\.origin !== origin \|\| event\.source !== parent \|\| !record\(event\.data\)\) return;/);
  assert.match(landing, /manager: managerHost\(\) \? \{/);
  // The board: no Manager tab until the app answers for the owner, and with it the owner has no tech check tab.
  assert.match(app, /id=\\"tabManager\\" aria-selected=\\"false\\" type=\\"button\\" hidden>Manager</);
  assert.match(app, /const MGK = hooks && hooks\.manager && typeof hooks\.manager\.read==="function" \? hooks\.manager : null;/);
  assert.match(app, /function mgShow\(on\)\{ MG\.on=on; \$\("tabManager"\)\.hidden=!on;\n  \$\("tabTech"\)\.hidden = on \|\| /);
  assert.match(app, /e=>\{ MG\.err=[^\n]+ if\(e && e\.gone\) mgShow\(false\); \}/);
  // A save needs a real change, and a SIM that is not being replaced is sent blank so it is left as it is.
  assert.match(app, /async function mgSave\(t\)\{ const e=MG\.edit; if\(!e \|\| MG\.busy \|\| !mgReal\(t,e\) \|\| mgBad\(t,e\)\) return;/);
  assert.match(app, /kit\.sims\[String\(s\.slot\)\] = now!==s\.number \? now : "";/);
  const manager = app.slice(app.indexOf('/* ---------- manager view ----------'), app.indexOf('/* ---------- wide screens ----------'));
  assert.ok(manager.length > 5000);
  assert.doesNotMatch(manager, /fetch\(|localStorage|innerHTML|document\.|window\./);
});

test('the handoff check is read only, in a fixed shape, and a failed read leaves the rest of the view', async () => {
  const gaps = {mode: 'enforce', secret: 'x',
    on_truck_without_handoff: [{service_tech: 'Riley Fixture', equipment_type: 'Sniper', unit_tag: '102', loaded_by: 'Riley Fixture', loaded_at: '2026-11-25T08:00:00Z', in_equipment_list: false, service_tech_id: 'private-id'}],
    loaded_without_handoff: [{service_tech: 'Riley Fixture', equipment_type: 'Ranger', unit_tag: '008', by: 'Owner Fixture', role: 'owner', reason: 'Swapped on site', kind: 'owner_override', at: '2026-11-25T09:00:00Z', actor_id: 'private-id'}],
    handoffs_not_finished: [{transfer_id: 'private-id', state: 'awaiting_service', from: 'Jordan Fixture', to: 'Riley Fixture', hours_waiting: 5.4, units: ['Spotter 268']}]};
  const {answer, calls} = host({rpc: name => name === 'owner_tech_command_board_v2' ? {data: {service_techs: []}, error: null}
    : name === 'techcheck_handoff_gaps_v1' ? {data: gaps, error: null} : {data: null, error: {message: 'held'}}});
  const {snapshot} = await answer({kind: 'read'});
  assert.match(calls[2].args.p_since, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(snapshot.gaps, {
    enforced: true,
    noHandoff: [{tech: 'Riley Fixture', unit: 'Sniper 102', by: 'Riley Fixture', at: '2026-11-25T08:00:00.000Z', listed: false}],
    loaded: [{tech: 'Riley Fixture', unit: 'Ranger 008', by: 'Owner Fixture', reason: 'Swapped on site', at: '2026-11-25T09:00:00.000Z', kind: 'owner_override'}],
    late: [{units: ['Spotter 268'], from: 'Jordan Fixture', to: 'Riley Fixture', state: 'awaiting_service', hours: 5.4}],
  });
  assert.doesNotMatch(JSON.stringify(snapshot.gaps), /private-id|secret/);
  const failing = host({rpc: name => name === 'owner_tech_command_board_v2' ? {data: {service_techs: []}, error: null} : {data: null, error: {message: 'Not authorized'}}});
  const {snapshot: still} = await failing.answer({kind: 'read'});
  assert.equal(still.gaps, null);
  assert.deepEqual(still.techs, []);
});

test('the SIM drawer is read in a fixed shape, and adding or marking a card is the drawer call and nothing else', async () => {
  const drawer = {require_listed: false, secret: 'x',
    cards: [{sim: '89012600000000000001', carrier: 'Simetry', status: 'in_drawer', location: null, note: 'box A', added_by: 'Owner Fixture', added_at: '2026-11-25T15:00:00Z', updated_by: 'Owner Fixture', updated_at: '2026-11-25T15:00:00Z'},
      {sim: '89012600000000000002', carrier: 'Vendera', status: 'in_unit', location: 'Sniper 332 → Riley Fixture', note: null, updated_by: 'Jordan Fixture', updated_at: '2026-11-25T16:00:00Z'},
      {sim: 'bad number!', status: 'in_drawer'}],
    not_in_drawer: [{sim: '89012600000000000077', detail: 'Handed over in Sniper 332 to Riley Fixture', by: 'Jordan Fixture', at: '2026-11-25T16:00:00Z'}]};
  const {answer, calls, plain} = host({rpc: name => name === 'owner_tech_command_board_v2' ? {data: {service_techs: []}, error: null}
    : name === 'sim_drawer_v1' ? {data: drawer, error: null}
    : name === 'sim_drawer_add_v1' ? {data: {added: ['89012600000000000003'], already_listed: ['89012600000000000001'], not_a_sim_number: ['12']}, error: null}
    : name === 'sim_drawer_mark_v1' ? {data: {}, error: null} : {data: null, error: {message: 'held'}}});
  const {snapshot} = await answer({kind: 'read'});
  assert.deepEqual(plain(snapshot.sims), {
    cards: [{sim: '89012600000000000001', carrier: 'Simetry', status: 'in_drawer', location: '', note: 'box A', by: 'Owner Fixture', at: '2026-11-25T15:00:00.000Z'},
      {sim: '89012600000000000002', carrier: 'Vendera', status: 'in_unit', location: 'Sniper 332 → Riley Fixture', note: '', by: 'Jordan Fixture', at: '2026-11-25T16:00:00.000Z'}],
    notListed: [{sim: '89012600000000000077', detail: 'Handed over in Sniper 332 to Riley Fixture', by: 'Jordan Fixture', at: '2026-11-25T16:00:00.000Z'}],
  });
  assert.deepEqual(plain(await answer({kind: 'simAdd', numbers: ['89012600000000000003', '89012600000000000001', '12'], carrier: 'Simetry', note: ''})),
    {added: ['89012600000000000003'], already: ['89012600000000000001'], bad: ['12']});
  assert.deepEqual(plain(calls.at(-1)), {name: 'sim_drawer_add_v1', args: {p_numbers: ['89012600000000000003', '89012600000000000001', '12'], p_carrier: 'Simetry', p_note: null}});
  assert.deepEqual(plain(await answer({kind: 'simMark', sim: '89012600000000000002', status: 'bad', note: 'Will not register'})), {});
  assert.deepEqual(plain(calls.at(-1)), {name: 'sim_drawer_mark_v1', args: {p_number: '89012600000000000002', p_status: 'bad', p_note: 'Will not register'}});
  assert.deepEqual(plain(await answer({kind: 'simMark', sim: '89012600000000000002', status: 'on_truck'})), {error: 'invalid'});
  assert.deepEqual(plain(await answer({kind: 'simAdd', numbers: []})), {error: 'invalid'});
});
