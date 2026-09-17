const SUPABASE_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const SUPABASE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const AUTH_DOMAIN = 'cameras-on-site.invalid';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const BATTERY = {
  Sniper: { per: 2, label: '12V 35Ah batteries' },
  Ranger: { per: 1, label: 'Ranger lithium battery' },
  'Solar Spotter': { per: 4, label: '12V 110Ah batteries' },
  Helios: { per: 1, label: 'charged Helios battery box' },
  'Recon 2': { dynamic: true, label: 'Recon batteries' },
};
const TRUCK = [
  'Fuel level sufficient for today’s route',
  'Tires appear safe and properly inflated',
  'Headlights / signals / brake lights working',
  'Windshield and mirrors are safe and clear',
  'No visible fluid leaks',
  'Required tools and service supplies onboard',
  'Ladders / cargo / equipment secured',
  'Truck cab and bed organized',
];
const TRAILER = [
  'Trailer tires appear safe and properly inflated',
  'Hitch / coupler fully secured',
  'Safety chains attached correctly',
  'Trailer plug connected; lights and signals working',
  'Jack / supports secured for travel',
  'Load balanced and equipment tied down',
  'No visible structural damage or unsafe condition',
];
let state = {
  session: null,
  profile: null,
  preps: [],
  reports: [],
  profiles: [],
  matched: [],
  sessionClosed: [],
};
let draftNeeds = [];
let liveChannel = null;

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[m]
  );
}
function msg(id, text, type = 'warn') {
  const el = $(id);
  if (el)
    el.innerHTML = text
      ? '<div class="' + type + '">' + esc(text) + '</div>'
      : '';
}
function badge(p) {
  const cls = p === 'SWAP' ? 'swap' : p === 'DELIVERY' ? 'delivery' : 'backup';
  return '<span class="pill ' + cls + '">' + esc(p) + '</span>';
}
function roleLabel(r) {
  return r === 'owner'
    ? 'Owner/Admin'
    : r === 'it'
      ? 'IT Tech'
      : r === 'service'
        ? 'Service Tech'
        : 'Pending';
}
function eqLabel(t) {
  return t === 'Recon 2' ? 'Recon II' : t;
}
function requiredBattery(item) {
  const meta = BATTERY[item?.equipment_type];
  if (!meta) return 0;
  const stored = Number(item?.required_battery_count);
  return Number.isFinite(stored) && stored > 0 ? stored : Number(meta.per || 0);
}
function setBusy(on) {
  document.body.classList.toggle('busy', on);
}
function normalizeUsername(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}
function authId(username) {
  return normalizeUsername(username) + '@' + AUTH_DOMAIN;
}
function validUsername(v) {
  return USERNAME_RE.test(normalizeUsername(v));
}

