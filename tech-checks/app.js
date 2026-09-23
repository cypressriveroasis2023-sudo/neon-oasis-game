const SUPABASE_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const SUPABASE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.TechCheckDB = db;
const $ = id => document.getElementById(id);
const AUTH_DOMAIN = 'cameras-on-site.invalid';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const BATTERY = {
  Sniper: { per: 2, label: '12V 35Ah batteries' },
  Ranger: { per: 1, label: 'Ranger lithium battery' },
  'Solar Spotter': { per: 0, label: '12V 110Ah batteries — checked by Service with Solar Stand' },
  Helios: { per: 1, label: 'charged Helios battery box' },
  'Recon 2': { dynamic: true, label: 'Recon batteries' },
  'Solar Stand': { per: 0, label: 'solar stand batteries — checked by Service' },
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
  ownerReviewQueue: [],
  ownerAIAlerts: [],
  ownerFieldEscalations: [],
  ownerTechCommandBoard: null,
  ownerWeatherData: null,
  ownerWeatherLoadedAt: 0,
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
let refreshInFlight = null;
let refreshQueued = false;
let deferredModulesPromise = null;
let realtimeStarted = false;
function scheduleRefreshData() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => refreshData(), 240);
}
function scheduleIdle(task, timeout=700) {
  if ('requestIdleCallback' in window) return requestIdleCallback(task, { timeout });
  return setTimeout(task, Math.min(timeout, 260));
}
function loadDeferredModules() {
  if (deferredModulesPromise) return deferredModulesPromise;
  deferredModulesPromise = import('./technician-wizard-owner-dashboard-v5.js?v=it-clock-weather-fix-20260923q')
    .then(() => {
      if (state.profile?.role === 'owner') {
        scheduleIdle(() => import('./team-email-settings.js?v=email-settings-v4').catch(console.warn), 1200);
      }
    })
    .catch(error => {
      console.error('Could not load Tech Check workflow tools', error);
      deferredModulesPromise = null;
    });
  return deferredModulesPromise;
}

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
function serviceInspectionRequiredForDate() {
  return true;
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
window.addEventListener('techcheck:owner-ai-alerts', event => {
  const alerts=Array.isArray(event?.detail?.alerts)?event.detail.alerts:[];
  state.ownerAIAlerts=alerts;
  if(state.profile?.role==='owner'){
    renderOwnerAttention();
    renderOwnerCommandCenter();
  }
});
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
  // Keep startup auth single-path. Supabase auth-state callbacks can deadlock
  // the client when follow-up Supabase work starts before the auth lock releases.
  // Login/logout already handle their own state; startup only restores a session.
  try {
    const {
      data: { session },
    } = await appTimeout(db.auth.getSession(), 'Restore session', 10000);
    if (session) await enterApp(session);
    else showAuth();
  } catch (error) {
    console.warn('Tech Check session restore failed', error);
    showAuth();
  }
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
    ownerReviewQueue: [],
    ownerAIAlerts: [],
    ownerFieldEscalations: [],
    ownerTechCommandBoard: null,
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
  realtimeStarted = false;
}
async function login() {
  msg('loginMessage', '');
  const username = normalizeUsername($('loginUsername').value);
  const password = $('loginPassword').value;
  if (!validUsername(username) || !password)
    return msg('loginMessage', 'Enter your username and password.', 'bad');
  setBusy(true);
  let data, error;
  try {
    const result = await appTimeout(
      db.auth.signInWithPassword({ email: authId(username), password }),
      'Sign in',
      15000
    );
    data = result?.data;
    error = result?.error;
  } catch (loginError) {
    error = loginError;
  } finally {
    setBusy(false);
  }
  if (error || !data?.session) {
    console.warn('Tech Check sign in failed', error);
    return msg('loginMessage', error?.message?.includes('timeout')
      ? 'Sign in timed out. Check your connection and try again.'
      : 'Username or password is incorrect.', 'bad');
  }
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

  // Paint the signed-in shell first. Heavy workflow code and shared-data hydration
  // are deliberately moved off the critical startup path.
  const sync = $('syncStatus');
  if (sync) sync.textContent = 'Opening Tech Check…';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sync) sync.textContent = 'Loading live work…';
    refreshData({ skipProfile:true, initial:true }).catch(error => console.warn('Initial Tech Check refresh failed', error));
    scheduleIdle(() => loadDeferredModules(), 700);
    scheduleIdle(() => setupRealtime(), 1200);
  }));
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
const TECHCHECK_LAST_GPS_KEY='techcheck:last-gps-v1';
function techCheckLastGps(){
  try{
    const value=JSON.parse(localStorage.getItem(TECHCHECK_LAST_GPS_KEY)||'null');
    return value&&Number.isFinite(Number(value.latitude))&&Number.isFinite(Number(value.longitude))?value:null;
  }catch{return null;}
}
function techCheckCoordsNear(a,b){
  if(!a||!b)return false;
  return Math.abs(Number(a.latitude)-Number(b.latitude))<0.012
    && Math.abs(Number(a.longitude)-Number(b.longitude))<0.012;
}
function techCheckGpsPosition(force=false){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('This device does not support GPS location.'));
    navigator.geolocation.getCurrentPosition(
      position=>{
        const coords={
          latitude:Number(position.coords.latitude),
          longitude:Number(position.coords.longitude),
          accuracy:Number(position.coords.accuracy||0),
          captured_at:Date.now()
        };
        try{localStorage.setItem(TECHCHECK_LAST_GPS_KEY,JSON.stringify(coords));}catch{}
        resolve(coords);
      },
      error=>{
        const cached=techCheckLastGps();
        if(!force&&cached&&Date.now()-Number(cached.captured_at||0)<60*60*1000*2)return resolve({...cached,cached:true});
        const message=error?.code===1
          ? 'Location permission is off. Allow Location Access for Tech Check to show local weather.'
          : 'Your GPS location could not be read right now.';
        reject(new Error(message));
      },
      {enableHighAccuracy:true,timeout:12000,maximumAge:force?0:120000}
    );
  });
}
async function techCheckWeatherForGps(coords,days=7){
  const lat=encodeURIComponent(Number(coords.latitude).toFixed(5));
  const lon=encodeURIComponent(Number(coords.longitude).toFixed(5));
  const url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon
    +'&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m'
    +'&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    +'&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days='+Math.max(1,Math.min(7,Number(days)||7));
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error('Local weather is unavailable right now.');
  const data=await response.json();
  data._gps={latitude:Number(coords.latitude),longitude:Number(coords.longitude),accuracy:Number(coords.accuracy||0),cached:Boolean(coords.cached)};
  return data;
}

