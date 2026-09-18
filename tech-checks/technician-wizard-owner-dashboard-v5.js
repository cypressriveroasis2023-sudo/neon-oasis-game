const LIVE_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LIVE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const liveDb = supabase.createClient(LIVE_URL, LIVE_KEY);
const EVIDENCE_BUCKET = 'handoff-evidence';
const OPS_TEL = '+13463149208';
const OPS_DISPLAY = '(346) 314-9208';
const truckLabels = [
  'Fuel level sufficient for today’s route',
  'Tires appear safe and properly inflated',
  'Headlights / signals / brake lights working',
  'Windshield and mirrors are safe and clear',
  'No visible fluid leaks',
  'Required tools and service supplies onboard',
  'Ladders / cargo / equipment secured',
  'Truck cab and bed organized',
];
const trailerLabels = [
  'Trailer tires appear safe and properly inflated',
  'Hitch / coupler fully secured',
  'Safety chains attached correctly',
  'Trailer plug connected; lights and signals working',
  'Jack / supports secured for travel',
  'Load balanced and equipment tied down',
  'No visible structural damage or unsafe condition',
];
let itCreateStep = 0;
let itExpectedUnits = 0;
let activeItPrep = null;
let itUnitIndex = 0;
let itQuestionIndex = 0;
let itUnitPhase = 'type';
let itTypeChoice = '';
let itPurposeChoice = '';
let itReconRequired = 1;
let itAnswered = new Set();
const itDraftAnswers = new Map();
let createPrepWrapped = false;
let activeSvcPrep = null;
let activeSvcAssignment = null;
let svcUnitIndex = 0;
let svcQuestionIndex = 0;
let inspection = { step: 0, truck: Array(8).fill(null), takingTrailer: null, trailer: Array(7).fill(null) };
let inspectionRecovered = false;
let serviceReturn = { step: 0, ticket: '', unit: '', type: '', notes: '', photo: null, conditionPhotos: [], damagePhotos: [], knownUnits: [] };
let serviceReturnRecovered = false;
let serviceReturnSubmitting = false;
const FIELD_DRAFT_TTL = 24 * 60 * 60 * 1000;
async function deviceDraftKey(kind) { const { data:{ session } } = await liveDb.auth.getSession(); return session?.user?.id ? `cos-tech-field-draft-v1:${session.user.id}:${kind}` : ''; }
async function saveDeviceDraft(kind, payload) { const key = await deviceDraftKey(kind); if (!key) return; try { localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() })); } catch {} }
async function loadDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (!key) return null; try { const value=JSON.parse(localStorage.getItem(key)||'null'); if (!value) return null; if (Date.now()-Number(value.savedAt||0)>FIELD_DRAFT_TTL) { localStorage.removeItem(key); return null; } return value; } catch { return null; } }
async function clearDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (key) try { localStorage.removeItem(key); } catch {} }
function saveInspectionDraft() { return saveDeviceDraft('inspection',{ step:inspection.step, truck:[...inspection.truck], takingTrailer:inspection.takingTrailer, trailer:[...inspection.trailer] }); }
function saveServiceReturnDraft() { return saveDeviceDraft('service-return',{ step:serviceReturn.step, ticket:serviceReturn.ticket, unit:serviceReturn.unit, type:serviceReturn.type, notes:serviceReturn.notes }); }
const intakeLabels = ['Is the returned unit tag / number correct?', 'Did you review the Service Tech site / damage photos and verify any damage found?', 'Are the returned accessories / equipment accounted for?', 'Are the batteries / battery box accounted for?', 'Are the SD cards / storage accounted for where applicable?', 'Did you power the unit and verify it comes online / functions correctly?', 'Were the SD cards formatted and made ready for the next deployment?', 'Was the SIM card turned off / canceled for this returned unit?', 'Was monitoring canceled for this returned unit?', 'Was this unit removed from Alibi?', 'Was the unit cleaned and made physically ready for reuse?', 'Was the unit added back to the 2026 Unit Tracker as Shop Inventory?', 'Was the SIM cancellation documented with the date, MHelpDesk job, unit number, and IT technician initials?', 'Is the unit back on the shelf and ready for a future deployment?', 'Was this returned unit removed from the customer email account in the camera app?'];
let intakeWizard = { row: null, step: 0, answers: Array(intakeLabels.length).fill(null), notes: '', photo: null, meta: {} };
let ownerReturnRows = new Map();
let serviceReturnRows = new Map();
const INTAKE_META_RE = /(?:^|\n)\[\[INTAKE_META:([A-Za-z0-9+/=]+)\]\]/;
function readIntakeRecord(raw) {
  const text = String(raw || '');
  const match = text.match(INTAKE_META_RE);
  let meta = {};
  if (match?.[1]) { try { meta = JSON.parse(atob(match[1])); } catch { meta = {}; } }
  return { notes: text.replace(INTAKE_META_RE, '').trim(), meta };
}
function writeIntakeRecord(notes, meta) {
  const payload = btoa(JSON.stringify(meta || {}));
  return `${String(notes || '').trim()}${String(notes || '').trim() ? '\n' : ''}[[INTAKE_META:${payload}]]`;
}
function techInitials(name) { return String(name || 'IT').trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 4).toUpperCase() || 'IT'; }
function intakeDocumentation(row, tech, at = new Date()) { return { simCanceledDate: at.toLocaleDateString(), ticket: String(row?.ticket_no || ''), unit: String(row?.unit_tag || ''), techInitials: techInitials(tech?.name), techName: String(tech?.name || 'IT Technician') }; }

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[c]);
}
function norm(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function roleText() { return document.getElementById('whoRole')?.textContent || ''; }
function isIT() { return roleText().includes('IT Technician') || roleText().includes('IT Tech') || roleText().includes('Owner/Admin'); }
function isSvc() { return roleText().includes('Service Tech') || roleText().includes('Owner/Admin'); }
function viewIT() { return document.getElementById('view-it'); }
function viewSvc() { return document.getElementById('view-svc'); }
function hideChildren(view, keep = []) {
  [...(view?.children || [])].forEach(el => el.style.display = keep.includes(el) ? '' : 'none');
}
function resetWizardPosition(anchor = null) {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();

  const homeIds = new Set(['wlItHome','wlItIntake','wlSvcHome']);
  const ids = ['wlItWizardOnly','wlSvcWizardOnly','wlInspection','wlCreateHead','wlPendingList','wlItStatus','wlItHome','wlItIntake','wlSvcLookup','wlSvcHistory','wlSvcHome'];

  const findTarget = () => anchor || ids.map(id => document.getElementById(id)).find(el => el && el.offsetParent !== null);

  const snap = () => {
    const target = findTarget();

    // Home screens must keep the Cameras Onsite / Tech Check banner below the
    // iPhone status area. Scrolling the home card itself to block:start pushes
    // the banner behind the Dynamic Island.
    if (!target || homeIds.has(target.id)) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    if (target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    }
  };

  snap();
  requestAnimationFrame(() => { snap(); requestAnimationFrame(snap); });
}
function injectStyles() {
  if (document.getElementById('wizardLiveStyles')) return;
  const s = document.createElement('style');
  s.id = 'wizardLiveStyles';
  s.textContent = `
    .wl-home{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}
    .wl-title{font-size:30px;font-weight:950;line-height:1.12;margin:10px 0 6px;color:#101a28;letter-spacing:-.7px}.wl-sub{font-size:16px;color:#687789;margin-bottom:20px}
    .wl-menu{display:grid;gap:14px}.wl-menu button,.wl-big{width:100%;min-height:82px;border:1px solid #dbe3ea;border-radius:18px;padding:18px 20px;text-align:left;font-size:19px;font-weight:950;box-shadow:0 5px 16px rgba(18,43,65,.065)}
    .wl-blue{background:#fff!important;color:#15191d!important;border-left:4px solid #d20b12!important}.wl-amber{background:#fff!important;color:#15191d!important;border-left:4px solid #eea400!important}.wl-green{background:#fff!important;color:#15191d!important;border-left:4px solid #20ad59!important}.wl-gray{background:#fff!important;color:#15191d!important;border-left:4px solid #7a838c!important}.wl-red{background:#fff!important;color:#15191d!important;border-left:4px solid #d20b12!important}
    .wl-count{float:right;background:rgba(255,255,255,.82);color:#26323c;border-radius:999px;padding:4px 9px;font-size:13px}.wl-back{width:100%;border:0;border-radius:12px;padding:12px;margin-bottom:12px;background:#edf1f4;font-weight:900;color:#394651}
    .wl-head{border:1px solid #d8dde2;background:#fff;border-radius:12px;padding:14px;margin-bottom:14px}.wl-head .kicker{font-size:11px;font-weight:950;text-transform:uppercase;color:#d20b12;letter-spacing:.4px}.wl-head h2{margin:4px 0!important;font-size:23px}.wl-progress{height:7px;background:#e1e4e7;border-radius:999px;overflow:hidden;margin-top:9px}.wl-progress span{display:block;height:100%;background:#d20b12}
    .wl-nav{display:grid;grid-template-columns:1fr 1.7fr;gap:9px;margin-top:14px}.wl-nav button{min-height:54px;border:0;border-radius:13px;font-size:16px;font-weight:950}.wl-prev{background:#fff;color:#3d4349;border:1px solid #d8dde2!important}.wl-next{background:#d20b12;color:#fff}.wl-finish{background:#20ad59!important;color:#fff!important}
    .wl-ticket{border:2px solid #dce4ea;border-radius:15px;padding:14px;margin-bottom:10px;background:#fff}.wl-ticket b{font-size:18px}.wl-ticket button{margin-top:10px}.wl-question{border:1px solid #d8dde2;background:#fff;border-radius:12px;padding:17px}.wl-question .qnum{font-size:12px;font-weight:950;color:#d20b12;text-transform:uppercase}.wl-question .qtext{font-size:21px;font-weight:900;margin:9px 0 15px}.wl-options{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wl-options button{min-height:66px;border:2px solid #d4dce3;border-radius:14px;background:#fff;font-size:18px;font-weight:950}.wl-options .pass.on{background:#e8f7ef;border-color:#52a777;color:#17653f}.wl-options .fail.on{background:#ffebe9;border-color:#dc6c63;color:#a5231b}
    .wl-proof{border:1px solid #d8dde2;background:#f8f9fa;border-radius:12px;padding:13px;margin-top:12px}.wl-proof.service{border-color:#b8ddc9;background:#f7fcf9}.wl-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}.wl-gallery img{width:100%;height:120px;object-fit:cover;border-radius:9px;background:#fff;border:1px solid #d9e2e8}.wl-sign canvas{width:100%;height:135px;border:2px dashed #a9b9c6;border-radius:10px;background:#fff;touch-action:none;overscroll-behavior:contain;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.wl-saved{background:#eaf8f0;border:1px solid #a8d5bb;border-radius:10px;padding:9px;margin-top:8px}.wl-saved img{width:100%;max-height:100px;object-fit:contain;background:#fff;border-radius:8px;margin-top:5px}.wl-note{font-size:12px;color:#62717d}.wl-review{border:2px solid #a7d3b8;background:#effaf3;border-radius:13px;padding:12px;margin:10px 0}.wl-stop{background:#ffebe9;border:2px solid #eeaaa3;border-radius:13px;padding:12px;color:#9e2119;margin-top:12px}.wl-stop a{display:block;background:#b82418;color:#fff!important;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:950;margin-top:8px}.wl-history details{border:2px solid #dce3e8;border-radius:12px;margin:8px 0;overflow:hidden}.wl-history summary{padding:13px;background:#f0f3f6;font-weight:950}.wl-history .body{padding:11px}.wl-status-pending{border-color:#e25a52!important}.wl-status-pending summary{background:#ffe7e5!important;color:#9f2119}.wl-status-waiting{border-color:#dfa94b!important}.wl-status-waiting summary{background:#fff1c9!important;color:#7c5200}.wl-status-complete{border-color:#43aa69!important}.wl-status-complete summary{background:#dff6e7!important;color:#126536}
    .wl-home .wl-title{color:#111417!important}.wl-home .wl-sub{color:#666b70!important}
    .wl-menu button,.wl-big{border-radius:12px!important;box-shadow:0 4px 14px rgba(0,0,0,.08)!important}
    .wl-blue{background:linear-gradient(180deg,#e5141b,#c90910)!important;color:#fff!important;border:1px solid #b6080e!important}.wl-red{background:linear-gradient(180deg,#e5141b,#c90910)!important;color:#fff!important}.wl-gray{background:#fff!important;color:#172231!important;border:1px solid #dbe3ea!important}.wl-amber{background:#fff!important;color:#172231!important;border:1px solid #dbe3ea!important;border-left:4px solid #7b8b9b!important}.wl-green{background:#fff!important;color:#172231!important;border:1px solid #dbe3ea!important;border-left:4px solid #2a7bc7!important}
    .wl-head{border:1px solid #d8dde2!important;background:#fff!important;border-radius:12px!important}.wl-head .kicker{color:#d20b12!important}.wl-progress span{background:#d20b12!important}
    .wl-question{border:1px solid #d8dde2!important;background:#fff!important;box-shadow:0 3px 12px rgba(0,0,0,.04)}
    .wl-next{background:#d20b12!important}.wl-stop a,.wl-red{background:#d20b12!important}
    .wl-ticket{border:1px solid #d8dde2!important;box-shadow:0 3px 12px rgba(0,0,0,.04)}
    .wl-issue-list{display:grid;gap:8px;margin-top:10px}.wl-issue-link{width:100%;border:1px solid #e5aaa6;border-radius:11px;background:#fff;color:#9e2119;padding:11px 12px;text-align:left;font-weight:850;cursor:pointer}.wl-issue-link:hover{background:#fff5f4}.wl-issue-link b{display:block;color:#741b15}.wl-issue-link span{display:block;font-size:12px;margin-top:2px;color:#9e2119}
    .wl-live-stage{margin:8px 0;padding:9px 10px;border-radius:10px;background:#f4f7f9}.wl-live-stage>b{display:block;font-size:12px;letter-spacing:.35px}.wl-live-stage>span{display:block;font-size:12px;color:#596875;margin-top:2px}.wl-live-track{height:6px;background:#dfe5e9;border-radius:999px;overflow:hidden;margin-top:7px}.wl-live-track i{display:block;height:100%;background:#d20b12;border-radius:999px}
    .wl-assigned-inventory{margin:12px 0;padding:12px;border:1px solid #cfdce5;border-radius:13px;background:#f3f7fa}.wl-assigned-inventory-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.wl-assigned-inventory-list span{display:inline-block;border:1px solid #d4dee6;border-radius:999px;background:#fff;padding:7px 9px;font-size:12px;color:#526472}.wl-assigned-inventory-list b{color:#102a40}
    .wl-help-overlay{position:fixed;inset:0;background:rgba(4,17,29,.62);z-index:10020;display:flex;align-items:flex-end;justify-content:center;padding:14px}.wl-help-overlay.hidden{display:none!important}.wl-help-sheet{width:min(720px,100%);max-height:92vh;overflow:auto;background:#f7f9fb;border-radius:22px 22px 14px 14px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px}.wl-help-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#f7f9fb;padding:14px 0 10px;z-index:2}.wl-help-head h2{margin:2px 0 0;font-size:24px}.wl-help-progress{height:8px;background:#dfe5ea;border-radius:999px;overflow:hidden}.wl-help-progress span{display:block;height:100%;background:#d20b12}.wl-help-step-count{text-align:right;font-size:12px;color:#65727e;margin-top:5px}.wl-help-card{background:#fff;border:1px solid #dce3e8;border-radius:16px;padding:20px;margin-top:12px}.wl-help-card h2{font-size:26px;margin:6px 0 12px}.wl-help-copy{font-size:16px;line-height:1.5;color:#263440}.wl-help-copy p{margin:0 0 12px}.wl-help-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#edf2f5;border-radius:12px;padding:12px;font-size:12px}.wl-help-flow span{color:#d20b12;font-weight:950}.wl-help-nav{display:grid;grid-template-columns:1fr auto 1.5fr;gap:8px;align-items:center;margin-top:14px}.wl-help-nav button{min-height:52px;border-radius:12px;font-weight:900}.wl-help-skip{border:0;background:transparent;color:#596875;text-decoration:underline}.helpMini{white-space:nowrap}
    .wl-menu-overlay{position:fixed;inset:0;background:rgba(4,17,29,.58);z-index:10030;display:flex;align-items:flex-end;justify-content:center;padding:14px}.wl-menu-overlay.hidden{display:none!important}.wl-menu-sheet{width:min(620px,100%);max-height:90vh;overflow:auto;background:#f7f9fb;border-radius:22px 22px 14px 14px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px}.wl-menu-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.wl-menu-head h2{margin:2px 0 0;font-size:28px}.wl-app-menu-list{display:grid;gap:10px;margin-top:14px}.wl-app-menu-item{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;border:1px solid #d5dfe6;border-radius:14px;background:#fff;padding:14px;text-align:left;color:#172839}.wl-app-menu-item span:nth-child(2) b,.wl-app-menu-item span:nth-child(2) small{display:block}.wl-app-menu-item span:nth-child(2) small{margin-top:3px;color:#687887;font-weight:600}.wl-app-menu-item>strong{color:#687887}.wl-app-menu-icon{width:38px;height:38px;border-radius:11px;background:#0b2a3f;color:#fff;display:grid;place-items:center;font-size:18px;font-weight:950}.wl-menu-future{margin-top:14px;padding:13px;border:1px dashed #bfcbd4;border-radius:13px;background:#eef3f6}.techMenuMini{white-space:nowrap}
    @media(min-width:900px){.wl-home{max-width:none!important}.wl-menu{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.wl-menu button,.wl-big{min-height:110px}.wl-title{font-size:34px}.wl-sub{max-width:760px}.wl-head{padding:18px 20px}.wl-question{padding:22px}.wl-question .qtext{font-size:24px}.wl-options{max-width:760px}.wl-options button{min-height:70px}.wl-nav{grid-template-columns:minmax(160px,.55fr) minmax(260px,1fr);max-width:760px}.wl-ticket{padding:18px}.wl-gallery{grid-template-columns:repeat(4,minmax(0,1fr))}.wl-gallery img{height:150px}}
    @media(max-width:560px){.wl-title{font-size:25px}.wl-sub{font-size:15px;margin-bottom:14px}.wl-menu{gap:10px}.wl-menu button,.wl-big{font-size:18px;min-height:72px;padding:15px 16px}.wl-nav{grid-template-columns:1fr 1.45fr;position:sticky;bottom:0;background:#f3f6f9;padding:8px 0 4px;z-index:15}.wl-nav button{min-height:58px}.wl-question{padding:15px}.wl-question .qtext{font-size:20px}.wl-options button{min-height:64px}.wl-head{margin-bottom:10px}.wl-ticket{padding:12px}.wl-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-sign canvas{height:160px}}
  `;
  document.head.appendChild(s);
}
function progress(kicker, title, step, total) {
  const ticketRef = activeItPrep?.ticket_no && isIT() ? `<div class='small' style='margin-top:6px;font-weight:850'>MHelpDesk Ticket #${esc(activeItPrep.ticket_no)}</div>` : '';
  return `<div class='wl-head'><div class='kicker'>${esc(kicker)}</div><h2>${esc(title)}</h2>${ticketRef}<div class='wl-progress'><span style='width:${Math.round(step / total * 100)}%'></span></div></div>`;
}
async function prepCounts() {
  const { data } = await liveDb.from('prep_tickets').select('id,status,ticket_no,site,expected_unit_count,created_at,released_at').order('created_at',{ascending:true});
  const rows = data || [];
  const drafts = rows.filter(r => r.status === 'draft');
  return { draft: drafts.length, released: rows.filter(r => r.status === 'released').length, closed: rows.filter(r => r.status === 'closed').length, nextDraft: drafts[0] || null };
}
async function returnCounts() { const { data } = await liveDb.from('unit_returns').select('id,status,ticket_no,unit_tag,equipment_type,returned_at').order('returned_at',{ascending:true}); const rows=data||[]; const waitingRows=rows.filter(r=>r.status==='waiting_it'); return { waiting:waitingRows.length, inventory:rows.filter(r=>r.status==='pending_mhelp_inventory').length, completed:rows.filter(r=>r.status==='completed').length, nextWaiting:waitingRows[0]||null }; }
async function returnRows() { const { data,error }=await liveDb.from('unit_returns').select('*').order('returned_at',{ascending:false}); if(error) throw error; return data||[]; }
async function returnPhotoHtml(paths) {
  const items = await Promise.all((paths || []).map(async path => {
    const { data, error } = await liveDb.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return `<div class='wl-note'>Photo unavailable — the saved file could not be loaded.</div>`;
    return `<a class='wl-return-photo' href='${esc(data.signedUrl)}' target='_blank'><img src='${esc(data.signedUrl)}' alt='Unit photo' loading='lazy'><span>View full photo</span></a>`;
  }));
  return items.join('');
}
async function myReturnCounts() { const { data: { session } } = await liveDb.auth.getSession(); if (!session?.user?.id) return { waiting:0, inventory:0, completed:0 }; const { data } = await liveDb.from('unit_returns').select('status').eq('service_tech_id', session.user.id); const rows=data||[]; return { waiting:rows.filter(r=>r.status==='waiting_it').length, inventory:rows.filter(r=>r.status==='pending_mhelp_inventory').length, completed:rows.filter(r=>r.status==='completed').length }; }
async function releasedPrepCount() { const { data } = await liveDb.from('prep_tickets').select('id').eq('status','released'); return (data||[]).length; }
async function serviceWorkData() {
  const { data:{ session } } = await liveDb.auth.getSession();
  if (!session?.user?.id) return { released:[], inspectionDone:false, deployed:[] };
  const dayStart = new Date(); dayStart.setHours(0,0,0,0);
  const [releasedQ, returnedQ, deployedQ, inspectionQ] = await Promise.all([
    liveDb.from('prep_tickets').select('id,ticket_no,site,released_at,created_at').eq('status','released').order('released_at',{ascending:true}),
    liveDb.from('unit_returns').select('ticket_no,unit_tag').eq('service_tech_id',session.user.id),
    liveDb.from('prep_tickets').select('id,ticket_no,site,closed_at,closed_by,prep_items(unit_tag,equipment_type)').eq('status','closed').eq('closed_by',session.user.id).order('closed_at',{ascending:false}).limit(30),
    liveDb.from('morning_checks').select('id').eq('service_tech_id',session.user.id).gte('submitted_at',dayStart.toISOString()).limit(1)
  ]);
  const returned = new Set((returnedQ.data||[]).map(r => `${norm(r.ticket_no)}|${norm(r.unit_tag)}`));
  const deployed = (deployedQ.data||[]).flatMap(p => (p.prep_items||[]).filter(i => i.unit_tag && !returned.has(`${norm(p.ticket_no)}|${norm(i.unit_tag)}`)).map(i => ({ ticket_no:p.ticket_no, site:p.site, closed_at:p.closed_at, unit_tag:i.unit_tag, equipment_type:i.equipment_type })));
  return { released:releasedQ.data||[], inspectionDone:(inspectionQ.data||[]).length>0, deployed };
}
async function loadOwnerReturnPhotos(details) { if (!details?.open || details.dataset.photosLoaded === '1') return; const row = ownerReturnRows.get(details.dataset.ownerReturn); if (!row) return; details.dataset.photosLoaded = '1'; const service = details.querySelector('[data-owner-service-photos]'); const intake = details.querySelector('[data-owner-intake-photos]'); if (service) { service.innerHTML = `<div class='wl-note'>Loading Service photos…</div>`; service.innerHTML = await returnPhotoHtml(row.return_photo_paths) || `<div class='wl-note'>No Service return photos saved.</div>`; } if (intake) { intake.innerHTML = `<div class='wl-note'>Loading IT photo…</div>`; intake.innerHTML = await returnPhotoHtml(row.intake_photo_paths) || `<div class='wl-note'>No IT intake photo saved.</div>`; } }
async function loadServiceReturnPhotos(details) { if (!details?.open || details.dataset.photosLoaded === '1') return; const row = serviceReturnRows.get(details.dataset.svcReturn); if (!row) return; details.dataset.photosLoaded = '1'; const host = details.querySelector('[data-svc-return-photos]'); if (!host) return; host.innerHTML = `<div class='wl-note'>Loading return photos…</div>`; host.innerHTML = `${await returnPhotoHtml(row.return_photo_paths)}${await returnPhotoHtml(row.intake_photo_paths)}` || `<div class='wl-note'>No return photos saved.</div>`; }
function filterOwnerReturns(value) { const q = String(value || '').trim().toLowerCase(); document.querySelectorAll('#ownerIntakeTracking details[data-owner-return]').forEach(el => { el.hidden = Boolean(q) && !String(el.dataset.ownerSearch || '').toLowerCase().includes(q); }); }
async function uploadReturnPhotos(files, returnId, stage) {
  const { data: { session } } = await liveDb.auth.getSession();
  if (!session?.user?.id) throw new Error('Please sign in again.');
  const paths = [];
  try {
    for (const original of [...files]) {
      const file = await optimizeEvidencePhoto(original);
      const safeName = (file.name || original.name || 'unit-photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${session.user.id}/${returnId}/returns/${stage}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { error } = await liveDb.storage.from(EVIDENCE_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
          if (error) throw error;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
        }
      }
      if (lastError) throw lastError;
      paths.push(path);
    }
    return paths;
  } catch (err) {
    if (paths.length) await Promise.all(paths.map(path => liveDb.storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => null)));
    throw new Error(err?.message === 'Failed to fetch' ? 'The photo upload lost its connection. Nothing was submitted. Check your connection and tap SEND THIS UNIT TO IT INTAKE again.' : (err?.message || 'Could not upload the return photos. Nothing was submitted.'));
  }
}
async function currentTechIdentity() {
  const { data } = await liveDb.auth.getUser();
  const user = data?.user;
  if (!user?.id) throw new Error('Please sign in again.');
  return { id: user.id, name: document.getElementById('whoName')?.textContent?.trim() || 'Technician' };
}

let notificationRealtimeChannel = null;
let notificationRealtimeUserId = null;
let ownerAssignmentProfiles = [];
let ownerAssignmentAssets = [];
let pendingAssignmentLinkId = null;
let pendingAssignmentManifest = [];
let pendingAssignmentWorkType = 'service';
let helpWalkthroughStep = 0;
let helpWalkthroughMode = 'help';
let walkthroughCheckedUserId = null;
let walkthroughDismissedSession = false;
const TECHCHECK_VAPID_PUBLIC_KEY = 'BAvDfBdTqTbyOxAOYDQ25EfMKregOkdUmOkVW_BlHEQ4CP--otdlOCrDobnj7eVUg-5YMcjVM8sfLHg_qNr2fq0';

function vapidKeyBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}
async function pushAlertState() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
  if (!supported) return { supported:false, permission:'unsupported', subscribed:false, ready:false };
  const permission = Notification.permission;
  let subscribed = false;
  if (permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      subscribed = Boolean(await reg.pushManager.getSubscription());
    } catch {}
  }
  return { supported:true, permission, subscribed, ready:permission === 'granted' && subscribed };
}
function phoneAlertBanner() { return ''; }
async function registerPhonePush() {
  const tech = await currentTechIdentity();
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(TECHCHECK_VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!p256dh || !auth) throw new Error('This device did not return a valid push subscription.');
  const { error } = await liveDb.from('push_subscriptions').upsert({
    user_id: tech.id,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return subscription;
}

function currentRoleKey() {
  const role = roleText();
  if (role.includes('Owner/Admin')) return 'owner';
  if (role.includes('Service Tech')) return 'service';
  return 'it';
}
function techCheckDateKey(value = new Date()) {
  const d=value instanceof Date ? value : new Date(value);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function helpStepsForRole(role = currentRoleKey()) {
  if (role === 'service') return [
    { kicker:'WELCOME', title:'Service Tech · How Tech Check Works', body:`<p>Tech Check is your technician workflow. <b>MHelpDesk stays separate.</b> Use the MHelpDesk reference in Tech Check to make sure you are working on the correct ticket.</p><p>Each new delivery, pickup, service call, or swap uses its own current MHelpDesk ticket. When that job is finished, it closes. The <b>unit number stays universal</b> in Tech Check so the unit history can follow it across different tickets.</p>` },
    { kicker:'MY WORK TODAY', title:'Start with the work assigned to you', body:`<p>Owner-assigned jobs appear at the top of <b>My Work Today</b>. A job may be sent directly to you or to the <b>Service Department queue</b>.</p><p>If it is a department task, tap <b>Claim & Start</b>. Once you claim it, the Owner can see which Service Tech took responsibility for the task.</p>` },
    { kicker:'RECEIVE FROM IT', title:'Receive equipment from the named IT Tech', body:`<p>When IT creates the handoff, Tech Check shows the MHelpDesk ticket, customer/site, exact units, parts, and the name of the <b>IT Tech who prepared the handoff</b>.</p><p>Do not accept equipment just because it is physically there. First make sure the Tech Check job matches your current MHelpDesk ticket.</p>` },
    { kicker:'VERIFY THE HANDOFF', title:'Physically check every unit and part', body:`<p>Verify the exact unit tags, battery/battery-box counts, photos, and every listed part quantity before accepting the handoff.</p><p>If Tech Check says IT Tech Teddy prepared Unit 058 and two SIM cards, you should physically have Unit 058 and two SIM cards before continuing. A mismatch should be corrected before you accept the equipment.</p>` },
    { kicker:'SOLAR DELIVERY CHECKOUT', title:'Solar Spotter and Ranger support is assigned automatically', body:`<p>For a <b>Solar Spotter DELIVERY</b>, finish checking the Solar Spotter first. Tech Check then automatically requires <b>one Solar Stand and four batteries per Solar Spotter</b>. Enter the stand tag, verify the MPPT update/test, verify the batteries are charged, connect the solar panel + batteries + MPPT together, and confirm charging.</p><p>Take a clear Solar Stand tag photo and upload a picture of the MPPT / charging readings. Battery proof and Service sign-off are also saved. For a <b>Ranger DELIVERY</b>, Tech Check automatically requires <b>one solar panel per Ranger</b>, and Service verifies the Ranger MPPT and charging. Helios still requires Cerbo + MPPT verification.</p>` },
    { kicker:'FIELD WORK', title:'Delivery, service, pickup, or swap', body:`<p>Use the current MHelpDesk ticket for the task you are doing today. A later visit gets a new ticket number even if the same unit is involved.</p><p>For a swap or pickup, the unit number lets Tech Check remember that equipment across old closed tickets and the new current ticket.</p>` },
    { kicker:'RETURN TO IT', title:'Send returning units and parts back to IT', body:`<p>When equipment comes back from the field, use <b>Return Unit to IT Intake</b>. Record the MHelpDesk reference, unit tag, condition, notes, and required photos.</p><p>The return is recorded under your name as the Service Tech who brought it back. IT then receives it, performs intake, and returns it to shelf inventory when ready.</p>` },
    { kicker:'DAILY TOOLS', title:'Inspection, phone alerts, and history', body:`<p>Complete the Truck / Trailer Inspection from your own account. Assigned work appears in <b>My Work Today</b>. Use History to review work that has already been submitted.</p><p>Open <b>Menu → Phone Alerts</b> once on your phone if you want Tech Check to alert you when the Owner sends new work.</p>` },
    { kicker:'SERVICE FLOW', title:'Your complete Service flow', body:`<div class='wl-help-flow'><b>OWNER / SERVICE QUEUE</b><span>→</span><b>SERVICE TECH CLAIMS</b><span>→</span><b>RECEIVE FROM IT</b><span>→</span><b>VERIFY UNITS + PARTS</b><span>→</span><b>AUTO SOLAR CHECKOUT</b><span>→</span><b>FIELD WORK</b><span>→</span><b>RETURN TO IT</b></div><p>The MHelpDesk job closes when that job is finished. The unit record continues.</p>` },
  ];
  if (role === 'owner') return [
    { kicker:'OWNER HELP', title:'Dispatch with control', body:`<p>Create a Tech Check job using the current MHelpDesk reference. Send it directly to a specific IT Tech or Service Tech, or send it to the department queue for a technician to claim.</p>` },
    { kicker:'LIVE PROGRESS', title:'See who took the task', body:`<p>The Owner dashboard shows <b>Sent → Claimed / In Process → Tech Check In Progress → Ready for Service → Done</b>. Department jobs change from waiting to the technician’s name as soon as that person claims the task.</p>` },
    { kicker:'ROLE SEPARATION', title:'IT and Service stay separate', body:`<p>IT Techs prepare equipment and create the handoff. Service Techs receive and verify the handoff, do the field work, and return equipment to IT. Returning equipment goes back through IT Intake before shelf inventory.</p>` },
    { kicker:'UNIT HISTORY', title:'Tickets close; units continue', body:`<p>Every new MHelpDesk job is a new job. Unit numbers remain universal in Tech Check so the same unit can be followed across different closed tickets.</p>` },
  ];
  return [
    { kicker:'WELCOME', title:'IT Tech · How Tech Check Works', body:`<p>Tech Check is your equipment-prep and intake workflow. <b>MHelpDesk stays separate.</b> Use the MHelpDesk reference in Tech Check to make sure you are working on the correct ticket.</p><p>Owner-assigned work is the normal flow, but IT can still create an <b>on-the-fly Equipment Prep</b> when the job requires it.</p>` },
    { kicker:'MY WORK TODAY', title:'Assigned work appears first', body:`<p>Your Owner may send a job directly to you or to the <b>IT Department queue</b>. Direct jobs are already yours. Department jobs can be claimed by an IT Tech.</p><p>When you claim a department task, the Owner immediately has a named IT Tech responsible for that work.</p>` },
    { kicker:'ON THE FLY', title:'IT can still start its own check', body:`<p>If an unexpected need comes up, use <b>Start New Equipment Prep</b>. Enter the current MHelpDesk reference, customer/site, total units, and parts required.</p><p>This does not create or change anything in MHelpDesk. It only makes the Tech Check workflow correspond to the correct job.</p>` },
    { kicker:'DEPLOYMENT', title:'Pull the real equipment from shelf inventory', body:`<p>For an assigned job, read the ticket information and requested equipment/parts first. Pull the actual units from the shelf, enter the exact unit tags, and complete each required check one unit at a time.</p><p>The unit tag is permanent in Tech Check. Old MHelpDesk jobs can close while the unit history continues.</p>` },
    { kicker:'RELEASE TO SERVICE', title:'Complete the named handoff', body:`<p>After every required check, photo, signature, and readiness item passes, create the handoff to Service.</p><p>Tech Check records the IT Tech who prepared it. The Service Tech must verify the exact units and listed parts before accepting the handoff.</p>` },
    { kicker:'INTAKE & RETURNS', title:'IT receives equipment coming back from Service', body:`<p>IT Intake is for units and parts returning from Service. The return shows the <b>Service Tech name</b>, MHelpDesk reference, unit tag, notes, and photos.</p><p>Complete the intake checks, document the unit, and move it through the Owner/Manager step before it returns to shelf inventory.</p>` },
    { kicker:'MENU & HISTORY', title:'Help, phone alerts, and history', body:`<p>Use <b>Menu → Help & Training</b> anytime you want to replay this walkthrough. Your assigned work stays under <b>My Work Today</b>, and Status & History shows previous IT work.</p><p>Open <b>Menu → Phone Alerts</b> once on your phone if you want Tech Check to alert you when new work is sent.</p>` },
    { kicker:'IT FLOW', title:'Your complete IT flow', body:`<div class='wl-help-flow'><b>OWNER / IT QUEUE</b><span>→</span><b>IT TECH CLAIMS</b><span>→</span><b>PULL FROM SHELF</b><span>→</span><b>TECH CHECK</b><span>→</span><b>HAND OFF TO SERVICE</b></div><p>Returns travel the other direction: <b>Service → IT Intake → Owner/Manager → Shelf Inventory.</b></p>` },
  ];
}
function ensureHelpOverlay() {
  let overlay = document.getElementById('wlHelpOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'wlHelpOverlay';
  overlay.className = 'wl-help-overlay hidden';
  overlay.innerHTML = `<div class='wl-help-sheet'><div class='wl-help-head'><div><div class='wl-next-kicker'>CAMERAS ONSITE</div><h2>Help & Training</h2></div><button class='mini' data-wl-help-close>Close</button></div><div id='wlHelpBody'></div></div>`;
  document.body.append(overlay);
  return overlay;
}
function renderHelpWalkthrough() {
  const overlay = ensureHelpOverlay();
  const body = document.getElementById('wlHelpBody');
  const steps = helpStepsForRole();
  helpWalkthroughStep = Math.max(0, Math.min(helpWalkthroughStep, steps.length - 1));
  const step = steps[helpWalkthroughStep];
  const pct = Math.round((helpWalkthroughStep + 1) / steps.length * 100);
  const firstTime = helpWalkthroughMode === 'first';
  const last = helpWalkthroughStep === steps.length - 1;
  body.innerHTML = `<div class='wl-help-progress'><span style='width:${pct}%'></span></div><div class='wl-help-step-count'>${helpWalkthroughStep + 1} of ${steps.length}</div><div class='wl-help-card'><div class='wl-next-kicker'>${esc(step.kicker)}</div><h2>${esc(step.title)}</h2><div class='wl-help-copy'>${step.body}</div></div><div class='wl-help-nav'><button class='wl-prev' data-wl-help-prev ${helpWalkthroughStep === 0 ? 'disabled' : ''}>Back</button>${firstTime && helpWalkthroughStep === 0 ? `<button class='wl-help-skip' data-wl-help-skip>Skip for now</button>` : '<span></span>'}<button class='wl-next ${last ? 'wl-finish' : ''}' data-wl-help-next>${last ? (firstTime ? 'Finish Setup ✓' : 'Close Help') : 'Next →'}</button></div>`;
  overlay.classList.remove('hidden');
}
async function openHelpWalkthrough(firstTime = false) {
  helpWalkthroughMode = firstTime ? 'first' : 'help';
  helpWalkthroughStep = 0;
  if (!firstTime) {
    const tech = await currentTechIdentity().catch(() => null);
    if (tech?.id) await liveDb.from('technician_training_state').upsert({ user_id:tech.id, last_help_opened_at:new Date().toISOString(), updated_at:new Date().toISOString() }, { onConflict:'user_id' });
  }
  renderHelpWalkthrough();
}
async function completeHelpWalkthrough() {
  if (helpWalkthroughMode !== 'first') { document.getElementById('wlHelpOverlay')?.classList.add('hidden'); return; }
  const tech = await currentTechIdentity().catch(() => null);
  if (tech?.id) {
    const now = new Date().toISOString();
    const { error } = await liveDb.from('technician_training_state').upsert({ user_id:tech.id, walkthrough_completed_at:now, last_help_opened_at:now, updated_at:now }, { onConflict:'user_id' });
    if (error) return alert(error.message);
  }
  document.getElementById('wlHelpOverlay')?.classList.add('hidden');
}
function ensureHelpButton() {
  // Help now lives inside the Tech Check Menu instead of a separate header button.
}
function ensureTechMenuPanel() {
  let panel = document.getElementById('wlTechMenuPanel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'wlTechMenuPanel';
  panel.className = 'wl-menu-overlay hidden';
  panel.innerHTML = `<div class='wl-menu-sheet'>
    <div class='wl-menu-head'>
      <div><div class='wl-next-kicker'>TECH CHECK</div><h2>Menu</h2></div>
      <button class='mini' data-wl-menu-close>Close</button>
    </div>
    <div id='wlTechMenuBody'></div>
  </div>`;
  document.body.append(panel);
  return panel;
}
async function openTechMenu() {
  const panel = ensureTechMenuPanel();
  const body = document.getElementById('wlTechMenuBody');
  const role = currentRoleKey();
  const push = role === 'owner' ? null : await pushAlertState();
  const pushLabel = !push ? '' : push.ready ? 'Phone alerts are enabled on this device.' : push.permission === 'denied' ? 'Phone alerts are blocked in this device settings.' : 'Enable once if you want new assignments to alert this phone.';
  body.innerHTML = `
    <div class='wl-app-menu-list'>
      <button class='wl-app-menu-item' data-wl-menu-help>
        <span class='wl-app-menu-icon'>?</span>
        <span><b>Help & Training</b><small>Replay the full ${role === 'it' ? 'IT Technician' : role === 'service' ? 'Service Tech' : 'Owner'} walkthrough.</small></span>
        <strong>›</strong>
      </button>
      ${role !== 'owner' ? `<button class='wl-app-menu-item' data-wl-menu-phone-alerts>
        <span class='wl-app-menu-icon'>↗</span>
        <span><b>Phone Alerts</b><small>${esc(pushLabel)}</small></span>
        <strong>${push?.ready ? 'ON' : '›'}</strong>
      </button>` : ''}
      <button class='wl-app-menu-item' data-wl-menu-refresh>
        <span class='wl-app-menu-icon'>↻</span>
        <span><b>Refresh Tech Check</b><small>Reload the latest assignments, equipment, and workflow status.</small></span>
        <strong>›</strong>
      </button>
    </div>
    ${role === 'owner' ? `<div class='wl-menu-future'><div class='wl-next-kicker'>OWNER TOOLS</div><b>AI Dispatch</b><div class='small'>This menu is ready for the Owner AI dispatch assistant we discussed. It is not enabled yet.</div></div>` : ''}
  `;
  panel.classList.remove('hidden');
}
async function maybeShowFirstTimeWalkthrough() {
  if (walkthroughDismissedSession || document.getElementById('appView')?.classList.contains('hidden')) return;
  const roleLabel = roleText();
  if (!roleLabel.includes('IT Technician') && !roleLabel.includes('Service Tech')) return;
  const tech = await currentTechIdentity().catch(() => null);
  if (!tech?.id || walkthroughCheckedUserId === tech.id) return;
  walkthroughCheckedUserId = tech.id;
  const { data } = await liveDb.from('technician_training_state').select('walkthrough_completed_at').eq('user_id',tech.id).maybeSingle();
  if (!data?.walkthrough_completed_at) openHelpWalkthrough(true);
}

async function myActiveAssignments(role = null) {
  const wantedRole = role || currentRoleKey();
  if (!['it','service'].includes(wantedRole)) return [];
  const { data, error } = await liveDb.rpc('my_available_assignments', { p_role: wantedRole });
  if (error) { console.warn('Could not load assignment queue', error); return []; }
  return data || [];
}
async function myAssignedInventoryAssets() {
  const tech = await currentTechIdentity().catch(() => null);
  if (!tech?.id) return [];
  const { data, error } = await liveDb.from('asset_inventory')
    .select('unit_key,unit_tag,asset_type,asset_category,availability_status,assigned_to_name,last_event')
    .eq('assigned_to', tech.id)
    .eq('availability_status', 'assigned')
    .order('asset_category', { ascending:true })
    .order('unit_tag', { ascending:true });
  if (error) { console.warn('Could not load assigned equipment', error); return []; }
  return data || [];
}
function assignedInventoryHtml(rows=[]) {
  if (!rows.length) return '';
  return `<div class='wl-assigned-inventory'><div class='wl-next-kicker'>EQUIPMENT ASSIGNED TO ME</div><div class='wl-assigned-inventory-list'>${rows.map(r => `<span><b>${esc(r.unit_tag)}</b> · ${esc(r.asset_type)}${r.asset_category === 'stand' ? ' · Stand' : ''}</span>`).join('')}</div></div>`;
}
async function myNotificationPreferences() {
  const tech = await currentTechIdentity();
  const { data } = await liveDb.from('notification_preferences').select('*').eq('user_id', tech.id).maybeSingle();
  return data || {
    new_assignments: true,
    returned_units: true,
    equipment_ready_service: true,
    owner_actions: true,
    browser_notifications: false,
  };
}
async function myNotifications(limit = 30) {
  const tech = await currentTechIdentity();
  const { data, error } = await liveDb.from('app_notifications')
    .select('*')
    .eq('recipient_user_id', tech.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}
async function refreshNotificationBadge() {
  if (document.getElementById('appView')?.classList.contains('hidden')) return;
  try {
    if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch {}
}
function ensureNotificationPanel() {
  let panel = document.getElementById('wlNotificationPanel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'wlNotificationPanel';
  panel.className = 'wl-notify-overlay hidden';
  panel.innerHTML = `<div class='wl-notify-sheet'><div class='wl-notify-head'><div><div class='wl-next-kicker'>TECH CHECK</div><h2>Notifications</h2></div><button class='mini' data-wl-notify-close>Close</button></div><div id='wlNotifyBody'></div></div>`;
  document.body.append(panel);
  return panel;
}
function notificationToggle(id, label, checked, detail = '') {
  return `<label class='wl-notify-toggle'><span><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</span><input id='${id}' type='checkbox' ${checked ? 'checked' : ''}></label>`;
}
async function openNotificationPanel() {
  const panel = ensureNotificationPanel();
  const body = document.getElementById('wlNotifyBody');
  const [prefs, rows, pushState] = await Promise.all([myNotificationPreferences(), myNotifications(30), pushAlertState()]);
  const role = currentRoleKey();
  const permission = pushState.permission;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const browserStatus = pushState.ready
    ? 'Phone alerts are ON. Tech Check can notify this device even when the app is closed.'
    : permission === 'denied'
      ? 'Alerts are blocked in this device’s notification settings.'
      : !pushState.supported
        ? 'Push alerts are not available in this browser. On iPhone, add Tech Check to the Home Screen and open the installed app.'
        : (!standalone && /iPhone|iPad|iPod/i.test(navigator.userAgent))
          ? 'On iPhone, add Tech Check to the Home Screen first, then open it and enable phone alerts.'
          : 'Tap Enable to allow Tech Check to notify this phone when work is assigned.';
  const toggles = [
    role !== 'owner' ? notificationToggle('wlPrefAssignments','New job assignments',prefs.new_assignments,'When the Owner assigns an MHelpDesk job directly to you.') : '',
    role === 'it' ? notificationToggle('wlPrefReturns','Returned units waiting for IT',prefs.returned_units,'When Service sends a unit back for IT Intake.') : '',
    role === 'service' ? notificationToggle('wlPrefService','Equipment ready for Service',prefs.equipment_ready_service,'When IT releases equipment for Service checkout.') : '',
    role === 'owner' ? notificationToggle('wlPrefOwner','Owner actions',prefs.owner_actions,'When IT finishes intake and MHelpDesk inventory confirmation is needed.') : '',
  ].join('');
  const inbox = rows.map(n => `<button class='wl-notify-item ${n.read_at ? '' : 'unread'}' data-wl-notification-id='${n.id}' ${n.assignment_id ? `data-wl-notification-assignment='${n.assignment_id}'` : ''}><span class='wl-notify-dot'></span><span><b>${esc(n.title)}</b><small>${esc(n.body)}</small><em>${new Date(n.created_at).toLocaleString()}</em></span></button>`).join('');
  body.innerHTML = `
    <div class='wl-notify-section'>
      <h3>Alert Settings</h3>
      ${toggles}
      <div class='wl-notify-system'>
        <div><b>iPhone / Browser Alerts</b><div class='small'>${esc(browserStatus)}</div></div>
        <button class='mini' data-wl-enable-browser-alerts>${pushState.ready ? 'Enabled' : 'Enable'}</button>
      </div>
      <div class='small top8'>Once enabled on this device, new Owner-assigned jobs can appear as phone notifications while Tech Check is closed. The Home Screen app badge also reflects unread Tech Check notifications when supported by the phone.</div>
      <button class='btn' data-wl-save-notify>Save Notification Settings</button>
    </div>
    <div class='wl-notify-section'>
      <div class='sectiontitle'><h3>Notification Inbox</h3><button class='mini' data-wl-notify-read-all>Mark all read</button></div>
      <div class='wl-notify-list'>${inbox || "<div class='ok'><b>✓ No notifications yet.</b></div>"}</div>
    </div>`;
  panel.classList.remove('hidden');
}
async function saveNotificationSettings() {
  const prefs = await myNotificationPreferences();
  const role = currentRoleKey();
  const browserAllowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const { error } = await liveDb.rpc('save_my_notification_preferences', {
    p_new_assignments: role === 'owner' ? Boolean(prefs.new_assignments) : Boolean(document.getElementById('wlPrefAssignments') ? document.getElementById('wlPrefAssignments').checked : prefs.new_assignments),
    p_returned_units: role === 'it' ? Boolean(document.getElementById('wlPrefReturns') ? document.getElementById('wlPrefReturns').checked : prefs.returned_units) : Boolean(prefs.returned_units),
    p_equipment_ready_service: role === 'service' ? Boolean(document.getElementById('wlPrefService') ? document.getElementById('wlPrefService').checked : prefs.equipment_ready_service) : Boolean(prefs.equipment_ready_service),
    p_owner_actions: role === 'owner' ? Boolean(document.getElementById('wlPrefOwner') ? document.getElementById('wlPrefOwner').checked : prefs.owner_actions) : Boolean(prefs.owner_actions),
    p_browser_notifications: browserAllowed,
  });
  if (error) return alert(error.message);
  alert('Notification settings saved.');
  await openNotificationPanel();
}
async function enableBrowserAlerts() {
  const state = await pushAlertState();
  if (!state.supported) {
    return alert('Phone push notifications are not available here. On iPhone, add Tech Check to the Home Screen, open the installed app, and try again.');
  }
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !standalone) {
    return alert('On iPhone, install Tech Check to your Home Screen first. Then open the Home Screen app and tap Enable again.');
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Notification permission was not enabled on this device.');
    await registerPhonePush();
    await saveNotificationSettings();
    alert('Phone alerts are enabled for Tech Check on this device.');
  } catch (error) {
    console.warn('Could not enable Tech Check push notifications', error);
    alert(error?.message || 'Could not enable phone alerts on this device.');
  }
}
async function showSystemNotification(row) {
  const prefs = await myNotificationPreferences();
  if (!prefs.browser_notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(row.title, {
        body: row.body,
        tag: 'techcheck-' + row.id,
        data: { url: location.href },
        icon: './icon-192.png',
        badge: './favicon-32x32.png',
      });
    } else {
      new Notification(row.title, { body: row.body });
    }
  } catch {}
}
async function setupNotificationRealtime() {
  if (document.getElementById('appView')?.classList.contains('hidden')) return;
  const tech = await currentTechIdentity().catch(() => null);
  if (!tech?.id || notificationRealtimeUserId === tech.id) return;
  if (notificationRealtimeChannel) {
    try { await liveDb.removeChannel(notificationRealtimeChannel); } catch {}
  }
  notificationRealtimeUserId = tech.id;
  notificationRealtimeChannel = liveDb
    .channel('tech-check-notifications-' + tech.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_notifications', filter: 'recipient_user_id=eq.' + tech.id }, payload => {
      refreshNotificationBadge();
      showSystemNotification(payload.new);
      if ((payload.new.kind === 'new_assignment' || payload.new.kind === 'returned_unit') && isIT() && !viewIT()?.classList.contains('hidden')) showITHome();
      if ((payload.new.kind === 'new_assignment' || payload.new.kind === 'equipment_ready_service') && isSvc() && !viewSvc()?.classList.contains('hidden')) showSvcHome();
      if (payload.new.kind === 'owner_action' && roleText().includes('Owner/Admin')) {
        installOwnerIntake(true);
        window.refreshData?.();
      }
    })
    .subscribe();
  refreshNotificationBadge();
}
async function startAssignedJob(id) {
  let { data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1);
  let assignment = rows?.[0];
  if (!assignment) return alert('That assignment is no longer available.');

  if (!assignment.assignee_user_id && assignment.assignment_scope === 'department') {
    const { error: claimError } = await liveDb.rpc('claim_my_department_assignment', { p_assignment_id: id });
    if (claimError) {
      alert(claimError.message || 'Another technician already claimed this department task.');
      if (assignment.assigned_role === 'it') showITHome(); else showSvcHome();
      return;
    }
    ({ data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1));
    assignment = rows?.[0];
    if (!assignment) return alert('The claimed assignment could not be reopened.');
  }

  if (assignment.assigned_role === 'it') {
    const tech = await currentTechIdentity();
    const { data: existing } = await liveDb.from('prep_tickets')
      .select('id,ticket_no,status,created_by')
      .eq('ticket_no', assignment.ticket_no)
      .eq('status', 'draft')
      .eq('created_by', tech.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (existing?.[0]) {
      const { error: linkError } = await liveDb.rpc('link_my_assignment_to_prep', { p_assignment_id: id, p_prep_id: existing[0].id });
      if (linkError) return alert(linkError.message);
      pendingAssignmentLinkId = null;
      return showItPrep(existing[0].id);
    }
    if (assignment.status !== 'started') await liveDb.rpc('set_my_job_assignment_status', { p_assignment_id: id, p_status: 'started' });
    pendingAssignmentLinkId = id;
    pendingAssignmentManifest = normalizedEquipmentManifest(assignment.equipment_manifest);
    pendingAssignmentWorkType = assignment.work_type || 'service';
    showNewPrep();
    const ticket = document.getElementById('itTicket');
    const site = document.getElementById('itSite');
    if (ticket) ticket.value = assignment.ticket_no || '';
    if (site) site.value = assignment.site || '';
    fillTicketPartInputs(assignment, 'wlPart');
    const requestedDevices = assignment.requested_unit_count == null ? equipmentManifestDeviceTotal(pendingAssignmentManifest) : Number(assignment.requested_unit_count || 0);
    const totalInput = document.getElementById('wlTotalUnits');
    if (totalInput) totalInput.value = String(requestedDevices);
    syncITEquipmentCounts();
    totalInput?.focus();
    return;
  }

  activeSvcAssignment = assignment;
  const { data: released } = await liveDb.from('prep_tickets')
    .select('id,ticket_no,status')
    .eq('ticket_no', assignment.ticket_no)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(1);
  if (!released?.length) {
    if (assignment.status !== 'started') await liveDb.rpc('set_my_job_assignment_status', { p_assignment_id: id, p_status: 'started' });
    return alert('This MHelpDesk job is assigned to you, but IT has not released the equipment yet. It will stay under My Work Today.');
  }
  const { error: linkError } = await liveDb.rpc('link_my_assignment_to_prep', { p_assignment_id: id, p_prep_id: released[0].id });
  if (linkError) return alert(linkError.message);
  return openServiceTicket(assignment.ticket_no);
}
async function openAssignmentFromNotification(id) {
  const { data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1);
  const assignment = rows?.[0];
  if (!assignment) return;
  document.getElementById('wlNotificationPanel')?.classList.add('hidden');
  return startAssignedJob(id);
}

async function showITHome() {
  if (!isIT() || !viewIT()) return;
  let home = document.getElementById('wlItHome');
  if (!home) { home = document.createElement('div'); home.id = 'wlItHome'; home.className = 'card wl-home'; viewIT().prepend(home); }
  const [c,r,assignments,phoneAlerts,assignedAssets] = await Promise.all([prepCounts(), returnCounts(), myActiveAssignments('it'), pushAlertState(), myAssignedInventoryAssets()]);
  const assigned = assignments[0] || null;
  const alertBanner = phoneAlertBanner(phoneAlerts);
  const resumeLabel = c.draft === 1 && c.nextDraft ? `▶ Resume MHelpDesk #${esc(c.nextDraft.ticket_no)}` : '▶ Continue Pending Prep';
  const assignmentAction = assigned ? `<div class='wl-next-action wl-assigned-next'><div class='wl-next-kicker'>ASSIGNED TO ME · FROM OWNER</div><b>MHelpDesk Ref #${esc(assigned.ticket_no)}</b><div class='small'>${esc(assigned.site || 'No customer / site entered')}</div>${assigned.work_type ? `<div class='small'><b>Job Type:</b> ${esc(assigned.work_type.toUpperCase())}</div>` : ''}${assigned.scheduled_for ? `<div class='small'><b>Work Date:</b> ${new Date(assigned.scheduled_for + 'T12:00:00').toLocaleDateString()}</div>` : ''}${assigned.requested_unit_count != null ? `<div class='small'><b>${String(assigned.work_type || '').toLowerCase() === 'pickup' ? 'Units Being Picked Up' : 'Units Required From MHelpDesk'}:</b> ${Number(assigned.requested_unit_count)}</div>` : ''}${assigned.unit_summary ? `<div class='small'><b>Unit / Equipment Notes:</b> ${esc(assigned.unit_summary)}</div>` : ''}${assigned.job_description ? `<div class='small'><b>Work:</b> ${esc(assigned.job_description)}</div>` : ''}${equipmentManifestInlineHtml(assigned)}${ticketPartsInlineHtml(assigned)}${automaticServiceSolarPlanHtml(assigned.equipment_manifest,assigned.work_type)}${assigned.notes ? `<div class='small'><b>Owner Notes:</b> ${esc(assigned.notes)}</div>` : ''}<button class='wl-big wl-blue top10' data-wl-start-assignment='${assigned.id}'>${assigned.status === 'started' ? 'Continue Assigned Job' : 'Open Assigned Job'} →</button></div>` : '';
  const nextAction = assignmentAction || (r.nextWaiting ? `<div class='wl-next-action'><div class='wl-next-kicker'>NEXT ACTION</div><b>IT Intake · Unit ${esc(r.nextWaiting.unit_tag)}</b><div class='small'>${esc(r.nextWaiting.equipment_type || 'Returned unit')} · MHelpDesk #${esc(r.nextWaiting.ticket_no)}</div><button class='wl-big wl-blue top10' data-wl-next-it-intake='${r.nextWaiting.id}'>Start / Continue IT Intake →</button></div>` : c.nextDraft ? `<div class='wl-next-action'><div class='wl-next-kicker'>NEXT ACTION</div><b>Finish IT Prep · MHelpDesk #${esc(c.nextDraft.ticket_no)}</b><div class='small'>${esc(c.nextDraft.site || 'No site / description')}</div><button class='wl-big wl-blue top10' data-wl-open-it='${c.nextDraft.id}'>Continue Exact Ticket →</button></div>` : `<div class='wl-next-action clear'><div class='wl-next-kicker'>NEXT ACTION</div><b>✓ No IT work is currently waiting.</b><div class='small'>Start a new equipment prep when the next MHelpDesk job is ready.</div></div>`);
  home.innerHTML = `${alertBanner}<div class='wl-mode-pills'><button class='on wl-mode-card' data-wl-mode='deployment'><span class='wl-mode-title'>Deployment</span><span class='wl-mode-sub'>Prepare & release equipment</span></button><button class='wl-mode-card' data-wl-mode='intake'><span class='wl-mode-title'>Intake & Returns</span><span class='wl-mode-sub'>Process returned units</span><span class='wl-mode-badge'>${r.waiting+r.inventory}</span></button></div><div class='wl-title'>My Work Today</div><div class='wl-sub'>Owner-assigned jobs appear here first, followed by the next workflow action.</div>${nextAction}<div class='wl-workstrip'><span><b>${assignments.length}</b> assigned to me</span><span><b>${c.draft}</b> pending prep</span><span><b>${r.waiting}</b> returns waiting</span></div>${assignedInventoryHtml(assignedAssets)}<div class='wl-menu'><button class='wl-blue' data-wl-it='new'>＋ Start New Equipment Prep</button><button class='${c.draft ? 'wl-red' : 'wl-gray'}' data-wl-it='pending'>${resumeLabel} <span class='wl-count'>${c.draft}</span></button><button class='wl-gray' data-wl-it='history'>☰ Status & History <span class='wl-count'>${c.released + c.closed}</span></button></div>`;
  hideChildren(viewIT(), [home]);
  resetWizardPosition();
}
function itCreateCard() { return document.getElementById('itTicket')?.closest('.card'); }
function createParts() {
  const card = itCreateCard();
  return { card, section: card?.querySelector('.sectiontitle'), intro: card?.querySelector('.sectiontitle')?.nextElementSibling, ticket: card?.querySelector('.grid'), title: [...(card?.querySelectorAll('h3') || [])].find(x => /Equipment Required/i.test(x.textContent)), eq: card?.querySelector('.grid3'), recon: document.getElementById('reconBatteryWrap'), add: [...(card?.querySelectorAll('button') || [])].find(b => /Add Requirement|Add Equipment/i.test(b.textContent)), draft: document.getElementById('needDraft'), create: [...(card?.querySelectorAll('button') || [])].find(b => /Create IT Equipment Prep/i.test(b.textContent)), msg: document.getElementById('itCreateMessage') };
}
function ensureTotalUnitsField(ticketGrid) {
  if (!ticketGrid) return null;
  const site = document.getElementById('itSite');
  const siteLabel = site?.previousElementSibling;
  if (siteLabel?.tagName === 'LABEL') siteLabel.textContent = 'Ticket Name / Customer / Site';
  let wrap = document.getElementById('wlTotalUnitsWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'wlTotalUnitsWrap';
    wrap.innerHTML = `<label>Total Units / Devices for This Ticket</label><input id='wlTotalUnits' type='number' inputmode='numeric' min='0' readonly placeholder='Choose units below'><div class='small'>Auto-calculated from the Unit Area below. Stands are separate.</div>`;
    ticketGrid.append(wrap);
  }
  return wrap;
}
function expectedUnitCount() {
  return Math.max(0, Math.floor(Number(document.getElementById('wlTotalUnits')?.value || 0)));
}
function expectedPrepItemCount() {
  const manifest=readITEquipmentManifest();
  return equipmentManifestDeviceTotal(manifest) + equipmentManifestStandTotal(manifest);
}
const TICKET_PARTS = [
  { key:'solar_panel_qty', id:'SolarPanels', label:'Solar Panels' },
  { key:'battery_replacement_qty', id:'BatteryReplacements', label:'Replacement Batteries' },
  { key:'camera_replacement_qty', id:'CameraReplacements', label:'Replacement Cameras' },
  { key:'sim_replacement_qty', id:'SimReplacements', label:'Replacement SIM Cards' },
  { key:'micro_sd_qty', id:'MicroSdCards', label:'Replacement SD / Micro SD Cards' },
];
function cleanPartQty(value) { return Math.max(0, Math.floor(Number(value || 0))); }
function readTicketPartInputs(prefix='wlPart') {
  const out = {};
  TICKET_PARTS.forEach(part => { out[part.key] = cleanPartQty(document.getElementById(prefix + part.id)?.value); });
  return out;
}
function ticketPartsRows(data) {
  return TICKET_PARTS.map(part => ({ ...part, qty: cleanPartQty(data?.[part.key]) }));
}
function ticketPartsTotal(data) { return ticketPartsRows(data).reduce((sum,row) => sum + row.qty, 0); }
function ticketPartsInlineHtml(data) {
  const rows = ticketPartsRows(data).filter(row => row.qty > 0);
  return rows.length ? `<div class='wl-parts-summary'><b>Parts Required</b><div class='wl-parts-chips'>${rows.map(row => `<span><b>${row.qty}</b> × ${esc(row.label)}</span>`).join('')}</div></div>` : `<div class='wl-parts-summary'><b>Parts Required</b><div class='small'>No extra replacement parts listed.</div></div>`;
}
function ticketPartsInputsHtml(prefix='wlPart', data={}) {
  return `<div class='wl-parts-grid'>${TICKET_PARTS.map(part => `<label><span>${esc(part.label)}</span><input id='${prefix}${part.id}' type='number' inputmode='numeric' min='0' step='1' value='${cleanPartQty(data?.[part.key])}'></label>`).join('')}</div>`;
}
const OWNER_DEVICE_TYPES = ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'];
const OWNER_STAND_TYPES = ['110V Stand','Solar Stand','Solar Pole','Pole'];
function equipmentDisplayLabel(label) { return label === 'Recon 2' ? 'Recon II' : label; }
function normalizedEquipmentManifest(raw) {
  return (Array.isArray(raw) ? raw : []).map(row => ({
    category: ['device','stand','other'].includes(row?.category) ? row.category : 'other',
    label: String(row?.label || '').trim() === 'Recon II' ? 'Recon 2' : String(row?.label || '').trim(),
    qty: Math.max(1, Math.floor(Number(row?.qty || 1))),
  })).filter(row => row.label);
}
function equipmentManifestTotal(raw) {
  return normalizedEquipmentManifest(raw).filter(row => row.category === 'device' || row.category === 'stand').reduce((sum,row) => sum + row.qty, 0);
}
function equipmentManifestStandTotal(raw) {
  return normalizedEquipmentManifest(raw).filter(row => row.category === 'stand').reduce((sum,row) => sum + row.qty, 0);
}
function equipmentManifestDeviceTotal(raw) {
  return normalizedEquipmentManifest(raw).filter(row => row.category === 'device').reduce((sum,row) => sum + row.qty, 0);
}
function equipmentManifestText(raw) {
  return normalizedEquipmentManifest(raw).map(row => row.qty + ' × ' + row.label).join(' · ');
}

function equipmentManifestExpanded(raw) {
  const out=[];
  normalizedEquipmentManifest(raw).forEach(row => {
    if (row.category !== 'device' && row.category !== 'stand') return;
    for (let i=0;i<row.qty;i++) out.push(row.label);
  });
  return out;
}
function manifestQty(raw,label) {
  return normalizedEquipmentManifest(raw).filter(row => row.label===label).reduce((sum,row)=>sum+row.qty,0);
}
function prepPurposeFromWorkType(workType) {
  const type=String(workType || '').toLowerCase();
  if (type==='delivery') return 'DELIVERY';
  if (type==='swap') return 'SWAP';
  return '';
}
function automaticServiceSolarPlan(raw,workType='service') {
  const delivery=String(workType || '').toLowerCase()==='delivery';
  if (!delivery) return { spotters:0,rangers:0,stands:0,batteries:0,panels:0 };
  const spotters=manifestQty(raw,'Solar Spotter');
  const rangers=manifestQty(raw,'Ranger');
  return { spotters,rangers,stands:spotters,batteries:spotters*4,panels:rangers };
}
function automaticServiceSolarPlanHtml(raw,workType='service') {
  const plan=automaticServiceSolarPlan(raw,workType);
  if (!plan.spotters && !plan.rangers) return '';
  const chips=[];
  if (plan.stands) chips.push(`<span><b>${plan.stands}</b> × Solar Stand automatically required for Service</span>`);
  if (plan.batteries) chips.push(`<span><b>${plan.batteries}</b> × batteries automatically required for Service (${plan.spotters} Solar Spotter${plan.spotters===1?'':'s'} × 4)</span>`);
  if (plan.panels) chips.push(`<span><b>${plan.panels}</b> × Solar Panel automatically required for Service (${plan.rangers} Ranger${plan.rangers===1?'':'s'})</span>`);
  return `<div class='wl-auto-service-plan'><b>AUTO SERVICE CHECKOUT</b><div class='small'>These Service-side requirements are generated automatically from the Delivery equipment above. Do not add the automatic Solar Stand to the IT prep list.</div><div class='wl-parts-chips'>${chips.join('')}</div></div>`;
}
function refreshOwnerAutoServicePlan() {
  const host=document.getElementById('ownerAutoServicePlan');
  if (!host) return;
  const type=document.getElementById('ownerAssignWorkType')?.value || 'service';
  host.innerHTML=automaticServiceSolarPlanHtml(readOwnerEquipmentManifest(),type);
  host.classList.toggle('hidden',!host.innerHTML);
}


function equipmentManifestInlineHtml(data) {
  const rows = normalizedEquipmentManifest(data?.equipment_manifest || data);
  if (!rows.length) return '';
  const devices = rows.filter(r => r.category === 'device');
  const stands = rows.filter(r => r.category === 'stand');
  const other = rows.filter(r => r.category === 'other');
  const group = (title,list) => list.length ? `<div class='wl-manifest-group'><b>${esc(title)}</b><div class='wl-parts-chips'>${list.map(row => `<span><b>${row.qty}</b> × ${esc(equipmentDisplayLabel(row.label))}</span>`).join('')}</div></div>` : '';
  const pickup = String(data?.work_type || '').toLowerCase() === 'pickup';
  return `<div class='wl-equipment-manifest'><div class='wl-manifest-title'>${pickup ? 'Equipment Being Picked Up / Returned to Shop' : 'Equipment Required From Shelf'}</div>${group(pickup ? 'Units / Devices Being Picked Up' : 'Units / Devices',devices)}${group(pickup ? 'Stands / Poles Being Picked Up' : 'Stands',stands)}${group('Other Equipment',other)}</div>`;
}
function ownerEquipmentTypeList(category) {
  const defaults = category === 'stand' ? OWNER_STAND_TYPES : OWNER_DEVICE_TYPES;
  const fromInventory = ownerAssignmentAssets.filter(a => a.asset_category === category && a.availability_status !== 'retired').map(a => a.asset_type);
  return [...new Set([...defaults,...fromInventory].filter(Boolean))];
}
function ownerEquipmentQtyGrid(category) {
  return ownerEquipmentTypeList(category).map(label => {
    const available = ownerAssignmentAssets.filter(a => a.asset_category === category && a.asset_type === label && a.availability_status === 'shop').length;
    return `<label class='wl-owner-equipment-qty'><span>${esc(equipmentDisplayLabel(label))}</span><small data-owner-stock-count>${available} in shop</small><input type='number' inputmode='numeric' min='0' step='1' value='0' data-owner-equipment-qty data-category='${category}' data-label='${esc(label)}'></label>`;
  }).join('');
}
function ownerEquipmentManifestInputsHtml() {
  return `<div class='wl-owner-equipment-requirements'><div class='wl-requirement-section unitArea'><div class='wl-requirement-heading'>UNIT AREA — Units / Devices Being Sent</div><div class='small'>Choose the unit types and quantities that match the MHelpDesk ticket.</div><div class='wl-owner-equipment-grid top8'>${ownerEquipmentQtyGrid('device')}</div></div><div class='wl-requirement-section standArea'><div class='wl-requirement-heading'>STAND AREA — Manual Stand Requirements</div><div class='small'>Use this only when the MHelpDesk job specifically calls for a stand as part of IT prep. For a Solar Spotter DELIVERY, Tech Check automatically creates the Service-side Solar Stand checkout, so do not add that automatic stand here.</div><div class='wl-owner-equipment-grid top8'>${ownerEquipmentQtyGrid('stand')}</div></div></div>`;
}
function readOwnerEquipmentManifest() {
  return [...document.querySelectorAll('#ownerJobAssignments [data-owner-equipment-qty]')].map(input => ({ category: input.dataset.category || 'other', label: input.dataset.label || '', qty: cleanPartQty(input.value) })).filter(row => row.label && row.qty > 0);
}
function itEquipmentQtyGrid(category, data=[]) {
  const rows=normalizedEquipmentManifest(data);
  const types=category === 'stand' ? OWNER_STAND_TYPES : OWNER_DEVICE_TYPES;
  return types.map(label => {
    const qty=rows.find(row => row.category===category && row.label===label)?.qty || 0;
    return `<label class='wl-owner-equipment-qty'><span>${esc(equipmentDisplayLabel(label))}</span><input type='number' inputmode='numeric' min='0' step='1' value='${qty}' data-it-equipment-qty data-category='${category}' data-label='${esc(label)}'></label>`;
  }).join('');
}
function itEquipmentManifestInputsHtml(data=[]) {
  return `<div class='wl-owner-equipment-requirements'><div class='wl-requirement-section unitArea'><div class='wl-requirement-heading'>UNIT AREA — Units / Devices Being Sent</div><div class='small'>Choose exactly what is going out for this MHelpDesk ticket.</div><div class='wl-owner-equipment-grid top8'>${itEquipmentQtyGrid('device',data)}</div></div><div class='wl-requirement-section standArea'><div class='wl-requirement-heading'>STAND AREA — Stands Being Sent</div><div class='small'>Stands are counted separately from the unit/device count.</div><div class='wl-owner-equipment-grid top8'>${itEquipmentQtyGrid('stand',data)}</div></div></div>`;
}
function readITEquipmentManifest() {
  return [...document.querySelectorAll('#wlITEquipmentWrap [data-it-equipment-qty]')].map(input => ({
    category: input.dataset.category || 'other',
    label: input.dataset.label || '',
    qty: cleanPartQty(input.value),
  })).filter(row => row.label && row.qty > 0);
}
function equipmentManifestKey(raw) {
  return normalizedEquipmentManifest(raw).map(row => row.category+'|'+row.label+'|'+row.qty).sort().join('||');
}
function syncITEquipmentCounts() {
  const manifest=readITEquipmentManifest();
  const unitCount=equipmentManifestDeviceTotal(manifest);
  const standCount=equipmentManifestStandTotal(manifest);
  const total=document.getElementById('wlTotalUnits');
  if (total) total.value=String(unitCount);
  const summary=document.getElementById('wlITEquipmentCountSummary');
  if (summary) summary.innerHTML=`<b>${unitCount}</b> unit/device${unitCount===1?'':'s'} · <b>${standCount}</b> stand/pole${standCount===1?'':'s'} · <b>${unitCount+standCount}</b> total equipment item${unitCount+standCount===1?'':'s'}`;
}
function ensureITEquipmentManifestFields(ticketGrid) {
  if (!ticketGrid) return null;
  let wrap=document.getElementById('wlITEquipmentWrap');
  if (!wrap) {
    wrap=document.createElement('div');
    wrap.id='wlITEquipmentWrap';
    wrap.className='wl-ticket-parts-setup wl-it-equipment-setup';
    wrap.style.gridColumn='1 / -1';
    ticketGrid.append(wrap);
  }
  wrap.innerHTML=`<div class='qtext'>Parts Required From This Ticket</div><div class='small'>Choose the exact units/devices, stands, and extra parts being sent for this MHelpDesk ticket.</div>${itEquipmentManifestInputsHtml(pendingAssignmentManifest)}<div id='wlITEquipmentCountSummary' class='wl-equipment-count-summary'></div><div class='wl-requirement-section partsArea'><div class='wl-requirement-heading'>PARTS / SUPPLIES</div>${ticketPartsInputsHtml('wlPart')}</div>`;
  wrap.querySelectorAll('[data-it-equipment-qty]').forEach(input => input.addEventListener('input', syncITEquipmentCounts));
  syncITEquipmentCounts();
  return wrap;
}
function ensureTicketPartsFields(ticketGrid) {
  return document.getElementById('wlITEquipmentWrap');
}
function fillTicketPartInputs(data, prefix='wlPart') {
  TICKET_PARTS.forEach(part => {
    const el = document.getElementById(prefix + part.id);
    if (el) el.value = String(cleanPartQty(data?.[part.key]));
  });
}
function draftedUnitCount() {
  return [...document.querySelectorAll('#needDraft .item b')].reduce((sum, el) => {
    const match = el.textContent.match(/(\d+)\s*[×x]/i);
    return sum + Number(match?.[1] || 0);
  }, 0);
}
function updateUnitCountStatus() {
  const status = document.getElementById('wlUnitCountStatus');
  if (!status) return;
  const expected = expectedPrepItemCount();
  const added = draftedUnitCount();
  const remaining = expected - added;
  status.className = remaining === 0 ? 'ok' : remaining > 0 ? 'warn' : 'bad';
  status.innerHTML = remaining === 0 ? `<b>✓ ${added} of ${expected} units added.</b> You can continue to Unit 1.` : remaining > 0 ? `<b>${added} of ${expected} units added.</b> Add ${remaining} more unit${remaining === 1 ? '' : 's'}.` : `<b>${added} units added but the ticket says ${expected}.</b> Remove ${Math.abs(remaining)} unit${Math.abs(remaining) === 1 ? '' : 's'} before continuing.`;
}
function showNewPrep() {
  const p = createParts();
  if (!p.card) return;
  itCreateStep = 0;
  const totalWrap = ensureTotalUnitsField(p.ticket);
  const equipmentWrap = ensureITEquipmentManifestFields(p.ticket);
  const partsWrap = ensureTicketPartsFields(p.ticket);
  hideChildren(viewIT(), [p.card]);
  [...p.card.children].forEach(el => el.style.display = 'none');
  let head = document.getElementById('wlCreateHead');
  if (!head) { head = document.createElement('div'); head.id = 'wlCreateHead'; p.card.prepend(head); }
  let nav = document.getElementById('wlCreateNav');
  if (!nav) { nav = document.createElement('div'); nav.id = 'wlCreateNav'; p.card.append(nav); }
  head.style.display = '';
  nav.style.display = '';
  if (p.ticket) p.ticket.style.display = 'grid';
  if (totalWrap) totalWrap.style.display = '';
  if (equipmentWrap) equipmentWrap.style.display = '';
  if (partsWrap) partsWrap.style.display = '';
  head.innerHTML = progress('Job Setup', 'Enter the ticket, units, and parts required', 1, 1);
  let req = document.getElementById('wlAssignedEquipmentReq');
  if (!req) { req = document.createElement('div'); req.id = 'wlAssignedEquipmentReq'; nav.before(req); }
  req.style.display = pendingAssignmentManifest.length ? '' : 'none';
  req.innerHTML = pendingAssignmentManifest.length ? `<div class='wl-review'><b>Owner Assignment · ${esc(String(pendingAssignmentWorkType || 'service').toUpperCase())}</b><div class='small'>The IT equipment above was prefilled from the Owner assignment. Solar Spotter Delivery support (Solar Stand + 4 batteries per Spotter) and Ranger solar panels are handled automatically on the Service side.</div>${equipmentManifestInlineHtml(pendingAssignmentManifest)}${automaticServiceSolarPlanHtml(pendingAssignmentManifest,pendingAssignmentWorkType)}</div>` : '';
  nav.innerHTML = `<div class='wl-nav'><button class='wl-prev' data-wl-create='prev'>← IT Home</button><button class='wl-next' data-wl-create='finish'>Start Unit 1 →</button></div>`;
  resetWizardPosition();
}
function validateCreateStep() {
  if (!document.getElementById('itTicket')?.value.trim()) { alert('Enter the MHelpDesk ticket number first.'); return false; }
  if (!document.getElementById('itSite')?.value.trim()) { alert('Enter the ticket name / customer / site so Service can verify the same ticket.'); return false; }
  const manifest = readITEquipmentManifest();
  const unitCount = equipmentManifestDeviceTotal(manifest);
  const standCount = equipmentManifestStandTotal(manifest);
  const totalItems = unitCount + standCount;
  if (totalItems < 1) { alert('Choose at least one unit/device or stand being sent out.'); return false; }
  if (expectedUnitCount() !== unitCount) { alert('The Unit Area total does not match the Total Units / Devices field.'); return false; }
  if (pendingAssignmentManifest.length && equipmentManifestKey(manifest) !== equipmentManifestKey(pendingAssignmentManifest)) {
    alert('This assigned job must match the Owner’s Unit Area and Stand Area. If the equipment changed, have the Owner update the assignment before continuing.');
    return false;
  }
  itExpectedUnits = totalItems;
  return true;
}
async function createPrepAndStartChecks() {
  if (!validateCreateStep()) return;
  const ticket = document.getElementById('itTicket').value.trim();
  const site = document.getElementById('itSite').value.trim();
  const manifest = readITEquipmentManifest();
  const requestedUnits = equipmentManifestDeviceTotal(manifest);
  const totalItems = requestedUnits + equipmentManifestStandTotal(manifest);
  const parts = readTicketPartInputs('wlPart');
  document.body.classList.add('busy');
  const { data: prepId, error } = await liveDb.rpc('create_it_prep_shell_v4', {
    p_ticket_no: ticket,
    p_site: site,
    p_requested_unit_count: requestedUnits,
    p_equipment_manifest: manifest,
    p_solar_panel_qty: parts.solar_panel_qty,
    p_battery_replacement_qty: parts.battery_replacement_qty,
    p_camera_replacement_qty: parts.camera_replacement_qty,
    p_sim_replacement_qty: parts.sim_replacement_qty,
    p_micro_sd_qty: parts.micro_sd_qty,
    p_work_type: pendingAssignmentWorkType || 'service',
  });
  document.body.classList.remove('busy');
  if (error) return alert(error.message);
  if (pendingAssignmentLinkId) {
    const { error: linkError } = await liveDb.rpc('link_my_assignment_to_prep', { p_assignment_id: pendingAssignmentLinkId, p_prep_id: prepId });
    if (linkError) return alert(linkError.message);
    pendingAssignmentLinkId = null;
  }
  pendingAssignmentManifest = [];
  pendingAssignmentWorkType = 'service';
  document.getElementById('itTicket').value = '';
  document.getElementById('itSite').value = '';
  const totalInput = document.getElementById('wlTotalUnits');
  if (totalInput) totalInput.value = '';
  document.querySelectorAll('#wlITEquipmentWrap [data-it-equipment-qty]').forEach(input => { input.value='0'; });
  fillTicketPartInputs({}, 'wlPart');
  itExpectedUnits = totalItems;
  await window.refreshData?.();
  return showItPrep(prepId);
}
async function showITIntake() {
  if (!isIT() || !viewIT()) return;
  let card = document.getElementById('wlItIntake');
  if (!card) { card = document.createElement('div'); card.id = 'wlItIntake'; card.className = 'card wl-home'; viewIT().append(card); }
  const c = await returnCounts();
  card.className = 'card wl-home';
  card.innerHTML = `<div class='wl-mode-pills'><button class='wl-mode-card' data-wl-mode='deployment'><span class='wl-mode-title'>Deployment</span><span class='wl-mode-sub'>Prepare & release equipment</span></button><button class='on wl-mode-card' data-wl-mode='intake'><span class='wl-mode-title'>Intake & Returns</span><span class='wl-mode-sub'>Process returned units</span><span class='wl-mode-badge'>${c.waiting+c.inventory}</span></button></div><div class='wl-title'>What do you need to do?</div><div class='wl-sub'>Process returned Service units the same way as Deployment: one unit and one step at a time.</div><div class='wl-menu'><button class='${c.waiting ? 'wl-red' : 'wl-gray'}' data-wl-intake-view='waiting'>▶ Start / Continue Returned Unit <span class='wl-count'>${c.waiting}</span></button><button class='${c.inventory ? 'wl-red' : 'wl-gray'}' data-wl-intake-view='inventory'>▣ Pending MHelpDesk Inventory <span class='wl-count'>${c.inventory}</span></button><button class='wl-gray' data-wl-intake-view='history'>☰ Status & History <span class='wl-count'>${c.completed}</span></button></div>`;
  hideChildren(viewIT(), [card]);
  resetWizardPosition();
}
async function showITIntakeList(kind = 'waiting') {
  const rows = await returnRows();
  const filtered = kind === 'waiting' ? rows.filter(r => r.status === 'waiting_it') : kind === 'inventory' ? [] : rows.filter(r => r.status === 'completed');
  let card = document.getElementById('wlIntakeList');
  if (!card) { card = document.createElement('div'); card.id = 'wlIntakeList'; card.className = 'card'; viewIT().append(card); }
  const title = kind === 'waiting' ? 'Choose a returned unit to check' : kind === 'inventory' ? 'Owner/Manager handles MHelpDesk inventory' : 'Completed returned-unit history';
  const kicker = kind === 'waiting' ? 'Returned / Waiting for IT' : kind === 'inventory' ? 'Sent to Owner / Manager' : 'Intake Status & History';
  const items = await Promise.all(filtered.map(async r => `<div class='wl-ticket'><b>${esc(r.unit_tag)} · ${esc(r.equipment_type || 'Unit')}</b><div><b>MHelpDesk #${esc(r.ticket_no)}</b></div><div class='small'>Returned by ${esc(r.service_tech_name)} · ${new Date(r.returned_at).toLocaleString()}</div>${r.return_notes ? `<div class='small top8'>Service notes: ${esc(r.return_notes)}</div>` : ''}<div class='wl-return-gallery'>${await returnPhotoHtml(r.return_photo_paths)}${kind !== 'waiting' ? await returnPhotoHtml(r.intake_photo_paths) : ''}</div>${kind === 'waiting' ? `<button class='wl-big wl-blue top10' data-wl-intake-start='${r.id}'>Start / Continue This Unit →</button>` : `<div class='ok top10'>✓ Completed · ${esc(r.it_tech_name || 'IT')}</div>`}</div>`));
  card.innerHTML = `${progress(kicker, title, 1, 1)}<button class='wl-back' data-wl-mode='intake'>← Intake / Returns Home</button>${kind === 'inventory' ? `<div class='ok'><b>✓ IT sends completed intake to the Owner/Manager.</b><div>You do not add units back to MHelpDesk inventory here. The Owner/Manager completes that final step from the Owner dashboard.</div></div>` : items.join('') || `<div class='ok'><b>${kind === 'history' ? 'No completed intake yet.' : 'Nothing waiting here.'}</b></div>`}`;
  hideChildren(viewIT(), [card]);
  resetWizardPosition();
}
async function startITIntake(id) {
  const rows = await returnRows();
  const row = rows.find(x => x.id === id);
  if (!row) return;
  const record = readIntakeRecord(row.damage_notes);
  const savedAnswers = Array.isArray(record.meta?.answers) ? record.meta.answers : [];
  const answers = Array(intakeLabels.length).fill(null).map((_, i) => typeof savedAnswers[i] === 'boolean' ? savedAnswers[i] : null);
  let step = answers.findIndex(v => v !== true);
  if (step < 0) step = row.intake_photo_paths?.length ? intakeLabels.length + 1 : intakeLabels.length;
  intakeWizard = { row, step, answers, notes: record.notes, photo: null, meta: record.meta || {} }; 
  return renderITIntakeWizard();
}
async function renderITIntakeWizard() {
  const row = intakeWizard.row;
  if (!row) return showITIntake();
  let card = document.getElementById('wlIntakeForm');
  if (!card) { card = document.createElement('div'); card.id = 'wlIntakeForm'; card.className = 'card'; viewIT().append(card); }
  const photoHtml = await returnPhotoHtml(row.return_photo_paths);
  if (intakeWizard.step < intakeLabels.length) {
    const i = intakeWizard.step;
    const answer = intakeWizard.answers[i];
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, intakeLabels[i], i + 1, intakeLabels.length + 2)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type || 'Unit')}</b><div>MHelpDesk #${esc(row.ticket_no)}</div><div>Returned by ${esc(row.service_tech_name)}</div>${row.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(row.return_notes)}</div></div>` : ''}<div class='small top8'><b>Service photos from site / return:</b></div><div class='wl-return-gallery'>${photoHtml}</div></div><div class='wl-question'><div class='qnum'>Intake Check ${i + 1} of ${intakeLabels.length}</div><div class='qtext'>${esc(intakeLabels[i])}</div><div class='wl-options'><button class='pass ${answer === true ? 'on' : ''}' data-wl-intake-answer='yes'>YES</button><button class='fail ${answer === false ? 'on' : ''}' data-wl-intake-answer='no'>NO</button></div>${answer === false ? `<div class='wl-stop'><b>NO recorded.</b><div>Document the issue before this unit goes back into inventory.</div></div>` : ''}</div><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><button class='wl-next' data-wl-intake-next>Next →</button></div>`;
  } else if (intakeWizard.step === intakeLabels.length) {
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, 'Take an IT intake photo', intakeLabels.length + 1, intakeLabels.length + 2)}<div class='wl-review'><b>Service site / return photos</b>${row.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(row.return_notes)}</div></div>` : ''}<div class='wl-return-gallery'>${photoHtml}</div></div><div class='wl-question'><div class='qtext'>Take a current photo of ${esc(row.unit_tag)} in the shop.</div><div class='wl-note'>This gives the Owner a Service-return photo and an IT-intake photo for the same unit.</div><label class='wl-photo-button' for='wlIntakePhoto'>📷 Take / Choose Unit Photo</label><input id='wlIntakePhoto' class='wl-photo-input' type='file' accept='image/*'><div class='wl-return-preview ${intakeWizard.photo ? '' : 'hidden'}'>${intakeWizard.photo ? `<img src='${URL.createObjectURL(intakeWizard.photo)}' alt='Selected IT intake unit photo'><div id='wlIntakePhotoName' class='ok'><b>✓ Photo selected for ${esc(row.unit_tag)}</b><div>${esc(intakeWizard.photo.name || 'Unit photo')} is ready for review.</div></div>` : ''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><button class='wl-next' data-wl-intake-next>Next: Review →</button></div>`;
  } else {
    const noCount = intakeWizard.answers.filter(v => v === false).length;
    const ready = noCount === 0 && intakeWizard.answers.every(v => v === true);
    const doc = intakeWizard.meta?.cancellationDoc;
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, 'Review this unit before MHelpDesk inventory', intakeLabels.length + 2, intakeLabels.length + 2)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type || 'Unit')}</b><div><b>MHelpDesk #${esc(row.ticket_no)}</b></div><div>${ready ? `✓ All ${intakeLabels.length} intake checks are YES.` : `${noCount} check${noCount === 1 ? '' : 's'} recorded NO — correct or document the issue before inventory.`}</div>${doc ? `<div class='ok top8'><b>SIM cancellation documentation</b><div>Date: ${esc(doc.simCanceledDate)} · Job: MHelpDesk #${esc(doc.ticket)} · Unit: ${esc(doc.unit)} · IT Initials: ${esc(doc.techInitials)}</div></div>` : ''}</div><label>Damage / intake notes</label><textarea id='wlIntakeNotes' rows='4' placeholder='Add damage, missing items, repairs needed, or other notes'>${esc(intakeWizard.notes)}</textarea>${ready ? `<div class='ok top10'><b>✓ IT INTAKE COMPLETE</b><div>SIM, monitoring, Alibi, customer-email app removal, SD cards, cleaning, 2026 Unit Tracker, damage verification, and shelf readiness are documented. Next: send this exact unit to Pending MHelpDesk Inventory.</div></div>` : `<div class='wl-stop'><b>This unit is not ready for inventory.</b><div>Use Back and correct every NO before finishing intake.</div></div>`}<button class='wl-big wl-green top10' data-wl-intake-finish ${ready ? '' : 'disabled'}>SEND TO PENDING MHELPDESK INVENTORY →</button><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><span></span></div>`;
  }
  hideChildren(viewIT(), [card]);
  resetWizardPosition();
}
async function showPendingList() {
  const { data } = await liveDb.from('prep_tickets').select('id,ticket_no,site,status,created_at,expected_unit_count,prep_items(id)').eq('status', 'draft').order('created_at', { ascending: true });
  let card = document.getElementById('wlPendingList'); if (!card) { card = document.createElement('div'); card.id = 'wlPendingList'; card.className = 'card'; viewIT().append(card); }
  const rows = data || [];
  card.innerHTML = `${progress('Pending IT Work', rows.length ? 'Choose a ticket to continue' : 'Nothing is waiting in IT', 1, 1)}<button class='wl-back' data-wl-home='it'>← IT Home</button>${rows.map(r => { const started=(r.prep_items||[]).length; const total=r.expected_unit_count||started; const next=started<total ? `Next: start equipment item ${started+1} of ${total}` : 'Next: continue the first incomplete check'; return `<div class='wl-ticket'><b>MHelpDesk #${esc(r.ticket_no)}</b><div class='small'>${esc(r.site || 'No site / description')}</div><div class='small'>Equipment items started: ${started} of ${total}</div><div class='ok top8'><b>${esc(next)}</b></div><button class='wl-big wl-blue' data-wl-open-it='${r.id}'>Resume This Prep →</button></div>`; }).join('') || `<div class='ok'><b>No pending prep.</b></div>`}`;
  hideChildren(viewIT(), [card]); resetWizardPosition();
}
function findItCard(ticket) {
  return [...document.querySelectorAll('#itPreps > .item.prepared')].find(c => c.textContent.includes(`MHelpDesk Ticket #${ticket}`));
}
async function editItPrepUnitCount(nextValue) {
  if (!activeItPrep || activeItPrep.status !== 'draft') return;
  const started = itItems().length;
  const current = Number(activeItPrep.expected_unit_count || itExpectedUnits || started || 1);
  const next = Number(nextValue ?? document.getElementById('wlUnitCountEdit')?.value ?? current);
  if (!Number.isInteger(next) || next < 1) return alert('Enter a whole number of units, 1 or more.');
  if (next < started) return alert(`You already started ${started} unit${started === 1 ? '' : 's'}. The total cannot be lower than ${started}.`);
  activeItPrep.expected_unit_count = next;
  itExpectedUnits = next;
  const card = findItCard(activeItPrep.ticket_no);
  const expectedInput = card?.querySelector("input[id^='expected_']");
  if (expectedInput) expectedInput.value = String(next);
  if (itUnitIndex >= next) { itUnitIndex = Math.max(0, next - 1); itUnitPhase = started >= next ? 'final' : 'type'; }
  showItWizard();
  return;
}
function unitCountEditor(totalUnits) {
  return `<div class='wl-count-editor wl-count-readonly' aria-label='Total equipment items'><b>${Number(totalUnits || 0)}</b><span>Total equipment items from the Unit Area + Stand Area</span></div>`;
}
async function getPrep(id) {
  const { data } = await liveDb.from('prep_tickets').select('*,prep_items(*)').eq('id', id).single(); return data;
}
function pendingUnitForms(card) { return [...card.querySelectorAll('.unitForm')]; }
function itQuestions(form) {
  return [...form.querySelectorAll('.check')].map(check => {
    const input = check.querySelector("input[type='checkbox']");
    if (!input) return null;
    if (input.checked && !input.dataset.wlAnswered) input.dataset.wlAnswered = '1';
    return { input, label: check.querySelector('b')?.textContent?.trim() || 'Confirm this check' };
  }).filter(Boolean);
}
function unitChoiceHtml(form) {
  const tag = form.querySelector("input[id^='tag_']");
  const batt = form.querySelector("input[id^='batt_']");
  const title = form.querySelector('.row b')?.textContent?.trim() || 'Equipment';
  return `<div class='wl-question'><div class='qnum'>Choose Unit</div><div class='qtext'>${esc(title)}</div><label>Exact Unit Tag</label><input id='wlUnitTag' value='${esc(tag?.value || '')}' placeholder='Enter unit tag'>${batt ? `<label class='top10'>Battery / Battery Box Count</label><input id='wlUnitBatt' type='number' min='${esc(batt.min || '0')}' value='${esc(batt.value || batt.min || '')}'>` : ''}</div>`;
}
function saveUnitChoice(form) {
  const tag = form.querySelector("input[id^='tag_']");
  const batt = form.querySelector("input[id^='batt_']");
  const chosenTag = document.getElementById('wlUnitTag')?.value.trim() || '';
  if (!chosenTag) { alert('Enter the exact unit tag before continuing.'); return false; }
  if (tag) tag.value = chosenTag;
  if (batt) {
    const chosenBatt = Number(document.getElementById('wlUnitBatt')?.value || 0);
    if (chosenBatt < Number(batt.min || 0)) { alert('Enter the required battery / battery-box count.'); return false; }
    batt.value = String(chosenBatt);
  }
  return true;
}
function unitQuestionHtml(q, index, total) {
  const answered = q.input.dataset.wlAnswered === '1';
  const yes = answered && q.input.checked;
  const no = answered && !q.input.checked;
  return `<div class='wl-question'><div class='qnum'>Check ${index + 1} of ${total}</div><div class='qtext'>${esc(q.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-it-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>NO recorded.</b><div>You may continue documenting the remaining checks, but this unit cannot be sent to Service until this answer is corrected to YES.</div></div>` : ''}</div>`;
}
function itUnitSteps(form) {
  const steps = [];
  const tag = form.querySelector("input[id^='tag_']");
  const batt = form.querySelector("input[id^='batt_']");
  if (tag) steps.push({ kind: 'tag', input: tag, label: 'Enter the exact unit tag' });
  if (batt) steps.push({ kind: 'battery', input: batt, label: 'Enter the battery / battery-box count' });
  itQuestions(form).forEach(q => steps.push({ kind: 'check', q, label: q.label }));
  return steps;
}
function itStepHtml(step, index, total, title) {
  if (step.kind === 'tag') return `<div class='wl-question'><div class='qnum'>Step ${index + 1} of ${total}</div><div class='qtext'>${esc(title)}</div><label>Exact Unit Tag</label><input id='wlItSingleValue' value='${esc(step.input.value || '')}' placeholder='Enter unit tag'></div>`;
  if (step.kind === 'battery') return `<div class='wl-question'><div class='qnum'>Step ${index + 1} of ${total}</div><div class='qtext'>How many batteries / battery boxes are prepared?</div><input id='wlItSingleValue' type='number' inputmode='numeric' min='${esc(step.input.min || '0')}' value='${esc(step.input.value || step.input.min || '')}'><div class='wl-note top8'>Required minimum: ${esc(step.input.min || '0')}</div></div>`;
  return unitQuestionHtml(step.q, index, total);
}
async function evidenceRows(prepId, stage) {
  const { data } = await liveDb.from('handoff_evidence').select('*').eq('prep_ticket_id', prepId).eq('stage', stage).order('created_at', { ascending: true });
  const rows = data || [];
  await Promise.all(rows.map(async r => { const { data: u } = await liveDb.storage.from(EVIDENCE_BUCKET).createSignedUrl(r.storage_path, 3600); r.url = u?.signedUrl || ''; }));
  return rows;
}
async function optimizeEvidencePhoto(file) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.size <= 900000 && /image\/jpe?g/i.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = url; });
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare photo.')), 'image/jpeg', 0.78));
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function uploadEvidence(prepId, stage, kind, file, name, itemId = null) {
  const { data: { session } } = await liveDb.auth.getSession();
  if (!session?.user?.id) throw new Error('Please sign in again.');
  const ext = kind === 'signature' ? 'png' : ((name || 'photo.jpg').split('.').pop() || 'jpg').toLowerCase();
  const path = `${session.user.id}/${prepId}/${stage}/${itemId || 'ticket'}/${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: up } = await liveDb.storage.from(EVIDENCE_BUCKET).upload(path, file, { contentType: file.type || (kind === 'signature' ? 'image/png' : 'image/jpeg') }); if (up) throw up;
  const { error: rec } = itemId
    ? await liveDb.rpc('record_unit_handoff_evidence', { p_prep_id: prepId, p_item_id: itemId, p_stage: stage, p_kind: kind, p_storage_path: path, p_original_name: name || null })
    : await liveDb.rpc('record_handoff_evidence', { p_prep_id: prepId, p_stage: stage, p_kind: kind, p_storage_path: path, p_original_name: name || null });
  if (rec) throw rec;
}
function wireCanvas(canvas) {
  if (!canvas || canvas.dataset.wired) return;
  canvas.dataset.wired = '1';
  canvas.style.touchAction = 'none';
  const dpr = Math.max(1, devicePixelRatio || 1);
  const w = Math.max(280, canvas.getBoundingClientRect().width || 300);
  canvas.width = w * dpr;
  canvas.height = 135 * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#17212b';
  let draw = false;
  const blockTouch = e => { e.preventDefault(); e.stopPropagation(); };
  canvas.addEventListener('touchstart', blockTouch, { passive: false });
  canvas.addEventListener('touchmove', blockTouch, { passive: false });
  const pt = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.onpointerdown = e => {
    draw = true;
    canvas.setPointerCapture?.(e.pointerId);
    const p = pt(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.dataset.ink = '1';
    e.preventDefault();
    e.stopPropagation();
  };
  canvas.onpointermove = e => {
    if (!draw) return;
    const p = pt(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
    e.stopPropagation();
  };
  const finish = e => {
    draw = false;
    try { if (e?.pointerId != null && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch {}
    e?.preventDefault?.();
    e?.stopPropagation?.();
  };
  canvas.onpointerup = finish;
  canvas.onpointercancel = finish;
}
function blobFromCanvas(canvas) { return new Promise(r => canvas.toBlob(r, 'image/png', .92)); }
async function proofHtml(prepId, stage, editable) {
  const rows = await evidenceRows(prepId, stage); const photos = rows.filter(r => r.kind === 'photo'); const sig = [...rows].reverse().find(r => r.kind === 'signature');
  const title = stage === 'it' ? 'IT Handoff Proof' : 'Service Receipt Proof';
  return `<div class='wl-proof ${stage === 'service' ? 'service' : ''}' data-proof='${prepId}' data-stage='${stage}'><b>${title}</b><div class='wl-note'>${stage === 'it' ? 'Photograph exactly what is leaving the shop.' : 'Photograph exactly what you received from IT.'}</div>${photos.length ? `<div class='wl-gallery'>${photos.map(p => `<img src='${esc(p.url)}' alt='Handoff photo'>`).join('')}</div>` : `<div class='warn top8'>No photos saved yet.</div>`}${editable ? `<input class='wl-file top8' type='file' accept='image/*' capture='environment' multiple><button class='mini full top8' data-wl-upload='${stage}'>Save Photo(s)</button>` : ''}${sig ? `<div class='wl-saved'><b>✓ Signature saved</b><div class='small'>${esc(sig.created_by_name || '')} · ${new Date(sig.created_at).toLocaleString()}</div>${sig.url ? `<img src='${esc(sig.url)}' alt='Saved signature'>` : ''}</div>${editable ? `<button class='mini full top8' data-wl-replace='${stage}'>Replace Signature</button>` : ''}` : editable ? `<div class='wl-sign top8'><b>Sign with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${stage}'>Save Signature</button></div></div>` : `<div class='warn top8'>No signature saved yet.</div>`}</div>`;
}
async function photoOnlyHtml(prepId, stage, unitNo = null, expectedCount = null) {
  const rows = await evidenceRows(prepId, stage);
  const prefix = unitNo ? `unit-${unitNo}-` : '';
  const photos = rows.filter(r => r.kind === 'photo' && (!unitNo || String(r.original_name || '').startsWith(prefix)));
  const required = unitNo ? 1 : Math.max(1, Number(expectedCount || 1));
  const item = stage === 'it' && unitNo ? itItems()[unitNo - 1] || null : null;
  const identity = item ? itItemIdentity(item, unitNo) : `Unit ${unitNo}`;
  const tag = String(item?.unit_tag || '').trim();
  const instruction = unitNo ? (stage === 'it' && tag ? `Take exactly 1 clear photo of ${identity}. Make sure unit tag ${tag} is clearly visible and readable in the photo.` : `Take exactly 1 clear photo for Unit ${unitNo}.`) : stage === 'service' ? `IT supplied ${required} photo${required === 1 ? '' : 's'}. Take exactly ${required} Service receipt photo${required === 1 ? '' : 's'} so the photo counts match.` : 'Photograph exactly what is leaving the shop.';
  const complete = photos.length === required;
  const input = complete && !unitNo ? '' : `<input class='wl-file top8' type='file' accept='image/*' capture='environment' ${unitNo ? '' : 'multiple'}><button class='mini full top8' data-wl-upload='${stage}'>${unitNo && photos.length ? 'Replace Unit Photo' : 'Save Photo(s)'}</button>`;
  const tagConfirm = stage === 'it' && unitNo && photos.length ? `<div class='wl-question top8'><div class='qtext'>Does this photo clearly show unit tag ${esc(tag)} and match ${esc(identity)}?</div><div class='wl-options'><button class='pass ${item?.photo_tag_match_ok ? 'on' : ''}' data-wl-photo-tag='yes'>YES — TAG MATCHES</button><button class='fail' data-wl-photo-tag='no'>NO — RETAKE PHOTO</button></div>${item?.photo_tag_match_ok ? `<div class='ok top8'><b>✓ Photo tag verified for ${esc(identity)}</b></div>` : `<div class='warn top8'><b>Tag confirmation required before continuing.</b></div>`}</div>` : '';
  return `<div class='wl-proof ${stage === 'service' ? 'service' : ''}' data-proof='${prepId}' data-stage='${stage}' data-mode='photo' data-unit='${unitNo || ''}' data-expected='${required}'><b>${stage === 'it' && unitNo ? `${esc(identity)} Photo` : unitNo ? `Unit ${unitNo} Photo` : 'Photo Proof'}</b><div class='wl-note'>${instruction}</div>${photos.length ? `<div class='wl-gallery'>${photos.map(p => `<img src='${esc(p.url)}' alt='Handoff photo'>`).join('')}</div><div class='${complete ? 'ok' : 'warn'} top8'><b>${complete ? '✓' : ''} ${photos.length} of ${required} photo${required === 1 ? '' : 's'} saved</b></div>` : `<div class='warn top8'>0 of ${required} photos saved.</div>`}${tagConfirm}${input}</div>`;
}
async function signatureOnlyHtml(prepId, stage, unitNo = null) {
  const rows = await evidenceRows(prepId, stage);
  const signatureName = unitNo ? `unit-${unitNo}-signature.png` : null;
  const sig = [...rows].reverse().find(r => r.kind === 'signature' && (!unitNo || r.original_name === signatureName));
  return `<div class='wl-proof ${stage === 'service' ? 'service' : ''}' data-proof='${prepId}' data-stage='${stage}' data-mode='signature' data-unit='${unitNo || ''}'><b>${unitNo ? `Unit ${unitNo} IT Verification Signature` : stage === 'it' ? 'IT Final Sign-Off' : 'Service Receipt Signature'}</b>${sig ? `<div class='wl-saved'><b>✓ Signature saved</b><div class='small'>${esc(sig.created_by_name || '')} · ${new Date(sig.created_at).toLocaleString()}</div>${sig.url ? `<img src='${esc(sig.url)}' alt='Saved signature'>` : ''}</div><button class='mini full top8' data-wl-replace='${stage}'>Replace Signature</button>` : `<div class='wl-sign top8'><b>Sign with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${stage}'>Save Signature</button></div></div>`}</div>`;
}
function itSummaryHtml(forms, evidence) {
  const photos = evidence.filter(r => r.kind === 'photo');
  const units = forms.map((form, index) => {
    const title = form.querySelector('.row b')?.textContent?.trim() || `Unit ${index + 1}`;
    const tag = form.querySelector("input[id^='tag_']")?.value || 'Not entered';
    const batt = form.querySelector("input[id^='batt_']")?.value;
    const checks = itQuestions(form);
    const passed = checks.filter(q => q.input.checked).length;
    return `<div class='wl-ticket'><b>Unit ${index + 1} — ${esc(title)}</b><div>Unit tag: <b>${esc(tag)}</b></div>${batt != null ? `<div>Battery / box count: <b>${esc(batt)}</b></div>` : ''}<div>${passed === checks.length ? `✓ All ${checks.length} verification checks passed` : `${passed} of ${checks.length} checks passed`}</div></div>`;
  }).join('');
  return `<div class='wl-review'><b>MHelpDesk #${esc(activeItPrep.ticket_no)}</b>${activeItPrep.site ? `<div>Ticket Name / Site: <b>${esc(activeItPrep.site)}</b></div>` : ''}<div>Total units checked: <b>${forms.length}</b></div></div>${units}<div class='wl-review'><div>📷 <b>${photos.length} photo${photos.length === 1 ? '' : 's'} saved</b></div><div class='small'>Review these unit checks and photo proof. Your final signature comes next.</div></div>`;
}
const CAMERA_UNIT_TYPES = ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'];
const STAND_POLE_TYPES = ['Solar Stand','Solar Pole','110V Stand','Pole'];
function isSolarSupport(type) { return ['Solar Stand','Solar Pole'].includes(type); }
function isSimpleSupport(type) { return ['110V Stand','Pole'].includes(type); }
function isSupport(type) { return isSolarSupport(type) || isSimpleSupport(type); }
function itItems() { return [...(activeItPrep?.prep_items || [])].sort((a, b) => a.item_order - b.item_order); }
function currentItItem() { return itItems()[itUnitIndex] || null; }
function itAllowedPurposes(type) { if (type === '110V Stand') return ['SWAP']; if (type === 'Solar Stand') return ['SWAP','DELIVERY']; return ['BACKUP','SWAP','DELIVERY']; }
function unitEvidence(rows, unitNo, kind) { const prefix = `unit-${unitNo}-`; return rows.filter(r => r.kind === kind && String(r.original_name || '').startsWith(prefix)); }
function unitSignature(rows, unitNo) { return [...rows].reverse().find(r => r.kind === 'signature' && r.original_name === `unit-${unitNo}-signature.png`); }
function itItemIdentity(item, unitNo) {
  const tag = String(item?.unit_tag || '').trim();
  return tag ? `${item.equipment_type} ${tag}` : `Unit ${unitNo}`;
}
function itUnitStepsData(item, unitNo) {
  const support = isSupport(item.equipment_type);
  const identity = itItemIdentity(item, unitNo);
  const steps = [{ kind: 'tag', field: 'unit_tag', label: support ? `Enter the exact tag / ID for ${item.equipment_type}` : `Enter the exact unit tag for ${item.equipment_type}` }];
  if (isSolarSupport(item.equipment_type)) {
    steps.push({ kind: 'bool', field: 'ticket_item_match_ok', label: `Is ${identity} listed on the MHelpDesk ticket?` });
    steps.push({ kind: 'bool', field: 'safe_ok', label: `Is ${identity} physically ready for Service to perform the Solar Stand checkout?` });
    return steps;
  }
  if (isSimpleSupport(item.equipment_type)) {
    steps.push({ kind: 'bool', field: 'ticket_item_match_ok', label: `Is ${identity} what the customer requested and what is listed on the MHelpDesk ticket?` });
    return steps;
  }
  if (item.equipment_type !== 'Solar Spotter' && Number(item.required_battery_count || 0) > 0) steps.push({ kind: 'number', field: 'battery_count', label: `How many batteries / battery boxes are prepared for ${identity}?` });
  steps.push({ kind: 'bool', field: 'power_ok', label: `Does ${identity} power on correctly?` });
  if (item.equipment_type === 'Ranger') {
    steps.push({ kind: 'bool', field: 'solar_mppt_updated_ok', label: `Is the MPPT firmware / configuration on ${identity} updated?` });
    steps.push({ kind: 'bool', field: 'solar_mppt_tested_ok', label: `Was the MPPT on ${identity} tested and working correctly?` });
    steps.push({ kind: 'bool', field: 'solar_pv_charging_ok', label: `With a solar panel connected to ${identity}, did you verify the Ranger battery is charging through the MPPT?` });
  }

  if (item.purpose === 'DELIVERY') {
    if (item.equipment_type === 'Helios') {
      steps.push({ kind: 'bool', field: 'solar_mppt_tested_ok', label: `Is the Cerbo for ${identity} online and visible in the VRM portal?` });
      steps.push({ kind: 'bool', field: 'solar_mppt_updated_ok', label: `Is the MPPT firmware / configuration for ${identity} updated?` });
      steps.push({ kind: 'bool', field: 'delivery_batteries_charged_ok', label: `Is the battery box for ${identity} fully charged?` });
      steps.push({ kind: 'bool', field: 'solar_pv_charging_ok', label: `Is the battery box charging when ${identity} is hooked up to the Helios tower solar panels?` });
    }
    steps.push({ kind: 'bool', field: 'delivery_sim_ok', label: `Is the SIM card for ${identity} active and installed in the router?` });
    steps.push({ kind: 'bool', field: 'delivery_camera_app_ok', label: `Is ${identity} visible in the camera app?` });

    if (item.equipment_type === 'Helios') {
      steps.push({ kind: 'bool', field: 'solar_panels_match_ok', label: `Does ${identity} have all 3 required 1TB SD cards installed?` });
      steps.push({ kind: 'bool', field: 'delivery_recording_ok', label: `Before formatting the SD cards, did you verify ${identity} is recording footage correctly?` });
    } else {
      steps.push({ kind: 'bool', field: 'delivery_recording_ok', label: `Was recording footage confirmed for ${identity}?` });
      if (item.equipment_type !== 'Solar Spotter') steps.push({ kind: 'bool', field: 'delivery_batteries_charged_ok', label: `Are the batteries / battery box for ${identity} charged and ready?` });
    }

    steps.push({ kind: 'bool', field: 'delivery_monitoring_ok', label: `Was Central Station monitoring for ${identity} created and sent in?` });
    if (item.equipment_type !== 'Helios') steps.push({ kind: 'bool', field: 'delivery_ticket_count_ok', label: `Is ${identity} included in the equipment type and quantity on the MHelpDesk ticket?` });

    // General readiness checks come before the two final deployment checks.
    steps.push({ kind: 'bool', field: 'functions_ok', label: `Were all functions on ${identity} tested and working?` });
    steps.push({ kind: 'bool', field: 'safe_ok', label: `Is ${identity} ready for field use?` });

    // Keep these as the final two checks by request.
    if (item.equipment_type === 'Helios') {
      steps.push({ kind: 'bool', field: 'delivery_sd_formatted_ok', label: `After confirming recording, are all 3 of the 1TB SD cards in ${identity} formatted and ready?` });
    } else {
      steps.push({ kind: 'bool', field: 'delivery_sd_formatted_ok', label: `Is the SD card / NVR storage for ${identity} formatted and ready?` });
    }
    steps.push({ kind: 'bool', field: 'delivery_customer_email_app_ok', label: `Was ${identity} added under the customer email account in the camera app?` });
    return steps;
  }

  steps.push({ kind: 'bool', field: 'functions_ok', label: `Were all functions on ${identity} tested and working?` });
  steps.push({ kind: 'bool', field: 'safe_ok', label: `Is ${identity} ready for field use?` });
  return steps;
}
function itUnitReady(item) {
  if (!item?.unit_tag) return false;
  if (isSolarSupport(item.equipment_type) || isSimpleSupport(item.equipment_type)) return Boolean(item.ticket_item_match_ok && (isSimpleSupport(item.equipment_type) || item.safe_ok));
  if (!item.power_ok || !item.functions_ok || !item.safe_ok) return false;
  if (item.equipment_type !== 'Solar Spotter' && Number(item.battery_count || 0) < Number(item.required_battery_count || 0)) return false;
  if (item.equipment_type === 'Ranger' && !(item.solar_mppt_updated_ok && item.solar_mppt_tested_ok && item.solar_pv_charging_ok)) return false;
  if (item.purpose !== 'DELIVERY') return true;
  if (item.equipment_type === 'Helios' && !(item.solar_mppt_tested_ok && item.solar_mppt_updated_ok && item.delivery_batteries_charged_ok && item.solar_pv_charging_ok && item.solar_panels_match_ok)) return false;
  const batteryReady = item.equipment_type === 'Solar Spotter' || item.delivery_batteries_charged_ok;
  return Boolean(item.delivery_sim_ok && item.delivery_camera_app_ok && item.delivery_customer_email_app_ok && item.delivery_sd_formatted_ok && item.delivery_recording_ok && batteryReady && item.delivery_monitoring_ok && (item.equipment_type === 'Helios' || item.delivery_ticket_count_ok));
}
function itAnswerKey(item, field) { return `${item.id}:${field}`; }
function itBoolValue(item, field) { const key = itAnswerKey(item, field); return itDraftAnswers.has(key) ? itDraftAnswers.get(key) : item[field]; }
function itBoolAnswered(item, field) { const key = itAnswerKey(item, field); return itDraftAnswers.has(key) || item[field] === true || itAnswered.has(key); }
function itPhotoTagReady(item) { return item?.photo_tag_match_ok === true; }
async function configureCurrentItItem() {
  const item = currentItItem();
  if (!itTypeChoice || !itPurposeChoice) return false;
  const required = itTypeChoice === 'Recon 2' ? Math.max(1, Number(itReconRequired || 1)) : 1;
  const result = item
    ? await liveDb.rpc('configure_it_prep_item', { p_item_id: item.id, p_equipment_type: itTypeChoice, p_purpose: itPurposeChoice, p_required_battery_count: required })
    : await liveDb.rpc('add_it_prep_item', { p_prep_id: activeItPrep.id, p_equipment_type: itTypeChoice, p_purpose: itPurposeChoice, p_recon_battery_count: required });
  if (result.error) { alert(result.error.message); return false; }
  activeItPrep = await getPrep(activeItPrep.id);
  return true;
}
async function persistCurrentItItem() {
  const item = currentItItem();
  if (!item) return false;
  const { error } = await liveDb.rpc('save_it_prep_item_draft', {
    p_item_id: item.id,
    p_unit_tag: item.unit_tag || '',
    p_battery_count: Number(item.battery_count || 0),
    p_power_ok: Boolean(item.power_ok),
    p_functions_ok: Boolean(item.functions_ok),
    p_safe_ok: Boolean(item.safe_ok),
    p_sim_ok: Boolean(item.delivery_sim_ok),
    p_camera_app_ok: Boolean(item.delivery_camera_app_ok), p_customer_email_app_ok: Boolean(item.delivery_customer_email_app_ok),
    p_batteries_charged_ok: Boolean(item.delivery_batteries_charged_ok),
    p_monitoring_ok: Boolean(item.delivery_monitoring_ok),
    p_ticket_count_ok: Boolean(item.delivery_ticket_count_ok),
    p_sd_formatted_ok: Boolean(item.delivery_sd_formatted_ok),
    p_recording_ok: Boolean(item.delivery_recording_ok),
    p_mppt_updated_ok: Boolean(item.solar_mppt_updated_ok),
    p_mppt_tested_ok: Boolean(item.solar_mppt_tested_ok),
    p_pv_charging_ok: Boolean(item.solar_pv_charging_ok),
    p_solar_panels_match_ok: Boolean(item.solar_panels_match_ok),
    p_ticket_item_match_ok: Boolean(item.ticket_item_match_ok),
  });
  if (error) { alert(error.message); return false; }
  activeItPrep = await getPrep(activeItPrep.id);
  return true;
}
function itCheckStepHtml(item, step, index, total, unitNo) {
  if (step.kind === 'tag') return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Step ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' value='${esc(item.unit_tag || '')}' placeholder='Exact unit tag'></div>`;
  if (step.kind === 'number') return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Step ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' type='number' inputmode='numeric' min='${Number(item.required_battery_count || 0)}' value='${esc(item.battery_count ?? item.required_battery_count ?? '')}'><div class='wl-note top8'>Required minimum: ${Number(item.required_battery_count || 0)}</div></div>`;
  const answered = itBoolAnswered(item, step.field);
  const value = itBoolValue(item, step.field);
  const yes = answered && value === true;
  const no = answered && value !== true;
  return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Check ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-it-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>NO recorded.</b><div>This unit cannot be sent to Service until this answer is corrected to YES.</div></div>` : ''}</div>`;
}
function itUnitIssues(item, evidence, unitNo) {
  const steps = itUnitStepsData(item, unitNo);
  const issues = [];
  steps.forEach((step, index) => {
    const failed = step.kind === 'number' ? Number(item[step.field] || 0) < Number(item.required_battery_count || 0) : step.kind === 'tag' ? !String(item[step.field] || '').trim() : itBoolValue(item, step.field) !== true;
    if (failed) issues.push({ phase: 'checks', index, label: step.label });
  });
  if (!unitEvidence(evidence, unitNo, 'photo').length) issues.push({ phase: 'photo', index: 0, label: 'Required equipment photo is missing.' });
  else if (!itPhotoTagReady(item)) issues.push({ phase: 'photo', index: 0, label: `Confirm the photo clearly shows and matches unit tag ${item.unit_tag || ''}.` });
  if (!unitSignature(evidence, unitNo)) issues.push({ phase: 'signature', index: 0, label: 'IT technician signature is missing.' });
  return issues;
}
function itIssueLinksHtml(item, evidence, unitNo) {
  const issues = itUnitIssues(item, evidence, unitNo);
  if (!issues.length) return '';
  return `<div class='wl-stop'><b>${issues.length} issue${issues.length === 1 ? '' : 's'} need attention.</b><div>Tap an issue to go directly back to it.</div><div class='wl-issue-list'>${issues.map((issue, index) => `<button class='wl-issue-link' data-wl-issue-unit='${unitNo - 1}' data-wl-issue-phase='${issue.phase}' data-wl-issue-index='${issue.index}'><b>Issue ${index + 1}: ${esc(issue.label)}</b><span>Go to this issue →</span></button>`).join('')}</div></div>`;
}
function itUnitReviewHtml(item, evidence, unitNo) {
  const photos = unitEvidence(evidence, unitNo, 'photo');
  const steps = itUnitStepsData(item, unitNo).filter(s => s.kind === 'bool');
  const passed = steps.filter(s => itBoolValue(item, s.field) === true).length;
  const identity = itItemIdentity(item, unitNo);
  return `<div class='wl-review'><b>${esc(identity)}</b><div><b>Unit:</b> ${unitNo}</div><div><b>Purpose:</b> ${esc(item.purpose)}</div>${Number(item.required_battery_count || 0) > 0 ? `<div><b>Batteries / boxes:</b> ${Number(item.battery_count || 0)} of ${Number(item.required_battery_count || 0)} required</div>` : ''}<div><b>Checks:</b> ${passed} of ${steps.length} passed</div><div><b>Photos:</b> ${photos.length}</div><div><b>Photo unit tag:</b> ${itPhotoTagReady(item) ? '✓ Visible and matches' : 'Not confirmed'}</div></div>`;
}
function itTicketSummaryHtml(items, evidence) {
  const units = items.map((item, index) => { const unitNo = index + 1; const photos = unitEvidence(evidence, unitNo, 'photo'); const sig = unitSignature(evidence, unitNo); const issues = itIssueLinksHtml(item, evidence, unitNo); return `<div class='wl-ticket'><b>Unit ${unitNo} — ${esc(item.equipment_type)}</b><div>${esc(item.purpose)} · Unit ${esc(item.unit_tag || '')}</div><div>📷 ${photos.length} photo${photos.length === 1 ? '' : 's'}</div><div>✍️ ${sig ? `Signed by ${esc(sig.created_by_name || 'IT Technician')} · ${new Date(sig.created_at).toLocaleString()}` : 'Signature missing'}</div>${issues}</div>`; }).join('');
  const partsEditor = activeItPrep?.status === 'draft' ? `<div class='wl-question top10'><div class='qtext'>Parts Required</div><div class='small'>Update these only if the MHelpDesk ticket changes before release.</div>${ticketPartsInputsHtml('wlEditPart', activeItPrep)}<button class='wl-big wl-blue top10' style='min-height:52px;font-size:16px' data-wl-save-prep-parts>Save Parts List</button></div>` : ticketPartsInlineHtml(activeItPrep);
  return `<div class='wl-review'><b>MHelpDesk #${esc(activeItPrep.ticket_no)}</b><div>${esc(activeItPrep.site || '')}</div><div><b>Units / Devices:</b> ${Number(activeItPrep.requested_unit_count ?? equipmentManifestDeviceTotal(activeItPrep.equipment_manifest))}</div><div><b>Stands / Poles:</b> ${equipmentManifestStandTotal(activeItPrep.equipment_manifest)}</div><div><b>Total Equipment Items:</b> ${items.length}</div></div>${equipmentManifestInlineHtml(activeItPrep)}${partsEditor}${units}`;
}
async function releaseItPrepUnitByUnit() {
  if (!activeItPrep) return showITHome();
  const items = itItems();
  const evidence = await evidenceRows(activeItPrep.id, 'it');
  const expected = activeItPrep.expected_unit_count || itExpectedUnits || items.length;
  const ready = items.length === expected && items.every((item, index) => itUnitIssues(item, evidence, index + 1).length === 0);
  if (!ready) return alert(`Complete all ${expected} equipment items with checks, a photo showing the matching tag, and an IT signature before handing off to Service.`);
  const button = document.querySelector('[data-wl-send-it]');
  const msg = document.getElementById('wlSendItMsg');
  if (button) { button.disabled = true; button.textContent = 'Creating Service handoff…'; }
  if (msg) msg.innerHTML = `<div class='warn top10'><b>Creating Service handoff…</b></div>`;
  document.body.classList.add('busy');
  try {
    const ticketNo = activeItPrep.ticket_no;
    for (const item of items) {
      const { error: verifyError } = await liveDb.rpc('verify_prep_item', { p_item_id: item.id, p_unit_tag: item.unit_tag || '', p_battery_count: Number(item.battery_count || 0), p_power_ok: Boolean(item.power_ok), p_functions_ok: Boolean(item.functions_ok), p_safe_ok: Boolean(item.safe_ok) });
      if (verifyError) throw verifyError;
      if (item.purpose === 'DELIVERY') {
        const { error: deliveryError } = await liveDb.rpc('verify_delivery_item_checks', { p_item_id: item.id, p_sim_ok: Boolean(item.delivery_sim_ok), p_camera_app_ok: Boolean(item.delivery_camera_app_ok), p_customer_email_app_ok: Boolean(item.delivery_customer_email_app_ok), p_batteries_charged_ok: Boolean(item.delivery_batteries_charged_ok), p_monitoring_ok: Boolean(item.delivery_monitoring_ok), p_ticket_count_ok: item.equipment_type === 'Helios' ? true : Boolean(item.delivery_ticket_count_ok), p_sd_formatted_ok: Boolean(item.delivery_sd_formatted_ok), p_recording_ok: Boolean(item.delivery_recording_ok) });
        if (deliveryError) throw deliveryError;
      }
    }
    const { error } = await liveDb.rpc('release_prep', { p_prep_id: activeItPrep.id });
    if (error) throw error;
    await window.refreshData?.();
    activeItPrep = null;
    itUnitIndex = 0;
    itQuestionIndex = 0;
    itUnitPhase = 'type';
    await showITHome();
    alert(`MHelpDesk Ticket #${ticketNo} was sent to Service.`);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = 'Hand Off to Service Tech →'; }
    if (msg) msg.innerHTML = `<div class='bad top10'><b>Could not create the Service handoff.</b><div>${esc(error?.message || 'Please try again.')}</div></div>`;
  } finally {
    document.body.classList.remove('busy');
  }
}
function itWizardCard() {
  let wizard = document.getElementById('wlItWizardOnly');
  if (!wizard) { wizard = document.createElement('div'); wizard.id = 'wlItWizardOnly'; wizard.className = 'card'; viewIT().append(wizard); }
  return wizard;
}
async function showItPrep(prepId) {
  activeItPrep = await getPrep(prepId);
  if (!activeItPrep) return;
  itExpectedUnits = activeItPrep.expected_unit_count || itItems().length;
  const evidence = await evidenceRows(prepId, 'it');
  const items = itItems();
  let firstIncomplete = items.findIndex((item, index) => itUnitIssues(item, evidence, index + 1).length > 0);
  if (firstIncomplete < 0) firstIncomplete = items.length;
  itUnitIndex = firstIncomplete;
  itQuestionIndex = 0;
  itAnswered = new Set();
  if (itUnitIndex >= itExpectedUnits) {
    itUnitPhase = 'final';
  } else if (itUnitIndex >= items.length) {
    itUnitPhase = 'type';
    itTypeChoice = equipmentManifestExpanded(activeItPrep.equipment_manifest)[itUnitIndex] || '';
    itPurposeChoice = prepPurposeFromWorkType(activeItPrep.work_type) || '';
    itReconRequired = 1;
  } else {
    const item = items[itUnitIndex];
    const unitNo = itUnitIndex + 1;
    itTypeChoice = item.equipment_type || '';
    itPurposeChoice = item.purpose || '';
    itReconRequired = Number(item.required_battery_count || 1);
    if (!item.equipment_type || !item.purpose) { itUnitPhase = 'type'; itTypeChoice = item.equipment_type || equipmentManifestExpanded(activeItPrep.equipment_manifest)[itUnitIndex] || ''; itPurposeChoice = item.purpose || prepPurposeFromWorkType(activeItPrep.work_type) || ''; }
    else {
      const issues = itUnitIssues(item, evidence, unitNo);
      if (!issues.length) itUnitPhase = 'review';
      else { itUnitPhase = issues[0].phase; itQuestionIndex = issues[0].index || 0; }
    }
  }
  const wizard = itWizardCard();
  hideChildren(viewIT(), [wizard]);
  wizard.style.display = '';
  await renderItUnitStep();
}
async function renderItUnitStep() {
  const items = itItems();
  const totalUnits = activeItPrep.expected_unit_count || itExpectedUnits || items.length;
  const wizard = itWizardCard();
  hideChildren(viewIT(), [wizard]);
  if (itUnitIndex >= totalUnits || itUnitPhase === 'final') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const ready = items.length === totalUnits && items.every((item, index) => itUnitIssues(item, ev, index + 1).length === 0);
    wizard.innerHTML = progress('Ticket Summary', ready ? 'READY — Hand Off to the Service Tech' : 'Review all completed equipment', 1, 1) + itTicketSummaryHtml(items, ev) + `<div class='wl-question top10'><div class='qtext'>Total Equipment Items for This Ticket</div>${unitCountEditor(totalUnits)}</div><div id='wlSendItMsg'></div>${ready ? `<div class='ok top10'><b>✓ IT CHECK COMPLETE</b><div>Your next step is to hand this equipment off to the Service Tech.</div></div>` : ''}<button class='wl-big wl-green top10' style='font-size:18px;min-height:58px' data-wl-send-it ${ready ? '' : 'disabled'}>HAND OFF TO SERVICE TECH →</button><div class='small top10' style='text-align:center'>After sending, you will return to IT Home to start your next task.</div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-home='it'>IT Home →</button></div><button class='wl-big wl-gray top10' data-wl-it='history'>Status & History →</button>`;
    return resetWizardPosition();
  }
  const item = items[itUnitIndex] || null;
  const unitNo = itUnitIndex + 1;
  const identity = item ? itItemIdentity(item, unitNo) : `Unit ${unitNo}`;
  if (itUnitPhase === 'type') {
    const cameraOptions = CAMERA_UNIT_TYPES.map(type => `<option value='${esc(type)}' ${itTypeChoice === type ? 'selected' : ''}>${esc(type)}</option>`).join('');
    const supportOptions = STAND_POLE_TYPES.map(type => `<option value='${esc(type)}' ${itTypeChoice === type ? 'selected' : ''}>${esc(type)}</option>`).join('');
    wizard.innerHTML = progress(`Item ${unitNo} of ${totalUnits}`, `What type of equipment is Item ${unitNo}?`, 1, 1) + `<div class='wl-question'><div class='qtext'>Equipment Plan</div>${equipmentManifestInlineHtml(activeItPrep)}${unitCountEditor(totalUnits)}</div><div class='wl-question top10'><div class='qtext'>Choose the equipment type</div><select id='wlItUnitType'><option value=''>Choose type…</option><optgroup label='Camera / Unit Types'>${cameraOptions}</optgroup><optgroup label='Stand / Pole Types'>${supportOptions}</optgroup></select></div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
  } else if (itUnitPhase === 'purpose') {
    const purposes = itAllowedPurposes(itTypeChoice);
    wizard.innerHTML = progress(`Unit ${unitNo} of ${totalUnits}`, `What is Unit ${unitNo} for?`, 1, 1) + `<div class='wl-question'><div class='qtext'>Choose BACKUP, SWAP, or DELIVERY</div><div class='wl-options'>${purposes.map(p => `<button class='${itPurposeChoice === p ? 'pass on' : 'pass'}' data-wl-unit-purpose='${p}'>${p}</button>`).join('')}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
  } else if (itUnitPhase === 'recon') {
    wizard.innerHTML = progress(`Unit ${unitNo} of ${totalUnits}`, 'Recon II requirement', 1, 1) + `<div class='wl-question'><div class='qtext'>How many Recon II camera / battery sets are required for this unit?</div><input id='wlReconRequired' type='number' inputmode='numeric' min='1' value='${Math.max(1, Number(itReconRequired || 1))}'></div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
  } else if (itUnitPhase === 'checks') {
    const steps = itUnitStepsData(item, unitNo);
    const step = steps[itQuestionIndex];
    wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, step?.label || `Check ${identity}`, itQuestionIndex + 1, Math.max(1, steps.length)) + itCheckStepHtml(item, step, itQuestionIndex, steps.length, unitNo) + `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>${itQuestionIndex === steps.length - 1 ? 'Next: Photo →' : 'Next →'}</button></div>`;
  } else if (itUnitPhase === 'photo') {
    wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, `Photograph ${identity} with tag ${esc(item.unit_tag || '')} visible`, 1, 3) + await photoOnlyHtml(activeItPrep.id, 'it', unitNo) + `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next: Signature →</button></div>`;
  } else if (itUnitPhase === 'review') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const issues = itUnitIssues(item, ev, unitNo);
    const ready = issues.length === 0;
    const sig = unitSignature(ev, unitNo); wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, `Review ${identity}`, 3, 3) + itUnitReviewHtml(item, ev, unitNo) + itIssueLinksHtml(item, ev, unitNo) + `${ready ? `<div class='ok'><b>✓ Checks, photo, and signature complete for ${esc(identity)}.</b></div>` : `<div class='wl-stop'><b>${esc(identity)} is not ready.</b><div>Choose an issue above to go directly to it.</div><button class='wl-big wl-red top10' data-wl-fix-issues>← Go to First Issue</button></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next ${ready ? '' : 'disabled'}>${unitNo < totalUnits ? `Next: Unit ${unitNo + 1} →` : 'Next: Ticket Summary →'}</button></div>`;
  } else if (itUnitPhase === 'signature') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const sig = unitSignature(ev, unitNo);
    wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, `Sign off ${identity}`, 2, 3) + itUnitReviewHtml(item, ev, unitNo) + await signatureOnlyHtml(activeItPrep.id, 'it', unitNo) + `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next ${sig ? '' : 'disabled'}>Next: Review ${esc(identity)} →</button></div>`;
    wizard.querySelectorAll('canvas').forEach(wireCanvas);
  }
  resetWizardPosition();
}
async function showITStatus() {
  const { data } = await liveDb.from('prep_tickets').select('id,ticket_no,site,status,released_by_name,released_at,closed_by_name,closed_at,requested_unit_count,equipment_manifest,solar_panel_qty,battery_replacement_qty,camera_replacement_qty,sim_replacement_qty,micro_sd_qty').order('created_at', { ascending: false }).limit(50);
  let card = document.getElementById('wlItStatus'); if (!card) { card = document.createElement('div'); card.id = 'wlItStatus'; card.className = 'card wl-history'; viewIT().append(card); }
  const rows = (data || []).map(r => {
    const cls = r.status === 'draft' ? 'wl-status-pending' : r.status === 'released' ? 'wl-status-waiting' : 'wl-status-complete';
    const label = r.status === 'draft' ? '🔴 PENDING IT' : r.status === 'released' ? '🟠 HANDOFF — WAITING FOR SERVICE' : '🟢 COMPLETED / DEPLOYED';
    return `<details class='${cls}'><summary>#${esc(r.ticket_no)} · ${label}</summary><div class='body'>${esc(r.site || '')}${equipmentManifestInlineHtml(r)}${ticketPartsInlineHtml(r)}<div class='small top8'>Prepared / handed off by: ${esc(r.released_by_name || 'Not handed off yet')}${r.released_at ? ' · ' + new Date(r.released_at).toLocaleString() : ''}</div>${r.closed_at ? `<div class='small'>Received by: ${esc(r.closed_by_name || 'Service')} · ${new Date(r.closed_at).toLocaleString()}</div>` : ''}</div></details>`;
  }).join('');
  card.innerHTML = `${progress('Status & History', 'Equipment handoff history', 1, 1)}<button class='wl-back' data-wl-home='it'>← IT Home</button>${rows || '<div class="warn">No history yet.</div>'}`;
  hideChildren(viewIT(), [card]); resetWizardPosition();
}
async function showSvcHome() {
  if (!isSvc() || !viewSvc()) return;
  let home = document.getElementById('wlSvcHome'); if (!home) { home = document.createElement('div'); home.id = 'wlSvcHome'; home.className = 'card wl-home'; viewSvc().prepend(home); }
  const [r, work, assignments,phoneAlerts,assignedAssets] = await Promise.all([myReturnCounts(), serviceWorkData(), myActiveAssignments('service'), pushAlertState(), myAssignedInventoryAssets()]);
  const assigned = assignments[0] || null;
  const alertBanner = phoneAlertBanner(phoneAlerts);
  const readyForService = work.released.length;
  const nextReleased = work.released[0] || null;
  const nextDeployed = work.deployed[0] || null;
  const assignmentAction = assigned ? `<div class='wl-next-action wl-assigned-next'><div class='wl-next-kicker'>ASSIGNED TO ME · FROM OWNER</div><b>MHelpDesk Ref #${esc(assigned.ticket_no)}</b><div class='small'>${esc(assigned.site || 'No customer / site entered')}</div>${assigned.work_type ? `<div class='small'><b>Job Type:</b> ${esc(assigned.work_type.toUpperCase())}</div>` : ''}${assigned.scheduled_for ? `<div class='small'><b>Work Date:</b> ${new Date(assigned.scheduled_for + 'T12:00:00').toLocaleDateString()}</div>` : ''}${assigned.requested_unit_count != null ? `<div class='small'><b>${String(assigned.work_type || '').toLowerCase() === 'pickup' ? 'Units Being Picked Up' : 'Units Required From MHelpDesk'}:</b> ${Number(assigned.requested_unit_count)}</div>` : ''}${assigned.unit_summary ? `<div class='small'><b>Unit / Equipment Notes:</b> ${esc(assigned.unit_summary)}</div>` : ''}${assigned.job_description ? `<div class='small'><b>Work:</b> ${esc(assigned.job_description)}</div>` : ''}${equipmentManifestInlineHtml(assigned)}${ticketPartsInlineHtml(assigned)}${automaticServiceSolarPlanHtml(assigned.equipment_manifest,assigned.work_type)}${assigned.notes ? `<div class='small'><b>Owner Notes:</b> ${esc(assigned.notes)}</div>` : ''}<button class='wl-big wl-blue top10' data-wl-start-assignment='${assigned.id}'>${assigned.status === 'started' ? 'Continue Assigned Job' : 'Open Assigned Job'} →</button></div>` : '';
  const nextAction = assignmentAction || (nextReleased ? `<div class='wl-next-action'><div class='wl-next-kicker'>NEXT ACTION</div><b>Receive Equipment · MHelpDesk #${esc(nextReleased.ticket_no)}</b><div class='small'>${esc(nextReleased.site || 'Equipment released by IT')}</div><button class='wl-big wl-blue top10' data-wl-next-svc-receive='${esc(nextReleased.ticket_no)}'>Receive This Equipment →</button></div>` : !work.inspectionDone ? `<div class='wl-next-action'><div class='wl-next-kicker'>NEXT ACTION</div><b>Complete Today’s Truck / Trailer Inspection</b><div class='small'>No morning inspection has been submitted from your account today.</div><button class='wl-big wl-blue top10' data-wl-next-svc-inspect>Start Inspection →</button></div>` : nextDeployed ? `<div class='wl-next-action'><div class='wl-next-kicker'>NEXT ACTION</div><b>Field Unit · ${esc(nextDeployed.unit_tag)}</b><div class='small'>MHelpDesk #${esc(nextDeployed.ticket_no)} · ${esc(nextDeployed.equipment_type || 'Deployed equipment')}</div><button class='wl-big wl-blue top10' data-wl-next-svc-return data-ticket='${esc(nextDeployed.ticket_no)}' data-unit='${esc(nextDeployed.unit_tag)}' data-type='${esc(nextDeployed.equipment_type || '')}'>Return This Unit When It Comes Back →</button></div>` : `<div class='wl-next-action clear'><div class='wl-next-kicker'>NEXT ACTION</div><b>✓ No Service action is currently waiting.</b><div class='small'>Your active handoffs and today’s inspection are caught up.</div></div>`);
  home.innerHTML = `${alertBanner}<div class='wl-title'>My Work Today</div><div class='wl-sub'>Owner-assigned jobs appear here first, followed by the next workflow action.</div>${nextAction}<div class='wl-workstrip'><span><b>${assignments.length}</b> assigned to me</span><span><b>${readyForService}</b> waiting from IT</span><span><b>${r.waiting}</b> returns waiting IT</span></div>${assignedInventoryHtml(assignedAssets)}<div class='wl-menu'><button class='wl-blue' data-wl-svc='receive'>① Receive Equipment From IT <span class='wl-count'>${readyForService}</span></button><button class='wl-red' data-wl-service-return>↩ Return Unit to IT Intake</button><button class='wl-gray' data-wl-svc='returns'>☰ My Returned Units <span class='wl-count'>${r.waiting + r.inventory}</span></button><button class='wl-amber' data-wl-svc='inspect'>② Truck / Trailer Inspection</button><button class='wl-gray' data-wl-svc='history'>☰ Inspection History</button></div>`;
  hideChildren(viewSvc(), [home]); resetWizardPosition();
}
async function showReceiveLookup() {
  let card = document.getElementById('wlSvcLookup'); if (!card) { card = document.createElement('div'); card.id = 'wlSvcLookup'; card.className = 'card'; viewSvc().append(card); }
  card.innerHTML = `${progress('Step 1', 'Enter the MHelpDesk ticket number', 1, 5)}<button class='wl-back' data-wl-home='svc'>← Service Home</button><label>MHelpDesk Ticket #</label><input id='wlTicketInput' inputmode='numeric' placeholder='Ticket #'><button class='wl-big wl-blue top10' data-wl-match>Find IT Equipment →</button><div id='wlLookupMsg'></div>`;
  hideChildren(viewSvc(), [card]); resetWizardPosition();
}
async function myServiceAssignmentForTicket(ticket, prepId=null) {
  const tech=await currentTechIdentity().catch(()=>null);
  if (!tech?.id) return null;
  let q=liveDb.from('job_assignments').select('*')
    .eq('assigned_role','service')
    .eq('assignee_user_id',tech.id)
    .eq('ticket_no',String(ticket || ''))
    .in('status',['assigned','started'])
    .order('assigned_at',{ascending:false})
    .limit(5);
  const { data }=await q;
  const rows=data || [];
  return rows.find(row => prepId && row.prep_ticket_id===prepId) || rows[0] || null;
}
async function openServiceTicket(ticket) {
  await showReceiveLookup();
  const input=document.getElementById('wlTicketInput');
  if(input) input.value=ticket;
  return matchSvcTicket();
}
async function matchSvcTicket() {
  const entered = document.getElementById('wlTicketInput')?.value || '';
  const { data } = await liveDb.from('prep_tickets').select('id,ticket_no,status').eq('status', 'released');
  const prep = (data || []).find(p => norm(p.ticket_no) === norm(entered));
  if (!prep) { document.getElementById('wlLookupMsg').innerHTML = `<div class='bad top10'><b>No equipment is waiting for Service under that ticket.</b></div>`; return; }
  document.getElementById('svcLookup').value = prep.ticket_no;
  await window.findPrep();
  await new Promise(r => setTimeout(r, 200));
  activeSvcPrep = await getPrep(prep.id);
  activeSvcAssignment = activeSvcAssignment?.ticket_no === activeSvcPrep.ticket_no ? activeSvcAssignment : await myServiceAssignmentForTicket(activeSvcPrep.ticket_no, activeSvcPrep.id);
  svcUnitIndex = 0;
  svcQuestionIndex = 0;
  showSvcTicketConfirmation();
}
function showSvcTicketConfirmation() {
  if (!activeSvcPrep) return;
  const base = document.getElementById('matchedPreps')?.closest('.card');
  const card = findSvcCard(activeSvcPrep.ticket_no);
  if (!base || !card) return alert('Could not open the matched equipment.');
  const forms = svcForms(card);
  const types = [...new Set((activeSvcPrep.prep_items || []).map(item => item.equipment_type).filter(Boolean))];
  const wizard = svcWizardCard();
  const preparedBy = activeSvcPrep.released_by_name || 'IT Technician';
  hideChildren(viewSvc(), [wizard]);
  base.style.display = 'none';
  wizard.innerHTML = progress('Verify Ticket', 'Does this match your MHelpDesk ticket?', 2, 6) + `<div class='wl-review'><div><b>MHelpDesk Ticket #</b></div><div style='font-size:28px;font-weight:950'>#${esc(activeSvcPrep.ticket_no)}</div><div class='top10'><b>Ticket Name / Customer / Site</b></div><div style='font-size:21px;font-weight:900'>${esc(activeSvcPrep.site || 'No ticket name entered')}</div><div class='top10'><b>Prepared by:</b> IT Tech ${esc(preparedBy)}</div><div class='top10'><b>Total equipment items IT is giving you:</b> ${forms.length}</div>${equipmentManifestInlineHtml(activeSvcPrep)}${types.length ? `<div class='small top8'><b>Checked equipment types:</b> ${esc(types.map(equipmentDisplayLabel).join(', '))}</div>` : ''}${ticketPartsInlineHtml(activeSvcPrep)}</div><div class='wl-question'><div class='qtext'>Does this ticket number, site, equipment, and work match your MHelpDesk ticket?</div><div class='wl-options'><button class='fail' data-wl-svc-ticket='wrong'>NO — WRONG TICKET</button><button class='pass' data-wl-svc-ticket='match'>YES — IT MATCHES</button></div></div>`;
  resetWizardPosition();
}
function findSvcCard(ticket) { return [...document.querySelectorAll('#matchedPreps > .item.prepared')].find(c => c.textContent.includes(`MHelpDesk Ticket #${ticket}`)); }
function svcForms(card) { return [...card.querySelectorAll('.unitConfirm')]; }

async function serviceSolarContextData(prepId) {
  const { data, error } = await liveDb.rpc('service_solar_context_v2', { p_prep_id: prepId });
  const empty={ need_solar:false,need_stand:false,has_helios:false,has_ranger:false,solar_spotter_count:0,ranger_count:0,expected_batteries:0,expected_solar_panels:0,assignment_id:null };
  if (error) { console.warn('Could not load Service Solar / Ranger / Helios context', error); return empty; }
  return Array.isArray(data) ? (data[0] || empty) : (data || empty);
}
async function loadServiceSolarCheck(prepId) {
  const { data, error } = await liveDb.from('service_solar_checks').select('*').eq('prep_ticket_id',prepId).maybeSingle();
  if (error) { console.warn('Could not load Service Solar / Helios checklist', error); return null; }
  return data || null;
}
async function serviceSolarEvidenceRows(prepId) {
  const { data, error } = await liveDb.from('service_solar_evidence').select('*').eq('prep_ticket_id',prepId).order('created_at',{ascending:true});
  if (error) { console.warn('Could not load Service Solar / Helios evidence', error); return []; }
  const rows=data || [];
  await Promise.all(rows.map(async row => {
    const { data:u }=await liveDb.storage.from(EVIDENCE_BUCKET).createSignedUrl(row.storage_path,3600);
    row.url=u?.signedUrl || '';
  }));
  return rows;
}
function serviceSolarEvidenceCount(rows, category, kind) {
  return (rows || []).filter(row => row.category===category && row.kind===kind).length;
}
function serviceSolarReady(ctx, check, evidence) {
  if (!ctx?.need_solar) return true;
  if (!check?.completed_at) return false;
  const requiredStandPhotos=ctx.need_stand ? Math.max(1,Number(ctx.solar_spotter_count || 0)) : 0;
  if (ctx.need_stand && (serviceSolarEvidenceCount(evidence,'solar_stand','photo')<requiredStandPhotos || serviceSolarEvidenceCount(evidence,'solar_stand','signature')<1)) return false;
  if (Number(ctx.expected_batteries || 0)>0 && (serviceSolarEvidenceCount(evidence,'batteries','photo')<1 || serviceSolarEvidenceCount(evidence,'batteries','signature')<1)) return false;
  if (serviceSolarEvidenceCount(evidence,'mppt','photo')<1) return false;
  if (ctx.has_helios && serviceSolarEvidenceCount(evidence,'helios_cerbo_mppt','photo')<1) return false;
  return true;
}
function serviceSolarDefaultStandTag() {
  const item=(activeSvcPrep?.prep_items || []).find(row => ['Solar Stand','Solar Pole'].includes(row.equipment_type));
  return item?.unit_tag || '';
}
function serviceSolarDefaultBatteryCount(ctx=null) {
  if (ctx && Number(ctx.expected_batteries || 0) > 0) return Number(ctx.expected_batteries || 0);
  return (activeSvcPrep?.prep_items || []).filter(row => ['Solar Stand','Solar Pole','Helios'].includes(row.equipment_type)).reduce((sum,row)=>sum+Number(row.battery_count || 0),0);
}
function serviceSolarExpectedPanels(ctx=null) {
  if (ctx && Number(ctx.expected_solar_panels || 0) > 0) return Number(ctx.expected_solar_panels || 0);
  return Math.max(Number(activeSvcAssignment?.solar_panel_qty || 0),Number(activeSvcPrep?.solar_panel_qty || 0));
}
function serviceSolarRequiredStandCount(ctx=null) {
  if (!ctx?.need_stand) return 0;
  return Math.max(1,Number(ctx.solar_spotter_count || 0));
}
function serviceSolarStandTagsValue(check=null) {
  return String(check?.stand_tag || serviceSolarDefaultStandTag() || '').split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).join('\n');
}
function serviceSolarProofPanelHtml(rows, category, title, instruction, requireSignature=false) {
  const photos=(rows || []).filter(row => row.category===category && row.kind==='photo');
  const sig=[...(rows || [])].reverse().find(row => row.category===category && row.kind==='signature');
  return `<div class='wl-proof service wl-solar-proof' data-solar-category='${esc(category)}'>
    <b>${esc(title)}</b>
    <div class='wl-note'>${esc(instruction)}</div>
    ${photos.length ? `<div class='wl-gallery'>${photos.map(p => `<img src='${esc(p.url)}' alt='${esc(title)}'>`).join('')}</div><div class='ok top8'><b>✓ ${photos.length} photo${photos.length===1?'':'s'} saved</b></div>` : `<div class='warn top8'>No photo saved yet.</div>`}
    <input class='wl-solar-file top8' type='file' accept='image/*' capture='environment' multiple>
    <button class='mini full top8' data-wl-solar-upload>Save ${esc(title)} Photo(s)</button>
    ${requireSignature ? (sig ? `<div class='wl-saved top8'><b>✓ Signature saved</b><div class='small'>${esc(sig.created_by_name || 'Service Tech')} · ${new Date(sig.created_at).toLocaleString()}</div>${sig.url ? `<img src='${esc(sig.url)}' alt='Saved signature'>` : ''}</div><button class='mini full top8' data-wl-solar-replace-sign>Replace Signature</button>` : `<div class='wl-sign top8'><b>Sign this verification with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-solar-clear>Clear</button><button class='wl-next' data-wl-solar-save-sign>Save Signature</button></div></div>`) : ''}
  </div>`;
}