async function init() {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (session) await enterApp(session);
  else showAuth();
  db.auth.onAuthStateChange(async (_event, nextSession) => {
    if (nextSession && !state.session) await enterApp(nextSession);
    if (!nextSession && state.session) showAuth();
  });
}
function showAuth() {
  state = {
    session: null,
    profile: null,
    preps: [],
    reports: [],
    profiles: [],
    matched: [],
    sessionClosed: [],
  };
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  if (liveChannel) {
    db.removeChannel(liveChannel);
    liveChannel = null;
  }
}
async function login() {
  msg('loginMessage', '');
  const username = normalizeUsername($('loginUsername').value);
  const password = $('loginPassword').value;
  if (!validUsername(username) || !password)
    return msg('loginMessage', 'Enter your username and password.', 'bad');
  setBusy(true);
  const { data, error } = await db.auth.signInWithPassword({
    email: authId(username),
    password,
  });
  setBusy(false);
  if (error)
    return msg('loginMessage', 'Username or password is incorrect.', 'bad');
  await enterApp(data.session);
}
async function enterApp(session) {
  state.session = session;
  const { data: profile, error } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', session.user.id)
    .single();
  if (error || !profile) {
    await db.auth.signOut();
    return msg(
      'loginMessage',
      'No active Cameras On Site profile was found.',
      'bad'
    );
  }
  if (!profile.active || profile.role === 'pending') {
    await db.auth.signOut();
    return msg(
      'loginMessage',
      'Your account is not active yet. Contact the Owner/Admin.',
      'bad'
    );
  }
  state.profile = profile;
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('whoName').textContent =
    profile.full_name || profile.username || 'Technician';
  $('whoRole').textContent = roleLabel(profile.role);
  configureTabs();
  setupRealtime();
  await refreshData();
}
function configureTabs() {
  const r = state.profile.role;
  $('tab-it').classList.toggle('hidden', !['it', 'owner'].includes(r));
  $('tab-svc').classList.toggle('hidden', !['service', 'owner'].includes(r));
  $('tab-owner').classList.toggle('hidden', r !== 'owner');
  show(r === 'owner' ? 'owner' : r === 'it' ? 'it' : 'svc');
}
function show(which) {
  ['it', 'svc', 'owner'].forEach(n => {
    $('view-' + n).classList.toggle('hidden', n !== which);
    $('tab-' + n).classList.toggle('on', n === which);
  });
}
async function logout() {
  await db.auth.signOut();
  showAuth();
}
function togglePasswordCard() {
  $('passwordCard').classList.toggle('hidden');
}
async function changeMyPassword() {
  const p = $('myNewPassword').value;
  if (p.length < 8)
    return msg(
      'passwordMessage',
      'Password must be at least 8 characters.',
      'bad'
    );
  const { error } = await db.auth.updateUser({ password: p });
  if (error) return msg('passwordMessage', error.message, 'bad');
  $('myNewPassword').value = '';
  msg('passwordMessage', 'Password updated.', 'ok');
}
function setupRealtime() {
  if (liveChannel) db.removeChannel(liveChannel);
  liveChannel = db
    .channel('cos-shared-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prep_tickets' },
      refreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prep_items' },
      refreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      refreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles' },
      refreshData
    )
    .subscribe(s => {
      $('syncStatus').textContent =
        s === 'SUBSCRIBED'
          ? 'Live shared data connected'
          : 'Connecting shared data…';
    });
}
async function refreshData() {
  if (!state.session) return;
  const prepQ = await db
    .from('prep_tickets')
    .select('*,prep_items(*)')
    .order('created_at', { ascending: true });
  if (!prepQ.error) state.preps = prepQ.data || [];
  if (state.profile.role === 'owner') {
    const rep = await db
      .from('reports')
      .select('*')
      .order('created_at', { ascending: true });
    if (!rep.error) state.reports = rep.data || [];
    const prof = await db
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (!prof.error) state.profiles = prof.data || [];
    renderOwner();
    renderUsers();
  }
  renderIT();
  renderMatched();
  updateMorningStatus();
}