let techWeatherRefreshTimer=null;
async function updateItWeather(force=false) {
  const weather = $('itWeatherNow');
  if (!weather || document.hidden) return;
  weather.textContent='Updating local weather…';
  try {
    const coords=await techCheckGpsPosition(force);
    const data=await techCheckWeatherForGps(coords,1);
    const current=data.current||{};
    const code=Number(current.weather_code);
    const condition=code===0?'Clear':code<=3?'Partly cloudy':code<=48?'Cloudy':code<=67?'Rain':code<=77?'Wintry':code<=82?'Showers':'Storms';
    weather.textContent=`${Math.round(Number(current.temperature_2m||0))}°F · ${condition} · Feels ${Math.round(Number(current.apparent_temperature||0))}° · updated ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`;
    clearInterval(techWeatherRefreshTimer);
    techWeatherRefreshTimer=setInterval(()=>updateItWeather(false),10*60*1000);
  } catch (error) {
    weather.textContent=error?.message||'Local GPS weather unavailable';
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
  const techScroll=which==='it'||which==='svc';
  document.documentElement.classList.toggle('tech-scroll-enabled',techScroll);
  document.body.classList.toggle('tech-scroll-enabled',techScroll);
  if(techScroll){
    document.documentElement.style.setProperty('overflow-y','auto','important');
    document.body.style.setProperty('overflow-y','auto','important');
    document.body.style.setProperty('height','auto','important');
  }else{
    document.documentElement.style.removeProperty('overflow-y');
    document.body.style.removeProperty('overflow-y');
    document.body.style.removeProperty('height');
  }
  window.dispatchEvent(new CustomEvent('techcheck:view-changed', { detail:{ view:which } }));
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
  if (realtimeStarted && liveChannel) return;
  realtimeStarted = true;
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
      { event: '*', schema: 'public', table: 'job_assignments' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'morning_checks' },
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
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'owner_job_reviews' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'field_escalations' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_truck_units' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_truck_stock' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_truck_inventory_checks' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_truck_restock_requests' },
      scheduleRefreshData
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'service_truck_sims' },
      scheduleRefreshData
    )
    .subscribe(s => {
      $('syncStatus').textContent = !navigator.onLine ? 'Offline — unsent field drafts stay on this device' : s === 'SUBSCRIBED' ? 'Live shared data connected' : 'Connecting shared data…';
    });
}
async function refreshData(options = {}) {
  if (!state.session) return;
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }
  refreshInFlight = refreshDataInner(options)
    .catch(error => { console.warn('Tech Check refresh failed', error); })
    .finally(() => {
      refreshInFlight = null;
      if (refreshQueued && state.session) {
        refreshQueued = false;
        scheduleRefreshData();
      }
    });
  return refreshInFlight;
}
function appTimeout(promise,label,ms=15000){
  return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out after '+Math.round(ms/1000)+'s')),ms))]);
}
async function loadPrepSnapshot(initial=false) {
  const historyLimit = initial ? 35 : 120;
  const [activeQ, recentQ] = await appTimeout(Promise.all([
    db.from('prep_tickets').select('*,prep_items(*)').neq('status','closed').order('created_at',{ascending:true}),
    db.from('prep_tickets').select('*,prep_items(*)').eq('status','closed').order('created_at',{ascending:false}).limit(historyLimit)
  ]),'Prep snapshot');
  if (activeQ.error && recentQ.error) return null;
  const byId = new Map();
  for (const row of (activeQ.data || [])) byId.set(row.id,row);
  for (const row of (recentQ.data || [])) if (!byId.has(row.id)) byId.set(row.id,row);
  return [...byId.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
}
async function refreshDataInner({ skipProfile=false, initial=false } = {}) {
  if (!state.session) return;

  if (!skipProfile) {
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
  }

  const prepRows = await loadPrepSnapshot(initial);
  if (prepRows) state.preps = prepRows;

  if (state.profile.role === 'owner') {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const selectedStart = dateFromKey(ownerDailyDate); selectedStart.setHours(0,0,0,0);
    const selectedEnd = new Date(selectedStart); selectedEnd.setDate(selectedEnd.getDate()+1);
    const reportLimit = initial ? 60 : 250;
    const historyLimit = initial ? 80 : 300;
    const registryLimit = initial ? 180 : 500;
    const [rep, prof, resets, returns, inspections, selectedInspections, assignments, registry, assets, assetHistory, accessHistory, ownerReviewQueue, fieldEscalations, truckSpareBatteries, ownerTechBoard] = await appTimeout(Promise.all([
      db.from('reports').select('*').order('created_at',{ascending:false}).limit(reportLimit),
      db.from('profiles').select('*').order('created_at',{ascending:true}),
      db.from('password_reset_requests').select('id,user_id,username,status,requested_at,expires_at,approved_at').in('status',['pending','approved']).order('requested_at',{ascending:false}).limit(30),
      db.from('unit_returns').select('id,ticket_no,unit_tag,equipment_type,status,returned_at,it_received_at,updated_at,service_tech_name,it_tech_name,return_notes,damage_notes').in('status',['waiting_it','pending_mhelp_inventory','needs_replacement']).order('returned_at',{ascending:true}),
      db.from('morning_checks').select('id,service_tech_id,truck_checks,taking_trailer,trailer_checks,truck_12v_110ah_qty,truck_12v_110ah_charged,truck_litime_12v_100ah_qty,truck_litime_12v_100ah_charged,backup_unit_type,backup_unit_tag,backup_it_checkout_verified,submitted_at').gte('submitted_at',dayStart.toISOString()).order('submitted_at',{ascending:false}),
      db.from('morning_checks').select('id,service_tech_id,truck_checks,taking_trailer,trailer_checks,truck_12v_110ah_qty,truck_12v_110ah_charged,truck_litime_12v_100ah_qty,truck_litime_12v_100ah_charged,backup_unit_type,backup_unit_tag,backup_it_checkout_verified,submitted_at').gte('submitted_at',selectedStart.toISOString()).lt('submitted_at',selectedEnd.toISOString()).order('submitted_at',{ascending:false}),
      db.from('job_assignments').select('*').eq('scheduled_for',ownerDailyDate).order('assigned_at',{ascending:true}),
      db.from('unit_registry').select('unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,current_holder_name,last_event,updated_at').order('updated_at',{ascending:false}).limit(registryLimit),
      db.from('asset_inventory').select('*').order('asset_category',{ascending:true}).order('unit_tag',{ascending:true}),
      db.from('asset_inventory_history').select('*').order('created_at',{ascending:false}).limit(historyLimit),
      db.from('team_access_history').select('*').order('created_at',{ascending:false}).limit(initial ? 40 : 100),
      db.rpc('owner_review_queue_v1',{p_limit:40}),
      db.from('field_escalations').select('id,ticket_no,site,unit_tag,equipment_type,status,service_tech_name,it_tech_name,original_problem,service_troubleshooting_notes,it_troubleshooting_notes,owner_summary,created_at,updated_at').is('resolved_at',null).order('updated_at',{ascending:false}).limit(100),
      db.from('truck_spare_batteries').select('*').eq('status','in_truck').order('accepted_at',{ascending:true}),
      db.rpc('owner_tech_command_board_v2',{p_date:localDateKey(new Date())})
    ]),'Owner production data');
    if (!rep.error) state.reports = rep.data || [];
    if (!prof.error) state.profiles = prof.data || [];
    if (!resets.error) state.resetRequests = resets.data || [];
    if (!returns.error) state.ownerReturns = returns.data || [];
    if (!inspections.error) state.todayInspections = inspections.data || [];
    if (!selectedInspections.error) state.dailyInspections = selectedInspections.data || [];
    if (!assignments.error) state.ownerAssignments = assignments.data || [];
    if (!registry.error) state.unitRegistry = registry.data || [];
    if (!assets.error) state.assetInventory = assets.data || [];
    if (!assetHistory.error) state.assetHistory = assetHistory.data || [];
    if (!accessHistory.error) state.accessHistory = accessHistory.data || [];
    if (!ownerReviewQueue.error) state.ownerReviewQueue = Array.isArray(ownerReviewQueue.data) ? ownerReviewQueue.data : [];
    if (!fieldEscalations.error) state.ownerFieldEscalations = fieldEscalations.data || [];
    if (!truckSpareBatteries.error) state.truckSpareBatteries = truckSpareBatteries.data || [];
    if (!ownerTechBoard.error) state.ownerTechCommandBoard = ownerTechBoard.data || null;
    renderOwner();
    renderOwnerUnitSearch();
    renderOwnerEquipment();
    renderOwnerTechOverview();
    renderOwnerAttention();
    renderOwnerReview();
    bindOwnerAppRouter();
    await ownerAppRender();
    renderPasswordResetRequests();
    renderUsers();
  }

  renderIT();
  renderMatched();
  updateMorningStatus();
  const sync = $('syncStatus');
  if (sync && navigator.onLine) sync.textContent = 'Live work loaded';

  // After the fast initial owner snapshot is interactive, quietly expand the
  // recent history once. This keeps launch fast without losing normal history.
  if (initial && state.profile.role === 'owner') {
    setTimeout(() => {
      if (!state.session || document.hidden) return;
      scheduleIdle(() => refreshData({ skipProfile:true, initial:false }), 1200);
    }, 4200);
  }
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
  if (['Solar Stand', '110V Stand', 'Pole'].includes(item?.equipment_type)) return true;
  return (
    !['DELIVERY','BACKUP'].includes(item.purpose) ||
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
  if (!['DELIVERY','BACKUP'].includes(item.purpose) || ['Solar Stand', '110V Stand', 'Pole'].includes(item.equipment_type)) return '';
  const delivery=item.purpose==='DELIVERY';
  return (
    '<div class="deliveryChecks"><div class="subhead">' + (delivery ? 'DELIVERY Readiness' : 'BACKUP Hardware Readiness') + '</div><div class="small">' +
      (delivery ? 'Customer-specific delivery setup plus hardware readiness is required.' : 'This truck spare must be hardware-ready. Customer email, Central Station monitoring, and MHelpDesk quantity are not falsely assigned unless the spare is actually used.') +
    '</div>' +
    '<div class="check"><input id="sim_' + item.id + '" type="checkbox"' + checked(item.delivery_sim_ok) + '><div><b>SIM card active and installed in router</b></div></div>' +
    '<div class="check"><input id="cam_' + item.id + '" type="checkbox"' + checked(item.delivery_camera_app_ok) + '><div><b>Camera is visible in the camera app</b></div></div>' +
    '<div class="check"><input id="sd_' + item.id + '" type="checkbox"' + checked(item.delivery_sd_formatted_ok) + '><div><b>SD card / NVR storage formatted and ready</b></div></div>' +
    '<div class="check"><input id="recording_' + item.id + '" type="checkbox"' + checked(item.delivery_recording_ok) + '><div><b>Recording footage confirmed</b></div></div>' +
    '<div class="check"><input id="charged_' + item.id + '" type="checkbox"' + checked(item.delivery_batteries_charged_ok) + '><div><b>Batteries / battery box charged and ready</b></div></div>' +
    (delivery
      ? '<div class="check"><input id="customeremail_' + item.id + '" type="checkbox"' + checked(item.delivery_customer_email_app_ok) + '><div><b>Unit/app added under the customer email account in the camera app</b></div></div>' +
        '<div class="check"><input id="monitor_' + item.id + '" type="checkbox"' + checked(item.delivery_monitoring_ok) + '><div><b>Central Station monitoring created and sent in</b></div></div>' +
        '<div class="check"><input id="count_' + item.id + '" type="checkbox"' + checked(item.delivery_ticket_count_ok) + '><div><b>This unit is included in the equipment type and quantity listed on the MHelpDesk ticket</b></div></div>'
      : '') +
    '</div>'
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
      (['DELIVERY','BACKUP'].includes(item.purpose)
        ? ' · All deploy-ready checks complete'
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
                  ' & Complete IT → Service Handoff'
                : 'Complete IT → Service Handoff') +
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
          ' before completing the IT → Service handoff.'
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
    if (['DELIVERY','BACKUP'].includes(item.purpose)) {
      const delivery=item.purpose==='DELIVERY';
      const sim = $('sim_' + item.id)?.checked || false,
        cam = $('cam_' + item.id)?.checked || false,
        customerEmail = delivery ? ($('customeremail_' + item.id)?.checked || false) : false,
        sd = $('sd_' + item.id)?.checked || false,
        recording = $('recording_' + item.id)?.checked || false,
        charged = $('charged_' + item.id)?.checked || false,
        monitor = delivery ? ($('monitor_' + item.id)?.checked || false) : false,
        count = delivery ? ($('count_' + item.id)?.checked || false) : false;
      const ready = sim && cam && sd && recording && charged && (!delivery || (customerEmail && monitor && count));
      if (!ready) {
        setBusy(false);
        await refreshData();
        return alert(
          'Complete all required ' + (delivery ? 'DELIVERY' : 'BACKUP hardware') + ' readiness checks for ' +
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
      ' now has a Service handoff ready for checkout.'
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
      : '<div class="bad"><b>No IT → Service handoff is ready for MHelpDesk Ticket #' +
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
    (item.purpose === 'BACKUP'
      ? '<div class="small"><b>Truck Spare:</b> ' + (item.spare_it_checked_out_at ? '✓ IT CHECKED OUT by ' + esc(item.spare_it_checked_out_by_name || 'IT Technician') : 'CHECKOUT PENDING — do not take this spare') + '</div>'
      : item.purpose === 'DELIVERY'
        ? '<div class="small">IT completed the deploy-ready checks before the handoff.</div>'
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
function truckLoadComplete() {
  const qty110=Math.max(0,Number($('truck110Qty')?.value || 0));
  const qtyLi=Math.max(0,Number($('truckLiTime100Qty')?.value || 0));
  const backup=String($('truckBackupType')?.value || '');
  return qty110>=4 && Boolean($('truck110Charged')?.checked)
    && qtyLi>=2 && Boolean($('truckLiTime100Charged')?.checked)
    && ['Spotter','Sniper','Solar Spotter'].includes(backup);
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
  const qty110=Math.max(0,Number($('truck110Qty')?.value || 0));
  const qtyLi=Math.max(0,Number($('truckLiTime100Qty')?.value || 0));
  if (qty110<4) issues.push('Need at least 4 × 12V 110Ah truck batteries');
  if (!$('truck110Charged')?.checked) issues.push('Physically verify the 12V 110Ah batteries are charged');
  if (qtyLi<2) issues.push('Need at least 2 × LiTime 12V 100Ah truck batteries');
  if (!$('truckLiTime100Charged')?.checked) issues.push('Physically verify the LiTime 12V 100Ah batteries are charged');
  if (!['Spotter','Sniper','Solar Spotter'].includes(String($('truckBackupType')?.value || ''))) issues.push('Choose the complete backup unit for today’s work');
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
  if (!truckLoadComplete())
    return msg('morningMessage', 'Verify the permanent truck battery minimum, confirm the batteries are charged, and choose today’s checked-out backup unit.', 'bad');
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
  const { error } = await db.rpc('submit_morning_check_v2', {
    p_mhelp_reviewed: true,
    p_truck_checks: truck,
    p_taking_trailer: $('takingTrailer').checked,
    p_trailer_checks: trailer,
    p_closed_ticket_nos: state.sessionClosed,
    p_truck_12v_110ah_qty: Math.max(0,Number($('truck110Qty')?.value || 0)),
    p_truck_12v_110ah_charged: Boolean($('truck110Charged')?.checked),
    p_truck_litime_12v_100ah_qty: Math.max(0,Number($('truckLiTime100Qty')?.value || 0)),
    p_truck_litime_12v_100ah_charged: Boolean($('truckLiTime100Charged')?.checked),
    p_backup_unit_type: String($('truckBackupType')?.value || ''),
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
  if ($('truck110Qty')) $('truck110Qty').value='';
  if ($('truck110Charged')) $('truck110Charged').checked=false;
  if ($('truckLiTime100Qty')) $('truckLiTime100Qty').value='';
  if ($('truckLiTime100Charged')) $('truckLiTime100Charged').checked=false;
  if ($('truckBackupType')) $('truckBackupType').value='';
  $('lookupMessage').innerHTML = '';
  renderSessionClosed();
  updateMorningStatus();
}

function ownerAgeHours(value) { const time = value ? new Date(value).getTime() : NaN; return Number.isFinite(time) ? Math.max(0,(Date.now()-time)/3600000) : 0; }
function ownerTechRoleName(profile) {
  const name = profile?.full_name || profile?.username || 'Technician';
  return profile?.role === 'it' ? 'IT Tech ' + name : profile?.role === 'service' ? 'Service Tech ' + name : profile?.role === 'owner' ? 'Owner/Admin ' + name : name;
}
function ownerActorLabel(report) {
  const profile=(state.profiles || []).find(p => p.user_id === report?.actor_id);
  if (profile) return ownerTechRoleName(profile);
  return report?.actor_name || 'Technician';
}
function inspectionSummary(row) {
  if (!row) return null;
  const truckValues=Object.values(row.truck_checks || {}).filter(v => typeof v === 'boolean');
  const trailerValues=Object.values(row.trailer_checks || {}).filter(v => typeof v === 'boolean');
  const truckFail=truckValues.includes(false);
  const trailerFail=Boolean(row.taking_trailer) && trailerValues.includes(false);
  const loadRecorded=Boolean(row.backup_unit_type)||Number(row.truck_12v_110ah_qty||0)>0||Number(row.truck_litime_12v_100ah_qty||0)>0||row.truck_12v_110ah_charged===true||row.truck_litime_12v_100ah_charged===true||row.backup_it_checkout_verified===true;
  const loadPass=!loadRecorded || (Number(row.truck_12v_110ah_qty||0)>=4
    && row.truck_12v_110ah_charged===true
    && Number(row.truck_litime_12v_100ah_qty||0)>=2
    && row.truck_litime_12v_100ah_charged===true
    && row.backup_it_checkout_verified===true
    && ['Spotter','Sniper','Solar Spotter'].includes(String(row.backup_unit_type||'')));
  return {
    failed: truckFail || trailerFail || !loadPass,
    truck: truckFail ? 'FAILED' : 'PASS',
    trailer: !row.taking_trailer ? 'Not taking trailer' : trailerFail ? 'FAILED' : 'PASS',
    load: !loadRecorded ? 'Legacy check — load not recorded' : loadPass
      ? Number(row.truck_12v_110ah_qty||0)+' × 12V 110Ah + '+Number(row.truck_litime_12v_100ah_qty||0)+' × LiTime 12V 100Ah · '+String(row.backup_unit_type||'Backup')+' '+String(row.backup_unit_tag||'')
      : 'NOT VERIFIED'
  };
}
function ownerAssignmentStatusLabel(a) {
  return a.status === 'completed' ? 'DONE' : a.status === 'started' ? 'IN PROCESS' : a.status === 'cancelled' ? 'CANCELLED' : a.assignee_user_id ? 'ASSIGNED' : 'DEPARTMENT QUEUE';
}
async function setOwnerDailyDate(value) {
  const next=String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
  ownerDailyDate=next;
  await refreshData();
}
async function moveOwnerDailyDate(days) { return setOwnerDailyDate(shiftDateKey(ownerDailyDate,days)); }
async function ownerDailyToday() { return setOwnerDailyDate(localDateKey(new Date())); }
function renderOwnerTechOverview() {
  if (state.profile?.role !== 'owner') return;
  const host=$('ownerTechOverview');
  if (!host) return;
  const today=localDateKey(new Date());
  const isToday=ownerDailyDate===today;
  const isPast=ownerDailyDate<today;
  const inspectionRequired=serviceInspectionRequiredForDate(ownerDailyDate);
  const techs=(state.profiles || [])
    .filter(p => p.active && !p.archived_at && (p.role==='it' || p.role==='service'))
    .sort((a,b) => (a.role===b.role ? String(a.full_name || a.username).localeCompare(String(b.full_name || b.username)) : a.role==='service' ? -1 : 1));
  const assignments=(state.ownerAssignments || []).filter(a => a.status !== 'cancelled');
  const inspectionMap=new Map();
  (state.dailyInspections || []).forEach(row => { if (!inspectionMap.has(row.service_tech_id)) inspectionMap.set(row.service_tech_id,row); });
  const missingService=inspectionRequired ? techs.filter(t => t.role==='service' && !inspectionMap.has(t.user_id)) : [];
  const queue=assignments.filter(a => !a.assignee_user_id && a.status==='assigned');
  const badge=$('ownerTechOverviewBadge');
  if (badge) {
    badge.textContent=isToday && inspectionRequired && missingService.length ? missingService.length + ' DUE' : String(techs.length);
    badge.classList.toggle('alert',isToday && inspectionRequired && missingService.length>0);
    badge.classList.toggle('neutral',!(isToday && inspectionRequired && missingService.length>0));
  }
  const techCards=techs.map(tech => {
    const name=ownerTechRoleName(tech);
    const jobs=assignments.filter(a => a.assignee_user_id===tech.user_id);
    const assets=(state.assetInventory || []).filter(a => a.assigned_to===tech.user_id && a.availability_status==='assigned');
    const inspection=tech.role==='service' ? inspectionMap.get(tech.user_id) : null;
    const ins=inspectionSummary(inspection);
    let dailyStatus='';
    if (tech.role==='service') {
      if (ins) {
        dailyStatus=`<div class='ownerDailyCheck ${ins.failed ? 'fail' : 'pass'}'><b>Daily Truck / Trailer Check · ${ins.failed ? 'NEEDS REVIEW' : 'SUBMITTED'}</b><span>Truck: ${esc(ins.truck)} · Trailer: ${esc(ins.trailer)} · Load: ${esc(ins.load)} · ${new Date(inspection.submitted_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</span></div>`;
      } else if (!inspectionRequired) {
        dailyStatus=`<div class='ownerDailyCheck info'><b>Daily Truck / Trailer Check · NOT REQUIRED</b><span>Weekend — Service inspections are Monday through Friday only.</span></div>`;
      } else {
        const label=isToday ? 'DUE TODAY' : isPast ? 'NOT SUBMITTED' : 'UPCOMING';
        dailyStatus=`<div class='ownerDailyCheck ${isToday || isPast ? 'missing' : ''}'><b>Daily Truck / Trailer Check · ${label}</b><span>${isToday ? 'Waiting for this Service Tech to submit the daily inspection.' : isPast ? 'No submitted inspection was found for this date.' : 'Daily inspection will be due on the selected work date.'}</span></div>`;
      }
    } else {
      dailyStatus=`<div class='ownerDailyCheck info'><b>IT Technician</b><span>Track assigned Tech Check jobs and equipment below.</span></div>`;
    }
    const jobHtml=jobs.length ? jobs.map(a => `<div class='ownerDailyJob'><div><b>MHelpDesk #${esc(a.ticket_no)}</b><span>${esc(a.site || 'No customer / site')} · ${esc(a.job_description || 'No job description')}</span>${a.requested_unit_count != null ? `<span>${Number(a.requested_unit_count)} unit${Number(a.requested_unit_count)===1?'':'s'} required</span>` : ''}</div><span class='pill ${a.status==='completed'?'green':a.status==='started'?'amber':''}'>${ownerAssignmentStatusLabel(a)}</span></div>`).join('') : `<div class='small ownerDailyEmpty'>No Tech Check tickets assigned to ${esc(name)} for this date.</div>`;
    const assetHtml=assets.length ? `<div class='ownerDailyAssets'><b>Current Assigned Equipment</b><div>${assets.map(a => `<span>${esc(a.unit_tag)} · ${esc(a.asset_type)}</span>`).join('')}</div></div>` : '';
    const roleClass=tech.role==='service'?'service':'it';
    return `<details class='ownerTechDayCard ${roleClass}' open><summary><div><b>${esc(name)}</b><span>${jobs.length} ticket${jobs.length===1?'':'s'} scheduled · ${assets.length} assigned asset${assets.length===1?'':'s'}</span></div><span class='pill roleBadge ${roleClass}'>${tech.role==='service'?'SERVICE':'IT'}</span></summary><div class='ownerTechDayBody'>${dailyStatus}<div class='ownerDailySectionLabel'>Assigned Work</div>${jobHtml}${assetHtml}</div></details>`;
  }).join('');
  const queueHtml=queue.length ? `<div class='ownerDepartmentQueue'><b>Unclaimed Department Tasks</b>${queue.map(a => `<div><span><b>${a.assigned_role==='it'?'IT':'SERVICE'} · MHelpDesk #${esc(a.ticket_no)}</b><small>${esc(a.site || '')} · ${esc(a.job_description || '')}</small></span><span class='pill amber'>WAITING TO CLAIM</span></div>`).join('')}</div>` : '';
  host.innerHTML=`
    <div class='ownerDailyToolbar'>
      <button class='mini' onclick="moveOwnerDailyDate(-1)">← Previous</button>
      <div class='ownerDailyDateCenter'><b>${esc(dateLabel(ownerDailyDate))}</b><input type='date' value='${esc(ownerDailyDate)}' onchange="setOwnerDailyDate(this.value)"></div>
      <button class='mini' onclick="moveOwnerDailyDate(1)">Next →</button>
      <button class='mini ownerTodayButton' onclick="ownerDailyToday()">Today</button>
    </div>
    <div class='ownerDailySummary'>
      <span><b>${techs.length}</b> active techs</span>
      <span><b>${assignments.length}</b> scheduled tickets</span>
      <span><b>${queue.length}</b> unclaimed</span>
      <span><b>${missingService.length}</b> Service checks ${inspectionRequired && !isToday ? 'missing' : 'due'}</span>
    </div>
    ${queueHtml}
    <div class='ownerTechDayGrid'>${techCards || '<div class="warn">No active IT or Service technicians.</div>'}</div>`;
}

async function ownerOpenTruckInventoryManager(){
  if(ownerAppRoute!=='team') await ownerAppNavigate('team');
  const first=(state.ownerTechCommandBoard?.service_techs||[])[0];
  if(!first)return alert('No active Service Tech truck inventory was found.');
  requestAnimationFrame(()=>{
    const card=document.querySelector('.ownerCmdTechCard');
    const editor=document.getElementById('ownerTruckEditor_'+first.service_tech_id);
    if(editor?.dataset.open!=='true') ownerToggleTruckInventoryEditor(first.service_tech_id);
    (editor||card)?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
function ownerOpenVisionAlert(button){
  ownerJump('vision',{ticket:button?.dataset?.visionTicket||'',alert:button?.dataset?.visionAlert||'workflow',detail:button?.dataset?.visionDetail||'Vision detected an active workflow issue.'});
}
function ownerJump(target, context={}) {
  if(target==='vision'){
    const p=new URLSearchParams();
    if(context.ticket)p.set('ticket',String(context.ticket));
    if(context.alert)p.set('alert',String(context.alert));
    if(context.detail)p.set('detail',String(context.detail));
    window.location.href='./onsite-vision.html'+(p.toString()?'?'+p.toString():'');
    return;
  }
  const routeMap={accounts:'accounts',review:'review',prep:'handoffs',returns:'handoffs',offline:'handoffs',daily:'team',activity:'activity'};
  const route=routeMap[target];
  if(route && typeof ownerAppNavigate==='function') ownerAppNavigate(route);
}
function ownerOpenReturn(id) {
  ownerAppNavigate('handoffs');
}

function ownerReviewStepClass(value) {
  const v=String(value || '').toLowerCase();
  if (v.startsWith('complete') || v.startsWith('no ') || v.startsWith('not required')) return 'complete';
  if (v.includes('missing information')) return 'missing';
  return 'pending';
}
function ownerReviewOverviewHtml(summary) {
  const o=summary?.overview || {};
  const rows=[
    ['Owner assigned',o.owner_assigned],
    ['IT completed',o.it_completed],
    ['IT → Service handoff',o.handoff_completed],
    ['Service completed',o.service_completed],
    ['Equipment / returns accounted for',o.equipment_returns_accounted_for],
    ['Evidence complete',o.evidence_complete],
  ];
  return '<div class="ownerReviewSteps">'+rows.map(([label,value]) =>
    '<div class="ownerReviewStep '+ownerReviewStepClass(value)+'"><span>'+esc(label)+'</span><b>'+esc(value || 'MISSING INFORMATION')+'</b></div>'
  ).join('')+'</div>';
}
function renderOwnerReview() {
  if (state.profile?.role !== 'owner') return;
  const host=$('ownerReviewQueue');
  if (!host) return;
  const rows=state.ownerReviewQueue || [];
  const ready=rows.filter(r=>r.ready_for_owner_review===true&&r.review_status!=='closed');
  const corrections=rows.filter(r=>r.review_status==='correction_requested'&&r.ready_for_owner_review!==true);
  const badge=$('ownerReviewBadge');
  if (badge) {
    badge.textContent=String(ready.length);
    badge.classList.toggle('alert',ready.length>0);
    badge.classList.toggle('neutral',ready.length===0);
  }
  const commandCenter=$('ownerCommandCenter');
  if (commandCenter) {
    commandCenter.dataset.readyReview=String(ready.length);
    const reviewButton=commandCenter.querySelector('[data-owner-command="review"]');
    const reviewCount=reviewButton?.querySelector('b');
    if (reviewCount) reviewCount.textContent=String(ready.length);
  }
  const card=$('ownerReviewCard');
  if (card?.tagName==='DETAILS' && (ready.length || corrections.length)) card.open=true;
  if (!rows.length) {
    host.innerHTML='<div class="ok"><b>✓ Nothing is waiting for Owner Review.</b><div class="small">Completed jobs will appear here after the recorded Tech Check workflow is finished.</div></div>';
    return;
  }
  host.innerHTML=rows.map(r=>{
    const ticket=esc(r.ticket_no || '');
    const site=esc(r.site || 'Site not recorded');
    if (r.review_status==='correction_requested'&&r.ready_for_owner_review!==true) {
      return '<div class="ownerReviewRow correction"><div class="ownerReviewHead"><div><b>MHelpDesk #'+ticket+' · '+site+'</b><span>RETURNED FOR CORRECTION</span></div></div>'
        +ownerReviewOverviewHtml(r)
        +'<div class="warn top8"><b>'+esc(String(r.correction_role || 'service').toUpperCase())+' correction active</b><div class="small">Automatically routed to the '+esc(String(r.correction_role || 'service').toUpperCase())+' Department queue · '+esc(r.correction_reason || 'Owner correction requested')+'</div></div>'
        +'<div class="row top8"><button class="mini" type="button" onclick="ownerJump(\'vision\')">Open Correction →</button><a class="mini" href="./onsite-vision.html">Ask Vision</a></div></div>';
    }
    return '<div class="ownerReviewRow ready"><div class="ownerReviewHead"><div><b>MHelpDesk #'+ticket+' · '+site+'</b><span>READY FOR OWNER REVIEW</span></div></div>'
      +ownerReviewOverviewHtml(r)
      +'<div class="ownerReviewActions"><button class="btn" type="button" onclick="ownerCloseJob(\''+ticket+'\')">Close Job</button><button class="mini danger" type="button" onclick="ownerReturnJobForCorrection(\''+ticket+'\')">Return for Correction</button></div>'
      +'<div class="small top8">Closing here finalizes the Tech Check review only. MHelpDesk remains separate.</div></div>';
  }).join('');
}
async function ownerCloseJob(ticketNo) {
  if (!confirm('Close MHelpDesk #'+ticketNo+' in Tech Check after reviewing the complete overview?')) return;
  setBusy(true);
  const { error }=await db.rpc('owner_close_job_v1',{p_ticket_no:String(ticketNo)});
  setBusy(false);
  if (error) return alert(error.message);
  await refreshData();
  alert('Tech Check Owner closeout saved. MHelpDesk was not changed.');
}
async function ownerReturnJobForCorrection(ticketNo) {
  const reason=prompt('What needs to be corrected before you will close this job?');
  if (reason===null) return;
  if (!String(reason).trim()) return alert('Enter the correction that is needed.');
  const target=prompt('Return this for correction to IT or Service?','Service');
  if (target===null) return;
  const role=String(target).trim().toLowerCase();
  if (!['it','service'].includes(role)) return alert('Enter IT or Service.');
  setBusy(true);
  const { data,error }=await db.rpc('owner_return_job_for_correction_v1',{
    p_ticket_no:String(ticketNo),
    p_reason:String(reason).trim(),
    p_role:role
  });
  setBusy(false);
  if (error) return alert(error.message);
  await refreshData();
  const queue=data?.correction_queue || (role==='it'?'IT Department':'Service Department');
  alert('Correction recorded and routed to '+queue+'. Prior completion history was preserved. MHelpDesk was not changed.');
}

function renderOwnerAttention() {
  if (state.profile?.role !== 'owner') return;
  const host = $('ownerAttention'); if (!host) return;
  const returns = state.ownerReturns || [];
  const corrections = (state.ownerReviewQueue || []).filter(r => r.review_status === 'correction_requested' && r.ready_for_owner_review !== true);
  const visionAlerts = state.ownerAIAlerts || [];
  const offlineEscalations = state.ownerFieldEscalations || [];
  const offlineOwnerRequired = offlineEscalations.filter(r => r.status === 'unresolved_owner');
  const drafts = state.preps.filter(p => p.status === 'draft');
  const released = state.preps.filter(p => p.status === 'released');
  const waitingIt = returns.filter(r => r.status === 'waiting_it');
  const manager = returns.filter(r => r.status === 'pending_mhelp_inventory');
  const replacements = returns.filter(r => r.status === 'needs_replacement');
  const resetPending = (state.resetRequests || []).filter(r => r.status === 'pending' && new Date(r.expires_at).getTime() > Date.now());
  const latestInspection = new Map(); (state.todayInspections || []).forEach(row => { if (!latestInspection.has(row.service_tech_id)) latestInspection.set(row.service_tech_id,row); });
  const failedInspections = [...latestInspection.values()].filter(row => inspectionSummary(row)?.failed);
  const overdueDrafts = drafts.filter(p => ownerAgeHours(p.created_at) >= 24);
  const overdueReleased = released.filter(p => ownerAgeHours(p.released_at || p.created_at) >= 24);
  const overdueReturns = waitingIt.filter(r => ownerAgeHours(r.returned_at) >= 24);
  const overdueManager = manager.filter(r => ownerAgeHours(r.it_received_at || r.updated_at) >= 24);
  const ownerActions = manager.length + replacements.length + resetPending.length + failedInspections.length + corrections.length + visionAlerts.length + offlineOwnerRequired.length;
  const offlineInProgress = Math.max(0,offlineEscalations.length-offlineOwnerRequired.length);
  const overdueCount = overdueDrafts.length + overdueReleased.length + overdueReturns.length + overdueManager.length;
  const attentionCount = ownerActions + offlineInProgress + overdueCount;
  const attentionBadge = $('ownerAttentionBadge');
  if (attentionBadge) {
    attentionBadge.textContent = String(attentionCount);
    attentionBadge.classList.toggle('alert', attentionCount > 0);
    attentionBadge.classList.toggle('neutral', attentionCount === 0);
  }
  const attentionCard = $('ownerAttentionCard');
  if (attentionCard?.tagName === 'DETAILS' && attentionCount > 0) attentionCard.open = true;
  const techName = id => state.profiles.find(p => p.user_id === id)?.full_name || state.profiles.find(p => p.user_id === id)?.username || 'Service Tech';
  const row = (kind,title,detail,target,urgent=false,context=null) => {const attrs=context?` data-vision-ticket="${esc(context.ticket||'')}" data-vision-alert="${esc(context.alert||'workflow')}" data-vision-detail="${esc(context.detail||detail)}" onclick="ownerOpenVisionAlert(this)"`:` onclick="ownerJump('${target}')"`;return `<div class='ownerAttentionRow ${urgent ? 'urgent' : ''}'><div><b>${esc(title)}</b><div class='small'>${esc(detail)}</div></div><button class='mini'${attrs}>Open →</button></div>`;};
  const nextOwner = replacements[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Damaged ${esc(replacements[0].equipment_type || 'equipment')} ${esc(replacements[0].unit_tag || '')} needs replacement / repair</b><div class='small'>MHelpDesk #${esc(replacements[0].ticket_no)} · Held in Maintenance · NOT available Shop Inventory.</div><button class='btn top10' onclick="ownerJump('returns')">Open Damage Record →</button></div>` : offlineOwnerRequired[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Offline Unit ${esc(offlineOwnerRequired[0].unit_tag || '')} needs your decision</b><div class='small'>MHelpDesk #${esc(offlineOwnerRequired[0].ticket_no || '—')} · Service and IT could not determine a solution.</div><button class='btn top10' onclick="ownerJump('offline')">Open Complete Summary →</button></div>` : corrections[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Correction active for MHelpDesk #${esc(corrections[0].ticket_no)}</b><div class='small'>Automatically routed to the ${esc(String(corrections[0].correction_role || 'service').toUpperCase())} Department queue · ${esc(corrections[0].correction_reason || 'Owner correction requested')}</div><button class='btn top10' onclick="ownerJump('vision')">Open Correction →</button></div>` : visionAlerts[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>ONSITE VISION ALERT</div><b>Review MHelpDesk #${esc(visionAlerts[0].ticket_no || '—')}</b><div class='small'>${esc(visionAlerts[0].detail || 'Vision detected an active workflow issue.')}${visionAlerts[0].acknowledged?' · ACKNOWLEDGED — remains active until resolved':''}</div><button class='btn top10' data-vision-ticket="${esc(visionAlerts[0].ticket_no||'')}" data-vision-alert="${esc(visionAlerts[0].id||'')}" data-vision-detail="${esc(visionAlerts[0].detail||'Vision detected an active workflow issue.')}" onclick="ownerOpenVisionAlert(this)">Open Vision Alert →</button></div>` : manager[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Return Unit ${esc(manager[0].unit_tag)} to Shop Inventory in MHelpDesk</b><div class='small'>MHelpDesk #${esc(manager[0].ticket_no)} · IT intake is complete.</div><button class='btn top10' onclick="ownerOpenReturn('${manager[0].id}')">Open This Unit →</button></div>` : resetPending[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Review password reset for ${esc(resetPending[0].username)}</b><div class='small'>Approve or deny the technician’s reset request.</div><button class='btn top10' onclick="ownerJump('accounts')">Review Reset Request →</button></div>` : failedInspections[0] ? `<div class='ownerNextAction'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>Review failed morning inspection</b><div class='small'>${esc(techName(failedInspections[0].service_tech_id))} has a current failed inspection today.</div><button class='btn top10' onclick="ownerJump('daily')">Open Technician Board →</button></div>` : `<div class='ownerNextAction clear'><div class='ownerNextKicker'>NEXT OWNER ACTION</div><b>✓ No Owner-only action is waiting.</b><div class='small'>You can monitor work in progress below without taking action right now.</div></div>`;
  const parts = [];
  if (offlineEscalations.length) parts.push(row(
    'offline',
    `${offlineEscalations.length} offline-unit escalation${offlineEscalations.length===1?'':'s'} active`,
    offlineEscalations.map(r => `Unit ${r.unit_tag || '—'} · #${r.ticket_no || '—'} · ${String(r.status || '').replaceAll('_',' ').toUpperCase()}${r.status==='unresolved_owner'?' · OWNER DECISION REQUIRED':''}`).join(' | '),
    'offline',
    offlineOwnerRequired.length>0
  ));
  if (replacements.length) parts.push(row('replacement',`${replacements.length} damaged equipment item${replacements.length===1?'':'s'} need replacement / repair`,replacements.map(r => `${r.equipment_type || 'Equipment'} ${r.unit_tag || ''} · #${r.ticket_no}`).join(' | '),'returns',true));
  if (corrections.length) parts.push(row('correction',`${corrections.length} job${corrections.length===1?'':'s'} returned for correction`,corrections.map(r => `#${r.ticket_no} · ${String(r.correction_role || 'service').toUpperCase()} · ${r.correction_reason || 'Owner correction requested'}`).join(' | '),'review',true));
  if (visionAlerts.length) parts.push(row('vision',`OnSite Vision detected ${visionAlerts.length} active issue${visionAlerts.length===1?'':'s'}`,visionAlerts.map(r => `#${r.ticket_no || '—'} · ${r.detail || 'Workflow issue'}${r.acknowledged?' · ACKNOWLEDGED':''}`).join(' | '),'vision',true,{ticket:visionAlerts[0].ticket_no||'',alert:visionAlerts[0].id||'workflow',detail:visionAlerts[0].detail||'Vision detected an active workflow issue.'}));
  if (manager.length) parts.push(row('manager',`${manager.length} return${manager.length===1?'':'s'} need your MHelpDesk inventory confirmation`,manager.map(r => `Unit ${r.unit_tag} · #${r.ticket_no}${ownerAgeHours(r.it_received_at || r.updated_at)>=24?' · OVER 24H':''}`).join(' | '),'returns',true));
  if (resetPending.length) parts.push(row('reset',`${resetPending.length} password reset request${resetPending.length===1?'':'s'} waiting for approval`,resetPending.map(r => r.username).join(' · '),'accounts',true));
  if (failedInspections.length) parts.push(row('inspection',`${failedInspections.length} current failed morning inspection${failedInspections.length===1?'':'s'} today`,failedInspections.map(r => techName(r.service_tech_id)).join(' · '),'activity',true));
  if (waitingIt.length) parts.push(row('intake',`${waitingIt.length} returned unit${waitingIt.length===1?'':'s'} waiting for IT intake`,waitingIt.map(r => `Unit ${r.unit_tag}${ownerAgeHours(r.returned_at)>=24?' · OVER 24H':''}`).join(' | '),'returns',overdueReturns.length>0));
  if (drafts.length) parts.push(row('prep',`${drafts.length} MHelpDesk ticket${drafts.length===1?'':'s'} still in IT prep`,drafts.map(p => `#${p.ticket_no}${ownerAgeHours(p.created_at)>=24?' · OVER 24H':''}`).join(' | '),'prep',overdueDrafts.length>0));
  if (released.length) parts.push(row('service',`${released.length} IT handoff${released.length===1?'':'s'} ready for Service`,released.map(p => `#${p.ticket_no}${ownerAgeHours(p.released_at || p.created_at)>=24?' · OVER 24H':''}`).join(' | '),'prep',overdueReleased.length>0));
  host.innerHTML = `${nextOwner}<div class='ownerAttentionStats'><span><b>${ownerActions}</b> needs you</span><span><b>${drafts.length + released.length + waitingIt.length + offlineInProgress}</b> in progress</span><span><b>${overdueCount}</b> over 24h</span></div>${parts.join('') || '<div class="ok"><b>✓ Nothing needs attention right now.</b><div class="small">No blocked, overdue, or Owner-action items are showing.</div></div>'}`;
}
function unitLifecycleLabel(status) { return ({shop_inventory:'SHOP INVENTORY',assigned_to_tech:'ASSIGNED TO TECH',maintenance:'MAINTENANCE',retired:'RETIRED',it_prep:'IT PREPARING',ready_for_service:'READY FOR SERVICE',deployed:'DEPLOYED / FIELD',returned_waiting_it:'RETURNED — WAITING IT',waiting_manager:'IT COMPLETE — WAITING MANAGER'})[status] || String(status || 'UNKNOWN').replaceAll('_',' ').toUpperCase(); }
function unitLifecycleClass(status) { return status === 'shop_inventory' ? 'green' : status === 'assigned_to_tech' ? 'delivery' : status === 'maintenance' || status === 'it_prep' || status === 'waiting_manager' ? 'amber' : status === 'retired' ? 'neutral' : status === 'deployed' ? 'delivery' : status === 'returned_waiting_it' ? 'swap' : 'green'; }
function ownerCompanyHistoryKindChanged() {
  const kind=String($('ownerCompanyHistoryKind')?.value || 'technician');
  const input=$('ownerCompanyHistoryQuery');
  if (!input) return;
  input.placeholder=kind==='unit' ? 'Unit number or asset tag' : kind==='site' ? 'Exact customer / site name' : 'Technician name or username';
  input.value='';
  const host=$('ownerCompanyHistoryResults');
  if (host) host.innerHTML='<div class="small">Enter the '+esc(kind==='site'?'customer / site':kind)+' to view its permanent Tech Check history.</div>';
}
function ownerCompanyHistorySubject(result) {
  const kind=String(result?.kind || '');
  const subject=result?.subject || {};
  if (kind==='technician') return subject.full_name || subject.username || result.query || 'Technician';
  if (kind==='unit') return 'Unit ' + String(subject.unit_tag || result.unit_key || result.query || '');
  return subject.site || result.query || 'Customer / Site';
}
function ownerWorkflowDisplayText(value) {
  return String(value ?? '')
    .replace(/equipment workflow\s*·\s*released/gi, 'Equipment workflow · IT → Service handoff completed')
    .replace(/IT EQUIPMENT SENT TO SERVICE/gi, 'IT → SERVICE HANDOFF COMPLETED')
    .replace(/sent equipment to Service/gi, 'created the Service handoff')
    .replace(/sent to Service/gi, 'handed off to Service');
}
function ownerCompanyHistoryEventHtml(event) {
  const when=event?.event_at ? new Date(event.event_at).toLocaleString() : 'Date not recorded';
  const refs=[event?.ticket_no ? 'MHelpDesk #'+event.ticket_no : '',event?.unit_tag ? 'Unit '+event.unit_tag : '',event?.site || '',event?.actor_name || ''].filter(Boolean);
  return '<div class="ownerCompanyHistoryEvent"><div><b>'+esc(ownerWorkflowDisplayText(String(event?.event_type || 'history').replaceAll('_',' ').toUpperCase()))+'</b><span>'+esc(when)+'</span></div>'
    +(refs.length?'<div class="small">'+refs.map(esc).join(' · ')+'</div>':'')
    +'<p>'+esc(ownerWorkflowDisplayText(event?.detail || 'Recorded Tech Check activity'))+'</p></div>';
}
async function ownerCompanyHistorySearch() {
  if (state.profile?.role !== 'owner') return;
  const kind=String($('ownerCompanyHistoryKind')?.value || 'technician');
  const value=String($('ownerCompanyHistoryQuery')?.value || '').trim();
  const host=$('ownerCompanyHistoryResults');
  if (!host) return;
  if (!value) { host.innerHTML='<div class="warn"><b>Enter what you want to find.</b><div class="small">Use a technician name or username, unit number, or exact customer / site name.</div></div>'; return; }
  host.innerHTML='<div class="small">Loading permanent company history…</div>';
  const response=await db.rpc('get_company_history_v1',{p_kind:kind,p_value:value,p_limit:100});
  if (response.error) { host.innerHTML='<div class="warn"><b>History could not be loaded.</b><div class="small">'+esc(response.error.message || 'Try again.')+'</div></div>'; return; }
  const result=response.data || {};
  const events=Array.isArray(result.events) ? result.events : [];
  if (!result.found) {
    host.innerHTML='<div class="warn"><b>MISSING INFORMATION</b><div class="small">No recorded '+esc(kind)+' history matched “'+esc(value)+'”. Vision and the Owner dashboard will not invent activity that is not in Tech Check.</div></div>';
    return;
  }
  host.innerHTML='<div class="ownerCompanyHistoryHead"><div><span>'+esc(kind.toUpperCase())+' HISTORY</span><b>'+esc(ownerCompanyHistorySubject(result))+'</b></div><strong>'+events.length+' event'+(events.length===1?'':'s')+'</strong></div>'
    +(events.length?events.map(ownerCompanyHistoryEventHtml).join(''):'<div class="warn"><b>MISSING INFORMATION</b><div class="small">The record exists, but no Tech Check history events are recorded yet.</div></div>');
}
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
  { key:'solar_panel_qty', id:'SolarPanels', label:'Additional Solar Panels' },
  { key:'battery_replacement_qty', id:'BatteryReplacements', label:'Additional Batteries' },
  { key:'camera_replacement_qty', id:'CameraReplacements', label:'Additional Cameras' },
  { key:'sim_replacement_qty', id:'SimReplacements', label:'Additional SIM Cards' },
  { key:'micro_sd_qty', id:'MicroSdCards', label:'Additional SD / Micro SD Cards' },
];
function ownerCleanPartQty(value) { return Math.max(0, Math.floor(Number(value || 0))); }
function ownerPartsRows(p) { return OWNER_TICKET_PARTS.map(part => ({...part, qty:ownerCleanPartQty(p?.[part.key])})); }
function ownerPartsSummary(p) {
  const rows=ownerPartsRows(p).filter(row=>row.qty>0);
  return '<div class="ownerPartsSummary top8"><b>Additional Loose Parts</b>' +
    (rows.length ? '<div class="ownerPartsChips">' + rows.map(row => '<span><b>'+row.qty+'</b> × '+esc(row.label)+'</span>').join('') + '</div>' : '<div class="small">None listed.</div>') +
    '</div>';
}
function ownerPartsEditor(p) {
  if (p.status !== 'draft') return ownerPartsSummary(p);
  return '<div class="ownerPartsEditor top8"><b>Additional Loose Parts</b><div class="small">Editable while IT is still preparing this ticket.</div><div class="ownerPartsGrid">' +
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


let ownerAppRoute='today';
function ownerAppHeader(kicker,title,description){
  return '<header class="ownerAppPageHeader"><span>'+esc(kicker)+'</span><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></header>';
}
function ownerAppEmpty(text,detail=''){
  return '<div class="ownerAppEmpty"><b>✓ '+esc(text)+'</b>'+(detail?'<span>'+esc(detail)+'</span>':'')+'</div>';
}
function ownerAppJobRow(a){
  const who=a.assignee_name||a.assigned_to_name||(a.assignment_scope==='department'?(a.assigned_role==='it'?'IT Department':'Service Department'):'Unassigned');
  const status=a.status==='started'?'WORKING':a.status==='completed'?'COMPLETE':'WAITING';
  const role=a.assigned_role==='it'?'IT':'SERVICE';
  const type=String(a.work_type||'service').toUpperCase();
  return '<article class="ownerTodayJob '+(a.status==='started'?'isWorking':a.status==='completed'?'isComplete':'isWaiting')+'">'
    +'<div class="ownerTodayJobMain"><div class="ownerTodayTicket"><span>MHELPDESK</span><b>#'+esc(a.ticket_no||'—')+'</b></div><div class="ownerTodaySite"><b>'+esc(a.site||'Customer / site not recorded')+'</b><span>'+esc(a.job_description||'No job description recorded')+'</span></div></div>'
    +'<div class="ownerTodayMeta"><span class="ownerTodayType">'+esc(type)+'</span><span class="ownerTodayRole '+role.toLowerCase()+'">'+role+'</span></div>'
    +'<div class="ownerTodayOwner"><b>'+esc(who)+'</b><span>'+esc(a.status==='started'?'Working now':a.status==='completed'?'Work complete':'Waiting to start')+'</span></div>'
    +'<div class="ownerTodayState"><span class="'+(a.status==='started'?'working':a.status==='completed'?'complete':'waiting')+'">'+status+'</span></div></article>';
}

let ownerCalendarDate=new Date(), ownerCalendarMode='month', ownerCalendarSelected=null, ownerCalendarRoleFilter='all';
let ownerCalendarSelectedJobId='';

function ownerCalendarAllRows(){
  return (state.ownerAssignments||[]).filter(a=>a.status!=='cancelled');
}
function ownerCalendarFilteredRows(){
  const rows=ownerCalendarAllRows();
  if(ownerCalendarRoleFilter==='it') return rows.filter(a=>a.assigned_role==='it');
  if(ownerCalendarRoleFilter==='service') return rows.filter(a=>a.assigned_role==='service');
  return rows;
}
function ownerCalendarJobsForDate(d){
  const key=localDateKey(d);
  return ownerCalendarFilteredRows().filter(a=>String(a.scheduled_for||'')===key);
}
function ownerCalendarRangeRows(){
  const rows=ownerCalendarFilteredRows();
  if(ownerCalendarMode==='day'){
    const key=localDateKey(ownerCalendarDate);
    return rows.filter(a=>String(a.scheduled_for||'')===key);
  }
  if(ownerCalendarMode==='week'){
    const start=new Date(ownerCalendarDate);start.setHours(12,0,0,0);start.setDate(start.getDate()-start.getDay());
    const end=new Date(start);end.setDate(end.getDate()+7);
    return rows.filter(a=>{
      const raw=String(a.scheduled_for||'');
      if(!raw)return false;
      const d=new Date(raw+'T12:00:00');
      return d>=start&&d<end;
    });
  }
  const y=ownerCalendarDate.getFullYear(),m=ownerCalendarDate.getMonth();
  return rows.filter(a=>{
    const raw=String(a.scheduled_for||'');
    if(!raw)return false;
    const d=new Date(raw+'T12:00:00');
    return d.getFullYear()===y&&d.getMonth()===m;
  });
}
function ownerCalendarShift(n){
  const d=new Date(ownerCalendarDate);
  if(ownerCalendarMode==='month') d.setMonth(d.getMonth()+n);
  else if(ownerCalendarMode==='week') d.setDate(d.getDate()+7*n);
  else d.setDate(d.getDate()+n);
  ownerCalendarDate=d;
  ownerCalendarSelected=localDateKey(d);
  ownerCalendarSelectedJobId='';
  ownerAppRender();
}
function ownerCalendarSetMode(m){
  ownerCalendarMode=['day','week','month'].includes(m)?m:'month';
  ownerCalendarSelected=localDateKey(ownerCalendarDate);
  ownerCalendarSelectedJobId='';
  ownerAppRender();
}
function ownerCalendarSetRoleFilter(role){
  ownerCalendarRoleFilter=['all','it','service'].includes(role)?role:'all';
  ownerCalendarSelectedJobId='';
  ownerAppRender();
}
function ownerCalendarToday(){
  ownerCalendarDate=new Date();
  ownerCalendarSelected=localDateKey(ownerCalendarDate);
  ownerCalendarSelectedJobId='';
  ownerAppRender();
}
function ownerCalendarSelect(key){
  ownerCalendarSelected=key;
  const jobs=ownerCalendarSelectedJobs();
  ownerCalendarSelectedJobId=jobs[0]?String(jobs[0].id||''):'';
  ownerAppRender();
}
function ownerCalendarDayCell(d,inMonth=true){
  const key=localDateKey(d),jobs=ownerCalendarJobsForDate(d),today=key===localDateKey(new Date()),sel=key===ownerCalendarSelected;
  const maxEvents=ownerCalendarMode==='week'?5:3;
  const events=jobs.slice(0,maxEvents).map(j=>{
    const role=j.assigned_role==='it'?'it':'service';
    const status=j.status==='started'?'working':j.status==='completed'?'complete':'waiting';
    const time=j.scheduled_time?String(j.scheduled_time).slice(0,5):'';
    return '<div class="ownerCalEvent '+role+' '+status+'"><div><b>#'+esc(j.ticket_no||'—')+'</b><span>'+esc(String(j.work_type||'Job').toUpperCase())+(time?' · '+esc(time):'')+'</span></div><strong>'+esc(j.site||'Site')+'</strong></div>';
  }).join('');
  const dots=jobs.length?'<div class="ownerCalDots">'+jobs.slice(0,3).map(j=>'<i class="'+(j.assigned_role==='it'?'it':'service')+'"></i>').join('')+(jobs.length>3?'<small>+'+(jobs.length-3)+'</small>':'')+'</div>':'';
  return '<button type="button" class="ownerCalDay '+(!inMonth?'muted ':'')+(today?'today ':'')+(sel?'selected ':'')+'" onclick="ownerCalendarSelect(\''+key+'\')">'
    +'<div class="ownerCalDate"><b>'+d.getDate()+'</b>'+(today?'<em>TODAY</em>':'')+(jobs.length?'<span>'+jobs.length+' job'+(jobs.length===1?'':'s')+'</span>':'')+'</div>'
    +dots+events
    +(jobs.length>maxEvents?'<small class="ownerCalMore">+'+(jobs.length-maxEvents)+' more</small>':'')
    +'</button>';
}
function ownerCalendarMonth(){
  const y=ownerCalendarDate.getFullYear(),m=ownerCalendarDate.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  let cells='';
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);cells+=ownerCalendarDayCell(d,d.getMonth()===m);}
  return '<div class="ownerCalScroll"><div class="ownerCalGridFrame"><div class="ownerCalWeekdays">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>'<b>'+x+'</b>').join('')+'</div><div class="ownerCalMonth">'+cells+'</div></div></div>';
}
function ownerCalendarWeek(){
  const d=new Date(ownerCalendarDate),start=new Date(d);start.setDate(d.getDate()-d.getDay());
  let cells='';
  for(let i=0;i<7;i++){const x=new Date(start);x.setDate(start.getDate()+i);cells+=ownerCalendarDayCell(x,true);}
  return '<div class="ownerCalScroll"><div class="ownerCalGridFrame ownerCalWeekFrame"><div class="ownerCalWeekdays">'+Array.from({length:7},(_,i)=>{const x=new Date(start);x.setDate(start.getDate()+i);return '<b>'+x.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})+'</b>';}).join('')+'</div><div class="ownerCalWeek">'+cells+'</div></div></div>';
}
function ownerCalendarDay(){
  const key=localDateKey(ownerCalendarDate);
  ownerCalendarSelected=key;
  const jobs=ownerCalendarJobsForDate(ownerCalendarDate).slice().sort((a,b)=>String(a.scheduled_time||'99:99').localeCompare(String(b.scheduled_time||'99:99')));
  const d=new Date(key+'T12:00:00');
  const rows=jobs.length?jobs.map(j=>{
    const id=esc(String(j.id||''));
    const role=j.assigned_role==='it'?'it':'service';
    const selected=String(j.id||'')===String(ownerCalendarSelectedJobId||'');
    const status=j.status==='started'?'working':j.status==='completed'?'complete':'waiting';
    const time=j.scheduled_time?new Date(key+'T'+String(j.scheduled_time).slice(0,8)).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Time not set';
    return '<button type="button" class="ownerCalDayJob '+role+' '+status+' '+(selected?'selected':'')+'" onclick="ownerCalendarOpenJob(\''+id+'\')">'
      +'<div class="ownerCalDayTime"><b>'+esc(time)+'</b><span>'+esc(role.toUpperCase())+'</span></div>'
      +'<div class="ownerCalDayJobMain"><span>MHELPDESK #'+esc(j.ticket_no||'—')+'</span><h3>'+esc(j.site||'Customer / Site')+'</h3><p>'+esc(j.job_description||'No job description recorded')+'</p></div>'
      +'<div class="ownerCalDayJobState"><b>'+esc(String(j.work_type||'Job').toUpperCase())+'</b><span>'+esc(ownerCalendarStatusLabel(j))+'</span></div>'
      +'</button>';
  }).join(''):'<div class="ownerCalDayEmpty"><b>No jobs scheduled</b><span>There are no Tech Check jobs on this day.</span><button class="btn" type="button" onclick="ownerCalendarNewJob()">＋ Create Job</button></div>';
  return '<div class="ownerCalDayView"><header><div><span>DAILY SCHEDULE</span><h2>'+d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})+'</h2></div><strong>'+jobs.length+' JOB'+(jobs.length===1?'':'S')+'</strong></header><div class="ownerCalDayJobs">'+rows+'</div></div>';
}

function ownerCalendarYear(){
  const y=ownerCalendarDate.getFullYear();
  return '<div class="ownerCalYear">'+Array.from({length:12},(_,m)=>{
    const jobs=ownerCalendarFilteredRows().filter(a=>{const raw=String(a.scheduled_for||'');if(!raw)return false;const x=new Date(raw+'T12:00:00');return x.getFullYear()===y&&x.getMonth()===m;});
    const it=jobs.filter(j=>j.assigned_role==='it').length,service=jobs.filter(j=>j.assigned_role==='service').length;
    return '<button type="button" onclick="ownerCalendarDate=new Date('+y+','+m+',1);ownerCalendarSetMode(\'month\')"><span>'+new Date(y,m,1).toLocaleDateString(undefined,{month:'short'}).toUpperCase()+'</span><b>'+new Date(y,m,1).toLocaleDateString(undefined,{month:'long'})+'</b><strong>'+jobs.length+'</strong><small>'+it+' IT · '+service+' Service</small></button>';
  }).join('')+'</div>';
}
function ownerCalendarSelectedJobs(){
  if(!ownerCalendarSelected)return [];
  return ownerCalendarFilteredRows().filter(a=>String(a.scheduled_for||'')===ownerCalendarSelected);
}
function ownerCalendarStatusLabel(j){
  return j.status==='started'?'WORKING':j.status==='completed'?'COMPLETE':j.status==='closed'?'CLOSED':'WAITING';
}
function ownerCalendarAgenda(){
  if(!ownerCalendarSelected)return '<section class="ownerCalAgenda"><div class="ownerCalRailEmpty"><b>Select a day</b><span>Choose a date on the calendar to see the jobs scheduled for it.</span></div></section>';
  const jobs=ownerCalendarSelectedJobs(),d=new Date(ownerCalendarSelected+'T12:00:00');
  return '<section class="ownerCalAgenda"><div class="ownerCalAgendaHead"><div><small>SELECTED DAY</small><h3>'+d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})+'</h3><span>'+jobs.length+' job'+(jobs.length===1?'':'s')+' scheduled</span></div><strong>'+jobs.length+'</strong></div>'
    +(jobs.length?'<div class="ownerCalAgendaList">'+jobs.map(j=>{
      const selected=String(j.id||'')===String(ownerCalendarSelectedJobId||'');
      const role=j.assigned_role==='it'?'IT':'SERVICE';
      const time=j.scheduled_time?String(j.scheduled_time).slice(0,5):'No time';
      return '<button type="button" data-owner-calendar-job="'+esc(String(j.id||''))+'" class="ownerCalAgendaJob '+(selected?'selected ':'')+(j.assigned_role==='it'?'it':'service')+'" onclick="ownerCalendarOpenJob(\''+esc(String(j.id||''))+'\')"><div class="ownerCalAgendaMain"><span>'+esc(role)+' · '+esc(time)+'</span><b>#'+esc(j.ticket_no||'—')+' · '+esc(j.site||'Customer / site')+'</b><small>'+esc(j.job_description||'No job description recorded')+'</small></div><div class="ownerCalAgendaState"><strong>'+esc(String(j.work_type||'Job').toUpperCase())+'</strong><em>'+esc(ownerCalendarStatusLabel(j))+'</em></div></button>';
    }).join('')+'</div>':ownerAppEmpty('NO JOBS ON THIS DAY','Pick another date or create a new Tech Check job.'))
    +'</section>';
}
function ownerCalendarOpenDayDetails(){
  const jobs=ownerCalendarSelectedJobs(); if(!jobs.length)return;
  ownerCalendarOpenJob(String(jobs[0].id||''));
}
function ownerCalendarServiceOrder(){
  const jobs=ownerCalendarSelectedJobs(),j=jobs.find(x=>String(x.work_type||'').toLowerCase()==='service')||jobs[0];
  if(j)ownerCalendarOpenJob(String(j.id||''));
}
function ownerCalendarNewJob(){ownerAppNavigate('assign');}
function ownerCalendarOpenJob(id){
  const job=ownerCalendarAllRows().find(x=>String(x.id)===String(id)); if(!job)return;
  const key=String(job.scheduled_for||'').slice(0,10);if(key)ownerCalendarSelected=key;
  ownerCalendarSelectedJobId=String(id);
  ownerAppRender();
}
function ownerCalendarInspector(){
  const jobs=ownerCalendarSelectedJobs(),job=jobs.find(j=>String(j.id)===String(ownerCalendarSelectedJobId))||jobs[0];
  if(!job)return '<section class="ownerCalInspector"><div class="ownerCalRailEmpty"><b>No job selected</b><span>Select a job from the selected day to see the Tech Check details.</span></div></section>';
  const service=(state.profiles||[]).find(p=>p.user_id===job.assignee_user_id);
  const who=job.assignee_name||job.assigned_to_name||service?.full_name||(job.assignment_scope==='department'?'Department Queue':'Unassigned');
  return '<section class="ownerCalInspector"><div class="ownerCalInspectorHead"><div><small>JOB DETAILS</small><h3>MHelpDesk #'+esc(job.ticket_no||'—')+'</h3><span>'+esc(job.site||'Customer / Site')+'</span></div><strong>'+esc(ownerCalendarStatusLabel(job))+'</strong></div>'
    +'<div class="ownerCalFacts"><span><small>WORK TYPE</small><b>'+esc(String(job.work_type||'job').toUpperCase())+'</b></span><span><small>DATE</small><b>'+esc(job.scheduled_for||'—')+'</b></span><span><small>TIME</small><b>'+esc(job.scheduled_time||job.work_time||'Not set')+'</b></span><span><small>DEPARTMENT</small><b>'+esc(job.assigned_role==='it'?'IT':'SERVICE')+'</b></span></div>'
    +'<div class="ownerCalInspectorSection"><small>ASSIGNED TO</small><b>'+esc(who)+'</b></div>'
    +(job.job_description?'<div class="ownerCalInspectorSection"><small>JOB</small><p>'+esc(job.job_description)+'</p></div>':'')
    +(job.notes?'<div class="ownerCalInspectorSection"><small>NOTES</small><p>'+esc(job.notes)+'</p></div>':'')
    +'<div class="ownerCalInspectorActions"><button class="btn" type="button" onclick="ownerAppNavigate(\'today\')">Open Live Workflow</button><button class="mini" type="button" onclick="ownerAppNavigate(\'history\')">View History</button></div>'
    +'</section>';
}
function ownerCalendarStats(){
  const rows=ownerCalendarRangeRows(),selected=ownerCalendarSelectedJobs();
  const it=rows.filter(j=>j.assigned_role==='it').length,service=rows.filter(j=>j.assigned_role==='service').length,working=rows.filter(j=>j.status==='started').length;
  return '<div class="ownerCalStats"><div><b>'+rows.length+'</b><span>IN THIS '+(ownerCalendarMode==='day'?'DAY':ownerCalendarMode==='week'?'WEEK':'MONTH')+'</span></div><div><b>'+selected.length+'</b><span>SELECTED DAY</span></div><div><b>'+it+'</b><span>IT JOBS</span></div><div><b>'+service+'</b><span>SERVICE JOBS</span></div><div><b>'+working+'</b><span>WORKING NOW</span></div></div>';
}
function ownerAppCalendar(){
  if(!ownerCalendarSelected) ownerCalendarSelected=localDateKey(ownerCalendarDate);
  if(ownerCalendarSelected&&!ownerCalendarSelectedJobId){
    const first=ownerCalendarSelectedJobs()[0];
    if(first)ownerCalendarSelectedJobId=String(first.id||'');
  }
  let label='';
  if(ownerCalendarMode==='month') label=ownerCalendarDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  else if(ownerCalendarMode==='week'){
    const start=new Date(ownerCalendarDate);start.setDate(start.getDate()-start.getDay());
    const end=new Date(start);end.setDate(end.getDate()+6);
    label='Week of '+start.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' – '+end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }else label=ownerCalendarDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const cal=ownerCalendarMode==='day'?ownerCalendarDay():ownerCalendarMode==='week'?ownerCalendarWeek():ownerCalendarMonth();
  const side=ownerCalendarMode==='day'?ownerCalendarInspector():ownerCalendarAgenda()+ownerCalendarInspector();
  return '<div class="ownerCalTop">'+ownerAppHeader('SCHEDULE','Calendar Command Center','Switch between daily, weekly, and monthly dispatch views without squeezing the schedule.')
    +'<div class="ownerCalQuick"><button class="btn" type="button" onclick="ownerCalendarNewJob()">＋ New Job</button><button class="mini" type="button" onclick="ownerAppNavigate(\'today\')">Live Work</button><button class="mini" type="button" onclick="ownerCalendarToday()">Today</button></div></div>'
    +ownerCalendarStats()
    +'<div class="ownerCalControlBar"><div class="ownerCalPeriod"><button aria-label="Previous" onclick="ownerCalendarShift(-1)">‹</button><button onclick="ownerCalendarToday()">Today</button><button aria-label="Next" onclick="ownerCalendarShift(1)">›</button><h2>'+esc(label)+'</h2></div>'
      +'<div class="ownerCalRoleFilters"><span>SHOW</span><button class="'+(ownerCalendarRoleFilter==='all'?'active':'')+'" onclick="ownerCalendarSetRoleFilter(\'all\')">All Jobs</button><button class="'+(ownerCalendarRoleFilter==='it'?'active':'')+'" onclick="ownerCalendarSetRoleFilter(\'it\')">IT</button><button class="'+(ownerCalendarRoleFilter==='service'?'active':'')+'" onclick="ownerCalendarSetRoleFilter(\'service\')">Service</button></div>'
      +'<div class="ownerCalModes"><button class="'+(ownerCalendarMode==='day'?'active':'')+'" onclick="ownerCalendarSetMode(\'day\')">Day</button><button class="'+(ownerCalendarMode==='week'?'active':'')+'" onclick="ownerCalendarSetMode(\'week\')">Week</button><button class="'+(ownerCalendarMode==='month'?'active':'')+'" onclick="ownerCalendarSetMode(\'month\')">Month</button></div></div>'
    +'<div class="ownerCalWorkspaceV2"><main class="ownerCalMain"><div class="ownerCalBoard">'+cal+'</div></main><aside class="ownerCalSideRail">'+side+'</aside></div>';
}

function ownerBoardTime(value){
  if(!value)return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}
function ownerBoardInitials(name){
  return String(name||'Tech').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'T';
}
function ownerBoardCheckRow(label,stateValue,detail,time=''){
  const cls=stateValue==='good'?'good':stateValue==='na'?'na':'bad';
  const icon=stateValue==='good'?'✓':stateValue==='na'?'—':'✕';
  return '<div class="ownerCmdReadyRow '+cls+'"><span>'+esc(label)+'</span><b><i>'+icon+'</i>'+esc(detail)+'</b><em>'+esc(time||'')+'</em></div>';
}
function ownerBoardStageHtml(stages){
  const rows=(Array.isArray(stages)?stages:[]).filter(s=>s.status!=='not_required');
  if(!rows.length)return '';
  return '<div class="ownerCmdJobFlow">'+rows.map((s,index)=>{
    const status=String(s.status||'waiting');
    const cls=status==='complete'?'complete':status==='working'?'working':'waiting';
    const icon=status==='complete'?'✓':status==='working'?'●':'○';
    return '<div class="ownerCmdFlowStep '+cls+'"><i>'+icon+'</i><span><b>'+esc(s.label||s.key||'Step')+'</b>'+(s.tech?'<small>'+esc(s.tech)+'</small>':'')+'</span></div>'+(index<rows.length-1?'<div class="ownerCmdFlowLine"></div>':'');
  }).join('')+'</div>';
}
function ownerBoardJobHtml(job){
  const flow=job.flow==='IT_TO_SERVICE'?'IT → SERVICE':job.flow==='SERVICE_TO_IT'?'SERVICE → IT':'SERVICE';
  const stage=String(job.current_stage||'WAITING').replaceAll('_',' ');
  const stageClass=/complete/i.test(stage)?'complete':/working|progress/i.test(stage)?'working':/owner|replacement|inventory/i.test(stage)?'danger':'waiting';
  const time=job.scheduled_time?String(job.scheduled_time).slice(0,5):'';
  return '<article class="ownerCmdJob '+stageClass+'">'
    +'<header><div><span>MHELPDESK</span><b>#'+esc(job.ticket_no||'—')+' · '+esc(job.site||'Site not recorded')+'</b></div><strong>'+esc(stage)+'</strong></header>'
    +'<div class="ownerCmdJobMeta"><span>'+esc(String(job.work_type||'service').toUpperCase())+'</span><span>'+esc(flow)+'</span>'+(time?'<span>'+esc(time)+'</span>':'')+'</div>'
    +(job.job_description?'<p>'+esc(job.job_description)+'</p>':'')
    +ownerBoardStageHtml(job.stages)
    +'</article>';
}
function ownerBoardUnitHtml(unit){
  const status=String(unit.status||'unassigned');
  const ok=status==='assigned'&&unit.unit_tag;
  let detail=ok?'Unit '+unit.unit_tag:'MISSING';
  let sub='';
  if(status==='used_restock_due'){
    detail=unit.unit_tag?'Unit '+unit.unit_tag+' · USED':'USED';
    sub=(unit.last_used_ticket_no?'Used at MHelpDesk #'+unit.last_used_ticket_no+'. ':'')+'Awaiting IT replacement.';
  }else if(!ok){
    sub='Permanent truck unit must be assigned by IT.';
  }
  return '<div class="ownerCmdUnitRow '+(ok?'good':'bad')+'"><span>'+esc(unit.equipment_type||'Unit')+'</span><b>'+esc(detail)+'</b><i>'+(ok?'✓':'!')+'</i>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>';
}
function ownerBoardStockRow(label,have,required){
  const ok=Number(have)>=Number(required);
  return '<div class="ownerCmdStockRow '+(ok?'good':'bad')+'"><span>'+esc(label)+'</span><b>'+Number(have||0)+' / '+Number(required)+'</b><i>'+(ok?'✓':'!')+'</i></div>';
}
function ownerBoardSimHtml(sim){
  const status=String(sim.status||'unassigned');
  const ok=status==='assigned'&&sim.sim_number;
  let detail=ok?'SIM '+sim.sim_number:'MISSING';
  let sub='';
  if(status==='used_restock_due'){
    detail=sim.sim_number?'SIM '+sim.sim_number+' · USED':'USED';
    sub=(sim.last_used_ticket_no?'Used at MHelpDesk #'+sim.last_used_ticket_no+'. ':'')+'IT replacement required.';
  }else if(!ok){
    sub='IT must assign an exact SIM number to this truck slot.';
  }
  return '<div class="ownerCmdUnitRow ownerCmdSimRow '+(ok?'good':'bad')+'"><span>SIM '+Number(sim.slot_no||0)+'</span><b>'+esc(detail)+'</b><i>'+(ok?'✓':'!')+'</i>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>';
}
function ownerBoardServiceTechCard(tech){
  const inspection=tech.inspection||{},inventory=tech.inventory_check||{},stock=tech.stock||{};
  const units=Array.isArray(tech.units)?tech.units:[];
  const sims=Array.isArray(tech.sims)?tech.sims:[];
  const jobs=Array.isArray(tech.jobs)?tech.jobs:[];
  const restocks=Array.isArray(tech.restock_requests)?tech.restock_requests:[];
  const missing=Array.isArray(tech.missing)?tech.missing:[];
  const ready=Boolean(tech.truck_ready);
  const truckState=inspection.truck_complete?'good':'bad';
  const trailerState=inspection.trailer_state==='not_taking'?'na':inspection.trailer_complete?'good':'bad';
  const trailerDetail=inspection.trailer_state==='not_taking'?'NOT TAKING':inspection.trailer_complete?'COMPLETE':'NOT COMPLETE';
  const stockComplete=Boolean(inventory.stock_complete);
  const verificationRequired=Boolean(inventory.verification_required);
  const inventoryState=inventory.ready?'good':stockComplete&&verificationRequired?'na':'bad';
  const inventoryDetail=inventory.ready?'COMPLETE':stockComplete&&verificationRequired?'AWAITING SERVICE VERIFY':'MISSING STOCK';
  const unitCount=units.filter(u=>u.status==='assigned'&&u.unit_tag).length;
  const simCount=sims.filter(s=>s.status==='assigned'&&s.sim_number).length;
  const restockSummary=restocks.length
    ? '<div class="ownerCmdRestock"><b>⚠ '+restocks.length+' IT RESTOCK ITEM'+(restocks.length===1?'':'S')+'</b>'+restocks.map(r=>'<span>'+esc(r.item_type)+' · '+esc(String(r.status||'requested').replaceAll('_',' ').toUpperCase())+(r.original_ticket_no?' · #'+esc(r.original_ticket_no):'')+'</span>').join('')+'</div>'
    : '';
  return '<section class="ownerCmdTechCard '+(ready?'ready':'notReady')+'">'
    +'<header class="ownerCmdTechHead"><div class="ownerCmdAvatar">'+esc(ownerBoardInitials(tech.name))+'</div><div><h2>'+esc(tech.name||'Service Tech')+'</h2><span>SERVICE TECHNICIAN</span></div><strong class="'+(ready?'ready':'danger')+'">'+(ready?'TRUCK READY':'NOT READY')+'</strong></header>'
    +'<div class="ownerCmdSection"><div class="ownerCmdSectionHead"><b>DAILY READINESS</b><span>'+esc(dateLabel((state.ownerTechCommandBoard&&state.ownerTechCommandBoard.date)||localDateKey(new Date())))+'</span></div>'
      +ownerBoardCheckRow('Truck Inspection',truckState,inspection.truck_complete?'COMPLETE':'NOT COMPLETE',inspection.submitted?ownerBoardTime(inspection.submitted_at):'')
      +ownerBoardCheckRow('Trailer Inspection',trailerState,trailerDetail,inspection.taking_trailer&&inspection.submitted?ownerBoardTime(inspection.submitted_at):'')
      +ownerBoardCheckRow('Truck Inventory',inventoryState,inventoryDetail,inventory.submitted?ownerBoardTime(inventory.submitted_at):'')
    +'</div>'
    +'<div class="ownerCmdSection"><div class="ownerCmdSectionHead"><b>TRUCK INVENTORY</b><span>'+unitCount+' / 4 units · '+simCount+' / 3 SIMs</span></div>'
      +'<div class="ownerCmdUnitList">'+units.map(ownerBoardUnitHtml).join('')+'</div>'
      +'<div class="ownerCmdSectionHead ownerCmdSubHead"><b>SIM CARDS · EXACT NUMBERS</b><span>'+simCount+' / 3</span></div>'
      +'<div class="ownerCmdUnitList ownerCmdSimList">'+sims.map(ownerBoardSimHtml).join('')+'</div>'
      +'<div class="ownerCmdStockList">'
        +ownerBoardStockRow('Recon Batteries',stock.recon_battery_qty,25)
        +ownerBoardStockRow('AGM 12V 110Ah',stock.agm_12v_110ah_qty,4)
        +ownerBoardStockRow('LiTime 12V 100Ah',stock.litime_12v_100ah_qty,2)
      +'</div>'
      +(missing.length?'<div class="ownerCmdMissingBanner"><b>⚠ MISSING TRUCK STOCK</b><span>'+missing.length+' required item'+(missing.length===1?'':'s')+' missing / not verified.</span></div>':'')
      +restockSummary
      +'<button type="button" class="ownerCmdInventoryEditBtn" data-owner-truck-edit="'+esc(tech.user_id||tech.service_tech_id)+'">✎ ADJUST THIS TRUCK INVENTORY</button>'
      +'<div id="ownerTruckEditor_'+esc(tech.user_id||tech.service_tech_id)+'" class="ownerCmdInventoryEditor" data-open="false"></div>'
    +'</div>'
    +'<div class="ownerCmdSection jobs"><div class="ownerCmdSectionHead"><b>TODAY’S JOBS</b><span>'+jobs.length+'</span></div>'
      +(jobs.length?'<div class="ownerCmdJobs">'+jobs.map(ownerBoardJobHtml).join('')+'</div>':'<div class="ownerCmdEmpty">No Service jobs assigned today.</div>')
    +'</div>'
    +'</section>';
}

function ownerTruckEditorTech(id){
  const rows=Array.isArray(state.ownerTechCommandBoard?.service_techs)?state.ownerTechCommandBoard.service_techs:[];
  return rows.find(t=>String(t.service_tech_id||t.user_id||t.tech_id)===String(id))||null;
}
async function ownerTruckEditorFetch(id){
  const {data,error}=await db.rpc('owner_service_truck_inventory_v1');
  if(error)throw error;
  const rows=Array.isArray(data)?data:[];
  const tech=rows.find(t=>String(t.service_tech_id||t.user_id)===String(id));
  if(!tech)throw new Error('Truck inventory record not found for this Service Tech.');
  return tech;
}
function ownerTruckEditorHtml(tech,id){
 const units=Array.isArray(tech.units)?tech.units:[],sims=Array.isArray(tech.sims)?tech.sims:[],stock=tech.stock||{},types=['Sniper','Ranger','Spotter','Solar Spotter'];
 return '<div class="ownerTruckEditorHead"><div><b>OWNER · EDIT '+esc(tech.name||'SERVICE TECH')+' TRUCK</b><span>Enter everything first. Nothing changes until you press SAVE ALL TRUCK INVENTORY.</span></div><button class="mini" type="button" data-owner-truck-edit="'+esc(id)+'">Close</button></div>'
 +'<div class="ownerTruckEditorLabel">UNITS · EXACT UNIT NUMBERS</div>'
 +types.map(type=>{const u=units.find(x=>x.equipment_type===type)||{},key=type.replaceAll(' ','_');return '<div class="ownerTruckEditRow ownerTruckEditNoButton"><div><b>'+esc(type)+'</b><span>'+(u.unit_tag?'Current · '+esc(u.unit_tag):'MISSING')+'</span></div><input id="ownerTruckUnit_'+esc(id)+'_'+key+'" value="'+esc(u.unit_tag||'')+'" placeholder="Enter '+esc(type)+' unit #"></div>';}).join('')
 +'<div class="ownerTruckEditorLabel">SIM CARDS · EXACT NUMBERS</div>'
 +[1,2,3].map(slot=>{const s=sims.find(x=>Number(x.slot_no)===slot)||{};return '<div class="ownerTruckEditRow ownerTruckEditNoButton"><div><b>SIM '+slot+'</b><span>'+(s.sim_number?'Current · '+esc(s.sim_number):'MISSING')+'</span></div><input id="ownerTruckSim_'+esc(id)+'_'+slot+'" value="'+esc(s.sim_number||'')+'" placeholder="Enter SIM '+slot+' number"></div>';}).join('')
 +'<div class="ownerTruckEditorLabel">BATTERY INVENTORY · ACTUAL COUNT ON TRUCK</div>'
 +[['Recon Battery','Recon Batteries',Number(stock.recon_battery_qty||0)],['AGM 12V 110Ah','AGM 12V 110Ah',Number(stock.agm_12v_110ah_qty||0)],['LiTime 12V 100Ah','LiTime 12V 100Ah',Number(stock.litime_12v_100ah_qty||0)]].map(([type,label,qty],i)=>'<div class="ownerTruckEditRow ownerTruckEditNoButton"><div><b>'+esc(label)+'</b><span>Current · '+qty+'</span></div><input id="ownerTruckStock_'+esc(id)+'_'+i+'" type="number" min="0" value="'+qty+'"></div>').join('')
 +'<div class="ownerTruckSaveBar"><span>Review all unit numbers, SIM numbers, and counts before saving.</span><button type="button" data-owner-save-all="'+esc(id)+'">SAVE ALL TRUCK INVENTORY</button></div>';
}
async function ownerFetchTruckInventory(id){const {data,error}=await db.rpc('owner_service_truck_inventory_v1');if(error)throw error;const rows=Array.isArray(data)?data:[];return rows.find(x=>String(x.service_tech_id||x.user_id)===String(id))||null;}
async function ownerToggleTruckInventoryEditor(id){const host=document.getElementById('ownerTruckEditor_'+id);if(!host)return alert('Truck editor container was not found.');if(host.dataset.open==='true'){host.dataset.open='false';host.style.display='none';host.innerHTML='';return;}host.dataset.open='loading';host.style.display='block';host.innerHTML='<div class="ownerTruckEditorHead"><b>LOADING CURRENT TRUCK INVENTORY…</b></div>';try{const tech=await ownerFetchTruckInventory(id);if(!tech)throw new Error('No truck inventory record exists for this technician.');host.innerHTML=ownerTruckEditorHtml(tech,id);host.dataset.open='true';host.style.display='block';requestAnimationFrame(()=>host.scrollIntoView({behavior:'smooth',block:'center'}));}catch(error){host.dataset.open='false';host.style.display='none';host.innerHTML='';alert('Truck inventory editor could not open: '+(error?.message||'unknown error'));}}
async function ownerSaveAllTruckInventory(id){
 const types=['Sniper','Ranger','Spotter','Solar Spotter'],units={},sims={},stock={};
 types.forEach(type=>units[type]=document.getElementById('ownerTruckUnit_'+id+'_'+type.replaceAll(' ','_'))?.value.trim()||'');
 [1,2,3].forEach(slot=>sims[String(slot)]=document.getElementById('ownerTruckSim_'+id+'_'+slot)?.value.trim()||'');
 [['Recon Battery',0],['AGM 12V 110Ah',1],['LiTime 12V 100Ah',2]].forEach(([type,i])=>stock[type]=Math.max(0,Math.floor(Number(document.getElementById('ownerTruckStock_'+id+'_'+i)?.value||0))));
 if(!confirm('Save ALL truck inventory for this technician? Service will be required to verify the truck again.'))return;
 setBusy(true);try{const {error}=await db.rpc('owner_save_service_truck_inventory_batch_v1',{p_service_tech_id:id,p_payload:{units,sims,stock}});if(error)throw error;await refreshData();alert('Truck inventory saved. Service must re-verify before leaving the shop.');}catch(error){alert('Could not save truck inventory: '+(error?.message||'unknown error'));}finally{setBusy(false);}
}
document.addEventListener('click',function(e){const edit=e.target.closest?.('[data-owner-truck-edit]');if(edit){e.preventDefault();e.stopPropagation();return ownerToggleTruckInventoryEditor(edit.dataset.ownerTruckEdit);}const save=e.target.closest?.('[data-owner-save-all]');if(save){e.preventDefault();e.stopPropagation();return ownerSaveAllTruckInventory(save.dataset.ownerSaveAll);}},true);

function ownerBoardITSupportHtml(itTechs){
  const techs=Array.isArray(itTechs)?itTechs:[];
  if(!techs.length)return '';
  return '<section class="ownerCmdITSection"><header><div><span>IT SUPPORT</span><h2>IT Technicians</h2></div><strong>'+techs.length+'</strong></header><div class="ownerCmdITGrid">'
    +techs.map(t=>{
      const jobs=Array.isArray(t.jobs)?t.jobs:[];
      const current=jobs.find(j=>j.status==='started')||jobs.find(j=>j.status==='assigned')||jobs[0];
      return '<article class="ownerCmdITCard"><div class="ownerCmdAvatar small">'+esc(ownerBoardInitials(t.name))+'</div><div><b>'+esc(t.name||'IT Technician')+'</b><span>IT TECHNICIAN</span></div><div class="ownerCmdITWork"><b>'+(current?'MHelpDesk #'+esc(current.ticket_no):'No active job')+'</b><span>'+esc(current?(String(current.status||'').toUpperCase()+' · '+(current.site||'No site')):'Available / waiting')+'</span></div><strong>'+jobs.length+' job'+(jobs.length===1?'':'s')+'</strong></article>';
    }).join('')
    +'</div></section>';
}
function ownerTechCommandBoardHtml(mode='today'){
  const board=state.ownerTechCommandBoard;
  if(!board)return ownerAppHeader('OWNER COMMAND CENTER',mode==='team'?'Technician Command Board':'Owner Command Center','Live technician readiness, permanent truck inventory, and IT ↔ Service job workflow.')+ownerAppEmpty('LOADING TECHNICIAN COMMAND BOARD','Refresh if this remains visible.');
  const service=Array.isArray(board.service_techs)?board.service_techs:[];
  const summary=board.summary||{};
  const summaryHtml='<div class="ownerCmdSummary">'
    +'<div><b>'+Number(summary.service_techs||service.length)+'</b><span>SERVICE TECHS</span></div>'
    +'<div><b>'+Number(summary.active_jobs||0)+'</b><span>ACTIVE JOBS</span></div>'
    +'<div class="'+(Number(summary.waiting_it||0)>0?'alert':'')+'"><b>'+Number(summary.waiting_it||0)+'</b><span>WAITING ON IT</span></div>'
    +'<div class="'+(Number(summary.truck_restock_needed||0)>0?'alert':'')+'"><b>'+Number(summary.truck_restock_needed||0)+'</b><span>TRUCK RESTOCK NEEDED</span></div>'
    +'</div>';
  const title=mode==='team'?'Technician Command Board':'Owner Command Center';
  const desc='Truck / trailer inspection, required truck inventory, exact unit numbers, stock shortages, and each job’s IT ↔ Service progress — one live board on desktop and mobile.';
  return ownerAppHeader('LIVE OPERATIONS',title,desc)
    +summaryHtml
    +'<div class="ownerCmdBoardMeta"><span>Updated '+ownerBoardTime(board.generated_at)+'</span><button type="button" class="mini" onclick="refreshData()">↻ Refresh Live Board</button></div>'
    +'<div class="ownerCmdTechGrid">'+(service.length?service.map(ownerBoardServiceTechCard).join(''):ownerAppEmpty('NO ACTIVE SERVICE TECHNICIANS'))+'</div>'
    +ownerBoardITSupportHtml(board.it_techs);
}


function ownerWeatherMeta(code,isDay=1){
  const c=Number(code);
  if(c===0)return {icon:isDay?'☀️':'🌙',label:'Clear',kind:'sun'};
  if(c<=2)return {icon:isDay?'🌤️':'☁️',label:'Partly Cloudy',kind:'cloud'};
  if(c===3)return {icon:'☁️',label:'Cloudy',kind:'cloud'};
  if(c<=48)return {icon:'🌫️',label:'Fog',kind:'cloud'};
  if(c<=57)return {icon:'🌦️',label:'Drizzle',kind:'rain'};
  if(c<=67)return {icon:'🌧️',label:'Rain',kind:'rain'};
  if(c<=77)return {icon:'❄️',label:'Wintry',kind:'snow'};
  if(c<=82)return {icon:'🌦️',label:'Showers',kind:'rain'};
  if(c<=86)return {icon:'🌨️',label:'Snow Showers',kind:'snow'};
  if(c>=95)return {icon:'⛈️',label:'Thunderstorms',kind:'storm'};
  return {icon:'🌤️',label:'Weather',kind:'cloud'};
}
async function ownerEnsureWeather(force=false){
  const host=document.getElementById('ownerTodayWeatherHost');
  if(host&&!state.ownerWeatherData)host.innerHTML='<div class="ownerWeatherLoading">Reading your GPS location for local weather…</div>';
  try{
    const coords=await techCheckGpsPosition(force);
    const cachedGps=state.ownerWeatherData?._gps;
    const fresh=state.ownerWeatherData&&Date.now()-Number(state.ownerWeatherLoadedAt||0)<20*60*1000&&techCheckCoordsNear(coords,cachedGps);
    if(fresh&&!force){ownerRenderWeather();return state.ownerWeatherData;}
    state.ownerWeatherData=await techCheckWeatherForGps(coords,7);
    state.ownerWeatherLoadedAt=Date.now();
  }catch(error){
    if(host)host.innerHTML='<div class="ownerWeatherError"><b>Location needed for weather</b><span>'+esc(error?.message||'Your GPS location could not be read.')+'</span><button class="mini" type="button" onclick="ownerEnsureWeather(true)">USE MY CURRENT LOCATION</button></div>';
    return null;
  }
  ownerRenderWeather();
  return state.ownerWeatherData;
}
function ownerWeatherForecastHtml(data){
  const daily=data?.daily||{},times=daily.time||[];
  if(!times.length)return '';
  return '<div class="ownerWeatherWeek">'+times.slice(0,7).map((date,index)=>{
    const meta=ownerWeatherMeta(daily.weather_code?.[index],1);
    const d=new Date(date+'T12:00:00');
    const day=index===0?'TODAY':d.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase();
    const rain=Number(daily.precipitation_probability_max?.[index]||0);
    return '<article class="ownerWeatherDay '+meta.kind+'"><span>'+day+'</span><i>'+meta.icon+'</i><b>'+Math.round(Number(daily.temperature_2m_max?.[index]||0))+'°</b><small>'+Math.round(Number(daily.temperature_2m_min?.[index]||0))+'° low</small><em>'+rain+'% rain</em></article>';
  }).join('')+'</div>';
}
function ownerRenderWeather(){
  const host=document.getElementById('ownerTodayWeatherHost'),data=state.ownerWeatherData;
  if(!host||!data)return;
  const current=data.current||{},meta=ownerWeatherMeta(current.weather_code,current.is_day);
  const todayCode=data.daily?.weather_code?.[0];
  const todayMeta=ownerWeatherMeta(todayCode,1);
  const high=Math.round(Number(data.daily?.temperature_2m_max?.[0]||current.temperature_2m||0));
  const low=Math.round(Number(data.daily?.temperature_2m_min?.[0]||current.temperature_2m||0));
  const rain=Math.round(Number(data.daily?.precipitation_probability_max?.[0]||0));
  const gps=data._gps||{};
  const accuracy=Number(gps.accuracy||0);
  const locationLine=(gps.cached?'LAST GPS LOCATION':'CURRENT GPS LOCATION')+(accuracy?' · ±'+Math.round(accuracy)+' m':'');
  host.innerHTML='<section class="ownerWeatherNow '+meta.kind+'"><div class="ownerWeatherIcon">'+meta.icon+'</div><div class="ownerWeatherCurrent"><span>LOCAL WEATHER · GPS</span><div><b>'+Math.round(Number(current.temperature_2m||0))+'°</b><strong>'+esc(meta.label)+'</strong></div><small>Feels '+Math.round(Number(current.apparent_temperature||0))+'° · Wind '+Math.round(Number(current.wind_speed_10m||0))+' mph</small><em>'+esc(locationLine)+'</em></div><div class="ownerWeatherToday"><span>TODAY</span><b>'+todayMeta.icon+' '+high+'° / '+low+'°</b><small>'+rain+'% chance of rain</small></div></section>'+ownerWeatherForecastHtml(data);
}
function ownerTodayGreeting(){
  const h=new Date().getHours();
  return h<12?'Good morning':h<18?'Good afternoon':'Good evening';
}
function ownerTodayName(){
  const raw=state.profile?.full_name||state.profile?.username||'James';
  return String(raw).trim().split(/\s+/)[0]||'James';
}
function ownerTodayClockTick(){
  const clock=document.getElementById('ownerTodayClock');
  const date=document.getElementById('ownerTodayDate');
  const greeting=document.getElementById('ownerTodayGreeting');
  if(!clock)return;
  const now=new Date();
  clock.textContent=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).replace(/\s?(AM|PM)$/,' $1');
  if(date)date.textContent=now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  if(greeting)greeting.textContent=ownerTodayGreeting()+', '+ownerTodayName();
}
function ownerStartTodayLive(){
  clearInterval(window.ownerTodayClockTimer);
  clearInterval(window.ownerTodayWeatherTimer);
  ownerTodayClockTick();
  window.ownerTodayClockTimer=setInterval(ownerTodayClockTick,1000);
  ownerEnsureWeather(true);
  window.ownerTodayWeatherTimer=setInterval(()=>ownerEnsureWeather(true),10*60*1000);
}
function ownerTodayReadinessHtml(){
  const techs=Array.isArray(state.ownerTechCommandBoard?.service_techs)?state.ownerTechCommandBoard.service_techs:[];
  if(!techs.length)return '';
  return '<section class="ownerTodayPanel"><header><div><span>TEAM READINESS</span><h2>Service Trucks</h2></div><div class="ownerTodayHeaderActions"><button class="mini" type="button" onclick="ownerOpenTruckInventoryManager()">Manage Truck Inventory</button><button class="mini" type="button" onclick="ownerAppNavigate(\'team\')">Open Team Board →</button></div></header><div class="ownerTodayReadinessGrid">'+techs.map(t=>{
    const inspection=t.inspection||{},inv=t.inventory_check||{};
    const sims=Array.isArray(t.sims)?t.sims:[];
    const simCount=sims.filter(s=>s.status==='assigned'&&s.sim_number).length;
    const ready=Boolean(t.truck_ready);
    return '<article class="ownerTodayReadyCard '+(ready?'ready':'notReady')+'"><div><b>'+esc(t.name||'Service Tech')+'</b><span>'+(ready?'READY TO LEAVE SHOP':'NOT READY')+'</span></div><div class="ownerTodayReadyChecks"><i class="'+(inspection.truck_complete?'good':'bad')+'">Truck '+(inspection.truck_complete?'✓':'✕')+'</i><i class="'+(inspection.trailer_state==='not_taking'||inspection.trailer_complete?'good':'bad')+'">Trailer '+(inspection.trailer_state==='not_taking'?'N/A':inspection.trailer_complete?'✓':'✕')+'</i><i class="'+(simCount===3?'good':'bad')+'">SIMs '+simCount+'/3</i><i class="'+(inv.ready?'good':inv.stock_complete?'neutral':'bad')+'">Inventory '+(inv.ready?'✓':inv.stock_complete?'VERIFY':'✕')+'</i></div></article>';
  }).join('')+'</div></section>';
}
function ownerTodayJobsHtml(){
  const today=localDateKey(new Date());
  const rows=(state.ownerAssignments||[]).filter(a=>String(a.scheduled_for||'')===today&&a.status!=='cancelled');
  const open=rows.filter(a=>a.status!=='completed'),working=rows.filter(a=>a.status==='started'),waiting=rows.filter(a=>a.status==='assigned'),complete=rows.filter(a=>a.status==='completed');
  return '<section class="ownerTodayPanel"><header><div><span>TODAY’S OPERATIONS</span><h2>'+rows.length+' Scheduled Job'+(rows.length===1?'':'s')+'</h2></div><button class="mini" type="button" onclick="ownerAppNavigate(\'calendar\')">Open Calendar →</button></header>'
    +'<div class="ownerTodayMiniStats"><div><b>'+open.length+'</b><span>OPEN</span></div><div><b>'+working.length+'</b><span>WORKING</span></div><div><b>'+waiting.length+'</b><span>WAITING</span></div><div><b>'+complete.length+'</b><span>COMPLETE</span></div></div>'
    +(rows.length?'<div class="ownerTodayJobsList">'+rows.map(ownerAppJobRow).join('')+'</div>':ownerAppEmpty('NO TECH CHECK JOBS SCHEDULED TODAY'))
    +'</section>';
}

function ownerAppToday(){
  const greeting=ownerTodayGreeting()+', '+ownerTodayName();
  return '<section class="ownerTodayHero"><div class="ownerTodayWelcome"><span>CAMERAS ONSITE · OWNER</span><h1 id="ownerTodayGreeting">'+esc(greeting)+'</h1><p>Here’s what is happening today.</p></div><div class="ownerTodayClockCard"><div id="ownerTodayClock" class="ownerTodayClock">--:--:--</div><span id="ownerTodayDate"></span></div></section>'
    +'<div id="ownerTodayWeatherHost" class="ownerTodayWeatherHost">'+(state.ownerWeatherData?'':'<div class="ownerWeatherLoading">Reading your GPS location for local weather…</div>')+'</div>'
    +ownerTodayReadinessHtml()
    +ownerTodayJobsHtml();
}
function ownerAppAttention(){
  return ownerAppHeader('OWNER ACTION','Needs Attention','Only real items that require your action right now.')+'<div id="ownerAttention" class="ownerAppAttentionHost"><div class="small">Loading items that need attention…</div></div>';
}
function ownerAppReview(){
  const rows=state.ownerReviewQueue||[];
  const ready=rows.filter(r=>r.ready_for_owner_review===true&&r.review_status!=='closed');
  const corrections=rows.filter(r=>r.review_status==='correction_requested'&&r.ready_for_owner_review!==true);
  const rowHtml=r=>{
    const ticket=esc(r.ticket_no||''),site=esc(r.site||'Site not recorded');
    if(r.review_status==='correction_requested'&&r.ready_for_owner_review!==true){
      return '<article class="ownerAppReviewRow correction"><header><div><small>MHELPDESK</small><b>#'+ticket+' · '+site+'</b></div><strong>RETURNED FOR CORRECTION</strong></header>'+ownerReviewOverviewHtml(r)+'<div class="ownerAppReviewNote"><b>'+esc(String(r.correction_role||'service').toUpperCase())+' correction active</b><span>'+esc(r.correction_reason||'Owner correction requested')+'</span></div></article>';
    }
    return '<article class="ownerAppReviewRow ready"><header><div><small>MHELPDESK</small><b>#'+ticket+' · '+site+'</b></div><strong>READY FOR OWNER REVIEW</strong></header>'+ownerReviewOverviewHtml(r)+'<div class="ownerAppReviewActions"><button class="btn" type="button" onclick="ownerCloseJob(\''+ticket+'\')">Close Job</button><button class="mini danger" type="button" onclick="ownerReturnJobForCorrection(\''+ticket+'\')">Return for Correction</button></div><p>Closing here finalizes Tech Check only. MHelpDesk remains separate.</p></article>';
  };
  let body='';
  if(ready.length)body+='<section class="ownerAppGroup"><h2>Ready for your review <span>'+ready.length+'</span></h2>'+ready.map(rowHtml).join('')+'</section>';
  if(corrections.length)body+='<section class="ownerAppGroup"><h2>Corrections in progress <span>'+corrections.length+'</span></h2>'+corrections.map(rowHtml).join('')+'</section>';
  return ownerAppHeader('FINAL REVIEW','Owner Review','Jobs waiting for your review, correction decision, or final closeout.')+(body||ownerAppEmpty('NOTHING IS WAITING FOR OWNER REVIEW','Completed jobs appear here after the required Tech Check workflow is finished.'));
}
function ownerAppTeam(){ return ownerTechCommandBoardHtml('team'); }
function ownerAppShowTechHistory(id){
  const t=(state.profiles||[]).find(p=>p.user_id===id);if(!t)return;
  const q=document.getElementById('ownerCompanyHistoryQuery'),k=document.getElementById('ownerCompanyHistoryKind');
  if(k)k.value='technician';if(q)q.value=t.full_name||t.username||'';
  ownerAppNavigate('history');ownerCompanyHistorySearch();
}
function ownerAppUnits(){
  renderOwnerUnitSearch();
  const rows=(state.unitRegistry||[]);
  return ownerAppHeader('EQUIPMENT','Units','Search a unit and see location, technician, status, last activity, and MHelpDesk reference.')
    +'<div class="ownerAppSearch"><input id="ownerAppUnitSearch" type="search" placeholder="Search unit number / tag" oninput="ownerAppFilterUnits(this.value)"></div>'
    +'<div id="ownerAppUnitResults">'+ownerAppUnitRows(rows.slice(0,30))+'</div>';
}
function ownerAppUnitRows(rows){
  if(!rows.length)return ownerAppEmpty('NO UNITS MATCH YOUR SEARCH');
  return rows.map(r=>'<div class="ownerAppUnitRow"><div><b>'+esc(r.equipment_type||'Equipment')+' · '+esc(r.unit_tag||'—')+'</b><span>'+esc(unitLifecycleLabel(r.lifecycle_status))+'</span></div><div><b>'+esc(r.current_holder_name||'No technician assigned')+'</b><span>'+esc(r.last_event||'No activity recorded')+'</span></div><div><b>'+(r.ticket_no?'MHelpDesk #'+esc(r.ticket_no):'No MHelpDesk ticket')+'</b><span>'+esc(r.current_site||'Location not recorded')+'</span></div></div>').join('');
}
function ownerAppFilterUnits(q){
  q=String(q||'').trim().toLowerCase();
  const rows=(state.unitRegistry||[]).filter(r=>!q||String(r.unit_tag||'').toLowerCase().includes(q)||String(r.equipment_type||'').toLowerCase().includes(q));
  const h=document.getElementById('ownerAppUnitResults');if(h)h.innerHTML=ownerAppUnitRows(rows.slice(0,100));
}
function ownerAppHandoffs(){
  const active=(state.preps||[]).filter(p=>p.status!=='closed'), done=(state.preps||[]).filter(p=>p.status==='closed').slice(-20).reverse();
  const returns=(state.ownerReturns||[]).filter(r=>r.status!=='completed');
  const escalations=(state.ownerFieldEscalations||[]).filter(r=>!r.resolved_at);
  const card=p=>'<div class="ownerAppHandoffRow"><div><b>MHelpDesk #'+esc(p.ticket_no||'—')+'</b><span>'+esc(p.site||'Site not recorded')+'</span></div><div><b>'+esc(p.status==='draft'?'IT preparing':'IT → Service handoff')+'</b><span>'+esc((p.prep_items||[]).map(i=>(i.unit_tag?i.unit_tag+' · ':'')+eqLabel(i.equipment_type)).join(' | ')||'No equipment recorded')+'</span></div></div>';
  const returnCard=r=>'<div class="ownerAppHandoffRow '+(r.status==='needs_replacement'?'urgent':'')+'"><div><b>Unit '+esc(r.unit_tag||'—')+' · MHelpDesk #'+esc(r.ticket_no||'—')+'</b><span>'+esc(r.equipment_type||'Returned equipment')+'</span></div><div><b>'+esc(String(r.status||'returned').replaceAll('_',' ').toUpperCase())+'</b><span>'+esc(r.status==='needs_replacement'?'Damage hold — not available Shop Inventory':r.status==='waiting_it'?'Waiting for IT Intake':r.status==='pending_mhelp_inventory'?'IT Intake complete — Owner/MHelpDesk inventory action required':'Return in progress')+'</span></div></div>';
  const escalationCard=r=>'<div class="ownerAppHandoffRow urgent"><div><b>Offline Unit '+esc(r.unit_tag||'—')+' · MHelpDesk #'+esc(r.ticket_no||'—')+'</b><span>'+esc(r.site||'Site not recorded')+'</span></div><div><b>'+esc(String(r.status||'escalated').replaceAll('_',' ').toUpperCase())+'</b><span>'+esc(r.status==='unresolved_owner'?'Service and IT could not resolve it — Owner decision required':'Active IT / Service troubleshooting escalation')+'</span></div></div>';
  let body='';
  if(escalations.length)body+='<section class="ownerAppGroup"><h2>Owner / unresolved escalations <span>'+escalations.length+'</span></h2>'+escalations.map(escalationCard).join('')+'</section>';
  if(returns.length)body+='<section class="ownerAppGroup"><h2>Returns & IT Intake <span>'+returns.length+'</span></h2>'+returns.map(returnCard).join('')+'</section>';
  const waiting=active.filter(p=>p.status==='released'), preparing=active.filter(p=>p.status==='draft');
  if(waiting.length)body+='<section class="ownerAppGroup"><h2>Waiting for Service acceptance <span>'+waiting.length+'</span></h2>'+waiting.map(card).join('')+'</section>';
  if(preparing.length)body+='<section class="ownerAppGroup"><h2>IT preparing <span>'+preparing.length+'</span></h2>'+preparing.map(card).join('')+'</section>';
  if(done.length)body+='<section class="ownerAppGroup"><h2>Completed handoffs <span>'+done.length+'</span></h2>'+done.map(card).join('')+'</section>';
  return ownerAppHeader('IT → SERVICE','Handoffs','Equipment preparation, Service acceptance, returns, IT Intake, and unresolved equipment workflow.')+(body||ownerAppEmpty('NO ACTIVE HANDOFF OR RETURN WORK'));
}
function ownerAppHistory(){
  return ownerAppHeader('PERMANENT RECORD','History','Search permanent Technician, Unit, Customer / Site, or MHelpDesk history.')
    +'<div class="ownerAppHistoryControls"><select id="ownerAppHistoryKind"><option value="technician">Technician</option><option value="unit">Unit</option><option value="site">Customer / Site</option></select><input id="ownerAppHistoryQuery" placeholder="Search history"><button class="btn" type="button" onclick="ownerAppRunHistory()">Search History</button></div><div id="ownerAppHistoryResults">'+ownerAppEmpty('ENTER A SEARCH TO VIEW HISTORY')+'</div>';
}
async function ownerAppRunHistory(){
  const kind=document.getElementById('ownerAppHistoryKind')?.value||'technician', value=document.getElementById('ownerAppHistoryQuery')?.value.trim()||'';
  const h=document.getElementById('ownerAppHistoryResults');if(!value){if(h)h.innerHTML=ownerAppEmpty('ENTER A SEARCH TO VIEW HISTORY');return;}
  if(!h)return;
  h.innerHTML='<div class="ownerAppEmpty"><b>SEARCHING HISTORY…</b><span>Please wait.</span></div>';
  try{
    const r=await Promise.race([
      db.rpc('get_company_history_v1',{p_kind:kind,p_value:value,p_limit:100}),
      new Promise(resolve=>setTimeout(()=>resolve({error:{message:'History search timed out. Please try again.'}}),12000))
    ]);
    if(r.error){h.innerHTML='<div class="warn"><b>History could not be loaded.</b><div class="small">'+esc(r.error.message||'Try again.')+'</div></div>';return;}
    const events=Array.isArray(r.data?.events)?r.data.events:[];
    h.innerHTML=events.length?events.map(ownerCompanyHistoryEventHtml).join(''):ownerAppEmpty('NO MATCHING HISTORY FOUND');
  }catch(error){
    h.innerHTML='<div class="warn"><b>History could not be loaded.</b><div class="small">'+esc(error?.message||'Try again.')+'</div></div>';
  }
}
function ownerAppActivity(){
  const rows=(state.reports||[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return ownerAppHeader('COMPANY LOG','Activity','Chronological Tech Check activity from recorded production events.')
    +(rows.length?rows.slice(0,100).map(r=>'<div class="ownerAppActivityRow"><div><b>'+esc(ownerWorkflowDisplayText(r.kind))+'</b><span>'+new Date(r.created_at).toLocaleString()+'</span></div><p>'+esc(ownerWorkflowDisplayText(r.text))+'</p></div>').join(''):ownerAppEmpty('NO ACTIVITY RECORDED'));
}
function ownerAppAccounts(){
  renderPasswordResetRequests();renderUsers();
  return ownerAppHeader('ACCESS','Technician Accounts','Create logins, change usernames, disable/reactivate access, and review disabled or former accounts.')
    +'<section class="ownerAppAccountCreate"><h2>Create Technician</h2><div class="grid4"><div><label>Full Name</label><input id="ownerAppNewTechName"></div><div><label>Username</label><input id="ownerAppNewTechUsername" autocapitalize="none" spellcheck="false"></div><div><label>Role</label><select id="ownerAppNewTechRole"><option value="service">Service Tech</option><option value="it">IT Technician</option></select></div><div><label>Temporary Password</label><input id="ownerAppNewTechPassword" type="password"></div></div><button class="btn" onclick="ownerAppCreateTech()">Create Technician Login</button></section>';
}
async function ownerAppCreateTech(){
  const map=[['ownerAppNewTechName','newTechName'],['ownerAppNewTechUsername','newTechUsername'],['ownerAppNewTechRole','newTechRole'],['ownerAppNewTechPassword','newTechPassword']];
  map.forEach(([a,b])=>{const x=document.getElementById(a),y=document.getElementById(b);if(x&&y)y.value=x.value;});
  await createTech();await ownerAppRender();
}
async function ownerAppAssign(){
  if(!document.getElementById('ownerAssignTicket')) {
    // Assign Job must work even when the deferred Owner workflow module has not loaded yet.
    await loadDeferredModules();
    if(typeof window.installOwnerAssignments==='function') await window.installOwnerAssignments(false);
  }
  const ready=Boolean(document.getElementById('ownerAssignTicket'));
  return ownerAppHeader('DISPATCH','Assign Job','Create the real Tech Check assignment that matches the existing MHelpDesk ticket.')
    +(ready?'':'<div class="ownerAppEmpty"><b>Loading Assign Job…</b><span>The production assignment form is being prepared. It will appear here without leaving this page.</span></div>');
}
let ownerAppRenderVersion = 0;
function ownerSetPersistentSurface(route){
  const form=document.getElementById('ownerJobAssignments');
  const accounts=document.getElementById('ownerPersistentAccounts');
  const assignActive=route==='assign', accountsActive=route==='accounts';
  if(form){
    form.classList.toggle('ownerAppMountedAssign',assignActive);
    form.open=assignActive;
    form.setAttribute('aria-hidden',assignActive?'false':'true');
    form.style.display=assignActive?'block':'none';
    form.style.visibility=assignActive?'visible':'hidden';
    form.style.pointerEvents=assignActive?'auto':'none';
  }
  if(accounts){
    accounts.setAttribute('aria-hidden',accountsActive?'false':'true');
    accounts.style.display=accountsActive?'block':'none';
    accounts.style.visibility=accountsActive?'visible':'hidden';
    accounts.style.pointerEvents=accountsActive?'auto':'none';
  }
}
async function ownerAppRender(){
  if(state.profile?.role!=='owner')return;
  const page=document.getElementById('ownerAppPage');
  const host=document.getElementById('ownerRouteView');
  if(!page||!host)return;
  const version=++ownerAppRenderVersion, route=ownerAppRoute;
  let html='';
  if(route==='today')html=ownerAppToday();
  else if(route==='calendar')html=ownerAppCalendar();
  else if(route==='attention')html=ownerAppAttention();
  else if(route==='review')html=ownerAppReview();
  else if(route==='team')html=ownerAppTeam();
  else if(route==='units')html=ownerAppUnits();
  else if(route==='handoffs')html=ownerAppHandoffs();
  else if(route==='history')html=ownerAppHistory();
  else if(route==='activity')html=ownerAppActivity();
  else if(route==='accounts')html=ownerAppAccounts();
  else if(route==='assign')html=await ownerAppAssign();
  if(version!==ownerAppRenderVersion||route!==ownerAppRoute)return;
  host.innerHTML=html;
  ownerSetPersistentSurface(route);
  const ownerWs=document.querySelector('#view-owner .ownerAppWorkspace');
  if(ownerWs){
    ownerWs.scrollLeft=0;
    requestAnimationFrame(()=>{ ownerWs.scrollLeft=0; });
  }
  document.documentElement.scrollLeft=0;
  document.body.scrollLeft=0;
  document.querySelectorAll('[data-owner-route]').forEach(b=>b.classList.toggle('active',b.dataset.ownerRoute===route));
  if(route==='attention')renderOwnerAttention();
  if(route==='accounts'){renderPasswordResetRequests();renderUsers();}
  if(route==='today')ownerStartTodayLive();
  else clearInterval(window.ownerTodayClockTimer);
  ownerInteractionSafety();
}
async function ownerAppNavigate(route){
  if(!['today','calendar','attention','review','assign','team','units','handoffs','history','activity','accounts'].includes(route))return;
  const ws=document.querySelector('#view-owner .ownerAppWorkspace');
  if(ws)ws.scrollLeft=0;
  ownerAppRoute=route;
  await ownerAppRender();
}
function ownerInteractionSafety(){
  if(state.profile?.role!=='owner')return;
  document.body.classList.remove('busy');
  const support=document.getElementById('ownerSupportMounts');
  if(support){
    support.setAttribute('aria-hidden','true');
    support.style.display='none';
    support.style.pointerEvents='none';
  }
  const app=document.getElementById('ownerApp');if(app)app.style.pointerEvents='auto';
  const ws=document.querySelector('#view-owner .ownerAppWorkspace');if(ws)ws.style.pointerEvents='auto';
  ownerSetPersistentSurface(ownerAppRoute);
}
function bindOwnerAppRouter(){
  const app=document.getElementById('ownerApp');if(!app||app.dataset.bound==='1')return;
  app.dataset.bound='1';
  app.addEventListener('click',e=>{
    const b=e.target.closest('[data-owner-route]');
    if(!b)return;
    e.preventDefault();
    e.stopPropagation();
    ownerAppNavigate(b.dataset.ownerRoute);
  });
}
function ownerCommandOpen(id) {
  const el=document.getElementById(id);
  if (!el) return;
  if (el.tagName==='DETAILS') el.open=true;
  if(window.matchMedia('(max-width:720px)').matches){
    requestAnimationFrame(()=>el.scrollIntoView({behavior:'smooth',block:'start'}));
  }else{
    requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
  }
}
function ownerCommandAction(action) {
  const map={
    today:'ownerTechOverviewCard',
    attention:'ownerAttentionCard',
    review:'ownerReviewCard',
    history:'ownerCompanyHistoryCard',
    team:'ownerTechOverviewCard',
    assign:'ownerJobAssignments',
    units:'ownerUnitStatusCard',
    handoffs:'ownerHandoffsCard',
    activity:'ownerActivityCard',
    accounts:'ownerAccountsCard'
  };
  const targetId=map[action];
  const content=document.getElementById('ownerWorkspaceContent');
  if(content && targetId){
    content.classList.add('active');
    content.querySelectorAll(':scope > details.ownerDashSection').forEach(section=>{
      const selected=section.id===targetId;
      section.classList.toggle('ownerWorkspaceSelected',selected);
      section.open=selected;
    });
  }
  document.querySelectorAll('#view-owner [data-owner-command]').forEach(button=>{
    button.classList.toggle('ownerNavActive',button.dataset.ownerCommand===action);
  });

  // Today and Team intentionally share the same live data, but Team gets a
  // dedicated people-first view instead of an empty/ambiguous workspace.
  const moduleHead=targetId ? document.querySelector('#'+targetId+' .ownerModuleHead') : null;
  const overview=document.getElementById('ownerTechOverview');
  if(moduleHead && (action==='today'||action==='team')){
    moduleHead.innerHTML=action==='team'
      ? '<span>TEAM</span><h1>Team</h1><p>See every active technician, their department, assigned work, and equipment.</p>'
      : '<span>TODAY</span><h1>Today</h1><p>See today’s work, who has each job, and what is waiting.</p>';
    if(action==='team' && overview){
      const techs=(state.profiles||[]).filter(p=>p.active&&!p.archived_at&&(p.role==='it'||p.role==='service'));
      const jobs=(state.ownerAssignments||[]).filter(a=>a.status!=='cancelled');
      const assets=state.assetInventory||[];
      overview.innerHTML=techs.length ? techs.map(t=>{
        const name=t.full_name||t.username||'Technician';
        const tj=jobs.filter(a=>a.assignee_user_id===t.user_id);
        const ta=assets.filter(a=>a.assigned_to===t.user_id&&a.availability_status==='assigned');
        return '<div class="ownerTeamPageRow"><div><b>'+esc(name)+'</b><span>'+esc(t.role==='it'?'IT TECHNICIAN':'SERVICE TECH')+'</span></div><div><b>'+tj.length+'</b><span>active job'+(tj.length===1?'':'s')+'</span></div><div><b>'+ta.length+'</b><span>assigned asset'+(ta.length===1?'':'s')+'</span></div></div>';
      }).join('') : '<div class="ok"><b>No active technicians.</b></div>';
    } else if(action==='today') renderOwnerTechOverview();
  }

  // Re-render the selected module at click time. This prevents a module from
  // looking blank when its data finished loading while it was hidden.
  if(action==='attention') renderOwnerAttention();
  if(action==='review') renderOwnerReview();
  if(action==='units') renderOwnerUnitSearch();
  if(action==='handoffs') renderOwner();
  if(action==='activity') renderOwner();
  if(action==='accounts'){ renderPasswordResetRequests(); renderUsers(); }
  if(action==='assign') renderOwnerAssignmentWorkspace();

  ownerCommandOpen(targetId);
  if(action==='units') requestAnimationFrame(()=>document.getElementById('ownerUnitSearch')?.focus());
  if(action==='history') requestAnimationFrame(()=>document.getElementById('ownerCompanyHistoryQuery')?.focus());
}

function renderOwnerAssignmentWorkspace(){
  if(state.profile?.role!=='owner') return;
  const card=document.getElementById('ownerJobAssignments');
  const body=card?.querySelector('.ownerDashBody');
  if(!body) return;
  const techs=(state.profiles||[]).filter(p=>p.active&&!p.archived_at&&(p.role==='it'||p.role==='service'));
  const rows=(state.ownerAssignments||[]).filter(a=>a.status!=='cancelled').slice().sort((a,b)=>new Date(b.assigned_at||0)-new Date(a.assigned_at||0));
  body.innerHTML='<div class="ownerModuleHead"><span>DISPATCH</span><h1>Create / Assign Job</h1><p>Create the Tech Check job that matches the MHelpDesk ticket, then choose the first department.</p></div>'
    +'<div class="ownerAssignLaunch"><b>NEW TECH CHECK JOB</b><p>MHelpDesk stays separate. Tech Check uses the same ticket number to control the technician workflow.</p><button class="btn" type="button" onclick="ownerOpenExistingAssignmentCreator()">CREATE / ASSIGN JOB →</button></div>'
    +'<div class="ownerPageStats"><span><b>'+rows.length+'</b> active jobs</span><span><b>'+techs.filter(t=>t.role==='it').length+'</b> IT techs</span><span><b>'+techs.filter(t=>t.role==='service').length+'</b> Service techs</span></div>'
    +(rows.length?'<div class="ownerPageList">'+rows.slice(0,20).map(a=>'<div class="ownerPageRow"><div><b>MHelpDesk #'+esc(a.ticket_no)+'</b><span>'+esc(a.site||'Customer / site not recorded')+(a.job_lead_name?' · Lead: '+esc(a.job_lead_name):'')+'</span></div><div><b>'+esc(a.assignee_name||a.assignee_username||(!a.assignee_user_id?'Department queue':'Assigned'))+'</b><span>'+esc(a.assignee_role==='it'?'IT':a.assignee_role==='service'?'SERVICE':String(a.status||'').toUpperCase())+'</span></div></div>').join('')+'</div>':'<div class="ok"><b>No active Tech Check assignments.</b><div class="small">Use CREATE / ASSIGN JOB to start one.</div></div>');
}
function ownerOpenExistingAssignmentCreator(){
  const candidates=[...document.querySelectorAll('button,a')].filter(el=>/create\s*\/\s*assign job|assign job/i.test(el.textContent||'')&&!el.closest('#ownerJobAssignments'));
  const button=candidates[0];
  if(button){ button.click(); return; }
  alert('The existing assignment creator is not available on this screen yet.');
}
function bindOwnerCommandCenter() {
  const host=document.getElementById('ownerCommandCenter');
  if(!host || host.dataset.bound==='1') return;
  host.dataset.bound='1';
  host.addEventListener('click',event=>{
    const button=event.target.closest('[data-owner-command]');
    if(button) ownerCommandAction(button.dataset.ownerCommand);
  });
}
function renderOwnerCommandCenter() {
  if(state.profile?.role!=='owner') return;
  const host=document.getElementById('ownerCommandStats');
  if(!host) return;
  bindOwnerCommandCenter();
  const activeTechs=(state.profiles||[]).filter(p=>p.active&&!p.archived_at&&(p.role==='it'||p.role==='service')).length;
  const activeAssets=(state.assetInventory||[]).filter(a=>a.availability_status!=='retired').length;
  const todayKey=localDateKey(new Date());
  const jobs=(state.ownerAssignments||[]).filter(a=>a.status!=='cancelled'&&String(a.scheduled_for||'')===todayKey).length;
  const returns=state.ownerReturns||[];
  const reviewRows=state.ownerReviewQueue||[];
  const readyReview=reviewRows.filter(r=>r.review_status==='ready').length;
  const correctionReview=reviewRows.filter(r=>r.review_status==='correction_requested'&&r.ready_for_owner_review!==true).length;
  const waitingIt=returns.filter(r=>r.status==='waiting_it').length;
  const replacementCount=returns.filter(r=>r.status==='needs_replacement').length;
  const resetPending=(state.resetRequests||[]).filter(r=>r.status==='pending'&&new Date(r.expires_at).getTime()>Date.now()).length;
  const latestInspection=new Map();
  (state.todayInspections||[]).forEach(row=>{if(!latestInspection.has(row.service_tech_id)) latestInspection.set(row.service_tech_id,row);});
  const failed=[...latestInspection.values()].filter(row=>inspectionSummary(row)?.failed).length;
  const visionAlerts=(state.ownerAIAlerts||[]).length;
  const overdue=(state.preps||[]).filter(p=>p.status!=='closed'&&ownerAgeHours(p.released_at||p.created_at)>=24).length+
    returns.filter(r=>ownerAgeHours(r.it_received_at||r.returned_at||r.updated_at)>=24).length;
  const attention=correctionReview+replacementCount+resetPending+failed+visionAlerts+overdue;
  const values=[
    {n:jobs,sub:'scheduled jobs',alert:false},
    {n:attention,sub:attention===1?'owner action':'owner actions',alert:attention>0},
    {n:readyReview,sub:'ready for owner review',alert:readyReview>0},
    {n:activeTechs,sub:activeAssets+' active assets',alert:false}
  ];
  [...host.querySelectorAll('button')].forEach((button,i)=>{
    const value=values[i]; if(!value)return;
    const number=button.querySelector('b'), small=button.querySelector('small');
    if(number) number.textContent=String(value.n);
    if(small) small.textContent=value.sub;
    button.classList.toggle('alert',value.alert);
  });
}
function renderOwner() {
  if (state.profile?.role !== 'owner') return;
  const activePreps = state.preps.filter(p => p.status !== 'closed');
  const completedPreps = state.preps.filter(p => p.status === 'closed').slice().reverse();
  const unresolvedSpareUnits = completedPreps.flatMap(p => (p.prep_items || [])
    .filter(i => i.purpose === 'BACKUP' && i.spare_checked_out_at && !i.spare_outcome)
    .map(i => ({...i,ticket_no:p.ticket_no,site:p.site,closed_by_name:p.closed_by_name})));
  const unresolvedSpareBatteries = state.truckSpareBatteries || [];
  const unresolvedTruckSpareCount = unresolvedSpareUnits.length + unresolvedSpareBatteries.length;
  const truckSpareOwnerHtml = unresolvedTruckSpareCount
    ? '<div class="warn"><b>Truck Spares Still Out · ' + unresolvedTruckSpareCount + '</b><div class="small">Service must resolve these as USED or RETURNED UNUSED. Unused backup units return directly to Shop Inventory.</div>' +
      unresolvedSpareUnits.map(i => '<div class="small top8"><b>' + esc(i.equipment_type) + ' ' + esc(i.unit_tag || '') + '</b> · MHelpDesk #' + esc(i.ticket_no) + ' · ' + esc(i.spare_checked_out_to_name || i.closed_by_name || 'Service Tech') + '</div>').join('') +
      unresolvedSpareBatteries.map(b => '<div class="small top8"><b>' + Number(b.qty_prepared || 0) + ' × ' + esc(b.battery_type) + '</b> · MHelpDesk #' + esc(b.ticket_no) + ' · ' + esc(b.service_tech_name || 'Service Tech') + '</div>').join('') +
      '</div>'
    : '';
  const prepHtml = p => '<details class="ownerFold"><summary><span><b>MHelpDesk Ticket #' + esc(p.ticket_no) + '</b><span class="small ownerFoldHint">' + esc(p.site || 'No site') + '</span></span>' + (p.status === 'draft' ? '<span class="pill amber">IT EQUIPMENT PREP</span>' : p.status === 'released' ? '<span class="pill green">READY FOR SERVICE CHECKOUT</span>' : '<span class="pill">EQUIPMENT VERIFIED</span>') + '</summary><div class="ownerFoldBody small">' + ownerPartsEditor(p) + '<div class="top8"><b>Units / Equipment</b><div>' + ((p.prep_items || []).map(i => i.purpose + ' ' + eqLabel(i.equipment_type) + (i.unit_tag ? ' ' + i.unit_tag : '') + (i.purpose === 'BACKUP' ? (i.spare_it_checked_out_at ? ' [IT CHECKED OUT]' : ' [CHECKOUT PENDING]') : '')).join(' · ') || 'No units started yet.') + '</div></div></div></details>';
  const draftCount = activePreps.filter(p => p.status === 'draft').length;
  const serviceCount = activePreps.filter(p => p.status === 'released').length;
  const handoffBadge = $('ownerHandoffsBadge');
  if (handoffBadge) {
    handoffBadge.textContent = String(activePreps.length + unresolvedTruckSpareCount);
    handoffBadge.classList.toggle('alert', activePreps.length + unresolvedTruckSpareCount > 0);
    handoffBadge.classList.toggle('neutral', activePreps.length + unresolvedTruckSpareCount === 0);
  }
  const activityBadge = $('ownerActivityBadge');
  if (activityBadge) activityBadge.textContent = String(state.reports.length);
  $('ownerPrepSummary').innerHTML = '<div class="wl-workstrip"><span><b>' + draftCount + '</b> IT preparing</span><span><b>' + serviceCount + '</b> waiting Service</span><span><b>' + unresolvedTruckSpareCount + '</b> truck spares out</span><span><b>' + activePreps.length + '</b> active tickets</span></div>';
  $('ownerPrepStatus').innerHTML = truckSpareOwnerHtml + (activePreps.length ? activePreps.slice().reverse().map(prepHtml).join('') : (unresolvedTruckSpareCount ? '' : '<div class="ok"><b>✓ No active equipment handoffs.</b></div>'));
  $('ownerPrepHistoryCount').textContent = String(completedPreps.length);
  $('ownerPrepHistory').innerHTML = completedPreps.length ? completedPreps.map(prepHtml).join('') : '<div class="small">No completed equipment history yet.</div>';
  const recentReports = state.reports.slice().sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, ownerReportLimit);
  $('reports').innerHTML = recentReports.length ? recentReports.map(r => '<details class="ownerFold"><summary><span><b>' + esc(ownerWorkflowDisplayText(r.kind)) + '</b><span class="small ownerFoldHint">' + esc(ownerActorLabel(r)) + (r.ticket_no ? ' · MHelpDesk #' + esc(r.ticket_no) : '') + ' · ' + new Date(r.created_at).toLocaleString() + '</span></span><span class="pill">DETAILS</span></summary><div class="ownerFoldBody">' + esc(ownerWorkflowDisplayText(r.text)) + '</div></details>').join('') : '<div class="warn">No reports yet.</div>';
  const more = $('ownerReportsMore'); if (more) { more.classList.toggle('hidden', ownerReportLimit >= state.reports.length); more.textContent = 'Show More Activity (' + Math.max(0, state.reports.length - ownerReportLimit) + ' older)'; more.onclick = () => { ownerReportLimit += 25; renderOwner(); }; }
  renderOwnerCommandCenter();
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
  const email = p.notification_email || '';
  const emailStatus = email ? '<span class="pill green">EMAIL SET</span>' : '<span class="pill amber">NO EMAIL</span>';
  const ownerCopy = p.role === 'owner' ? '<label class="emailPref"><input id="emailOwner_' + p.user_id + '" type="checkbox" ' + (p.email_owner_copies ? 'checked' : '') + '><span>Owner copy emails</span></label>' : '';
  return '<details class="teamMemberCard role-' + teamRoleClass(p.role) + ' ' + (p.active?'':'disabledAccount') + '"><summary><div class="teamMemberIdentity"><b>' + esc(p.full_name || p.username || 'User') + '</b><span>@' + esc(p.username || 'no-username') + '</span></div><div class="teamMemberBadges"><span class="pill roleBadge ' + teamRoleClass(p.role) + '">' + esc(roleLabel(p.role)) + '</span><span class="pill ' + (p.active ? 'green' : 'amber') + '">' + status + '</span>' + emailStatus + (self ? '<span class="pill">YOU</span>' : '') + '</div></summary><div class="teamMemberBody">'
    +(!p.active?'<div class="warn accountDisabledNotice"><b>DISABLED ACCOUNT</b><div class="small">This person cannot sign in until Access is changed back to Active and saved.</div></div>':'')
    +'<div class="teamEditGrid"><div><label>Full Name</label><input id="name_' + p.user_id + '" value="' + esc(p.full_name || '') + '"></div>'
    +'<div><label>Username / Sign In</label><input id="username_' + p.user_id + '" autocapitalize="none" spellcheck="false" value="' + esc(p.username || '') + '"><div class="small">Changing this changes the username they use the next time they sign in.</div></div>'
    +'<div><label>Role</label><select id="role_' + p.user_id + '"><option value="service" ' + (p.role==='service'?'selected':'') + '>Service Tech</option><option value="it" ' + (p.role==='it'?'selected':'') + '>IT Technician</option><option value="owner" ' + (p.role==='owner'?'selected':'') + '>Owner/Admin</option><option value="pending" ' + (p.role==='pending'?'selected':'') + '>Pending</option></select></div>'
    +'<div><label>Access</label><select id="active_' + p.user_id + '"><option value="true" ' + (p.active?'selected':'') + '>Active</option><option value="false" ' + (!p.active?'selected':'') + '>Disabled</option></select></div>'
    +'<div class="teamSaveCell"><label>&nbsp;</label><button class="mini full" onclick="saveUserAccess(\'' + p.user_id + '\')">Save Account</button></div></div>'
    +'<div class="teamEmailBox"><div><label>Notification Email</label><input id="notifyEmail_' + p.user_id + '" type="email" autocapitalize="none" spellcheck="false" placeholder="name@camerasonsite.com" value="' + esc(email) + '"></div><div class="emailPrefs"><label class="emailPref"><input id="emailJobs_' + p.user_id + '" type="checkbox" ' + (p.email_job_assignments !== false ? 'checked' : '') + '><span>New job assignment emails</span></label><label class="emailPref"><input id="emailHandoffs_' + p.user_id + '" type="checkbox" ' + (p.email_handoff_updates !== false ? 'checked' : '') + '><span>Equipment / handoff emails</span></label>' + ownerCopy + '</div><div class="small">Email delivery will start after the outgoing email service is connected.</div></div>'
    +'<details class="accountSecurityFold"><summary>Account Security</summary><div class="accountSecurityBody"><div class="small">' + (p.must_change_password ? 'Password status: TEMPORARY — private change required at next sign in' : 'Password status: Private password set') + '</div><div class="grid top8"><div><label>Set Temporary Password</label><input id="reset_' + p.user_id + '" type="password" placeholder="8+ characters"></div><div><label>&nbsp;</label><button class="mini full" onclick="resetUserPassword(\'' + p.user_id + '\')">Set Temporary Password</button></div></div></div></details>'
    +(self ? '<div class="small top8"><b>Your Owner/Admin account is protected.</b> You cannot archive or disable your own owner access.</div>' : '<button class="mini danger top10" onclick="archiveUser(\'' + p.user_id + '\')">Delete from Techs on File</button>')
    +'</div></details>';
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
    fullName = $('name_' + id)?.value.trim() || '',
    username = normalizeUsername($('username_' + id)?.value || ''),
    notificationEmail = $('notifyEmail_' + id)?.value.trim().toLowerCase() || '',
    emailJobAssignments = Boolean($('emailJobs_' + id)?.checked),
    emailHandoffUpdates = Boolean($('emailHandoffs_' + id)?.checked),
    emailOwnerCopies = Boolean($('emailOwner_' + id)?.checked);
  if (!validUsername(username)) return alert('Username must be 3–32 letters, numbers, dots, dashes, or underscores.');
  if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) return alert('Enter a valid notification email address.');
  const prior=state.profiles.find(p=>p.user_id===id);
  const usernameChanged=Boolean(prior && normalizeUsername(prior.username)!==username);
  if(usernameChanged && !confirm('Change ' + (prior?.full_name || prior?.username || 'this account') + ' sign-in username from @' + (prior?.username || 'none') + ' to @' + username + '?\n\nThey must use the NEW username the next time they sign in.')) return;
  const { data, error } = await db.functions.invoke('admin-user-management', {
    body: {
      action: 'set_access',
      user_id: id,
      role,
      active,
      full_name: fullName,
      username,
      notification_email: notificationEmail || null,
      email_job_assignments: emailJobAssignments,
      email_handoff_updates: emailHandoffUpdates,
      email_owner_copies: emailOwnerCopies,
    },
  });
  if (error || data?.error) return alert(error?.message || data.error);
  await refreshData();
  alert(usernameChanged ? 'Account updated. New sign-in username: @' + username : 'Team member and email settings updated.');
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
  ownerCompanyHistoryKindChanged,
  ownerCompanyHistorySearch,
  ownerAppNavigate,
  ownerInteractionSafety,
  ownerCalendarShift,
  ownerCalendarSetMode,
  ownerCalendarSetRoleFilter,
  ownerCalendarToday,
  ownerCalendarOpenJob,
  ownerCalendarSelect,
  ownerCalendarNewJob,
  ownerCalendarServiceOrder,
  ownerEnsureWeather,
  techCheckGpsPosition,
  techCheckWeatherForGps,
  ownerAppRunHistory,
  ownerAppFilterUnits,
  ownerAppShowTechHistory,
  ownerAppCreateTech,
  ownerJump,
  ownerOpenReturn,
  setOwnerDailyDate,
  moveOwnerDailyDate,
  ownerDailyToday,
  renderOwnerTechOverview,
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