function serviceSolarChecklistHtml(ctx, check, evidence) {
  const expectedPanels=Number(ctx?.expected_solar_panels || 0);
  const expectedBatteries=Number(ctx?.expected_batteries || 0);
  const spotters=Number(ctx?.solar_spotter_count || 0);
  const rangers=Number(ctx?.ranger_count || 0);
  const standTag=check?.stand_tag || serviceSolarDefaultStandTag();
  const batteryDefault=check?.battery_count ?? (expectedBatteries || '');
  const panelDefault=check?.solar_panel_count ?? (expectedPanels || '');
  const complete=serviceSolarReady(ctx,check,evidence);
  const autoBits=[];
  if (spotters) autoBits.push(`<span><b>${spotters}</b> Solar Spotter${spotters===1?'':'s'} → <b>${spotters}</b> Solar Stand${spotters===1?'':'s'} + <b>${spotters*4}</b> batteries</span>`);
  if (rangers) autoBits.push(`<span><b>${rangers}</b> Ranger${rangers===1?'':'s'} → <b>${rangers}</b> Solar Panel${rangers===1?'':'s'}</span>`);
  return `<div class='wl-service-solar'>
    <div class='wl-review'>
      <b>Service Solar / Ranger / Helios Checkout</b>
      <div class='small'>This step appears automatically after you finish checking the IT-prepared unit. Complete it before taking the equipment from the shop.</div>
      ${autoBits.length ? `<div class='wl-auto-service-plan top8'><b>AUTOMATIC SERVICE REQUIREMENTS</b><div class='wl-parts-chips'>${autoBits.join('')}</div></div>` : ''}
    </div>
    <div class='wl-question top10'>
      ${ctx.need_stand ? `<div class='wl-auto-required'><b>${spotters > 1 ? `${spotters} Solar Stands automatically assigned for checkout` : 'Solar Stand automatically assigned for checkout'}</b><div class='small'>Choose the physical stand${spotters>1?'s':''} you are taking and record ${spotters>1?'one exact tag per line or separated by commas':'the exact tag'} below.</div></div><label>Exact Solar Stand / Solar Pole Tag${spotters>1?'s':''}${spotters>0 ? ` · required ${spotters}` : ''}</label>${spotters>1 ? `<textarea id='wlSvcSolarStandTag' rows='3' placeholder='One stand tag per line or comma separated'>${esc(standTag)}</textarea>` : `<input id='wlSvcSolarStandTag' value='${esc(standTag)}' placeholder='Enter the exact stand tag / ID'>`}<label class='check top8'><input id='wlSvcSolarStandVerified' type='checkbox' ${check?.stand_verified?'checked':''}><span>I physically verified ${spotters>1?'these are the exact Solar Stands / Solar Poles':'this is the exact Solar Stand / Solar Pole'} I am taking for this job.</span></label>` : ''}
      <label class='check top8'><input id='wlSvcMpptUpdated' type='checkbox' ${check?.mppt_updated_ok?'checked':''}><span>MPPT firmware / configuration is updated and current.</span></label>
      <label class='check top8'><input id='wlSvcMpptTested' type='checkbox' ${check?.mppt_tested_ok?'checked':''}><span>MPPT was powered, tested, and is working.</span></label>
      ${ctx.has_helios ? `<label class='check top8'><input id='wlSvcCerboUpdated' type='checkbox' ${check?.cerbo_updated_ok?'checked':''}><span>Helios Cerbo update / configuration is current.</span></label><label class='check top8'><input id='wlSvcCerboOnline' type='checkbox' ${check?.cerbo_online_ok?'checked':''}><span>Helios Cerbo is online, communicating, and tested.</span></label>` : ''}
      <div class='grid top10'>
        <div><label>Solar Panels Physically In Hand${expectedPanels>0 ? ` · required ${expectedPanels}` : ' · for charging test'}</label><input id='wlSvcSolarPanelCount' type='number' inputmode='numeric' min='0' value='${esc(panelDefault)}' placeholder='How many solar panels?'></div>
        ${expectedBatteries>0 ? `<div><label>Batteries / Battery Boxes Physically In Hand · required ${expectedBatteries}</label><input id='wlSvcSolarBatteryCount' type='number' inputmode='numeric' min='0' value='${esc(batteryDefault)}' placeholder='How many batteries?'></div>` : ''}
      </div>
      <label class='check top8'><input id='wlSvcSolarPanelsVerified' type='checkbox' ${check?.solar_panels_verified?'checked':''}><span>I physically counted and verified the solar panel(s) required for this checkout.</span></label>
      ${expectedBatteries>0 ? `<label class='check top8'><input id='wlSvcBatteriesCharged' type='checkbox' ${check?.batteries_charged_ok?'checked':''}><span>I physically verified all ${expectedBatteries} required batteries / battery boxes are charged.</span></label>` : ''}
      <label class='check top8'><input id='wlSvcSolarCharging' type='checkbox' ${check?.solar_charging_ok?'checked':''}><span>With the solar panel, battery/battery system, and MPPT connected together, I verified the battery is actively charging.</span></label>
      <button class='wl-big wl-blue top10' data-wl-save-service-solar>Save Solar Checkout Checklist</button>
      ${check?.completed_at ? `<div class='ok top8'><b>✓ Checklist verified by ${esc(check.service_tech_name || 'Service Tech')}</b><div class='small'>${new Date(check.completed_at).toLocaleString()}</div></div>` : `<div class='warn top8'>Complete every required verification above, then save the checklist.</div>`}
    </div>

    ${ctx.need_stand ? serviceSolarProofPanelHtml(evidence,'solar_stand','Solar Stand Tag',spotters>1 ? `Take at least ${spotters} clear tag photos — one for each Solar Stand you are taking.` : 'Take a clear picture of the exact Solar Stand tag / ID you are taking from the shop.',true) : ''}
    ${expectedBatteries>0 ? serviceSolarProofPanelHtml(evidence,'batteries','Checkout Batteries','Take clear pictures of the required batteries / battery boxes after you verify they are charged.',true) : ''}
    ${serviceSolarProofPanelHtml(evidence,'mppt','MPPT / Charging Readings','Upload a picture of the MPPT / charging readings while the solar panel, battery system, and MPPT are connected together and actively charging.',false)}
    ${ctx.has_helios ? serviceSolarProofPanelHtml(evidence,'helios_cerbo_mppt','Helios Cerbo + MPPT','Take pictures showing the Helios Cerbo and MPPT updated, online, and tested.',false) : ''}

    <div class='${complete?'ok':'warn'} top10'><b>${complete?'✓ Solar checkout complete — equipment may leave the shop':'Solar checkout still needs verification'}</b><div class='small'>${complete?'Checklist, required proof photos, and signatures are saved.':'Complete the automatic stand/battery/panel requirements and upload the required MPPT / charging reading proof.'}</div></div>
  </div>`;
}