function toggleReconBatteryInput() {
  $('reconBatteryWrap')?.classList.toggle(
    'hidden',
    $('needType')?.value !== 'Recon 2'
  );
}
function addNeed() {
  const type = $('needType').value,
    purpose = $('needPurpose').value,
    qty = Math.max(1, Number($('needQty').value || 1));
  const battery_qty =
    type === 'Recon 2'
      ? Math.max(1, Number($('reconBatteryQty').value || 1))
      : null;
  const old = draftNeeds.find(
    x =>
      x.equipment_type === type &&
      x.purpose === purpose &&
      Number(x.battery_qty || 0) === Number(battery_qty || 0)
  );
  if (old) old.qty += qty;
  else draftNeeds.push({ equipment_type: type, purpose, qty, battery_qty });
  renderDraftNeeds();
}
function removeNeed(i) {
  draftNeeds.splice(i, 1);
  renderDraftNeeds();
}
function needBatteryText(n) {
  const b = BATTERY[n.equipment_type];
  if (!b) return '';
  const count =
    n.equipment_type === 'Recon 2'
      ? Number(n.battery_qty || 1)
      : Number(b.per || 0);
  return ' · ' + count + ' × ' + esc(b.label) + ' per unit';
}
function renderDraftNeeds() {
  $('needDraft').innerHTML = draftNeeds
    .map(
      (n, i) =>
        '<div class="item"><div class="row">' +
        badge(n.purpose) +
        ' <b>' +
        n.qty +
        ' × ' +
        esc(eqLabel(n.equipment_type)) +
        '</b><button class="mini danger" onclick="removeNeed(' +
        i +
        ')">Remove</button></div><div class="small">MHelpDesk quantity: ' +
        n.qty +
        needBatteryText(n) +
        '</div></div>'
    )
    .join('');
}
async function createPrep() {
  msg('itCreateMessage', '');
  const ticket = $('itTicket').value.trim(),
    site = $('itSite').value.trim();
  if (!ticket)
    return msg('itCreateMessage', 'Enter the MHelpDesk ticket number.', 'bad');
  if (!draftNeeds.length)
    return msg(
      'itCreateMessage',
      'Add at least one BACKUP, SWAP, or DELIVERY requirement.',
      'bad'
    );
  setBusy(true);
  const { error } = await db.rpc('create_it_prep', {
    p_ticket_no: ticket,
    p_site: site,
    p_requirements: draftNeeds,
  });
  setBusy(false);
  if (error) return msg('itCreateMessage', error.message, 'bad');
  $('itTicket').value = '';
  $('itSite').value = '';
  draftNeeds = [];
  renderDraftNeeds();
  msg(
    'itCreateMessage',
    'IT equipment prep created. Verify the exact units below.',
    'ok'
  );
  await refreshData();
}
function deliveryReady(item) {
  return (
    item.purpose !== 'DELIVERY' ||
    (item.delivery_sim_ok &&
      item.delivery_camera_app_ok &&
      item.delivery_batteries_charged_ok &&
      item.delivery_monitoring_ok &&
      item.delivery_ticket_count_ok &&
      item.delivery_sd_formatted_ok &&
      item.delivery_recording_ok)
  );
}
function itemReady(item) {
  return !!item.unit_tag && !!item.verified_at && deliveryReady(item);
}
function checked(v) {
  return v ? ' checked' : '';
}
function deliveryChecklist(item) {
  if (item.purpose !== 'DELIVERY') return '';
  return (
    '<div class="deliveryChecks"><div class="subhead">DELIVERY Readiness</div><div class="small">All seven checks are required before this delivery equipment can be released.</div>' +
    '<div class="check"><input id="sim_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_sim_ok) +
    '><div><b>SIM card active and installed in router</b></div></div>' +
    '<div class="check"><input id="cam_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_camera_app_ok) +
    '><div><b>Camera is visible in the camera app</b></div></div>' +
    '<div class="check"><input id="sd_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_sd_formatted_ok) +
    '><div><b>SD card formatted</b></div></div>' +
    '<div class="check"><input id="recording_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_recording_ok) +
    '><div><b>Recording footage confirmed</b></div></div>' +
    '<div class="check"><input id="charged_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_batteries_charged_ok) +
    '><div><b>Batteries / battery box charged and ready</b></div></div>' +
    '<div class="check"><input id="monitor_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_monitoring_ok) +
    '><div><b>Central Station monitoring created and sent in</b></div></div>' +
    '<div class="check"><input id="count_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_ticket_count_ok) +
    '><div><b>This unit is included in the equipment type and quantity listed on the MHelpDesk ticket</b></div></div></div>'
  );
}
function itemForm(item) {
  const req = requiredBattery(item),
    b = BATTERY[item.equipment_type];
  if (itemReady(item))
    return (
      '<div class="ok"><div class="row">' +
      badge(item.purpose) +
      ' <b>' +
      esc(eqLabel(item.equipment_type)) +
      ' — ' +
      esc(item.unit_tag) +
      '</b></div><div class="small">Verified by IT' +
      (req > 0
        ? ' · Prepared: ' + item.battery_count + ' × ' + esc(b.label)
        : '') +
      (item.purpose === 'DELIVERY'
        ? ' · All delivery readiness checks complete'
        : '') +
      '</div></div>'
    );
  return (
    '<div class="unitForm"><div class="row">' +
    badge(item.purpose) +
    ' <b>' +
    esc(eqLabel(item.equipment_type)) +
    '</b></div><label class="top8">Exact Unit Tag</label><input id="tag_' +
    item.id +
    '" value="' +
    esc(item.unit_tag || '') +
    '" placeholder="Unit tag">' +
    (req > 0
      ? '<label class="top8">Batteries / Battery Box Prepared</label><input id="batt_' +
        item.id +
        '" type="number" min="' +
        req +
        '" value="' +
        (item.battery_count || req) +
        '"><div class="small">Required by this MHelpDesk prep: ' +
        req +
        ' × ' +
        esc(b.label) +
        '</div>'
      : '') +
    '<div class="check"><input id="power_' +
    item.id +
    '" type="checkbox"' +
    checked(item.power_ok) +
    '><div><b>Powers on correctly</b></div></div><div class="check"><input id="func_' +
    item.id +
    '" type="checkbox"' +
    checked(item.functions_ok) +
    '><div><b>Functions tested and working</b></div></div><div class="check"><input id="safe_' +
    item.id +
    '" type="checkbox"' +
    checked(item.safe_ok) +
    '><div><b>Safe for field use</b></div></div>' +
    deliveryChecklist(item) +
    '</div>'
  );
}
function renderIT() {
  if (!['it', 'owner'].includes(state.profile?.role || '')) return;
  $('openPrepCount').textContent =
    state.preps.filter(p => p.status !== 'closed').length + ' open';
  $('itPreps').innerHTML = state.preps.length
    ? state.preps
        .map(p => {
          const st =
            p.status === 'draft'
              ? '<span class="pill amber">IT EQUIPMENT PREP</span>'
              : p.status === 'released'
                ? '<span class="pill green">READY FOR SERVICE CHECKOUT</span>'
                : '<span class="pill">EQUIPMENT VERIFIED</span>';
          const sorted = [...(p.prep_items || [])].sort(
            (a, b) => a.item_order - b.item_order
          );
          const items = sorted.map(itemForm).join('');
          let action = '';
          if (p.status === 'draft') {
            const pending = sorted.filter(i => !itemReady(i)).length;
            action =
              '<button class="btn" onclick="saveAndRelease(\'' +
              p.id +
              '\')">' +
              (pending
                ? 'Verify ' +
                  pending +
                  ' Item' +
                  (pending > 1 ? 's' : '') +
                  ' & Release Equipment to Service Tech'
                : 'Release Equipment to Service Tech') +
              '</button>';
          }
          return (
            '<div class="item prepared ' +
            (p.status === 'closed' ? 'closed' : '') +
            '"><div class="ticketHead"><div><b>MHelpDesk Ticket #' +
            esc(p.ticket_no) +
            '</b><div class="small">' +
            esc(p.site || 'No site') +
            '</div></div>' +
            st +
            '</div>' +
            items +
            action +
            '</div>'
          );
        })
        .join('')
    : '<div class="warn">No IT equipment prep records yet.</div>';
}
async function saveAndRelease(prepId) {
  const p = state.preps.find(x => x.id === prepId);
  if (!p || p.status !== 'draft') return;
  const pending = [...(p.prep_items || [])]
    .filter(i => !itemReady(i))
    .sort((a, b) => a.item_order - b.item_order);
  setBusy(true);
  for (const item of pending) {
    const tag = $('tag_' + item.id)?.value.trim() || '',
      power = $('power_' + item.id)?.checked || false,
      func = $('func_' + item.id)?.checked || false,
      safe = $('safe_' + item.id)?.checked || false;
    const req = requiredBattery(item),
      batt = req > 0 ? Number($('batt_' + item.id)?.value || 0) : 0;
    if (!tag || !power || !func || !safe) {
      setBusy(false);
      return alert(
        'Complete the unit tag and all three IT equipment checks for ' +
          eqLabel(item.equipment_type) +
          ' before release.'
      );
    }
    if (req > 0 && batt < req) {
      setBusy(false);
      return alert(
        eqLabel(item.equipment_type) +
          ' requires ' +
          req +
          ' ' +
          BATTERY[item.equipment_type].label +
          '.'
      );
    }
    const { error } = await db.rpc('verify_prep_item', {
      p_item_id: item.id,
      p_unit_tag: tag,
      p_battery_count: batt,
      p_power_ok: power,
      p_functions_ok: func,
      p_safe_ok: safe,
    });
    if (error) {
      setBusy(false);
      await refreshData();
      return alert(error.message);
    }
    if (item.purpose === 'DELIVERY') {
      const sim = $('sim_' + item.id)?.checked || false,
        cam = $('cam_' + item.id)?.checked || false,
        sd = $('sd_' + item.id)?.checked || false,
        recording = $('recording_' + item.id)?.checked || false,
        charged = $('charged_' + item.id)?.checked || false,
        monitor = $('monitor_' + item.id)?.checked || false,
        count = $('count_' + item.id)?.checked || false;
      if (!sim || !cam || !sd || !recording || !charged || !monitor || !count) {
        setBusy(false);
        await refreshData();
        return alert(
          'Complete all seven DELIVERY readiness checks for ' +
            eqLabel(item.equipment_type) +
            ' ' +
            tag +
            '.'
        );
      }
      const { error: deliveryError } = await db.rpc(
        'verify_delivery_item_checks',
        {
          p_item_id: item.id,
          p_sim_ok: sim,
          p_camera_app_ok: cam,
          p_batteries_charged_ok: charged,
          p_monitoring_ok: monitor,
          p_ticket_count_ok: count,
          p_sd_formatted_ok: sd,
          p_recording_ok: recording,
        }
      );
      if (deliveryError) {
        setBusy(false);
        await refreshData();
        return alert(deliveryError.message);
      }
    }
  }
  const { error: releaseError } = await db.rpc('release_prep', {
    p_prep_id: prepId,
  });
  setBusy(false);
  if (releaseError) {
    await refreshData();
    return alert(releaseError.message);
  }
  await refreshData();
  alert(
    'Equipment for MHelpDesk Ticket #' +
      p.ticket_no +
      ' is released to Service Tech checkout.'
  );
}

