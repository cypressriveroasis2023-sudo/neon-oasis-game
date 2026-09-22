const LIVE_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LIVE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const liveDb = window.TechCheckDB || supabase.createClient(LIVE_URL, LIVE_KEY);
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
let itFinalView = 'summary';
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
let serviceReturn = { step: 0, ticket: '', unit: '', type: '', notes: '', noTag:false, photo: null, tagScan: null, conditionPhotos: [], damagePhotos: [], knownUnits: [] };
let serviceReturnRecovered = false;
let serviceReturnSubmitting = false;
const FIELD_DRAFT_TTL = 24 * 60 * 60 * 1000;
async function deviceDraftKey(kind) { const { data:{ session } } = await liveDb.auth.getSession(); return session?.user?.id ? `cos-tech-field-draft-v1:${session.user.id}:${kind}` : ''; }
async function saveDeviceDraft(kind, payload) { const key = await deviceDraftKey(kind); if (!key) return; try { localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() })); } catch {} }
async function loadDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (!key) return null; try { const value=JSON.parse(localStorage.getItem(key)||'null'); if (!value) return null; if (Date.now()-Number(value.savedAt||0)>FIELD_DRAFT_TTL) { localStorage.removeItem(key); return null; } return value; } catch { return null; } }
async function clearDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (key) try { localStorage.removeItem(key); } catch {} }
function saveInspectionDraft() { return saveDeviceDraft('inspection',{ step:inspection.step, truck:[...inspection.truck], takingTrailer:inspection.takingTrailer, trailer:[...inspection.trailer] }); }
function saveServiceReturnDraft() { return saveDeviceDraft('service-return',{ step:serviceReturn.step, ticket:serviceReturn.ticket, unit:serviceReturn.unit, type:serviceReturn.type, notes:serviceReturn.notes, noTag:Boolean(serviceReturn.noTag), offlineEscalationId:serviceReturn.offlineEscalationId||null }); }
const intakeLabels = window.TechCheckRules?.itIntakeChecklist || ['Is the returned unit tag / number correct?', 'Did you review the Service Tech site / damage photos and verify any damage found?', 'Are the returned accessories / equipment accounted for?', 'Are the batteries / battery box accounted for?', 'Are the SD cards / storage accounted for where applicable?', 'Did you power the unit and verify it comes online / functions correctly?', 'Were the SD cards formatted and made ready for the next deployment?', 'Was the SIM card turned off / canceled for this returned unit?', 'Was monitoring canceled for this returned unit?', 'Was this unit removed from Alibi?', 'Was the unit cleaned and made physically ready for reuse?', 'Was the unit added back to the 2026 Unit Tracker as Shop Inventory?', 'Was the SIM cancellation documented with the date, MHelpDesk job, unit number, and IT technician initials?', 'Is the unit back on the shelf and ready for a future deployment?', 'Was this returned unit removed from the customer email account in the camera app?'];
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
    #view-it .wl-question .qtext,#view-svc .wl-question .qtext{font-size:26px!important;line-height:1.22!important;margin:12px 0 20px!important}
    #view-it .wl-options button,#view-svc .wl-options button{min-height:70px!important;border-radius:999px!important;font-size:19px!important}
    #view-it .wl-nav button,#view-svc .wl-nav button{min-height:62px!important;border-radius:999px!important;font-size:18px!important}
    #view-it .wl-big,#view-svc .wl-big{border-radius:999px!important;font-size:18px!important;text-align:center!important}
    .wl-next{background:#d20b12!important}.wl-stop a,.wl-red{background:#d20b12!important}
    .wl-ticket{border:1px solid #d8dde2!important;box-shadow:0 3px 12px rgba(0,0,0,.04)}
    .wl-issue-list{display:grid;gap:8px;margin-top:10px}.wl-issue-link{width:100%;border:1px solid #e5aaa6;border-radius:11px;background:#fff;color:#9e2119;padding:11px 12px;text-align:left;font-weight:850;cursor:pointer}.wl-issue-link:hover{background:#fff5f4}.wl-issue-link b{display:block;color:#741b15}.wl-issue-link span{display:block;font-size:12px;margin-top:2px;color:#9e2119}
    .wl-live-stage{margin:8px 0;padding:9px 10px;border-radius:10px;background:#f4f7f9}.wl-live-stage>b{display:block;font-size:12px;letter-spacing:.35px}.wl-live-stage>span{display:block;font-size:12px;color:#596875;margin-top:2px}.wl-live-track{height:6px;background:#dfe5e9;border-radius:999px;overflow:hidden;margin-top:7px}.wl-live-track i{display:block;height:100%;background:#d20b12;border-radius:999px}
    .wl-assigned-inventory{margin:12px 0;padding:12px;border:1px solid #cfdce5;border-radius:13px;background:#f3f7fa}.wl-assigned-inventory-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.wl-assigned-inventory-list span{display:inline-block;border:1px solid #d4dee6;border-radius:999px;background:#fff;padding:7px 9px;font-size:12px;color:#526472}.wl-assigned-inventory-list b{color:#102a40}
    .wl-svc-command{display:grid;gap:13px}
    .wl-svc-command-hero{background:linear-gradient(145deg,#101820,#243441);color:#fff;border-radius:17px;padding:17px 16px;box-shadow:0 8px 24px rgba(11,28,43,.16)}
    .wl-svc-command-kicker{font-size:9px;font-weight:950;letter-spacing:.16em;color:#ffb1b4;text-transform:uppercase}
    .wl-svc-command-hero h2{margin:4px 0 3px!important;color:#fff!important;font-size:25px!important;line-height:1.05}
    .wl-svc-command-hero p{margin:0;color:#d6e0e7;font-size:12px;line-height:1.4}
    .wl-svc-command-state{display:flex;align-items:center;gap:9px;margin-top:13px;padding:10px 11px;border-radius:12px;background:rgba(255,255,255,.1);font-size:12px;font-weight:900}
    .wl-svc-command-state i{width:10px;height:10px;border-radius:999px;background:#6ad893;box-shadow:0 0 0 4px rgba(106,216,147,.13);flex:none}
    .wl-svc-command-state.due i,.wl-svc-command-state.issue i{background:#ffcf5b;box-shadow:0 0 0 4px rgba(255,207,91,.13)}
    .wl-svc-command-state.blocked i{background:#ff7f7f;box-shadow:0 0 0 4px rgba(255,127,127,.13)}
    .wl-svc-command-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .wl-svc-command-stat{min-width:0;border:1px solid #dbe3e9;border-radius:12px;background:#fff;padding:10px 8px;text-align:center}
    .wl-svc-command-stat b{display:block;color:#102333;font-size:21px;line-height:1}
    .wl-svc-command-stat span{display:block;margin-top:5px;color:#627381;font-size:8px;font-weight:850;line-height:1.15;text-transform:uppercase;letter-spacing:.04em}
    .wl-svc-command-next{border:2px solid #d20b12;border-radius:14px;background:#fff;padding:14px}
    .wl-svc-command-next.clear{border-color:#8bc6a1;background:#f2fbf5}
    .wl-svc-command-next.wait{border-color:#e1b454;background:#fff9e9}
    .wl-svc-command-next .wl-next-kicker{margin-bottom:4px}
    .wl-svc-command-next>b{display:block;font-size:19px;color:#152637;line-height:1.15}
    .wl-svc-command-next .small{margin-top:5px}
    .wl-svc-command-section{border:1px solid #dbe3e9;border-radius:14px;background:#fff;padding:13px}
    .wl-svc-command-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
    .wl-svc-command-section-head b{font-size:16px;color:#152637}
    .wl-svc-command-section-head span{font-size:10px;font-weight:900;color:#687987}
    .wl-svc-job{border:1px solid #dce4e9;border-radius:12px;padding:12px;margin-top:8px;background:#fbfcfd}
    .wl-svc-job:first-child{margin-top:0}
    .wl-svc-job-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
    .wl-svc-job-top b{font-size:16px;color:#152637}
    .wl-svc-job-top span{flex:none;padding:4px 7px;border-radius:999px;background:#eaf6ee;color:#17643c;font-size:8px;font-weight:950;text-transform:uppercase}
    .wl-svc-job-top span.wait{background:#fff0ca;color:#805600}
    .wl-svc-job-top span.attn{background:#ffe4e2;color:#9e2119}
    .wl-svc-job-meta{display:flex;flex-wrap:wrap;gap:5px 9px;margin-top:5px;color:#60717e;font-size:10px}
    .wl-svc-job-desc{margin-top:7px;color:#263744;font-size:11px;line-height:1.35}
    .wl-svc-command-closeout{display:grid;gap:7px}
    .wl-svc-command-close-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:10px;background:#f5f7f9;font-size:11px}
    .wl-svc-command-close-row b{color:#263744}.wl-svc-command-close-row span{font-weight:900;color:#5d6e7c}
    .wl-svc-command-close-row.pending{background:#fff4e2}.wl-svc-command-close-row.pending span{color:#895900}
    .wl-svc-command-close-row.issue{background:#ffe9e7}.wl-svc-command-close-row.issue span{color:#9f2119}
    .wl-tech-load{display:grid;place-items:center;min-height:280px;padding:34px 18px;text-align:center}
    .wl-tech-load-ring{width:42px;height:42px;border:4px solid #dfe6eb;border-top-color:#d20b12;border-radius:999px;animation:wlTechSpin .8s linear infinite}
    .wl-tech-load h3{margin:15px 0 5px!important;color:#172839!important;font-size:20px!important}.wl-tech-load p{margin:0;max-width:310px;color:#667786;font-size:12px;line-height:1.45}
    .wl-tech-load-error{border:1px solid #e2b4b0;background:#fff5f4;border-radius:14px;padding:16px;text-align:left}.wl-tech-load-error b{color:#9e2119}.wl-tech-load-error button{margin-top:12px}
    .wl-tech-partial{border:1px solid #e4c77b;background:#fff9e9;color:#6e5100;border-radius:12px;padding:10px 12px;font-size:11px;line-height:1.4}
    @keyframes wlTechSpin{to{transform:rotate(360deg)}}
    .wl-it-command .wl-svc-command-hero{background:linear-gradient(145deg,#0d2233,#1f4b68)}
    .wl-it-command .wl-svc-command-kicker{color:#9bdcff}
    .wl-it-command .wl-svc-command-next{border-color:#277ca8}
    .wl-it-command .wl-svc-command-next.clear{border-color:#8bc6a1}
    .wl-it-command .wl-svc-command-next.wait{border-color:#e1b454}
    .wl-it-command .wl-svc-job-top span{background:#e6f4fb;color:#195f83}
    .wl-it-command .wl-svc-job-top span.wait{background:#fff0ca;color:#805600}
    .wl-it-command .wl-svc-job-top span.attn{background:#ffe4e2;color:#9e2119}
    @media(max-width:380px){.wl-svc-command-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-svc-command-hero h2{font-size:22px!important}}
    .wl-help-overlay{position:fixed;inset:0;background:rgba(4,17,29,.62);z-index:10020;display:flex;align-items:flex-end;justify-content:center;padding:14px}.wl-help-overlay.hidden{display:none!important}.wl-help-sheet{width:min(720px,100%);max-height:92vh;overflow:auto;background:#f7f9fb;border-radius:22px 22px 14px 14px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px}.wl-help-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#f7f9fb;padding:14px 0 10px;z-index:2}.wl-help-head h2{margin:2px 0 0;font-size:24px}.wl-help-progress{height:8px;background:#dfe5ea;border-radius:999px;overflow:hidden}.wl-help-progress span{display:block;height:100%;background:#d20b12}.wl-help-step-count{text-align:right;font-size:12px;color:#65727e;margin-top:5px}.wl-help-card{background:#fff;border:1px solid #dce3e8;border-radius:16px;padding:20px;margin-top:12px}.wl-help-card h2{font-size:26px;margin:6px 0 12px}.wl-help-copy{font-size:16px;line-height:1.5;color:#263440}.wl-help-copy p{margin:0 0 12px}.wl-help-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#edf2f5;border-radius:12px;padding:12px;font-size:12px}.wl-help-flow span{color:#d20b12;font-weight:950}.wl-help-nav{display:grid;grid-template-columns:1fr auto 1.5fr;gap:8px;align-items:center;margin-top:14px}.wl-help-nav button{min-height:52px;border-radius:12px;font-weight:900}.wl-help-skip{border:0;background:transparent;color:#596875;text-decoration:underline}.helpMini{white-space:nowrap}
    /* Tech Check Help Center v91 */
    .wl-help-sheet{background:#f5f7f9!important;color:#172839!important}
    .wl-help-head{background:#f5f7f9!important;border-bottom:1px solid #e1e7ec!important;margin:0 -2px 12px!important;padding:13px 2px 11px!important}
    .wl-help-brand{display:flex;align-items:center;gap:9px;min-width:0}
    .wl-help-brand-icon{width:38px;height:38px;flex:none;display:grid;place-items:center;border-radius:11px;background:#101820}
    .wl-help-brand-icon img{width:25px;height:25px;object-fit:contain}
    .wl-help-head .wl-next-kicker{color:#d20b12!important;font-size:8px!important;letter-spacing:.14em!important}
    .wl-help-head h2{margin:2px 0 0!important;color:#101820!important;font-size:21px!important;line-height:1.05!important}
    .wl-help-close-btn{width:38px;height:38px;min-width:38px;margin:0;padding:0;border:0;border-radius:999px;background:#e8edf1;color:#334757;display:grid;place-items:center;font-size:23px;font-weight:700;line-height:1}
    .wl-help-home-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px;border:1px solid #d6dee5;border-left:4px solid #d20b12;border-radius:14px;background:#fff;box-shadow:0 2px 8px rgba(16,24,32,.04)}
    .wl-help-home-hero>div>span{display:block;color:#d20b12;font-size:8px;font-weight:950;letter-spacing:.12em}
    .wl-help-home-hero h3{margin:3px 0 4px;color:#101820;font-size:20px;line-height:1.05}
    .wl-help-home-hero p{margin:0;color:#657583;font-size:10px;line-height:1.4;font-weight:600}
    .wl-help-safe{flex:none;padding:5px 7px;border:1px solid #b7d8c5;border-radius:999px;background:#edf9f1;color:#16653d;font-size:7px!important;letter-spacing:.07em!important;white-space:nowrap}
    .wl-help-role-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:10px}
    .wl-help-role-tabs button{min-height:54px;margin:0;padding:7px;border:1px solid #d2dbe2;border-radius:12px;background:#fff;color:#647482;font:inherit}
    .wl-help-role-tabs button b{width:25px;height:25px;margin:0 auto 3px;display:grid;place-items:center;border-radius:8px;background:#edf1f4;color:#253a4b;font-size:9px;font-weight:950}
    .wl-help-role-tabs button span{display:block;font-size:9px;font-weight:850}
    .wl-help-role-tabs button.selected{border-color:#d20b12;background:#fff7f7;color:#a90e14;box-shadow:inset 0 -3px 0 #d20b12}
    .wl-help-role-tabs button.selected b{background:#101820;color:#fff}
    .wl-help-start-card{margin-top:10px;padding:11px;border:1px solid #d6dee5;border-radius:14px;background:#101820;color:#fff}
    .wl-help-start-card>div{display:flex;align-items:center;gap:9px}
    .wl-help-start-icon{width:36px;height:36px;flex:none;display:grid;place-items:center;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#1b2832}
    .wl-help-start-icon img{width:23px;height:23px}
    .wl-help-start-card b,.wl-help-start-card small{display:block}
    .wl-help-start-card b{font-size:12px;line-height:1.2}.wl-help-start-card small{margin-top:2px;color:#c4ced6;font-size:8px;line-height:1.25}
    .wl-help-start-card button{width:100%;min-height:40px;margin:9px 0 0;border:0;border-radius:10px;background:#d20b12;color:#fff;font:inherit;font-size:10px;font-weight:900}
    .wl-help-flow-section,.wl-help-status-section,.wl-help-topics{margin-top:12px}
    .wl-help-section-title{display:flex;align-items:end;justify-content:space-between;gap:8px;margin:0 1px 7px}
    .wl-help-section-title b{color:#172839;font-size:12px;font-weight:900}.wl-help-section-title span{color:#7a8793;font-size:7px;font-weight:900;letter-spacing:.09em}
    .wl-help-flow-map{display:flex;align-items:center;gap:5px;overflow-x:auto;padding:10px;border:1px solid #d9e1e7;border-radius:12px;background:#fff;-webkit-overflow-scrolling:touch}
    .wl-help-flow-map span{flex:none;padding:6px 8px;border-radius:8px;background:#edf2f5;color:#263a49;font-size:7px;font-weight:900;white-space:nowrap}
    .wl-help-flow-map i{flex:none;color:#d20b12;font-style:normal;font-weight:950}
    .wl-help-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
    .wl-help-status-grid>div{min-width:0;padding:8px;border:1px solid #d8e0e6;border-radius:11px;background:#fff;display:grid;grid-template-columns:11px minmax(0,1fr);gap:7px;align-items:start}
    .wl-help-status-grid i{width:10px;height:10px;margin-top:2px;border-radius:999px;background:#a5afb8}
    .wl-help-status-grid .ready i{background:#16844a}.wl-help-status-grid .pending i{background:#d8a516}.wl-help-status-grid .stop i{background:#d20b12}
    .wl-help-status-grid b,.wl-help-status-grid small{display:block}.wl-help-status-grid b{font-size:9px}.wl-help-status-grid small{margin-top:2px;color:#72808c;font-size:7px;line-height:1.25}
    .wl-help-topic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
    .wl-help-topic-grid button{min-width:0;min-height:73px;margin:0;padding:9px;display:grid;grid-template-columns:31px minmax(0,1fr) auto;gap:7px;align-items:center;border:1px solid #d7dfe6;border-radius:12px;background:#fff;color:#172839;text-align:left;font:inherit}
    .wl-help-topic-icon{width:30px;height:30px;flex:none;display:grid;place-items:center;border-radius:9px;background:#101820;color:#fff;font-size:9px;font-weight:950}
    .wl-help-topic-grid button>span:nth-child(2){min-width:0}.wl-help-topic-grid b,.wl-help-topic-grid small{display:block}.wl-help-topic-grid b{font-size:9px;line-height:1.15;font-weight:900}.wl-help-topic-grid small{margin-top:3px;color:#72808d;font-size:7px;line-height:1.25}.wl-help-topic-grid strong{color:#7c8994;font-size:18px}
    .wl-help-rule-card{margin-top:12px;padding:10px 11px;border:1px solid #e2bd71;border-radius:11px;background:#fff8e9;color:#654713}
    .wl-help-rule-card b,.wl-help-rule-card span{display:block}.wl-help-rule-card b{font-size:10px}.wl-help-rule-card span{margin-top:3px;font-size:8px;line-height:1.35;font-weight:650}
    .wl-help-back{min-height:37px;margin:0 0 8px;padding:7px 10px;border:1px solid #d3dce3;border-radius:10px;background:#fff;color:#35495a;font:inherit;font-size:9px;font-weight:850}
    .wl-help-topic-detail{border:1px solid #d6dee5;border-top:4px solid #d20b12;border-radius:14px;background:#fff;overflow:hidden}
    .wl-help-topic-detail-head{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;align-items:center;padding:13px;border-bottom:1px solid #e5eaee}
    .wl-help-topic-icon.large{width:40px;height:40px;border-radius:11px;font-size:11px}
    .wl-help-topic-detail-head>div>span{display:block;color:#d20b12;font-size:7px;font-weight:950;letter-spacing:.1em}.wl-help-topic-detail-head h3{margin:2px 0;color:#101820;font-size:18px;line-height:1.1}.wl-help-topic-detail-head p{margin:3px 0 0;color:#6a7986;font-size:9px;line-height:1.3}
    .wl-help-topic-copy{padding:13px;color:#263847;font-size:11px;line-height:1.5}.wl-help-topic-copy p{margin:0 0 10px}.wl-help-topic-copy p:last-child{margin-bottom:0}
    .wl-help-topic-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.wl-help-topic-actions button{min-height:43px;margin:0;border-radius:10px;font:inherit;font-size:8px;font-weight:900}.wl-help-topic-actions button:first-child{border:1px solid #d20b12;background:#d20b12;color:#fff}.wl-help-topic-actions button:last-child{border:1px solid #d3dce3;background:#fff;color:#35495a}
    .wl-help-progress{height:6px!important}.wl-help-step-count{font-size:9px!important}.wl-help-card{padding:14px!important}.wl-help-card h2{font-size:20px!important}.wl-help-copy{font-size:12px!important;line-height:1.5!important}.wl-help-nav button{min-height:44px!important;font-size:10px!important}
    @media(min-width:800px){.wl-help-overlay{align-items:center!important}.wl-help-sheet{border-radius:20px!important;max-height:88vh!important}}
    @media(max-width:430px){.wl-help-sheet{padding:14px!important}.wl-help-head{top:-14px!important}.wl-help-topic-grid{grid-template-columns:1fr}.wl-help-home-hero{padding:11px}.wl-help-status-grid{gap:6px}.wl-help-topic-actions{grid-template-columns:1fr}}
    /* Walkthrough coaching v92 */
    .wl-help-howto{margin-top:13px;padding:11px;border:1px solid #cfd9e1;border-left:4px solid #d20b12;border-radius:12px;background:#f8fafb}
    .wl-help-howto-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
    .wl-help-howto-head span{color:#d20b12;font-size:8px;font-weight:950;letter-spacing:.11em}
    .wl-help-howto-head b{padding:4px 7px;border-radius:999px;background:#e9eef2;color:#4f5f6d;font-size:7px;font-weight:900}
    .wl-help-howto ol{margin:0;padding:0;list-style:none;counter-reset:helpstep;display:grid;gap:7px}
    .wl-help-howto li{counter-increment:helpstep;display:grid;grid-template-columns:23px minmax(0,1fr);gap:7px;align-items:start;color:#263847;font-size:10px;line-height:1.4;font-weight:650}
    .wl-help-howto li:before{content:counter(helpstep);width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:#101820;color:#fff;font-size:8px;font-weight:950}
    .wl-help-howto>button{width:100%;min-height:40px;margin:10px 0 0;border:1px solid #d20b12;border-radius:10px;background:#d20b12;color:#fff;font:inherit;font-size:9px;font-weight:900}
    .wl-help-howto>small{display:block;margin-top:7px;color:#788591;font-size:7px;line-height:1.35;font-weight:650}
    .wl-help-live-highlight{position:relative!important;z-index:10012!important;outline:4px solid #f1b918!important;outline-offset:4px!important;box-shadow:0 0 0 8px rgba(241,185,24,.20),0 10px 30px rgba(0,0,0,.18)!important;animation:wlHelpPulse .8s ease-in-out 3}
    @keyframes wlHelpPulse{0%,100%{outline-color:#f1b918}50%{outline-color:#d20b12}}
    .wl-help-coach-toast{position:fixed;left:50%;bottom:18px;z-index:10050;width:min(440px,calc(100% - 28px));transform:translate(-50%,140%);opacity:0;pointer-events:none;box-sizing:border-box;padding:10px 11px;border:1px solid #d3dce3;border-top:4px solid #d20b12;border-radius:13px;background:#fff;color:#172839;box-shadow:0 12px 38px rgba(0,0,0,.24);transition:transform .22s ease,opacity .22s ease}
    .wl-help-coach-toast.show{transform:translate(-50%,0);opacity:1;pointer-events:auto}
    .wl-help-coach-toast b,.wl-help-coach-toast span{display:block}.wl-help-coach-toast b{font-size:11px}.wl-help-coach-toast span{margin-top:2px;color:#687885;font-size:8px;line-height:1.3}
    .wl-help-coach-toast button{width:100%;min-height:36px;margin:8px 0 0;border:0;border-radius:9px;background:#101820;color:#fff;font:inherit;font-size:8px;font-weight:900}
    .wl-help-show-note{margin:0 0 8px;padding:9px;border:1px solid #e7c76a;border-radius:9px;background:#fff8df;color:#725000;font-size:9px;font-weight:750;line-height:1.35}
    @media(max-width:430px){.wl-help-howto{padding:9px}.wl-help-howto li{font-size:9px}.wl-help-coach-toast{bottom:12px}}


    .wl-menu-overlay{position:fixed;inset:0;background:rgba(4,17,29,.58);z-index:10030;display:flex;align-items:flex-end;justify-content:center;padding:14px}.wl-menu-overlay.hidden{display:none!important}.wl-menu-sheet{width:min(620px,100%);max-height:90vh;overflow:auto;background:#f7f9fb;border-radius:22px 22px 14px 14px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px}.wl-menu-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.wl-menu-head h2{margin:2px 0 0;font-size:28px}.wl-app-menu-list{display:grid;gap:10px;margin-top:14px}.wl-app-menu-item{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;border:1px solid #d5dfe6;border-radius:14px;background:#fff;padding:14px;text-align:left;color:#172839}.wl-app-menu-item span:nth-child(2) b,.wl-app-menu-item span:nth-child(2) small{display:block}.wl-app-menu-item span:nth-child(2) small{margin-top:3px;color:#687887;font-weight:600}.wl-app-menu-item>strong{color:#687887}.wl-app-menu-icon{width:38px;height:38px;border-radius:11px;background:#0b2a3f;color:#fff;display:grid;place-items:center;font-size:18px;font-weight:950}.wl-menu-future{margin-top:14px;padding:13px;border:1px dashed #bfcbd4;border-radius:13px;background:#eef3f6}.techMenuMini{white-space:nowrap}


    /* Compact Owner Menu v89 */
    .wl-menu-close-btn{width:38px;height:38px;min-width:38px;border:0;border-radius:999px;background:#eaf0f4;color:#35495b;display:grid;place-items:center;font-size:23px;line-height:1;font-weight:700;padding:0}
    .wl-owner-menu{padding:12px!important}
    .wl-owner-menu .wl-menu-sheet{width:min(560px,100%)!important;max-height:none!important;overflow:visible!important;border-radius:22px!important;padding:15px!important;background:#f8fafb!important}
    .wl-owner-menu .wl-menu-head{margin-bottom:10px!important}
    .wl-owner-menu .wl-menu-head h2{font-size:23px!important;line-height:1.05!important;margin:2px 0 0!important}
    .wl-owner-menu .wl-next-kicker{font-size:9px!important;letter-spacing:.13em!important}
    .wl-owner-menu-primary{margin-top:4px}
    .wl-owner-menu-ai{box-sizing:border-box;width:100%;min-height:72px;margin:0;padding:10px 12px;display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:10px;border:1px solid #d8c7f2;border-radius:15px;background:#fff;color:#172839;text-align:left;box-shadow:0 2px 8px rgba(18,43,65,.05)}
    .wl-owner-menu-ai-icon{width:38px;height:38px;border-radius:11px;background:#0b2a3f;color:#fff;display:grid;place-items:center;font-size:18px}
    .wl-owner-menu-ai>span:nth-child(2){min-width:0}.wl-owner-menu-ai b,.wl-owner-menu-ai small{display:block}.wl-owner-menu-ai b{font-size:15px;line-height:1.1;font-weight:900}.wl-owner-menu-ai small{margin-top:3px;color:#6d7b88;font-size:10px;line-height:1.2;font-weight:650}.wl-owner-menu-ai>strong{color:#7a8793;font-size:22px}
    .wl-owner-menu-utilities{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}
    .wl-owner-menu-util{box-sizing:border-box;width:100%;min-width:0;min-height:60px;margin:0;padding:8px 9px;display:grid;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:8px;border:1px solid #d5dfe6;border-radius:14px;background:#fff;color:#172839;text-align:left}
    .wl-owner-menu-util-icon{width:31px;height:31px;border-radius:10px;background:#eef3f6;color:#24394a;display:grid;place-items:center;font-size:15px;font-weight:950}
    .wl-owner-menu-util>span:nth-child(2){min-width:0}.wl-owner-menu-util b,.wl-owner-menu-util small{display:block}.wl-owner-menu-util b{font-size:11px;line-height:1.1;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wl-owner-menu-util small{margin-top:3px;color:#71808d;font-size:8px;line-height:1.15;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wl-owner-menu-ai:active,.wl-owner-menu-util:active,.wl-menu-close-btn:active{transform:scale(.985)}
    @media(max-width:390px){.wl-owner-menu .wl-menu-sheet{padding:13px!important}.wl-owner-menu-ai{min-height:68px;padding:9px 10px}.wl-owner-menu-utilities{gap:7px}.wl-owner-menu-util{padding:7px 8px}.wl-owner-menu-util b{font-size:10px}}
    #view-service .wl-service-find-row{display:grid!important;grid-template-columns:minmax(0,1fr) 112px!important;gap:8px!important;align-items:stretch!important}
    #view-service .wl-service-find-row input{box-sizing:border-box!important;width:100%!important;min-width:0!important;height:48px!important;min-height:48px!important;margin:0!important;padding:9px 11px!important;border:1px solid #cbd5df!important;border-radius:12px!important;background:#fff!important;font-size:15px!important;box-shadow:none!important}
    #view-service .wl-find-job-button{box-sizing:border-box!important;width:100%!important;min-width:0!important;height:48px!important;min-height:48px!important;margin:0!important;padding:0 13px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;border:1px solid #d20b12!important;border-radius:12px!important;background:#d20b12!important;color:#fff!important;box-shadow:0 3px 8px rgba(210,11,18,.12)!important;font:inherit!important;font-size:12px!important;font-weight:900!important;line-height:1!important;white-space:nowrap!important}
    #view-service .wl-find-job-button strong{font-size:17px!important;line-height:1!important;font-weight:700!important}
    #view-service .wl-find-job-button:active{transform:scale(.985)}
    @media(max-width:390px){#view-service .wl-service-find-row{grid-template-columns:minmax(0,1fr) 104px!important}#view-service .wl-find-job-button{padding:0 10px!important;font-size:11px!important}}
    .wl-service-quick{margin:12px 0 2px;padding:10px;border:1px solid #d7e0e8;border-radius:16px;background:rgba(255,255,255,.72);box-shadow:0 3px 10px rgba(18,43,65,.04)}
    .wl-service-quick-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 8px}.wl-service-quick-head b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#516170}.wl-service-quick-head span{font-size:9px;font-weight:800;color:#8a98a6}
    .wl-service-quick-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .wl-service-quick-pill{width:100%!important;min-width:0!important;height:50px!important;min-height:50px!important;margin:0!important;padding:5px 8px!important;display:grid!important;grid-template-columns:30px minmax(0,1fr) auto!important;align-items:center!important;gap:7px!important;border:1px solid #ccd7e1!important;border-radius:999px!important;background:#fff!important;color:#17283b!important;box-shadow:0 2px 6px rgba(18,43,65,.05)!important;text-align:left!important;font-size:11px!important;font-weight:850!important;line-height:1!important;overflow:hidden!important}
    .wl-service-quick-pill.return{border-color:#d20b12!important;background:#fff7f7!important;color:#a90b10!important}
    .wl-service-quick-icon{width:30px;height:30px;border-radius:999px;display:grid;place-items:center;background:#eef2f5;color:#24384b;font-size:14px;font-weight:900}
    .wl-service-quick-pill.return .wl-service-quick-icon{background:#d20b12;color:#fff}
    .wl-service-quick-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:850}
    .wl-service-quick-badge{flex:none;min-width:24px;height:24px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#eef2f5;color:#607080;font-size:8px;font-weight:900;line-height:1}
    .wl-service-quick-pill.return .wl-service-quick-badge{background:#fde7e8;color:#a90b10}
    .wl-service-quick-pill:active{transform:scale(.985)}

    /* Owner compact dashboard v76 */
    #view-owner>.ownerCompactShell{display:block;width:100%}
    .ownerCompactTopbar{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.35fr);gap:8px;margin:6px 0 10px}
    .ownerCompactAssign,.ownerCompactAttention{box-sizing:border-box;min-width:0;min-height:48px;margin:0;border-radius:13px;font:inherit;cursor:pointer}
    .ownerCompactAssign{display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 12px;border:1px solid #d20b12;background:#d20b12;color:#fff;box-shadow:0 3px 8px rgba(210,11,18,.12)}
    .ownerCompactAssign span{font-size:19px;font-weight:600}.ownerCompactAssign b{font-size:12px;font-weight:900}
    .ownerCompactAttention{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px 9px;border:1px solid #d8e0e7;background:#fff;color:#17283b;text-align:left;box-shadow:0 2px 7px rgba(18,43,65,.04)}
    .ownerCompactAlertIcon{width:26px;height:26px;display:grid;place-items:center;border-radius:999px;background:#eef2f5;color:#637383;font-size:12px;font-weight:950}
    .ownerCompactAttention>span:nth-child(2){min-width:0}.ownerCompactAttention b,.ownerCompactAttention small{display:block}.ownerCompactAttention b{font-size:10px;line-height:1.1}.ownerCompactAttention small{margin-top:2px;color:#788695;font-size:8px;line-height:1.15;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ownerCompactAttention strong{min-width:25px;height:25px;padding:0 6px;display:grid;place-items:center;border-radius:999px;background:#eef2f5;color:#607080;font-size:10px}
    .ownerCompactAttention.has-attention{border-color:#efb1b4;background:#fff8f8}.ownerCompactAttention.has-attention .ownerCompactAlertIcon,.ownerCompactAttention.has-attention strong{background:#d20b12;color:#fff}.ownerCompactAttention.has-attention b{color:#a90b10}
    #view-owner .ownerCompactGroup{margin:8px 0!important;padding:0!important;overflow:hidden;border:1px solid #d6e0e8!important;border-radius:14px!important;background:#fff!important;box-shadow:0 2px 8px rgba(18,43,65,.045)!important}
    #view-owner .ownerCompactGroup.jobs{border-left:4px solid #22965b!important}#view-owner .ownerCompactGroup.equipment{border-left:4px solid #2d73a5!important}#view-owner .ownerCompactGroup.team{border-left:4px solid #7c4bb1!important}#view-owner .ownerCompactGroup.more{border-left:4px solid #778696!important}
    .ownerCompactGroupSummary{list-style:none;display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:66px;padding:10px 12px;cursor:pointer;background:#fff}.ownerCompactGroupSummary::-webkit-details-marker{display:none}
    .ownerCompactIcon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#f0f4f7;color:#294054;font-size:12px;font-weight:950;letter-spacing:-.03em}
    .ownerCompactGroup.jobs .ownerCompactIcon{background:#eef9f2;color:#187346}.ownerCompactGroup.equipment .ownerCompactIcon{background:#eff6fb;color:#2b6e9d}.ownerCompactGroup.team .ownerCompactIcon{background:#f6f0fb;color:#7141a5}
    .ownerCompactGroupSummary>span:nth-child(2){min-width:0}.ownerCompactGroupSummary b,.ownerCompactGroupSummary small{display:block}.ownerCompactGroupSummary b{color:#152334;font-size:17px;line-height:1.05;font-weight:900;letter-spacing:-.02em}.ownerCompactGroupSummary small{margin-top:4px;color:#718090;font-size:9px;line-height:1.2;font-weight:650}
    .ownerCompactGroupSummary>strong{min-width:31px;height:31px;padding:0 8px;display:grid;place-items:center;border-radius:999px;background:#eef3f6;color:#536576;font-size:10px;font-weight:900}.ownerCompactGroup[open]>.ownerCompactGroupSummary{border-bottom:1px solid #e4e9ee}.ownerCompactGroup[open]>.ownerCompactGroupSummary>strong{background:#152334;color:#fff}
    .ownerCompactGroupBody{padding:8px;background:#f8fafb}
    #view-owner .ownerCompactSecondary{margin:7px 0!important;border:1px solid #dbe3ea!important;border-radius:11px!important;box-shadow:none!important;background:#fff!important;overflow:hidden}
    #view-owner .ownerCompactSecondary>.ownerDashSummary{min-height:52px!important;padding:8px 10px!important;border-left:0!important;background:#fff!important}
    #view-owner .ownerCompactSecondary>.ownerDashSummary>div>b{font-size:14px!important;line-height:1.1!important;letter-spacing:-.01em!important}#view-owner .ownerCompactSecondary>.ownerDashSummary>div>span{margin-top:2px!important;font-size:8px!important;line-height:1.15!important}
    #view-owner .ownerCompactSecondary>.ownerDashSummary .ownerDashBadge{min-width:28px!important;height:28px!important;font-size:10px!important;box-shadow:none!important}#view-owner .ownerCompactSecondary>.ownerDashBody{padding:9px!important}
    #view-owner .ownerCompactAssignForm:not([open]),#view-owner .ownerCompactAttentionDetail:not([open]){display:none!important}
    #view-owner .ownerCompactAssignForm>.ownerDashSummary>div>b,#view-owner .ownerCompactAttentionDetail>.ownerDashSummary>div>b{color:#b20b10}
    @media(max-width:560px){.ownerCompactTopbar{grid-template-columns:minmax(0,.72fr) minmax(0,1.28fr);gap:7px}.ownerCompactAssign,.ownerCompactAttention{min-height:46px}.ownerCompactAssign b{font-size:11px}.ownerCompactGroupSummary{min-height:62px;padding:9px 10px;grid-template-columns:34px minmax(0,1fr) auto;gap:8px}.ownerCompactIcon{width:32px;height:32px}.ownerCompactGroupSummary b{font-size:16px}.ownerCompactGroupSummary small{font-size:8px}.ownerCompactGroupBody{padding:6px}}

    /* Owner Jobs focus layout v78 */
    #ownerCompactJobsBody #ownerLiveJobProgress{border:0!important;border-radius:0!important;margin:0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important}
    #ownerCompactJobsBody #ownerLiveJobProgress>.ownerDashSummary{display:none!important}
    #ownerCompactJobsBody #ownerLiveJobProgress>.ownerDashBody{display:block!important;padding:2px 0 0!important;background:transparent!important}
    #ownerCompactJobsBody .ownerLiveSummary{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important;margin:0 0 8px!important}
    #ownerCompactJobsBody .ownerLiveSummary span{min-width:0!important;padding:8px 5px!important;border:1px solid #dce4ea!important;border-radius:10px!important;background:#fff!important;text-align:center!important;color:#6c7a88!important;font-size:8px!important;line-height:1.15!important;font-weight:700!important}
    #ownerCompactJobsBody .ownerLiveSummary b{display:block!important;margin-bottom:3px!important;color:#162536!important;font-size:17px!important;line-height:1!important;font-weight:900!important}
    #ownerCompactJobsBody .ownerJobStatusSection{margin:7px 0!important;padding:8px!important;border-width:1px!important;border-radius:11px!important;box-shadow:none!important}
    #ownerCompactJobsBody .ownerActiveLabel{margin-bottom:6px!important;font-size:9px!important;line-height:1.1!important;letter-spacing:.08em!important}
    #ownerCompactJobsBody .wl-assignment-row{margin:6px 0!important;padding:9px!important;border-radius:10px!important;box-shadow:none!important}
    #ownerCompactJobsBody .ownerHistoryFold{margin-top:7px!important;border:1px solid #dde5eb!important;border-radius:10px!important;background:#fff!important}
    #ownerCompactJobsBody .ownerHistoryFold>summary{padding:8px 10px!important;font-size:10px!important;font-weight:800!important}

    .ownerCompactAIStatus{margin:8px 0 0!important;border:1px solid #ded8ed!important;border-radius:11px!important;background:#fff!important;overflow:hidden!important}
    .ownerCompactAIStatus>summary{list-style:none;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:50px;padding:7px 9px;cursor:pointer}
    .ownerCompactAIStatus>summary::-webkit-details-marker{display:none}
    .ownerCompactAIIcon{width:29px;height:29px;display:grid;place-items:center;border-radius:9px;background:#f4effb;font-size:14px}
    .ownerCompactAIStatus>summary>span:nth-child(2){min-width:0}.ownerCompactAIStatus>summary b,.ownerCompactAIStatus>summary small{display:block}.ownerCompactAIStatus>summary b{color:#4f2391;font-size:12px;line-height:1.1;font-weight:900}.ownerCompactAIStatus>summary small{margin-top:2px;color:#7a7187;font-size:8px;line-height:1.15;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ownerCompactAIStatus>summary strong{padding:5px 7px;border:1px solid #b9eac8;border-radius:999px;background:#f0fbf3;color:#16723f;font-size:8px;font-weight:900;white-space:nowrap}
    .ownerCompactAIStatus>summary strong.attention{border-color:#f1b6b9;background:#fff2f2;color:#b20b10}
    .ownerCompactAIStatus>.wl-owner-ai-control-center{margin:0!important;border:0!important;border-top:1px solid #ebe6f2!important;border-radius:0!important;box-shadow:none!important}

    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup{margin:0 0 7px!important;border:1px solid #dbe4eb!important;border-radius:11px!important;background:#fff!important;box-shadow:none!important}
    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup .wl-owner-unit-lookup-head{padding:0!important}
    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup .wl-eyebrow{font-size:7px!important}
    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup .wl-owner-unit-lookup-head b{font-size:13px!important}
    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup .wl-owner-unit-lookup-head small{font-size:8px!important}
    #ownerCompactEquipmentBody>.ownerCompactEquipmentLookup .wl-owner-unit-search{margin-top:7px!important}

    @media(max-width:560px){
      #ownerCompactJobsBody .ownerLiveSummary{grid-template-columns:repeat(4,minmax(0,1fr))!important}
      #ownerCompactJobsBody .ownerLiveSummary span{padding:7px 3px!important;font-size:7px!important}
      #ownerCompactJobsBody .ownerLiveSummary b{font-size:16px!important}
      .ownerCompactAIStatus>summary{grid-template-columns:28px minmax(0,1fr) auto;gap:7px;padding:6px 8px}
      .ownerCompactAIStatus>summary strong{max-width:82px;overflow:hidden;text-overflow:ellipsis}
    }

    /* Owner IT/Service shared-home layout v81 */
    #view-owner>.ownerCompactShell.wl-home{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}
    #view-owner .ownerHomeMain{display:block}
    #view-owner .ownerHomeMain.hidden{display:none!important}
    #view-owner .ownerHomeModes{margin-top:0!important}
    #view-owner .ownerHomeModes .wl-mode-card{min-height:96px!important}
    #view-owner .ownerHomeModes .wl-mode-card.on{border-color:#d20b12!important}
    #view-owner .ownerHomeWorkstrip{margin:12px 0!important}
    #view-owner .ownerHomeMenu{margin-top:12px!important}
    #view-owner .ownerCompactGroup{display:none!important;margin:0!important}
    #view-owner .ownerCompactGroup.ownerPanelActive{display:block!important}
    #view-owner .ownerCompactGroup.ownerPanelActive>.ownerCompactGroupSummary{display:grid!important}
    #view-owner .ownerCompactGroup.ownerPanelActive>.ownerCompactGroupSummary{cursor:default!important;user-select:none!important;-webkit-user-select:none!important}
    #view-owner .ownerCompactGroup.ownerPanelActive>.ownerCompactGroupSummary>strong{background:#eef3f6!important;color:#536576!important}
    #view-owner .ownerCompactGroup.ownerPanelActive>.ownerCompactGroupBody{display:block!important}
    #view-owner .ownerPanelBack{margin:0 0 8px!important}
    #view-owner .ownerCompactGroupSummary{min-height:68px!important}
    #view-owner .ownerCompactGroupBody{padding:8px!important}
    #view-owner .ownerCompactSecondary{margin:7px 0!important}
    #view-owner .ownerCompactAssignForm:not([open]),#view-owner .ownerCompactAttentionDetail:not([open]){display:none!important}
    #view-owner .ownerCompactGroup.ownerPanelActive .ownerCompactAssignForm[open],
    #view-owner .ownerCompactGroup.ownerPanelActive .ownerCompactAttentionDetail[open]{display:block!important}
    @media(max-width:560px){
      #view-owner .ownerHomeModes{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:10px!important;margin-bottom:18px!important}
      #view-owner .ownerHomeModes .wl-mode-card{min-height:86px!important}
      #view-owner .ownerHomeMenu{gap:10px!important}
    }

    /* Owner real page containers v83 */
    #view-owner .ownerFeaturePage{display:none!important;margin:0!important;padding:0!important;overflow:hidden!important;border:1px solid #d6e0e8!important;border-radius:14px!important;background:#fff!important;box-shadow:0 2px 8px rgba(18,43,65,.045)!important}
    #view-owner .ownerFeaturePage.ownerPanelActive{display:block!important}
    #view-owner .ownerFeaturePage.jobs{border-left:4px solid #22965b!important}#view-owner .ownerFeaturePage.equipment{border-left:4px solid #2d73a5!important}#view-owner .ownerFeaturePage.team{border-left:4px solid #7c4bb1!important}#view-owner .ownerFeaturePage.more{border-left:4px solid #778696!important}
    #view-owner .ownerFeatureHeader{display:grid!important;grid-template-columns:36px minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;min-height:66px!important;padding:10px 12px!important;border-bottom:1px solid #e4e9ee!important;background:#fff!important}
    #view-owner .ownerFeatureHeader>span:nth-child(2){min-width:0!important}#view-owner .ownerFeatureHeader b,#view-owner .ownerFeatureHeader small{display:block!important}#view-owner .ownerFeatureHeader b{color:#152334!important;font-size:17px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.02em!important}#view-owner .ownerFeatureHeader small{margin-top:4px!important;color:#718090!important;font-size:9px!important;line-height:1.2!important;font-weight:650!important}
    #view-owner .ownerFeatureHeader>strong{min-width:31px!important;height:31px!important;padding:0 8px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:#eef3f6!important;color:#536576!important;font-size:10px!important;font-weight:900!important}
    #view-owner .ownerFeatureBody{display:block!important;padding:8px!important;background:#f8fafb!important}
    #view-owner .ownerFeatureContent{display:block!important;width:100%!important}
    #view-owner .ownerPanelBack{display:block!important;width:100%!important;min-height:48px!important;margin:0 0 8px!important;border:0!important;border-radius:11px!important;background:#edf2f6!important;color:#34495c!important;font-size:14px!important;font-weight:850!important}
    @media(max-width:560px){#view-owner .ownerFeatureHeader{min-height:62px!important;padding:9px 10px!important;grid-template-columns:34px minmax(0,1fr) auto!important;gap:8px!important}#view-owner .ownerFeatureHeader b{font-size:16px!important}#view-owner .ownerFeatureHeader small{font-size:8px!important}#view-owner .ownerFeatureBody{padding:6px!important}}

    /* Owner persistent inline dashboard v84 */
    #view-owner .ownerHomeMain{display:block!important}
    #view-owner .ownerFeaturePage{display:none!important;margin:12px 0 0!important;padding:0!important;overflow:hidden!important;border:1px solid #d6e0e8!important;border-radius:14px!important;background:#fff!important;box-shadow:0 2px 8px rgba(18,43,65,.045)!important}
    #view-owner .ownerFeaturePage.ownerPanelActive{display:block!important}
    #view-owner .ownerFeaturePage.jobs{border-left:4px solid #22965b!important}#view-owner .ownerFeaturePage.equipment{border-left:4px solid #2d73a5!important}#view-owner .ownerFeaturePage.team{border-left:4px solid #7c4bb1!important}#view-owner .ownerFeaturePage.more{border-left:4px solid #778696!important}
    #view-owner .ownerFeatureHeader{display:grid!important;grid-template-columns:36px minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;min-height:62px!important;padding:9px 11px!important;border-bottom:1px solid #e4e9ee!important;background:#fff!important}
    #view-owner .ownerFeatureHeader>span:nth-child(2){min-width:0!important}#view-owner .ownerFeatureHeader b,#view-owner .ownerFeatureHeader small{display:block!important}#view-owner .ownerFeatureHeader b{color:#152334!important;font-size:16px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.02em!important}#view-owner .ownerFeatureHeader small{margin-top:3px!important;color:#718090!important;font-size:8px!important;line-height:1.2!important;font-weight:650!important}
    #view-owner .ownerFeatureHeaderRight{display:flex!important;align-items:center!important;gap:6px!important}
    #view-owner .ownerFeatureHeaderRight>strong{min-width:29px!important;height:29px!important;padding:0 7px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:#eef3f6!important;color:#536576!important;font-size:9px!important;font-weight:900!important}
    #view-owner .ownerFeatureClose{width:29px!important;height:29px!important;min-width:29px!important;min-height:29px!important;margin:0!important;padding:0!important;border:1px solid #d7e0e7!important;border-radius:999px!important;background:#fff!important;color:#607080!important;font-size:18px!important;line-height:1!important;font-weight:700!important}
    #view-owner .ownerFeatureBody{display:block!important;padding:7px!important;background:#f8fafb!important}
    #view-owner .ownerFeatureContent{display:block!important;width:100%!important}
    #view-owner .ownerCompactAssignForm:not([open]),#view-owner .ownerCompactAttentionDetail:not([open]){display:none!important}
    #view-owner .ownerFeaturePage.ownerPanelActive .ownerCompactAssignForm[open],#view-owner .ownerFeaturePage.ownerPanelActive .ownerCompactAttentionDetail[open]{display:block!important}
    @media(max-width:560px){
      #view-owner .ownerFeaturePage{margin-top:10px!important}
      #view-owner .ownerFeatureHeader{grid-template-columns:32px minmax(0,1fr) auto!important;gap:8px!important;min-height:58px!important;padding:8px 9px!important}
      #view-owner .ownerFeatureHeader b{font-size:15px!important}
      #view-owner .ownerFeatureHeader small{font-size:8px!important}
      #view-owner .ownerFeatureBody{padding:6px!important}
    }

    /* Owner true page navigation v85 */
    #view-owner .ownerHomeMain{display:block!important}
    #view-owner .ownerHomeMain.hidden{display:none!important}
    #view-owner .ownerFeaturePage{display:none!important;margin:0!important;padding:0!important;overflow:hidden!important;border:1px solid #d6e0e8!important;border-radius:14px!important;background:#fff!important;box-shadow:0 2px 8px rgba(18,43,65,.045)!important}
    #view-owner .ownerFeaturePage.ownerPanelActive{display:block!important}
    #view-owner .ownerFeaturePage.assign{border-left:4px solid #d20b12!important}
    #view-owner .ownerFeaturePage.jobs{border-left:4px solid #22965b!important}
    #view-owner .ownerFeaturePage.equipment{border-left:4px solid #2d73a5!important}
    #view-owner .ownerFeaturePage.team{border-left:4px solid #7c4bb1!important}
    #view-owner .ownerFeaturePage.more{border-left:4px solid #778696!important}
    #view-owner .ownerFeatureHeader{display:grid!important;grid-template-columns:36px minmax(0,1fr) auto!important;align-items:center!important;gap:10px!important;min-height:66px!important;padding:10px 12px!important;border-bottom:1px solid #e4e9ee!important;background:#fff!important}
    #view-owner .ownerFeatureHeader>span:nth-child(2){min-width:0!important}
    #view-owner .ownerFeatureHeader b,#view-owner .ownerFeatureHeader small{display:block!important}
    #view-owner .ownerFeatureHeader b{color:#152334!important;font-size:17px!important;line-height:1.05!important;font-weight:900!important;letter-spacing:-.02em!important}
    #view-owner .ownerFeatureHeader small{margin-top:4px!important;color:#718090!important;font-size:9px!important;line-height:1.2!important;font-weight:650!important}
    #view-owner .ownerFeatureHeader>strong{min-width:31px!important;height:31px!important;padding:0 8px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:#eef3f6!important;color:#536576!important;font-size:9px!important;font-weight:900!important}
    #view-owner .ownerFeatureBody{display:block!important;padding:8px!important;background:#f8fafb!important}
    #view-owner .ownerFeatureContent{display:block!important;width:100%!important}
    #view-owner .ownerBackHome{display:block!important;width:100%!important;min-height:52px!important;margin:0 0 9px!important;padding:10px 14px!important;border:0!important;border-radius:12px!important;background:#eaf0f4!important;color:#34495c!important;font-size:15px!important;font-weight:900!important;text-align:center!important}
    #view-owner #ownerCompactAssign.ownerPanelActive #ownerJobAssignments{display:block!important;margin:0!important;border:0!important;box-shadow:none!important}
    #view-owner #ownerCompactAssign.ownerPanelActive #ownerJobAssignments>.ownerDashSummary{display:none!important}
    #view-owner #ownerCompactAssign.ownerPanelActive #ownerJobAssignments>.ownerDashBody{display:block!important;padding:4px!important}
    #view-owner .ownerCompactAssignForm:not([open]){display:none!important}
    #view-owner #ownerCompactAssign.ownerPanelActive .ownerCompactAssignForm[open]{display:block!important}
    @media(max-width:560px){
      #view-owner .ownerFeatureHeader{grid-template-columns:32px minmax(0,1fr) auto!important;gap:8px!important;min-height:60px!important;padding:9px 10px!important}
      #view-owner .ownerFeatureHeader b{font-size:16px!important}
      #view-owner .ownerFeatureHeader small{font-size:8px!important}
      #view-owner .ownerFeatureBody{padding:6px!important}
      #view-owner .ownerBackHome{min-height:48px!important;font-size:14px!important}
    }

    /* Simple Owner job builder v162 */
    #view-owner #ownerJobAssignments .ownerDashBody{max-width:1180px;margin:0 auto!important}
    #view-owner .owner-simple-intro{margin:0 0 10px;padding:10px 12px;border:1px solid #d9e1e7;border-radius:12px;background:#f8fafb;color:#566978;font-size:10px;line-height:1.4}
    #view-owner .owner-simple-intro b{color:#1b2d3c}
    #view-owner .owner-simple-step{margin-top:11px;padding:15px;border:1px solid #d8e0e6;border-radius:15px;background:#fff;box-shadow:0 2px 8px rgba(15,35,52,.04)}
    #view-owner .owner-simple-step-head{display:flex;align-items:center;gap:10px;margin-bottom:11px}
    #view-owner .owner-simple-step-num{width:31px;height:31px;display:grid;place-items:center;flex:none;border-radius:999px;background:#101820;color:#fff;font-size:12px;font-weight:950}
    #view-owner .owner-simple-step-head b{display:block;color:#152838;font-size:16px;line-height:1.05}
    #view-owner .owner-simple-step-head span{display:block;margin-top:3px;color:#71818e;font-size:9px;line-height:1.25}
    #view-owner .owner-simple-pills{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:0 0 10px}
    #view-owner .owner-simple-pills button{min-height:48px;border:1px solid #ced8df;border-radius:999px;background:#f7f9fa;color:#344b5c;font-size:11px;font-weight:900}
    #view-owner .owner-simple-pills button.selected{border-color:#d20b12;background:#d20b12;color:#fff;box-shadow:0 3px 10px rgba(210,11,18,.18)}
    #view-owner .owner-simple-pills.role-pills button{border-radius:12px;min-height:57px;padding:8px}
    #view-owner .owner-simple-pills.role-pills button small{display:block;margin-top:2px;font-size:7px;font-weight:700;opacity:.78}
    #view-owner .owner-simple-hidden-select{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}
    #view-owner .owner-simple-review{border:2px solid #d8e0e6;border-radius:14px;padding:13px;background:#f8fafb}
    #view-owner .owner-simple-review.ready{border-color:#82c39a;background:#eff9f2}
    #view-owner .owner-simple-review.pending{border-color:#e2b353;background:#fff9e9}
    #view-owner .owner-simple-review h3{margin:0!important;font-size:16px!important;color:#152838!important}
    #view-owner .owner-simple-review p{margin:4px 0 0;color:#617481;font-size:10px;line-height:1.4}
    #view-owner .owner-simple-review-list{display:grid;gap:6px;margin-top:9px}
    #view-owner .owner-simple-review-list div{display:flex;align-items:flex-start;gap:7px;padding:8px 9px;border-radius:9px;background:#fff;color:#4c6070;font-size:10px;font-weight:750}
    #view-owner .owner-simple-review-list i{font-style:normal;color:#b06e00;font-weight:950}
    #view-owner .owner-simple-summary{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
    #view-owner .owner-simple-summary span{padding:6px 8px;border:1px solid #d7e0e6;border-radius:999px;background:#fff;color:#435867;font-size:8px;font-weight:900}
    #view-owner .owner-simple-assign{width:100%;min-height:58px!important;margin-top:10px!important;border-radius:999px!important;font-size:15px!important;font-weight:950!important}
    #view-owner #ownerAssignDraftStatus{padding:7px 10px;border-radius:9px;background:#edf5fb;color:#426177;font-weight:750}
    #view-owner #ownerAssignParts .wl-owner-equipment-qty{border-radius:11px!important}
    #view-owner #ownerAssignParts .wl-owner-equipment-qty input{min-height:42px!important;font-size:15px!important;font-weight:900!important}
    @media(max-width:720px){
      #view-owner .owner-simple-pills{grid-template-columns:repeat(2,minmax(0,1fr))}
      #view-owner .owner-simple-step{padding:12px}
    }

    /* Classic Owner dashboard restore v86 */
    #view-owner #ownerCompactShell,
    #view-owner .ownerFeaturePage,
    #view-owner .ownerHomeMain{display:none!important}
    #view-owner #ownerJobAssignments,
    #view-owner #ownerLiveJobProgress,
    #view-owner #ownerAttentionCard,
    #view-owner #ownerIntakeTracking,
    #view-owner #ownerUnitStatusCard,
    #view-owner #ownerHandoffsCard,
    #view-owner #ownerActivityCard,
    #view-owner #ownerAccountsCard,
    #view-owner #ownerResetCard{width:100%!important;max-width:100%!important}
    @media(min-width:900px){.wl-home{max-width:none!important}.wl-menu{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.wl-menu button,.wl-big{min-height:110px}.wl-title{font-size:34px}.wl-sub{max-width:760px}.wl-head{padding:18px 20px}.wl-question{padding:22px}.wl-question .qtext{font-size:24px}.wl-options{max-width:760px}.wl-options button{min-height:70px}.wl-nav{grid-template-columns:minmax(160px,.55fr) minmax(260px,1fr);max-width:760px}.wl-ticket{padding:18px}.wl-gallery{grid-template-columns:repeat(4,minmax(0,1fr))}.wl-gallery img{height:150px}}
    @media(max-width:560px){.wl-title{font-size:25px}.wl-sub{font-size:15px;margin-bottom:14px}.wl-menu{gap:10px}.wl-menu button,.wl-big{font-size:18px;min-height:72px;padding:15px 16px}.wl-nav{grid-template-columns:1fr 1.45fr;position:sticky;bottom:0;background:#f3f6f9;padding:8px 0 4px;z-index:15}.wl-nav button{min-height:58px}.wl-question{padding:15px}.wl-question .qtext{font-size:20px}.wl-options button{min-height:64px}.wl-head{margin-bottom:10px}.wl-ticket{padding:12px}.wl-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-sign canvas{height:160px}}
  `;
  s.textContent += `
    #view-svc{color:#fff!important}
    #view-svc>.card:not(#wlSvcHome):not(#wlSvcLookup):not(#wlInspection):not(#wlSvcWizardOnly):not(#wlSvcFieldAssignment){display:none}
    #view-svc .wl-service-simple-home,
    #view-svc .wl-service-simple-card,
    #view-svc #wlSvcWizardOnly,
    #view-svc #wlSvcFieldAssignment,
    #view-svc #wlInspection{
      max-width:820px!important;margin:18px auto!important;padding:18px!important;
      background:#071117!important;border:1px solid #263943!important;border-radius:16px!important;
      color:#fff!important;box-shadow:0 18px 45px rgba(0,0,0,.28)!important
    }
    #view-svc .wl-service-simple-shell{text-align:center;padding:28px 10px 10px}
    #view-svc .wl-service-simple-kicker,
    #view-svc .wl-service-step-label,
    #view-svc .qnum{color:#ff343b!important;font-size:13px!important;font-weight:950!important;letter-spacing:.12em!important}
    #view-svc .wl-service-simple-shell h1{margin:10px 0 8px!important;color:#fff!important;font-size:clamp(34px,7vw,64px)!important;line-height:1!important;font-weight:1000!important;letter-spacing:-.04em!important}
    #view-svc .wl-service-simple-shell p{margin:0 auto 24px!important;max-width:620px;color:#c7d1d6!important;font-size:20px!important;font-weight:800!important;line-height:1.35!important}
    #view-svc .wl-service-start{
      width:100%!important;min-height:82px!important;border:1px solid #ff3b42!important;border-radius:12px!important;
      background:#e31821!important;color:#fff!important;font-size:24px!important;font-weight:1000!important;letter-spacing:.02em!important;
      box-shadow:0 10px 28px rgba(227,24,33,.22)!important
    }
    #view-svc .wl-service-flowline{margin:20px 0;color:#82949e!important;font-size:12px!important;font-weight:900!important;letter-spacing:.05em!important}
    #view-svc .wl-service-flowline b{color:#ff343b!important;padding:0 5px}
    #view-svc .wl-service-more{margin-top:26px;border-top:1px solid #263943;padding-top:12px;text-align:left}
    #view-svc .wl-service-more summary{cursor:pointer;color:#8fa2ad;font-size:11px;font-weight:900;letter-spacing:.1em;text-align:center}
    #view-svc .wl-service-more-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
    #view-svc .wl-service-more-grid button,
    #view-svc .wl-service-backstep,
    #view-svc .wl-back{min-height:46px!important;border:1px solid #334954!important;border-radius:9px!important;background:#101e25!important;color:#dce6ea!important;font-weight:900!important}
    #view-svc .wl-back{width:auto!important;padding:0 16px!important;margin:0 0 16px!important}
    #view-svc .wl-service-backstep{width:100%!important;margin-top:14px!important}
    #view-svc .wl-head{background:#0b1920!important;border:1px solid #2a414d!important;color:#fff!important;border-radius:12px!important}
    #view-svc .wl-head h2{color:#fff!important;font-size:clamp(24px,5vw,38px)!important;font-weight:1000!important}
    #view-svc .wl-head .kicker{color:#ff343b!important;font-weight:950!important}
    #view-svc .wl-progress{background:#24343d!important}
    #view-svc .wl-progress span{background:#e31821!important}
    #view-svc .wl-question,
    #view-svc .wl-review,
    #view-svc .wl-ticket,
    #view-svc .wl-proof{background:#0b1920!important;border:1px solid #2a414d!important;color:#fff!important;border-radius:14px!important}
    #view-svc .wl-question .qtext{color:#fff!important;font-size:clamp(25px,5.4vw,42px)!important;line-height:1.12!important;font-weight:1000!important;text-transform:uppercase!important}
    #view-svc .wl-options{grid-template-columns:1fr 1fr!important;gap:12px!important}
    #view-svc .wl-options button{min-height:86px!important;border-radius:12px!important;font-size:24px!important;font-weight:1000!important}
    #view-svc .wl-options .pass{background:#fff!important;border:2px solid #fff!important;color:#0b1115!important}
    #view-svc .wl-options .fail{background:#e31821!important;border:2px solid #ff444b!important;color:#fff!important}
    #view-svc input,#view-svc select,#view-svc textarea{
      min-height:62px!important;background:#02080c!important;border:2px solid #39515d!important;border-radius:10px!important;
      color:#fff!important;font-size:22px!important;font-weight:900!important;padding:10px 14px!important
    }
    #view-svc input::placeholder{color:#60737d!important}
    #view-svc .wl-stop{background:#2a0d10!important;border:2px solid #e31821!important;color:#fff!important;border-radius:12px!important;font-size:16px!important}
    #view-svc .wl-stop b{color:#ff5a60!important;font-size:20px!important}
    #view-svc .wl-stop a{background:#e31821!important;color:#fff!important}
    #view-svc .wl-service-ticket-entry{text-align:center;padding:28px!important}
    #view-svc .wl-service-ticket-entry input{width:100%!important;text-align:center!important;font-size:32px!important;letter-spacing:.06em!important}
    #view-svc .wl-service-help{margin-top:12px;color:#8497a1!important;font-size:13px!important;font-weight:700!important;text-align:center}
    #view-svc .wl-service-ticket-found{margin-top:14px;padding:24px;background:#0b1920;border:1px solid #2a414d;border-radius:14px;text-align:center}
    #view-svc .wl-service-ticket-number{font-size:clamp(38px,8vw,66px);font-weight:1000;color:#fff;line-height:1;margin:10px 0}
    #view-svc .wl-service-ticket-site{font-size:22px;font-weight:900;color:#cbd5da;margin-bottom:18px}
    #view-svc .wl-service-good{padding:16px;border:1px solid #4d6977;border-radius:10px;background:#101e25;color:#fff;font-size:20px;font-weight:1000;text-align:center}
    #view-svc .wl-service-wait{padding:16px;border:2px solid #e31821;border-radius:10px;background:#2a0d10;color:#fff;font-size:20px;font-weight:1000;text-align:center}
    #view-svc .wl-nav{background:#071117!important}
    #view-svc .wl-next{background:#e31821!important;color:#fff!important}
    #view-svc .wl-prev{background:#101e25!important;border:1px solid #334954!important;color:#dce6ea!important}
    #view-svc .wl-service-auto-bool + .wl-nav .wl-next{display:none!important}
    #view-svc .small,#view-svc .wl-note{color:#a8b7be!important}
    @media(max-width:560px){
      #view-svc .wl-service-simple-home,#view-svc .wl-service-simple-card,#view-svc #wlSvcWizardOnly,#view-svc #wlSvcFieldAssignment,#view-svc #wlInspection{margin:8px 0!important;padding:12px!important;border-radius:12px!important}
      #view-svc .wl-service-simple-shell{padding:20px 4px 8px}
      #view-svc .wl-service-start{min-height:76px!important;font-size:22px!important}
      #view-svc .wl-options button{min-height:78px!important;font-size:22px!important}
      #view-svc .wl-service-more-grid{grid-template-columns:1fr}
      #view-svc .wl-nav{position:static!important;padding-top:8px!important}
    }
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
async function returnCounts() { const { data } = await liveDb.from('unit_returns').select('id,status,ticket_no,unit_tag,equipment_type,returned_at').order('returned_at',{ascending:true}); const rows=data||[]; const waitingRows=rows.filter(r=>r.status==='waiting_it'); return { waiting:waitingRows.length, inventory:rows.filter(r=>r.status==='pending_mhelp_inventory').length, replacement:rows.filter(r=>r.status==='needs_replacement').length, completed:rows.filter(r=>r.status==='completed').length, nextWaiting:waitingRows[0]||null }; }
async function returnRows() { const { data,error }=await liveDb.from('unit_returns').select('*').order('returned_at',{ascending:false}); if(error) throw error; return data||[]; }
async function returnPhotoHtml(paths) {
  const items = await Promise.all((paths || []).map(async path => {
    const { data, error } = await liveDb.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return `<div class='wl-note'>Photo unavailable — the saved file could not be loaded.</div>`;
    return `<a class='wl-return-photo' href='${esc(data.signedUrl)}' target='_blank'><img src='${esc(data.signedUrl)}' alt='Unit photo' loading='lazy'><span>View full photo</span></a>`;
  }));
  return items.join('');
}
async function myReturnCounts() { const { data: { session } } = await liveDb.auth.getSession(); if (!session?.user?.id) return { waiting:0, inventory:0, replacement:0, completed:0 }; const { data } = await liveDb.from('unit_returns').select('status').eq('service_tech_id', session.user.id); const rows=data||[]; return { waiting:rows.filter(r=>r.status==='waiting_it').length, inventory:rows.filter(r=>r.status==='pending_mhelp_inventory').length, replacement:rows.filter(r=>r.status==='needs_replacement').length, completed:rows.filter(r=>r.status==='completed').length }; }
async function releasedPrepCount() { const { data } = await liveDb.from('prep_tickets').select('id').eq('status','released'); return (data||[]).length; }
async function myTruckSpareData() {
  const { data:{ session } }=await liveDb.auth.getSession();
  if (!session?.user?.id) return {units:[],batteries:[]};
  const [prepQ,batteryQ]=await Promise.all([
    liveDb.from('prep_tickets')
      .select('id,ticket_no,site,closed_at,closed_by,prep_items(id,unit_tag,equipment_type,purpose,spare_outcome,spare_checked_out_at,spare_checked_out_to)')
      .eq('status','closed').eq('closed_by',session.user.id)
      .order('closed_at',{ascending:false}).limit(50),
    liveDb.from('truck_spare_batteries').select('*')
      .eq('service_tech_id',session.user.id).eq('status','in_truck')
      .order('accepted_at',{ascending:true})
  ]);
  if (prepQ.error) throw prepQ.error;
  if (batteryQ.error) throw batteryQ.error;
  const units=(prepQ.data||[]).flatMap(p=>(p.prep_items||[])
    .filter(i=>i.purpose==='BACKUP' && i.spare_checked_out_at && i.spare_checked_out_to===session.user.id && !i.spare_outcome)
    .map(i=>({...i,ticket_no:p.ticket_no,site:p.site,closed_at:p.closed_at})));
  return {units,batteries:batteryQ.data||[]};
}
function truckSpareServiceHtml(spares) {
  const units=spares?.units||[], batteries=spares?.batteries||[];
  if (!units.length && !batteries.length) return '';
  const unitHtml=units.map(i=>`<div class='wl-ticket'><b>${esc(i.equipment_type)} ${esc(i.unit_tag||'')}</b><div class='small'>MHelpDesk #${esc(i.ticket_no)} · Truck BACKUP</div><div class='small top8'>Was this spare actually used today?</div><div class='grid2 top8'><button class='wl-big wl-gray' style='min-height:50px;font-size:15px' data-wl-spare-unit-return='${i.id}'>RETURN UNUSED → IT INTAKE</button><button class='wl-big wl-blue' style='min-height:50px;font-size:15px' data-wl-spare-unit-used='${i.id}'>USED FOR SWAP</button></div></div>`).join('');
  const batteryHtml=batteries.map(b=>`<div class='wl-ticket'><b>${esc(b.battery_type)}</b><div class='small'>MHelpDesk #${esc(b.ticket_no)} · ${Number(b.qty_prepared||0)} spare prepared for ${esc(b.equipment_type)}</div><label class='top8'>How many were USED?<input id='wlSpareUsed_${b.id}' type='number' inputmode='numeric' min='0' max='${Number(b.qty_prepared||0)}' value='0'></label><button class='wl-big wl-blue top8' style='min-height:50px;font-size:15px' data-wl-spare-battery-resolve='${b.id}' data-wl-spare-battery-max='${Number(b.qty_prepared||0)}'>CHECK IN BATTERY SPARES</button><div class='small'>Anything not used is automatically recorded as returned unused.</div></div>`).join('');
  return `<div class='wl-stop top10' data-wl-truck-spares>
    <b>TRUCK SPARES TO RESOLVE · ${units.length+batteries.length}</b>
    <div>Before ending the day, resolve every backup that IT handed off to you. <b>Unused complete backup units return through IT Intake</b> after transport so IT can verify them before they become available Shop Inventory again. If you used a spare for a swap, mark it USED and return the failed/replaced field unit through the normal IT Intake flow.</div>
    ${unitHtml}${batteryHtml}
  </div>`;
}

async function serviceWorkData() {
  const { data:{ session } } = await liveDb.auth.getSession();
  const inspectionRequired=serviceInspectionRequiredToday();
  if (!session?.user?.id) return { assignments:[], released:[], inspectionDone:false, inspectionRequired, deployed:[] };
  const dayStart = new Date(); dayStart.setHours(0,0,0,0);
  const [assignments,releasedQ,returnedQ,deployedQ,inspectionQ] = await Promise.all([
    myActiveAssignments('service'),
    liveDb.from('prep_tickets').select('id,ticket_no,site,released_at,created_at').eq('status','released').order('released_at',{ascending:true}),
    liveDb.from('unit_returns').select('ticket_no,unit_tag').eq('service_tech_id',session.user.id),
    liveDb.from('prep_tickets').select('id,ticket_no,site,closed_at,closed_by,prep_items(id,unit_tag,equipment_type,purpose,spare_outcome,swap_outcome,swap_installed_site,swap_site_registration_status)').eq('status','closed').eq('closed_by',session.user.id).order('closed_at',{ascending:false}).limit(30),
    liveDb.from('morning_checks').select('id').eq('service_tech_id',session.user.id).gte('submitted_at',dayStart.toISOString()).limit(1)
  ]);
  const activeTickets=new Set((assignments||[]).map(a=>norm(a.ticket_no)));
  const released=(releasedQ.data||[]).filter(p=>activeTickets.has(norm(p.ticket_no)));
  const returned = new Set((returnedQ.data||[]).map(r => `${norm(r.ticket_no)}|${norm(r.unit_tag)}`));
  const deployed = (deployedQ.data||[]).flatMap(p => (p.prep_items||[]).filter(i => {
    if (!i.unit_tag || returned.has(`${norm(p.ticket_no)}|${norm(i.unit_tag)}`)) return false;
    if (i.purpose==='BACKUP') return i.spare_outcome==='used';
    if (i.purpose==='SWAP') return i.swap_outcome==='installed';
    return true;
  }).map(i => ({ prep_item_id:i.id, ticket_no:p.ticket_no, site:p.site, closed_at:p.closed_at, unit_tag:i.unit_tag, equipment_type:i.equipment_type, purpose:i.purpose, spare_outcome:i.spare_outcome })));
  return { assignments:assignments||[], released, inspectionDone:(inspectionQ.data||[]).length>0, inspectionRequired, deployed };
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
let ownerAIAckRows = [];
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
function serviceInspectionRequiredToday(value = new Date()) {
  const d=value instanceof Date ? value : new Date(value);
  const day=d.getDay();
  return day>=1 && day<=5;
}

function helpStepsForRole(role = currentRoleKey()) {
  if (role === 'service') return [
    { kicker:'WELCOME', title:'Service Tech · How Tech Check Works', body:`<p>Tech Check is your technician workflow. <b>MHelpDesk stays separate.</b> Use the MHelpDesk reference in Tech Check to make sure you are working on the correct ticket.</p><p>Each new delivery, pickup, service call, or swap uses its own current MHelpDesk ticket. When that job is finished, it closes. The <b>unit number stays universal</b> in Tech Check so the unit history can follow it across different tickets.</p>` },
    { kicker:'MY WORK TODAY', title:'Start with the work assigned to you', body:`<p>Owner-assigned jobs appear at the top of <b>My Work Today</b>. A job may be assigned directly to you or to the <b>Service Department queue</b>.</p><p>Tap <b>Open Service Job</b>, enter the exact current MHelpDesk ticket, tap <b>Find Job</b>, verify the ticket preview, then choose <b>Take This Job</b>. If it is a department-queue job, Take This Job claims it to you and the Owner can see which Service Tech took responsibility.</p>` },
    { kicker:'START THE DAY', title:'Truck Check → Trailer Check → Today’s Tasks', body:`<p><b>Monday–Friday only:</b> complete the Truck Check one question at a time. If you are taking a trailer, complete the Trailer Check next.</p><p>That is the complete start-day gate right now. <b>No spare unit, battery count, or spare checkout is required to pass the morning check.</b> After you submit it, go straight to <b>Today’s Tasks</b>.</p>` },
    { kicker:'RECEIVE FROM IT', title:'Receive equipment from the named IT Tech', body:`<p>When IT creates the handoff, Tech Check shows the MHelpDesk ticket, customer/site, exact units, parts, and the name of the <b>IT Tech who prepared the handoff</b>.</p><p>Do not accept equipment just because it is physically there. First make sure the Tech Check job matches your current MHelpDesk ticket.</p>` },
    { kicker:'VERIFY THE HANDOFF', title:'Physically check every unit and part', body:`<p>Verify the exact unit tags, battery/battery-box counts, photos, and every listed part quantity before accepting the handoff.</p><p>If Tech Check says IT Tech Teddy prepared Unit 058 and two SIM cards, you should physically have Unit 058 and two SIM cards before continuing. A mismatch should be corrected before you accept the equipment.</p>` },
    { kicker:'SOLAR DELIVERY CHECKOUT', title:'Solar Spotter and Ranger support is assigned automatically', body:`<p>For a <b>Solar Spotter DELIVERY</b>, finish checking the Solar Spotter first. Tech Check then automatically requires <b>one Solar Stand per Solar Spotter</b>. In Service checkout, select the battery setup actually installed on that stand: <b>4 × AGM 12V 110Ah</b> or <b>1 × 12V 350Ah</b> per stand. Enter the stand tag, verify the MPPT update/test, verify the selected battery setup is charged, connect the solar panel + battery system + MPPT together, and confirm charging.</p><p>Take a clear Solar Stand tag photo and upload a picture of the MPPT / charging readings. Battery proof and Service sign-off are also saved. For a <b>Ranger DELIVERY</b>, Tech Check automatically requires <b>one solar panel and one LiTime 12V 110Ah battery per Ranger</b>, and Service verifies the Ranger MPPT and charging. Helios requires its battery box in the Service checkout plus Cerbo + MPPT verification.</p>` },
    { kicker:'FIELD WORK', title:'Delivery, service, pickup, or swap', body:`<p>Use the current MHelpDesk ticket for the task you are doing today. A later visit gets a new ticket number even if the same unit is involved.</p><p>For a swap or pickup, the unit number lets Tech Check remember that equipment across old closed tickets and the new current ticket.</p>` },
    { kicker:'TRUCK SPARES', title:'Resolve every truck backup after the call', body:`<p>IT may hand you a <b>BACKUP / truck spare</b> unit or extra batteries for the current MHelpDesk job. These are contingency items in case a field unit or battery is bad.</p><p>If a spare unit was <b>not used</b>, choose <b>RETURN UNUSED → IT INTAKE</b>. IT must verify it after transport before it can return to Shop Inventory. If it was used for a swap, mark it <b>USED FOR SWAP</b> and return the failed/replaced field unit through normal IT Intake. For spare batteries, enter the quantity used and Tech Check returns the remainder unused.</p>` },
    { kicker:'RETURN TO IT', title:'Return equipment to the right place', body:`<p>Most equipment coming back from the field uses <b>Return Unit to IT Intake</b>. Record the MHelpDesk reference, unit tag, condition, notes, and required photos.</p><p><b>110V Stand exception:</b> put the stand on the trailer, bring it back to the shop, and return it directly to <b>Shop Inventory</b> from Service. If the stand has no tag, choose <b>110V Stand — No Tag</b>; no tag does not block the return and IT Intake is not required.</p><p>For Helios and other solar equipment, Tech Check performs an AI-assisted OCR scan of the tag photo and compares it to the expected unit tag. A clear mismatch requires a new photo; an unreadable scan falls back to technician visual confirmation.</p>` },
    { kicker:'DAILY TOOLS', title:'Inspection, phone alerts, and history', body:`<p>Complete the Truck / Trailer Inspection from your own account. Assigned work appears in <b>My Work Today</b>. Use History to review work that has already been submitted.</p><p>Open <b>Menu → Phone Alerts</b> once on your phone if you want Tech Check to alert you when the Owner sends new work.</p>` },
    { kicker:'SERVICE FLOW', title:'Your simple Service flow', body:`<div class='wl-help-flow'><b>TRUCK CHECK</b><span>→</span><b>TRAILER CHECK IF NEEDED</b><span>→</span><b>TODAY’S TASKS</b><span>→</span><b>VERIFY IT HANDOFF</b><span>→</span><b>SERVICE / FIELD WORK</b></div><p>Solar-panel hookup and charging verification happen on the <b>Service side after the IT → Service handoff</b>. Optional truck spares are handled only when a specific job actually has one.</p>` },
  ];
  if (role === 'owner') return [
    { kicker:'OWNER HELP', title:'Dispatch with control', body:`<p>Create a Tech Check job using the current MHelpDesk reference. Assign it directly to a specific IT Tech or Service Tech, or assign it to the department queue for a technician to claim.</p>` },
    { kicker:'LIVE PROGRESS', title:'See who took the task', body:`<p>The Owner dashboard shows the job's real stage, such as <b>Waiting for Tech / Assigned → Claimed / In Process → Tech Check In Progress → Ready for Service → Service Verify / Solar Checkout → Done</b>. Department jobs change from waiting to the technician’s name as soon as that person claims the task.</p>` },
    { kicker:'ROLE SEPARATION', title:'IT and Service stay separate', body:`<p><b>IT + Service</b> means IT prepares the equipment first and Service waits for the Service handoff. <b>Service + IT</b> means Service works first and IT waits for the returned equipment before Intake.</p><p><b>Pickup always starts with Service.</b> Returning equipment goes through IT Intake before shelf inventory.</p>` },
    { kicker:'TRUCK SPARES', title:'Monitor contingency equipment that is still out', body:`<p>IT can add a <b>BACKUP / Truck Spare</b> to a Service ticket without changing the customer/job equipment manifest. The Owner Equipment Handoffs area shows truck spares that Service has not resolved yet.</p><p>An <b>unused</b> complete backup unit returns through IT Intake before Shop Inventory. A spare marked <b>USED</b> stays with the field job, while the failed/replaced field unit follows the normal Service → IT Intake → Owner/Manager inventory flow.</p>` },
    { kicker:'NEEDS ATTENTION', title:'Vision alerts stay visible until the condition is resolved', body:`<p>OnSite Vision records detected workflow problems in <b>Needs Attention</b>. You can acknowledge an alert to show that you saw it, but acknowledgement does <b>not</b> remove the issue. It stays active until the underlying Tech Check condition clears.</p><p>After the condition clears, the alert is marked resolved and remains in permanent alert history.</p>` },
    { kicker:'OWNER REVIEW', title:'Review the complete job before closing it', body:`<p>A job becomes <b>Ready for Owner Review</b> only after the recorded Tech Check workflow supports the closeout overview: <b>Owner assigned → IT completed → IT → Service handoff completed → Service completed → equipment/returns accounted for → evidence complete</b>.</p><p><b>Close Job</b> finalizes the Tech Check review only. It does not change MHelpDesk.</p>` },
    { kicker:'RETURN FOR CORRECTION', title:'Route a correction without erasing completed work', body:`<p>If something must be corrected, choose <b>Return for Correction</b>, enter the reason, and choose IT or Service. Tech Check records the Owner decision permanently and automatically creates or reuses one active correction task in that department queue.</p><p>The earlier completed records stay intact. While correction work is active, the job is not ready to close. When the correction is completed, the job returns to <b>Ready for Owner Review</b>. MHelpDesk remains separate.</p>` },
    { kicker:'COMPANY HISTORY', title:'Use the permanent Technician, Unit, and Customer / Site history', body:`<p>Company History reads the permanent Tech Check record instead of inventing missing activity. Search a technician, unit number, or customer / site to see linked recorded events even after jobs close or units return to Shop Inventory.</p><p>If a procedure or event was never recorded, Tech Check should show <b>MISSING INFORMATION</b> rather than make one up.</p>` },
    { kicker:'UNIT HISTORY', title:'Tickets close; units continue', body:`<p>Every new MHelpDesk job is a new job. Unit numbers remain universal in Tech Check so the same unit can be followed across different closed tickets.</p>` },
  ];
  return [
    { kicker:'WELCOME', title:'IT Tech · How Tech Check Works', body:`<p>Tech Check is your equipment-prep and intake workflow. <b>MHelpDesk stays separate.</b> Use the MHelpDesk reference in Tech Check to make sure you are working on the correct ticket.</p><p>Owner-assigned work is the normal flow, but IT can still create an <b>on-the-fly Equipment Prep</b> when the job requires it.</p>` },
    { kicker:'MY WORK TODAY', title:'Assigned work appears first', body:`<p>Your Owner may assign a job directly to you or to the <b>IT Department queue</b>. Direct jobs are already yours. Department jobs can be claimed by an IT Tech.</p><p>When you claim a department task, the Owner immediately has a named IT Tech responsible for that work.</p>` },
    { kicker:'ON THE FLY', title:'IT can still start its own check', body:`<p>If an unexpected need comes up, use <b>Start New Equipment Prep</b>. Enter the current MHelpDesk reference, customer/site, total units/devices, exact device and stand quantities, and any parts required.</p><p>This does not create or change anything in MHelpDesk. It only makes the Tech Check workflow correspond to the correct job.</p>` },
    { kicker:'DEPLOYMENT', title:'Pull the real equipment from shelf inventory', body:`<p>For an assigned job, read the ticket information and requested equipment/parts first. Pull the actual units from the shelf, enter the exact unit tags, and complete each required check one unit at a time.</p><p>The unit tag is permanent in Tech Check. Old MHelpDesk jobs can close while the unit history continues.</p>` },
    { kicker:'OPTIONAL SPARES', title:'Only handle a backup when the job actually needs one', body:`<p>Truck spares are <b>not part of the morning Truck / Trailer Check</b> and are not required for every Service Tech day.</p><p>If a specific job truly needs contingency equipment, use <b>Manage Truck Spares</b> for that job and follow the normal IT checkout. Otherwise, skip this completely and keep the normal IT prep → Service handoff flow simple.</p>` },
    { kicker:'SERVICE HANDOFF', title:'Complete the named handoff', body:`<p>After the required <b>IT shop checks</b>, photo, signature, and readiness items pass, create the handoff to Service.</p><p><b>IT does not hook solar panels to units in the shop.</b> Service performs solar-panel / PV charging verification after receiving the IT → Service handoff. Tech Check records the IT Tech who prepared the equipment.</p>` },
    { kicker:'INTAKE & RETURNS', title:'IT receives equipment coming back from Service', body:`<p>IT Intake is for tagged equipment returning from Service. The return shows the <b>Service Tech name</b>, MHelpDesk reference, unit tag, notes, and photos.</p><p>Complete the intake checks, document the unit, and move it through the Owner/Manager step before it returns to shelf inventory.</p>` },
    { kicker:'MENU & HISTORY', title:'Help, phone alerts, and history', body:`<p>Use <b>Menu → Help Center</b> anytime you want to replay this walkthrough. Your assigned work stays under <b>My Work Today</b>, and Status & History shows previous IT work.</p><p>Open <b>Menu → Phone Alerts</b> once on your phone if you want Tech Check to alert you when new work is sent.</p>` },
    { kicker:'IT FLOW', title:'Your complete IT flow', body:`<div class='wl-help-flow'><b>OWNER / IT QUEUE</b><span>→</span><b>OPEN / CLAIM IT JOB</b><span>→</span><b>PULL FROM SHELF</b><span>→</span><b>TECH CHECK</b><span>→</span><b>CREATE SERVICE HANDOFF</b></div><p>Returns travel the other direction: <b>Service → IT Intake → Owner/Manager → Shelf Inventory.</b></p>` },
  ];
}
function ensureHelpOverlay() {
  let overlay = document.getElementById('wlHelpOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'wlHelpOverlay';
  overlay.className = 'wl-help-overlay hidden';
  overlay.innerHTML = `<div class='wl-help-sheet'>
    <div class='wl-help-head'>
      <div class='wl-help-brand'>
        <span class='wl-help-brand-icon'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span>
        <div><div class='wl-next-kicker'>TECH CHECK</div><h2 id='wlHelpTitle'>Help Center</h2></div>
      </div>
      <button class='wl-help-close-btn' data-wl-help-close aria-label='Close help'>×</button>
    </div>
    <div id='wlHelpBody'></div>
  </div>`;
  document.body.append(overlay);
  return overlay;
}

let helpCenterRole = null;
let helpWalkthroughRole = null;

function helpRoleName(role){
  return role==='owner' ? 'Owner / Admin' : role==='service' ? 'Service Tech' : 'IT Technician';
}
function helpRoleIcon(role){
  return role==='owner' ? 'O' : role==='service' ? 'S' : 'IT';
}
function helpFlowHtml(role){
  if(role==='owner') return "<div class='wl-help-flow-map'><span>OWNER ASSIGNS</span><i>→</i><span>IT PREP + SPARES</span><i>→</i><span>SERVICE VERIFY</span><i>→</i><span>FIELD WORK</span><i>→</i><span>RESOLVE SPARES / RETURNS</span></div>";
  if(role==='service') return "<div class='wl-help-flow-map'><span>OPEN MHELP TICKET</span><i>→</i><span>VERIFY IT HANDOFF</span><i>→</i><span>FIELD WORK</span><i>→</i><span>RESOLVE TRUCK SPARES</span><i>→</i><span>RETURN FAILED / FIELD UNITS</span></div>";
  return "<div class='wl-help-flow-map'><span>ASSIGNED / CLAIM</span><i>→</i><span>PULL JOB EQUIPMENT</span><i>→</i><span>ADD TRUCK SPARES</span><i>→</i><span>TECH CHECK + PROOF</span><i>→</i><span>CREATE HANDOFF</span></div>";
}
function helpTopicsForRole(role){
  if(role==='owner') return [
    {id:'assign',icon:'+',title:'Assign a new job',desc:'MHelpDesk reference, equipment, department flow, and technician assignment.',body:"<p>Use the <b>current MHelpDesk ticket</b> as the source of truth. Enter the reference, site, work date, job description, equipment quantities/numbers, parts, and department flow.</p><p>You can assign directly to a named technician or leave it in the department queue. AI Dispatch can prepare the draft, but <b>you still review and send it</b>.</p>"},
    {id:'progress',icon:'◎',title:'Track live jobs',desc:'See who owns the work, the handoff stage, and what is still open.',body:"<p><b>Live Job Progress</b> shows assigned/waiting work and jobs already in progress. Once a department-queue job is claimed, the technician's name becomes visible to the Owner.</p><p>Use the AI status as an advisory signal: green is on track, yellow is waiting/pending, and red needs Owner attention.</p>"},
    {id:'handoff',icon:'⇄',title:'Understand IT → Service handoff',desc:'What IT finishes and what Service must verify.',body:"<p>IT completes the required unit checks, photos, signature, and readiness items, then creates the <b>Service handoff</b>. Service opens the same MHelpDesk reference and physically verifies the handed-off equipment before continuing.</p>"},
    {id:'spares',icon:'↔',title:'Track truck spares',desc:'See contingency units and batteries that are still riding with Service.',body:"<p>Truck spares are tied to the same MHelpDesk job but are separate from the customer equipment manifest. In <b>Equipment Handoffs</b>, watch <b>Truck Spares Still Out</b>. Service resolves each one as used or returned unused. Unused complete backup units return through IT Intake before Shop Inventory; failed/replaced field equipment goes through IT Intake as well.</p>"},
    {id:'returns',icon:'↩',title:'Returns & IT Intake',desc:'Follow equipment from Service back to shelf inventory.',body:"<p>Service records the returning unit, condition, notes, and photos. IT Intake receives it and completes the intake checklist. The Owner/Manager completes the final inventory confirmation before the unit returns to shelf inventory.</p>"},
    {id:'team',icon:'👥',title:'Technicians & activity',desc:'Accounts, activity, resets, and accountability.',body:"<p>Use <b>Technician Accounts</b> for logins/access and <b>Recent Activity</b> to review submitted work. Tech Check keeps the named technician attached to work they claimed, prepared, verified, or returned.</p>"},
    {id:'ai',icon:'AI',title:'Use OnSite Vision',desc:'Ask about jobs, get next steps, speak requests, or prepare a new ticket draft.',body:"<p>Ask OnSite Vision a normal question such as <b>Tell me about Monday’s Helios delivery</b> or <b>What needs attention today?</b>. Vision looks at Tech Check records and gives the current status and next step.</p><p>When you want a new assignment, say <b>Create a new ticket...</b>. Vision will fill the draft but <b>never sends a job by itself.</b></p>"}
  ];
  if(role==='service') return [
    {id:'find',icon:'⌕',title:'Open the correct Service job',desc:'Use the exact current MHelpDesk ticket number.',body:"<p>Service jobs stay hidden until you enter the <b>exact current MHelpDesk reference</b>. This prevents the wrong job from being opened just because the same unit was used on an older ticket.</p>"},
    {id:'handoff',icon:'⇄',title:'Verify the IT handoff',desc:'Confirm the named IT Tech, exact units, checked-out spares, parts, and quantities.',body:"<p>Before accepting the handoff, physically match the unit tags and listed parts to Tech Check. Any Truck Spare must show <b>IT CHECKED OUT</b> before you take it. Spare battery batches also show the IT checkout quantity and technician. Do not accept a mismatch.</p>"},
    {id:'solar',icon:'☀',title:'Solar / Helios checkout',desc:'Solar Stand, batteries, MPPT, charging proof, Ranger, and Helios.',body:"<p><b>Solar Spotter delivery:</b> Service verifies the assigned Solar Stand, required batteries, MPPT update/test, and active charging with the solar panel + batteries + MPPT connected. Upload the stand tag and charging/reading proof.</p><p><b>Ranger:</b> verify the required solar panel and charging. <b>Helios:</b> physically verify the required battery box, then complete the Service-side Cerbo/MPPT verification and proof photos.</p>"},
    {id:'field',icon:'→',title:'Complete the field work',desc:'Delivery, service, swap, or pickup using the current ticket.',body:"<p>Work from the current MHelpDesk job. The MHelpDesk ticket changes from job to job, but the unit number remains universal inside Tech Check so history follows the equipment.</p>"},
    {id:'return',icon:'↩',title:'Return a unit to IT',desc:'Record the ticket, unit, condition, notes, and photos.',body:"<p>Use <b>Return Unit to IT Intake</b> when equipment comes back from the field. The return is recorded under your Service Tech name, then IT receives it through Intake.</p>"},
    {id:'inspection',icon:'✓',title:'Truck / Trailer Inspection',desc:'Complete your inspection from your own account.',body:"<p>Truck / Trailer Inspections are required <b>Monday through Friday only</b>. Complete the inspection from your own Service account so the record reflects the correct technician. Submitted inspections remain available in History.</p>"},
    {id:'alerts',icon:'!',title:'Phone alerts & history',desc:'Enable alerts once and review completed work.',body:"<p>Open <b>Menu → Phone Alerts</b> on your device to enable assignment alerts. Use History to review previously submitted Service work.</p>"}
  ];
  return [
    {id:'assigned',icon:'1',title:'Start assigned IT work',desc:'Direct assignments and department-queue jobs.',body:"<p>Owner-assigned jobs appear in <b>My Work Today</b>. Direct jobs are already assigned to you. Department-queue jobs can be claimed by an IT Tech; once claimed, the Owner sees who took responsibility.</p>"},
    {id:'prep',icon:'+',title:'Start Equipment Prep',desc:'Use Owner assignment or start an on-the-fly prep when needed.',body:"<p>For an unexpected need, <b>Start New Equipment Prep</b> using the current MHelpDesk reference. This creates the Tech Check workflow only; it does not create or edit the MHelpDesk ticket.</p>"},
    {id:'deployment',icon:'✓',title:'Complete deployment checks',desc:'Pull the exact equipment and finish every required check.',body:"<p>Enter the exact unit tags and complete the required equipment-specific checks one unit at a time. Required photos, tag confirmation, signature, and readiness checks must be complete before handoff.</p>"},
    {id:'helios',icon:'H',title:'Helios IT checks',desc:'Cameras, router ports, speaker, Cerbo/VRM, SD cards, and shop readiness.',body:"<p>IT completes the Helios hardware, programming, ports, Cerbo/VRM, battery-box, recording, SD-card, monitoring, and customer-access checks.</p><p><b>Do not connect a solar panel or perform PV charging verification in IT.</b> Service performs the solar / yard charging check after the IT → Service handoff.</p>"},
    {id:'handoff',icon:'⇄',title:'Create the Service handoff',desc:'Finish IT and hand the verified equipment to Service.',body:"<p>After all required IT checks, photos, signatures, and readiness items pass, create the <b>Service handoff</b>. Service must open the same MHelpDesk ticket and verify the exact handed-off equipment.</p>"},
    {id:'intake',icon:'↩',title:'IT Intake & returns',desc:'Receive equipment returning from Service.',body:"<p>IT Intake shows the Service Tech, ticket, unit tag, notes, and photos. Complete every intake check, document the unit, and move it to the Owner/Manager confirmation step before shelf inventory.</p>"},
    {id:'alerts',icon:'!',title:'Phone alerts & history',desc:'Enable alerts once and review previous IT work.',body:"<p>Open <b>Menu → Phone Alerts</b> on your device to receive new-assignment alerts. Use Status & History to review prior IT work.</p>"}
  ];
}
function renderHelpCenter(roleOverride=null){
  const overlay=ensureHelpOverlay();
  const body=document.getElementById('wlHelpBody');
  const title=document.getElementById('wlHelpTitle');
  helpCenterRole=roleOverride||helpCenterRole||currentRoleKey()||'it';
  if(!['owner','it','service'].includes(helpCenterRole)) helpCenterRole='it';
  if(title) title.textContent='Help Center';
  const topics=helpTopicsForRole(helpCenterRole);
  const steps=helpStepsForRole(helpCenterRole);
  body.innerHTML=`
    <section class='wl-help-home-hero'>
      <div>
        <span>TRAINING CENTER</span>
        <h3>${esc(helpRoleName(helpCenterRole))}</h3>
        <p>Quick answers, role workflows, and step-by-step training. Help mode does not change live Tech Check jobs.</p>
      </div>
      <span class='wl-help-safe'>TRAINING ONLY</span>
    </section>
    <div class='wl-help-role-tabs'>
      <button type='button' data-wl-help-role='owner' class='${helpCenterRole==='owner'?'selected':''}'><b>O</b><span>Owner</span></button>
      <button type='button' data-wl-help-role='it' class='${helpCenterRole==='it'?'selected':''}'><b>IT</b><span>IT Tech</span></button>
      <button type='button' data-wl-help-role='service' class='${helpCenterRole==='service'?'selected':''}'><b>S</b><span>Service</span></button>
    </div>
    <section class='wl-help-start-card'>
      <div><span class='wl-help-start-icon'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><div><b>${steps.length}-step ${esc(helpRoleName(helpCenterRole))} walkthrough</b><small>Best for new team members or a full refresher.</small></div></div>
      <button type='button' data-wl-help-walkthrough>Start Walkthrough →</button>
    </section>
    <section class='wl-help-flow-section'>
      <div class='wl-help-section-title'><b>Role workflow</b><span>THE BIG PICTURE</span></div>
      ${helpFlowHtml(helpCenterRole)}
    </section>
    <section class='wl-help-status-section'>
      <div class='wl-help-section-title'><b>Status colors</b><span>WHAT THEY MEAN</span></div>
      <div class='wl-help-status-grid'>
        <div class='ready'><i></i><span><b>Green</b><small>Ready, started, working, or on track</small></span></div>
        <div class='pending'><i></i><span><b>Yellow</b><small>Pending, waiting, or review needed</small></span></div>
        <div class='stop'><i></i><span><b>Red</b><small>Stop, blocked, missing, or action required</small></span></div>
        <div class='neutral'><i></i><span><b>Gray</b><small>Draft, neutral, or inactive</small></span></div>
      </div>
    </section>
    <section class='wl-help-topics'>
      <div class='wl-help-section-title'><b>How do I…?</b><span>QUICK HELP</span></div>
      <div class='wl-help-topic-grid'>
        ${topics.map(t=>`<button type='button' data-wl-help-topic='${esc(t.id)}'><span class='wl-help-topic-icon'>${esc(t.icon)}</span><span><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></span><strong>›</strong></button>`).join('')}
      </div>
    </section>
    <section class='wl-help-rule-card'>
      <b>MHelpDesk and Tech Check are separate.</b>
      <span>Always use the current MHelpDesk ticket as the job source of truth. Tech Check records the workflow, evidence, handoffs, returns, and universal unit history.</span>
    </section>
  `;
  overlay.classList.remove('hidden');
}
function renderHelpTopic(topicId){
  const body=document.getElementById('wlHelpBody');
  const title=document.getElementById('wlHelpTitle');
  const role=helpCenterRole||currentRoleKey()||'it';
  const topic=helpTopicsForRole(role).find(t=>t.id===topicId);
  if(!body||!topic) return renderHelpCenter(role);
  if(title) title.textContent='Quick Help';
  body.innerHTML=`
    <button type='button' class='wl-help-back' data-wl-help-center>← Help Center</button>
    <section class='wl-help-topic-detail'>
      <div class='wl-help-topic-detail-head'>
        <span class='wl-help-topic-icon large'>${esc(topic.icon)}</span>
        <div><span>${esc(helpRoleName(role)).toUpperCase()}</span><h3>${esc(topic.title)}</h3><p>${esc(topic.desc)}</p></div>
      </div>
      <div class='wl-help-topic-copy'>${topic.body}</div>
    </section>
    <div class='wl-help-topic-actions'>
      <button type='button' data-wl-help-walkthrough>Replay Full ${esc(helpRoleName(role))} Walkthrough</button>
      <button type='button' data-wl-help-center>Back to Help Center</button>
    </div>
  `;
}
async function openHelpCenter(roleOverride=null){
  document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
  helpWalkthroughMode='help-center';
  helpCenterRole=roleOverride||currentRoleKey()||'it';
  const tech=await currentTechIdentity().catch(()=>null);
  if(tech?.id) liveDb.from('technician_training_state').upsert({user_id:tech.id,last_help_opened_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'}).then(()=>{}).catch(()=>{});
  renderHelpCenter(helpCenterRole);
}


function helpStepGuide(role, step){
  const key=(role||'it')+':'+String(step?.kicker||'').toUpperCase();
  const guides={
    'owner:OWNER HELP':{
      steps:[
        'Tap Create / Assign Job.',
        'Copy the current MHelpDesk reference, customer/site, work date, and job description.',
        'Enter the exact equipment quantities and unit / stand numbers from MHelpDesk.',
        'Choose the department flow and technician assignment.',
        'Review the draft or AI Preflight, then send the Tech Check job yourself.'
      ],
      selector:'#ownerJobAssignments > summary, #ownerJobAssignments'
    },
    'owner:LIVE PROGRESS':{
      steps:[
        'Tap Live Job Progress.',
        'Open the active MHelpDesk job you want to review.',
        'Read the current stage, assigned technician, and handoff status.',
        'Use the AI status and timeline as an advisory check for waiting or attention items.',
        'Follow up only when the job shows a real blocked or Owner-action state.'
      ],
      selector:'#ownerLiveJobProgress > summary, #ownerLiveJobProgress'
    },
    'owner:ROLE SEPARATION':{
      steps:[
        'Choose IT + Service when IT must prepare equipment before Service can start.',
        'Choose Service + IT when Service works first and IT should wait for returned equipment.',
        'For Pickup, always start with Service; IT Intake begins only after Service checks the equipment back in.',
        'For IT + Service, IT completes the unit checks. Any Truck Spare must also be explicitly checked out by IT before the Service handoff can be created.',
        'IT Intake and Owner / Manager inventory confirmation finish returned-equipment flow.'
      ],
      selector:'#ownerAssignRole'
    },
    'owner:TRUCK SPARES':{
      steps:[
        'Open Equipment Handoffs.',
        'Look for Truck Spares Still Out.',
        'The card shows the Service Tech, MHelpDesk reference, spare unit or battery type, and anything still unresolved.',
        'Unused complete backup units enter IT Intake when Service checks them in and are not Shop Inventory until intake is completed; used spares remain field equipment.',
        'A failed/replaced field unit still follows the normal Return & Intake process.'
      ],
      selector:'#ownerHandoffsCard > summary, #ownerHandoffsCard'
    },
    'owner:UNIT HISTORY':{
      steps:[
        'Tap Unit Status & Search.',
        'Enter the permanent Tech Check unit number.',
        'Search to see the unit’s current status and prior Tech Check history.',
        'Use the unit number for history even when the old MHelpDesk ticket has already closed.'
      ],
      selector:'#ownerUnitStatusCard > summary, #ownerUnitStatusCard'
    },

    'service:WELCOME':{
      steps:[
        'Open the Service Tech tab.',
        'Work from the current MHelpDesk ticket for today’s job.',
        'Use Tech Check for the technician workflow; do not treat it as a replacement for MHelpDesk.',
        'Use the permanent unit number to recognize equipment across different MHelpDesk jobs.'
      ],
      selector:'#tab-svc'
    },
    'service:MY WORK TODAY':{
      steps:[
        'Open Field Work on the Service Tech home.',
        'Enter the exact current MHelpDesk ticket number.',
        'Tap Open Service Job / Find Job.',
        'If the job is in the Service department queue, claim it before continuing.',
        'Confirm the customer/site and equipment match the ticket you are actually working.'
      ],
      selector:'#wlSvcHome'
    },
    'service:RECEIVE FROM IT':{
      steps:[
        'Open the exact MHelpDesk Service job.',
        'Read the IT handoff information and the name of the IT Tech who prepared it.',
        'For every truck spare, confirm Tech Check shows that IT checked it out before you take it.',
        'Physically locate every listed unit and part before accepting anything.',
        'Do not continue if the ticket, unit tag, or quantities do not match.'
      ],
      selector:'#wlSvcHome'
    },
    'service:VERIFY THE HANDOFF':{
      steps:[
        'Compare each physical unit tag to the handed-off unit shown in Tech Check.',
        'For a Truck Spare, confirm it shows IT CHECKED OUT before taking it.',
        'Verify required batteries / battery boxes, checked-out spare batteries, and every listed replacement part.',
        'Review the IT evidence that belongs to the handed-off equipment.',
        'Answer each Service verification step truthfully.',
        'Stop and correct a mismatch before you accept the handoff.'
      ],
      selector:'#wlSvcLookup'
    },
    'service:SOLAR DELIVERY CHECKOUT':{
      steps:[
        'Finish the handed-off Solar Spotter / Ranger / Helios verification first.',
        'Enter the assigned Solar Stand tag when a Solar Spotter requires one.',
        'Select the actual Solar Spotter battery setup when applicable, then verify MPPT update / test and the required battery / battery-box equipment.',
        'Connect the solar panel + batteries + MPPT and confirm active charging.',
        'Upload the stand-tag photo and MPPT / charging readings before Service sign-off.'
      ],
      selector:"[data-wl-save-service-solar]"
    },
    'service:FIELD WORK':{
      steps:[
        'Keep the current MHelpDesk reference tied to the work you are doing today.',
        'Complete the required Service Tech Check before equipment leaves the shop.',
        'Perform the delivery, service call, pickup, or swap.',
        'If equipment returns from the field, start Return Unit to IT Intake.'
      ],
      selector:'#wlSvcHome'
    },
    'service:TRUCK SPARES':{
      steps:[
        'Open Truck Spares to Resolve on Service Home after the field call.',
        'For a backup unit you did NOT use, tap RETURN UNUSED → IT INTAKE. IT verifies it after transport before it can return to Shop Inventory.',
        'If you used a backup unit for a swap, tap USED FOR SWAP.',
        'If a spare replaced a failed field unit, return the failed/replaced unit through the normal Return Unit to IT Intake flow.',
        'For spare batteries, enter how many were used. Tech Check records the rest as returned unused.'
      ],
      selector:"[data-wl-truck-spares]"
    },
    'service:RETURN TO IT':{
      steps:[
        'Tap Return Unit to IT Intake / Shop.',
        'Enter the current MHelpDesk reference.',
        'For normal equipment, choose or enter the exact unit tag. For a tagless 110V Stand, tap 110V STAND — NO TAG.',
        'Take / upload the required return photo. Tagged equipment keeps the normal tag verification rules.',
        'A 110V Stand goes directly from Service back to Shop Inventory after pickup; IT Intake is not required.',
        'All other returned field equipment continues through normal IT Intake.'
      ],
      selector:"[data-wl-service-return]"
    },
    'service:DAILY TOOLS':{
      steps:[
        'Monday through Friday, tap Truck / Trailer Inspection from your own Service account. Weekend inspections are not required.',
        'Complete every required inspection item and submit it under your name.',
        'Use History to review previously submitted Service work.',
        'Enable Menu → Phone Alerts once on your phone if you want assignment notifications.'
      ],
      selector:"[data-wl-svc='inspect']"
    },
    'service:SERVICE FLOW':{
      steps:[
        'Open / claim the correct Service job.',
        'Receive and verify the IT handoff when IT prep is involved.',
        'Complete any required Solar / Helios Service checkout.',
        'Perform the field work.',
        'Resolve every Truck Spare after the call: unused complete backup units return through IT Intake before Shop Inventory; used/replaced field equipment follows the normal return flow.'
      ],
      selector:'#wlSvcHome'
    },

    'it:WELCOME':{
      steps:[
        'Open the IT Technician tab.',
        'Check My Work Today for Owner-assigned or department-queue work.',
        'Use the current MHelpDesk reference for the job you are preparing.',
        'Use Tech Check for equipment prep / intake while MHelpDesk remains separate.'
      ],
      selector:'#tab-it'
    },
    'it:MY WORK TODAY':{
      steps:[
        'Look at My Work Today first.',
        'Open a direct assignment, or claim an IT department-queue job.',
        'Confirm the MHelpDesk reference, site, equipment, and Owner notes.',
        'Then begin the required equipment prep.'
      ],
      selector:'#wlItHome'
    },
    'it:ON THE FLY':{
      steps:[
        'Tap Start New Equipment Prep.',
        'Enter the current MHelpDesk reference and customer/site.',
        'Choose the exact units / devices, stands, and parts required.',
        'Create the IT Equipment Prep and begin the one-unit-at-a-time checks.'
      ],
      selector:"[data-wl-it='new']"
    },
    'it:DEPLOYMENT':{
      steps:[
        'Read the requested equipment and parts before pulling anything from the shelf.',
        'Pull the actual unit and enter its permanent unit tag.',
        'Complete each required equipment-specific question in order.',
        'Take the required photo. For Helios and other solar equipment, the AI-assisted tag scan compares the visible tag to the expected unit tag.',
        'A clear AI mismatch requires a new photo. If the scan cannot read the tag, visually verify it yourself.',
        'Sign the unit check and review readiness before handoff.'
      ],
      selector:"[data-wl-it='new']"
    },
    'it:TRUCK SPARES':{
      steps:[
        'From Ticket Summary, tap Manage Truck Spares to open the separate Truck Spares / Backups page.',
        'Add a spare unit when Service should carry an emergency replacement for this ticket.',
        'Complete the full hardware/deploy-ready IT check, matching-tag photo, and signature for the BACKUP unit.',
        'Tap CHECK OUT SPARE after the unit is fully ready. Service cannot take it until IT checks it out.',
        'For extra Solar Spotter, Ranger, Helios, or Recon II batteries, save the READY quantity and then tap CHECK OUT SPARE BATTERIES.',
        'This is optional job-specific contingency equipment. If the job has no requested backup/spare, skip this page completely.'
      ],
      selector:"[data-wl-truck-spares-it]"
    },
    'it:SERVICE HANDOFF':{
      steps:[
        'Finish every required IT equipment check.',
        'Confirm required photos, visible tag match, and IT signature are complete.',
        'Resolve every readiness issue shown by Tech Check.',
        'If the specific job includes an optional Truck Spare, complete its checkout. Otherwise skip spares.',
        'Create the Service handoff after the required IT job-equipment checks are complete.',
        'Physically hand Service the exact equipment and parts listed on the same ticket.'
      ],
      selector:'#wlItWizardOnly'
    },
    'it:INTAKE & RETURNS':{
      steps:[
        'Open Intake & Returns.',
        'Choose the returned unit waiting for IT.',
        'Review the Service Tech name, MHelpDesk reference, notes, and return photos.',
        'Complete every IT Intake check and add the required Intake photo.',
        'Send the completed intake to Owner / Manager for final MHelpDesk inventory confirmation.'
      ],
      selector:"[data-wl-mode='intake']"
    },
    'it:MENU & HISTORY':{
      steps:[
        'Use Status & History to review prior IT prep work.',
        'Use Menu → Help Center whenever you need these training steps again.',
        'Use Menu → Phone Alerts once on your phone if you want new-assignment notifications.'
      ],
      selector:"[data-wl-it='history']"
    },
    'it:IT FLOW':{
      steps:[
        'Open or claim the IT job.',
        'Pull the exact equipment from shelf inventory.',
        'Complete the full Tech Check for each unit.',
        'Finish photo, signature, and readiness review.',
        'Create the Service handoff when Service is the next department.'
      ],
      selector:'#wlItHome'
    }
  };
  return guides[key] || {
    steps:[
      'Read the Tech Check instruction shown on this step.',
      'Confirm you are working from the correct current MHelpDesk ticket.',
      'Complete the matching action in Tech Check before moving forward.',
      'If anything does not match the physical equipment or current ticket, stop and correct it first.'
    ],
    selector:null
  };
}
function helpStepHowToHtml(role, step){
  const guide=helpStepGuide(role,step);
  const canShow=Boolean(guide.selector) && (currentRoleKey()===role || currentRoleKey()==='owner');
  return `
    <div class='wl-help-howto'>
      <div class='wl-help-howto-head'><span>HOW TO DO IT</span><b>${guide.steps.length} steps</b></div>
      <ol>${guide.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>
      ${canShow ? "<button type='button' data-wl-help-show-step>Show me in the app →</button>" : ''}
      <small>Training guidance only. “Show me” highlights the control but never submits or changes a live job.</small>
    </div>
  `;
}
function showHelpStepInApp(){
  const role=helpWalkthroughRole || currentRoleKey();
  const steps=helpStepsForRole(role);
  const step=steps[Math.max(0,Math.min(helpWalkthroughStep,steps.length-1))];
  const guide=helpStepGuide(role,step);
  if(!guide.selector) return;

  const overlay=document.getElementById('wlHelpOverlay');
  overlay?.classList.add('hidden');

  // Owners can preview the matching Owner / IT / Service surface without changing any records.
  if(currentRoleKey()==='owner'){
    const tabId=role==='owner' ? 'tab-owner' : role==='service' ? 'tab-svc' : 'tab-it';
    document.getElementById(tabId)?.click();
  }

  setTimeout(()=>{
    const target=document.querySelector(guide.selector);
    if(!target){
      renderHelpWalkthrough();
      const body=document.getElementById('wlHelpBody');
      if(body){
        const note=document.createElement('div');
        note.className='wl-help-show-note';
        note.textContent='Open the matching job or workflow first, then tap “Show me in the app” again.';
        body.prepend(note);
      }
      return;
    }
    target.scrollIntoView({behavior:'smooth',block:'center'});
    target.classList.add('wl-help-live-highlight');
    let toast=document.getElementById('wlHelpCoachToast');
    if(!toast){
      toast=document.createElement('div');
      toast.id='wlHelpCoachToast';
      toast.className='wl-help-coach-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML="<b>Training pointer</b><span>This is the control for the step you just read.</span><button type='button' data-wl-help-coach-return>Back to Help</button>";
    toast.classList.add('show');
    setTimeout(()=>target.classList.remove('wl-help-live-highlight'),3200);
  },320);
}

function renderHelpWalkthrough() {
  const overlay = ensureHelpOverlay();
  const body = document.getElementById('wlHelpBody');
  const steps = helpStepsForRole(helpWalkthroughRole || currentRoleKey());
  helpWalkthroughStep = Math.max(0, Math.min(helpWalkthroughStep, steps.length - 1));
  const step = steps[helpWalkthroughStep];
  const helpTitle=document.getElementById('wlHelpTitle'); if(helpTitle) helpTitle.textContent='Step-by-Step Training';
  const pct = Math.round((helpWalkthroughStep + 1) / steps.length * 100);
  const firstTime = helpWalkthroughMode === 'first';
  const last = helpWalkthroughStep === steps.length - 1;
  const walkthroughRole=helpWalkthroughRole || currentRoleKey();
  body.innerHTML = `<div class='wl-help-progress'><span style='width:${pct}%'></span></div><div class='wl-help-step-count'>${helpWalkthroughStep + 1} of ${steps.length}</div><div class='wl-help-card'><div class='wl-next-kicker'>${esc(step.kicker)}</div><h2>${esc(step.title)}</h2><div class='wl-help-copy'>${step.body}</div>${helpStepHowToHtml(walkthroughRole,step)}</div><div class='wl-help-nav'><button class='wl-prev' data-wl-help-prev ${helpWalkthroughStep === 0 ? 'disabled' : ''}>Back</button>${firstTime && helpWalkthroughStep === 0 ? `<button class='wl-help-skip' data-wl-help-skip>Skip for now</button>` : '<span></span>'}<button class='wl-next ${last ? 'wl-finish' : ''}' data-wl-help-next>${last ? (firstTime ? 'Finish Setup ✓' : 'Close Help') : 'Next →'}</button></div>`;
  overlay.classList.remove('hidden');
}
async function openHelpWalkthrough(firstTime = false, roleOverride = null) {
  helpWalkthroughMode = firstTime ? 'first' : 'help';
  helpWalkthroughRole = firstTime ? null : (roleOverride || helpCenterRole || currentRoleKey());
  helpWalkthroughStep = 0;
  if (!firstTime) {
    const tech = await currentTechIdentity().catch(() => null);
    if (tech?.id) await liveDb.from('technician_training_state').upsert({ user_id:tech.id, last_help_opened_at:new Date().toISOString(), updated_at:new Date().toISOString() }, { onConflict:'user_id' });
  }
  renderHelpWalkthrough();
}
async function completeHelpWalkthrough() {
  if (helpWalkthroughMode !== 'first') { helpWalkthroughMode='help-center'; return renderHelpCenter(helpWalkthroughRole || helpCenterRole || currentRoleKey()); }
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
      <div><div class='wl-next-kicker'>TECH CHECK</div><h2 id='wlTechMenuTitle'>Menu</h2></div>
      <button class='wl-menu-close-btn' data-wl-menu-close aria-label='Close menu'>×</button>
    </div>
    <div id='wlTechMenuBody'></div>
  </div>`;
  document.body.append(panel);
  return panel;
}
async function openTechMenu() {
  const panel = ensureTechMenuPanel();
  const body = document.getElementById('wlTechMenuBody');
  const title = document.getElementById('wlTechMenuTitle');
  const role = currentRoleKey();

  panel.classList.toggle('wl-owner-menu', role === 'owner');
  if (title) title.textContent = role === 'owner' ? 'Owner Menu' : 'Menu';

  if (role === 'owner') {
    body.innerHTML = `
      <div class='wl-owner-menu-primary'>
        <button class='wl-owner-menu-ai' data-wl-menu-ai-dispatch>
          <span class='wl-owner-menu-ai-icon'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span>
          <span><b>Owner AI Dispatch</b><small>Create or dictate a Tech Check job</small></span>
          <strong>›</strong>
        </button>
      </div>
      <div class='wl-owner-menu-utilities'>
        <button class='wl-owner-menu-util' data-wl-menu-help>
          <span class='wl-owner-menu-util-icon'>?</span>
          <span><b>Help Center</b><small>Guides, walkthroughs & quick answers</small></span>
        </button>
        <button class='wl-owner-menu-util' data-wl-menu-refresh>
          <span class='wl-owner-menu-util-icon'>↻</span>
          <span><b>Refresh Data</b><small>Reload Tech Check</small></span>
        </button>
      </div>
    `;
    panel.classList.remove('hidden');
    return;
  }

  const push = await pushAlertState();
  const pushLabel = !push ? '' : push.ready ? 'Phone alerts are enabled on this device.' : push.permission === 'denied' ? 'Phone alerts are blocked in this device settings.' : 'Enable once if you want new assignments to alert this phone.';
  body.innerHTML = `
    <div class='wl-app-menu-list'>
      <button class='wl-app-menu-item' data-wl-menu-help>
        <span class='wl-app-menu-icon'>?</span>
        <span><b>Help Center</b><small>Guides, walkthroughs & quick answers.</small></span>
        <strong>›</strong>
      </button>
      <button class='wl-app-menu-item' data-wl-menu-phone-alerts>
        <span class='wl-app-menu-icon'>↗</span>
        <span><b>Phone Alerts</b><small>${esc(pushLabel)}</small></span>
        <strong>${push?.ready ? 'ON' : '›'}</strong>
      </button>
      <button class='wl-app-menu-item' data-wl-menu-refresh>
        <span class='wl-app-menu-icon'>↻</span>
        <span><b>Refresh Tech Check</b><small>Reload the latest assignments, equipment, and workflow status.</small></span>
        <strong>›</strong>
      </button>
    </div>
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
    role === 'service' ? notificationToggle('wlPrefService','Equipment ready for Service',prefs.equipment_ready_service,'When IT creates a Service handoff for checkout.') : '',
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
let equipmentMemoryCache=new Map();
async function loadEquipmentMemory(tags=[]){
  const clean=[...new Set(tags.map(v=>String(v||'').trim()).filter(Boolean))];if(!clean.length)return new Map();
  const missing=clean.filter(t=>!equipmentMemoryCache.has(t));
  if(missing.length){
    const {data}=await liveDb.from('unit_returns').select('unit_tag,equipment_type,ticket_no,status,service_tech_name,returned_at,it_tech_name,it_received_at,completed_at,damage_notes,return_notes').in('unit_tag',missing).order('created_at',{ascending:false}).limit(200);
    missing.forEach(t=>equipmentMemoryCache.set(t,[]));(data||[]).forEach(x=>equipmentMemoryCache.set(String(x.unit_tag),(equipmentMemoryCache.get(String(x.unit_tag))||[]).concat(x)));
  }
  return new Map(clean.map(t=>[t,equipmentMemoryCache.get(t)||[]]));
}
function equipmentRecurringIssueAnalysis(rows=[]){
  const cats=[
    ['camera',/camera|ptz|lens|video|image|ir\b/i],
    ['SD card',/sd\s*card|micro\s*sd|storage|format/i],
    ['power',/power|offline|won't turn|wont turn|voltage|electronic/i],
    ['battery',/battery|batteries|charge|charging/i],
    ['connectivity',/network|connect|offline|modem|sim|signal|cellular|internet/i],
    ['speaker',/speaker|audio/i],
    ['MPPT / solar',/mppt|solar|panel/i]
  ];
  const counts=new Map(),tickets=new Map();
  rows.forEach(r=>{const text=[r.damage_notes,r.return_notes].filter(Boolean).join(' ');if(!text)return;cats.forEach(([name,re])=>{if(re.test(text)){counts.set(name,(counts.get(name)||0)+1);if(!tickets.has(name))tickets.set(name,new Set());tickets.get(name).add(String(r.ticket_no||'—'));}})});
  return [...counts.entries()].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(([name,n])=>({name,count:n,tickets:[...(tickets.get(name)||[])]}));
}
function equipmentRecurringIssueHtml(rows=[]){
  const recurring=equipmentRecurringIssueAnalysis(rows);if(!recurring.length)return '';
  return `<div class='wl-ai-repeat-issues'><div class='wl-ai-head'>${onsiteVisionTitle('History Pattern')}<b>RECURRING ISSUE</b></div>${recurring.map(x=>`<div><b>⚠ ${esc(x.name)} mentioned in ${x.count} prior records</b><span>MHelpDesk: ${x.tickets.slice(0,5).map(t=>'#'+esc(t)).join(', ')}</span></div>`).join('')}<div class='small top8'>Pattern detection uses prior Tech Check notes only. IT must still perform the current physical checks.</div></div>`;
}
function equipmentHealthHistoryHtml(tag,rows=[]){
  if(!rows.length)return '';
  const sorted=[...rows].sort((a,b)=>new Date(b.completed_at||b.it_received_at||b.returned_at||0)-new Date(a.completed_at||a.it_received_at||a.returned_at||0));
  const recurring=equipmentRecurringIssueAnalysis(rows);
  const events=sorted.flatMap(r=>{
    const out=[];
    if(r.returned_at)out.push({when:r.returned_at,title:'Returned from field',detail:'MHelpDesk #'+(r.ticket_no||'—')+(r.service_tech_name?' · Service: '+r.service_tech_name:'')});
    if(r.it_received_at)out.push({when:r.it_received_at,title:'IT Intake received',detail:(r.it_tech_name?'IT: '+r.it_tech_name:'')});
    if(r.completed_at)out.push({when:r.completed_at,title:'IT Intake completed',detail:r.status||'Completed'});
    if(r.damage_notes||r.return_notes)out.push({when:r.returned_at||r.it_received_at||r.completed_at,title:'Issue / return notes',detail:r.damage_notes||r.return_notes,issue:true});
    return out;
  }).sort((a,b)=>new Date(b.when||0)-new Date(a.when||0));
  return `<details class='wl-unit-health'><summary><span>📈 Unit Health History</span><span class='pill'>${events.length} EVENTS</span></summary><div><div class='wl-unit-health-head'><b>${esc(tag)}</b><span>${rows.length} Tech Check record${rows.length===1?'':'s'}${recurring.length?' · '+recurring.length+' recurring pattern'+(recurring.length===1?'':'s'):''}</span></div><div class='wl-unit-timeline'>${events.slice(0,18).map(e=>`<div class='wl-unit-event ${e.issue?'issue':''}'><i></i><div><b>${esc(e.title)}</b><span>${e.when?esc(ownerTimelineWhen(e.when)):'Date not recorded'}</span><p>${esc(e.detail||'')}</p></div></div>`).join('')}</div></div></details>`;
}
function equipmentMemoryHtml(tag,rows=[]){
  if(!rows.length)return `<div class='wl-equipment-memory'><b>🧠 Equipment Memory · ${esc(tag)}</b><span>No prior Tech Check return/intake history found. History will build as this equipment moves through the app.</span></div>`;
  const last=rows[0], issues=rows.filter(r=>String(r.damage_notes||r.return_notes||'').trim()).length;
  return `<details class='wl-equipment-memory'><summary><span>🧠 Equipment Memory · ${esc(tag)}</span><span class='pill'>${rows.length} HISTORY</span></summary><div><div class='small'><b>Last MHelpDesk:</b> #${esc(last.ticket_no||'—')} · ${esc(last.equipment_type||'Equipment')} · ${esc(last.status||'Recorded')}</div>${last.completed_at?`<div class='small'><b>Last intake completed:</b> ${esc(ownerTimelineWhen(last.completed_at))}${last.it_tech_name?' · '+esc(last.it_tech_name):''}</div>`:''}${issues?`<div class='wl-ai-warn top8'>⚠ ${issues} prior history record${issues===1?'':'s'} include notes/issues. Review before sending this equipment back to the field.</div>`:`<div class='wl-ai-good top8'>✓ No prior return/intake notes are recorded in the available history.</div>`}${equipmentRecurringIssueHtml(rows)}${equipmentHealthHistoryHtml(tag,rows)}<details class='top8'><summary>Previous Tech Check records</summary>${rows.slice(0,6).map(r=>`<div class='small top8'><b>#${esc(r.ticket_no||'—')}</b> · ${esc(r.status||'Recorded')}${r.completed_at?' · '+esc(ownerTimelineWhen(r.completed_at)):''}${r.damage_notes||r.return_notes?'<br>Notes: '+esc(r.damage_notes||r.return_notes):''}</div>`).join('')}</details></div></details>`;
}
async function injectEquipmentMemory(root=document){
  const nodes=[...root.querySelectorAll('[data-unit-tag]')];const tags=nodes.map(n=>n.dataset.unitTag).filter(Boolean);if(!tags.length)return;
  const mem=await loadEquipmentMemory(tags);nodes.forEach(n=>{if(n.querySelector('.wl-equipment-memory'))return;n.insertAdjacentHTML('beforeend',equipmentMemoryHtml(n.dataset.unitTag,mem.get(n.dataset.unitTag)||[]));});
}
function techCheckAIAnalysis(a, role){
  const type=String(a?.work_type||'service').toLowerCase(), manifest=a?.equipment_manifest||{}, warnings=[], steps=[];
  const devices=Object.entries(manifest.devices||{}).filter(([,n])=>Number(n)>0);
  const stands=Object.entries(manifest.stands||{}).filter(([,n])=>Number(n)>0);
  const equipment=[...devices,...stands].map(([k,n])=>Number(n)+' '+String(k).replace(/_/g,' '));
  if(type==='pickup'){steps.push('Service performs the field pickup first.','Service checks returned equipment into IT Intake.','IT completes Intake after Service handoff.'); if(role==='it') warnings.push('Do not begin IT Intake until Service has returned/check-in equipment.');}
  else if(a?.requires_it_handoff){steps.push('IT completes required Tech Check.','IT creates the Service handoff.','Service verifies the handed-off equipment.');}
  if(!String(a?.ticket_no||'').trim()) warnings.push('MHelpDesk ticket number is missing.');
  if(!equipment.length) warnings.push('No equipment quantities are listed.');
  if(Number(a?.requested_unit_count||0)>0 && !devices.length) warnings.push('A unit count exists but no device type is listed.');
  return {type,equipment,warnings,steps};
}
function onsiteVisionTitle(label='Equipment Check'){
  return `<span class='wl-ai-brand-inline'><span class='wl-ai-brand-inline-icon'><img src='./techcheck-eye-192.png?v=1' alt=''></span><span class='wl-ai-brand-inline-copy'><small>ONSITE VISION</small><strong>${esc(label)}</strong></span></span>`;
}
function techCheckAIHtml(a,role){
  const x=techCheckAIAnalysis(a,role), status=x.warnings.length?'REVIEW NEEDED':'WORKFLOW CHECK';
  return `<div class='wl-ai-panel'><div class='wl-ai-head'>${onsiteVisionTitle('Workflow Check')}<b>${status}</b></div>
    <div class='small'><b>MHelpDesk #${esc(a?.ticket_no||'—')}</b> · ${esc(String(x.type).toUpperCase())}</div>
    ${x.equipment.length?`<div class='wl-ai-line'><b>Equipment:</b> ${esc(x.equipment.join(', '))}</div>`:''}
    ${x.steps.length?`<div class='wl-ai-line'><b>Expected flow:</b> ${x.steps.map(esc).join(' → ')}</div>`:''}
    ${x.warnings.length?`<div class='wl-ai-warn'>${x.warnings.map(w=>'⚠ '+esc(w)).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ No obvious workflow conflicts found.</div>`}
    <div class='small top8'>AI Assist is advisory only. It cannot change, claim, complete, or reassign a ticket.</div></div>`;
}
async function assignmentGateState(assignment) {
  const workType=String(assignment?.work_type||'').toLowerCase();
  const legacyPickup=!workType && /\bpick[ -]?up\b/i.test(String(assignment?.job_description||''));
  if(workType==='pickup' || legacyPickup){
    if(assignment.assigned_role==='service') return {ready:true,label:'SERVICE FIRST — PICKUP'};
    const {data}=await liveDb.from('unit_returns').select('id,status').eq('ticket_no',assignment.ticket_no).eq('status','waiting_it').order('returned_at',{ascending:true}).limit(1);
    return data?.length ? {ready:true,label:'Service return received',returnId:data[0].id} : {ready:false,label:'WAITING FOR SERVICE RETURN',detail:'Pickup starts with Service. Service must finish the field pickup and check the returned equipment into IT Intake before IT can start.'};
  }
  if (!assignment?.requires_it_handoff) return {ready:true,label:''};
  if (assignment.assigned_role==='service'){
    const {data}=await liveDb.from('prep_tickets').select('id,status').eq('ticket_no',assignment.ticket_no).in('status',['released','closed']).order('released_at',{ascending:false}).limit(1);
    return data?.length ? {ready:true,label:'IT handoff received'} : {ready:false,label:'WAITING FOR IT HANDOFF',detail:'IT must finish its Tech Check and create the Service handoff before Service can start.'};
  }
  const {data}=await liveDb.from('unit_returns').select('id,status').eq('ticket_no',assignment.ticket_no).eq('status','waiting_it').order('returned_at',{ascending:true}).limit(1);
  return data?.length ? {ready:true,label:'Service return received',returnId:data[0].id} : {ready:false,label:'WAITING FOR SERVICE RETURN',detail:'Service must finish the field pickup/return and hand the unit to IT Intake before IT can start.'};
}
function assignmentEquipmentCount(a) {
  return Math.max(1, normalizedEquipmentManifest(a?.equipment_manifest || []).reduce((sum,row)=>sum+Number(row.qty||0),0) || Number(a?.requested_unit_count||0) || 1);
}
async function serviceAssignmentNeedsITReturn(a) {
  if (!a?.ticket_no) return false;
  const { data }=await liveDb.from('job_assignments').select('id').eq('ticket_no',a.ticket_no).eq('assigned_role','it').eq('requires_it_handoff',true).in('status',['assigned','started']).limit(1);
  return Boolean(data?.length);
}
function serviceFieldCard() {
  let card=document.getElementById('wlSvcFieldAssignment');
  if(!card){card=document.createElement('div');card.id='wlSvcFieldAssignment';card.className='card';viewSvc().append(card);}
  return card;
}
async function renderServiceFieldAssignment(a,needsReturn=false) {
  const card=serviceFieldCard();
  const count=assignmentEquipmentCount(a);
  card.innerHTML=`${progress('Service Field Work','MHelpDesk #'+esc(a.ticket_no),2,3)}
    <button class='wl-back' data-wl-home='svc'>← Service Home</button>
    <div class='wl-review'><div class='wl-next-kicker'>SERVICE TASK</div><b style='font-size:24px'>MHelpDesk #${esc(a.ticket_no)}</b><div class='top8'><b>Customer / Site:</b> ${esc(a.site||'Not listed')}</div><div class='top8'><b>Job Type:</b> ${esc(String(a.work_type||'service').toUpperCase())}</div>${a.job_description?`<div class='top8'><b>Work:</b> ${esc(a.job_description)}</div>`:''}${equipmentManifestInlineHtml(a)}${ticketPartsInlineHtml(a)}${a.notes?`<div class='small top8'><b>Owner Notes:</b> ${esc(a.notes)}</div>`:''}</div>
    ${needsReturn?`<div class='warn top10'><b>Service → IT return required</b><div>Complete the field work, then check the returning equipment into IT Intake under this same MHelpDesk ticket. This assignment completes after the required returned equipment is recorded.</div></div><button class='wl-big wl-red top10' data-wl-service-begin-return='${a.id}'>Return Equipment to IT Intake →</button>`:`<div class='ok top10'><b>No IT handoff is required for this Service-only Tech Check task.</b><div>Complete the field work in MHelpDesk, then mark this Tech Check assignment complete. Tech Check does not modify MHelpDesk.</div></div><button class='wl-big wl-green top10' data-wl-service-complete-assignment='${a.id}'>Mark Tech Check Service Task Complete →</button>`}
    <div class='small top10'>Equipment items listed for this assignment: ${count}.</div>`;
  hideChildren(viewSvc(),[card]);
  resetWizardPosition();
}
async function beginServiceReturnForAssignment(id) {
  const { data:rows,error }=await liveDb.from('job_assignments').select('*').eq('id',id).eq('assigned_role','service').limit(1);
  if(error)return alert(error.message);
  const a=rows?.[0]; if(!a)return alert('This Service assignment is no longer available.');
  const tech=await currentTechIdentity().catch(()=>null);
  if(!tech?.id || a.assignee_user_id!==tech.id)return alert('Claim or open this Service job from My Work Today before returning equipment.');
  activeSvcAssignment=a;
  if(a.status!=='started') {
    const {error:startError}=await liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:id,p_status:'started'});
    if(startError)return alert(startError.message);
  }
  serviceReturn={ step:1, ticket:String(a.ticket_no||''), unit:'', type:'', notes:'', photo:null, conditionPhotos:[], damagePhotos:[], knownUnits:await rememberedUnitsForTicket(a.ticket_no) };
  serviceReturnRecovered=false;
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
async function completeServiceFieldAssignment(id) {
  if(!confirm('Mark this Tech Check Service task complete?\n\nThis only updates Tech Check. It does not change MHelpDesk.')) return;
  const {error}=await liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:id,p_status:'completed'});
  if(error)return alert(error.message);
  activeSvcAssignment=null;
  await showSvcHome();
}
async function syncServiceAssignmentAfterReturn(ticket,techId) {
  const {data:rows}=await liveDb.from('job_assignments').select('*').eq('ticket_no',String(ticket||'')).eq('assigned_role','service').eq('assignee_user_id',techId).in('status',['assigned','started']).order('assigned_at',{ascending:false}).limit(1);
  const a=rows?.[0];if(!a)return {completed:false,count:0,required:0};
  const {data:returns}=await liveDb.from('unit_returns').select('id,equipment_type').eq('ticket_no',String(ticket||'')).eq('service_tech_id',techId);
  const returnRows=returns||[];
  const count=returnRows.length;
  const {data:preps}=await liveDb.from('prep_tickets').select('id,status,prep_items(id,unit_tag,equipment_type,purpose,swap_outcome)').eq('ticket_no',String(ticket||'')).eq('status','released').order('released_at',{ascending:false}).limit(5);

  // Any SWAP stays in the field-result workflow until Service records whether
  // the replacement was installed and the required return path is satisfied.
  const activeSwapPrep=(preps||[]).find(p=>(p.prep_items||[]).some(i=>i.purpose==='SWAP'));
  if(activeSwapPrep){
    const swaps=(activeSwapPrep.prep_items||[]).filter(i=>i.purpose==='SWAP');
    const replacementKeys=new Set(swaps.map(i=>norm(i.unit_tag)).filter(Boolean));
    const installed=swaps.filter(i=>i.swap_outcome==='installed');
    const oldReturnRows=returnRows.filter(r=>!replacementKeys.has(norm(r.unit_tag)));
    const required=installed.length;
    return {completed:false,count:oldReturnRows.length,required,fieldPending:true};
  }

  const required=assignmentEquipmentCount(a);
  if(count>=required){
    const {error}=await liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:a.id,p_status:'completed'});
    if(error)console.warn('Return saved but Service assignment could not be completed',error);
    else return {completed:true,count,required};
  }
  return {completed:false,count,required};
}
async function syncITReturnAssignmentAfterIntake(ticket,techId) {
  const {data:rows}=await liveDb.from('job_assignments').select('*').eq('ticket_no',String(ticket||'')).eq('assigned_role','it').eq('assignee_user_id',techId).in('status',['assigned','started']).order('assigned_at',{ascending:false}).limit(1);
  const a=rows?.[0]; if(!a)return;
  const required=assignmentEquipmentCount(a);
  const {data:returns}=await liveDb.from('unit_returns').select('id,status').eq('ticket_no',String(ticket||''));
  const processed=(returns||[]).filter(r=>['pending_mhelp_inventory','needs_replacement','completed'].includes(r.status)).length;
  if(processed>=required){
    const {error}=await liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:a.id,p_status:'completed'});
    if(error)console.warn('IT Intake saved but IT assignment could not be completed',error);
  }
}

async function startAssignedJob(id) {
  let { data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1);
  let assignment = rows?.[0];
  if (!assignment) return alert('That assignment is no longer available.');
  const gate = await assignmentGateState(assignment);
  if (!gate.ready) return alert(gate.label + '\n\n' + gate.detail);

  if (!assignment.assignee_user_id && assignment.assignment_scope === 'department') {
    if(assignment.assigned_role==='service'){
      return showServiceJobLookup();
    }
    if(!confirm('ACCEPT IT JOB\n\nMHelpDesk #'+assignment.ticket_no+'\n'+(assignment.site||'')+'\n\nMake this job yours?')) return;
    const { error: claimError } = await liveDb.rpc('claim_my_department_assignment', { p_assignment_id: id });
    if (claimError) {
      alert(claimError.message || 'Another IT Tech already accepted this job.');
      showITHome();
      return;
    }
    ({ data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1));
    assignment = rows?.[0];
    if (!assignment) return alert('The accepted IT assignment could not be reopened.');
  }

  if (assignment.assigned_role === 'it') {
    if (String(assignment.work_type||'').toLowerCase()==='pickup' || (!assignment.work_type && /\bpick[ -]?up\b/i.test(String(assignment.job_description||'')))) {
      if (assignment.status !== 'started') await liveDb.rpc('set_my_job_assignment_status', { p_assignment_id:id, p_status:'started' });
      const { data: returns } = await liveDb.from('unit_returns').select('id,status').eq('ticket_no',assignment.ticket_no).eq('status','waiting_it').order('returned_at',{ascending:true}).limit(1);
      if (!returns?.length) return alert('WAITING FOR SERVICE RETURN\n\nPickup starts with Service. IT Intake cannot begin until Service checks the returned equipment in.');
      return startITIntake(returns[0].id);
    }
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
  if (String(assignment.work_type || '').toLowerCase()==='pickup' || (!assignment.work_type && /\bpick[ -]?up\b/i.test(String(assignment.job_description||'')))) {
    return beginServiceReturnForAssignment(id);
  }
  if (!assignment.requires_it_handoff) {
    if (assignment.status !== 'started') {
      const {error:startError}=await liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:id,p_status:'started'});
      if(startError)return alert(startError.message);
      assignment.status='started';
    }
    const needsReturn=await serviceAssignmentNeedsITReturn(assignment);
    return renderServiceFieldAssignment(assignment,needsReturn);
  }
  const { data: released } = await liveDb.from('prep_tickets')
    .select('id,ticket_no,status')
    .eq('ticket_no', assignment.ticket_no)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(1);
  if (!released?.length) {
    if (assignment.status !== 'started') await liveDb.rpc('set_my_job_assignment_status', { p_assignment_id: id, p_status: 'started' });
    return alert('This MHelpDesk job is assigned to you, but IT has not created the Service handoff yet. It will stay under My Work Today.');
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


async function fieldEscalationRows() {
  const {data,error}=await liveDb.from('field_escalations').select('*').order('created_at',{ascending:false}).limit(100);
  if(error)throw error;
  return data||[];
}
function fieldEscalationStatusLabel(status) {
  return ({
    waiting_it:'WAITING FOR IT',
    joint_troubleshooting:'SERVICE + IT TROUBLESHOOTING',
    repaired_onsite:'REPAIRED ONSITE',
    backup_swap_authorized:'IT AUTHORIZED BACKUP SWAP',
    failed_unit_in_it_intake:'FAILED UNIT IN IT INTAKE',
    unresolved_owner:'OWNER DECISION REQUIRED',
    owner_resolved:'OWNER RESOLVED'
  })[status]||String(status||'').replaceAll('_',' ').toUpperCase();
}
function fieldEscalationHistoryHtml(row) {
  return '<div class="small top8"><b>Original problem:</b> '+esc(row.original_problem||'—')+'</div>'+
    '<div class="small"><b>Service power/troubleshooting:</b> '+esc(row.service_troubleshooting_notes||'—')+'</div>'+
    (row.it_troubleshooting_notes?'<div class="small"><b>IT troubleshooting:</b> '+esc(row.it_troubleshooting_notes)+'</div>':'')+
    (row.backup_unit_tag?'<div class="small"><b>Authorized backup:</b> '+esc(row.backup_equipment_type||'Unit')+' '+esc(row.backup_unit_tag)+'</div>':'')+
    (row.owner_summary?'<div class="small"><b>Owner summary:</b> '+esc(row.owner_summary)+'</div>':'')+
    (row.owner_resolution?'<div class="small"><b>Owner decision:</b> '+esc(row.owner_resolution)+'</div>':'');
}
function fieldEscalationServiceHtml(rows) {
  const active=(rows||[]).filter(r=>!r.resolved_at);
  const cards=active.map(r=>{
    let action='';
    if(r.status==='backup_swap_authorized') action="<button class='wl-big wl-red top10' data-wl-offline-complete-swap='"+r.id+"' data-wl-offline-backup='"+(r.backup_prep_item_id||"")+"'>USE AUTHORIZED BACKUP & RETURN FAILED UNIT →</button>";
    return "<div class='wl-ticket'><b>Unit "+esc(r.unit_tag)+" · "+esc(fieldEscalationStatusLabel(r.status))+"</b><div class='small'>MHelpDesk #"+esc(r.ticket_no)+" · "+esc(r.site||"No site")+"</div>"+fieldEscalationHistoryHtml(r)+action+"</div>";
  }).join('');
  return "<div class='wl-review top10'><b>OFFLINE UNIT / IT TROUBLESHOOTING</b><div class='small'>Service verifies power first, then Service and IT troubleshoot together. Equipment-specific troubleshooting that has not been taught remains <b>MISSING INFORMATION</b>.</div>"+(cards||"<div class='small top8'>No active offline-unit escalation.</div>")+"<button class='wl-big wl-blue top10' data-wl-offline-start>＋ Offline Unit — Call IT</button></div>";
}
async function showOfflineUnitForm() {
  const work=await serviceWorkData();
  const units=(work.deployed||[]);
  const first=units[0]||{};
  let card=document.getElementById('wlOfflineUnitForm');
  if(!card){card=document.createElement('div');card.id='wlOfflineUnitForm';card.className='card';viewSvc().append(card);}
  const options=units.map((u,i)=>"<option value='"+i+"'>MHelpDesk #"+esc(u.ticket_no)+" · "+esc(u.equipment_type)+" "+esc(u.unit_tag)+"</option>").join('');
  card.innerHTML=progress('Offline Unit','Service power check → call IT',1,1)+
    "<button class='wl-back' data-wl-home='svc'>← Service Home</button>"+
    "<div class='wl-stop'><b>VERIFY POWER BEFORE CALLING IT</b><div>Service checks the unit and verifies power first. Then Service calls IT and both troubleshoot together.</div></div>"+
    (units.length?"<label>Choose unit currently in the field</label><select id='wlOfflineKnownUnit'>"+options+"</select>":"<div class='warn'><b>No deployed unit was found automatically.</b><div>Enter the exact current MHelpDesk and unit information below.</div></div>")+
    "<div class='grid top10'><label>MHelpDesk Ticket #<input id='wlOfflineTicket' value='"+esc(first.ticket_no||"")+"'></label><label>Customer / Site<input id='wlOfflineSite' value='"+esc(first.site||"")+"'></label><label>Offline Unit Tag<input id='wlOfflineUnit' value='"+esc(first.unit_tag||"")+"'></label><label>Equipment Type<input id='wlOfflineType' value='"+esc(first.equipment_type||"")+"'></label></div>"+
    "<label>Original problem<textarea id='wlOfflineProblem' rows='3' placeholder='What is the unit doing or not doing?'></textarea></label>"+
    "<label class='check top8'><input id='wlOfflinePower' type='checkbox'><span>I physically verified power at the unit before calling IT.</span></label>"+
    "<label>Service checks completed before calling IT<textarea id='wlOfflineServiceNotes' rows='4' placeholder='Record the power check and general troubleshooting completed. Do not invent equipment-specific steps.'></textarea></label>"+
    "<button class='wl-big wl-red top10' data-wl-offline-submit>CALL IT / START JOINT TROUBLESHOOTING →</button>";
  card.dataset.units=JSON.stringify(units);
  hideChildren(viewSvc(),[card]);resetWizardPosition();
}
async function submitOfflineUnitForm() {
  const button=document.querySelector('[data-wl-offline-submit]');
  if(button){button.disabled=true;button.textContent='Notifying IT…';}
  const {error}=await liveDb.rpc('service_start_offline_escalation_v1',{
    p_ticket_no:document.getElementById('wlOfflineTicket')?.value||'',
    p_site:document.getElementById('wlOfflineSite')?.value||'',
    p_unit_tag:document.getElementById('wlOfflineUnit')?.value||'',
    p_equipment_type:document.getElementById('wlOfflineType')?.value||'',
    p_original_problem:document.getElementById('wlOfflineProblem')?.value||'',
    p_power_verified:Boolean(document.getElementById('wlOfflinePower')?.checked),
    p_service_notes:document.getElementById('wlOfflineServiceNotes')?.value||''
  });
  if(error){if(button){button.disabled=false;button.textContent='CALL IT / START JOINT TROUBLESHOOTING →';}return alert(error.message);}
  await showSvcHome();
  alert('IT was notified. Keep this issue open while Service and IT troubleshoot together.');
}
async function fieldEscalationITData(rows) {
  const ticketSet=new Set((rows||[]).map(r=>norm(r.ticket_no)));
  if(!ticketSet.size)return new Map();
  const {data,error}=await liveDb.from('prep_tickets')
    .select('ticket_no,prep_items(id,unit_tag,equipment_type,purpose,spare_outcome,spare_it_checked_out_at,spare_checked_out_to)')
    .eq('status','closed').order('closed_at',{ascending:false}).limit(100);
  if(error)throw error;
  const map=new Map();
  (data||[]).forEach(p=>{
    if(!ticketSet.has(norm(p.ticket_no)))return;
    (p.prep_items||[]).filter(i=>i.purpose==='BACKUP'&&i.spare_it_checked_out_at&&!i.spare_outcome).forEach(i=>{
      const key=norm(p.ticket_no);if(!map.has(key))map.set(key,[]);map.get(key).push(i);
    });
  });
  return map;
}
async function fieldEscalationITHtml(rows) {
  const active=(rows||[]).filter(r=>['waiting_it','joint_troubleshooting'].includes(r.status));
  if(!active.length)return '';
  const backups=await fieldEscalationITData(active);
  return "<div class='wl-stop top10'><b>SERVICE NEEDS IT TROUBLESHOOTING · "+active.length+"</b><div>Review the Service power check, work together, and record the IT decision.</div>"+active.map(r=>{
    const opts=(backups.get(norm(r.ticket_no))||[]).filter(i=>i.spare_checked_out_to===r.service_tech_id).map(i=>"<option value='"+i.id+"'>"+esc(i.equipment_type)+" Unit "+esc(i.unit_tag||"")+"</option>").join('');
    return "<div class='wl-ticket top10'><b>Unit "+esc(r.unit_tag)+" · MHelpDesk #"+esc(r.ticket_no)+"</b><div class='small'>Service Tech: "+esc(r.service_tech_name)+"</div>"+fieldEscalationHistoryHtml(r)+
      "<label>IT checks / actions<textarea id='wlOfflineItNotes_"+r.id+"' rows='4' placeholder='Record what IT and Service checked together.'></textarea></label>"+
      "<label>Outcome<select id='wlOfflineItAction_"+r.id+"'><option value='continue_troubleshooting'>Continue Service + IT troubleshooting</option><option value='repaired_onsite'>Repaired onsite</option><option value='authorize_backup_swap'>Authorize checked-out backup swap</option><option value='unresolved_owner'>No solution — escalate to Owner</option></select></label>"+
      "<label>Checked-out backup unit<select id='wlOfflineItBackup_"+r.id+"'><option value=''>Choose only when authorizing a swap</option>"+opts+"</select></label>"+
      (!opts?"<div class='small'><b>No active checked-out backup is recorded for this ticket and Service Tech.</b></div>":"")+
      "<button class='wl-big wl-blue top10' data-wl-offline-it-save='"+r.id+"'>Save IT Decision →</button></div>";
  }).join('')+"</div>";
}
async function saveOfflineITDecision(id) {
  const button=document.querySelector("[data-wl-offline-it-save='"+id+"']");
  if(button){button.disabled=true;button.textContent='Saving…';}
  const action=document.getElementById('wlOfflineItAction_'+id)?.value||'';
  const backup=document.getElementById('wlOfflineItBackup_'+id)?.value||null;
  const {error}=await liveDb.rpc('it_update_offline_escalation_v1',{
    p_escalation_id:id,
    p_it_notes:document.getElementById('wlOfflineItNotes_'+id)?.value||'',
    p_action:action,
    p_backup_prep_item_id:backup||null
  });
  if(error){if(button){button.disabled=false;button.textContent='Save IT Decision →';}return alert(error.message);}
  await showITHome();
  alert(action==='unresolved_owner'?'Owner was notified with the complete Service + IT summary.':'IT troubleshooting decision saved.');
}
async function completeAuthorizedOfflineSwap(id,backupItemId) {
  const {data:existing,error:returnError}=await liveDb.from('unit_returns').select('id,ticket_no,unit_tag').limit(100);
  if(returnError)return alert(returnError.message);
  const rows=await fieldEscalationRows(), row=rows.find(r=>r.id===id);
  if(!row)return alert('Offline-unit escalation not found.');
  const match=(existing||[]).find(r=>norm(r.ticket_no)===norm(row.ticket_no)&&norm(r.unit_tag)===norm(row.unit_tag));
  if(match){
    const {error}=await liveDb.rpc('service_link_offline_failed_return_v1',{p_escalation_id:id,p_return_id:match.id});
    if(error)return alert(error.message);
    return showSvcHome();
  }
  const {error:spareError}=await liveDb.rpc('resolve_my_truck_spare_unit',{p_item_id:backupItemId,p_outcome:'used'});
  if(spareError&&!/already been resolved/i.test(spareError.message||''))return alert(spareError.message);
  serviceReturn={step:3,ticket:String(row.ticket_no||''),unit:String(row.unit_tag||''),type:String(row.equipment_type||''),notes:'Failed unit returned after IT-authorized backup swap.',noTag:false,photo:null,tagScan:null,conditionPhotos:[],damagePhotos:[],knownUnits:[],offlineEscalationId:id};
  serviceReturnRecovered=false;await saveServiceReturnDraft();return renderServiceReturn();
}

async function swapSiteRegistrationRows(){
  const {data,error}=await liveDb.from('prep_tickets')
    .select('id,ticket_no,site,status,prep_items(id,unit_tag,equipment_type,purpose,swap_outcome,swap_installed_site,swap_site_registration_status)')
    .in('status',['released','closed'])
    .order('created_at',{ascending:false})
    .limit(120);
  if(error)throw error;
  return (data||[]).flatMap(prep=>(prep.prep_items||[])
    .filter(item=>item.purpose==='SWAP'&&item.swap_outcome==='installed'&&item.swap_site_registration_status==='pending_it')
    .map(item=>({...item,prep_ticket_id:prep.id,ticket_no:prep.ticket_no,site:item.swap_installed_site||prep.site||''})));
}
function swapSiteRegistrationHtml(rows){
  if(!rows?.length)return'';
  return `<div class='wl-svc-command-section'><div class='wl-svc-command-section-head'><b>SWAP Site Registration</b><span>${rows.length} ready</span></div>${rows.map(row=>`<div class='wl-svc-job'><div class='wl-svc-job-top'><div><b>${esc(row.equipment_type)} ${esc(row.unit_tag||'')}</b><div class='small'>MHelpDesk #${esc(row.ticket_no)} · ${esc(row.site||'Customer site')}</div></div><span>READY</span></div><div class='wl-svc-job-desc'>Service confirmed this replacement unit was actually installed. Confirm that IT registered this exact unit to the customer/site.</div><button class='wl-big wl-blue top10' style='min-height:52px;font-size:15px' data-wl-confirm-swap-site='${esc(row.id)}' data-wl-swap-site-label='${esc((row.equipment_type||'Unit')+' '+(row.unit_tag||''))}' data-wl-swap-site='${esc(row.site||'Customer site')}'>Confirm Site Registration →</button></div>`).join('')}</div>`;
}
async function showITHome() {
  if (!isIT() || !viewIT()) return;
  let home=document.getElementById('wlItHome');
  if(!home){
    home=document.createElement('div');
    home.id='wlItHome';
    home.className='card wl-home';
    viewIT().prepend(home);
  }
  const loadToken=++itDashboardLoadToken;
  home.innerHTML=techDashboardLoadingHtml('Loading IT Technician Command Center…');
  hideChildren(viewIT(),[home]);
  resetWizardPosition();

  const settled=await Promise.allSettled([
    techDashboardTimeout(prepCounts(),{draft:0,released:0,closed:0,nextDraft:null}),
    techDashboardTimeout(returnCounts(),{waiting:0,inventory:0,replacement:0,completed:0,nextWaiting:null}),
    techDashboardTimeout(myActiveAssignments('it'),[]),
    techDashboardTimeout(pushAlertState(),{supported:false,permission:'unknown',subscribed:false,ready:false}),
    techDashboardTimeout(myAssignedInventoryAssets(),[]),
    techDashboardTimeout(fieldEscalationRows(),[]),
    techDashboardTimeout(swapSiteRegistrationRows(),[])
  ]);
  if(loadToken!==itDashboardLoadToken)return;
  const values=settled.map(r=>r.status==='fulfilled'?r.value:null);
  const prepSummary=values[0]||{draft:0,released:0,closed:0,nextDraft:null};
  const returns=values[1]||{waiting:0,inventory:0,replacement:0,completed:0,nextWaiting:null};
  const assignments=values[2]||[];
  const phoneAlerts=values[3]||{supported:false,permission:'unknown',subscribed:false,ready:false};
  const assignedAssets=values[4]||[];
  const offlineRows=values[5]||[];
  const swapSiteRegs=values[6]||[];
  let partialLoad=techDashboardSettled(settled);

  const ownerViewingIT=roleText().includes('Owner/Admin');
  const techName=document.getElementById('whoName')?.textContent?.trim() || (ownerViewingIT?'IT / Owner':'IT Technician');
  const todayKey=techCheckDateKey();
  const todayLabel=new Date().toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
  const offlineIT=(offlineRows||[]).filter(row=>!row.resolved_at&&['waiting_it','joint_troubleshooting'].includes(String(row.status||'')));

  const offlineHtmlResult=await Promise.allSettled([techDashboardTimeout(fieldEscalationITHtml(offlineRows),'')]);
  if(loadToken!==itDashboardLoadToken)return;
  if(techDashboardSettled(offlineHtmlResult))partialLoad=true;
  const offlineITHtml=offlineHtmlResult[0]?.status==='fulfilled'?(offlineHtmlResult[0].value||''):'';

  const gateResults=await Promise.allSettled((assignments||[]).map(a=>techDashboardTimeout(
    assignmentGateState(a),
    {ready:false,label:'STATUS UNAVAILABLE',detail:'Live workflow status did not finish loading. Retry the dashboard before starting this task.'},
    5000
  )));
  if(loadToken!==itDashboardLoadToken)return;
  if(techDashboardSettled(gateResults))partialLoad=true;
  const assignmentRows=(assignments||[]).map((a,index)=>({
    a,
    gate:gateResults[index]?.status==='fulfilled'
      ? gateResults[index].value
      : {ready:false,label:'STATUS UNAVAILABLE',detail:'Retry the dashboard before starting this task.'}
  }));
  const alertBanner=(partialLoad?"<div class='wl-tech-partial'><b>Partial live-data load.</b> The IT command center is usable, but one live check did not answer. Retry before starting any item marked STATUS UNAVAILABLE.</div>":"")+phoneAlertBanner(phoneAlerts);
  const dateKey=a=>String(a?.scheduled_for||'').slice(0,10);
  const overdueAll=assignmentRows.filter(({a})=>dateKey(a)&&dateKey(a)<todayKey);
  const todayAll=assignmentRows.filter(({a})=>dateKey(a)===todayKey);
  const unscheduledAll=assignmentRows.filter(({a})=>!dateKey(a));
  const upcomingAll=assignmentRows.filter(({a})=>dateKey(a)>todayKey);
  const deferred=[...overdueAll,...todayAll,...unscheduledAll].filter(({gate})=>!gate.ready);
  const overdue=overdueAll.filter(({gate})=>gate.ready);
  const today=todayAll.filter(({gate})=>gate.ready);
  const unscheduled=unscheduledAll.filter(({gate})=>gate.ready);
  const upcoming=upcomingAll.filter(({gate})=>gate.ready);
  const needsAction=[...overdue,...today,...unscheduled];
  const ready=needsAction;
  const blocked=deferred;
  const queueCount=needsAction.filter(({a})=>!a.assignee_user_id&&a.assignment_scope==='department').length;

  function itAssignmentState(row){
    const {a,gate}=row;
    const overdueFlag=dateKey(a)&&dateKey(a)<todayKey;
    if(overdueFlag)return {label:'OVERDUE / OPEN',tone:'attn',detail:'This IT assignment is still open from an earlier work date.'};
    if(!gate.ready)return {label:gate.label||'WAITING',tone:'wait',detail:gate.detail||'A required prior workflow step is not complete.'};
    if(a.status==='started')return {label:'IN PROCESS',tone:'',detail:'Continue the IT workflow already started for this ticket.'};
    return {label:'READY',tone:'',detail:'This IT assignment is ready to open after exact MHelpDesk verification.'};
  }

  function itAssignmentCard(row){
    const {a}=row,state=itAssignmentState(row);
    const queue=!a.assignee_user_id&&a.assignment_scope==='department';
    return `<div class='wl-svc-job'>
      <div class='wl-svc-job-top'><div><b>MHelpDesk #${esc(a.ticket_no)}</b><div class='small'>${esc(a.site||'No customer / site')}</div></div><span class='${state.tone}'>${esc(state.label)}</span></div>
      <div class='wl-svc-job-meta'><span>${esc(String(a.work_type||'service').toUpperCase())}</span><span>${esc(ownerAIScheduleText(a.scheduled_for,a.scheduled_time))}</span>${queue?'<span>IT Department Queue</span>':''}</div>
      <div class='wl-svc-job-desc'>${a.job_description?esc(a.job_description):esc(state.detail)}</div>
      <button class='wl-big wl-blue top10' style='min-height:58px;font-size:18px' data-wl-start-assignment='${a.id}' ${state.tone==='wait'?'disabled':''}>${a.status==='started'?'CONTINUE →':'ACCEPT JOB'}</button>
    </div>`;
  }

  let commandState='IT WORKFLOW READY',commandTone='',commandDetail='Work the highest-priority IT task shown below.';
  if(offlineIT.length){commandState='SERVICE NEEDS IT SUPPORT';commandTone='issue';commandDetail='A field unit is waiting for Service + IT troubleshooting.';}
  else if(returns.waiting){commandState='IT INTAKE WAITING';commandTone='due';commandDetail='Returned equipment is waiting for IT Intake.';}
  else if(swapSiteRegs.length){commandState='SWAP SITE REGISTRATION READY';commandTone='due';commandDetail='Service confirmed a replacement unit was installed. IT can register it to the customer/site now.';}
  else if(overdue.length){commandState='OPEN IT WORK FROM EARLIER DATE';commandTone='blocked';commandDetail='At least one IT assignment is still open from an earlier work date.';}
  else if(ready.length){commandState='IT JOB READY';commandDetail='An IT assignment is ready to work now.';}
  else if(prepSummary.draft){commandState='UNFINISHED IT PREP';commandTone='due';commandDetail='An equipment prep draft is still incomplete.';}
  else if(!needsAction.length){commandState='NO ACTIVE IT WORK TODAY';commandDetail='Only work that is ready for IT appears here. Future workflow steps stay hidden until they are released to IT.';}

  let nextAction='';
  if(offlineIT.length){
    const issue=offlineIT[0];
    nextAction=`<div class='wl-svc-command-next wait'><div class='wl-next-kicker'>DO THIS NEXT</div><b>Help Service troubleshoot ${esc(issue.equipment_type||'Unit')} ${esc(issue.unit_tag||'')}</b><div class='small'>MHelpDesk #${esc(issue.ticket_no||'—')} · ${esc(issue.site||'No site')} · ${esc(fieldEscalationStatusLabel(issue.status))}</div><div class='small'>Review Service’s power check, troubleshoot together, and record the IT decision in the field-issue card below.</div></div>`;
  }else if(returns.nextWaiting){
    nextAction=`<div class='wl-svc-command-next'><div class='wl-next-kicker'>DO THIS NEXT</div><b>Start IT Intake · Unit ${esc(returns.nextWaiting.unit_tag||'Unknown')}</b><div class='small'>${esc(returns.nextWaiting.equipment_type||'Returned unit')} · MHelpDesk #${esc(returns.nextWaiting.ticket_no||'—')}</div><button class='wl-big wl-blue top10' style='min-height:52px;font-size:15px' data-wl-next-it-intake='${returns.nextWaiting.id}'>Start / Continue IT Intake →</button></div>`;
  }else if(swapSiteRegs.length){
    const reg=swapSiteRegs[0];
    nextAction=`<div class='wl-svc-command-next'><div class='wl-next-kicker'>DO THIS NEXT</div><b>Register ${esc(reg.equipment_type)} ${esc(reg.unit_tag||'')} to ${esc(reg.site||'customer site')}</b><div class='small'>MHelpDesk #${esc(reg.ticket_no)} · Service confirmed the SWAP happened.</div><button class='wl-big wl-blue top10' style='min-height:52px;font-size:15px' data-wl-confirm-swap-site='${esc(reg.id)}' data-wl-swap-site-label='${esc((reg.equipment_type||'Unit')+' '+(reg.unit_tag||''))}' data-wl-swap-site='${esc(reg.site||'Customer site')}'>Confirm Site Registration →</button></div>`;
  }else if(ready.length){
    const next=ready[0].a;
    nextAction=`<div class='wl-svc-command-next'><div class='wl-next-kicker'>DO THIS NEXT</div><b>Open MHelpDesk #${esc(next.ticket_no)}</b><div class='small'>${esc(next.site||'No customer / site')} · ${esc(String(next.work_type||'service').toUpperCase())} · ${esc(ownerAIScheduleText(next.scheduled_for,next.scheduled_time))}</div><button class='wl-big wl-blue top10' style='min-height:52px;font-size:15px' data-wl-start-assignment='${next.id}'>${next.status==='started'?'Continue IT Task':'Open IT Task'} →</button></div>`;
  }else if(prepSummary.nextDraft){
    nextAction=`<div class='wl-svc-command-next wait'><div class='wl-next-kicker'>DO THIS NEXT</div><b>Finish IT Prep · MHelpDesk #${esc(prepSummary.nextDraft.ticket_no)}</b><div class='small'>${esc(prepSummary.nextDraft.site||'No customer / site')}</div><button class='wl-big wl-blue top10' style='min-height:52px;font-size:15px' data-wl-open-it='${prepSummary.nextDraft.id}'>Continue Equipment Prep →</button></div>`;
  }else{
    nextAction=`<div class='wl-svc-command-next clear'><div class='wl-next-kicker'>DAY STATUS</div><b>✓ IT command center is clear.</b><div class='small'>No IT task is currently released and ready to work.</div></div>`;
  }

  const upcomingHtml=upcoming.length?`<div class='wl-svc-command-section'><div class='wl-svc-command-section-head'><b>Upcoming IT Work</b><span>${upcoming.length} scheduled</span></div>${upcoming.slice(0,8).map(itAssignmentCard).join('')}</div>`:'';
  const closeoutClear=!assignments.length&&!prepSummary.draft&&!returns.waiting&&!offlineIT.length&&!swapSiteRegs.length;

  home.innerHTML=`${alertBanner}<div class='wl-svc-command wl-it-command'>
    <div class='wl-svc-command-hero'>
      <div class='wl-svc-command-kicker'>IT TECHNICIAN COMMAND CENTER</div>
      <h2>${esc(ownerViewingIT?techName+' · IT':techName)} · ${esc(todayLabel)}</h2>
      <p>Assignments → equipment prep → Service handoff → field support → IT Intake → inventory protection.</p>
      <div class='wl-svc-command-state ${commandTone}'><i></i><span><b>${esc(commandState)}</b><br>${esc(commandDetail)}</span></div>
    </div>

    <div class='wl-svc-command-stats'>
      <div class='wl-svc-command-stat'><b>${today.length}</b><span>Today’s IT jobs</span></div>
      <div class='wl-svc-command-stat'><b>${ready.length}</b><span>Ready / actionable</span></div>
      <div class='wl-svc-command-stat'><b>${returns.waiting}</b><span>Released to IT Intake</span></div>
      <div class='wl-svc-command-stat'><b>${swapSiteRegs.length}</b><span>SWAP site registrations</span></div>
      <div class='wl-svc-command-stat'><b>${returns.waiting}</b><span>Returns waiting IT</span></div>
      <div class='wl-svc-command-stat'><b>${offlineIT.length}</b><span>Service needs IT</span></div>
    </div>

    ${nextAction}

    <div class='wl-svc-command-section'>
      <div class='wl-svc-command-section-head'><b>IT Queue Health</b><span>${needsAction.length} open now</span></div>
      <div class='wl-svc-command-closeout'>
        <div class='wl-svc-command-close-row ${overdue.length?'issue':''}'><b>Overdue IT assignments</b><span>${overdue.length}</span></div>
        <div class='wl-svc-command-close-row ${queueCount?'pending':''}'><b>IT Department queue jobs</b><span>${queueCount}</span></div>
        <div class='wl-svc-command-close-row ${prepSummary.draft?'pending':''}'><b>Equipment prep drafts</b><span>${prepSummary.draft}</span></div>
        <div class='wl-svc-command-close-row ${returns.waiting?'pending':''}'><b>Returns waiting IT Intake</b><span>${returns.waiting}</span></div>
        <div class='wl-svc-command-close-row ${returns.replacement?'issue':''}'><b>Needs Replacement holds</b><span>${returns.replacement}</span></div>
        <div class='wl-svc-command-close-row ${swapSiteRegs.length?'pending':''}'><b>SWAP site registration ready</b><span>${swapSiteRegs.length}</span></div>
      </div>
    </div>

    ${swapSiteRegistrationHtml(swapSiteRegs)}

    <div class='wl-svc-command-section'>
      <div class='wl-svc-command-section-head'><b>Today / Needs Action</b><span>${needsAction.length} open</span></div>
      ${needsAction.length?needsAction.map(itAssignmentCard).join(''):"<div class='ok'><b>✓ No due, overdue, or unscheduled IT assignments.</b></div>"}
    </div>

    ${offlineITHtml}
    ${upcomingHtml}

    <div class='wl-svc-command-section'>
      <div class='wl-svc-command-section-head'><b>Equipment Prep & Intake</b><span>Live Tech Check</span></div>
      <div class='wl-svc-command-closeout'>
        <div class='wl-svc-command-close-row ${prepSummary.draft?'pending':''}'><b>Draft IT preps</b><span>${prepSummary.draft}</span></div>
        <div class='wl-svc-command-close-row'><b>Handoffs waiting for Service</b><span>${prepSummary.released}</span></div>
        <div class='wl-svc-command-close-row ${returns.waiting?'pending':''}'><b>Returned units waiting IT</b><span>${returns.waiting}</span></div>
        <div class='wl-svc-command-close-row'><b>Intake awaiting Owner / MHelpDesk inventory</b><span>${returns.inventory}</span></div>
      </div>
      ${assignedInventoryHtml(assignedAssets)}
      <div class='wl-menu top10'>
        ${ownerViewingIT?"<button class='wl-blue' data-wl-it='new'>＋ Owner: Start New Equipment Prep</button>":""}
        <button class='${prepSummary.draft?"wl-red":"wl-gray"}' data-wl-it='pending' ${prepSummary.draft?'':'disabled'}>▶ Continue Pending Prep <span class='wl-count'>${prepSummary.draft}</span></button>
        <button class='${returns.waiting?"wl-red":"wl-gray"}' data-wl-mode='intake' ${returns.waiting?'':'disabled'}>↩ Intake & Returns <span class='wl-count'>${returns.waiting+returns.inventory+returns.replacement}</span></button>
        <button class='wl-gray' data-wl-it='history'>☰ Status & History <span class='wl-count'>${prepSummary.released+prepSummary.closed}</span></button>
      </div>
    </div>

    <div class='wl-svc-command-section'>
      <div class='wl-svc-command-section-head'><b>End-of-Day IT Closeout</b><span>${closeoutClear?'CLEAR':'OPEN ITEMS'}</span></div>
      <div class='wl-svc-command-closeout'>
        <div class='wl-svc-command-close-row ${needsAction.length?'pending':''}'><b>Ready IT assignments</b><span>${needsAction.length}</span></div>
        <div class='wl-svc-command-close-row ${prepSummary.draft?'pending':''}'><b>Unfinished equipment prep</b><span>${prepSummary.draft}</span></div>
        <div class='wl-svc-command-close-row ${returns.waiting?'pending':''}'><b>Returns waiting IT Intake</b><span>${returns.waiting}</span></div>
        <div class='wl-svc-command-close-row ${offlineIT.length?'issue':''}'><b>Service troubleshooting waiting on IT</b><span>${offlineIT.length}</span></div>
        <div class='wl-svc-command-close-row ${swapSiteRegs.length?'pending':''}'><b>SWAP site registrations</b><span>${swapSiteRegs.length}</span></div>
      </div>
      <div class='small top8'>Released handoffs may remain with Service, and completed intake may remain in Owner / MHelpDesk inventory confirmation without falsely blocking IT closeout. MHelpDesk remains separate.</div>
    </div>
  </div>`;

  hideChildren(viewIT(),[home]);
  injectEquipmentMemory(wizard).catch(()=>{});
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
  { key:'solar_panel_qty', id:'SolarPanels', label:'Solar Panel Replacement', help:'Replace an existing solar panel with a new one.' },
  { key:'battery_replacement_qty', id:'BatteryReplacements', label:'Battery Replacement', help:'Replace an existing battery with a new one.' },
  { key:'camera_replacement_qty', id:'CameraReplacements', label:'Camera Replacement', help:'Replace an existing camera with a new one.' },
  { key:'sim_replacement_qty', id:'SimReplacements', label:'SIM Card Swap', help:'IT supplies it: remove the old SIM → install the new SIM.' },
  { key:'micro_sd_qty', id:'MicroSdCards', label:'SD / Micro SD Card Replacement', help:'IT supplies the replacement SD / micro SD card.' },
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
  const itSupplied=rows.filter(row=>row.key==='sim_replacement_qty'||row.key==='micro_sd_qty');
  return rows.length ? `<div class='wl-parts-summary'><b>Replacement / Swap Work</b><div class='wl-parts-chips'>${rows.map(row => `<span><b>${row.qty}</b> × ${esc(row.label)}</span>`).join('')}</div>${itSupplied.length?`<div class='small top8'><b>IT SUPPLIES:</b> ${esc(itSupplied.map(row=>row.qty+' × '+row.label).join(', '))}. Service verifies these in the IT → Service handoff before leaving.</div>`:''}</div>` : `<div class='wl-parts-summary'><b>Replacement / Swap Work</b><div class='small'>None listed.</div></div>`;
}
function ticketPartsInputsHtml(prefix='wlPart', data={}) {
  return `<div class='wl-parts-grid'>${TICKET_PARTS.map(part => `<label><span>${esc(part.label)}</span>${part.help?`<small>${esc(part.help)}</small>`:''}<input id='${prefix}${part.id}' type='number' inputmode='numeric' min='0' step='1' value='${cleanPartQty(data?.[part.key])}'></label>`).join('')}</div>`;
}
const OWNER_DEVICE_TYPES = window.TechCheckRules?.deviceTypes || ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'];
const OWNER_STAND_TYPES = window.TechCheckRules?.standTypes || ['110V Stand','Solar Stand','Pole'];
function equipmentDisplayLabel(label) { return label === 'Recon 2' ? 'Recon II' : label; }
function normalizedEquipmentManifest(raw) {
  if (window.TechCheckRules?.normalizeManifest) return window.TechCheckRules.normalizeManifest(raw);
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
  if (window.TechCheckRules?.manifestQty) return window.TechCheckRules.manifestQty(raw,label);
  return normalizedEquipmentManifest(raw).filter(row => row.label===label).reduce((sum,row)=>sum+row.qty,0);
}
function prepPurposeFromWorkType(workType) {
  const type=String(workType || '').toLowerCase();
  if (type==='delivery') return 'DELIVERY';
  if (type==='swap') return 'SWAP';
  return '';
}
function automaticServiceSolarPlan(raw,workType='service') {
  if (window.TechCheckRules?.automaticServiceSolarPlan) return window.TechCheckRules.automaticServiceSolarPlan(raw,workType);
  const delivery=String(workType || '').toLowerCase()==='delivery';
  if (!delivery) return { spotters:0,rangers:0,stands:0,panels:0 };
  const spotters=manifestQty(raw,'Solar Spotter');
  const rangers=manifestQty(raw,'Ranger');
  return { spotters,rangers,stands:spotters,panels:rangers };
}
function automaticServiceSolarPlanHtml(raw,workType='service') {
  const plan=automaticServiceSolarPlan(raw,workType);
  if (!plan.spotters && !plan.rangers) return '';
  const chips=[];
  if (plan.stands) chips.push(`<span><b>${plan.stands}</b> × Solar Stand automatically required for Service</span>`);
  if (plan.spotters) chips.push(`<span><b>Battery setup selected in Service</b> · per stand: 4 × AGM 12V 110Ah <b>or</b> 1 × 12V 350Ah</span>`);
  if (plan.panels) chips.push(`<span><b>${plan.panels}</b> × Solar Panel + <b>${plan.rangers}</b> × LiTime 12V 110Ah battery automatically required for Ranger Service checkout</span>`);
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
  return `<div class='wl-owner-equipment-requirements'><div class='wl-requirement-section unitArea'><div class='wl-requirement-heading'>UNIT AREA — Units / Devices Being Sent</div><div class='small'>Choose the unit types and quantities that match the MHelpDesk ticket.</div><div class='wl-owner-equipment-grid top8'>${ownerEquipmentQtyGrid('device')}</div></div><div class='wl-requirement-section standArea'><div class='wl-requirement-heading'>STANDS / SOLAR STANDS — Count + MHelpDesk Tag / Unit #</div><div class='small'>Use this for stands, solar stands, or poles being picked up, delivered, or swapped. Enter the count below and the exact tag / unit numbers from MHelpDesk here.</div><div class='wl-owner-equipment-grid top8'>${ownerEquipmentQtyGrid('stand')}</div></div></div>`;
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
  wrap.innerHTML=`<div class='qtext'>Parts Required From This Ticket</div><div class='small'>Choose the exact units/devices, stands, and extra parts being sent for this MHelpDesk ticket.</div>${itEquipmentManifestInputsHtml(pendingAssignmentManifest)}<div id='wlITEquipmentCountSummary' class='wl-equipment-count-summary'></div><div class='wl-requirement-section partsArea'><div class='wl-requirement-heading'>REPLACEMENT / SWAP WORK</div><div class='small'><b>IT supplies all listed SIM and SD/micro SD cards.</b> Put the exact quantity in the Service handoff.</div>${ticketPartsInputsHtml('wlPart')}</div>`;
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
  req.innerHTML = pendingAssignmentManifest.length ? `<div class='wl-review'><b>Owner Assignment · ${esc(String(pendingAssignmentWorkType || 'service').toUpperCase())}</b><div class='small'>The IT equipment above was prefilled from the Owner assignment. Solar Spotter Delivery support (Solar Stand + Service-selected battery setup) and Ranger solar equipment are handled automatically on the Service side.</div>${equipmentManifestInlineHtml(pendingAssignmentManifest)}${automaticServiceSolarPlanHtml(pendingAssignmentManifest,pendingAssignmentWorkType)}</div>` : '';
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
  card.innerHTML = `<div class='wl-mode-pills'><button class='wl-mode-card' data-wl-mode='deployment'><span class='wl-mode-title'>Deployment</span><span class='wl-mode-sub'>Prepare & hand off equipment</span></button><button class='on wl-mode-card' data-wl-mode='intake'><span class='wl-mode-title'>Intake & Returns</span><span class='wl-mode-sub'>Process returned units</span><span class='wl-mode-badge'>${c.waiting+c.inventory}</span></button></div><div class='wl-title'>What do you need to do?</div><div class='wl-sub'>Process returned Service units the same way as Deployment: one unit and one step at a time.</div><div class='wl-menu'><button class='${c.waiting ? 'wl-red' : 'wl-gray'}' data-wl-intake-view='waiting'>▶ Start / Continue Returned Unit <span class='wl-count'>${c.waiting}</span></button><button class='${c.inventory ? 'wl-red' : 'wl-gray'}' data-wl-intake-view='inventory'>▣ Pending MHelpDesk Inventory <span class='wl-count'>${c.inventory}</span></button><button class='wl-gray' data-wl-intake-view='history'>☰ Status & History <span class='wl-count'>${c.completed}</span></button></div>`;
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
  const items = await Promise.all(filtered.map(async r => `<div class='wl-ticket'><b>${esc(r.unit_tag || (r.equipment_type==='110V Stand'?'No tag':'Unit'))} · ${esc(r.equipment_type || 'Unit')}</b><div><b>MHelpDesk #${esc(r.ticket_no)}</b></div><div class='small'>Returned by ${esc(r.service_tech_name)} · ${new Date(r.returned_at).toLocaleString()}</div>${r.return_notes ? `<div class='small top8'>Service notes: ${esc(r.return_notes)}</div>` : ''}<div class='wl-return-gallery'>${await returnPhotoHtml(r.return_photo_paths)}${kind !== 'waiting' ? await returnPhotoHtml(r.intake_photo_paths) : ''}</div>${kind === 'waiting' ? `<button class='wl-big wl-blue top10' data-wl-intake-start='${r.id}'>Start / Continue This Unit →</button>` : `<div class='ok top10'>✓ Completed · ${esc(r.it_tech_name || 'IT')}</div>`}</div>`));
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
function intakeAIReview(row){
  const answered=intakeWizard.answers.filter(v=>v!==null).length,noCount=intakeWizard.answers.filter(v=>v===false).length,remaining=intakeWizard.answers.length-answered,flags=[];
  const yes=(i)=>intakeWizard.answers[i]===true, servicePhotos=Array.isArray(row?.return_photo_paths)?row.return_photo_paths:[], intakePhotos=Array.isArray(row?.intake_photo_paths)?row.intake_photo_paths:[];
  if(yes(1)&&!servicePhotos.length) flags.push('Evidence mismatch: Service damage/photo review is YES, but no Service return photo is attached.');
  if(yes(0)&&!String(row?.unit_tag||'').trim()) flags.push('Evidence mismatch: unit/tag verification is YES, but the returned unit tag is missing.');
  if(intakeWizard.step>intakeLabels.length && !intakeWizard.photo && !intakePhotos.length) flags.push('Required IT Intake photo is still missing.');
  if(yes(12)&&!intakeWizard.meta?.cancellationDoc) flags.push('Evidence mismatch: SIM cancellation documentation is YES, but the date/job/unit/initials record is missing.');
  if(noCount) flags.push(noCount+' intake check'+(noCount===1?' is':'s are')+' marked NO.');
  if(row?.return_notes) flags.push('Service documented return/damage notes — review them against the photos.');
  if(!row?.return_photo_paths?.length) flags.push('No Service return photo is attached.');
  const pct=Math.round(answered/intakeWizard.answers.length*100);
  return `<div class='wl-ai-panel wl-ai-progress'><div class='wl-ai-head'>${onsiteVisionTitle('Intake Review')}<b>${noCount?'ATTENTION':remaining?'IN PROGRESS':'CHECKS COMPLETE'}</b></div><div class='wl-ai-line'><b>Checklist:</b> ${answered}/${intakeWizard.answers.length} answered · ${pct}%</div>${flags.length?`<div class='wl-ai-warn'>${flags.map(v=>'⚠ '+esc(v)).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ No checklist conflicts detected so far.</div>`}<div class='small top8'>AI reviews recorded answers and evidence status only. Technician verification is still required.</div></div>`;
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
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, intakeLabels[i], i + 1, intakeLabels.length + 2)}${intakeAIReview(row)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type || 'Unit')}</b><div>MHelpDesk #${esc(row.ticket_no)}</div><div>Returned by ${esc(row.service_tech_name)}</div>${row.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(row.return_notes)}</div></div>` : ''}<div class='small top8'><b>Service photos from site / return:</b></div><div class='wl-return-gallery'>${photoHtml}</div></div><div class='wl-question'><div class='qnum'>Intake Check ${i + 1} of ${intakeLabels.length}</div><div class='qtext'>${esc(intakeLabels[i])}</div><div class='wl-options'><button class='pass ${answer === true ? 'on' : ''}' data-wl-intake-answer='yes'>YES</button><button class='fail ${answer === false ? 'on' : ''}' data-wl-intake-answer='no'>NO</button></div>${answer === false ? `<div class='wl-stop'><b>NO recorded.</b><div>Document the issue before this unit goes back into inventory.</div></div>` : ''}</div><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><button class='wl-next' data-wl-intake-next>Next →</button></div>`;
  } else if (intakeWizard.step === intakeLabels.length) {
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, 'Take an IT intake photo', intakeLabels.length + 1, intakeLabels.length + 2)}${intakeAIReview(row)}<div class='wl-review'><b>Service site / return photos</b>${row.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(row.return_notes)}</div></div>` : ''}<div class='wl-return-gallery'>${photoHtml}</div></div><div class='wl-question'><div class='qtext'>Take a current photo of ${esc(row.unit_tag)} in the shop.</div><div class='wl-note'>This gives the Owner a Service-return photo and an IT-intake photo for the same unit.</div><label class='wl-photo-button' for='wlIntakePhoto'>📷 Take / Choose Unit Photo</label><input id='wlIntakePhoto' class='wl-photo-input' type='file' accept='image/*'><div class='wl-return-preview ${intakeWizard.photo ? '' : 'hidden'}'>${intakeWizard.photo ? `<img src='${URL.createObjectURL(intakeWizard.photo)}' alt='Selected IT intake unit photo'><div id='wlIntakePhotoName' class='ok'><b>✓ Photo selected for ${esc(row.unit_tag)}</b><div>${esc(intakeWizard.photo.name || 'Unit photo')} is ready for review.</div></div>` : ''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><button class='wl-next' data-wl-intake-next>Next: Review →</button></div>`;
  } else {
    const noCount = intakeWizard.answers.filter(v => v === false).length;
    const ready = noCount === 0 && intakeWizard.answers.every(v => v === true);
    const doc = intakeWizard.meta?.cancellationDoc;
    card.innerHTML = `${progress(`${row.unit_tag} · IT Intake`, 'Review this unit before MHelpDesk inventory', intakeLabels.length + 2, intakeLabels.length + 2)}${intakeAIReview(row)}<div class='wl-review'><b>${esc(row.unit_tag)} · ${esc(row.equipment_type || 'Unit')}</b><div><b>MHelpDesk #${esc(row.ticket_no)}</b></div><div>${ready ? `✓ All ${intakeLabels.length} intake checks are YES.` : `${noCount} check${noCount === 1 ? '' : 's'} recorded NO — correct or document the issue before inventory.`}</div>${doc ? `<div class='ok top8'><b>SIM cancellation documentation</b><div>Date: ${esc(doc.simCanceledDate)} · Job: MHelpDesk #${esc(doc.ticket)} · Unit: ${esc(doc.unit)} · IT Initials: ${esc(doc.techInitials)}</div></div>` : ''}</div><label>Damage / intake notes</label><textarea id='wlIntakeNotes' rows='4' placeholder='Add damage, missing items, repairs needed, or other notes'>${esc(intakeWizard.notes)}</textarea>${ready ? `<div class='ok top10'><b>✓ IT INTAKE COMPLETE</b><div>SIM, monitoring, Alibi, customer-email app removal, SD cards, cleaning, 2026 Unit Tracker, damage verification, and shelf readiness are documented. Next: send this exact unit to Pending MHelpDesk Inventory.</div></div>` : `<div class='wl-stop'><b>This unit is not ready for inventory.</b><div>If the failed check is because equipment is damaged or cannot be made deployment-ready, document what needs replacement and use the Owner escalation button below. Do not mark it Shop Inventory.</div></div>`}<button class='wl-big wl-green top10' data-wl-intake-finish ${ready ? '' : 'disabled'}>SEND TO PENDING MHELPDESK INVENTORY →</button>${!ready && noCount>0 ? `<button class='wl-big wl-red top10' data-wl-intake-replacement>MARK NEEDS REPLACEMENT → OWNER</button><div class='small top8'>This holds the unit in Maintenance / Needs Replacement. It will not become available Shop Inventory.</div>` : ''}<div class='wl-nav'><button class='wl-prev' data-wl-intake-prev>Back</button><span></span></div>`;
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
  return `<div class='wl-count-editor wl-count-readonly' aria-label='Total prepared equipment items'><b>${Number(totalUnits || 0)}</b><span>Total prepared items: job equipment + any Truck Spares</span></div>`;
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
  return `<div class='wl-question'><div class='qnum'>Check ${index + 1} of ${total}</div><div class='qtext'>${esc(q.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-it-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>NO recorded.</b><div>You may continue documenting the remaining checks, but this unit cannot be handed off to Service until this answer is corrected to YES.</div></div>` : ''}</div>`;
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
let tagScannerModulePromise=null;
function shouldScanUnitTag(type) {
  return ['Helios','Ranger','Solar Spotter','Solar Stand'].includes(String(type||''));
}
function normalizeScannedTag(value) {
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
async function loadTagScanner() {
  if (!tagScannerModulePromise) {
    tagScannerModulePromise=import('https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js')
      .catch(error => { tagScannerModulePromise=null; throw error; });
  }
  return tagScannerModulePromise;
}
async function scanUnitTagPhoto(file,expectedTag) {
  const expected=normalizeScannedTag(expectedTag);
  if (!file || !expected) return {status:'unreadable',detected:'',confidence:null,engine:'tesseract.js-7.0.0'};
  let worker=null;
  try {
    const mod=await loadTagScanner();
    worker=await mod.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' });
    const result=await worker.recognize(file);
    const raw=String(result?.data?.text||'').trim();
    const full=normalizeScannedTag(raw);
    const confidence=Number.isFinite(Number(result?.data?.confidence)) ? Math.round(Number(result.data.confidence)*10)/10 : null;
    if (full.includes(expected)) return {status:'match',detected:expectedTag,confidence,engine:'tesseract.js-7.0.0',raw};
    const tokens=raw.toUpperCase().split(/\s+/).map(normalizeScannedTag).filter(Boolean)
      .filter(token=>token.length>=Math.max(2,expected.length-2) && token.length<=expected.length+4);
    const candidate=tokens.sort((a,b)=>Math.abs(a.length-expected.length)-Math.abs(b.length-expected.length))[0]||'';
    return candidate
      ? {status:'mismatch',detected:candidate,confidence,engine:'tesseract.js-7.0.0',raw}
      : {status:'unreadable',detected:raw.slice(0,80),confidence,engine:'tesseract.js-7.0.0',raw};
  } catch(error) {
    console.warn('AI/OCR tag scan unavailable',error);
    return {status:'unreadable',detected:'',confidence:null,engine:'tesseract.js-7.0.0'};
  } finally {
    try { await worker?.terminate?.(); } catch {}
  }
}
function tagScanStatusHtml(scan,expectedTag) {
  if (!scan?.status) return '';
  const confidence=scan.confidence!=null ? ` · ${Math.round(Number(scan.confidence))}% scan confidence` : '';
  if (scan.status==='scanning') return `<div class='wl-ai-scan-live processing top8'><span class='wl-ai-scan-spinner' aria-hidden='true'></span><div><b>OnSite Vision is processing this photo…</b><span>Checking the unit tag now. This may take a few seconds.</span></div></div>`;
  if (scan.status==='match') return `<div class='wl-ai-scan-live clear top8'><span class='wl-ai-scan-check'>✓</span><div><b>Scan complete — tag match detected</b><span>OnSite Vision found ${esc(expectedTag)}${confidence}. Confirm the tag visually below to continue.</span></div></div>`;
  if (scan.status==='mismatch') return `<div class='wl-ai-scan-live stop top8'><span class='wl-ai-scan-mark'>!</span><div><b>Scan complete — tag mismatch</b><span>Expected <b>${esc(expectedTag)}</b>, but OnSite Vision read <b>${esc(scan.detected||'a different tag')}</b>${confidence}. Retake the photo.</span></div></div>`;
  return `<div class='wl-ai-scan-live pending top8'><span class='wl-ai-scan-mark'>?</span><div><b>Scan complete — tag could not be read</b><span>Expected <b>${esc(expectedTag)}</b>. Retake a clearer photo or visually verify the tag yourself.</span></div></div>`;
}
function showLiveTagScan(panel,expectedTag){
  if(!panel) return;
  panel.querySelector('.wl-ai-scan-live')?.remove();
  const box=document.createElement('div');
  box.className='wl-ai-scan-live processing top8';
  box.innerHTML=`<span class='wl-ai-scan-spinner' aria-hidden='true'></span><div><b>OnSite Vision is processing this photo…</b><span>Checking unit tag ${esc(expectedTag||'')} now. This may take a few seconds.</span></div>`;
  const anchor=panel.querySelector('[data-wl-upload]');
  if(anchor) anchor.insertAdjacentElement('beforebegin',box); else panel.append(box);
}
function itemTagScan(item) {
  return item?.ai_tag_scan_status ? {
    status:item.ai_tag_scan_status,
    detected:item.ai_tag_scan_detected||'',
    expected:item.ai_tag_scan_expected||item.unit_tag||'',
    confidence:item.ai_tag_scan_confidence,
    engine:item.ai_tag_scan_engine||''
  } : null;
}
function returnTagScan(row) {
  return row?.tag_scan_status ? {
    status:row.tag_scan_status,
    detected:row.tag_scan_detected||'',
    expected:row.tag_scan_expected||row.unit_tag||'',
    confidence:row.tag_scan_confidence,
    engine:row.tag_scan_engine||''
  } : null;
}
async function saveItTagScan(itemId,scan) {
  const { error }=await liveDb.rpc('record_it_unit_ai_tag_scan',{
    p_item_id:itemId,
    p_status:scan.status,
    p_detected:scan.detected||null,
    p_confidence:scan.confidence==null?null:Number(scan.confidence),
    p_engine:scan.engine||'tesseract.js-7.0.0'
  });
  if (error) throw error;
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
  const instruction = unitNo
    ? (stage === 'it' && tag
      ? `Take exactly 1 clear photo of ${identity}. Make sure unit tag ${tag} is clearly visible and readable in the photo.`
      : (stage === 'it' && item?.equipment_type === '110V Stand'
        ? 'Take exactly 1 clear photo of the 110V Stand. If it has a tag, include it in the photo. If it has no tag, the stand photo is enough.'
        : `Take exactly 1 clear photo for Unit ${unitNo}.`))
    : stage === 'service' ? `IT supplied ${required} photo${required === 1 ? '' : 's'}. Take exactly ${required} Service receipt photo${required === 1 ? '' : 's'} so the photo counts match.` : 'Photograph exactly what is leaving the shop.';
  const complete = photos.length === required;
  const input = complete && !unitNo ? '' : `<input class='wl-file top8' type='file' accept='image/*' capture='environment' ${unitNo ? '' : 'multiple'}><button class='mini full top8' data-wl-upload='${stage}'>${unitNo && photos.length ? 'Replace Unit Photo' : 'Save Photo(s)'}</button>`;
  const aiScan = stage === 'it' && unitNo && photos.length && shouldScanUnitTag(item?.equipment_type) ? itemTagScan(item) : null;
  const aiScanHtml = aiScan ? tagScanStatusHtml(aiScan,tag) : (stage === 'it' && unitNo && photos.length && shouldScanUnitTag(item?.equipment_type) ? (item?.photo_tag_match_ok ? `<div class='wl-ai-scan-live clear top8'><span class='wl-ai-scan-check'>✓</span><div><b>Clear to continue</b><span>The technician already verified unit tag ${esc(tag)}. No separate OnSite Vision scan result was recorded for this photo.</span></div></div>` : `<div class='wl-ai-scan-live pending top8'><span class='wl-ai-scan-mark'>…</span><div><b>OnSite Vision scan not recorded</b><span>Retake/save the unit photo to run the live tag check.</span></div></div>`) : '');
  const aiMismatch = aiScan?.status === 'mismatch';
  const tagConfirm = stage === 'it' && unitNo && photos.length && tag ? `<div class='wl-question top8'>${aiScanHtml}<div class='qtext'>Does this photo clearly show unit tag ${esc(tag)} and match ${esc(identity)}?</div><div class='wl-options'><button class='pass ${item?.photo_tag_match_ok ? 'on' : ''}' data-wl-photo-tag='yes' ${aiMismatch?'disabled':''}>YES — TAG MATCHES</button><button class='fail' data-wl-photo-tag='no'>NO — RETAKE PHOTO</button></div>${item?.photo_tag_match_ok ? `<div class='ok top8'><b>✓ Photo tag verified for ${esc(identity)}</b></div>` : `<div class='warn top8'><b>Technician tag confirmation required before continuing.</b></div>`}</div>` : '';
  return `<div class='wl-proof ${stage === 'service' ? 'service' : ''}' data-proof='${prepId}' data-stage='${stage}' data-mode='photo' data-unit='${unitNo || ''}' data-expected='${required}'><b>${stage === 'it' && unitNo ? `${esc(identity)} Photo` : unitNo ? `Unit ${unitNo} Photo` : 'Photo Proof'}</b><div class='wl-note'>${instruction}</div>${photos.length ? `<div class='wl-gallery'>${photos.map(p => `<img src='${esc(p.url)}' alt='Handoff photo'>`).join('')}</div><div class='${complete ? 'ok' : 'warn'} top8'><b>${complete ? '✓' : ''} ${photos.length} of ${required} photo${required === 1 ? '' : 's'} saved</b></div>` : `<div class='warn top8'>0 of ${required} photos saved.</div>`}${tagConfirm}${input}</div>`;
}
function signatureStamp(name,at){
  if(!at) return `Signed by ${esc(name || 'Technician')}`;
  const d=new Date(at);
  const date=d.toLocaleDateString([], {month:'numeric',day:'numeric',year:'numeric'});
  const time=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return `Signed by ${esc(name || 'Technician')} · ${esc(date)} · ${esc(time)}`;
}
async function signatureOnlyHtml(prepId, stage, unitNo = null) {
  const rows = await evidenceRows(prepId, stage);
  const signatureName = unitNo ? `unit-${unitNo}-signature.png` : null;
  const sig = [...rows].reverse().find(r => r.kind === 'signature' && (!unitNo || r.original_name === signatureName));
  return `<div class='wl-proof ${stage === 'service' ? 'service' : ''}' data-proof='${prepId}' data-stage='${stage}' data-mode='signature' data-unit='${unitNo || ''}'><b>${unitNo ? `Unit ${unitNo} IT Verification Signature` : stage === 'it' ? 'IT Final Sign-Off' : 'Service Receipt Signature'}</b>${sig ? `<div class='wl-saved'><b>✓ Signature saved</b><div class='small'>${signatureStamp(sig.created_by_name || (stage === 'it' ? 'IT Technician' : 'Service Tech'),sig.created_at)}</div>${sig.url ? `<img src='${esc(sig.url)}' alt='Saved signature'>` : ''}</div><button class='mini full top8' data-wl-replace='${stage}'>Replace Signature</button>` : `<div class='wl-sign top8'><b>Sign with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${stage}'>Save Signature</button></div></div>`}</div>`;
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
const CAMERA_UNIT_TYPES = window.TechCheckRules?.deviceTypes || ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'];
const STAND_POLE_TYPES = window.TechCheckRules?.standTypes || ['Solar Stand','110V Stand','Pole'];
function isSolarSupport(type) { return window.TechCheckRules?.isSolarSupport ? window.TechCheckRules.isSolarSupport(type) : type==='Solar Stand'; }
function isSimpleSupport(type) { return window.TechCheckRules?.isSimpleSupport ? window.TechCheckRules.isSimpleSupport(type) : ['110V Stand','Pole'].includes(type); }
function isSupport(type) { return window.TechCheckRules?.isSupport ? window.TechCheckRules.isSupport(type) : (isSolarSupport(type) || isSimpleSupport(type)); }
function itItems() { return [...(activeItPrep?.prep_items || [])].sort((a, b) => a.item_order - b.item_order); }
function currentItItem() { return itItems()[itUnitIndex] || null; }
function itAllowedPurposes(type) { if (type === '110V Stand') return ['SWAP']; if (type === 'Solar Stand') return ['SWAP','DELIVERY']; return ['SWAP','DELIVERY']; }
function unitEvidence(rows, unitNo, kind) { const prefix = `unit-${unitNo}-`; return rows.filter(r => r.kind === kind && String(r.original_name || '').startsWith(prefix)); }
function unitSignature(rows, unitNo) { return [...rows].reverse().find(r => r.kind === 'signature' && r.original_name === `unit-${unitNo}-signature.png`); }
function itItemIdentity(item, unitNo) {
  const tag = String(item?.unit_tag || '').trim();
  if (tag) return `${item.equipment_type} ${tag}`;
  if (item?.equipment_type === '110V Stand') return '110V Stand · no tag';
  return `Unit ${unitNo}`;
}
function isHeliosDeploy(item){
  return window.TechCheckRules?.isHeliosDeploy ? window.TechCheckRules.isHeliosDeploy(item) : (item?.equipment_type==='Helios' && ['DELIVERY','SWAP','BACKUP'].includes(item?.purpose));
}
function itUnitStepsData(item, unitNo) {
  if (window.TechCheckRules?.itChecklist) return window.TechCheckRules.itChecklist(item, unitNo);
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
  if (!['Solar Spotter','Spotter'].includes(item.equipment_type) && Number(item.required_battery_count || 0) > 0) {
    steps.push({ kind: 'number', field: 'battery_count', label: item.equipment_type==='Helios' ? `Confirm ${identity} has exactly its internal Helios battery box prepared. This is ONE Helios battery box — not four Solar Stand batteries.` : `How many batteries / battery boxes are prepared for ${identity}?` });
  }
  steps.push({ kind: 'bool', field: 'power_ok', label: item.equipment_type === 'Sniper' ? `With ${identity} plugged into 120V, does the Sniper power on correctly?` : `Does ${identity} power on correctly?` });

  if (item.equipment_type === 'Sniper' && ['DELIVERY','SWAP','BACKUP'].includes(item.purpose)) {
    steps.push({ kind:'bool', field:'delivery_sim_ok', label:`Is an active SIM installed in the InHand router for ${identity} and is the router online?` });
    steps.push({ kind:'bool', field:'delivery_camera_app_ok', label:`Using the public IP recorded for ${identity} in the 2026 Unit Tracker, is the Avigilon ES appliance reachable and is this Sniper on the Avigilon Unity platform?` });
    steps.push({ kind:'bool', field:'delivery_recording_ok', label:`Is video / recording from both Avigilon bullet cameras working on ${identity}?` });
    steps.push({ kind:'bool', field:'delivery_batteries_charged_ok', label:`Are both required 12V 35Ah batteries installed in ${identity} and ready for field use?` });
    steps.push({ kind:'bool', field:'delivery_sd_formatted_ok', label:`Is the Avigilon ES appliance storage on ${identity} ready for deployment?` });
    if (item.purpose !== 'BACKUP') {
      steps.push({ kind:'bool', field:'delivery_monitoring_ok', label:`Was all required information for ${identity} sent to the Monitoring Center and set up on the monitoring side?` });
      steps.push({ kind:'bool', field:'delivery_ticket_count_ok', label:`Is ${identity} included correctly on the current MHelpDesk Service order / ticket?` });
      steps.push({ kind:'bool', field:'delivery_customer_email_app_ok', label:`Was customer access to the Avigilon Unity app confirmed for ${identity}?` });
    }
    steps.push({ kind:'bool', field:'functions_ok', label:`Were the Avigilon ES appliance, both bullet cameras, InHand router, and required Sniper functions tested and working?` });
    steps.push({ kind:'bool', field:'safe_ok', label:`Is ${identity} ready for the IT → Service handoff?` });
    return steps;
  }

  if (isHeliosDeploy(item)) {
    steps.push(
      { kind:'bool', field:'helios_camera1_hardware_ok', label:`Is Camera 1 (bullet camera) installed correctly on ${identity}?` },
      { kind:'bool', field:'helios_camera2_hardware_ok', label:`Is Camera 2 (bullet camera) installed correctly on ${identity}?` },
      { kind:'bool', field:'helios_ptz_assembly_ok', label:`Is the Cameras 3/4 PTZ assembly correct on ${identity}: 180° lens on top and PTZ on bottom?` },
      { kind:'bool', field:'helios_cameras_12v_ok', label:`Are the Helios cameras powered from the required 12V supply?` },
      { kind:'bool', field:'helios_ptz_plate_4bolts_ok', label:`Is the PTZ mounted to the removable front plate and secured with all 4 bolts?` },
      { kind:'bool', field:'helios_router_sim_ok', label:`Is the router installed correctly with the SIM installed in ${identity}?` },
      { kind:'bool', field:'helios_proxicast_4x4_ok', label:`Is the Proxicast 4x4 antenna installed, connected to the router, and secure?` },
      { kind:'bool', field:'helios_speaker_24v_ok', label:`Is the IP Speaker installed and powered from the required 24V supply?` },
      { kind:'bool', field:'helios_camera_router_programming_ok', label:`Are the cameras and router programmed together for this Helios before port verification?` },
      { kind:'bool', field:'delivery_sim_ok', label:`Is the SIM active and is the Helios router online?` },
      { kind:'bool', field:'delivery_camera_app_ok', label:`Is ${identity} visible and working in the camera app?` },
      { kind:'bool', field:'helios_camera1_ports_ok', label:`Camera 1: are ports 81 / 554 / 1400 configured and open in both Camera 1 and the router?` },
      { kind:'bool', field:'helios_camera2_ports_ok', label:`Camera 2: are ports 81 / 554 / 1500 configured and open in both Camera 2 and the router?` },
      { kind:'bool', field:'helios_ptz_ports_ok', label:`PTZ: are ports 81 / 554 / 1600 configured and open in both the PTZ and the router?` },
      { kind:'bool', field:'helios_speaker_ports_ok', label:`IP Speaker: are ports 81 / 554 / 1700 configured and open in both the speaker and the router?` },
      { kind:'bool', field:'helios_alibi_vigilant_ok', label:`Is ${identity} correctly configured and visible in Alibi / Vigilant Control Center?` },
      { kind:'bool', field:'helios_cerbo_network_ok', label:`Is the Victron Cerbo connected to the Helios router/network?` },
      { kind:'bool', field:'helios_cerbo_vrm_ok', label:`Is the Cerbo added to Victron VRM and visible online?` },
      { kind:'bool', field:'helios_rear_unit_tag_ok', label:`Is the permanent Helios unit tag installed on the rear and clearly readable?` },
      { kind:'bool', field:'helios_battery_box_installed_ok', label:`Is the single Helios battery box installed inside ${identity}?` },
      { kind:'bool', field:'helios_battery_120v_charged_ok', label:`Did you charge the Helios battery box while ${identity} was plugged into 120V?` },
      { kind:'bool', field:'helios_3x1tb_sd_ok', label:`Are all 3 required 1TB SD cards installed in ${identity}?` },
      { kind:'bool', field:'delivery_recording_ok', label:`Before formatting storage, did you verify ${identity} is recording correctly?` },
      { kind:'bool', field:'delivery_sd_formatted_ok', label:`After recording verification, are all 3 × 1TB SD cards formatted and ready?` }
    );
    if (item.purpose!=='BACKUP') {
      steps.push({ kind:'bool', field:'delivery_monitoring_ok', label:`Was Central Station monitoring for ${identity} created and sent in?` });
      steps.push({ kind:'bool', field:'delivery_customer_email_app_ok', label:`Was ${identity} added under the customer email account in the camera app?` });
    }
    steps.push({ kind:'bool', field:'functions_ok', label:`Were all functions on ${identity} tested and working?` });
    steps.push({ kind:'bool', field:'safe_ok', label:`Is ${identity} ready for the IT → Service handoff?` });
    return steps;
  }

  if (item.equipment_type === 'Ranger') {
    steps.push({ kind: 'bool', field: 'solar_mppt_updated_ok', label: `Is the MPPT firmware / configuration on ${identity} updated?` });
    steps.push({ kind: 'bool', field: 'solar_mppt_tested_ok', label: `Was the MPPT on ${identity} tested and working correctly?` });
  }
  if (['DELIVERY','BACKUP'].includes(item.purpose) || (['Sniper','Spotter','Recon 2','Ranger'].includes(item.equipment_type) && item.purpose === 'SWAP')) {
    steps.push({ kind: 'bool', field: 'delivery_sim_ok', label: `Is the SIM card for ${identity} active and installed in the router?` });
    steps.push({ kind: 'bool', field: 'delivery_camera_app_ok', label: `Is ${identity} visible in the camera app?` });
    steps.push({ kind: 'bool', field: 'delivery_recording_ok', label: `Was recording footage confirmed for ${identity}?` });
    if (!['Solar Spotter','Spotter'].includes(item.equipment_type)) steps.push({ kind: 'bool', field: 'delivery_batteries_charged_ok', label: `Are the batteries / battery box for ${identity} charged and ready?` });
    if (item.purpose === 'DELIVERY') {
      steps.push({ kind: 'bool', field: 'delivery_monitoring_ok', label: `Was Central Station monitoring for ${identity} created and sent in?` });
      steps.push({ kind: 'bool', field: 'delivery_ticket_count_ok', label: `Is ${identity} included in the equipment type and quantity on the MHelpDesk ticket?` });
    }
    steps.push({ kind: 'bool', field: 'delivery_sd_formatted_ok', label: `Is the SD card / NVR storage for ${identity} formatted and ready?` });
    if (item.purpose === 'DELIVERY') steps.push({ kind: 'bool', field: 'delivery_customer_email_app_ok', label: `Was ${identity} added under the customer email account in the camera app?` });
    steps.push({ kind: 'bool', field: 'functions_ok', label: `Were all functions on ${identity} tested and working?` });
    steps.push({ kind: 'bool', field: 'safe_ok', label: `Is ${identity} ready for field use?` });
    return steps;
  }
  steps.push({ kind: 'bool', field: 'functions_ok', label: `Were all functions on ${identity} tested and working?` });
  steps.push({ kind: 'bool', field: 'safe_ok', label: `Is ${identity} ready for field use?` });
  return steps;
}
function itUnitReady(item) {
  if (window.TechCheckRules?.itReady) return window.TechCheckRules.itReady(item);
  if (!item?.unit_tag) return false;
  if (isSolarSupport(item.equipment_type) || isSimpleSupport(item.equipment_type)) return Boolean(item.ticket_item_match_ok && (isSimpleSupport(item.equipment_type) || item.safe_ok));
  if (!item.power_ok || !item.functions_ok || !item.safe_ok) return false;
  if (item.equipment_type !== 'Solar Spotter' && Number(item.battery_count || 0) < Number(item.required_battery_count || 0)) return false;
  if (isHeliosDeploy(item)) {
    const core=Boolean(
      item.helios_camera1_hardware_ok && item.helios_camera2_hardware_ok && item.helios_ptz_assembly_ok &&
      item.helios_proxicast_4x4_ok && item.helios_router_sim_ok && item.helios_speaker_24v_ok &&
      item.helios_cameras_12v_ok && item.helios_ptz_plate_4bolts_ok && item.helios_cerbo_network_ok &&
      item.helios_cerbo_vrm_ok && item.helios_rear_unit_tag_ok && item.helios_battery_box_installed_ok &&
      item.helios_battery_120v_charged_ok && item.helios_camera_router_programming_ok && item.helios_alibi_vigilant_ok &&
      item.helios_3x1tb_sd_ok && item.helios_camera1_ports_ok && item.helios_camera2_ports_ok &&
      item.helios_ptz_ports_ok && item.helios_speaker_ports_ok && item.delivery_sim_ok &&
      item.delivery_camera_app_ok && item.delivery_batteries_charged_ok && item.delivery_sd_formatted_ok &&
      item.delivery_recording_ok
    );
    if(!core) return false;
    return item.purpose==='BACKUP' ? true : Boolean(item.delivery_customer_email_app_ok && item.delivery_monitoring_ok);
  }
  if (item.equipment_type === 'Spotter' && !(item.unit_programmed_ok && item.camera_port_81_ok && item.camera_port_554_ok)) return false;
  if (item.equipment_type === 'Recon 2' && !(item.unit_programmed_ok && Number(item.recon_camera_count || 0) >= 1 && item.camera_port_81_ok && item.camera_port_554_ok)) return false;
  if (item.equipment_type === 'Ranger' && !(item.solar_mppt_updated_ok && item.solar_mppt_tested_ok && item.camera_port_81_ok && item.camera_port_554_ok)) return false;
  const customerSwap = ['Sniper','Spotter','Recon 2','Ranger'].includes(item.equipment_type) && item.purpose === 'SWAP';
  if (!['DELIVERY','BACKUP'].includes(item.purpose) && !customerSwap) return true;
  const batteryReady = ['Solar Spotter','Spotter'].includes(item.equipment_type) || item.delivery_batteries_charged_ok;
  const hardwareReady = Boolean(item.delivery_sim_ok && item.delivery_camera_app_ok && item.delivery_sd_formatted_ok && item.delivery_recording_ok && batteryReady);
  if (item.purpose === 'BACKUP') return hardwareReady;
  return Boolean(hardwareReady && item.delivery_customer_email_app_ok && item.delivery_monitoring_ok && item.delivery_ticket_count_ok);
}
function itAnswerKey(item, field) { return `${item.id}:${field}`; }
function itBoolValue(item, field) { const key = itAnswerKey(item, field); return itDraftAnswers.has(key) ? itDraftAnswers.get(key) : item[field]; }
function itBoolAnswered(item, field) { const key = itAnswerKey(item, field); return itDraftAnswers.has(key) || item[field] === true || itAnswered.has(key); }
function itPhotoTagReady(item) {
  if (item?.equipment_type === '110V Stand' && !String(item?.unit_tag || '').trim()) return true;
  return item?.photo_tag_match_ok === true;
}
async function configureCurrentItItem() {
  const item = currentItItem();
  if (!itTypeChoice || !itPurposeChoice) return false;
  const required = 1;
  const result = item
    ? await liveDb.rpc('configure_it_prep_item', { p_item_id: item.id, p_equipment_type: itTypeChoice, p_purpose: itPurposeChoice, p_required_battery_count: required })
    : await liveDb.rpc('add_it_prep_item', { p_prep_id: activeItPrep.id, p_equipment_type: itTypeChoice, p_purpose: itPurposeChoice, p_recon_battery_count: required });
  if (result.error) { alert(result.error.message); return false; }
  activeItPrep = await getPrep(activeItPrep.id);
  if (['Spotter','Recon 2','Ranger'].includes(itTypeChoice)) {
    const configured=currentItItem();
    if (configured) {
      const { error:familyError }=await liveDb.rpc('save_it_camera_family_checks_v1',{
        p_item_id:configured.id,
        p_programmed_ok:false,
        p_port_81_ok:false,
        p_port_554_ok:false,
        p_recon_camera_count:itTypeChoice==='Recon 2'?Math.max(1,Number(itReconRequired||1)):null
      });
      if (familyError) { alert(familyError.message); return false; }
      activeItPrep=await getPrep(activeItPrep.id);
    }
  }
  if (itTypeChoice === 'Helios' && ['DELIVERY','SWAP','BACKUP'].includes(itPurposeChoice)) {
    const configured = currentItItem();
    if (configured) {
      const { error }=await liveDb.rpc('save_it_helios_deploy_checks_v1',{
        p_item_id:configured.id,
        p_camera1_hardware_ok:false,p_camera2_hardware_ok:false,p_ptz_assembly_ok:false,p_proxicast_4x4_ok:false,
        p_router_sim_ok:false,p_speaker_24v_ok:false,p_cameras_12v_ok:false,p_ptz_plate_4bolts_ok:false,
        p_cerbo_network_ok:false,p_cerbo_vrm_ok:false,p_rear_unit_tag_ok:false,p_battery_box_installed_ok:false,
        p_battery_120v_charged_ok:false,p_camera_router_programming_ok:false,p_alibi_vigilant_ok:false,p_3x1tb_sd_ok:false,
        p_camera1_ports_ok:false,p_camera2_ports_ok:false,p_ptz_ports_ok:false,p_speaker_ports_ok:false,
        p_sim_ok:false,p_camera_app_ok:false,p_customer_email_app_ok:false,p_monitoring_ok:false,p_sd_formatted_ok:false,p_recording_ok:false
      });
      if (error) { alert(error.message); return false; }
      activeItPrep = await getPrep(activeItPrep.id);
    }
  }
  return true;
}
async function persistCurrentItItem() {
  const item = currentItItem();
  if (!item) return false;
  if (['Spotter','Recon 2','Ranger'].includes(item.equipment_type)) {
    const { error:familyError }=await liveDb.rpc('save_it_camera_family_checks_v1',{
      p_item_id:item.id,
      p_programmed_ok:Boolean(item.unit_programmed_ok),
      p_port_81_ok:Boolean(item.camera_port_81_ok),
      p_port_554_ok:Boolean(item.camera_port_554_ok),
      p_recon_camera_count:item.equipment_type==='Recon 2'?Math.max(1,Number(item.recon_camera_count||1)):null
    });
    if (familyError) { alert(familyError.message); return false; }
  }
  const { error } = await liveDb.rpc('save_it_prep_item_draft', {
    p_item_id: item.id,p_unit_tag:item.unit_tag||'',p_battery_count:Number(item.battery_count||0),
    p_power_ok:Boolean(item.power_ok),p_functions_ok:Boolean(item.functions_ok),p_safe_ok:Boolean(item.safe_ok),
    p_sim_ok:Boolean(item.delivery_sim_ok),p_camera_app_ok:Boolean(item.delivery_camera_app_ok),
    p_customer_email_app_ok:Boolean(item.delivery_customer_email_app_ok),p_batteries_charged_ok:Boolean(item.delivery_batteries_charged_ok),
    p_monitoring_ok:Boolean(item.delivery_monitoring_ok),p_ticket_count_ok:Boolean(item.delivery_ticket_count_ok),
    p_sd_formatted_ok:Boolean(item.delivery_sd_formatted_ok),p_recording_ok:Boolean(item.delivery_recording_ok),
    p_mppt_updated_ok:Boolean(item.solar_mppt_updated_ok),p_mppt_tested_ok:Boolean(item.solar_mppt_tested_ok),
    p_pv_charging_ok:Boolean(item.solar_pv_charging_ok),p_solar_panels_match_ok:Boolean(item.solar_panels_match_ok),
    p_ticket_item_match_ok:Boolean(item.ticket_item_match_ok)
  });
  if (error) { alert(error.message); return false; }
  if (isHeliosDeploy(item)) {
    const { error:heliosError }=await liveDb.rpc('save_it_helios_deploy_checks_v1',{
      p_item_id:item.id,
      p_camera1_hardware_ok:Boolean(item.helios_camera1_hardware_ok),p_camera2_hardware_ok:Boolean(item.helios_camera2_hardware_ok),
      p_ptz_assembly_ok:Boolean(item.helios_ptz_assembly_ok),p_proxicast_4x4_ok:Boolean(item.helios_proxicast_4x4_ok),
      p_router_sim_ok:Boolean(item.helios_router_sim_ok),p_speaker_24v_ok:Boolean(item.helios_speaker_24v_ok),
      p_cameras_12v_ok:Boolean(item.helios_cameras_12v_ok),p_ptz_plate_4bolts_ok:Boolean(item.helios_ptz_plate_4bolts_ok),
      p_cerbo_network_ok:Boolean(item.helios_cerbo_network_ok),p_cerbo_vrm_ok:Boolean(item.helios_cerbo_vrm_ok),
      p_rear_unit_tag_ok:Boolean(item.helios_rear_unit_tag_ok),p_battery_box_installed_ok:Boolean(item.helios_battery_box_installed_ok),
      p_battery_120v_charged_ok:Boolean(item.helios_battery_120v_charged_ok),p_camera_router_programming_ok:Boolean(item.helios_camera_router_programming_ok),
      p_alibi_vigilant_ok:Boolean(item.helios_alibi_vigilant_ok),p_3x1tb_sd_ok:Boolean(item.helios_3x1tb_sd_ok),
      p_camera1_ports_ok:Boolean(item.helios_camera1_ports_ok),p_camera2_ports_ok:Boolean(item.helios_camera2_ports_ok),
      p_ptz_ports_ok:Boolean(item.helios_ptz_ports_ok),p_speaker_ports_ok:Boolean(item.helios_speaker_ports_ok),
      p_sim_ok:Boolean(item.delivery_sim_ok),p_camera_app_ok:Boolean(item.delivery_camera_app_ok),
      p_customer_email_app_ok:Boolean(item.delivery_customer_email_app_ok),p_monitoring_ok:Boolean(item.delivery_monitoring_ok),
      p_sd_formatted_ok:Boolean(item.delivery_sd_formatted_ok),p_recording_ok:Boolean(item.delivery_recording_ok)
    });
    if (heliosError) { alert(heliosError.message); return false; }
  }
  activeItPrep = await getPrep(activeItPrep.id);
  return true;
}
function itCheckStepHtml(item, step, index, total, unitNo) {
  if (step.kind === 'tag') return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Step ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' value='${esc(item.unit_tag || '')}' placeholder='${step.optional ? 'Enter tag if present' : 'Exact unit tag'}'>${step.optional ? "<div class='wl-note top8'>No tag is valid for a 110V Stand. Leave this blank if the stand does not have one.</div>" : ''}</div>`;
  if (step.kind === 'number') { const min=Number(step.min ?? (step.field==='battery_count' ? item.required_battery_count : 1) ?? 1); const value=item[step.field] ?? (step.field==='battery_count' ? item.required_battery_count : min); return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Step ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' type='number' inputmode='numeric' min='${min}' value='${esc(value ?? '')}'><div class='wl-note top8'>Required minimum: ${min}</div></div>`; }
  const answered = itBoolAnswered(item, step.field);
  const value = itBoolValue(item, step.field);
  const yes = answered && value === true;
  const no = answered && value !== true;
  return `<div class='wl-question'><div class='qnum'>Unit ${unitNo} · Check ${index + 1} of ${total}</div><div class='qtext'>${esc(step.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-it-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>NO recorded.</b><div>This unit cannot be handed off to Service until this answer is corrected to YES.</div></div>` : ''}</div>`;
}
function itUnitIssues(item, evidence, unitNo) {
  const steps = itUnitStepsData(item, unitNo);
  const issues = [];
  steps.forEach((step, index) => {
    const failed = step.kind === 'number' ? Number(item[step.field] || 0) < Number(step.min ?? (step.field==='battery_count' ? item.required_battery_count : 1) ?? 1) : step.kind === 'tag' ? (!step.optional && !String(item[step.field] || '').trim()) : itBoolValue(item, step.field) !== true;
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
  const tagText = item.equipment_type === '110V Stand' && !String(item.unit_tag || '').trim() ? 'No tag on this stand' : (itPhotoTagReady(item) ? '✓ Visible and matches' : 'Not confirmed');
  return `<div class='wl-review' data-unit-tag='${esc(item.unit_tag||'')}'><b>${esc(identity)}</b><div><b>Unit:</b> ${unitNo}</div><div><b>Purpose:</b> ${esc(item.purpose)}</div>${item.equipment_type==='Recon 2'? `<div><b>Recon II cameras:</b> ${Number(item.recon_camera_count||0)}</div>` : ''}${Number(item.required_battery_count || 0) > 0 ? `<div><b>Batteries / boxes:</b> ${Number(item.battery_count || 0)} (minimum ${Number(item.required_battery_count || 0)})</div>` : ''}<div><b>Checks:</b> ${passed} of ${steps.length} passed</div><div><b>Photos:</b> ${photos.length}</div><div><b>Photo unit tag:</b> ${tagText}</div></div>`;
}
const TRUCK_SPARE_BATTERY_OPTIONS = window.TechCheckRules?.truckSpareBatteryOptions || [
  { key:'spotter-agm', equipment_type:'Solar Spotter', battery_type:'AGM 12V 110Ah', label:'Solar Spotter · AGM 12V 110Ah' },
  { key:'spotter-350', equipment_type:'Solar Spotter', battery_type:'12V 350Ah', label:'Solar Spotter · 12V 350Ah' },
  { key:'ranger-litime', equipment_type:'Ranger', battery_type:'LiTime 12V 110Ah', label:'Ranger · LiTime 12V 110Ah' },
  { key:'helios-box', equipment_type:'Helios', battery_type:'Helios Battery Box', label:'Helios · Battery Box' },
  { key:'recon-battery', equipment_type:'Recon 2', battery_type:'Recon II Battery', label:'Recon II · Spare Battery' },
];
async function loadTruckSpareBatteries(prepId) {
  if (!prepId) return [];
  const { data,error } = await liveDb.from('truck_spare_batteries').select('*').eq('prep_ticket_id',prepId).order('created_at',{ascending:true});
  if (error) throw error;
  return data || [];
}
function truckSpareITPanelHtml(rows,items,evidence=[]) {
  const byKey=new Map((rows||[]).map(r=>[r.equipment_type+'|'+r.battery_type,r]));
  const indexed=(items||[]).map((item,index)=>({item,index}));
  const backups=indexed.filter(row=>row.item.purpose==='BACKUP');
  const backupHtml=backups.length
    ? backups.map(({item:i,index})=>{
        const checkedOut=Boolean(i.spare_it_checked_out_at);
        const issues=itUnitIssues(i,evidence,index+1);
        const canCheckout=issues.length===0;
        const status=checkedOut
          ? `<div class='ok top8'><b>✓ IT CHECKED OUT</b><div class='small'>${esc(i.spare_it_checked_out_by_name||'IT Technician')} · ${new Date(i.spare_it_checked_out_at).toLocaleString()}</div></div>`
          : canCheckout
            ? `<button class='wl-big wl-blue top8' style='min-height:50px;font-size:15px' data-wl-checkout-truck-spare-unit='${i.id}'>CHECK OUT SPARE →</button><div class='small'>IT must check this spare out before Service can take it.</div>`
            : `<div class='warn top8'><b>CHECKOUT PENDING</b><div class='small'>Finish this spare's IT checks, matching-tag photo, and signature first.</div></div>`;
        return `<div class='wl-ticket'><b>TRUCK SPARE · ${esc(i.equipment_type)}</b><div>Unit ${esc(i.unit_tag||'Tag pending')} · ${i.verified_at?'IT check complete':'IT check pending'}</div><div class='small'>This is contingency equipment for MHelpDesk #${esc(activeItPrep?.ticket_no||'')}. IT checkout happens before the Service handoff.</div>${status}</div>`;
      }).join('')
    : `<div class='small'>No spare unit added yet. Add one only when Service should carry an emergency replacement for this ticket.</div>`;

  const batteryRows=TRUCK_SPARE_BATTERY_OPTIONS.map(opt=>{
    const row=byKey.get(opt.equipment_type+'|'+opt.battery_type);
    const qty=Number(row?.qty_prepared||0);
    const ready=Boolean(row?.ready_ok);
    const checkedOut=Boolean(row?.it_checked_out_at);
    const locked=checkedOut ? 'disabled' : '';
    const checkout=qty>0
      ? checkedOut
        ? `<div class='ok top8'><b>✓ IT CHECKED OUT</b><div class='small'>${esc(row?.it_checked_out_by_name||'IT Technician')} · ${new Date(row.it_checked_out_at).toLocaleString()}</div></div>`
        : ready
          ? `<button class='wl-big wl-blue top8' style='min-height:50px;font-size:15px' data-wl-checkout-truck-spare-battery='${row.id}'>CHECK OUT SPARE BATTERIES →</button>`
          : `<div class='warn top8'><b>CHECKOUT PENDING</b><div class='small'>Mark this battery batch physically present, charged & READY, save the plan, then check it out.</div></div>`
      : '';
    return `<div class='wl-ticket'><b>${esc(opt.label)}</b><div class='grid2 top8'><label>Spare Qty<input id='wlSpareQty_${opt.key}' type='number' inputmode='numeric' min='0' value='${qty}' ${locked}></label><label class='check' style='align-self:end'><input id='wlSpareReady_${opt.key}' type='checkbox' ${ready?'checked':''} ${locked}><span>Physically present, charged & READY</span></label></div>${qty&&!ready?`<div class='warn top8'><b>Pending:</b> mark this battery batch READY before checkout.</div>`:''}${checkout}</div>`;
  }).join('');

  return `<div class='wl-question top10' data-wl-truck-spares-it>
    <div class='qnum'>TRUCK SPARES / BACKUPS</div>
    <div class='qtext'>Contingency equipment for this Service call</div>
    <div class='small'>The flow remains <b>IT check → photo/signature → IT CHECK OUT → Service handoff</b>. A spare cannot leave with Service until IT checks it out. After the field call, Service resolves it as USED or RETURN UNUSED.</div>
    <div class='top10'><b>Spare Units</b></div>
    ${backupHtml}
    <div class='grid2 top10'><label>Spare Unit Type<select id='wlTruckSpareUnitType'><option value=''>Choose spare…</option>${['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'].map(v=>`<option value='${esc(v)}'>${esc(v)}</option>`).join('')}</select></label><label>Recon II camera count<input id='wlTruckSpareReconCount' type='number' inputmode='numeric' min='1' value='1'></label></div>
    <button class='wl-big wl-blue top10' style='min-height:52px;font-size:16px' data-wl-add-truck-spare-unit>＋ Add Spare Unit & Run IT Check</button>
    <div class='top10'><b>Spare Batteries</b><div class='small'>Enter and save the spare quantity first. Then IT must use CHECK OUT SPARE BATTERIES before the Service handoff.</div></div>
    ${batteryRows}
    <button class='wl-big wl-blue top10' style='min-height:52px;font-size:16px' data-wl-save-truck-spare-batteries>Save Spare Battery Plan</button>
  </div>`;
}
async function addTruckSpareUnitFromSummary() {
  if (!activeItPrep?.id || activeItPrep.status!=='draft') return alert('Truck spares can only be added before the Service handoff.');
  const type=document.getElementById('wlTruckSpareUnitType')?.value || '';
  if (!type) return alert('Choose the spare unit type first.');
  const recon=Math.max(1,Number(document.getElementById('wlTruckSpareReconCount')?.value||1));
  const { data,error }=await liveDb.rpc('add_it_truck_spare_unit',{
    p_prep_id:activeItPrep.id,
    p_equipment_type:type,
    p_recon_battery_count:type==='Recon 2'?1:null
  });
  if (error) return alert(error.message);
  activeItPrep=await getPrep(activeItPrep.id);
  if (['Spotter','Recon 2','Ranger'].includes(type)) {
    const added=itItems().find(i=>i.id===data);
    if (added) {
      const { error:familyError }=await liveDb.rpc('save_it_camera_family_checks_v1',{
        p_item_id:added.id,p_programmed_ok:false,p_port_81_ok:false,p_port_554_ok:false,
        p_recon_camera_count:type==='Recon 2'?recon:null
      });
      if (familyError) return alert(familyError.message);
      activeItPrep=await getPrep(activeItPrep.id);
    }
  }
  itExpectedUnits=activeItPrep.expected_unit_count||itItems().length;
  const items=itItems();
  const found=items.findIndex(i=>i.id===data);
  itUnitIndex=found>=0?found:Math.max(0,items.length-1);
  itTypeChoice=type;
  itPurposeChoice='BACKUP';
  itReconRequired=recon;
  itQuestionIndex=0;
  itUnitPhase='checks';
  return renderItUnitStep();
}
async function saveTruckSpareBatteriesFromSummary() {
  if (!activeItPrep?.id || activeItPrep.status!=='draft') return alert('Spare batteries can only be changed before the Service handoff.');
  for (const opt of TRUCK_SPARE_BATTERY_OPTIONS) {
    const qtyInput=document.getElementById('wlSpareQty_'+opt.key);
    if (qtyInput?.disabled) continue;
    const qty=Math.max(0,Math.floor(Number(qtyInput?.value||0)));
    const ready=Boolean(document.getElementById('wlSpareReady_'+opt.key)?.checked);
    const { error }=await liveDb.rpc('save_it_truck_spare_battery',{
      p_prep_id:activeItPrep.id,
      p_equipment_type:opt.equipment_type,
      p_battery_type:opt.battery_type,
      p_qty:qty,
      p_ready_ok:ready
    });
    if (error) return alert(error.message);
  }
  alert('Truck spare battery plan saved.');
  return renderItUnitStep();
}


async function checkoutTruckSpareUnit(itemId) {
  if (!activeItPrep?.id || activeItPrep.status!=='draft') return alert('Truck spare checkout must happen before the Service handoff.');
  const item=itItems().find(row=>row.id===itemId);
  if (!item) return alert('Truck spare unit could not be found.');
  if (!confirm('Check out '+item.equipment_type+' '+(item.unit_tag||'')+' as a truck spare for MHelpDesk #'+activeItPrep.ticket_no+'?')) return;
  const { error }=await liveDb.rpc('it_checkout_truck_spare_unit',{p_item_id:itemId});
  if (error) return alert(error.message);
  activeItPrep=await getPrep(activeItPrep.id);
  return renderItUnitStep();
}
async function checkoutTruckSpareBattery(spareId) {
  if (!activeItPrep?.id || activeItPrep.status!=='draft') return alert('Spare battery checkout must happen before the Service handoff.');
  const rows=await loadTruckSpareBatteries(activeItPrep.id);
  const row=rows.find(x=>x.id===spareId);
  if (!row) return alert('Spare battery batch could not be found.');
  if (!confirm('Check out '+row.qty_prepared+' × '+row.battery_type+' for MHelpDesk #'+activeItPrep.ticket_no+'?')) return;
  const { error }=await liveDb.rpc('it_checkout_truck_spare_battery',{p_spare_id:spareId});
  if (error) return alert(error.message);
  return renderItUnitStep();
}

function itTicketSummaryHtml(items, evidence) {
  const jobItems=items.map((item,index)=>({item,index})).filter(row=>row.item.purpose!=='BACKUP');
  const units=jobItems.map(({item,index})=>{
    const unitNo=index+1;
    const photos=unitEvidence(evidence,unitNo,'photo');
    const sig=unitSignature(evidence,unitNo);
    return `<div class='wl-ticket'>
      <b>Unit ${unitNo} — ${esc(item.equipment_type)}</b>
      <div>${esc(item.purpose)} · Unit ${esc(item.unit_tag||'')}</div>
      <div class='small'>📷 ${photos.length} photo${photos.length===1?'':'s'} · ✍️ ${sig?'Signed by '+esc(sig.created_by_name||'IT Technician'):'Signature missing'}</div>
      <button class='mini top8' data-wl-final-unit='${index}'>Review / Adjust Unit</button>
    </div>`;
  }).join('');
  return `<div class='wl-review'>
    <b>MHelpDesk #${esc(activeItPrep.ticket_no)}</b>
    <div>${esc(activeItPrep.site||'')}</div>
    <div><b>Units / Devices:</b> ${Number(activeItPrep.requested_unit_count ?? equipmentManifestDeviceTotal(activeItPrep.equipment_manifest))}</div>
    <div><b>Stands / Poles:</b> ${equipmentManifestStandTotal(activeItPrep.equipment_manifest)}</div>
  </div>
  ${equipmentManifestInlineHtml(activeItPrep)}
  <div class='top10'>${units||"<div class='small'>No job equipment prepared yet.</div>"}</div>`;
}
function itFinalPartsSummaryHtml() {
  const rows=ticketPartsRows(activeItPrep).filter(row=>row.qty>0);
  const line=rows.length?rows.map(row=>row.qty+' × '+esc(row.label)).join(' · '):'None listed';
  return `<div class='wl-question top10'>
    <div class='qnum'>ADDITIONAL LOOSE PARTS</div>
    <div class='qtext'>${line}</div>
    <div class='small'>Unit-specific required components belong in that unit's checklist, not here.</div>
    <button class='mini top8' data-wl-final-view='parts'>Adjust Parts</button>
  </div>`;
}
function itFinalSpareSummaryHtml(items,rows) {
  const units=(items||[]).filter(item=>item.purpose==='BACKUP');
  const batteries=(rows||[]).filter(row=>Number(row.qty_prepared||0)>0);
  const bits=[];
  if(units.length) bits.push(units.map(item=>esc(item.equipment_type)+' '+esc(item.unit_tag||'')).join(' · '));
  if(batteries.length) bits.push(batteries.map(row=>Number(row.qty_prepared)+' × '+esc(row.battery_type)).join(' · '));
  return `<div class='wl-question top10'>
    <div class='qnum'>TRUCK SPARES / BACKUPS</div>
    <div class='qtext'>${bits.join(' · ')||'None added'}</div>
    <div class='small'>Contingency equipment stays separate from the main ticket equipment summary.</div>
    <button class='mini top8' data-wl-final-view='spares'>Manage Truck Spares</button>
  </div>`;
}
function itFinalPartsEditorHtml() {
  return `${progress('Additional Parts','Separate from the ticket review',1,1)}
    <div class='wl-review'><b>MHelpDesk #${esc(activeItPrep.ticket_no)}</b><div>${esc(activeItPrep.site||'')}</div></div>
    <div class='wl-question top10'>
      <div class='qnum'>ADDITIONAL LOOSE PARTS</div>
      <div class='qtext'>Only add loose parts specifically needed for this ticket.</div>
      <div class='small'>Normal components that belong to the unit are handled in that unit's IT checklist.</div>
      ${ticketPartsInputsHtml('wlEditPart',activeItPrep)}
      <button class='wl-big wl-blue top10' data-wl-save-prep-parts>Save & Return to Ticket Summary</button>
    </div>
    <div class='wl-nav'><button class='wl-prev' data-wl-final-view='summary'>← Ticket Summary</button><button class='wl-next' data-wl-home='it'>IT Home →</button></div>`;
}
function itFinalSparesEditorHtml(spareBatteries,items,evidence) {
  return `${progress('Truck Spares / Backups','Separate contingency equipment',1,1)}
    <div class='wl-review'><b>MHelpDesk #${esc(activeItPrep.ticket_no)}</b><div>${esc(activeItPrep.site||'')}</div></div>
    ${truckSpareITPanelHtml(spareBatteries,items,evidence)}
    <div class='wl-nav'><button class='wl-prev' data-wl-final-view='summary'>← Ticket Summary</button><button class='wl-next' data-wl-home='it'>IT Home →</button></div>`;
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
      if (['DELIVERY','BACKUP'].includes(item.purpose) || (item.equipment_type === 'Sniper' && item.purpose === 'SWAP')) {
        // Solar Spotter batteries are a Service-side checkout. The legacy delivery RPC still requires this compatibility flag.
        const { error: deliveryError } = await liveDb.rpc('verify_delivery_item_checks', { p_item_id: item.id, p_sim_ok: Boolean(item.delivery_sim_ok), p_camera_app_ok: Boolean(item.delivery_camera_app_ok), p_customer_email_app_ok: Boolean(item.delivery_customer_email_app_ok), p_batteries_charged_ok: item.equipment_type === 'Solar Spotter' ? true : Boolean(item.delivery_batteries_charged_ok), p_monitoring_ok: Boolean(item.delivery_monitoring_ok), p_ticket_count_ok: item.equipment_type === 'Helios' ? true : Boolean(item.delivery_ticket_count_ok), p_sd_formatted_ok: Boolean(item.delivery_sd_formatted_ok), p_recording_ok: Boolean(item.delivery_recording_ok) });
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
    alert(`MHelpDesk Ticket #${ticketNo}: Service handoff created.`);
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
    itFinalView = 'summary';
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
    itReconRequired = Number(item.recon_camera_count || 1);
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
function itEquipmentAIReview(item,ev,unitNo){
  const type=String(item?.equipment_type||itTypeChoice||'Equipment'), issues=item?itUnitIssues(item,ev||[],unitNo):[], flags=[];
  const low=type.toLowerCase();
  if(low.includes('helios')) flags.push('Helios focus: cameras → modem → antenna → camera/modem programming → ports/configuration; verify 3 × 1TB SD cards.');
  if(low.includes('solar spotter')) flags.push('Solar Spotter IT check does not include battery checkout. The Solar Stand and its battery setup are verified on the Service side (4 × AGM 12V 110Ah or 1 × 12V 350Ah per stand).');
  if(low.includes('ranger')) flags.push('Ranger: verify MPPT update, MPPT operation, and charging. Service should receive 1 solar panel per Ranger.');
  if(low.includes('helios')) flags.push('Verify Camera 1: 81/554/1400 · Camera 2: 81/554/1500 · PTZ: 81/554/1600 · IP Speaker: 81/554/1700.');
  return `<div class='wl-ai-panel wl-ai-equipment'><div class='wl-ai-head'>${onsiteVisionTitle('Equipment Check')}<b>${issues.length?'VERIFY '+issues.length+' ITEM'+(issues.length===1?'':'S'):'ON TRACK'}</b></div><div class='wl-ai-line'><b>${esc(type)}</b> · Item ${unitNo}</div>${flags.length?`<div class='wl-ai-line'>${flags.map(v=>'• '+esc(v)).join('<br>')}</div>`:''}${issues.length?`<div class='wl-ai-warn'>${issues.slice(0,5).map(v=>'⚠ '+esc(v.label||v.message||v.phase||'Required check incomplete')).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ No required-item conflicts detected at this point.</div>`}<div class='small top8'>AI Assist does not answer checks or approve equipment for the technician.</div></div>`;
}
async function renderItUnitStep() {
  const items = itItems();
  const totalUnits = activeItPrep.expected_unit_count || itExpectedUnits || items.length;
  const wizard = itWizardCard();
  hideChildren(viewIT(), [wizard]);
  if (itUnitIndex >= totalUnits || itUnitPhase === 'final') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const spareBatteries = await loadTruckSpareBatteries(activeItPrep.id);
    const itemReady = items.length === totalUnits && items.every((item, index) => itUnitIssues(item, ev, index + 1).length === 0);
    const spareUnits=items.filter(row=>row.purpose==='BACKUP');
    const spareUnitsCheckedOut=spareUnits.every(row=>Boolean(row.spare_it_checked_out_at));
    const spareBatteriesReady = spareBatteries.every(row => Boolean(row.ready_ok));
    const spareBatteriesCheckedOut = spareBatteries.every(row => Boolean(row.it_checked_out_at));
    const ready = itemReady && spareUnitsCheckedOut && spareBatteriesReady && spareBatteriesCheckedOut;

    if (itFinalView==='parts') {
      wizard.innerHTML=itFinalPartsEditorHtml();
      resetWizardPosition(wizard);
      return;
    }
    if (itFinalView==='spares') {
      wizard.innerHTML=itFinalSparesEditorHtml(spareBatteries,items,ev);
      resetWizardPosition(wizard);
      return;
    }

    wizard.innerHTML =
      progress('Ticket Summary', ready ? 'READY — Review & Hand Off' : 'Review before handoff', 1, 1) +
      itTicketSummaryHtml(items, ev) +
      itFinalPartsSummaryHtml() +
      itFinalSpareSummaryHtml(items,spareBatteries) +
      (!spareUnitsCheckedOut ? `<div class='wl-stop top10'><b>Truck spare checkout is not complete.</b><div>Open Manage Truck Spares and CHECK OUT every spare unit before Service can take it.</div></div>` : '') +
      ((!spareBatteriesReady || !spareBatteriesCheckedOut) ? `<div class='wl-stop top10'><b>Spare battery checkout is not complete.</b><div>Open Manage Truck Spares and finish the spare battery checkout.</div></div>` : '') +
      `<div id='wlSendItMsg'></div>` +
      (ready ? `<div class='ok top10'><b>✓ IT PREP COMPLETE</b><div>Review the ticket above, then create the Service handoff.</div></div>` : '') +
      `<button class='wl-big wl-green top10' style='font-size:18px;min-height:58px' data-wl-send-it ${ready ? '' : 'disabled'}>HAND OFF TO SERVICE TECH →</button>
      <div class='wl-nav'><button class='wl-prev' data-wl-final-last-unit>← Back to Unit Checks</button><button class='wl-next' data-wl-home='it'>IT Home →</button></div>
      <button class='wl-big wl-gray top10' data-wl-it='history'>Status & History →</button>`;
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
    wizard.innerHTML = progress(`Unit ${unitNo} of ${totalUnits}`, `What is Unit ${unitNo} for?`, 1, 1) + `<div class='wl-question'><div class='qtext'>Choose SWAP or DELIVERY</div><div class='wl-options'>${purposes.map(p => `<button class='${itPurposeChoice === p ? 'pass on' : 'pass'}' data-wl-unit-purpose='${p}'>${p}</button>`).join('')}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
  } else if (itUnitPhase === 'recon') {
    wizard.innerHTML = progress(`Unit ${unitNo} of ${totalUnits}`, 'Recon II camera count', 1, 1) + `<div class='wl-question'><div class='qtext'>How many cameras are going on this Recon II for this deployment?</div><input id='wlReconRequired' type='number' inputmode='numeric' min='1' value='${Math.max(1, Number(itReconRequired || 1))}'></div><div class='wl-note top8'>Battery quantity is entered separately during the unit check after the Recon II is programmed and ready.</div><div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next →</button></div>`;
  } else if (itUnitPhase === 'checks') {
    const steps = itUnitStepsData(item, unitNo);
    const step = steps[itQuestionIndex];
    wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, step?.label || `Check ${identity}`, itQuestionIndex + 1, Math.max(1, steps.length)) + itEquipmentAIReview(item,[],unitNo) + itCheckStepHtml(item, step, itQuestionIndex, steps.length, unitNo) + `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>${itQuestionIndex === steps.length - 1 ? 'Next: Photo →' : 'Next →'}</button></div>`;
  } else if (itUnitPhase === 'photo') {
    wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, `Photograph ${identity} with tag ${esc(item.unit_tag || '')} visible`, 1, 3) + await photoOnlyHtml(activeItPrep.id, 'it', unitNo) + `<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next>Next: Signature →</button></div>`;
  } else if (itUnitPhase === 'review') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const issues = itUnitIssues(item, ev, unitNo);
    const ready = issues.length === 0;
    const sig = unitSignature(ev, unitNo); wizard.innerHTML = progress(`${identity} · Unit ${unitNo} of ${totalUnits}`, `Review ${identity}`, 3, 3) + itEquipmentAIReview(item,ev,unitNo) + itUnitReviewHtml(item, ev, unitNo) + itIssueLinksHtml(item, ev, unitNo) + `${ready ? `<div class='ok'><b>✓ Checks, photo, and signature complete for ${esc(identity)}.</b></div>` : `<div class='wl-stop'><b>${esc(identity)} is not ready.</b><div>Choose an issue above to go directly to it.</div><button class='wl-big wl-red top10' data-wl-fix-issues>← Go to First Issue</button></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-it-prev>Back</button><button class='wl-next' data-wl-it-next ${ready ? '' : 'disabled'}>${unitNo < totalUnits ? `Next: Unit ${unitNo + 1} →` : 'Next: Ticket Summary →'}</button></div>`;
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
let serviceDashboardLoadToken=0;
let itDashboardLoadToken=0;
function techDashboardLoadingHtml(label){
  return "<div class='wl-tech-load'><div><div class='wl-tech-load-ring'></div><h3>"+esc(label)+"</h3><p>Loading live Tech Check work. You can leave this screen at any time; the app will not lock up.</p></div></div>";
}
function techDashboardErrorHtml(role,message){
  const label=role==='it'?'IT Technician':'Service Tech';
  return "<div class='wl-tech-load'><div class='wl-tech-load-error'><b>"+esc(label)+" dashboard could not finish loading.</b><div class='small top8'>"+esc(message||'A live data request did not complete.')+"</div><button class='wl-big wl-blue' data-wl-dashboard-retry='"+esc(role)+"'>Retry Dashboard →</button></div></div>";
}
function techDashboardTimeout(promise,fallback,ms=7000){
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out loading live data.')),ms);})
  ]).then(value=>{clearTimeout(timer);return value;},error=>{
    clearTimeout(timer);
    console.warn('Tech dashboard live-data request failed; using safe fallback.',error);
    throw error;
  });
}
function techDashboardSettled(results){
  return results.some(r=>r.status==='rejected');
}

async function showSvcHome() {
  if (!isSvc() || !viewSvc()) return;
  let home=document.getElementById('wlSvcHome');
  if(!home){
    home=document.createElement('div');
    home.id='wlSvcHome';
    home.className='card wl-home wl-service-simple-home';
    viewSvc().prepend(home);
  }
  home.innerHTML=techDashboardLoadingHtml('Loading your day…');
  hideChildren(viewSvc(),[home]);
  resetWizardPosition();

  const work=await techDashboardTimeout(
    serviceWorkData(),
    {assignments:[],released:[],inspectionDone:false,inspectionRequired:serviceInspectionRequiredToday(),deployed:[]}
  );
  const ownerViewingService=roleText().includes('Owner/Admin');
  const techName=document.getElementById('whoName')?.textContent?.trim() || (ownerViewingService?'Service Technician':'Technician');
  const firstName=String(techName||'Technician').trim().split(/\s+/)[0] || 'Technician';
  const inspectionDue=Boolean(work.inspectionRequired&&!work.inspectionDone);
  const inspectionDone=Boolean(work.inspectionDone);
  const weekend=!work.inspectionRequired;

  const startAction=inspectionDue
    ? `<button class='wl-service-start' data-wl-svc='inspect'>START MY DAY</button>`
    : `<button class='wl-service-start' data-wl-service-open-job>${inspectionDone?'CONTINUE MY DAY':'START MY DAY'}</button>`;

  const statusLine=inspectionDue
    ? 'First: complete your truck inspection.'
    : weekend
      ? 'No start-day vehicle inspection is required today.'
      : 'Truck inspection complete. Enter your next MHelpDesk ticket.';

  home.innerHTML=`<div class='wl-service-simple-shell'>
    <div class='wl-service-simple-kicker'>SERVICE TECH</div>
    <h1>HELLO, ${esc(ownerViewingService?'TECHNICIAN':firstName.toUpperCase())}</h1>
    <p>${esc(statusLine)}</p>
    ${startAction}
    <div class='wl-service-flowline'>TRUCK CHECK <b>→</b> TRAILER IF NEEDED <b>→</b> MHELPDESK TICKET <b>→</b> JOB</div>

    <details class='wl-service-more'>
      <summary>OTHER ACTIONS</summary>
      <div class='wl-service-more-grid'>
        <button data-wl-service-return>RETURN UNIT TO IT</button>
        <button data-wl-svc='returns'>MY RETURNED UNITS</button>
        <button data-wl-offline-start>OFFLINE UNIT / CALL IT</button>
        <button data-wl-svc='history'>STATUS & HISTORY</button>
      </div>
    </details>
  </div>`;

  hideChildren(viewSvc(),[home]);
  resetWizardPosition();
}
function showServiceJobLookup() {
  let card=document.getElementById('wlSvcLookup');
  if(!card){
    card=document.createElement('div');
    card.id='wlSvcLookup';
    card.className='card wl-service-simple-card';
    viewSvc().append(card);
  }
  card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← BACK</button>
    <div class='wl-service-step-label'>NEXT STEP</div>
    <div class='wl-question wl-service-ticket-entry'>
      <div class='qtext'>ENTER YOUR MHELPDESK TICKET #</div>
      <input id='wlServiceJobSearch' inputmode='numeric' autocomplete='off' placeholder='TICKET #'>
      <button class='wl-service-start top10' data-wl-service-find-job>FIND MY JOB</button>
      <div id='wlServiceJobSearchMsg' class='wl-service-help'>The ticket must be assigned to you or available to the Service team.</div>
    </div>`;
  hideChildren(viewSvc(),[card]);
  resetWizardPosition();
  requestAnimationFrame(()=>document.getElementById('wlServiceJobSearch')?.focus());
}

async function serviceFindJobByTicket(){
  const input=document.getElementById('wlServiceJobSearch'), msg=document.getElementById('wlServiceJobSearchMsg');
  const ticket=String(input?.value||'').trim().replace(/^#\s*/,'');
  if(!ticket){if(msg)msg.innerHTML='<div class="wl-stop"><b>ENTER A TICKET NUMBER.</b></div>';return;}
  const tech=await currentTechIdentity().catch(()=>null);
  if(!tech?.id)return alert('Active Service Tech account required.');

  const {data,error}=await liveDb.from('job_assignments')
    .select('*')
    .eq('ticket_no',ticket)
    .eq('assigned_role','service')
    .in('status',['assigned','started'])
    .order('assigned_at',{ascending:false})
    .limit(10);
  if(error)return alert(error.message);

  let a=(data||[]).find(x=>x.assignee_user_id===tech.id)
    ||(data||[]).find(x=>!x.assignee_user_id&&x.assignment_scope==='department');

  if(!a){
    if(msg)msg.innerHTML=`<div class='wl-stop'><b>NO SERVICE JOB FOUND FOR #${esc(ticket)}</b><div>Check the ticket number or ask the Owner to assign it to you.</div></div>`;
    return;
  }

  const gate=await assignmentGateState(a);
  const assignedToMe=a.assignee_user_id===tech.id;
  const ready=Boolean(gate.ready);
  const assignmentText=assignedToMe?'THIS JOB IS ASSIGNED TO YOU':'THIS JOB IS AVAILABLE TO THE SERVICE TEAM';

  if(msg)msg.innerHTML=`<div class='wl-service-ticket-found'>
    <div class='wl-service-step-label'>JOB FOUND</div>
    <div class='wl-service-ticket-number'>#${esc(a.ticket_no)}</div>
    <div class='wl-service-ticket-site'>${esc(a.site||'NO SITE LISTED')}</div>
    <div class='${ready?'wl-service-good':'wl-service-wait'}'>${ready?'✓ '+esc(assignmentText):'WAITING — '+esc(gate.label)}</div>
    ${ready
      ? `<button class='wl-service-start top10' data-wl-service-take-job='${a.id}'>START JOB</button>`
      : `<div class='wl-stop top10'><b>YOU CANNOT START YET.</b><div>${esc(gate.detail||'The required handoff is not ready.')}</div></div>`}
  </div>`;
}
async function serviceTakeVerifiedJob(id){
  const {data:rows,error}=await liveDb.from('job_assignments').select('*').eq('id',id).eq('assigned_role','service').limit(1);
  if(error)return alert(error.message); const a=rows?.[0]; if(!a)return alert('This Service job is no longer available.');
  const gate=await assignmentGateState(a); if(!gate.ready)return alert(gate.label+'\n\n'+gate.detail);
  const tech=await currentTechIdentity().catch(()=>null); if(!tech?.id)return alert('Active Service Tech account required.');
  if(a.assignee_user_id&&a.assignee_user_id!==tech.id)return alert('This ticket has already been assigned to another Service Tech.');
  if(!a.assignee_user_id&&a.assignment_scope==='department'){
    const {error:claimError}=await liveDb.rpc('claim_my_department_assignment',{p_assignment_id:id});
    if(claimError)return alert(claimError.message||'Another Service Tech already claimed this ticket.');
  }
  return startAssignedJob(id);
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
  const tech=await currentTechIdentity().catch(()=>null);
  const assignment=(activeSvcAssignment?.ticket_no===prep.ticket_no && activeSvcAssignment?.assignee_user_id===tech?.id)
    ? activeSvcAssignment
    : await myServiceAssignmentForTicket(prep.ticket_no,prep.id);
  if(currentRoleKey()!=='owner' && !assignment){
    document.getElementById('wlLookupMsg').innerHTML = `<div class='bad top10'><b>This released handoff is not assigned to you.</b><div>Return to Service Home and open / claim the correct MHelpDesk job first.</div></div>`;
    return;
  }
  if(assignment) activeSvcAssignment=assignment;
  document.getElementById('svcLookup').value = prep.ticket_no;
  await window.findPrep();
  await new Promise(r => setTimeout(r, 200));
  activeSvcPrep = await getPrep(prep.id);
  activeSvcAssignment = activeSvcAssignment?.ticket_no === activeSvcPrep.ticket_no ? activeSvcAssignment : await myServiceAssignmentForTicket(activeSvcPrep.ticket_no, activeSvcPrep.id);
  svcUnitIndex = 0;
  svcQuestionIndex = 0;
  showSvcTicketConfirmation();
}
async function showSvcTicketConfirmation() {
  if (!activeSvcPrep) return;
  const base = document.getElementById('matchedPreps')?.closest('.card');
  const card = findSvcCard(activeSvcPrep.ticket_no);
  if (!base || !card) return alert('Could not open the matched equipment.');
  const forms = svcForms(card);
  const types = [...new Set((activeSvcPrep.prep_items || []).map(item => item.equipment_type).filter(Boolean))];
  const wizard = svcWizardCard();
  const preparedBy = activeSvcPrep.released_by_name || 'IT Technician';
  const spareUnits=(activeSvcPrep.prep_items || []).filter(item=>item.purpose==='BACKUP');
  const spareBatteries=await loadTruckSpareBatteries(activeSvcPrep.id).catch(()=>[]);
  const spareCheckoutHtml=(spareUnits.length || spareBatteries.length)
    ? `<div class='wl-question top10'><div class='qnum'>IT TRUCK SPARE CHECKOUT</div><div class='qtext'>These spares were checked out by IT before this handoff</div>${
        spareUnits.map(item=>`<div class='ok top8'><b>✓ ${esc(item.equipment_type)} ${esc(item.unit_tag||'')}</b><div class='small'>IT CHECKED OUT · ${esc(item.spare_it_checked_out_by_name||preparedBy)}${item.spare_it_checked_out_at?' · '+new Date(item.spare_it_checked_out_at).toLocaleString():''}</div></div>`).join('')
      }${
        spareBatteries.map(row=>`<div class='ok top8'><b>✓ ${Number(row.qty_prepared||0)} × ${esc(row.battery_type)}</b><div class='small'>${esc(row.equipment_type)} spare batteries · IT CHECKED OUT · ${esc(row.it_checked_out_by_name||preparedBy)}${row.it_checked_out_at?' · '+new Date(row.it_checked_out_at).toLocaleString():''}</div></div>`).join('')
      }<div class='small top8'>Physically verify these checked-out spares before taking them from the shop.</div></div>`
    : '';
  hideChildren(viewSvc(), [wizard]);
  base.style.display = 'none';
  wizard.innerHTML = progress('Verify Ticket', 'Does this match your MHelpDesk ticket?', 2, 6) + `<div class='wl-review'><div><b>MHelpDesk Ticket #</b></div><div style='font-size:28px;font-weight:950'>#${esc(activeSvcPrep.ticket_no)}</div><div class='top10'><b>Ticket Name / Customer / Site</b></div><div style='font-size:21px;font-weight:900'>${esc(activeSvcPrep.site || 'No ticket name entered')}</div><div class='top10'><b>Prepared by:</b> IT Tech ${esc(preparedBy)}</div><div class='top10'><b>Total equipment items IT is giving you:</b> ${forms.length}</div>${equipmentManifestInlineHtml(activeSvcPrep)}${types.length ? `<div class='small top8'><b>Checked equipment types:</b> ${esc(types.map(equipmentDisplayLabel).join(', '))}</div>` : ''}${ticketPartsInlineHtml(activeSvcPrep)}</div>${spareCheckoutHtml}<div class='wl-question'><div class='qtext'>Does this ticket number, site, equipment, truck spares, and work match your MHelpDesk ticket?</div><div class='wl-options'><button class='fail' data-wl-svc-ticket='wrong'>NO — WRONG TICKET</button><button class='pass' data-wl-svc-ticket='match'>YES — IT MATCHES</button></div></div>`;
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
  if (window.TechCheckRules?.serviceSolarEvidenceRequirements) {
    return window.TechCheckRules.serviceSolarEvidenceRequirements(ctx).every(req =>
      serviceSolarEvidenceCount(evidence,req.category,req.kind) >= Number(req.minimum || 1)
    );
  }
  const requiredStandPhotos=ctx.need_stand ? Math.max(1,Number(ctx.solar_spotter_count || 0)) : 0;
  if (ctx.need_stand && (serviceSolarEvidenceCount(evidence,'solar_stand','photo')<requiredStandPhotos || serviceSolarEvidenceCount(evidence,'solar_stand','signature')<1)) return false;
  if (serviceSolarEvidenceCount(evidence,'batteries','photo')<1 || serviceSolarEvidenceCount(evidence,'batteries','signature')<1) return false;
  if (serviceSolarEvidenceCount(evidence,'mppt','photo')<1) return false;
  if (ctx.has_helios) {
    if (serviceSolarEvidenceCount(evidence,'helios_cerbo_mppt','photo')<1) return false;
    if (serviceSolarEvidenceCount(evidence,'helios_yard','photo')<1 || serviceSolarEvidenceCount(evidence,'helios_yard','signature')<1) return false;
  }
  return true;
}
function serviceSolarDefaultStandTag() {
  const item=(activeSvcPrep?.prep_items || []).find(row => row.equipment_type==='Solar Stand');
  return item?.unit_tag || '';
}
function serviceSolarDefaultBatteryCount(ctx=null) {
  if (ctx && Number(ctx.expected_batteries || 0) > 0) return Number(ctx.expected_batteries || 0);
  return (activeSvcPrep?.prep_items || []).filter(row => ['Solar Stand','Helios'].includes(row.equipment_type)).reduce((sum,row)=>sum+Number(row.battery_count || 0),0);
}
function serviceSolarExpectedPanels(ctx=null) {
  if (ctx && Number(ctx.expected_solar_panels || 0) > 0) return Number(ctx.expected_solar_panels || 0);
  return Math.max(Number(activeSvcAssignment?.solar_panel_qty || 0),Number(activeSvcPrep?.solar_panel_qty || 0));
}
function serviceSolarRequiredStandCount(ctx=null) {
  if (window.TechCheckRules?.serviceSolarRequiredStandCount) return window.TechCheckRules.serviceSolarRequiredStandCount(ctx);
  if (!ctx?.need_stand) return 0;
  return Math.max(1,Number(ctx.solar_spotter_count || 0));
}
function serviceSolarStandTagsValue(check=null) {
  return String(check?.stand_tag || serviceSolarDefaultStandTag() || '').split(/[,\n]+/).map(v=>v.trim()).filter(Boolean).join('\n');
}
function serviceSolarProofPanelHtml(rows, category, title, instruction, requireSignature=false) {
  const photos=(rows || []).filter(row => row.category===category && row.kind==='photo');
  const sig=[...(rows || [])].reverse().find(row => row.category===category && row.kind==='signature');
  return `<div class='wl-proof service wl-solar-proof' data-solar-category='${esc(category)}'><b>${esc(title)}</b><div class='wl-note'>${esc(instruction)}</div>
    ${photos.length ? `<div class='wl-gallery'>${photos.map(p => `<img src='${esc(p.url)}' alt='${esc(title)}'>`).join('')}</div><div class='ok top8'><b>✓ ${photos.length} photo${photos.length===1?'':'s'} saved</b></div>` : `<div class='warn top8'>No photo saved yet.</div>`}
    <input class='wl-solar-file top8' type='file' accept='image/*' capture='environment' multiple><button class='mini full top8' data-wl-solar-upload>Save ${esc(title)} Photo(s)</button>
    ${requireSignature ? (sig ? `<div class='wl-saved top8'><b>✓ Signature saved</b><div class='small'>${signatureStamp(sig.created_by_name || 'Service Tech',sig.created_at)}</div>${sig.url ? `<img src='${esc(sig.url)}' alt='Saved signature'>` : ''}</div><button class='mini full top8' data-wl-solar-replace-sign>Replace Signature</button>` : `<div class='wl-sign top8'><b>Sign this verification with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-solar-clear>Clear</button><button class='wl-next' data-wl-solar-save-sign>Save Signature</button></div></div>`) : ''}</div>`;
}
function serviceSolarHeliosCount() {
  return (activeSvcPrep?.prep_items || []).filter(row => row.equipment_type==='Helios' && ['DELIVERY','SWAP','BACKUP'].includes(row.purpose)).length;
}
function serviceSolarBatteryPlan(ctx,check=null) {
  if (window.TechCheckRules?.serviceSolarBatteryPlan) return window.TechCheckRules.serviceSolarBatteryPlan(ctx,check,serviceSolarHeliosCount());
  const spotters=Number(ctx?.solar_spotter_count || 0);
  const rangers=Number(ctx?.ranger_count || 0);
  const helios=serviceSolarHeliosCount();
  const saved=String(check?.battery_configuration || '');
  if (spotters>0) {
    const config=['agm_4x_12v_110ah','single_12v_350ah'].includes(saved) ? saved : '';
    const count=config==='agm_4x_12v_110ah' ? spotters*4 : config==='single_12v_350ah' ? spotters : 0;
    const description=config==='agm_4x_12v_110ah'
      ? `${spotters} Solar Stand${spotters===1?'':'s'} · 4 × AGM 12V 110Ah per stand`
      : config==='single_12v_350ah'
        ? `${spotters} Solar Stand${spotters===1?'':'s'} · 1 × 12V 350Ah per stand`
        : 'Choose the battery setup installed on the Solar Stand';
    return {config,count,description,selectable:true,spotters,rangers,helios};
  }
  if (rangers>0 && helios===0) return {config:'litime_1x_12v_110ah',count:rangers,description:`${rangers} × LiTime 12V 110Ah`,selectable:false,spotters,rangers,helios};
  if (helios>0 && rangers===0) return {config:'helios_battery_box',count:helios,description:`${helios} Helios battery box${helios===1?'':'es'}`,selectable:false,spotters,rangers,helios};
  if (rangers>0 || helios>0) return {config:'mixed',count:rangers+helios,description:'Mixed Ranger LiTime 12V 110Ah + Helios battery-box package',selectable:false,spotters,rangers,helios};
  return {config:'mixed',count:0,description:'Battery system used for charging verification',selectable:false,spotters,rangers,helios};
}
function serviceSolarChecklistHtml(ctx, check, evidence) {
  const expectedPanels=Number(ctx?.expected_solar_panels || 0), spotters=Number(ctx?.solar_spotter_count || 0), rangers=Number(ctx?.ranger_count || 0);
  const batteryPlan=serviceSolarBatteryPlan(ctx,check), standTag=check?.stand_tag || serviceSolarDefaultStandTag();
  const panelDefault=check?.solar_panel_count ?? (expectedPanels || 0), complete=serviceSolarReady(ctx,check,evidence), autoBits=[];
  if (spotters) autoBits.push(`<span><b>${spotters}</b> Solar Spotter${spotters===1?'':'s'} → <b>${spotters}</b> Solar Stand${spotters===1?'':'s'} + choose installed battery setup</span>`);
  if (rangers) autoBits.push(`<span><b>${rangers}</b> Ranger${rangers===1?'':'s'} → <b>${rangers}</b> loose Solar Panel${rangers===1?'':'s'} + <b>${rangers}</b> LiTime 12V 110Ah</span>`);
  if (batteryPlan.helios) autoBits.push(`<span><b>${batteryPlan.helios}</b> Helios → internal battery box + yard-tower solar test</span>`);
  const batteryChoice=spotters?`<div class='wl-auto-required top8'><b>Solar Spotter Battery Setup</b></div><label class='check top8'><input type='radio' name='wlSvcBatteryConfig' value='agm_4x_12v_110ah' ${batteryPlan.config==='agm_4x_12v_110ah'?'checked':''}><span><b>4 × AGM 12V 110Ah per Solar Stand</b></span></label><label class='check top8'><input type='radio' name='wlSvcBatteryConfig' value='single_12v_350ah' ${batteryPlan.config==='single_12v_350ah'?'checked':''}><span><b>1 × 12V 350Ah per Solar Stand</b></span></label>`:`<div class='wl-auto-required top8'><b>Battery Setup</b><div class='small'>${esc(batteryPlan.description)}</div></div>`;
  const panelBlock=expectedPanels>0?`<div class='grid top10'><div><label>Loose Solar Panels Physically In Hand · required ${expectedPanels}</label><input id='wlSvcSolarPanelCount' type='number' min='0' value='${esc(panelDefault)}'></div><div><label>Battery Requirement</label><input value='${esc(batteryPlan.description)}' readonly></div></div><label class='check top8'><input id='wlSvcSolarPanelsVerified' type='checkbox' ${check?.solar_panels_verified?'checked':''}><span>I physically counted and verified the loose solar panel(s).</span></label>`:`<div class='wl-auto-required top8'><b>No loose Helios panel is checked out.</b><div class='small'>The Helios yard tower already has its solar panel. Use that tower for the PV/charging test.</div></div><input id='wlSvcSolarPanelCount' type='hidden' value='0'>`;
  return `<div class='wl-service-solar'><div class='wl-review'><b>Service Solar / Ranger / Helios Pre-Trip</b><div class='small'>Complete this after receiving the IT-prepared equipment and before anything leaves the shop.</div>${autoBits.length?`<div class='wl-auto-service-plan top8'><b>AUTOMATIC SERVICE REQUIREMENTS</b><div class='wl-parts-chips'>${autoBits.join('')}</div></div>`:''}</div>
    <div class='wl-question top10'>
      ${ctx.need_stand?`<div class='wl-auto-required'><b>${spotters>1?`${spotters} Solar Stands automatically assigned for checkout`:'Solar Stand automatically assigned for checkout'}</b></div><label>Exact Solar Stand Tag${spotters>1?'s':''}</label>${spotters>1?`<textarea id='wlSvcSolarStandTag' rows='3'>${esc(standTag)}</textarea>`:`<input id='wlSvcSolarStandTag' value='${esc(standTag)}'>`}<label class='check top8'><input id='wlSvcSolarStandVerified' type='checkbox' ${check?.stand_verified?'checked':''}><span>I physically verified the exact stand(s).</span></label>`:''}
      ${batteryChoice}
      <label class='check top8'><input id='wlSvcMpptUpdated' type='checkbox' ${check?.mppt_updated_ok?'checked':''}><span>MPPT firmware / configuration is updated and current.</span></label>
      <label class='check top8'><input id='wlSvcMpptTested' type='checkbox' ${check?.mppt_tested_ok?'checked':''}><span>MPPT was powered, tested, and is working.</span></label>
      ${ctx.has_helios?`<div class='wl-stop top10'><b>HELIOS YARD SOLAR TEST — BEFORE LEAVING</b><div>Take the IT-checked-out Helios to a Helios tower in the yard. The tower already has its solar panel.</div></div>
        <label class='check top8'><input id='wlSvcCerboUpdated' type='checkbox' ${check?.cerbo_updated_ok?'checked':''}><span>Helios Cerbo / Victron configuration and updates are current.</span></label>
        <label class='check top8'><input id='wlSvcCerboOnline' type='checkbox' ${check?.cerbo_online_ok?'checked':''}><span>Helios Cerbo is online and communicating.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardPvConnected' type='checkbox' ${check?.helios_yard_pv_connected_ok?'checked':''}><span>I connected the Helios PV cable to the yard tower.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardSwitchPv' type='checkbox' ${check?.helios_yard_switch_pv_ok?'checked':''}><span>I flipped the internal Helios switch to PV.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardVictron' type='checkbox' ${check?.helios_yard_victron_bluetooth_ok?'checked':''}><span>I connected to the unit in the Victron Bluetooth app.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardStatus' type='checkbox' ${check?.helios_yard_updates_status_ok?'checked':''}><span>I verified Victron status / updates and the system is healthy.</span></label>
        <label class='check top8'><input id='wlSvcHeliosBatteryCharging' type='checkbox' ${check?.helios_battery_box_charging_ok?'checked':''}><span>The internal Helios battery box is present and charged.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardCharging' type='checkbox' ${check?.helios_yard_solar_charging_ok?'checked':''}><span>I verified solar charging from the tower panel.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardPtzWrapped' type='checkbox' ${check?.helios_yard_ptz_wrapped_ok?'checked':''}><span>I removed the PTZ from the door/front plate and bubble wrapped it for transport.</span></label>`:''}
      ${panelBlock}
      <label class='check top8'><input id='wlSvcBatteriesCharged' type='checkbox' ${check?.batteries_charged_ok?'checked':''}><span>I verified the required battery / battery-box setup is present and charged.</span></label>
      <label class='check top8'><input id='wlSvcSolarCharging' type='checkbox' ${check?.solar_charging_ok?'checked':''}><span>I verified the battery system is actively charging through MPPT / PV.</span></label>
      <button class='wl-big wl-blue top10' data-wl-save-service-solar>Save Pre-Trip Checklist</button>
      ${check?.completed_at?`<div class='ok top8'><b>✓ Pre-trip checklist verified</b><div class='small'>${signatureStamp(check.service_tech_name||'Service Tech',check.completed_at)}</div></div>`:`<div class='warn top8'>Complete every required verification above, then save the checklist.</div>`}
    </div>
    ${ctx.need_stand?serviceSolarProofPanelHtml(evidence,'solar_stand','Solar Stand Tag',spotters>1?`Take at least ${spotters} clear tag photos — one per stand.`:'Take a clear picture of the exact Solar Stand tag / ID.',true):''}
    ${serviceSolarProofPanelHtml(evidence,'batteries','Checkout Batteries','Photograph the verified battery / battery-box setup.',true)}
    ${serviceSolarProofPanelHtml(evidence,'mppt','MPPT / Charging Readings','Upload the MPPT / charging readings while the system is actively charging.',false)}
    ${ctx.has_helios?serviceSolarProofPanelHtml(evidence,'helios_cerbo_mppt','Helios Cerbo + MPPT','Photograph the Helios Cerbo and MPPT current, online, and tested.',false):''}
    ${ctx.has_helios?serviceSolarProofPanelHtml(evidence,'helios_yard','Helios Yard Solar Test','Photograph the Helios connected to the yard tower for PV/Victron charging verification. Sign after the yard test and PTZ transport prep are complete.',true):''}
    <div class='${complete?'ok':'warn'} top10'><b>${complete?'✓ Pre-trip complete — equipment may leave the shop after handoff acceptance':'Pre-trip still needs verification'}</b></div></div>`;
}
async function saveServiceSolarChecklist() {
  if (!activeSvcPrep?.id) return;
  const ctx=await serviceSolarContextData(activeSvcPrep.id); if (!ctx.need_solar) return;
  const standTag=document.getElementById('wlSvcSolarStandTag')?.value.trim()||'';
  const panelCount=Math.max(0,Math.floor(Number(document.getElementById('wlSvcSolarPanelCount')?.value||0)));
  const expectedPanels=Number(ctx.expected_solar_panels||0), requiredStands=ctx.need_stand?Math.max(1,Number(ctx.solar_spotter_count||0)):0;
  const standTags=standTag.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
  if(ctx.need_stand&&standTags.length!==requiredStands)return alert('Enter exactly '+requiredStands+' Solar Stand tag'+(requiredStands===1?'':'s')+'.');
  if(ctx.need_stand&&!document.getElementById('wlSvcSolarStandVerified')?.checked)return alert('Verify the exact Solar Stand.');
  const selectedBatteryConfig=document.querySelector("input[name='wlSvcBatteryConfig']:checked")?.value||'';
  const batteryPlan=serviceSolarBatteryPlan(ctx,{battery_configuration:selectedBatteryConfig||undefined});
  if(Number(ctx.solar_spotter_count||0)>0&&!['agm_4x_12v_110ah','single_12v_350ah'].includes(selectedBatteryConfig))return alert('Choose the Solar Stand battery setup.');
  if(!document.getElementById('wlSvcMpptUpdated')?.checked)return alert('Verify the MPPT update / configuration.');
  if(!document.getElementById('wlSvcMpptTested')?.checked)return alert('Verify the MPPT test.');
  const requiredHelios=[
    ['wlSvcCerboUpdated','Verify the Helios Cerbo update / configuration.'],['wlSvcCerboOnline','Verify the Helios Cerbo is online.'],
    ['wlSvcHeliosYardPvConnected','Connect the Helios PV cable to the yard tower.'],['wlSvcHeliosYardSwitchPv','Flip the internal switch to PV.'],
    ['wlSvcHeliosYardVictron','Verify the Helios in the Victron Bluetooth app.'],['wlSvcHeliosYardStatus','Verify Victron status / updates.'],
    ['wlSvcHeliosBatteryCharging','Verify the internal Helios battery box is present and charged.'],['wlSvcHeliosYardCharging','Verify solar charging from the yard tower.'],
    ['wlSvcHeliosYardPtzWrapped','Remove the PTZ and bubble wrap it for transport.']
  ];
  if(ctx.has_helios)for(const [id,msg] of requiredHelios)if(!document.getElementById(id)?.checked)return alert(msg);
  if(expectedPanels>0&&panelCount!==expectedPanels)return alert('This job requires '+expectedPanels+' loose solar panel'+(expectedPanels===1?'':'s')+'.');
  if(expectedPanels>0&&!document.getElementById('wlSvcSolarPanelsVerified')?.checked)return alert('Verify the loose solar panel count.');
  if(!document.getElementById('wlSvcBatteriesCharged')?.checked)return alert('Verify the battery / battery-box setup.');
  if(!document.getElementById('wlSvcSolarCharging')?.checked)return alert('Verify active charging.');
  document.body.classList.add('busy');
  const {error}=await liveDb.rpc('save_my_service_solar_check_v4',{
    p_prep_id:activeSvcPrep.id,p_stand_tag:standTag,p_battery_configuration:batteryPlan.config,
    p_mppt_updated_ok:Boolean(document.getElementById('wlSvcMpptUpdated')?.checked),p_mppt_tested_ok:Boolean(document.getElementById('wlSvcMpptTested')?.checked),
    p_solar_panel_count:panelCount,p_solar_panels_verified:expectedPanels===0?true:Boolean(document.getElementById('wlSvcSolarPanelsVerified')?.checked),
    p_batteries_charged_ok:Boolean(document.getElementById('wlSvcBatteriesCharged')?.checked),p_solar_charging_ok:Boolean(document.getElementById('wlSvcSolarCharging')?.checked),
    p_cerbo_updated_ok:Boolean(document.getElementById('wlSvcCerboUpdated')?.checked),p_cerbo_online_ok:Boolean(document.getElementById('wlSvcCerboOnline')?.checked),
    p_helios_battery_box_charging_ok:Boolean(document.getElementById('wlSvcHeliosBatteryCharging')?.checked),
    p_helios_yard_pv_connected_ok:Boolean(document.getElementById('wlSvcHeliosYardPvConnected')?.checked),p_helios_yard_switch_pv_ok:Boolean(document.getElementById('wlSvcHeliosYardSwitchPv')?.checked),
    p_helios_yard_victron_bluetooth_ok:Boolean(document.getElementById('wlSvcHeliosYardVictron')?.checked),p_helios_yard_updates_status_ok:Boolean(document.getElementById('wlSvcHeliosYardStatus')?.checked),
    p_helios_yard_solar_charging_ok:Boolean(document.getElementById('wlSvcHeliosYardCharging')?.checked),p_helios_yard_ptz_wrapped_ok:Boolean(document.getElementById('wlSvcHeliosYardPtzWrapped')?.checked)
  });
  document.body.classList.remove('busy'); if(error)return alert(error.message); return renderSvcPrep();
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
  if (q.kind === 'number') return `<div class='wl-question'><div class='qnum'>STEP ${index + 1} OF ${total}</div><div class='qtext'>${esc(q.label)}</div><input id='wlSvcCount' type='number' inputmode='numeric' min='${esc(q.input.min || '0')}' value='${esc(q.input.value || '')}' placeholder='ENTER COUNT'></div>`;
  const answered = q.input.dataset.wlAnswered === '1';
  const yes = answered && q.input.checked;
  const no = answered && !q.input.checked;
  return `<div class='wl-question wl-service-auto-bool'><div class='qnum'>STEP ${index + 1} OF ${total}</div><div class='qtext'>${esc(q.label)}</div><div class='wl-options'><button class='pass ${yes ? 'on' : ''}' data-wl-svc-answer='yes'>YES</button><button class='fail ${no ? 'on' : ''}' data-wl-svc-answer='no'>NO</button></div>${no ? `<div class='wl-stop'><b>STOP — FIX THIS FIRST.</b><div>When the problem is corrected, tap YES. You cannot continue with this job while this answer is NO.</div></div>` : ''}</div>`;
}
function svcWizardCard() {
  let wizard = document.getElementById('wlSvcWizardOnly');
  if (!wizard) { wizard = document.createElement('div'); wizard.id = 'wlSvcWizardOnly'; wizard.className = 'card'; viewSvc().append(wizard); }
  return wizard;
}
function advanceSvcVerification() {
  const card = findSvcCard(activeSvcPrep?.ticket_no);
  if (!card) return;
  const forms = svcForms(card);
  if (svcUnitIndex >= forms.length) return;
  const questions = svcQuestions(forms[svcUnitIndex]);
  const q = questions[svcQuestionIndex];
  if (q?.kind === 'bool') {
    if (q.input.dataset.wlAnswered !== '1') return alert('Choose YES or NO first.');
    if (!q.input.checked) return alert('This step is blocked. Fix the issue, then tap YES.');
  }
  if (q?.kind === 'number') {
    const value = document.getElementById('wlSvcCount')?.value ?? '';
    if (value === '') return alert('Enter the physical count first.');
    q.input.value = value;
  }
  if (svcQuestionIndex < questions.length - 1) svcQuestionIndex++;
  else { svcUnitIndex++; svcQuestionIndex = 0; }
  return renderSvcPrep();
}

function serviceAIEquipmentReview(ctx,check,evidence){
  const flags=[], spotters=Number(ctx?.solar_spotter_count||0), rangers=Number(ctx?.ranger_count||0), panels=Number(ctx?.expected_solar_panels||0);
  const batteryPlan=serviceSolarBatteryPlan(ctx,check);
  const standPhotos=serviceSolarEvidenceCount(evidence,'solar_stand','photo'), batteryPhotos=serviceSolarEvidenceCount(evidence,'batteries','photo'), mpptPhotos=serviceSolarEvidenceCount(evidence,'mppt','photo'), heliosPhotos=serviceSolarEvidenceCount(evidence,'helios_cerbo_mppt','photo');
  if(spotters){
    if(!['agm_4x_12v_110ah','single_12v_350ah'].includes(String(check?.battery_configuration||'')))flags.push('Select the Solar Spotter battery setup actually installed on the stand.');
    if(Number(ctx?.need_stand)&&standPhotos<Math.max(1,spotters))flags.push('Solar Stand tag/photo proof is incomplete.');
    if(batteryPhotos<1)flags.push('Battery photo proof is missing.');
    if(mpptPhotos<1)flags.push('MPPT / live solar charging reading photo is missing.');
  }
  if(rangers){if(panels<rangers)flags.push('Ranger plan expects at least '+rangers+' solar panel'+(rangers===1?'':'s')+' — one per Ranger.');if(batteryPhotos<1)flags.push('Ranger battery photo proof is missing.');if(mpptPhotos<1)flags.push('Ranger MPPT / charging proof photo is missing.');}
  if(ctx?.has_helios){if(!check?.helios_battery_box_charging_ok)flags.push('Helios battery-box charging verification is incomplete.');if(heliosPhotos<1)flags.push('Helios Cerbo / MPPT proof photo is missing.');}
  if(ctx?.need_solar&&!check?.completed_at)flags.push('Solar / Helios Service checklist is not completed yet.');
  return `<div class='wl-ai-panel wl-ai-service-equipment'><div class='wl-ai-head'>${onsiteVisionTitle('Service Equipment Check')}<b>${flags.length?'PROOF NEEDED':'ON TRACK'}</b></div>${spotters?`<div class='wl-ai-line'><b>Solar Spotter:</b> ${spotters} unit${spotters===1?'':'s'} → ${spotters} Solar Stand${spotters===1?'':'s'} → ${esc(check?.battery_description || batteryPlan.description)}</div>`:''}${rangers?`<div class='wl-ai-line'><b>Ranger:</b> ${rangers} unit${rangers===1?'':'s'} → ${rangers} solar panel${rangers===1?'':'s'} + LiTime 12V 110Ah battery setup</div>`:''}${flags.length?`<div class='wl-ai-warn'>${flags.map(v=>'⚠ '+esc(v)).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ Required Service equipment evidence is present.</div>`}<div class='small top8'>AI checks stored evidence only. Service Tech must physically verify the equipment and readings.</div></div>`;
}
function finalHandoffAIReview({proofReady,allChecksOk,partsReady,solarReady,servicePhotos,requiredPhotos,hasParts,solarRequired}){
  const holds=[];
  if(!allChecksOk) holds.push('One or more Service equipment checks are NO or incomplete.');
  if(!proofReady) holds.push('Service evidence is incomplete: '+servicePhotos+' of '+requiredPhotos+' receipt photos plus final signature are required.');
  if(hasParts&&!partsReady) holds.push('Listed parts have not been physically verified.');
  if(solarRequired&&!solarReady) holds.push('Solar / Helios pre-trip requirements or evidence are incomplete.');
  const ready=holds.length===0;
  return `<div class='wl-ai-panel wl-ai-final ${ready?'wl-ai-ready':'wl-ai-hold'}'><div class='wl-ai-head'>${onsiteVisionTitle('Final Handoff Gate')}<b>${ready?'AI READY':'HOLD — '+holds.length+' ISSUE'+(holds.length===1?'':'S')}</b></div>${ready?`<div class='wl-ai-good'><b>✓ Cross-check complete.</b><br>IT/Service handoff evidence, Service checks, parts, signatures, and applicable solar requirements are consistent with the stored record.</div>`:`<div class='wl-ai-warn'>${holds.map(v=>'⛔ '+esc(v)).join('<br>')}</div>`}<div class='small top8'>AI READY means the stored Tech Check requirements are complete. The Service Tech still makes the physical verification and final acceptance.</div></div>`;
}
function allSwapItems(prep=activeSvcPrep){
  return [...(prep?.prep_items||[])].filter(row=>row.purpose==='SWAP').sort((a,b)=>a.item_order-b.item_order);
}
function heliosHandoffItems(prep=activeSvcPrep){
  return [...(prep?.prep_items||[])].filter(row=>row.equipment_type==='Helios'&&['DELIVERY','SWAP'].includes(row.purpose)).sort((a,b)=>a.item_order-b.item_order);
}
function heliosFieldItems(prep=activeSvcPrep){
  return heliosHandoffItems(prep).filter(row=>row.purpose==='DELIVERY'||(row.purpose==='SWAP'&&row.swap_outcome==='installed'));
}
function serviceHandoffVerifications(){
  return [...(activeSvcPrep?.prep_items||[])].sort((a,b)=>a.item_order-b.item_order).map(item=>{
    const required=Number(item.required_battery_count||0);
    return {item_id:item.id,unit_tag:String(item.unit_tag||''),unit_confirmed:Boolean(document.getElementById(`exact_${item.id}`)?.checked),
      battery_count:required>0?Number(document.getElementById(`sbatt_${item.id}`)?.value??item.battery_count??0):0,
      battery_verified:required>0?Boolean(document.getElementById(`sbattok_${item.id}`)?.checked):false};
  });
}
async function loadHeliosSwapReturns(ticket){
  const {data,error}=await liveDb.from('unit_returns').select('*').eq('ticket_no',String(ticket||'')).eq('equipment_type','Helios').order('returned_at',{ascending:true});
  if(error){console.warn('Could not load Helios swap returns',error);return [];} return data||[];
}
async function acceptHeliosHandoff(){
  if(!activeSvcPrep?.id)return;
  const {error}=await liveDb.rpc('accept_helios_handoff_v1',{p_prep_id:activeSvcPrep.id,p_verifications:serviceHandoffVerifications()});
  if(error)return alert(error.message);
  activeSvcPrep=await getPrep(activeSvcPrep.id);
  alert('Helios handoff accepted. The unit is checked out to Service, but it is NOT deployed yet. Complete the field installation next.');
  return renderSvcPrep();
}
async function startHeliosOldUnitReturn(){
  if(!activeSvcPrep?.ticket_no)return;
  serviceReturn={step:1,ticket:String(activeSvcPrep.ticket_no),unit:'',type:'Helios',notes:'',photo:null,conditionPhotos:[],damagePhotos:[],knownUnits:[]};
  serviceReturnRecovered=false; await saveServiceReturnDraft(); return renderServiceReturn();
}
function heliosFieldRuleList(){
  return window.TechCheckRules?.heliosFieldChecklist || [
    {key:'helios_field_box_mounted_ok',rpc_param:'p_box_mounted_ok',label:'Helios box installed and secured on the tower.'},
    {key:'helios_field_pv_connected_ok',rpc_param:'p_pv_connected_ok',label:'PV cables connected.'},
    {key:'helios_field_ptz_secured_ok',rpc_param:'p_ptz_secured_ok',label:'PTZ reinstalled and secured on the removable front plate.'},
    {key:'helios_field_switch_pv_ok',rpc_param:'p_switch_pv_ok',label:'Internal switch flipped to PV.'},
    {key:'helios_field_unit_battery_on_ok',rpc_param:'p_unit_battery_on_ok',label:'Helios unit and battery turned on.'},
    {key:'helios_field_it_online_verified_ok',rpc_param:'p_it_online_verified_ok',label:'Called IT and IT verified the Helios is online.'},
    {key:'helios_field_cameras_aimed_ok',rpc_param:'p_cameras_aimed_ok',label:'Camera aim / focus completed with IT.'},
    {key:'helios_field_recording_ok',rpc_param:'p_recording_ok',label:'Recording verified after final aim.'},
    {key:'helios_field_tower_20ft_ok',rpc_param:'p_tower_20ft_ok',label:'Tower cranked to approximately 20 feet.'},
    {key:'helios_field_mast_lock_bolt_ok',rpc_param:'p_mast_lock_bolt_ok',label:'Separate tower mast locking bolt inserted and secured.'},
    {key:'helios_field_panel_45deg_ok',rpc_param:'p_panel_45deg_ok',label:'Solar panel set to approximately 45°.'},
    {key:'helios_field_panel_bolt_ok',rpc_param:'p_panel_bolt_ok',label:'Separate panel angle/locking bolt installed and secured.'},
    {key:'helios_field_4_sandbags_ok',rpc_param:'p_4_sandbags_ok',label:'4 bags of sand placed on the tower base.'}
  ];
}
function serviceHeliosFieldInstallHtml(prep,check,evidence,returns){
  const units=heliosFieldItems(prep), swaps=units.filter(x=>x.purpose==='SWAP'), installPhotos=serviceSolarEvidenceCount(evidence,'helios_install','photo');
  const installSig=[...(evidence||[])].reverse().find(row=>row.category==='helios_install'&&row.kind==='signature'), submitted=Boolean(check?.helios_field_completed_at), ownerDone=Boolean(check?.helios_owner_verified_at);
  const replacementKeys=new Set(allSwapItems(prep).map(i=>norm(i.unit_tag)).filter(Boolean));
  const returnRows=(returns||[]).filter(r=>r.equipment_type==='Helios'&&!replacementKeys.has(norm(r.unit_tag)));
  const allChecks=heliosFieldRuleList();
  const checklist=allChecks.map((rule,index)=>`<label class='check top8'><input id='wlHeliosFieldRule${index}' data-wl-helios-field-key='${esc(rule.key)}' type='checkbox' ${check?.[rule.key]?'checked':''} ${submitted?'disabled':''}><span>${esc(rule.label)}</span></label>`).join('');
  const newUnits=units.map(x=>`<div class='ok top8'><b>NEW UNIT OUT · ${esc(x.unit_tag||'Tag missing')}</b><div class='small'>${esc(x.purpose)} Helios${check?.handoff_accepted_at?` · ${signatureStamp(check.handoff_accepted_by_name||'Service Tech',check.handoff_accepted_at)}`:''}</div></div>`).join('');
  const oldBlock=swaps.length?`<div class='wl-stop top10'><b>OLD UNIT RETURNING · ${returnRows.length} of ${swaps.length} recorded</b><div>The old Helios is NOT an unused spare. Photograph the old unit and tag, document why it is being swapped, damage/issues/symptoms/repair needed, then Service Return → IT Intake.</div>${returnRows.map(r=>`<div class='wl-review top8'><b>OLD UNIT ${esc(r.unit_tag)}</b><div class='small'>${esc(r.status||'waiting_it')} · ${r.returned_at?esc(new Date(r.returned_at).toLocaleString()):''}</div><div class='small'>${esc(r.return_notes||'No return notes')}</div>${r.tag_scan_status?`<div class='small'>Tag scan: <b>${esc(String(r.tag_scan_status).toUpperCase())}</b></div>`:''}</div>`).join('')}<button class='wl-big wl-red top10' data-wl-helios-old-return>Document OLD UNIT RETURNING →</button></div>`:'';
  const state=ownerDone?`<div class='ok top10'><b>✓ OWNER FINAL VERIFIED</b><div class='small'>${signatureStamp(check.helios_owner_verified_by_name||'Owner',check.helios_owner_verified_at)}</div></div>`:submitted?`<div class='warn top10'><b>FIELD INSTALL SUBMITTED — WAITING FOR OWNER FINAL VERIFICATION</b><div class='small'>${signatureStamp(check.helios_field_completed_by_name||'Service Tech',check.helios_field_completed_at)}</div></div>`:`<button class='wl-big wl-green top10' data-wl-submit-helios-field>Submit Helios Field Install to Owner →</button>`;
  return `${progress('Helios Field Install','Install, verify, photograph, sign, then submit to Owner',1,1)}<div class='wl-review'><b>MHelpDesk #${esc(prep.ticket_no)}</b><div class='small'>The handoff is accepted. This job remains open until field installation and Owner final verification are complete.</div></div>${newUnits}${oldBlock}<div class='wl-question top10'><div class='qtext'>FIELD INSTALL CHECKLIST</div>${checklist}</div>${serviceSolarProofPanelHtml(evidence,'helios_install','Final Helios Installation','Take final-product photos showing the Helios, raised tower, mast lock bolt, solar-panel position/bolt, and sandbags. Upload at least one final photo per Helios.',true)}<div class='${installPhotos>=units.length&&installSig?'ok':'warn'} top10'><b>${installPhotos} of ${units.length} minimum final photos saved${installSig?' · signature saved':' · signature still required'}</b></div>${state}<div class='wl-nav'><button class='wl-prev' data-wl-home='svc'>← Service Home</button><span></span></div>`;
}
async function submitHeliosFieldInstall(){
  if(!activeSvcPrep?.id)return;
  const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id), units=heliosFieldItems(activeSvcPrep), swaps=units.filter(x=>x.purpose==='SWAP');
  const swapState=await swapWorkflowState(activeSvcPrep);
  if(swapState.undecided.length)return alert('Answer YES or NO for every Helios SWAP replacement first.');
  if(swapState.missingOld.some(x=>x.type==='Helios'))return alert('Document every OLD Helios unit returning through Service Return → IT Intake first.');
  if(serviceSolarEvidenceCount(evidence,'helios_install','photo')<units.length)return alert('Upload at least one final installation photo for each Helios.');
  if(serviceSolarEvidenceCount(evidence,'helios_install','signature')<1)return alert('Save the timestamped Service installation signature.');
  const fieldRules=heliosFieldRuleList();
  if(fieldRules.some(rule=>!document.querySelector(`[data-wl-helios-field-key="${rule.key}"]`)?.checked))return alert('Complete every Helios field installation check.');
  const fieldPayload={p_prep_id:activeSvcPrep.id};
  fieldRules.forEach(rule=>{fieldPayload[rule.rpc_param]=true;});
  const {error}=await liveDb.rpc('save_my_helios_field_install_v1',fieldPayload);
  if(error)return alert(error.message);
  activeSvcPrep=await getPrep(activeSvcPrep.id); alert('Helios field installation submitted to the Owner for final verification.'); return renderSvcPrep();
}
function rangerFieldItems(prep=activeSvcPrep){
  return [...(prep?.prep_items||[])].filter(i=>i.equipment_type==='Ranger'&&(i.purpose==='DELIVERY'||(i.purpose==='SWAP'&&i.swap_outcome==='installed')));
}
function rangerFieldReady(prep=activeSvcPrep){
  const rows=rangerFieldItems(prep);
  return !rows.length||rows.every(i=>i.ranger_field_victron_updated_ok===true);
}
async function swapWorkflowState(prep=activeSvcPrep){
  const swaps=allSwapItems(prep);
  const returns=(await returnRows()).filter(r=>norm(r.ticket_no)===norm(prep?.ticket_no));
  const replacementKeys=new Set(swaps.map(i=>norm(i.unit_tag)).filter(Boolean));
  const undecided=swaps.filter(i=>!i.swap_outcome);
  const installed=swaps.filter(i=>i.swap_outcome==='installed');
  const returnedUnused=swaps.filter(i=>i.swap_outcome==='returned_unused');
  const unusedMissing=returnedUnused.filter(item=>!returns.some(r=>
    String(r.prep_item_id||'')===String(item.id) || norm(r.unit_tag)===norm(item.unit_tag)
  ));
  const oldReturns=returns.filter(r=>!replacementKeys.has(norm(r.unit_tag)));
  const byType={};
  installed.forEach(item=>{
    const type=item.equipment_type||'Unit';
    if(!byType[type])byType[type]={required:0,returned:0,missing:0};
    byType[type].required++;
  });
  Object.keys(byType).forEach(type=>{
    byType[type].returned=oldReturns.filter(r=>r.equipment_type===type).length;
    byType[type].missing=Math.max(0,byType[type].required-byType[type].returned);
  });
  const missingOld=Object.entries(byType).flatMap(([type,row])=>Array(row.missing).fill(null).map(()=>({type})));
  const pendingSiteRegistration=installed.filter(i=>i.swap_site_registration_status==='pending_it');
  const completedSiteRegistration=installed.filter(i=>i.swap_site_registration_status==='completed');
  return{
    swaps,returns,replacementKeys,undecided,installed,returnedUnused,unusedMissing,
    oldReturns,byType,missingOld,pendingSiteRegistration,completedSiteRegistration,
    ready:undecided.length===0&&unusedMissing.length===0&&missingOld.length===0
  };
}
function swapResultHtml(prep,state,{heliosOnly=false}={}){
  const scope=heliosOnly?state.swaps.filter(i=>i.equipment_type==='Helios'):state.swaps.filter(i=>i.equipment_type!=='Helios');
  if(!scope.length)return'';
  const undecided=scope.find(i=>!i.swap_outcome);
  const site=prep?.site||'the customer site';
  const resolved=scope.filter(i=>i.swap_outcome).map(item=>{
    if(item.swap_outcome==='returned_unused'){
      return `<div class='warn top8'><b>↩ DID NOT USE · ${esc(item.equipment_type)} ${esc(item.unit_tag||'')}</b><div class='small'>This exact replacement unit is routed back through IT Intake before Shop Inventory.</div></div>`;
    }
    const registration=item.swap_site_registration_status==='completed'
      ? '✓ IT site registration complete'
      : 'IT site registration is ready for IT';
    return `<div class='ok top8'><b>✓ SWAP HAPPENED · ${esc(item.equipment_type)} ${esc(item.unit_tag||'')}</b><div class='small'>Replacement stays at ${esc(item.swap_installed_site||site)} · ${esc(registration)}</div></div>`;
  }).join('');
  if(undecided){
    return `${progress('Swap Result','One simple field decision',1,1)}<div class='wl-review'><b>MHelpDesk #${esc(prep.ticket_no)}</b><div class='small'>Replacement unit: ${esc(undecided.equipment_type)} ${esc(undecided.unit_tag||'Tag missing')} · Site: ${esc(site)}</div></div>${resolved}<div class='wl-question top10'><div class='qtext'>Did you actually install/use replacement ${esc(undecided.equipment_type)} ${esc(undecided.unit_tag||'')} at ${esc(site)}?</div><div class='wl-options'><button class='pass' data-wl-swap-used='${esc(undecided.id)}'>YES — SWAP HAPPENED</button><button class='fail' data-wl-swap-unused='${esc(undecided.id)}'>NO — DID NOT USE IT</button></div><div class='wl-note'>YES: replacement stays at the site, IT gets a site-registration task, and the OLD unit must return through IT Intake.<br>NO: this unused replacement automatically goes back through IT Intake.</div></div>`;
  }
  const scopeInstalled=scope.filter(i=>i.swap_outcome==='installed');
  const neededByType={};
  scopeInstalled.forEach(i=>neededByType[i.equipment_type]=(neededByType[i.equipment_type]||0)+1);
  const scopeMissing=Object.entries(neededByType).flatMap(([type,needed])=>{
    const returned=state.oldReturns.filter(r=>r.equipment_type===type).length;
    return Array(Math.max(0,Number(needed)-returned)).fill(type);
  });
  const oldReturn=scopeMissing[0]||'';
  const unusedMissing=scope.filter(i=>i.swap_outcome==='returned_unused'&&state.unusedMissing.some(m=>m.id===i.id));
  const complete=!oldReturn&&!unusedMissing.length;
  return `${progress('Swap Result',complete?'Swap result recorded':'Finish the return path',1,1)}${resolved}${oldReturn?`<div class='wl-stop top10'><b>OLD UNIT MUST RETURN</b><div>The replacement was installed. Bring the OLD ${esc(oldReturn)} back through IT Intake.</div><button class='wl-big wl-red top10' data-wl-swap-old-return='${esc(oldReturn)}'>Return OLD ${esc(oldReturn)} to IT Intake →</button></div>`:''}${unusedMissing.length?`<div class='wl-stop top10'><b>UNUSED REPLACEMENT INTAKE REQUIRED</b><div>The unused replacement has not reached IT Intake yet.</div></div>`:''}${complete?`<div class='ok top10'><b>✓ SWAP RESULT COMPLETE</b><div>Every replacement has a YES/NO outcome and every required unit is in the correct path.</div></div>`:''}`;
}
async function resolveSwapUnitOutcome(itemId,used){
  const item=allSwapItems(activeSvcPrep).find(i=>String(i.id)===String(itemId));
  if(!item)return alert('This SWAP replacement unit is no longer available.');
  const {data,error}=await liveDb.rpc('service_resolve_swap_unit_v1',{p_item_id:itemId,p_used:Boolean(used)});
  if(error)return alert(error.message);
  activeSvcPrep=await getPrep(activeSvcPrep.id);
  if(used){
    alert(`SWAP recorded. ${item.equipment_type} ${item.unit_tag||''} stays at the customer site. The OLD unit must return through IT Intake; IT now has the site-registration task.`);
    return renderSvcPrep();
  }
  alert(`Not used. Return ${item.equipment_type} ${item.unit_tag||''} now through Service Return → IT Intake.`);
  await clearDeviceDraft('service-return');
  serviceReturn={
    step:1,
    ticket:String(activeSvcPrep?.ticket_no||''),
    unit:String(item.unit_tag||''),
    type:String(item.equipment_type||''),
    notes:'Prepared replacement not used on SWAP — returning to IT Intake.',
    noTag:false,photo:null,tagScan:null,conditionPhotos:[],damagePhotos:[],knownUnits:[]
  };
  serviceReturnRecovered=false;
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
async function startSwapOldUnitReturn(type){
  const saved=await loadDeviceDraft('service-return');
  if(saved?.ticket)return showServiceReturn();
  serviceReturn={
    step:1,
    ticket:String(activeSvcPrep?.ticket_no||''),
    unit:'',
    type:String(type||''),
    notes:'OLD unit removed during SWAP. Returning through IT Intake.',
    photo:null,tagScan:null,conditionPhotos:[],damagePhotos:[],knownUnits:[]
  };
  serviceReturnRecovered=false;
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
function rangerFieldHtml(prep){
  const rows=rangerFieldItems(prep);
  const cards=rows.map((item,index)=>`<label class='check top8'><input type='checkbox' data-wl-ranger-field-item='${esc(item.id)}' ${item.ranger_field_victron_updated_ok?'checked':''}><span><b>${esc(item.unit_tag||('Ranger '+(index+1)))}</b> — at the site, verify this Ranger is up to date in the Victron Bluetooth app.</span></label>`).join('');
  const ready=rangerFieldReady(prep);
  return `<div class='wl-review'><b>Ranger Field Check</b><div class='small'>Complete this in the field before closing the Tech Check.</div>${cards}</div>${ready?`<div class='ok top10'><b>✓ Ranger Victron field verification complete.</b></div>`:`<button class='wl-big wl-blue top10' data-wl-save-ranger-field>Save Ranger Field Verification</button>`}`;
}
async function saveRangerFieldVerification(){
  const rows=rangerFieldItems(activeSvcPrep);
  for(const item of rows){
    const checked=Boolean(document.querySelector(`[data-wl-ranger-field-item="${item.id}"]`)?.checked);
    if(!checked)return alert('Verify every Ranger is up to date in the Victron Bluetooth app while in the field.');
    const {error}=await liveDb.rpc('save_my_ranger_field_check_v1',{p_item_id:item.id,p_victron_updated_ok:true});
    if(error)return alert(error.message);
  }
  activeSvcPrep=await getPrep(activeSvcPrep.id);
  return renderSvcPrep();
}
async function startStandardSwapReturn(type){ return startSwapOldUnitReturn(type); }

async function renderSvcPrep() {
  if (!activeSvcPrep) return;
  const base=document.getElementById('matchedPreps')?.closest('.card'),card=findSvcCard(activeSvcPrep.ticket_no);
  if(!base||!card)return alert('Could not open the matched equipment.');
  const forms=svcForms(card),wizard=svcWizardCard(),partsTotal=ticketPartsTotal(activeSvcPrep),hasParts=partsTotal>0;
  const solarCtx=await serviceSolarContextData(activeSvcPrep.id),solarRequired=Boolean(solarCtx?.need_solar);
  const solarCheck=solarRequired?await loadServiceSolarCheck(activeSvcPrep.id):null,solarEvidence=solarRequired?await serviceSolarEvidenceRows(activeSvcPrep.id):[],solarReady=serviceSolarReady(solarCtx,solarCheck,solarEvidence);
  const swapState=await swapWorkflowState(activeSvcPrep);
  const allSwaps=swapState.swaps,nonHeliosSwaps=allSwaps.filter(i=>i.equipment_type!=='Helios'),heliosHandoff=heliosHandoffItems(activeSvcPrep),heliosField=heliosFieldItems(activeSvcPrep),rangerField=rangerFieldItems(activeSvcPrep);
  const partStep=forms.length,solarStep=forms.length+(hasParts?1:0),proofStep=solarStep+(solarRequired?1:0),photoStep=proofStep+1,signStep=proofStep+2,swapStep=signStep+1,rangerStep=swapStep+(nonHeliosSwaps.length?1:0),preparedBy=activeSvcPrep.released_by_name||'IT Technician';
  hideChildren(viewSvc(),[wizard]);base.style.display='none';
  if(heliosHandoff.length&&solarCheck?.handoff_accepted_at){
    const heliosScope=swapState.swaps.filter(i=>i.equipment_type==='Helios');
    const heliosUnresolved=heliosScope.some(i=>!i.swap_outcome)||swapResultHtml(activeSvcPrep,swapState,{heliosOnly:true}).includes('MUST RETURN');
    if(heliosScope.length&&!heliosUnresolved){
      // all Helios swap outcomes/returns are resolved; installed Helios continue to field install
    }else if(heliosScope.length){
      wizard.innerHTML=swapResultHtml(activeSvcPrep,swapState,{heliosOnly:true});
      resetWizardPosition();return;
    }
    if(heliosField.length){const swapReturns=await loadHeliosSwapReturns(activeSvcPrep.ticket_no);wizard.innerHTML=serviceHeliosFieldInstallHtml(activeSvcPrep,solarCheck,solarEvidence,swapReturns);wizard.querySelectorAll('canvas').forEach(wireCanvas);resetWizardPosition();return;}
  }
  if(svcUnitIndex<forms.length){
    const questions=svcQuestions(forms[svcUnitIndex]),q=questions[svcQuestionIndex],afterLast=hasParts?'Verify Parts →':solarRequired?'Solar / Helios Check →':'Compare IT Photos →';
    wizard.innerHTML=progress(`Unit ${svcUnitIndex+1} of ${forms.length}`,q?.label||'Verify this unit',svcQuestionIndex+1,Math.max(1,questions.length))+(q?svcQuestionHtml(q,svcQuestionIndex,questions.length):`<div class='ok'><b>This unit has no additional checks.</b></div>`)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>${svcQuestionIndex===questions.length-1?(svcUnitIndex===forms.length-1?afterLast:'Next Unit →'):'Next →'}</button></div>`;
  }else if(hasParts&&svcUnitIndex===partStep){
    const confirmed=Boolean(activeSvcPrep.service_parts_confirmed);
    wizard.innerHTML=progress('Parts Handoff',`Verify parts from IT Tech ${preparedBy}`,1,1)+`<div class='wl-review'><b>Physically verify every part before accepting it.</b><div class='small'>MHelpDesk #${esc(activeSvcPrep.ticket_no)} · Prepared by IT Tech ${esc(preparedBy)}</div>${ticketPartsInlineHtml(activeSvcPrep)}</div>${confirmed?`<div class='ok'><b>✓ Parts verified.</b></div>`:`<div class='wl-question'><div class='qtext'>Do you physically have the exact quantities listed above?</div><div class='wl-options'><button class='pass' data-wl-confirm-service-parts>YES — I HAVE THEM</button><button class='fail' data-wl-service-parts-mismatch>NO — MISMATCH</button></div></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${confirmed?'':'disabled'}>${solarRequired?'Solar / Helios Check →':'Compare IT Photos →'}</button></div>`;
  }else if(solarRequired&&svcUnitIndex===solarStep){
    wizard.innerHTML=progress('Solar / Helios Pre-Trip','Verify charging, equipment, and Helios yard test before leaving',1,1)+serviceAIEquipmentReview(solarCtx,solarCheck,solarEvidence)+serviceSolarChecklistHtml(solarCtx,solarCheck,solarEvidence)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${solarReady?'':'disabled'}>Compare IT Photos →</button></div>`;wizard.querySelectorAll('canvas').forEach(wireCanvas);
  }else if(svcUnitIndex===proofStep){
    wizard.innerHTML=progress('Compare',`Look at IT Tech ${preparedBy}’s handoff photos`,1,1)+await proofHtml(activeSvcPrep.id,'it',false)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>My Photos →</button></div>`;
  }else if(svcUnitIndex===photoStep){
    const itEv=await evidenceRows(activeSvcPrep.id,'it'),requiredPhotos=itEv.filter(x=>x.kind==='photo').length||forms.length;
    wizard.innerHTML=progress('Service Photos',`Take ${requiredPhotos} matching receipt photo${requiredPhotos===1?'':'s'}`,1,1)+await photoOnlyHtml(activeSvcPrep.id,'service',null,requiredPhotos)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>Signature →</button></div>`;
  }else if(svcUnitIndex===signStep){
    wizard.innerHTML=progress('Service Signature',`Sign that you received and verified the handoff from IT Tech ${preparedBy}`,1,1)+await signatureOnlyHtml(activeSvcPrep.id,'service')+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>${nonHeliosSwaps.length?'Swap Result →':rangerField.length?'Ranger Field Check →':'Review →'}</button></div>`;wizard.querySelectorAll('canvas').forEach(wireCanvas);
  }else if(nonHeliosSwaps.length&&svcUnitIndex===swapStep){
    const html=swapResultHtml(activeSvcPrep,swapState);
    const scopeReady=!nonHeliosSwaps.some(i=>!i.swap_outcome)
      && !nonHeliosSwaps.some(i=>i.swap_outcome==='returned_unused'&&swapState.unusedMissing.some(m=>m.id===i.id))
      && !Object.entries(nonHeliosSwaps.filter(i=>i.swap_outcome==='installed').reduce((m,i)=>(m[i.equipment_type]=(m[i.equipment_type]||0)+1,m),{})).some(([type,needed])=>swapState.oldReturns.filter(r=>r.equipment_type===type).length<Number(needed));
    wizard.innerHTML=html+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${scopeReady?'':'disabled'}>${rangerField.length?'Ranger Field Check →':'Review →'}</button></div>`;
  }else if(rangerField.length&&svcUnitIndex===rangerStep){
    wizard.innerHTML=progress('Ranger Field Check','Verify Victron Bluetooth status at the site',1,1)+rangerFieldHtml(activeSvcPrep)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${rangerFieldReady(activeSvcPrep)?'':'disabled'}>Review →</button></div>`;
  }else{
    if(heliosField.length&&solarCheck?.handoff_accepted_at){const swapReturns=await loadHeliosSwapReturns(activeSvcPrep.ticket_no);wizard.innerHTML=serviceHeliosFieldInstallHtml(activeSvcPrep,solarCheck,solarEvidence,swapReturns);wizard.querySelectorAll('canvas').forEach(wireCanvas);resetWizardPosition();return;}
    const ev=await evidenceRows(activeSvcPrep.id,'service'),itEv=await evidenceRows(activeSvcPrep.id,'it'),requiredPhotos=itEv.filter(x=>x.kind==='photo').length||forms.length,servicePhotos=ev.filter(x=>x.kind==='photo').length;
    const allChecksOk=forms.every(form=>svcQuestions(form).every(q=>q.kind==='number'?q.input.value!=='':q.input.checked)),partsReady=!hasParts||Boolean(activeSvcPrep.service_parts_confirmed),proofReady=servicePhotos===requiredPhotos&&ev.some(x=>x.kind==='signature'),rangerReady=rangerFieldReady(activeSvcPrep);
    const heliosNeedsAcceptance=heliosHandoff.length>0&&!solarCheck?.handoff_accepted_at;
    const nonHeliosInstalled=nonHeliosSwaps.filter(i=>i.swap_outcome==='installed');
    const nonHeliosByType=nonHeliosInstalled.reduce((m,i)=>(m[i.equipment_type]=(m[i.equipment_type]||0)+1,m),{});
    const nonHeliosReady=!nonHeliosSwaps.some(i=>!i.swap_outcome)
      && !nonHeliosSwaps.some(i=>i.swap_outcome==='returned_unused'&&swapState.unusedMissing.some(m=>m.id===i.id))
      && !Object.entries(nonHeliosByType).some(([type,needed])=>swapState.oldReturns.filter(r=>r.equipment_type===type).length<Number(needed));
    const swapReady=heliosNeedsAcceptance ? nonHeliosReady : swapState.ready;
    const ready=proofReady&&allChecksOk&&partsReady&&solarReady&&rangerReady&&swapReady;
    const aiFinal=finalHandoffAIReview({proofReady,allChecksOk,partsReady,solarReady,servicePhotos,requiredPhotos,hasParts,solarRequired});
    const heliosNotice=heliosHandoff.length&&!solarCheck?.handoff_accepted_at?`<div class='warn top10'><b>HELIOS HANDOFF FIRST</b><div>Accept the IT → Service handoff. At the site, Service will answer whether the SWAP replacement was actually installed.</div></div>`:'';
    const rangerNotice=rangerField.length?(rangerReady?`<div class='ok top10'><b>✓ Ranger field Victron verification complete.</b></div>`:`<div class='wl-stop top10'><b>Ranger field verification is incomplete.</b><div>At the site, confirm each installed Ranger is up to date in the Victron Bluetooth app before closing this Tech Check.</div></div>`):'';
    const pendingHeliosFieldDecision=heliosNeedsAcceptance&&allSwaps.some(i=>i.equipment_type==='Helios'&&!i.swap_outcome);
    const swapNotice=allSwaps.length?(pendingHeliosFieldDecision
      ? `<div class='warn top10'><b>HELIOS SWAP RESULT COMES NEXT</b><div>Accept the handoff first. At the site, Service will answer YES — SWAP HAPPENED or NO — DID NOT USE IT.</div></div>`
      : swapReady
        ? `<div class='ok top10'><b>✓ SWAP outcome and required return path recorded.</b><div>${swapState.pendingSiteRegistration.length?'IT site registration is queued and ready for IT.':'No unresolved Service SWAP return remains.'}</div></div>`
        : `<div class='wl-stop top10'><b>SWAP RESULT REQUIRED</b><div>Finish the YES / NO replacement-unit decision and any required IT Intake return before this Tech Check can close.</div></div>`
    ):'';
    wizard.innerHTML=progress('Final Step',heliosHandoff.length&&!solarCheck?.handoff_accepted_at?'Accept the Helios handoff — field result comes next':'Complete field work and close Tech Check',1,1)+aiFinal+`<div class='wl-review'><b>MHelpDesk #${esc(activeSvcPrep.ticket_no)}</b><div class='small'><b>Received from:</b> IT Tech ${esc(preparedBy)}</div><div class='small'>📷 Service receipt photos: ${servicePhotos} of ${requiredPhotos}</div>${partsReady?(hasParts?`<div class='small'>✓ Listed parts verified.</div>`:''):`<div class='wl-stop'><b>Parts are not verified.</b></div>`}${solarRequired?(solarReady?`<div class='small'>✓ Solar / Helios pre-trip complete.</div>`:`<div class='wl-stop'><b>Solar / Helios pre-trip incomplete.</b></div>`):''}${allChecksOk?`<div class='small'>✓ Every Service equipment verification answer is YES.</div>`:`<div class='wl-stop'><b>One or more Service checks are incomplete.</b></div>`}</div>${heliosNotice}${rangerNotice}${swapNotice}<button class='wl-big wl-green' ${heliosHandoff.length&&!solarCheck?.handoff_accepted_at?'data-wl-accept-helios':'data-wl-close-svc'} ${ready?'':'disabled'}>${heliosHandoff.length&&!solarCheck?.handoff_accepted_at?`Accept Helios from IT Tech ${esc(preparedBy)} & Continue →`:`Complete Tech Check →`}</button><div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>`;
  }
  resetWizardPosition();
}
function inspectionQuestion() {
  const total = 8 + 1 + (inspection.takingTrailer === true ? 7 : 0) + 1;
  let card = document.getElementById('wlInspection');
  if (!card) {
    card = document.createElement('div');
    card.id = 'wlInspection';
    card.className = 'card wl-service-simple-card';
    viewSvc().append(card);
  }

  let body = '';
  if (inspection.step < 8) {
    const i = inspection.step;
    const failed=inspection.truck[i]===false;
    body = `${progress(`TRUCK CHECK · ${i + 1} OF 8`, truckLabels[i], i + 1, total)}
      <div class='wl-question'>
        <div class='qtext'>${esc(truckLabels[i])}</div>
        <div class='wl-options'>
          <button class='pass ${inspection.truck[i] === true ? 'on' : ''}' data-wl-answer='pass'>YES</button>
          <button class='fail ${failed ? 'on' : ''}' data-wl-answer='fail'>NO</button>
        </div>
        ${failed?`<div class='wl-stop'><b>STOP — FIX THIS BEFORE CONTINUING.</b><div>Once it is corrected, tap YES.</div><a href='tel:${OPS_TEL}'>CALL OPERATIONS — ${OPS_DISPLAY}</a></div>`:''}
      </div>`;
  } else if (inspection.step === 8) {
    body = `${progress('TRAILER', 'Are you taking a trailer today?', 9, total)}
      <div class='wl-question'>
        <div class='qtext'>ARE YOU TAKING A TRAILER TODAY?</div>
        <div class='wl-options'>
          <button class='pass' data-wl-trailer='no'>NO</button>
          <button class='pass' data-wl-trailer='yes'>YES</button>
        </div>
      </div>`;
  } else if (inspection.takingTrailer === true && inspection.step < 16) {
    const i = inspection.step - 9;
    const failed=inspection.trailer[i]===false;
    body = `${progress(`TRAILER CHECK · ${i + 1} OF 7`, trailerLabels[i], inspection.step + 1, total)}
      <div class='wl-question'>
        <div class='qtext'>${esc(trailerLabels[i])}</div>
        <div class='wl-options'>
          <button class='pass ${inspection.trailer[i] === true ? 'on' : ''}' data-wl-answer='pass'>YES</button>
          <button class='fail ${failed ? 'on' : ''}' data-wl-answer='fail'>NO</button>
        </div>
        ${failed?`<div class='wl-stop'><b>STOP — FIX THIS BEFORE CONTINUING.</b><div>Once it is corrected, tap YES.</div><a href='tel:${OPS_TEL}'>CALL OPERATIONS — ${OPS_DISPLAY}</a></div>`:''}
      </div>`;
  } else {
    const failed = inspection.truck.some(v => v === false) || (inspection.takingTrailer === true && inspection.trailer.some(v => v === false));
    body = failed
      ? `<div class='wl-stop'><b>INSPECTION BLOCKED.</b><div>There is still a NO answer. Go back and correct it before continuing.</div></div>`
      : `${progress('START-DAY CHECK COMPLETE', 'Vehicle is ready', total, total)}
         <div class='wl-service-good'>✓ ALL REQUIRED CHECKS PASSED</div>
         <button class='wl-service-start top10' data-wl-submit-inspection>CONTINUE TO MHELPDESK TICKET</button>`;
  }

  card.innerHTML = `${inspectionRecovered ? `<div class='warn wl-draft-recovered'><b>Recovered your unfinished inspection.</b></div>` : ''}
    <button class='wl-back' data-wl-home='svc'>← BACK</button>
    ${body}
    ${inspection.step>0?`<button class='wl-service-backstep' data-wl-inspect-prev>← PREVIOUS QUESTION</button>`:''}`;

  hideChildren(viewSvc(), [card]);
  resetWizardPosition();
}
async function startInspection() {
  const saved=await loadDeviceDraft('inspection');
  if (saved && Array.isArray(saved.truck) && Array.isArray(saved.trailer)) {
    inspection={ step:Number(saved.step||0), truck:saved.truck.slice(0,8), takingTrailer:saved.takingTrailer ?? null, trailer:saved.trailer.slice(0,7) };
    while(inspection.truck.length<8) inspection.truck.push(null);
    while(inspection.trailer.length<7) inspection.trailer.push(null);
    const truckFail=inspection.truck.findIndex(v=>v===false);
    const trailerFail=inspection.trailer.findIndex(v=>v===false);
    if(truckFail>=0) inspection.step=truckFail;
    else if(inspection.takingTrailer===true&&trailerFail>=0) inspection.step=9+trailerFail;
    inspectionRecovered=true;
  } else {
    inspection={ step:0, truck:Array(8).fill(null), takingTrailer:null, trailer:Array(7).fill(null) };
    inspectionRecovered=false;
  }
  inspectionQuestion();
}
async function submitInspection() {
  if (inspection.truck.some(v => v !== true)) return alert('Every truck question must be YES before continuing.');
  if (inspection.takingTrailer === true && inspection.trailer.some(v => v !== true)) return alert('Every trailer question must be YES before continuing.');
  if (!navigator.onLine) {
    await saveInspectionDraft();
    return alert('No connection. Your inspection is saved on this device, but it has NOT been submitted.');
  }
  const truck = {}; inspection.truck.forEach((v, i) => truck[`truck_${i + 1}`] = v);
  const trailer = {}; inspection.trailer.forEach((v, i) => trailer[`trailer_${i + 1}`] = v);
  const text = document.getElementById('sessionClosed')?.textContent || '';
  const tickets = [...text.matchAll(/MHelpDesk Ticket\s*#([^·\s]+)/gi)].map(m => m[1]);
  document.body.classList.add('busy');
  try {
    const { error } = await liveDb.rpc('submit_morning_check', {
      p_mhelp_reviewed:true,
      p_truck_checks:truck,
      p_taking_trailer:inspection.takingTrailer===true,
      p_trailer_checks:trailer,
      p_closed_ticket_nos:tickets
    });
    if (error) throw error;
    await clearDeviceDraft('inspection');
    inspectionRecovered=false;
    return showServiceJobLookup();
  } catch(error) {
    await saveInspectionDraft();
    alert(error?.message === 'Failed to fetch'
      ? 'Connection lost. Your inspection is saved on this device and was not submitted.'
      : (error?.message || 'Could not submit the inspection.'));
  } finally {
    document.body.classList.remove('busy');
  }
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
document.addEventListener('keydown', e => {
  if(e.target?.id==='ownerAIDispatchPrompt' && e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    ownerAIDispatchBuild();
  }
});
document.addEventListener('change', async e => {
  if (e.target.id === 'wlReturnPhoto') {
    const file=e.target.files?.[0];
    if (!file) return;
    serviceReturn.photo=await optimizeEvidencePhoto(file);
    serviceReturn.tagScan={status:'scanning',detected:'',confidence:null,engine:'tesseract.js-7.0.0'};
    renderServiceReturn();
    if (shouldScanUnitTag(serviceReturn.type) && serviceReturn.unit) {
      serviceReturn.tagScan=await scanUnitTagPhoto(serviceReturn.photo,serviceReturn.unit);
    } else {
      serviceReturn.tagScan=null;
    }
    saveServiceReturnDraft();
    return renderServiceReturn();
  }
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
  const dashboardRetry=e.target.closest('[data-wl-dashboard-retry]');
  if(dashboardRetry){
    if(dashboardRetry.dataset.wlDashboardRetry==='it')return showITHome();
    return showSvcHome();
  }
  if(e.target.closest('[data-owner-ai-new-chat]')) { ownerAIConversationClear(); return; }
  const aiChip=e.target.closest('[data-owner-ai-chip]');
  if(aiChip){
    const input=document.getElementById('ownerAIDispatchPrompt');
    if(input){
      input.value=String(aiChip.dataset.ownerAiChip||'').trim();
      return ownerAIDispatchBuild();
    }
    return;
  }
  if(e.target.closest('[data-owner-unit-lookup]')) return ownerLookupUnitHistory();
  const dayTab=e.target.closest('[data-owner-ai-day]');if(dayTab){const box=dayTab.closest('.wl-owner-ai-daily');box?.querySelectorAll('[data-owner-ai-day]').forEach(b=>b.classList.toggle('selected',b===dayTab));box?.querySelectorAll('[data-owner-ai-day-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.ownerAiDayPanel!==dayTab.dataset.ownerAiDay));return;}
  const aiAck=e.target.closest('[data-owner-ai-ack]'); if(aiAck) return ownerAIAcknowledge(aiAck.dataset.ownerAiAck,aiAck.dataset.ownerAiAckKey,aiAck.dataset.ownerAiAckDetail,aiAck.dataset.ownerAiAckTicket);
  const aiFilter=e.target.closest('[data-owner-ai-filter]'); if(aiFilter) return ownerApplyAIFilter(aiFilter.dataset.ownerAiFilter,aiFilter);
  if (e.target?.closest?.('[data-owner-add-tech]')) { e.preventDefault(); addOwnerTechPill(); return; }
  if (e.target?.closest?.('[data-owner-remove-tech]')) { e.preventDefault(); e.target.closest('.wl-tech-pill')?.remove(); ownerSaveAssignDraftNow(); ownerAIReview(); return; }
  if(e.target.closest('[data-wl-offline-start]')) return showOfflineUnitForm();
  if(e.target.closest('[data-wl-offline-submit]')) return submitOfflineUnitForm();
  const offlineItSave=e.target.closest('[data-wl-offline-it-save]'); if(offlineItSave)return saveOfflineITDecision(offlineItSave.dataset.wlOfflineItSave);
  const offlineSwap=e.target.closest('[data-wl-offline-complete-swap]'); if(offlineSwap)return completeAuthorizedOfflineSwap(offlineSwap.dataset.wlOfflineCompleteSwap,offlineSwap.dataset.wlOfflineBackup);
  const nextItIntake = e.target.closest('[data-wl-next-it-intake]'); if (nextItIntake) return startITIntake(nextItIntake.dataset.wlNextItIntake);
  const nextSvcReceive = e.target.closest('[data-wl-next-svc-receive]'); if (nextSvcReceive) return openServiceTicket(nextSvcReceive.dataset.wlNextSvcReceive);
  if (e.target.closest('[data-wl-next-svc-inspect]')) return startInspection();
  const nextSvcReturn = e.target.closest('[data-wl-next-svc-return]'); if (nextSvcReturn) return showServiceReturnPreset(nextSvcReturn.dataset.ticket,nextSvcReturn.dataset.unit,nextSvcReturn.dataset.type);
  if (e.target.closest('[data-wl-service-return]')) return showServiceReturn();
  if (e.target.closest('[data-wl-return-next]')) return serviceReturnNext();
  if (e.target.closest('[data-wl-return-no-tag-110v]')) { serviceReturn.unit=''; serviceReturn.type='110V Stand'; serviceReturn.noTag=true; serviceReturn.photo=null; serviceReturn.tagScan=null; serviceReturn.step=3; saveServiceReturnDraft(); return renderServiceReturn(); }
  const returnUnit = e.target.closest('[data-wl-return-unit]');
  if (returnUnit) {
    const nextUnit=returnUnit.dataset.wlReturnUnit || '';
    const nextType=returnUnit.dataset.wlReturnType || serviceReturn.type;
    if (norm(nextUnit)!==norm(serviceReturn.unit) || nextType!==serviceReturn.type) { serviceReturn.photo=null; serviceReturn.tagScan=null; }
    serviceReturn.unit=nextUnit;
    serviceReturn.type=nextType;
    serviceReturn.noTag=false;
    if (serviceReturn.step === 1) serviceReturn.step = 2;
    saveServiceReturnDraft();
    return renderServiceReturn();
  }
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
  if (e.target.closest('[data-wl-intake-replacement]')) {
    intakeWizard.notes = document.getElementById('wlIntakeNotes')?.value || intakeWizard.notes || '';
    const row = intakeWizard.row;
    if (!row?.id) return alert('This intake record is no longer available.');
    if (!intakeWizard.notes.trim()) return alert('Describe the damage and what needs replacement before notifying the Owner.');
    const file = document.getElementById('wlIntakePhoto')?.files?.[0];
    if (file) intakeWizard.photo = file;
    let paths = row.intake_photo_paths || [];
    try {
      if (intakeWizard.photo) paths = await uploadReturnPhotos([intakeWizard.photo], row.id, 'it-replacement');
      if (!paths.length) return alert('Take or choose an IT Intake photo showing the damaged equipment first.');
      const { error } = await liveDb.rpc('it_mark_return_needs_replacement_v1', {
        p_return_id: row.id,
        p_damage_notes: intakeWizard.notes.trim(),
        p_intake_photo_paths: paths
      });
      if (error) throw error;
      const tech = await currentTechIdentity();
      await syncITReturnAssignmentAfterIntake(row.ticket_no,tech.id);
      intakeWizard = { row: null, step: 0, answers: Array(intakeLabels.length).fill(null), notes: '', photo: null, meta: {} };
      alert('Owner notified. This equipment is held in Maintenance / Needs Replacement and is NOT available Shop Inventory.');
      return showITIntake();
    } catch (error) {
      return alert(error?.message || 'Could not mark this equipment as needing replacement.');
    }
  }
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
    await syncITReturnAssignmentAfterIntake(row.ticket_no,tech.id);
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
    if (matches && item.ai_tag_scan_status==='mismatch') return alert(`AI read a different tag than ${item.unit_tag}. Retake a clear tag photo before approving this unit.`);
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
      if (value < 1) return alert('Enter how many cameras are going on this Recon II.');
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
        if (!value && !step.optional) return alert('Enter the exact unit tag first.');
        item.unit_tag = value; needsSave = true;
      } else if (step.kind === 'number') {
        const value = Number(document.getElementById('wlItUnitValue')?.value || 0);
        const min=Number(step.min ?? (step.field==='battery_count' ? item.required_battery_count : 1) ?? 1);
        if (value < min) return alert(`This check requires at least ${min}.`);
        item[step.field] = value; needsSave = true;
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
        itFinalView = 'summary';
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
  const finalView=e.target.closest('[data-wl-final-view]');
  if (finalView && itUnitPhase==='final') {
    itFinalView=finalView.dataset.wlFinalView || 'summary';
    return renderItUnitStep();
  }
  const finalUnit=e.target.closest('[data-wl-final-unit]');
  if (finalUnit && itUnitPhase==='final') {
    itFinalView='summary';
    itUnitIndex=Math.max(0,Number(finalUnit.dataset.wlFinalUnit||0));
    itUnitPhase='review';
    return renderItUnitStep();
  }
  if (e.target.closest('[data-wl-final-last-unit]') && itUnitPhase==='final') {
    itFinalView='summary';
    const jobItems=itItems().map((item,index)=>({item,index})).filter(row=>row.item.purpose!=='BACKUP');
    itUnitIndex=jobItems.length ? jobItems[jobItems.length-1].index : Math.max(0,itItems().length-1);
    itUnitPhase='review';
    return renderItUnitStep();
  }

  if (e.target.closest('[data-wl-it-prev]')) {
    const items = itItems();
    if (itUnitPhase === 'final') { itFinalView='summary'; itUnitIndex = Math.max(0, items.length - 1); itUnitPhase = 'review'; return renderItUnitStep(); }
    if (itUnitPhase === 'signature') { itUnitPhase = 'photo'; return renderItUnitStep(); }
    if (itUnitPhase === 'review') { itUnitPhase = 'signature'; return renderItUnitStep(); }
    if (itUnitPhase === 'photo') { itUnitPhase = 'checks'; itQuestionIndex = Math.max(0, itUnitStepsData(currentItItem(), itUnitIndex + 1).length - 1); return renderItUnitStep(); }
    if (itUnitPhase === 'checks') { if (itQuestionIndex > 0) { itQuestionIndex--; return renderItUnitStep(); } itUnitPhase = 'purpose'; itTypeChoice = currentItItem()?.equipment_type || ''; itPurposeChoice = currentItItem()?.purpose || ''; return renderItUnitStep(); }
    if (itUnitPhase === 'recon') { itUnitPhase = 'purpose'; return renderItUnitStep(); }
    if (itUnitPhase === 'purpose') { itUnitPhase = 'type'; return renderItUnitStep(); }
    if (itUnitPhase === 'type') { if (itUnitIndex === 0) return showPendingList(); itUnitIndex--; itUnitPhase = 'review'; return renderItUnitStep(); }
  }
  if (e.target.closest('[data-wl-add-truck-spare-unit]')) { e.preventDefault(); e.stopPropagation(); return addTruckSpareUnitFromSummary(); }
  const checkoutSpareUnit=e.target.closest('[data-wl-checkout-truck-spare-unit]');
  if (checkoutSpareUnit) { e.preventDefault(); e.stopPropagation(); return checkoutTruckSpareUnit(checkoutSpareUnit.dataset.wlCheckoutTruckSpareUnit); }
  const checkoutSpareBattery=e.target.closest('[data-wl-checkout-truck-spare-battery]');
  if (checkoutSpareBattery) { e.preventDefault(); e.stopPropagation(); return checkoutTruckSpareBattery(checkoutSpareBattery.dataset.wlCheckoutTruckSpareBattery); }
  if (e.target.closest('[data-wl-save-truck-spare-batteries]')) { e.preventDefault(); e.stopPropagation(); return saveTruckSpareBatteriesFromSummary(); }
  if (e.target.closest('[data-wl-send-it]')) { e.preventDefault(); e.stopPropagation(); await releaseItPrepUnitByUnit(); return; }
  const svc = e.target.closest('[data-wl-svc]'); if (svc) { if (svc.dataset.wlSvc === 'receive') showReceiveLookup(); if (svc.dataset.wlSvc === 'returns') showServiceReturnHistory(); if (svc.dataset.wlSvc === 'inspect') startInspection(); if (svc.dataset.wlSvc === 'history') showInspectionHistory(); return; }
  if (e.target.closest('[data-wl-service-open-job]')) return showServiceJobLookup();
  const beginAssignedReturn=e.target.closest('[data-wl-service-begin-return]');
  if(beginAssignedReturn) return beginServiceReturnForAssignment(beginAssignedReturn.dataset.wlServiceBeginReturn);
  const completeServiceAssignment=e.target.closest('[data-wl-service-complete-assignment]');
  if(completeServiceAssignment) return completeServiceFieldAssignment(completeServiceAssignment.dataset.wlServiceCompleteAssignment);
  if (e.target.closest('[data-wl-service-find-job]')) return serviceFindJobByTicket();
  const takeServiceJob=e.target.closest('[data-wl-service-take-job]');
  if(takeServiceJob) return serviceTakeVerifiedJob(takeServiceJob.dataset.wlServiceTakeJob);
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
    const swapStep = signStep + 1;
    const nonHeliosSwaps = allSwapItems(activeSvcPrep).filter(i=>i.equipment_type!=='Helios');
    const rangerStep = swapStep + (nonHeliosSwaps.length ? 1 : 0);
    const rangerField = rangerFieldItems(activeSvcPrep);
    if (svcUnitIndex < forms.length) return advanceSvcVerification();
    if (hasParts && svcUnitIndex === partStep && !activeSvcPrep.service_parts_confirmed) return alert('Physically verify the listed parts from IT before continuing.');
    if (solarRequired && svcUnitIndex === solarStep) {
      const check=await loadServiceSolarCheck(activeSvcPrep.id);
      const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
      if (!serviceSolarReady(solarCtx,check,evidence)) return alert('Finish the Solar / Helios checklist, required photos, and signatures before continuing.');
    }
    if (svcUnitIndex === photoStep) { const serviceEv = await evidenceRows(activeSvcPrep.id, 'service'); const itEv = await evidenceRows(activeSvcPrep.id, 'it'); const requiredPhotos = itEv.filter(x => x.kind === 'photo').length || forms.length; const servicePhotos = serviceEv.filter(x => x.kind === 'photo').length; if (servicePhotos !== requiredPhotos) return alert(`Service needs exactly ${requiredPhotos} receipt photo${requiredPhotos === 1 ? '' : 's'} to match IT. You currently have ${servicePhotos}.`); }
    if (svcUnitIndex === signStep) { const ev = await evidenceRows(activeSvcPrep.id, 'service'); if (!ev.some(x => x.kind === 'signature')) return alert('Save the Service signature before continuing.'); }
    if (nonHeliosSwaps.length && svcUnitIndex === swapStep) {
      const state=await swapWorkflowState(activeSvcPrep);
      const unresolved=nonHeliosSwaps.some(i=>!i.swap_outcome)
        || nonHeliosSwaps.some(i=>i.swap_outcome==='returned_unused'&&state.unusedMissing.some(m=>m.id===i.id))
        || Object.entries(nonHeliosSwaps.filter(i=>i.swap_outcome==='installed').reduce((m,i)=>(m[i.equipment_type]=(m[i.equipment_type]||0)+1,m),{})).some(([type,needed])=>state.oldReturns.filter(r=>r.equipment_type===type).length<Number(needed));
      if(unresolved)return alert('Finish the SWAP YES / NO decision and required IT Intake return before continuing.');
    }
    if (rangerField.length && svcUnitIndex === rangerStep && !rangerFieldReady(activeSvcPrep)) return alert('Complete the Ranger Victron Bluetooth field verification before continuing.');
    svcUnitIndex++; return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-svc-prev]')) {
    const card = findSvcCard(activeSvcPrep.ticket_no);
    const forms = svcForms(card);
    const hasParts = ticketPartsTotal(activeSvcPrep) > 0;
    const partStep = forms.length;
    const solarCtx=await serviceSolarContextData(activeSvcPrep.id),solarRequired=Boolean(solarCtx?.need_solar);
    const solarStep=forms.length+(hasParts?1:0),proofStep=solarStep+(solarRequired?1:0),photoStep=proofStep+1,signStep=proofStep+2,swapStep=signStep+1;
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
  if (e.target.closest('[data-wl-accept-helios]')) return acceptHeliosHandoff();
  if (e.target.closest('[data-wl-helios-old-return]')) return startHeliosOldUnitReturn();
  if (e.target.closest('[data-wl-return-to-active-helios]')) return renderSvcPrep();
  if (e.target.closest('[data-wl-submit-helios-field]')) return submitHeliosFieldInstall();
  if (e.target.closest('[data-wl-save-ranger-field]')) return saveRangerFieldVerification();
  const swapUsed=e.target.closest('[data-wl-swap-used]');
  if(swapUsed)return resolveSwapUnitOutcome(swapUsed.dataset.wlSwapUsed,true);
  const swapUnused=e.target.closest('[data-wl-swap-unused]');
  if(swapUnused)return resolveSwapUnitOutcome(swapUnused.dataset.wlSwapUnused,false);
  const swapOldReturn=e.target.closest('[data-wl-swap-old-return]');
  if(swapOldReturn)return startSwapOldUnitReturn(swapOldReturn.dataset.wlSwapOldReturn);
  const standardSwapReturn=e.target.closest('[data-wl-standard-swap-return]');
  if(standardSwapReturn)return startSwapOldUnitReturn(standardSwapReturn.dataset.wlStandardSwapReturn);
  if (e.target.closest('[data-wl-return-to-active-standard]')) return renderSvcPrep();
  const confirmSwapSite=e.target.closest('[data-wl-confirm-swap-site]');
  if(confirmSwapSite){
    const label=confirmSwapSite.dataset.wlSwapSiteLabel||'replacement unit',site=confirmSwapSite.dataset.wlSwapSite||'customer site';
    if(!confirm('Confirm IT registered '+label+' to '+site+'?\n\nThis records the site-registration step in Tech Check.'))return;
    const {error}=await liveDb.rpc('it_confirm_swap_site_registration_v1',{p_item_id:confirmSwapSite.dataset.wlConfirmSwapSite});
    if(error)return alert(error.message);
    return showITHome();
  }

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

  const spareReturn=e.target.closest('[data-wl-spare-unit-return]');
  if (spareReturn) {
    if (!confirm('Return this UNUSED complete backup through IT Intake? IT must verify it after transport before it can return to Shop Inventory.')) return;
    const { error }=await liveDb.rpc('resolve_my_truck_spare_unit',{p_item_id:spareReturn.dataset.wlSpareUnitReturn,p_outcome:'returned_unused'});
    if (error) return alert(error.message);
    return showSvcHome();
  }
  const spareUsed=e.target.closest('[data-wl-spare-unit-used]');
  if (spareUsed) {
    if (!confirm('Mark this truck spare USED for the field job? If it replaced a failed unit, return the failed unit through normal IT Intake.')) return;
    const { error }=await liveDb.rpc('resolve_my_truck_spare_unit',{p_item_id:spareUsed.dataset.wlSpareUnitUsed,p_outcome:'used'});
    if (error) return alert(error.message);
    return showSvcHome();
  }
  const spareBattery=e.target.closest('[data-wl-spare-battery-resolve]');
  if (spareBattery) {
    const max=Math.max(0,Number(spareBattery.dataset.wlSpareBatteryMax||0));
    const used=Math.max(0,Math.floor(Number(document.getElementById('wlSpareUsed_'+spareBattery.dataset.wlSpareBatteryResolve)?.value||0)));
    if (used>max) return alert('Used spare battery quantity cannot exceed '+max+'.');
    if (!confirm('Record '+used+' used and '+(max-used)+' returned unused?')) return;
    const { error }=await liveDb.rpc('resolve_my_truck_spare_battery',{p_spare_id:spareBattery.dataset.wlSpareBatteryResolve,p_used_qty:used});
    if (error) return alert(error.message);
    return showSvcHome();
  }

  if (e.target.closest('[data-wl-close-svc]')) { await window.closePreparedTicket(activeSvcPrep.id); setTimeout(showSvcHome, 300); return; }
  const upload = e.target.closest('[data-wl-upload]'); if (upload) {
    const panel = upload.closest('.wl-proof');
    const input = panel.querySelector('.wl-file');
    const files = [...(input.files || [])];
    if (!files.length) return alert('Take or select at least one photo.');
    const unitNo = Number(panel.dataset.unit || 0) || null;
    const item = panel.dataset.stage === 'it' && unitNo ? itItems()[unitNo - 1] || null : null;
    const itemId = item?.id || null;
    const expected = Number(panel.dataset.expected || 0) || null;
    if (unitNo && files.length !== 1) return alert('Take exactly one photo for this item.');
    if (panel.dataset.stage === 'service' && expected) {
      const existing = (await evidenceRows(panel.dataset.proof, 'service')).filter(x => x.kind === 'photo').length;
      if (existing + files.length > expected) return alert(`Service needs exactly ${expected} photos total. You already have ${existing}.`);
    }
    upload.disabled = true;
    upload.textContent = files.length > 1 ? `Preparing ${files.length} photos…` : 'Preparing photo…';
    try {
      const optimized = await Promise.all(files.map(optimizeEvidencePhoto));
      let tagScan=null;
      if (panel.dataset.stage==='it' && unitNo && item && shouldScanUnitTag(item.equipment_type) && item.unit_tag) {
        upload.textContent='OnSite Vision is scanning…';
        showLiveTagScan(panel,item.unit_tag);
        tagScan=await scanUnitTagPhoto(optimized[0],item.unit_tag);
        const liveScan=panel.querySelector('.wl-ai-scan-live');
        if(liveScan) liveScan.outerHTML=tagScanStatusHtml(tagScan,item.unit_tag);
      }
      upload.textContent = files.length > 1 ? `Saving ${files.length} photos…` : 'Saving photo…';
      await Promise.all(optimized.map((f, i) => {
        const original = f.name || files[i].name;
        const evidenceName = unitNo ? `unit-${unitNo}-photo-${original}` : original;
        return uploadEvidence(panel.dataset.proof, panel.dataset.stage, 'photo', f, evidenceName, itemId);
      }));
      if (tagScan && itemId) await saveItTagScan(itemId,tagScan);
      if (panel.dataset.stage === 'it' && unitNo && activeItPrep) {
        activeItPrep = await getPrep(activeItPrep.id);
        return renderItUnitStep();
      }
      await refreshProofPanel(panel);
    } catch (err) {
      upload.disabled = false;
      upload.textContent = 'Save Photo(s)';
      alert(err.message || 'Upload failed.');
    }
    return;
  }
  const clear = e.target.closest('[data-wl-clear]'); if (clear) { const c = clear.closest('.wl-sign').querySelector('canvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); c.dataset.ink = ''; return; }
  const save = e.target.closest('[data-wl-save-sign]'); if (save) { const panel = save.closest('.wl-proof'); const canvas = panel.querySelector('canvas'); if (!canvas?.dataset.ink) return alert('Sign in the box first.'); const blob = await blobFromCanvas(canvas); const unitNo = Number(panel.dataset.unit || 0) || null; const itemId = panel.dataset.stage === 'it' && unitNo ? itItems()[unitNo - 1]?.id || null : null; const signatureName = unitNo ? `unit-${unitNo}-signature.png` : 'signature.png'; await uploadEvidence(panel.dataset.proof, panel.dataset.stage, 'signature', blob, signatureName, itemId); if (panel.dataset.stage === 'it' && panel.dataset.mode === 'signature' && activeItPrep) return renderItUnitStep(); await refreshProofPanel(panel); return; }
  const replace = e.target.closest('[data-wl-replace]'); if (replace) { const panel = replace.closest('.wl-proof'); const saved = panel.querySelector('.wl-saved'); const btn = replace; saved?.remove(); btn.remove(); const d = document.createElement('div'); d.className = 'wl-sign top8'; d.innerHTML = `<b>Sign with your finger</b><canvas></canvas><div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${panel.dataset.stage}'>Save Signature</button></div>`; panel.append(d); wireCanvas(d.querySelector('canvas')); return; }
  const ans = e.target.closest('[data-wl-answer]'); if (ans) { const val = ans.dataset.wlAnswer === 'pass'; if (inspection.step < 8) inspection.truck[inspection.step] = val; else if (inspection.takingTrailer === true && inspection.step < 16) inspection.trailer[inspection.step - 9] = val; if (val) inspection.step++; saveInspectionDraft(); return inspectionQuestion(); }
  const tr = e.target.closest('[data-wl-trailer]'); if (tr) { inspection.takingTrailer = tr.dataset.wlTrailer === 'yes'; inspection.step = inspection.takingTrailer ? 9 : 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-next]')) { if (inspection.step < 8 && inspection.truck[inspection.step] === null) return alert('Choose PASS or FAIL first.'); if (inspection.step === 8 && inspection.takingTrailer === null) return alert('Choose whether you are taking a trailer.'); if (inspection.takingTrailer === true && inspection.step >= 9 && inspection.step < 16 && inspection.trailer[inspection.step - 9] === null) return alert('Choose PASS or FAIL first.'); inspection.step++; if (inspection.step === 9 && inspection.takingTrailer === false) inspection.step = 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-prev]')) { if(document.getElementById('wlTruck110Qty')) { inspection.load.qty110=document.getElementById('wlTruck110Qty').value; inspection.load.charged110=document.getElementById('wlTruck110Charged')?.checked===true; inspection.load.qtyLi=document.getElementById('wlTruckLiQty')?.value||''; inspection.load.chargedLi=document.getElementById('wlTruckLiCharged')?.checked===true; inspection.load.backup=document.getElementById('wlTruckBackup')?.value||''; } if (inspection.step === 16 && inspection.takingTrailer === false) inspection.step = 8; else inspection.step = Math.max(0, inspection.step - 1); saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-submit-inspection]')) return submitInspection();
});
async function showServiceReturn() {
  const saved=await loadDeviceDraft('service-return');
  if (saved?.ticket) { serviceReturn={ step:Math.min(Number(saved.step||0),3), ticket:String(saved.ticket||''), unit:String(saved.unit||''), type:String(saved.type||''), notes:String(saved.notes||''), noTag:Boolean(saved.noTag), photo:null, tagScan:null, conditionPhotos:[], damagePhotos:[], knownUnits:[], offlineEscalationId:saved.offlineEscalationId||null }; if (serviceReturn.ticket && serviceReturn.step>=1) serviceReturn.knownUnits=await rememberedUnitsForTicket(serviceReturn.ticket); serviceReturnRecovered=true; }
  else { serviceReturn={ step:0, ticket:'', unit:'', type:'', notes:'', noTag:false, photo:null, tagScan:null, conditionPhotos:[], damagePhotos:[], knownUnits:[] }; serviceReturnRecovered=false; }
  return renderServiceReturn();
}
async function showServiceReturnPreset(ticket, unit, type) { const saved=await loadDeviceDraft('service-return'); if(saved?.ticket) return showServiceReturn(); serviceReturn={ step:3, ticket:String(ticket||''), unit:String(unit||''), type:String(type||''), notes:'', noTag:String(type||'')==='110V Stand'&&!String(unit||'').trim(), photo:null, tagScan:null, conditionPhotos:[], damagePhotos:[], knownUnits:[] }; serviceReturnRecovered=false; await saveServiceReturnDraft(); return renderServiceReturn(); }
async function prepareReturnPreviewPhotos(files) {
  const prepared = [];
  for (const file of files) prepared.push(await optimizeEvidencePhoto(file));
  return prepared;
}
async function rememberedUnitsForTicket(ticket) {
  const { data, error } = await liveDb.from('prep_tickets').select('ticket_no,prep_items(unit_tag,equipment_type,purpose,spare_outcome)').order('created_at', { ascending: false });
  if (error) return [];
  const prepUnits = (data || []).filter(p => norm(p.ticket_no) === norm(ticket)).flatMap(p => p.prep_items || []);
  const returns = (await returnRows()).filter(r => norm(r.ticket_no) === norm(ticket));
  const alreadyReturned = new Set(returns.map(r => norm(r.unit_tag)).filter(Boolean));
  const seen = new Set();
  return prepUnits.filter(item => {
    const tag = String(item.unit_tag || '').trim();
    const key = norm(tag);
    if (item.purpose==='BACKUP' && item.spare_outcome!=='used') return false;
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
  const statusText = r => r.status === 'waiting_it' ? 'WAITING FOR IT INTAKE' : r.status === 'pending_mhelp_inventory' ? 'IT COMPLETE — PENDING MHELPDESK INVENTORY' : r.status === 'needs_replacement' ? 'NEEDS REPLACEMENT — OWNER NOTIFIED' : 'COMPLETED — BACK IN SHOP INVENTORY';
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
function isTagless110VReturn(){ return serviceReturn.type==='110V Stand' && Boolean(serviceReturn.noTag) && !String(serviceReturn.unit||'').trim(); }
function is110VStandReturn(){ return serviceReturn.type==='110V Stand'; }
function serviceReturnLabel(){ return isTagless110VReturn() ? '110V Stand · No tag' : (serviceReturn.unit || serviceReturn.type || 'Returned equipment'); }
function renderServiceReturn() {
  const card = serviceReturnCard();
  const step = serviceReturn.step;
  if (step === 0) card.innerHTML = `${progress('Return Unit · Step 1 of 5', 'Enter the MHelpDesk ticket number', 1, 5)}<div class='wl-question'><div class='qtext'>What MHelpDesk ticket is this unit coming back from?</div><input id='wlReturnTicket' inputmode='numeric' value='${esc(serviceReturn.ticket)}' placeholder='Ticket #'></div><div class='wl-nav'><button class='wl-prev' data-wl-home='svc'>Back</button><button class='wl-next' data-wl-return-next>Next →</button></div>`;
  else if (step === 1) { const remembered = serviceReturn.knownUnits || []; const choices = remembered.map(item => `<button class='wl-unit-choice ${norm(serviceReturn.unit) === norm(item.unit_tag) ? 'on' : ''}' data-wl-return-unit='${esc(item.unit_tag)}' data-wl-return-type='${esc(item.equipment_type || '')}'><b>${esc(item.unit_tag)}</b><span>${esc(item.equipment_type || 'Known unit')} · remembered from MHelpDesk #${esc(serviceReturn.ticket)}</span></button>`).join(''); card.innerHTML = `${progress('Return Unit · Step 2 of 5', 'Choose the equipment coming back', 2, 5)}<div class='wl-question'><div class='qtext'>Which unit is coming back from MHelpDesk #${esc(serviceReturn.ticket)}?</div>${choices ? `<div class='wl-note'>These tagged units are already remembered from this ticket. Tap the unit coming back.</div><div class='wl-unit-choices'>${choices}</div><div class='wl-divider'>OR</div>` : ''}<button class='wl-big wl-gray' data-wl-return-no-tag-110v><b>110V STAND — NO TAG</b><span class='small'>Use this when the stand has no physical tag. Service will return it directly to Shop.</span></button><div class='wl-divider'>OR ENTER A UNIT TAG</div><input id='wlReturnUnit' value='${esc(serviceReturn.unit)}' placeholder='Exact unit tag'></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next →</button></div>`; }
  else if (step === 2) { const options = [...CAMERA_UNIT_TYPES, ...STAND_POLE_TYPES].map(type => `<option value='${esc(type)}' ${serviceReturn.type === type ? 'selected' : ''}>${esc(type)}</option>`).join(''); card.innerHTML = `${progress('Return Unit · Step 3 of 5', 'Choose the equipment type', 3, 5)}<div class='wl-question'><div class='qtext'>What type of unit is ${esc(serviceReturn.unit)}?</div><select id='wlReturnType'><option value=''>Choose type…</option>${options}<option value='Other' ${serviceReturn.type === 'Other' ? 'selected' : ''}>Other</option></select></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next: Photo →</button></div>`; }
  else if (step === 3) {
    const scan=serviceReturn.tagScan;
    const scanHtml=scan?.status==='scanning'
      ? `<div class='warn top8'><b>AI scanning tag…</b><div class='small'>Checking this photo against ${esc(serviceReturn.unit)}.</div></div>`
      : (scan ? tagScanStatusHtml(scan,serviceReturn.unit) : '');
    card.innerHTML = isTagless110VReturn() ? `${progress('Return 110V Stand · Step 4 of 5', 'Photograph the stand', 4, 5)}<div class='wl-question'><div class='qtext'>Take a clear photo of the 110V Stand before bringing it back to Shop.</div><div class='wl-note'>This stand has no physical tag. The stand photo is the return proof; no tag scan or tag match is required.</div><label class='wl-photo-button' for='wlReturnPhoto'>📷 TAKE / CHOOSE STAND PHOTO</label><input id='wlReturnPhoto' class='wl-photo-input' type='file' accept='image/*' capture='environment'><div id='wlReturnPhotoPreview' class='wl-return-preview ${serviceReturn.photo ? '' : 'hidden'}'>${serviceReturn.photo ? `<img src='${URL.createObjectURL(serviceReturn.photo)}' alt='Selected 110V Stand photo'><div class='ok top8'><b>✓ No tag on this stand</b></div>` : ''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next>Next: Review →</button></div>` : `${progress('Return Unit · Step 4 of 5', `Photograph unit tag ${serviceReturn.unit}`, 4, 5)}<div class='wl-question'><div class='qtext'>Take a clear photo of the UNIT TAG showing ${esc(serviceReturn.unit)}.</div><div class='wl-stop'><b>Required photo proof</b><div>The tag number <b>${esc(serviceReturn.unit)}</b> must be readable in the picture. For solar equipment, the app also scans the photo and compares it to the expected tag.</div></div><label class='wl-photo-button' for='wlReturnPhoto'>📷 TAKE / CHOOSE UNIT TAG PHOTO</label><input id='wlReturnPhoto' class='wl-photo-input' type='file' accept='image/*' capture='environment'><div id='wlReturnPhotoPreview' class='wl-return-preview ${serviceReturn.photo ? '' : 'hidden'}'>${serviceReturn.photo ? `<img src='${URL.createObjectURL(serviceReturn.photo)}' alt='Selected unit tag photo'>${scanHtml}<div class='small top8'>Expected tag: <b>${esc(serviceReturn.unit)}</b></div>` : ''}</div></div><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><button class='wl-next' data-wl-return-next ${scan?.status==='scanning'?'disabled':''}>Next: Review →</button></div>`;
  }
  else { const conditionPreview = (serviceReturn.conditionPhotos || []).map(file => `<img src='${URL.createObjectURL(file)}' alt='Site condition photo'>`).join(''); const damagePreview = (serviceReturn.damagePhotos || []).map(file => `<img src='${URL.createObjectURL(file)}' alt='Damage photo'>`).join(''); const direct110=is110VStandReturn(); card.innerHTML = `${progress(direct110?'Return 110V Stand · Step 5 of 5':'Return Unit · Step 5 of 5', direct110?'Return this stand directly to Shop':'Document how the unit looked at the site', 5, 5)}<div class='wl-review'><b>${esc(serviceReturnLabel())} · ${esc(serviceReturn.type)}</b><div><b>MHelpDesk #${esc(serviceReturn.ticket)}</b></div><div>📷 ${direct110?'Stand photo ready':'Unit tag photo ready'}</div>${!direct110 && serviceReturn.tagScan && serviceReturn.tagScan.status!=='scanning' ? tagScanStatusHtml(serviceReturn.tagScan,serviceReturn.unit) : ''}<div class='small top8'>${direct110?'Put the 110V Stand on the trailer, bring it back to the shop, and add it directly back to Shop Inventory. IT Intake is not required.':'Add photos showing the camera/unit as it looked at the site. If there is damage, add close-up damage photos and describe it below. IT Intake will see all of this before checking the unit.'}</div></div><div class='wl-question top10'><div class='qtext'>Site condition photos</div><div class='wl-note'>Take pictures showing the overall camera/unit condition before it leaves the site. Add as many as needed to verify it still looks good.</div><label class='wl-photo-button' for='wlReturnConditionPhotos'>📷 ADD SITE CONDITION PHOTOS</label><input id='wlReturnConditionPhotos' class='wl-photo-input' type='file' accept='image/*' capture='environment' multiple><div class='wl-return-preview ${conditionPreview ? '' : 'hidden'}'><div class='wl-return-gallery'>${conditionPreview}</div><div class='ok'>✓ ${(serviceReturn.conditionPhotos || []).length} site condition photo${(serviceReturn.conditionPhotos || []).length === 1 ? '' : 's'} selected</div></div></div><div class='wl-question top10'><div class='qtext'>Damage photos, if damage is found</div><div class='wl-note'>Take close-up pictures of scratches, broken parts, dents, missing pieces, camera damage, or anything else IT needs to inspect.</div><label class='wl-photo-button wl-damage-photo' for='wlReturnDamagePhotos'>⚠️ ADD DAMAGE PHOTOS</label><input id='wlReturnDamagePhotos' class='wl-photo-input' type='file' accept='image/*' capture='environment' multiple><div class='wl-return-preview ${damagePreview ? '' : 'hidden'}'><div class='wl-return-gallery'>${damagePreview}</div><div class='warn'>⚠ ${(serviceReturn.damagePhotos || []).length} damage photo${(serviceReturn.damagePhotos || []).length === 1 ? '' : 's'} selected — describe the damage below.</div></div></div><label>Return notes / damage noticed</label><textarea id='wlReturnNotes' rows='5' placeholder='Describe damage, missing parts, site condition, reason for return, or other notes'>${esc(serviceReturn.notes)}</textarea><div class='ok top10'><b>✓ SERVICE RETURN READY</b><div>${direct110?'This 110V Stand will be marked Back in Shop directly by Service.':'All photos and these notes will follow unit '+esc(serviceReturn.unit)+' into IT Intake.'}</div></div><button class='wl-big wl-red top10' data-wl-return-submit>${direct110?'RETURN 110V STAND TO SHOP →':'SEND THIS UNIT TO IT INTAKE →'}</button><div class='wl-nav'><button class='wl-prev' data-wl-return-prev>Back</button><span></span></div>`; }
  if (serviceReturnRecovered && !card.querySelector('.wl-draft-recovered')) card.insertAdjacentHTML('afterbegin', `<div class='warn wl-draft-recovered'><b>Recovered unsent Service Return from this device.</b><div class='small'>Ticket, unit, equipment type, and notes were restored. Photos are never treated as saved until they upload successfully, so reselect/retake the required photo if Safari reloaded.</div></div>`);
  hideChildren(viewSvc(), [card]);
  resetWizardPosition();
}
async function serviceReturnNext() {
  if (serviceReturn.step === 0) { const value = document.getElementById('wlReturnTicket')?.value.trim() || ''; if (!value) return alert('Enter the MHelpDesk ticket number first.'); serviceReturn.ticket = value; serviceReturn.knownUnits = await rememberedUnitsForTicket(value); }
  else if (serviceReturn.step === 1) { const value = document.getElementById('wlReturnUnit')?.value.trim() || serviceReturn.unit || ''; if (!value) return alert('Choose a remembered unit, tap 110V STAND — NO TAG, or enter the exact unit tag / unit number first.'); serviceReturn.noTag=false; serviceReturn.unit = value; const known = (serviceReturn.knownUnits || []).find(item => norm(item.unit_tag) === norm(value)); if (known?.equipment_type) serviceReturn.type = known.equipment_type; }
  else if (serviceReturn.step === 2) { const value = document.getElementById('wlReturnType')?.value || ''; if (!value) return alert('Choose the equipment type first.'); serviceReturn.type = value; serviceReturn.noTag=false; }
  else if (serviceReturn.step === 3) {
    const file=document.getElementById('wlReturnPhoto')?.files?.[0];
    if (!file && !serviceReturn.photo) return alert(isTagless110VReturn() ? 'Take or choose a clear photo of the 110V Stand first.' : `Take or choose a clear photo of the unit tag showing ${serviceReturn.unit} first.`);
    if (isTagless110VReturn()) { serviceReturn.tagScan=null; }
    else if (serviceReturn.tagScan?.status==='scanning') return alert('Wait for the AI tag scan to finish.');
    if (!isTagless110VReturn() && serviceReturn.tagScan?.status==='mismatch') return alert(`The photo scan read ${serviceReturn.tagScan.detected||'a different tag'}, not ${serviceReturn.unit}. Retake the tag photo before continuing.`);
    if (!isTagless110VReturn() && serviceReturn.tagScan?.status==='unreadable' && !confirm(`AI could not read unit tag ${serviceReturn.unit}. Can you clearly read and visually verify ${serviceReturn.unit} in this photo?`)) return;
    if (!isTagless110VReturn() && !serviceReturn.tagScan && !confirm(`Can you clearly read unit tag ${serviceReturn.unit} in this photo?`)) return;
  }
  serviceReturn.step = Math.min(4, serviceReturn.step + 1);
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
async function submitServiceReturn() {
  if (serviceReturnSubmitting) return;
  serviceReturn.notes = document.getElementById('wlReturnNotes')?.value || serviceReturn.notes || '';
  await saveServiceReturnDraft();
  if (!serviceReturn.ticket || !serviceReturn.type || !serviceReturn.photo || (!serviceReturn.unit && !isTagless110VReturn())) return alert(isTagless110VReturn() ? 'Ticket, 110V Stand type, and stand photo are required.' : 'Ticket, unit, equipment type, and unit tag photo are required.');
  const isHeliosSwapReturn=serviceReturn.type==='Helios' && activeSvcPrep?.ticket_no && norm(activeSvcPrep.ticket_no)===norm(serviceReturn.ticket) && heliosFieldItems(activeSvcPrep).some(x=>x.purpose==='SWAP');
  if (isHeliosSwapReturn && !serviceReturn.notes.trim()) return alert('For OLD UNIT RETURNING, document why the Helios is being swapped and the damage / issues / symptoms / repair needed before sending it to IT Intake.');
  if ((serviceReturn.damagePhotos || []).length && !serviceReturn.notes.trim()) return alert('Damage photos were added. Describe what is damaged in Return notes / damage noticed so IT knows what to inspect.');
  if (!navigator.onLine) return alert(`No connection. This return is saved as an unsent draft on this device. Reconnect before ${is110VStandReturn()?'returning the stand to Shop':'sending it to IT Intake'}.`);
  serviceReturnSubmitting=true; document.body.classList.add('busy');
  let uploadedPaths=[];
  try {
    const tech=await currentTechIdentity();
    const existingReturns=isTagless110VReturn()?[]:(await returnRows()).filter(r => norm(r.ticket_no)===norm(serviceReturn.ticket) && norm(r.unit_tag)===norm(serviceReturn.unit));
    if (existingReturns.length) return alert(`Unit ${serviceReturn.unit} has already been returned for MHelpDesk #${serviceReturn.ticket}. It cannot be returned again from this ticket.`);
    const returnId=crypto.randomUUID();
    const safeUnit=(String(serviceReturn.unit||'').trim()||'no-tag-110v-stand').replace(/[^a-zA-Z0-9._-]/g,'_');
    const taggedPhoto=new File([serviceReturn.photo],isTagless110VReturn()?`110v-stand-no-tag-${serviceReturn.photo.name || 'photo.jpg'}`:`unit-${safeUnit}-tag-${serviceReturn.photo.name || 'photo.jpg'}`,{type:serviceReturn.photo.type || 'image/jpeg'});
    const conditionPhotos=(serviceReturn.conditionPhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-site-condition-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    const damagePhotos=(serviceReturn.damagePhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-DAMAGE-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    uploadedPaths=await uploadReturnPhotos([taggedPhoto,...conditionPhotos,...damagePhotos],returnId,`service/unit-${safeUnit}`);
    const scan=!is110VStandReturn() && serviceReturn.tagScan && ['match','mismatch','unreadable'].includes(serviceReturn.tagScan.status) ? serviceReturn.tagScan : null;
    let error=null;
    if (is110VStandReturn()) {
      ({error}=await liveDb.rpc('service_return_110v_stand_to_shop_v3',{
        p_ticket_no:serviceReturn.ticket,
        p_unit_tag:String(serviceReturn.unit||'').trim()||null,
        p_notes:serviceReturn.notes||null,
        p_return_photo_paths:uploadedPaths,
        p_return_id:returnId,
        p_damage_found:(serviceReturn.damagePhotos || []).length>0
      }));
    } else {
      ({error}=await liveDb.from('unit_returns').insert({
        id:returnId,
        ticket_no:serviceReturn.ticket,
        unit_tag:serviceReturn.unit,
        equipment_type:serviceReturn.type,
        service_tech_id:tech.id,
        service_tech_name:tech.name,
        return_notes:serviceReturn.notes,
        return_photo_paths:uploadedPaths,
        tag_scan_status:scan?.status||null,
        tag_scan_detected:scan?.detected||null,
        tag_scan_expected:scan?serviceReturn.unit:null,
        tag_scan_confidence:scan?.confidence==null?null:Number(scan.confidence),
        tag_scan_engine:scan?.engine||null,
        tag_scan_at:scan?new Date().toISOString():null
      }));
    }
    if (error) throw error;
    let offlineLinkError=null;
    if (!is110VStandReturn() && serviceReturn.offlineEscalationId) {
      const link=await liveDb.rpc('service_link_offline_failed_return_v1',{p_escalation_id:serviceReturn.offlineEscalationId,p_return_id:returnId});
      offlineLinkError=link.error||null;
      if(!offlineLinkError)serviceReturn.offlineEscalationId=null;
    }
    const assignmentProgress=await syncServiceAssignmentAfterReturn(serviceReturn.ticket,tech.id);
    await clearDeviceDraft('service-return'); serviceReturnRecovered=false;
    const card=serviceReturnCard();
    const continuationHtml=
      (!is110VStandReturn() && activeSvcPrep?.ticket_no && norm(activeSvcPrep.ticket_no)===norm(serviceReturn.ticket) && heliosFieldItems(activeSvcPrep).some(x=>x.purpose==='SWAP')
        ? `<button class='wl-big wl-blue top10' data-wl-return-to-active-helios>← Continue Helios Swap</button>`
        : '') +
      (activeSvcPrep?.ticket_no && norm(activeSvcPrep.ticket_no)===norm(serviceReturn.ticket) && allSwapItems(activeSvcPrep).some(x=>x.equipment_type===serviceReturn.type)
        ? `<button class='wl-big wl-blue top10' data-wl-return-to-active-standard>← Continue ${esc(serviceReturn.type)} Swap</button>`
        : '');
    const actionHtml=`<button class='wl-big wl-red top10' data-wl-service-return>＋ Add Another Returned Unit</button><button class='wl-back top10' data-wl-home='svc'>Service Home</button>`;
    const direct110Damage=is110VStandReturn() && (serviceReturn.damagePhotos || []).length>0;
    card.innerHTML=(is110VStandReturn()
      ? (direct110Damage
        ? `${progress('110V Stand Returned', 'Damage requires Owner action', 1, 1)}<div class='warn'><b>⚠ ${esc(serviceReturnLabel())} needs replacement / repair.</b><div>The damaged stand is held in Maintenance and is NOT available in Shop Inventory. The Owner was notified with the photos and notes for MHelpDesk #${esc(serviceReturn.ticket)}. IT Intake is not required for this 110V Stand.</div>${assignmentProgress.required?`<div class='small top8'><b>Assignment progress:</b> ${assignmentProgress.count} of ${assignmentProgress.required} required return${assignmentProgress.required===1?'':'s'} recorded${assignmentProgress.completed?' · Service assignment complete':''}${assignmentProgress.fieldPending?' · Continue active SWAP workflow':''}.</div>`:''}</div>`
        : `${progress('110V Stand Returned', 'Back in Shop', 1, 1)}<div class='ok'><b>✓ ${esc(serviceReturnLabel())} is back in Shop.</b><div>Service returned the stand directly to Shop under MHelpDesk #${esc(serviceReturn.ticket)}. ${isTagless110VReturn()?'No physical tag was required.':'The stand tag was recorded.'} IT Intake is not required.</div>${assignmentProgress.required?`<div class='small top8'><b>Assignment progress:</b> ${assignmentProgress.count} of ${assignmentProgress.required} required return${assignmentProgress.required===1?'':'s'} recorded${assignmentProgress.completed?' · Service assignment complete':''}${assignmentProgress.fieldPending?' · Continue active SWAP workflow':''}.</div>`:''}</div>`)
      : `${progress('Return Submitted', `${serviceReturn.unit} is waiting for IT`, 1, 1)}${offlineLinkError?`<div class="warn"><b>Return saved, but the offline escalation still needs linking.</b><div>${esc(offlineLinkError.message||"Open Service Home and finish the authorized swap again.")}</div></div>`:""}<div class='ok'><b>✓ Unit ${esc(serviceReturn.unit)} sent to IT Intake.</b><div>The unit tag photo, ${(serviceReturn.conditionPhotos || []).length} site condition photo${(serviceReturn.conditionPhotos || []).length === 1 ? '' : 's'}, ${(serviceReturn.damagePhotos || []).length} damage photo${(serviceReturn.damagePhotos || []).length === 1 ? '' : 's'}, and Service notes are saved with ${esc(serviceReturn.unit)} under MHelpDesk #${esc(serviceReturn.ticket)}. IT will see them during intake.</div>${assignmentProgress.required?`<div class='small top8'><b>Assignment progress:</b> ${assignmentProgress.count} of ${assignmentProgress.required} required return${assignmentProgress.required===1?'':'s'} recorded${assignmentProgress.completed?' · Service assignment complete':''}${assignmentProgress.fieldPending?' · Continue active SWAP workflow':''}.</div>`:''}</div>`)
      + continuationHtml + actionHtml;
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

function prepHasHeliosField(prep){
  return (prep?.prep_items||[]).some(i=>i.equipment_type==='Helios'&&['DELIVERY','SWAP'].includes(i.purpose));
}
function assignmentNeedsServiceSolar(a, prep) {
  if (a?.assigned_role !== 'service') return false;
  const workType=String(a?.work_type || prep?.work_type || '').toLowerCase();
  const rows=[...normalizedEquipmentManifest(a?.equipment_manifest),...normalizedEquipmentManifest(prep?.equipment_manifest)];
  const hasHelios=rows.some(row=>row.label==='Helios'&&row.qty>0)||prepHasHeliosField(prep);
  if(workType==='swap') return hasHelios;
  if(workType&&workType!=='delivery') return false;
  return rows.some(row=>['Solar Spotter','Ranger','Solar Stand','Helios'].includes(row.label)&&row.qty>0);
}
function ownerAssignmentProgress(a, prep, solarCheck=null) {
  const roleLabel=a.assigned_role==='it'?'IT':'SERVICE';
  if(a.status==='completed'||prep?.status==='closed')return {step:5,label:'DONE',detail:roleLabel+' task completed'};
  if(!a.assignee_user_id&&a.assignment_scope==='department')return {step:1,label:'WAITING FOR '+roleLabel+' TECH',detail:'Assigned to the '+(a.assigned_role==='it'?'IT Department':'Service Department')+' queue'};
  if(a.status==='assigned')return {step:1,label:'ASSIGNED',detail:'Waiting for '+a.assignee_name+' to start'};
  if(a.assigned_role==='service'&&prep?.status==='released'&&prepHasHeliosField(prep)){
    if(solarCheck?.helios_field_completed_at&&!solarCheck?.helios_owner_verified_at)return {step:4,label:'WAITING OWNER FINAL VERIFY',detail:'Service submitted the Helios field installation, photos, and signature'};
    if(solarCheck?.handoff_accepted_at)return {step:4,label:'HELIOS FIELD INSTALL IN PROGRESS',detail:'Service accepted the IT handoff; field installation is still open'};
    if(solarCheck?.completed_at)return {step:3,label:'HELIOS YARD TEST COMPLETE',detail:'Yard solar/Victron test is complete; Service still must accept the handoff'};
    return {step:3,label:'HELIOS PRE-TRIP IN PROGRESS',detail:'Service is completing the yard solar/Victron test before leaving'};
  }
  if(a.assigned_role==='service'&&prep?.status==='released'&&assignmentNeedsServiceSolar(a,prep)){
    return solarCheck?.completed_at?{step:4,label:'SOLAR CHECKOUT VERIFIED',detail:'Automatic Solar / Ranger Service checkout completed'}:{step:3,label:'SOLAR CHECKOUT IN PROGRESS',detail:(a.assignee_name||'Service Tech')+' is verifying charging equipment and proof'};
  }
  if(prep?.status==='released')return {step:4,label:'READY FOR SERVICE',detail:'Handoff created by IT'};
  if(prep?.status==='draft')return {step:3,label:'TECH CHECK IN PROGRESS',detail:'Equipment prep is active'};
  return {step:2,label:'CLAIMED / IN PROCESS',detail:a.assignee_name+' started the task'};
}
function ownerAIElapsed(v){if(!v)return null;const t=new Date(v).getTime();return Number.isFinite(t)?Math.max(0,Date.now()-t):null;}
function ownerAIElapsedText(ms){if(ms==null)return '';const m=Math.floor(ms/60000);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+(h%24)+'h';}
function ownerAIStallCheck(a,prep,solarCheck=null){
  const p=ownerAssignmentProgress(a,prep,solarCheck), role=String(a?.assigned_role||''), type=String(a?.work_type||prep?.work_type||'service').toLowerCase(), flags=[];let since=a?.assigned_at,label='assigned';
  const intentionallyDormant=type==='pickup'&&role==='it'&&a?.status==='assigned';
  if(a?.status==='started'){since=a?.started_at||a?.updated_at||a?.assigned_at;label='in progress';}
  if(prep?.status==='draft'){since=a?.started_at||prep?.updated_at||a?.updated_at||a?.assigned_at;label='IT Tech Check';}
  if(prep?.status==='released'&&role==='service'){since=prep?.released_at||a?.updated_at;label='waiting for Service';}
  const elapsed=ownerAIElapsed(since);
  if(!intentionallyDormant&&a?.status==='assigned'&&elapsed!=null&&elapsed>4*60*60*1000)flags.push('Assigned '+ownerAIElapsedText(elapsed)+' ago and has not been started.');
  if(prep?.status==='draft'&&elapsed!=null&&elapsed>4*60*60*1000)flags.push('IT Tech Check has been open about '+ownerAIElapsedText(elapsed)+'.');
  if(prep?.status==='released'&&role==='service'&&elapsed!=null&&elapsed>2*60*60*1000)flags.push('IT handoff has been waiting for Service about '+ownerAIElapsedText(elapsed)+'.');
  return {flags,elapsed,label,p};
}
function ownerLiveAIStatus(a,prep,solarCheck=null){
  const p=ownerAssignmentProgress(a,prep,solarCheck), flags=[], type=String(a?.work_type||prep?.work_type||'service').toLowerCase(), role=String(a?.assigned_role||'');
  if(type==='pickup'&&role==='it'&&a?.status==='assigned')return {state:'waiting',label:'WAITING NORMALLY',detail:'IT remains locked until Service returns/checks in the pickup equipment.',flags:[]};
  const stall=ownerAIStallCheck(a,prep,solarCheck); flags.push(...stall.flags);
  if(!String(a?.ticket_no||'').trim())flags.push('Missing MHelpDesk reference.');
  if(!String(a?.site||'').trim())flags.push('Customer / Site is missing.');
  if(!String(a?.job_description||'').trim())flags.push('Work description is missing.');
  if(type==='pickup'&&a?.assigned_role==='it'&&p.step<2)flags.push('Pickup is waiting on Service field return before IT Intake.');
  if(a?.assigned_role==='service'&&prep?.status!=='released'&&a?.requires_it_handoff) return {state:'waiting',label:'WAITING NORMALLY',detail:'Waiting for IT handoff',flags};
  if(a?.assigned_role==='service'&&prep?.status==='released'&&assignmentNeedsServiceSolar(a,prep)&&!solarCheck?.completed_at) return {state:flags.length?'attention':'working',label:flags.length?'AI ATTENTION':'IN PROGRESS',detail:'Solar / equipment checkout is still being verified',flags};
  if(flags.length)return {state:'attention',label:'AI ATTENTION',detail:flags[0],flags};
  if(a?.status==='completed'||prep?.status==='closed')return {state:'healthy',label:'COMPLETE',detail:'No obvious workflow conflict',flags:[]};
  return {state:'healthy',label:'ON TRACK',detail:p.detail,flags:[]};
}
function ownerLiveAIHtml(a,prep,solarCheck=null){const s=ownerLiveAIStatus(a,prep,solarCheck);return `<div class='wl-owner-ai-status ${s.state}'><span class='wl-ai-inline-brand'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''>AI</span><b>${esc(s.label)}</b><small>${esc(s.detail)}</small>${s.flags.length?`<div>${s.flags.map(v=>'⚠ '+esc(v)).join('<br>')}</div>`:''}</div>`;}
function ownerTimelineWhen(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function ownerAIJobTimeline(a,prep,solarCheck=null){
  const role=String(a?.assigned_role||''),type=String(a?.work_type||prep?.work_type||'service').toLowerCase(),status=String(a?.status||''),ps=String(prep?.status||'');
  const assignedWho=a?.assignee_name|| (role==='it'?'IT Department':'Service Department');
  const normal=[
    {t:'Owner assigned',who:assignedWho,when:a?.assigned_at},
    {t:'IT Tech Check',who:role==='it'?assignedWho:(prep?.released_by_name||'IT Tech'),when:a?.started_at||a?.updated_at},
    {t:'IT handoff',who:prep?.released_by_name||'IT Tech',when:prep?.released_at},
    {t:'Service verify',who:role==='service'?assignedWho:(prep?.closed_by_name||'Service Tech'),when:solarCheck?.updated_at||a?.updated_at},
    {t:'Deployed',who:prep?.closed_by_name||'Service Tech',when:prep?.closed_at||a?.completed_at}
  ];
  const pickup=[
    {t:'Owner assigned',who:assignedWho,when:a?.assigned_at},
    {t:'Service pickup',who:role==='service'?assignedWho:'Service Tech',when:role==='service'?(a?.started_at||a?.updated_at):null},
    {t:'Returned to shop',who:'Service Tech',when:role==='it'?a?.assigned_at:null},
    {t:'IT Intake',who:role==='it'?assignedWho:'IT Tech',when:role==='it'?(a?.started_at||a?.updated_at):null},
    {t:'Complete',who:a?.completed_by_name||assignedWho,when:a?.completed_at}
  ];
  const steps=type==='pickup'?pickup:normal;let idx=0;
  if(status==='started')idx=Math.max(idx,1);
  if(type==='pickup'){if(role==='it')idx=Math.max(idx,3);if(status==='completed')idx=4;}
  else{if(ps==='draft')idx=Math.max(idx,1);if(ps==='released')idx=Math.max(idx,role==='service'?3:2);if(solarCheck?.completed_at)idx=Math.max(idx,3);if(ps==='closed'||status==='completed')idx=4;}
  const ai=ownerLiveAIStatus(a,prep,solarCheck);
  return `<details class='wl-ai-timeline'><summary><span class='wl-ai-inline-brand'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''>AI Job Timeline</span> <span class='pill'>${esc(steps[idx]?.t||'Current')}</span></summary><div class='wl-ai-timeline-track'>${steps.map((s,i)=>{const when=ownerTimelineWhen(s.when);return `<div class='wl-ai-time-step ${i<idx?'done':i===idx?'current':'future'}'><i></i><div><b>${i<idx?'✓ ':i===idx?'→ ':''}${esc(s.t)}</b><span>${esc(s.who||'')}${when?' · '+esc(when):''}</span>${i===idx?`<span class='wl-ai-current-detail'>${esc(ai.detail||'Current workflow position')}</span>`:''}</div></div>`}).join('')}</div>${ai.state==='attention'?`<div class='wl-ai-warn'><b>AI detected an issue at the current stage:</b><br>${ai.flags.map(v=>'⚠ '+esc(v)).join('<br>')}</div>`:''}</details>`;
}
function ownerAIMorningReadinessHtml(states){
  const rows=Array.isArray(states)?states:[];
  if(!rows.length)return "<div class='wl-ai-good'><b>Tomorrow readiness:</b> No Tech Check jobs assigned.</div>";
  const attention=rows.filter(x=>x?.s?.state==='attention');
  if(!attention.length)return "<div class='wl-ai-good'><b>Tomorrow readiness:</b> ✓ All assigned jobs are currently on track.</div>";
  return "<div class='wl-ai-warn'><b>Tomorrow readiness:</b> "+attention.length+" job"+(attention.length===1?'':'s')+" need review before work starts.<br>"+attention.slice(0,6).map(x=>'#'+esc(x?.a?.ticket_no||'—')+' — '+esc(x?.s?.detail||'Needs review')).join('<br>')+"</div>";
}
function ownerAIAlertFingerprint(flag){
  const value=String(flag||'').trim();
  const low=value.toLowerCase();
  if(/^assigned .+ ago and has not been started\.$/i.test(value))return 'assigned_not_started';
  if(/^it tech check has been open about /i.test(value))return 'it_tech_check_stalled';
  if(/^it handoff has been waiting for service about /i.test(value))return 'it_handoff_waiting_service';
  if(low==='missing mhelpdesk reference.')return 'missing_mhelpdesk_reference';
  if(low==='customer / site is missing.')return 'missing_customer_site';
  if(low==='work description is missing.')return 'missing_work_description';
  if(low==='pickup is waiting on service field return before it intake.')return 'pickup_waiting_service_return';
  return low
    .replace(/\b\d+d(?:\s+\d+h)?\b/g,'<elapsed>')
    .replace(/\b\d+h(?:\s+\d+m)?\b/g,'<elapsed>')
    .replace(/\b\d+m\b/g,'<elapsed>');
}
function ownerAINotificationKey(a,status){
  const id=String(a?.id||a?.ticket_no||'unknown');
  const fingerprints=(status?.flags||[]).map(ownerAIAlertFingerprint).filter(Boolean).sort();
  const detail=[status?.label||'',...fingerprints].join('|').trim();
  return id+'::'+detail;
}
function ownerAIIsAcknowledged(a,status){
  const id=String(a?.id||a?.ticket_no||'');
  const key=ownerAINotificationKey(a,status);
  return ownerAIAckRows.some(r=>String(r.assignment_id)===id&&r.alert_key===key&&!r.resolved_at&&r.acknowledged_by&&r.acknowledged_at);
}
async function ownerAISyncDetectedAlerts(aiStates){
  const now=new Date().toISOString();
  const active=(aiStates||[]).filter(x=>x?.s?.state==='attention');
  for(const x of active){
    const assignmentId=String(x?.a?.id||x?.a?.ticket_no||'');
    const alertKey=ownerAINotificationKey(x.a,x.s);
    const existing=ownerAIAckRows.find(r=>String(r.assignment_id)===assignmentId&&r.alert_key===alertKey&&!r.resolved_at);
    if(existing){
      existing.last_seen_at=now;
      const {error}=await liveDb.from('owner_ai_alert_acknowledgements').update({last_seen_at:now,alert_detail:String(x.s.detail||'Vision detected a workflow issue.'),ticket_no:String(x?.a?.ticket_no||'')}).eq('id',existing.id).is('resolved_at',null);
      if(error)console.warn('Could not refresh Owner AI alert',error);
      continue;
    }
    const row={
      assignment_id:assignmentId,
      alert_key:alertKey,
      ticket_no:String(x?.a?.ticket_no||''),
      alert_detail:String(x.s.detail||'Vision detected a workflow issue.'),
      acknowledged_by:null,
      acknowledged_by_name:null,
      acknowledged_at:null,
      detected_at:now,
      last_seen_at:now
    };
    const {data,error}=await liveDb.from('owner_ai_alert_acknowledgements').insert(row).select('*').single();
    if(error){
      if(String(error.code||'')!=='23505')console.warn('Could not record Owner AI alert',error);
      continue;
    }
    ownerAIAckRows.unshift(data);
  }
}
async function ownerAISyncResolutions(aiStates){
  const activeKeys=new Set((aiStates||[]).filter(x=>x?.s?.state==='attention').map(x=>ownerAINotificationKey(x.a,x.s)));
  const unresolved=ownerAIAckRows.filter(r=>!r.resolved_at&&!activeKeys.has(r.alert_key));
  if(!unresolved.length)return;
  const now=new Date().toISOString();
  for(const row of unresolved){
    const {error}=await liveDb.from('owner_ai_alert_acknowledgements').update({resolved_at:now,last_seen_at:now,resolution_note:'Workflow condition cleared in live Tech Check data.'}).eq('id',row.id).is('resolved_at',null);
    if(error)console.warn('Could not resolve Owner AI alert',error);
    else {row.resolved_at=now;row.last_seen_at=now;row.resolution_note='Workflow condition cleared in live Tech Check data.';}
  }
}
async function ownerAIAcknowledge(assignmentId,alertKey,detail,ticketNo){
  try{
    const identity=await currentTechIdentity(),now=new Date().toISOString();
    const existing=ownerAIAckRows.find(r=>String(r.assignment_id)===String(assignmentId)&&r.alert_key===alertKey&&!r.resolved_at);
    if(existing?.acknowledged_by&&existing?.acknowledged_at)return;
    if(existing){
      const {data,error}=await liveDb.from('owner_ai_alert_acknowledgements').update({
        acknowledged_by:identity.id,
        acknowledged_by_name:identity.name,
        acknowledged_at:now,
        last_seen_at:now
      }).eq('id',existing.id).is('resolved_at',null).select('*').single();
      if(error)throw error;
      Object.assign(existing,data||{acknowledged_by:identity.id,acknowledged_by_name:identity.name,acknowledged_at:now,last_seen_at:now});
    }else{
      const row={assignment_id:String(assignmentId||''),alert_key:String(alertKey||''),ticket_no:String(ticketNo||''),alert_detail:String(detail||'AI Attention alert'),acknowledged_by:identity.id,acknowledged_by_name:identity.name,acknowledged_at:now,detected_at:now,last_seen_at:now};
      const {data,error}=await liveDb.from('owner_ai_alert_acknowledgements').insert(row).select('*').single();
      if(error)throw error;
      ownerAIAckRows.unshift(data);
    }
    scheduleOwnerRefresh(true,0);
  }catch(error){alert(error?.message||'Could not acknowledge this AI alert.');}
}
function ownerAIAlertHistoryHtml(a,prep,solarCheck=null){
  const id=String(a?.id||a?.ticket_no||''), current=ownerLiveAIStatus(a,prep,solarCheck), rows=ownerAIAckRows.filter(r=>String(r.assignment_id)===id);
  if(!rows.length&&current.state!=='attention')return '';
  const items=rows.map(r=>{
    const active=current.state==='attention'&&ownerAINotificationKey(a,current)===r.alert_key&&!r.resolved_at;
    const acknowledged=Boolean(r.acknowledged_by&&r.acknowledged_at);
    const stateLabel=active?(acknowledged?'🟠 ACTIVE · ACKNOWLEDGED':'🔴 ACTIVE · NOT ACKNOWLEDGED'):'✓ RESOLVED';
    return `<div class='wl-ai-history-row ${active?'active':''}'><div><b>${stateLabel}</b><span>${esc(r.alert_detail||'AI Attention alert')}</span></div><div class='small'><b>Detected:</b> ${esc(ownerTimelineWhen(r.detected_at||r.acknowledged_at)||'Time not recorded')}</div>${acknowledged?`<div class='small'>Acknowledged by <b>${esc(r.acknowledged_by_name||'Owner/Admin')}</b> · ${esc(ownerTimelineWhen(r.acknowledged_at))}</div>`:''}${r.resolved_at?`<div class='small'><b>Resolved:</b> ${esc(ownerTimelineWhen(r.resolved_at))}${r.resolution_note?' · '+esc(r.resolution_note):''}</div>`:''}</div>`;
  }).join('');
  const hasCurrentRow=rows.some(r=>!r.resolved_at&&current.state==='attention'&&r.alert_key===ownerAINotificationKey(a,current));
  const virtual=current.state==='attention'&&!hasCurrentRow?`<div class='wl-ai-history-row active'><div><b>🔴 ACTIVE · DETECTION PENDING SAVE</b><span>${esc(current.detail)}</span></div></div>`:'';
  return `<details class='wl-ai-alert-history'><summary>🔔 AI Alert History <span class='pill'>${rows.length+(virtual?1:0)}</span></summary><div>${virtual}${items||"<div class='small'>No alert history yet.</div>"}</div></details>`;
}
async function ownerOpenHeliosFinalReview(prepId){
  const prep=await getPrep(prepId),check=await loadServiceSolarCheck(prepId),evidence=await serviceSolarEvidenceRows(prepId),returns=await loadHeliosSwapReturns(prep?.ticket_no),units=heliosFieldItems(prep);
  let host=document.getElementById('ownerHeliosFinalReview');
  if(!host){host=document.createElement('div');host.id='ownerHeliosFinalReview';host.className='card';document.getElementById('view-owner')?.prepend(host);}
  const fields=[
    ['Box mounted','helios_field_box_mounted_ok'],['PV connected','helios_field_pv_connected_ok'],['PTZ secured','helios_field_ptz_secured_ok'],
    ['Switch on PV','helios_field_switch_pv_ok'],['Unit + battery on','helios_field_unit_battery_on_ok'],['IT verified online','helios_field_it_online_verified_ok'],
    ['Cameras aimed/focused','helios_field_cameras_aimed_ok'],['Recording verified','helios_field_recording_ok'],['Tower ~20 ft','helios_field_tower_20ft_ok'],
    ['Mast locking bolt','helios_field_mast_lock_bolt_ok'],['Panel ~45°','helios_field_panel_45deg_ok'],['Panel bolt secured','helios_field_panel_bolt_ok'],['4 sandbags','helios_field_4_sandbags_ok']
  ];
  const install=evidence.filter(r=>r.category==='helios_install'),sig=[...install].reverse().find(r=>r.kind==='signature');
  host.innerHTML=`<button class='wl-back' data-wl-owner-helios-close>← Back to Owner Dashboard</button>${progress('Owner Final Verification','Helios field installation review',1,1)}
    <div class='wl-review'><b>MHelpDesk #${esc(prep?.ticket_no||'')}</b>${prep?.site?`<div>${esc(prep.site)}</div>`:''}</div>
    <div class='ok top10'><b>NEW UNIT OUT</b>${units.map(u=>`<div class='small'>${esc(u.unit_tag||'Tag missing')} · ${esc(u.purpose)}</div>`).join('')}</div>
    ${units.some(u=>u.purpose==='SWAP')?`<div class='wl-stop top10'><b>OLD UNIT RETURNING</b>${returns.map(r=>`<div class='small'><b>${esc(r.unit_tag)}</b> · ${esc(r.status||'')}<br>${esc(r.return_notes||'')}${r.tag_scan_status?`<br>Tag scan: ${esc(String(r.tag_scan_status).toUpperCase())}`:''}</div>`).join('')||'<div class="small">No Helios Service Return found yet.</div>'}</div>`:''}
    <div class='wl-review top10'><b>Field checklist</b>${fields.map(([label,key])=>`<div class='small'>${check?.[key]?'✓':'✕'} ${esc(label)}</div>`).join('')}</div>
    <div class='wl-review top10'><b>Final installation photos</b>${install.filter(r=>r.kind==='photo').length?`<div class='wl-gallery top8'>${install.filter(r=>r.kind==='photo').map(p=>`<img src='${esc(p.url)}' alt='Helios final installation'>`).join('')}</div>`:'<div class="warn">No final installation photos found.</div>'}${sig?`<div class='ok top8'><b>✓ Service signature</b><div class='small'>${signatureStamp(sig.created_by_name||check?.helios_field_completed_by_name||'Service Tech',sig.created_at||check?.helios_field_completed_at)}</div></div>`:'<div class="warn top8">Service installation signature missing.</div>'}</div>
    <div class='warn top10'><b>Owner final verification</b><div>Confirm only after reviewing the completed field checklist, final photos, Service signature, and OLD UNIT RETURNING documentation for any swap.</div></div>
    <button class='wl-big wl-green top10' data-wl-owner-helios-verify='${esc(prepId)}'>Owner Final Verify Helios →</button>`;
  host.scrollIntoView({behavior:'smooth',block:'start'});
}
async function ownerVerifyHeliosFinal(prepId){
  if(!confirm('Final verify this Helios deployment?\n\nThis closes the Tech Check only after the field checklist, photos, Service signature, and any OLD UNIT RETURNING documentation pass the database checks.'))return;
  const {error}=await liveDb.rpc('owner_verify_helios_install_v1',{p_prep_id:prepId});
  if(error)return alert(error.message);
  document.getElementById('ownerHeliosFinalReview')?.remove();
  await installOwnerAssignments(true);
  if(typeof window.refreshData==='function')await window.refreshData();
  alert('Helios deployment final verified and Tech Check closed.');
}
function ownerAssignmentTechOptions(role='it'){
  const wanted=String(role||'it').toLowerCase();
  const label=wanted==='service'?'Service Department Queue — any Service Tech can claim':'IT Department Queue — any IT Tech can claim';
  return "<option value=''>"+label+"</option>"+ownerAssignmentProfiles
    .filter(p=>String(p.role||'').toLowerCase()===wanted&&p.active!==false&&!p.archived_at)
    .map(p=>"<option value='"+esc(p.user_id)+"'>"+esc(p.full_name||p.username||'Technician')+"</option>").join('');
}
function ownerEquipmentEditorHtml(a){
  const manifest=normalizedEquipmentManifest(a?.equipment_manifest||[]);
  const categories=['device','stand'];
  const sections=categories.map(category=>{
    const current=manifest.filter(r=>r.category===category);
    const defaults=ownerEquipmentTypeList(category);
    const labels=[...new Set([...defaults,...current.map(r=>r.label)].filter(Boolean))];
    const rows=labels.map(label=>{
      const qty=current.find(r=>r.label===label)?.qty||0;
      return `<label class='wl-owner-equipment-qty'><span>${esc(equipmentDisplayLabel(label))}</span><input type='number' inputmode='numeric' min='0' max='999' step='1' value='${qty}' data-owner-live-equipment-qty data-category='${esc(category)}' data-label='${esc(label)}'></label>`;
    }).join('');
    return `<div class='wl-requirement-section ${category==='device'?'unitArea':'standArea'}'><div class='wl-requirement-heading'>${category==='device'?'UNITS / DEVICES':'STANDS / POLES'}</div><div class='wl-owner-equipment-grid top8'>${rows}</div></div>`;
  }).join('');
  return `<div class='wl-owner-live-equipment-editor hidden' data-owner-equipment-editor='${esc(a.ticket_no)}'><div class='wl-review top8'><b>Owner Equipment Override</b><div class='small'>Change the live Tech Check quantities here. Set an item to 0 to remove it. This updates the active IT and Service records for the ticket; MHelpDesk remains separate.</div></div>${sections}<div class='wl-nav top10'><button class='wl-prev' type='button' data-owner-cancel-equipment>Edit Cancel</button><button class='wl-next' type='button' data-owner-save-equipment='${esc(a.ticket_no)}'>Save Equipment Quantities →</button></div></div>`;
}
async function ownerSaveEquipmentQuantities(button){
  const row=button?.closest('.wl-assignment-row');
  const editor=row?.querySelector('[data-owner-equipment-editor]');
  const ticket=String(button?.dataset?.ownerSaveEquipment||editor?.dataset?.ownerEquipmentEditor||'').trim();
  if(!ticket||!editor)return;
  const manifest=[...editor.querySelectorAll('[data-owner-live-equipment-qty]')].map(input=>({
    category:String(input.dataset.category||'other'),
    label:String(input.dataset.label||'').trim(),
    qty:cleanPartQty(input.value)
  })).filter(x=>x.label&&x.qty>0);
  const summary=manifest.map(x=>x.qty+' × '+equipmentDisplayLabel(x.label)).join(', ')||'No equipment';
  if(!confirm('Save these Tech Check equipment quantities for MHelpDesk #'+ticket+'?\n\n'+summary+'\n\nMHelpDesk will not be changed.'))return;
  button.disabled=true;button.textContent='Saving…';
  try{
    const {error}=await liveDb.rpc('owner_update_ticket_equipment_v1',{p_ticket_no:ticket,p_equipment_manifest:manifest});
    if(error)throw error;
    await installOwnerAssignments(true);
    if(typeof window.refreshData==='function')await window.refreshData();
    alert('Equipment quantities updated for MHelpDesk #'+ticket+'.');
  }catch(error){
    button.disabled=false;button.textContent='Save Equipment Quantities →';
    alert(error?.message||'Could not update the equipment quantities.');
  }
}
function ownerAssignmentRowHtml(a, prep, solarCheck=null) {
  const p=ownerAssignmentProgress(a,prep,solarCheck),aiState=ownerLiveAIStatus(a,prep,solarCheck).state,pct=Math.max(8,Math.min(100,p.step/5*100));
  const heliosFinal=prepHasHeliosField(prep)&&prep?.status==='released'&&solarCheck?.helios_field_completed_at&&!solarCheck?.helios_owner_verified_at
    ? `<div class='warn top10'><b>HELIOS FIELD INSTALL SUBMITTED</b><div class='small'>${signatureStamp(solarCheck.helios_field_completed_by_name||'Service Tech',solarCheck.helios_field_completed_at)}</div><button class='mini top8' data-wl-owner-helios-review='${esc(prep.id)}'>Review & Final Verify Helios</button></div>`:'';
  const visionUrl='./onsite-vision.html?ticket='+encodeURIComponent(String(a.ticket_no||''));
  return `<div class='wl-assignment-row' data-owner-ai-state='${aiState}'><div class='wl-assignment-main'><div class='row'><b>MHelpDesk Ref #${esc(a.ticket_no)}</b><span class='pill'>${a.assigned_role==='it'?'IT':'SERVICE'}</span></div><div class='wl-live-stage'><b>${esc(p.label)}</b><span>${esc(p.detail)}</span><div class='wl-live-track'><i style='width:${pct}%'></i></div></div><div class='small'><b>${a.assignee_user_id?'Assigned to:':'Queue:'}</b> ${esc(a.assignee_name)}</div>${a.site?`<div class='small'><b>Customer / Site:</b> ${esc(a.site)}</div>`:''}${a.work_type?`<div class='small'><b>Job Type:</b> ${esc(a.work_type.toUpperCase())}</div>`:''}${a.scheduled_for?`<div class='small'><b>Work Date:</b> ${new Date(a.scheduled_for+'T12:00:00').toLocaleDateString()}</div>`:''}${a.requested_unit_count!=null?`<div class='small'><b>${String(a.work_type||'').toLowerCase()==='pickup'?'Units Being Picked Up':'Units Required'}:</b> ${Number(a.requested_unit_count)}</div>`:''}${a.unit_summary?`<div class='small'><b>Unit / Equipment Notes:</b> ${esc(a.unit_summary)}</div>`:''}${a.job_description?`<div class='small'><b>Work Description:</b> ${esc(a.job_description)}</div>`:''}${ownerLiveAIHtml(a,prep,solarCheck)}${ownerAIJobTimeline(a,prep,solarCheck)}${ownerAIAlertHistoryHtml(a,prep,solarCheck)}${equipmentManifestInlineHtml(a)}${ticketPartsInlineHtml(a)}${automaticServiceSolarPlanHtml(a.equipment_manifest,a.work_type)}${heliosFinal}${a.notes?`<div class='small'><b>Owner Notes:</b> ${esc(a.notes)}</div>`:''}<div class='ownerVisionRowAction'>${a.status==='completed'?'':`<button class='mini' type='button' data-owner-edit-equipment='${esc(a.ticket_no)}'>Edit Equipment / Quantities</button>`}<a class='mini ownerVisionTicketLink' href='${esc(visionUrl)}'>Open in OnSite Vision →</a></div>${a.status==='completed'?'':ownerEquipmentEditorHtml(a)}</div>${a.status==='completed'?'':`<button class='mini danger' data-wl-cancel-assignment='${a.id}'>Cancel</button>`}</div>`;
}

async function installOwnerAssignments(force = false) {
  if (!roleText().includes('Owner/Admin')) return;
  const structuralOwner=Boolean(document.getElementById('ownerApp'));
  let host = document.getElementById('ownerJobAssignments');
  if(host?.querySelector?.('#ownerAssignTicket')) ownerSaveAssignDraftNow();
  if (!host) {
    host = document.createElement('details');
    host.id = 'ownerJobAssignments';
    host.className = 'card ownerDashSection ownerDispatchCard';
    const view = document.getElementById('view-owner');
    view?.prepend(host);
  }

  let liveHost = document.getElementById('ownerLiveJobProgress');
  if(structuralOwner && !liveHost){ liveHost=document.createElement('details'); liveHost.id='ownerLiveJobProgress'; liveHost.className='ownerLegacyLiveMount'; document.getElementById('ownerSupportMounts')?.append(liveHost); }
  let liveNeedsHydration = false;
  if (!liveHost) {
    liveHost = document.createElement('details');
    liveHost.id = 'ownerLiveJobProgress';
    liveHost.className = 'card ownerDashSection ownerLiveJobsCard';
    host.insertAdjacentElement('afterend', liveHost);
    liveNeedsHydration = true;
  }
  if (!liveHost.querySelector('summary')) {
    liveHost.innerHTML = `
      <summary class='ownerDashSummary'>
        <div><b>Live Job Progress</b><span>See what is assigned, who has it, and what is currently being worked</span></div>
        <span class='ownerDashBadge neutral'>0</span>
      </summary>
      <div class='ownerDashBody'><div class='small'>Loading live Tech Check jobs…</div></div>`;
    liveNeedsHydration = true;
  }
  if (host.dataset.loaded === '1' && !force && !liveNeedsHydration) return;

  const wasOpen = host.open;
  const liveWasOpen = liveHost.open;
  host.dataset.loaded = '1';

  const ownerLoadResults = await Promise.all([
    liveDb.from('profiles').select('user_id,full_name,username,role,active,archived_at').eq('active', true).is('archived_at', null).in('role', ['it','service']).order('full_name'),
    liveDb.from('job_assignments').select('*').in('status', ['assigned','started','completed']).order('assigned_at', { ascending: false }).limit(50),
    liveDb.from('prep_tickets').select('id,ticket_no,site,status,work_type,equipment_manifest,released_by_name,released_at,closed_by_name,closed_at,prep_items(equipment_type,purpose,unit_tag)').order('created_at', { ascending:false }).limit(100),
    liveDb.from('asset_inventory').select('unit_tag,asset_type,asset_category,availability_status').neq('availability_status','retired').order('asset_type'),
    liveDb.from('service_solar_checks').select('prep_ticket_id,service_tech_name,completed_at,updated_at,handoff_accepted_at,handoff_accepted_by_name,helios_field_completed_at,helios_field_completed_by_name,helios_owner_verified_at,helios_owner_verified_by_name').order('updated_at',{ascending:false}).limit(100),
    liveDb.from('owner_ai_alert_acknowledgements').select('*').order('acknowledged_at',{ascending:false}).limit(500),
  ]);
  const ownerLoadError = ownerLoadResults.find(result => result?.error)?.error;
  if (ownerLoadError) throw ownerLoadError;
  const [{ data: profiles }, { data: assignments }, { data: preps }, { data: assets }, { data: solarChecks }, { data: aiAcks }] = ownerLoadResults;
  ownerAIAckRows = aiAcks || [];
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
  const aiStates=active.map(a=>({a,s:ownerLiveAIStatus(a,prepMap.get(a.prep_ticket_id),solarCheckMap.get(a.prep_ticket_id))}));
  await ownerAISyncDetectedAlerts(aiStates);
  await ownerAISyncResolutions(aiStates);
  const aiAttention=aiStates.filter(x=>x.s.state==='attention').length, aiWaiting=aiStates.filter(x=>x.s.state==='waiting').length, aiWorking=aiStates.filter(x=>x.s.state==='working').length, aiOnTrack=aiStates.filter(x=>x.s.state==='healthy').length;
  const aiNotices=aiStates.filter(x=>x.s.state==='attention').map(x=>({...x,key:ownerAINotificationKey(x.a,x.s),ack:ownerAIIsAcknowledged(x.a,x.s)})); const aiUnread=aiNotices.filter(x=>!x.ack).length;
  window.dispatchEvent(new CustomEvent('techcheck:owner-ai-alerts',{detail:{alerts:aiNotices.map(x=>({
    assignment_id:String(x.a?.id||x.a?.ticket_no||''),
    ticket_no:String(x.a?.ticket_no||''),
    detail:String(x.s?.detail||'Vision detected a workflow issue.'),
    flags:Array.isArray(x.s?.flags)?x.s.flags.map(String):[],
    key:String(x.key||''),
    acknowledged:Boolean(x.ack)
  }))}}));
  const todayKey=techCheckDateKey(new Date());
  const tomorrowDate=new Date();tomorrowDate.setDate(tomorrowDate.getDate()+1);const tomorrowKey=techCheckDateKey(tomorrowDate);
  const tomorrowJobs=all.filter(a=>String(a.scheduled_for||'')===tomorrowKey&&a.status!=='completed');
  const tomorrowStates=tomorrowJobs.map(a=>({a,s:ownerLiveAIStatus(a,prepMap.get(a.prep_ticket_id),solarCheckMap.get(a.prep_ticket_id))}));

  const completedToday=all.filter(a=>a.status==='completed'&&techCheckDateKey(new Date(a.completed_at||a.updated_at||a.assigned_at))===todayKey);
  const alertsToday=ownerAIAckRows.filter(r=>techCheckDateKey(new Date(r.detected_at||r.acknowledged_at))===todayKey);
  const resolvedToday=ownerAIAckRows.filter(r=>r.resolved_at&&techCheckDateKey(new Date(r.resolved_at))===todayKey);
  const outstandingAlerts=aiStates.filter(x=>x.s.state==='attention');
  // The database closeout summary is the single authority for Owner Review.
  // Do not infer readiness here: open returns, missing evidence, correction work,
  // and unresolved offline-unit escalations can all block closeout.
  const ownerReviewBadgeCount=Number(String(document.getElementById('ownerReviewBadge')?.textContent||'0').match(/\d+/)?.[0]||0);
  const commandCenter=ensureOwnerCommandCenter();
  if(commandCenter){
    commandCenter.dataset.readyReview=String(ownerReviewBadgeCount);
    commandCenter.dataset.activeTechs=String(ownerAssignmentProfiles.length);
    commandCenter.dataset.activeAssets=String(ownerAssignmentAssets.length);
  }
  const unfinishedTechs=active.map(a=>({ticket:a.ticket_no||'—',role:a.assigned_role==='it'?'IT':'Service',name:a.assignee_name||a.assigned_to_name||(a.assignment_scope==='department'?'Department Queue':'Unassigned')}));
  const assignedRows = assignedWaiting.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');
  const progressRows = inProgress.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');
  const doneRows = completed.map(a => ownerAssignmentRowHtml(a, prepMap.get(a.prep_ticket_id), solarCheckMap.get(a.prep_ticket_id))).join('');

  // A live refresh must not replace focused fields or discard in-flight typing.
  const buildAssignmentForm = !host.querySelector('#ownerAssignTicket');
  if (buildAssignmentForm) host.innerHTML = `
    <summary class='ownerDashSummary'>
      <div><b>Create / Assign Job</b><span>Create a new Tech Check assignment from the current MHelpDesk ticket</span></div>
      <span class='ownerDashBadge neutral'>＋</span>
    </summary>
    <div class='ownerDashBody'>
      <div id='ownerAssignDraftStatus' class='owner-assign-draft-note small'>Draft autosaves as you type. You can leave this screen and come back without losing it.</div>

      <div class='owner-assign-command-grid'>
        <section class='owner-simple-step owner-assign-job-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>⌁</span><div><b>Job Type</b><span>Choose the type of job. Tech Check will use your defaults and equipment requirements.</span></div></div>
          <div class='owner-simple-pills'><button type='button' data-owner-work-pill='delivery'>Delivery</button><button type='button' data-owner-work-pill='pickup'>Pickup</button><button type='button' data-owner-work-pill='swap'>Swap</button><button type='button' data-owner-work-pill='service'>Service</button></div>
          <select id='ownerAssignWorkType' class='owner-simple-hidden-select' aria-label='Job type'><option value='delivery'>Delivery</option><option value='pickup'>Pickup</option><option value='swap'>Swap</option><option value='service' selected>Service</option></select>
          <div class='grid'><div><label>MHelpDesk #</label><input id='ownerAssignTicket' inputmode='numeric' placeholder='MHelpDesk ticket number'></div><div><label>Customer / Site</label><input id='ownerAssignSite' placeholder='Customer or site name'></div></div>
          <div class='grid top10'><div><label>What needs to be done?</label><input id='ownerAssignDescription' placeholder='Short job description'></div><div><label>Owner note <span class='small'>(optional)</span></label><input id='ownerAssignNotes' placeholder='Anything important for the tech'></div></div>
          <div id='ownerFlowHint' class='small top8'></div>
        </section>
        <section class='owner-simple-step owner-assign-schedule-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>▣</span><div><b>Schedule</b><span>When should this be done?</span></div></div>
          <div class='grid'><div class='ownerWorkDateField'><label>Work Date</label><input id='ownerAssignDate' type='date' value='${techCheckDateKey(new Date())}'></div><div class='ownerWorkDateField'><label>Work Time <span class='small'>(optional)</span></label><input id='ownerAssignTime' type='time' step='900'></div></div>
        </section>
        <section class='owner-simple-step owner-assign-location-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>●</span><div><b>Location / Units</b><span>Where is the work and what units are involved?</span></div></div>
          <div class='wl-equipment-number-grid'><div><label>Unit #s</label><input id='ownerAssignUnitNumbers' placeholder='e.g. 058, 103, 221'></div><div><label>Stand / Solar Stand / Pole #s</label><input id='ownerAssignStandNumbers' placeholder='e.g. 047, SS-12, SP-4'></div></div>
        </section>
        <section class='owner-simple-step owner-assign-equipment-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>◇</span><div><b>Equipment & Parts</b><span>Enter what's required for this job.</span></div></div>
          <div id='ownerAssignParts' class='wl-ticket-parts-setup'><div class='qtext' id='ownerEquipmentTotalHeading'>Equipment</div><div class='small' id='ownerEquipmentTotalHelp'>Choose the equipment type and quantity from MHelpDesk.</div>${ownerEquipmentManifestInputsHtml()}<div id='ownerAutoServicePlan' class='hidden'></div><div class='wl-requirement-section'><div class='wl-requirement-heading'>Replacement / Swap Categories</div><div class='small'><b>SIM and SD/micro SD cards come from IT.</b> If Service is doing the field work, Tech Check uses IT → Service so Service receives and verifies the cards in the handoff.</div>${ticketPartsInputsHtml('ownerPart')}</div></div>
        </section>
        <section class='owner-simple-step owner-assign-tech-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>♟</span><div><b>Who gets it?</b><span>Assign a technician or department.</span></div></div>
          <div class='owner-simple-pills role-pills'><button type='button' data-owner-role-pill='it'>IT only<small>IT does the work</small></button><button type='button' data-owner-role-pill='service'>Service only<small>Service does the work</small></button><button type='button' data-owner-role-pill='it_service'>IT → Service<small>IT first, then handoff</small></button><button type='button' data-owner-role-pill='service_it'>Service → IT<small>Service first, then IT</small></button></div>
          <select id='ownerAssignRole' class='owner-simple-hidden-select' aria-label='Department flow'><option value='it'>IT Department Only</option><option value='service'>Service Department Only</option><option value='it_service'>IT + Service Departments</option><option value='service_it'>Service + IT Departments</option></select>
          <label>Technician <span class='small'>(optional — leave blank for department queue)</span></label><div id='ownerAssignedTechPills' class='wl-tech-pills'></div><div class='wl-tech-add-row'><select id='ownerAssignTech'>${ownerAssignmentTechOptions('it')}</select><button type='button' class='mini wl-add-tech-plus' data-owner-add-tech aria-label='Add technician'>＋</button></div><div id='ownerAssignTechHint' class='small top8'></div>
        </section>
        <section class='owner-simple-step owner-assign-review-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>✓</span><div><b>Review & Assign</b><span>Check the key items before creating the assignment.</span></div></div><div id='ownerAIReviewBox' class='owner-simple-review pending'></div><button class='btn ownerDispatchButton owner-simple-assign' data-wl-owner-assign>Create Assignment</button>
        </section>
      </div>
    </div>`;

  liveHost.innerHTML = `
    <summary class='ownerDashSummary'>
      <div><b>Live Job Progress</b><span>See what is assigned, who has it, and what is currently being worked</span></div>
      <span id='ownerAssignmentBadge' class='ownerDashBadge ${active.length ? 'alert' : 'neutral'}'>${active.length}</span>
    </summary>
    <div class='ownerDashBody'>
      <section class='wl-owner-unit-lookup'>
        <div class='wl-owner-unit-lookup-head'><div><span class='wl-eyebrow'>EQUIPMENT MEMORY</span><b>Unit Lookup</b><small>Search any numbered unit to see its Tech Check history.</small></div><span class='wl-owner-unit-icon'>⌕</span></div>
        <div class='wl-owner-unit-search'><input id='ownerUnitLookupInput' inputmode='text' autocomplete='off' placeholder='Enter unit #, e.g. 058'><button type='button' data-owner-unit-lookup>Search</button></div>
        <div id='ownerUnitLookupResult'></div>
      </section>
      <section class='wl-owner-ai-control-center'>
        <div class='wl-owner-ai-control-head'>
          <div class='wl-owner-ai-control-title'>
            <span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span>
            <div><span class='wl-owner-ai-kicker'>ONSITE VISION</span><b>Vision Control Center</b><small>Daily workflow health, alerts, and operations</small></div>
          </div>
          <span class='wl-owner-ai-master-status ${aiAttention ? 'attention' : 'healthy'}'>${aiAttention ? aiAttention+' NEEDS REVIEW' : 'ALL CLEAR'}</span>
        </div>
      <details class='wl-owner-ai-daily' open><summary><span>Daily Summary</span><span class='pill'>TODAY</span></summary><div class='wl-owner-ai-daily-body'>
        <div class='wl-owner-ai-day-tabs'><button type='button' class='selected' data-owner-ai-day='today'>Today</button><button type='button' data-owner-ai-day='tomorrow'>Tomorrow <span>${tomorrowJobs.length}</span></button></div>
        <div data-owner-ai-day-panel='today'>
        <div class='wl-owner-ai-daily-counts'><div><b>${completedToday.length}</b><span>Completed</span></div><div><b>${active.length}</b><span>Open</span></div><div><b>${alertsToday.length}</b><span>Acknowledged</span></div><div><b>${resolvedToday.length}</b><span>Resolved</span></div><div class='${outstandingAlerts.length?'attention':''}'><b>${outstandingAlerts.length}</b><span>Outstanding</span></div></div>
        ${unfinishedTechs.length?`<details class='wl-owner-ai-open-jobs'><summary>Unfinished jobs <span class='pill'>${unfinishedTechs.length}</span></summary><div>${unfinishedTechs.map(x=>`<div><b>#${esc(x.ticket)}</b><span>${esc(x.role)} · ${esc(x.name)}</span></div>`).join('')}</div></details>`:`<div class='wl-ai-good'>✓ No unfinished Tech Check jobs.</div>`}
        ${outstandingAlerts.length?`<div class='wl-ai-warn top8'><b>Still needs attention:</b><br>${outstandingAlerts.slice(0,6).map(x=>'#'+esc(x.a.ticket_no||'—')+' — '+esc(x.s.detail)).join('<br>')}</div>`:`<div class='wl-ai-good top8'>✓ No outstanding alerts</div>`}
        </div>
        <div class='hidden' data-owner-ai-day-panel='tomorrow'>
          ${ownerAIMorningReadinessHtml(tomorrowStates)}
          <div class='wl-owner-ai-daily-counts'><div><b>${tomorrowJobs.length}</b><span>Jobs tomorrow</span></div><div class='${tomorrowStates.filter(x=>x.s.state==='attention').length?'attention':''}'><b>${tomorrowStates.filter(x=>x.s.state==='attention').length}</b><span>Need attention</span></div><div><b>${tomorrowJobs.filter(a=>a.assigned_role==='it').length}</b><span>IT assignments</span></div><div><b>${tomorrowJobs.filter(a=>a.assigned_role==='service').length}</b><span>Service assignments</span></div></div>
          ${tomorrowJobs.length?`<div class='wl-owner-ai-tomorrow-list'>${tomorrowStates.map(x=>`<div class='${x.s.state==='attention'?'attention':''}'><div><b>#${esc(x.a.ticket_no||'—')} · ${esc(x.a.site||'No site')}</b><span>${esc(x.a.assigned_role==='it'?'IT':'Service')} · ${esc(x.a.assignee_name||x.a.assigned_to_name||(x.a.assignment_scope==='department'?'Department Queue':'Unassigned'))}</span></div><div><b>${x.s.state==='attention'?'⚠ REVIEW':'✓ READY'}</b><span>${esc(x.s.detail||'No setup conflict detected')}</span></div></div>`).join('')}</div>`:`<div class='wl-ai-good top8'>✓ No Tech Check jobs are assigned for tomorrow.</div>`}
        </div>
      </div></details>
      <details class='wl-owner-ai-notifications ${aiUnread?'has-alerts':''}' ${aiUnread?'open':''}><summary><span>Notifications</span><b id='ownerAINotificationBadge'>${aiUnread}</b></summary><div>${aiNotices.length?aiNotices.map(x=>`<div class='wl-owner-ai-notice ${x.ack?'acknowledged':''}' data-owner-ai-notice-id='${esc(x.a.id||x.a.ticket_no)}'><div><b>MHelpDesk #${esc(x.a.ticket_no||'—')}</b><span>${esc(x.s.detail)}</span></div><button type='button' data-owner-ai-ack='${esc(x.a.id||x.a.ticket_no)}' data-owner-ai-ack-key='${esc(x.key)}' data-owner-ai-ack-detail='${esc(x.s.detail)}' data-owner-ai-ack-ticket='${esc(x.a.ticket_no||'')}'>${x.ack?'Acknowledged':'Acknowledge'}</button></div>`).join(''):`<div class='wl-ai-good'>✓ No AI notifications</div>`}</div></details>
      <div class='wl-owner-ai-overview'><div class='wl-owner-ai-overview-head'><span>Operations</span><b>${aiAttention ? aiAttention+' NEEDS REVIEW' : 'ON TRACK'}</b></div><div class='wl-owner-ai-counts'><button type='button' class='attention' data-owner-ai-filter='attention'><b>${aiAttention}</b><span>Attention</span></button><button type='button' class='waiting' data-owner-ai-filter='waiting'><b>${aiWaiting}</b><span>Waiting</span></button><button type='button' class='working' data-owner-ai-filter='working'><b>${aiWorking}</b><span>Working</span></button><button type='button' class='healthy' data-owner-ai-filter='healthy'><b>${aiOnTrack}</b><span>On track</span></button></div>${aiAttention ? `<div class='wl-ai-warn top8'><b>Review recommended:</b><br>${aiStates.filter(x=>x.s.state==='attention').slice(0,4).map(x=>'#'+esc(x.a.ticket_no||'—')+' — '+esc(x.s.detail)).join('<br>')}</div>` : `<div class='wl-ai-good top8'>✓ All active jobs are on track</div>`}</div>
      </section>
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

  if(buildAssignmentForm) host.open = wasOpen;
  liveHost.open = liveWasOpen || active.length > 0;
  if(buildAssignmentForm && !ownerRestoreAssignDraft()){
    refreshOwnerAutoServicePlan();
    refreshOwnerWorkTypeLabels();
    ownerAIReview();
  } else if(!buildAssignmentForm) {
    refreshOwnerWorkTypeLabels();
    syncOwnerSimplePills();
    ownerAIReview();
  }
  if(host.open)liveHost.open=false;
  organizeOwnerDashboard();
  syncOwnerCompactDashboard();
}
// Unified Owner router calls this when Assign Job is opened before/after deferred module load.
// Expose only the authoritative installer; it hydrates the single persistent #ownerJobAssignments.
window.installOwnerAssignments = installOwnerAssignments;

async function ownerLookupUnitHistory(){
  const input=document.getElementById('ownerUnitLookupInput'),out=document.getElementById('ownerUnitLookupResult');
  const tag=String(input?.value||'').trim();if(!out)return;if(!tag){out.innerHTML="<div class='small'>Enter a unit number to view its Tech Check history.</div>";return;}
  out.innerHTML="<div class='wl-owner-unit-loading'>Searching Tech Check history…</div>";
  const [retQ,itemQ,fieldQ]=await Promise.all([
    liveDb.from('unit_returns').select('unit_tag,equipment_type,ticket_no,status,service_tech_name,returned_at,it_tech_name,it_received_at,completed_at,damage_notes,return_notes,created_at').ilike('unit_tag',tag).order('created_at',{ascending:false}).limit(100),
    liveDb.from('prep_items').select('id,prep_ticket_id,equipment_type,purpose,unit_tag,verified_at,service_verified_at,required_battery_count,battery_count,service_battery_count,power_ok,functions_ok,safe_ok').ilike('unit_tag',tag).order('verified_at',{ascending:false}).limit(100),
    liveDb.from('field_escalations').select('ticket_no,site,unit_tag,equipment_type,status,service_tech_name,service_started_at,original_problem,service_troubleshooting_notes,it_tech_name,it_troubleshooting_notes,backup_unit_tag,owner_resolution,owner_resolved_at,resolved_at,updated_at').ilike('unit_tag',tag).order('updated_at',{ascending:false}).limit(100)
  ]);
  if(retQ.error||itemQ.error||fieldQ.error){out.innerHTML="<div class='wl-ai-warn'>Unable to load unit history right now.</div>";return;}
  const returns=retQ.data||[],items=itemQ.data||[],fieldEscalations=fieldQ.data||[],prepIds=[...new Set(items.map(x=>x.prep_ticket_id).filter(Boolean))];
  let prepMap=new Map();
  if(prepIds.length){
    const {data}=await liveDb.from('prep_tickets').select('id,ticket_no,site,status,work_type,released_at,closed_at,created_at').in('id',prepIds);
    prepMap=new Map((data||[]).map(x=>[x.id,x]));
  }
  if(!returns.length&&!items.length&&!fieldEscalations.length){out.innerHTML=`<div class='wl-owner-unit-empty'><b>No Tech Check history for ${esc(tag)}</b><span>This unit has not been recorded in an IT/Service check, offline escalation, or return/intake yet.</span></div>`;return;}
  const recurring=equipmentRecurringIssueAnalysis(returns);
  const events=[];
  items.forEach(x=>{const p=prepMap.get(x.prep_ticket_id)||{};const base='MHelpDesk #'+(p.ticket_no||'—')+(p.site?' · '+p.site:'');
    if(p.created_at)events.push({when:p.created_at,title:'Tech Check job created',detail:base});
    if(x.verified_at)events.push({when:x.verified_at,title:'IT equipment check verified',detail:base+' · '+(x.equipment_type||'Equipment')});
    if(p.released_at)events.push({when:p.released_at,title:'IT handoff created',detail:base});
    if(x.service_verified_at)events.push({when:x.service_verified_at,title:'Service equipment verification',detail:base});
    if(p.closed_at)events.push({when:p.closed_at,title:'Tech Check workflow closed',detail:base});
  });
  returns.forEach(x=>{
    if(x.returned_at)events.push({when:x.returned_at,title:'Returned from field',detail:'MHelpDesk #'+(x.ticket_no||'—')+(x.service_tech_name?' · Service: '+x.service_tech_name:'')});
    if(x.it_received_at)events.push({when:x.it_received_at,title:'IT Intake received',detail:'MHelpDesk #'+(x.ticket_no||'—')+(x.it_tech_name?' · IT: '+x.it_tech_name:'')});
    if(x.damage_notes||x.return_notes)events.push({when:x.returned_at||x.it_received_at||x.created_at,title:'Issue / return notes',detail:x.damage_notes||x.return_notes,issue:true});
    if(x.completed_at)events.push({when:x.completed_at,title:'IT Intake completed',detail:'MHelpDesk #'+(x.ticket_no||'—')});
  });
  fieldEscalations.forEach(f=>{
    const base='MHelpDesk #'+(f.ticket_no||'—')+(f.site?' · '+f.site:'');
    events.push({
      when:f.service_started_at||f.updated_at,
      title:'Service verified power and called IT',
      detail:base+' · '+(f.original_problem||'Problem not recorded')+(f.service_tech_name?' · Service: '+f.service_tech_name:'')+(f.service_troubleshooting_notes?' · '+f.service_troubleshooting_notes:''),
      issue:true
    });
    if(f.it_troubleshooting_notes||f.status!=='waiting_it'){
      events.push({
        when:f.owner_resolved_at||f.resolved_at||f.updated_at,
        title:'Offline-unit escalation · '+String(f.status||'').replaceAll('_',' ').toUpperCase(),
        detail:base+(f.it_tech_name?' · IT: '+f.it_tech_name:'')+(f.it_troubleshooting_notes?' · '+f.it_troubleshooting_notes:'')+(f.backup_unit_tag?' · Backup '+f.backup_unit_tag:'')+(f.owner_resolution?' · Owner: '+f.owner_resolution:''),
        issue:!f.resolved_at
      });
    }
  });
  events.sort((a,b)=>new Date(b.when||0)-new Date(a.when||0));
  const latest=events[0],types=[...new Set([...items.map(x=>x.equipment_type),...returns.map(x=>x.equipment_type),...fieldEscalations.map(x=>x.equipment_type)].filter(Boolean))];
  out.innerHTML=`<div class='wl-owner-unit-profile'>
    <div class='wl-owner-unit-profile-head'><div><span>UNIT HISTORY</span><h3>${esc(tag)}</h3><p>${types.length?esc(types.join(' · ')):'Equipment type not recorded'}</p></div><div class='wl-owner-unit-score'><b>${returns.length+items.length+fieldEscalations.length}</b><span>records</span></div></div>
    <div class='wl-owner-unit-statrow'><div><b>${items.length}</b><span>IT / Service checks</span></div><div><b>${returns.length}</b><span>Return / intake records</span></div><div class='${fieldEscalations.some(f=>!f.resolved_at)?'attention':''}'><b>${fieldEscalations.length}</b><span>Offline escalations</span></div></div>
    ${latest?`<div class='wl-owner-unit-last'><span>Latest activity</span><b>${esc(latest.title)}</b><small>${esc(ownerTimelineWhen(latest.when))}</small></div>`:''}
    ${recurring.length?`<div class='wl-owner-unit-patterns'><b>✨ AI History Patterns</b>${recurring.map(x=>`<span>⚠ ${esc(x.name)} · ${x.count} prior mentions</span>`).join('')}<small>Advisory only — current equipment checks are still required.</small></div>`:''}
    <details class='wl-owner-unit-timeline' open><summary>Full Tech Check timeline <span class='pill'>${events.length}</span></summary><div>${events.slice(0,40).map(e=>`<div class='wl-owner-unit-event ${e.issue?'issue':''}'><i></i><div><b>${esc(e.title)}</b><span>${e.when?esc(ownerTimelineWhen(e.when)):'Date not recorded'}</span><p>${esc(e.detail||'')}</p></div></div>`).join('')}</div></details>
  </div>`;
}
function ownerApplyAIFilter(state,button){const live=document.getElementById('ownerLiveJobProgress');if(!live)return;const off=button.classList.contains('selected');live.querySelectorAll('[data-owner-ai-filter]').forEach(b=>b.classList.remove('selected'));const target=off?'':state;if(!off)button.classList.add('selected');live.querySelectorAll('.wl-assignment-row[data-owner-ai-state]').forEach(row=>row.classList.toggle('wl-ai-filter-hidden',!!target&&row.dataset.ownerAiState!==target));}
const OWNER_ASSIGN_DRAFT_KEY='cos-techcheck-owner-assign-draft-v1';
let ownerAssignDraftRestoring=false;
function ownerAssignDraftStatus(message){
  const el=document.getElementById('ownerAssignDraftStatus');
  if(el)el.textContent=message;
}
function ownerAssignDraftPayload(){
  const host=document.getElementById('ownerJobAssignments');
  if(!host?.querySelector?.('#ownerAssignTicket'))return null;
  return {
    version:1,
    saved_at:new Date().toISOString(),
    work_type:document.getElementById('ownerAssignWorkType')?.value||'service',
    scheduled_for:document.getElementById('ownerAssignDate')?.value||techCheckDateKey(new Date()),
    scheduled_time:document.getElementById('ownerAssignTime')?.value||'',
    ticket_no:document.getElementById('ownerAssignTicket')?.value||'',
    site:document.getElementById('ownerAssignSite')?.value||'',
    description:document.getElementById('ownerAssignDescription')?.value||'',
    notes:document.getElementById('ownerAssignNotes')?.value||'',
    unit_numbers:document.getElementById('ownerAssignUnitNumbers')?.value||'',
    stand_numbers:document.getElementById('ownerAssignStandNumbers')?.value||'',
    role:document.getElementById('ownerAssignRole')?.value||'it',
    equipment_manifest:readOwnerEquipmentManifest(),
    parts:readTicketPartInputs('ownerPart'),
    assignee_ids:[...document.querySelectorAll('#ownerAssignedTechPills [data-tech-id]')].map(el=>String(el.dataset.techId||'')).filter(Boolean),
    service_queue_selected:!!document.querySelector('#ownerAssignedTechPills [data-queue-role="service"]')
  };
}
function ownerAssignDraftMeaningful(d){
  if(!d)return false;
  const text=[d.ticket_no,d.site,d.description,d.notes,d.unit_numbers,d.stand_numbers,d.scheduled_time].some(v=>String(v||'').trim());
  const equipment=Array.isArray(d.equipment_manifest)&&d.equipment_manifest.some(r=>Number(r?.qty||0)>0);
  const parts=d.parts&&Object.values(d.parts).some(v=>Number(v||0)>0);
  const people=Array.isArray(d.assignee_ids)&&d.assignee_ids.length>0;
  const nonDefault=String(d.work_type||'service')!=='service'||String(d.role||'it')!=='it'||String(d.scheduled_for||'')!==techCheckDateKey(new Date())||d.service_queue_selected===true;
  return text||equipment||parts||people||nonDefault;
}
function ownerSaveAssignDraftNow(){
  if(ownerAssignDraftRestoring)return;
  const d=ownerAssignDraftPayload();
  if(!d)return;
  try{
    if(ownerAssignDraftMeaningful(d)){
      localStorage.setItem(OWNER_ASSIGN_DRAFT_KEY,JSON.stringify(d));
      const when=new Date(d.saved_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      ownerAssignDraftStatus('Draft saved automatically · '+when);
    }else{
      localStorage.removeItem(OWNER_ASSIGN_DRAFT_KEY);
      ownerAssignDraftStatus('Draft autosaves as you type. You can leave this screen and come back without losing it.');
    }
  }catch(error){console.warn('Owner assignment draft save failed',error);}
}
function ownerClearAssignDraft(){
  try{localStorage.removeItem(OWNER_ASSIGN_DRAFT_KEY);}catch{}
}
function ownerLoadAssignDraft(){
  try{
    const raw=localStorage.getItem(OWNER_ASSIGN_DRAFT_KEY);
    if(!raw)return null;
    const d=JSON.parse(raw);
    if(!ownerAssignDraftMeaningful(d))return null;
    return d;
  }catch(error){console.warn('Owner assignment draft load failed',error);return null;}
}
function ownerRestoreAssignDraft(){
  const d=ownerLoadAssignDraft();
  if(!d)return false;
  const host=document.getElementById('ownerJobAssignments');
  if(!host?.querySelector?.('#ownerAssignTicket'))return false;
  ownerAssignDraftRestoring=true;
  try{
    const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value==null?'':String(value);};
    set('ownerAssignWorkType',d.work_type||'service');
    set('ownerAssignDate',d.scheduled_for||techCheckDateKey(new Date()));
    set('ownerAssignTime',d.scheduled_time||'');
    set('ownerAssignTicket',d.ticket_no||'');
    set('ownerAssignSite',d.site||'');
    set('ownerAssignDescription',d.description||'');
    set('ownerAssignNotes',d.notes||'');
    set('ownerAssignUnitNumbers',d.unit_numbers||'');
    set('ownerAssignStandNumbers',d.stand_numbers||'');
    set('ownerAssignRole',d.role||'it');
    refreshOwnerAssignmentTechOptions();

    const manifest=normalizedEquipmentManifest(d.equipment_manifest||[]);
    document.querySelectorAll('#ownerJobAssignments [data-owner-equipment-qty]').forEach(input=>{
      const match=manifest.find(row=>String(row.category||'')===String(input.dataset.category||'')&&String(row.label||'').toLowerCase()===String(input.dataset.label||'').toLowerCase());
      input.value=String(match?.qty||0);
    });
    fillTicketPartInputs(d.parts||{},'ownerPart');

    const pills=document.getElementById('ownerAssignedTechPills');
    if(pills)pills.innerHTML='';
    (d.assignee_ids||[]).forEach(id=>{
      const p=ownerAssignmentProfiles.find(row=>String(row.user_id)===String(id));
      if(!p||!pills)return;
      const label=(p.full_name||p.username||'Technician')+' — '+(p.role==='it'?'IT':'Service');
      const el=document.createElement('span');
      el.className='wl-tech-pill';
      el.dataset.techId=String(id);
      el.innerHTML='<span>'+esc(label)+"</span><button type='button' data-owner-remove-tech aria-label='Remove "+esc(label)+"'>×</button>";
      pills.appendChild(el);
    });
    if(d.service_queue_selected&&pills&&!pills.querySelector('[data-queue-role="service"]')){
      const el=document.createElement('span');
      el.className='wl-tech-pill';
      el.dataset.queueRole='service';
      el.innerHTML="<span>Service Department Queue — any Service Tech can claim</span><button type='button' data-owner-remove-tech aria-label='Remove Service Department Queue'>×</button>";
      pills.appendChild(el);
    }
    refreshOwnerWorkTypeLabels();
    refreshOwnerAutoServicePlan();
    ownerAIReview();
    const when=d.saved_at?new Date(d.saved_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'earlier';
    ownerAssignDraftStatus('Draft restored automatically · last saved '+when);
    return true;
  }finally{
    ownerAssignDraftRestoring=false;
  }
}
function addOwnerTechPill() {
  const select=document.getElementById('ownerAssignTech'); const pills=document.getElementById('ownerAssignedTechPills');
  const id=select?.value || ''; if(!id||!pills) return;
  if(id==='__service_queue__'){ const pill=document.createElement('span'); pill.className='wl-tech-pill'; pill.dataset.queueRole='service'; pill.innerHTML=`<span>Service Department Queue — any Service Tech can claim</span><button type='button' data-owner-remove-tech aria-label='Remove Service Department Queue'>×</button>`; if(!pills.querySelector('[data-queue-role="service"]')) pills.appendChild(pill); select.value=''; ownerSaveAssignDraftNow(); return; }
  if(pills.querySelector(`[data-tech-id="${CSS.escape(id)}"]`)){ select.value=''; return; }
  const label=select.options[select.selectedIndex]?.textContent?.trim() || 'Technician';
  const pill=document.createElement('span'); pill.className='wl-tech-pill'; pill.dataset.techId=id;
  pill.innerHTML=`<span>${esc(label)}</span><button type='button' data-owner-remove-tech aria-label='Remove ${esc(label)}'>×</button>`;
  pills.appendChild(pill); select.value=''; ownerSaveAssignDraftNow(); ownerAIReview();
}
function refreshOwnerAssignmentTechOptions() {
  const role = document.getElementById('ownerAssignRole')?.value || 'it';
  const select = document.getElementById('ownerAssignTech');
  const hint = document.getElementById('ownerAssignTechHint');
  if (!select) return;
  const pills=document.getElementById('ownerAssignedTechPills'); if(pills) pills.innerHTML='';
  if (role === 'it_service' || role === 'service_it') {
    select.innerHTML = `<option value=''>Both Department Queues — IT prepares first, Service follows</option>`;
    select.disabled = false;
    select.innerHTML = `<option value=''>${role === 'service_it' ? 'Service Department Queue — any Service Tech can claim' : 'IT Department Queue — any IT Tech can claim'}</option><option value='__service_queue__'>Service Department Queue — any Service Tech can claim</option>` + ownerAssignmentProfiles.map(p => `<option value='${p.user_id}'>${esc(p.full_name || p.username || 'Technician')} — ${p.role === 'it' ? 'IT' : 'Service'}</option>`).join('');
    if (hint) hint.textContent = role === 'service_it' ? 'Service first → returned units go to IT Intake.' : 'IT first → Service receives the prepared equipment.';
  } else {
    select.disabled = false;
    select.innerHTML = ownerAssignmentTechOptions(role);
    if (hint) hint.textContent = `Select one or more ${role === 'it' ? 'IT' : 'Service'} technicians. Leave all unselected to assign it to the ${role === 'it' ? 'IT' : 'Service'} Department queue.`;
  }
  document.getElementById('ownerAssignParts')?.classList.remove('hidden');
  refreshOwnerWorkTypeLabels();
}
function refreshOwnerWorkTypeLabels() {
  const type = document.getElementById('ownerAssignWorkType')?.value || 'service';
  syncOwnerSimplePills();
  const pickup = type === 'pickup';
  const swap = type === 'swap';
  const delivery = type === 'delivery';
  const action = pickup ? 'Being Picked Up' : swap ? 'Being Swapped' : delivery ? 'Being Delivered' : 'Required';
  const flowHint=document.getElementById('ownerFlowHint');
  if(flowHint) flowHint.innerHTML = pickup ? '<b>Pickup:</b> Service goes to the field first → returned equipment goes to IT Intake.' : swap ? '<b>Swap:</b> choose IT + Service for outgoing replacement prep, or Service + IT when the returned unit needs Service first → IT Intake.' : delivery ? '<b>Delivery:</b> IT prepares equipment first → Service receives the handoff and delivers it.' : '<b>Service:</b> choose the department order needed for this service call.';
  const totalHeading=document.getElementById('ownerEquipmentTotalHeading');
  const totalHelp=document.getElementById('ownerEquipmentTotalHelp');
  if(totalHeading) totalHeading.textContent = type==='pickup' ? 'Total Equipment Being Picked Up' : type==='delivery' ? 'Total Equipment Being Delivered' : type==='swap' ? 'Total Equipment Being Swapped' : 'Total Equipment Required';
  if(totalHelp) totalHelp.textContent='Enter each equipment type and quantity once. Enter the specific MHelpDesk equipment numbers below.';
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

// Classic Owner dashboard restored: keep the original stacked Owner cards.
function ownerBadgeNumber(id){
  const txt=String(document.getElementById(id)?.textContent||'');
  return Number((txt.match(/\d+/)||['0'])[0])||0;
}
function ownerCardBadgeNumber(id){
  const txt=String(document.querySelector('#'+id+' .ownerDashBadge')?.textContent||'');
  return Number((txt.match(/\d+/)||['0'])[0])||0;
}
function syncOwnerCompactDashboard(){
  const card=document.getElementById('ownerCommandCenter');
  if(!card)return;
  const stat=(action,value)=>{
    const btn=card.querySelector('[data-owner-command="'+action+'"]');
    const b=btn?.querySelector('b');
    if(b)b.textContent=String(value??0);
    return btn;
  };
  const attention=ownerBadgeNumber('ownerAttentionBadge');
  const today=ownerBadgeNumber('ownerAssignmentBadge') || ownerBadgeNumber('ownerTechOverviewBadge');
  const review=Number(card.dataset.readyReview||0);
  const activeTechs=Number(card.dataset.activeTechs||0);
  const activeAssets=Number(card.dataset.activeAssets||0);
  stat('today',today);
  stat('attention',attention)?.classList.toggle('alert',attention>0);
  stat('review',review)?.classList.toggle('ready',review>0);
  const team=stat('team',activeTechs);
  const teamSmall=team?.querySelector('small');
  if(teamSmall)teamSmall.textContent=activeTechs+' active techs · '+activeAssets+' active assets';
}
function ownerClassicCardFor(name){
  return ({
    Assign:'ownerJobAssignments',
    Jobs:'ownerLiveJobProgress',
    Attention:'ownerAttentionCard',
    Equipment:'ownerHandoffsCard',
    Returns:'ownerIntakeTracking',
    Units:'ownerUnitStatusCard',
    Team:'ownerAccountsCard',
    Activity:'ownerActivityCard',
    More:'ownerResetCard'
  })[name] || null;
}
function ownerShowHome(){
  organizeOwnerDashboard();
  window.scrollTo({top:0,left:0,behavior:'auto'});
}
function ownerShowGroup(name){
  organizeOwnerDashboard();
  const id=ownerClassicCardFor(name);
  const card=id?document.getElementById(id):null;
  if(card){
    if(card.tagName==='DETAILS') card.open=true;
    requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  return card;
}
function ownerCompactOpenGroup(name){ return ownerShowGroup(name); }
function ownerFeaturePageHtml(){ return ''; }
function ensureOwnerCommandCenter(){
  const view=document.getElementById('view-owner');
  if(!view)return null;
  let card=document.getElementById('ownerCommandCenter');
  if(!card){
    card=document.createElement('section');
    card.id='ownerCommandCenter';
    card.className='ownerCommandCenter';
    card.innerHTML=`<div class="ownerCommandHero"><div><span class="ownerCommandKicker">OWNER COMMAND CENTER</span><h2>Today at Cameras On Site</h2><p>Start with what needs you, then move into live work, people, and equipment.</p></div><a class="ownerCommandVision" href="./onsite-vision.html"><img src="./techcheck-eye-favicon-32.png?v=1" alt=""><span><b>OnSite Vision</b><small>Ask, search, and review operations</small></span><strong>Open →</strong></a></div><div id="ownerCommandStats" class="ownerCommandStats" aria-live="polite"><button type="button" data-owner-command="today"><span>Today</span><b>—</b><small>open Tech Check jobs</small></button><button type="button" data-owner-command="attention"><span>Needs Attention</span><b>—</b><small>owner actions & issues</small></button><button type="button" data-owner-command="review"><span>Ready for My Review</span><b>—</b><small>completed work awaiting Owner review</small></button><button type="button" data-owner-command="team"><span>Team & Equipment</span><b>—</b><small>loading live readiness…</small></button></div><div class="ownerCommandQuick"><button type="button" data-owner-command="assign">+ Assign Job to Tech</button><button type="button" data-owner-command="units">Search Units</button><button type="button" data-owner-command="handoffs">Equipment Handoffs</button><button type="button" data-owner-command="activity">Recent Activity</button></div>`;
    view.prepend(card);
  }
  if(!card.dataset.commandBound){
    card.dataset.commandBound='1';
    card.addEventListener('click',event=>{
      const btn=event.target.closest('[data-owner-command]');
      if(!btn)return;
      const action=btn.dataset.ownerCommand;
      if(action==='today') return ownerShowGroup('Jobs');
      if(action==='attention') return ownerShowGroup('Attention');
      if(action==='review') return ownerShowGroup('Returns');
      if(action==='team') return ownerShowGroup('Team');
      if(action==='assign') return ownerShowGroup('Assign');
      if(action==='units') return ownerShowGroup('Units');
      if(action==='handoffs') return ownerShowGroup('Equipment');
      if(action==='activity') return ownerShowGroup('Activity');
    });
  }
  const stat=(action,value)=>{
    const btn=card.querySelector('[data-owner-command="'+action+'"]');
    const b=btn?.querySelector('b');
    if(b)b.textContent=String(value??0);
    return btn;
  };
  syncOwnerCompactDashboard();
  return card;
}

function organizeOwnerDashboard(){
  const view=document.getElementById('view-owner');
  if(!view || !roleText().includes('Owner/Admin')) return;
  const structuralOwner=document.getElementById('ownerApp');
  const support=document.getElementById('ownerSupportMounts');
  if(structuralOwner && support){
    document.getElementById('ownerVisionWorkspaceCard')?.remove();
    document.getElementById('ownerCommandCenter')?.remove();
    document.getElementById('ownerVisionHeaderButton')?.remove();
    document.getElementById('ownerCompactShell')?.remove();
    view.querySelectorAll('.ownerFeaturePage,.ownerHomeMain').forEach(el=>el.remove());
    const supportIds=['ownerTechOverviewCard','ownerAttentionCard','ownerLiveJobProgress','ownerIntakeTracking','ownerFieldEscalations','ownerUnitStatusCard','ownerHandoffsCard','ownerActivityCard','ownerAccountsCard','ownerResetCard'];
    supportIds.forEach(id=>{const card=document.getElementById(id);if(card&&card.parentElement!==support)support.append(card);});
    const assign=document.getElementById('ownerJobAssignments');
    const persistent=document.getElementById('ownerPersistentControls');
    if(assign&&persistent&&assign.parentElement!==persistent)persistent.prepend(assign);
    return;
  }

  document.getElementById('ownerVisionWorkspaceCard')?.remove();
  ensureOwnerCommandCenter();
  let visionButton=document.getElementById('ownerVisionHeaderButton');
  if(!visionButton){
    visionButton=document.createElement('a');visionButton.id='ownerVisionHeaderButton';visionButton.className='mini ownerVisionHeaderButton';
    visionButton.href='./onsite-vision.html';visionButton.innerHTML="<img src='./techcheck-eye-favicon-32.png?v=1' alt=''><span>OnSite Vision</span>";
  }
  const accountActions=document.querySelector('.accountActions');
  if(accountActions&&visionButton.parentElement!==accountActions){
    const refresh=[...accountActions.querySelectorAll('button')].find(btn=>String(btn.textContent||'').trim()==='Refresh');
    accountActions.insertBefore(visionButton,refresh||accountActions.firstChild);
  }
  const order=['ownerCommandCenter','ownerTechOverviewCard','ownerAttentionCard','ownerJobAssignments','ownerLiveJobProgress','ownerIntakeTracking','ownerUnitStatusCard','ownerHandoffsCard','ownerActivityCard','ownerAccountsCard','ownerResetCard'];
  const shell=document.getElementById('ownerCompactShell');
  if(shell){order.forEach(id=>{const card=document.getElementById(id);if(card&&card.parentElement!==view){card.classList.remove('ownerCompactSecondary','ownerCompactAssignForm','ownerCompactAttentionDetail','ownerCompactLivePrimary');view.appendChild(card);}});shell.remove();}
  view.querySelectorAll('.ownerFeaturePage,.ownerHomeMain').forEach(el=>el.remove());
  order.forEach(id=>{const card=document.getElementById(id);if(!card)return;card.classList.remove('ownerCompactSecondary','ownerCompactAssignForm','ownerCompactAttentionDetail','ownerCompactLivePrimary');if(card.parentElement!==view)view.appendChild(card);if(!card.dataset.ownerClassicInitialized)card.dataset.ownerClassicInitialized='1';});
}
let ownerAIDispatchPrepared = false;
let ownerAIDispatchLastParse = null;
let ownerAIDispatchRecognition = null;
let ownerAIAssistantLastJobs = [];
let ownerAIConversationTurns = [];
let ownerAIActiveResponseBox = null;

function ownerAIConversationMarkup() {
  if(!ownerAIConversationTurns.length){
    return "<div class='wl-ai-chat-empty'><b>Start a conversation with OnSite Vision</b><span>Ask a question, look up a job, change something you just discussed, or tell Vision to prepare a new Tech Check.</span></div>";
  }
  return ownerAIConversationTurns.map(turn=>{
    if(turn.role==='user') return "<div class='wl-ai-chat-turn user'><div class='wl-ai-chat-label'>YOU</div><div class='wl-ai-chat-bubble'>"+esc(turn.text||'')+"</div></div>";
    return "<div class='wl-ai-chat-turn assistant'><div class='wl-ai-chat-label'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''> ONSITE VISION</div><div class='wl-ai-chat-bubble'>"+String(turn.html||'')+"</div></div>";
  }).join('');
}
function ownerAIConversationScroll() {
  const host=document.getElementById('ownerAIConversation');
  if(!host)return;
  requestAnimationFrame(()=>{host.scrollTop=host.scrollHeight;});
}
function ownerAIConversationAppendUser(text) {
  const host=document.getElementById('ownerAIConversation');
  if(!host)return;
  host.querySelector('.wl-ai-chat-empty')?.remove();
  ownerAIConversationTurns.push({role:'user',text:String(text||'')});
  const turn=document.createElement('div');
  turn.className='wl-ai-chat-turn user';
  turn.innerHTML="<div class='wl-ai-chat-label'>YOU</div><div class='wl-ai-chat-bubble'>"+esc(text)+"</div>";
  host.append(turn);
  ownerAIConversationScroll();
}
function ownerAIConversationBeginAssistant() {
  const host=document.getElementById('ownerAIConversation');
  if(!host)return null;
  host.querySelector('.wl-ai-chat-empty')?.remove();
  const turn=document.createElement('div');
  turn.className='wl-ai-chat-turn assistant';
  turn.innerHTML="<div class='wl-ai-chat-label'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''> ONSITE VISION</div><div class='wl-ai-chat-bubble'><div class='wl-ai-assistant-working'><span class='wl-ai-scan-spinner'></span><div><b>Thinking through Tech Check…</b><span>Looking at the conversation and current records.</span></div></div></div>";
  host.append(turn);
  ownerAIConversationScroll();
  return turn.querySelector('.wl-ai-chat-bubble');
}
function ownerAIConversationFinishAssistant(box) {
  if(!box)return;
  ownerAIConversationTurns.push({role:'assistant',html:box.innerHTML});
  ownerAIConversationScroll();
}
function ownerAIResponseBox() {
  return ownerAIActiveResponseBox || document.getElementById('ownerAIDispatchResult');
}
function ownerAIConversationClear() {
  ownerAIConversationTurns=[];
  ownerAIAssistantLastJobs=[];
  ownerAIDispatchPrepared=false;
  ownerAIDispatchLastParse=null;
  ownerAIActiveResponseBox=null;
  const host=document.getElementById('ownerAIConversation');
  if(host) host.innerHTML=ownerAIConversationMarkup();
  const input=document.getElementById('ownerAIDispatchPrompt');
  if(input) input.value='';
}
function ownerAIShouldApplyDraftCorrection(raw) {
  if(!ownerAIDispatchPrepared)return false;
  const parsed=ownerAIParseDispatch(raw);
  const explicitDraft=/\b(draft|new\s+(?:ticket|job)|this\s+(?:draft|ticket|job)|that\s+(?:draft|ticket|job))\b/i.test(raw);
  const discussingExisting=ownerAIAssistantLastJobs.length>0;
  const directExisting=Boolean(parsed.ticket_no||parsed.unit_hint);
  if(!explicitDraft && (directExisting||discussingExisting)) return false;
  return true;
}
function ownerAIConversationDraftCorrection(raw) {
  if(!ownerAIDispatchPrepared)return null;
  const lower=String(raw||'').toLowerCase();
  const correction=/\b(i meant|actually|instead|change|correct|should be|make that|not\b.+\bbut)\b/i.test(raw);
  if(!correction)return null;
  const parsed=ownerAIParseDispatch(raw), changes=[];
  if(parsed.work_type){
    const el=document.getElementById('ownerAssignWorkType');
    if(el && el.value!==parsed.work_type){el.value=parsed.work_type;el.dataset.aiSet='1';changes.push('job type → '+parsed.work_type.toUpperCase());}
  }
  if(parsed.scheduled_for){
    const el=document.getElementById('ownerAssignDate');
    if(el && el.value!==parsed.scheduled_for){el.value=parsed.scheduled_for;el.dataset.aiSet='1';changes.push('date → '+ownerAIScheduleText(parsed.scheduled_for,''));}
  }
  if(parsed.scheduled_time){
    const el=document.getElementById('ownerAssignTime');
    if(el && el.value!==parsed.scheduled_time){el.value=parsed.scheduled_time;el.dataset.aiSet='1';changes.push('time → '+ownerAIScheduleText('',parsed.scheduled_time));}
  }
  const desc=String(raw||'').match(/\b(?:description|job description)\s*(?:to|is|should be|should say|say)\s*[:=-]?\s*(.+)$/i);
  if(desc){
    const el=document.getElementById('ownerAssignDescription'), value=String(desc[1]||'').trim();
    if(el&&value){el.value=value;changes.push('description updated');}
  }
  const notes=String(raw||'').match(/\bnotes?\s*(?:to|is|should be|should say|say)\s*[:=-]?\s*(.+)$/i);
  if(notes){
    const el=document.getElementById('ownerAssignNotes'), value=String(notes[1]||'').trim();
    if(el&&value){el.value=value;changes.push('notes updated');}
  }
  if(!changes.length)return null;
  refreshOwnerWorkTypeLabels();
  refreshOwnerAutoServicePlan();
  ownerAIDispatchLastParse={...(ownerAIDispatchLastParse||{}),...parsed};
  return changes;
}
function ownerAIEscapeRegExp(v) {
  return String(v || "").replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
function ownerAINumberWords(text) {
  const map = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  return String(text || "").replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, m => String(map[m.toLowerCase()] || m));
}
function ownerAIQtyNearAlias(text, aliases) {
  const source = ownerAINumberWords(text).toLowerCase();
  let mentioned = false;
  for (const alias of aliases) {
    const a = ownerAIEscapeRegExp(alias.toLowerCase());
    if (source.includes(alias.toLowerCase())) mentioned = true;
    const before = source.match(new RegExp("\\b(\\d+)\\s*(?:x\\s*)?" + a + "\\b", "i"));
    if (before) return { mentioned:true, qty:Math.max(0, Number(before[1] || 0)) };
    const after = source.match(new RegExp("\\b" + a + "\\s*(?:x|qty|quantity|count|=|:)?\\s*(\\d+)\\b", "i"));
    if (after) return { mentioned:true, qty:Math.max(0, Number(after[1] || 0)) };
  }
  return { mentioned, qty:null };
}
function ownerAIDateFromText(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const base = new Date();
  const key = d => techCheckDateKey(d);
  if (/\btomorrow\b/.test(lower)) { const d=new Date(base); d.setDate(d.getDate()+1); return key(d); }
  if (/\btoday\b/.test(lower)) return key(base);
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const us = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) {
    const d=new Date(Number(us[3]),Number(us[1])-1,Number(us[2]));
    if (!Number.isNaN(d.getTime())) return key(d);
  }
  const days={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
  const dm=lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dm) {
    const d=new Date(base), target=days[dm[1]], diff=(target-d.getDay()+7)%7 || 7;
    d.setDate(d.getDate()+diff);
    return key(d);
  }
  return "";
}
function ownerAITimeFromText(text) {
  const raw=String(text||'');
  let m=raw.match(/\b(?:at|for)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if(!m) m=raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if(!m) m=raw.match(/\b(?:at|for|to)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if(!m) return '';
  let h=Number(m[1]||0), min=Number(m[2]||0);
  const mer=String(m[3]||'').toLowerCase().replace(/\./g,'');
  if(mer==='pm' && h<12) h+=12;
  if(mer==='am' && h===12) h=0;
  if(h<0||h>23||min<0||min>59) return '';
  return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
}
function ownerAINormalizeUnitTag(v) {
  const s=String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(/^\d+$/.test(s)) return String(Number(s));
  return s.replace(/^0+(?=\d)/,'');
}
function ownerAIUnitReference(text) {
  const raw=ownerAINumberWords(text);
  const defs=[
    {type:'Helios',re:/\bhelio(?:s)?\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i},
    {type:'Ranger',re:/\branger\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i},
    {type:'Solar Spotter',re:/\bsolar\s+spotter\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i},
    {type:'Spotter',re:/\bspotter\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i},
    {type:'Sniper',re:/\bsniper\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i},
    {type:'Recon 2',re:/\brecon\s*(?:2|ii|two)?\s*(?:unit\s*)?(?:#|number|no\.?)?\s*(\d{1,4})\b/i}
  ];
  for(const d of defs){
    const m=raw.match(d.re);
    if(m) return {type:d.type,tag:String(m[1]).padStart(d.type==='Helios'?3:1,'0')};
  }
  const generic=raw.match(/\bunit\s*(?:#|number|no\.?)?\s*(\d{1,4})\b/i);
  return generic ? {type:'',tag:String(generic[1])} : null;
}
function ownerAIEffectiveWorkType(a,prep) {
  const purpose=(prep?.prep_items||[]).map(x=>String(x?.purpose||'').toUpperCase()).find(v=>v==='DELIVERY'||v==='SWAP');
  return purpose ? purpose.toLowerCase() : String(a?.work_type||prep?.work_type||'service').toLowerCase();
}
function ownerAIUnitMatches(a,prep,hint) {
  if(!hint?.tag) return true;
  const want=ownerAINormalizeUnitTag(hint.tag);
  const rows=prep?.prep_items||[];
  if(rows.some(x=>(!hint.type||String(x?.equipment_type||'').toLowerCase()===String(hint.type).toLowerCase()) && ownerAINormalizeUnitTag(x?.unit_tag)===want)) return true;
  const summary=String(a?.unit_summary||'');
  return summary && ownerAINormalizeUnitTag(summary).includes(want);
}
function ownerAIScheduleText(date,time) {
  if(!date) return time ? time : 'No date set';
  let label=String(date);
  const d=new Date(String(date)+'T12:00:00');
  if(!Number.isNaN(d.getTime())) label=d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'});
  if(time){
    const parts=String(time).split(':').map(Number);
    const t=new Date(2000,0,1,parts[0]||0,parts[1]||0);
    label+=' · '+t.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  }
  return label;
}
function ownerAIParseEquipment(text) {
  const rows = [
    {category:"device",label:"Solar Spotter",aliases:["solar spotter","solar spotters"]},
    {category:"device",label:"Recon 2",aliases:["recon 2","recon ii","recon two","recon 2s"]},
    {category:"device",label:"Helios",aliases:["helios","helio"]},
    {category:"device",label:"Ranger",aliases:["ranger","rangers"]},
    {category:"device",label:"Sniper",aliases:["sniper","snipers"]},
    {category:"device",label:"Spotter",aliases:["spotter","spotters"]},
    {category:"stand",label:"Solar Stand",aliases:["solar stand","solar stands"]},
    {category:"stand",label:"110V Stand",aliases:["110v stand","110 v stand","110-volt stand","110 volt stand"]},
    {category:"stand",label:"Pole",aliases:["pole","poles"]}
  ];
  const source = String(text || "").toLowerCase();
  const manifest = [], mentionedWithoutQty = [];
  for (const row of rows) {
    let scan = source;
    if (row.label === "Spotter") scan = scan.replace(/solar spotters?/g, "");
    if (row.label === "Pole") scan = scan.replace(/solar\s+poles?/g, "");
    const found = ownerAIQtyNearAlias(scan,row.aliases);
    if (found.qty != null && found.qty > 0) manifest.push({category:row.category,label:row.label,qty:found.qty});
    else if (found.mentioned) mentionedWithoutQty.push(row.label);
  }
  return {manifest,mentionedWithoutQty};
}
function ownerAIParseDispatch(text) {
  const raw=String(text || "").trim(), lower=raw.toLowerCase();
  const parsed={raw,ticket_no:"",site:"",work_type:"",scheduled_for:"",scheduled_time:"",unit_hint:null,role:"",assignee_ids:[],manifest:[],mentionedWithoutQty:[],parts:{},unit_numbers:"",stand_numbers:"",description:"",descriptionExplicit:false,notes:"",warnings:[]};
  const tm=raw.match(/\b(?:mhelpdesk|mhelp|ticket|reference|ref)\s*(?:#|number|no\.?)?\s*[:#=-]?\s*(\d{3,})\b/i) || raw.match(/#(\d{3,})\b/);
  if (tm) parsed.ticket_no=tm[1];

  const sm=raw.match(/\b(?:site|customer)\s*(?:is|:|=|-)\s*([^,.;\n]+)/i) || raw.match(/\bat\s+([^,.;\n]+?)(?=\s+(?:tomorrow|today|on\s+\d|for\s+(?:delivery|pickup|swap|service)|send\s+to|assign\s+to|with\s+\d)|[,.;\n]|$)/i);
  if (sm) parsed.site=String(sm[1]||"").trim();

  const serviceRoleContext=/\bservice\s+(?:department|dept|team|tech|technician|queue)\b|\b(?:assigned?|task(?:ed)?|sent?)\s+(?:to\s+)?(?:anyone\s+in\s+)?(?:the\s+)?service\b|\banyone\s+in\s+(?:the\s+)?service\b/i.test(raw);
  if (/\b(pickup|pick\s+up|collect|retrieve)\b/.test(lower)) parsed.work_type="pickup";
  else if (/\b(delivery|deliver|deploy|drop\s+off)\b/.test(lower)) parsed.work_type="delivery";
  else if (/\b(swap|swapping)\b/.test(lower)) parsed.work_type="swap";
  else if (
    /\b(repair|troubleshoot|troubleshooting|check\s+on|fix)\b/.test(lower)
    || /\bservice\s+(?:job|call|ticket|work)\b/.test(lower)
    || /\b(?:job|work|type)\s*(?:is|:|=)?\s*service\b/.test(lower)
    || (!serviceRoleContext && /\bfor\s+service\b/.test(lower))
  ) parsed.work_type="service";

  parsed.scheduled_for=ownerAIDateFromText(raw);
  parsed.scheduled_time=ownerAITimeFromText(raw);
  parsed.unit_hint=ownerAIUnitReference(raw);

  const hasIT=/\b(?:it\s+department|it\s+tech|it\s+technician|send\s+to\s+it|assign\s+to\s+it)\b/i.test(raw);
  const hasService=/\b(?:service\s+department|service\s+tech|service\s+technician|send\s+to\s+service|assign\s+to\s+service)\b/i.test(raw);
  const serviceFirst=/\bservice\b[\s\S]{0,30}\b(?:then|first|before)\b[\s\S]{0,30}\bit\b/i.test(raw) || /\bservice\s*(?:→|->)\s*it\b/i.test(raw);
  const itFirst=/\bit\b[\s\S]{0,30}\b(?:then|first|before)\b[\s\S]{0,30}\bservice\b/i.test(raw) || /\bit\s*(?:→|->)\s*service\b/i.test(raw);
  const servicePlusIT=/\bservice\s*(?:and|&|\+|\/)\s*it\b/i.test(raw);
  const itPlusService=/\bit\s*(?:and|&|\+|\/)\s*service\b/i.test(raw);
  if (serviceFirst || servicePlusIT) parsed.role="service_it";
  else if (itFirst || itPlusService) parsed.role="it_service";
  else if (hasIT && hasService) {
    const iIT=lower.search(/\bit\b/), iSvc=lower.search(/\bservice\b/);
    parsed.role=(iSvc>=0 && iIT>=0 && iSvc<iIT) ? "service_it" : "it_service";
  }
  else if (hasIT) parsed.role="it";
  else if (hasService) parsed.role="service";

  if (parsed.work_type === "pickup") {
    if (parsed.role && parsed.role !== "service_it") parsed.warnings.push("Pickup follows Service → field pickup → IT Intake, so the department flow was corrected.");
    parsed.role="service_it";
  }
  if (parsed.work_type === "delivery") {
    if (parsed.role && parsed.role !== "it_service") parsed.warnings.push("Delivery follows IT prep → Service handoff, so the department flow was corrected.");
    parsed.role="it_service";
  }

  const matched=[];
  const profileRows=ownerAssignmentProfiles || [];
  for (const p of profileRows) {
    const full=String(p.full_name||"").trim(), username=String(p.username||"").trim();
    const first=full.split(/\s+/)[0] || "";
    const fullHit=full.length>2 && lower.includes(full.toLowerCase());
    const userHit=username.length>2 && new RegExp("\\b"+ownerAIEscapeRegExp(username.toLowerCase())+"\\b","i").test(lower);
    const firstHit=first.length>2 && new RegExp("\\b(?:to|assign|send|tech|technician)\\s+(?:it\\s+to\\s+|service\\s+to\\s+)?"+ownerAIEscapeRegExp(first.toLowerCase())+"\\b","i").test(lower);
    if (fullHit || userHit || firstHit) matched.push(p);
  }
  parsed.assignee_ids=[...new Set(matched.map(p=>p.user_id))];
  const roles=[...new Set(matched.map(p=>p.role).filter(r=>r==="it"||r==="service"))];
  if (!parsed.role && roles.length===1) parsed.role=roles[0];
  if (!parsed.role && roles.length===2) parsed.role=lower.indexOf("service") < lower.indexOf("it") ? "service_it" : "it_service";

  const eq=ownerAIParseEquipment(raw);
  parsed.manifest=eq.manifest;
  parsed.mentionedWithoutQty=eq.mentionedWithoutQty;

  const partDefs=[
    {key:"solar_panel_qty",aliases:["solar panel","solar panels"]},
    {key:"battery_replacement_qty",aliases:["battery replacement","battery replacements","replacement batteries","replacement battery"]},
    {key:"camera_replacement_qty",aliases:["camera replacement","camera replacements","replacement cameras","replacement camera"]},
    {key:"sim_replacement_qty",aliases:["sim replacement","sim replacements","replacement sim card","replacement sim cards"]},
    {key:"micro_sd_qty",aliases:["micro sd replacement","micro sd replacements","replacement micro sd card","replacement micro sd cards"]}
  ];
  partDefs.forEach(def=>{const q=ownerAIQtyNearAlias(raw,def.aliases);if(q.qty!=null)parsed.parts[def.key]=q.qty;else if(q.mentioned)parsed.mentionedWithoutQty.push(def.aliases[0]);});

  const um=raw.match(/\b(?:unit|units)\s*(?:#s?|numbers?|tags?)\s*[:=]\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if (um) parsed.unit_numbers=um[1].replace(/\s+/g," ").trim();
  const stm=raw.match(/\b(?:stand|stands|solar\s+stand|solar\s+stands|pole|poles)\s*(?:#s?|numbers?|tags?)\s*[:=]\s*([A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*)/i);
  if (stm) parsed.stand_numbers=stm[1].replace(/\s+/g," ").trim();

  const dm=raw.match(/\bdescription\s*[:=]\s*([^;\n]+)/i);
  if (dm) { parsed.description=String(dm[1]||"").trim(); parsed.descriptionExplicit=true; }
  else parsed.description=raw;
  const nm=raw.match(/\bnotes?\s*[:=]\s*([^;\n]+)/i);
  if (nm) parsed.notes=String(nm[1]||"").trim();
  return parsed;
}
function ownerAIAddAssigneePills(ids) {
  const pills=document.getElementById("ownerAssignedTechPills");
  if (!pills || !ids?.length) return;
  pills.innerHTML="";
  ids.forEach(id=>{
    const p=ownerAssignmentProfiles.find(row=>row.user_id===id);
    if (!p) return;
    const label=(p.full_name||p.username||"Technician")+" — "+(p.role==="it"?"IT":"Service");
    const el=document.createElement("span");
    el.className="wl-tech-pill";
    el.dataset.techId=id;
    el.innerHTML="<span>"+esc(label)+"</span><button type='button' data-owner-remove-tech aria-label='Remove "+esc(label)+"'>×</button>";
    pills.appendChild(el);
  });
}
function ownerAIDispatchApply(parsed) {
  const set=(id,value)=>{const el=document.getElementById(id);if(el && value)el.value=value;};
  set("ownerAssignTicket",parsed.ticket_no);
  set("ownerAssignSite",parsed.site);
  if (parsed.scheduled_for) {
    const dateEl=document.getElementById("ownerAssignDate");
    if (dateEl) { dateEl.value=parsed.scheduled_for; dateEl.dataset.aiSet="1"; }
  }
  if (parsed.scheduled_time) {
    const timeEl=document.getElementById("ownerAssignTime");
    if (timeEl) { timeEl.value=parsed.scheduled_time; timeEl.dataset.aiSet="1"; }
  }
  const description=document.getElementById("ownerAssignDescription");
  if (description && parsed.description && (parsed.descriptionExplicit || !description.value.trim())) description.value=parsed.description;
  set("ownerAssignNotes",parsed.notes);
  set("ownerAssignUnitNumbers",parsed.unit_numbers);
  set("ownerAssignStandNumbers",parsed.stand_numbers);

  if (parsed.work_type) {
    const el=document.getElementById("ownerAssignWorkType");
    if (el) { el.value=parsed.work_type; el.dataset.aiSet="1"; }
  }
  if (parsed.role) {
    const el=document.getElementById("ownerAssignRole");
    if (el) { el.value=parsed.role; el.dataset.aiSet="1"; }
    refreshOwnerAssignmentTechOptions();
  }
  if (parsed.assignee_ids?.length) ownerAIAddAssigneePills(parsed.assignee_ids);

  parsed.manifest.forEach(row=>{
    const input=[...document.querySelectorAll("#ownerJobAssignments [data-owner-equipment-qty]")].find(el=>String(el.dataset.category||"")===row.category && String(el.dataset.label||"").toLowerCase()===row.label.toLowerCase());
    if (input) input.value=String(row.qty);
  });
  TICKET_PARTS.forEach(part=>{
    if (parsed.parts[part.key] == null) return;
    const el=document.getElementById("ownerPart"+part.id);
    if (el) el.value=String(parsed.parts[part.key]);
  });
  refreshOwnerWorkTypeLabels();
  refreshOwnerAutoServicePlan();
  ownerSaveAssignDraftNow();
}
function ownerAIDispatchMissing(parsed) {
  const missing=[], current=ownerAIDraft();
  if (!current.ticket_no) missing.push("MHelpDesk ticket number");
  if (!current.site) missing.push("customer / site");
  if (!current.job_description) missing.push("job description");
  const work=document.getElementById("ownerAssignWorkType");
  if (!parsed?.work_type && !work?.dataset?.aiSet && !work?.dataset?.ownerConfirmed) missing.push("job type (Delivery, Pickup, Swap, or Service)");
  const date=document.getElementById("ownerAssignDate");
  if (!parsed?.scheduled_for && !date?.dataset?.aiSet && !date?.dataset?.ownerConfirmed) missing.push("work date");
  const role=document.getElementById("ownerAssignRole");
  if (!parsed?.role && !role?.dataset?.aiSet && !role?.dataset?.ownerConfirmed) missing.push("department flow (IT, Service, IT → Service, or Service → IT)");
  const manifest=readOwnerEquipmentManifest();
  const roleValue=role?.value||"";
  if ((roleValue==="it" || roleValue==="it_service" || roleValue==="service_it") && !manifest.length) missing.push("equipment type and quantity");
  (parsed?.mentionedWithoutQty||[]).forEach(label=>{
    const low=String(label||"").toLowerCase();
    const hasManifest=manifest.some(r=>String(r.label||"").toLowerCase()===low && Number(r.qty||0)>0);
    const partKey=low==="solar panel"?"solar_panel_qty":low==="battery replacement"?"battery_replacement_qty":low==="camera replacement"?"camera_replacement_qty":low==="sim replacement"?"sim_replacement_qty":low==="micro sd replacement"?"micro_sd_qty":"";
    const part=partKey ? TICKET_PARTS.find(p=>p.key===partKey) : null;
    const hasPart=part ? Number(document.getElementById("ownerPart"+part.id)?.value||0)>0 : false;
    if (!hasManifest && !hasPart && !missing.includes("quantity for "+label)) missing.push("quantity for "+label);
  });
  return [...new Set(missing)];
}
function ownerAIDispatchSummary(parsed) {
  const a=ownerAIDraft(), techIds=[...document.querySelectorAll("#ownerAssignedTechPills [data-tech-id]")].map(el=>el.dataset.techId), techs=techIds.map(id=>ownerAssignmentProfiles.find(p=>p.user_id===id)?.full_name||ownerAssignmentProfiles.find(p=>p.user_id===id)?.username).filter(Boolean);
  const eq=normalizedEquipmentManifest(a.equipment_manifest).map(r=>r.qty+" × "+equipmentDisplayLabel(r.label)).join(", ");
  const flow=a.role==="it_service"?"IT → Service":a.role==="service_it"?"Service → IT":a.role==="it"?"IT only":"Service only";
  return {ticket:a.ticket_no||"—",site:a.site||"—",date:ownerAIScheduleText(document.getElementById("ownerAssignDate")?.value||"",document.getElementById("ownerAssignTime")?.value||""),type:String(a.work_type||"").toUpperCase(),flow,techs:techs.length?techs.join(", "):"Department queue",equipment:eq||"—"};
}
function ownerAIDispatchRender(parsed) {
  const box=ownerAIResponseBox(); if(!box)return;
  const missing=ownerAIDispatchMissing(parsed), s=ownerAIDispatchSummary(parsed);
  box.classList.remove("hidden");
  box.classList.toggle("is-ready", missing.length===0);
  box.classList.toggle("is-pending", missing.length>0);
  const warningHtml=(parsed.warnings||[]).length ? "<div class='wl-ai-warn top8'>"+parsed.warnings.map(v=>"⚠ "+esc(v)).join("<br>")+"</div>" : "";
  box.innerHTML=
    "<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>New Ticket Draft</b></span></div><span class='wl-ai-state "+(missing.length?"pending":"ready")+"'>"+(missing.length?"PENDING":"READY")+"</span></div>"
    +"<div class='wl-ai-result-grid'>"
      +"<div><span>MHelpDesk</span><b>#"+esc(s.ticket)+"</b></div>"
      +"<div><span>Job type</span><b>"+esc(s.type)+"</b></div>"
      +"<div><span>Site</span><b>"+esc(s.site)+"</b></div>"
      +"<div><span>Work date / time</span><b>"+esc(s.date)+"</b></div>"
      +"<div><span>Flow</span><b>"+esc(s.flow)+"</b></div>"
      +"<div><span>Assigned</span><b>"+esc(s.techs)+"</b></div>"
    +"</div>"
    +"<div class='wl-ai-result-equipment'><span>Equipment</span><b>"+esc(s.equipment)+"</b></div>"
    +warningHtml
    +(missing.length
      ? "<div class='wl-ai-pending-box'><b>Pending information</b>"+missing.map(v=>"<span>• "+esc(v)+"</span>").join("")+"<small>Tell OnSite Vision the missing details, or fill them in below, then ask Vision again.</small></div>"
      : "<div class='wl-ai-good'><b>✓ Ready for your review</b><br>Nothing has been sent.</div>")
    +"<div class='wl-ai-advisory'>OnSite Vision prepared this draft because you asked to create or update a ticket. Nothing is sent until you review and send the Tech Check job.</div>";
  return missing;
}
function ownerAIAssistantIntent(text) {
  const raw=String(text||'').trim();
  const hasScheduleValue=Boolean(ownerAIDateFromText(raw)||ownerAITimeFromText(raw));
  const scheduleVerb=/\b(put|set|change|update|move|reschedule|schedule|make)\b/i.test(raw);
  const explicitScheduleWord=/\b(date|time|delivery|pickup|swap|service|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i.test(raw);
  const conversationalSchedule=/\b(?:put|set|change|update|move|make)\s+(?:it|that|this)(?:\s+(?:to|for))?\b/i.test(raw);
  const scheduleChange=hasScheduleValue && scheduleVerb && (explicitScheduleWord||conversationalSchedule);
  if(scheduleChange) return 'schedule';
  const explicitCreate=/\b(create|make|start|set\s*up|setup|add|prepare|build)\b[\s\S]{0,40}\b(?:new\s+)?(?:tech\s*check|ticket|job|assignment)\b/i.test(raw)
    || /\b(create|make|start|set\s*up|setup)\b[\s\S]{0,30}\b(delivery|pickup|swap|service)\b/i.test(raw)
    || /\b(update|change|edit)\b[\s\S]{0,30}\b(draft|new\s+ticket|new\s+job|assignment)\b/i.test(raw);
  return explicitCreate ? 'draft' : 'ask';
}
function ownerAIAssistantWorkflowGuide(parsed,raw) {
  if (parsed?.ticket_no || parsed?.scheduled_for) return '';
  if (!/\b(step|steps|workflow|process|requirement|requirements|what do i need|what should|how do|how does|what happens|directions)\b/i.test(raw)) return '';
  const names=[...(parsed?.manifest||[]).map(r=>r.label),...(parsed?.mentionedWithoutQty||[])].map(v=>String(v||'').toLowerCase());
  const type=String(parsed?.work_type||'').toLowerCase();
  if(names.includes('helios')){
    return "<div class='wl-ai-answer'><b>Helios "+esc((type||'delivery').toUpperCase())+" workflow</b>"
      +"<ol><li><b>Owner:</b> start from the MHelpDesk ticket and create the Tech Check assignment with the date, site, Helios quantity, and unit number.</li>"
      +"<li><b>IT:</b> complete the Helios lab checks — cameras/router/ports, Proxicast 4x4, Cerbo/VRM, 3 × 1TB SD cards, internal battery box and 120V charge — then photo, sign, and create the Service handoff.</li>"
      +"<li><b>Service before leaving:</b> connect PV, switch to PV, verify Victron/Bluetooth and active solar charging, remove/wrap the PTZ, then accept the handoff.</li>"
      +"<li><b>Field:</b> mount the box and PTZ, connect PV, power on, call IT to verify online/aim/recording, crank to about 20 ft, install mast bolt, set panel about 45°, install panel bolt, add 4 sandbags, then upload final photos and sign.</li>"
      +"<li><b>Owner final:</b> review the field proof and complete Owner Final Verify.</li></ol>"
      +"<div class='wl-ai-next'><b>Next step:</b> If this is a new job, say “Create a new Helios delivery ticket…” and include the MHelpDesk number, site, date, quantity, and unit number.</div></div>";
  }
  if(names.includes('solar spotter')){
    return "<div class='wl-ai-answer'><b>Solar Spotter delivery workflow</b><p>IT checks the Solar Spotter itself. After IT creates the handoff, Service is automatically responsible for the Solar Stand and the battery setup, verifies charging/MPPT proof, and then takes the equipment from the shop.</p><div class='wl-ai-next'><b>Next step:</b> Create the ticket from the MHelpDesk details; do not add the automatic Solar Stand to the IT prep list.</div></div>";
  }
  if(names.includes('ranger')){
    return "<div class='wl-ai-answer'><b>Ranger delivery workflow</b><p>IT prepares the Ranger. Service verifies the Ranger solar checkout, including the required solar panel, LiTime 12V 110Ah battery setup, MPPT operation/update, charging proof, and photos before leaving.</p></div>";
  }
  if(type==='pickup') return "<div class='wl-ai-answer'><b>Pickup workflow</b><p>Service goes to the field first, photographs and returns the equipment to the shop, then the returned unit enters IT Intake. IT does not start the pickup.</p></div>";
  if(type==='delivery') return "<div class='wl-ai-answer'><b>Delivery workflow</b><p>Owner creates the Tech Check from MHelpDesk → IT prepares and signs off equipment → IT creates the Service handoff → Service verifies and takes the equipment → field work is completed.</p></div>";
  return '';
}
function ownerAIAssistantNextStep(a,prep,solar) {
  const p=ownerAssignmentProgress(a,prep,solar);
  if(p.label==='DONE') return 'No action needed — this assignment is complete.';
  if(p.label==='WAITING OWNER FINAL VERIFY') return 'Review the Helios field photos/checklist and complete Owner Final Verify.';
  if(p.label==='HELIOS FIELD INSTALL IN PROGRESS') return 'Service needs to finish the Helios field checklist, final photos, and dated signature.';
  if(p.label==='HELIOS YARD TEST COMPLETE') return 'Service needs to accept the IT handoff before leaving the shop.';
  if(p.label==='HELIOS PRE-TRIP IN PROGRESS') return 'Service needs to finish the yard PV/Victron/solar test and transport prep.';
  if(p.label==='SOLAR CHECKOUT IN PROGRESS') return 'Service needs to finish the required solar/equipment checkout proof.';
  if(p.label==='READY FOR SERVICE') return 'Service needs to open the same MHelpDesk ticket and verify the IT handoff.';
  if(p.label==='TECH CHECK IN PROGRESS') return 'IT needs to finish the unit checks, required photo/tag proof, signature, and handoff.';
  if(/WAITING FOR/.test(p.label)) return 'A technician needs to claim this assignment from the department queue.';
  if(p.label==='SENT') return 'The assigned technician needs to start the job.';
  return p.detail || 'Open the job and continue the current Tech Check step.';
}
function ownerAIAssignmentQuestion(raw) {
  const text=String(raw||'');
  const asks=/\b(assign(?:ed|ment)?|task(?:ed)?|who\s+(?:has|is\s+handling|is\s+assigned)|who(?:'s|\s+is)\s+(?:got|handling)|anyone\s+(?:in|on)|department\s+queue|who\s+has\s+it)\b/i.test(text);
  if(!asks)return null;
  let role='';
  if(/\bservice\s+(?:department|dept|team|tech|technician|queue)\b|\b(?:to|in|on)\s+(?:the\s+)?service\b/i.test(text)) role='service';
  else if(/\bit\s+(?:department|dept|team|tech|technician|queue)\b|\b(?:to|in|on)\s+(?:the\s+)?it\b/i.test(text)) role='it';
  return {role};
}
function ownerAIAssignmentAnswerHtml(rows,question) {
  const active=(rows||[]).filter(r=>r.status!=='completed');
  const wanted=question?.role||'';
  const scoped=wanted ? active.filter(r=>String(r.assigned_role||'')===wanted) : active;
  const ticket=String(rows?.[0]?.ticket_no||'—');
  const roleName=wanted==='service'?'Service':wanted==='it'?'IT':'';
  if(wanted && !scoped.length){
    const other=active.map(r=>String(r.assigned_role||'').toUpperCase()+' — '+String(r.assignee_name||r.assigned_to_name||(r.assignment_scope==='department'?'Department queue':'Unassigned'))).join(' · ');
    return "<div class='wl-ai-direct-answer no'><b>No active "+esc(roleName)+" assignment is showing for MHelpDesk #"+esc(ticket)+".</b>"
      +(other?"<span>Current assignment: "+esc(other)+".</span>":"<span>No active technician assignment is showing right now.</span>")+"</div>";
  }
  if(!wanted && !scoped.length){
    return "<div class='wl-ai-direct-answer no'><b>No active technician assignment is showing for MHelpDesk #"+esc(ticket)+".</b></div>";
  }
  const lines=scoped.map(r=>{
    const role=String(r.assigned_role||'').toUpperCase()||'ASSIGNMENT';
    const who=r.assignee_name||r.assigned_to_name||(r.assignment_scope==='department'?(role==='SERVICE'?'Service department queue':'IT department queue'):'Unassigned');
    const queue=!r.assignee_name&&!r.assigned_to_name&&r.assignment_scope==='department' ? ' · not claimed by an individual technician yet' : '';
    return "<span><b>"+esc(role)+":</b> "+esc(who)+esc(queue)+"</span>";
  }).join('');
  const lead=wanted
    ? "Yes — MHelpDesk #"+esc(ticket)+" has an active "+esc(roleName)+" assignment."
    : "Here is who currently has MHelpDesk #"+esc(ticket)+".";
  return "<div class='wl-ai-direct-answer yes'><b>"+lead+"</b>"+lines+"</div>";
}

async function ownerAIAssistantAnswer(raw) {
  const box=ownerAIResponseBox(); if(!box)return;
  const parsed=ownerAIParseDispatch(raw), intent=ownerAIAssistantIntent(raw);
  const guide=ownerAIAssistantWorkflowGuide(parsed,raw);
  box.classList.remove('hidden','is-ready','is-pending');
  if(guide && intent!=='schedule'){
    box.innerHTML="<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>Next Steps</b></span></div><span class='wl-ai-state ready'>GUIDE</span></div>"+guide;
    return;
  }
  box.innerHTML="<div class='wl-ai-assistant-working'><span class='wl-ai-scan-spinner'></span><div><b>OnSite Vision is checking Tech Check…</b><span>Finding the matching equipment, ticket, schedule, and workflow status.</span></div></div>";
  const results=await Promise.all([
    liveDb.from('job_assignments').select('*').in('status',['assigned','started','completed']).order('assigned_at',{ascending:false}).limit(100),
    liveDb.from('prep_tickets').select('id,ticket_no,site,status,work_type,equipment_manifest,released_by_name,released_at,closed_by_name,closed_at,prep_items(equipment_type,purpose,unit_tag)').order('created_at',{ascending:false}).limit(100),
    liveDb.from('service_solar_checks').select('prep_ticket_id,service_tech_name,completed_at,updated_at,handoff_accepted_at,handoff_accepted_by_name,helios_field_completed_at,helios_field_completed_by_name,helios_owner_verified_at,helios_owner_verified_by_name').order('updated_at',{ascending:false}).limit(100)
  ]);
  const jobResult=results[0], prepResult=results[1], solarResult=results[2];
  if(jobResult.error) throw jobResult.error;
  const jobs=jobResult.data||[], preps=prepResult.data||[], solarRows=solarResult.data||[];
  const prepMap=new Map(preps.map(p=>[p.id,p])), solarMap=new Map(solarRows.map(s=>[s.prep_ticket_id,s]));
  const unitHint=parsed.unit_hint||ownerAIUnitReference(raw);
  const equipmentNames=[...(parsed.manifest||[]).map(r=>r.label),...(parsed.mentionedWithoutQty||[])].filter(v=>OWNER_DEVICE_TYPES.includes(v)||OWNER_STAND_TYPES.includes(v));
  if(unitHint?.type && !equipmentNames.some(v=>String(v).toLowerCase()===String(unitHint.type).toLowerCase())) equipmentNames.push(unitHint.type);

  let baseMatches=[...jobs];
  const hasDirectJobReference=Boolean(parsed.ticket_no||unitHint||equipmentNames.length||parsed.work_type);
  if(intent==='schedule' && !hasDirectJobReference && ownerAIAssistantLastJobs.length){
    const priorIds=new Set(ownerAIAssistantLastJobs.map(a=>String(a.id)));
    baseMatches=jobs.filter(a=>priorIds.has(String(a.id)));
  }
  if(parsed.ticket_no)baseMatches=baseMatches.filter(a=>String(a.ticket_no||'')===String(parsed.ticket_no));
  if(parsed.work_type)baseMatches=baseMatches.filter(a=>ownerAIEffectiveWorkType(a,prepMap.get(a.prep_ticket_id))===String(parsed.work_type).toLowerCase());
  if(equipmentNames.length)baseMatches=baseMatches.filter(a=>{
    const prep=prepMap.get(a.prep_ticket_id), rows=normalizedEquipmentManifest((a.equipment_manifest?.length?a.equipment_manifest:prep?.equipment_manifest)||[]);
    return equipmentNames.some(name=>rows.some(r=>String(r.label).toLowerCase()===String(name).toLowerCase()));
  });
  if(unitHint)baseMatches=baseMatches.filter(a=>ownerAIUnitMatches(a,prepMap.get(a.prep_ticket_id),unitHint));

  if(intent==='schedule'){
    const active=baseMatches.filter(a=>a.status!=='completed');
    const grouped=new Map();
    active.forEach(a=>{const key=String(a.prep_ticket_id||a.ticket_no||a.id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(a);});
    if(!parsed.scheduled_for && !parsed.scheduled_time){
      box.innerHTML="<div class='wl-ai-warn'><b>I found the job, but I need the new date or time.</b><br>For example: “Set Helios 007 for Monday at 8 AM.”</div>";
      return;
    }
    if(grouped.size===1){
      const rows=[...grouped.values()][0], target=rows[0], prep=prepMap.get(target.prep_ticket_id), solar=prep?solarMap.get(prep.id):null;
      const update={updated_at:new Date().toISOString()};
      if(parsed.scheduled_for) update.scheduled_for=parsed.scheduled_for;
      if(parsed.scheduled_time) update.scheduled_time=parsed.scheduled_time;
      let q=liveDb.from('job_assignments').update(update);
      q=target.prep_ticket_id ? q.eq('prep_ticket_id',target.prep_ticket_id) : q.eq('id',target.id);
      const {error}=await q;
      if(error) throw error;
      rows.forEach(r=>{if(parsed.scheduled_for)r.scheduled_for=parsed.scheduled_for;if(parsed.scheduled_time)r.scheduled_time=parsed.scheduled_time;});
      const unitText=unitHint?.type ? unitHint.type+' '+unitHint.tag : equipmentManifestText((target.equipment_manifest?.length?target.equipment_manifest:prep?.equipment_manifest)||[]);
      const effective=ownerAIEffectiveWorkType(target,prep).toUpperCase();
      box.innerHTML="<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>Schedule Updated</b></span></div><span class='wl-ai-state ready'>SAVED</span></div>"
        +"<div class='wl-ai-good'><b>✓ Updated MHelpDesk #"+esc(target.ticket_no||'—')+" in Tech Check</b><br>"+esc(unitText||'Equipment')+" · "+esc(effective)+"<br><b>"+esc(ownerAIScheduleText(target.scheduled_for,target.scheduled_time))+"</b></div>"
        +"<div class='wl-ai-job-status'>"+rows.map(r=>"<div><b>"+esc(String(r.assigned_role||'').toUpperCase())+":</b> "+esc(r.assignee_name||((r.assignment_scope==='department')?'Department queue':'Unassigned'))+" · "+esc(ownerAssignmentProgress(r,prep,solar).label)+"</div>").join('')+"</div>"
        +"<div class='wl-ai-next'><b>Next:</b> "+esc(ownerAIAssistantNextStep(rows.find(r=>r.status!=='completed')||target,prep,solar))+"</div>"
        +"<div class='wl-ai-advisory'>The date/time was saved to Tech Check. MHelpDesk itself is still a separate system.</div>";
      ownerAIAssistantLastJobs=rows;
      return;
    }
    if(grouped.size>1){
      const choices=[...grouped.values()].slice(0,6).map(rows=>{
        const a=rows[0],prep=prepMap.get(a.prep_ticket_id);
        return "<div class='wl-ai-job-answer'><b>#"+esc(a.ticket_no||'—')+" · "+esc(a.site||prep?.site||'No site')+"</b><div class='small'>"+esc(ownerAIScheduleText(a.scheduled_for,a.scheduled_time))+" · "+esc(equipmentManifestText((a.equipment_manifest?.length?a.equipment_manifest:prep?.equipment_manifest)||[]))+"</div></div>";
      }).join('');
      box.innerHTML="<div class='wl-ai-warn'><b>I found more than one active match, so I did not change anything.</b><br>Tell me the MHelpDesk ticket number and I can update the correct one.</div>"+choices;
      return;
    }
  }

  let matches=[...baseMatches], scheduleMismatch=false;
  if(parsed.scheduled_for){
    const dated=matches.filter(a=>String(a.scheduled_for||'')===String(parsed.scheduled_for));
    if(dated.length) matches=dated;
    else if(matches.length && (unitHint||parsed.ticket_no)){scheduleMismatch=true;}
    else matches=dated;
  }
  const wantsAttention=/\b(attention|problem|problems|issue|issues|stuck|overdue|needs? me|needs? review)\b/i.test(raw);
  if(wantsAttention)matches=matches.filter(a=>{
    const prep=prepMap.get(a.prep_ticket_id), solar=prep?solarMap.get(prep.id):null;
    return ownerLiveAIStatus(a,prep,solar).state==='attention';
  });
  const hasSelector=Boolean(parsed.ticket_no||parsed.scheduled_for||parsed.work_type||equipmentNames.length||unitHint||wantsAttention);
  if(!hasSelector && ownerAIAssistantLastJobs.length && /\b(it|that|this|those|next|who|status|where)\b/i.test(raw)){
    const ids=new Set(ownerAIAssistantLastJobs.map(a=>String(a.id)));
    matches=jobs.filter(a=>ids.has(String(a.id)));
  }
  if(!matches.length){
    const what=[parsed.work_type,unitHint?(unitHint.type+' '+unitHint.tag):'',parsed.scheduled_for,equipmentNames.join(' ')].filter(Boolean).join(' ');
    box.innerHTML="<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>No matching Tech Check job found</b></span></div><span class='wl-ai-state pending'>NO MATCH</span></div>"
      +"<div class='wl-ai-answer'><p>I do not see a current Tech Check record matching <b>"+esc(what||raw)+"</b>.</p><div class='wl-ai-next'><b>If this is a new MHelpDesk job:</b> say “Create a new ticket…” and give me the MHelpDesk number, site, date, equipment, and quantity. I will prepare the form for you.</div><div class='wl-ai-advisory'>MHelpDesk is separate, so OnSite Vision can only look up what has already been entered into Tech Check.</div></div>";
    ownerAIAssistantLastJobs=[];
    return;
  }
  ownerAIAssistantLastJobs=matches.slice(0,12);
  const groups=new Map();
  matches.forEach(a=>{const key=String(a.prep_ticket_id||a.ticket_no||a.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);});
  const assignmentQuestion=ownerAIAssignmentQuestion(raw);
  const assignmentAnswer=assignmentQuestion ? [...groups.values()].slice(0,8).map(rows=>ownerAIAssignmentAnswerHtml(rows,assignmentQuestion)).join('') : '';
  const cards=[...groups.values()].slice(0,8).map(rows=>{
    const a=rows[0], prep=rows.map(r=>prepMap.get(r.prep_ticket_id)).find(Boolean)||null, solar=prep?solarMap.get(prep.id):null;
    const manifest=(a.equipment_manifest?.length?a.equipment_manifest:prep?.equipment_manifest)||[];
    const unitRows=(prep?.prep_items||[]).filter(x=>x.unit_tag).map(x=>String(x.equipment_type||'Unit')+' '+String(x.unit_tag)).join(', ');
    const statuses=rows.map(r=>{const p=ownerAssignmentProgress(r,prep,solar);return "<div><b>"+esc(String(r.assigned_role||'').toUpperCase())+":</b> "+esc(r.assignee_name||((r.assignment_scope==='department')?'Department queue':'Unassigned'))+" · "+esc(p.label)+"</div>";}).join('');
    const active=rows.filter(r=>r.status!=='completed');
    const target=active.find(r=>ownerLiveAIStatus(r,prep,solar).state==='attention')||active.find(r=>r.assigned_role==='it')||active[0]||rows[0];
    const ai=ownerLiveAIStatus(target,prep,solar), effective=ownerAIEffectiveWorkType(a,prep).toUpperCase();
    return "<div class='wl-ai-job-answer "+(ai.state==='attention'?'attention':'')+"'><div class='wl-ai-job-answer-head'><b>#"+esc(a.ticket_no||'—')+" · "+esc(a.site||prep?.site||'No site')+"</b><span>"+esc(effective)+"</span></div>"
      +"<div class='wl-ai-job-meta'><span>"+esc(ownerAIScheduleText(a.scheduled_for,a.scheduled_time))+"</span><span>"+esc(unitRows||equipmentManifestText(manifest)||'No equipment listed')+"</span></div>"
      +"<div class='wl-ai-job-status'>"+statuses+"</div>"
      +"<div class='wl-ai-next'><b>Next:</b> "+esc(ownerAIAssistantNextStep(target,prep,solar))+"</div></div>";
  }).join('');
  box.innerHTML="<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>"+(wantsAttention?'Needs Attention':'Tech Check Answer')+"</b></span></div><span class='wl-ai-state ready'>"+groups.size+" FOUND</span></div>"
    +(scheduleMismatch?"<div class='wl-ai-warn'><b>I found the exact equipment/ticket, but its saved date does not match the date you mentioned.</b><br>I am showing the likely match instead of pretending there is no ticket.</div>":"")
    +assignmentAnswer
    +"<div class='wl-ai-answer-intro'>"+(assignmentQuestion?"I also pulled the job details into this conversation so you can see exactly what Vision is referring to.":"I found the matching Tech Check record"+(groups.size===1?'':'s')+". Here is the schedule, current status, and what should happen next.")+"</div>"+cards;
}
async function ownerAIDispatchBuild() {
  const input=document.getElementById('ownerAIDispatchPrompt');
  const raw=String(input?.value||'').trim();
  if(!raw)return;
  if(input) input.value='';
  ownerAIConversationAppendUser(raw);
  const response=ownerAIConversationBeginAssistant();
  ownerAIActiveResponseBox=response;
  const status=document.getElementById('ownerAIDispatchVoiceStatus');
  if(status)status.textContent='';
  try{
    const intent=ownerAIAssistantIntent(raw);
    const correction=ownerAIShouldApplyDraftCorrection(raw) ? ownerAIConversationDraftCorrection(raw) : null;
    if(correction){
      response.innerHTML="<div class='wl-ai-result-head'><div class='wl-ai-brand-title'><span class='wl-ai-brand-icon small'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><span><small>ONSITE VISION</small><b>Got it — I changed the draft</b></span></div><span class='wl-ai-state ready'>UPDATED</span></div>"
        +"<div class='wl-ai-good'><b>✓ "+esc(correction.join(' · '))+"</b></div>"
        +"<div class='wl-ai-answer-intro'>Here is the draft now. You can keep talking to me if anything else needs to change.</div>";
      const recap=document.createElement('div');
      response.append(recap);
      ownerAIActiveResponseBox=recap;
      ownerAIDispatchRender(ownerAIDispatchLastParse||{warnings:[]});
      ownerAIReview();
      ownerAIActiveResponseBox=response;
    } else if(intent==='draft'){
      const parsed=ownerAIParseDispatch(raw);
      ownerAIDispatchApply(parsed);
      ownerAIDispatchPrepared=true;
      ownerAIDispatchLastParse=parsed;
      ownerAIDispatchRender(parsed);
      ownerAIReview();
    } else {
      await ownerAIAssistantAnswer(raw);
    }
  }catch(error){
    console.warn('OnSite Vision owner assistant error',error);
    if(response)response.innerHTML="<div class='wl-ai-warn'><b>OnSite Vision could not finish that request.</b><br>"+esc(error?.message||'Please try again.')+"</div>";
  }finally{
    ownerAIActiveResponseBox=null;
    ownerAIConversationFinishAssistant(response);
  }
}
function ownerAIDispatchStartVoice() {
  const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Ctor)return alert('Voice requests are not available in this browser. Type your request and tap Ask OnSite Vision.');
  try{ownerAIDispatchRecognition?.stop?.();}catch{}
  const input=document.getElementById('ownerAIDispatchPrompt'), status=document.getElementById('ownerAIDispatchVoiceStatus'), button=document.querySelector('[data-owner-ai-dispatch-voice]');
  const rec=new Ctor(); ownerAIDispatchRecognition=rec;
  rec.lang='en-US';rec.interimResults=false;rec.continuous=false;rec.maxAlternatives=1;
  rec.onstart=()=>{if(status)status.textContent='Listening… speak naturally.';if(button)button.innerHTML='<span>●</span> Listening…';};
  rec.onerror=e=>{if(status)status.textContent='Voice request stopped. You can type instead.';if(button)button.innerHTML='<span>🎙</span> Speak to Vision';console.warn('OnSite Vision voice error',e);};
  rec.onend=()=>{if(button)button.innerHTML='<span>🎙</span> Speak to Vision';ownerAIDispatchRecognition=null;};
  rec.onresult=async e=>{
    const spoken=String(e.results?.[0]?.[0]?.transcript||'').trim();
    if(input&&spoken)input.value=spoken;
    if(status)status.textContent=spoken?'Got it — adding that to the conversation…':'I did not catch that. Try again.';
    if(spoken)await ownerAIDispatchBuild();
  };
  rec.start();
}
async function openOwnerAIDispatch() {
  document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
  await installOwnerAssignments(false);
  organizeOwnerDashboard();
  const host=document.getElementById('ownerJobAssignments');if(host)host.open=true;
  document.querySelector('.ownerAIDispatchPanel')?.scrollIntoView?.({behavior:'smooth',block:'start'});
}
function ownerAIDraft(){const m=readOwnerEquipmentManifest();return{ticket_no:document.getElementById('ownerAssignTicket')?.value.trim()||'',site:document.getElementById('ownerAssignSite')?.value.trim()||'',work_type:document.getElementById('ownerAssignWorkType')?.value||'service',scheduled_for:document.getElementById('ownerAssignDate')?.value||'',scheduled_time:document.getElementById('ownerAssignTime')?.value||'',job_description:document.getElementById('ownerAssignDescription')?.value.trim()||'',notes:document.getElementById('ownerAssignNotes')?.value.trim()||'',equipment_manifest:m,requested_unit_count:equipmentManifestDeviceTotal(m),role:document.getElementById('ownerAssignRole')?.value||'it'};}
function syncOwnerSimplePills(){
  const work=document.getElementById('ownerAssignWorkType')?.value||'service';
  const role=document.getElementById('ownerAssignRole')?.value||'it';
  document.querySelectorAll('[data-owner-work-pill]').forEach(b=>b.classList.toggle('selected',b.dataset.ownerWorkPill===work));
  document.querySelectorAll('[data-owner-role-pill]').forEach(b=>b.classList.toggle('selected',b.dataset.ownerRolePill===role));
}
function ownerAIReview(){
  const a=ownerAIDraft(),role=a.role,type=a.work_type,dual=role==='it_service'||role==='service_it',issues=[];
  const manifest=normalizedEquipmentManifest(a.equipment_manifest||[]);
  const deviceCount=equipmentManifestDeviceTotal(manifest),standCount=equipmentManifestStandTotal(manifest);
  const un=(document.getElementById('ownerAssignUnitNumbers')?.value||'').split(',').map(v=>v.trim()).filter(Boolean);
  const sn=(document.getElementById('ownerAssignStandNumbers')?.value||'').split(',').map(v=>v.trim()).filter(Boolean);
  const parts=readTicketPartInputs('ownerPart');
  if(!a.ticket_no)issues.push('Enter the MHelpDesk ticket number.');
  if(!a.job_description)issues.push('Add a short description of what needs to be done.');
  if(type==='pickup'&&role==='it')issues.push('Pickup must start with Service. Choose Service only or Service → IT.');
  const itSuppliedCards=Number(parts.sim_replacement_qty||0)+Number(parts.micro_sd_qty||0);
  if(type!=='pickup'&&itSuppliedCards>0&&(role==='service'||role==='service_it'))issues.push('SIM / SD replacements come from IT. Choose IT → Service so IT supplies the cards before Service leaves.');
  if((role==='it'||dual)&&deviceCount+standCount<1)issues.push('Choose the equipment IT will work on in Step 2.');
  const autoSolarPlan=automaticServiceSolarPlan(manifest,type);
  if(autoSolarPlan.spotters>0&&manifestQty(manifest,'Solar Stand')>0)issues.push('Remove Solar Stand from the IT list. Service gets it automatically after the IT handoff.');
  if(deviceCount&&un.length&&deviceCount!==un.length)issues.push('The unit quantity and the number of Unit #s do not match.');
  if(standCount&&sn.length&&standCount!==sn.length)issues.push('The stand quantity and the number of Stand #s do not match.');
  const box=document.getElementById('ownerAIReviewBox');if(!box)return;
  box.classList.remove('hidden','is-ready','is-pending');
  box.classList.toggle('ready',issues.length===0);
  box.classList.toggle('pending',issues.length>0);
  const flow=type==='pickup'?'Service pickup → IT Intake':role==='it_service'?'IT → Service':role==='service_it'?'Service → IT':role==='it'?'IT only':'Service only';
  const equipmentText=manifest.length?manifest.map(r=>r.qty+' × '+equipmentDisplayLabel(r.label)).join(', '):'No equipment selected';
  const partTotal=Object.values(parts).reduce((sum,v)=>sum+Number(v||0),0);
  const summary=[
    type.toUpperCase(),
    flow,
    equipmentText,
    partTotal?partTotal+' extra part'+(partTotal===1?'':'s'):null
  ].filter(Boolean);
  box.innerHTML=issues.length
    ? `<h3>${issues.length===1?'Almost done — one thing left':'Almost done — '+issues.length+' things left'}</h3><p>Fix the item${issues.length===1?'':'s'} below, then assign the job.</p><div class='owner-simple-review-list'>${issues.slice(0,4).map(v=>'<div><i>→</i><span>'+esc(v)+'</span></div>').join('')}</div><div class='owner-simple-summary'>${summary.map(v=>'<span>'+esc(v)+'</span>').join('')}</div>`
    : `<h3>✓ Ready to assign</h3><p>Everything Tech Check needs is here.</p><div class='owner-simple-summary'>${summary.map(v=>'<span>'+esc(v)+'</span>').join('')}</div>`;
  const assign=document.querySelector('[data-wl-owner-assign]');
  if(assign){
    assign.textContent=issues.length?'Fix the item'+(issues.length===1?'':'s')+' above':'Assign Job →';
    assign.classList.toggle('wl-gray',issues.length>0);
    assign.classList.toggle('wl-red',issues.length===0);
  }
}
async function ownerAssignJob() {
  const ticket = document.getElementById('ownerAssignTicket')?.value.trim() || '';
  const site = document.getElementById('ownerAssignSite')?.value.trim() || '';
  const units = '';
  const unitNumbers = document.getElementById('ownerAssignUnitNumbers')?.value.trim() || '';
  const standNumbers = document.getElementById('ownerAssignStandNumbers')?.value.trim() || '';
  const requestedUnitCount = equipmentManifestDeviceTotal(readOwnerEquipmentManifest());
  const description = document.getElementById('ownerAssignDescription')?.value.trim() || '';
  const role = document.getElementById('ownerAssignRole')?.value || 'it';
  const assignees = [...document.querySelectorAll('#ownerAssignedTechPills [data-tech-id]')].map(el => el.dataset.techId).filter(Boolean);
  const serviceQueueSelected = !!document.querySelector('#ownerAssignedTechPills [data-queue-role="service"]');
  const assignee = assignees[0] || null;
  const notes = document.getElementById('ownerAssignNotes')?.value.trim() || '';
  const scheduledFor = document.getElementById('ownerAssignDate')?.value || techCheckDateKey(new Date());
  const scheduledTime = document.getElementById('ownerAssignTime')?.value || '';
  const workType = document.getElementById('ownerAssignWorkType')?.value || 'service';
  const equipmentManifest = readOwnerEquipmentManifest();
  const parts = readTicketPartInputs('ownerPart');
  if (!ticket) return alert('Enter the MHelpDesk reference number.');
  if (workType!=='pickup' && (Number(parts.sim_replacement_qty||0)>0 || Number(parts.micro_sd_qty||0)>0) && (role==='service' || role==='service_it')) return alert('SIM Card Swap and SD/Micro SD Card Replacement must use IT → Service. IT supplies the card(s), then Service verifies them in the handoff.');
  if (workType === 'pickup' && role === 'it') return alert('Pickup starts with Service. Choose Service Department Only, IT + Service Departments, or Service + IT Departments so Service handles the field pickup before IT Intake.');
  const selectedDeviceCount = equipmentManifestDeviceTotal(equipmentManifest);
  const selectedStandCount = equipmentManifestStandTotal(equipmentManifest);
  if (['it','it_service','service_it'].includes(role) && selectedDeviceCount + selectedStandCount < 1) return alert('Choose at least one unit/device or stand in the Equipment & Parts area because this workflow includes IT.');
  const autoSolarPlan=automaticServiceSolarPlan(equipmentManifest,workType);
  if (autoSolarPlan.spotters > 0 && manifestQty(equipmentManifest,'Solar Stand') > 0) return alert('Remove Solar Stand from the IT Stand Area. A Delivery with Solar Spotter automatically assigns the Solar Stand to the Service checkout after IT creates the Service handoff for the Solar Spotter.');
  if (!description) return alert('Enter a short job description so the technician knows what needs to be done.');

  if (ownerAIDispatchPrepared) {
    const missing=ownerAIDispatchMissing(ownerAIDispatchLastParse||{});
    if (missing.length) {
      ownerAIDispatchRender(ownerAIDispatchLastParse||{warnings:[]});
      return alert("AI Dispatch still needs: " + missing.join(", ") + ". Nothing was assigned.");
    }
    const eq=normalizedEquipmentManifest(equipmentManifest).map(r=>r.qty+" × "+equipmentDisplayLabel(r.label)).join(", ") || "No equipment";
    const flow=role==="it_service"?"IT → Service":role==="service_it"?"Service → IT":role==="it"?"IT only":"Service only";
    const techNames=assignees.map(id=>ownerAssignmentProfiles.find(p=>p.user_id===id)?.full_name||ownerAssignmentProfiles.find(p=>p.user_id===id)?.username).filter(Boolean);
    const confirmText="ONSITE VISION CONFIRMATION\n\nMHelpDesk #"+ticket+"\nSite: "+(site||"—")+"\nWork date/time: "+ownerAIScheduleText(scheduledFor,scheduledTime)+"\nJob: "+workType.toUpperCase()+"\nFlow: "+flow+"\nAssigned: "+(techNames.length?techNames.join(", "):"Department queue")+"\nEquipment: "+eq+"\n\nAssign this Tech Check job?";
    if (!confirm(confirmText)) return;
  }

  document.body.classList.add('busy');
  const dualDept = role === 'it_service' || role === 'service_it';
  const orderedRoles = workType === 'pickup' && dualDept ? ['service','it'] : (role === 'service_it' ? ['service','it'] : ['it','service']);
  const targets = dualDept
    ? orderedRoles.flatMap(r => { const ids=assignees.filter(id => ownerAssignmentProfiles.find(p=>p.user_id===id)?.role===r); if(r==='service' && serviceQueueSelected) return [{role:'service',assignee:null}]; return ids.length ? ids.map(id=>({role:r,assignee:id})) : [{role:r,assignee:null}]; })
    : (assignees.length ? assignees.map(id => ({ role, assignee:id })) : [{ role, assignee:null }]);
  const rolesToSend = targets.map(t => t.role);
  const assignmentIds = [];
  const pushAssignmentIds = [];
  for (const target of targets) {
    const targetRole = target.role;
    const { data: assignmentId, error } = await liveDb.rpc('owner_assign_job_v8', {
      p_ticket_no: ticket,
      p_site: site,
      p_assigned_role: targetRole,
      p_assignee_user_id: target.assignee,
      p_requested_unit_count: requestedUnitCount,
      p_unit_summary: [units, unitNumbers ? 'Unit #s: '+unitNumbers : '', standNumbers ? 'Stand / Solar Stand #s: '+standNumbers : ''].filter(Boolean).join(' | '),
      p_job_description: description,
      p_notes: notes,
      p_solar_panel_qty: parts.solar_panel_qty,
      p_battery_replacement_qty: parts.battery_replacement_qty,
      p_camera_replacement_qty: parts.camera_replacement_qty,
      p_sim_replacement_qty: parts.sim_replacement_qty,
      p_micro_sd_qty: parts.micro_sd_qty,
      p_equipment_manifest: equipmentManifest,
      p_requires_it_handoff: workType === 'pickup'
        ? false
        : ((role === 'it_service' && targetRole === 'service') || (role === 'service_it' && targetRole === 'it')),
      p_scheduled_for: scheduledFor,
      p_work_type: workType,
    });
    if (error) { document.body.classList.remove('busy'); return alert(error.message); }
    if (assignmentId && scheduledTime) {
      const { error: timeError } = await liveDb.from('job_assignments').update({ scheduled_time: scheduledTime, updated_at:new Date().toISOString() }).eq('id', assignmentId);
      if (timeError) { document.body.classList.remove('busy'); return alert(timeError.message); }
    }
    if (assignmentId) {
      assignmentIds.push(assignmentId);
      if (!(workType==='pickup' && targetRole==='it')) pushAssignmentIds.push(assignmentId);
    }
  }
  document.body.classList.remove('busy');

  let pushMessage = '';
  let pushed = 0;
  for (const assignmentId of pushAssignmentIds) {
    try {
      const { data: pushResult, error: pushError } = await liveDb.functions.invoke('send-techcheck-push', { body: { assignment_id: assignmentId } });
      if (pushError) throw pushError;
      pushed += Number(pushResult?.sent || 0);
    } catch (pushError) {
      console.warn('Assignment saved but phone push could not be sent', pushError);
    }
  }
  pushMessage = pushed > 0 ? ` Phone notifications sent to ${pushed} device${pushed === 1 ? '' : 's'}.` : ' Tech Check inbox alert created.';

  ownerClearAssignDraft();
  ['ownerAssignTicket','ownerAssignSite','ownerAssignUnitNumbers','ownerAssignStandNumbers','ownerAssignDescription','ownerAssignNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const dateInput=document.getElementById('ownerAssignDate'); if (dateInput) dateInput.value=techCheckDateKey(new Date());
  const timeInput=document.getElementById('ownerAssignTime'); if (timeInput) timeInput.value='';
  const workTypeInput=document.getElementById('ownerAssignWorkType'); if (workTypeInput) workTypeInput.value='service';
  const roleInput=document.getElementById('ownerAssignRole'); if(roleInput) roleInput.value='it';
  const techPills=document.getElementById('ownerAssignedTechPills'); if(techPills) techPills.innerHTML='';
  fillTicketPartInputs({}, 'ownerPart');
  document.querySelectorAll('#ownerJobAssignments [data-owner-equipment-qty]').forEach(input => { input.value='0'; });
  ownerAIDispatchPrepared=false;
  ownerAIDispatchLastParse=null;
  await installOwnerAssignments(true);
  const target = (role === 'it_service' || role === 'service_it') ? (workType === 'pickup' || role === 'service_it' ? 'Service first, then IT Intake' : 'IT first, then Service') : assignees.length > 1 ? `${assignees.length} selected technicians` : assignees.length === 1 ? 'the selected technician' : (role === 'it' ? 'the IT Department queue' : 'the Service Department queue');
  alert('Assigned to ' + target + ' in Tech Check.' + pushMessage + ' MHelpDesk remains unchanged.');
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
  itFinalView='summary';
  await renderItUnitStep();
  alert('Parts list updated.');
}
async function ownerCancelAssignment(id) {
  if (!confirm('Cancel this Tech Check assignment?')) return;
  const { error } = await liveDb.rpc('owner_cancel_job_assignment', { p_assignment_id: id });
  if (error) return alert(error.message);
  await installOwnerAssignments(true);
}


async function installOwnerFieldEscalations(force=false) {
  if(!roleText().includes('Owner/Admin'))return;
  let host=document.getElementById('ownerFieldEscalations');
  if(host&&host.dataset.loaded==='1'&&!force)return;
  if(!host){host=document.createElement('details');host.id='ownerFieldEscalations';host.className='card ownerDashSection';const view=document.getElementById('view-owner');const support=document.getElementById('ownerSupportMounts');const attention=document.getElementById('ownerAttentionCard');if(document.getElementById('ownerApp')&&support)support.append(host);else if(attention)attention.after(host);else view?.prepend(host);}
  const wasOpen=host.open;host.dataset.loaded='1';
  const rows=await fieldEscalationRows();
  const active=rows.filter(r=>!r.resolved_at), ownerNeeded=active.filter(r=>r.status==='unresolved_owner');
  const render=r=>"<div class='wl-ticket'><b>Unit "+esc(r.unit_tag)+" · "+esc(fieldEscalationStatusLabel(r.status))+"</b><div class='small'>MHelpDesk #"+esc(r.ticket_no)+" · "+esc(r.site||"No site")+"</div>"+fieldEscalationHistoryHtml(r)+(r.status==='unresolved_owner'?"<label>Owner decision<textarea id='wlOfflineOwnerResolution_"+r.id+"' rows='3' placeholder='Record the decision / next action.'></textarea></label><button class='wl-big wl-red top10' data-wl-offline-owner-resolve='"+r.id+"'>SAVE OWNER DECISION →</button>":"")+"</div>";
  host.innerHTML="<summary class='ownerDashSummary'><div><b>Offline Unit Escalations</b><span>Service power check → IT troubleshooting → backup / Owner decision</span></div><span class='ownerDashBadge "+(ownerNeeded.length?"alert":"neutral")+"'>"+active.length+"</span></summary><div class='ownerDashBody'>"+
    (ownerNeeded.length?"<div class='wl-stop'><b>OWNER DECISION REQUIRED · "+ownerNeeded.length+"</b><div>These remain visible until you record the decision.</div></div>":"")+
    (active.map(render).join('')||"<div class='ok'><b>✓ No active offline-unit escalation.</b></div>")+
    "<details class='ownerHistoryFold'><summary>Resolved Offline-Unit History <span class='pill'>"+rows.filter(r=>r.resolved_at).length+"</span></summary><div>"+(rows.filter(r=>r.resolved_at).slice(0,30).map(render).join('')||"<div class='small'>No resolved escalation history yet.</div>")+"</div></details></div>";
  host.open=wasOpen||ownerNeeded.length>0;
}
async function resolveOfflineOwnerDecision(id) {
  const button=document.querySelector("[data-wl-offline-owner-resolve='"+id+"']");
  if(button){button.disabled=true;button.textContent='Saving…';}
  const {error}=await liveDb.rpc('owner_resolve_offline_escalation_v1',{p_escalation_id:id,p_resolution:document.getElementById('wlOfflineOwnerResolution_'+id)?.value||''});
  if(error){if(button){button.disabled=false;button.textContent='SAVE OWNER DECISION →';}return alert(error.message);}
  await installOwnerFieldEscalations(true);scheduleOwnerRefresh(true,0);
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
    const support = document.getElementById('ownerSupportMounts');
    const attention = document.getElementById('ownerAttentionCard');
    if (document.getElementById('ownerApp') && support) support.append(host);
    else if (attention) attention.after(host);
    else if (view) view.prepend(host);
  }
  const wasOpen = host.open;
  host.dataset.loaded = '1';
  const currentSearch = document.getElementById('ownerReturnSearch')?.value || '';
  const rows = await returnRows();
  ownerReturnRows = new Map(rows.map(r => [r.id, r]));
  const waitingCount = rows.filter(r => r.status === 'waiting_it').length;
  const managerCount = rows.filter(r => r.status === 'pending_mhelp_inventory').length;
  const replacementCount = rows.filter(r => r.status === 'needs_replacement').length;
  const completedCount = rows.filter(r => r.status === 'completed').length;
  const activeRows = rows.filter(r => r.status !== 'completed');
  const completedRows = rows.filter(r => r.status === 'completed');
  const renderOwnerReturn = r => {
    const record = readIntakeRecord(r.damage_notes);
    const answers = Array.isArray(record.meta?.answers) ? record.meta.answers : [];
    const checks = intakeLabels.map((label, i) => `<div class='small' style='padding:4px 0;border-bottom:1px solid #edf1f4'><b>${answers[i] === true ? '✓ YES' : answers[i] === false ? '✕ NO' : '— PENDING'}</b> · ${esc(label)}</div>`).join('');
    const doc = record.meta?.cancellationDoc;
    const status = r.status === 'waiting_it' ? 'WAITING FOR IT INTAKE' : r.status === 'pending_mhelp_inventory' ? 'PENDING MHELP INVENTORY' : r.status === 'needs_replacement' ? 'NEEDS REPLACEMENT — NOT SHOP INVENTORY' : 'COMPLETED — SHOP INVENTORY';
    const savedTagScan=returnTagScan(r);
    const savedTagScanHtml=savedTagScan ? tagScanStatusHtml(savedTagScan,r.unit_tag) : '';
    const serviceDone = true;
    const itDone = ['pending_mhelp_inventory','needs_replacement','completed'].includes(r.status);
    const managerDone = r.status === 'completed';
    const replacement = r.status === 'needs_replacement';
    const process = replacement
      ? `<div class='ownerProcess'><span class='processStep done'>✓ Service Return</span><span class='processArrow'>→</span><span class='processStep done'>✓ Damage Verified</span><span class='processArrow'>→</span><span class='processStep current'>• Owner / Replacement</span></div>`
      : `<div class='ownerProcess'><span class='processStep done'>✓ Service Return</span><span class='processArrow'>→</span><span class='processStep ${itDone ? 'done' : 'current'}'>${itDone ? '✓' : '•'} IT Intake</span><span class='processArrow'>→</span><span class='processStep ${managerDone ? 'done' : itDone ? 'current' : ''}'>${managerDone ? '✓' : '•'} Manager / MHelpDesk</span></div>`;
    const managerAction = r.status === 'pending_mhelp_inventory'
      ? `<div class='warn top8'><b>Manager action required</b><div class='small'>IT intake is finished. You now add Unit ${esc(r.unit_tag)} back to Shop Inventory in MHelpDesk.</div><button class='mini top8' data-wl-owner-mhelp-done='${r.id}'>Confirm I Added It to MHelpDesk Inventory</button></div>`
      : replacement
        ? `<div class='warn top8'><b>Damaged equipment needs replacement / repair</b><div class='small'>This unit is held in Maintenance and is NOT available Shop Inventory. Review the photos and IT notes below. The final replacement/disposition procedure is MISSING INFORMATION until the Owner defines it.</div></div>`
        : '';
    const searchText = `${r.unit_tag || ''} ${r.equipment_type || ''} ${r.ticket_no || ''} ${r.service_tech_name || ''} ${r.it_tech_name || ''}`;
    return `<details class='ownerFold' data-owner-return='${r.id}' data-owner-search='${esc(searchText)}'><summary><span><b>Unit ${esc(r.unit_tag)} · ${esc(r.equipment_type || 'Unit')}</b><span class='small ownerFoldHint'>MHelpDesk #${esc(r.ticket_no)}</span>${process}</span><span class='pill ${r.status === 'completed' ? 'delivery' : r.status === 'needs_replacement' ? 'swap' : r.status === 'pending_mhelp_inventory' ? 'amber' : 'swap'}'>${status}</span></summary><div class='ownerFoldBody'>${managerAction}${savedTagScanHtml}<div class='wl-review top8'><b>Chain of Custody</b><div class='small'><b>Service Tech:</b> ${esc(r.service_tech_name || 'Not recorded')} · Submitted ${r.returned_at ? new Date(r.returned_at).toLocaleString() : '—'}</div><div class='small'><b>IT Tech:</b> ${esc(r.it_tech_name || 'Not assigned')}${r.it_received_at ? ` · Intake completed ${new Date(r.it_received_at).toLocaleString()}` : ''}</div>${r.completed_at ? `<div class='small'><b>Manager confirmed MHelpDesk inventory:</b> ${new Date(r.completed_at).toLocaleString()}</div>` : ''}</div>${r.return_notes ? `<div class='warn top8'><b>Service return / damage notes</b><div>${esc(r.return_notes)}</div></div>` : ''}<div class='wl-review top8'><b>IT Intake Checklist — ${answers.filter(v => v === true).length}/${intakeLabels.length} YES</b>${checks}</div>${doc ? `<div class='ok top8'><b>SIM Cancellation Record</b><div class='small'>Date: ${esc(doc.simCanceledDate)} · MHelpDesk #${esc(doc.ticket)} · Unit ${esc(doc.unit)} · IT Tech: ${esc(doc.techName || r.it_tech_name || 'IT')} (${esc(doc.techInitials)})</div></div>` : ''}${record.notes ? `<div class='wl-note top8'><b>IT intake notes</b><div>${esc(record.notes)}</div></div>` : ''}<div class='small top8'><b>Service Return / Site / Damage Photos</b></div><div class='wl-return-gallery' data-owner-service-photos='${r.id}'><div class='wl-note'>Photos load when this record is opened.</div></div><div class='small top8'><b>IT Intake Photo</b></div><div class='wl-return-gallery' data-owner-intake-photos='${r.id}'><div class='wl-note'>Photo loads when this record is opened.</div></div>${replacement?`<div class='wl-stop top8'><b>DAMAGE HOLD LOCKED</b><div>This record cannot be removed or returned to Shop Inventory while it is marked Needs Replacement. <b>MISSING INFORMATION:</b> final repair / replacement disposition has not been defined yet.</div></div>`:`<button class='mini danger top8' data-wl-owner-remove-return='${r.id}' data-wl-unit='${esc(r.unit_tag)}' data-wl-ticket='${esc(r.ticket_no)}'>Remove from Tracking</button>`}</div></details>`;
  };

  const activeItems = activeRows.map(renderOwnerReturn);
  const completedItems = completedRows.map(renderOwnerReturn);
  host.innerHTML = `<summary class='ownerDashSummary'>
    <div><b>Returns & Intake</b><span>Returned units, IT intake, and manager follow-up</span></div>
    <span id='ownerIntakeBadge' class='ownerDashBadge ${activeRows.length ? 'alert' : 'neutral'}'>${activeRows.length}</span>
  </summary>
  <div class='ownerDashBody'>
    <div class='ownerWorkTools'>
      <div class='wl-workstrip'><span><b>${waitingCount}</b> waiting IT</span><span><b>${managerCount}</b> need manager</span><span><b>${replacementCount}</b> need replacement</span><span><b>${completedCount}</b> completed</span></div>
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
  const offlineOwner=e.target.closest('[data-wl-offline-owner-resolve]');if(offlineOwner)return resolveOfflineOwnerDecision(offlineOwner.dataset.wlOfflineOwnerResolve);
  const ownerSummary=e.target.closest('#view-owner summary.ownerDashSummary');
  if(ownerSummary){
    const details=ownerSummary.parentElement;
    if(details?.tagName==='DETAILS'){
      e.preventDefault();
      details.open=!details.open;
      return;
    }
  }
  if (e.target.closest('#techMenuButton')) return openTechMenu();
  if (e.target.closest('[data-wl-menu-close]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-menu-help]')) return openHelpCenter();
  if (e.target.closest('[data-wl-menu-phone-alerts]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return enableBrowserAlerts(); }
  if (e.target.closest('[data-wl-menu-refresh]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); await window.refreshData?.(); return; }
  if (e.target.closest('[data-wl-menu-ai-dispatch]')) return openOwnerAIDispatch();
  if (e.target.closest('#helpTrainingButton')) return openHelpCenter();
  const helpRole=e.target.closest('[data-wl-help-role]'); if(helpRole) return renderHelpCenter(helpRole.dataset.wlHelpRole);
  const helpTopic=e.target.closest('[data-wl-help-topic]'); if(helpTopic) return renderHelpTopic(helpTopic.dataset.wlHelpTopic);
  if(e.target.closest('[data-wl-help-center]')) return renderHelpCenter(helpCenterRole);
  if(e.target.closest('[data-wl-help-walkthrough]')) return openHelpWalkthrough(false,helpCenterRole);
  if(e.target.closest('[data-wl-help-show-step]')) return showHelpStepInApp();
  if(e.target.closest('[data-wl-help-coach-return]')){
    document.getElementById('wlHelpCoachToast')?.classList.remove('show');
    return renderHelpWalkthrough();
  }
  if (e.target.closest('[data-wl-help-close]')) { document.getElementById('wlHelpOverlay')?.classList.add('hidden'); document.getElementById('wlHelpCoachToast')?.classList.remove('show'); return; }
  const ownerEditEquipment=e.target.closest('[data-owner-edit-equipment]');
  if(ownerEditEquipment){
    const row=ownerEditEquipment.closest('.wl-assignment-row');
    const editor=row?.querySelector('[data-owner-equipment-editor]');
    if(editor)editor.classList.toggle('hidden');
    return;
  }
  if(e.target.closest('[data-owner-cancel-equipment]')){
    const editor=e.target.closest('[data-owner-equipment-editor]');
    if(editor)editor.classList.add('hidden');
    return;
  }
  const ownerSaveEquipment=e.target.closest('[data-owner-save-equipment]');
  if(ownerSaveEquipment)return ownerSaveEquipmentQuantities(ownerSaveEquipment);
  const heliosReview=e.target.closest('[data-wl-owner-helios-review]'); if(heliosReview) return ownerOpenHeliosFinalReview(heliosReview.dataset.wlOwnerHeliosReview);
  const heliosVerify=e.target.closest('[data-wl-owner-helios-verify]'); if(heliosVerify) return ownerVerifyHeliosFinal(heliosVerify.dataset.wlOwnerHeliosVerify);
  if(e.target.closest('[data-wl-owner-helios-close]')) { document.getElementById('ownerHeliosFinalReview')?.remove(); return; }
  if (e.target.closest('[data-wl-help-skip]')) { walkthroughDismissedSession = true; document.getElementById('wlHelpOverlay')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-help-prev]')) { helpWalkthroughStep = Math.max(0, helpWalkthroughStep - 1); return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-help-next]')) { const steps=helpStepsForRole(helpWalkthroughRole || currentRoleKey()); if (helpWalkthroughStep >= steps.length - 1) return completeHelpWalkthrough(); helpWalkthroughStep++; return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-enable-browser-alerts]')) return enableBrowserAlerts();
  const assigned = e.target.closest('[data-wl-start-assignment]');
  if (assigned) return startAssignedJob(assigned.dataset.wlStartAssignment);
  const ownerHome=e.target.closest('[data-owner-compact-home]');
    if(ownerHome){ownerShowHome();return;}
    const ownerPanel=e.target.closest('[data-owner-home-panel]');
    if(ownerPanel){ownerShowGroup(ownerPanel.dataset.ownerHomePanel);return;}
    if (e.target.closest('[data-owner-compact-assign]')) {
      ownerShowGroup('Assign');
      const form=document.getElementById('ownerJobAssignments');
      if(form){form.dataset.ownerExplicitOpen='1';form.open=true;requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));}
      return;
    }
    const ownerWorkPill=e.target.closest('[data-owner-work-pill]');
    if(ownerWorkPill){
      const input=document.getElementById('ownerAssignWorkType');
      if(input){input.value=ownerWorkPill.dataset.ownerWorkPill||'service';input.dataset.ownerConfirmed='1';refreshOwnerWorkTypeLabels();refreshOwnerAutoServicePlan();refreshOwnerAssignmentTechOptions();ownerSaveAssignDraftNow();ownerAIReview();}
      return;
    }
    const ownerRolePill=e.target.closest('[data-owner-role-pill]');
    if(ownerRolePill){
      const input=document.getElementById('ownerAssignRole');
      if(input){input.value=ownerRolePill.dataset.ownerRolePill||'it';input.dataset.ownerConfirmed='1';refreshOwnerAssignmentTechOptions();syncOwnerSimplePills();ownerSaveAssignDraftNow();ownerAIReview();}
      return;
    }
    if (e.target.closest('[data-owner-compact-attention]')) {
      ownerShowGroup('Jobs');
      const card=document.getElementById('ownerAttentionCard');
      if(card){card.open=true;requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'start'}));}
      return;
    }
    if (e.target.closest('[data-owner-ai-dispatch-build]')) return ownerAIDispatchBuild();
  if (e.target.closest('[data-owner-ai-dispatch-voice]')) return ownerAIDispatchStartVoice();
  if (e.target.closest('[data-owner-ai-review]')) return ownerAIReview();
  if (e.target.closest('[data-wl-owner-assign]')) return ownerAssignJob();
  if (e.target.closest('[data-wl-save-prep-parts]')) return saveActivePrepParts();
  const cancelAssignment = e.target.closest('[data-wl-cancel-assignment]');
  if (cancelAssignment) return ownerCancelAssignment(cancelAssignment.dataset.wlCancelAssignment);
});
document.addEventListener('change', e => {
  if (e.target?.id === 'ownerAssignRole') { e.target.dataset.ownerConfirmed='1'; refreshOwnerAssignmentTechOptions(); }
  if (e.target?.id === 'ownerAssignDate') e.target.dataset.ownerConfirmed='1';
  if (e.target?.id === 'ownerAssignTime') e.target.dataset.ownerConfirmed='1';
  if (e.target?.id === 'ownerAssignWorkType') { e.target.dataset.ownerConfirmed='1'; refreshOwnerWorkTypeLabels(); refreshOwnerAutoServicePlan(); refreshOwnerAssignmentTechOptions(); }
  if (e.target?.id === 'ownerAssignWorkType') refreshOwnerAutoServicePlan();
  if(e.target?.closest?.('#ownerJobAssignments')&&e.target?.matches?.('input,select,textarea')) {
    if(e.target?.id==='ownerPartSimReplacements'||e.target?.id==='ownerPartMicroSdCards'){
      const parts=readTicketPartInputs('ownerPart'),role=document.getElementById('ownerAssignRole'),workType=document.getElementById('ownerAssignWorkType')?.value||'service';
      if(workType!=='pickup'&&(Number(parts.sim_replacement_qty||0)>0||Number(parts.micro_sd_qty||0)>0)&&role&&(role.value==='service'||role.value==='service_it')){
        role.value='it_service';role.dataset.ownerConfirmed='1';refreshOwnerAssignmentTechOptions();syncOwnerSimplePills();
      }
    }
    ownerSaveAssignDraftNow();ownerAIReview();
  }
});

document.addEventListener('input', e => { if (e.target?.id === 'ownerReturnSearch') filterOwnerReturns(e.target.value); if (e.target?.matches?.('[data-owner-equipment-qty]')) refreshOwnerAutoServicePlan(); if(e.target?.closest?.('#ownerJobAssignments')&&e.target?.matches?.('input,textarea')) {ownerSaveAssignDraftNow();ownerAIReview();} if (e.target?.id === 'wlReturnTicket') { serviceReturn.ticket=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnUnit') { if(norm(e.target.value)!==norm(serviceReturn.unit)){serviceReturn.photo=null;serviceReturn.tagScan=null;} serviceReturn.unit=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnNotes') { serviceReturn.notes=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('change', e => { if(e.target?.id==='wlOfflineKnownUnit'){const card=document.getElementById('wlOfflineUnitForm');let units=[];try{units=JSON.parse(card?.dataset.units||'[]');}catch{}const u=units[Number(e.target.value)]||{};const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};set('wlOfflineTicket',u.ticket_no);set('wlOfflineSite',u.site);set('wlOfflineUnit',u.unit_tag);set('wlOfflineType',u.equipment_type);} if (e.target?.id === 'wlReturnType') { if(serviceReturn.type!==e.target.value){serviceReturn.photo=null;serviceReturn.tagScan=null;} serviceReturn.type=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if(e.target?.id==='ownerUnitLookupInput'){e.preventDefault();ownerLookupUnitHistory();return;} if (e.target?.id === 'wlItUnitValue' || e.target?.id === 'wlReconRequired') { e.preventDefault(); document.querySelector('#wlItWizardOnly [data-wl-it-next]')?.click(); return; } if (e.target?.id === 'wlSvcCount') { e.preventDefault(); document.querySelector('#wlSvcWizardOnly [data-wl-svc-next]')?.click(); return; } if (e.target?.id === 'wlTicketInput') { e.preventDefault(); document.querySelector('[data-wl-match]')?.click(); return; } if (e.target?.id === 'wlReturnTicket' || e.target?.id === 'wlReturnUnit') { e.preventDefault(); document.querySelector('#wlSvcReturn [data-wl-return-next]')?.click(); } });
document.addEventListener('click',e=>{if(e.target.closest('[data-owner-retry-live]')){e.preventDefault();scheduleOwnerRefresh(true,0);}},true);
document.addEventListener('toggle', e => {
  if(e.target?.id==='ownerJobAssignments'&&e.target.open){const live=document.getElementById('ownerLiveJobProgress');if(live)live.open=false;}
  if(e.target?.id==='ownerLiveJobProgress'&&e.target.open){const create=document.getElementById('ownerJobAssignments');if(create)create.open=false;}
  const ownerDetails = e.target?.matches?.('details[data-owner-return]') ? e.target : null; if (ownerDetails?.open) loadOwnerReturnPhotos(ownerDetails); const serviceDetails = e.target?.matches?.('details[data-svc-return]') ? e.target : null; if (serviceDetails?.open) loadServiceReturnPhotos(serviceDetails); }, true);
let ownerRefreshTimer=null;
let ownerRefreshInFlight=false;
let ownerRefreshQueued=false;
let ownerStartupScheduled=false;
let ownerLastRefreshAt=0;

async function runOwnerRefresh(force=false) {
  if (!roleText().includes('Owner/Admin')) return;
  if (ownerRefreshInFlight) { ownerRefreshQueued=true; return; }
  ownerRefreshInFlight=true;
  try {
    const results=await Promise.allSettled([
      techDashboardTimeout(installOwnerAssignments(force),null,12000),
      techDashboardTimeout(installOwnerIntake(force),null,12000),
      techDashboardTimeout(installOwnerFieldEscalations(force),null,12000)
    ]);
    organizeOwnerDashboard();
    ownerLastRefreshAt=Date.now();
    const failed=results.filter(r=>r.status==='rejected');
    if(failed.length) console.warn('Owner support refresh completed with '+failed.length+' timed-out/failed section(s).');
  } catch (error) {
    console.error('Owner dashboard refresh failed', error);
    const message=esc(error?.message||'Could not load live Tech Check data.');
    const host=document.getElementById('ownerJobAssignments');
    const live=document.getElementById('ownerLiveJobProgress');
    if(host && !host.querySelector('#ownerAssignTicket'))host.innerHTML="<summary class='ownerDashSummary'><div><b>Send Job to Tech</b><span>Create and manage technician assignments</span></div><span class='ownerDashBadge alert'>!</span></summary><div class='ownerDashBody'><div class='bad'><b>Could not load assignments.</b><div class='small'>"+message+"</div><button class='mini top8' type='button' data-owner-retry-live>Retry now</button></div></div>";
    if(live)live.innerHTML="<summary class='ownerDashSummary'><div><b>Live Job Progress</b><span>See what is assigned, who has it, and what is currently being worked</span></div><span class='ownerDashBadge alert'>!</span></summary><div class='ownerDashBody'><div class='bad'><b>Live data did not finish loading.</b><div class='small'>"+message+"</div><button class='mini top8' type='button' data-owner-retry-live>Retry now</button></div></div>";
  } finally {
    ownerRefreshInFlight=false;
    if (ownerRefreshQueued) {
      ownerRefreshQueued=false;
      scheduleOwnerRefresh(true, 180);
    }
  }
}
function scheduleOwnerRefresh(force=false, delay=180) {
  clearTimeout(ownerRefreshTimer);
  ownerRefreshTimer=setTimeout(() => runOwnerRefresh(force), delay);
}
function scheduleOwnerStartupLoad() {
  if (ownerStartupScheduled) return;
  ownerStartupScheduled=true;
  const load=() => runOwnerRefresh(false);
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout:700 });
  else setTimeout(load, 280);
}
window.refreshOwnerIntake = () => scheduleOwnerRefresh(true, 160);
let ownerLiveRealtimeStarted=false;
function setupOwnerLiveRealtime(){
  if(ownerLiveRealtimeStarted)return;
  ownerLiveRealtimeStarted=true;
  const refresh=()=>{if(roleText().includes('Owner/Admin'))scheduleOwnerRefresh(true,140);};
  liveDb.channel('tech-check-owner-dashboard-live-v2')
    .on('postgres_changes',{event:'*',schema:'public',table:'job_assignments'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'prep_tickets'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'prep_items'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'unit_returns'},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},refresh)
    .subscribe();
}
let serviceSolarRealtimeStarted=false;
function setupServiceSolarRealtime() {
  if (serviceSolarRealtimeStarted) return;
  serviceSolarRealtimeStarted=true;
  liveDb.channel('tech-check-service-solar-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'service_solar_checks'},()=>{
      if (roleText().includes('Owner/Admin')) scheduleOwnerRefresh(true,220);
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'service_solar_evidence'},()=>{
      if (roleText().includes('Owner/Admin')) scheduleOwnerRefresh(true,220);
    })
    .subscribe();
}
function boot() {
  injectStyles();
  installTabs();
  setupNotificationRealtime();
  if (roleText().includes('Owner/Admin')) { setupServiceSolarRealtime(); setupOwnerLiveRealtime(); }
  refreshNotificationBadge();
  if (roleText().includes('Owner/Admin')) organizeOwnerDashboard();

  const appVisible = !document.getElementById('appView')?.classList.contains('hidden');
  if (!appVisible) return;

  if (roleText().includes('Owner/Admin')) scheduleOwnerStartupLoad();
  if (isIT() && !viewIT()?.classList.contains('hidden') && !document.getElementById('wlItHome')) showITHome();
  if (isSvc() && !viewSvc()?.classList.contains('hidden') && !document.getElementById('wlSvcHome')) showSvcHome();
  setTimeout(maybeShowFirstTimeWalkthrough, 250);
}
let bootQueued=false;
function scheduleBoot() {
  if (bootQueued) return;
  bootQueued=true;
  requestAnimationFrame(() => { bootQueued=false; boot(); });
}
function handleTechCheckViewChange(event) {
  scheduleBoot();
  if (event?.detail?.view === 'owner' && roleText().includes('Owner/Admin')) {
    if (!ownerStartupScheduled) scheduleOwnerStartupLoad();
    else if (Date.now()-ownerLastRefreshAt > 15000) scheduleOwnerRefresh(true,160);
  }
}
window.addEventListener('techcheck:app-ready', scheduleBoot);
window.addEventListener('techcheck:view-changed', handleTechCheckViewChange);

let lastLifecycleRefresh=0;
function refreshAfterResume() {
  if (document.hidden) return;
  const now=Date.now();
  if (now-lastLifecycleRefresh < 15000) return;
  lastLifecycleRefresh=now;
  scheduleBoot();
  if (roleText().includes('Owner/Admin')) scheduleOwnerRefresh(true,220);
}
document.addEventListener('visibilitychange', refreshAfterResume);
window.addEventListener('focus', refreshAfterResume);
window.addEventListener('beforeunload', ownerSaveAssignDraftNow);
boot();

// ASSIGNMENT_NOTIFICATION_PUBLISH_STAMP_V1

// OWNER_ASSIGNMENT_TOP_CARD_V2