async function saveServiceSolarChecklist() {
  if (!activeSvcPrep?.id) return;
  const ctx=await serviceSolarContextData(activeSvcPrep.id);
  if (!ctx.need_solar) return;
  const standTag=document.getElementById('wlSvcSolarStandTag')?.value.trim() || '';
  const panelCount=Math.max(0,Math.floor(Number(document.getElementById('wlSvcSolarPanelCount')?.value || 0)));
  const batteryCount=Math.max(0,Math.floor(Number(document.getElementById('wlSvcSolarBatteryCount')?.value || 0)));
  const expectedPanels=Number(ctx.expected_solar_panels || 0);
  const expectedBatteries=Number(ctx.expected_batteries || 0);
  const requiredStands=ctx.need_stand ? Math.max(1,Number(ctx.solar_spotter_count || 0)) : 0;
  const standTags=standTag.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
  if (ctx.need_stand && standTags.length !== requiredStands) return alert('Enter exactly ' + requiredStands + ' Solar Stand tag' + (requiredStands===1?'':'s') + ', one for each Solar Spotter delivery unit.');
  if (ctx.need_stand && Number(ctx.solar_spotter_count || 0)>0) {
    const tagCount=standTag.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).length;
    if (tagCount !== Number(ctx.solar_spotter_count || 0)) return alert('This delivery automatically requires ' + Number(ctx.solar_spotter_count || 0) + ' Solar Stand tag' + (Number(ctx.solar_spotter_count || 0)===1?'':'s') + '. You entered ' + tagCount + '.');
  }
  if (ctx.need_stand && !document.getElementById('wlSvcSolarStandVerified')?.checked) return alert('Verify the Solar Stand / Solar Pole you are taking.');
  if (!document.getElementById('wlSvcMpptUpdated')?.checked) return alert('Verify the MPPT update / configuration.');
  if (!document.getElementById('wlSvcMpptTested')?.checked) return alert('Verify the MPPT was tested and is working.');
  if (ctx.has_helios && !document.getElementById('wlSvcCerboUpdated')?.checked) return alert('Verify the Helios Cerbo update / configuration.');
  if (ctx.has_helios && !document.getElementById('wlSvcCerboOnline')?.checked) return alert('Verify the Helios Cerbo is online and working.');
  if (panelCount < 1) return alert('Enter how many solar panels you physically have for the charging test.');
  if (expectedPanels > 0 && panelCount !== expectedPanels) return alert('This job automatically requires ' + expectedPanels + ' solar panel' + (expectedPanels===1?'':'s') + '. You entered ' + panelCount + '.');
  if (!document.getElementById('wlSvcSolarPanelsVerified')?.checked) return alert('Physically count and verify the required solar panels.');
  if (expectedBatteries > 0 && batteryCount !== expectedBatteries) return alert('This job automatically requires ' + expectedBatteries + ' batteries / battery-box items. You entered ' + batteryCount + '.');
  if (expectedBatteries > 0 && !document.getElementById('wlSvcBatteriesCharged')?.checked) return alert('Verify all required batteries / battery boxes are charged.');
  if (!document.getElementById('wlSvcSolarCharging')?.checked) return alert('Connect the solar panel, battery system, and MPPT together and verify the battery is actively charging.');

  document.body.classList.add('busy');
  const { error }=await liveDb.rpc('save_my_service_solar_check_v2',{
    p_prep_id:activeSvcPrep.id,
    p_stand_tag:standTag,
    p_stand_verified:Boolean(document.getElementById('wlSvcSolarStandVerified')?.checked),
    p_mppt_updated_ok:Boolean(document.getElementById('wlSvcMpptUpdated')?.checked),
    p_mppt_tested_ok:Boolean(document.getElementById('wlSvcMpptTested')?.checked),
    p_cerbo_updated_ok:Boolean(document.getElementById('wlSvcCerboUpdated')?.checked),
    p_cerbo_online_ok:Boolean(document.getElementById('wlSvcCerboOnline')?.checked),
    p_solar_panel_count:panelCount,
    p_solar_panels_verified:Boolean(document.getElementById('wlSvcSolarPanelsVerified')?.checked),
    p_battery_count:batteryCount,
    p_batteries_charged_ok:expectedBatteries>0 ? Boolean(document.getElementById('wlSvcBatteriesCharged')?.checked) : true,
    p_solar_charging_ok:Boolean(document.getElementById('wlSvcSolarCharging')?.checked),
  });
  document.body.classList.remove('busy');
  if (error) return alert(error.message);
  return renderSvcPrep();
}
async function uploadServiceSolarEvidence(prepId,category,kind,file) {
  const { data:{ session } }=await liveDb.auth.getSession();
  if (!session?.user?.id) throw new Error('Please sign in again.');
  const prepared=kind==='photo' ? await optimizeEvidencePhoto(file) : file;
  const ext=kind==='signature' ? 'png' : ((prepared.name || 'photo.jpg').split('.').pop() || 'jpg').toLowerCase();
  const path=`${session.user.id}/${prepId}/service-solar/${category}/${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error:up }=await liveDb.storage.from(EVIDENCE_BUCKET).upload(path,prepared,{contentType:prepared.type || (kind==='signature'?'image/png':'image/jpeg')});
  if (up) throw up;
  const original=kind==='signature' ? `${category}-signature.png` : `${category}-photo-${prepared.name || 'photo.jpg'}`;
  const { error:rec }=await liveDb.rpc('record_service_solar_evidence',{
    p_prep_id:prepId,p_category:category,p_kind:kind,p_storage_path:path,p_original_name:original
  });
  if (rec) throw rec;
}
function svcQuestions(form) {
  const out = [];
  const exact = form.querySelector("input[id^='exact_']");
  if (exact) { if (exact.checked && !exact.dataset.wlAnswered) exact.dataset.wlAnswered = '1'; out.push({ kind: 'bool', input: exact, label: form.querySelector('.row b')?.textContent?.trim() ? `Do you physically have ${form.querySelector('.row b').textContent.trim()}?` : 'Do you physically have this exact unit?' }); }
  const batt = form.querySelector("input[id^='sbatt_']");
  if (batt) out.push({ kind: 'number', input: batt, label: 'How many batteries / battery boxes are physically in hand?' });
  const battOk = form.querySelector("input[id^='sbattok_']");
  if (battOk) { if (battOk.checked && !battOk.dataset.wlAnswered) battOk.dataset.wlAnswered = '1'; out.push({ kind: 'bool', input: battOk, label: 'Did you physically count and verify the required batteries / battery box?' }); }
  return out;
}
function svcQuestionHtml(q, index, total) {
  if (q.kind === 'number') return `<div class='wl-question'><div class='qnum'>Check ${index + 1} of ${total}</div><div class='qtext'>${esc(q.label)}</div><input id='wlSvcCount' type='number' inputmode='numeric' min='${esc(q.input.min || '0')}' value='${esc(q.input.value || '')}' placeholder='Enter count'></div>`;
  const answered = q.input.dataset.wlAnswered === '1';
  const yes = answered && q.input.checked;
  const no = answered && !q.input.checked;
  return `<div class='wl-question'><div class='qnum'>Check ${index + 1} of ${total}</div><div class='qtext'>${esc(q.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-svc-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-svc-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>NO recorded.</b><div>You can continue documenting, but this equipment cannot be accepted until the mismatch is corrected.</div></div>` : ''}</div>`;
}
function svcWizardCard() {
  let wizard = document.getElementById('wlSvcWizardOnly');
  if (!wizard) { wizard = document.createElement('div'); wizard.id = 'wlSvcWizardOnly'; wizard.className = 'card'; viewSvc().append(wizard); }
  return wizard;
}
async function advanceSvcVerification() { const card = findSvcCard(activeSvcPrep?.ticket_no); if (!card) return; const forms = svcForms(card); if (svcUnitIndex >= forms.length) return; const questions = svcQuestions(forms[svcUnitIndex]); const q = questions[svcQuestionIndex]; if (q?.kind === 'bool' && q.input.dataset.wlAnswered !== '1') return alert('Choose YES or NO first.'); if (q?.kind === 'number') { const value = document.getElementById('wlSvcCount')?.value ?? ''; if (value === '') return alert('Enter the physical count first.'); q.input.value = value; } if (svcQuestionIndex < questions.length - 1) svcQuestionIndex++; else { svcUnitIndex++; svcQuestionIndex = 0; } return renderSvcPrep(); }

async function renderSvcPrep() {
  if (!activeSvcPrep) return;
  const base = document.getElementById('matchedPreps')?.closest('.card');
  const card = findSvcCard(activeSvcPrep.ticket_no);
  if (!base || !card) return alert('Could not open the matched equipment.');
  const forms = svcForms(card);
  const wizard = svcWizardCard();
  const partsTotal = ticketPartsTotal(activeSvcPrep);
  const hasParts = partsTotal > 0;
  const solarCtx = await serviceSolarContextData(activeSvcPrep.id);
  const solarRequired = Boolean(solarCtx?.need_solar);
  const solarCheck = solarRequired ? await loadServiceSolarCheck(activeSvcPrep.id) : null;
  const solarEvidence = solarRequired ? await serviceSolarEvidenceRows(activeSvcPrep.id) : [];
  const solarReady = serviceSolarReady(solarCtx,solarCheck,solarEvidence);

  const partStep = forms.length;
  const solarStep = forms.length + (hasParts ? 1 : 0);
  const proofStep = solarStep + (solarRequired ? 1 : 0);
  const photoStep = proofStep + 1;
  const signStep = proofStep + 2;
  const finalStep = proofStep + 3;
  const preparedBy = activeSvcPrep.released_by_name || 'IT Technician';
  hideChildren(viewSvc(), [wizard]);
  base.style.display = 'none';

  if (svcUnitIndex < forms.length) {
    const questions = svcQuestions(forms[svcUnitIndex]);
    const q = questions[svcQuestionIndex];
    const afterLast = hasParts ? 'Verify Parts →' : solarRequired ? 'Solar / Helios Check →' : 'Compare IT Photos →';
    wizard.innerHTML = progress(`Unit ${svcUnitIndex + 1} of ${forms.length}`, q?.label || 'Verify this unit', svcQuestionIndex + 1, Math.max(1, questions.length)) +
      (q ? svcQuestionHtml(q, svcQuestionIndex, questions.length) : `<div class='ok'><b>This unit has no additional checks.</b></div>`) +
      `<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>${svcQuestionIndex === questions.length - 1 ? (svcUnitIndex === forms.length - 1 ? afterLast : 'Next Unit →') : 'Next →'}</button></div>`;
  } else if (hasParts && svcUnitIndex === partStep) {
    const confirmed = Boolean(activeSvcPrep.service_parts_confirmed);
    wizard.innerHTML = progress('Parts Handoff', `Verify parts from IT Tech ${preparedBy}`, 1, 1) +
      `<div class='wl-review'><b>Physically verify every part before accepting it.</b><div class='small'>MHelpDesk #${esc(activeSvcPrep.ticket_no)} · Prepared by IT Tech ${esc(preparedBy)}</div>${ticketPartsInlineHtml(activeSvcPrep)}</div>${confirmed ? `<div class='ok'><b>✓ Parts verified.</b><div>Recorded by ${esc(activeSvcPrep.service_parts_confirmed_by_name || 'Service Tech')}.</div></div>` : `<div class='wl-question'><div class='qtext'>Do you physically have the exact quantities listed above from IT Tech ${esc(preparedBy)}?</div><div class='wl-options'><button class='pass' data-wl-confirm-service-parts>YES — I HAVE THEM</button><button class='fail' data-wl-service-parts-mismatch>NO — MISMATCH</button></div></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${confirmed ? '' : 'disabled'}>${solarRequired ? 'Solar / Helios Check →' : 'Compare IT Photos →'}</button></div>`;
  } else if (solarRequired && svcUnitIndex === solarStep) {
    wizard.innerHTML = progress('Solar / Helios Pre-Trip', 'Verify Solar Stand, charging, MPPT, batteries, and Helios Cerbo', 1, 1) +
      serviceSolarChecklistHtml(solarCtx,solarCheck,solarEvidence) +
      `<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${solarReady ? '' : 'disabled'}>Compare IT Photos →</button></div>`;
    wizard.querySelectorAll('canvas').forEach(wireCanvas);
  } else if (svcUnitIndex === proofStep) {
    wizard.innerHTML = progress('Compare', `Look at IT Tech ${preparedBy}’s handoff photos`, 1, 1) + await proofHtml(activeSvcPrep.id, 'it', false) + `<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>My Photos →</button></div>`;
  } else if (svcUnitIndex === photoStep) {
    const itEv = await evidenceRows(activeSvcPrep.id, 'it');
    const requiredPhotos = itEv.filter(x => x.kind === 'photo').length || forms.length;
    wizard.innerHTML = progress('Service Photos', `Take ${requiredPhotos} matching receipt photo${requiredPhotos === 1 ? '' : 's'}`, 1, 1) + await photoOnlyHtml(activeSvcPrep.id, 'service', null, requiredPhotos) + `<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>Signature →</button></div>`;
  } else if (svcUnitIndex === signStep) {
    wizard.innerHTML = progress('Service Signature', `Sign that you received and verified the handoff from IT Tech ${preparedBy}`, 1, 1) + await signatureOnlyHtml(activeSvcPrep.id, 'service') + `<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>Review →</button></div>`;
    wizard.querySelectorAll('canvas').forEach(wireCanvas);
  } else {
    const ev = await evidenceRows(activeSvcPrep.id, 'service');
    const itEv = await evidenceRows(activeSvcPrep.id, 'it');
    const requiredPhotos = itEv.filter(x => x.kind === 'photo').length || forms.length;
    const servicePhotos = ev.filter(x => x.kind === 'photo').length;
    const allChecksOk = forms.every(form => svcQuestions(form).every(q => q.kind === 'number' ? q.input.value !== '' : q.input.checked));
    const partsReady = !hasParts || Boolean(activeSvcPrep.service_parts_confirmed);
    const proofReady = servicePhotos === requiredPhotos && ev.some(x => x.kind === 'signature');
    const ready = proofReady && allChecksOk && partsReady && solarReady;
    wizard.innerHTML = progress('Final Step', 'Accept equipment and deploy to field', 1, 1) +
      `<div class='wl-review'><b>MHelpDesk #${esc(activeSvcPrep.ticket_no)}</b><div class='small'><b>Received from:</b> IT Tech ${esc(preparedBy)}</div><div class='small'>📷 Service receipt photos: ${servicePhotos} of ${requiredPhotos} required to match IT</div><div class='small'>${proofReady ? '✓ Matching photo count and final Service signature saved.' : 'Matching receipt photo count and final signature are still required.'}</div>${partsReady ? (hasParts ? `<div class='small'>✓ Listed parts physically verified.</div>` : '') : `<div class='wl-stop'><b>Parts are not verified.</b><div>Use Back and verify the physical parts from IT.</div></div>`}${solarRequired ? (solarReady ? `<div class='small'>✓ Solar / Helios pre-trip checklist, photos, and required signatures complete.</div>` : `<div class='wl-stop'><b>Solar / Helios pre-trip verification is incomplete.</b><div>Use Back to complete the Solar Stand, battery, MPPT, and Cerbo proof.</div></div>`) : ''}${allChecksOk ? `<div class='small'>✓ Every Service equipment verification answer is YES.</div>` : `<div class='wl-stop'><b>One or more Service checks are NO or incomplete.</b><div>Use Back to correct the mismatch before accepting equipment.</div></div>`}</div><button class='wl-big wl-green' data-wl-close-svc ${ready ? '' : 'disabled'}>Accept from IT Tech ${esc(preparedBy)} & Mark Deployed →</button><div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>`;
  }
  resetWizardPosition();
}
function inspectionQuestion() {
  const total = 8 + 1 + (inspection.takingTrailer === true ? 7 : 0) + 1;
  let card = document.getElementById('wlInspection'); if (!card) { card = document.createElement('div'); card.id = 'wlInspection'; card.className = 'card'; viewSvc().append(card); }
  let body = '';
  if (inspection.step < 8) { const i = inspection.step; body = `${progress(`Truck Question ${i + 1} of 8`, truckLabels[i], i + 1, total)}<div class='wl-question'><div class='qtext'>${esc(truckLabels[i])}</div><div class='wl-options'><button class='pass ${inspection.truck[i] === true ? 'on' : ''}' data-wl-answer='pass'>PASS</button><button class='fail ${inspection.truck[i] === false ? 'on' : ''}' data-wl-answer='fail'>FAIL</button></div></div>`; }
  else if (inspection.step === 8) { body = `${progress('Trailer', 'Are you taking a trailer today?', 9, total)}<div class='wl-question'><div class='qtext'>Taking a trailer today?</div><div class='wl-options'><button class='pass ${inspection.takingTrailer === false ? 'on' : ''}' data-wl-trailer='no'>NO TRAILER</button><button class='fail ${inspection.takingTrailer === true ? 'on' : ''}' data-wl-trailer='yes'>YES</button></div></div>`; }
  else if (inspection.takingTrailer === true && inspection.step < 16) { const i = inspection.step - 9; body = `${progress(`Trailer Question ${i + 1} of 7`, trailerLabels[i], inspection.step + 1, total)}<div class='wl-question'><div class='qtext'>${esc(trailerLabels[i])}</div><div class='wl-options'><button class='pass ${inspection.trailer[i] === true ? 'on' : ''}' data-wl-answer='pass'>PASS</button><button class='fail ${inspection.trailer[i] === false ? 'on' : ''}' data-wl-answer='fail'>FAIL</button></div></div>`; }
  else { const failed = inspection.truck.some(v => v === false) || (inspection.takingTrailer === true && inspection.trailer.some(v => v === false)); body = `${progress('Final Step', 'Review and submit to Owner', total, total)}<div class='wl-review'><b>Truck:</b> ${inspection.truck.some(v => v === false) ? 'FAILED' : 'PASS'}<br><b>Trailer:</b> ${inspection.takingTrailer === true ? (inspection.trailer.some(v => v === false) ? 'FAILED' : 'PASS') : 'Not taken'}</div>${failed ? `<div class='wl-stop'><b>FAILED ITEM — CALL OPERATIONS MANAGER</b><a href='tel:${OPS_TEL}'>Call Operations Manager — ${OPS_DISPLAY}</a></div>` : ''}<button class='wl-big ${failed ? 'wl-red' : 'wl-green'} top10' data-wl-submit-inspection>Submit Morning Inspection to Owner</button>`; }
  const failedNow = inspection.truck.some(v => v === false) || inspection.trailer.some(v => v === false);
  card.innerHTML = `${inspectionRecovered ? `<div class='warn wl-draft-recovered'><b>Recovered unsent inspection from this device.</b><div class='small'>Nothing was submitted while you were offline or away. Continue where you left off.</div></div>` : ''}<button class='wl-back' data-wl-home='svc'>← Service Home</button>${body}${failedNow && inspection.step < (inspection.takingTrailer === true ? 16 : 9) ? `<div class='wl-stop'><b>A failed item needs immediate attention.</b><a href='tel:${OPS_TEL}'>Call Operations Manager — ${OPS_DISPLAY}</a></div>` : ''}<div class='wl-nav'><button class='wl-prev' data-wl-inspect-prev ${inspection.step === 0 ? 'disabled' : ''}>Back</button>${inspection.step < (inspection.takingTrailer === true ? 16 : 9) ? `<button class='wl-next' data-wl-inspect-next>Next →</button>` : '<span></span>'}</div>`;
  hideChildren(viewSvc(), [card]); resetWizardPosition();
}
async function startInspection() { const saved=await loadDeviceDraft('inspection'); if (saved && Array.isArray(saved.truck) && Array.isArray(saved.trailer)) { inspection={ step:Number(saved.step||0), truck:saved.truck.slice(0,8), takingTrailer:saved.takingTrailer ?? null, trailer:saved.trailer.slice(0,7) }; while(inspection.truck.length<8) inspection.truck.push(null); while(inspection.trailer.length<7) inspection.trailer.push(null); inspectionRecovered=true; } else { inspection={ step:0, truck:Array(8).fill(null), takingTrailer:null, trailer:Array(7).fill(null) }; inspectionRecovered=false; } inspectionQuestion(); }
async function submitInspection() {
  if (inspection.truck.some(v => v === null)) return alert('Complete every truck question.'); if (inspection.takingTrailer === true && inspection.trailer.some(v => v === null)) return alert('Complete every trailer question.');
  if (!navigator.onLine) { await saveInspectionDraft(); return alert('No connection. Your inspection is saved on this device, but it has NOT been submitted to the Owner. Reconnect and tap Submit again.'); }
  const truck = {}; inspection.truck.forEach((v, i) => truck[`truck_${i + 1}`] = v); const trailer = {}; inspection.trailer.forEach((v, i) => trailer[`trailer_${i + 1}`] = v); const text = document.getElementById('sessionClosed')?.textContent || ''; const tickets = [...text.matchAll(/MHelpDesk Ticket\s*#([^·\s]+)/gi)].map(m => m[1]);
  document.body.classList.add('busy'); try { const { error } = await liveDb.rpc('submit_morning_check', { p_mhelp_reviewed: true, p_truck_checks: truck, p_taking_trailer: inspection.takingTrailer === true, p_trailer_checks: trailer, p_closed_ticket_nos: tickets }); if (error) throw error; await clearDeviceDraft('inspection'); inspectionRecovered=false; alert('Morning inspection submitted to the Owner.'); showSvcHome(); } catch(error) { await saveInspectionDraft(); alert(error?.message === 'Failed to fetch' ? 'Connection lost. Your inspection is saved on this device and was not marked submitted. Reconnect and try again.' : (error?.message || 'Could not submit the inspection.')); } finally { document.body.classList.remove('busy'); }
}
async function showInspectionHistory() {
  const { data } = await liveDb.from('morning_checks').select('*').order('submitted_at', { ascending: false }).limit(60); let card = document.getElementById('wlSvcHistory'); if (!card) { card = document.createElement('div'); card.id = 'wlSvcHistory'; card.className = 'card wl-history'; viewSvc().append(card); }
  card.innerHTML = `${progress('Inspection History', 'Submitted truck / trailer checks', 1, 1)}<button class='wl-back' data-wl-home='svc'>← Service Home</button>${(data || []).map(r => { const tv = Object.values(r.truck_checks || {}).filter(v => typeof v === 'boolean'); const rv = Object.values(r.trailer_checks || {}).filter(v => typeof v === 'boolean'); const fail = tv.includes(false) || (r.taking_trailer && rv.includes(false)); return `<details><summary>${new Date(r.submitted_at).toLocaleDateString()} · ${new Date(r.submitted_at).toLocaleTimeString()} · ${fail ? 'FAILED' : 'PASSED'}</summary><div class='body'><b>Truck:</b> ${tv.includes(false) ? 'FAILED' : 'PASS'}<br><b>Trailer:</b> ${!r.taking_trailer ? 'Not taken' : rv.includes(false) ? 'FAILED' : 'PASS'}</div></details>`; }).join('') || '<div class="warn">No submitted inspections yet.</div>'}`;
  hideChildren(viewSvc(), [card]); resetWizardPosition();
}
async function refreshProofPanel(panel) {
  if (!panel) return;
  const prepId = panel.dataset.proof;
  const stage = panel.dataset.stage;
  const mode = panel.dataset.mode || 'full';
  const unitNo = Number(panel.dataset.unit || 0) || null;
  const expectedCount = Number(panel.dataset.expected || 0) || null;
  const html = mode === 'photo' ? await photoOnlyHtml(prepId, stage, unitNo, expectedCount) : mode === 'signature' ? await signatureOnlyHtml(prepId, stage, unitNo) : await proofHtml(prepId, stage, true);
  panel.outerHTML = html;
  const selector = `[data-proof='${prepId}'][data-stage='${stage}']${unitNo ? `[data-unit='${unitNo}']` : ''}`;
  const next = document.querySelector(selector);
  next?.querySelectorAll('canvas').forEach(wireCanvas);
}
document.addEventListener('change', async e => {
  if (e.target.id === 'wlReturnPhoto') { const file = e.target.files?.[0]; if (!file) return; serviceReturn.photo = file; saveServiceReturnDraft(); return renderServiceReturn(); }
  if (e.target.id === 'wlReturnConditionPhotos') { serviceReturn.conditionPhotos = await prepareReturnPreviewPhotos([...(e.target.files || [])]); return renderServiceReturn(); }
  if (e.target.id === 'wlReturnDamagePhotos') { serviceReturn.damagePhotos = await prepareReturnPreviewPhotos([...(e.target.files || [])]); return renderServiceReturn(); }
  if (e.target.id === 'wlIntakePhoto') {
    const file = e.target.files?.[0];
    if (!file) return;
    intakeWizard.photo = file;
    return renderITIntakeWizard();
  }
});
document.addEventListener('click', async e => {
  const nextItIntake = e.target.closest('[data-wl-next-it-intake]'); if (nextItIntake) return startITIntake(nextItIntake.dataset.wlNextItIntake);
  const nextSvcReceive = e.target.closest('[data-wl-next-svc-receive]'); if (nextSvcReceive) return openServiceTicket(nextSvcReceive.dataset.wlNextSvcReceive);
  if (e.target.closest('[data-wl-next-svc-inspect]')) return startInspection();
  const nextSvcReturn = e.target.closest('[data-wl-next-svc-return]'); if (nextSvcReturn) return showServiceReturnPreset(nextSvcReturn.dataset.ticket,nextSvcReturn.dataset.unit,nextSvcReturn.dataset.type);
  if (e.target.closest('[data-wl-service-return]')) return showServiceReturn();
  if (e.target.closest('[data-wl-return-next]')) return serviceReturnNext();
  const returnUnit = e.target.closest('[data-wl-return-unit]');
  if (returnUnit) { serviceReturn.unit = returnUnit.dataset.wlReturnUnit || ''; if (returnUnit.dataset.wlReturnType) serviceReturn.type = returnUnit.dataset.wlReturnType; if (serviceReturn.step === 1) serviceReturn.step = 2; saveServiceReturnDraft(); return renderServiceReturn(); }
  if (e.target.closest('[data-wl-return-prev]')) { serviceReturn.step = Math.max(0, serviceReturn.step - 1); saveServiceReturnDraft(); return renderServiceReturn(); }
  if (e.target.closest('[data-wl-return-submit]')) return submitServiceReturn();
  if (e.target.id === 'wlReturnPhoto') return;
  const addEquipmentClick = e.target.closest('button');
  if ((addEquipmentClick && /Add Equipment/i.test(addEquipmentClick.textContent)) || e.target.closest('#needDraft .danger')) setTimeout(updateUnitCountStatus, 0);
  const mode = e.target.closest('[data-wl-mode]');
  if (mode) { if (mode.dataset.wlMode === 'intake') return showITIntake(); return showITHome(); }
  const intakeView = e.target.closest('[data-wl-intake-view]');
  if (intakeView) return showITIntakeList(intakeView.dataset.wlIntakeView);
  const intakeStart = e.target.closest('[data-wl-intake-start]');
  if (intakeStart) return startITIntake(intakeStart.dataset.wlIntakeStart);
  const intakeAnswer = e.target.closest('[data-wl-intake-answer]');
  if (intakeAnswer) {
    const value = intakeAnswer.dataset.wlIntakeAnswer === 'yes';
    intakeWizard.answers[intakeWizard.step] = value;
    const row = intakeWizard.row;
    if (row?.id) {
      const tech = await currentTechIdentity();
      if (intakeWizard.step === 12 && value) intakeWizard.meta.cancellationDoc = intakeDocumentation(row, tech);
      intakeWizard.meta.answers = [...intakeWizard.answers];
      const update = { damage_notes: writeIntakeRecord(intakeWizard.notes, intakeWizard.meta), updated_at: new Date().toISOString() };
      const { error } = await liveDb.from('unit_returns').update(update).eq('id', row.id);
      if (error) return alert(error.message);
      row.damage_notes = update.damage_notes;
    }
    return renderITIntakeWizard();
  }
  if (e.target.closest('[data-wl-intake-next]')) {
    if (intakeWizard.step < intakeLabels.length && intakeWizard.answers[intakeWizard.step] === null) return alert('Choose YES or NO first.');
    if (intakeWizard.step === intakeLabels.length) { const file = document.getElementById('wlIntakePhoto')?.files?.[0]; if (!file && !intakeWizard.photo) return alert('Take or choose the IT intake photo first.'); if (file) intakeWizard.photo = file; }
    intakeWizard.step++;
    return renderITIntakeWizard();
  }
  if (e.target.closest('[data-wl-intake-prev]')) { if (intakeWizard.step === intakeLabels.length + 1) intakeWizard.notes = document.getElementById('wlIntakeNotes')?.value || intakeWizard.notes; intakeWizard.step = Math.max(0, intakeWizard.step - 1); return renderITIntakeWizard(); }
  if (e.target.closest('[data-wl-intake-finish]')) {
    intakeWizard.notes = document.getElementById('wlIntakeNotes')?.value || '';
    const row = intakeWizard.row;
    const tech = await currentTechIdentity();
    const paths = intakeWizard.photo ? await uploadReturnPhotos([intakeWizard.photo], row.id, 'it') : row.intake_photo_paths || [];
    const now = new Date().toISOString();
    const a = intakeWizard.answers;
    if (!a.every(v => v === true)) return alert('Every IT intake check must be YES before this unit can move to MHelpDesk inventory.');
    if (!intakeWizard.meta.cancellationDoc) intakeWizard.meta.cancellationDoc = intakeDocumentation(row, tech, new Date(now));
    intakeWizard.meta.answers = [...a];
    const { error } = await liveDb.from('unit_returns').update({ status: 'pending_mhelp_inventory', it_tech_id: tech.id, it_tech_name: tech.name, it_received_at: now, damage_notes: writeIntakeRecord(intakeWizard.notes, intakeWizard.meta), intake_photo_paths: paths, updated_at: now }).eq('id', row.id);
    if (error) return alert(error.message);
    intakeWizard = { row: null, step: 0, answers: Array(intakeLabels.length).fill(null), notes: '', photo: null, meta: {} };
    return showITIntake();
  }
  const ownerRemoveReturn = e.target.closest('[data-wl-owner-remove-return]'); if (ownerRemoveReturn) { if (!roleText().includes('Owner/Admin')) return alert('Only the Owner/Admin can remove Return & Intake tracking records.'); const unit = ownerRemoveReturn.dataset.wlUnit || 'this unit'; const ticket = ownerRemoveReturn.dataset.wlTicket || ''; if (!confirm(`Remove Unit ${unit}${ticket ? ` from MHelpDesk #${ticket}` : ''} from Return & Intake Tracking?\n\nThis deletes this tracking record from the app and cannot be undone.`)) return; ownerRemoveReturn.disabled = true; ownerRemoveReturn.textContent = 'Removing…'; const { error } = await liveDb.rpc('owner_remove_unit_return', { p_return_id: ownerRemoveReturn.dataset.wlOwnerRemoveReturn }); if (error) { ownerRemoveReturn.disabled = false; ownerRemoveReturn.textContent = 'Remove from Tracking'; return alert(error.message); } await installOwnerIntake(true); if (typeof window.refreshData === 'function') await window.refreshData(); return; } const ownerMhelpDone = e.target.closest('[data-wl-owner-mhelp-done]');
  if (ownerMhelpDone) {
    if (!roleText().includes('Owner/Admin')) return alert('Only the Owner/Manager can confirm MHelpDesk shop inventory.');
    if (!confirm('Confirm you have returned this unit to Shop Inventory in MHelpDesk?')) return;
    const now = new Date().toISOString();
    const { error } = await liveDb.from('unit_returns').update({ status: 'completed', mhelp_inventory_confirmed: true, mhelp_confirmed_at: now, completed_at: now, updated_at: now }).eq('id', ownerMhelpDone.dataset.wlOwnerMhelpDone);
    if (error) return alert(error.message);
    await installOwnerIntake(true);
    if (typeof window.refreshData === 'function') await window.refreshData();
    return;
  }
  const it = e.target.closest('[data-wl-it]'); if (it) { if (it.dataset.wlIt === 'new') { pendingAssignmentLinkId=null; pendingAssignmentManifest=[]; pendingAssignmentWorkType='service'; const t=document.getElementById('itTicket'); const s=document.getElementById('itSite'); if(t)t.value=''; if(s)s.value=''; fillTicketPartInputs({},'wlPart'); showNewPrep(0); } if (it.dataset.wlIt === 'pending') showPendingList(); if (it.dataset.wlIt === 'history') showITStatus(); return; }
  if (e.target.closest("[data-wl-home='it']")) return showITHome(); if (e.target.closest("[data-wl-home='svc']")) return showSvcHome();
  const cr = e.target.closest('[data-wl-create]'); if (cr) { if (cr.dataset.wlCreate === 'prev') { pendingAssignmentLinkId=null; pendingAssignmentManifest=[]; pendingAssignmentWorkType='service'; showITHome(); } else if (validateCreateStep()) await createPrepAndStartChecks(); return; }
  const openIt = e.target.closest('[data-wl-open-it]'); if (openIt) return showItPrep(openIt.dataset.wlOpenIt);
  const countMinus = e.target.closest('[data-wl-count-minus]'); if (countMinus) { const input = document.getElementById('wlUnitCountEdit'); if (input) input.value = String(Math.max(1, Number(input.value || 1) - 1)); return; }
  const countPlus = e.target.closest('[data-wl-count-plus]'); if (countPlus) { const input = document.getElementById('wlUnitCountEdit'); if (input) input.value = String(Math.max(1, Number(input.value || 1) + 1)); return; }

  if (e.target.closest('[data-wl-edit-total]')) return editItPrepUnitCount();
  if (e.target.closest('[data-wl-it-back]')) return showPendingList();
  const purpose = e.target.closest('[data-wl-unit-purpose]');
  if (purpose) { itPurposeChoice = purpose.dataset.wlUnitPurpose; return renderItUnitStep(); }
  const photoTag = e.target.closest('[data-wl-photo-tag]');
  if (photoTag && itUnitPhase === 'photo') {
    const item = currentItItem();
    if (!item) return;
    const matches = photoTag.dataset.wlPhotoTag === 'yes';
    const { error } = await liveDb.rpc('confirm_it_unit_photo_tag', { p_item_id: item.id, p_matches: matches });
    if (error) return alert(error.message);
    activeItPrep = await getPrep(activeItPrep.id);
    if (!matches) alert(`Retake the photo so the unit tag for ${itItemIdentity(currentItItem(), itUnitIndex + 1)} is clearly visible and matches the equipment.`);
    return renderItUnitStep();
  }
  const itAnswer = e.target.closest('[data-wl-it-answer]');
  if (itAnswer && itUnitPhase === 'checks') {
    const item = currentItItem();
    const step = itUnitStepsData(item, itUnitIndex + 1)[itQuestionIndex];
    if (!step || step.kind !== 'bool') return;
    const value = itAnswer.dataset.wlItAnswer === 'yes';
    item[step.field] = value;
    itDraftAnswers.set(itAnswerKey(item, step.field), value);
    itAnswered.add(itAnswerKey(item, step.field));
    const answerButtons = itAnswer.closest('.wl-options')?.querySelectorAll('button') || [];
    answerButtons.forEach(button => button.disabled = true);
    const saved = await persistCurrentItItem();
    if (!saved) { answerButtons.forEach(button => button.disabled = false); return; }
    if (value) { const steps = itUnitStepsData(currentItItem(), itUnitIndex + 1); if (itQuestionIndex < steps.length - 1) itQuestionIndex++; else itUnitPhase = 'photo'; }
    return renderItUnitStep();
  }
  if (e.target.closest('[data-wl-it-next]')) {
    const items = itItems();
    const totalUnits = activeItPrep?.expected_unit_count || itExpectedUnits || items.length;
    if (itUnitPhase === 'type') {
      const value = document.getElementById('wlItUnitType')?.value || '';
      if (!value) return alert('Choose the unit type first.');
      itTypeChoice = value;
      itPurposeChoice = '';
      itUnitPhase = 'purpose';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'purpose') {
      if (!itPurposeChoice) return alert('Choose BACKUP, SWAP, or DELIVERY first.');
      if (!itAllowedPurposes(itTypeChoice).includes(itPurposeChoice)) return alert('That purpose is not available for this equipment type.');
      if (itTypeChoice === 'Recon 2') { itUnitPhase = 'recon'; return renderItUnitStep(); }
      if (!await configureCurrentItItem()) return;
      itQuestionIndex = 0;
      itUnitPhase = 'checks';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'recon') {
      const value = Math.max(1, Number(document.getElementById('wlReconRequired')?.value || 0));
      if (value < 1) return alert('Enter the Recon II camera / battery requirement.');
      itReconRequired = value;
      if (!await configureCurrentItItem()) return;
      itQuestionIndex = 0;
      itUnitPhase = 'checks';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'checks') {
      const item = currentItItem();
      const steps = itUnitStepsData(item, itUnitIndex + 1);
      const step = steps[itQuestionIndex];
      let needsSave = false;
      if (step.kind === 'tag') {
        const value = document.getElementById('wlItUnitValue')?.value.trim() || '';
        if (!value) return alert('Enter the exact unit tag first.');
        item.unit_tag = value; needsSave = true;
      } else if (step.kind === 'number') {
        const value = Number(document.getElementById('wlItUnitValue')?.value || 0);
        if (value < Number(item.required_battery_count || 0)) return alert(`This unit requires at least ${Number(item.required_battery_count || 0)} batteries / battery boxes.`);
        item.battery_count = value; needsSave = true;
      } else if (!itBoolAnswered(item, step.field)) {
        return alert('Choose YES or NO first.');
      }
      if (needsSave && !await persistCurrentItItem()) return;
      if (itQuestionIndex < steps.length - 1) itQuestionIndex++;
      else itUnitPhase = 'photo';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'photo') {
      const ev = await evidenceRows(activeItPrep.id, 'it');
      const item = currentItItem();
      const identity = itItemIdentity(item, itUnitIndex + 1);
      if (!unitEvidence(ev, itUnitIndex + 1, 'photo').length) return alert(`Take and save a photo of ${identity} before continuing.`);
      if (!itPhotoTagReady(item)) return alert(`Confirm that the photo clearly shows unit tag ${item.unit_tag} and matches ${identity} before continuing.`);
      itUnitPhase = 'signature';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'signature') {
      const ev = await evidenceRows(activeItPrep.id, 'it');
      if (!unitSignature(ev, itUnitIndex + 1)) return alert(`Sign Unit ${itUnitIndex + 1} before continuing.`);
      itUnitPhase = 'review';
      return renderItUnitStep();
    }
    if (itUnitPhase === 'review') {
      const ev = await evidenceRows(activeItPrep.id, 'it');
      const issues = itUnitIssues(currentItItem(), ev, itUnitIndex + 1);
      if (issues.length) {
        itUnitPhase = issues[0].phase;
        itQuestionIndex = issues[0].index || 0;
        return renderItUnitStep();
      }
      if (itUnitIndex < totalUnits - 1) {
        itUnitIndex++;
        itQuestionIndex = 0;
        itUnitPhase = 'type';
        itTypeChoice = '';
        itPurposeChoice = '';
        itReconRequired = 1;
      } else {
        itUnitIndex = totalUnits;
        itUnitPhase = 'final';
      }
      return renderItUnitStep();
    }
  }
  const issueLink = e.target.closest('[data-wl-issue-unit]');
  if (issueLink) {
    if (!activeItPrep) return;
    itUnitIndex = Number(issueLink.dataset.wlIssueUnit || 0);
    itUnitPhase = issueLink.dataset.wlIssuePhase || 'checks';
    itQuestionIndex = Number(issueLink.dataset.wlIssueIndex || 0);
    return renderItUnitStep();
  }
  if (e.target.closest('[data-wl-fix-issues]')) {
    if (!activeItPrep) return;
    const item = itItems()[itUnitIndex];
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const firstIssue = itUnitIssues(item, ev, itUnitIndex + 1)[0];
    if (!firstIssue) return renderItUnitStep();
    itUnitPhase = firstIssue.phase;
    itQuestionIndex = firstIssue.index || 0;
    return renderItUnitStep();
  }
  if (e.target.closest('[data-wl-it-prev]')) {
    const items = itItems();
    if (itUnitPhase === 'final') { itUnitIndex = Math.max(0, items.length - 1); itUnitPhase = 'review'; return renderItUnitStep(); }
    if (itUnitPhase === 'signature') { itUnitPhase = 'photo'; return renderItUnitStep(); }
    if (itUnitPhase === 'review') { itUnitPhase = 'signature'; return renderItUnitStep(); }
    if (itUnitPhase === 'photo') { itUnitPhase = 'checks'; itQuestionIndex = Math.max(0, itUnitStepsData(currentItItem(), itUnitIndex + 1).length - 1); return renderItUnitStep(); }
    if (itUnitPhase === 'checks') { if (itQuestionIndex > 0) { itQuestionIndex--; return renderItUnitStep(); } itUnitPhase = 'purpose'; itTypeChoice = currentItItem()?.equipment_type || ''; itPurposeChoice = currentItItem()?.purpose || ''; return renderItUnitStep(); }
    if (itUnitPhase === 'recon') { itUnitPhase = 'purpose'; return renderItUnitStep(); }
    if (itUnitPhase === 'purpose') { itUnitPhase = 'type'; return renderItUnitStep(); }
    if (itUnitPhase === 'type') { if (itUnitIndex === 0) return showPendingList(); itUnitIndex--; itUnitPhase = 'review'; return renderItUnitStep(); }
  }
  if (e.target.closest('[data-wl-send-it]')) { e.preventDefault(); e.stopPropagation(); await releaseItPrepUnitByUnit(); return; }
  const svc = e.target.closest('[data-wl-svc]'); if (svc) { if (svc.dataset.wlSvc === 'receive') showReceiveLookup(); if (svc.dataset.wlSvc === 'returns') showServiceReturnHistory(); if (svc.dataset.wlSvc === 'inspect') startInspection(); if (svc.dataset.wlSvc === 'history') showInspectionHistory(); return; }
  if (e.target.closest('[data-wl-match]')) return matchSvcTicket();
  const svcTicket = e.target.closest('[data-wl-svc-ticket]');
  if (svcTicket) { if (svcTicket.dataset.wlSvcTicket === 'wrong') { activeSvcPrep = null; return showReceiveLookup(); } return renderSvcPrep(); }
  const svcAnswer = e.target.closest('[data-wl-svc-answer]');
  if (svcAnswer) {
    const card = findSvcCard(activeSvcPrep.ticket_no);
    const q = svcQuestions(svcForms(card)[svcUnitIndex])[svcQuestionIndex];
    if (!q || q.kind !== 'bool') return;
    const yes = svcAnswer.dataset.wlSvcAnswer === 'yes';
    q.input.checked = yes;
    q.input.dataset.wlAnswered = '1';
    if (yes) return advanceSvcVerification();
    return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-svc-next]')) {
    const card = findSvcCard(activeSvcPrep.ticket_no);
    const forms = svcForms(card);
    const hasParts = ticketPartsTotal(activeSvcPrep) > 0;
    const solarCtx = await serviceSolarContextData(activeSvcPrep.id);
    const solarRequired = Boolean(solarCtx?.need_solar);
    const partStep = forms.length;
    const solarStep = forms.length + (hasParts ? 1 : 0);
    const proofStep = solarStep + (solarRequired ? 1 : 0);
    const photoStep = proofStep + 1;
    const signStep = proofStep + 2;
    if (svcUnitIndex < forms.length) return advanceSvcVerification();
    if (hasParts && svcUnitIndex === partStep && !activeSvcPrep.service_parts_confirmed) return alert('Physically verify the listed parts from IT before continuing.');
    if (solarRequired && svcUnitIndex === solarStep) {
      const check=await loadServiceSolarCheck(activeSvcPrep.id);
      const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
      if (!serviceSolarReady(solarCtx,check,evidence)) return alert('Finish the Solar / Helios checklist, required photos, and signatures before continuing.');
    }
    if (svcUnitIndex === photoStep) { const serviceEv = await evidenceRows(activeSvcPrep.id, 'service'); const itEv = await evidenceRows(activeSvcPrep.id, 'it'); const requiredPhotos = itEv.filter(x => x.kind === 'photo').length || forms.length; const servicePhotos = serviceEv.filter(x => x.kind === 'photo').length; if (servicePhotos !== requiredPhotos) return alert(`Service needs exactly ${requiredPhotos} receipt photo${requiredPhotos === 1 ? '' : 's'} to match IT. You currently have ${servicePhotos}.`); }
    if (svcUnitIndex === signStep) { const ev = await evidenceRows(activeSvcPrep.id, 'service'); if (!ev.some(x => x.kind === 'signature')) return alert('Save the Service signature before continuing.'); }
    svcUnitIndex++; return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-svc-prev]')) {
    const card = findSvcCard(activeSvcPrep.ticket_no);
    const forms = svcForms(card);
    const hasParts = ticketPartsTotal(activeSvcPrep) > 0;
    const partStep = forms.length;
    if (svcUnitIndex < forms.length) {
      if (svcQuestionIndex > 0) { svcQuestionIndex--; return renderSvcPrep(); }
      if (svcUnitIndex > 0) { svcUnitIndex--; svcQuestionIndex = Math.max(0, svcQuestions(forms[svcUnitIndex]).length - 1); return renderSvcPrep(); }
      return showReceiveLookup();
    }
    if (svcUnitIndex === partStep && forms.length) { svcUnitIndex--; svcQuestionIndex = Math.max(0, svcQuestions(forms[svcUnitIndex]).length - 1); return renderSvcPrep(); }
    svcUnitIndex = Math.max(0, svcUnitIndex - 1); return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-confirm-service-parts]')) {
    const { error } = await liveDb.rpc('confirm_service_parts', { p_prep_id: activeSvcPrep.id });
    if (error) return alert(error.message);
    activeSvcPrep = await getPrep(activeSvcPrep.id);
    return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-service-parts-mismatch]')) return alert('Do not accept the handoff. Compare the parts with IT and the MHelpDesk ticket, then correct the mismatch before continuing.');
  if (e.target.closest('[data-wl-save-service-solar]')) return saveServiceSolarChecklist();

  const solarUpload=e.target.closest('[data-wl-solar-upload]');
  if (solarUpload) {
    const panel=solarUpload.closest('.wl-solar-proof');
    const category=panel?.dataset.solarCategory;
    const files=[...(panel?.querySelector('.wl-solar-file')?.files || [])];
    if (!category || !files.length) return alert('Take or select at least one photo first.');
    solarUpload.disabled=true;
    solarUpload.textContent=files.length>1 ? `Saving ${files.length} photos…` : 'Saving photo…';
    try {
      for (const file of files) await uploadServiceSolarEvidence(activeSvcPrep.id,category,'photo',file);
      return renderSvcPrep();
    } catch (err) {
      solarUpload.disabled=false;
      solarUpload.textContent='Save Photo(s)';
      return alert(err.message || 'Could not save the Solar / Helios photo.');
    }
  }

  const solarClear=e.target.closest('[data-wl-solar-clear]');
  if (solarClear) {
    const canvas=solarClear.closest('.wl-sign')?.querySelector('canvas');
    if (canvas) { canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height); canvas.dataset.ink=''; }
    return;
  }

  const solarSign=e.target.closest('[data-wl-solar-save-sign]');
  if (solarSign) {
    const panel=solarSign.closest('.wl-solar-proof');
    const category=panel?.dataset.solarCategory;
    const canvas=panel?.querySelector('canvas');
    if (!category || !canvas?.dataset.ink) return alert('Sign in the box first.');
    try {
      const blob=await blobFromCanvas(canvas);
      await uploadServiceSolarEvidence(activeSvcPrep.id,category,'signature',blob);
      return renderSvcPrep();
    } catch (err) {
      return alert(err.message || 'Could not save the verification signature.');
    }
  }

  const solarReplace=e.target.closest('[data-wl-solar-replace-sign]');
  if (solarReplace) {
    const panel=solarReplace.closest('.wl-solar-proof');
    panel?.querySelector('.wl-saved')?.remove();
    solarReplace.remove();
    const d=document.createElement('div');
    d.className='wl-sign top8';
    d.innerHTML=`<b>Sign this verification with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-solar-clear>Clear</button><button class='wl-next' data-wl-solar-save-sign>Save Signature</button></div>`;
    panel?.append(d);
    wireCanvas(d.querySelector('canvas'));
    return;
  }

  if (e.target.closest('[data-wl-close-svc]')) { await window.closePreparedTicket(activeSvcPrep.id); setTimeout(showSvcHome, 300); return; }
  const upload = e.target.closest('[data-wl-upload]'); if (upload) { const panel = upload.closest('.wl-proof'); const input = panel.querySelector('.wl-file'); const files = [...(input.files || [])]; if (!files.length) return alert('Take or select at least one photo.'); const unitNo = Number(panel.dataset.unit || 0) || null; const itemId = panel.dataset.stage === 'it' && unitNo ? itItems()[unitNo - 1]?.id || null : null; const expected = Number(panel.dataset.expected || 0) || null; if (unitNo && files.length !== 1) return alert('Take exactly one photo for this item.'); if (panel.dataset.stage === 'service' && expected) { const existing = (await evidenceRows(panel.dataset.proof, 'service')).filter(x => x.kind === 'photo').length; if (existing + files.length > expected) return alert(`Service needs exactly ${expected} photos total. You already have ${existing}.`); } upload.disabled = true; upload.textContent = files.length > 1 ? `Preparing ${files.length} photos…` : 'Preparing photo…'; try { const optimized = await Promise.all(files.map(optimizeEvidencePhoto)); upload.textContent = files.length > 1 ? `Saving ${files.length} photos…` : 'Saving photo…'; await Promise.all(optimized.map((f, i) => { const original = f.name || files[i].name; const evidenceName = unitNo ? `unit-${unitNo}-photo-${original}` : original; return uploadEvidence(panel.dataset.proof, panel.dataset.stage, 'photo', f, evidenceName, itemId); })); if (panel.dataset.stage === 'it' && unitNo && activeItPrep) { activeItPrep = await getPrep(activeItPrep.id); return renderItUnitStep(); } await refreshProofPanel(panel); } catch (err) { upload.disabled = false; upload.textContent = 'Save Photo(s)'; alert(err.message || 'Upload failed.'); } return; }
  const clear = e.target.closest('[data-wl-clear]'); if (clear) { const c = clear.closest('.wl-sign').querySelector('canvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); c.dataset.ink = ''; return; }
  const save = e.target.closest('[data-wl-save-sign]'); if (save) { const panel = save.closest('.wl-proof'); const canvas = panel.querySelector('canvas'); if (!canvas?.dataset.ink) return alert('Sign in the box first.'); const blob = await blobFromCanvas(canvas); const unitNo = Number(panel.dataset.unit || 0) || null; const itemId = panel.dataset.stage === 'it' && unitNo ? itItems()[unitNo - 1]?.id || null : null; const signatureName = unitNo ? `unit-${unitNo}-signature.png` : 'signature.png'; await uploadEvidence(panel.dataset.proof, panel.dataset.stage, 'signature', blob, signatureName, itemId); if (panel.dataset.stage === 'it' && panel.dataset.mode === 'signature' && activeItPrep) return renderItUnitStep(); await refreshProofPanel(panel); return; }
  const replace = e.target.closest('[data-wl-replace]'); if (replace) { const panel = replace.closest('.wl-proof'); const saved = panel.querySelector('.wl-saved'); const btn = replace; saved?.remove(); btn.remove(); const d = document.createElement('div'); d.className = 'wl-sign top8'; d.innerHTML = `<b>Sign with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${panel.dataset.stage}'>Save Signature</button></div>`; panel.append(d); wireCanvas(d.querySelector('canvas')); return; }
  const ans = e.target.closest('[data-wl-answer]'); if (ans) { const val = ans.dataset.wlAnswer === 'pass'; if (inspection.step < 8) inspection.truck[inspection.step] = val; else if (inspection.takingTrailer === true && inspection.step < 16) inspection.trailer[inspection.step - 9] = val; if (val) inspection.step++; saveInspectionDraft(); return inspectionQuestion(); }
  const tr = e.target.closest('[data-wl-trailer]'); if (tr) { inspection.takingTrailer = tr.dataset.wlTrailer === 'yes'; inspection.step = inspection.takingTrailer ? 9 : 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-next]')) { if (inspection.step < 8 && inspection.truck[inspection.step] === null) return alert('Choose PASS or FAIL first.'); if (inspection.step === 8 && inspection.takingTrailer === null) return alert('Choose whether you are taking a trailer.'); if (inspection.takingTrailer === true && inspection.step >= 9 && inspection.step < 16 && inspection.trailer[inspection.step - 9] === null) return alert('Choose PASS or FAIL first.'); inspection.step++; if (inspection.step === 9 && inspection.takingTrailer === false) inspection.step = 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-prev]')) { if (inspection.step === 16 && inspection.takingTrailer === false) inspection.step = 8; else inspection.step = Math.max(0, inspection.step - 1); saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-submit-inspection]')) return submitInspection();
});
async function showServiceReturn() {
  const saved=await loadDeviceDraft('service-return');
  if (saved?.ticket) { serviceReturn={ step:Math.min(Number(saved.step||0),3), ticket:String(saved.ticket||''), unit:String(saved.unit||''), type:String(saved.type||''), notes:String(saved.notes||''), photo:null, conditionPhotos:[], damagePhotos:[], knownUnits:[] }; if (serviceReturn.ticket && serviceReturn.step>=1) serviceReturn.knownUnits=await rememberedUnitsForTicket(serviceReturn.ticket); serviceReturnRecovered=true; }
  else { serviceReturn={ step:0, ticket:'', unit:'', type:'', notes:'', photo:null, conditionPhotos:[], damagePhotos:[], knownUnits:[] }; serviceReturnRecovered=false; }
  return renderServiceReturn();
}
async function showServiceReturnPreset(ticket, unit, type) { const saved=await loadDeviceDraft('service-return'); if(saved?.ticket) return showServiceReturn(); serviceReturn={ step:3, ticket:String(ticket||''), unit:String(unit||''), type:String(type||''), notes:'', photo:null, conditionPhotos:[], damagePhotos:[], knownUnits:[] }; serviceReturnRecovered=false; await saveServiceReturnDraft(); return renderServiceReturn(); }
async function prepareReturnPreviewPhotos(files) {
  const prepared = [];
  for (const file of files) prepared.push(await optimizeEvidencePhoto(file));
  return prepared;
}
async function rememberedUnitsForTicket(ticket) {
  const { data, error } = await liveDb.from('prep_tickets').select('ticket_no,prep_items(unit_tag,equipment_type)').order('created_at', { ascending: false });
  if (error) return [];
  const prepUnits = (data || []).filter(p => norm(p.ticket_no) === norm(ticket)).flatMap(p => p.prep_items || []);
  const returns = (await returnRows()).filter(r => norm(r.ticket_no) === norm(ticket));
  const alreadyReturned = new Set(returns.map(r => norm(r.unit_tag)).filter(Boolean));
  const seen = new Set();
  return prepUnits.filter(item => {
    const tag = String(item.unit_tag || '').trim();
    const key = norm(tag);
    if (!tag || alreadyReturned.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function showServiceReturnHistory() {
  const tech = await currentTechIdentity();
  const rows = (await returnRows()).filter(r => r.service_tech_id === tech.id);
  serviceReturnRows = new Map(rows.map(r => [r.id, r]));
  let card = document.getElementById('wlSvcReturnHistory');
  if (!card) { card = document.createElement('div'); card.id = 'wlSvcReturnHistory'; card.className = 'card'; viewSvc().append(card); }
  const statusText = r => r.status === 'waiting_it' ? 'WAITING FOR IT INTAKE' : r.status === 'pending_mhelp_inventory' ? 'IT COMPLETE — PENDING MHELPDESK INVENTORY' : 'COMPLETED — BACK IN SHOP INVENTORY';
  const item = r => `<details class='ownerFold' data-svc-return='${r.id}'><summary><span><b>${esc(r.unit_tag)} · ${esc(r.equipment_type || 'Unit')}</b><span class='small ownerFoldHint'>MHelpDesk #${esc(r.ticket_no)}</span></span><span class='pill ${r.status === 'completed' ? 'delivery' : 'amber'}'>${statusText(r)}</span></summary><div class='ownerFoldBody'><div class='small'><b>Status:</b> ${statusText(r)}</div><div class='wl-return-gallery top8' data-svc-return-photos='${r.id}'><div class='wl-note'>Photos load when this return is opened.</div></div></div></details>`;
  const active = rows.filter(r => r.status !== 'completed');
  const completed = rows.filter(r => r.status === 'completed');
  card.innerHTML = `${progress('Returned Units', 'Your Service returns and IT intake status', 1, 1)}<button class='wl-back' data-wl-home='svc'>← Service Home</button><div class='ownerActiveLabel'>Still In Progress</div>${active.map(item).join('') || '<div class="ok"><b>✓ No returns waiting on IT or Manager.</b></div>'}<details class='ownerHistoryFold'><summary>Completed Return History <span class='pill'>${completed.length}</span></summary><div>${completed.map(item).join('') || '<div class="small">No completed returns yet.</div>'}</div></details>`;
  hideChildren(viewSvc(), [card]);
  resetWizardPosition();
}
function serviceReturnCard() {
  let card = document.getElementById('wlSvcReturn');
  if (!card) { card = document.createElement('div'); card.id = 'wlSvcReturn'; card.className = 'card'; viewSvc().append(card); }
  return card;
}
function renderServiceReturn() {
  const card = serviceReturnCard();
  const step = serviceReturn.step;
  if (step === 0) card.innerHTML = `${progress('Return Unit · Step 1 of 5', 'Enter the MHelpDesk ticket number', 1, 5)}<div class='wl-question'><div class='qtext'>What MHelpDesk ticket is this unit coming back from?</div><input id='wlReturnTicket' inputmode='numeric' value='${esc(serviceReturn.ticket)}' placeholder='Ticket #'></div><div class='wl-nav'><button class='wl-prev' data-wl-home='svc'>Back</button><button class='wl-next' data-wl-return-next>Next →</button></div>`;
  else if (step === 1) { const remembered = serviceReturn.knownUnits || []; const choices = remembered.map(item => `<button class='wl-unit-choice ${norm(serviceReturn.unit) === norm(item.unit_tag) ? 'on' : ''}' data-wl-return-unit='${esc(item.unit_tag)}' data-wl-return-type='${esc(item.equipment_type || '')}'><b>${esc(item.unit_tag)}</b><span>${esc(item.equipment_type || 'Known unit')} · remembered from MHelpDesk #${esc(serviceReturn.ticket)}</span></button>`).join(''); card.innerHTML = `${progress('Return Unit · Step 2 of 5', 'Choose the exact unit IT will receive', 2, 5)}<div class='wl-question'><div class='qtext'>Which unit is coming back from MHelpDesk #${esc(serviceReturn.ticket)}?</div>${choices ? `<div class='wl-note'>These units are already remembered from this ticket. Tap the unit coming back.</div><div class='wl-unit-choices'>${choices}</div><div class='wl-divider'>OR ENTER A UNIT TAG</div>` : `<div class='wl-note'>No remembered unit tags were found for this ticket yet. Enter the exact tag below.</div>`}<input id='wlReturnUnit' value='${esc(serviceReturn.unit)}' placeholder='Exact unit tag'></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next →</button></div>`; }
  else if (step === 2) { const options = [...CAMERA_UNIT_TYPES, ...STAND_POLE_TYPES].map(type => `<option value='${esc(type)}' ${serviceReturn.type === type ? 'selected' : ''}>${esc(type)}</option>`).join(''); card.innerHTML = `${progress('Return Unit · Step 3 of 5', 'Choose the equipment type', 3, 5)}<div class='wl-question'><div class='qtext'>What type of unit is ${esc(serviceReturn.unit)}?</div><select id='wlReturnType'><option value=''>Choose type…</option>${options}<option value='Other' ${serviceReturn.type === 'Other' ? 'selected' : ''}>Other</option></select></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next: Photo →</button></div>`; }
  else if (step === 3) card.innerHTML = `${progress('Return Unit · Step 4 of 5', `Photograph unit tag ${serviceReturn.unit}`, 4, 5)}<div class='wl-question'><div class='qtext'>Take a clear photo of the UNIT TAG showing ${esc(serviceReturn.unit)}.</div><div class='wl-stop'><b>Required photo proof</b><div>The tag number <b>${esc(serviceReturn.unit)}</b> must be readable in the picture. This photo will be saved to this exact returned unit and MHelpDesk #${esc(serviceReturn.ticket)}.</div></div><label class='wl-photo-button' for='wlReturnPhoto'>📷 TAKE / CHOOSE UNIT TAG PHOTO</label><input id='wlReturnPhoto' class='wl-photo-input' type='file' accept='image/*' capture='environment'><div id='wlReturnPhotoPreview' class='wl-return-preview ${serviceReturn.photo ? '' : 'hidden'}'>${serviceReturn.photo ? `<img src='${URL.createObjectURL(serviceReturn.photo)}' alt='Selected unit tag photo'><div class='ok'><b>✓ Photo selected for unit ${esc(serviceReturn.unit)}</b><div>Confirm ${esc(serviceReturn.unit)} is readable before continuing.</div></div>` : ''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next: Review →</button></div>`;
  else { const conditionPreview = (serviceReturn.conditionPhotos || []).map(file => `<img src='${URL.createObjectURL(file)}' alt='Site condition photo'>`).join(''); const damagePreview = (serviceReturn.damagePhotos || []).map(file => `<img src='${URL.createObjectURL(file)}' alt='Damage photo'>`).join(''); card.innerHTML = `${progress('Return Unit · Step 5 of 5', 'Document how the unit looked at the site', 5, 5)}<div class='wl-review'><b>${esc(serviceReturn.unit)} · ${esc(serviceReturn.type)}</b><div><b>MHelpDesk #${esc(serviceReturn.ticket)}</b></div><div>📷 Unit tag photo ready</div><div class='small top8'>Add photos showing the camera/unit as it looked at the site. If there is damage, add close-up damage photos and describe it below. IT Intake will see all of this before checking the unit.</div></div><div class='wl-question top10'><div class='qtext'>Site condition photos</div><div class='wl-note'>Take pictures showing the overall camera/unit condition before it leaves the site. Add as many as needed to verify it still looks good.</div><label class='wl-photo-button' for='wlReturnConditionPhotos'>📷 ADD SITE CONDITION PHOTOS</label><input id='wlReturnConditionPhotos' class='wl-photo-input' type='file' accept='image/*' capture='environment' multiple><div class='wl-return-preview ${conditionPreview ? '' : 'hidden'}'><div class='wl-return-gallery'>${conditionPreview}</div><div class='ok'>✓ ${(serviceReturn.conditionPhotos || []).length} site condition photo${(serviceReturn.conditionPhotos || []).length === 1 ? '' : 's'} selected</div></div></div><div class='wl-question top10'><div class='qtext'>Damage photos, if damage is found</div><div class='wl-note'>Take close-up pictures of scratches, broken parts, dents, missing pieces, camera damage, or anything else IT needs to inspect.</div><label class='wl-photo-button wl-damage-photo' for='wlReturnDamagePhotos'>⚠️ ADD DAMAGE PHOTOS</label><input id='wlReturnDamagePhotos' class='wl-photo-input' type='file' accept='image/*' capture='environment' multiple><div class='wl-return-preview ${damagePreview ? '' : 'hidden'}'><div class='wl-return-gallery'>${damagePreview}</div><div class='warn'>⚠ ${(serviceReturn.damagePhotos || []).length} damage photo${(serviceReturn.damagePhotos || []).length === 1 ? '' : 's'} selected — describe the damage below.</div></div></div><label>Return notes / damage noticed</label><textarea id='wlReturnNotes' rows='5' placeholder='Describe damage, missing parts, site condition, reason for return, or other notes'>${esc(serviceReturn.notes)}</textarea><div class='ok top10'><b>✓ SERVICE RETURN READY</b><div>All photos and these notes will follow unit ${esc(serviceReturn.unit)} into IT Intake.</div></div><button class='wl-big wl-red top10' data-wl-return-submit>SEND THIS UNIT TO IT INTAKE →</button><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><span></span></div>`; }
  if (serviceReturnRecovered && !card.querySelector('.wl-draft-recovered')) card.insertAdjacentHTML('afterbegin', `<div class='warn wl-draft-recovered'><b>Recovered unsent Service Return from this device.</b><div class='small'>Ticket, unit, equipment type, and notes were restored. Photos are never treated as saved until they upload successfully, so reselect/retake the required photo if Safari reloaded.</div></div>`);
  hideChildren(viewSvc(), [card]);
  resetWizardPosition();
}
async function serviceReturnNext() {
  if (serviceReturn.step === 0) { const value = document.getElementById('wlReturnTicket')?.value.trim() || ''; if (!value) return alert('Enter the MHelpDesk ticket number first.'); serviceReturn.ticket = value; serviceReturn.knownUnits = await rememberedUnitsForTicket(value); }
  else if (serviceReturn.step === 1) { const value = document.getElementById('wlReturnUnit')?.value.trim() || serviceReturn.unit || ''; if (!value) return alert('Choose or enter the exact unit tag / unit number first.'); serviceReturn.unit = value; const known = (serviceReturn.knownUnits || []).find(item => norm(item.unit_tag) === norm(value)); if (known?.equipment_type) serviceReturn.type = known.equipment_type; }
  else if (serviceReturn.step === 2) { const value = document.getElementById('wlReturnType')?.value || ''; if (!value) return alert('Choose the equipment type first.'); serviceReturn.type = value; }
  else if (serviceReturn.step === 3) { const file = document.getElementById('wlReturnPhoto')?.files?.[0]; if (!file && !serviceReturn.photo) return alert(`Take or choose a clear photo of the unit tag showing ${serviceReturn.unit} first.`); if (file) serviceReturn.photo = file; if (!confirm(`Can you clearly read unit tag ${serviceReturn.unit} in this photo?`)) return; }
  serviceReturn.step = Math.min(4, serviceReturn.step + 1);
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
async function submitServiceReturn() {
  if (serviceReturnSubmitting) return;
  serviceReturn.notes = document.getElementById('wlReturnNotes')?.value || serviceReturn.notes || '';
  await saveServiceReturnDraft();
  if (!serviceReturn.ticket || !serviceReturn.unit || !serviceReturn.type || !serviceReturn.photo) return alert('Ticket, unit, equipment type, and unit tag photo are required.');
  if ((serviceReturn.damagePhotos || []).length && !serviceReturn.notes.trim()) return alert('Damage photos were added. Describe what is damaged in Return notes / damage noticed so IT knows what to inspect.');
  if (!navigator.onLine) return alert('No connection. This return is saved as an unsent draft on this device. Reconnect before sending it to IT Intake.');
  serviceReturnSubmitting=true; document.body.classList.add('busy');
  let uploadedPaths=[];
  try {
    const tech=await currentTechIdentity();
    const existingReturns=(await returnRows()).filter(r => norm(r.ticket_no)===norm(serviceReturn.ticket) && norm(r.unit_tag)===norm(serviceReturn.unit));
    if (existingReturns.length) return alert(`Unit ${serviceReturn.unit} has already been sent to IT Intake for MHelpDesk #${serviceReturn.ticket}. It cannot be returned again from this ticket.`);
    const returnId=crypto.randomUUID();
    const safeUnit=String(serviceReturn.unit).replace(/[^a-zA-Z0-9._-]/g,'_');
    const taggedPhoto=new File([serviceReturn.photo],`unit-${safeUnit}-tag-${serviceReturn.photo.name || 'photo.jpg'}`,{type:serviceReturn.photo.type || 'image/jpeg'});
    const conditionPhotos=(serviceReturn.conditionPhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-site-condition-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    const damagePhotos=(serviceReturn.damagePhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-DAMAGE-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    uploadedPaths=await uploadReturnPhotos([taggedPhoto,...conditionPhotos,...damagePhotos],returnId,`service/unit-${safeUnit}`);
    const { error }=await liveDb.from('unit_returns').insert({ id:returnId, ticket_no:serviceReturn.ticket, unit_tag:serviceReturn.unit, equipment_type:serviceReturn.type, service_tech_id:tech.id, service_tech_name:tech.name, return_notes:serviceReturn.notes, return_photo_paths:uploadedPaths });
    if (error) throw error;
    await clearDeviceDraft('service-return'); serviceReturnRecovered=false;
    const card=serviceReturnCard();
    card.innerHTML=`${progress('Return Submitted', `${serviceReturn.unit} is waiting for IT`, 1, 1)}<div class='ok'><b>✓ Unit ${esc(serviceReturn.unit)} sent to IT Intake.</b><div>The unit tag photo, ${(serviceReturn.conditionPhotos || []).length} site condition photo${(serviceReturn.conditionPhotos || []).length === 1 ? '' : 's'}, ${(serviceReturn.damagePhotos || []).length} damage photo${(serviceReturn.damagePhotos || []).length === 1 ? '' : 's'}, and Service notes are saved with ${esc(serviceReturn.unit)} under MHelpDesk #${esc(serviceReturn.ticket)}. IT will see them during intake.</div></div><button class='wl-big wl-red top10' data-wl-service-return>＋ Add Another Returned Unit</button><button class='wl-back top10' data-wl-home='svc'>Service Home</button>`;
    resetWizardPosition();
  } catch(err) {
    if (uploadedPaths.length) await liveDb.storage.from(EVIDENCE_BUCKET).remove(uploadedPaths).catch(() => null);
    await saveServiceReturnDraft();
    alert(err?.message === 'Failed to fetch' ? 'Connection lost. Nothing was marked submitted. Your return details are still saved on this device; reconnect and try again.' : (err?.message || 'Could not submit the return. Nothing was marked submitted.'));
  } finally { serviceReturnSubmitting=false; document.body.classList.remove('busy'); }
}
function installTabs() {
  const it = document.getElementById('tab-it'); const svc = document.getElementById('tab-svc');
  if (it && !it.dataset.wl) { it.dataset.wl = '1'; it.addEventListener('click', () => setTimeout(showITHome, 80)); }
  if (svc && !svc.dataset.wl) { svc.dataset.wl = '1'; svc.addEventListener('click', () => setTimeout(showSvcHome, 80)); }
}
function wrapCreatePrep() {
  if (createPrepWrapped || typeof window.createPrep !== 'function') return;
  createPrepWrapped = true;
  const original = window.createPrep;
  window.createPrep = async function(...args) {
    const ticket = document.getElementById('itTicket')?.value.trim() || '';
    await original(...args);
    if (!ticket || document.getElementById('itCreateMessage')?.querySelector('.bad')) return;
    const { data } = await liveDb.from('prep_tickets').select('id,ticket_no,status,created_at').eq('status', 'draft').order('created_at', { ascending: false });
    const prep = (data || []).find(p => norm(p.ticket_no) === norm(ticket));
    if (!prep) return;
    await new Promise(r => setTimeout(r, 180));
    await showItPrep(prep.id);
  };
}

function assignmentNeedsServiceSolar(a, prep) {
  if (a?.assigned_role !== 'service') return false;
  const workType=String(a?.work_type || prep?.work_type || '').toLowerCase();
  if (workType && workType !== 'delivery') return false;
  const rows=[...normalizedEquipmentManifest(a?.equipment_manifest),...normalizedEquipmentManifest(prep?.equipment_manifest)];
  return rows.some(row => ['Solar Spotter','Ranger','Solar Stand','Solar Pole','Helios'].includes(row.label) && row.qty > 0);
}
function ownerAssignmentProgress(a, prep, solarCheck=null) {
  const roleLabel = a.assigned_role === 'it' ? 'IT' : 'SERVICE';
  if (a.status === 'completed') return { step:5, label:'DONE', detail: roleLabel + ' task completed' };
  if (workType === 'pickup' && a.assigned_role === 'it' && a.requires_it_handoff && !prep) return { step:1, label:'WAITING FOR SERVICE CHECK-IN', detail:'Service checks the pickup in first; IT Intake starts after Service returns the unit' };
  if (!a.assignee_user_id && a.assignment_scope === 'department') return { step:1, label:'WAITING FOR ' + roleLabel + ' TECH', detail:'Sent to the ' + (a.assigned_role === 'it' ? 'IT Department' : 'Service Department') + ' queue' };
  if (a.status === 'assigned') return { step:1, label:'SENT', detail:'Waiting for ' + a.assignee_name + ' to start' };
  if (prep?.status === 'closed') return { step:5, label:'DONE', detail:'Equipment accepted by Service / deployed' };
  if (a.assigned_role === 'service' && prep?.status === 'released' && assignmentNeedsServiceSolar(a,prep)) {
    return solarCheck?.completed_at
      ? { step:4, label:'SOLAR CHECKOUT VERIFIED', detail:'Automatic Solar Spotter / Ranger / Helios Service checkout completed' }
      : { step:3, label:'SOLAR CHECKOUT IN PROGRESS', detail:(a.assignee_name || 'Service Tech') + ' is verifying automatic stands, batteries, panels, MPPT/charging readings, and Cerbo when applicable' };
  }
  if (prep?.status === 'released') return { step:4, label:'READY FOR SERVICE', detail:'Handoff created by IT' };
  if (prep?.status === 'draft') return { step:3, label:'TECH CHECK IN PROGRESS', detail:'Equipment prep is active' };
  return { step:2, label:'CLAIMED / IN PROCESS', detail:a.assignee_name + ' started the task' };
}
function ownerAssignmentRowHtml(a, prep, solarCheck=null) {
  const p = ownerAssignmentProgress(a, prep, solarCheck);
  const pct = Math.max(8, Math.min(100, p.step / 5 * 100));
  return `<div class='wl-assignment-row'><div class='wl-assignment-main'><div class='row'><b>MHelpDesk Ref #${esc(a.ticket_no)}</b><span class='pill'>${a.assigned_role === 'it' ? 'IT' : 'SERVICE'}</span></div><div class='wl-live-stage'><b>${esc(p.label)}</b><span>${esc(p.detail)}</span><div class='wl-live-track'><i style='width:${pct}%'></i></div></div><div class='small'><b>${a.assignee_user_id ? 'Assigned to:' : 'Queue:'}</b> ${esc(a.assignee_name)}</div>${a.site ? `<div class='small'><b>Customer / Site:</b> ${esc(a.site)}</div>` : ''}${a.work_type ? `<div class='small'><b>Job Type:</b> ${esc(a.work_type.toUpperCase())}</div>` : ''}${a.scheduled_for ? `<div class='small'><b>Work Date:</b> ${new Date(a.scheduled_for + 'T12:00:00').toLocaleDateString()}</div>` : ''}${a.requested_unit_count != null ? `<div class='small'><b>${String(a.work_type || '').toLowerCase() === 'pickup' ? 'Units Being Picked Up' : 'Units Required'}:</b> ${Number(a.requested_unit_count)}</div>` : ''}${a.unit_summary ? `<div class='small'><b>Unit / Equipment Notes:</b> ${esc(a.unit_summary)}</div>` : ''}${a.job_description ? `<div class='small'><b>Work Description:</b> ${esc(a.job_description)}</div>` : ''}${equipmentManifestInlineHtml(a)}${ticketPartsInlineHtml(a)}${automaticServiceSolarPlanHtml(a.equipment_manifest,a.work_type)}${a.notes ? `<div class='small'><b>Owner Notes:</b> ${esc(a.notes)}</div>` : ''}</div>${a.status === 'completed' ? '' : `<button class='mini danger' data-wl-cancel-assignment='${a.id}'>Cancel</button>`}</div>`;
}
function ownerAssignmentTechOptions(role) {
  const department = role === 'it' ? 'IT Department Queue' : 'Service Department Queue';
  return `<option value=''>${department} — any ${role === 'it' ? 'IT Tech' : 'Service Tech'} can claim</option>` + ownerAssignmentProfiles.filter(p => p.role === role).map(p => `<option value='${p.user_id}'>${esc(p.full_name || p.username || 'Technician')}</option>`).join('');
}
async function installOwnerAssignments(force = false) {
  if (!roleText().includes('Owner/Admin')) return;
  let host = document.getElementById('ownerJobAssignments');
  if (host && host.dataset.loaded === '1' && !force) return;
  if (!host) {
    host = document.createElement('details');
    host.id = 'ownerJobAssignments';
    host.className = 'card ownerDashSection ownerDispatchCard';
    const view = document.getElementById('view-owner');
    view?.prepend(host);
  }

  let liveHost = document.getElementById('ownerLiveJobProgress');
  if (!liveHost) {
    liveHost = document.createElement('details');
    liveHost.id = 'ownerLiveJobProgress';
    liveHost.className = 'card ownerDashSection ownerLiveJobsCard';
    host.insertAdjacentElement('afterend', liveHost);
  }

  const wasOpen = host.open;
  const liveWasOpen = liveHost.open;
  host.dataset.loaded = '1';

  const [{ data: profiles }, { data: assignments }, { data: preps }, { data: assets }, { data: solarChecks }] = await Promise.all([
    liveDb.from('profiles').select('user_id,full_name,username,role,active,archived_at').eq('active', true).is('archived_at', null).in('role', ['it','service']).order('full_name'),
    liveDb.from('job_assignments').select('*').in('status', ['assigned','started','completed']).order('assigned_at', { ascending: false }).limit(50),
    liveDb.from('prep_tickets').select('id,ticket_no,status,work_type,equipment_manifest,released_by_name,released_at,closed_by_name,closed_at').order('created_at', { ascending:false }).limit(100),
    liveDb.from('asset_inventory').select('unit_tag,asset_type,asset_category,availability_status').neq('availability_status','retired').order('asset_type'),
    liveDb.from('service_solar_checks').select('prep_ticket_id,service_tech_name,completed_at,updated_at').order('updated_at',{ascending:false}).limit(100),
  ]);
  ownerAssignmentProfiles = profiles || [];
  ownerAssignmentAssets = assets || [];
  const all = assignments || [];
  const prepMap = new Map((preps || []).map(p => [p.id,p]));
  const solarCheckMap = new Map((solarChecks || []).map(row => [row.prep_ticket_id,row]));
  const now = Date.now();
  const active = all.filter(a => a.status !== 'completed');
  const completed = all.filter(a => a.status === 'completed' && now - new Date(a.completed_at || a.updated_at || a.assigned_at).getTime() < 24*60*60*1000);

  const assignedWaiting = active.filter(a => {
    const p = ownerAssignmentProgress(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id));
    return p.step <= 1;
  });
  const inProgress = active.filter(a => {
    const p = ownerAssignmentProgress(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id));
    return p.step >= 2 && p.step < 5;
  });

  const itCount = active.filter(a => a.assigned_role === 'it').length;
  const svcCount = active.filter(a => a.assigned_role === 'service').length;
  const assignedRows = assignedWaiting.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');
  const progressRows = inProgress.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');
  const doneRows = completed.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');

  host.innerHTML = `
    <summary class='ownerDashSummary'>
      <div><b>Create / Assign Job</b><span>Create a new Tech Check assignment from the current MHelpDesk ticket</span></div>
      <span class='ownerDashBadge neutral'>＋</span>
    </summary>
    <div class='ownerDashBody'>
      <div class='warn manualReferenceNotice'>
        <b>MHelpDesk is separate from Tech Check.</b>
        <div class='small'>Use the current MHelpDesk ticket as the source of truth every time. Enter the MHelpDesk reference, unit count, equipment, and work exactly as shown there. A new MHelpDesk ticket stays a new Tech Check job; unit history remains universal inside Tech Check.</div>
      </div>
      <div class='grid top10'>
        <div><label>MHelpDesk Reference #</label><input id='ownerAssignTicket' inputmode='numeric' placeholder='Reference / ticket #'></div>
        <div><label>Customer / Site</label><input id='ownerAssignSite' placeholder='Customer or site'></div>
      </div>
      <div class='grid top10'>
        <div><label><span id='ownerAssignUnitCountLabel'>Units Required</span> <span class='small'>(from MHelpDesk)</span></label><input id='ownerAssignUnitCount' type='number' inputmode='numeric' min='0' step='1' placeholder='Example: 2'></div>
        <div><label>Job Description</label><input id='ownerAssignDescription' placeholder='What needs to be done?'></div>
      </div>
      <div class='top10'><label>Specific Unit / Equipment Notes <span class='small'>(optional)</span></label><input id='ownerAssignUnits' placeholder='Example: Use spare Unit 058, or pick up Unit 103'></div>
      <div id='ownerAssignParts' class='wl-ticket-parts-setup top10'>
        <div class='qtext'>Parts Required From This Ticket</div>
        <div class='small'>Choose the exact units/devices and any manual stand/part requirements from the MHelpDesk ticket. DELIVERY jobs automatically create the Service-side Solar Spotter/Ranger checkout requirements shown below.</div>
        ${ownerEquipmentManifestInputsHtml()}
        <div id='ownerAutoServicePlan' class='hidden'></div>
        <div class='wl-requirement-section'><div class='wl-requirement-heading'>Parts / Supplies</div>${ticketPartsInputsHtml('ownerPart')}</div>
      </div>
      <div class='grid top10'>
        <div><label>Job Type</label><select id='ownerAssignWorkType'><option value='delivery'>Delivery</option><option value='swap'>Swap</option><option value='service' selected>Service</option><option value='pickup'>Pickup</option></select></div>
        <div><label>Work Date</label><input id='ownerAssignDate' type='date' value='${techCheckDateKey(new Date())}'></div>
      </div>
      <div class='grid top10'>
        <div><label>Send Ticket To</label><select id='ownerAssignRole'><option value='it'>IT Department Only</option><option value='service'>Service Department Only</option><option value='both'>IT + Service Departments</option></select></div>
        <div><label>Technicians</label><div id='ownerAssignedTechPills' class='wl-tech-pills'></div><div class='wl-tech-add-row'><select id='ownerAssignTech'>${ownerAssignmentTechOptions('it')}</select><button type='button' class='btn' id='ownerAddTech'>＋ Add Tech</button></div><div id='ownerAssignTechHint' class='small'>Add one or more IT technicians. If you add nobody, it goes to the IT Department queue.</div></div>
      </div>
      <label class='top10'>Owner Notes <span class='small'>(optional)</span></label>
      <input id='ownerAssignNotes' placeholder='Anything else the tech should know'>
      <button class='btn ownerDispatchButton' data-wl-owner-assign>Send Tech Check Job</button>
    </div>`;

  liveHost.innerHTML = `
    <summary class='ownerDashSummary'>
      <div><b>Live Job Progress</b><span>See what is assigned, who has it, and what is currently being worked</span></div>
      <span id='ownerAssignmentBadge' class='ownerDashBadge ${active.length ? 'alert' : 'neutral'}'>${active.length}</span>
    </summary>
    <div class='ownerDashBody'>
      <div class='ownerDispatchSummary ownerLiveSummary'>
        <span><b>${assignedWaiting.length}</b> assigned / waiting</span>
        <span><b>${inProgress.length}</b> in progress</span>
        <span><b>${itCount}</b> IT</span>
        <span><b>${svcCount}</b> Service</span>
      </div>

      <div class='ownerJobStatusSection assigned'>
        <div class='ownerActiveLabel'>Assigned / Waiting to Start</div>
        <div id='ownerAssignedWaitingList'>${assignedRows || "<div class='ok'><b>✓ No jobs waiting to start.</b></div>"}</div>
      </div>

      <div class='ownerJobStatusSection progress'>
        <div class='ownerActiveLabel'>In Progress</div>
        <div id='ownerInProgressList'>${progressRows || "<div class='ok'><b>✓ No jobs currently in progress.</b></div>"}</div>
      </div>

      ${doneRows ? `<details class='ownerHistoryFold'><summary>Completed in the last 24 hours <span class='pill'>${completed.length}</span></summary><div>${doneRows}</div></details>` : ''}
    </div>`;

  host.open = wasOpen;
  liveHost.open = liveWasOpen || active.length > 0;
  refreshOwnerAutoServicePlan();
  refreshOwnerWorkTypeLabels();
}
function addOwnerTechPill() {
  const select=document.getElementById('ownerAssignTech'); const pills=document.getElementById('ownerAssignedTechPills');
  const id=select?.value || ''; if (!id || !pills) return;
  if (pills.querySelector(`[data-tech-id="${CSS.escape(id)}"]`)) { select.value=''; return; }
  const label=select.options[select.selectedIndex]?.textContent?.trim() || 'Technician';
  const pill=document.createElement('span'); pill.className='wl-tech-pill'; pill.dataset.techId=id;
  pill.innerHTML=`<span>${esc(label)}</span><button type="button" data-remove-tech aria-label="Remove ${esc(label)}">×</button>`;
  pills.appendChild(pill); select.value='';
}
function refreshOwnerAssignmentTechOptions() {
  const role = document.getElementById('ownerAssignRole')?.value || 'it';
  const select = document.getElementById('ownerAssignTech');
  const hint = document.getElementById('ownerAssignTechHint');
  if (!select) return;
  const pills = document.getElementById('ownerAssignedTechPills');
  if (pills) pills.innerHTML = '';
  if (role === 'both') {
    select.innerHTML = `<option value=''>Both Department Queues</option>`;
    select.disabled = true;
    const add = document.getElementById('ownerAddTech'); if (add) add.disabled = true;
    if (hint) { const wt=document.getElementById('ownerAssignWorkType')?.value || 'service'; hint.textContent = wt === 'pickup' ? 'Pickup order: Service checks the equipment back in first → actual units go to IT Intake → IT checks the units into shop inventory.' : 'Delivery / Swap order: IT prepares first → creates the handoff → Service verifies and takes the equipment.'; }
  } else {
    select.disabled = false;
    select.innerHTML = ownerAssignmentTechOptions(role);
    const add = document.getElementById('ownerAddTech'); if (add) add.disabled = false;
    if (hint) hint.textContent = `Add one or more ${role === 'it' ? 'IT' : 'Service'} technicians. If you add nobody, it goes to the ${role === 'it' ? 'IT' : 'Service'} Department queue.`;
  }
  document.getElementById('ownerAssignParts')?.classList.remove('hidden');
  refreshOwnerWorkTypeLabels();
}
function refreshOwnerWorkTypeLabels() {
  const type = document.getElementById('ownerAssignWorkType')?.value || 'service';
  const pickup = type === 'pickup';
  const swap = type === 'swap';
  const delivery = type === 'delivery';
  const action = pickup ? 'Being Picked Up' : swap ? 'Being Swapped' : delivery ? 'Being Delivered' : 'Required';
  const countLabel = document.getElementById('ownerAssignUnitCountLabel');
  if (countLabel) countLabel.textContent = `Units ${action}`;
  const unitHeading = document.querySelector('#ownerAssignParts .unitArea .wl-requirement-heading');
  if (unitHeading) unitHeading.textContent = `UNIT AREA — Units / Devices ${action}`;
  const unitHelp = document.querySelector('#ownerAssignParts .unitArea .small');
  if (unitHelp) unitHelp.textContent = pickup
    ? 'Enter the unit types and quantities being PICKED UP from the customer/site. These are coming back to the shop — they are not shelf inventory.'
    : swap
      ? 'Enter the replacement units going out for the SWAP. Use the stand area below for any solar stands, poles, or panels involved in the swap.'
      : delivery
        ? 'Enter the unit types and quantities being DELIVERED. Use the stand area below for solar stands, poles, or panels being delivered.'
        : 'Choose the unit types and quantities that match the MHelpDesk ticket.';
  const standHeading = document.querySelector('#ownerAssignParts .standArea .wl-requirement-heading');
  if (standHeading) standHeading.textContent = pickup
    ? 'STAND AREA — Solar Stands / Poles / Panels Being Picked Up'
    : swap
      ? 'STAND AREA — Solar Stands / Poles / Panels Being Swapped'
      : delivery
        ? 'STAND AREA — Solar Stands / Poles / Panels Being Delivered'
        : 'STAND AREA — Manual Stand Requirements';
  const standHelp = document.querySelector('#ownerAssignParts .standArea .small');
  if (standHelp) standHelp.textContent = pickup
    ? 'Enter the solar stands, poles, and removable solar panels being PICKED UP and returned to the shop.'
    : swap
      ? 'Enter the solar stands, poles, and removable solar panels being SWAPPED. This is separate from the unit/device count above.'
      : delivery
        ? 'Enter any solar stands, poles, and removable solar panels being DELIVERED. Automatic Solar Spotter/Ranger requirements still apply.'
        : 'Use this only when the MHelpDesk job specifically calls for a stand as part of IT prep.';
  document.querySelectorAll('#ownerAssignParts [data-owner-stock-count]').forEach(el => {
    el.style.display = pickup ? 'none' : '';
  });
}
async function ownerAssignJob() {
  const ticket = document.getElementById('ownerAssignTicket')?.value.trim() || '';
  const site = document.getElementById('ownerAssignSite')?.value.trim() || '';
  const units = document.getElementById('ownerAssignUnits')?.value.trim() || '';
  const requestedUnitCountRaw = document.getElementById('ownerAssignUnitCount')?.value;
  const requestedUnitCount = requestedUnitCountRaw === '' || requestedUnitCountRaw == null ? null : Math.max(0, Math.floor(Number(requestedUnitCountRaw || 0)));
  const description = document.getElementById('ownerAssignDescription')?.value.trim() || '';
  const role = document.getElementById('ownerAssignRole')?.value || 'it';
  const techSelect = document.getElementById('ownerAssignTech');
  const assignees = role === 'both' ? [] : [...document.querySelectorAll('#ownerAssignedTechPills [data-tech-id]')].map(el => el.dataset.techId).filter(Boolean);
  const assignee = assignees[0] || null;
  const notes = document.getElementById('ownerAssignNotes')?.value.trim() || '';
  const scheduledFor = document.getElementById('ownerAssignDate')?.value || techCheckDateKey(new Date());
  const workType = document.getElementById('ownerAssignWorkType')?.value || 'service';
  const equipmentManifest = readOwnerEquipmentManifest();
  const parts = readTicketPartInputs('ownerPart');
  if (!ticket) return alert('Enter the MHelpDesk reference number.');
  if (requestedUnitCount === null) return alert('Enter how many units are listed on the MHelpDesk ticket. Use 0 if this job has no unit/device.');
  const selectedDeviceCount = equipmentManifestDeviceTotal(equipmentManifest);
  const selectedStandCount = equipmentManifestStandTotal(equipmentManifest);
  if (selectedDeviceCount > 0 && selectedDeviceCount !== requestedUnitCount) return alert('The MHelpDesk unit count is ' + requestedUnitCount + ', but the Unit Area adds up to ' + selectedDeviceCount + '. Make them match before sending the job.');
  if ((role === 'it' || role === 'both') && selectedDeviceCount + selectedStandCount < 1) return alert('Choose at least one unit/device or stand in the Equipment & Parts area before sending this job to IT.');
  const autoSolarPlan=automaticServiceSolarPlan(equipmentManifest,workType);
  if (autoSolarPlan.spotters > 0 && manifestQty(equipmentManifest,'Solar Stand') > 0) return alert('Remove Solar Stand from the IT Stand Area. A Delivery with Solar Spotter automatically assigns the Solar Stand to the Service checkout after IT releases the Solar Spotter.');
  if (!description) return alert('Enter a short job description so the technician knows what needs to be done.');

  document.body.classList.add('busy');
  const targets = role === 'both'
    ? (workType === 'pickup' ? [{ role:'service', assignee:null }, { role:'it', assignee:null }] : [{ role:'it', assignee:null }, { role:'service', assignee:null }])
    : (assignees.length ? assignees.map(id => ({ role, assignee:id })) : [{ role, assignee:null }]);
  const rolesToSend = targets.map(t => t.role);
  const assignmentIds = [];
  for (const target of targets) {
    const targetRole = target.role;
    const { data: assignmentId, error } = await liveDb.rpc('owner_assign_job_v8', {
      p_ticket_no: ticket,
      p_site: site,
      p_assigned_role: targetRole,
      p_assignee_user_id: target.assignee,
      p_requested_unit_count: requestedUnitCount,
      p_unit_summary: units,
      p_job_description: description,
      p_notes: notes,
      p_solar_panel_qty: parts.solar_panel_qty,
      p_battery_replacement_qty: parts.battery_replacement_qty,
      p_camera_replacement_qty: parts.camera_replacement_qty,
      p_sim_replacement_qty: parts.sim_replacement_qty,
      p_micro_sd_qty: parts.micro_sd_qty,
      p_equipment_manifest: equipmentManifest,
      p_requires_it_handoff: workType === 'pickup' ? (targetRole === 'it' && rolesToSend.includes('service')) : (targetRole === 'service' && rolesToSend.includes('it')),
      p_scheduled_for: scheduledFor,
      p_work_type: workType,
    });
    if (error) { document.body.classList.remove('busy'); return alert(error.message); }
    if (assignmentId) assignmentIds.push(assignmentId);
  }
  document.body.classList.remove('busy');

  let pushMessage = '';
  let pushed = 0;
  for (const assignmentId of assignmentIds) {
    try {
      const { data: pushResult, error: pushError } = await liveDb.functions.invoke('send-techcheck-push', { body: { assignment_id: assignmentId } });
      if (pushError) throw pushError;
      pushed += Number(pushResult?.sent || 0);
    } catch (pushError) {
      console.warn('Assignment saved but phone push could not be sent', pushError);
    }
  }
  pushMessage = pushed > 0 ? ` Phone notifications sent to ${pushed} device${pushed === 1 ? '' : 's'}.` : ' Tech Check inbox alert created.';

  ['ownerAssignTicket','ownerAssignSite','ownerAssignUnitCount','ownerAssignUnits','ownerAssignDescription','ownerAssignNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const dateInput=document.getElementById('ownerAssignDate'); if (dateInput) dateInput.value=techCheckDateKey(new Date());
  const workTypeInput=document.getElementById('ownerAssignWorkType'); if (workTypeInput) workTypeInput.value='service';
  fillTicketPartInputs({}, 'ownerPart');
  document.querySelectorAll('#ownerJobAssignments [data-owner-equipment-qty]').forEach(input => { input.value='0'; });
  await installOwnerAssignments(true);
  const target = role === 'both' ? 'both the IT and Service Department queues' : assignees.length > 1 ? `${assignees.length} selected technicians` : assignees.length === 1 ? 'the selected technician' : (role === 'it' ? 'the IT Department queue' : 'the Service Department queue');
  alert('Sent to ' + target + ' in Tech Check.' + pushMessage + ' MHelpDesk remains unchanged.');
}
async function saveActivePrepParts() {
  if (!activeItPrep?.id) return;
  const parts = readTicketPartInputs('wlEditPart');
  document.body.classList.add('busy');
  const { error } = await liveDb.rpc('set_prep_parts', {
    p_prep_id: activeItPrep.id,
    p_solar_panel_qty: parts.solar_panel_qty,
    p_battery_replacement_qty: parts.battery_replacement_qty,
    p_camera_replacement_qty: parts.camera_replacement_qty,
    p_sim_replacement_qty: parts.sim_replacement_qty,
    p_micro_sd_qty: parts.micro_sd_qty,
  });
  document.body.classList.remove('busy');
  if (error) return alert(error.message);
  activeItPrep = await getPrep(activeItPrep.id);
  await window.refreshData?.();
  await renderItUnitStep();
  alert('Parts list updated.');
}
async function ownerCancelAssignment(id) {
  if (!confirm('Cancel this Tech Check assignment?')) return;
  const { error } = await liveDb.rpc('owner_cancel_job_assignment', { p_assignment_id: id });
  if (error) return alert(error.message);
  await installOwnerAssignments(true);
}

async function installOwnerIntake(force = false) {
  if (!roleText().includes('Owner/Admin')) return;
  let host = document.getElementById('ownerIntakeTracking');
  if (host && host.dataset.loaded === '1' && !force) return;
  if (!host) {
    host = document.createElement('details');
    host.id = 'ownerIntakeTracking';
    host.className = 'card ownerDashSection ownerIntakeSection';
    const view = document.getElementById('view-owner');
    const attention = document.getElementById('ownerAttentionCard');
    if (attention) attention.after(host); else if (view) view.prepend(host);
  }
  const wasOpen = host.open;
  host.dataset.loaded = '1';
  const currentSearch = document.getElementById('ownerReturnSearch')?.value || '';
  const rows = await returnRows();
  ownerReturnRows = new Map(rows.map(r => [r.id, r]));
  const waitingCount = rows.filter(r => r.status === 'waiting_it').length;
  const managerCount = rows.filter(r => r.status === 'pending_mhelp_inventory').length;
  const completedCount = rows.filter(r => r.status === 'completed').length;
  const activeRows = rows.filter(r => r.status !== 'completed');
  const completedRows = rows.filter(r => r.status === 'completed');
  const renderOwnerReturn = r => {
    const record = readIntakeRecord(r.damage_notes);
    const answers = Array.isArray(record.meta?.answers) ? record.meta.answers : [];
    const checks = intakeLabels.map((label, i) => `<div class='small' style='padding:4px 0;border-bottom:1px solid #edf1f4'><b>${answers[i] === true ? '✓ YES' : answers[i] === false ? '✕ NO' : '— PENDING'}</b> · ${esc(label)}</div>`).join('');
    const doc = record.meta?.cancellationDoc;
    const status = r.status === 'waiting_it' ? 'WAITING FOR IT INTAKE' : r.status === 'pending_mhelp_inventory' ? 'PENDING MHELP INVENTORY' : 'COMPLETED — SHOP INVENTORY';
    const serviceDone = true;
    const itDone = r.status === 'pending_mhelp_inventory' || r.status === 'completed';
    const managerDone = r.status === 'completed';
    const process = `<div class='ownerProcess'><span class='processStep done'>✓ Service Return</span><span class='processArrow'>→</span><span class='processStep ${itDone ? 'done' : 'current'}'>${itDone ? '✓' : '•'} IT Intake</span><span class='processArrow'>→</span><span class='processStep ${managerDone ? 'done' : itDone ? 'current' : ''}'>${managerDone ? '✓' : '•'} Manager / MHelpDesk</span></div>`;
    const managerAction = r.status === 'pending_mhelp_inventory' ? `<div class='warn top8'><b>Manager action required</b><div class='small'>IT intake is finished. You now add Unit ${esc(r.unit_tag)} back to Shop Inventory in MHelpDesk.</div><button class='mini top8' data-wl-owner-mhelp-done='${r.id}'>Confirm I Added It to MHelpDesk Inventory</button></div>` : '';
    const searchText = `${r.unit_tag || ''} ${r.equipment_type || ''} ${r.ticket_no || ''} ${r.service_tech_name || ''} ${r.it_tech_name || ''}`;
    return `<details class='ownerFold' data-owner-return='${r.id}' data-owner-search='${esc(searchText)}'><summary><span><b>Unit ${esc(r.unit_tag)} · ${esc(r.equipment_type || 'Unit')}</b><span class='small ownerFoldHint'>MHelpDesk #${esc(r.ticket_no)}</span>${process}</span><span class='pill ${r.status === 'completed' ? 'delivery' : r.status === 'pending_mhelp_inventory' ? 'amber' : 'swap'}'>${status}</span></summary><div class='ownerFoldBody'>${managerAction}<div class='wl-review top8'><b>Chain of Custody</b><div class='small'><b>Service Tech:</b> ${esc(r.service_tech_name || 'Not recorded')} · Submitted ${r.returned_at ? new Date(r.returned_at).toLocaleString() : '—'}</div><div class='small'><b>IT Tech:</b> ${esc(r.it_tech_name || 'Not assigned')}${r.it_received_at ? ` · Intake completed ${new Date(r.it_received_at).toLocaleString()}` : ''}</div>${r.completed_at ? `<div class='small'><b>Manager confirmed MHelpDesk inventory:</b> ${new Date(r.completed_at).toLocaleString()}</div>` : ''}</div>${r.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(r.return_notes)}</div></div>` : ''}<div class='wl-review top8'><b>IT Intake Checklist — ${answers.filter(v => v === true).length}/${intakeLabels.length} YES</b>${checks}</div>${doc ? `<div class='ok top8'><b>SIM Cancellation Record</b><div class='small'>Date: ${esc(doc.simCanceledDate)} · MHelpDesk #${esc(doc.ticket)} · Unit ${esc(doc.unit)} · IT Tech: ${esc(doc.techName || r.it_tech_name || 'IT')} (${esc(doc.techInitials)})</div></div>` : ''}${record.notes ? `<div class='wl-note top8'><b>IT intake notes</b><div>${esc(record.notes)}</div></div>` : ''}<div class='small top8'><b>Service Return / Site / Damage Photos</b></div><div class='wl-return-gallery' data-owner-service-photos='${r.id}'><div class='wl-note'>Photos load when this record is opened.</div></div><div class='small top8'><b>IT Intake Photo</b></div><div class='wl-return-gallery' data-owner-intake-photos='${r.id}'><div class='wl-note'>Photo loads when this record is opened.</div></div><button class='mini danger top8' data-wl-owner-remove-return='${r.id}' data-wl-unit='${esc(r.unit_tag)}' data-wl-ticket='${esc(r.ticket_no)}'>Remove from Tracking</button></div></details>`;
  };

  const activeItems = activeRows.map(renderOwnerReturn);
  const completedItems = completedRows.map(renderOwnerReturn);
  host.innerHTML = `<summary class='ownerDashSummary'>
    <div><b>Returns & Intake</b><span>Returned units, IT intake, and manager follow-up</span></div>
    <span id='ownerIntakeBadge' class='ownerDashBadge ${activeRows.length ? 'alert' : 'neutral'}'>${activeRows.length}</span>
  </summary>
  <div class='ownerDashBody'>
    <div class='ownerWorkTools'>
      <div class='wl-workstrip'><span><b>${waitingCount}</b> waiting IT</span><span><b>${managerCount}</b> need manager</span><span><b>${completedCount}</b> completed</span></div>
      <input id='ownerReturnSearch' value='${esc(currentSearch)}' placeholder='Search unit, MHelpDesk ticket, equipment, or tech'>
    </div>
    <div class='ownerActiveLabel'>Needs Attention / In Progress</div>
    ${activeItems.join('') || '<div class="ok"><b>✓ No active return/intake work.</b></div>'}
    <details class='ownerHistoryFold'><summary>Completed Return & Intake History <span class='pill'>${completedCount}</span></summary><div>${completedItems.join('') || '<div class="small">No completed return history yet.</div>'}</div></details>
  </div>`;
  host.open = wasOpen;
  if (currentSearch) filterOwnerReturns(currentSearch);
}

document.addEventListener('click', async e => {
  if (e.target.closest('#techMenuButton')) return openTechMenu();
  if (e.target.closest('[data-wl-menu-close]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-menu-help]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return openHelpWalkthrough(false); }
  if (e.target.closest('[data-wl-menu-phone-alerts]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return enableBrowserAlerts(); }
  if (e.target.closest('[data-wl-menu-refresh]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); await window.refreshData?.(); return; }
  if (e.target.closest('#helpTrainingButton')) return openHelpWalkthrough(false);
  if (e.target.closest('[data-wl-help-close]')) { document.getElementById('wlHelpOverlay')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-help-skip]')) { walkthroughDismissedSession = true; document.getElementById('wlHelpOverlay')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-help-prev]')) { helpWalkthroughStep = Math.max(0, helpWalkthroughStep - 1); return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-help-next]')) { const steps=helpStepsForRole(); if (helpWalkthroughStep >= steps.length - 1) return completeHelpWalkthrough(); helpWalkthroughStep++; return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-enable-browser-alerts]')) return enableBrowserAlerts();
  const assigned = e.target.closest('[data-wl-start-assignment]');
  if (assigned) return startAssignedJob(assigned.dataset.wlStartAssignment);
  if (e.target.closest('[data-wl-owner-assign]')) return ownerAssignJob();
  if (e.target.closest('[data-wl-save-prep-parts]')) return saveActivePrepParts();
  const cancelAssignment = e.target.closest('[data-wl-cancel-assignment]');
  if (cancelAssignment) return ownerCancelAssignment(cancelAssignment.dataset.wlCancelAssignment);
});
document.addEventListener('change', e => {
  if (e.target?.id === 'ownerAddTech') { e.preventDefault(); addOwnerTechPill(); }
  if (e.target?.matches?.('[data-remove-tech]')) { e.preventDefault(); e.target.closest('[data-tech-id]')?.remove(); }
  if (e.target?.id === 'ownerAssignRole') refreshOwnerAssignmentTechOptions();
  if (e.target?.id === 'ownerAssignWorkType') { refreshOwnerWorkTypeLabels(); refreshOwnerAutoServicePlan(); const role=document.getElementById('ownerAssignRole')?.value; if(role==='both') refreshOwnerAssignmentTechOptions(); }
  if (e.target?.id === 'ownerAssignWorkType') refreshOwnerAutoServicePlan();
});

document.addEventListener('input', e => { if (e.target?.id === 'ownerReturnSearch') filterOwnerReturns(e.target.value); if (e.target?.matches?.('[data-owner-equipment-qty]')) refreshOwnerAutoServicePlan(); if (e.target?.id === 'wlReturnTicket') { serviceReturn.ticket=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnUnit') { serviceReturn.unit=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnNotes') { serviceReturn.notes=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('change', e => { if (e.target?.id === 'wlReturnType') { serviceReturn.type=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if (e.target?.id === 'wlItUnitValue' || e.target?.id === 'wlReconRequired') { e.preventDefault(); document.querySelector('#wlItWizardOnly [data-wl-it-next]')?.click(); return; } if (e.target?.id === 'wlSvcCount') { e.preventDefault(); document.querySelector('#wlSvcWizardOnly [data-wl-svc-next]')?.click(); return; } if (e.target?.id === 'wlTicketInput') { e.preventDefault(); document.querySelector('[data-wl-match]')?.click(); return; } if (e.target?.id === 'wlReturnTicket' || e.target?.id === 'wlReturnUnit') { e.preventDefault(); document.querySelector('#wlSvcReturn [data-wl-return-next]')?.click(); } });
document.addEventListener('toggle', e => { const ownerDetails = e.target?.matches?.('details[data-owner-return]') ? e.target : null; if (ownerDetails?.open) loadOwnerReturnPhotos(ownerDetails); const serviceDetails = e.target?.matches?.('details[data-svc-return]') ? e.target : null; if (serviceDetails?.open) loadServiceReturnPhotos(serviceDetails); }, true);
window.refreshOwnerIntake = () => { installOwnerAssignments(true); installOwnerIntake(true); };
let serviceSolarRealtimeStarted=false;
function setupServiceSolarRealtime() {
  if (serviceSolarRealtimeStarted) return;
  serviceSolarRealtimeStarted=true;
  liveDb.channel('tech-check-service-solar-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'service_solar_checks'},async()=>{
      if (roleText().includes('Owner/Admin')) await installOwnerAssignments(true);
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'service_solar_evidence'},async()=>{
      if (roleText().includes('Owner/Admin')) await installOwnerAssignments(true);
    })
    .subscribe();
}
function boot() {
  injectStyles(); installTabs(); installOwnerAssignments(); installOwnerIntake(); setupNotificationRealtime(); setupServiceSolarRealtime(); refreshNotificationBadge();
  const appVisible = !document.getElementById('appView')?.classList.contains('hidden');
  if (appVisible) { if (isIT() && !viewIT()?.classList.contains('hidden') && !document.getElementById('wlItHome')) showITHome(); if (isSvc() && !viewSvc()?.classList.contains('hidden') && !document.getElementById('wlSvcHome')) showSvcHome(); setTimeout(maybeShowFirstTimeWalkthrough, 250); }
}
let bootQueued = false;
function scheduleBoot() { if (bootQueued) return; bootQueued = true; requestAnimationFrame(() => { bootQueued = false; boot(); }); }
const bootObserver = new MutationObserver(scheduleBoot);
bootObserver.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
window.addEventListener('focus', scheduleBoot);
setInterval(scheduleBoot, 5000);
boot();

// ASSIGNMENT_NOTIFICATION_PUBLISH_STAMP_V1

// OWNER_ASSIGNMENT_TOP_CARD_V2