async function findPrep() {
  const no = $('svcLookup').value.trim();
  $('lookupMessage').innerHTML = '';
  if (!no) return alert('Enter the MHelpDesk ticket number first.');
  await refreshData();
  const p = state.preps.find(
    x => x.ticket_no === no && x.status === 'released'
  );
  if (!p) {
    const completed = state.preps.find(
      x => x.ticket_no === no && x.status === 'closed'
    );
    $('lookupMessage').innerHTML = completed
      ? '<div class="warn"><b>Equipment verification for MHelpDesk Ticket #' +
        esc(no) +
        ' is already complete.</b></div>'
      : '<div class="bad"><b>No released IT equipment prep matches MHelpDesk Ticket #' +
        esc(no) +
        '.</b><div class="small">Confirm the ticket number or contact IT.</div></div>';
    return;
  }
  if (!state.matched.includes(p.id)) state.matched.push(p.id);
  $('svcLookup').value = '';
  $('lookupMessage').innerHTML =
    '<div class="ok"><b>Matched MHelpDesk Ticket #' +
    esc(p.ticket_no) +
    '</b> to IT-prepared equipment.</div>';
  renderMatched();
  updateMorningStatus();
}
function exactId(item) {
  return 'exact_' + item.id;
}
function battInputId(item) {
  return 'sbatt_' + item.id;
}
function battCheckId(item) {
  return 'sbattok_' + item.id;
}
function serviceItem(item) {
  const req = requiredBattery(item),
    b = BATTERY[item.equipment_type];
  return (
    '<div class="unitConfirm"><div class="row">' +
    badge(item.purpose) +
    ' <b>' +
    esc(eqLabel(item.equipment_type)) +
    ' — exact unit ' +
    esc(item.unit_tag) +
    '</b></div>' +
    (item.purpose === 'DELIVERY'
      ? '<div class="small">IT completed the DELIVERY readiness checks before release.</div>'
      : '') +
    '<div class="check"><input id="' +
    exactId(item) +
    '" type="checkbox"><div><b>I physically have this exact unit tag.</b></div></div>' +
    (req > 0
      ? '<div class="batteryVerify"><b>Battery Checkout Verification</b><div class="small">Required: <b>' +
        req +
        '</b> × ' +
        esc(b.label) +
        ' · IT prepared: <b>' +
        item.battery_count +
        '</b></div><label class="top8">Battery / battery-box count physically in hand</label><input id="' +
        battInputId(item) +
        '" type="number" min="' +
        req +
        '" inputmode="numeric" placeholder="Enter count"><div class="check"><input id="' +
        battCheckId(item) +
        '" type="checkbox"><div><b>I physically counted and verified the required batteries / battery box.</b></div></div></div>'
      : '') +
    '</div>'
  );
}
function renderMatched() {
  if (!['service', 'owner'].includes(state.profile?.role || '')) return;
  const preps = state.matched
    .map(id => state.preps.find(p => p.id === id))
    .filter(p => p && p.status === 'released');
  $('matchedPreps').innerHTML = preps.length
    ? preps
        .map(
          p =>
            '<div class="item prepared"><div class="ticketHead"><div><b>MHelpDesk Ticket #' +
            esc(p.ticket_no) +
            '</b><div class="small">' +
            esc(p.site || 'No site') +
            '</div></div><span class="pill green">MATCHED TO IT EQUIPMENT PREP</span></div>' +
            [...(p.prep_items || [])]
              .sort((a, b) => a.item_order - b.item_order)
              .map(serviceItem)
              .join('') +
            '<div class="row top10"><button class="mini danger" onclick="unmatchTicket(\'' +
            p.id +
            '\')">Remove From Morning View</button></div><button class="btn" onclick="closePreparedTicket(\'' +
            p.id +
            '\')">Complete Equipment Checkout Verification</button></div>'
        )
        .join('')
    : '<div class="warn">No equipment prep matched yet. Enter an MHelpDesk ticket number above if the job needs BACKUP, SWAP, or DELIVERY equipment.</div>';
  renderSessionClosed();
}
function unmatchTicket(id) {
  state.matched = state.matched.filter(x => x !== id);
  renderMatched();
  updateMorningStatus();
}
async function closePreparedTicket(id) {
  const p = state.preps.find(x => x.id === id);
  if (!p) return;
  const verifications = [];
  for (const item of [...(p.prep_items || [])].sort(
    (a, b) => a.item_order - b.item_order
  )) {
    const exact = $('exact_' + item.id);
    if (!exact?.checked)
      return alert('Confirm the exact unit tag ' + item.unit_tag + '.');
    let battery_count = 0,
      battery_verified = false;
    const req = requiredBattery(item);
    if (req > 0) {
      const inp = $('sbatt_' + item.id),
        chk = $('sbattok_' + item.id);
      if (!inp || inp.value === '')
        return alert(
          'Enter the battery count for ' +
            eqLabel(item.equipment_type) +
            ' ' +
            item.unit_tag +
            '.'
        );
      battery_count = Number(inp.value);
      battery_verified = !!chk?.checked;
      if (battery_count !== Number(item.battery_count))
        return alert(
          'Battery count must match IT prepared count: ' +
            item.battery_count +
            '.'
        );
      if (battery_count < req)
        return alert(
          eqLabel(item.equipment_type) +
            ' requires at least ' +
            req +
            ' ' +
            BATTERY[item.equipment_type].label +
            '.'
        );
      if (!battery_verified)
        return alert(
          'Check the battery verification box for ' + item.unit_tag + '.'
        );
    }
    verifications.push({
      item_id: item.id,
      unit_tag: item.unit_tag,
      unit_confirmed: true,
      battery_count,
      battery_verified,
    });
  }
  setBusy(true);
  const { error } = await db.rpc('close_prep_ticket', {
    p_prep_id: id,
    p_verifications: verifications,
  });
  setBusy(false);
  if (error) return alert(error.message);
  state.sessionClosed.push(p.ticket_no);
  state.matched = state.matched.filter(x => x !== id);
  await refreshData();
  renderSessionClosed();
  alert(
    'Equipment checkout verification for MHelpDesk Ticket #' +
      p.ticket_no +
      ' is complete and recorded.'
  );
}
function renderSessionClosed() {
  $('sessionClosed').innerHTML = state.sessionClosed.length
    ? '<div class="ok"><b>Equipment verified this morning</b><div class="small">' +
      state.sessionClosed.map(n => 'MHelpDesk Ticket #' + esc(n)).join(' · ') +
      '</div></div>'
    : '';
}
function truckComplete() {
  const boxes = [...document.querySelectorAll('.truckBox')];
  return boxes.length === 8 && boxes.every(x => x.checked);
}
function trailerComplete() {
  if (!$('takingTrailer').checked) return true;
  const boxes = [...document.querySelectorAll('.trailerBox')];
  return boxes.length === 7 && boxes.every(x => x.checked);
}
function toggleTrailer() {
  $('trailerArea').classList.toggle('hidden', !$('takingTrailer').checked);
  updateMorningStatus();
}
function updateMorningStatus() {
  if (!['service', 'owner'].includes(state.profile?.role || '')) return;
  const issues = [];
  if (!$('mhelpReviewed').checked) issues.push('MHelpDesk jobs not reviewed');
  if (state.matched.length)
    issues.push(
      state.matched.length +
        ' matched equipment verification' +
        (state.matched.length > 1 ? 's' : '') +
        ' still incomplete'
    );
  if (!truckComplete()) issues.push('Truck inspection incomplete');
  if (!trailerComplete()) issues.push('Trailer inspection incomplete');
  $('truckStatus').innerHTML = issues.length
    ? '<div class="warn"><b>Morning check not complete</b><div class="small">' +
      issues.map(esc).join('<br>') +
      '</div></div>'
    : '<div class="ok"><b>READY TO SUBMIT MORNING CHECK</b></div>';
}
async function submitMorning() {
  msg('morningMessage', '');
  if (!$('mhelpReviewed').checked)
    return msg(
      'morningMessage',
      'Confirm that you reviewed today’s MHelpDesk jobs.',
      'bad'
    );
  if (state.matched.length)
    return msg(
      'morningMessage',
      'Complete or remove every matched equipment verification first.',
      'bad'
    );
  if (!truckComplete())
    return msg('morningMessage', 'Complete all 8 truck checks.', 'bad');
  if (!trailerComplete())
    return msg('morningMessage', 'Complete all 7 trailer checks.', 'bad');
  const truck = {};
  document
    .querySelectorAll('.truckBox')
    .forEach((x, i) => (truck['truck_' + (i + 1)] = x.checked));
  const trailer = {};
  document
    .querySelectorAll('.trailerBox')
    .forEach((x, i) => (trailer['trailer_' + (i + 1)] = x.checked));
  setBusy(true);
  const { error } = await db.rpc('submit_morning_check', {
    p_mhelp_reviewed: true,
    p_truck_checks: truck,
    p_taking_trailer: $('takingTrailer').checked,
    p_trailer_checks: trailer,
    p_closed_ticket_nos: state.sessionClosed,
  });
  setBusy(false);
  if (error) return msg('morningMessage', error.message, 'bad');
  msg(
    'morningMessage',
    'Morning readiness check submitted to the Owner.',
    'ok'
  );
  state.sessionClosed = [];
  resetMorningInputs();
  await refreshData();
}
function resetMorningInputs() {
  $('mhelpReviewed').checked = false;
  $('takingTrailer').checked = false;
  $('trailerArea').classList.add('hidden');
  document
    .querySelectorAll('.truckBox,.trailerBox')
    .forEach(x => (x.checked = false));
  $('lookupMessage').innerHTML = '';
  renderSessionClosed();
  updateMorningStatus();
}

