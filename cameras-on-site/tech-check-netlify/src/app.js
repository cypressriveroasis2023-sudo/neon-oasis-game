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
  'Solar Stand': { per: 1, label: 'solar stand batteries' },
  'Solar Pole': { per: 1, label: 'solar pole batteries' },
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
const INVENTORY_TYPES = [
  'Sniper',
  'Ranger',
  'Helios',
  'Solar Spotter',
  'Spotter',
  'Recon II',
  '110V Stand',
  'Solar Stand',
  'Solar Pole',
  'Pole',
  'Other',
];
let ownerEquipmentFilter = 'all';
let ownerDailyDate = localDateKey(new Date());
let state = {
  session: null,
  profile: null,
  preps: [],
  reports: [],
  profiles: [],
  resetRequests: [],
  unitRegistry: [],
  assetInventory: [],
  assetHistory: [],
  accessHistory: [],
  ownerAssignments: [],
  dailyInspections: [],
  matched: [],
  sessionClosed: [],
};
let draftNeeds = [];
let liveChannel = null;
let liveRefreshTimer = null;
let ownerReportLimit = 15;
const RESET_REQUEST_KEY = 'cos-tech-password-reset-v1';
let claimedTemporaryPassword = '';
function scheduleRefreshData() { clearTimeout(liveRefreshTimer); liveRefreshTimer = setTimeout(() => refreshData(), 180); }

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
      ? 'IT Technician'
      : r === 'service'
        ? 'Service Tech'
        : 'Pending';
}
function eqLabel(t) {
  return t === 'Recon 2' ? 'Recon II' : t;
}
function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y + '-' + m + '-' + day;
}
function dateFromKey(key) {
  const [y,m,d] = String(key || '').split('-').map(Number);
  return new Date(y || 1970,(m || 1)-1,d || 1,12,0,0,0);
}
function shiftDateKey(key,days) {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + Number(days || 0));
  return localDateKey(d);
}
function dateLabel(key) {
  return new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(dateFromKey(key));
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
let connectionHideTimer = null;
function updateConnectionStatus() {
  const online = navigator.onLine;
  document.body.classList.toggle('offlineMode', !online);
  const banner = $('connectionBanner');
  const sync = $('syncStatus');
  clearTimeout(connectionHideTimer);
  if (sync && !online) sync.textContent = 'Offline — unsent field drafts stay on this device';
  if (!banner) return;
  banner.classList.remove('hidden','online','offline');
  banner.classList.add(online ? 'online' : 'offline');
  banner.innerHTML = online ? '<b>Back online.</b> Refreshing shared Tech Check data…' : '<b>No connection.</b> Keep working on unsent Service Return or inspection forms. The app will not mark anything submitted until the server confirms it.';
  if (online) {
    if (state.session) scheduleRefreshData();
    connectionHideTimer = setTimeout(() => banner.classList.add('hidden'), 3200);
  }
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
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
    resetRequests: [],
    unitRegistry: [],
    assetInventory: [],
    assetHistory: [],
    accessHistory: [],
    matched: [],
    sessionClosed: [],
  };
  $('authView').classList.remove('hidden');
  $('forcePasswordView')?.classList.add('hidden');
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
  if (profile.must_change_password) return showForcedPasswordChange(profile);
  $('forcePasswordView')?.classList.add('hidden');
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('whoName').textContent =
    profile.full_name || profile.username || 'Technician';
  $('whoRole').textContent = roleLabel(profile.role);
  updateItWelcome();
  updateItWeather();
  configureTabs();
  setupRealtime();
  await refreshData();
}
function showForcedPasswordChange(profile) {
  $('authView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('forcePasswordView').classList.remove('hidden');
  const intro = $('forcePasswordIntro');
  if (intro) intro.textContent = `${profile.full_name || profile.username || 'Technician'}, your temporary password worked. Create a private password that only you know before continuing.`;
  $('forcedNewPassword').value = '';
  $('forcedConfirmPassword').value = '';
  msg('forcedPasswordMessage', '');
}
async function saveForcedPassword() {
  const password = $('forcedNewPassword').value;
  const confirmPassword = $('forcedConfirmPassword').value;
  if (password.length < 8) return msg('forcedPasswordMessage', 'Password must be at least 8 characters.', 'bad');
  if (password !== confirmPassword) return msg('forcedPasswordMessage', 'The two passwords do not match.', 'bad');
  setBusy(true);
  const { error } = await db.auth.updateUser({ password });
  if (error) { setBusy(false); return msg('forcedPasswordMessage', error.message, 'bad'); }
  const { error: profileError } = await db.rpc('complete_my_password_change');
  setBusy(false);
  if (profileError) return msg('forcedPasswordMessage', profileError.message, 'bad');
  const { data: sessionData } = await db.auth.getSession();
  if (!sessionData.session) return showAuth();
  await enterApp(sessionData.session);
}
function updateItWelcome() {
  const box = $('itWelcome');
  const clock = $('itWelcomeDateTime');
  if (!box || !clock) return;
  const name = state.profile?.full_name || state.profile?.username || 'Technician';
  box.querySelector('b').textContent = `Welcome, ${name}`;
  const renderClock = () => { clock.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date()); };
  renderClock();
  clearInterval(window.itWelcomeClockTimer);
  window.itWelcomeClockTimer = setInterval(renderClock, 30000);
}
async function updateItWeather() {
  const weather = $('itWeatherNow');
  if (!weather) return;
  try {
    const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=29.7858&longitude=-95.8244&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit&timezone=America%2FChicago');
    if (!response.ok) throw new Error('weather unavailable');
    const data = await response.json();
    const current = data.current || {};
    const code = Number(current.weather_code);
    const condition = code === 0 ? 'Clear' : code <= 3 ? 'Partly cloudy' : code <= 48 ? 'Cloudy' : code <= 67 ? 'Rain' : code <= 77 ? 'Wintry' : code <= 82 ? 'Showers' : 'Storms';
    weather.textContent = `${Math.round(current.temperature_2m)}°F · ${condition} · Feels ${Math.round(current.apparent_temperature)}°`;
  } catch (error) {
    weather.textContent = 'Katy weather unavailable';
  }
}
function configureTabs() {
  const r = state.profile.role;
  $('tab-it').classList.toggle('hidden', !['it', 'owner'].includes(r));
  $('tab-svc').classList.toggle('hidden', !['service', 'owner'].includes(r));
  $('tab-owner').classList.toggle('hidden', r !== 'owner');
  $('appView')?.classList.toggle('singleRoleView', r !== 'owner');
  show(r === 'owner' ? 'owner' : r === 'it' ? 'it' : 'svc');
}
function show(which) {
  ['it', 'svc', 'owner'].forEach(n => {
    $('view-' + n).classList.toggle('hidden', n !== which);
    $('tab-' + n).classList.toggle('on', n === which);
  });
  if (which === 'owner' && typeof window.refreshOwnerIntake === 'function') window.refreshOwnerIntake();
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
  await db.rpc('complete_my_password_change');
  $('myNewPassword').value = '';
  msg('passwordMessage', 'Private password updated.', 'ok');
}
function resetRequestState() { try { return JSON.parse(localStorage.getItem(RESET_REQUEST_KEY) || 'null'); } catch { return null; } }
function toggleResetRequestCard() {
  const card = $('resetRequestCard');
  card.classList.toggle('hidden');
  const username = normalizeUsername($('loginUsername').value);
  if (username && !$('resetUsername').value) $('resetUsername').value = username;
  const saved = resetRequestState();
  $('resetStatusButton').classList.toggle('hidden', !saved?.request_token);
}
async function callPasswordReset(body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/password-reset-request`, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` }, body:JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || 'Password reset service is unavailable.');
  return data;
}
async function requestPasswordReset() {
  const username = normalizeUsername($('resetUsername').value || $('loginUsername').value);
  if (!validUsername(username)) return msg('resetRequestMessage', 'Enter your Tech Check username.', 'bad');
  setBusy(true);
  try {
    const data = await callPasswordReset({ action:'request', username });
    if (data.request_token) localStorage.setItem(RESET_REQUEST_KEY, JSON.stringify({ username, request_token:data.request_token }));
    $('resetStatusButton').classList.remove('hidden');
    $('resetTempBox').classList.add('hidden');
    msg('resetRequestMessage', 'Reset request sent. The Owner/Admin must approve it. After approval, come back here and tap Check Reset Status.', 'ok');
  } catch (error) { msg('resetRequestMessage', error.message, 'bad'); }
  finally { setBusy(false); }
}
async function checkPasswordReset() {
  const saved = resetRequestState();
  if (!saved?.request_token) return msg('resetRequestMessage', 'Submit a password reset request first.', 'bad');
  setBusy(true);
  try {
    const data = await callPasswordReset({ action:'claim', username:saved.username, request_token:saved.request_token });
    if (data.status === 'ready' && data.temporary_password) {
      claimedTemporaryPassword = data.temporary_password;
      $('resetTemporaryPassword').textContent = data.temporary_password;
      $('resetTempBox').classList.remove('hidden');
      msg('resetRequestMessage', 'Approved. Your one-time temporary password is ready below.', 'ok');
    } else if (data.status === 'denied') msg('resetRequestMessage', 'The Owner/Admin did not approve this reset request. Contact the Owner/Admin if you still need help.', 'bad');
    else if (data.status === 'expired') msg('resetRequestMessage', 'This reset request expired. Submit a new request.', 'bad');
    else if (data.status === 'fulfilled') msg('resetRequestMessage', 'This reset request was already used. Submit a new request if you still cannot sign in.', 'bad');
    else msg('resetRequestMessage', 'Still waiting for Owner/Admin approval.', 'warn');
  } catch (error) { msg('resetRequestMessage', error.message, 'bad'); }
  finally { setBusy(false); }
}
async function useTemporaryResetPassword() {
  const saved = resetRequestState();
  if (!claimedTemporaryPassword || !saved?.username) return;
  $('loginUsername').value = saved.username;
  $('loginPassword').value = claimedTemporaryPassword;
  await login();
  if (state.session) { localStorage.removeItem(RESET_REQUEST_KEY); claimedTemporaryPassword = ''; }
}
function setupRealtime() {
  if (liveChannel) db.removeChannel(liveChannel);
  liveChannel = db
    .channel('cos-shared-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prep_tickets' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'prep_items' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asset_inventory' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'asset_inventory_history' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_access_history' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'password_reset_requests' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'unit_returns' },
      () => {
        scheduleRefreshData();
        if (state.profile?.role === 'owner' && typeof window.refreshOwnerIntake === 'function') window.refreshOwnerIntake();
      }
    )
    .subscribe(s => {
      $('syncStatus').textContent = !navigator.onLine ? 'Offline — unsent field drafts stay on this device' : s === 'SUBSCRIBED' ? 'Live shared data connected' : 'Connecting shared data…';
    });
}
async function refreshData() {
  if (!state.session) return;
  const { data: currentProfile } = await db.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();
  if (!currentProfile || !currentProfile.active || currentProfile.archived_at || currentProfile.role === 'pending') {
    await db.auth.signOut();
    return showAuth();
  }
  if (currentProfile.role !== state.profile?.role || currentProfile.full_name !== state.profile?.full_name) {
    state.profile = currentProfile;
    $('whoName').textContent = currentProfile.full_name || currentProfile.username || 'Technician';
    $('whoRole').textContent = roleLabel(currentProfile.role);
    configureTabs();
  } else {
    state.profile = currentProfile;
  }
  const prepQ = await db
    .from('prep_tickets')
    .select('*,prep_items(*)')
    .order('created_at', { ascending: true });
  if (!prepQ.error) state.preps = prepQ.data || [];
  if (state.profile.role === 'owner') {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const [rep, prof, resets, returns, inspections, registry, assets, assetHistory, accessHistory] = await Promise.all([
      db.from('reports').select('*').order('created_at', { ascending: true }),
      db.from('profiles').select('*').order('created_at', { ascending: true }),
      db.from('password_reset_requests').select('id,user_id,username,status,requested_at,expires_at,approved_at').in('status',['pending','approved']).order('requested_at',{ascending:false}).limit(50),
      db.from('unit_returns').select('id,ticket_no,unit_tag,equipment_type,status,returned_at,it_received_at,updated_at,service_tech_name,it_tech_name').in('status',['waiting_it','pending_mhelp_inventory']).order('returned_at',{ascending:true}),
      db.from('morning_checks').select('id,service_tech_id,truck_checks,taking_trailer,trailer_checks,submitted_at').gte('submitted_at',dayStart.toISOString()).order('submitted_at',{ascending:false}),
      db.from('unit_registry').select('unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,current_holder_name,last_event,updated_at').order('updated_at',{ascending:false}).limit(500),
      db.from('asset_inventory').select('*').order('asset_category',{ascending:true}).order('unit_tag',{ascending:true}),
      db.from('asset_inventory_history').select('*').order('created_at',{ascending:false}).limit(300),
      db.from('team_access_history').select('*').order('created_at',{ascending:false}).limit(100)
    ]);
    if (!rep.error) state.reports = rep.data || [];
    if (!prof.error) state.profiles = prof.data || [];
    if (!resets.error) state.resetRequests = resets.data || [];
    if (!returns.error) state.ownerReturns = returns.data || [];
    if (!inspections.error) state.todayInspections = inspections.data || [];
    if (!registry.error) state.unitRegistry = registry.data || [];
    if (!assets.error) state.assetInventory = assets.data || [];
    if (!assetHistory.error) state.assetHistory = assetHistory.data || [];
    if (!accessHistory.error) state.accessHistory = accessHistory.data || [];
    renderOwner();
    renderOwnerUnitSearch();
    renderOwnerEquipment();
    renderOwnerAttention();
    renderPasswordResetRequests();
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
  if (['Solar Stand', 'Solar Pole', '110V Stand', 'Pole'].includes(item?.equipment_type)) return true;
  return (
    item.purpose !== 'DELIVERY' ||
    (item.delivery_sim_ok &&
      item.delivery_camera_app_ok && item.delivery_customer_email_app_ok &&
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
  if (item.purpose !== 'DELIVERY' || ['Solar Stand', 'Solar Pole', '110V Stand', 'Pole'].includes(item.equipment_type)) return '';
  return (
    '<div class="deliveryChecks"><div class="subhead">DELIVERY Readiness</div><div class="small">All eight checks are required before this delivery equipment can be released.</div>' +
    '<div class="check"><input id="sim_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_sim_ok) +
    '><div><b>SIM card active and installed in router</b></div></div>' +
    '<div class="check"><input id="cam_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_camera_app_ok) +
    '><div><b>Camera is visible in the camera app</b></div></div>' + '<div class="check"><input id="customeremail_' + item.id + '" type="checkbox"' + checked(item.delivery_customer_email_app_ok) + '><div><b>Unit/app added under the customer email account in the camera app</b></div></div>' +
    '<div class="check"><input id="sd_' +
    item.id +
    '" type="checkbox"' +
    checked(item.delivery_sd_formatted_ok) +
    '><div><b>SD card / NVR storage formatted and ready</b></div></div>' +
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
            ownerPartsSummary(p) +
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
        cam = $('cam_' + item.id)?.checked || false, customerEmail = $('customeremail_' + item.id)?.checked || false,
        sd = $('sd_' + item.id)?.checked || false,
        recording = $('recording_' + item.id)?.checked || false,
        charged = $('charged_' + item.id)?.checked || false,
        monitor = $('monitor_' + item.id)?.checked || false,
        count = $('count_' + item.id)?.checked || false;
      if (!sim || !cam || !customerEmail || !sd || !recording || !charged || !monitor || !count) {
        setBusy(false);
        await refreshData();
        return alert(
          'Complete all eight DELIVERY readiness checks for ' +
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
          p_camera_app_ok: cam, p_customer_email_app_ok: customerEmail,
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

function ownerAgeHours(value) { const time = value ? new Date(value).getTime() : NaN; return Number.isFinite(time) ? Math.max(0,(Date.now()-time)/3600000) : 0; }
function ownerJump(target) {
  const el = target === 'returns'
    ? document.getElementById('ownerIntakeTracking')
    : target === 'accounts'
      ? document.getElementById('ownerAccountsCard')
      : target === 'activity'
        ? document.getElementById('ownerActivityCard')
        : document.getElementById('ownerHandoffsCard');
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({behavior:'smooth',block:'start'});
  el.classList.add('ownerAttentionFlash');
  setTimeout(() => el.classList.remove('ownerAttentionFlash'),1200);
}
function ownerOpenReturn(id) {
  const section = document.getElementById('ownerIntakeTracking');
  if (section?.tagName === 'DETAILS') section.open = true;
  const el=[...document.querySelectorAll('details[data-owner-return]')].find(x => x.dataset.ownerReturn===String(id));
  if (!el) return ownerJump('returns');
  el.open=true;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.classList.add('ownerAttentionFlash');
  setTimeout(() => el.classList.remove('ownerAttentionFlash'),1200);
}
function renderOwnerAttention() {
  if (state.profile?.role !== 'owner') return;
  const host = $('ownerAttention'); if (!host) return;
  const returns = state.ownerReturns || [];
  const drafts = state.preps.filter(p => p.status === 'draft');
  const released = state.preps.filter(p => p.status === 'released');
  const waitingIt = returns.filter(r => r.status === 'waiting_it');
  const manager = returns.filter(r => r.status === 'pending_mhelp_inventory');
  const resetPending = (state.resetRequests || []).filter(r => r.status === 'pending' && new Date(r.expires_at).getTime() > Date.now());
  const latestInspection = new Map(); (state.todayInspections || []).forEach(row => { if (!latestInspection.has(row.service_tech_id)) latestInspection.set(row.service_tech_id,row); });
  const failedInspections = [...latestInspection.values()].filter(row => Object.values(row.truck_checks || {}).includes(false) || (row.taking_trailer && Object.values(row.trailer_checks || {}).includes(false)));
  const overdueDrafts = drafts.filter(p => ownerAgeHours(p.created_at) >= 24);
  const overdueReleased = released.filter(p => ownerAgeHours(p.released_at || p.created_at) >= 24);
  const overdueReturns = waitingIt.filter(r => ownerAgeHours(r.returned_at) >= 24);
  const overdueManager = manager.filter(r => ownerAgeHours(r.it_received_at || r.updated_at) >= 24);
  const ownerActions = manager.length + resetPending.length + failedInspections.length;
  const overdueCount = overdueDrafts.length + overdueReleased.length + overdueReturns.length + overdueManager.length;
  const attentionCount = ownerActions + overdueCount;
  const attentionBadge = $('ownerAttentionBadge');
  if (attentionBadge) {
    attentionBadge.textContent = String(attentionCount);
    attentionBadge.classList.toggle('alert', attentionCount > 0);
    attentionBadge.classList.toggle('neutral', attentionCount === 0);
  }
  const attentionCard = $('ownerAttentionCard');
  if (attentionCard?.tagName === 'DETAILS' && attentionCount > 0) attentionCard.open = true;
  const techName = id => state.profiles.find(p => p.user_id === id)?.full_name || state.profiles.find(p => p.user_id === id)?.username || 'Service Tech';
  const row = (kind,title,detail,target,urgent=false) => `<div class='ownerAttentionRow ${urgent ? 'urgent' : ''}'><div><b>${esc(title)}</b><div class='small'>${esc(detail)}</div></div><button class='mini' onclick="ownerJump('${target}')">Open →</button></div>`;
  const nextOwner = manager[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Return Unit ${esc(manager[0].unit_tag)} to Shop Inventory in MHelpDesk</b><div class='small'>MHelpDesk #${esc(manager[0].ticket_no)} · IT intake is complete.</div><button class='btn top10' onclick="ownerOpenReturn('${manager[0].id}')">Open This Unit →</button></div>` : resetPending[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Review password reset for ${esc(resetPending[0].username)}</b><div class='small'>Approve or deny the technician’s reset request.</div><button class='btn top10' onclick="ownerJump('accounts')">Review Reset Request →</button></div>` : failedInspections[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Review failed morning inspection</b><div class='small'>${esc(techName(failedInspections[0].service_tech_id))} has a current failed inspection today.</div><button class='btn top10' onclick="ownerJump('activity')">Open Activity →</button></div>` : `<div class='ownerNextAction clear'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>✓ No Owner-only action is waiting.</b><div class='small'>You can monitor work in progress below without taking action right now.</div></div>`;
  const parts = [];
  if (manager.length) parts.push(row('manager',`${manager.length} return${manager.length===1?'':'s'} need your MHelpDesk inventory confirmation`,manager.map(r => `Unit ${r.unit_tag} · #${r.ticket_no}${ownerAgeHours(r.it_received_at || r.updated_at)>=24?' · OVER 24H':''}`).join(' | '),'returns',true));
  if (resetPending.length) parts.push(row('reset',`${resetPending.length} password reset request${resetPending.length===1?'':'s'} waiting for approval`,resetPending.map(r => r.username).join(' · '),'accounts',true));
  if (failedInspections.length) parts.push(row('inspection',`${failedInspections.length} current failed morning inspection${failedInspections.length===1?'':'s'} today`,failedInspections.map(r => techName(r.service_tech_id)).join(' · '),'activity',true));
  if (waitingIt.length) parts.push(row('intake',`${waitingIt.length} returned unit${waitingIt.length===1?'':'s'} waiting for IT intake`,waitingIt.map(r => `Unit ${r.unit_tag}${ownerAgeHours(r.returned_at)>=24?' · OVER 24H':''}`).join(' | '),'returns',overdueReturns.length>0));
  if (drafts.length) parts.push(row('prep',`${drafts.length} MHelpDesk ticket${drafts.length===1?'':'s'} still in IT prep`,drafts.map(p => `#${p.ticket_no}${ownerAgeHours(p.created_at)>=24?' · OVER 24H':''}`).join(' | '),'prep',overdueDrafts.length>0));
  if (released.length) parts.push(row('service',`${released.length} prepared ticket${released.length===1?'':'s'} waiting for Service checkout`,released.map(p => `#${p.ticket_no}${ownerAgeHours(p.released_at || p.created_at)>=24?' · OVER 24H':''}`).join(' | '),'prep',overdueReleased.length>0));
  host.innerHTML = `${nextOwner}<div class='ownerAttentionStats'><span><b>${ownerActions}</b> needs you</span><span><b>${drafts.length + released.length + waitingIt.length}</b> in progress</span><span><b>${overdueCount}</b> over 24h</span></div>${parts.join('') || '<div class="ok"><b>✓ Nothing needs attention right now.</b><div class="small">No blocked, overdue, or Owner-action items are showing.</div></div>'}`;
}
function unitLifecycleLabel(status) { return ({shop_inventory:'SHOP INVENTORY',assigned_to_tech:'ASSIGNED TO TECH',maintenance:'MAINTENANCE',retired:'RETIRED',it_prep:'IT PREPARING',ready_for_service:'READY FOR SERVICE',deployed:'DEPLOYED / FIELD',returned_waiting_it:'RETURNED — WAITING IT',waiting_manager:'IT COMPLETE — WAITING MANAGER'})[status] || String(status || 'UNKNOWN').replaceAll('_',' ').toUpperCase(); }
function unitLifecycleClass(status) { return status === 'shop_inventory' ? 'green' : status === 'assigned_to_tech' ? 'delivery' : status === 'maintenance' || status === 'it_prep' || status === 'waiting_manager' ? 'amber' : status === 'retired' ? 'neutral' : status === 'deployed' ? 'delivery' : status === 'returned_waiting_it' ? 'swap' : 'green'; }
function renderOwnerUnitSearch() {
  if (state.profile?.role !== 'owner') return;
  const unitBadge = $('ownerUnitStatusBadge');
  if (unitBadge) unitBadge.textContent = String((state.unitRegistry || []).length);
  const host = $('ownerUnitSearchResults'); if (!host) return;
  const q = String($('ownerUnitSearch')?.value || '').trim().toLowerCase();
  let rows = state.unitRegistry || [];
  if (q) rows = rows.filter(r => `${r.unit_tag || ''} ${r.ticket_no || ''} ${r.equipment_type || ''} ${r.lifecycle_status || ''} ${unitLifecycleLabel(r.lifecycle_status)} ${r.current_holder_name || ''} ${r.last_event || ''}`.toLowerCase().includes(q));
  else rows = rows.slice(0,10);
  const title = q ? `${rows.length} matching unit${rows.length===1?'':'s'}` : 'Recently Updated Units';
  host.innerHTML = `<div class='small top8'><b>${esc(title)}</b></div>${rows.length ? rows.map(r => `<div class='unitStatusRow'><div><b>Unit ${esc(r.unit_tag)}</b><div class='small'>${esc(r.equipment_type || 'Equipment type not recorded')} · MHelpDesk ${r.ticket_no ? '#' + esc(r.ticket_no) : 'not linked'}</div><div class='small'>${esc(r.last_event || 'Status updated')}${r.current_holder_name ? ` · Last tech: ${esc(r.current_holder_name)}` : ''}</div><div class='small'>Updated ${new Date(r.updated_at).toLocaleString()}</div></div><span class='pill ${unitLifecycleClass(r.lifecycle_status)}'>${esc(unitLifecycleLabel(r.lifecycle_status))}</span></div>`).join('') : `<div class='${q ? 'warn' : 'ok'} top8'><b>${q ? 'No unit matched that search.' : 'No units have entered the lifecycle yet.'}</b><div class='small'>Unit status is created automatically as IT starts preparing equipment.</div></div>`}`;
}

function inventoryStatusLabel(status) {
  return ({shop:'SHOP / SHELF',assigned:'ASSIGNED',maintenance:'MAINTENANCE',retired:'RETIRED'})[status] || String(status || '').toUpperCase();
}
function inventoryStatusClass(status) {
  return status === 'shop' ? 'green' : status === 'assigned' ? 'delivery' : status === 'maintenance' ? 'amber' : 'neutral';
}
function inventoryTypeOptions(selected='') {
  return INVENTORY_TYPES.map(type => '<option value="' + esc(type) + '" ' + (type===selected?'selected':'') + '>' + esc(type) + '</option>').join('');
}
function inventoryTechOptions(selected='') {
  const techs=(state.profiles || []).filter(p => p.active && !p.archived_at && (p.role==='it' || p.role==='service'));
  return '<option value="">Choose technician…</option>' + techs.map(p => '<option value="' + p.user_id + '" ' + (p.user_id===selected?'selected':'') + '>' + esc(roleLabel(p.role).replace('Technician','Tech')) + ' · ' + esc(p.full_name || p.username || 'Technician') + '</option>').join('');
}
function inventoryHistoryHtml(unitKey) {
  const rows=(state.assetHistory || []).filter(h => h.unit_key===unitKey).slice(0,8);
  if (!rows.length) return '<div class="small">No inventory history yet.</div>';
  return rows.map(h => '<div class="inventoryHistoryRow"><b>' + esc(String(h.action || '').replaceAll('_',' ').toUpperCase()) + '</b><span>' + esc(h.actor_name || 'Owner/Admin') + ' · ' + new Date(h.created_at).toLocaleString() + '</span>' + (h.to_user_name ? '<span>To: ' + esc(h.to_user_name) + '</span>' : '') + (h.notes ? '<span>' + esc(h.notes) + '</span>' : '') + '</div>').join('');
}
function renderOwnerEquipment() {
  if (state.profile?.role !== 'owner') return;
  const host=$('ownerEquipmentManager');
  if (!host) return;
  const rows=state.assetInventory || [];
  const active=rows.filter(r => r.availability_status!=='retired');
  const assigned=rows.filter(r => r.availability_status==='assigned');
  const shop=rows.filter(r => r.availability_status==='shop');
  const badge=$('ownerEquipmentBadge');
  if (badge) {
    badge.textContent=String(active.length);
    badge.classList.toggle('alert',assigned.length>0);
    badge.classList.toggle('neutral',assigned.length===0);
  }
  const filtered=rows.filter(r => {
    if (ownerEquipmentFilter==='all') return r.availability_status!=='retired';
    if (ownerEquipmentFilter==='device' || ownerEquipmentFilter==='stand') return r.asset_category===ownerEquipmentFilter && r.availability_status!=='retired';
    return r.availability_status===ownerEquipmentFilter;
  });

  host.innerHTML =
    '<div class="ownerEquipmentIntro"><b>Master Equipment Inventory</b><div class="small">Add permanent unit / asset tags here, then assign devices or stands to an IT Tech or Service Tech. MHelpDesk tickets can close; the equipment record stays.</div></div>' +
    '<div class="ownerEquipmentAdd"><div><label>Unit / Asset Tag</label><input id="inventoryTag" placeholder="Example: 058 or Stand-12"></div><div><label>Type</label><select id="inventoryType">' + inventoryTypeOptions() + '</select></div><div><label>Category</label><select id="inventoryCategory"><option value="device">Device</option><option value="stand">Stand</option></select></div><div><label>Notes</label><input id="inventoryNotes" placeholder="Optional shelf / condition note"></div><button class="btn" id="inventoryAddButton" type="button">Add to Inventory</button></div>' +
    '<div class="ownerEquipmentStats"><span><b>' + shop.length + '</b> Shop</span><span><b>' + assigned.length + '</b> Assigned</span><span><b>' + rows.filter(r=>r.availability_status==='maintenance').length + '</b> Maintenance</span><span><b>' + rows.filter(r=>r.asset_category==='stand' && r.availability_status!=='retired').length + '</b> Stands</span></div>' +
    '<div class="ownerEquipmentFilters"><button data-equipment-filter="all" class="' + (ownerEquipmentFilter==='all'?'on':'') + '">Active</button><button data-equipment-filter="device" class="' + (ownerEquipmentFilter==='device'?'on':'') + '">Devices</button><button data-equipment-filter="stand" class="' + (ownerEquipmentFilter==='stand'?'on':'') + '">Stands</button><button data-equipment-filter="assigned" class="' + (ownerEquipmentFilter==='assigned'?'on':'') + '">Assigned</button><button data-equipment-filter="maintenance" class="' + (ownerEquipmentFilter==='maintenance'?'on':'') + '">Maintenance</button><button data-equipment-filter="retired" class="' + (ownerEquipmentFilter==='retired'?'on':'') + '">Retired</button></div>' +
    '<div class="ownerEquipmentList">' + (filtered.length ? filtered.map((r,i) => {
      const role = state.profiles.find(p => p.user_id===r.assigned_to)?.role;
      const holder = r.assigned_to_name ? (role==='it'?'IT Tech ':role==='service'?'Service Tech ':'') + r.assigned_to_name : '';
      const assignmentControls = r.availability_status==='shop'
        ? '<div class="equipmentAssignRow"><select data-asset-tech="' + i + '">' + inventoryTechOptions() + '</select><button class="mini" data-asset-assign="' + i + '">Assign to Tech</button></div>'
        : r.availability_status==='assigned'
          ? '<div class="equipmentActionRow"><button class="mini" data-asset-shop="' + i + '">Return to Shop</button><button class="mini" data-asset-maintenance="' + i + '">Maintenance</button></div>'
          : r.availability_status==='maintenance'
            ? '<div class="equipmentActionRow"><button class="mini" data-asset-shop="' + i + '">Return to Shop</button><button class="mini danger" data-asset-retire="' + i + '">Retire</button></div>'
            : '<div class="equipmentActionRow"><button class="mini" data-asset-shop="' + i + '">Restore to Shop</button></div>';
      return '<details class="equipmentAssetCard ' + esc(r.asset_category) + '"><summary><div><b>' + esc(r.unit_tag) + '</b><span>' + esc(r.asset_type) + ' · ' + esc(r.asset_category.toUpperCase()) + '</span></div><span class="pill ' + inventoryStatusClass(r.availability_status) + '">' + esc(inventoryStatusLabel(r.availability_status)) + '</span></summary><div class="equipmentAssetBody">' + (holder ? '<div class="equipmentHolder"><b>Assigned to:</b> ' + esc(holder) + '</div>' : '') + (r.last_event ? '<div class="small"><b>Last event:</b> ' + esc(r.last_event) + '</div>' : '') + (r.notes ? '<div class="small"><b>Notes:</b> ' + esc(r.notes) + '</div>' : '') + assignmentControls + '<details class="equipmentHistoryFold"><summary>Inventory History</summary><div>' + inventoryHistoryHtml(r.unit_key) + '</div></details></div></details>';
    }).join('') : '<div class="ok"><b>No equipment in this view.</b><div class="small">Add your devices and stands above.</div></div>') + '</div>';

  $('inventoryAddButton')?.addEventListener('click', addInventoryAsset);
  host.querySelectorAll('[data-equipment-filter]').forEach(btn => btn.addEventListener('click', () => { ownerEquipmentFilter=btn.dataset.equipmentFilter; renderOwnerEquipment(); }));
  host.querySelectorAll('[data-asset-assign]').forEach(btn => btn.addEventListener('click', () => {
    const row=filtered[Number(btn.dataset.assetAssign)];
    const select=host.querySelector('[data-asset-tech="' + btn.dataset.assetAssign + '"]');
    if (row) assignInventoryAsset(row.unit_key, select?.value || '');
  }));
  host.querySelectorAll('[data-asset-shop]').forEach(btn => btn.addEventListener('click', () => {
    const row=filtered[Number(btn.dataset.assetShop)]; if (row) setInventoryAssetStatus(row.unit_key,'shop');
  }));
  host.querySelectorAll('[data-asset-maintenance]').forEach(btn => btn.addEventListener('click', () => {
    const row=filtered[Number(btn.dataset.assetMaintenance)]; if (row) setInventoryAssetStatus(row.unit_key,'maintenance');
  }));
  host.querySelectorAll('[data-asset-retire]').forEach(btn => btn.addEventListener('click', () => {
    const row=filtered[Number(btn.dataset.assetRetire)]; if (row) setInventoryAssetStatus(row.unit_key,'retired');
  }));
}
async function addInventoryAsset() {
  const tag=$('inventoryTag')?.value.trim() || '';
  const type=$('inventoryType')?.value || '';
  const category=$('inventoryCategory')?.value || 'device';
  const notes=$('inventoryNotes')?.value.trim() || '';
  if (!tag || !type) return alert('Enter the unit / asset tag and equipment type.');
  setBusy(true);
  const { error }=await db.rpc('owner_add_inventory_asset',{ p_unit_tag:tag,p_asset_type:type,p_asset_category:category,p_notes:notes });
  setBusy(false);
  if (error) return alert(error.message);
  await refreshData();
}
async function assignInventoryAsset(unitKey,userId) {
  if (!userId) return alert('Choose the technician who should receive this equipment.');
  const asset=(state.assetInventory || []).find(r=>r.unit_key===unitKey);
  const tech=(state.profiles || []).find(p=>p.user_id===userId);
  if (!asset || !tech) return alert('Equipment or technician could not be found.');
  if (!confirm('Assign ' + asset.unit_tag + ' (' + asset.asset_type + ') to ' + (tech.role==='it'?'IT Tech ':'Service Tech ') + (tech.full_name || tech.username) + '?')) return;
  setBusy(true);
  const { error }=await db.rpc('owner_assign_inventory_asset',{ p_unit_key:unitKey,p_user_id:userId });
  setBusy(false);
  if (error) return alert(error.message);
  await refreshData();
}
async function setInventoryAssetStatus(unitKey,status) {
  const asset=(state.assetInventory || []).find(r=>r.unit_key===unitKey);
  if (!asset) return;
  const verb=status==='shop'?'return to Shop / Shelf Inventory':status==='maintenance'?'move to Maintenance':'retire from active inventory';
  if (!confirm('Do you want to ' + verb + ': ' + asset.unit_tag + '?')) return;
  const notes=status==='maintenance' ? (prompt('Maintenance note (optional):','') || '') : '';
  setBusy(true);
  const { error }=await db.rpc('owner_set_inventory_asset_status',{ p_unit_key:unitKey,p_status:status,p_notes:notes });
  setBusy(false);
  if (error) return alert(error.message);
  await refreshData();
}

const OWNER_TICKET_PARTS = [
  { key:'solar_panel_qty', id:'SolarPanels', label:'Solar Panels' },
  { key:'battery_replacement_qty', id:'BatteryReplacements', label:'Replacement Batteries' },
  { key:'camera_replacement_qty', id:'CameraReplacements', label:'Replacement Cameras' },
  { key:'sim_replacement_qty', id:'SimReplacements', label:'Replacement SIM Cards' },
  { key:'micro_sd_qty', id:'MicroSdCards', label:'Micro SD Cards' },
];
function ownerCleanPartQty(value) { return Math.max(0, Math.floor(Number(value || 0))); }
function ownerPartsRows(p) { return OWNER_TICKET_PARTS.map(part => ({...part, qty:ownerCleanPartQty(p?.[part.key])})); }
function ownerPartsSummary(p) {
  const rows=ownerPartsRows(p).filter(row=>row.qty>0);
  return '<div class="ownerPartsSummary top8"><b>Parts Required</b>' +
    (rows.length ? '<div class="ownerPartsChips">' + rows.map(row => '<span><b>'+row.qty+'</b> × '+esc(row.label)+'</span>').join('') + '</div>' : '<div class="small">No extra replacement parts listed.</div>') +
    '</div>';
}
function ownerPartsEditor(p) {
  if (p.status !== 'draft') return ownerPartsSummary(p);
  return '<div class="ownerPartsEditor top8"><b>Parts Required</b><div class="small">Editable while IT is still preparing this ticket.</div><div class="ownerPartsGrid">' +
    OWNER_TICKET_PARTS.map(part => '<label><span>'+esc(part.label)+'</span><input id="ownerPart_'+part.id+'_'+p.id+'" type="number" min="0" step="1" inputmode="numeric" value="'+ownerCleanPartQty(p[part.key])+'"></label>').join('') +
    '</div><button class="mini top8" onclick="saveOwnerPrepParts(\''+p.id+'\')">Save Parts List</button></div>';
}
async function saveOwnerPrepParts(prepId) {
  const p=state.preps.find(row=>row.id===prepId);
  if (!p || p.status!=='draft') return alert('Only a ticket still in IT Prep can have its parts list changed.');
  const values={};
  OWNER_TICKET_PARTS.forEach(part => {
    values[part.key]=ownerCleanPartQty(document.getElementById('ownerPart_'+part.id+'_'+prepId)?.value);
  });
  setBusy(true);
  const { error }=await db.rpc('set_prep_parts',{
    p_prep_id:prepId,
    p_solar_panel_qty:values.solar_panel_qty,
    p_battery_replacement_qty:values.battery_replacement_qty,
    p_camera_replacement_qty:values.camera_replacement_qty,
    p_sim_replacement_qty:values.sim_replacement_qty,
    p_micro_sd_qty:values.micro_sd_qty,
  });
  setBusy(false);
  if(error) return alert(error.message);
  await refreshData();
  alert('Parts list updated.');
}

function renderOwner() {
  if (state.profile?.role !== 'owner') return;
  const activePreps = state.preps.filter(p => p.status !== 'closed');
  const completedPreps = state.preps.filter(p => p.status === 'closed').slice().reverse();
  const prepHtml = p => '<details class="ownerFold"><summary><span><b>MHelpDesk Ticket #' + esc(p.ticket_no) + '</b><span class="small ownerFoldHint">' + esc(p.site || 'No site') + '</span></span>' + (p.status === 'draft' ? '<span class="pill amber">IT EQUIPMENT PREP</span>' : p.status === 'released' ? '<span class="pill green">READY FOR SERVICE CHECKOUT</span>' : '<span class="pill">EQUIPMENT VERIFIED</span>') + '</summary><div class="ownerFoldBody small">' + ownerPartsEditor(p) + '<div class="top8"><b>Units / Equipment</b><div>' + ((p.prep_items || []).map(i => i.purpose + ' ' + eqLabel(i.equipment_type) + (i.unit_tag ? ' ' + i.unit_tag : '')).join(' · ') || 'No units started yet.') + '</div></div></div></details>';
  const draftCount = activePreps.filter(p => p.status === 'draft').length;
  const serviceCount = activePreps.filter(p => p.status === 'released').length;
  const handoffBadge = $('ownerHandoffsBadge');
  if (handoffBadge) {
    handoffBadge.textContent = String(activePreps.length);
    handoffBadge.classList.toggle('alert', activePreps.length > 0);
    handoffBadge.classList.toggle('neutral', activePreps.length === 0);
  }
  const activityBadge = $('ownerActivityBadge');
  if (activityBadge) activityBadge.textContent = String(state.reports.length);
  $('ownerPrepSummary').innerHTML = '<div class="wl-workstrip"><span><b>' + draftCount + '</b> IT preparing</span><span><b>' + serviceCount + '</b> waiting Service</span><span><b>' + activePreps.length + '</b> active tickets</span></div>';
  $('ownerPrepStatus').innerHTML = activePreps.length ? activePreps.slice().reverse().map(prepHtml).join('') : '<div class="ok"><b>✓ No active equipment handoffs.</b></div>';
  $('ownerPrepHistoryCount').textContent = String(completedPreps.length);
  $('ownerPrepHistory').innerHTML = completedPreps.length ? completedPreps.map(prepHtml).join('') : '<div class="small">No completed equipment history yet.</div>';
  const recentReports = state.reports.slice().reverse().slice(0, ownerReportLimit);
  $('reports').innerHTML = recentReports.length ? recentReports.map(r => '<details class="ownerFold"><summary><span><b>' + esc(r.kind) + '</b><span class="small ownerFoldHint">' + esc(r.actor_name || 'Technician') + ' · ' + new Date(r.created_at).toLocaleString() + '</span></span><span class="pill">DETAILS</span></summary><div class="ownerFoldBody">' + esc(r.text) + '</div></details>').join('') : '<div class="warn">No reports yet.</div>';
  const more = $('ownerReportsMore'); if (more) { more.classList.toggle('hidden', ownerReportLimit >= state.reports.length); more.textContent = 'Show More Activity (' + Math.max(0, state.reports.length - ownerReportLimit) + ' older)'; more.onclick = () => { ownerReportLimit += 25; renderOwner(); }; }
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
    'Team member login created for username ' + username + '. The temporary password must be changed privately at first sign in.',
    'ok'
  );
  await refreshData();
}
function renderPasswordResetRequests() {
  if (state.profile?.role !== 'owner') return;
  const host = $('passwordResetRequests');
  if (!host) return;
  const rows = state.resetRequests || [];
  host.innerHTML = rows.length ? rows.map(r => { const profile = state.profiles.find(p => p.user_id === r.user_id); const name = profile?.full_name || r.username; const expired = new Date(r.expires_at).getTime() <= Date.now(); return '<div class="usercard"><div><b>' + esc(name) + '</b><div class="small">Username: ' + esc(r.username) + ' · Requested ' + new Date(r.requested_at).toLocaleString() + '</div></div>' + (expired ? '<div class="warn top8"><b>Expired</b></div>' : r.status === 'approved' ? '<div class="ok top8"><b>APPROVED</b><div class="small">Waiting for the technician to claim the one-time temporary password on the requesting device.</div><button class="mini danger top8" onclick="ownerReviewPasswordReset(\'' + r.id + '\',false)">Cancel Request</button></div>' : '<div class="row top8"><button class="mini" onclick="ownerReviewPasswordReset(\'' + r.id + '\',true)">Approve Reset</button><button class="mini danger" onclick="ownerReviewPasswordReset(\'' + r.id + '\',false)">Deny</button></div>') + '</div>'; }).join('') : '<div class="ok top8"><b>✓ No password reset requests waiting.</b></div>';
}
async function ownerReviewPasswordReset(id, approve) {
  const { error } = await db.rpc('owner_review_password_reset', { p_request_id:id, p_approve:Boolean(approve) });
  if (error) return alert(error.message);
  await refreshData();
  alert(approve ? 'Reset approved. The technician can now retrieve a one-time temporary password from the requesting device.' : 'Reset request closed.');
}
function teamRoleClass(role) {
  return role === 'owner' ? 'owner' : role === 'it' ? 'it' : role === 'service' ? 'service' : 'pending';
}
function teamMemberCard(p) {
  const self = p.user_id === state.profile?.user_id;
  const status = p.active ? 'ACTIVE' : 'DISABLED';
  return '<details class="teamMemberCard role-' + teamRoleClass(p.role) + '"><summary><div class="teamMemberIdentity"><b>' + esc(p.full_name || p.username || 'User') + '</b><span>@' + esc(p.username || 'no-username') + '</span></div><div class="teamMemberBadges"><span class="pill roleBadge ' + teamRoleClass(p.role) + '">' + esc(roleLabel(p.role)) + '</span><span class="pill ' + (p.active ? 'green' : 'amber') + '">' + status + '</span>' + (self ? '<span class="pill">YOU</span>' : '') + '</div></summary><div class="teamMemberBody"><div class="teamEditGrid"><div><label>Full Name</label><input id="name_' + p.user_id + '" value="' + esc(p.full_name || '') + '"></div><div><label>Role</label><select id="role_' + p.user_id + '"><option value="service" ' + (p.role==='service'?'selected':'') + '>Service Tech</option><option value="it" ' + (p.role==='it'?'selected':'') + '>IT Technician</option><option value="owner" ' + (p.role==='owner'?'selected':'') + '>Owner/Admin</option><option value="pending" ' + (p.role==='pending'?'selected':'') + '>Pending</option></select></div><div><label>Access</label><select id="active_' + p.user_id + '"><option value="true" ' + (p.active?'selected':'') + '>Active</option><option value="false" ' + (!p.active?'selected':'') + '>Disabled</option></select></div><div class="teamSaveCell"><label>&nbsp;</label><button class="mini full" onclick="saveUserAccess(\'' + p.user_id + '\')">Save Access</button></div></div><details class="accountSecurityFold"><summary>Account Security</summary><div class="accountSecurityBody"><div class="small">' + (p.must_change_password ? 'Password status: TEMPORARY — private change required at next sign in' : 'Password status: Private password set') + '</div><div class="grid top8"><div><label>Set Temporary Password</label><input id="reset_' + p.user_id + '" type="password" placeholder="8+ characters"></div><div><label>&nbsp;</label><button class="mini full" onclick="resetUserPassword(\'' + p.user_id + '\')">Set Temporary Password</button></div></div></div></details>' + (self ? '<div class="small top8"><b>Your Owner/Admin account is protected.</b> You cannot archive or disable your own owner access.</div>' : '<button class="mini danger top10" onclick="archiveUser(\'' + p.user_id + '\')">Delete from Techs on File</button>') + '</div></details>';
}
function archivedTeamCard(p) {
  return '<div class="archivedTeamCard"><div><b>' + esc(p.full_name || p.username || 'Team Member') + '</b><div class="small">@' + esc(p.username || 'no-username') + ' · ' + esc(roleLabel(p.role)) + '</div><div class="small">Deleted from Techs on File ' + (p.archived_at ? new Date(p.archived_at).toLocaleString() : '') + (p.archived_reason ? ' · ' + esc(p.archived_reason) : '') + '</div></div><button class="mini" onclick="restoreUser(\'' + p.user_id + '\')">Restore</button></div>';
}
function renderTeamAccessHistory() {
  const host=$('teamAccessHistory');
  if (!host) return;
  const rows=(state.accessHistory || []).slice(0,50);
  host.innerHTML=rows.length ? rows.map(h => '<div class="teamHistoryRow"><div><b>' + esc(h.user_name) + '</b><span>' + esc(String(h.action || '').replaceAll('_',' ').toUpperCase()) + '</span></div><div class="small">' + esc(h.actor_name || 'Owner/Admin') + ' · ' + new Date(h.created_at).toLocaleString() + '</div>' + (h.detail ? '<div class="small">' + esc(h.detail) + '</div>' : '') + '</div>').join('') : '<div class="small">No access changes logged yet.</div>';
}
function renderUsers() {
  if (state.profile?.role !== 'owner') return;
  const activeTeam=state.profiles.filter(p => !p.archived_at && p.active);
  const inactiveTeam=state.profiles.filter(p => !p.archived_at && !p.active);
  const archived=state.profiles.filter(p => p.archived_at);
  const activeTechCount=activeTeam.filter(p => p.role==='it' || p.role==='service').length;
  const ownerCount=activeTeam.filter(p => p.role==='owner').length;
  const resetCount=(state.resetRequests || []).filter(r => r.status==='pending' && new Date(r.expires_at).getTime()>Date.now()).length;
  const accountsBadge=$('ownerAccountsBadge');
  if (accountsBadge) {
    accountsBadge.textContent=resetCount ? resetCount + ' RESET' + (resetCount===1?'':'S') : (activeTechCount + ownerCount) + ' TEAM';
    accountsBadge.classList.toggle('alert',resetCount>0);
    accountsBadge.classList.toggle('neutral',resetCount===0);
  }
  const stats=$('ownerTeamStats');
  if (stats) stats.innerHTML='<span><b>' + activeTechCount + '</b> Active Techs</span><span><b>' + ownerCount + '</b> Owners/Admins</span><span><b>' + inactiveTeam.length + '</b> Inactive</span>';
  if ($('activeTeamCount')) $('activeTeamCount').textContent=String(activeTeam.length);
  if ($('inactiveTeamCount')) $('inactiveTeamCount').textContent=String(inactiveTeam.length);
  if ($('archivedTeamCount')) $('archivedTeamCount').textContent=String(archived.length);
  $('userList').innerHTML=activeTeam.length ? activeTeam.map(teamMemberCard).join('') : '<div class="warn">No active team members.</div>';
  const inactiveHost=$('inactiveUserList');
  if (inactiveHost) inactiveHost.innerHTML=inactiveTeam.length ? inactiveTeam.map(teamMemberCard).join('') : '<div class="ok"><b>✓ No inactive team members.</b></div>';
  const archivedHost=$('archivedUserList');
  if (archivedHost) archivedHost.innerHTML=archived.length ? archived.map(archivedTeamCard).join('') : '<div class="ok"><b>✓ No deleted / former team members.</b></div>';
  renderTeamAccessHistory();
}
async function archiveUser(id) {
  const p=state.profiles.find(row=>row.user_id===id);
  if (!p) return;
  if (!confirm('Delete ' + (p.full_name || p.username) + ' from Techs on File?\n\nThey will disappear from Active and Inactive Team lists and will not be able to sign in. Their historical tickets, checks, photos, handoffs, and reports will still keep their name.')) return;
  const reason=prompt('Delete / former team note (optional):','') || '';
  setBusy(true);
  const { data,error }=await db.functions.invoke('admin-user-management',{ body:{ action:'archive',user_id:id,reason } });
  setBusy(false);
  if (error || data?.error) return alert(error?.message || data.error);
  await refreshData();
}
async function restoreUser(id) {
  const p=state.profiles.find(row=>row.user_id===id);
  if (!p) return;
  if (!confirm('Restore ' + (p.full_name || p.username) + ' to Active Team? Their existing username and password will work again.')) return;
  setBusy(true);
  const { data,error }=await db.functions.invoke('admin-user-management',{ body:{ action:'restore',user_id:id } });
  setBusy(false);
  if (error || data?.error) return alert(error?.message || data.error);
  await refreshData();
}
async function saveUserAccess(id) {
  const role = $('role_' + id).value,
    active = $('active_' + id).value === 'true',
    fullName = $('name_' + id)?.value.trim() || '';
  const { data, error } = await db.functions.invoke('admin-user-management', {
    body: { action: 'set_access', user_id: id, role, active, full_name: fullName },
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
  await refreshData();
  alert('Temporary password set. The technician must create a private password at the next sign in.');
}
function ensureStartFreshCard() {
  if ($('ownerResetCard')) return;
  const card = document.createElement('details');
  card.id = 'ownerResetCard';
  card.className = 'card ownerDashSection ownerMaintenanceCard';
  card.innerHTML =
    '<summary class="ownerDashSummary"><div><b>Maintenance</b><span>Clear test / operational data only when needed</span></div><span class="ownerDashBadge neutral">⚙</span></summary>' +
    '<div class="ownerDashBody"><div class="warn"><b>Owner only.</b><div class="small">Clears all equipment prep records, equipment checkout verifications, Owner reports, morning checks, and the operational unit-status registry. Technician accounts, usernames, roles, and passwords are kept.</div></div><button class="btn danger" onclick="startFresh()">Start Fresh — Clear Operational Data</button></div>';
  const accountsCard = $('ownerAccountsCard');
  if (accountsCard) accountsCard.after(card);
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
  saveForcedPassword,
  toggleResetRequestCard,
  requestPasswordReset,
  checkPasswordReset,
  useTemporaryResetPassword,
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
  archiveUser,
  restoreUser,
  resetUserPassword,
  ownerReviewPasswordReset,
  ownerJump,
  ownerOpenReturn,
  renderOwnerUnitSearch,
  renderOwnerEquipment,
  addInventoryAsset,
  assignInventoryAsset,
  setInventoryAssetStatus,
  saveOwnerPrepParts,
  startFresh,
});

renderDraftNeeds();
updateConnectionStatus();
init();