function renderOwner() {
  if (state.profile?.role !== 'owner') return;
  $('ownerPrepStatus').innerHTML = state.preps.length
    ? state.preps
        .map(
          p =>
            '<div class="item"><div class="row"><b>MHelpDesk Ticket #' +
            esc(p.ticket_no) +
            '</b> ' +
            (p.status === 'draft'
              ? '<span class="pill amber">IT EQUIPMENT PREP</span>'
              : p.status === 'released'
                ? '<span class="pill green">READY FOR SERVICE CHECKOUT</span>'
                : '<span class="pill">EQUIPMENT VERIFIED</span>') +
            '</div><div class="small">' +
            esc(p.site || 'No site') +
            ' · ' +
            (p.prep_items || [])
              .map(
                i =>
                  i.purpose +
                  ' ' +
                  eqLabel(i.equipment_type) +
                  (i.unit_tag ? ' ' + i.unit_tag : '')
              )
              .join(' · ') +
            '</div></div>'
        )
        .join('')
    : '<div class="warn">No prepared equipment records yet.</div>';
  $('reports').innerHTML = state.reports.length
    ? state.reports
        .map(
          r =>
            '<div class="item"><b>' +
            esc(r.kind) +
            '</b><div>' +
            esc(r.actor_name || 'Technician') +
            '</div><div class="small">' +
            new Date(r.created_at).toLocaleString() +
            '</div><div>' +
            esc(r.text) +
            '</div></div>'
        )
        .join('')
    : '<div class="warn">No reports yet.</div>';
  ensureStartFreshCard();
}
async function createTech() {
  msg('userMessage', '');
  const username = normalizeUsername($('newTechUsername').value);
  const body = {
    action: 'create',
    full_name: $('newTechName').value.trim(),
    email: authId(username),
    role: $('newTechRole').value,
    password: $('newTechPassword').value,
  };
  if (!body.full_name || !validUsername(username) || body.password.length < 8)
    return msg(
      'userMessage',
      'Enter a name, a username of 3–32 letters/numbers/dots/dashes/underscores, a role, and a temporary password of at least 8 characters.',
      'bad'
    );
  setBusy(true);
  const { data, error } = await db.functions.invoke('admin-user-management', {
    body,
  });
  setBusy(false);
  if (error) return msg('userMessage', error.message, 'bad');
  if (data?.error) return msg('userMessage', data.error, 'bad');
  $('newTechName').value = '';
  $('newTechUsername').value = '';
  $('newTechPassword').value = '';
  msg(
    'userMessage',
    'Technician login created for username ' + username + '.',
    'ok'
  );
  await refreshData();
}
function renderUsers() {
  if (state.profile?.role !== 'owner') return;
  $('userList').innerHTML = state.profiles.length
    ? state.profiles
        .map(
          p =>
            '<div class="usercard"><div><b>' +
            esc(p.full_name || p.username || 'User') +
            '</b><div class="small">Username: ' +
            esc(p.username || 'Not set') +
            '</div></div><div class="usergrid top8"><div><label>Role</label><select id="role_' +
            p.user_id +
            '"><option value="service" ' +
            (p.role === 'service' ? 'selected' : '') +
            '>Service Tech</option><option value="it" ' +
            (p.role === 'it' ? 'selected' : '') +
            '>IT Tech</option><option value="owner" ' +
            (p.role === 'owner' ? 'selected' : '') +
            '>Owner/Admin</option><option value="pending" ' +
            (p.role === 'pending' ? 'selected' : '') +
            '>Pending</option></select></div><div><label>Active</label><select id="active_' +
            p.user_id +
            '"><option value="true" ' +
            (p.active ? 'selected' : '') +
            '>Active</option><option value="false" ' +
            (!p.active ? 'selected' : '') +
            '>Disabled</option></select></div><div><label>&nbsp;</label><button class="mini full" onclick="saveUserAccess(\'' +
            p.user_id +
            '\')">Save Access</button></div></div><div class="grid top8"><div><label>Set New Password</label><input id="reset_' +
            p.user_id +
            '" type="password" placeholder="8+ characters"></div><div><label>&nbsp;</label><button class="mini full" onclick="resetUserPassword(\'' +
            p.user_id +
            '\')">Reset Password</button></div></div></div>'
        )
        .join('')
    : '<div class="warn">No users yet.</div>';
}
async function saveUserAccess(id) {
  const role = $('role_' + id).value,
    active = $('active_' + id).value === 'true';
  const { data, error } = await db.functions.invoke('admin-user-management', {
    body: { action: 'set_access', user_id: id, role, active },
  });
  if (error || data?.error) return alert(error?.message || data.error);
  await refreshData();
  alert('Access updated.');
}
async function resetUserPassword(id) {
  const password = $('reset_' + id).value;
  if (password.length < 8)
    return alert('Password must be at least 8 characters.');
  const { data, error } = await db.functions.invoke('admin-user-management', {
    body: { action: 'reset_password', user_id: id, password },
  });
  if (error || data?.error) return alert(error?.message || data.error);
  $('reset_' + id).value = '';
  alert('Password reset.');
}
function ensureStartFreshCard() {
  if ($('ownerResetCard')) return;
  const card = document.createElement('div');
  card.id = 'ownerResetCard';
  card.className = 'card';
  card.innerHTML =
    '<h2>Start Fresh / Clear Test Data</h2><div class="warn"><b>Owner only.</b><div class="small">Clears all equipment prep records, equipment checkout verifications, Owner reports, and morning checks. Technician accounts, usernames, roles, and passwords are kept.</div></div><button class="btn danger" onclick="startFresh()">Start Fresh — Clear Operational Data</button>';
  const reportCard = $('reports')?.closest('.card');
  if (reportCard) reportCard.after(card);
  else $('view-owner')?.appendChild(card);
}
async function startFresh() {
  if (state.profile?.role !== 'owner') return;
  const answer = prompt(
    'This clears ALL equipment prep, equipment verification history, Owner reports, and morning checks. Technician accounts and passwords will be kept. Type RESET to continue.'
  );
  if (answer !== 'RESET') return;
  setBusy(true);
  const { error } = await db.rpc('owner_start_fresh');
  setBusy(false);
  if (error) return alert(error.message);
  state.matched = [];
  state.sessionClosed = [];
  await refreshData();
  alert(
    'Started fresh. Operational/test data was cleared. Technician accounts were kept.'
  );
}

$('truckChecks').innerHTML = TRUCK.map(
  x =>
    '<div class="check"><input class="truckBox" type="checkbox" onchange="updateMorningStatus()"><div><b>' +
    esc(x) +
    '</b></div></div>'
).join('');
$('trailerChecks').innerHTML = TRAILER.map(
  x =>
    '<div class="check"><input class="trailerBox" type="checkbox" onchange="updateMorningStatus()"><div><b>' +
    esc(x) +
    '</b></div></div>'
).join('');
Object.assign(window, {
  login,
  refreshData,
  togglePasswordCard,
  changeMyPassword,
  logout,
  show,
  toggleReconBatteryInput,
  addNeed,
  removeNeed,
  createPrep,
  saveAndRelease,
  findPrep,
  unmatchTicket,
  closePreparedTicket,
  toggleTrailer,
  updateMorningStatus,
  submitMorning,
  createTech,
  saveUserAccess,
  resetUserPassword,
  startFresh,
});

renderDraftNeeds();
init();
