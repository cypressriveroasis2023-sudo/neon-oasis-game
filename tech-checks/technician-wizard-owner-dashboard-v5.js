import './it-prep-view-v1.js?v=6';
import './handoff-evidence-view-v1.js?v=3';
import './handoff-evidence-shared-v1.js?v=5';
import './it-prep-wizard-v1.js?v=13';
import './it-prep-rules-v1.js?v=3';
import './it-prep-shared-v1.js?v=9';
import './truck-spares-shared-v1.js?v=1';
import './it-intake-wizard-v1.js?v=2';
import './intake-shared-v1.js?v=1';
import './notifications-v1.js?v=1';
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
let serviceQuestionAdvancing = false;
let svcSolarCursor = null;
let svcHeliosFieldCursor = null;
let heliosFieldAnswerSubmitting = false;
let inspection = { step: 0, truck: Array(8).fill(null), takingTrailer: null, trailer: Array(7).fill(null) };
let inspectionRecovered = false;
let inspectionSubmitting = false;
let serviceTruckInventorySubmitting = false;
let serviceTruckUsageSubmitting = false;
let serviceReturn = { step: 0, ticket: '', unit: '', type: '', notes: '', noTag:false, photo: null, tagScan: null, conditionPhotos: [], damagePhotos: [], knownUnits: [], submissionId:null, pendingUploadPaths:[] };
let serviceReturnRecovered = false;
let serviceReturnSubmitting = false;
let serviceCloseSubmitting = false;
const FIELD_DRAFT_TTL = 24 * 60 * 60 * 1000;
async function deviceDraftKey(kind) { const tech=await currentTechIdentity().catch(()=>null); return tech?.id ? `cos-tech-field-draft-v1:${tech.id}:${kind}` : ''; }
async function saveDeviceDraft(kind, payload) { const key = await deviceDraftKey(kind); if (!key) return; try { localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() })); } catch {} }
async function loadDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (!key) return null; try { const value=JSON.parse(localStorage.getItem(key)||'null'); if (!value) return null; if (Date.now()-Number(value.savedAt||0)>FIELD_DRAFT_TTL) { localStorage.removeItem(key); return null; } return value; } catch { return null; } }
async function clearDeviceDraft(kind) { const key = await deviceDraftKey(kind); if (key) try { localStorage.removeItem(key); } catch {} }
function saveInspectionDraft() { return saveDeviceDraft('inspection',{ step:inspection.step, truck:[...inspection.truck], takingTrailer:inspection.takingTrailer, trailer:[...inspection.trailer] }); }
function saveServiceReturnDraft() { return saveDeviceDraft('service-return',{ step:serviceReturn.step, ticket:serviceReturn.ticket, unit:serviceReturn.unit, type:serviceReturn.type, notes:serviceReturn.notes, noTag:Boolean(serviceReturn.noTag), offlineEscalationId:serviceReturn.offlineEscalationId||null, submissionId:serviceReturn.submissionId||null, pendingUploadPaths:Array.isArray(serviceReturn.pendingUploadPaths)?serviceReturn.pendingUploadPaths:[] }); }
const intakeLabels = window.TechCheckITIntake.labels;
let intakeWizard = window.TechCheckITIntake.getState();
let ownerReturnRows = new Map();
let serviceReturnRows = new Map();
const readIntakeRecord = (...args) => window.TechCheckIntake.readRecord(...args);
const writeIntakeRecord = (...args) => window.TechCheckIntake.writeRecord(...args);
const intakeDocumentation = (...args) => window.TechCheckIntake.documentation(...args);

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

    /* Simple technician training v93 */
    .wl-help-simple-card{min-height:430px;margin-top:12px;padding:22px 18px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:2px solid #dce4ea;border-top:7px solid #d20b12;border-radius:24px;background:#fff;box-shadow:0 8px 24px rgba(16,24,32,.07)}
    .wl-help-simple-role{margin-bottom:14px;padding:8px 16px;border-radius:999px;background:#101820;color:#fff;font-size:13px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}
    .wl-help-simple-number{width:78px;height:78px;margin-bottom:16px;display:grid;place-items:center;border-radius:999px;background:#d20b12;color:#fff;font-size:38px;font-weight:950;box-shadow:0 8px 18px rgba(210,11,18,.24)}
    .wl-help-simple-card .wl-next-kicker{color:#d20b12!important;font-size:13px!important;letter-spacing:.13em!important;font-weight:950!important}
    .wl-help-simple-card h2{max-width:560px;margin:7px 0 18px!important;color:#101820!important;font-size:27px!important;line-height:1.08!important}
    .wl-help-simple-instruction{max-width:590px;color:#213445;font-size:27px;line-height:1.28;font-weight:900}
    .wl-help-simple-show{width:100%;min-height:64px;margin:24px 0 0;padding:12px 18px;border:2px solid #101820;border-radius:999px;background:#fff;color:#101820;font:inherit;font-size:16px;font-weight:950}
    .wl-help-simple-nav{grid-template-columns:1fr 1.65fr!important;gap:12px!important;margin-top:16px!important}
    .wl-help-simple-nav button{min-height:68px!important;border-radius:999px!important;font-size:17px!important;font-weight:950!important}
    .wl-help-simple-nav .wl-prev{background:#fff!important;border:2px solid #cfd9e1!important;color:#35495a!important}
    .wl-help-simple-nav .wl-next{border:2px solid #d20b12!important;background:#d20b12!important;color:#fff!important}
    .wl-help-simple-nav .wl-finish{border-color:#16844a!important;background:#16844a!important}
    .wl-help-simple-skip{width:100%;min-height:46px;margin:10px 0 0;border:0;background:transparent;color:#647482;font:inherit;font-size:13px;font-weight:850;text-decoration:underline}
    @media(max-width:430px){
      .wl-help-simple-card{min-height:390px;padding:18px 14px;border-radius:20px}
      .wl-help-simple-number{width:68px;height:68px;font-size:33px}
      .wl-help-simple-card h2{font-size:23px!important}
      .wl-help-simple-instruction{font-size:24px}
      .wl-help-simple-show{min-height:60px;font-size:14px}
      .wl-help-simple-nav button{min-height:64px!important;font-size:15px!important}
    }

    /* In-app guided tutorial v94 */
    .wl-guided-tour{position:fixed;inset:0;z-index:2147483000;pointer-events:none}.wl-guided-tour.hidden{display:none!important}
    .wl-tour-shade{position:fixed;background:rgba(4,12,20,.70);pointer-events:auto}
    .wl-tour-blocker{position:fixed;z-index:1;background:transparent;pointer-events:auto}
    .wl-guided-tour-target{position:relative!important;z-index:10039!important;outline:4px solid #fff!important;outline-offset:4px!important;box-shadow:0 0 0 8px #d20b12,0 14px 40px rgba(0,0,0,.34)!important;border-radius:16px!important}
    .wl-tour-tip{--tour-arrow-x:50%;position:fixed;z-index:4;box-sizing:border-box;padding:16px;border:2px solid #e31821;border-radius:20px;background:#08151d;color:#f4f8fa;box-shadow:0 18px 50px rgba(0,0,0,.34);pointer-events:auto}.wl-tour-tip:before{display:none!important}
    .wl-tour-tip-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.wl-tour-tip-head span{padding:6px 10px;border-radius:999px;background:#101820;color:#fff;font-size:11px;font-weight:950;letter-spacing:.06em}
    .wl-tour-tip-head button{width:38px;height:38px;margin:0;border:1px solid #39515d;border-radius:999px;background:#142630;color:#e8f1f5;font-size:25px;line-height:1;font-weight:800}
    .wl-tour-tip h3{margin:12px 0 7px!important;color:#ff4249!important;font-size:22px!important;line-height:1.08!important}.wl-tour-tip p{margin:0;color:#d7e2e8;font-size:17px;line-height:1.35;font-weight:750}
    .wl-tour-nav{display:grid;grid-template-columns:1fr 1.6fr;gap:9px;margin-top:15px}.wl-tour-nav button{min-height:56px;margin:0;border-radius:999px;font:inherit;font-size:14px;font-weight:950}.wl-tour-nav button:first-child{border:2px solid #4b606b;background:#101e25;color:#eef5f7}.wl-tour-nav button:last-child{border:2px solid #d20b12;background:#d20b12;color:#fff}.wl-tour-nav button:disabled{opacity:.35}
    @media(max-width:430px){.wl-tour-tip{padding:14px;border-radius:18px}.wl-tour-tip h3{font-size:19px!important}.wl-tour-tip p{font-size:15px}.wl-tour-nav button{min-height:54px;font-size:13px}}


    .wl-menu-overlay{position:fixed;inset:0;background:rgba(4,17,29,.72);z-index:16000;display:flex;align-items:flex-end;justify-content:center;padding:14px}.wl-menu-overlay.hidden{display:none!important}.wl-menu-sheet{width:min(620px,100%);max-height:90vh;overflow:auto;background:#f7f9fb;border-radius:22px 22px 14px 14px;box-shadow:0 18px 60px rgba(0,0,0,.28);padding:18px}.wl-menu-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.wl-menu-head h2{margin:2px 0 0;font-size:28px}.wl-app-menu-list{display:grid;gap:10px;margin-top:14px}.wl-app-menu-item{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;border:1px solid #d5dfe6;border-radius:14px;background:#fff;padding:14px;text-align:left;color:#172839}.wl-app-menu-item span:nth-child(2) b,.wl-app-menu-item span:nth-child(2) small{display:block}.wl-app-menu-item span:nth-child(2) small{margin-top:3px;color:#687887;font-weight:600}.wl-app-menu-item>strong{color:#687887}.wl-app-menu-icon{width:38px;height:38px;border-radius:11px;background:#0b2a3f;color:#fff;display:grid;place-items:center;font-size:18px;font-weight:950}.wl-menu-future{margin-top:14px;padding:13px;border:1px dashed #bfcbd4;border-radius:13px;background:#eef3f6}.techMenuMini{white-space:nowrap}
    .wl-tech-menu-dark{background:rgba(0,8,14,.82)!important}
    .wl-tech-menu-dark .wl-menu-sheet{background:#08151d!important;color:#f4f8fa!important;border:1px solid #2b414d!important;box-shadow:0 24px 70px rgba(0,0,0,.58)!important}
    .wl-tech-menu-dark .wl-menu-head{padding-bottom:12px;border-bottom:1px solid #263b46}
    .wl-tech-menu-dark .wl-menu-head h2{color:#fff!important}
    .wl-tech-menu-dark .wl-next-kicker{color:#ff343b!important}
    .wl-tech-menu-dark .wl-menu-close-btn{background:#142630!important;color:#e8f1f5!important;border:1px solid #39515d!important}
    .wl-tech-menu-dark .wl-app-menu-list{gap:9px}
    .wl-tech-menu-dark .wl-app-menu-item{background:#101e25!important;color:#f1f6f8!important;border:1px solid #334954!important;box-shadow:none!important}
    .wl-tech-menu-dark .wl-app-menu-item b{color:#fff!important}
    .wl-tech-menu-dark .wl-app-menu-item small{color:#9eb0ba!important}
    .wl-tech-menu-dark .wl-app-menu-item>strong{color:#aebdc5!important}
    .wl-tech-menu-dark .wl-app-menu-icon{background:#e31821!important;color:#fff!important}
    .wl-tech-menu-dark .wl-menu-section-label{margin:14px 3px 7px;color:#ff4b52;font-size:10px;font-weight:950;letter-spacing:.14em;text-transform:uppercase}
    .wl-tech-menu-dark .wl-menu-signout{border-color:#8d3439!important;background:#33181c!important}


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
  s.textContent += `
    #view-it{color:#fff!important}
    #view-it .wl-it-simple-home,
    #view-it .wl-it-simple-card,
    #view-it #wlItWizardOnly,
    #view-it #wlIntakeForm,
    #view-it #wlPendingList,
    #view-it #wlIntakeList,
    #view-it #wlItStatus{
      max-width:820px!important;margin:18px auto!important;padding:18px!important;
      background:#071117!important;border:1px solid #263943!important;border-radius:16px!important;
      color:#fff!important;box-shadow:0 18px 45px rgba(0,0,0,.28)!important
    }
    #view-it .wl-it-simple-shell{text-align:center;padding:28px 10px 10px}
    #view-it .wl-it-simple-kicker,
    #view-it .wl-it-step-label,
    #view-it .qnum{color:#ff343b!important;font-size:13px!important;font-weight:950!important;letter-spacing:.12em!important}
    #view-it .wl-it-simple-shell h1{margin:10px 0 8px!important;color:#fff!important;font-size:clamp(34px,7vw,64px)!important;line-height:1!important;font-weight:1000!important;letter-spacing:-.04em!important}
    #view-it .wl-it-simple-shell p{margin:0 auto 24px!important;max-width:650px;color:#c7d1d6!important;font-size:20px!important;font-weight:800!important;line-height:1.35!important}
    #view-it .wl-it-start{
      width:100%!important;min-height:82px!important;border:1px solid #ff3b42!important;border-radius:12px!important;
      background:#e31821!important;color:#fff!important;font-size:24px!important;font-weight:1000!important;letter-spacing:.02em!important;
      box-shadow:0 10px 28px rgba(227,24,33,.22)!important
    }
    #view-it .wl-it-flowline{margin:20px 0;color:#82949e!important;font-size:12px!important;font-weight:900!important;letter-spacing:.05em!important}
    #view-it .wl-it-flowline b{color:#ff343b!important;padding:0 5px}
    #view-it .wl-it-more{margin-top:26px;border-top:1px solid #263943;padding-top:12px;text-align:left}
    #view-it .wl-it-more summary{cursor:pointer;color:#8fa2ad;font-size:11px;font-weight:900;letter-spacing:.1em;text-align:center}
    #view-it .wl-it-more-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
    #view-it .wl-it-more-grid button,
    #view-it .wl-back,
    #view-it .wl-service-backstep{min-height:46px!important;border:1px solid #334954!important;border-radius:9px!important;background:#101e25!important;color:#dce6ea!important;font-weight:900!important}
    #view-it .wl-back{width:auto!important;padding:0 16px!important;margin:0 0 16px!important}
    #view-it .wl-head{background:#0b1920!important;border:1px solid #2a414d!important;color:#fff!important;border-radius:12px!important}
    #view-it .wl-head h2{color:#fff!important;font-size:clamp(24px,5vw,38px)!important;font-weight:1000!important}
    #view-it .wl-head .kicker{color:#ff343b!important;font-weight:950!important}
    #view-it .wl-progress{background:#24343d!important}
    #view-it .wl-progress span{background:#e31821!important}
    #view-it .wl-question,
    #view-it .wl-review,
    #view-it .wl-ticket,
    #view-it .wl-proof{background:#0b1920!important;border:1px solid #2a414d!important;color:#fff!important;border-radius:14px!important}
    #view-it .wl-question .qtext{color:#fff!important;font-size:clamp(25px,5.4vw,42px)!important;line-height:1.12!important;font-weight:1000!important;text-transform:uppercase!important}
    #view-it .wl-options{grid-template-columns:1fr 1fr!important;gap:12px!important}
    #view-it .wl-options button{min-height:86px!important;border-radius:12px!important;font-size:24px!important;font-weight:1000!important}
    #view-it .wl-options .pass{background:#fff!important;border:2px solid #fff!important;color:#0b1115!important}
    #view-it .wl-options .fail{background:#e31821!important;border:2px solid #ff444b!important;color:#fff!important}
    #view-it input,#view-it select,#view-it textarea{
      min-height:62px!important;background:#02080c!important;border:2px solid #39515d!important;border-radius:10px!important;
      color:#fff!important;font-size:22px!important;font-weight:900!important;padding:10px 14px!important
    }
    #view-it input::placeholder{color:#60737d!important}
    #view-it .wl-stop{background:#2a0d10!important;border:2px solid #e31821!important;color:#fff!important;border-radius:12px!important;font-size:16px!important}
    #view-it .wl-stop b{color:#ff5a60!important;font-size:20px!important}
    #view-it .wl-it-ticket-entry{text-align:center;padding:28px!important}
    #view-it .wl-it-ticket-entry input{width:100%!important;text-align:center!important;font-size:32px!important;letter-spacing:.06em!important}
    #view-it .wl-it-help{margin-top:12px;color:#8497a1!important;font-size:13px!important;font-weight:700!important;text-align:center}
    #view-it .wl-it-ticket-found{margin-top:14px;padding:24px;background:#0b1920;border:1px solid #2a414d;border-radius:14px;text-align:center}
    #view-it .wl-it-ticket-number{font-size:clamp(38px,8vw,66px);font-weight:1000;color:#fff;line-height:1;margin:10px 0}
    #view-it .wl-it-ticket-site{font-size:22px;font-weight:900;color:#cbd5da;margin-bottom:8px}
    #view-it .wl-it-job-type{display:inline-block;margin-bottom:16px;padding:6px 12px;border:1px solid #425966;border-radius:999px;color:#fff;font-size:12px;font-weight:950}
    #view-it .wl-it-good{padding:16px;border:1px solid #4d6977;border-radius:10px;background:#101e25;color:#fff;font-size:20px;font-weight:1000;text-align:center}
    #view-it .wl-it-wait{padding:16px;border:2px solid #e31821;border-radius:10px;background:#2a0d10;color:#fff;font-size:20px;font-weight:1000;text-align:center}
    #view-it .wl-it-escalate{width:100%;min-height:54px;border:1px solid #ff4a51;border-radius:9px;background:#e31821;color:#fff;font-weight:1000}
    #view-it .wl-nav{background:#071117!important}
    #view-it .wl-next{background:#e31821!important;color:#fff!important}
    #view-it .wl-prev{background:#101e25!important;border:1px solid #334954!important;color:#dce6ea!important}
    #view-it .small,#view-it .wl-note{color:#a8b7be!important}
    @media(max-width:560px){
      #view-it .wl-it-simple-home,#view-it .wl-it-simple-card,#view-it #wlItWizardOnly,#view-it #wlIntakeForm,#view-it #wlPendingList,#view-it #wlIntakeList,#view-it #wlItStatus{margin:8px 0!important;padding:12px!important;border-radius:12px!important}
      #view-it .wl-it-simple-shell{padding:20px 4px 8px}
      #view-it .wl-it-start{min-height:76px!important;font-size:22px!important}
      #view-it .wl-options button{min-height:78px!important;font-size:22px!important}
      #view-it .wl-it-more-grid{grid-template-columns:1fr}
      #view-it .wl-nav{position:static!important;padding-top:8px!important}
    }
  `;
  s.textContent += `
    /* IT DESKTOP WORKSPACE NORMALIZATION v20260923z
       Work pages are desktop application screens, not oversized mobile cards. */
    @media(min-width:901px){
      #view-it{padding:0 24px 32px!important;box-sizing:border-box!important}
      #view-it .wl-it-simple-card,
      #view-it #wlItWizardOnly,
      #view-it #wlIntakeForm,
      #view-it #wlPendingList,
      #view-it #wlIntakeList,
      #view-it #wlItStatus{
        width:min(1240px,calc(100% - 24px))!important;
        max-width:1240px!important;
        margin:18px 0 18px 0!important;
        padding:24px!important;
        border-radius:12px!important;
        box-sizing:border-box!important;
        box-shadow:0 10px 28px rgba(0,0,0,.18)!important
      }
      #view-it #wlItTruckInventory,
      #view-it #wlItTruckRestock,
      #view-it #wlITManagedTickets,
      #view-it #wlITManagedTicketEditor,
      #view-it #wlITOpsCreate,
      #view-it #wlITTicketHistory{
        width:min(1400px,calc(100% - 24px))!important;
        max-width:1400px!important;
        margin-left:auto!important;
        margin-right:auto!important
      }
      #view-it #wlItJobLookup{width:min(860px,calc(100% - 24px))!important;max-width:860px!important}
      #view-it #wlPendingList,#view-it #wlItStatus{width:min(1100px,calc(100% - 24px))!important;max-width:1100px!important}
      #view-it #wlItIntake{
        width:min(1240px,calc(100% - 24px))!important;
        max-width:1240px!important;
        margin:18px 0!important;
        padding:24px!important;
        box-sizing:border-box!important
      }
      #view-it .wl-head{padding:15px 18px!important;margin-bottom:14px!important}
      #view-it .wl-head h2{font-size:28px!important;line-height:1.12!important}
      #view-it .wl-head .kicker,#view-it .wl-it-step-label{font-size:11px!important}
      #view-it .wl-title{font-size:28px!important;line-height:1.15!important}
      #view-it .wl-sub{font-size:14px!important;line-height:1.45!important;max-width:760px!important}
      #view-it input,#view-it select,#view-it textarea{
        min-height:46px!important;
        font-size:15px!important;
        font-weight:750!important;
        padding:9px 12px!important;
        border-width:1px!important
      }
      #view-it textarea{min-height:88px!important}
      #view-it .wl-big,
      #view-it .wl-it-start,
      #view-it .wl-it-escalate{
        width:auto!important;
        min-height:44px!important;
        border-radius:8px!important;
        padding:10px 16px!important;
        font-size:14px!important;
        line-height:1.15!important;
        box-shadow:none!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important
      }
      #view-it .wl-it-ops-actions{align-items:center!important}
      #view-it .wl-it-ops-actions .wl-big{flex:0 0 auto!important}
      #view-it .wl-it-ticket-entry{
        max-width:760px!important;
        padding:22px!important;
        text-align:left!important
      }
      #view-it .wl-it-ticket-entry .qtext{font-size:24px!important;margin:4px 0 14px!important;text-align:left!important}
      #view-it .wl-it-ticket-entry input{width:min(520px,100%)!important;font-size:18px!important;text-align:left!important;letter-spacing:0!important}
      #view-it .wl-it-ticket-entry .wl-it-help{text-align:left!important}
      #view-it .wl-menu{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important;max-width:1100px!important}
      #view-it .wl-menu button{
        width:100%!important;
        min-height:72px!important;
        padding:14px 16px!important;
        border-radius:10px!important;
        font-size:15px!important;
        box-shadow:none!important
      }
      #view-it #wlItIntake .wl-mode-pills{max-width:760px!important}
      #view-it #wlItIntake .wl-mode-card{min-height:68px!important}
      #view-it .wl-it-ops-form{max-width:1180px!important}
      #view-it .wl-it-ops-form .grid2{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      #view-it .wl-it-ops-form .grid3{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      #view-it .wl-it-ops-ticket-list{max-width:1180px!important}
      #view-it .wl-it-ops-ticket{padding:16px!important}
      #view-it .wl-it-attn{max-width:980px!important;padding:14px!important}
      #view-it .wl-it-attn-row{padding:11px 12px!important}
      #view-it .wl-it-cal-page{width:min(1500px,calc(100% - 32px));max-width:1500px;margin:0 auto;padding:8px 0 32px;text-align:left}
      #view-it .wl-it-cal-title{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:16px 0 18px;padding:20px 24px;border:1px solid #263b4a;border-radius:12px;background:#0b1720}
      #view-it .wl-it-cal-title small{color:#ff4249;font-weight:1000;letter-spacing:.14em} #view-it .wl-it-cal-title h1{margin:4px 0 4px;font-size:30px;color:#fff} #view-it .wl-it-cal-title p{margin:0;color:#b6c2ca}
      #view-it .wl-it-cal-create{width:auto!important;padding:11px 18px!important;background:#ed1c24!important;color:#fff!important;border:1px solid #ff4b50!important;border-radius:8px!important;font-weight:900!important}
      #view-it .wl-it-cal-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:18px;align-items:start}
      #view-it .wl-it-cal-main{min-width:0}
      #view-it .wl-it-cal-nav strong{padding:9px 14px;border:1px solid #314453;border-radius:8px;background:#101b25;color:#fff;font-size:18px}
      #view-it .wl-it-cal-week{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;margin-top:12px}
      #view-it .wl-it-cal-week b{text-align:center;padding:9px;color:#d9e3e9}
      #view-it .wl-it-calendar{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
      #view-it .wl-it-cal-day{min-height:132px!important;padding:9px!important;border:1px solid #263b4a!important;border-radius:7px!important;background:#0c1821!important;overflow:hidden}
      #view-it .wl-it-cal-day.outside{opacity:.38;background:#09131a!important} #view-it .wl-it-cal-date{display:flex;gap:7px;align-items:center;margin-bottom:7px;color:#fff} #view-it .wl-it-cal-date span{color:#ff4249;font-size:10px;font-weight:1000}
      #view-it .wl-it-cal-event{display:flex!important;align-items:flex-start!important;gap:7px!important;width:100%!important;margin:4px 0!important;padding:6px!important;background:#101e28!important;border:0!important;border-radius:6px!important;color:#fff!important;text-align:left!important}
      #view-it .wl-it-cal-event .wl-it-cal-dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%;margin-top:4px;background:#3d9cff} #view-it .wl-it-cal-event span:last-child{display:grid;min-width:0} #view-it .wl-it-cal-event strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #view-it .wl-it-cal-event small{font-size:9px;color:#9fb0bb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #view-it .wl-it-cal-event.delivery .wl-it-cal-dot{background:#39d0ad} #view-it .wl-it-cal-event.swap .wl-it-cal-dot{background:#ffd04b} #view-it .wl-it-cal-event.pickup .wl-it-cal-dot{background:#a94df0}
      #view-it .wl-it-cal-side{display:grid;gap:16px} #view-it .wl-it-cal-side section{padding:16px;border:1px solid #294151;border-radius:10px;background:#0c1821} #view-it .wl-it-cal-side h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 10px;color:#fff;font-size:18px} #view-it .wl-it-cal-side h3 em{font-style:normal;padding:2px 7px;border-radius:6px;background:#203341} #view-it .wl-it-cal-side p{color:#9fb0bb;font-size:11px}
      #view-it .wl-it-cal-count{display:flex;justify-content:space-between;padding:8px 4px;color:#fff;border-bottom:1px solid #1d303d} #view-it .wl-it-cal-count.service span{color:#56a9ff} #view-it .wl-it-cal-count.delivery span{color:#49d9b6} #view-it .wl-it-cal-count.swap span{color:#ffd04b} #view-it .wl-it-cal-count.pickup span{color:#b65cff} #view-it .wl-it-cal-total{display:flex;justify-content:space-between;padding:12px 4px 2px;color:#fff;font-weight:900}
      #view-it .wl-it-cal-side section>button:not(.wl-it-cal-view-all){display:grid!important;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;width:100%!important;padding:8px!important;margin:5px 0!important;background:#101e28!important;color:#fff!important;border:1px solid #263b4a!important;border-radius:6px!important;text-align:left!important} #view-it .wl-it-cal-side section>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px} #view-it .wl-it-cal-side i{font-style:normal;font-size:9px;padding:3px 5px;border-radius:4px;background:#245f96} #view-it .wl-it-cal-side i.delivery{background:#147c69} #view-it .wl-it-cal-side i.swap{background:#9a7515} #view-it .wl-it-cal-side i.pickup{background:#7130a4}
      #view-it .wl-it-cal-view-all{width:100%!important;margin-top:10px!important;padding:9px!important;border:1px solid #456174!important;border-radius:7px!important;background:#132431!important;color:#fff!important;font-weight:850!important} #view-it .wl-it-cal-none{padding:12px;color:#91a3ae;border:1px dashed #2b414f;border-radius:6px}
      #view-it .wl-it-cal-legend{display:flex;gap:22px;flex-wrap:wrap;padding:14px 2px;color:#c8d3da;font-size:12px} #view-it .wl-it-cal-legend .service{color:#56a9ff} #view-it .wl-it-cal-legend .delivery{color:#49d9b6} #view-it .wl-it-cal-legend .swap{color:#ffd04b} #view-it .wl-it-cal-legend .pickup{color:#b65cff}
      @media(max-width:900px){#view-it .wl-it-cal-page{width:100%;padding:8px 10px 24px}#view-it .wl-it-cal-title{align-items:start;padding:14px;flex-direction:column}#view-it .wl-it-cal-title h1{font-size:23px}#view-it .wl-it-cal-layout{grid-template-columns:1fr}#view-it .wl-it-calendar-toolbar{align-items:flex-start!important}#view-it .wl-it-cal-nav strong{order:-1;width:100%}#view-it .wl-it-cal-week{display:none!important}#view-it .wl-it-calendar{display:block!important}#view-it .wl-it-cal-day{min-height:0!important;margin:7px 0!important}#view-it .wl-it-cal-day.outside,#view-it .wl-it-cal-day:not(.is-today):not(:has(.wl-it-cal-event)){display:none!important}#view-it .wl-it-cal-event strong{font-size:13px}#view-it .wl-it-cal-side{grid-template-columns:1fr}#view-it .wl-it-cal-create{width:100%!important}}
      /* IT Service Truck pages use the same spacious desktop command-center proportions as Owner. */
      @media(min-width:901px){
        #view-it:has(#wlItTruckInventory){padding:0 18px 30px!important}
        #view-it #wlItTruckInventory.wl-it-simple-card{
          width:100%!important;max-width:none!important;margin:0!important;padding:18px 22px 30px!important;
          background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important
        }
        #wlItTruckInventory>.wl-back{margin:0 0 12px!important}
        #wlItTruckInventory .wl-progress{width:100%!important;max-width:none!important;margin:0 0 12px!important}
        #wlItTruckInventory .wl-it-restock-banner{width:100%!important;max-width:none!important;margin:0 0 14px!important;padding:14px 16px!important}
        #wlItTruckInventory .wl-it-truck-manage-list{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important;width:100%!important}
        #wlItTruckInventory .wl-it-truck-manage-row{
          display:grid!important;grid-template-columns:1fr!important;gap:14px!important;align-content:start!important;
          min-width:0!important;padding:18px!important;border:1px solid #263943!important;border-radius:14px!important;background:#0b1821!important
        }
        #wlItTruckInventory .wl-it-truck-counts{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:7px!important}
        #wlItTruckInventory .wl-it-truck-counts i{padding:12px 6px!important;text-align:center!important;border-radius:9px!important}
        #wlItTruckInventory .wl-it-start{width:auto!important;min-height:42px!important;justify-self:start!important;padding:0 18px!important}
        #wlItTruckInventory>[data-wl-it-truck-inventory]{width:auto!important;min-width:150px!important;margin-top:14px!important}
        #wlItTruckInventory>label.top10{display:block!important;width:min(720px,100%)!important;margin:12px 0 16px!important}
        #wlItTruckInventory>label.top10 input{width:100%!important;margin-top:6px!important}
        #wlItTruckInventory .wl-it-truck-editor{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:12px 18px!important;width:100%!important}
        #wlItTruckInventory .wl-truck-section-title,#wlItTruckInventory .wl-it-truck-editor>.small,#wlItTruckInventory #wlItUnitLoadChecks{grid-column:1/-1!important}
        #wlItTruckInventory .wl-it-load-line{
          display:grid!important;grid-template-columns:minmax(150px,.55fr) minmax(180px,1fr) auto!important;
          align-items:center!important;gap:10px!important;padding:12px!important;border:1px solid #263943!important;border-radius:11px!important;background:#0b1821!important
        }
        #wlItTruckInventory .wl-it-load-line input{width:100%!important;min-width:0!important}
        #wlItTruckInventory .wl-it-load-line button{width:auto!important;white-space:nowrap!important;padding:0 14px!important;min-height:40px!important}
        #wlItTruckInventory .wl-it-restock-checks{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important}
        #wlItTruckInventory .wl-it-restock-checks .check{min-height:52px!important;padding:10px 12px!important;border:1px solid #263943!important;border-radius:9px!important;background:#0b1821!important}
        #wlItTruckInventory details.wl-it-more{width:100%!important;margin-top:16px!important}
      }
      @media(max-width:1200px) and (min-width:901px){
        #wlItTruckInventory .wl-it-truck-manage-list{grid-template-columns:1fr 1fr!important}
        #wlItTruckInventory .wl-it-truck-editor{grid-template-columns:1fr!important}
        #wlItTruckInventory .wl-it-load-line{grid-column:1!important}
        #wlItTruckInventory .wl-it-restock-checks{grid-template-columns:1fr 1fr!important}
      }
      @media(max-width:900px){
        #view-it #wlItTruckInventory.wl-it-simple-card{width:100%!important;max-width:none!important;margin:0!important;padding:12px!important}
        #wlItTruckInventory .wl-it-truck-manage-list,#wlItTruckInventory .wl-it-truck-editor{display:grid!important;grid-template-columns:1fr!important;gap:10px!important}
        #wlItTruckInventory .wl-it-load-line{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}
        #wlItTruckInventory .wl-it-load-line button,#wlItTruckInventory .wl-it-start,#wlItTruckInventory>[data-wl-it-truck-inventory]{width:100%!important}
        #wlItTruckInventory .wl-it-restock-checks{grid-template-columns:1fr!important}
        #wlItTruckInventory .wl-it-truck-counts{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      }
      /* Final desktop calendar sizing: later legacy rules in this file were winning the cascade. */
      @media(min-width:901px){
        #view-it:has(.wl-it-cal-page){padding:0 8px 24px!important}
        #view-it #wlITCalendar{width:100%!important;max-width:none!important;margin:0!important}
        #view-it .wl-it-cal-page{width:100%!important;max-width:none!important;margin:0!important;padding:4px 0 20px!important}
        #view-it .wl-it-cal-title{margin:4px 0 8px!important;padding:14px 18px!important}
        #view-it .wl-it-cal-layout{display:grid!important;grid-template-columns:minmax(0,1fr) 230px!important;gap:8px!important;width:100%!important;max-width:none!important}
        #view-it .wl-it-cal-main{width:100%!important;max-width:none!important;min-width:0!important}
        #view-it .wl-it-calendar{width:100%!important;max-width:none!important;grid-template-columns:repeat(7,minmax(0,1fr))!important}
        #view-it .wl-it-cal-day{display:block!important;min-height:clamp(155px,19vh,235px)!important}
        #view-it .wl-it-cal-day.empty{display:block!important}
        #view-it .wl-it-cal-side{width:230px!important;min-width:230px!important;gap:8px!important}
      }
      /* Full-screen IT calendar desktop workspace; mobile remains stacked and touch friendly */
      @media(min-width:901px){
        #view-it:has(.wl-it-cal-page){padding-left:10px!important;padding-right:10px!important}
        #view-it #wlITCalendar{width:100%!important;max-width:none!important;margin:0!important}
        #view-it .wl-it-cal-page .wl-it-cal-title{margin-top:6px!important;margin-bottom:10px!important}
        #view-it .wl-it-calendar-toolbar{margin:8px 0 6px!important}
        #view-it .wl-it-cal-layout{grid-template-columns:minmax(0,1fr) 250px!important;gap:10px!important}
        #view-it .wl-it-cal-day{min-height:clamp(145px,18vh,230px)!important}
        #view-it .wl-it-cal-side{gap:10px!important}
        #view-it .wl-it-cal-side section{padding:12px!important}
        #view-it .wl-it-cal-page{width:100%!important;max-width:none!important;margin:0!important;padding:8px 0 32px!important}
        #view-it .wl-it-cal-title{width:100%!important;margin:12px 0 16px!important;padding:18px 22px!important}
        #view-it .wl-it-cal-layout{grid-template-columns:minmax(0,1fr) clamp(280px,18vw,360px)!important;gap:16px!important;width:100%!important}
        #view-it .wl-it-cal-main{width:100%!important}
        #view-it .wl-it-calendar,#view-it .wl-it-cal-week{width:100%!important;max-width:none!important}
        #view-it .wl-it-cal-day{min-height:clamp(118px,14vh,190px)!important}
        #view-it .wl-it-cal-side{width:100%!important}
      }
      @media(max-width:900px){
        #view-it .wl-it-cal-page{width:100%!important;max-width:none!important;margin:0!important;padding:8px 10px 24px!important}
        #view-it .wl-it-cal-title{width:100%!important}
        #view-it .wl-it-cal-layout{width:100%!important;grid-template-columns:1fr!important}
        #view-it .wl-it-cal-main,#view-it .wl-it-cal-side{width:100%!important;min-width:0!important}
        #view-it .wl-it-calendar-toolbar{width:100%!important}
        #view-it .wl-it-cal-nav,#view-it .wl-it-cal-filters{width:100%!important}
        #view-it .wl-it-cal-nav button,#view-it .wl-it-cal-filters button{flex:1 1 auto!important}
        #view-it .wl-it-cal-event{min-height:52px!important;padding:10px!important}
        #view-it .wl-it-cal-side section{width:100%!important}
      }
      #view-it #wlITCalendar{width:min(1400px,calc(100% - 24px))!important;max-width:1400px!important;margin-left:auto!important;margin-right:auto!important}
      #view-it .wl-it-calendar-toolbar{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:14px!important;flex-wrap:wrap!important;margin:14px 0 8px!important}
      #view-it .wl-it-cal-nav,#view-it .wl-it-cal-filters{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important}
      #view-it .wl-it-cal-nav button,#view-it .wl-it-cal-filters button{width:auto!important;min-height:38px!important;padding:8px 13px!important;border:1px solid #314453!important;border-radius:8px!important;background:#101b25!important;color:#fff!important;font-weight:800!important}
      #view-it .wl-it-cal-filters button.active{background:#ed1c24!important;border-color:#ff4b50!important}
      #view-it .wl-it-cal-head{justify-content:space-between!important;align-items:end!important}
      #view-it .wl-it-cal-summary{color:#9eacb8!important;font-size:13px!important}
      #view-it .wl-it-cal-day.is-today{border-color:#ed1c24!important;box-shadow:inset 0 0 0 1px #ed1c24!important}
      #view-it .wl-it-cal-day>b span{font-size:9px!important;color:#ff5b60!important;margin-left:5px!important}
      #view-it .wl-it-cal-unscheduled{margin-top:18px!important;padding:16px!important;border:1px solid #263746!important;border-radius:10px!important;background:#0c1720!important;max-width:900px!important}
      #view-it .wl-it-cal-unscheduled h3{margin:0 0 10px!important}
      #view-it .wl-it-cal-unscheduled button{display:flex!important;justify-content:space-between!important;gap:16px!important;width:100%!important;padding:10px 12px!important;margin:6px 0!important;background:#101b25!important;color:#fff!important;border:1px solid #304657!important;border-radius:8px!important;text-align:left!important}
      #view-it .wl-it-cal-head{justify-content:flex-start!important}
      #view-it .wl-it-cal-head h2{text-align:left!important;min-width:180px!important}
      #view-it .wl-it-calendar,#view-it .wl-it-cal-week{max-width:1400px!important}
      #view-it .wl-it-cal-day{min-height:112px!important}
      #view-it .wl-ticket{max-width:1050px!important;padding:16px!important}
      #view-it .wl-question{max-width:980px!important;padding:20px!important}
      #view-it .wl-question .qtext{font-size:26px!important}
      #view-it .wl-options{max-width:720px!important}
      #view-it .wl-options button{min-height:62px!important;font-size:18px!important}
      #view-it .wl-review,#view-it .wl-proof{max-width:980px!important}
      #view-it .wl-nav{max-width:760px!important}
      #view-it .wl-it-more{max-width:900px!important}
      #view-it .wl-it-more summary{text-align:left!important}
      #view-it .wl-it-service-queue,#view-it .wl-it-ticket-prompt{margin-left:0!important;margin-right:0!important}
    }
    /* IT Intake dark-background contrast fix */
    #view-it #wlItIntake .wl-title,
    #view-it #wlItIntake .wl-sub {
      color:#ffffff!important;
      opacity:1!important;
    }
    #view-it #wlItIntake .wl-sub {
      color:#d8e1e6!important;
    }

    /* Preserve dark text on the white cards/buttons */
    #view-it #wlItIntake .wl-mode-card,
    #view-it #wlItIntake .wl-mode-card .wl-mode-title,
    #view-it #wlItIntake .wl-mode-card .wl-mode-sub,
    #view-it #wlItIntake .wl-menu button {
      color:#182635!important;
    }
    #view-it #wlItIntake .wl-mode-card .wl-mode-sub {
      color:#71808d!important;
    }

    /* Active red action stays white */
    #view-it #wlItIntake .wl-menu button.wl-red {
      color:#ffffff!important;
    }
  `;
  s.textContent += `
    .owner-auto-flow-card{margin:4px 0 16px;padding:16px 18px;border:1px solid #394d58;border-left:5px solid #e31821;border-radius:12px;background:#0b1920;color:#fff;display:grid;gap:5px}
    .owner-auto-flow-card>span{font-size:11px;font-weight:950;letter-spacing:.12em;color:#ff4b52}
    .owner-auto-flow-card>b{font-size:22px;font-weight:1000;color:#fff;line-height:1.15}
    .owner-auto-flow-card>small{font-size:13px;font-weight:750;color:#b9c7ce;line-height:1.35}
  `;
  s.textContent += `
    .wl-day-next-card{margin:18px auto 12px;padding:22px 18px;max-width:720px;border:1px solid #334852;border-radius:16px;background:#0b1920;color:#fff;text-align:center;display:grid;gap:8px}
    .wl-day-next-card>span{font-size:11px;font-weight:1000;letter-spacing:.12em;color:#ff4b52}
    .wl-day-next-card>b{font-size:clamp(26px,5vw,44px);line-height:1.05;color:#fff;font-weight:1000}
    .wl-day-next-card>small{font-size:14px;line-height:1.45;color:#c5d0d5;font-weight:750}
    .wl-day-next-card.urgent{border-color:#e31821;box-shadow:0 0 0 1px rgba(227,24,33,.22) inset}
    .wl-day-next-card.waiting{border-color:#7b8991}
    .wl-day-next-card.done{border-color:#52656e}
    .wl-truck-required-banner,.wl-it-restock-banner{margin:12px 0;padding:14px;border:1px solid #405966;border-left:5px solid #e31821;border-radius:12px;background:#0a171d;color:#fff;display:grid;gap:4px}
    .wl-truck-required-banner b,.wl-it-restock-banner b{font-size:13px;letter-spacing:.06em}
    .wl-truck-required-banner span,.wl-it-restock-banner span{font-size:12px;color:#b8c7ce;font-weight:750}
    .wl-truck-section-title{margin:18px 0 8px;color:#ff4b52;font-size:12px;font-weight:1000;letter-spacing:.12em}
    .wl-truck-unit-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .wl-truck-unit-check{min-height:72px;padding:11px;border:1px solid #38505b;border-radius:12px;background:#0b1920;display:flex;gap:10px;align-items:center;color:#fff}
    .wl-truck-unit-check.missing{border-color:#a93238;background:#261014}
    .wl-truck-unit-check input{width:24px!important;height:24px!important;min-height:0!important;padding:0!important}
    .wl-truck-unit-check span{display:grid;gap:2px}.wl-truck-unit-check b{font-size:16px;color:#fff}.wl-truck-unit-check small{font-size:11px;color:#aebdc5}
    .wl-truck-stock-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
    .wl-truck-stock-grid label{padding:11px;border:1px solid #38505b;border-radius:12px;background:#0b1920;color:#fff}.wl-truck-stock-grid label>span{display:block;min-height:42px;font-size:12px;font-weight:850}.wl-truck-stock-grid input{text-align:center!important}
    .wl-truck-restock-list{margin-top:16px}.wl-truck-restock-row{margin:8px 0;padding:12px;border:1px solid #713238;border-radius:12px;background:#241014;color:#fff}.wl-truck-restock-row.ready{border-color:#3f6a55;background:#0d2117}.wl-truck-restock-row>div{display:grid;gap:3px}.wl-truck-restock-row span{font-size:12px;color:#b9c7ce}.wl-truck-restock-row em{display:block;margin-top:6px;font-style:normal;font-size:10px;font-weight:1000;letter-spacing:.08em;color:#ff6369}
    .wl-it-restock-card{margin:10px 0;padding:15px;border:1px solid #405966;border-radius:12px;background:#0b1920;color:#fff}.wl-it-restock-card.waiting{border-color:#8b3c42}.wl-it-restock-card.ready{border-color:#3f6a55}.wl-it-restock-card h3{margin:4px 0 8px;color:#fff}.wl-it-restock-card label{display:block;margin-top:9px}.wl-it-restock-checks{display:grid;gap:6px;margin-top:10px}
    @media(max-width:620px){.wl-truck-unit-grid,.wl-truck-stock-grid{grid-template-columns:1fr}}
    #view-it .wl-it-ticket-prompt{margin:16px auto 12px;max-width:720px;padding:16px 18px;border:1px solid #334852;border-radius:14px;background:#0b1920;color:#fff;text-align:center;display:grid;gap:7px}
    #view-it .wl-it-ticket-prompt>span{font-size:11px;font-weight:1000;letter-spacing:.12em;color:#ff4b52}
    #view-it .wl-it-ticket-prompt>b{font-size:clamp(22px,4.5vw,34px);line-height:1.08;color:#fff;font-weight:1000}
    #view-it .wl-it-ticket-prompt>small{font-size:13px;line-height:1.4;color:#b9c7ce;font-weight:750}
    #view-it .wl-it-home-ticket-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:4px}
    #view-it .wl-it-home-ticket-entry input{min-height:52px!important;font-size:18px!important;text-align:center!important}
    #view-it .wl-it-home-ticket-entry button{min-height:52px;border:1px solid #ff3b42;border-radius:10px;background:#e31821;color:#fff;font-size:15px;font-weight:1000;padding:0 16px}
    @media(max-width:560px){#view-it .wl-it-home-ticket-entry{grid-template-columns:1fr}#view-it .wl-it-home-ticket-entry button{width:100%}}
    #view-it .wl-it-service-queue{max-width:720px;margin:12px auto 0;padding:14px 16px;border:1px solid #2a414d;border-radius:14px;background:#071117;text-align:left}
    #view-it .wl-it-service-queue-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:9px;border-bottom:1px solid #263943}
    #view-it .wl-it-service-queue-head>span{font-size:11px;font-weight:1000;letter-spacing:.12em;color:#ff4b52}
    #view-it .wl-it-service-queue-head>b{font-size:13px;color:#dce6ea}
    #view-it .wl-it-service-queue-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #1d3039}
    #view-it .wl-it-service-queue-row:last-child{border-bottom:0}
    #view-it .wl-it-service-queue-row>div{display:grid;gap:2px}
    #view-it .wl-it-service-queue-row b{color:#fff;font-size:14px}
    #view-it .wl-it-service-queue-row span{color:#9fb0b8;font-size:12px}
    #view-it .wl-it-service-queue-row em{font-style:normal;color:#c8d3d8;font-size:10px;font-weight:1000;letter-spacing:.06em;white-space:nowrap}
    #view-it .wl-it-service-queue-empty,#view-it .wl-it-service-queue-more{padding:11px 0 2px;color:#9fb0b8;font-size:12px;font-weight:750}
    #view-it .wl-readonly-extra .small{margin-top:8px;color:#91a4ad!important;font-size:12px!important;font-weight:800!important}
    #view-it .wl-it-final-lock{margin:10px 0 14px;padding:11px 13px;border:1px solid #39515d;border-radius:11px;background:#0a171d;display:grid;gap:3px;text-align:left}
    #view-it .wl-it-final-lock b{color:#fff;font-size:13px;font-weight:1000;letter-spacing:.04em}
    #view-it .wl-it-final-lock span{color:#a9bac2;font-size:12px;font-weight:750;line-height:1.35}
    .wl-day-complete-flash{margin:12px auto;max-width:720px;padding:12px 14px;border:1px solid #49636d;border-radius:12px;background:#102229;color:#fff;display:grid;gap:2px;text-align:center}
    .wl-day-complete-flash>b{font-size:16px;color:#fff}
    .wl-day-complete-flash>span{font-size:14px;font-weight:850;color:#d8e1e6}
    .wl-day-complete-flash>small{font-size:12px;color:#aebec5}
    .wl-day-complete-card{max-width:820px!important;margin:22px auto!important;background:#071117!important;color:#fff!important;text-align:center!important;padding:34px 22px!important}
    .wl-day-complete-card .wl-day-check{width:74px;height:74px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;background:#e31821;color:#fff;font-size:42px;font-weight:1000}
    .wl-day-complete-card .wl-day-kicker{font-size:12px;font-weight:1000;letter-spacing:.14em;color:#ff4b52}
    .wl-day-complete-card h1{font-size:clamp(36px,8vw,70px)!important;color:#fff!important;margin:8px 0!important}
    .wl-day-complete-card p{font-size:18px;color:#d8e1e6!important;font-weight:750}
    .wl-day-future{margin:16px auto;max-width:600px;padding:12px;border:1px solid #334852;border-radius:10px;color:#c5d0d5;font-weight:750}
  `;
  s.textContent += `
    .wl-tech-live-status{position:fixed;z-index:9997;right:12px;top:calc(env(safe-area-inset-top,0px) + 62px);display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;background:#071117;border:1px solid #3a4b53;color:#fff;font-size:10px;font-weight:1000;letter-spacing:.08em;box-shadow:0 6px 18px rgba(0,0,0,.22);pointer-events:none}
    .wl-tech-live-status.hidden{display:none!important}
    .wl-tech-live-status i{width:7px;height:7px;border-radius:50%;background:#fff;display:block}
    .wl-tech-live-status.live{border-color:#52656e}
    .wl-tech-live-status.live i{background:#74d99f;box-shadow:0 0 0 3px rgba(116,217,159,.12)}
    .wl-tech-live-status.reconnecting{border-color:#e31821}
    .wl-tech-live-status.reconnecting i{background:#e31821;animation:wlLivePulse 1s infinite}
    .wl-tech-live-status.offline{border-color:#7b8991;color:#d5dde1}
    .wl-tech-live-status.offline i{background:#7b8991}
    @keyframes wlLivePulse{0%,100%{opacity:.35}50%{opacity:1}}
    @media(max-width:700px){.wl-tech-live-status{right:8px;top:calc(env(safe-area-inset-top,0px) + 58px);font-size:9px;padding:5px 8px}}
  `;
  s.textContent += `
    #view-svc .wl-solar-photo-card,
    #view-svc .wl-solar-sign-card{
      background:#0a171e!important;border:1px solid #314a57!important;border-radius:16px!important;
      padding:14px!important;box-shadow:none!important;color:#fff!important
    }
    #view-svc .wl-solar-proof-status,
    #view-svc .wl-solar-sign-label{
      font-size:11px!important;font-weight:1000!important;letter-spacing:.12em!important;color:#ff4b52!important;
      margin-bottom:10px!important
    }
    #view-svc .wl-solar-photo-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 10px}
    #view-svc .wl-solar-photo-choice{
      min-height:70px;border:1px solid #395361;border-radius:13px;background:#11242d;color:#fff;
      display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;font-weight:1000;cursor:pointer
    }
    #view-svc .wl-solar-photo-choice span{font-size:20px}
    #view-svc .wl-solar-photo-choice b{font-size:13px;letter-spacing:.03em}
    #view-svc .wl-solar-file-hidden{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}
    #view-svc .wl-solar-selected{
      min-height:44px;display:flex;align-items:center;padding:10px 12px;border:1px solid #2d4652;border-radius:11px;
      background:#071117;color:#b8c7ce;font-size:13px;font-weight:800;overflow-wrap:anywhere
    }
    #view-svc .wl-solar-multi-note{margin:-2px 0 10px;color:#9db0ba;font-size:11px;font-weight:800;text-align:center}
    #view-svc .wl-solar-preview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
    #view-svc .wl-solar-preview-grid img{width:100%;height:64px;object-fit:cover;border-radius:8px;border:1px solid #3c5662}
    #view-svc .wl-solar-clear-photos{width:100%;margin-top:10px;min-height:42px;border:1px solid #425a66;border-radius:999px;background:#0d1c24;color:#cdd8dd;font-size:11px;font-weight:1000;letter-spacing:.04em}
    #view-svc .wl-solar-clear-photos.hidden{display:none!important}
    #view-svc .wl-solar-preview{
      margin-top:10px;padding:10px;border:1px solid #35515f;border-radius:12px;background:#071117;
      display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;align-items:center
    }
    #view-svc .wl-solar-preview.hidden{display:none!important}
    #view-svc .wl-solar-preview img{width:72px;height:72px;object-fit:cover;border-radius:9px;border:1px solid #3c5662}
    #view-svc .wl-solar-preview b{display:block;color:#75d99e;font-size:11px;letter-spacing:.08em}
    #view-svc .wl-solar-preview span{display:block;margin-top:4px;color:#d9e3e8;font-size:12px;overflow-wrap:anywhere}
    #view-svc .wl-solar-save-photo{margin-top:12px!important;min-height:62px!important}
    #view-svc .wl-solar-save-photo:disabled{opacity:.42!important}
    #view-svc .wl-solar-sign-card .small{margin-bottom:10px!important}
    #view-svc .wl-solar-sign-card .wl-sign{background:transparent!important}
    #view-svc .wl-solar-sign-card canvas{
      display:block;width:100%!important;height:150px!important;background:#fff!important;border:2px solid #6f8792!important;
      border-radius:12px!important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.04)
    }
    #view-svc .wl-solar-sign-actions{display:grid;grid-template-columns:.8fr 1.35fr;gap:10px;margin-top:10px}
    #view-svc .wl-solar-sign-actions button{min-height:58px!important;border-radius:999px!important;font-size:16px!important;font-weight:1000!important}
    @media(max-width:520px){
      #view-svc .wl-solar-photo-actions{grid-template-columns:1fr 1fr}
      #view-svc .wl-solar-photo-choice{min-height:66px;padding:8px}
      #view-svc .wl-solar-photo-choice b{font-size:11px}
      #view-svc .wl-solar-sign-actions{grid-template-columns:.8fr 1.45fr}
    }
  `;
  s.textContent += `
    #view-svc .wl-svc-ticket-brief{background:#071117!important;border:1px solid #29404c!important;color:#fff!important;box-shadow:none!important}
    #view-svc .wl-svc-summary-kicker{font-size:13px;font-weight:1000;letter-spacing:.12em;color:#ff4b52;margin-bottom:12px}
    #view-svc .wl-svc-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    #view-svc .wl-svc-summary-grid>div{background:#0d1c24;border:1px solid #2c4350;border-radius:11px;padding:10px 11px;min-width:0}
    #view-svc .wl-svc-summary-grid span,#view-svc .wl-svc-summary-label{display:block;color:#8fa3ae;font-size:9px;font-weight:1000;letter-spacing:.11em;text-transform:uppercase}
    #view-svc .wl-svc-summary-grid b{display:block;margin-top:4px;color:#fff;font-size:14px;line-height:1.25;overflow-wrap:anywhere}
    #view-svc .wl-svc-summary-label{margin:14px 0 7px;color:#ff4b52}
    #view-svc .wl-svc-summary-equipment-list{display:grid;gap:7px}
    #view-svc .wl-svc-summary-equipment{border:1px solid #304955;border-radius:11px;background:#0b1820;padding:11px 12px}
    #view-svc .wl-svc-summary-equipment b{display:block;color:#fff;font-size:16px}
    #view-svc .wl-svc-summary-equipment span{display:block;margin-top:4px;color:#b4c2c9;font-size:12px;font-weight:800}
    #view-svc .wl-svc-summary-extra{margin-top:8px;color:#b8c5cb;font-size:12px}
    #view-svc .wl-svc-summary-question{margin-top:18px!important}
    #view-svc .wl-svc-question-note{margin:-8px 0 12px;padding:9px 11px;border:1px solid #344d59;border-radius:10px;background:#0a171e;color:#b8c7ce;font-size:12px;font-weight:800}
    #view-svc .wl-svc-restart-questions{width:100%;min-height:48px;margin-top:12px;border:1px solid #425a66;border-radius:999px;background:#0d1c24;color:#cdd8dd;font-size:12px;font-weight:1000;letter-spacing:.05em}
    @media(max-width:520px){#view-svc .wl-svc-summary-grid{grid-template-columns:1fr}}
  `;
    s.textContent += `
    #view-svc .wl-complete-continue{
      background:#ed1c24!important;
      color:#fff!important;
      border:1px solid #ed1c24!important;
      border-left:1px solid #ed1c24!important;
      box-shadow:none!important;
      outline:none!important;
      -webkit-tap-highlight-color:transparent!important
    }
    #view-svc .wl-complete-continue:focus,
    #view-svc .wl-complete-continue:focus-visible{
      outline:none!important;
      box-shadow:none!important;
      border-color:#ed1c24!important
    }
  `;
    s.textContent += `
    #view-svc .wl-helios-field-head{border:1px solid #314954!important;border-radius:18px!important;background:#07161d!important;color:#fff!important;box-shadow:none!important;padding:18px!important}
    #view-svc .wl-helios-field-head h2{color:#fff!important;line-height:1.12!important}
    #view-svc .wl-helios-field-head .kicker{color:#ff3038!important}
    #view-svc .wl-helios-field-head .wl-progress{background:#20333c!important}
    #view-svc .wl-field-context{border:1px solid #2d4652;border-left:4px solid #ed1c24;border-radius:14px;background:#0a171e;padding:14px;margin:10px 0;color:#fff}
    #view-svc .wl-field-context>b{display:block;font-size:17px;color:#fff}
    #view-svc .wl-field-context>span{display:block;margin-top:6px;color:#aebdc5;font-size:13px;font-weight:800;line-height:1.35}
    #view-svc .wl-field-unit{border:1px solid #2d4652;border-radius:13px;background:#0a171e;padding:12px;margin:9px 0;color:#fff}
    #view-svc .wl-field-unit b{display:block;font-size:15px;color:#fff}.wl-field-unit span{display:block;margin-top:4px;color:#aebdc5;font-size:11px}
    #view-svc .wl-field-status{border-radius:14px!important;padding:14px!important;margin:12px 0!important}
    #view-svc .wl-helios-field-step{background:#0a171e!important;border:1px solid #2d4652!important;color:#fff!important;box-shadow:none!important}
    #view-svc .wl-helios-field-step .qnum{color:#ff3038!important}
    #view-svc .wl-helios-field-step .qtext{color:#fff!important}
    #view-svc .wl-helios-field-step .wl-options .fail{background:#ed1c24!important;border-color:#ff4b52!important;color:#fff!important}
    #view-svc .wl-helios-field-step .wl-options .pass{background:#f7f7f7!important;border-color:#f7f7f7!important;color:#111820!important}
    #view-svc .wl-helios-field-step .wl-options .pass.on{background:#18864b!important;border-color:#24a35d!important;color:#fff!important}
    #view-svc .wl-helios-field-step .wl-solar-proof{background:#0b1a22!important;border:1px solid #2d4652!important;color:#fff!important}
    #view-svc .wl-helios-field-step .wl-solar-photo-choice{background:#121f27!important;border:1px solid #425b67!important;color:#fff!important}
    #view-svc .wl-helios-field-step .wl-solar-selected,#view-svc .wl-helios-field-step .wl-solar-multi-note,#view-svc .wl-helios-field-step .wl-solar-sign-label,#view-svc .wl-helios-field-step .small{color:#aebdc5!important}
    #view-svc .wl-helios-field-step .wl-sign canvas{border-color:#425b67!important}
    #view-svc .wl-ai-final{background:#07161d!important;border:1px solid #2d4652!important;border-top:5px solid #ed1c24!important;color:#fff!important;box-shadow:none!important}
    #view-svc .wl-ai-final .wl-ai-head{color:#fff!important}
    #view-svc .wl-ai-final .wl-ai-head>b{background:#111d25!important;color:#fff!important;border:1px solid #40535d!important}
    #view-svc .wl-ai-final .small{color:#aebdc5!important}
    #view-svc .wl-ai-final .wl-ai-good{background:#0d2119!important;border:1px solid #315244!important;color:#dff7e8!important}
    #view-svc [data-wl-accept-helios],#view-svc [data-wl-submit-helios-field]{background:#ed1c24!important;color:#fff!important;border:1px solid #ed1c24!important;border-left:1px solid #ed1c24!important;box-shadow:none!important}
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
async function myReturnCounts() { const tech=await currentTechIdentity().catch(()=>null); if (!tech?.id) return { waiting:0, inventory:0, replacement:0, completed:0 }; const { data } = await liveDb.from('unit_returns').select('status').eq('service_tech_id', tech.id); const rows=data||[]; return { waiting:rows.filter(r=>r.status==='waiting_it').length, inventory:rows.filter(r=>r.status==='pending_mhelp_inventory').length, replacement:rows.filter(r=>r.status==='needs_replacement').length, completed:rows.filter(r=>r.status==='completed').length }; }
async function releasedPrepCount() { const { data } = await liveDb.from('prep_tickets').select('id').eq('status','released'); return (data||[]).length; }
async function myTruckSpareData() {
  const tech=await currentTechIdentity().catch(()=>null);
  if (!tech?.id) return {units:[],batteries:[]};
  const [prepQ,batteryQ]=await Promise.all([
    liveDb.from('prep_tickets')
      .select('id,ticket_no,site,closed_at,closed_by,prep_items(id,unit_tag,equipment_type,purpose,spare_outcome,spare_checked_out_at,spare_checked_out_to)')
      .eq('status','closed').eq('closed_by',tech.id)
      .order('closed_at',{ascending:false}).limit(50),
    liveDb.from('truck_spare_batteries').select('*')
      .eq('service_tech_id',tech.id).eq('status','in_truck')
      .order('accepted_at',{ascending:true})
  ]);
  if (prepQ.error) throw prepQ.error;
  if (batteryQ.error) throw batteryQ.error;
  const units=(prepQ.data||[]).flatMap(p=>(p.prep_items||[])
    .filter(i=>i.purpose==='BACKUP' && i.spare_checked_out_at && i.spare_checked_out_to===tech.id && !i.spare_outcome)
    .map(i=>({...i,ticket_no:p.ticket_no,site:p.site,closed_at:p.closed_at})));
  return {units,batteries:batteryQ.data||[]};
}
function truckSpareServiceHtml(spares) {
  const units=spares?.units||[], batteries=spares?.batteries||[];
  if (!units.length && !batteries.length) return '';
  const unitHtml=units.map(i=>`<div class='wl-ticket'><b>${esc(i.equipment_type)} ${esc(i.unit_tag||'')}</b><div class='small'>MHelpDesk #${esc(i.ticket_no)} · Truck BACKUP</div><div class='small top8'>Was this spare actually used today?</div><div class='grid2 top8'><button class='wl-big wl-gray' style='min-height:50px;font-size:15px' data-wl-spare-unit-return='${i.id}' data-wl-spare-unit-label='${esc((i.equipment_type||'Unit')+' '+(i.unit_tag||''))}'>RETURN UNUSED → IT INTAKE</button><button class='wl-big wl-blue' style='min-height:50px;font-size:15px' data-wl-spare-unit-used='${i.id}'>USED FOR SWAP</button></div><div class='small top8'><b>Return photo required:</b> an unused complete backup cannot enter IT Intake until Service photographs the unit being returned.</div></div>`).join('');
  const batteryHtml=batteries.map(b=>`<div class='wl-ticket'><b>${esc(b.battery_type)}</b><div class='small'>MHelpDesk #${esc(b.ticket_no)} · ${Number(b.qty_prepared||0)} spare prepared for ${esc(b.equipment_type)}</div><label class='top8'>How many were USED?<input id='wlSpareUsed_${b.id}' type='number' inputmode='numeric' min='0' max='${Number(b.qty_prepared||0)}' value='0'></label><button class='wl-big wl-blue top8' style='min-height:50px;font-size:15px' data-wl-spare-battery-resolve='${b.id}' data-wl-spare-battery-max='${Number(b.qty_prepared||0)}'>CHECK IN BATTERY SPARES</button><div class='small'>Anything not used is automatically recorded as returned unused.</div></div>`).join('');
  return `<div class='wl-stop top10' data-wl-truck-spares>
    <b>TRUCK SPARES TO RESOLVE · ${units.length+batteries.length}</b>
    <div>Before ending the day, resolve every backup that IT handed off to you. <b>Unused complete backup units require a Service return photo and then return through IT Intake</b> so IT can verify them before they become available Shop Inventory again. If you used a spare for a swap, mark it USED and return the failed/replaced field unit through the normal IT Intake flow.</div>
    ${unitHtml}${batteryHtml}
  </div>`;
}

async function serviceWorkData() {
  const tech=await currentTechIdentity().catch(()=>null);
  const inspectionRequired=serviceInspectionRequiredToday();
  if (!tech?.id) return { assignments:[], released:[], inspectionDone:false, inspectionRequired, deployed:[] };
  const dayStart = new Date(); dayStart.setHours(0,0,0,0);
  const [assignments,releasedQ,returnedQ,deployedQ,inspectionQ] = await Promise.all([
    myActiveAssignments('service'),
    liveDb.from('prep_tickets').select('id,ticket_no,site,released_at,created_at').eq('status','released').order('released_at',{ascending:true}),
    liveDb.from('unit_returns').select('ticket_no,unit_tag').eq('service_tech_id',tech.id),
    liveDb.from('prep_tickets').select('id,ticket_no,site,closed_at,closed_by,prep_items(id,unit_tag,equipment_type,purpose,spare_outcome,swap_outcome,swap_installed_site,swap_site_registration_status)').eq('status','closed').eq('closed_by',tech.id).order('closed_at',{ascending:false}).limit(30),
    liveDb.from('morning_checks').select('id').eq('service_tech_id',tech.id).gte('submitted_at',dayStart.toISOString()).limit(1)
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
function ownerTestPreviewContext(){
  if(!document.body.classList.contains('owner-test-role-preview')) return null;
  try{
    const ctx=JSON.parse(localStorage.getItem('techcheck:owner-test-session-v2')||'null');
    if(!ctx?.ticket||!ctx?.preview_role||!ctx?.persona_id)return null;
    return ctx;
  }catch{return null;}
}
function ownerTestPreviewFor(role){
  const ctx=ownerTestPreviewContext();
  return ctx&&(!role||ctx.preview_role===role)?ctx:null;
}
async function currentTechIdentity() {
  const preview=ownerTestPreviewContext();
  if(preview){
    return { id:preview.persona_id, name:preview.persona_name||'Test Technician', username:preview.persona_username||'', owner_test:true, ticket:preview.ticket, role:preview.preview_role };
  }
  const { data } = await liveDb.auth.getUser();
  const user = data?.user;
  if (!user?.id) throw new Error('Please sign in again.');
  return { id: user.id, name: document.getElementById('whoName')?.textContent?.trim() || 'Technician' };
}
async function setJobAssignmentStatusCompat(id,status){
  const preview=ownerTestPreviewContext();
  return preview
    ? liveDb.rpc('owner_test_set_assignment_status_v1',{p_assignment_id:id,p_status:status})
    : liveDb.rpc('set_my_job_assignment_status',{p_assignment_id:id,p_status:status});
}
async function linkAssignmentToPrepCompat(id,prepId){
  const preview=ownerTestPreviewContext();
  return preview
    ? liveDb.rpc('owner_test_link_assignment_to_prep_v1',{p_assignment_id:id,p_prep_id:prepId})
    : liveDb.rpc('link_my_assignment_to_prep',{p_assignment_id:id,p_prep_id:prepId});
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
const pushAlertState = (...args) => window.TechCheckNotifications.pushAlertState(...args);
const registerPhonePush = (...args) => window.TechCheckNotifications.registerPhonePush(...args);
function phoneAlertBanner() { return ''; }

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
function serviceInspectionRequiredToday() {
  return true;
}

function helpStepsForRole(role = currentRoleKey()) {
  if (role === 'service') return [
    { kicker:'WELCOME', title:'Service Tech · How Tech Check Works', body:`<p>Tech Check is your technician workflow. <b>MHelpDesk stays separate.</b> Use the MHelpDesk reference in Tech Check to make sure you are working on the correct ticket.</p><p>Each new delivery, pickup, service call, or swap uses its own current MHelpDesk ticket. When that job is finished, it closes. The <b>unit number stays universal</b> in Tech Check so the unit history can follow it across different tickets.</p>` },
    { kicker:'MY WORK TODAY', title:'Start with the work assigned to you', body:`<p>Owner-assigned jobs appear at the top of <b>My Work Today</b>. A job may be assigned directly to you or to the <b>Service Department queue</b>.</p><p>Tap <b>Open Service Job</b>, enter the exact current MHelpDesk ticket, tap <b>Find Job</b>, verify the ticket preview, then choose <b>Take This Job</b>. If it is a department-queue job, Take This Job claims it to you and the Owner can see which Service Tech took responsibility.</p>` },
    { kicker:'START THE DAY', title:'Truck / Trailer Inspection → Required Truck Inventory → Field Work', body:`<p><b>Every work day:</b> the Truck Check is mandatory before leaving the shop. If you are taking a trailer, the Trailer Check is mandatory too.</p><p>After the safety inspection passes, physically verify your permanent truck inventory: <b>1 Sniper, 1 Ranger, 1 Spotter, 1 Solar Spotter, 3 exact SIM cards by SIM number, 25 Recon batteries, 4 AGM 12V 110Ah batteries, and 2 LiTime 12V 100Ah batteries.</b> Each SIM stays assigned to that truck until Service marks that exact SIM as used. When used, Tech Check makes the truck short, sends the SIM replacement to IT, and requires the new SIM number to be verified before the truck is ready again.</p>` },
    { kicker:'RECEIVE FROM IT', title:'Receive equipment from the named IT Tech', body:`<p>When IT creates the handoff, Tech Check shows the MHelpDesk ticket, customer/site, exact units, parts, and the name of the <b>IT Tech who prepared the handoff</b>.</p><p>Do not accept equipment just because it is physically there. First make sure the Tech Check job matches your current MHelpDesk ticket.</p>` },
    { kicker:'VERIFY THE HANDOFF', title:'Physically check every unit and part', body:`<p>Verify the exact unit tags, battery/battery-box counts, photos, and every listed part quantity before accepting the handoff.</p><p>If Tech Check says IT Tech Teddy prepared Unit 058 and two SIM cards, you should physically have Unit 058 and two SIM cards before continuing. A mismatch should be corrected before you accept the equipment.</p>` },
    { kicker:'SOLAR DELIVERY CHECKOUT', title:'Solar Spotter and Ranger support is assigned automatically', body:`<p>For a <b>Solar Spotter DELIVERY</b>, finish checking the Solar Spotter first. Tech Check then automatically requires <b>one Solar Stand per Solar Spotter</b>. In Service checkout, select the battery setup actually installed on that stand: <b>4 × AGM 12V 110Ah</b> or <b>1 × 12V 350Ah</b> per stand. Enter the stand tag, verify the MPPT update/test, verify the selected battery setup is charged, connect the solar panel + battery system + MPPT together, and confirm charging.</p><p>Take a clear Solar Stand tag photo and upload a picture of the MPPT / charging readings. Battery proof and Service sign-off are also saved. For a <b>Ranger DELIVERY</b>, Tech Check automatically requires <b>one solar panel and one LiTime 12V 110Ah battery per Ranger</b>, and Service verifies the Ranger MPPT and charging. Helios requires its battery box in the Service checkout plus the yard-tower MPPT / solar charging test.</p>` },
    { kicker:'FIELD WORK', title:'Delivery, service, pickup, or swap', body:`<p>Use the current MHelpDesk ticket for the task you are doing today. A later visit gets a new ticket number even if the same unit is involved.</p><p>For a swap or pickup, the unit number lets Tech Check remember that equipment across old closed tickets and the new current ticket.</p>` },
    { kicker:'TRUCK SPARES', title:'Resolve every truck backup after the call', body:`<p>IT may hand you a <b>BACKUP / truck spare</b> unit or extra batteries for the current MHelpDesk job. These are contingency items in case a field unit or battery is bad.</p><p>If a spare unit was <b>not used</b>, choose <b>RETURN UNUSED → IT INTAKE</b>. IT must verify it after transport before it can return to Shop Inventory. If it was used for a swap, mark it <b>USED FOR SWAP</b> and return the failed/replaced field unit through normal IT Intake. For spare batteries, enter the quantity used and Tech Check returns the remainder unused.</p>` },
    { kicker:'RETURN TO IT', title:'Return equipment to the right place', body:`<p>Most equipment coming back from the field uses <b>Return Unit to IT Intake</b>. Record the MHelpDesk reference, unit tag, condition, notes, and required photos.</p><p><b>110V Stand exception:</b> put the stand on the trailer, bring it back to the shop, and return it directly to <b>Shop Inventory</b> from Service. If the stand has no tag, choose <b>110V Stand — No Tag</b>; no tag does not block the return and IT Intake is not required.</p><p>For Helios and other solar equipment, Tech Check performs an AI-assisted OCR scan of the tag photo and compares it to the expected unit tag. A clear mismatch requires a new photo; an unreadable scan falls back to technician visual confirmation.</p>` },
    { kicker:'DAILY TOOLS', title:'Inspection, phone alerts, and history', body:`<p>Complete the Truck / Trailer Inspection from your own account. Assigned work appears in <b>My Work Today</b>. Use History to review work that has already been submitted.</p><p>Open <b>Menu → Phone Alerts</b> once on your phone if you want Tech Check to alert you when the Owner sends new work.</p>` },
    { kicker:'SERVICE FLOW', title:'Your simple Service flow', body:`<div class='wl-help-flow'><b>TRUCK CHECK</b><span>→</span><b>TRAILER CHECK IF NEEDED</b><span>→</span><b>PERMANENT TRUCK INVENTORY</b><span>→</span><b>TODAY’S TASKS</b><span>→</span><b>SERVICE / FIELD WORK</b></div><p>The safety inspection and permanent truck inventory are separate mandatory gates. If a permanent truck unit, one of the 3 exact truck SIM cards, or battery stock is used, Tech Check records the shortage and IT must replenish it before the truck is ready for another new field job.</p>` },
  ];
  if (role === 'owner') return [
    { kicker:'SERVICE TRUCK INVENTORY', title:'Owner can load and adjust permanent truck inventory', body:`<p>The Owner has the same authorized truck-inventory controls as IT: load or verify permanent unit tags, assign exact SIM numbers, and add battery stock physically placed on the truck.</p><p>Open <b>Team → Manage Truck Inventory</b>. Any Owner or IT inventory change makes Service physically re-verify the truck before it can be ready to leave the shop.</p>` },
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
    { kicker:'OPTIONAL SPARES', title:'Only handle a backup already required by the job', body:`<p>Truck spares are <b>not part of the morning Truck / Trailer Check</b> and are not required for every job.</p><p>If a backup is listed for the ticket, complete its normal IT check and checkout. The final handoff screen is read-only; if another spare is needed, the Owner must correct the assignment first.</p>` },
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
    {id:'solar',icon:'☀',title:'Solar / Helios checkout',desc:'Solar Stand, batteries, MPPT, charging proof, Ranger, and Helios.',body:"<p><b>Solar Spotter delivery:</b> Service verifies the assigned Solar Stand, required batteries, MPPT update/test, and active charging with the solar panel + batteries + MPPT connected. Upload the stand tag and charging/reading proof.</p><p><b>Ranger:</b> verify the required solar panel and charging. <b>Helios:</b> physically verify the required battery box, then complete the Service-side MPPT / solar charging verification and proof photos.</p>"},
    {id:'field',icon:'→',title:'Complete the field work',desc:'Delivery, service, swap, or pickup using the current ticket.',body:"<p>Work from the current MHelpDesk job. The MHelpDesk ticket changes from job to job, but the unit number remains universal inside Tech Check so history follows the equipment.</p>"},
    {id:'return',icon:'↩',title:'Return a unit to IT',desc:'Record the ticket, unit, condition, notes, and photos.',body:"<p>Use <b>Return Unit to IT Intake</b> when equipment comes back from the field. The return is recorded under your Service Tech name, then IT receives it through Intake.</p>"},
    {id:'inspection',icon:'✓',title:'Truck / Trailer Inspection',desc:'Complete the mandatory inspection before leaving the shop.',body:"<p>The Truck Inspection is required <b>every work day</b>. If you are taking a trailer, the Trailer Inspection is required too. After the safety inspection passes, Tech Check requires the separate permanent truck-inventory verification before a new field job can start.</p>"},
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
      <div><span class='wl-help-start-icon'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''></span><div><b>${['service','it'].includes(helpCenterRole)?guidedTourSteps(helpCenterRole).length+'-step guided tutorial':'Simple '+esc(helpRoleName(helpCenterRole))+' walkthrough'}</b><small>${['service','it'].includes(helpCenterRole)?'Follow the spotlight on the real app. Tap NEXT after each stop.':'One instruction at a time.'}</small></div></div>
      <button type='button' data-wl-help-walkthrough>START GUIDED TUTORIAL →</button>
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
        'Every work day, complete the Truck / Trailer Inspection from your own Service account before leaving the shop.',
        'After the inspection passes, physically verify all four permanent truck units and the required battery quantities.',
        'If anything is short, go to IT, accept the prepared replacement/restock, then recheck the truck inventory before starting a new field job.',
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
        'Truck spares only appear when they are already part of the job workflow.',
        'Do not add a new spare from the final handoff screen.',
        'If a listed BACKUP unit is part of the ticket, complete its full hardware/deploy-ready IT check, matching-tag photo, and signature.',
        'Complete the required IT checkout before Service can take a listed spare.',
        'If the ticket needs different equipment or an additional spare, stop and have the Owner correct the assignment before handoff.'
      ],
      selector:'#wlItWizardOnly'
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
let guidedTourRole = null;
let guidedTourStep = 0;
let guidedTourFirstTime = false;
let guidedTourRenderToken = 0;

function guidedTourSteps(role){
  const topControls=[
    { selector:'#techMenuButton', title:'MENU', text:'Open Menu anytime for Help, phone alerts, and other Tech Check tools.' },
    { selector:"[data-wl-menu-phone-alerts]", openMenu:true, title:'PHONE ALERTS', text:'Enable this once on each phone so new assignments can alert you when Tech Check is closed.' },
    { selector:".accountActions button[onclick='refreshData()']", closeMenu:true, title:'REFRESH', text:'Tap Refresh when you want Tech Check to reload the latest assignments and workflow status right now.' },
    { selector:".accountActions button[onclick='logout()']", closeMenu:true, title:'SIGN OUT', text:'Tap Sign Out when you are finished or when another technician needs to use this device.' }
  ];
  if(role==='service') return [
    { selector:'#wlSvcHome .wl-day-next-card', title:'READ THIS CARD FIRST', text:'This card shows your one required action. You do not need to search through the app.' },
    { selector:'#wlSvcHome .wl-day-next-card button', title:'TAP THIS BUTTON', text:'This starts the next required Service step.' },
    { selector:'#wlSvcHome .wl-service-flowline', title:'FOLLOW THIS ORDER', text:'Truck / Trailer Inspection → Required Truck Inventory → next job → field work.' },
    { selector:"#wlSvcHome [data-wl-service-truck-inventory]", open:'#wlSvcHome .wl-service-more', title:'REQUIRED TRUCK INVENTORY', text:'Every work day, verify the four assigned permanent units, the exact numbers of all 3 truck SIM cards, 25 Recon batteries, 4 AGM 12V 110Ah, and 2 LiTime 12V 100Ah before leaving the shop.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-service-truck-usage]", open:'#wlSvcHome .wl-service-more', title:'WHEN YOU USE TRUCK STOCK', text:'Record a permanent truck unit, exact SIM card, or battery stock used at the current MHelpDesk job. Tech Check automatically creates the IT restock requirement.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-service-open-job]", open:'#wlSvcHome .wl-service-more', title:'ENTER A TICKET', text:'Use the exact current MHelpDesk ticket number. Tech Check will find the correct Service job.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-service-return]", open:'#wlSvcHome .wl-service-more', title:'RETURN EQUIPMENT', text:'Use this when a unit comes back from the field. Tech Check will walk you through the return photo and IT Intake.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-svc='returns']", open:'#wlSvcHome .wl-service-more', title:'MY RETURNED UNITS', text:'Use this to see equipment you returned and whether IT Intake is still waiting or already complete.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-offline-start]", open:'#wlSvcHome .wl-service-more', title:'OFFLINE UNIT / CALL IT', text:'Use this when a field unit goes offline. Check power first, then call IT and record the troubleshooting here.', fallback:'#wlSvcHome .wl-service-more > summary' },
    { selector:"#wlSvcHome [data-wl-svc='history']", open:'#wlSvcHome .wl-service-more', title:'STATUS & HISTORY', text:'Use this to review your Service jobs, handoffs, returns, and completed work.', fallback:'#wlSvcHome .wl-service-more > summary' },
    ...topControls
  ];
  return [
    { selector:'#wlItHome .wl-day-next-card, #wlItHome .wl-it-ticket-prompt', title:'READ THIS FIRST', text:'Tech Check puts the next required IT action here. If nothing is waiting, this changes to Enter Another Ticket Number.' },
    { selector:'#wlItHome .wl-day-next-card button, #wlItHome #wlITHomeTicketSearch', title:'NEXT JOB / TICKET', text:'If Tech Check has work waiting, use the action button. If not, type the exact MHelpDesk ticket number right here.' },
    { selector:"#wlItHome [data-wl-it-find-home-job]", title:'OPEN THE TICKET', text:'Tech Check will find the active IT assignment, Intake return, or site-registration work tied to that ticket.' },
    { selector:'#wlItHome .wl-it-service-queue', title:'SERVICE QUEUE', text:'This is read-only. It shows IT handoffs already completed and waiting for Service to accept them.' },
    { selector:'#wlItHome .wl-it-flowline', title:'FOLLOW THIS ORDER', text:'IT Intake → site registration → active prep → next IT job → Service Queue.' },
    { selector:"#wlItHome [data-wl-it-open-job]", open:'#wlItHome .wl-it-more', title:'ENTER A TICKET', text:'Use the exact current MHelpDesk ticket number to open or claim the correct IT job.', fallback:'#wlItHome .wl-it-more > summary' },
    { selector:"#wlItHome [data-wl-mode='intake']", open:'#wlItHome .wl-it-more', title:'IT INTAKE AND RETURNS', text:'Returned equipment waits here. Open it and Tech Check will continue one check at a time.', fallback:'#wlItHome .wl-it-more > summary' },
    { selector:"#wlItHome [data-wl-it='pending']", open:'#wlItHome .wl-it-more', title:'RESUME EQUIPMENT PREP', text:'Use this to continue an IT prep job you already started. Saved work stays attached to the same ticket.', fallback:'#wlItHome .wl-it-more > summary' },
    { selector:"#wlItHome [data-wl-it='history']", open:'#wlItHome .wl-it-more', title:'STATUS & HISTORY', text:'Use this to review IT prep, handoffs, Intake work, site registration, and completed jobs.', fallback:'#wlItHome .wl-it-more > summary' },
    ...topControls
  ];
}

function ensureGuidedTourLayer(){
  let layer=document.getElementById('wlGuidedTourLayer');
  if(layer)return layer;
  layer=document.createElement('div');
  layer.id='wlGuidedTourLayer';
  layer.className='wl-guided-tour hidden';
  layer.innerHTML="<div class='wl-tour-shade top'></div><div class='wl-tour-shade left'></div><div class='wl-tour-shade right'></div><div class='wl-tour-shade bottom'></div><div class='wl-tour-blocker'></div><section class='wl-tour-tip' role='dialog' aria-modal='true'><div class='wl-tour-tip-head'><span id='wlTourCount'></span><button type='button' data-wl-tour-close aria-label='Close tutorial'>×</button></div><h3 id='wlTourTitle'></h3><p id='wlTourText'></p><div class='wl-tour-nav'><button type='button' data-wl-tour-back>BACK</button><button type='button' data-wl-tour-next>NEXT →</button></div></section>";
  document.body.append(layer);
  return layer;
}

function clearGuidedTourTarget(){
  document.querySelectorAll('.wl-guided-tour-target').forEach(el=>el.classList.remove('wl-guided-tour-target'));
}

function positionGuidedTour(step,target){
  const layer=ensureGuidedTourLayer();
  const tip=layer.querySelector('.wl-tour-tip');
  document.getElementById('wlTourCount').textContent='STEP '+(guidedTourStep+1)+' OF '+guidedTourSteps(guidedTourRole).length;
  document.getElementById('wlTourTitle').textContent=step.title;
  document.getElementById('wlTourText').textContent=step.text;
  const back=layer.querySelector('[data-wl-tour-back]');
  back.disabled=guidedTourStep===0;
  const next=layer.querySelector('[data-wl-tour-next]');
  next.textContent=guidedTourStep===guidedTourSteps(guidedTourRole).length-1?'FINISH ✓':'NEXT →';

  const pad=14;
  const rect=target.getBoundingClientRect();
  const top=Math.max(0,rect.top-pad), left=Math.max(0,rect.left-pad);
  const right=Math.min(innerWidth,rect.right+pad), bottom=Math.min(innerHeight,rect.bottom+pad);
  const setBox=(name,styles)=>{const el=layer.querySelector('.wl-tour-shade.'+name);Object.assign(el.style,styles);};
  setBox('top',{left:'0px',top:'0px',width:'100vw',height:top+'px'});
  setBox('bottom',{left:'0px',top:bottom+'px',width:'100vw',height:Math.max(0,innerHeight-bottom)+'px'});
  setBox('left',{left:'0px',top:top+'px',width:left+'px',height:Math.max(0,bottom-top)+'px'});
  setBox('right',{left:right+'px',top:top+'px',width:Math.max(0,innerWidth-right)+'px',height:Math.max(0,bottom-top)+'px'});
  const blocker=layer.querySelector('.wl-tour-blocker');
  Object.assign(blocker.style,{left:left+'px',top:top+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});

  const edge=12;
  const tipWidth=Math.min(430,innerWidth-(edge*2));
  tip.style.width=tipWidth+'px';
  tip.style.left=Math.max(edge,(innerWidth-tipWidth)/2)+'px';
  tip.style.maxHeight='42vh';
  tip.style.overflowY='auto';
  tip.style.removeProperty('--tour-arrow-x');
  tip.classList.remove('above','below');

  // Keep the instructions on the opposite half of the screen from the
  // highlighted control. This removes the fragile floating arrow card.
  const targetCenter=(rect.top+rect.bottom)/2;
  if(targetCenter>innerHeight/2){
    tip.style.top='calc(12px + env(safe-area-inset-top))';
    tip.style.bottom='auto';
  }else{
    tip.style.top='auto';
    tip.style.bottom='calc(12px + env(safe-area-inset-bottom))';
  }
}
async function showGuidedTourStep(){
  const token=++guidedTourRenderToken;
  const layer=ensureGuidedTourLayer();

  // Never expose a half-built tutorial card between steps.
  layer.classList.add('hidden');
  clearGuidedTourTarget();

  const steps=guidedTourSteps(guidedTourRole);
  guidedTourStep=Math.max(0,Math.min(guidedTourStep,steps.length-1));
  const step=steps[guidedTourStep];
  if(step.closeMenu)document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
  if(step.openMenu)await openTechMenu();
  if(step.open){
    const details=document.querySelector(step.open);
    if(details)details.open=true;
  }

  let target=document.querySelector(step.selector);
  if((!target || target.offsetParent===null) && step.fallback)target=document.querySelector(step.fallback);
  if(!target)return finishGuidedTour(false);

  // An instant scroll prevents the page and spotlight from visibly chasing
  // each other on iPhone.
  target.scrollIntoView({behavior:'auto',block:'center',inline:'nearest'});
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(token!==guidedTourRenderToken)return;

  clearGuidedTourTarget();
  target.classList.add('wl-guided-tour-target');
  positionGuidedTour(step,target);
  layer.classList.remove('hidden');
}

async function startGuidedTour(role,firstTime=false){
  guidedTourRole=['service','it'].includes(role)?role:currentRoleKey();
  if(!['service','it'].includes(guidedTourRole))return;
  guidedTourStep=0;
  guidedTourFirstTime=Boolean(firstTime);
  guidedTourRenderToken++;
  document.getElementById('wlGuidedTourLayer')?.classList.add('hidden');
  document.getElementById('wlHelpOverlay')?.classList.add('hidden');
  document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
  document.getElementById('wlHelpCoachToast')?.classList.remove('show');
  if(currentRoleKey()==='owner'){
    document.getElementById(guidedTourRole==='service'?'tab-svc':'tab-it')?.click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }

  // Reuse the already-loaded technician home. Rebuilding it here caused the
  // login screen to flash and race the first tutorial step.
  const readySelector=guidedTourRole==='service'
    ? '#wlSvcHome .wl-day-next-card'
    : '#wlItHome .wl-day-next-card, #wlItHome .wl-it-ticket-prompt';
  if(!document.querySelector(readySelector)){
    if(guidedTourRole==='service')await showSvcHome();
    else await showITHome();
  }
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return showGuidedTourStep();
}

async function finishGuidedTour(completed=true){
  guidedTourRenderToken++;
  clearGuidedTourTarget();
  const layer=document.getElementById('wlGuidedTourLayer');
  layer?.classList.add('hidden');
  document.getElementById('wlHelpCoachToast')?.classList.remove('show');
  document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
  const serviceMore=document.querySelector('#wlSvcHome .wl-service-more');
  const itMore=document.querySelector('#wlItHome .wl-it-more');
  if(serviceMore)serviceMore.open=false;
  if(itMore)itMore.open=false;
  if(completed&&guidedTourFirstTime){
    const tech=await currentTechIdentity().catch(()=>null);
    if(tech?.id){
      const now=new Date().toISOString();
      await liveDb.from('technician_training_state').upsert({user_id:tech.id,walkthrough_completed_at:now,last_help_opened_at:now,updated_at:now},{onConflict:'user_id'});
    }
  }
  guidedTourFirstTime=false;
}

function helpWalkthroughPages(role = currentRoleKey()) {
  const sections = helpStepsForRole(role);
  if (!['service','it'].includes(role)) {
    return sections.map(section => ({ section, instruction:null, instructionIndex:0, instructionCount:1 }));
  }
  return sections.flatMap(section => {
    const guide = helpStepGuide(role, section);
    const instructions = Array.isArray(guide.steps) && guide.steps.length
      ? guide.steps
      : ['Read this step and complete the matching action in Tech Check.'];
    return instructions.map((instruction, instructionIndex) => ({
      section,
      instruction,
      instructionIndex,
      instructionCount:instructions.length,
      selector:guide.selector || null,
    }));
  });
}

function showHelpStepInApp(){
  const role=helpWalkthroughRole || currentRoleKey();
  const pages=helpWalkthroughPages(role);
  const page=pages[Math.max(0,Math.min(helpWalkthroughStep,pages.length-1))];
  const step=page?.section || helpStepsForRole(role)[0];
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
        note.textContent='Open the matching job or workflow first, then tap “SHOW ME” again.';
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
    toast.innerHTML="<b>THIS IS THE BUTTON</b><span>Look for the highlighted control.</span><button type='button' data-wl-help-coach-return>BACK TO TRAINING</button>";
    toast.classList.add('show');
    setTimeout(()=>target.classList.remove('wl-help-live-highlight'),3200);
  },320);
}

function renderHelpWalkthrough() {
  const overlay = ensureHelpOverlay();
  const body = document.getElementById('wlHelpBody');
  const walkthroughRole=helpWalkthroughRole || currentRoleKey();
  const pages = helpWalkthroughPages(walkthroughRole);
  helpWalkthroughStep = Math.max(0, Math.min(helpWalkthroughStep, pages.length - 1));
  const page = pages[helpWalkthroughStep];
  const step = page.section;
  const helpTitle=document.getElementById('wlHelpTitle');
  if(helpTitle) helpTitle.textContent='Step-by-Step Training';
  const pct = Math.round((helpWalkthroughStep + 1) / pages.length * 100);
  const firstTime = helpWalkthroughMode === 'first';
  const last = helpWalkthroughStep === pages.length - 1;
  const simpleTech = ['service','it'].includes(walkthroughRole);

  if(simpleTech){
    const guide=helpStepGuide(walkthroughRole,step);
    const canShow=Boolean(guide.selector) && (currentRoleKey()===walkthroughRole || currentRoleKey()==='owner');
    body.innerHTML = `<div class='wl-help-progress'><span style='width:${pct}%'></span></div>
      <div class='wl-help-step-count'>STEP ${helpWalkthroughStep + 1} OF ${pages.length}</div>
      <div class='wl-help-simple-card'>
        <div class='wl-help-simple-role'>${esc(helpRoleName(walkthroughRole))}</div>
        <div class='wl-help-simple-number'>${helpWalkthroughStep + 1}</div>
        <div class='wl-next-kicker'>${esc(step.kicker)}</div>
        <h2>${esc(step.title)}</h2>
        <div class='wl-help-simple-instruction'>${esc(page.instruction)}</div>
        ${canShow ? "<button type='button' class='wl-help-simple-show' data-wl-help-show-step>SHOW ME IN THE APP →</button>" : ''}
      </div>
      <div class='wl-help-nav wl-help-simple-nav'>
        <button class='wl-prev' data-wl-help-prev ${helpWalkthroughStep === 0 ? 'disabled' : ''}>← BACK</button>
        <button class='wl-next ${last ? 'wl-finish' : ''}' data-wl-help-next>${last ? (firstTime ? 'FINISH ✓' : 'CLOSE HELP') : 'NEXT →'}</button>
      </div>
      ${firstTime && helpWalkthroughStep === 0 ? "<button class='wl-help-simple-skip' data-wl-help-skip>Skip for now</button>" : ''}`;
  } else {
    body.innerHTML = `<div class='wl-help-progress'><span style='width:${pct}%'></span></div><div class='wl-help-step-count'>${helpWalkthroughStep + 1} of ${pages.length}</div><div class='wl-help-card'><div class='wl-next-kicker'>${esc(step.kicker)}</div><h2>${esc(step.title)}</h2><div class='wl-help-copy'>${step.body}</div>${helpStepHowToHtml(walkthroughRole,step)}</div><div class='wl-help-nav'><button class='wl-prev' data-wl-help-prev ${helpWalkthroughStep === 0 ? 'disabled' : ''}>Back</button>${firstTime && helpWalkthroughStep === 0 ? `<button class='wl-help-skip' data-wl-help-skip>Skip for now</button>` : '<span></span>'}<button class='wl-next ${last ? 'wl-finish' : ''}' data-wl-help-next>${last ? (firstTime ? 'Finish Setup ✓' : 'Close Help') : 'Next →'}</button></div>`;
  }
  overlay.classList.remove('hidden');
}
async function openHelpWalkthrough(firstTime = false, roleOverride = null) {
  const requestedRole = firstTime ? currentRoleKey() : (roleOverride || helpCenterRole || currentRoleKey());
  if (['service','it'].includes(requestedRole)) return startGuidedTour(requestedRole, firstTime);
  helpWalkthroughMode = firstTime ? 'first' : 'help';
  helpWalkthroughRole = firstTime ? null : requestedRole;
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
  panel.classList.toggle('wl-tech-menu-dark', role !== 'owner');
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
  const roleActions = role === 'service' ? `
      <div class='wl-menu-section-label'>SERVICE ACTIONS</div>
      <button class='wl-app-menu-item' data-wl-menu-go='service-home'><span class='wl-app-menu-icon'>⌂</span><span><b>Service Home</b><small>Return to your next required action.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='service-ticket'><span class='wl-app-menu-icon'>#</span><span><b>Enter MHelpDesk Ticket</b><small>Open or claim the correct Service job.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='service-return'><span class='wl-app-menu-icon'>↩</span><span><b>Return Unit to IT</b><small>Record the unit, photo, and return.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='service-returns'><span class='wl-app-menu-icon'>R</span><span><b>My Returned Units</b><small>See what is waiting for IT Intake.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='service-offline'><span class='wl-app-menu-icon'>!</span><span><b>Offline Unit / Call IT</b><small>Check power, call IT, and record troubleshooting.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='service-history'><span class='wl-app-menu-icon'>✓</span><span><b>Status & History</b><small>Review Service work and inspections.</small></span><strong>›</strong></button>
    ` : `
      <div class='wl-menu-section-label'>IT ACTIONS</div>
      <button class='wl-app-menu-item' data-wl-menu-go='it-home'><span class='wl-app-menu-icon'>⌂</span><span><b>IT Home</b><small>Return to your next required action.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='it-ticket'><span class='wl-app-menu-icon'>#</span><span><b>Enter MHelpDesk Ticket</b><small>Open or claim the correct IT job.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='it-intake'><span class='wl-app-menu-icon'>↩</span><span><b>IT Intake / Returns</b><small>Continue returned-equipment Intake.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='it-prep'><span class='wl-app-menu-icon'>▶</span><span><b>Resume Equipment Prep</b><small>Continue saved IT preparation.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-go='it-history'><span class='wl-app-menu-icon'>✓</span><span><b>Status & History</b><small>Review prep, handoffs, Intake, and completed work.</small></span><strong>›</strong></button>
    `;
  body.innerHTML = `
    <div class='wl-app-menu-list'>
      ${roleActions}
      <div class='wl-menu-section-label'>HELP & PHONE</div>
      <button class='wl-app-menu-item' data-wl-menu-help><span class='wl-app-menu-icon'>?</span><span><b>Replay Guided Tutorial</b><small>Return directly to the step-by-step walkthrough.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-notifications><span class='wl-app-menu-icon'>●</span><span><b>Notifications</b><small>Open your Tech Check alerts and settings.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-phone-alerts><span class='wl-app-menu-icon'>↗</span><span><b>Phone Alerts</b><small>${esc(pushLabel)}</small></span><strong>${push?.ready ? 'ON' : '›'}</strong></button>
      <button class='wl-app-menu-item' data-wl-menu-refresh><span class='wl-app-menu-icon'>↻</span><span><b>Refresh Tech Check</b><small>Reload the latest assignments and workflow status.</small></span><strong>›</strong></button>
      <button class='wl-app-menu-item wl-menu-signout' data-wl-menu-signout><span class='wl-app-menu-icon'>×</span><span><b>Sign Out</b><small>Leave Tech Check on this device.</small></span><strong>›</strong></button>
    </div>
  `;
  panel.classList.remove('hidden');
}
async function maybeShowFirstTimeWalkthrough() {
  if (walkthroughDismissedSession || document.getElementById('appView')?.classList.contains('hidden')) return;
  const roleLabel = roleText();
  if (!roleLabel.includes('IT Technician') && !roleLabel.includes('Service Tech')) return;
  const role=currentRoleKey();
  const ready=role==='service'
    ? document.querySelector('#wlSvcHome .wl-day-next-card')
    : role==='it'
      ? document.querySelector('#wlItHome .wl-day-next-card')
      : null;
  if(!ready){setTimeout(maybeShowFirstTimeWalkthrough,180);return;}
  const tech = await currentTechIdentity().catch(() => null);
  if (!tech?.id || walkthroughCheckedUserId === tech.id) return;
  walkthroughCheckedUserId = tech.id;
  const { data } = await liveDb.from('technician_training_state').select('walkthrough_completed_at').eq('user_id',tech.id).maybeSingle();
  if (!data?.walkthrough_completed_at) openHelpWalkthrough(true);
}

async function myActiveAssignments(role = null) {
  const wantedRole = role || currentRoleKey();
  if (!['it','service'].includes(wantedRole)) return [];
  const preview=ownerTestPreviewFor(wantedRole);
  if(preview){
    const {data,error}=await liveDb.from('job_assignments').select('*')
      .eq('assigned_role',wantedRole)
      .in('status',['assigned','started'])
      .order('assigned_at',{ascending:true});
    if(error){console.warn('Could not load Owner Test assignment queue',error);return [];}
    return (data||[]).filter(a=>String(a.ticket_no||'')===String(preview.ticket||'') || a.assignee_user_id===preview.persona_id);
  }
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
const openNotificationPanel = (...args) => window.TechCheckNotifications.openPanel(...args);
const saveNotificationSettings = (...args) => window.TechCheckNotifications.saveSettings(...args);
const enableBrowserAlerts = (...args) => window.TechCheckNotifications.enableBrowserAlerts(...args);
const refreshNotificationBadge = (...args) => window.TechCheckNotifications.refreshBadge(...args);
async function setupNotificationRealtime(force=false){
  return window.TechCheckNotifications.setupRealtime(force,payload=>{
    refreshNotificationBadge();
    scheduleTechWorkflowRefresh('notification',payload);
    if(payload.new.kind==='owner_action'&&roleText().includes('Owner/Admin')){installOwnerIntake(true);window.TechCheckContext?.refresh?.();}
  });
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
  const testPreview=ownerTestPreviewContext();
  if(assignment?.assigned_role==='service' && assignment?.status!=='started' && !testPreview){
    const {data:departure,error:departureError}=await liveDb.rpc('service_departure_readiness_v1');
    if(departureError)return {ready:false,label:'START-DAY CHECK REQUIRED',detail:departureError.message||'Truck readiness could not be verified.'};
    if(!departure?.inspection_ready)return {ready:false,label:'TRUCK / TRAILER INSPECTION REQUIRED',detail:'Complete and pass today’s mandatory Truck Check and Trailer Check when a trailer is being used.'};
    if(!departure?.inventory_ready)return {ready:false,label:'TRUCK INVENTORY / RESTOCK REQUIRED',detail:'Verify the permanent truck inventory and complete any IT restock before leaving the shop for a new Service job.'};
  }
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
    const {error:startError}=await setJobAssignmentStatusCompat(id,'started');
    if(startError)return alert(startError.message);
  }
  serviceReturn={ step:1, ticket:String(a.ticket_no||''), unit:'', type:'', notes:'', photo:null, conditionPhotos:[], damagePhotos:[], knownUnits:await rememberedUnitsForTicket(a.ticket_no) };
  serviceReturnRecovered=false;
  await saveServiceReturnDraft();
  return renderServiceReturn();
}
async function completeServiceFieldAssignment(id) {
  if(!confirm('Mark this Tech Check Service task complete?\n\nThis only updates Tech Check. It does not change MHelpDesk.')) return;
  const {data:rows}=await liveDb.from('job_assignments').select('ticket_no').eq('id',id).limit(1);
  const ticket=rows?.[0]?.ticket_no||activeSvcAssignment?.ticket_no||'';
  const {error}=await setJobAssignmentStatusCompat(id,'completed');
  if(error)return alert(error.message);
  activeSvcAssignment=null;
  rememberTechCompletion('service',ticket,'JOB COMPLETE');
  await showSvcHome();
}
async function serviceReturnAssignmentProgress(ticket,techId) {
  const {data:rows}=await liveDb.from('job_assignments').select('id,status,work_type').eq('ticket_no',String(ticket||'')).eq('assigned_role','service').eq('assignee_user_id',techId).order('assigned_at',{ascending:false}).limit(1);
  const a=rows?.[0]||null;
  const {data:returns}=await liveDb.from('unit_returns').select('id,equipment_type').eq('ticket_no',String(ticket||'')).eq('service_tech_id',techId);
  const returnRows=returns||[];
  const {data:preps}=await liveDb.from('prep_tickets').select('id,status,prep_items(id,unit_tag,equipment_type,purpose,swap_outcome)').eq('ticket_no',String(ticket||'')).eq('status','released').order('released_at',{ascending:false}).limit(5);

  // Display-only progress. Assignment completion is authoritative in Supabase:
  // PICKUP is completed from saved return/intake records; SWAP/handoff work
  // completes through the field/close gates. The browser never decides completion.
  const activeSwapPrep=(preps||[]).find(p=>(p.prep_items||[]).some(i=>i.purpose==='SWAP'));
  if(activeSwapPrep){
    const swaps=(activeSwapPrep.prep_items||[]).filter(i=>i.purpose==='SWAP');
    const replacementKeys=new Set(swaps.map(i=>norm(i.unit_tag)).filter(Boolean));
    const installed=swaps.filter(i=>i.swap_outcome==='installed');
    const oldReturnRows=returnRows.filter(r=>!replacementKeys.has(norm(r.unit_tag)));
    return {completed:a?.status==='completed',count:oldReturnRows.length,required:installed.length,fieldPending:true};
  }

  // Do not duplicate database equipment-count semantics here. Re-read the
  // assignment only to reflect whether the authoritative trigger completed it.
  return {completed:a?.status==='completed',count:returnRows.length,required:0};
}
async function startAssignedJob(id,{serviceTicketVerified=false}={}) {
  let { data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1);
  let assignment = rows?.[0];
  if (!assignment) return alert('That assignment is no longer available.');
  const gate = await assignmentGateState(assignment);
  if (!gate.ready) return alert(gate.label + '\n\n' + gate.detail);

  if (assignment.assigned_role==='service' && !serviceTicketVerified) {
    return showServiceJobLookup();
  }

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
    await sendTechWorkflowBroadcast('assignment_claimed',{assignment_id:id,role:'it',ticket_no:assignment.ticket_no});
    ({ data: rows } = await liveDb.from('job_assignments').select('*').eq('id', id).limit(1));
    assignment = rows?.[0];
    if (!assignment) return alert('The accepted IT assignment could not be reopened.');
  }

  if (assignment.assigned_role === 'it') {
    if (String(assignment.work_type||'').toLowerCase()==='pickup' || (!assignment.work_type && /\bpick[ -]?up\b/i.test(String(assignment.job_description||'')))) {
      if (assignment.status !== 'started') await setJobAssignmentStatusCompat(id,'started');
      const { data: returns } = await liveDb.from('unit_returns').select('id,status').eq('ticket_no',assignment.ticket_no).eq('status','waiting_it').order('returned_at',{ascending:true}).limit(1);
      if (!returns?.length) return alert('WAITING FOR SERVICE RETURN\n\nPickup starts with Service. IT Intake cannot begin until Service checks the returned equipment in.');
      return startITIntake(returns[0].id);
    }
    const tech = await currentTechIdentity();
    const testPreview=ownerTestPreviewFor('it');
    let existingQuery=liveDb.from('prep_tickets')
      .select('id,ticket_no,status,created_by,is_test')
      .eq('ticket_no', assignment.ticket_no)
      .eq('status', 'draft');
    if(!testPreview) existingQuery=existingQuery.eq('created_by', tech.id);
    else existingQuery=existingQuery.eq('is_test',true);
    const { data: existing } = await existingQuery
      .order('created_at', { ascending: false })
      .limit(1);
    if (existing?.[0]) {
      const { error: linkError } = await linkAssignmentToPrepCompat( id,existing[0].id );
      if (linkError) return alert(linkError.message);
      pendingAssignmentLinkId = null;
      return showItPrep(existing[0].id);
    }
    if (assignment.status !== 'started') await setJobAssignmentStatusCompat( id,'started');
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
    refreshAssignedITSetupSummary();
    return;
  }

  activeSvcAssignment = assignment;
  if (String(assignment.work_type || '').toLowerCase()==='pickup' || (!assignment.work_type && /\bpick[ -]?up\b/i.test(String(assignment.job_description||'')))) {
    return beginServiceReturnForAssignment(id);
  }
  if (!assignment.requires_it_handoff) {
    if (assignment.status !== 'started') {
      const {error:startError}=await setJobAssignmentStatusCompat(id,'started');
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
    if (assignment.status !== 'started') await setJobAssignmentStatusCompat( id,'started');
    return alert('This MHelpDesk job is assigned to you, but IT has not created the Service handoff yet. It will stay under My Work Today.');
  }
  const { error: linkError } = await linkAssignmentToPrepCompat( id,released[0].id );
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

let techCompletionFlash={service:null,it:null};
function rememberTechCompletion(role,ticket='',label='TASK COMPLETE'){
  if(!['service','it'].includes(role))return;
  techCompletionFlash[role]={ticket:String(ticket||''),label:String(label||'TASK COMPLETE')};
}
function takeTechCompletion(role){
  const value=techCompletionFlash[role]||null;
  techCompletionFlash[role]=null;
  return value;
}
function techAssignmentIsCurrent(a,today=techCheckDateKey()){
  const date=String(a?.scheduled_for||'').trim();
  return !date || date<=today;
}
function techAssignmentScheduleText(a){
  const date=String(a?.scheduled_for||'').trim();
  const time=String(a?.scheduled_time||'').trim().slice(0,5);
  if(!date)return time?time:'UNSCHEDULED';
  const d=new Date(date+'T12:00:00');
  const day=Number.isNaN(d.getTime())?date:d.toLocaleDateString([], {month:'short',day:'numeric'});
  return time?day+' · '+time:day;
}
async function assignmentGateRows(assignments=[]){
  return Promise.all((assignments||[]).map(async assignment=>{
    try{return {assignment,gate:await assignmentGateState(assignment)};}
    catch(error){return {assignment,gate:{ready:false,label:'CHECK REQUIRED',detail:error?.message||'Could not verify this job yet.'}};}
  }));
}
async function serviceDayState(){
  const preview=ownerTestPreviewFor('service');
  const tech=await currentTechIdentity().catch(()=>null);
  const [work,spares,healthQ,truckQ]=await Promise.all([
    serviceWorkData(),
    myTruckSpareData(),
    preview?Promise.resolve({data:{recovery:null}}):liveDb.rpc('get_workflow_health_v1'),
    preview?Promise.resolve({data:{inspection_ready:true,inventory_ready:true,departure_ready:true,units:[],sims:[],stock:{},restock_requests:[]}})
      : liveDb.rpc('service_departure_readiness_v1',tech?.id?{p_service_tech_id:tech.id}:{})
  ]);
  const today=techCheckDateKey();
  const currentAssignments=(work.assignments||[]).filter(a=>techAssignmentIsCurrent(a,today));
  const futureAssignments=(work.assignments||[]).filter(a=>!techAssignmentIsCurrent(a,today));
  const activeStarted=currentAssignments.find(a=>a.status==='started')||null;
  const gates=await assignmentGateRows(currentAssignments);
  const truckReadiness=truckQ?.error
    ? {inspection_ready:Boolean(work.inspectionDone),inventory_ready:false,departure_ready:false,units:[],stock:{},restock_requests:[]}
    : (truckQ?.data||{});
  return {
    work,
    spares,
    truckReadiness,
    inspectionDue:preview?false:!Boolean(truckReadiness.inspection_ready),
    inventoryDue:preview?false:Boolean(truckReadiness.inspection_ready&&!truckReadiness.inventory_ready),
    spareCount:(spares?.units?.length||0)+(spares?.batteries?.length||0),
    currentAssignments,
    futureAssignments,
    activeStarted,
    gates,
    recovery:healthQ?.data?.recovery||null,
    nextReady:gates.find(row=>row.gate?.ready)||null,
    nextBlocked:gates.find(row=>!row.gate?.ready)||null
  };
}
async function myITDraftPreps(){
  const tech=await currentTechIdentity().catch(()=>null);
  if(!tech?.id)return [];
  const preview=ownerTestPreviewFor('it');
  let q=liveDb.from('prep_tickets').select('id,ticket_no,site,status,created_at,work_type').eq('status','draft');
  q=preview?q.eq('ticket_no',preview.ticket):q.eq('created_by',tech.id);
  const {data,error}=await q.order('created_at',{ascending:true});
  if(error)throw error;
  return data||[];
}
async function itDayState(){
  const today=techCheckDateKey();
  const [assignmentsQ,returnsQ,siteQ,draftsQ,healthQ,serviceQueueQ,truckRestockQ]=await Promise.all([
    myActiveAssignments('it'),
    liveDb.from('unit_returns').select('id,ticket_no,unit_tag,equipment_type,status,returned_at').eq('status','waiting_it').order('returned_at',{ascending:true}).limit(50),
    swapSiteRegistrationRows(),
    myITDraftPreps(),
    liveDb.rpc('get_workflow_health_v1'),
    liveDb.from('prep_tickets').select('id,ticket_no,site,status,released_at,released_by_name,work_type').eq('status','released').order('released_at',{ascending:true}).limit(12),
    liveDb.rpc('get_it_service_truck_restock_queue_v1')
  ]);
  if(returnsQ.error)throw returnsQ.error;
  const assignments=assignmentsQ||[];
  const currentAssignments=assignments.filter(a=>techAssignmentIsCurrent(a,today));
  const futureAssignments=assignments.filter(a=>!techAssignmentIsCurrent(a,today));
  const gates=await assignmentGateRows(currentAssignments);
  return {
    currentAssignments,
    futureAssignments,
    waitingReturns:returnsQ.data||[],
    siteTasks:siteQ||[],
    drafts:draftsQ||[],
    gates,
    recovery:healthQ?.data?.recovery||null,
    serviceQueue:serviceQueueQ?.error ? [] : (serviceQueueQ?.data||[]),
    truckRestockQueue:truckRestockQ?.error ? [] : (truckRestockQ?.data||[]),
    nextReady:gates.find(row=>row.gate?.ready)||null,
    nextBlocked:gates.find(row=>!row.gate?.ready)||null
  };
}
function techCompletionBanner(flash){
  if(!flash)return '';
  return `<div class='wl-day-complete-flash'><b>✓ ${esc(flash.label)}</b>${flash.ticket?`<span>MHelpDesk #${esc(flash.ticket)}</span>`:''}<small>Tech Check automatically checked what you need to do next.</small></div>`;
}
function serviceNextActionHtml(state){
  if(state.inspectionDue){
    return `<div class='wl-day-next-card urgent'><span>MANDATORY BEFORE LEAVING SHOP</span><b>TRUCK / TRAILER INSPECTION</b><small>Complete the Truck Check every work day. If you are taking a trailer, its inspection is mandatory too.</small><button class='wl-service-start' data-wl-svc='inspect'>START INSPECTION</button></div>`;
  }
  if(state.activeStarted){
    const a=state.activeStarted;
    return `<div class='wl-day-next-card urgent'><span>ACTIVE FIELD JOB</span><b>MHELPDESK #${esc(a.ticket_no)}</b><small>${esc(a.site||'No site listed')} · Finish the job already in progress. Any truck shortage must be restocked before the next new job.</small><button class='wl-service-start' data-wl-service-take-job='${esc(a.id)}'>CONTINUE JOB</button></div>`;
  }
  if(state.inventoryDue){
    const readyCount=(state.truckReadiness?.units||[]).filter(u=>u.status==='assigned'&&u.unit_tag).length;
    const simCount=(state.truckReadiness?.sims||[]).filter(s=>s.status==='assigned'&&s.sim_number).length;
    return `<div class='wl-day-next-card urgent'><span>MANDATORY BEFORE LEAVING SHOP</span><b>REQUIRED TRUCK INVENTORY</b><small>${readyCount}/4 permanent units · ${simCount}/3 exact SIM cards · Verify 25 Recon batteries · 4 AGM 12V 110Ah · 2 LiTime 12V 100Ah. Missing items must be restocked by IT.</small><button class='wl-service-start' data-wl-service-truck-inventory>CHECK / RESTOCK TRUCK</button></div>`;
  }
  if(state.spareCount>0){
    return `<div class='wl-day-next-card urgent'><span>NEXT REQUIRED ACTION</span><b>RESOLVE TRUCK SPARES · ${state.spareCount}</b><small>Used / unused backup equipment must be resolved before your day can close.</small><button class='wl-service-start' data-wl-service-resolve-spares>RESOLVE SPARES</button></div>`;
  }
  if(state.recovery?.kind==='service_job'){
    const a=state.currentAssignments.find(x=>String(x.id)===String(state.recovery.record_id));
    if(a)return `<div class='wl-day-next-card urgent'><span>CONTINUE WHERE YOU STOPPED</span><b>${esc(state.recovery.title)}</b><small>${esc(state.recovery.step||'Continue this field job.')}</small><button class='wl-service-start' data-wl-service-take-job='${esc(a.id)}'>RESUME JOB</button></div>`;
  }
  if(state.nextReady){
    const a=state.nextReady.assignment;
    return `<div class='wl-day-next-card'><span>NEXT JOB</span><b>MHELPDESK #${esc(a.ticket_no)}</b><small>${esc(a.site||'No site listed')} · ${esc(String(a.work_type||'service').toUpperCase())} · ${esc(techAssignmentScheduleText(a))}</small><button class='wl-service-start' data-wl-service-take-job='${esc(a.id)}'>OPEN NEXT JOB</button></div>`;
  }
  if(state.nextBlocked){
    const a=state.nextBlocked.assignment,gate=state.nextBlocked.gate;
    return `<div class='wl-day-next-card waiting'><span>TODAY'S JOB IS WAITING</span><b>MHELPDESK #${esc(a.ticket_no)}</b><small>${esc(gate.label||'WAITING')} · ${esc(gate.detail||'This job is not ready yet.')}</small><button class='wl-big wl-gray' data-wl-service-open-job>CHECK / ENTER A TICKET</button></div>`;
  }
  return `<div class='wl-day-next-card done'><span>ALL REQUIRED WORK IS CLEAR</span><b>END MY DAY</b><small>No unresolved Service work for today.${state.futureAssignments.length?` ${state.futureAssignments.length} future assignment${state.futureAssignments.length===1?' is':'s are'} already scheduled and will not block today.`:''}</small><button class='wl-service-start' data-wl-tech-end-day='service'>END MY DAY</button></div>`;
}
function itNextActionHtml(state){
  const r=state.waitingReturns[0];
  if(r){
    return `<div class='wl-day-next-card urgent'><span>NEXT REQUIRED ACTION</span><b>IT INTAKE</b><small>MHelpDesk #${esc(r.ticket_no)} · ${esc(r.equipment_type||'Unit')} ${esc(r.unit_tag||'')}</small><button class='wl-it-start' data-wl-intake-start='${esc(r.id)}'>START IT INTAKE</button></div>`;
  }
  const site=state.siteTasks[0];
  if(site){
    return `<div class='wl-day-next-card urgent'><span>NEXT REQUIRED ACTION</span><b>SWAP SITE REGISTRATION</b><small>MHelpDesk #${esc(site.ticket_no)} · ${esc(site.equipment_type||'Unit')} ${esc(site.unit_tag||'')} · ${esc(site.site||'Customer site')}</small><button class='wl-it-start' data-wl-confirm-swap-site='${esc(site.id)}' data-wl-swap-site-label='${esc((site.equipment_type||'Unit')+' '+(site.unit_tag||''))}' data-wl-swap-site='${esc(site.site||'Customer site')}'>CONFIRM SITE REGISTRATION</button></div>`;
  }
  const truckRestock=(state.truckRestockQueue||[]).find(r=>['requested','preparing'].includes(r.status));
  if(truckRestock){
    return `<div class='wl-day-next-card urgent'><span>SERVICE TRUCK RESTOCK</span><b>${esc(truckRestock.service_tech_name)}</b><small>${esc(truckRestock.item_kind==='unit' ? '1 × '+truckRestock.item_type : truckRestock.qty_needed+' × '+truckRestock.item_type)} · Required before this Service truck can leave for a new job.</small><button class='wl-it-start' data-wl-it-truck-restock>OPEN TRUCK RESTOCK</button></div>`;
  }
  const draft=state.drafts[0];
  if(draft){
    return `<div class='wl-day-next-card'><span>RESUME IT JOB</span><b>MHELPDESK #${esc(draft.ticket_no)}</b><small>${esc(draft.site||'No site listed')} · ${esc(String(draft.work_type||'service').toUpperCase())}</small><button class='wl-it-start' data-wl-open-it='${esc(draft.id)}'>CONTINUE IT PREP</button></div>`;
  }
  if(state.nextReady){
    const a=state.nextReady.assignment;
    return `<div class='wl-day-next-card'><span>NEXT IT JOB</span><b>MHELPDESK #${esc(a.ticket_no)}</b><small>${esc(a.site||'No site listed')} · ${esc(String(a.work_type||'service').toUpperCase())} · ${esc(techAssignmentScheduleText(a))}</small><button class='wl-it-start' data-wl-start-assignment='${esc(a.id)}'>OPEN NEXT IT JOB</button></div>`;
  }
  if(state.nextBlocked){
    const a=state.nextBlocked.assignment,gate=state.nextBlocked.gate;
    return `<div class='wl-day-next-card waiting'><span>IT JOB IS WAITING</span><b>MHELPDESK #${esc(a.ticket_no)}</b><small>${esc(gate.label||'WAITING')} · ${esc(gate.detail||'This IT job is not ready yet.')}</small><button class='wl-big wl-gray' data-wl-it-open-job>CHECK / ENTER A TICKET</button></div>`;
  }
  return `<div class='wl-it-ticket-prompt'><span>READY FOR THE NEXT TICKET</span><b>ENTER ANOTHER TICKET NUMBER</b><small>No unresolved IT work is waiting right now.${state.futureAssignments.length?` ${state.futureAssignments.length} future assignment${state.futureAssignments.length===1?' is':'s are'} already scheduled.`:''}</small><div class='wl-it-home-ticket-entry'><input id='wlITHomeTicketSearch' inputmode='numeric' autocomplete='off' placeholder='MHELPDESK TICKET #'><button type='button' data-wl-it-find-home-job>OPEN TICKET →</button></div></div>`;
}
function itServiceQueueHtml(state){
  const rows=Array.isArray(state?.serviceQueue)?state.serviceQueue:[];
  const list=rows.slice(0,6).map(row=>`<div class='wl-it-service-queue-row'><div><b>MHelpDesk #${esc(row.ticket_no||'—')}</b><span>${esc(row.site||'Site not listed')}</span></div><em>WAITING FOR SERVICE</em></div>`).join('');
  return `<section class='wl-it-service-queue'>
    <div class='wl-it-service-queue-head'><span>SERVICE QUEUE</span><b>${rows.length} waiting</b></div>
    ${list || "<div class='wl-it-service-queue-empty'>No IT handoffs are waiting for Service right now.</div>"}
    ${rows.length>6?`<div class='wl-it-service-queue-more'>+${rows.length-6} more in Status & History</div>`:''}
  </section>`;
}

let ownerWorkflowHealth=null;
async function installOwnerWorkflowHealth(){
  const {data,error}=await liveDb.rpc('get_workflow_health_v1');
  if(error)throw error;
  ownerWorkflowHealth=data||null;
  renderOwnerWorkflowHealth();
  return ownerWorkflowHealth;
}
function renderOwnerWorkflowHealth(){
  const page=document.getElementById('ownerAppPage')||document.getElementById('view-owner');
  if(!page)return;
  let card=document.getElementById('ownerWorkflowHealthCard');
  const issues=Array.isArray(ownerWorkflowHealth?.issues)?ownerWorkflowHealth.issues:[];
  if(!issues.length){card?.remove();return;}
  if(!card){card=document.createElement('section');card.id='ownerWorkflowHealthCard';card.className='owner-workflow-health';const anchor=document.getElementById('ownerRouteView');page.insertBefore(card,anchor||page.firstChild);}
  card.innerHTML=`<div class='owner-health-head'><div><span>WORKFLOW HEALTH</span><h2>${issues.length} WORKFLOW ISSUE${issues.length===1?'':'S'} NEED ATTENTION</h2></div><b>${Number(ownerWorkflowHealth?.critical_count||0)} CRITICAL</b></div>
    <div class='owner-health-list'>${issues.map(issue=>`<article class='${issue.severity==='critical'?'critical':'warning'}'><div><span>MHELPDESK #${esc(issue.ticket_no||'—')}</span><b>${esc(issue.title)}</b><small>${esc(issue.detail)}</small></div>${issue.repairable?`<button type='button' data-owner-repair-workflow='${esc(issue.issue_key)}'>REPAIR WORKFLOW</button>`:`<em>REVIEW REQUIRED</em>`}</article>`).join('')}</div>
    <p>Safe Repair only relinks or recreates workflow routing already proven by saved records. It never creates photos, signatures, physical checks, swap answers, or inventory decisions.</p>`;
}
async function ownerRepairWorkflow(issueKey){
  if(!issueKey)return;
  if(!confirm('Repair this workflow using the existing saved records?\n\nTech Check will not invent evidence or technician confirmations.'))return;
  const {data,error}=await liveDb.rpc('repair_workflow_issue_v1',{p_issue_key:issueKey});
  if(error)return alert(error.message||'The workflow could not be repaired.');
  alert(`Workflow repaired for MHelpDesk #${data?.ticket_no||''}. An audit entry was saved.`);
  await runOwnerRefresh(true);
}
async function showServiceSpareResolution(){
  let card=document.getElementById('wlSvcSpareResolution');
  if(!card){card=document.createElement('div');card.id='wlSvcSpareResolution';card.className='card wl-service-simple-card';viewSvc().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading truck spares…');
  hideChildren(viewSvc(),[card]);
  try{
    const spares=await techDashboardTimeout(myTruckSpareData(),{units:[],batteries:[]});
    const count=(spares.units?.length||0)+(spares.batteries?.length||0);
    if(!count)return showSvcHome();
    card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← BACK</button>${progress('REQUIRED FOLLOW-UP','Resolve truck spares',1,1)}${truckSpareServiceHtml(spares)}`;
    hideChildren(viewSvc(),[card]);resetWizardPosition();
  }catch(error){
    card.innerHTML=techDashboardErrorHtml('service',error?.message||'Could not load truck spares.');
  }
}
async function attemptTechEndDay(role){
  try{
    if(role==='service'){
      const state=await techDashboardTimeout(serviceDayState(),null);
      const blockers=[];
      if(state.inspectionDue)blockers.push('truck / trailer inspection');
      if(!state.truckReadiness?.inventory_ready)blockers.push('permanent truck inventory / IT restock');
      if(state.spareCount)blockers.push(state.spareCount+' unresolved job-specific truck spare'+(state.spareCount===1?'':'s'));
      if(state.currentAssignments.length)blockers.push(state.currentAssignments.length+' active job'+(state.currentAssignments.length===1?'':'s'));
      if(blockers.length){alert('END MY DAY IS BLOCKED\n\nFinish: '+blockers.join(', ')+'.');return showSvcHome();}
      return showTechDayComplete('service',state.futureAssignments.length);
    }
    const state=await techDashboardTimeout(itDayState(),null);
    const blockers=[];
    if(state.waitingReturns.length)blockers.push(state.waitingReturns.length+' IT Intake return'+(state.waitingReturns.length===1?'':'s'));
    if(state.siteTasks.length)blockers.push(state.siteTasks.length+' site registration'+(state.siteTasks.length===1?'':'s'));
    if(state.drafts.length)blockers.push(state.drafts.length+' open IT prep'+(state.drafts.length===1?'':'s'));
    if(state.currentAssignments.length)blockers.push(state.currentAssignments.length+' active IT job'+(state.currentAssignments.length===1?'':'s'));
    if(blockers.length){alert('END MY DAY IS BLOCKED\n\nFinish: '+blockers.join(', ')+'.');return showITHome();}
    return showTechDayComplete('it',state.futureAssignments.length);
  }catch(error){
    alert('Tech Check could not verify that all required work is finished. End My Day stays blocked until the live work check succeeds.');
    return role==='it'?showITHome():showSvcHome();
  }
}
function showTechDayComplete(role,futureCount=0){
  const host=role==='it'?viewIT():viewSvc();
  if(!host)return;
  let card=document.getElementById(role==='it'?'wlItDayComplete':'wlSvcDayComplete');
  if(!card){card=document.createElement('div');card.id=role==='it'?'wlItDayComplete':'wlSvcDayComplete';card.className='card wl-day-complete-card';host.append(card);}
  card.innerHTML=`<div class='wl-day-check'>✓</div><div class='wl-day-kicker'>TECH CHECK</div><h1>DAY COMPLETE</h1><p>No unresolved ${role==='it'?'IT':'Service'} work is waiting for you today.</p>${futureCount?`<div class='wl-day-future'>${futureCount} future assignment${futureCount===1?' is':'s are'} already scheduled. ${futureCount===1?'It does':'They do'} not block today.</div>`:''}<button class='${role==='it'?'wl-it-start':'wl-service-start'} top10' data-wl-tech-day-back='${role}'>BACK TO TECH CHECK</button>`;
  hideChildren(host,[card]);resetWizardPosition();
}

function ensureITCommandDashboardStyles(){
  if(document.getElementById('wlItCommandDashboardStyles'))return;
  const s=document.createElement('style');
  s.id='wlItCommandDashboardStyles';
  s.textContent=`
    .wl-it-command-shell{display:grid;grid-template-columns:260px minmax(0,1fr);width:100%;min-height:calc(100vh - 150px);background:#071018;border:1px solid #263746;border-radius:22px;overflow:hidden;color:#eef4f8}
    .wl-it-command-sidebar{background:#0b141d;border-right:1px solid #253541;padding:20px 16px;display:flex;flex-direction:column;gap:18px}
    .wl-it-command-brand{display:flex;gap:10px;align-items:center;padding:4px 6px 14px;border-bottom:1px solid #263746}.wl-it-command-brand img{width:34px;height:34px}.wl-it-command-brand b{display:block;font-size:15px;letter-spacing:.08em}.wl-it-command-brand small{color:#9caaba}
    .wl-it-command-nav{display:grid;gap:7px}.wl-it-command-nav button,.wl-it-command-nav a{display:block;width:100%;box-sizing:border-box;text-align:left;text-decoration:none;background:transparent!important;color:#e8eef3!important;border:1px solid transparent!important;border-radius:10px;padding:11px 12px;font-weight:850;min-height:44px}.wl-it-command-nav button:hover,.wl-it-command-nav a:hover{background:#121f2a!important;border-color:#304657!important}.wl-it-command-nav .active{background:#172633!important;border-left:3px solid #e22b2f!important}
    .wl-it-command-limit{margin-top:auto;border-top:1px solid #263746;padding:13px 8px 0;color:#91a0ad;font-size:11px;line-height:1.45}.wl-it-command-limit b{color:#eef4f8;display:block;margin-bottom:4px}
    .wl-it-command-workspace{padding:28px 32px;min-width:0;width:100%;box-sizing:border-box}.wl-it-command-head{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:10px}.wl-it-command-head small{display:block;color:#ef4a4e;font-weight:900;letter-spacing:.12em}.wl-it-command-head h1{font-size:18px;line-height:1.1;margin:4px 0 2px;color:#fff}.wl-it-command-head p{margin:0;color:#9ba9b6;font-size:12px}.wl-it-hero-greeting{display:flex;flex-direction:column;justify-content:center;min-width:0;background:radial-gradient(circle at 70% 50%,rgba(194,20,31,.28),transparent 45%),linear-gradient(115deg,#111b24,#220c13 62%,#0c1821);border:1px solid #2b4050;border-radius:16px;padding:20px 24px;overflow:hidden}.wl-it-hero-greeting small{color:#ff4c54;font-weight:900;letter-spacing:.12em}.wl-it-hero-greeting h2{font-size:clamp(27px,2.3vw,40px);line-height:1.02;margin:7px 0 5px;color:#fff}.wl-it-hero-greeting p{margin:0;color:#d2dbe1;font-size:14px}
    .wl-it-owner-hero{display:grid;grid-template-columns:minmax(360px,1.05fr) minmax(300px,.75fr) minmax(340px,.9fr);gap:14px;margin-bottom:18px}.wl-it-clock-card,.wl-it-weather-card{border:1px solid #2b4050;border-radius:16px;background:#0d1923;padding:16px;min-width:0;overflow:hidden}.wl-it-clock-card small,.wl-it-weather-card small{display:block;color:#8ea0ae;font-weight:900;letter-spacing:.1em}.wl-it-big-clock{font-size:clamp(32px,4vw,58px);line-height:1;font-weight:950;color:#fff;margin:8px 0 5px;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:-.03em}.wl-it-clock-date{color:#aab7c2}.wl-it-weather-main{display:flex;align-items:center;gap:12px;margin-top:8px}.wl-it-weather-main i{font-style:normal;font-size:34px}.wl-it-weather-main b{display:block;color:#fff;font-size:27px}.wl-it-weather-main span{display:block;color:#aab7c2;font-size:12px;margin-top:2px}.wl-it-weather-error{color:#ff9296;font-size:12px;margin-top:8px}
    @media(max-width:1250px){.wl-it-owner-hero{grid-template-columns:1fr 1fr}.wl-it-hero-greeting{grid-column:1/-1}.wl-it-big-clock{font-size:clamp(34px,5vw,52px)}}
    .wl-it-command-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}.wl-it-command-stat{background:#101b25;border:1px solid #263746;border-radius:14px;padding:16px;cursor:default}.wl-it-command-stat.action{cursor:pointer}.wl-it-command-stat b{display:block;font-size:28px;color:#fff}.wl-it-command-stat span{display:block;font-size:11px;color:#97a5b2;font-weight:850;letter-spacing:.06em;margin-top:4px}.wl-it-command-stat small{display:block;color:#708391;margin-top:5px}.wl-it-dashboard-row{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(360px,.75fr);gap:16px;margin-bottom:16px}.wl-it-dashboard-list{display:grid;gap:8px}.wl-it-dashboard-item{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #273b4b;border-radius:11px;background:#0a151e;padding:11px;color:#eaf1f5}.wl-it-dashboard-item span{color:#91a2af;font-size:12px}.wl-it-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.wl-it-quick-grid button,.wl-it-quick-grid a{box-sizing:border-box;text-decoration:none;text-align:left;border:1px solid #304555!important;border-radius:11px!important;background:#0a151e!important;color:#fff!important;padding:12px!important;min-height:62px}.wl-it-quick-grid b,.wl-it-quick-grid span{display:block}.wl-it-quick-grid span{color:#91a3b1;font-size:11px;margin-top:3px}.wl-it-quick-grid .primary{background:#a71922!important;border-color:#e22b2f!important}.wl-it-empty{display:grid;place-items:center;min-height:150px;text-align:center;color:#8294a2}.wl-it-empty b{display:block;color:#c9d5dd;font-size:16px;margin-bottom:5px}
    .wl-it-command-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(360px,.75fr);gap:16px}.wl-it-command-panel{background:#0f1a24;border:1px solid #263746;border-radius:16px;padding:16px}.wl-it-command-panel h2{margin:0 0 10px;color:#fff}.wl-it-command-panel .wl-it-more{margin-top:12px}
    .wl-it-permissions{display:grid;gap:8px}.wl-it-permission{display:flex;gap:9px;align-items:flex-start;padding:10px;border:1px solid #253745;border-radius:11px;background:#0b151e}.wl-it-permission i{font-style:normal;color:#51dd7c;font-weight:950}.wl-it-permission b{display:block;color:#edf4f8}.wl-it-permission span{display:block;color:#92a1af;font-size:12px;margin-top:2px}
    .wl-it-owner-lock{margin-top:12px;padding:11px;border:1px solid #5a3436;border-radius:11px;color:#d7a0a3;background:#190e11;font-size:12px}.wl-it-owner-lock b{color:#ff7478}
    .wl-it-ops-form{display:grid;gap:14px}.wl-it-ops-form .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.wl-it-ops-form .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.wl-it-ops-form label{display:grid;gap:6px;color:#aab6c2;font-size:12px;font-weight:800}.wl-it-ops-form input,.wl-it-ops-form select,.wl-it-ops-form textarea{width:100%;box-sizing:border-box;background:#07111a;color:#f2f6f9;border:1px solid #314453;border-radius:10px;padding:11px;font:inherit}.wl-it-ops-form textarea{resize:vertical}.wl-it-ops-banner{border:1px solid #315f45;background:#0b2117;border-radius:13px;padding:12px}.wl-it-ops-banner b{display:block;color:#67e68f}.wl-it-ops-banner span{display:block;color:#a7b6c1;margin-top:4px}.wl-it-ops-flow{border:1px solid #394b5a;background:#0b151e;border-radius:12px;padding:12px}.wl-it-ops-flow b{color:#fff}.wl-it-ops-flow span{display:block;color:#9eacb8;margin-top:4px;font-size:12px}.wl-it-ops-section{border:1px solid #263746;border-radius:14px;padding:13px;background:#0c1720}.wl-it-ops-section>h3{margin:0 0 10px;color:#fff}.wl-it-ops-equipment{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.wl-it-ops-equipment label{border:1px solid #243746;border-radius:10px;padding:9px;background:#09131c}.wl-it-ops-ticket-list{display:grid;gap:10px}.wl-it-ops-ticket{border:1px solid #263746;border-radius:13px;padding:13px;background:#0b151e}.wl-it-ops-ticket header{display:flex;justify-content:space-between;gap:10px}.wl-it-ops-ticket h3{margin:0;color:#fff}.wl-it-ops-ticket .meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.wl-it-ops-ticket .meta span{border:1px solid #304353;border-radius:999px;padding:5px 8px;color:#aab7c3;font-size:11px}.wl-it-ops-ticket .lead{margin-top:9px;color:#68e28c;font-weight:850}.wl-it-ops-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.wl-it-ops-history{display:grid;gap:8px}.wl-it-ops-history-row{border-left:3px solid #344c5d;background:#0a141d;padding:9px 11px;border-radius:7px}.wl-it-ops-history-row b{color:#fff}.wl-it-ops-history-row span,.wl-it-ops-history-row small{display:block;color:#9ba8b4;margin-top:3px}.wl-it-ops-history-row small{font-size:11px}
    @media(max-width:900px){.wl-it-dashboard-row{grid-template-columns:1fr}.wl-it-quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-it-command-shell{grid-template-columns:1fr;min-height:auto}.wl-it-command-sidebar{border-right:0;border-bottom:1px solid #253541;padding:12px}.wl-it-command-brand{display:none}.wl-it-command-nav{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.wl-it-command-nav button,.wl-it-command-nav a{text-align:center;padding:9px 7px;font-size:12px}.wl-it-command-limit{display:none}.wl-it-command-workspace{padding:16px}.wl-it-command-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-it-command-grid{grid-template-columns:1fr}.wl-it-command-head h1{font-size:30px}}
    @media(min-width:1400px){.wl-it-command-workspace{padding:32px 40px}.wl-it-command-head h1{font-size:44px}.wl-it-big-clock{font-size:58px}.wl-it-clock-card,.wl-it-weather-card{padding:20px}.wl-it-command-stat{padding:17px}.wl-it-command-stat b{font-size:30px}.wl-it-command-panel{padding:20px}}
    @media(min-width:1800px){.wl-it-command-shell{grid-template-columns:285px minmax(0,1fr)}.wl-it-command-workspace{padding:36px 48px}.wl-it-owner-hero{grid-template-columns:minmax(480px,.85fr) minmax(520px,1.15fr)}.wl-it-command-grid{grid-template-columns:minmax(0,1.35fr) minmax(420px,.65fr)}}
    @media(max-width:520px){.wl-it-quick-grid{grid-template-columns:1fr}.wl-it-command-nav{grid-template-columns:repeat(2,minmax(0,1fr))}.wl-it-command-head{display:block}.wl-it-ops-form .grid2,.wl-it-ops-form .grid3,.wl-it-ops-equipment{grid-template-columns:1fr}}
    .wl-it-cal-head{display:flex;align-items:center;justify-content:center;gap:14px;margin:12px 0}.wl-it-cal-head h2{margin:0;min-width:210px;text-align:center}.wl-it-cal-head button{background:#101b25;color:#fff;border:1px solid #314453;border-radius:9px;padding:8px 14px}.wl-it-cal-week,.wl-it-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.wl-it-cal-week b{text-align:center;color:#8fa0ae;font-size:11px;padding:5px}.wl-it-cal-day{min-height:105px;border:1px solid #263746;border-radius:10px;background:#0b151e;padding:7px;min-width:0}.wl-it-cal-day.empty{opacity:.25}.wl-it-cal-day>b{display:block;color:#fff;margin-bottom:6px}.wl-it-cal-day button{display:block;width:100%;text-align:left;background:#132330;color:#fff;border:1px solid #304657;border-radius:7px;padding:6px;margin:4px 0;overflow:hidden}.wl-it-cal-day button strong,.wl-it-cal-day button span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wl-it-cal-day button span{font-size:10px;color:#a8b6c2}.wl-it-attn{margin-top:12px;border:1px solid #263746;border-radius:13px;background:#0c1720;padding:12px}.wl-it-attn h3{margin:0 0 8px;color:#fff}.wl-it-attn h3 span{color:#ff6b70}.wl-it-attn-row{display:block;width:100%;text-align:left;background:#0a141d;color:#fff;border:1px solid #2b3d4b;border-radius:9px;padding:10px;margin:6px 0}.wl-it-attn-row b,.wl-it-attn-row span{display:block}.wl-it-attn-row span{color:#9eacb8;font-size:12px;margin-top:3px}
    @media(max-width:700px){.wl-it-cal-week{display:none}.wl-it-calendar{grid-template-columns:1fr}.wl-it-cal-day.empty{display:none}.wl-it-cal-day{min-height:0}.wl-it-cal-day:not(:has(button)){display:none}.wl-it-cal-day>b{font-size:13px}}
    .wl-it-ticket-next{margin-top:10px;border:1px solid #31506a;border-left:4px solid #e22b2f;border-radius:10px;background:#0a1620;padding:10px}.wl-it-ticket-next b,.wl-it-ticket-next span{display:block}.wl-it-ticket-next span{color:#a9b6c1;font-size:12px;margin-top:3px}.wl-it-ticket-next.done{border-left-color:#36d57b}.wl-it-ticket-next.active{border-left-color:#f0b43c}.wl-it-ticket-command{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.wl-it-ticket-command>div{border:1px solid #2c4050;border-radius:11px;background:#0b151e;padding:11px}.wl-it-ticket-command .wide{grid-column:1/-1;border-left:4px solid #e22b2f}.wl-it-ticket-command small,.wl-it-ticket-command b,.wl-it-ticket-command span{display:block}.wl-it-ticket-command small{color:#8495a4;font-weight:900;letter-spacing:.08em}.wl-it-ticket-command b{color:#fff;margin-top:3px}.wl-it-ticket-command span{color:#a7b4bf;font-size:12px;margin-top:4px}
    .wl-it-audit{display:grid;gap:8px;margin-top:10px}.wl-it-audit-row{border:1px solid #263746;border-radius:10px;background:#0b151e;padding:10px}.wl-it-audit-row b{color:#fff}.wl-it-audit-row span{display:block;color:#a8b3bd;font-size:12px;margin-top:3px}.wl-it-audit-row em{font-style:normal;color:#6f8190;font-size:11px}
  `;
  document.head.append(s);
}

async function showITHome() {
  if (!isIT() || !viewIT()) return;
  ensureITCommandDashboardStyles();
  let home=document.getElementById('wlItHome');
  if(!home){
    home=document.createElement('div');
    home.id='wlItHome';
    home.className='card wl-home wl-it-simple-home';
    viewIT().prepend(home);
  }
  home.innerHTML=techDashboardLoadingHtml('Checking your IT command dashboard…');
  hideChildren(viewIT(),[home]);
  resetWizardPosition();

  const ownerViewingIT=roleText().includes('Owner/Admin');
  const techName=document.getElementById('whoName')?.textContent?.trim() || (ownerViewingIT?'IT Technician':'Technician');
  const firstName=String(techName||'Technician').trim().split(/\s+/)[0] || 'Technician';

  try{
    const [state,managedTickets]=await Promise.all([techDashboardTimeout(itDayState(),null),techDashboardTimeout(loadITManagedTickets(),[])]);
    const flash=takeTechCompletion('it');
    const assigned=(state.currentAssignments||[]).length;
    const returns=(state.waitingReturns||[]).length;
    const restock=(state.truckRestockQueue||[]).length;
    const managedActive=(managedTickets||[]).filter(t=>!t.all_finished).length;
    const serviceQueue=(state.serviceQueue||[]).length;
    const todayKey=techCheckDateKey(new Date());
    const todaysManaged=(managedTickets||[]).filter(t=>String(t.scheduled_for||'')===todayKey&&!t.all_finished);
    const overdueManaged=(managedTickets||[]).filter(t=>t.scheduled_for&&String(t.scheduled_for)<todayKey&&!t.all_finished);
    const prepCount=(state.drafts||[]).length;
    const siteRegistration=(state.currentAssignments||[]).filter(a=>/swap/i.test(String(a.work_type||''))&&/register|site/i.test(String(a.status||'')+' '+String(a.next_step||'')));
    const inService=(managedTickets||[]).filter(t=>t.any_started&&!t.all_finished).length;
    const attentionCount=overdueManaged.length+returns+restock+prepCount+siteRegistration.length;
    const recentManaged=(managedTickets||[]).slice().sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0)).slice(0,5);
    home.innerHTML=`<div class='wl-it-command-shell'>
      <aside class='wl-it-command-sidebar'>
        <div class='wl-it-command-brand'><img src='./techcheck-eye-favicon-32.png?v=1' alt=''><span><b>CAMERAS ONSITE</b><small>IT Technician</small></span></div>
        <nav class='wl-it-command-nav'>
          <button class='active' data-wl-home='it'>Dashboard</button>
          <button data-wl-it-create-job>＋ Create Job</button>
          <button data-wl-it-managed-jobs>Managed Tickets</button>
          <button data-wl-it-calendar>Calendar</button>
          <button data-wl-it-attention>Needs Attention</button>
          <a href='./camera-health.html?v=it-ops-20260923a'>Camera Health</a>
          <button data-wl-it-truck-inventory>Truck Inventory</button>
          <button data-wl-it-truck-restock>Truck Restock</button>
          <button data-wl-mode='intake'>IT Intake</button>
          <button data-wl-it='pending'>Equipment Prep</button>
          <button data-wl-it-units>Units</button>
          <button data-wl-it='history'>Handoffs / History</button>
          <button data-wl-it-open-job>Open MHelpDesk Job</button>
        </nav>
        <div class='wl-it-command-limit'><b>IT OPERATIONS ACCESS</b>Create and lead Service Calls, Deliveries, Swaps, and Pickups from existing MHelpDesk tickets; run equipment prep, Camera Health, truck inventory, intake, handoffs, and operational history. Owner Review, employee accounts, permissions, system configuration, and administrative overrides stay Owner-only.</div>
      </aside>
      <main class='wl-it-command-workspace'>
        <header class='wl-it-command-head'><div><small>IT OPERATIONS COMMAND CENTER</small><h1>${esc(ownerViewingIT?'IT':techName)}</h1><p>Ticket Lead · Technical Operations</p></div><div style='display:flex;gap:8px;flex-wrap:wrap'><button class='mini wl-red' data-wl-it-create-job>＋ Create Job</button><button class='mini' data-wl-home='it'>Refresh</button></div></header>
        <div class='wl-it-owner-hero'>
          <section class='wl-it-hero-greeting'><small>CAMERAS ONSITE · IT OPERATIONS</small><h2>Good morning, ${esc(ownerViewingIT?'IT':firstName)}!</h2><p>Here’s what is happening today.</p></section>
          <section class='wl-it-clock-card'><small>LOCAL TIME</small><div id='wlITBigClock' class='wl-it-big-clock'>--:--:--</div><div id='wlITClockDate' class='wl-it-clock-date'></div></section>
          <section class='wl-it-weather-card'><small>LOCAL WEATHER</small><div id='wlITWeatherNow'><span>Reading current weather…</span></div></section>
        </div>
        ${techCompletionBanner(flash)}
        <div class='wl-it-command-stats'>
          <div class='wl-it-command-stat action' data-wl-it-managed-jobs><b>${managedActive}</b><span>MY ACTIVE TICKETS</span><small>View Tickets →</small></div>
          <div class='wl-it-command-stat action' data-wl-it-attention><b>${attentionCount}</b><span>NEEDS ATTENTION</span><small>View Details →</small></div>
          <div class='wl-it-command-stat action' data-wl-it-managed-jobs><b>${inService}</b><span>IN SERVICE · FIELD</span><small>View Field Jobs →</small></div>
          <div class='wl-it-command-stat action' data-wl-mode='intake'><b>${returns}</b><span>AWAITING IT INTAKE</span><small>View Intake →</small></div>
          <div class='wl-it-command-stat action' data-wl-it='pending'><b>${prepCount}</b><span>IN EQUIPMENT PREP</span><small>View Prep →</small></div>
        </div>
        <div class='wl-it-dashboard-row'>
          <section class='wl-it-command-panel'><h2>Today's Schedule · My Tickets</h2>
            ${todaysManaged.length?"<div class='wl-it-dashboard-list'>"+todaysManaged.slice(0,6).map(t=>"<button class='wl-it-dashboard-item' data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'><b>#"+esc(t.ticket_no)+" · "+esc(t.site||t.work_type||'Job')+"</b><span>"+esc(itManagedTicketStatus(t))+" →</span></button>").join('')+"</div>":"<div class='wl-it-empty'><div><b>No tickets scheduled for today.</b><span>You're all caught up.</span></div></div>"}
          </section>
          <section class='wl-it-command-panel'><h2>Needs Attention</h2>
            <div class='wl-it-dashboard-list'>
              <button class='wl-it-dashboard-item' data-wl-it-attention><b>Overdue Managed Tickets</b><span>${overdueManaged.length} →</span></button>
              <button class='wl-it-dashboard-item' data-wl-mode='intake'><b>Returned Units · IT Intake</b><span>${returns} →</span></button>
              <button class='wl-it-dashboard-item' data-wl-it='pending'><b>Pending Swap Registration</b><span>${siteRegistration.length} →</span></button>
              <button class='wl-it-dashboard-item' data-wl-it='pending'><b>Unfinished Equipment Prep</b><span>${prepCount} →</span></button>
              <button class='wl-it-dashboard-item' data-wl-it-truck-restock><b>Service Truck Restock Requests</b><span>${restock} →</span></button>
            </div>
          </section>
        </div>
        <div class='wl-it-dashboard-row'>
          <section class='wl-it-command-panel'><h2>Recent Activity · My Tickets</h2>
            ${recentManaged.length?"<div class='wl-it-dashboard-list'>"+recentManaged.map(t=>"<button class='wl-it-dashboard-item' data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'><b>#"+esc(t.ticket_no)+" · "+esc(t.site||t.work_type||'Job')+"</b><span>"+esc(itManagedTicketStatus(t))+" · "+esc(t.updated_at?new Date(t.updated_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'')+" →</span></button>").join('')+"</div>":"<div class='wl-it-empty'><div><b>No managed-ticket activity yet.</b><span>New ticket activity will appear here.</span></div></div>"}
          </section>
          <section class='wl-it-command-panel'><h2>Quick Actions</h2><div class='wl-it-quick-grid'>
            <button class='primary' data-wl-it-create-job><b>＋ Create Job</b><span>From MHelpDesk ticket</span></button>
            <button data-wl-it-managed-jobs><b>Managed Tickets</b><span>View & update</span></button>
            <button data-wl-it-calendar><b>Calendar</b><span>My schedule</span></button>
            <button data-wl-it-attention><b>Needs Attention</b><span>Operational follow-up</span></button>
            <a href='./camera-health.html?v=it-ops-20260923a'><b>Camera Health</b><span>Camera status</span></a>
            <button data-wl-it-truck-inventory><b>Truck Inventory</b><span>Units, SIMs & batteries</span></button>
            <button data-wl-it='pending'><b>Equipment Prep</b><span>Prepare units</span></button>
            <button data-wl-mode='intake'><b>IT Intake</b><span>Process returns</span></button>
            <button data-wl-it-open-job><b>Open MHelpDesk Job</b><span>Existing job</span></button>
          </div></section>
        </div>
        <div class='wl-it-command-grid'>
          <section class='wl-it-command-panel'>
            <h2>Next IT Action</h2>
            ${itNextActionHtml(state)}
            ${itServiceQueueHtml(state)}
            <div class='wl-it-flowline'>IT INTAKE <b>→</b> SITE REGISTRATION <b>→</b> ACTIVE PREP <b>→</b> SERVICE HANDOFF</div>
          </section>
          <section class='wl-it-command-panel'>
            <h2>IT Controls</h2>
            <div class='wl-it-permissions'>
              <div class='wl-it-permission'><i>✓</i><div><b>Create + Lead Jobs</b><span>Create Service Calls, Deliveries, Swaps, and Pickups from existing MHelpDesk tickets. The IT tech who creates it automatically becomes Ticket Lead.</span></div></div>
              <div class='wl-it-permission'><i>✓</i><div><b>Camera Health</b><span>Open the same Camera Health workspace as Owner.</span></div></div>
              <div class='wl-it-permission'><i>✓</i><div><b>Service Truck Inventory</b><span>IT controls official unit tags, SIM numbers, and battery counts. Every change is logged.</span></div></div>
              <div class='wl-it-permission'><i>✓</i><div><b>Equipment Checks</b><span>Required readiness checks still apply before equipment is released.</span></div></div>
              <div class='wl-it-permission'><i>✓</i><div><b>Intake + Handoffs</b><span>Receive returned equipment and hand verified equipment to Service.</span></div></div>
            </div>
            <div class='wl-it-owner-lock'><b>OWNER-ONLY:</b> Owner Review/administrative closeout, employee accounts, role/access changes, system settings, credential/integration settings, history deletion, and Owner overrides. IT controls normal technical operations without an Owner approval gate.</div>
            <details class='wl-it-more'>
              <summary>MORE IT ACTIONS</summary>
              <div class='wl-it-more-grid'>
                <button data-wl-it-create-job>＋ CREATE SERVICE / DELIVERY / SWAP / PICKUP</button>
                <button data-wl-it-managed-jobs>MY MANAGED TICKETS${managedActive?` · ${managedActive}`:''}</button>
                <button data-wl-it-open-job>OPEN EXISTING MHELPDESK JOB</button>
                <button data-wl-it-truck-inventory>SERVICE TRUCK INVENTORY</button>
                <button data-wl-it-truck-restock>SERVICE TRUCK RESTOCK${restock?` · ${restock}`:''}</button>
                <button data-wl-mode='intake'>IT INTAKE / RETURNS${returns?` · ${returns}`:''}</button>
                <button data-wl-it='pending'>RESUME EQUIPMENT PREP${(state.drafts||[]).length?` · ${state.drafts.length}`:''}</button>
                <button data-wl-it-units>UNITS / CURRENT HOLDER</button>
                <button data-wl-it='history'>HANDOFFS & HISTORY</button>
                ${ownerViewingIT?"<button data-wl-it='new'>OWNER: START NEW PREP</button>":""}
              </div>
            </details>
          </section>
        </div>
      </main>
    </div>`;
  }catch(error){
    home.innerHTML=techDashboardErrorHtml('it',error?.message||'Could not verify your IT work.');
  }

  hideChildren(viewIT(),[home]);
  resetWizardPosition();
  startITCommandClockWeather();
}
function startITCommandClockWeather(){
  const clock=document.getElementById('wlITBigClock'),date=document.getElementById('wlITClockDate');
  if(clock&&date){
    const tick=()=>{const now=new Date();clock.textContent=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});date.textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});};
    tick(); clearInterval(window.wlITCommandClockTimer); window.wlITCommandClockTimer=setInterval(tick,1000);
  }
  updateITCommandWeather();
}
async function updateITCommandWeather(){
  const host=document.getElementById('wlITWeatherNow'); if(!host)return;
  try{
    const coords=await window.techCheckGpsPosition(false);
    const data=await window.techCheckWeatherForGps(coords,1),cur=data?.current||{};
    const code=Number(cur.weather_code),day=Number(cur.is_day)!==0;
    const map=code===0?[day?'☀️':'🌙','Clear']:code<=3?['🌤️','Partly cloudy']:code<=48?['🌫️','Fog']:code<=67?['🌧️','Rain']:code<=77?['❄️','Snow']:code<=82?['🌦️','Showers']:code<=99?['⛈️','Storms']:['🌤️','Weather'];
    host.innerHTML="<div class='wl-it-weather-main'><i>"+map[0]+"</i><div><b>"+Math.round(Number(cur.temperature_2m||0))+"°F · "+esc(map[1])+"</b><span>Feels "+Math.round(Number(cur.apparent_temperature||0))+"° · Wind "+Math.round(Number(cur.wind_speed_10m||0))+" mph</span></div></div>";
  }catch(error){host.innerHTML="<div class='wl-it-weather-error'>"+esc(error?.message||'Local weather unavailable')+"</div>";}
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
function requiredItEquipmentType(index=itUnitIndex) {
  return equipmentManifestExpanded(activeItPrep?.equipment_manifest || [])[index] || '';
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

let wlITManagedTicketsCache=[];
let wlITOpsProfilesCache=[];

async function loadITManagedTickets(){
  const result=await liveDb.rpc('my_managed_tickets_v1');
  if(result.error)throw result.error;
  wlITManagedTicketsCache=Array.isArray(result.data)?result.data:[];
  return wlITManagedTicketsCache;
}
function itOpsCard(){
  return document.getElementById('wlItHome');
}
function itOpsDateLabel(key){
  if(!key)return 'No date';
  const d=new Date(String(key)+'T12:00:00');
  return Number.isNaN(d.getTime())?String(key):d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
}
function itOpsMonthLabel(date){
  return date.toLocaleDateString(undefined,{month:'long',year:'numeric'});
}
let wlITCalendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let wlITCalendarFilter='ALL';
async function showITCalendar(shift){
  if(!isIT()||!viewIT())return;
  ensureITCommandDashboardStyles();
  if(shift==='today')wlITCalendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  else if(Number.isFinite(Number(shift))&&Number(shift)!==0)wlITCalendarMonth=new Date(wlITCalendarMonth.getFullYear(),wlITCalendarMonth.getMonth()+Number(shift),1);
  const card=itOpsCard(); if(!card)return;
  card.innerHTML=techDashboardLoadingHtml('Loading your Ticket Lead calendar…');
  hideChildren(viewIT(),[card]); resetWizardPosition();
  try{
    const rows=await loadITManagedTickets();
    const y=wlITCalendarMonth.getFullYear(),m=wlITCalendarMonth.getMonth();
    const typeOf=t=>String(t.work_type||t.job_type||'').trim().toUpperCase();
    const filteredRows=wlITCalendarFilter==='ALL'?rows:rows.filter(t=>typeOf(t).includes(wlITCalendarFilter));
    const monthRows=filteredRows.filter(t=>{const d=String(t.scheduled_for||'').split('-').map(Number);return d.length===3&&d[0]===y&&d[1]===m+1;});
    const unscheduled=filteredRows.filter(t=>!t.scheduled_for&&!t.all_finished);
    const first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),lead=first.getDay(),prevDays=new Date(y,m,0).getDate();
    const today=techCheckDateKey(new Date());
    const timeOf=t=>{const raw=String(t.scheduled_time||t.work_time||t.time||'').trim();if(!raw)return '';const mm=raw.match(/^(\d{1,2}):(\d{2})/);if(!mm)return raw;let hr=Number(mm[1]),min=mm[2],ap=hr>=12?'PM':'AM';hr=hr%12||12;return hr+':'+min+' '+ap;};
    const typeClass=t=>{const x=typeOf(t);return x.includes('DELIVERY')?'delivery':x.includes('SWAP')?'swap':x.includes('PICKUP')?'pickup':'service';};
    const ticketHtml=t=>"<button class='wl-it-cal-event "+typeClass(t)+"' data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'><span class='wl-it-cal-dot'></span><span><strong>"+esc((timeOf(t)?timeOf(t)+' · ':'')+(t.work_type||'Job'))+"</strong><small>#"+esc(t.ticket_no)+(t.site?' · '+esc(t.site):'')+"</small></span></button>";
    let cells='';
    for(let i=0;i<lead;i++){const d=prevDays-lead+i+1;cells+="<div class='wl-it-cal-day outside'><b>"+d+"</b></div>";}
    for(let day=1;day<=days;day++){
      const key=y+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      const jobs=monthRows.filter(t=>String(t.scheduled_for||'')===key);
      cells+="<div class='wl-it-cal-day"+(key===today?" is-today":"")+"'><div class='wl-it-cal-date'><b>"+day+"</b>"+(key===today?"<span>TODAY</span>":"")+"</div>"+jobs.map(ticketHtml).join('')+"</div>";
    }
    const used=lead+days,tail=(7-(used%7))%7; for(let i=1;i<=tail;i++)cells+="<div class='wl-it-cal-day outside'><b>"+i+"</b></div>";
    const counts={SERVICE:0,DELIVERY:0,SWAP:0,PICKUP:0}; monthRows.forEach(t=>{const x=typeOf(t);if(x.includes('DELIVERY'))counts.DELIVERY++;else if(x.includes('SWAP'))counts.SWAP++;else if(x.includes('PICKUP'))counts.PICKUP++;else counts.SERVICE++;});
    const filterButton=(value,label)=>"<button class='"+(wlITCalendarFilter===value?"active":"")+"' data-wl-it-calendar-filter='"+esc(value)+"'>"+esc(label)+"</button>";
    const summary="<aside class='wl-it-cal-side'><section><h3>Month Summary</h3><div class='wl-it-cal-count service'><span>● Service</span><b>"+counts.SERVICE+"</b></div><div class='wl-it-cal-count delivery'><span>● Delivery</span><b>"+counts.DELIVERY+"</b></div><div class='wl-it-cal-count swap'><span>● Swap</span><b>"+counts.SWAP+"</b></div><div class='wl-it-cal-count pickup'><span>● Pickup</span><b>"+counts.PICKUP+"</b></div><div class='wl-it-cal-total'><span>Total Scheduled</span><b>"+monthRows.length+"</b></div></section><section><h3>Unscheduled Managed Tickets <em>"+unscheduled.length+"</em></h3><p>Assigned to you but not dated yet.</p>"+(unscheduled.length?unscheduled.slice(0,8).map(t=>"<button data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'><b>#"+esc(t.ticket_no)+"</b><span>"+esc(t.site||t.work_type||'Managed ticket')+"</span><i class='"+typeClass(t)+"'>"+esc(t.work_type||'Job')+"</i></button>").join(''):"<div class='wl-it-cal-none'>No unscheduled tickets.</div>")+"<button class='wl-it-cal-view-all' data-wl-it-managed-jobs>View All Managed Tickets →</button></section></aside>";
    card.innerHTML="<div class='wl-it-cal-page'><button class='wl-back' data-wl-home='it'>← IT DASHBOARD</button><header class='wl-it-cal-title'><div><small>CALENDAR</small><h1>Only tickets where you are Ticket Lead</h1><p>View and manage your scheduled IT work. This calendar uses your live Tech Check tickets.</p></div><button class='wl-it-cal-create' data-wl-it-create-job>＋ Create Job</button></header><div class='wl-it-cal-layout'><main class='wl-it-cal-main'><div class='wl-it-calendar-toolbar'><div class='wl-it-cal-nav'><button data-wl-it-calendar-shift='-1'>← Previous</button><strong>"+esc(itOpsMonthLabel(wlITCalendarMonth))+"</strong><button data-wl-it-calendar-today='1'>Today</button><button data-wl-it-calendar-shift='1'>Next →</button></div><div class='wl-it-cal-filters'>"+filterButton('ALL','All')+filterButton('SERVICE','Service')+filterButton('DELIVERY','Delivery')+filterButton('SWAP','Swap')+filterButton('PICKUP','Pickup')+"</div></div><div class='wl-it-cal-week'><b>Sun</b><b>Mon</b><b>Tue</b><b>Wed</b><b>Thu</b><b>Fri</b><b>Sat</b></div><div class='wl-it-calendar'>"+cells+"</div><div class='wl-it-cal-legend'><span class='service'>● Service</span><span class='delivery'>● Delivery</span><span class='swap'>● Swap</span><span class='pickup'>● Pickup</span></div></main>"+summary+"</div></div>";
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error?.message||'Could not load your IT calendar.');}
}
async function showITNeedsAttention(){
  if(!isIT()||!viewIT())return;
  ensureITCommandDashboardStyles();
  const card=itOpsCard(); if(!card)return;
  card.innerHTML=techDashboardLoadingHtml('Checking IT Needs Attention…');
  hideChildren(viewIT(),[card]); resetWizardPosition();
  try{
    const [state,rows]=await Promise.all([techDashboardTimeout(itDayState(),null),loadITManagedTickets()]);
    const today=techCheckDateKey(new Date());
    const overdue=rows.filter(t=>!t.all_finished&&t.scheduled_for&&String(t.scheduled_for)<today);
    const returns=state?.waitingReturns||[], restock=state?.truckRestockQueue||[], drafts=state?.drafts||[];
    const site=(state?.currentAssignments||[]).filter(a=>/swap/i.test(String(a.work_type||''))&&/register|site/i.test(String(a.status||'')+' '+String(a.next_step||'')));
    const count=overdue.length+returns.length+restock.length+drafts.length+site.length;
    const section=(title,items,body)=>items.length?"<section class='wl-it-attn'><h3>"+esc(title)+" <span>"+items.length+"</span></h3>"+items.map(body).join('')+"</section>":'';
    card.innerHTML="<button class='wl-back' data-wl-home='it'>← IT DASHBOARD</button>"+progress('NEEDS ATTENTION',count?count+' operational item'+(count===1?'':'s')+' need action':'Nothing urgent is waiting',1,1)+
      (count?'':"<div class='ok'><b>✓ No IT operational exceptions right now.</b></div>")+
      section('Overdue Managed Tickets',overdue,t=>"<button class='wl-it-attn-row' data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'><b>MHelpDesk #"+esc(t.ticket_no)+"</b><span>"+esc(t.site||'No site')+" · "+esc(itOpsDateLabel(t.scheduled_for))+"</span></button>")+
      section('Returned Units Waiting for IT Intake',returns,r=>"<button class='wl-it-attn-row' data-wl-mode='intake'><b>"+esc(r.unit_tag||r.equipment_type||'Returned unit')+"</b><span>IT Intake required</span></button>")+
      section('Swap / Site Registration',site,a=>"<button class='wl-it-attn-row' data-wl-it='pending'><b>MHelpDesk #"+esc(a.ticket_no||'—')+"</b><span>"+esc(a.site||'Site registration work pending')+"</span></button>")+
      section('Unfinished IT Prep',drafts,d=>"<button class='wl-it-attn-row' data-wl-it='pending'><b>MHelpDesk #"+esc(d.ticket_no||'—')+"</b><span>"+esc(d.site||'Equipment prep unfinished')+"</span></button>")+
      section('Service Truck Restock Requests',restock,r=>"<button class='wl-it-attn-row' data-wl-it-truck-restock><b>"+esc(r.tech_name||r.service_tech_name||'Service truck')+"</b><span>"+esc(r.status||'Restock requested')+"</span></button>")+
      "<div class='wl-it-ops-actions top10'><a class='wl-big wl-gray' href='./camera-health.html?v=it-ops-20260923a'>OPEN CAMERA HEALTH →</a></div>";
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error?.message||'Could not load IT Needs Attention.');}
}
async function loadITOpsProfiles(){
  const result=await liveDb.rpc('it_ops_assignment_profiles_v1');
  if(result.error)throw result.error;
  wlITOpsProfilesCache=Array.isArray(result.data)?result.data:[];
  const requiredIT=[
    {user_id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',full_name:'Teddy Hopper',username:'thopper',role:'it',active:true,archived_at:null},
    {user_id:'b7cc3cbf-d11e-4d4a-9742-c07701857911',full_name:'Victor Garcia',username:'vgarcia',role:'it',active:true,archived_at:null}
  ];
  requiredIT.forEach(function(p){if(!wlITOpsProfilesCache.some(function(x){return String(x.user_id)===String(p.user_id);})){wlITOpsProfilesCache.push(p);}});
  return wlITOpsProfilesCache;
}
function canITAccountManageOwnership(){
  return currentRoleKey()==='it' && String((document.getElementById('whoName')||{}).textContent||'').trim().toLowerCase()==='james martin';
}
function itOpsServiceOptions(selected){
  selected=selected||'';
  const service=wlITOpsProfilesCache.filter(function(p){return p.role==='service';});
  return "<option value=''>Service Department Queue — any Service Tech can claim</option>"+
    service.map(function(p){
      const sel=String(selected)===String(p.user_id)?" selected":"";
      return "<option value='"+esc(p.user_id)+"'"+sel+">"+esc(p.full_name||p.username||'Service Technician')+"</option>";
    }).join('');
}
function itOpsLeadOptions(selected){
  selected=selected||'';
  const current=(document.getElementById('whoName')||{}).textContent||'Me';
  const it=wlITOpsProfilesCache.filter(function(p){return p.role==='it';});
  return "<option value=''>Me — "+esc(current)+"</option>"+
    it.map(function(p){
      const sel=String(selected)===String(p.user_id)?" selected":"";
      return "<option value='"+esc(p.user_id)+"'"+sel+">"+esc(p.full_name||p.username||'IT Technician')+"</option>";
    }).join('');
}
function monitoredCameraSummary(raw){
  const rows=normalizedEquipmentManifest(raw||[]);
  let systems=0,cameras=0,known=false,detail=[];
  rows.filter(function(r){return r.category==='device';}).forEach(function(r){
    const label=String(r.label||'');
    let per=null;
    const m=label.match(/(?:^|\D)([24])\s*[- ]?camera/i);
    if(m)per=Number(m[1]);
    else if(/sniper\s*4/i.test(label))per=4;
    else if(/sniper\s*2/i.test(label))per=2;
    if(per){known=true;systems+=Number(r.qty||0);cameras+=Number(r.qty||0)*per;detail.push(r.qty+" × "+per+"-Camera Monitored "+equipmentDisplayLabel(label).replace(/\s*[24]\s*[- ]?camera.*$/i,''));}
  });
  return known?{systems:systems,cameras:cameras,text:detail.join(' · ')}:null;
}
function itOpsMonitoredCameraHtml(raw){
  const s=monitoredCameraSummary(raw);
  if(!s)return "<div id='wlITOpsCameraSummary' class='small top8'><b>Monitored camera configuration:</b> Select/enter a 2-camera or 4-camera monitored system when the MHelpDesk item specifies it.</div>";
  return "<div id='wlITOpsCameraSummary' class='wl-it-ops-flow top8'><b>MONITORED CAMERA CONFIGURATION</b><span>"+esc(s.text)+" · Total monitored cameras: "+s.cameras+"</span></div>";
}
function itOpsEquipmentGrid(data){
  const rows=normalizedEquipmentManifest(data||[]);
  function render(category,types){
    return types.map(function(label){
      const found=rows.find(function(r){return r.category===category&&r.label===label;});
      const qty=found?found.qty:0;
      return "<label><span>"+esc(equipmentDisplayLabel(label))+"</span><input type='number' inputmode='numeric' min='0' step='1' value='"+qty+"' data-it-ops-equipment data-category='"+category+"' data-label='"+esc(label)+"'></label>";
    }).join('');
  }
  return "<div class='wl-it-ops-section'><h3>Units / Devices</h3><div class='small'>Enter the quantity involved in the MHelpDesk ticket. Keep unit quantity separate from monitored camera count.</div><div class='wl-it-ops-equipment top8'>"+render('device',OWNER_DEVICE_TYPES)+"</div>"+itOpsMonitoredCameraHtml(rows)+"</div>"+
    "<div class='wl-it-ops-section'><h3>Stands / Poles</h3><div class='wl-it-ops-equipment'>"+render('stand',OWNER_STAND_TYPES)+"</div></div>";
}
function readITOpsEquipmentManifest(){
  return Array.from(document.querySelectorAll('#wlITOpsJobForm [data-it-ops-equipment]')).map(function(input){
    return {category:input.dataset.category||'other',label:input.dataset.label||'',qty:cleanPartQty(input.value)};
  }).filter(function(r){return r.label&&r.qty>0;});
}
function itOpsParts(){return readTicketPartInputs('itOpsPart');}
function itOpsFlowState(){
  const type=(document.getElementById('wlITOpsWorkType')||{}).value||'service';
  const manifest=readITOpsEquipmentManifest();
  const parts=itOpsParts();
  const hasPrep=manifest.length>0||ticketPartsTotal(parts)>0;
  if(type==='pickup')return {code:'service_it',label:'SERVICE → IT INTAKE',reason:'Service performs the pickup first. You remain Ticket Lead and IT Intake unlocks after the equipment returns.'};
  if(type==='swap')return {code:'it_service_it',label:'IT → SERVICE → IT INTAKE',reason:'You prepare the replacement, Service performs the swap, and the old unit returns through IT Intake.'};
  if(type==='delivery')return {code:'it_service',label:'IT → SERVICE',reason:'You prepare and verify the equipment before Service can accept the handoff and deliver/install it.'};
  if(hasPrep)return {code:'it_service',label:'IT → SERVICE',reason:'This Service Call needs shop equipment or replacement parts, so you prepare them before Service begins.'};
  return {code:'service',label:'SERVICE',reason:'No shop prep is required. Service can start the field call directly while you remain responsible for the ticket.'};
}
function itOpsRefreshFlow(){
  const box=document.getElementById('wlITOpsFlow');
  if(!box)return;
  const f=itOpsFlowState();
  box.innerHTML="<b>"+esc(f.label)+"</b><span>"+esc(f.reason)+"</span>";
}
function itOpsUnitSummaryParts(summary){
  const s=String(summary||'');
  const unit=(s.match(/Unit #s:\s*([^|]+)/i)||[])[1]||'';
  const stand=(s.match(/Stand \/ Solar Stand #s:\s*([^|]+)/i)||[])[1]||'';
  return {unit:unit.trim(),stand:stand.trim()};
}
function itOpsJobFormHtml(data,mode){
  const d=data||{};
  mode=mode||'create';
  const edit=mode==='edit';
  const parts={solar_panel_qty:d.solar_panel_qty||0,battery_replacement_qty:d.battery_replacement_qty||0,camera_replacement_qty:d.camera_replacement_qty||0,sim_replacement_qty:d.sim_replacement_qty||0,micro_sd_qty:d.micro_sd_qty||0};
  const date=d.scheduled_for||techCheckDateKey(new Date());
  const time=d.scheduled_time?String(d.scheduled_time).slice(0,5):'';
  const nums=itOpsUnitSummaryParts(d.unit_summary||'');
  const itName=(document.getElementById('whoName')||{}).textContent||'IT Technician';
  let html="<div id='wlITOpsJobForm' class='wl-it-ops-form' data-mode='"+mode+"'>";
  html+="<div class='wl-it-ops-banner'><b>"+(edit?'CURRENT TICKET LEAD':'ASSIGN TICKET LEAD')+"</b><span>"+esc(edit?(d.job_lead_name||itName)+" is currently responsible. You can transfer the ticket to another IT Technician below.":"Creating the ticket does not lock responsibility to you. Choose who should take over, or leave Me selected.")+"</span></div>";
  if(!edit&&canITAccountManageOwnership())html+="<label>Assigned To / Ticket Lead<select id='wlITOpsLead'>"+itOpsLeadOptions('')+"</select><small>Owner control · choose Teddy Hopper or Victor Garcia to take over this ticket, or leave Me selected.</small></label>";
  html+="<div class='grid3'><label>MHelpDesk Ticket #<input id='wlITOpsTicket' value='"+esc(d.ticket_no||'')+"' "+(edit?'readonly':'')+" placeholder='Existing MHelpDesk number'></label>";
  html+="<label>Job Type<select id='wlITOpsWorkType'><option value='service' "+((d.work_type==='service'||!d.work_type)?'selected':'')+">Service Call</option><option value='delivery' "+(d.work_type==='delivery'?'selected':'')+">Delivery</option><option value='swap' "+(d.work_type==='swap'?'selected':'')+">Swap</option><option value='pickup' "+(d.work_type==='pickup'?'selected':'')+">Pickup</option></select></label>";
  html+="<label>Service Technician<select id='wlITOpsServiceTech'>"+itOpsServiceOptions(d.service_assignee_user_id||'')+"</select></label></div>";
  html+="<div class='grid3'><label>Customer / Site<input id='wlITOpsSite' value='"+esc(d.site||'')+"' placeholder='Customer / site'></label><label>Work Date<input id='wlITOpsDate' type='date' value='"+esc(date)+"'></label><label>Time<input id='wlITOpsTime' type='time' value='"+esc(time)+"'></label></div>";
  html+="<div id='wlITOpsFlow' class='wl-it-ops-flow'><b>Calculating workflow…</b></div>";
  html+="<label>Job Description<textarea id='wlITOpsDescription' rows='3' placeholder='What needs to be done?'>"+esc(d.job_description||'')+"</textarea></label>";
  html+=itOpsEquipmentGrid(d.equipment_manifest||[]);
  html+="<div class='wl-it-ops-section'><h3>Replacement Parts / Shop Prep</h3>"+ticketPartsInputsHtml('itOpsPart',parts)+"</div>";
  html+="<div class='grid2'><label>Unit #s / Tags from MHelpDesk<input id='wlITOpsUnitNumbers' value='"+esc(nums.unit)+"' placeholder='Example: 198, 205'></label><label>Stand / Pole #s<input id='wlITOpsStandNumbers' value='"+esc(nums.stand)+"' placeholder='If applicable'></label></div>";
  html+="<label>Operational Notes<textarea id='wlITOpsNotes' rows='3' placeholder='Anything the technicians need to know'>"+esc(d.notes||'')+"</textarea></label>";
  if(edit)html+="<label>Change Note<input id='wlITOpsChangeNote' placeholder='Why are you changing this ticket?'></label>";
  html+="<div class='wl-it-ops-actions'><button class='wl-big wl-red' "+(edit?'data-wl-it-save-managed-job':'data-wl-it-submit-create-job')+">"+(edit?'SAVE TICKET CHANGES →':'CREATE TECH CHECK JOB →')+"</button><button class='wl-big wl-gray' data-wl-it-managed-jobs>CANCEL / VIEW TICKETS</button></div></div>";
  return html;
}
function bindITOpsForm(){
  const form=document.getElementById('wlITOpsJobForm');
  if(!form||form.dataset.bound==='1')return;
  form.dataset.bound='1';
  form.addEventListener('input',function(){itOpsRefreshFlow();const s=document.getElementById('wlITOpsCameraSummary');if(s){const n=document.createElement('div');n.innerHTML=itOpsMonitoredCameraHtml(readITOpsEquipmentManifest());s.replaceWith(n.firstElementChild);}});
  form.addEventListener('change',function(){itOpsRefreshFlow();const s=document.getElementById('wlITOpsCameraSummary');if(s){const n=document.createElement('div');n.innerHTML=itOpsMonitoredCameraHtml(readITOpsEquipmentManifest());s.replaceWith(n.firstElementChild);}});
  itOpsRefreshFlow();
}
async function showITCreateJob(){
  if(currentRoleKey()!=='it')return;
  ensureITCommandDashboardStyles();
  let card=document.getElementById('wlITOpsCreate');
  if(!card){card=document.createElement('div');card.id='wlITOpsCreate';card.className='card wl-it-simple-card';viewIT().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Opening IT Create Job…');
  hideChildren(viewIT(),[card]);resetWizardPosition();
  try{
    await loadITOpsProfiles();
    card.innerHTML="<button class='wl-back' data-wl-home='it'>← IT DASHBOARD</button>"+progress('CREATE JOB','MHelpDesk remains separate · you become Ticket Lead',1,1)+
      "<div class='wl-it-restock-banner'><b>NORMAL IT OPERATIONS — NO OWNER APPROVAL REQUIRED</b><span>Create the Tech Check workflow after the MHelpDesk ticket exists. Required equipment checks, handoffs, Service verification, and Intake gates still apply.</span></div>"+
      itOpsJobFormHtml(null,'create');
    bindITOpsForm();
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error&&error.message?error.message:'Could not open Create Job.');}
}
function itOpsPayload(){
  const manifest=readITOpsEquipmentManifest();
  const parts=itOpsParts();
  const unitNumbers=((document.getElementById('wlITOpsUnitNumbers')||{}).value||'').trim();
  const standNumbers=((document.getElementById('wlITOpsStandNumbers')||{}).value||'').trim();
  return {
    ticket:(((document.getElementById('wlITOpsTicket')||{}).value)||'').trim(),
    site:(((document.getElementById('wlITOpsSite')||{}).value)||'').trim(),
    workType:(document.getElementById('wlITOpsWorkType')||{}).value||'service',
    date:(document.getElementById('wlITOpsDate')||{}).value||techCheckDateKey(new Date()),
    time:(document.getElementById('wlITOpsTime')||{}).value||null,
    serviceTech:(document.getElementById('wlITOpsServiceTech')||{}).value||null,
    leadTech:(document.getElementById('wlITOpsLead')||{}).value||null,
    description:(((document.getElementById('wlITOpsDescription')||{}).value)||'').trim(),
    notes:(((document.getElementById('wlITOpsNotes')||{}).value)||'').trim(),
    manifest:manifest,parts:parts,requestedUnitCount:equipmentManifestDeviceTotal(manifest),
    unitSummary:[unitNumbers?'Unit #s: '+unitNumbers:'',standNumbers?'Stand / Solar Stand #s: '+standNumbers:''].filter(Boolean).join(' | '),
    changeNote:(((document.getElementById('wlITOpsChangeNote')||{}).value)||'').trim()
  };
}
function validateITOpsPayload(p){
  if(!p.ticket)return 'MHelpDesk ticket number is required.';
  if(!p.description)return 'Enter a short job description.';
  if(['delivery','swap','pickup'].includes(p.workType)&&equipmentManifestTotal(p.manifest)<1)return 'Choose the equipment involved in this '+p.workType+'.';
  const plan=automaticServiceSolarPlan(p.manifest,p.workType);
  if(plan.spotters>0&&manifestQty(p.manifest,'Solar Stand')>0)return 'Remove Solar Stand from the IT list. Delivery with Solar Spotter automatically creates the Service-side Solar Stand checkout.';
  return '';
}
async function itSubmitCreateJob(){
  const p=itOpsPayload();
  const problem=validateITOpsPayload(p);
  if(problem)return alert(problem);
  const flow=itOpsFlowState();
  const leadProfile=wlITOpsProfilesCache.find(function(x){return String(x.user_id)===String(p.leadTech);});
  const leadName=p.leadTech?((leadProfile&&(leadProfile.full_name||leadProfile.username))||'selected IT Technician'):((document.getElementById('whoName')||{}).textContent||'Me');
  if(!confirm('CREATE TECH CHECK JOB\n\nMHelpDesk #'+p.ticket+'\n'+(p.site||'No site entered')+'\n'+p.workType.toUpperCase()+' · '+flow.label+'\n\nTicket Lead: '+leadName+'\nContinue?'))return;
  document.body.classList.add('busy');
  try{
    const result=await liveDb.rpc('it_create_job_v1',{
      p_ticket_no:p.ticket,p_site:p.site,p_work_type:p.workType,p_scheduled_for:p.date,p_scheduled_time:p.time,
      p_service_assignee_user_id:p.serviceTech,p_requested_unit_count:p.requestedUnitCount,p_unit_summary:p.unitSummary,
      p_job_description:p.description,p_notes:p.notes,p_solar_panel_qty:p.parts.solar_panel_qty,p_battery_replacement_qty:p.parts.battery_replacement_qty,
      p_camera_replacement_qty:p.parts.camera_replacement_qty,p_sim_replacement_qty:p.parts.sim_replacement_qty,p_micro_sd_qty:p.parts.micro_sd_qty,p_equipment_manifest:p.manifest
    });
    if(result.error)throw result.error;
    if(p.leadTech && result.data && String(result.data.job_lead_user_id)!==String(p.leadTech)){
      const transfer=await liveDb.rpc('transfer_ticket_lead_v1',{p_ticket_no:p.ticket,p_new_it_user_id:p.leadTech,p_reason:'Assigned to IT Technician during ticket creation'});
      if(transfer.error)throw transfer.error;
      result.data.job_lead_user_id=p.leadTech;
      result.data.job_lead_name=(transfer.data&&transfer.data.new_lead_name)||leadName;
    }
    if(result.data&&result.data.service_assignment_id){
      try{await liveDb.functions.invoke('send-techcheck-push',{body:{assignment_id:result.data.service_assignment_id}});}catch(pushError){console.warn('Service push failed',pushError);}
    }
    rememberTechCompletion('it',p.ticket,'TICKET CREATED · LEAD: '+leadName);
    alert('MHelpDesk #'+p.ticket+' is now in Tech Check.\n\nTicket Lead: '+((result.data&&result.data.job_lead_name)||((document.getElementById('whoName')||{}).textContent)||'IT')+'\nFlow: '+flow.label);
    await loadITManagedTickets();
    return showITManagedTickets();
  }catch(error){alert(error&&error.message?error.message:'Could not create this Tech Check job.');}
  finally{document.body.classList.remove('busy');}
}
function itManagedTicketStatus(t){
  if(t.all_finished)return 'COMPLETE';
  if(t.any_started)return 'IN PROGRESS';
  return 'SCHEDULED / READY';
}
function itManagedTicketNextAction(t){
  if(t.all_finished)return {label:'COMPLETE',detail:'All required Tech Check stages are finished.',tone:'done'};
  const type=String(t.work_type||'service').toLowerCase();
  const hasPrep=itManagedFlowLabel(t)!=='SERVICE'&&type!=='pickup';
  if(t.any_started)return {label:'FOLLOW ACTIVE WORK',detail:'Work has started. Keep ownership and follow the existing workflow; Service reassignment or workflow restructuring now requires Owner intervention.',tone:'active'};
  if(type==='pickup')return {label:'WAIT FOR SERVICE PICKUP',detail:'Service performs the pickup first. IT Intake is required when the equipment returns.',tone:'next'};
  if(hasPrep)return {label:'COMPLETE IT PREP / HANDOFF',detail:type==='swap'?'Prepare and verify the replacement, then hand off to Service. The removed unit returns to IT Intake.':'Complete required equipment checks, then hand off to Service.',tone:'next'};
  return {label:'SERVICE FIELD WORK',detail:'No shop prep is required. Service can work the field call while you remain Ticket Lead.',tone:'next'};
}
function itManagedFlowLabel(t){
  const parts={solar_panel_qty:t.solar_panel_qty,battery_replacement_qty:t.battery_replacement_qty,camera_replacement_qty:t.camera_replacement_qty,sim_replacement_qty:t.sim_replacement_qty,micro_sd_qty:t.micro_sd_qty};
  const type=String(t.work_type||'service');
  if(type==='pickup')return 'SERVICE → IT INTAKE';
  if(type==='swap')return 'IT → SERVICE → IT INTAKE';
  if(type==='delivery')return 'IT → SERVICE';
  return (normalizedEquipmentManifest(t.equipment_manifest).length||ticketPartsTotal(parts))?'IT → SERVICE':'SERVICE';
}
function itManagedTicketHtml(t){
  const service=t.service_assignee_name||'Service Department';
  const date=t.scheduled_for?new Date(String(t.scheduled_for)+'T12:00:00').toLocaleDateString():'No date';
  let html="<article class='wl-it-ops-ticket'><header><div><h3>MHelpDesk #"+esc(t.ticket_no)+"</h3><div class='small'>"+esc(t.site||'Customer / site not recorded')+"</div></div><span class='pill'>"+esc(itManagedTicketStatus(t))+"</span></header>";
  html+="<div class='lead'>TICKET LEAD · "+esc(t.job_lead_name||'IT')+"</div>";
  html+="<div class='meta'><span>"+esc(String(t.work_type||'service').toUpperCase())+"</span><span>"+esc(itManagedFlowLabel(t))+"</span><span>"+esc(date+(t.scheduled_time?' · '+String(t.scheduled_time).slice(0,5):''))+"</span><span>Service: "+esc(service)+"</span></div>";
  html+="<div class='small top8'>"+esc(t.job_description||'No description')+"</div>";
  const next=itManagedTicketNextAction(t);
  html+="<div class='wl-it-ticket-next "+esc(next.tone)+"'><b>NEXT · "+esc(next.label)+"</b><span>"+esc(next.detail)+"</span></div>";
  html+="<div class='wl-it-ops-actions'><button class='mini' data-wl-it-edit-managed-ticket='"+esc(t.ticket_no)+"'>Open Ticket</button><button class='mini' data-wl-it-ticket-history='"+esc(t.ticket_no)+"'>History</button></div></article>";
  return html;
}
async function showITManagedTickets(){
  if(currentRoleKey()!=='it')return;
  ensureITCommandDashboardStyles();
  let card=document.getElementById('wlITManagedTickets');
  if(!card){card=document.createElement('div');card.id='wlITManagedTickets';card.className='card wl-it-simple-card';viewIT().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading tickets you lead…');
  hideChildren(viewIT(),[card]);resetWizardPosition();
  try{
    const rows=await loadITManagedTickets();
    card.innerHTML="<button class='wl-back' data-wl-home='it'>← IT DASHBOARD</button>"+progress('MY MANAGED TICKETS','Create, assign, and transfer IT ticket responsibility',1,1)+
      "<div class='wl-it-ops-banner'><b>TICKET LEAD CONTROL</b><span>The creator does not have to remain responsible. Assign the ticket to the IT Technician who should own it, and transfer it later when needed. Every transfer stays in History.</span></div>"+
      "<div class='wl-it-ops-actions top10'><button class='wl-big wl-red' data-wl-it-create-job>＋ CREATE JOB</button></div>"+
      "<div class='wl-it-ops-ticket-list top10'>"+(rows.length?rows.map(itManagedTicketHtml).join(''):"<div class='ok'><b>No tickets assigned to you as Ticket Lead yet.</b></div>")+"</div>";
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error&&error.message?error.message:'Could not load managed tickets.');}
}
async function showITManagedTicketEditor(ticket){
  if(currentRoleKey()!=='it')return;
  if(!wlITManagedTicketsCache.length)await loadITManagedTickets();
  const t=wlITManagedTicketsCache.find(function(row){return String(row.ticket_no)===String(ticket);});
  if(!t)return alert('Ticket not found in your managed work.');
  await loadITOpsProfiles();
  let card=document.getElementById('wlITManagedTicketEditor');
  if(!card){card=document.createElement('div');card.id='wlITManagedTicketEditor';card.className='card wl-it-simple-card';viewIT().append(card);}
  hideChildren(viewIT(),[card]);resetWizardPosition();
  const itOptions=wlITOpsProfilesCache.filter(function(p){return p.role==='it'&&String(p.user_id)!==String(t.job_lead_user_id);}).map(function(p){
    return "<option value='"+esc(p.user_id)+"'>"+esc(p.full_name||p.username||'IT Technician')+"</option>";
  }).join('');
  const next=itManagedTicketNextAction(t);
  card.innerHTML="<button class='wl-back' data-wl-it-managed-jobs>← MANAGED TICKETS</button>"+progress('MANAGE TICKET','MHelpDesk #'+esc(t.ticket_no),1,1)+
    "<div class='wl-it-ticket-command'><div><small>CURRENT STATUS</small><b>"+esc(itManagedTicketStatus(t))+"</b></div><div><small>WORKFLOW</small><b>"+esc(itManagedFlowLabel(t))+"</b></div><div class='wide'><small>YOUR NEXT ACTION</small><b>"+esc(next.label)+"</b><span>"+esc(next.detail)+"</span></div></div>"+
    itOpsJobFormHtml(t,'edit')+
    (canITAccountManageOwnership()?"<details class='wl-it-more top10'><summary>CHANGE TICKET OWNERSHIP</summary><div class='wl-it-owner-lock'><b>OWNER CONTROL</b> Only your IT account can change ticket ownership. Teddy and Victor can receive and work tickets but cannot transfer ownership.</div><label>Assign Ticket Lead To<select id='wlITTransferLead'><option value=''>Choose IT Technician…</option>"+itOptions+"</select></label><label>Reason<textarea id='wlITTransferReason' rows='2' placeholder='Why is responsibility moving?'></textarea></label><button class='wl-big wl-gray top8' data-wl-it-transfer-ticket='"+esc(t.ticket_no)+"'>CHANGE OWNERSHIP →</button></details>":"");
  bindITOpsForm();
}
async function itSaveManagedJob(){
  const p=itOpsPayload();
  const problem=validateITOpsPayload(p);
  if(problem)return alert(problem);
  document.body.classList.add('busy');
  try{
    const result=await liveDb.rpc('it_update_managed_job_v1',{
      p_ticket_no:p.ticket,p_site:p.site,p_work_type:p.workType,p_scheduled_for:p.date,p_scheduled_time:p.time,
      p_service_assignee_user_id:p.serviceTech,p_requested_unit_count:p.requestedUnitCount,p_unit_summary:p.unitSummary,
      p_job_description:p.description,p_notes:p.notes,p_solar_panel_qty:p.parts.solar_panel_qty,p_battery_replacement_qty:p.parts.battery_replacement_qty,
      p_camera_replacement_qty:p.parts.camera_replacement_qty,p_sim_replacement_qty:p.parts.sim_replacement_qty,p_micro_sd_qty:p.parts.micro_sd_qty,
      p_equipment_manifest:p.manifest,p_change_note:p.changeNote
    });
    if(result.error)throw result.error;
    alert('MHelpDesk #'+p.ticket+' updated. The change is in the permanent ticket history.');
    await loadITManagedTickets();
    return showITManagedTicketEditor(p.ticket);
  }catch(error){alert(error&&error.message?error.message:'Could not update this ticket.');}
  finally{document.body.classList.remove('busy');}
}
async function showITTicketHistory(ticket){
  let card=document.getElementById('wlITTicketHistory');
  if(!card){card=document.createElement('div');card.id='wlITTicketHistory';card.className='card wl-it-simple-card';viewIT().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading ticket history…');
  hideChildren(viewIT(),[card]);resetWizardPosition();
  try{
    const result=await liveDb.rpc('ticket_activity_v1',{p_ticket_no:ticket});
    if(result.error)throw result.error;
    const rows=Array.isArray(result.data)?result.data:[];
    const body=rows.length?rows.map(function(r){
      return "<div class='wl-it-ops-history-row'><b>"+esc(String(r.action||'updated').replaceAll('_',' ').toUpperCase())+"</b><span>"+esc(r.actor_name||'System')+" · "+esc(r.actor_role==='it'?'IT Technician':r.actor_role==='owner'?'Owner/Admin':r.actor_role||'System')+"</span><small>"+new Date(r.created_at).toLocaleString()+(r.note?' · '+esc(r.note):'')+"</small></div>";
    }).join(''):"<div class='small'>No ticket-history events yet.</div>";
    card.innerHTML="<button class='wl-back' data-wl-it-managed-jobs>← MANAGED TICKETS</button>"+progress('TICKET HISTORY','MHelpDesk #'+esc(ticket),1,1)+"<div class='wl-it-ops-history'>"+body+"</div>";
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error&&error.message?error.message:'Could not load ticket history.');}
}
async function itTransferManagedTicket(ticket){
  if(!canITAccountManageOwnership())return alert('Only James Martin can change ticket ownership.');
  const id=(document.getElementById('wlITTransferLead')||{}).value||'';
  const reason=(((document.getElementById('wlITTransferReason')||{}).value)||'').trim();
  if(!id)return alert('Choose the IT Technician who is taking responsibility.');
  if(!reason)return alert('Enter the reason for transferring this ticket.');
  const p=wlITOpsProfilesCache.find(function(x){return String(x.user_id)===String(id);});
  if(!confirm('Transfer MHelpDesk #'+ticket+' to '+((p&&(p.full_name||p.username))||'this IT Technician')+'?\n\nYou will no longer be the Ticket Lead.'))return;
  document.body.classList.add('busy');
  try{
    const result=await liveDb.rpc('transfer_ticket_lead_v1',{p_ticket_no:ticket,p_new_it_user_id:id,p_reason:reason});
    if(result.error)throw result.error;
    alert('Ticket ownership transferred to '+((result.data&&result.data.new_lead_name)||(p&&(p.full_name||p.username))||'the new IT lead')+'. The transfer is permanently logged.');
    await loadITManagedTickets();
    return showITManagedTickets();
  }catch(error){alert(error&&error.message?error.message:'Could not transfer ticket ownership.');}
  finally{document.body.classList.remove('busy');}
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
  if (pendingAssignmentManifest.length) return normalizedEquipmentManifest(pendingAssignmentManifest);
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
  const assignedPlan = pendingAssignmentManifest.length
    ? `<div class='wl-requirement-section unitArea'><div class='wl-requirement-heading'>EQUIPMENT FROM OWNER</div><div class='small'>This equipment is locked to the Owner assignment. IT prepares exactly what is listed below.</div>${equipmentManifestInlineHtml({equipment_manifest:pendingAssignmentManifest})}</div>`
    : itEquipmentManifestInputsHtml([]);
  wrap.innerHTML=`<div class='qtext'>Parts Required From This Ticket</div>${assignedPlan}<div id='wlITEquipmentCountSummary' class='wl-equipment-count-summary'></div><div class='wl-requirement-section partsArea'><div class='wl-requirement-heading'>REPLACEMENT / SWAP WORK</div><div class='small'><b>IT supplies all listed SIM and SD/micro SD cards.</b> Put the exact quantity in the Service handoff.</div>${ticketPartsInputsHtml('wlPart')}</div>`;
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
async function openITHomeTicketSearch(){
  const homeInput=document.getElementById('wlITHomeTicketSearch');
  const ticket=String(homeInput?.value||'').trim().replace(/^#\s*/,'');
  if(!ticket){
    homeInput?.focus();
    return;
  }
  showITJobLookup();
  const lookup=document.getElementById('wlITJobSearch');
  if(lookup) lookup.value=ticket;
  await itFindJobByTicket();
}
function showITJobLookup() {
  let card=document.getElementById('wlItJobLookup');
  if(!card){
    card=document.createElement('div');
    card.id='wlItJobLookup';
    card.className='card wl-it-simple-card';
    viewIT().append(card);
  }
  card.innerHTML=`<button class='wl-back' data-wl-home='it'>← BACK</button>
    <div class='wl-it-step-label'>NEXT STEP</div>
    <div class='wl-question wl-it-ticket-entry'>
      <div class='qtext'>ENTER YOUR MHELPDESK TICKET #</div>
      <input id='wlITJobSearch' inputmode='numeric' autocomplete='off' placeholder='TICKET #'>
      <button class='wl-it-start top10' data-wl-it-find-job>FIND MY IT JOB</button>
      <div id='wlITJobSearchMsg' class='wl-it-help'>The ticket must be assigned to you or available to the IT team.</div>
    </div>`;
  hideChildren(viewIT(),[card]);
  resetWizardPosition();
  requestAnimationFrame(()=>document.getElementById('wlITJobSearch')?.focus());
}
async function itFindJobByTicket() {
  const input=document.getElementById('wlITJobSearch');
  const msg=document.getElementById('wlITJobSearchMsg');
  const ticket=String(input?.value||'').trim().replace(/^#\s*/,'');
  if(!ticket){
    if(msg)msg.innerHTML='<div class="wl-stop"><b>ENTER A TICKET NUMBER.</b></div>';
    return;
  }

  const tech=await currentTechIdentity().catch(()=>null);
  if(!tech?.id)return alert('Active IT Technician account required.');

  const {data,error}=await liveDb.from('job_assignments')
    .select('*')
    .eq('ticket_no',ticket)
    .eq('assigned_role','it')
    .in('status',['assigned','started'])
    .order('assigned_at',{ascending:false})
    .limit(10);
  if(error)return alert(error.message);

  let a=(data||[]).find(x=>x.assignee_user_id===tech.id)
    ||(data||[]).find(x=>!x.assignee_user_id&&x.assignment_scope==='department');

  if(!a){
    const [returnsResult,siteResult]=await Promise.allSettled([
      liveDb.from('unit_returns')
        .select('id,ticket_no,unit_tag,equipment_type,status,returned_at')
        .eq('ticket_no',ticket)
        .eq('status','waiting_it')
        .order('returned_at',{ascending:true})
        .limit(10),
      swapSiteRegistrationRows()
    ]);
    const waitingReturns=returnsResult.status==='fulfilled'&&!returnsResult.value.error ? (returnsResult.value.data||[]) : [];
    const siteTasks=siteResult.status==='fulfilled' ? (siteResult.value||[]).filter(row=>norm(row.ticket_no)===norm(ticket)) : [];

    if(waitingReturns.length||siteTasks.length){
      const siteHtml=siteTasks.map(row=>`<div class='wl-it-good top10'><b>SITE REGISTRATION REQUIRED</b><div class='small'>${esc(row.equipment_type||'Unit')} ${esc(row.unit_tag||'')} · ${esc(row.site||'Customer site')}</div><button class='wl-it-start top10' data-wl-confirm-swap-site='${esc(row.id)}' data-wl-swap-site-label='${esc((row.equipment_type||'Unit')+' '+(row.unit_tag||''))}' data-wl-swap-site='${esc(row.site||'Customer site')}'>CONFIRM SITE REGISTRATION</button></div>`).join('');
      const returnHtml=waitingReturns.length ? `<div class='wl-it-good top10'><b>IT INTAKE REQUIRED · ${waitingReturns.length} ITEM${waitingReturns.length===1?'':'S'}</b><div class='small'>Next: ${esc(waitingReturns[0].equipment_type||'Unit')} ${esc(waitingReturns[0].unit_tag||'')}</div><button class='wl-it-start top10' data-wl-intake-start='${waitingReturns[0].id}'>START IT INTAKE</button></div>` : '';
      if(msg)msg.innerHTML=`<div class='wl-it-ticket-found'>
        <div class='wl-it-step-label'>IT FOLLOW-UP FOUND</div>
        <div class='wl-it-ticket-number'>#${esc(ticket)}</div>
        <div class='wl-it-ticket-site'>${siteTasks.length?'SWAP FOLLOW-UP':''}${siteTasks.length&&waitingReturns.length?' + ':''}${waitingReturns.length?'RETURN / INTAKE':''}</div>
        ${siteHtml}${returnHtml}
      </div>`;
      return;
    }

    const assignedOther=(data||[]).find(x=>x.assignee_user_id&&x.assignee_user_id!==tech.id);
    if(msg)msg.innerHTML=assignedOther
      ? `<div class='wl-stop'><b>THIS IT JOB IS ASSIGNED TO ANOTHER TECHNICIAN.</b><div>MHelpDesk #${esc(ticket)} cannot be opened under this login.</div></div>`
      : `<div class='wl-stop'><b>NO IT WORK FOUND FOR #${esc(ticket)}</b><div>No active IT assignment, site-registration task, or returned equipment is waiting under this ticket.</div></div>`;
    return;
  }

  const gate=await assignmentGateState(a);
  const ready=Boolean(gate.ready);
  const assignedToMe=a.assignee_user_id===tech.id;
  const mode=String(a.work_type||'service').toUpperCase();

  if(msg)msg.innerHTML=`<div class='wl-it-ticket-found'>
    <div class='wl-it-step-label'>IT JOB FOUND</div>
    <div class='wl-it-ticket-number'>#${esc(a.ticket_no)}</div>
    <div class='wl-it-ticket-site'>${esc(a.site||'NO SITE LISTED')}</div>
    <div class='wl-it-job-type'>${esc(mode)}</div>
    <div class='${ready?'wl-it-good':'wl-it-wait'}'>${ready?'✓ '+esc(assignedToMe?'THIS IT JOB IS ASSIGNED TO YOU':'THIS JOB IS AVAILABLE TO THE IT TEAM'):'WAITING — '+esc(gate.label)}</div>
    ${ready
      ? `<button class='wl-it-start top10' data-wl-start-assignment='${a.id}'>START IT JOB</button>`
      : `<div class='wl-stop top10'><b>YOU CANNOT START YET.</b><div>${esc(gate.detail||'A required prior workflow step is not complete.')}</div></div>`}
  </div>`;
}
function refreshAssignedITSetupSummary() {
  const host=document.getElementById('wlAssignedEquipmentReq');
  if(!host || !pendingAssignmentManifest.length) return;
  const ticket=document.getElementById('itTicket')?.value?.trim() || '';
  const site=document.getElementById('itSite')?.value?.trim() || '';
  const equipment=normalizedEquipmentManifest(pendingAssignmentManifest)
    .map(row=>`${row.qty} × ${equipmentDisplayLabel(row.label)}`).join(' · ');
  const partData={};
  TICKET_PARTS.forEach(part=>{partData[part.key]=cleanPartQty(document.getElementById('wlPart'+part.id)?.value);});
  const parts=ticketPartsRows(partData).filter(row=>row.qty>0);
  host.innerHTML=`<div class='wl-simple-setup'>
    <div class='wl-simple-setup-kicker'>YOUR IT JOB</div>
    <div class='wl-simple-setup-ticket'>MHelpDesk #${esc(ticket)}</div>
    <div class='wl-simple-setup-site'>${esc(site)}</div>
    <div class='wl-simple-setup-label'>PREPARE</div>
    <div class='wl-simple-setup-equipment'>${esc(equipment)}</div>
    ${parts.length?`<div class='wl-simple-setup-label'>ALSO TAKE</div><div class='small'>${parts.map(row=>row.qty+' × '+esc(row.label)).join(' · ')}</div>`:''}
    <div class='wl-simple-setup-note'>The Owner already chose the equipment. Follow the steps for each unit.</div>
  </div>`;
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
  let req = document.getElementById('wlAssignedEquipmentReq');
  if (!req) { req = document.createElement('div'); req.id = 'wlAssignedEquipmentReq'; nav.before(req); }
  head.style.display = '';
  nav.style.display = '';

  if (pendingAssignmentManifest.length) {
    if (p.ticket) p.ticket.style.display = 'none';
    if (totalWrap) totalWrap.style.display = 'none';
    if (equipmentWrap) equipmentWrap.style.display = 'none';
    if (partsWrap) partsWrap.style.display = 'none';
    req.style.display = '';
    head.innerHTML = progress('Job Setup', 'Ready to start', 1, 1);
    refreshAssignedITSetupSummary();
    const partsOnlyDraft=equipmentManifestTotal(pendingAssignmentManifest)===0&&ticketPartsTotal(readTicketPartInputs('wlPart'))>0;
    nav.innerHTML = `<div class='wl-nav'><button class='wl-prev' data-wl-create='prev'>← IT Home</button><button class='wl-next' data-wl-create='finish'>${partsOnlyDraft?'Review Parts →':'Start Unit 1 →'}</button></div>`;
  } else {
    if (p.ticket) p.ticket.style.display = 'grid';
    if (totalWrap) totalWrap.style.display = '';
    if (equipmentWrap) equipmentWrap.style.display = '';
    if (partsWrap) partsWrap.style.display = '';
    req.style.display = 'none';
    head.innerHTML = progress('Job Setup', 'Enter the ticket and equipment', 1, 1);
    const partsOnlyDraft=expectedPrepItemCount()===0&&ticketPartsTotal(readTicketPartInputs('wlPart'))>0;
    nav.innerHTML = `<div class='wl-nav'><button class='wl-prev' data-wl-create='prev'>← IT Home</button><button class='wl-next' data-wl-create='finish'>${partsOnlyDraft?'Review Parts →':'Start Unit 1 →'}</button></div>`;
  }
  resetWizardPosition();
}
function validateCreateStep() {
  if (!document.getElementById('itTicket')?.value.trim()) { alert('Enter the MHelpDesk ticket number first.'); return false; }
  if (!document.getElementById('itSite')?.value.trim()) { alert('Enter the ticket name / customer / site so Service can verify the same ticket.'); return false; }
  const manifest = readITEquipmentManifest();
  const unitCount = equipmentManifestDeviceTotal(manifest);
  const standCount = equipmentManifestStandTotal(manifest);
  const totalItems = unitCount + standCount;
  const parts=readTicketPartInputs('wlPart');
  const partTotal=ticketPartsTotal(parts);
  if (totalItems < 1 && partTotal < 1) { alert('Choose equipment or at least one loose part for this IT → Service handoff.'); return false; }
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
  let prepId;
  try{
    prepId=await window.TechCheckITPrep.createPrepShell({
      ticket,
      site,
      requestedUnits,
      manifest,
      parts,
      workType:pendingAssignmentWorkType||'service'
    });
  }catch(error){
    document.body.classList.remove('busy');
    return alert(error?.message||'Could not create the IT prep ticket.');
  }
  document.body.classList.remove('busy');
  if (pendingAssignmentLinkId) {
    const { error: linkError } = await linkAssignmentToPrepCompat( pendingAssignmentLinkId,prepId );
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
async function showITIntake(){
  if(!isIT()||!viewIT())return;
  return window.TechCheckITIntake.showHome({view:viewIT,hideChildren,resetPosition:resetWizardPosition});
}
async function showITIntakeList(kind='waiting'){
  return window.TechCheckITIntake.showList(kind,{view:viewIT,progress,photoHtml:returnPhotoHtml,hideChildren,resetPosition:resetWizardPosition});
}

async function startITIntake(id) {
  const rows=await returnRows(),row=rows.find(x=>x.id===id);if(!row)return;
  intakeWizard=window.TechCheckITIntake.start(row);return renderITIntakeWizard();
}
async function renderITIntakeWizard(){
  window.TechCheckITIntake.setState(intakeWizard);
  return window.TechCheckITIntake.render({view:viewIT(),progress,photoHtml:returnPhotoHtml,hideChildren,resetPosition:resetWizardPosition,onEmpty:showITIntake});
}

async function showPendingList() {
  const { data } = await liveDb.from('prep_tickets').select('id,ticket_no,site,status,created_at,expected_unit_count,solar_panel_qty,battery_replacement_qty,camera_replacement_qty,sim_replacement_qty,micro_sd_qty,prep_items(id)').eq('status', 'draft').order('created_at', { ascending: true });
  let card = document.getElementById('wlPendingList'); if (!card) { card = document.createElement('div'); card.id = 'wlPendingList'; card.className = 'card'; viewIT().append(card); }
  const rows = data || [];
  card.innerHTML = `${progress('Pending IT Work', rows.length ? 'Choose a ticket to continue' : 'Nothing is waiting in IT', 1, 1)}<button class='wl-back' data-wl-home='it'>← IT Home</button>${rows.map(r => {
    const started=(r.prep_items||[]).length;
    const parts=ticketPartsTotal(r);
    const partsOnly=r.expected_unit_count==null&&started===0&&parts>0;
    const total=r.expected_unit_count??started;
    const next=partsOnly?'Next: verify loose parts, photo, and IT signature':started<total?`Next: start equipment item ${started+1} of ${total}`:'Next: continue the first incomplete check';
    return `<div class='wl-ticket'><b>MHelpDesk #${esc(r.ticket_no)}</b><div class='small'>${esc(r.site || 'No site / description')}</div><div class='small'>${partsOnly?'PARTS-ONLY HANDOFF':`Equipment items started: ${started} of ${total}`}</div><div class='ok top8'><b>${esc(next)}</b></div><button class='wl-big wl-blue' data-wl-open-it='${r.id}'>Resume This ${partsOnly?'Handoff':'Prep'} →</button></div>`;
  }).join('') || `<div class='ok'><b>No pending prep.</b></div>`}`;
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
async function getPrep(id) {
  const { data } = await liveDb.from('prep_tickets').select('*,prep_items(*)').eq('id', id).single(); return data;
}
async function evidenceRows(prepId,stage){return window.TechCheckEvidence.rows(prepId,stage);}
async function optimizeEvidencePhoto(file){return window.TechCheckEvidence.optimizePhoto(file);}
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
async function saveItTagScan(itemId,scan){return window.TechCheckITPrep.saveTagScan(itemId,scan);}

async function uploadEvidence(prepId,stage,kind,file,name,itemId=null){return window.TechCheckEvidence.upload(prepId,stage,kind,file,name,itemId);}
function wireCanvas(canvas){return window.TechCheckEvidence.wireCanvas(canvas);}
function blobFromCanvas(canvas){return window.TechCheckEvidence.blobFromCanvas(canvas);}
async function proofHtml(prepId,stage,editable){
  return window.TechCheckEvidenceView.proofHtml(prepId,stage,editable,{evidenceRows,esc});
}
async function photoOnlyHtml(prepId,stage,unitNo=null,expectedCount=null){
  return window.TechCheckEvidenceView.photoOnlyHtml(prepId,stage,unitNo,expectedCount,{
    evidenceRows,esc,itItems,itemIdentity:itItemIdentity,shouldScanUnitTag,itemTagScan
  });
}
function signatureStamp(name,at){
  if(!at) return `Signed by ${esc(name || 'Technician')}`;
  const d=new Date(at);
  const date=d.toLocaleDateString([], {month:'numeric',day:'numeric',year:'numeric'});
  const time=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return `Signed by ${esc(name || 'Technician')} · ${esc(date)} · ${esc(time)}`;
}
async function signatureOnlyHtml(prepId,stage,unitNo=null){
  return window.TechCheckEvidenceView.signatureOnlyHtml(prepId,stage,unitNo,{evidenceRows,signatureStamp});
}
const CAMERA_UNIT_TYPES = window.TechCheckRules?.deviceTypes || ['Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'];
const STAND_POLE_TYPES = window.TechCheckRules?.standTypes || ['Solar Stand','110V Stand','Pole'];
function itItems(){return window.TechCheckITPrepWizard.sortedItems(activeItPrep);}
function currentItItem() { return itItems()[itUnitIndex] || null; }
function itPurposeOptionsForCurrentJob(type){
  const workType=String(activeItPrep?.work_type||pendingAssignmentWorkType||'service').toLowerCase();
  return window.TechCheckITPrepRules.purposeOptions(type,workType);
}
function itPurposeAllowedForCurrentJob(type,purpose){
  const workType=String(activeItPrep?.work_type||pendingAssignmentWorkType||'service').toLowerCase();
  return window.TechCheckITPrepRules.purposeAllowed(type,purpose,workType);
}
const unitEvidence=(rows,unitNo,kind)=>window.TechCheckEvidence.unitRows(rows,unitNo,kind);
const unitSignature=(rows,unitNo)=>window.TechCheckEvidence.unitSignature(rows,unitNo);
function itItemIdentity(item,unitNo){return window.TechCheckITPrepRules.itemIdentity(item,unitNo);}
function itUnitStepsData(item,unitNo){return window.TechCheckITPrepRules.checklist(item,unitNo);}
function itBoolValue(item,field){return window.TechCheckITPrepWizard.boolValue(item,field,itDraftAnswers);}
function itBoolAnswered(item,field){return window.TechCheckITPrepWizard.boolAnswered(item,field,itDraftAnswers,itAnswered);}
function itPhotoTagReady(item){return window.TechCheckITPrepWizard.photoTagReady(item);}
async function configureCurrentItItem(){
  const result=await window.TechCheckITPrepWizard.configureCurrent({
    prep:activeItPrep,
    unitIndex:itUnitIndex,
    typeChoice:itTypeChoice,
    purposeChoice:itPurposeChoice,
    reconRequired:itReconRequired
  },{
    configureBase:args=>window.TechCheckITPrep.configureBase(args),
    initializeConfigured:args=>window.TechCheckITPrep.initializeConfigured(args),
    reload:getPrep
  });
  if(!result?.ok){
    if(result?.error)alert(result.error?.message||'Could not configure this IT prep item.');
    return false;
  }
  activeItPrep=result.prep;
  return true;
}
async function persistCurrentItItem(){
  const result=await window.TechCheckITPrepWizard.persistCurrent({prep:activeItPrep,unitIndex:itUnitIndex},{
    saveItem:item=>window.TechCheckITPrep.saveItem(item),
    reload:getPrep
  });
  if(!result?.ok){
    if(result?.error)alert(result.error?.message||'Could not save this IT prep item.');
    return false;
  }
  activeItPrep=result.prep;
  return true;
}

function itUnitIssues(item,evidence,unitNo){
  return window.TechCheckITPrepWizard.unitIssues(item,evidence,unitNo,{steps:itUnitStepsData,boolValue:itBoolValue,unitEvidence,photoTagReady:itPhotoTagReady,unitSignature});
}
function itIssueLinksHtml(item,evidence,unitNo){return window.TechCheckITPrepView.issueLinksHtml(item,evidence,unitNo,{esc,issues:itUnitIssues});}
function itUnitReviewHtml(item,evidence,unitNo){return window.TechCheckITPrepView.unitReviewHtml(item,evidence,unitNo,{esc,unitEvidence,stepsData:itUnitStepsData,boolValue:itBoolValue,itemIdentity:itItemIdentity,unitSignature});}
const loadTruckSpareBatteries=(prepId)=>window.TechCheckTruckSpares.load(prepId);
async function releaseItPrepUnitByUnit() {
  if (!activeItPrep) return showITHome();
  const items=itItems();
  const evidence=await evidenceRows(activeItPrep.id,'it');
  const result=await window.TechCheckITPrepWizard.releaseHandoff(activeItPrep,items,evidence,{
    expectedUnits:itExpectedUnits,
    issues:itUnitIssues,
    partsTotal:ticketPartsTotal,
    verifyItems:rows=>window.TechCheckITPrep.verifyItemsForRelease(rows),
    releasePrep:prepId=>window.TechCheckITPrep.releasePrep(prepId),
    refresh:()=>window.refreshData?.(),
    escape:esc
  });
  if(!result?.completed)return;
  activeItPrep=null;
  itUnitIndex=0;
  itQuestionIndex=0;
  itUnitPhase='type';
  rememberTechCompletion('it',result.ticketNo,result.partsOnly?'PARTS HANDOFF COMPLETE':'IT HANDOFF COMPLETE');
  await showITHome();
}
function itWizardCard(){return window.TechCheckITPrepView.wizardCard(viewIT());}
async function showItPrep(prepId) {
  activeItPrep = await getPrep(prepId);
  if (!activeItPrep) return;
  const evidence = await evidenceRows(prepId, 'it');
  const items = itItems();
  const initial=window.TechCheckITPrepWizard.initialState(activeItPrep,items,evidence,{
    issues:itUnitIssues,
    manifestExpanded:equipmentManifestExpanded,
    purposeFromWorkType:prepPurposeFromWorkType
  });
  itExpectedUnits=initial.expectedUnits;
  itUnitIndex=initial.unitIndex;
  itQuestionIndex=initial.questionIndex;
  itAnswered=new Set();
  itUnitPhase=initial.phase;
  if('finalView' in initial)itFinalView=initial.finalView;
  if('typeChoice' in initial)itTypeChoice=initial.typeChoice;
  if('purposeChoice' in initial)itPurposeChoice=initial.purposeChoice;
  if('reconRequired' in initial)itReconRequired=initial.reconRequired;
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
    const spareBatteries = await loadTruckSpareBatteries(activeItPrep.id);
    const finalState=window.TechCheckITPrepWizard.finalReadiness(activeItPrep,items,ev,spareBatteries,{
      expectedUnits:itExpectedUnits,
      issues:itUnitIssues,
      partsTotal:ticketPartsTotal
    });
    const {partsOnly,ready,spareUnitsCheckedOut,spareBatteriesReady,spareBatteriesCheckedOut}=finalState;

    // Final handoff is read-only. Corrections go through Review / Adjust Unit.
    if (itFinalView!=='summary') itFinalView='summary';

    if(partsOnly){
      const partsPhotoHtml=await photoOnlyHtml(activeItPrep.id,'it',null,1);
      const partsSignatureHtml=await signatureOnlyHtml(activeItPrep.id,'it',null);
      wizard.innerHTML=window.TechCheckITPrepView.partsOnlyFinalHtml(activeItPrep,ready,partsPhotoHtml,partsSignatureHtml,{progress,esc,partsRows:ticketPartsRows});
      wizard.querySelectorAll('canvas').forEach(wireCanvas);
      return resetWizardPosition();
    }

    wizard.innerHTML=window.TechCheckITPrepView.finalTicketHtml(activeItPrep,items,spareBatteries,{
      ready,spareUnitsCheckedOut,spareBatteriesReady,spareBatteriesCheckedOut
    },{progress,esc,partsRows:ticketPartsRows});
    return resetWizardPosition();
  }
  const item = items[itUnitIndex] || null;
  const unitNo = itUnitIndex + 1;
  const identity = item ? itItemIdentity(item, unitNo) : `Unit ${unitNo}`;
  if (itUnitPhase === 'type') {
    const typeDecision=window.TechCheckITPrepWizard.typePhaseDecision({
      lockedType:requiredItEquipmentType(itUnitIndex),
      autoPurpose:prepPurposeFromWorkType(activeItPrep?.work_type),
      currentItem:currentItItem(),
      purposeAllowed:itPurposeAllowedForCurrentJob
    });
    if(!typeDecision.missingType){
      itTypeChoice=typeDecision.typeChoice;
      itPurposeChoice=typeDecision.purposeChoice;
      itUnitPhase=typeDecision.phase;
      if('questionIndex' in typeDecision)itQuestionIndex=typeDecision.questionIndex;
      if(typeDecision.configure&&!await configureCurrentItItem())return;
      return renderItUnitStep();
    }
    wizard.innerHTML = window.TechCheckITPrepView.typeMissingHtml(unitNo,totalUnits,{progress,esc});
  } else if (itUnitPhase === 'purpose') {
    const options=itPurposeOptionsForCurrentJob(itTypeChoice);
    const serviceJob=String(activeItPrep?.work_type||'').toLowerCase()==='service';
    wizard.innerHTML = window.TechCheckITPrepView.purposeHtml(unitNo,totalUnits,itTypeChoice,itPurposeChoice,options,serviceJob,{progress,esc});
  } else if (itUnitPhase === 'recon') {
    wizard.innerHTML = window.TechCheckITPrepView.reconHtml(unitNo,totalUnits,itReconRequired,{progress});
  } else if (itUnitPhase === 'checks') {
    const steps = itUnitStepsData(item, unitNo);
    wizard.innerHTML = window.TechCheckITPrepView.checksHtml(item,unitNo,totalUnits,itQuestionIndex,steps,{progress,esc,boolAnswered:itBoolAnswered,boolValue:itBoolValue});
  } else if (itUnitPhase === 'photo') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const photoReady = unitEvidence(ev, unitNo, 'photo').length === 1 && itPhotoTagReady(item);
    const photoHtml=await photoOnlyHtml(activeItPrep.id,'it',unitNo);
    wizard.innerHTML=window.TechCheckITPrepView.photoPhaseHtml(identity,unitNo,totalUnits,photoReady,photoHtml,{progress,esc});
  } else if (itUnitPhase === 'review') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const issues = itUnitIssues(item, ev, unitNo);
    const ready = issues.length === 0;
    wizard.innerHTML=window.TechCheckITPrepView.reviewScreenHtml(identity,unitNo,totalUnits,ready,itUnitReviewHtml(item,ev,unitNo),ready?'':itIssueLinksHtml(item,ev,unitNo),{progress});
  } else if (itUnitPhase === 'signature') {
    const ev = await evidenceRows(activeItPrep.id, 'it');
    const sig = unitSignature(ev, unitNo);
    const signatureHtml=await signatureOnlyHtml(activeItPrep.id,'it',unitNo);
    wizard.innerHTML=window.TechCheckITPrepView.signaturePhaseHtml(identity,unitNo,totalUnits,Boolean(sig),signatureHtml,{progress,esc});
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
async function loadMyServiceTruckReadiness(){
  const preview=ownerTestPreviewFor('service');
  if(preview){
    const {data,error}=await liveDb.rpc('service_departure_readiness_v1',{p_service_tech_id:preview.persona_id});
    if(error)throw error;
    return data||{};
  }
  const {data,error}=await liveDb.rpc('service_departure_readiness_v1');
  if(error)throw error;
  return data||{};
}
function serviceTruckUnitOrder(type){return ({'Sniper':1,'Ranger':2,'Spotter':3,'Solar Spotter':4})[type]||9;}
function serviceTruckRestockRowsHtml(readiness){
  const rows=Array.isArray(readiness?.restock_requests)?readiness.restock_requests:[];
  if(!rows.length)return '';
  return `<div class='wl-truck-restock-list'><div class='wl-truck-section-title'>RESTOCK STATUS</div>${rows.map(r=>{
    const qty=r.item_kind==='unit'?'1 unit':r.item_kind==='sim'?'1 SIM':(String(r.qty_needed)+' needed');
    const detail=r.item_kind==='unit'
      ? `${r.used_unit_tag?'Used truck unit '+esc(r.used_unit_tag)+' · ':''}${r.old_unit_tag?'Old unit '+esc(r.old_unit_tag)+' · ':''}${r.original_ticket_no?'MHelpDesk #'+esc(r.original_ticket_no):''}`
      : r.item_kind==='sim'
        ? `Slot ${Number(r.sim_slot_no||0)}${r.used_sim_number?' · Used SIM '+esc(r.used_sim_number):''}${r.replacement_sim_number?' · Replacement '+esc(r.replacement_sim_number):''}${r.original_ticket_no?' · MHelpDesk #'+esc(r.original_ticket_no):''}`
        : `${esc(qty)}${r.original_ticket_no?' · MHelpDesk #'+esc(r.original_ticket_no):''}`;
    const action=r.status==='ready'
      ? `<button class='wl-service-start top8' data-wl-service-accept-truck-restock='${esc(r.id)}'>ACCEPT FROM IT →</button>`
      : (r.status==='awaiting_return'&&r.old_unit_tag
        ? `<button class='wl-big wl-red top8' data-wl-next-svc-return data-ticket='${esc(r.original_ticket_no||'')}' data-unit='${esc(r.old_unit_tag)}' data-type='${esc(r.item_type)}'>RETURN OLD UNIT TO IT →</button>`
        : `<div class='small top8'>${r.status==='requested'?'IT RESTOCK REQUESTED':r.status==='preparing'?'IT IS PREPARING THIS':'WAITING FOR IT'}</div>`);
    return `<div class='wl-truck-restock-row ${r.status==='ready'?'ready':''}'><div><b>${esc(r.item_type)}</b><span>${detail}</span></div><em>${esc(String(r.status||'').replaceAll('_',' ').toUpperCase())}</em>${action}</div>`;
  }).join('')}</div>`;
}
async function showServiceTruckInventoryCheck(){
  let card=document.getElementById('wlSvcTruckInventory');
  if(!card){card=document.createElement('div');card.id='wlSvcTruckInventory';card.className='card wl-service-simple-card';viewSvc().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading required truck inventory…');
  hideChildren(viewSvc(),[card]);resetWizardPosition();
  try{
    const r=await loadMyServiceTruckReadiness();
    if(!r.inspection_ready){
      card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← BACK</button><div class='wl-stop'><b>TRUCK / TRAILER INSPECTION REQUIRED FIRST</b><div>The permanent inventory check cannot replace the mandatory safety inspection.</div><button class='wl-service-start top10' data-wl-svc='inspect'>START INSPECTION</button></div>`;
      return resetWizardPosition();
    }
    const units=(r.units||[]).slice().sort((a,b)=>serviceTruckUnitOrder(a.equipment_type)-serviceTruckUnitOrder(b.equipment_type));
    const stock=r.stock||{};
    const sims=(r.sims||[]).slice().sort((a,b)=>Number(a.slot_no||0)-Number(b.slot_no||0));
    const unitRows=units.map(u=>{
      const ready=u.status==='assigned'&&u.unit_tag;
      return `<label class='wl-truck-unit-check ${ready?'':'missing'}'><input type='checkbox' data-wl-truck-unit-confirm='${esc(u.equipment_type)}' data-unit-tag='${esc(u.unit_tag||'')}' ${ready?'':'disabled'}><span><b>${esc(u.equipment_type)}</b><small>${ready?'Unit '+esc(u.unit_tag):u.status==='used_restock_due'?'USED — IT RESTOCK REQUIRED':'NO UNIT ASSIGNED — IT REQUIRED'}</small></span></label>`;
    }).join('');
    const simRows=sims.map(s=>{
      const ready=s.status==='assigned'&&s.sim_number;
      const detail=ready
        ? 'SIM '+esc(s.sim_number)
        : s.status==='used_restock_due'
          ? 'USED'+(s.sim_number?' · '+esc(s.sim_number):'')+(s.last_used_ticket_no?' · MHelpDesk #'+esc(s.last_used_ticket_no):'')
          : 'NO SIM ASSIGNED — IT REQUIRED';
      return `<label class='wl-truck-unit-check wl-truck-sim-check ${ready?'':'missing'}'><input type='checkbox' data-wl-truck-sim-confirm='${Number(s.slot_no||0)}' data-sim-number='${esc(s.sim_number||'')}' ${ready?'':'disabled'}><span><b>SIM SLOT ${Number(s.slot_no||0)}</b><small>${detail}</small></span></label>`;
    }).join('');
    card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← SERVICE HOME</button>
      ${progress('MANDATORY TRUCK INVENTORY','Required before leaving the shop',1,1)}
      <div class='wl-truck-required-banner'><b>THIS IS SEPARATE FROM THE SAFETY INSPECTION</b><span>Every work day, physically verify the 4 exact units, all 3 exact SIM numbers, and the required battery quantities before leaving the shop.</span></div>
      <div class='wl-truck-section-title'>PERMANENT UNITS · 4 REQUIRED</div>
      <div class='wl-truck-unit-grid'>${unitRows}</div>
      <div class='wl-truck-section-title'>SIM CARDS · 3 REQUIRED · VERIFY THE EXACT SIM NUMBER</div>
      <div class='wl-truck-unit-grid wl-truck-sim-grid'>${simRows}</div>
      <div class='wl-truck-section-title'>BATTERY STOCK · COUNT WHAT IS PHYSICALLY ON THE TRUCK</div>
      <div class='wl-truck-stock-grid'>
        <label><span>Recon batteries <b>25 required</b></span><input id='wlTruckReconQty' type='number' inputmode='numeric' min='0' value='${Number(stock.recon_battery_qty||0)}'></label>
        <label><span>AGM 12V 110Ah <b>4 required</b></span><input id='wlTruckAgmQty' type='number' inputmode='numeric' min='0' value='${Number(stock.agm_12v_110ah_qty||0)}'></label>
        <label><span>LiTime 12V 100Ah <b>2 required</b></span><input id='wlTruckLiTimeQty' type='number' inputmode='numeric' min='0' value='${Number(stock.litime_12v_100ah_qty||0)}'></label>
      </div>
      ${serviceTruckRestockRowsHtml(r)}
      <button class='wl-service-start top10' data-wl-submit-truck-inventory>I PHYSICALLY VERIFIED MY TRUCK →</button>
      <button class='wl-big wl-gray top8' data-wl-service-truck-refresh>REFRESH FROM IT</button>
      <div class='small top8'>New Service jobs remain blocked until the safety inspection AND this truck inventory check are both complete.</div>`;
    resetWizardPosition();
  }catch(error){
    card.innerHTML=techDashboardErrorHtml('service',error?.message||'Could not load permanent truck inventory.');
  }
}
async function submitServiceTruckInventoryCheck(){
  if(serviceTruckInventorySubmitting)return;
  const unitConfirmations={};
  document.querySelectorAll('[data-wl-truck-unit-confirm]').forEach(el=>{
    unitConfirmations[el.dataset.wlTruckUnitConfirm]={unit_tag:el.dataset.unitTag||'',confirmed:Boolean(el.checked)};
  });
  const simConfirmations={};
  document.querySelectorAll('[data-wl-truck-sim-confirm]').forEach(el=>{
    simConfirmations[String(el.dataset.wlTruckSimConfirm||'')]={sim_number:el.dataset.simNumber||'',confirmed:Boolean(el.checked)};
  });
  const recon=Number(document.getElementById('wlTruckReconQty')?.value);
  const agm=Number(document.getElementById('wlTruckAgmQty')?.value);
  const litime=Number(document.getElementById('wlTruckLiTimeQty')?.value);
  if(!Number.isFinite(recon)||!Number.isFinite(agm)||!Number.isFinite(litime))return alert('Enter the actual battery quantities physically on the truck.');
  const reconQty=Math.max(0,Math.floor(recon)),agmQty=Math.max(0,Math.floor(agm)),litimeQty=Math.max(0,Math.floor(litime));
  const attemptStartedAt=Date.now();
  const submitButton=document.querySelector('[data-wl-submit-truck-inventory]');
  serviceTruckInventorySubmitting=true;
  if(submitButton){submitButton.disabled=true;submitButton.textContent='VERIFYING TRUCK…';}
  document.body.classList.add('busy');
  const finishResult=async data=>{
    if(data?.inventory_ready){
      rememberTechCompletion('service','', 'TRUCK INVENTORY READY');
      return showSvcHome();
    }
    alert('TRUCK NOT READY TO LEAVE SHOP\n\nMissing items were sent to the IT restock queue. Accept the prepared replacements/restock, then physically recheck the truck.');
    return showServiceTruckInventoryCheck();
  };
  try{
    const {data,error}=await liveDb.rpc('submit_my_service_truck_inventory_check_v2',{
      p_unit_confirmations:unitConfirmations,
      p_sim_confirmations:simConfirmations,
      p_recon_battery_qty:reconQty,
      p_agm_12v_110ah_qty:agmQty,
      p_litime_12v_100ah_qty:litimeQty
    });
    if(error)throw error;
    return await finishResult(data);
  }catch(error){
    let confirmed=false;
    try{
      const {data:rows,error:verifyError}=await liveDb.from('service_truck_inventory_checks')
        .select('unit_confirmations,sim_confirmations,recon_battery_qty,agm_12v_110ah_qty,litime_12v_100ah_qty,submitted_at')
        .gte('submitted_at',new Date(attemptStartedAt-60000).toISOString())
        .order('submitted_at',{ascending:false})
        .limit(3);
      const sameUnit=(actual,expected)=>Object.keys(expected||{}).every(key=>
        String(actual?.[key]?.unit_tag||'')===String(expected?.[key]?.unit_tag||'')
        && Boolean(actual?.[key]?.confirmed)===Boolean(expected?.[key]?.confirmed)
      )&&Object.keys(actual||{}).length===Object.keys(expected||{}).length;
      const sameSim=(actual,expected)=>Object.keys(expected||{}).every(key=>
        String(actual?.[key]?.sim_number||'')===String(expected?.[key]?.sim_number||'')
        && Boolean(actual?.[key]?.confirmed)===Boolean(expected?.[key]?.confirmed)
      )&&Object.keys(actual||{}).length===Object.keys(expected||{}).length;
      if(!verifyError)confirmed=(rows||[]).some(row=>
        Number(row?.recon_battery_qty)===reconQty
        && Number(row?.agm_12v_110ah_qty)===agmQty
        && Number(row?.litime_12v_100ah_qty)===litimeQty
        && sameUnit(row?.unit_confirmations,unitConfirmations)
        && sameSim(row?.sim_confirmations,simConfirmations)
      );
    }catch{}
    if(confirmed){
      const readiness=await loadMyServiceTruckReadiness().catch(()=>null);
      if(readiness)return await finishResult(readiness);
      return alert('The truck inventory check was saved, but Tech Check could not reload readiness. Return to Service Home and refresh before starting a new job.');
    }
    return alert(error?.message==='Failed to fetch'
      ? 'Connection lost. Tech Check could not confirm that this truck inventory check saved. Reconnect and verify the truck again before starting a new job.'
      : (error?.message||'Could not save the truck inventory check.'));
  }finally{
    serviceTruckInventorySubmitting=false;
    document.body.classList.remove('busy');
    if(document.contains(submitButton)){submitButton.disabled=false;submitButton.textContent='I PHYSICALLY VERIFIED MY TRUCK →';}
  }
}
async function acceptServiceTruckRestock(id){
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('service_accept_truck_restock_v1',{p_request_id:id});
    if(error)throw error;
    alert('Restock received. Physically verify the truck again before leaving the shop.');
    return showServiceTruckInventoryCheck();
  }catch(error){alert(error?.message||'Could not accept the IT restock.');}
  finally{document.body.classList.remove('busy');}
}
async function showServiceTruckUsage(){
  let card=document.getElementById('wlSvcTruckUsage');
  if(!card){card=document.createElement('div');card.id='wlSvcTruckUsage';card.className='card wl-service-simple-card';viewSvc().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading permanent truck inventory…');
  hideChildren(viewSvc(),[card]);resetWizardPosition();
  try{
    const [r,assignments]=await Promise.all([loadMyServiceTruckReadiness(),myActiveAssignments('service')]);
    const active=(assignments||[]).filter(a=>a.status==='started');
    if(!active.length){
      card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← SERVICE HOME</button><div class='wl-stop'><b>NO ACTIVE SERVICE JOB</b><div>Open and start the MHelpDesk job before recording permanent truck inventory used.</div></div>`;
      return resetWizardPosition();
    }
    const ticketOptions=active.map(a=>`<option value='${esc(a.ticket_no)}'>#${esc(a.ticket_no)} · ${esc(a.site||'No site listed')}</option>`).join('');
    const unitOptions=(r.units||[]).filter(u=>u.status==='assigned'&&u.unit_tag).map(u=>`<option value='${esc(u.equipment_type)}'>${esc(u.equipment_type)} · Unit ${esc(u.unit_tag)}</option>`).join('');
    const simOptions=(r.sims||[]).filter(s=>s.status==='assigned'&&s.sim_number).sort((a,b)=>Number(a.slot_no)-Number(b.slot_no)).map(s=>`<option value='${Number(s.slot_no)}'>Slot ${Number(s.slot_no)} · SIM ${esc(s.sim_number)}</option>`).join('');
    card.innerHTML=`<button class='wl-back' data-wl-home='svc'>← SERVICE HOME</button>
      ${progress('PERMANENT TRUCK INVENTORY','Record anything used at a field job',1,1)}
      <div class='wl-stop'><b>USING A PERMANENT TRUCK ITEM MAKES THE TRUCK SHORT</b><div>You may finish the job already in progress, but another new field job is blocked until IT replenishes the truck and you recheck it.</div></div>
      <div class='wl-question top10'>
        <div class='qnum'>USED ONE OF MY 4 TRUCK UNITS</div>
        <label>MHelpDesk Ticket<select id='wlTruckUseUnitTicket'>${ticketOptions}</select></label>
        <label>Truck Unit<select id='wlTruckUseUnitType'><option value=''>Choose unit…</option>${unitOptions}</select></label>
        <label>OLD CUSTOMER / SITE UNIT COMING BACK<input id='wlTruckUseOldUnitTag' autocomplete='off' placeholder='Old unit tag'></label>
        <button class='wl-big wl-red top10' data-wl-service-record-truck-unit-used>RECORD UNIT USED + RETURN OLD UNIT →</button>
      </div>
      <div class='wl-question top10'>
        <div class='qnum'>USED ONE OF MY 3 TRUCK SIM CARDS</div>
        <label>MHelpDesk Ticket<select id='wlTruckUseSimTicket'>${ticketOptions}</select></label>
        <label>Exact SIM Used<select id='wlTruckUseSimSlot'><option value=''>Choose SIM…</option>${simOptions}</select></label>
        <button class='wl-big wl-red top10' data-wl-service-record-truck-sim-used>MARK SIM USED →</button>
        <div class='small top8'>The exact SIM number stays in history as USED and IT must give you a replacement before the truck is ready again.</div>
      </div>
      <div class='wl-question top10'>
        <div class='qnum'>USED TRUCK BATTERY STOCK</div>
        <label>MHelpDesk Ticket<select id='wlTruckUseStockTicket'>${ticketOptions}</select></label>
        <label>Stock Type<select id='wlTruckUseStockType'><option value='Recon Battery'>Recon Battery</option><option value='AGM 12V 110Ah'>AGM 12V 110Ah</option><option value='LiTime 12V 100Ah'>LiTime 12V 100Ah</option></select></label>
        <label>Quantity Used<input id='wlTruckUseStockQty' type='number' inputmode='numeric' min='1' value='1'></label>
        <button class='wl-big wl-red top10' data-wl-service-record-truck-stock-used>RECORD STOCK USED →</button>
      </div>`;
    resetWizardPosition();
  }catch(error){card.innerHTML=techDashboardErrorHtml('service',error?.message||'Could not load permanent truck inventory.');}
}
async function recordServiceTruckUnitUsed(){
  const ticket=document.getElementById('wlTruckUseUnitTicket')?.value||'';
  const type=document.getElementById('wlTruckUseUnitType')?.value||'';
  const oldTag=document.getElementById('wlTruckUseOldUnitTag')?.value.trim()||'';
  if(!ticket||!type||!oldTag)return alert('Choose the active MHelpDesk job, truck unit type, and enter the old unit coming back to IT.');
  document.body.classList.add('busy');
  try{
    const {data,error}=await liveDb.rpc('service_use_permanent_truck_unit_v1',{p_ticket_no:ticket,p_equipment_type:type,p_old_unit_tag:oldTag});
    if(error)throw error;
    alert(`Truck ${type} ${data?.used_unit_tag||''} recorded as USED.\n\nNow return old unit ${oldTag} through the normal Service Return → IT Intake flow. IT will then prepare your replacement truck unit.`);
    return showServiceReturnPreset(ticket,oldTag,type);
  }catch(error){alert(error?.message||'Could not record the permanent truck unit as used.');}
  finally{document.body.classList.remove('busy');}
}
async function recordServiceTruckSimUsed(){
  const ticket=document.getElementById('wlTruckUseSimTicket')?.value||'';
  const slot=Number(document.getElementById('wlTruckUseSimSlot')?.value||0);
  if(!ticket||![1,2,3].includes(slot))return alert('Choose the active MHelpDesk job and the exact SIM card you used.');
  document.body.classList.add('busy');
  try{
    const {data,error}=await liveDb.rpc('service_use_truck_sim_v1',{p_ticket_no:ticket,p_slot_no:slot});
    if(error)throw error;
    const used=(data?.sims||[]).find(s=>Number(s.slot_no)===slot);
    alert(`SIM ${used?.sim_number||''} recorded as USED. IT now has a replacement request for truck SIM slot ${slot}. Recheck the truck inventory after IT gives you the new SIM.`);
    return showSvcHome();
  }catch(error){alert(error?.message||'Could not record the truck SIM as used.');}
  finally{document.body.classList.remove('busy');}
}
async function recordServiceTruckStockUsed(){
  if(serviceTruckUsageSubmitting)return;
  const ticket=document.getElementById('wlTruckUseStockTicket')?.value||'';
  const type=document.getElementById('wlTruckUseStockType')?.value||'';
  const qty=Math.max(1,Math.floor(Number(document.getElementById('wlTruckUseStockQty')?.value||0)));
  const fieldByType={'Recon Battery':'recon_battery_qty','AGM 12V 110Ah':'agm_12v_110ah_qty','LiTime 12V 100Ah':'litime_12v_100ah_qty'};
  const field=fieldByType[type];
  if(!ticket||!field)return alert('Choose the active MHelpDesk job and the truck battery stock you used.');
  let before;
  try{
    const readiness=await loadMyServiceTruckReadiness();
    before=Number(readiness?.stock?.[field]);
  }catch(error){
    return alert(error?.message||'Could not verify current truck stock. Refresh before recording battery usage.');
  }
  if(!Number.isFinite(before))return alert('Could not verify the current truck battery quantity. Refresh before continuing.');
  if(before<qty)return alert('You cannot use more '+type+' than Tech Check currently records on the truck.');
  const button=document.querySelector('[data-wl-service-record-truck-stock-used]');
  serviceTruckUsageSubmitting=true;
  if(button){button.disabled=true;button.textContent='RECORDING USAGE…';}
  document.body.classList.add('busy');
  const finish=async()=>{
    alert('Truck stock usage recorded. IT restock is now required before the truck is ready for another new field job.');
    return showSvcHome();
  };
  try{
    const {error}=await liveDb.rpc('service_use_truck_stock_v1',{p_ticket_no:ticket,p_item_type:type,p_qty:qty});
    if(error)throw error;
    return await finish();
  }catch(error){
    let after=NaN;
    try{
      const readiness=await loadMyServiceTruckReadiness();
      after=Number(readiness?.stock?.[field]);
    }catch{}
    if(Number.isFinite(after)&&after===before-qty)return await finish();
    if(Number.isFinite(after)&&after!==before){
      return alert('Truck stock changed while Tech Check was saving this usage. The app will not subtract anything again. Return to Service Home, refresh the live truck inventory, and verify the physical quantity before recording another usage.');
    }
    return alert(error?.message==='Failed to fetch'
      ? 'Connection was interrupted and Tech Check could not confirm whether the battery usage saved. Do not tap again until the live truck inventory can be reloaded.'
      : (error?.message||'Could not record truck stock used.'));
  }finally{
    serviceTruckUsageSubmitting=false;
    document.body.classList.remove('busy');
    if(document.contains(button)){button.disabled=false;button.textContent='RECORD STOCK USED →';}
  }
}

async function loadITServiceTruckInventory(){
  const {data,error}=await liveDb.rpc('it_service_truck_inventory_v1');
  if(error)throw error;
  return Array.isArray(data)?data:[];
}

async function loadServiceTruckInventoryAudit(serviceTechId){
  const {data,error}=await liveDb.rpc('service_truck_inventory_audit_v1',{p_service_tech_id:serviceTechId||null});
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
function itTruckAuditHtml(rows){
  if(!rows?.length)return "<div class='small'>No inventory changes have been logged yet.</div>";
  return "<div class='wl-it-audit'>"+rows.slice(0,30).map(r=>{
    const before=r.before_value==null||r.before_value===''?'—':r.before_value;
    const after=r.after_value==null||r.after_value===''?'—':r.after_value;
    const who=r.actor_name||'System';
    const role=r.actor_role==='owner'?'Owner/Admin':r.actor_role==='it'?'IT Technician':r.actor_role||'System';
    return "<div class='wl-it-audit-row'><b>"+esc(String(r.action||'updated').toUpperCase())+" · "+esc(r.item_slot||r.item_kind)+"</b><span>"+esc(before)+" → "+esc(after)+"</span><em>"+esc(who)+" · "+esc(role)+" · "+new Date(r.created_at).toLocaleString()+"</em></div>";
  }).join('')+"</div>";
}
function itTruckInventoryCounts(row){
  const units=Array.isArray(row?.units)?row.units:[];
  const sims=Array.isArray(row?.sims)?row.sims:[];
  const stock=row?.stock||{};
  return {
    units:units.filter(x=>x.status==='assigned'&&x.unit_tag).length,
    sims:sims.filter(x=>x.status==='assigned'&&x.sim_number).length,
    recon:Number(stock.recon_battery_qty||0),
    agm:Number(stock.agm_12v_110ah_qty||0),
    litime:Number(stock.litime_12v_100ah_qty||0)
  };
}
function itTruckInventorySummaryHtml(row){
  const n=itTruckInventoryCounts(row),ready=Boolean(row.departure_ready);
  return `<article class='wl-it-truck-manage-row ${ready?'ready':'not-ready'}'>
    <div><span>SERVICE TRUCK</span><h3>${esc(row.service_tech_name||'Service Tech')}</h3><b>${ready?'READY TO LEAVE SHOP':'NOT READY'}</b></div>
    <div class='wl-it-truck-counts'><i>${n.units}/4 <small>UNITS</small></i><i>${n.sims}/3 <small>SIMs</small></i><i>${n.recon}/25 <small>RECON</small></i><i>${n.agm}/4 <small>AGM</small></i><i>${n.litime}/2 <small>LiTime</small></i></div>
    <button class='wl-it-start' data-wl-it-manage-truck='${esc(row.service_tech_id)}'>MANAGE / LOAD TRUCK →</button>
  </article>`;
}
async function showITServiceTruckInventory(){
  let card=document.getElementById('wlItTruckInventory');
  if(!card){card=document.createElement('div');card.id='wlItTruckInventory';card.className='card wl-it-simple-card';viewIT().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading permanent Service truck inventory…');
  hideChildren(viewIT(),[card]); resetWizardPosition();
  try{
    const rows=await loadITServiceTruckInventory();
    window.__wlItTruckInventoryRows=rows;
    card.innerHTML=`<button class='wl-back' data-wl-home='it'>← IT HOME</button>${progress('SERVICE TRUCKS','Permanent truck inventory',1,1)}
      <div class='wl-it-restock-banner'><b>IT LOADS / RESTOCKS · SERVICE VERIFIES / USES</b><span>IT is the only department that adds official permanent truck inventory. Any IT change forces Service to physically verify the truck again before departure.</span></div>
      <div class='wl-it-truck-manage-list'>${rows.length?rows.map(itTruckInventorySummaryHtml).join(''):`<div class='ok'><b>No active Service technicians.</b></div>`}</div>
      <button class='wl-big wl-gray top10' data-wl-it-truck-inventory>REFRESH TRUCKS</button>`;
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error?.message||'Could not load Service truck inventory.');}
}
function itTruckUnitLoadChecksHtml(){
  return `<div class='wl-it-restock-checks'>
    ${[['identity_ok','Exact unit / model verified'],['power_ok','Power / battery verified'],['functions_ok','Camera functions verified'],['programmed_online_ok','Programmed and online'],['sd_storage_ok','SD / storage verified'],['sim_monitoring_ok','SIM / monitoring verified'],['clean_safe_ok','Clean and safe for truck']].map(([key,label])=>`<label class='check'><input type='checkbox' data-wl-it-load-unit-check='${key}'><span>${label}</span></label>`).join('')}
  </div>`;
}
async function showITServiceTruckManager(serviceTechId){
  const rows=window.__wlItTruckInventoryRows||await loadITServiceTruckInventory();
  const row=rows.find(x=>String(x.service_tech_id)===String(serviceTechId));
  if(!row)return alert('Service truck not found. Refresh and try again.');
  const card=document.getElementById('wlItTruckInventory'); if(!card)return;
  const units=Array.isArray(row.units)?row.units:[],sims=Array.isArray(row.sims)?row.sims:[],stock=row.stock||{};
  const unitTypes=['Sniper','Ranger','Spotter','Solar Spotter'];
  let audit=[];
  try{audit=await loadServiceTruckInventoryAudit(serviceTechId)}catch(error){console.warn('Could not load truck inventory audit',error)}
  card.innerHTML=`<button class='wl-back' data-wl-it-truck-inventory>← SERVICE TRUCKS</button>${progress('MANAGE SERVICE TRUCK',row.service_tech_name||'Service Tech',1,1)}
    <div class='wl-it-restock-banner'><b>IT MAINTAINS THE OFFICIAL INVENTORY · SERVICE PHYSICALLY VERIFIES IT</b><span>IT can add, remove, or correct unit tags, exact SIM numbers, and battery counts. Every saved change records who changed it, what changed, and when. Any change forces Service to verify the truck again before departure.</span></div>
    <label class='top10'>Change note (optional)<input id='wlInventoryChangeNote' placeholder='Why are you changing this inventory?'></label>
    <div class='wl-it-truck-editor'>
      <div class='wl-truck-section-title'>PERMANENT UNITS · EXACT UNIT TAGS</div>
      <div class='small'>To assign or correct a unit, enter the exact tag and complete all 7 IT readiness checks below. To remove a unit from the truck, clear the tag and save.</div>
      ${unitTypes.map(type=>{const u=units.find(x=>x.equipment_type===type)||{};return `<div class='wl-it-load-line'><div><b>${esc(type)}</b><span>${u.unit_tag?'CURRENT · '+esc(u.unit_tag):'NOT ASSIGNED'}</span></div><input id='wlLoadUnit_${type.replaceAll(' ','_')}' placeholder='Exact unit tag — blank removes' value='${esc(u.unit_tag||'')}'><button data-wl-it-load-unit='${esc(type)}' data-service-tech='${esc(serviceTechId)}'>SAVE / CORRECT</button></div>`;}).join('')}
      <div id='wlItUnitLoadChecks'>${itTruckUnitLoadChecksHtml()}</div>
      <div class='wl-truck-section-title'>SIM CARDS · EXACT NUMBERS</div>
      ${[1,2,3].map(slot=>{const s=sims.find(x=>Number(x.slot_no)===slot)||{};return `<div class='wl-it-load-line'><div><b>SIM ${slot}</b><span>${s.sim_number?'CURRENT · '+esc(s.sim_number):'NOT ASSIGNED'}</span></div><input id='wlLoadSim_${slot}' inputmode='numeric' placeholder='Exact SIM number — blank removes' value='${esc(s.sim_number||'')}'><label class='wl-it-inline-verify'><input id='wlLoadSimVerified_${slot}' type='checkbox'> exact number verified</label><button data-wl-it-load-sim='${slot}' data-service-tech='${esc(serviceTechId)}'>SAVE / CORRECT</button></div>`;}).join('')}
      <div class='wl-truck-section-title'>BATTERY STOCK · SET THE EXACT PHYSICAL COUNT</div>
      ${[['Recon Battery','Recon Batteries',Number(stock.recon_battery_qty||0),25],['AGM 12V 110Ah','AGM 12V 110Ah',Number(stock.agm_12v_110ah_qty||0),4],['LiTime 12V 100Ah','LiTime 12V 100Ah',Number(stock.litime_12v_100ah_qty||0),2]].map(([type,label,qty,target],i)=>`<div class='wl-it-load-line'><div><b>${label}</b><span>CURRENT · ${qty} / ${target}</span></div><input id='wlLoadStock_${i}' type='number' min='0' inputmode='numeric' value='${qty}'><button data-wl-it-load-stock='${i}' data-stock-type='${esc(type)}' data-service-tech='${esc(serviceTechId)}'>SET EXACT COUNT</button></div>`).join('')}
    </div>
    <details class='wl-it-more top10' open><summary>INVENTORY CHANGE HISTORY · ${audit.length}</summary>${itTruckAuditHtml(audit)}</details>`;
}
window.showITServiceTruckInventory=showITServiceTruckInventory;
window.showITServiceTruckManager=showITServiceTruckManager;
async function refreshITTruckManager(serviceTechId){
  window.__wlItTruckInventoryRows=await loadITServiceTruckInventory();
  return showITServiceTruckManager(serviceTechId);
}
function itTruckAdjustmentChecks(){
  const checks={};
  document.querySelectorAll('[data-wl-it-load-unit-check]').forEach(x=>checks[x.dataset.wlItLoadUnitCheck]=Boolean(x.checked));
  return checks;
}
async function itLoadTruckUnit(serviceTechId,type){
  const input=document.getElementById('wlLoadUnit_'+String(type).replaceAll(' ','_'));
  const tag=input?.value.trim()||'';
  const checks=itTruckAdjustmentChecks();
  if(tag && (Object.values(checks).length!==7||Object.values(checks).some(v=>!v)))return alert('Complete all 7 IT readiness checks before assigning or correcting this unit.');
  if(!tag && !confirm('Remove the '+type+' from this Service truck inventory? Service will have to verify the truck again.'))return;
  const note=document.getElementById('wlInventoryChangeNote')?.value.trim()||'';
  try{
    const {error}=await liveDb.rpc('it_adjust_service_truck_inventory_v3',{
      p_service_tech_id:serviceTechId,p_kind:'unit',p_slot:type,p_value:tag,p_checks:checks,p_verified:false,p_note:note
    });
    if(error)throw error;
    alert(type+' inventory saved. Service must physically verify the truck again.');
    return refreshITTruckManager(serviceTechId);
  }catch(error){alert(error?.message||'Could not change truck unit.');}
}
async function itLoadTruckSim(serviceTechId,slot){
  const sim=document.getElementById('wlLoadSim_'+slot)?.value.trim()||'';
  const verified=Boolean(document.getElementById('wlLoadSimVerified_'+slot)?.checked);
  if(sim&&!verified)return alert('Physically verify the exact SIM number first.');
  if(!sim&&!confirm('Remove SIM '+slot+' from this Service truck inventory? Service will have to verify the truck again.'))return;
  const note=document.getElementById('wlInventoryChangeNote')?.value.trim()||'';
  try{
    const {error}=await liveDb.rpc('it_adjust_service_truck_inventory_v3',{
      p_service_tech_id:serviceTechId,p_kind:'sim',p_slot:String(slot),p_value:sim,p_checks:{},p_verified:verified,p_note:note
    });
    if(error)throw error;
    alert('SIM '+slot+' inventory saved. Service must verify the exact SIM again.');
    return refreshITTruckManager(serviceTechId);
  }catch(error){alert(error?.message||'Could not change truck SIM.');}
}
async function itAddTruckStock(serviceTechId,type,index){
  const raw=document.getElementById('wlLoadStock_'+index)?.value;
  const qty=Math.floor(Number(raw));
  if(!Number.isFinite(qty)||qty<0)return alert('Enter the exact physical quantity on the truck.');
  const note=document.getElementById('wlInventoryChangeNote')?.value.trim()||'';
  try{
    const {error}=await liveDb.rpc('it_adjust_service_truck_inventory_v3',{
      p_service_tech_id:serviceTechId,p_kind:'stock',p_slot:type,p_value:String(qty),p_checks:{},p_verified:true,p_note:note
    });
    if(error)throw error;
    alert(type+' count saved as '+qty+'. Service must recount the truck.');
    return refreshITTruckManager(serviceTechId);
  }catch(error){alert(error?.message||'Could not set truck stock count.');}
}

async function loadITTruckRestockQueue(){
  const {data,error}=await liveDb.rpc('get_it_service_truck_restock_queue_v1');
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
function itTruckUnitChecksHtml(id){
  const checks=[
    ['identity_ok','Exact unit tag + correct unit type verified'],
    ['power_ok','Power / battery system verified'],
    ['functions_ok','Core functions tested'],
    ['programmed_online_ok','Programmed and online'],
    ['sd_storage_ok','SD / storage ready where applicable'],
    ['sim_monitoring_ok','SIM / camera app / monitoring ready where applicable'],
    ['clean_safe_ok','Clean, safe, and physically ready for truck']
  ];
  return `<div class='wl-it-restock-checks'>${checks.map(([key,label])=>`<label class='check'><input type='checkbox' data-wl-it-restock-check='${esc(id)}' data-check-key='${key}'><span>${esc(label)}</span></label>`).join('')}</div>`;
}
async function showITTruckRestock(){
  let card=document.getElementById('wlItTruckRestock');
  if(!card){card=document.createElement('div');card.id='wlItTruckRestock';card.className='card wl-it-simple-card';viewIT().append(card);}
  card.innerHTML=techDashboardLoadingHtml('Loading Service truck restock queue…');
  hideChildren(viewIT(),[card]);resetWizardPosition();
  try{
    const rows=await loadITTruckRestockQueue();
    card.innerHTML=`<button class='wl-back' data-wl-home='it'>← IT HOME</button>${progress('SERVICE TRUCK RESTOCK','Permanent truck inventory',1,1)}
      <div class='wl-it-restock-banner'><b>SERVICE CANNOT LEAVE FOR A NEW JOB UNTIL THIS IS RESTORED</b><span>Unit replacements must be fully checked by IT before the Service Tech accepts them.</span></div>
      ${rows.length?rows.map(r=>{
        if(r.status==='awaiting_return')return `<div class='wl-it-restock-card waiting'><div class='qnum'>WAITING FOR OLD UNIT RETURN</div><h3>${esc(r.service_tech_name)} · ${esc(r.item_type)}</h3><div class='small'>Used truck unit: ${esc(r.used_unit_tag||'—')} · Old field unit: ${esc(r.old_unit_tag||'—')} · MHelpDesk #${esc(r.original_ticket_no||'—')}</div><div class='wl-stop top8'>Service must return the old unit through normal IT Intake before this replacement can be prepared.</div></div>`;
        if(r.status==='ready')return `<div class='wl-it-restock-card ready'><div class='qnum'>READY — WAITING FOR SERVICE ACCEPTANCE</div><h3>${esc(r.service_tech_name)} · ${esc(r.item_type)}</h3><div class='small'>${r.item_kind==='unit'?'Replacement Unit '+esc(r.replacement_unit_tag||'—'):r.item_kind==='sim'?'SIM '+esc(r.replacement_sim_number||'—')+' · Slot '+Number(r.sim_slot_no||0):esc(r.qty_issued||r.qty_needed)+' ready'}</div></div>`;
        if(r.item_kind==='sim')return `<div class='wl-it-restock-card'><div class='qnum'>SIM CARD RESTOCK</div><h3>${esc(r.service_tech_name)} · SIM SLOT ${Number(r.sim_slot_no||0)}</h3><div class='small'>${r.used_sim_number?'Used SIM '+esc(r.used_sim_number)+' · ':''}${r.original_ticket_no?'MHelpDesk #'+esc(r.original_ticket_no):'Initial 3-SIM truck assignment'}</div><label>Exact Replacement SIM Number<input id='wlItRestockSim_${esc(r.id)}' autocomplete='off' inputmode='numeric' placeholder='SIM number'></label><label class='check top8'><input type='checkbox' id='wlItRestockSimVerified_${esc(r.id)}'><span>I physically verified this exact SIM number</span></label><button class='wl-it-start top8' data-wl-it-ready-truck-sim='${esc(r.id)}'>SIM VERIFIED — READY FOR SERVICE →</button></div>`;
        if(r.item_kind==='battery')return `<div class='wl-it-restock-card'><div class='qnum'>BATTERY RESTOCK</div><h3>${esc(r.service_tech_name)} · ${esc(r.item_type)}</h3><div class='small'>Needs ${Number(r.qty_needed||0)} before leaving the shop.</div><label>Quantity IT is issuing<input id='wlItRestockQty_${esc(r.id)}' type='number' inputmode='numeric' min='${Number(r.qty_needed||1)}' value='${Number(r.qty_needed||1)}'></label><button class='wl-it-start top8' data-wl-it-ready-truck-battery='${esc(r.id)}'>MARK READY FOR SERVICE →</button></div>`;
        return `<div class='wl-it-restock-card'><div class='qnum'>UNIT RESTOCK</div><h3>${esc(r.service_tech_name)} · 1 × ${esc(r.item_type)}</h3><div class='small'>${r.old_unit_tag?'Old Unit '+esc(r.old_unit_tag)+' was turned in · ':''}${r.original_ticket_no?'MHelpDesk #'+esc(r.original_ticket_no):'Initial permanent truck assignment'}</div><label>Replacement ${esc(r.item_type)} Unit Tag<input id='wlItRestockUnit_${esc(r.id)}' autocomplete='off' placeholder='Unit tag'></label>${itTruckUnitChecksHtml(r.id)}<button class='wl-it-start top8' data-wl-it-ready-truck-unit='${esc(r.id)}'>UNIT CHECKED — READY FOR SERVICE →</button></div>`;
      }).join(''):`<div class='ok'><b>✓ No permanent Service truck restock is waiting on IT.</b></div>`}
      <button class='wl-big wl-gray top10' data-wl-it-truck-restock>REFRESH QUEUE</button>`;
    resetWizardPosition();
  }catch(error){card.innerHTML=techDashboardErrorHtml('it',error?.message||'Could not load Service truck restock queue.');}
}
async function prepareITTruckUnitRestock(id){
  const tag=document.getElementById('wlItRestockUnit_'+id)?.value.trim()||'';
  const checks={};
  document.querySelectorAll(`[data-wl-it-restock-check="${CSS.escape(id)}"]`).forEach(el=>checks[el.dataset.checkKey]=Boolean(el.checked));
  if(!tag)return alert('Enter the exact replacement unit tag.');
  if(Object.values(checks).some(v=>!v))return alert('Complete every IT readiness check before giving this permanent truck unit to Service.');
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('it_prepare_service_truck_unit_restock_v1',{p_request_id:id,p_replacement_unit_tag:tag,p_checks:checks});
    if(error)throw error;
    alert('Replacement unit is READY. The Service Tech must accept it, then physically recheck the truck before leaving.');
    return showITTruckRestock();
  }catch(error){alert(error?.message||'Could not prepare the replacement truck unit.');}
  finally{document.body.classList.remove('busy');}
}
async function prepareITTruckSimRestock(id){
  const sim=document.getElementById('wlItRestockSim_'+id)?.value.trim()||'';
  const verified=Boolean(document.getElementById('wlItRestockSimVerified_'+id)?.checked);
  if(!sim)return alert('Enter the exact replacement SIM number.');
  if(!verified)return alert('Physically verify the exact SIM number first.');
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('it_prepare_service_truck_sim_restock_v1',{
      p_request_id:id,
      p_replacement_sim_number:sim,
      p_number_verified:verified
    });
    if(error)throw error;
    alert('SIM is READY. The Service Tech must accept it and recheck the exact SIM number on the truck.');
    return showITTruckRestock();
  }catch(error){alert(error?.message||'Could not prepare the replacement SIM.');}
  finally{document.body.classList.remove('busy');}
}
async function prepareITTruckBatteryRestock(id){
  const qty=Math.max(0,Math.floor(Number(document.getElementById('wlItRestockQty_'+id)?.value||0)));
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('it_prepare_service_truck_battery_restock_v1',{p_request_id:id,p_qty_issued:qty});
    if(error)throw error;
    alert('Battery restock is READY for the Service Tech to accept.');
    return showITTruckRestock();
  }catch(error){alert(error?.message||'Could not prepare the truck battery restock.');}
  finally{document.body.classList.remove('busy');}
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
  home.innerHTML=techDashboardLoadingHtml('Checking your next Service action…');
  hideChildren(viewSvc(),[home]);
  resetWizardPosition();

  const ownerViewingService=roleText().includes('Owner/Admin');
  const techName=document.getElementById('whoName')?.textContent?.trim() || (ownerViewingService?'Service Technician':'Technician');
  const firstName=String(techName||'Technician').trim().split(/\s+/)[0] || 'Technician';

  try{
    const state=await techDashboardTimeout(serviceDayState(),null);
    const flash=takeTechCompletion('service');
    home.innerHTML=`<div class='wl-service-simple-shell'>
      <div class='wl-service-simple-kicker'>SERVICE TECH</div>
      <h1>HELLO, ${esc(ownerViewingService?'TECHNICIAN':firstName.toUpperCase())}</h1>
      ${techCompletionBanner(flash)}
      ${serviceNextActionHtml(state)}
      <div class='wl-service-flowline'>TRUCK / TRAILER INSPECTION <b>→</b> REQUIRED TRUCK INVENTORY <b>→</b> NEXT JOB <b>→</b> FIELD WORK</div>

      <details class='wl-service-more'>
        <summary>OTHER ACTIONS</summary>
        <div class='wl-service-more-grid'>
          <button data-wl-service-open-job>ENTER MHELPDESK TICKET</button>
          <button data-wl-service-truck-inventory>MY REQUIRED TRUCK INVENTORY</button>
          <button data-wl-service-truck-usage>USED TRUCK UNIT / SIM / STOCK</button>
          <button data-wl-service-return>RETURN UNIT TO IT</button>
          <button data-wl-svc='returns'>MY RETURNED UNITS</button>
          <button data-wl-offline-start>OFFLINE UNIT / CALL IT</button>
          <button data-wl-svc='history'>STATUS & HISTORY</button>
        </div>
      </details>
    </div>`;
  }catch(error){
    home.innerHTML=techDashboardErrorHtml('service',error?.message||'Could not verify your Service work.');
  }

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
async function serviceTakeVerifiedJob(id,enteredTicket=''){
  const {data:rows,error}=await liveDb.from('job_assignments').select('*').eq('id',id).eq('assigned_role','service').limit(1);
  if(error)return alert(error.message); const a=rows?.[0]; if(!a)return alert('This Service job is no longer available.');

  if(norm(enteredTicket)!==norm(a.ticket_no)){
    showServiceJobLookup();
    const msg=document.getElementById('wlServiceJobSearchMsg');
    if(msg)msg.innerHTML='<div class="wl-stop"><b>ENTER THE CURRENT MHELPDESK TICKET # TO OPEN THIS JOB.</b><div>Service must verify the ticket before Tech Check shows or starts the field task.</div></div>';
    return;
  }

  const gate=await assignmentGateState(a); if(!gate.ready)return alert(gate.label+'\n\n'+gate.detail);
  const tech=await currentTechIdentity().catch(()=>null); if(!tech?.id)return alert('Active Service Tech account required.');
  if(a.assignee_user_id&&a.assignee_user_id!==tech.id)return alert('This ticket has already been assigned to another Service Tech.');
  if(!a.assignee_user_id&&a.assignment_scope==='department'){
    const {error:claimError}=await liveDb.rpc('claim_my_department_assignment',{p_assignment_id:id});
    if(claimError)return alert(claimError.message||'Another Service Tech already claimed this ticket.');
    await sendTechWorkflowBroadcast('assignment_claimed',{assignment_id:id,role:'service',ticket_no:a.ticket_no});
  }
  return startAssignedJob(id,{serviceTicketVerified:true});
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
  svcSolarCursor = null;
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
  if(!activeSvcAssignment || norm(activeSvcAssignment.ticket_no)!==norm(activeSvcPrep.ticket_no)){
    const {data:assignmentRows}=await liveDb.from('job_assignments')
      .select('*')
      .eq('ticket_no',activeSvcPrep.ticket_no)
      .eq('assigned_role','service')
      .order('assigned_at',{ascending:false})
      .limit(1);
    if(assignmentRows?.[0])activeSvcAssignment=assignmentRows[0];
  }
  const assignment=activeSvcAssignment||{};
  const jobName=String(assignment.job_description||'').trim() || String(activeSvcPrep.site||'Service job').trim();
  const jobDate=serviceSummaryDate(assignment.scheduled_for);
  const jobTime=serviceSummaryTime(assignment.scheduled_time);
  const equipmentRows=[...(activeSvcPrep.prep_items||[])].sort((a,b)=>Number(a.item_order||0)-Number(b.item_order||0)).map(item=>{
    const type=equipmentDisplayLabel(item.equipment_type||'Equipment');
    const unit=String(item.unit_tag||'').trim();
    const preparedBatteries=Math.max(0,Number(item.battery_count||0));
    const batteryText=item.equipment_type==='Helios'
      ? (preparedBatteries||1)+' Helios battery box'+((preparedBatteries||1)===1?'':'es')
      : preparedBatteries>0 ? preparedBatteries+' prepared batter'+(preparedBatteries===1?'y':'ies') : '';
    return `<div class='wl-svc-summary-equipment'><b>${esc(type)}${unit?' · Unit '+esc(unit):''}</b>${batteryText?`<span>${esc(batteryText)}</span>`:''}</div>`;
  }).join('') || `<div class='wl-svc-summary-equipment'><b>${esc(equipmentManifestText(activeSvcPrep.equipment_manifest||[])||'Equipment not listed')}</b></div>`;
  const spareQty = spareUnits.length + spareBatteries.reduce((sum,row) => sum + Math.max(0,Number(row.qty_prepared || 0)),0);
  wizard.innerHTML = progress('Verify Ticket', 'Check the job before you start', 1, 1) + `<div class='wl-question wl-svc-ticket-brief'>
    <div class='wl-svc-summary-kicker'>MHELPDESK #${esc(activeSvcPrep.ticket_no)}</div>
    <div class='wl-svc-summary-grid'>
      <div><span>JOB</span><b>${esc(jobName)}</b></div>
      <div><span>DATE</span><b>${esc(jobDate)}</b></div>
      <div><span>TIME</span><b>${esc(jobTime)}</b></div>
      <div><span>SITE</span><b>${esc(assignment.site||activeSvcPrep.site||'Site not entered')}</b></div>
    </div>
    <div class='wl-svc-summary-label'>EQUIPMENT</div>
    <div class='wl-svc-summary-equipment-list'>${equipmentRows}</div>
    ${spareQty?`<div class='wl-svc-summary-extra'>Truck spares: <b>${spareQty}</b></div>`:''}
    <div class='qtext wl-svc-summary-question'>Is this the right ticket?</div>
    <div class='wl-options'><button class='fail' data-wl-svc-ticket='wrong'>NO — WRONG</button><button class='pass' data-wl-svc-ticket='match'>YES — CONTINUE</button></div>
    ${serviceRestartButtonHtml()}
  </div>`;
  resetWizardPosition();
}
function serviceSummaryDate(value){
  if(!value)return 'Date not set';
  const raw=String(value).slice(0,10);
  const d=new Date(raw+'T12:00:00');
  return Number.isNaN(d.getTime())?raw:new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(d);
}
function serviceSummaryTime(value){
  if(!value)return 'Time not set';
  const parts=String(value).split(':');
  const h=Number(parts[0]),m=Number(parts[1]||0);
  if(!Number.isFinite(h)||!Number.isFinite(m))return String(value);
  const d=new Date(2000,0,1,h,m,0);
  return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(d);
}
function serviceRestartButtonHtml(){
  return "<button class='wl-svc-restart-questions' data-wl-svc-restart-questions>START QUESTIONS OVER</button>";
}
async function restartServiceVerificationQuestions(){
  if(!activeSvcPrep?.id)return;
  const ok=confirm('Start the Service questions over?\n\nYour saved photos and signatures will stay. Your unit checks, battery counts, parts confirmation, and yes/no answers will reset.');
  if(!ok)return;
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('restart_service_verification_questions_v1',{p_prep_id:activeSvcPrep.id});
    if(error)throw error;
    const alibiReset=await liveDb.rpc('save_service_alibi_camera_check_v1',{p_prep_id:activeSvcPrep.id,p_value:false});
    if(alibiReset.error)throw alibiReset.error;
    activeSvcPrep=await getPrep(activeSvcPrep.id);
    const card=findSvcCard(activeSvcPrep.ticket_no);
    card?.querySelectorAll("input[id^='exact_'],input[id^='sbattok_']").forEach(input=>{input.checked=false;delete input.dataset.wlAnswered;});
    card?.querySelectorAll("input[id^='sbatt_']").forEach(input=>{input.value='';});
    svcUnitIndex=0;
    svcQuestionIndex=0;
    svcSolarCursor=null;
    return renderSvcPrep();
  }catch(error){
    return alert(error?.message||'Could not restart the Service questions.');
  }finally{
    document.body.classList.remove('busy');
  }
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
  if (serviceSolarEvidenceCount(evidence,'batteries','photo')<1) return false;
  if (!ctx.has_helios && serviceSolarEvidenceCount(evidence,'batteries','signature')<1) return false;
  if (serviceSolarEvidenceCount(evidence,'mppt','photo')<1) return false;
  if (ctx.has_helios) {
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
      ${ctx.has_helios?`<div class='wl-stop top10'><b>HELIOS YARD SOLAR TEST — BEFORE LEAVING</b><div>Take the IT-checked-out Helios outside to the Helios yard tower. Connect it to the tower solar panel before checking MPPT or Victron status.</div></div>
        <label class='check top8'><input id='wlSvcHeliosYardPvConnected' type='checkbox' ${check?.helios_yard_pv_connected_ok?'checked':''}><span>The Helios is outside and connected to the yard tower solar panel.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardSwitchPv' type='checkbox' ${check?.helios_yard_switch_pv_ok?'checked':''}><span>I flipped the internal Helios switch to PV.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardVictron' type='checkbox' ${check?.helios_yard_victron_bluetooth_ok?'checked':''}><span>I connected to the unit in the Victron Bluetooth app.</span></label>
        <label class='check top8'><input id='wlSvcMpptUpdated' type='checkbox' ${check?.mppt_updated_ok?'checked':''}><span>With yard solar connected, Victron shows the MPPT firmware / configuration is current.</span></label>
        <label class='check top8'><input id='wlSvcMpptTested' type='checkbox' ${check?.mppt_tested_ok?'checked':''}><span>With yard solar connected, the MPPT is powered and working correctly.</span></label>
        <label class='check top8'><input id='wlSvcCerboUpdated' type='checkbox' ${check?.cerbo_updated_ok?'checked':''}><span>Victron shows the Helios Cerbo / configuration is current.</span></label>
        <label class='check top8'><input id='wlSvcCerboOnline' type='checkbox' ${check?.cerbo_online_ok?'checked':''}><span>Helios Cerbo is online and communicating.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardStatus' type='checkbox' ${check?.helios_yard_updates_status_ok?'checked':''}><span>I verified Victron status / updates and the system is healthy.</span></label>
        <label class='check top8'><input id='wlSvcHeliosBatteryCharging' type='checkbox' ${check?.helios_battery_box_charging_ok?'checked':''}><span>The internal Helios battery box is present and charged.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardCharging' type='checkbox' ${check?.helios_yard_solar_charging_ok?'checked':''}><span>I verified solar charging from the tower panel.</span></label>
        <label class='check top8'><input id='wlSvcHeliosYardPtzWrapped' type='checkbox' ${check?.helios_yard_ptz_wrapped_ok?'checked':''}><span>I removed the PTZ from the door/front plate and bubble wrapped it for transport.</span></label>`:`
        <label class='check top8'><input id='wlSvcMpptUpdated' type='checkbox' ${check?.mppt_updated_ok?'checked':''}><span>MPPT firmware / configuration is updated and current.</span></label>
        <label class='check top8'><input id='wlSvcMpptTested' type='checkbox' ${check?.mppt_tested_ok?'checked':''}><span>MPPT was powered, tested, and is working.</span></label>`}
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

function servicePrimaryEquipmentLabel(){
  const items=[...(activeSvcPrep?.prep_items||[])].filter(item=>String(item?.purpose||'')!=='RETURN');
  const helios=items.find(item=>item?.equipment_type==='Helios');
  const item=helios||items[0]||null;
  if(!item)return 'EQUIPMENT';
  const type=equipmentDisplayLabel(item.equipment_type||'Equipment');
  const unit=String(item.unit_tag||'').trim();
  return (type+(unit?' '+unit:'')).trim();
}
function serviceSolarAnswerTasks(ctx,check) {
  const tasks=[];
  const spotters=Number(ctx?.solar_spotter_count||0);
  const rangers=Number(ctx?.ranger_count||0);
  const expectedPanels=Number(ctx?.expected_solar_panels||0);
  const requiredStands=serviceSolarRequiredStandCount(ctx);
  const standTags=serviceSolarStandTagsValue(check).split(/\n+/).map(function(v){return v.trim();}).filter(Boolean);
  const heliosOnly=Boolean(ctx?.has_helios)&&spotters===0&&rangers===0;
  if(ctx?.need_stand){
    tasks.push({
      key:'stand_tag',
      kind:'stand',
      title:'VERIFY SOLAR STAND',
      question:requiredStands===1?'Enter the exact Solar Stand tag.':'Enter the '+requiredStands+' exact Solar Stand tags — one per line.',
      value:serviceSolarStandTagsValue(check),
      requiredStands:requiredStands,
      done:Boolean(check?.stand_verified)&&standTags.length===requiredStands
    });
  }
  if(spotters>0){
    tasks.push({
      key:'battery_configuration',
      kind:'battery_config',
      title:'VERIFY BATTERY SETUP',
      question:'Which battery setup is physically installed on the Solar Stand?',
      done:['agm_4x_12v_110ah','single_12v_350ah'].includes(String(check?.battery_configuration||''))
    });
  }
  function addBool(field,title,question,done,extra){
    tasks.push({key:field,field:field,kind:'bool',title:title,question:question,done:done===undefined?Boolean(check?.[field]):Boolean(done),extra:extra||null});
  }
  if(ctx?.has_helios){
    const unitLabel=servicePrimaryEquipmentLabel();
    addBool('helios_yard_pv_connected_ok','HELIOS YARD TEST','Please connect '+unitLabel+' to the Helios tower and solar panel for testing.');
    addBool('helios_yard_switch_pv_ok','HELIOS YARD TEST','Did you flip the internal switch on '+unitLabel+' to PV?');
    addBool('helios_yard_victron_bluetooth_ok','HELIOS YARD TEST','Did you connect to the MPPT for '+unitLabel+' in the Victron Bluetooth app?');
    addBool(
      'mppt_tested_ok',
      'MPPT CHECK',
      'Does the Victron MPPT for '+unitLabel+' show the configuration is current and the MPPT is healthy?',
      Boolean(check?.mppt_updated_ok&&check?.mppt_tested_ok&&check?.helios_yard_updates_status_ok)
    );
    addBool(
      'helios_yard_solar_charging_ok',
      'CHARGING CHECK',
      'Does the MPPT show '+unitLabel+' is actively charging from the tower solar panel?',
      Boolean(check?.helios_yard_solar_charging_ok&&(!heliosOnly||check?.solar_charging_ok))
    );
    addBool(
      'helios_yard_alibi_visible_ok',
      'ALIBI CAMERA CHECK',
      'Can you see Helios Camera 1, Helios Camera 2, and Helios Camera 3 / PTZ for '+unitLabel+' in the Alibi app?'
    );
    addBool('helios_yard_ptz_wrapped_ok','TRANSPORT PREP','Did you remove the PTZ from '+unitLabel+' and bubble wrap it for transport?');
  }else{
    addBool('mppt_updated_ok','MPPT CHECK','Is the MPPT firmware / configuration updated and current?');
    addBool('mppt_tested_ok','MPPT CHECK','Is the MPPT powered, tested, and working?');
  }
  if(expectedPanels>0){
    addBool(
      'solar_panels_verified',
      'SOLAR PANEL CHECK',
      'Do you physically have exactly '+expectedPanels+' loose solar panel'+(expectedPanels===1?'':'s')+' for this job?',
      Boolean(check?.solar_panels_verified)&&Number(check?.solar_panel_count||0)===expectedPanels,
      {field:'solar_panel_count',value:String(expectedPanels)}
    );
  }
  if(!heliosOnly){
    addBool('batteries_charged_ok','BATTERY CHECK','Is the required battery / battery-box setup physically present and charged?');
    addBool('solar_charging_ok','CHARGING CHECK','Is the battery system actively charging through MPPT / PV?');
  }
  return tasks;
}
function serviceSolarProofTasks(ctx,evidence) {
  const tasks=[];
  const spotters=Math.max(1,Number(ctx?.solar_spotter_count||0));
  function addPhoto(category,title,question,required){
    required=required||1;
    tasks.push({key:category+':photo',kind:'photo',category:category,title:title,question:question,required:required,done:serviceSolarEvidenceCount(evidence,category,'photo')>=required});
  }
  function addSign(category,title,question){
    tasks.push({key:category+':signature',kind:'signature',category:category,title:title,question:question,required:1,done:serviceSolarEvidenceCount(evidence,category,'signature')>=1});
  }
  if(ctx?.need_stand){
    addPhoto('solar_stand','SOLAR STAND PHOTO',spotters===1?'Upload one clear photo of the exact Solar Stand tag.':'Upload '+spotters+' clear Solar Stand tag photos — one per stand.',spotters);
    addSign('solar_stand','SOLAR STAND SIGN-OFF','Sign to confirm the exact Solar Stand tag(s) were physically verified.');
  }
  addPhoto('batteries','BATTERY PHOTO','Upload one clear photo of the battery / battery-box setup.',1);
  if(!ctx?.has_helios) addSign('batteries','BATTERY SIGN-OFF','Sign to confirm you physically verified the battery / battery-box setup.');
  addPhoto(
    'mppt',
    'MPPT / CHARGING',
    ctx?.has_helios
      ? 'Upload one or more MPPT screenshots or photos showing the charging readings.'
      : 'Upload one or more photos showing the MPPT / charging readings while the system is actively charging.',
    1
  );
  if(ctx?.has_helios){
    addPhoto('helios_yard','HELIOS YARD TEST PHOTO','Upload one photo of the Helios connected to the Helios tower and solar panel for testing.',1);
    addSign('helios_yard','HELIOS YARD TEST SIGN-OFF','Sign to confirm you completed the Helios yard solar test and transport prep.');
  }
  return tasks;
}
function serviceSolarAnswersComplete(ctx,check){
  return serviceSolarAnswerTasks(ctx,check).every(function(task){return task.done;});
}
function serviceSolarSingleProofHtml(task,evidence,stepNo,total,reviewMode=false) {
  const count=serviceSolarEvidenceCount(evidence,task.category,task.kind);
  if(task.kind==='photo'){
    const allowsMultiple=task.category==='mppt'||task.category==='helios_install'||task.required>1;
    const multiple=allowsMultiple?' multiple':'';
    return "<div class='wl-question wl-solar-one-step'>"+
      "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
      "<div class='qtext'>"+esc(task.question)+"</div>"+
      "<div class='wl-solar-proof wl-solar-photo-card top10' data-solar-category='"+esc(task.category)+"' data-wl-solar-multi='"+(allowsMultiple?"1":"0")+"'>"+
        "<div class='wl-solar-proof-status'>"+(count?"✓ "+count+" saved":"PHOTO REQUIRED")+"</div>"+
        "<div class='wl-solar-photo-actions'>"+
          "<label class='wl-solar-photo-choice'><span>📷</span><b>TAKE PHOTO</b><input class='wl-solar-file wl-solar-file-hidden' type='file' accept='image/*' capture='environment'"+multiple+"></label>"+
          "<label class='wl-solar-photo-choice'><span>▣</span><b>PHOTO LIBRARY</b><input class='wl-solar-file wl-solar-file-hidden' type='file' accept='image/*'"+multiple+"></label>"+
        "</div>"+
        (allowsMultiple?"<div class='wl-solar-multi-note'>You can add multiple photos before saving.</div>":"")+
        "<div class='wl-solar-selected' data-wl-solar-selected>No photo selected yet.</div>"+
        "<div class='wl-solar-preview hidden' data-wl-solar-preview></div>"+
        (allowsMultiple?"<button class='wl-solar-clear-photos hidden' type='button' data-wl-solar-clear-photos>CLEAR SELECTED PHOTOS</button>":"")+
        "<button class='wl-big wl-blue wl-solar-save-photo' data-wl-solar-upload disabled>SAVE PHOTO"+(allowsMultiple?"S":"")+" →</button>"+
      "</div>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button>"+(reviewMode&&count>=Number(task.required||1)?"<button class='wl-next' data-wl-solar-review-next>NEXT →</button>":"<span></span>")+"</div>"+
    "</div>";
  }
  return "<div class='wl-question wl-solar-one-step'>"+
    "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
    "<div class='qtext'>"+esc(task.question)+"</div>"+
    "<div class='wl-solar-proof wl-solar-sign-card top10' data-solar-category='"+esc(task.category)+"'>"+
      "<div class='wl-solar-sign-label'>SIGN BELOW</div>"+
      "<div class='small'>Use your finger to sign inside the box.</div>"+
      "<div class='wl-sign'>"+
        "<canvas></canvas>"+
        "<div class='wl-solar-sign-actions'>"+
          "<button class='wl-prev' data-wl-solar-clear>CLEAR</button>"+
          "<button class='wl-next' data-wl-solar-save-sign>SAVE SIGNATURE →</button>"+
        "</div>"+
      "</div>"+
    "</div>"+
    "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button>"+(reviewMode&&count>=1?"<button class='wl-next' data-wl-solar-review-next>NEXT →</button>":"<span></span>")+"</div>"+
  "</div>";
}
function serviceSolarOneStepHtml(ctx,check,evidence,offset=0,totalOverride=null,forcedIndex=null) {
  const answerTasks=serviceSolarAnswerTasks(ctx,check);
  const proofTasks=serviceSolarProofTasks(ctx,evidence);
  const tasks=answerTasks.concat(proofTasks);
  const naturalIndex=tasks.findIndex(function(task){return !task.done;});
  const hasForced=Number.isInteger(forcedIndex);
  const index=hasForced ? forcedIndex : naturalIndex;
  if(index<0 || index>=tasks.length){
    return "<div class='wl-question wl-solar-one-step'>"+
      "<div class='qnum'>"+(ctx?.has_helios?'YARD TEST COMPLETE':'PRE-TRIP COMPLETE')+"</div>"+
      "<div class='qtext'>"+(ctx?.has_helios?'Helios yard solar testing and proof are complete.':'All required Service pre-trip checks and proof are complete.')+"</div>"+
      "<div class='ok top10'><b>✓ READY FOR THE NEXT STEP</b></div>"+
      "<button class='wl-big wl-complete-continue top10' data-wl-svc-next>CONTINUE →</button>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>"+
    "</div>";
  }
  const task=tasks[index],stepNo=offset+index+1,total=totalOverride||offset+tasks.length;
  if(task.kind==='stand'){
    const tagControl=task.requiredStands>1
      ? "<textarea id='wlSolarSingleStandTag' rows='4' placeholder='ONE TAG PER LINE'>"+esc(task.value||'')+"</textarea>"
      : "<input id='wlSolarSingleStandTag' value='"+esc(task.value||'')+"' placeholder='ENTER STAND TAG'>";
    return "<div class='wl-question wl-solar-one-step'>"+
      "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
      "<div class='qtext'>"+esc(task.question)+"</div>"+
      tagControl+
      "<button class='wl-big wl-blue top10' data-wl-solar-save-stand data-required='"+task.requiredStands+"'>SAVE & CONTINUE →</button>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>"+
    "</div>";
  }
  if(task.kind==='battery_config'){
    return "<div class='wl-question wl-solar-one-step'>"+
      "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
      "<div class='qtext'>"+esc(task.question)+"</div>"+
      "<div class='wl-options'>"+
        "<button class='pass' data-wl-solar-battery-config='agm_4x_12v_110ah'>4 × AGM 12V 110Ah</button>"+
        "<button class='pass' data-wl-solar-battery-config='single_12v_350ah'>1 × 12V 350Ah</button>"+
      "</div>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>"+
    "</div>";
  }
  if(task.kind==='bool'){
    const extra=task.extra
      ? " data-extra-field='"+esc(task.extra.field)+"' data-extra-value='"+esc(task.extra.value)+"'"
      : "";
    const heliosConnectStep=task.field==='helios_yard_pv_connected_ok';
    const yesLabel=heliosConnectStep?'CONNECTED':'YES';
    const noLabel=heliosConnectStep?'NOT CONNECTED':'NO';
    return "<div class='wl-question wl-solar-one-step'>"+
      "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
      "<div class='qtext'>"+esc(task.question)+"</div>"+
      "<div class='wl-options'>"+
        "<button class='fail' data-wl-solar-step-answer='no' data-field='"+esc(task.field)+"'>"+noLabel+"</button>"+
        "<button class='pass' data-wl-solar-step-answer='yes' data-field='"+esc(task.field)+"'"+extra+">"+yesLabel+"</button>"+
      "</div>"+
      "<div class='wl-solar-step-message'></div>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>"+
    "</div>";
  }
  return serviceSolarSingleProofHtml(task,evidence,stepNo,total,hasForced&&Boolean(task.done));
}
async function saveServiceSolarProgressField(field,value){
  if(!activeSvcPrep?.id)return false;
  document.body.classList.add('busy');
  const result=field==='helios_yard_alibi_visible_ok'
    ? await liveDb.rpc('save_service_alibi_camera_check_v1',{
        p_prep_id:activeSvcPrep.id,p_value:String(value)==='true'
      })
    : await liveDb.rpc('save_service_solar_progress_v1',{
        p_prep_id:activeSvcPrep.id,p_field:String(field),p_value:String(value)
      });
  document.body.classList.remove('busy');
  if(result.error){alert(result.error.message);return false;}
  return true;
}
async function maybeFinalizeServiceSolarProgress(){
  if(!activeSvcPrep?.id)return false;
  const ctx=await serviceSolarContextData(activeSvcPrep.id);
  const check=await loadServiceSolarCheck(activeSvcPrep.id);
  if(!serviceSolarAnswersComplete(ctx,check))return true;
  if(check?.completed_at)return true;
  document.body.classList.add('busy');
  const result=await liveDb.rpc('finalize_service_solar_progress_v1',{p_prep_id:activeSvcPrep.id});
  document.body.classList.remove('busy');
  if(result.error){alert(result.error.message);return false;}
  return true;
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
  if(ctx.has_helios){
    const requiredHeliosBeforeMppt=[
      ['wlSvcHeliosYardPvConnected','Take the Helios outside and connect it to the yard tower solar panel.'],
      ['wlSvcHeliosYardSwitchPv','Flip the internal switch to PV.'],
      ['wlSvcHeliosYardVictron','Connect to the Helios in the Victron Bluetooth app.']
    ];
    for(const [id,msg] of requiredHeliosBeforeMppt)if(!document.getElementById(id)?.checked)return alert(msg);
    if(!document.getElementById('wlSvcMpptUpdated')?.checked)return alert('Verify the MPPT firmware / configuration while the Helios is connected to yard solar.');
    if(!document.getElementById('wlSvcMpptTested')?.checked)return alert('Verify the MPPT is powered and working while the Helios is connected to yard solar.');
    const requiredHeliosAfterMppt=[
      ['wlSvcCerboUpdated','Verify the Helios Cerbo update / configuration.'],['wlSvcCerboOnline','Verify the Helios Cerbo is online.'],
      ['wlSvcHeliosYardStatus','Verify Victron status / updates.'],
      ['wlSvcHeliosBatteryCharging','Verify the internal Helios battery box is present and charged.'],['wlSvcHeliosYardCharging','Verify solar charging from the yard tower.'],
      ['wlSvcHeliosYardPtzWrapped','Remove the PTZ and bubble wrap it for transport.']
    ];
    for(const [id,msg] of requiredHeliosAfterMppt)if(!document.getElementById(id)?.checked)return alert(msg);
  }else{
    if(!document.getElementById('wlSvcMpptUpdated')?.checked)return alert('Verify the MPPT update / configuration.');
    if(!document.getElementById('wlSvcMpptTested')?.checked)return alert('Verify the MPPT test.');
  }
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
async function serviceEvidenceContentHash(file){
  if(!globalThis.crypto?.subtle)throw new Error('Secure evidence hashing is unavailable on this device. Reload Tech Check over HTTPS and try again.');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function uploadServiceSolarEvidence(prepId,category,kind,file) {
  const { data:{ session } }=await liveDb.auth.getSession();
  if (!session?.user?.id) throw new Error('Please sign in again.');
  const prepared=kind==='photo' ? await optimizeEvidencePhoto(file) : file;
  const ext=kind==='signature' ? 'png' : ((prepared.name || 'photo.jpg').split('.').pop() || 'jpg').toLowerCase();
  const hash=await serviceEvidenceContentHash(prepared);
  const path=`${session.user.id}/${prepId}/service-solar/${category}/${kind}-${hash}.${ext}`;
  const contentType=prepared.type || (kind==='signature'?'image/png':'image/jpeg');
  const { error:up }=await liveDb.storage.from(EVIDENCE_BUCKET).upload(path,prepared,{contentType,upsert:true});
  if (up) throw up;
  const original=kind==='signature' ? `${category}-signature.png` : `${category}-photo-${prepared.name || 'photo.jpg'}`;
  const { error:rec }=await liveDb.rpc('record_service_solar_evidence',{
    p_prep_id:prepId,p_category:category,p_kind:kind,p_storage_path:path,p_original_name:original
  });
  if(rec){
    const {data:recorded,error:verifyError}=await liveDb.from('service_solar_evidence')
      .select('id')
      .eq('storage_path',path)
      .maybeSingle();
    if(recorded?.id)return path;
    if(!verifyError)await liveDb.storage.from(EVIDENCE_BUCKET).remove([path]).catch(()=>null);
    if(verifyError)throw new Error('Connection was interrupted while saving Solar / Helios evidence. Tech Check could not safely verify the result. Reconnect and retry this same proof; the same photo will not be counted twice.');
    throw rec;
  }
  return path;
}
function svcQuestions(form) {
  const out = [];
  const exact = form.querySelector("input[id^='exact_']");
  const itemId=String(exact?.id||'').replace(/^exact_/,'');
  const item=(activeSvcPrep?.prep_items||[]).find(row=>String(row.id)===itemId)||null;
  const type=item?.equipment_type ? equipmentDisplayLabel(item.equipment_type) : '';
  const unit=String(item?.unit_tag||'').trim();
  const required=Math.max(0,Number(item?.required_battery_count||0));
  const prepared=Math.max(0,Number(item?.battery_count||0));
  const helios=item?.equipment_type==='Helios';
  if (exact) {
    if (exact.checked && !exact.dataset.wlAnswered) exact.dataset.wlAnswered = '1';
    out.push({
      kind:'bool',
      input:exact,
      item:item,
      label:item ? `Do you physically have ${type}${unit?' '+unit:''}?` : 'Do you physically have this exact unit?'
    });
  }
  const batt = form.querySelector("input[id^='sbatt_']");
  if (batt) out.push({
    kind:'number',
    input:batt,
    item:item,
    label:helios?'How many Helios battery boxes do you physically have?':'How many batteries / battery boxes are physically in hand?',
    note:helios?`IT prepared: ${prepared||required||1} Helios battery box${(prepared||required||1)===1?'':'es'} for ${type}${unit?' '+unit:''}.`:`IT prepared: ${prepared} · Required: ${required}`
  });
  const battOk = form.querySelector("input[id^='sbattok_']");
  if (battOk) {
    if (battOk.checked && !battOk.dataset.wlAnswered) battOk.dataset.wlAnswered = '1';
    const expected=prepared||required||1;
    out.push({
      kind:'bool',
      input:battOk,
      item:item,
      heliosBattery:helios,
      label:helios
        ? `Did you physically verify the ${expected} Helios battery box${expected===1?'':'es'} IT prepared ${expected===1?'is':'are'} present and charged?`
        : 'Did you physically count and verify the required batteries / battery box?'
    });
  }
  return out;
}
function svcQuestionHtml(q, index, total, displayStep=index+1, displayTotal=total) {
  if (q.kind === 'number') return `<div class='wl-question'><div class='qnum'>STEP ${displayStep} OF ${displayTotal}</div><div class='qtext'>${esc(q.label)}</div>${q.note?`<div class='wl-svc-question-note'>${esc(q.note)}</div>`:''}<input id='wlSvcCount' type='number' inputmode='numeric' min='${esc(q.input.min || '0')}' value='${esc(q.input.value || '')}' placeholder='ENTER COUNT'></div>`;
  const answered = q.input.dataset.wlAnswered === '1';
  const yes = answered && q.input.checked;
  const no = answered && !q.input.checked;
  return `<div class='wl-question wl-service-auto-bool'><div class='qnum'>STEP ${displayStep} OF ${displayTotal}</div><div class='qtext'>${esc(q.label)}</div><div class='wl-options'><button class='fail ${no ? 'on' : ''}' data-wl-svc-answer='no'>NO</button><button class='pass ${yes ? 'on' : ''}' data-wl-svc-answer='yes'>YES</button></div>${no ? `<div class='wl-stop'><b>STOP — FIX THIS FIRST.</b><div>When the problem is corrected, tap YES. You cannot continue with this job while this answer is NO.</div></div>` : ''}</div>`;
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
    const actual=Number(value);
    const expected=Number(q.item?.battery_count||0);
    if(q.item && expected>=0 && actual!==expected){
      const label=q.item.equipment_type==='Helios'?'Helios battery box count':'battery count';
      return alert('The '+label+' does not match what IT prepared. IT prepared '+expected+'. Physically verify the handoff before continuing.');
    }
    q.input.value = value;
  }
  if (svcQuestionIndex < questions.length - 1) svcQuestionIndex++;
  else { svcUnitIndex++; svcQuestionIndex = 0; }
  return renderSvcPrep();
}

function serviceAIEquipmentReview(ctx,check,evidence){
  const flags=[], spotters=Number(ctx?.solar_spotter_count||0), rangers=Number(ctx?.ranger_count||0), panels=Number(ctx?.expected_solar_panels||0);
  const batteryPlan=serviceSolarBatteryPlan(ctx,check);
  const standPhotos=serviceSolarEvidenceCount(evidence,'solar_stand','photo'), batteryPhotos=serviceSolarEvidenceCount(evidence,'batteries','photo'), mpptPhotos=serviceSolarEvidenceCount(evidence,'mppt','photo'), heliosPhotos=serviceSolarEvidenceCount(evidence,'helios_yard','photo');
  if(spotters){
    if(!['agm_4x_12v_110ah','single_12v_350ah'].includes(String(check?.battery_configuration||'')))flags.push('Select the Solar Spotter battery setup actually installed on the stand.');
    if(Number(ctx?.need_stand)&&standPhotos<Math.max(1,spotters))flags.push('Solar Stand tag/photo proof is incomplete.');
    if(batteryPhotos<1)flags.push('Battery photo proof is missing.');
    if(mpptPhotos<1)flags.push('MPPT / live solar charging reading photo is missing.');
  }
  if(rangers){if(panels<rangers)flags.push('Ranger plan expects at least '+rangers+' solar panel'+(rangers===1?'':'s')+' — one per Ranger.');if(batteryPhotos<1)flags.push('Ranger battery photo proof is missing.');if(mpptPhotos<1)flags.push('Ranger MPPT / charging proof photo is missing.');}
  if(ctx?.has_helios){if(!check?.helios_battery_box_charging_ok)flags.push('Helios battery-box charging verification is incomplete.');if(mpptPhotos<1)flags.push('Helios MPPT screenshot / charging photo is missing.');if(heliosPhotos<1)flags.push('Helios yard-test photo is missing.');}
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
  return `<div class='wl-ai-panel wl-ai-final ${ready?'wl-ai-ready':'wl-ai-hold'}'><div class='wl-ai-head'>${onsiteVisionTitle('Service Handoff Check')}<b>${ready?'AI READY':'HOLD — '+holds.length+' ISSUE'+(holds.length===1?'':'S')}</b></div>${ready?`<div class='wl-ai-good'><b>✓ Handoff record ready.</b><br>IT-to-Service handoff evidence, Service checks, parts, signatures, and required solar pre-trip checks are complete in the stored record.</div>`:`<div class='wl-ai-warn'>${holds.map(v=>'⛔ '+esc(v)).join('<br>')}</div>`}<div class='small top8'>This confirms the handoff record only. The Helios is not deployed until Service completes the field-install steps at the site.</div></div>`;
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
  svcHeliosFieldCursor=null;
  alert('Helios handoff accepted. Next: complete the field installation one step at a time. The unit is NOT deployed until the site steps are finished.');
  return renderSvcPrep();
}
async function startHeliosOldUnitReturn(){
  if(!activeSvcPrep?.ticket_no)return;
  serviceReturn={step:1,ticket:String(activeSvcPrep.ticket_no),unit:'',type:'Helios',notes:'',photo:null,conditionPhotos:[],damagePhotos:[],knownUnits:[]};
  serviceReturnRecovered=false; await saveServiceReturnDraft(); return renderServiceReturn();
}
function heliosFieldRuleList(){
  return window.TechCheckRules?.heliosFieldChecklist || [
    {key:'helios_field_box_mounted_ok',rpc_param:'p_box_mounted_ok',label:'Is the Helios box installed and secured on the tower?'},
    {key:'helios_field_pv_connected_ok',rpc_param:'p_pv_connected_ok',label:'Are the PV cables connected?'},
    {key:'helios_field_ptz_secured_ok',rpc_param:'p_ptz_secured_ok',label:'Is the PTZ reinstalled and secured on the removable front plate?'},
    {key:'helios_field_switch_pv_ok',rpc_param:'p_switch_pv_ok',label:'Is the internal switch flipped to PV?'},
    {key:'helios_field_unit_battery_on_ok',rpc_param:'p_unit_battery_on_ok',label:'Are the Helios unit and battery turned on?'},
    {key:'helios_field_it_online_verified_ok',rpc_param:'p_it_online_verified_ok',label:'Did you call IT and have IT verify the Helios is online?'},
    {key:'helios_field_cameras_aimed_ok',rpc_param:'p_cameras_aimed_ok',label:'Did you complete camera aim / focus with IT?'},
    {key:'helios_field_panel_45deg_ok',rpc_param:'p_panel_45deg_ok',label:'Is the solar panel set to approximately 45°?'},
    {key:'helios_field_panel_bolt_ok',rpc_param:'p_panel_bolt_ok',label:'Is the separate panel angle / locking bolt installed and secured?'},
    {key:'helios_field_tower_20ft_ok',rpc_param:'p_tower_20ft_ok',label:'Is the tower cranked to approximately 20 feet?'},
    {key:'helios_field_mast_lock_bolt_ok',rpc_param:'p_mast_lock_bolt_ok',label:'Is the separate tower mast locking bolt inserted and secured?'},
    {key:'helios_field_recording_ok',rpc_param:'p_recording_ok',label:'After the tower is raised and locked, did IT verify recording after the final camera aim?'},
    {key:'helios_field_4_sandbags_ok',rpc_param:'p_4_sandbags_ok',label:'Are 4 bags of sand placed on the tower base?'}
  ];
}
function heliosFieldUnitLabel(units){
  const unit=units?.[0];
  const tag=String(unit?.unit_tag||'').trim();
  return tag ? 'Helios '+tag : 'Helios';
}
function heliosFieldTaskIndex(check,evidence,units){
  const rules=heliosFieldRuleList();
  const firstRule=rules.findIndex(rule=>check?.[rule.key]!==true);
  if(firstRule>=0)return firstRule;
  const photoCount=serviceSolarEvidenceCount(evidence,'helios_install','photo');
  if(photoCount<Math.max(1,units.length))return rules.length;
  if(serviceSolarEvidenceCount(evidence,'helios_install','signature')<1)return rules.length+1;
  return rules.length+2;
}
function heliosFieldPhotoStepHtml(evidence,units,stepNo,total){
  const count=serviceSolarEvidenceCount(evidence,'helios_install','photo');
  const required=Math.max(1,units.length);
  const saved=(evidence||[]).filter(row=>row.category==='helios_install'&&row.kind==='photo');
  return "<div class='wl-question wl-helios-field-step'>"+
    "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
    "<div class='qtext'>Take final installation photos showing the Helios, raised tower, mast lock bolt, solar-panel position / locking bolt, and sandbags.</div>"+
    "<div class='wl-solar-proof wl-solar-photo-card top10' data-solar-category='helios_install' data-wl-solar-multi='1'>"+
      "<div class='wl-solar-proof-status'>"+(count?"✓ "+count+" saved":"PHOTO REQUIRED")+"</div>"+
      (saved.length?"<div class='wl-gallery'>"+saved.map(p=>"<img src='"+esc(p.url)+"' alt='Saved Helios installation photo'>").join('')+"</div>":"")+
      "<div class='wl-solar-photo-actions'>"+
        "<label class='wl-solar-photo-choice'><span>📷</span><b>TAKE PHOTO</b><input class='wl-solar-file wl-solar-file-hidden' type='file' accept='image/*' capture='environment'></label>"+
        "<label class='wl-solar-photo-choice'><span>▣</span><b>PHOTO LIBRARY</b><input class='wl-solar-file wl-solar-file-hidden' type='file' accept='image/*' multiple></label>"+
      "</div>"+
      "<div class='wl-solar-multi-note'>Add as many site photos as you need. At least "+required+" photo"+(required===1?" is":"s are")+" required.</div>"+
      "<div class='wl-solar-selected' data-wl-solar-selected>No new photo selected yet.</div>"+
      "<div class='wl-solar-preview hidden' data-wl-solar-preview></div>"+
      "<button class='wl-solar-clear-photos hidden' type='button' data-wl-solar-clear-photos>CLEAR SELECTED PHOTOS</button>"+
      "<button class='wl-big wl-red wl-solar-save-photo' data-wl-solar-upload disabled>SAVE PHOTOS →</button>"+
    "</div>"+
    "<div class='wl-nav'><button class='wl-prev' data-wl-helios-field-prev>Back</button>"+(count>=required?"<button class='wl-next' data-wl-helios-field-next>NEXT →</button>":"<span></span>")+"</div>"+
  "</div>";
}
function heliosFieldSignatureStepHtml(evidence,stepNo,total){
  const sig=[...(evidence||[])].reverse().find(row=>row.category==='helios_install'&&row.kind==='signature');
  if(sig){
    return "<div class='wl-question wl-helios-field-step'>"+
      "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
      "<div class='qtext'>Sign to confirm you completed the Helios field installation checks in order.</div>"+
      "<div class='ok top10'><b>✓ SIGNATURE SAVED</b><div class='small'>"+signatureStamp(sig.created_by_name||'Service Tech',sig.created_at)+"</div></div>"+
      "<div class='wl-nav'><button class='wl-prev' data-wl-helios-field-prev>Back</button><button class='wl-next' data-wl-helios-field-next>NEXT →</button></div>"+
    "</div>";
  }
  return "<div class='wl-question wl-helios-field-step'>"+
    "<div class='qnum'>STEP "+stepNo+" OF "+total+"</div>"+
    "<div class='qtext'>Sign to confirm you completed the Helios field installation checks in order.</div>"+
    "<div class='wl-solar-proof wl-solar-sign-card top10' data-solar-category='helios_install'>"+
      "<div class='wl-solar-sign-label'>SIGN BELOW</div>"+
      "<div class='small'>Use your finger to sign inside the box.</div>"+
      "<div class='wl-sign'><canvas></canvas><div class='wl-solar-sign-actions'><button class='wl-prev' data-wl-solar-clear>CLEAR</button><button class='wl-next' data-wl-solar-save-sign>SAVE SIGNATURE →</button></div></div>"+
    "</div>"+
    "<div class='wl-nav'><button class='wl-prev' data-wl-helios-field-prev>Back</button><span></span></div>"+
  "</div>";
}
async function saveHeliosFieldCheckAnswer(field,value){
  if(!activeSvcPrep?.id)return false;
  document.body.classList.add('busy');
  try{
    const {error}=await liveDb.rpc('save_service_helios_field_check_v1',{p_prep_id:activeSvcPrep.id,p_field:String(field),p_value:Boolean(value)});
    if(error)throw error;
    return true;
  }catch(error){
    alert(error?.message||'Could not save the Helios field-install check.');
    return false;
  }finally{
    document.body.classList.remove('busy');
  }
}
function heliosFieldProgress(kicker,title,step,total){
  return progress(kicker,title,step,total).replace("class='wl-head'","class='wl-head wl-helios-field-head'");
}
function serviceHeliosFieldInstallHtml(prep,check,evidence,returns){
  const units=heliosFieldItems(prep),swaps=units.filter(x=>x.purpose==='SWAP');
  const unitLabel=heliosFieldUnitLabel(units);
  const rules=heliosFieldRuleList();
  const total=rules.length+2;
  const submitted=Boolean(check?.helios_field_completed_at);
  const operationsDone=Boolean(check?.helios_owner_verified_at);
  const replacementKeys=new Set(allSwapItems(prep).map(i=>norm(i.unit_tag)).filter(Boolean));
  const returnRows=(returns||[]).filter(r=>r.equipment_type==='Helios'&&!replacementKeys.has(norm(r.unit_tag)));
  const newUnits=units.map(x=>"<div class='wl-field-unit'><b>"+esc(x.purpose)+" · "+esc(x.equipment_type)+" "+esc(x.unit_tag||'Tag missing')+"</b><span>"+(check?.handoff_accepted_at?signatureStamp(check.handoff_accepted_by_name||'Service Tech',check.handoff_accepted_at):'Handoff accepted')+"</span></div>").join('');
  const oldBlock=swaps.length&&returnRows.length<swaps.length
    ? "<div class='wl-stop top10'><b>OLD UNIT RETURN STILL REQUIRED</b><div>For an installed Helios swap, document the old Helios through Service Return → IT Intake before final submission.</div><button class='wl-big wl-red top10' data-wl-helios-old-return>DOCUMENT OLD UNIT RETURN →</button></div>"
    : "";

  if(operationsDone){
    return heliosFieldProgress('HELIOS FIELD INSTALL','Operations Manager verification complete',total,total)+
      "<div class='ok wl-field-status'><b>✓ OPERATIONS MANAGER VERIFIED</b><div class='small'>"+signatureStamp(check.helios_owner_verified_by_name||'Operations Manager',check.helios_owner_verified_at)+"</div></div>"+
      newUnits+"<div class='wl-nav'><button class='wl-prev' data-wl-home='svc'>← SERVICE HOME</button><span></span></div>";
  }
  if(submitted){
    return heliosFieldProgress('HELIOS FIELD INSTALL','Submitted to Operations Manager',total,total)+
      "<div class='warn wl-field-status'><b>FIELD INSTALL SUBMITTED</b><div>Waiting for Operations Manager final verification.</div><div class='small top8'>"+signatureStamp(check.helios_field_completed_by_name||'Service Tech',check.helios_field_completed_at)+"</div></div>"+
      newUnits+"<div class='wl-nav'><button class='wl-prev' data-wl-home='svc'>← SERVICE HOME</button><span></span></div>";
  }

  const naturalIndex=heliosFieldTaskIndex(check,evidence,units);
  let index=Number.isInteger(svcHeliosFieldCursor)?svcHeliosFieldCursor:naturalIndex;
  index=Math.max(0,Math.min(total,index));
  const header=heliosFieldProgress('HELIOS FIELD INSTALL',unitLabel+' · Complete one step at a time',Math.min(total,index+1),total);
  const context="<div class='wl-field-context'><b>"+esc(unitLabel)+" · MHelpDesk #"+esc(prep.ticket_no)+"</b><span>Follow each site step in order. Tap YES only after it is physically complete. Tap NO to stop and correct it before continuing.</span></div>"+newUnits+oldBlock;

  if(index<rules.length){
    const rule=rules[index];
    const yes=check?.[rule.key]===true;
    return header+context+
      "<div class='wl-question wl-helios-field-step'>"+
        "<div class='qnum'>STEP "+(index+1)+" OF "+total+"</div>"+
        "<div class='qtext'>"+esc(rule.label)+"</div>"+
        "<div class='wl-options'><button class='fail' data-wl-helios-field-answer='no' data-field='"+esc(rule.key)+"'>NO</button><button class='pass "+(yes?"on":"")+"' data-wl-helios-field-answer='yes' data-field='"+esc(rule.key)+"'>YES</button></div>"+
        "<div class='wl-helios-field-message'></div>"+
        "<div class='wl-nav'>"+(index>0?"<button class='wl-prev' data-wl-helios-field-prev>Back</button>":"<button class='wl-prev' data-wl-home='svc'>Service Home</button>")+"<span></span></div>"+
      "</div>";
  }
  if(index===rules.length)return header+context+heliosFieldPhotoStepHtml(evidence,units,index+1,total);
  if(index===rules.length+1)return header+context+heliosFieldSignatureStepHtml(evidence,index+1,total);

  return heliosFieldProgress('HELIOS FIELD INSTALL',unitLabel+' · Ready to submit',total,total)+context+
    "<div class='ok wl-field-status'><b>✓ FIELD INSTALLATION COMPLETE</b><div>All ordered site checks, installation photos, and the Service signature are saved.</div></div>"+
    "<button class='wl-big wl-red top10' data-wl-submit-helios-field>SUBMIT TO OPERATIONS MANAGER →</button>"+
    "<div class='wl-nav'><button class='wl-prev' data-wl-helios-field-prev>Back</button><span></span></div>";
}
async function submitHeliosFieldInstall(){
  if(!activeSvcPrep?.id)return;
  const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id),units=heliosFieldItems(activeSvcPrep);
  const swapState=await swapWorkflowState(activeSvcPrep);
  if(swapState.undecided.length)return alert('Answer YES or NO for every Helios SWAP replacement first.');
  if(swapState.missingOld.some(x=>x.type==='Helios'))return alert('Document every OLD Helios unit returning through Service Return → IT Intake first.');
  if(serviceSolarEvidenceCount(evidence,'helios_install','photo')<units.length)return alert('Upload at least one final installation photo for each Helios.');
  if(serviceSolarEvidenceCount(evidence,'helios_install','signature')<1)return alert('Save the Service installation signature.');
  const check=await loadServiceSolarCheck(activeSvcPrep.id);
  const fieldRules=heliosFieldRuleList();
  if(fieldRules.some(rule=>check?.[rule.key]!==true))return alert('Complete every Helios field installation question in order before submitting.');
  const fieldPayload={p_prep_id:activeSvcPrep.id};
  fieldRules.forEach(rule=>{fieldPayload[rule.rpc_param]=true;});
  const {error}=await liveDb.rpc('save_my_helios_field_install_v1',fieldPayload);
  if(error)return alert(String(error.message||'Could not submit the field install.').replace(/Owner/g,'Operations Manager'));
  activeSvcPrep=await getPrep(activeSvcPrep.id);
  svcHeliosFieldCursor=null;
  alert('Helios field installation submitted to the Operations Manager for final verification.');
  return renderSvcPrep();
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
    return `${progress('Swap Result','One simple field decision',1,1)}<div class='wl-review'><b>MHelpDesk #${esc(prep.ticket_no)}</b><div class='small'>Replacement unit: ${esc(undecided.equipment_type)} ${esc(undecided.unit_tag||'Tag missing')} · Site: ${esc(site)}</div></div>${resolved}<div class='wl-question top10'><div class='qtext'>Did you actually install/use replacement ${esc(undecided.equipment_type)} ${esc(undecided.unit_tag||'')} at ${esc(site)}?</div><div class='wl-options'><button class='fail' data-wl-swap-unused='${esc(undecided.id)}'>NO — DID NOT USE IT</button><button class='pass' data-wl-swap-used='${esc(undecided.id)}'>YES — SWAP HAPPENED</button></div><div class='wl-note'>YES: replacement stays at the site, IT gets a site-registration task, and the OLD unit must return through IT Intake.<br>NO: this unused replacement automatically goes back through IT Intake.</div></div>`;
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
  let solarCheck=solarRequired?await loadServiceSolarCheck(activeSvcPrep.id):null; const solarEvidence=solarRequired?await serviceSolarEvidenceRows(activeSvcPrep.id):[]; const solarReady=serviceSolarReady(solarCtx,solarCheck,solarEvidence);
  const swapState=await swapWorkflowState(activeSvcPrep);
  const allSwaps=swapState.swaps,nonHeliosSwaps=allSwaps.filter(i=>i.equipment_type!=='Helios'),heliosHandoff=heliosHandoffItems(activeSvcPrep),heliosField=heliosFieldItems(activeSvcPrep),rangerField=rangerFieldItems(activeSvcPrep);
  const partStep=forms.length,solarStep=forms.length+(hasParts?1:0),proofStep=solarStep+(solarRequired?1:0),photoStep=proofStep+1,signStep=proofStep+2,swapStep=signStep+1,rangerStep=swapStep+(nonHeliosSwaps.length?1:0),preparedBy=activeSvcPrep.released_by_name||'IT Technician';
  const unitQuestionCounts=forms.map(form=>svcQuestions(form).length);
  const unitQuestionTotal=unitQuestionCounts.reduce((sum,n)=>sum+n,0);
  const solarTaskTotal=solarRequired
    ? serviceSolarAnswerTasks(solarCtx,solarCheck).length+serviceSolarProofTasks(solarCtx,solarEvidence).length
    : 0;
  const combinedCheckTotal=Math.max(1,unitQuestionTotal+(hasParts?1:0)+solarTaskTotal);
  const combinedCheckTitle=(servicePrimaryEquipmentLabel()+' SERVICE CHECK').toUpperCase();
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
    const questions=svcQuestions(forms[svcUnitIndex]),q=questions[svcQuestionIndex],afterLast=hasParts?'Next Check →':solarRequired?'Next Check →':'Compare IT Photos →';
    const completedBefore=unitQuestionCounts.slice(0,svcUnitIndex).reduce((sum,n)=>sum+n,0);
    const overallStep=completedBefore+svcQuestionIndex+1;
    wizard.innerHTML=progress(combinedCheckTitle,'One step at a time',overallStep,combinedCheckTotal)+(q?svcQuestionHtml(q,svcQuestionIndex,questions.length,overallStep,combinedCheckTotal):`<div class='ok'><b>This unit has no additional checks.</b></div>`)+`<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next>${svcQuestionIndex===questions.length-1?(svcUnitIndex===forms.length-1?afterLast:'Next Unit →'):'Next →'}</button></div>`+serviceRestartButtonHtml();
  }else if(hasParts&&svcUnitIndex===partStep){
    const confirmed=Boolean(activeSvcPrep.service_parts_confirmed),overallStep=unitQuestionTotal+1;
    wizard.innerHTML=progress(combinedCheckTitle,'One step at a time',overallStep,combinedCheckTotal)+`<div class='wl-review'><b>Physically verify every part before accepting it.</b><div class='small'>MHelpDesk #${esc(activeSvcPrep.ticket_no)} · Prepared by IT Tech ${esc(preparedBy)}</div>${ticketPartsInlineHtml(activeSvcPrep)}</div>${confirmed?`<div class='ok'><b>✓ Parts verified.</b></div>`:`<div class='wl-question'><div class='qnum'>STEP ${overallStep} OF ${combinedCheckTotal}</div><div class='qtext'>Do you physically have the exact quantities listed above?</div><div class='wl-options'><button class='fail' data-wl-service-parts-mismatch>NO — MISMATCH</button><button class='pass' data-wl-confirm-service-parts>YES — I HAVE THEM</button></div></div>`}<div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><button class='wl-next' data-wl-svc-next ${confirmed?'':'disabled'}>${solarRequired?'Next Check →':'Compare IT Photos →'}</button></div>`+serviceRestartButtonHtml();
  }else if(solarRequired&&svcUnitIndex===solarStep){
    if(serviceSolarAnswersComplete(solarCtx,solarCheck)&&!solarCheck?.completed_at){const fin=await liveDb.rpc('finalize_service_solar_progress_v1',{p_prep_id:activeSvcPrep.id});if(!fin.error)solarCheck=await loadServiceSolarCheck(activeSvcPrep.id);}
    const solarTasks=serviceSolarAnswerTasks(solarCtx,solarCheck).concat(serviceSolarProofTasks(solarCtx,solarEvidence));
    const naturalSolarIndex=solarTasks.findIndex(task=>!task.done);
    const solarIndex=Number.isInteger(svcSolarCursor) ? svcSolarCursor : naturalSolarIndex;
    const solarOffset=unitQuestionTotal+(hasParts?1:0);
    const overallStep=solarOffset+((solarIndex<0?solarTasks.length:solarIndex)+1);
    wizard.innerHTML=progress(combinedCheckTitle,'One step at a time',Math.min(combinedCheckTotal,Math.max(1,overallStep)),combinedCheckTotal)+serviceSolarOneStepHtml(solarCtx,solarCheck,solarEvidence,solarOffset,combinedCheckTotal,Number.isInteger(svcSolarCursor)?svcSolarCursor:null)+serviceRestartButtonHtml();wizard.querySelectorAll('canvas').forEach(wireCanvas);
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
    wizard.innerHTML=progress(heliosHandoff.length&&!solarCheck?.handoff_accepted_at?'SERVICE HANDOFF':'FINAL STEP',heliosHandoff.length&&!solarCheck?.handoff_accepted_at?'Accept the Helios from IT before field installation':'Complete field work and close Tech Check',1,1)+aiFinal+`<div class='wl-review'><b>MHelpDesk #${esc(activeSvcPrep.ticket_no)}</b><div class='small'><b>Received from:</b> IT Tech ${esc(preparedBy)}</div><div class='small'>📷 Service receipt photos: ${servicePhotos} of ${requiredPhotos}</div>${partsReady?(hasParts?`<div class='small'>✓ Listed parts verified.</div>`:''):`<div class='wl-stop'><b>Parts are not verified.</b></div>`}${solarRequired?(solarReady?`<div class='small'>✓ Solar / Helios pre-trip complete.</div>`:`<div class='wl-stop'><b>Solar / Helios pre-trip incomplete.</b></div>`):''}${allChecksOk?`<div class='small'>✓ Every Service equipment verification answer is YES.</div>`:`<div class='wl-stop'><b>One or more Service checks are incomplete.</b></div>`}</div>${heliosNotice}${rangerNotice}${swapNotice}<button class='wl-big wl-red' ${heliosHandoff.length&&!solarCheck?.handoff_accepted_at?'data-wl-accept-helios':'data-wl-close-svc'} ${ready?'':'disabled'}>${heliosHandoff.length&&!solarCheck?.handoff_accepted_at?`Accept Helios from IT Tech ${esc(preparedBy)} & Start Field Install →`:`Complete Tech Check →`}</button><div class='wl-nav'><button class='wl-prev' data-wl-svc-prev>Back</button><span></span></div>`;
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
          <button class='fail ${failed ? 'on' : ''}' data-wl-answer='fail'>NO</button>
          <button class='pass ${inspection.truck[i] === true ? 'on' : ''}' data-wl-answer='pass'>YES</button>
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
          <button class='fail ${failed ? 'on' : ''}' data-wl-answer='fail'>NO</button>
          <button class='pass ${inspection.trailer[i] === true ? 'on' : ''}' data-wl-answer='pass'>YES</button>
        </div>
        ${failed?`<div class='wl-stop'><b>STOP — FIX THIS BEFORE CONTINUING.</b><div>Once it is corrected, tap YES.</div><a href='tel:${OPS_TEL}'>CALL OPERATIONS — ${OPS_DISPLAY}</a></div>`:''}
      </div>`;
  } else {
    const failed = inspection.truck.some(v => v === false) || (inspection.takingTrailer === true && inspection.trailer.some(v => v === false));
    body = failed
      ? `<div class='wl-stop'><b>INSPECTION BLOCKED.</b><div>There is still a NO answer. Go back and correct it before continuing.</div></div>`
      : `${progress('START-DAY CHECK COMPLETE', 'Vehicle is ready', total, total)}
         <div class='wl-service-good'>✓ ALL REQUIRED CHECKS PASSED</div>
         <button class='wl-service-start top10' data-wl-submit-inspection>CONTINUE TO REQUIRED TRUCK INVENTORY →</button>`;
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
  if(inspectionSubmitting)return;
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
  const attemptStartedAt=Date.now();
  const submitButton=document.querySelector('[data-wl-submit-inspection]');
  inspectionSubmitting=true;
  if(submitButton){submitButton.disabled=true;submitButton.textContent='SUBMITTING…';}
  document.body.classList.add('busy');
  const finishSubmittedInspection=async()=>{
    await clearDeviceDraft('inspection');
    inspectionRecovered=false;
    rememberTechCompletion('service','', 'TRUCK / TRAILER INSPECTION COMPLETE');
    return showServiceTruckInventoryCheck();
  };
  try {
    const { error } = await liveDb.rpc('submit_morning_check', {
      p_mhelp_reviewed:true,
      p_truck_checks:truck,
      p_taking_trailer:inspection.takingTrailer===true,
      p_trailer_checks:trailer,
      p_closed_ticket_nos:tickets
    });
    if (error) throw error;
    return await finishSubmittedInspection();
  } catch(error) {
    let confirmed=false;
    try{
      const {data,error:verifyError}=await liveDb.from('morning_checks')
        .select('id,submitted_at,mhelp_reviewed,truck_checks,taking_trailer,trailer_checks,closed_ticket_nos')
        .gte('submitted_at',new Date(attemptStartedAt-60000).toISOString())
        .order('submitted_at',{ascending:false})
        .limit(5);
      if(!verifyError){
        const sameChecks=(actual,expected,prefix,count)=>{
          for(let i=1;i<=count;i++)if(Boolean(actual?.[`${prefix}_${i}`])!==Boolean(expected?.[`${prefix}_${i}`]))return false;
          return true;
        };
        const sameTickets=(actual,expected)=>{
          const a=[...(actual||[])].map(String).sort(),b=[...(expected||[])].map(String).sort();
          return a.length===b.length&&a.every((value,index)=>value===b[index]);
        };
        confirmed=(data||[]).some(row=>
          row?.mhelp_reviewed===true
          && Boolean(row?.taking_trailer)===Boolean(inspection.takingTrailer===true)
          && sameChecks(row?.truck_checks,truck,'truck',8)
          && (!inspection.takingTrailer || sameChecks(row?.trailer_checks,trailer,'trailer',7))
          && sameTickets(row?.closed_ticket_nos,tickets)
        );
      }
    }catch{}
    if(confirmed)return await finishSubmittedInspection();
    await saveInspectionDraft();
    alert(error?.message === 'Failed to fetch'
      ? 'Connection lost. Your inspection is saved on this device and Tech Check could not confirm a submitted record. Reconnect and try again.'
      : (error?.message || 'Could not submit the inspection.'));
  } finally {
    inspectionSubmitting=false;
    document.body.classList.remove('busy');
    if(document.contains(submitButton)){submitButton.disabled=false;submitButton.textContent='CONTINUE TO REQUIRED TRUCK INVENTORY →';}
  }
}
async function showInspectionHistory() {
  const { data } = await liveDb.from('morning_checks').select('*').order('submitted_at', { ascending: false }).limit(60); let card = document.getElementById('wlSvcHistory'); if (!card) { card = document.createElement('div'); card.id = 'wlSvcHistory'; card.className = 'card wl-history'; viewSvc().append(card); }
  card.innerHTML = `${progress('Inspection History', 'Submitted truck / trailer checks', 1, 1)}<button class='wl-back' data-wl-home='svc'>← Service Home</button>${(data || []).map(r => { const tv = Object.values(r.truck_checks || {}).filter(v => typeof v === 'boolean'); const rv = Object.values(r.trailer_checks || {}).filter(v => typeof v === 'boolean'); const fail = tv.includes(false) || (r.taking_trailer && rv.includes(false)); return `<details><summary>${new Date(r.submitted_at).toLocaleDateString()} · ${new Date(r.submitted_at).toLocaleTimeString()} · ${fail ? 'FAILED' : 'PASSED'}</summary><div class='body'><b>Truck:</b> ${tv.includes(false) ? 'FAILED' : 'PASS'}<br><b>Trailer:</b> ${!r.taking_trailer ? 'Not taken' : rv.includes(false) ? 'FAILED' : 'PASS'}</div></details>`; }).join('') || '<div class="warn">No submitted inspections yet.</div>'}`;
  hideChildren(viewSvc(), [card]); resetWizardPosition();
}
async function refreshProofPanel(panel) {
  return window.TechCheckEvidenceView.refreshPanel(panel,{photoOnlyHtml,signatureOnlyHtml,proofHtml,wireCanvas,document});
}
document.addEventListener('keydown', e => {
  if(e.target?.id==='ownerAIDispatchPrompt' && e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    ownerAIDispatchBuild();
  }
});
document.addEventListener('change', async e => {
  if (e.target.matches?.('.wl-solar-file')) {
    const panel=e.target.closest('.wl-solar-proof');
    if(!panel)return;
    const multi=panel.dataset.wlSolarMulti==='1';
    const incoming=[...(e.target.files||[])];
    if(!multi){
      panel.querySelectorAll('.wl-solar-file').forEach(input=>{if(input!==e.target)input.value='';});
      panel._wlSolarPendingFiles=incoming;
    }else{
      const existing=Array.isArray(panel._wlSolarPendingFiles)?panel._wlSolarPendingFiles:[];
      const merged=[...existing];
      for(const file of incoming){
        const key=[file.name,file.size,file.lastModified].join('|');
        if(!merged.some(x=>[x.name,x.size,x.lastModified].join('|')===key))merged.push(file);
      }
      panel._wlSolarPendingFiles=merged;
      e.target.value='';
    }
    const files=panel._wlSolarPendingFiles||[];
    const selected=panel.querySelector('[data-wl-solar-selected]');
    const preview=panel.querySelector('[data-wl-solar-preview]');
    const save=panel.querySelector('[data-wl-solar-upload]');
    const clear=panel.querySelector('[data-wl-solar-clear-photos]');
    for(const url of (panel._wlSolarObjectUrls||[])){try{URL.revokeObjectURL(url);}catch{}}
    panel._wlSolarObjectUrls=[];
    if(!files.length){
      if(selected)selected.textContent='No photo selected yet.';
      preview?.classList.add('hidden');
      if(preview)preview.innerHTML='';
      if(save){save.disabled=true;save.textContent=multi?'SAVE PHOTOS →':'SAVE PHOTO →';}
      clear?.classList.add('hidden');
      return;
    }
    if(selected)selected.textContent=files.length===1?'✓ 1 photo selected':'✓ '+files.length+' photos selected';
    if(preview){
      const shown=files.slice(0,4);
      const urls=shown.map(file=>URL.createObjectURL(file));
      panel._wlSolarObjectUrls=urls;
      preview.classList.remove('hidden');
      preview.innerHTML="<div class='wl-solar-preview-grid'>"+urls.map((url,i)=>"<img src='"+url+"' alt='Selected photo "+(i+1)+"'>").join('')+"</div><div><b>READY TO SAVE</b><span>"+esc(files.length===1?files[0].name:(files.length+' photos selected'))+"</span></div>";
    }
    if(save){save.disabled=false;save.textContent=files.length>1?'SAVE '+files.length+' PHOTOS →':'SAVE PHOTO →';}
    clear?.classList.remove('hidden');
    return;
  }
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
  const nextSvcReceive = e.target.closest('[data-wl-next-svc-receive]'); if (nextSvcReceive) return showServiceJobLookup();
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
  if (await window.TechCheckITIntake.handleClick(e,{
    start:startITIntake,
    render:async()=>{ intakeWizard=window.TechCheckITIntake.getState(); return renderITIntakeWizard(); },
    identity:currentTechIdentity,
    uploadPhotos:uploadReturnPhotos,
    remember:rememberTechCompletion,
    home:showITHome
  })) { intakeWizard=window.TechCheckITIntake.getState(); return; }
  const ownerRemoveReturn = e.target.closest('[data-wl-owner-remove-return]'); if (ownerRemoveReturn) { if (!roleText().includes('Owner/Admin')) return alert('Only the Owner/Admin can remove Return & Intake tracking records.'); const unit = ownerRemoveReturn.dataset.wlUnit || 'this unit'; const ticket = ownerRemoveReturn.dataset.wlTicket || ''; if (!confirm(`Remove Unit ${unit}${ticket ? ` from MHelpDesk #${ticket}` : ''} from Return & Intake Tracking?\n\nThis deletes this tracking record from the app and cannot be undone.`)) return; ownerRemoveReturn.disabled = true; ownerRemoveReturn.textContent = 'Removing…'; const { error } = await liveDb.rpc('owner_remove_unit_return', { p_return_id: ownerRemoveReturn.dataset.wlOwnerRemoveReturn }); if (error) { ownerRemoveReturn.disabled = false; ownerRemoveReturn.textContent = 'Remove from Tracking'; return alert(error.message); } await installOwnerIntake(true); if (typeof window.refreshData === 'function') await window.refreshData(); return; } const ownerMhelpDone = e.target.closest('[data-wl-owner-mhelp-done]');
  if (ownerMhelpDone) {
    if (!roleText().includes('Owner/Admin')) return alert('Only the Owner/Manager can confirm MHelpDesk shop inventory.');
    if (!confirm('Confirm you have returned this unit to Shop Inventory in MHelpDesk?')) return;
    try { await window.TechCheckIntake.confirmMHelpInventory(ownerMhelpDone.dataset.wlOwnerMhelpDone); }
    catch (error) { return alert(error.message); }
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
  const itPrepClickResult=await window.TechCheckITPrepWizard.handlePrepClick(e,{
    unitIndex:itUnitIndex,
    questionIndex:itQuestionIndex,
    phase:itUnitPhase,
    typeChoice:itTypeChoice,
    purposeChoice:itPurposeChoice,
    reconRequired:itReconRequired,
    finalView:itFinalView
  },{
    currentItem:currentItItem,
    items:itItems,
    steps:itUnitStepsData,
    persist:persistCurrentItItem,
    recordAnswer:(item,field,value)=>window.TechCheckITPrepWizard.recordAnswer(item,field,value,itDraftAnswers,itAnswered),
    totalUnits:items=>activeItPrep?.expected_unit_count||itExpectedUnits||items.length,
    purposeAllowed:itPurposeAllowedForCurrentJob,
    configure:configureCurrentItItem,
    setReconRequired:value=>{itReconRequired=value;},
    boolAnswered:itBoolAnswered,
    evidence:()=>evidenceRows(activeItPrep.id,'it'),
    identity:itItemIdentity,
    unitEvidence,
    photoTagReady:itPhotoTagReady,
    unitSignature,
    issues:itUnitIssues,
    hasPrep:()=>Boolean(activeItPrep),
    confirmPhotoTag:async(itemId,matches)=>{try{await window.TechCheckITPrep.confirmPhotoTag(itemId,matches);return null;}catch(error){return error;}},
    reload:async()=>{activeItPrep=await getPrep(activeItPrep.id);},
    autoPurpose:()=>prepPurposeFromWorkType(activeItPrep?.work_type),
    release:releaseItPrepUnitByUnit
  });
  if(itPrepClickResult.handled){
    const next=itPrepClickResult.state;
    itUnitIndex=next.unitIndex;
    itQuestionIndex=next.questionIndex;
    itUnitPhase=next.phase;
    itTypeChoice=next.typeChoice;
    itPurposeChoice=next.purposeChoice;
    itReconRequired=next.reconRequired;
    itFinalView=next.finalView;
    if(itPrepClickResult.action==='pending')return showPendingList();
    if(itPrepClickResult.render)return renderItUnitStep();
    return;
  }
  const svc = e.target.closest('[data-wl-svc]'); if (svc) { if (svc.dataset.wlSvc === 'receive') showReceiveLookup(); if (svc.dataset.wlSvc === 'returns') showServiceReturnHistory(); if (svc.dataset.wlSvc === 'inspect') startInspection(); if (svc.dataset.wlSvc === 'history') showInspectionHistory(); return; }
  if (e.target.closest('[data-wl-service-open-job]')) return showServiceJobLookup();
  if (e.target.closest('[data-wl-service-truck-inventory]')) return showServiceTruckInventoryCheck();
  if (e.target.closest('[data-wl-service-truck-refresh]')) return showServiceTruckInventoryCheck();
  if (e.target.closest('[data-wl-submit-truck-inventory]')) return submitServiceTruckInventoryCheck();
  const acceptTruckRestock=e.target.closest('[data-wl-service-accept-truck-restock]'); if(acceptTruckRestock)return acceptServiceTruckRestock(acceptTruckRestock.dataset.wlServiceAcceptTruckRestock);
  if (e.target.closest('[data-wl-service-truck-usage]')) return showServiceTruckUsage();
  if (e.target.closest('[data-wl-service-record-truck-unit-used]')) return recordServiceTruckUnitUsed();
  if (e.target.closest('[data-wl-service-record-truck-sim-used]')) return recordServiceTruckSimUsed();
  if (e.target.closest('[data-wl-service-record-truck-stock-used]')) return recordServiceTruckStockUsed();
  if (e.target.closest('[data-wl-service-resolve-spares]')) return showServiceSpareResolution();
  if (e.target.closest('[data-wl-it-create-job]')) return showITCreateJob();
  if (e.target.closest('[data-wl-it-managed-jobs]')) return showITManagedTickets();
  if (e.target.closest('[data-wl-it-calendar]')) return showITCalendar(0);
  const itCalShift=e.target.closest('[data-wl-it-calendar-shift]'); if(itCalShift)return showITCalendar(Number(itCalShift.dataset.wlItCalendarShift||0));
  if(e.target.closest('[data-wl-it-calendar-today]'))return showITCalendar('today');
  const itCalFilter=e.target.closest('[data-wl-it-calendar-filter]'); if(itCalFilter){wlITCalendarFilter=String(itCalFilter.dataset.wlItCalendarFilter||'ALL').toUpperCase();return showITCalendar(0);}
  if (e.target.closest('[data-wl-it-attention]')) return showITNeedsAttention();
  if (e.target.closest('[data-wl-it-submit-create-job]')) return itSubmitCreateJob();
  if (e.target.closest('[data-wl-it-save-managed-job]')) return itSaveManagedJob();
  const editManaged=e.target.closest('[data-wl-it-edit-managed-ticket]'); if(editManaged)return showITManagedTicketEditor(editManaged.dataset.wlItEditManagedTicket);
  const ticketHistory=e.target.closest('[data-wl-it-ticket-history]'); if(ticketHistory)return showITTicketHistory(ticketHistory.dataset.wlItTicketHistory);
  const transferTicket=e.target.closest('[data-wl-it-transfer-ticket]'); if(transferTicket)return itTransferManagedTicket(transferTicket.dataset.wlItTransferTicket);
  if (e.target.closest('[data-wl-it-truck-inventory]')) return showITServiceTruckInventory();
  const manageTruck=e.target.closest('[data-wl-it-manage-truck]'); if(manageTruck)return showITServiceTruckManager(manageTruck.dataset.wlItManageTruck);
  const loadUnit=e.target.closest('[data-wl-it-load-unit]'); if(loadUnit)return itLoadTruckUnit(loadUnit.dataset.serviceTech,loadUnit.dataset.wlItLoadUnit);
  const loadSim=e.target.closest('[data-wl-it-load-sim]'); if(loadSim)return itLoadTruckSim(loadSim.dataset.serviceTech,loadSim.dataset.wlItLoadSim);
  const loadStock=e.target.closest('[data-wl-it-load-stock]'); if(loadStock)return itAddTruckStock(loadStock.dataset.serviceTech,loadStock.dataset.stockType,loadStock.dataset.wlItLoadStock);
  if (e.target.closest('[data-wl-it-truck-restock]')) return showITTruckRestock();
  const readyTruckUnit=e.target.closest('[data-wl-it-ready-truck-unit]'); if(readyTruckUnit)return prepareITTruckUnitRestock(readyTruckUnit.dataset.wlItReadyTruckUnit);
  const readyTruckSim=e.target.closest('[data-wl-it-ready-truck-sim]'); if(readyTruckSim)return prepareITTruckSimRestock(readyTruckSim.dataset.wlItReadyTruckSim);
  const readyTruckBattery=e.target.closest('[data-wl-it-ready-truck-battery]'); if(readyTruckBattery)return prepareITTruckBatteryRestock(readyTruckBattery.dataset.wlItReadyTruckBattery);
  const techEndDay=e.target.closest('[data-wl-tech-end-day]');
  if(techEndDay)return attemptTechEndDay(techEndDay.dataset.wlTechEndDay);
  const techDayBack=e.target.closest('[data-wl-tech-day-back]');
  if(techDayBack)return techDayBack.dataset.wlTechDayBack==='it'?showITHome():showSvcHome();
  const beginAssignedReturn=e.target.closest('[data-wl-service-begin-return]');
  if(beginAssignedReturn) return beginServiceReturnForAssignment(beginAssignedReturn.dataset.wlServiceBeginReturn);
  const completeServiceAssignment=e.target.closest('[data-wl-service-complete-assignment]');
  if(completeServiceAssignment) return completeServiceFieldAssignment(completeServiceAssignment.dataset.wlServiceCompleteAssignment);
  if (e.target.closest('[data-wl-service-find-job]')) return serviceFindJobByTicket();
  const takeServiceJob=e.target.closest('[data-wl-service-take-job]');
  if(takeServiceJob){
    const fromTicketLookup=Boolean(takeServiceJob.closest('#wlSvcLookup')&&document.getElementById('wlServiceJobSearch'));
    const enteredTicket=fromTicketLookup ? String(document.getElementById('wlServiceJobSearch')?.value||'').trim().replace(/^#\s*/,'') : '';
    return serviceTakeVerifiedJob(takeServiceJob.dataset.wlServiceTakeJob,enteredTicket);
  }
  if (e.target.closest('[data-wl-match]')) return matchSvcTicket();
  if(e.target.closest('[data-wl-svc-restart-questions]')) return restartServiceVerificationQuestions();
  const svcTicket = e.target.closest('[data-wl-svc-ticket]');
  if (svcTicket) { if (svcTicket.dataset.wlSvcTicket === 'wrong') { activeSvcPrep = null; return showReceiveLookup(); } return renderSvcPrep(); }
  const svcAnswer = e.target.closest('[data-wl-svc-answer]');
  if (svcAnswer) {
    if(serviceQuestionAdvancing)return;
    serviceQuestionAdvancing=true;
    const answerButtons=[...(svcAnswer.closest('.wl-options')?.querySelectorAll('button')||[])];
    answerButtons.forEach(button=>button.disabled=true);
    try{
      const card = findSvcCard(activeSvcPrep.ticket_no);
      const q = svcQuestions(svcForms(card)[svcUnitIndex])[svcQuestionIndex];
      if (!q || q.kind !== 'bool') return;
      const yes = svcAnswer.dataset.wlSvcAnswer === 'yes';
      q.input.checked = yes;
      q.input.dataset.wlAnswered = '1';
      if(q.heliosBattery){
        if(!await saveServiceSolarProgressField('helios_battery_box_charging_ok',yes?'true':'false'))return;
        if(!await saveServiceSolarProgressField('batteries_charged_ok',yes?'true':'false'))return;
      }
      if (yes) return await advanceSvcVerification();
      return await renderSvcPrep();
    }finally{
      serviceQuestionAdvancing=false;
      answerButtons.forEach(button=>{if(document.contains(button))button.disabled=false;});
    }
  }
  const svcNext=e.target.closest('[data-wl-svc-next]');
  if (svcNext) {
    if(serviceQuestionAdvancing)return;
    serviceQuestionAdvancing=true;
    svcNext.disabled=true;
    try{
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
      if (svcUnitIndex < forms.length) return await advanceSvcVerification();
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
      svcUnitIndex++;
      return await renderSvcPrep();
    }finally{
      serviceQuestionAdvancing=false;
      if(document.contains(svcNext))svcNext.disabled=false;
    }
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
    if(solarRequired && svcUnitIndex===solarStep){
      const check=await loadServiceSolarCheck(activeSvcPrep.id);
      const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
      const tasks=serviceSolarAnswerTasks(solarCtx,check).concat(serviceSolarProofTasks(solarCtx,evidence));
      const naturalIndex=tasks.findIndex(task=>!task.done);
      const current=Number.isInteger(svcSolarCursor)?svcSolarCursor:(naturalIndex<0?Math.max(0,tasks.length-1):naturalIndex);
      if(current>0){svcSolarCursor=current-1;return renderSvcPrep();}
      svcSolarCursor=0;
      if(hasParts){svcUnitIndex=partStep;return renderSvcPrep();}
      if(forms.length){svcUnitIndex=forms.length-1;svcQuestionIndex=Math.max(0,svcQuestions(forms[svcUnitIndex]).length-1);return renderSvcPrep();}
      return showReceiveLookup();
    }
    svcUnitIndex = Math.max(0, svcUnitIndex - 1); return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-confirm-service-parts]')) {
    const { error } = await liveDb.rpc('confirm_service_parts', { p_prep_id: activeSvcPrep.id });
    if (error) return alert(error.message);
    activeSvcPrep = await getPrep(activeSvcPrep.id);
    return renderSvcPrep();
  }
  if (e.target.closest('[data-wl-service-parts-mismatch]')) return alert('Do not accept the handoff. Compare the parts with IT and the MHelpDesk ticket, then correct the mismatch before continuing.');
  
  const solarStandSave=e.target.closest('[data-wl-solar-save-stand]');
  if(solarStandSave){
    const required=Math.max(1,Number(solarStandSave.dataset.required||1));
    const value=String(document.getElementById('wlSolarSingleStandTag')?.value||'').trim();
    const tags=value.split(/[,\n]+/).map(function(v){return v.trim();}).filter(Boolean);
    if(tags.length!==required)return alert('Enter exactly '+required+' Solar Stand tag'+(required===1?'':'s')+'.');
    if(!await saveServiceSolarProgressField('stand_tag',tags.join('\n')))return;
    if(!await saveServiceSolarProgressField('stand_verified','true'))return;
    await maybeFinalizeServiceSolarProgress();
    if(Number.isInteger(svcSolarCursor))svcSolarCursor++;
    return renderSvcPrep();
  }
  const solarBatteryConfig=e.target.closest('[data-wl-solar-battery-config]');
  if(solarBatteryConfig){
    if(!await saveServiceSolarProgressField('battery_configuration',solarBatteryConfig.dataset.wlSolarBatteryConfig))return;
    await maybeFinalizeServiceSolarProgress();
    if(Number.isInteger(svcSolarCursor))svcSolarCursor++;
    return renderSvcPrep();
  }
  const solarStepAnswer=e.target.closest('[data-wl-solar-step-answer]');
  if(solarStepAnswer){
    if(solarStepAnswer.dataset.wlSolarStepAnswer==='no'){
      const stepMessage=solarStepAnswer.closest('.wl-question')?.querySelector('.wl-solar-step-message');
      const field=solarStepAnswer.dataset.field||'';
      const reopen=await liveDb.rpc('reopen_service_solar_progress_v1',{p_prep_id:activeSvcPrep.id});
      if(reopen.error)return alert(reopen.error.message);
      if(!await saveServiceSolarProgressField(field,'false'))return;
      if(field==='mppt_tested_ok' && serviceSolarHeliosCount()>0){
        if(!await saveServiceSolarProgressField('mppt_updated_ok','false'))return;
        if(!await saveServiceSolarProgressField('helios_yard_updates_status_ok','false'))return;
      }
      if(field==='helios_yard_solar_charging_ok'){
        if(!await saveServiceSolarProgressField('solar_charging_ok','false'))return;
      }
      if(stepMessage)stepMessage.innerHTML=field==='helios_yard_pv_connected_ok'
        ? "<div class='wl-stop top10'><b>CONNECT HELIOS FIRST.</b><div>Connect the Helios unit to the Helios tower and solar panel for testing, then tap CONNECTED.</div></div>"
        : "<div class='wl-stop top10'><b>STOP — FIX THIS FIRST.</b><div>When it is corrected, tap YES. You cannot continue while this answer is NO.</div></div>";
      return;
    }
    const extraField=solarStepAnswer.dataset.extraField;
    const extraValue=solarStepAnswer.dataset.extraValue;
    if(extraField && !await saveServiceSolarProgressField(extraField,extraValue))return;
    const field=solarStepAnswer.dataset.field;
    if(!await saveServiceSolarProgressField(field,'true'))return;
    if(field==='mppt_tested_ok' && serviceSolarHeliosCount()>0){
      if(!await saveServiceSolarProgressField('mppt_updated_ok','true'))return;
      if(!await saveServiceSolarProgressField('helios_yard_updates_status_ok','true'))return;
    }
    if(field==='helios_battery_box_charging_ok'){
      if(!await saveServiceSolarProgressField('batteries_charged_ok','true'))return;
    }
    if(field==='helios_yard_solar_charging_ok'){
      if(!await saveServiceSolarProgressField('solar_charging_ok','true'))return;
    }
    await maybeFinalizeServiceSolarProgress();
    if(Number.isInteger(svcSolarCursor))svcSolarCursor++;
    return renderSvcPrep();
  }

  const solarReviewNext=e.target.closest('[data-wl-solar-review-next]');
  if(solarReviewNext){
    if(!Number.isInteger(svcSolarCursor))svcSolarCursor=0;
    svcSolarCursor++;
    return renderSvcPrep();
  }

  const heliosFieldAnswer=e.target.closest('[data-wl-helios-field-answer]');
  if(heliosFieldAnswer){
    if(heliosFieldAnswerSubmitting)return;
    heliosFieldAnswerSubmitting=true;
    const answerButtons=[...(heliosFieldAnswer.closest('.wl-options')?.querySelectorAll('[data-wl-helios-field-answer]')||[])];
    answerButtons.forEach(button=>button.disabled=true);
    const field=heliosFieldAnswer.dataset.field;
    const yes=heliosFieldAnswer.dataset.wlHeliosFieldAnswer==='yes';
    try{
      if(!await saveHeliosFieldCheckAnswer(field,yes))return;
      if(!yes){
        const msg=heliosFieldAnswer.closest('.wl-question')?.querySelector('.wl-helios-field-message');
        if(msg)msg.innerHTML="<div class='wl-stop'><b>STOP — FIX THIS FIRST.</b><div>Correct this site-install step, then tap YES before continuing.</div></div>";
        svcHeliosFieldCursor=null;
        return;
      }
      const check=await loadServiceSolarCheck(activeSvcPrep.id);
      const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
      const units=heliosFieldItems(activeSvcPrep);
      svcHeliosFieldCursor=heliosFieldTaskIndex(check,evidence,units);
      return renderSvcPrep();
    }finally{
      heliosFieldAnswerSubmitting=false;
      answerButtons.forEach(button=>{if(document.contains(button))button.disabled=false;});
    }
  }
  if(e.target.closest('[data-wl-helios-field-prev]')){
    const check=await loadServiceSolarCheck(activeSvcPrep.id);
    const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
    const units=heliosFieldItems(activeSvcPrep);
    const current=Number.isInteger(svcHeliosFieldCursor)?svcHeliosFieldCursor:heliosFieldTaskIndex(check,evidence,units);
    svcHeliosFieldCursor=Math.max(0,current-1);
    return renderSvcPrep();
  }
  if(e.target.closest('[data-wl-helios-field-next]')){
    const check=await loadServiceSolarCheck(activeSvcPrep.id);
    const evidence=await serviceSolarEvidenceRows(activeSvcPrep.id);
    const units=heliosFieldItems(activeSvcPrep);
    const current=Number.isInteger(svcHeliosFieldCursor)?svcHeliosFieldCursor:heliosFieldTaskIndex(check,evidence,units);
    svcHeliosFieldCursor=Math.min(heliosFieldRuleList().length+2,current+1);
    return renderSvcPrep();
  }

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
    try{await window.TechCheckITPrep.confirmSwapSiteRegistration(confirmSwapSite.dataset.wlConfirmSwapSite);}catch(error){return alert(error?.message||'Could not confirm site registration.');}
    rememberTechCompletion('it','', 'SITE REGISTRATION COMPLETE');
    return showITHome();
  }

  const solarClearPhotos=e.target.closest('[data-wl-solar-clear-photos]');
  if(solarClearPhotos){
    const panel=solarClearPhotos.closest('.wl-solar-proof');
    if(!panel)return;
    panel._wlSolarPendingFiles=[];
    for(const url of (panel._wlSolarObjectUrls||[])){try{URL.revokeObjectURL(url);}catch{}}
    panel._wlSolarObjectUrls=[];
    panel.querySelectorAll('.wl-solar-file').forEach(input=>{input.value='';});
    const selected=panel.querySelector('[data-wl-solar-selected]');
    const preview=panel.querySelector('[data-wl-solar-preview]');
    const save=panel.querySelector('[data-wl-solar-upload]');
    if(selected)selected.textContent='No photo selected yet.';
    if(preview){preview.innerHTML='';preview.classList.add('hidden');}
    if(save){save.disabled=true;save.textContent=panel.dataset.wlSolarMulti==='1'?'SAVE PHOTOS →':'SAVE PHOTO →';}
    solarClearPhotos.classList.add('hidden');
    return;
  }

  const solarUpload=e.target.closest('[data-wl-solar-upload]');
  if (solarUpload) {
    const panel=solarUpload.closest('.wl-solar-proof');
    const category=panel?.dataset.solarCategory;
    const files=(Array.isArray(panel?._wlSolarPendingFiles)&&panel._wlSolarPendingFiles.length)
      ? [...panel._wlSolarPendingFiles]
      : [...(panel?.querySelectorAll('.wl-solar-file') || [])].flatMap(input=>[...(input.files||[])]);
    if (!category || !files.length) return alert('Take or select at least one photo first.');
    solarUpload.disabled=true;
    solarUpload.textContent=files.length>1 ? `Saving ${files.length} photos…` : 'Saving photo…';
    try {
      for (const file of files) await uploadServiceSolarEvidence(activeSvcPrep.id,category,'photo',file);
      if(category==='helios_install' && Number.isInteger(svcHeliosFieldCursor))svcHeliosFieldCursor++;
      else if(Number.isInteger(svcSolarCursor))svcSolarCursor++;
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
      if(category==='helios_install' && Number.isInteger(svcHeliosFieldCursor))svcHeliosFieldCursor++;
      else if(Number.isInteger(svcSolarCursor))svcSolarCursor++;
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
    const card=spareReturn.closest('.wl-ticket');
    if(!card)return;
    let proof=card.querySelector('.wl-unused-backup-proof');
    if(!proof){
      proof=document.createElement('div');
      proof.className='wl-unused-backup-proof top10';
      const itemId=spareReturn.dataset.wlSpareUnitReturn;
      const label=spareReturn.dataset.wlSpareUnitLabel||'unused backup';
      proof.innerHTML=`<div class='wl-question'>
        <div class='qnum'>RETURN UNUSED BACKUP</div>
        <div class='qtext'>TAKE A CLEAR RETURN PHOTO</div>
        <div class='small'>Photograph ${esc(label)} before handing it back to IT. The photo will stay with this unit through IT Intake.</div>
        <label class='wl-photo-button top10' for='wlUnusedBackupPhoto_${esc(itemId)}'>📷 TAKE RETURN PHOTO</label>
        <input id='wlUnusedBackupPhoto_${esc(itemId)}' class='wl-photo-input' type='file' accept='image/*' capture='environment' data-wl-unused-backup-photo='${esc(itemId)}'>
        <div class='wl-return-preview hidden' data-wl-unused-backup-preview></div>
        <button class='wl-big wl-red top10' data-wl-spare-unit-return-confirm='${esc(itemId)}' disabled>SEND UNUSED BACKUP TO IT INTAKE →</button>
        <button class='wl-service-backstep top10' data-wl-spare-unit-return-cancel>← CANCEL</button>
      </div>`;
      card.append(proof);
      card.querySelector('.grid2')?.classList.add('hidden');
      const input=proof.querySelector('[data-wl-unused-backup-photo]');
      input?.addEventListener('change',()=>{
        const file=input.files?.[0];
        const preview=proof.querySelector('[data-wl-unused-backup-preview]');
        const send=proof.querySelector('[data-wl-spare-unit-return-confirm]');
        if(!file){
          preview?.classList.add('hidden');
          if(send)send.disabled=true;
          return;
        }
        if(preview){
          preview.classList.remove('hidden');
          preview.innerHTML=`<img src='${URL.createObjectURL(file)}' alt='Unused backup return photo'><div class='ok top8'><b>✓ RETURN PHOTO READY</b></div>`;
        }
        if(send)send.disabled=false;
      });
      input?.click();
    }else{
      proof.querySelector('[data-wl-unused-backup-photo]')?.click();
    }
    return;
  }

  const spareReturnCancel=e.target.closest('[data-wl-spare-unit-return-cancel]');
  if(spareReturnCancel){
    const proof=spareReturnCancel.closest('.wl-unused-backup-proof');
    const card=proof?.closest('.wl-ticket');
    proof?.remove();
    card?.querySelector('.grid2')?.classList.remove('hidden');
    return;
  }

  const spareReturnConfirm=e.target.closest('[data-wl-spare-unit-return-confirm]');
  if(spareReturnConfirm){
    const proof=spareReturnConfirm.closest('.wl-unused-backup-proof');
    const file=proof?.querySelector('[data-wl-unused-backup-photo]')?.files?.[0];
    if(!file)return alert('Take a clear return photo before sending this unused backup to IT Intake.');
    if(!confirm('Send this UNUSED complete backup and its return photo to IT Intake?'))return;

    const itemId=spareReturnConfirm.dataset.wlSpareUnitReturnConfirm;
    const returnId=crypto.randomUUID();
    let uploadedPaths=[];
    spareReturnConfirm.disabled=true;
    spareReturnConfirm.textContent='SENDING TO IT INTAKE…';
    document.body.classList.add('busy');
    try{
      uploadedPaths=await uploadReturnPhotos([file],returnId,'service/unused-backup');
      const {error}=await liveDb.rpc('resolve_my_truck_spare_unit_v2',{
        p_item_id:itemId,
        p_outcome:'returned_unused',
        p_return_photo_paths:uploadedPaths,
        p_return_id:returnId
      });
      if(error)throw error;
      await window.refreshData?.();
      rememberTechCompletion('service','', 'BACKUP RETURN SENT TO IT');
      return showSvcHome();
    }catch(err){
      if(uploadedPaths.length)await liveDb.storage.from(EVIDENCE_BUCKET).remove(uploadedPaths).catch(()=>null);
      spareReturnConfirm.disabled=false;
      spareReturnConfirm.textContent='SEND UNUSED BACKUP TO IT INTAKE →';
      return alert(err?.message||'Could not send the unused backup to IT Intake.');
    }finally{
      document.body.classList.remove('busy');
    }
  }

  const spareUsed=e.target.closest('[data-wl-spare-unit-used]');
  if (spareUsed) {
    if (!confirm('Mark this truck spare USED for the field job? If it replaced a failed unit, return the failed unit through normal IT Intake.')) return;
    const { error }=await liveDb.rpc('resolve_my_truck_spare_unit',{p_item_id:spareUsed.dataset.wlSpareUnitUsed,p_outcome:'used'});
    if (error) return alert(error.message);
    rememberTechCompletion('service','', 'BACKUP DISPOSITION RECORDED');
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

  const closeSvc=e.target.closest('[data-wl-close-svc]');
  if (closeSvc) {
    if(serviceCloseSubmitting)return;
    const prepId=activeSvcPrep?.id;
    const ticket=activeSvcPrep?.ticket_no||'';
    if(!prepId)return;
    serviceCloseSubmitting=true;
    const originalText=closeSvc.textContent;
    closeSvc.disabled=true;
    closeSvc.textContent='Saving completion…';
    let closeError=null;
    try {
      await window.closePreparedTicket(prepId);
    } catch(error) {
      closeError=error;
      console.warn('Service close request failed before it could be verified',error);
    }
    let verified=null;
    try { verified=await getPrep(prepId); } catch(error) { closeError=closeError||error; }
    serviceCloseSubmitting=false;
    if(verified?.status!=='closed'){
      if(document.contains(closeSvc)){closeSvc.disabled=false;closeSvc.textContent=originalText;}
      if(closeError)alert('Could not verify that this Tech Check closed. Your work is still on this screen; reconnect and try Complete Tech Check again.');
      if(verified)activeSvcPrep=verified;
      return renderSvcPrep();
    }
    activeSvcPrep=verified;
    rememberTechCompletion('service',ticket,'JOB COMPLETE');
    setTimeout(showSvcHome,300);
    return;
  }
  const evidencePhotoResult=await window.TechCheckEvidence.handlePhotoUpload(e,{
    optimizePhoto:optimizeEvidencePhoto,
    uploadEvidence,
    resolveItem:({panel,unitNo})=>panel.dataset.stage==='it'&&unitNo?itItems()[unitNo-1]||null:null,
    validate:async({panel,files,expected})=>{
      if(panel.dataset.stage==='service'&&expected){
        const existing=(await evidenceRows(panel.dataset.proof,'service')).filter(row=>row.kind==='photo').length;
        if(existing+files.length>expected){
          alert(`Service needs exactly ${expected} photos total. You already have ${existing}.`);
          return false;
        }
      }
      return true;
    },
    beforeUpload:async({button,panel,optimized,unitNo,item})=>{
      let tagScan=null;
      if(panel.dataset.stage==='it'&&unitNo&&item&&shouldScanUnitTag(item.equipment_type)&&item.unit_tag){
        button.textContent='OnSite Vision is scanning…';
        showLiveTagScan(panel,item.unit_tag);
        tagScan=await scanUnitTagPhoto(optimized[0],item.unit_tag);
        const liveScan=panel.querySelector('.wl-ai-scan-live');
        if(liveScan)liveScan.outerHTML=tagScanStatusHtml(tagScan,item.unit_tag);
      }
      return {tagScan};
    },
    afterUpload:async({itemId,extra})=>{
      if(extra?.tagScan&&itemId)await saveItTagScan(itemId,extra.tagScan);
    },
    afterSuccess:async({panel,unitNo})=>{
      if(panel.dataset.stage==='it'&&unitNo&&activeItPrep){
        activeItPrep=await getPrep(activeItPrep.id);
        await renderItUnitStep();
        return true;
      }
      if(panel.dataset.stage==='it'&&!unitNo&&activeItPrep?.id===panel.dataset.proof&&activeItPrep.expected_unit_count==null&&itItems().length===0){
        activeItPrep=await getPrep(activeItPrep.id);
        await renderItUnitStep();
        return true;
      }
      return false;
    },
    refreshPanel:refreshProofPanel,
    alert
  });
  if(evidencePhotoResult.handled)return;
  const evidenceSignatureResult=await window.TechCheckEvidenceView.handleSignatureClick(e,{
    blobFromCanvas,
    uploadEvidence,
    resolveItemId:(panel,unitNo)=>panel.dataset.stage==='it'&&unitNo?itItems()[unitNo-1]?.id||null:null,
    afterSave:async({panel})=>{
      if(panel.dataset.stage==='it'&&panel.dataset.mode==='signature'&&activeItPrep){
        await renderItUnitStep();
        return true;
      }
      return false;
    },
    refreshPanel:refreshProofPanel,
    wireCanvas,
    alert,
    document
  });
  if(evidenceSignatureResult.handled)return;
  const ans = e.target.closest('[data-wl-answer]'); if (ans) { const val = ans.dataset.wlAnswer === 'pass'; if (inspection.step < 8) inspection.truck[inspection.step] = val; else if (inspection.takingTrailer === true && inspection.step < 16) inspection.trailer[inspection.step - 9] = val; if (val) inspection.step++; saveInspectionDraft(); return inspectionQuestion(); }
  const tr = e.target.closest('[data-wl-trailer]'); if (tr) { inspection.takingTrailer = tr.dataset.wlTrailer === 'yes'; inspection.step = inspection.takingTrailer ? 9 : 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-next]')) { if (inspection.step < 8 && inspection.truck[inspection.step] === null) return alert('Choose PASS or FAIL first.'); if (inspection.step === 8 && inspection.takingTrailer === null) return alert('Choose whether you are taking a trailer.'); if (inspection.takingTrailer === true && inspection.step >= 9 && inspection.step < 16 && inspection.trailer[inspection.step - 9] === null) return alert('Choose PASS or FAIL first.'); inspection.step++; if (inspection.step === 9 && inspection.takingTrailer === false) inspection.step = 16; saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-inspect-prev]')) { if(document.getElementById('wlTruck110Qty')) { inspection.load.qty110=document.getElementById('wlTruck110Qty').value; inspection.load.charged110=document.getElementById('wlTruck110Charged')?.checked===true; inspection.load.qtyLi=document.getElementById('wlTruckLiQty')?.value||''; inspection.load.chargedLi=document.getElementById('wlTruckLiCharged')?.checked===true; inspection.load.backup=document.getElementById('wlTruckBackup')?.value||''; } if (inspection.step === 16 && inspection.takingTrailer === false) inspection.step = 8; else inspection.step = Math.max(0, inspection.step - 1); saveInspectionDraft(); return inspectionQuestion(); }
  if (e.target.closest('[data-wl-submit-inspection]')) return submitInspection();
});
async function showServiceReturn() {
  const saved=await loadDeviceDraft('service-return');
  if (saved?.ticket) { serviceReturn={ step:Math.min(Number(saved.step||0),3), ticket:String(saved.ticket||''), unit:String(saved.unit||''), type:String(saved.type||''), notes:String(saved.notes||''), noTag:Boolean(saved.noTag), photo:null, tagScan:null, conditionPhotos:[], damagePhotos:[], knownUnits:[], offlineEscalationId:saved.offlineEscalationId||null, submissionId:saved.submissionId||null, pendingUploadPaths:Array.isArray(saved.pendingUploadPaths)?saved.pendingUploadPaths:[] }; if (serviceReturn.ticket && serviceReturn.step>=1) serviceReturn.knownUnits=await rememberedUnitsForTicket(serviceReturn.ticket); serviceReturnRecovered=true; }
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
  if (!serviceReturn.ticket || !serviceReturn.type || (!serviceReturn.unit && !isTagless110VReturn())) return alert(isTagless110VReturn() ? 'Ticket and 110V Stand type are required.' : 'Ticket, unit, and equipment type are required.');
  const isHeliosSwapReturn=serviceReturn.type==='Helios' && activeSvcPrep?.ticket_no && norm(activeSvcPrep.ticket_no)===norm(serviceReturn.ticket) && heliosFieldItems(activeSvcPrep).some(x=>x.purpose==='SWAP');
  if (isHeliosSwapReturn && !serviceReturn.notes.trim()) return alert('For OLD UNIT RETURNING, document why the Helios is being swapped and the damage / issues / symptoms / repair needed before sending it to IT Intake.');
  if ((serviceReturn.damagePhotos || []).length && !serviceReturn.notes.trim()) return alert('Damage photos were added. Describe what is damaged in Return notes / damage noticed so IT knows what to inspect.');
  if (!navigator.onLine) return alert(`No connection. This return is saved as an unsent draft on this device. Reconnect before ${is110VStandReturn()?'returning the stand to Shop':'sending it to IT Intake'}.`);
  serviceReturnSubmitting=true; document.body.classList.add('busy');
  let uploadedPaths=[];
  const returnId=serviceReturn.submissionId||crypto.randomUUID();
  serviceReturn.submissionId=returnId;
  await saveServiceReturnDraft();
  try {
    const tech=await currentTechIdentity();

    // A prior request may have committed even if this phone never received the response.
    // Always resolve the same stable return id before uploading or inserting again.
    const {data:priorReturn,error:priorLookupError}=await liveDb.from('unit_returns')
      .select('id,ticket_no,unit_tag,equipment_type,status')
      .eq('id',returnId)
      .maybeSingle();
    if(priorLookupError)throw new Error('Could not verify whether this return was already saved. Reconnect and tap submit again; Tech Check will check the same return instead of creating another.');
    if(priorReturn){
      await clearDeviceDraft('service-return');
      serviceReturnRecovered=false;
      serviceReturn.pendingUploadPaths=[];
      alert(`Return already saved successfully for MHelpDesk #${priorReturn.ticket_no}. No duplicate was created.`);
      if(activeSvcPrep?.ticket_no&&norm(activeSvcPrep.ticket_no)===norm(priorReturn.ticket_no))return renderSvcPrep();
      return showSvcHome();
    }

    if((serviceReturn.pendingUploadPaths||[]).length){
      await liveDb.storage.from(EVIDENCE_BUCKET).remove(serviceReturn.pendingUploadPaths).catch(()=>null);
      serviceReturn.pendingUploadPaths=[];
      await saveServiceReturnDraft();
    }

    if (!serviceReturn.photo) return alert(isTagless110VReturn() ? 'Take or choose a clear photo of the 110V Stand first.' : `Take or choose a clear unit tag photo showing ${serviceReturn.unit} first.`);

    const existingReturns=isTagless110VReturn()?[]:(await returnRows()).filter(r => norm(r.ticket_no)===norm(serviceReturn.ticket) && norm(r.unit_tag)===norm(serviceReturn.unit) && String(r.id)!==String(returnId));
    if (existingReturns.length) return alert(`Unit ${serviceReturn.unit} has already been returned for MHelpDesk #${serviceReturn.ticket}. It cannot be returned again from this ticket.`);
    const safeUnit=(String(serviceReturn.unit||'').trim()||'no-tag-110v-stand').replace(/[^a-zA-Z0-9._-]/g,'_');
    const taggedPhoto=new File([serviceReturn.photo],isTagless110VReturn()?`110v-stand-no-tag-${serviceReturn.photo.name || 'photo.jpg'}`:`unit-${safeUnit}-tag-${serviceReturn.photo.name || 'photo.jpg'}`,{type:serviceReturn.photo.type || 'image/jpeg'});
    const conditionPhotos=(serviceReturn.conditionPhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-site-condition-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    const damagePhotos=(serviceReturn.damagePhotos || []).map((file,index) => new File([file],`unit-${safeUnit}-DAMAGE-${index + 1}-${file.name || 'photo.jpg'}`,{type:file.type || 'image/jpeg'}));
    uploadedPaths=await uploadReturnPhotos([taggedPhoto,...conditionPhotos,...damagePhotos],returnId,`service/unit-${safeUnit}`);
    serviceReturn.pendingUploadPaths=[...uploadedPaths];
    await saveServiceReturnDraft();
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
    const assignmentProgress=await serviceReturnAssignmentProgress(serviceReturn.ticket,tech.id);
    await clearDeviceDraft('service-return'); serviceReturnRecovered=false; serviceReturn.submissionId=null; serviceReturn.pendingUploadPaths=[];
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
    let confirmed=null,verificationError=null;
    try{
      const check=await liveDb.from('unit_returns').select('id,ticket_no').eq('id',returnId).maybeSingle();
      confirmed=check.data||null;
      verificationError=check.error||null;
    }catch(error){verificationError=error;}

    if(confirmed){
      serviceReturn.pendingUploadPaths=[];
      serviceReturn.submissionId=null;
      await clearDeviceDraft('service-return');
      serviceReturnRecovered=false;
      alert(`Return saved successfully for MHelpDesk #${confirmed.ticket_no} even though the connection was interrupted. No duplicate was created.`);
      if(activeSvcPrep?.ticket_no&&norm(activeSvcPrep.ticket_no)===norm(confirmed.ticket_no))return renderSvcPrep();
      return showSvcHome();
    }

    if(!verificationError){
      const cleanup=[...new Set([...(uploadedPaths||[]),...(serviceReturn.pendingUploadPaths||[])])];
      if(cleanup.length)await liveDb.storage.from(EVIDENCE_BUCKET).remove(cleanup).catch(()=>null);
      serviceReturn.pendingUploadPaths=[];
    }
    await saveServiceReturnDraft();

    if(verificationError){
      alert('Connection was interrupted and Tech Check could not verify whether the return reached Supabase. Your return is saved on this device with the same retry ID. Reconnect and tap submit again; Tech Check will verify that same return before creating anything.');
    }else{
      alert(err?.message === 'Failed to fetch' ? 'Connection lost before the return could be confirmed. Your return details are still saved on this device; reconnect and tap submit again.' : (err?.message || 'Could not submit the return. Nothing was marked submitted.'));
    }
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
    <div class='warn top10'><b>Operations Manager final verification</b><div>Confirm only after reviewing the completed field checklist, final photos, Service signature, and OLD UNIT RETURNING documentation for any swap.</div></div>
    <button class='wl-big wl-green top10' data-wl-owner-helios-verify='${esc(prepId)}'>Operations Manager Final Verify Helios →</button>`;
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
  return `<div class='wl-assignment-row' data-owner-ai-state='${aiState}'><div class='wl-assignment-main'><div class='row'><b>MHelpDesk Ref #${esc(a.ticket_no)}</b><span class='pill'>${a.assigned_role==='it'?'IT':'SERVICE'}</span></div><div class='wl-live-stage'><b>${esc(p.label)}</b><span>${esc(p.detail)}</span><div class='wl-live-track'><i style='width:${pct}%'></i></div></div><div class='small'><b>${a.assignee_user_id?'Assigned to:':'Queue:'}</b> ${esc(a.assignee_name)}</div>${a.site?`<div class='small'><b>Customer / Site:</b> ${esc(a.site)}</div>`:''}${a.work_type?`<div class='small'><b>Job Type:</b> ${esc(a.work_type.toUpperCase())}</div>`:''}${a.scheduled_for?`<div class='small'><b>Work Date:</b> ${new Date(a.scheduled_for+'T12:00:00').toLocaleDateString()}</div>`:''}${a.job_lead_name?`<div class='small'><b>Ticket Lead:</b> ${esc(a.job_lead_name)} · IT</div>`:''}${a.requested_unit_count!=null?`<div class='small'><b>${String(a.work_type||'').toLowerCase()==='pickup'?'Units Being Picked Up':'Units Required'}:</b> ${Number(a.requested_unit_count)}</div>`:''}${a.unit_summary?`<div class='small'><b>Unit / Equipment Notes:</b> ${esc(a.unit_summary)}</div>`:''}${a.job_description?`<div class='small'><b>Work Description:</b> ${esc(a.job_description)}</div>`:''}${ownerLiveAIHtml(a,prep,solarCheck)}${ownerAIJobTimeline(a,prep,solarCheck)}${ownerAIAlertHistoryHtml(a,prep,solarCheck)}${equipmentManifestInlineHtml(a)}${ticketPartsInlineHtml(a)}${automaticServiceSolarPlanHtml(a.equipment_manifest,a.work_type)}${heliosFinal}${a.notes?`<div class='small'><b>Owner Notes:</b> ${esc(a.notes)}</div>`:''}<div class='ownerVisionRowAction'>${a.status==='completed'?'':`<button class='mini' type='button' data-owner-edit-equipment='${esc(a.ticket_no)}'>Edit Equipment / Quantities</button>`}<a class='mini ownerVisionTicketLink' href='${esc(visionUrl)}'>Open in OnSite Vision →</a></div>${a.status==='completed'?'':ownerEquipmentEditorHtml(a)}</div>${a.status==='completed'?'':`<button class='mini danger' data-wl-cancel-assignment='${a.id}'>Cancel</button>`}</div>`;
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
          <div id='ownerAssignParts' class='wl-ticket-parts-setup'><div class='qtext' id='ownerEquipmentTotalHeading'>Equipment</div><div class='small' id='ownerEquipmentTotalHelp'>Choose the equipment type and quantity from MHelpDesk.</div>${ownerEquipmentManifestInputsHtml()}<div id='ownerAutoServicePlan' class='hidden'></div><div class='wl-requirement-section'><div class='wl-requirement-heading'>Replacement / Swap Categories</div><div class='small'><b>Workflow is automatic.</b> Any shop equipment or replacement parts selected for a Service job automatically place IT before Service.</div>${ticketPartsInputsHtml('ownerPart')}</div></div>
        </section>
        <section class='owner-simple-step owner-assign-tech-card'>
          <div class='owner-simple-step-head'><span class='owner-simple-step-icon'>♟</span><div><b>Who gets it?</b><span>Assign a technician or department.</span></div></div>
          <div id='ownerAutoFlowCard' class='owner-auto-flow-card'><span>AUTOMATIC WORKFLOW</span><b data-owner-auto-flow-label>SERVICE</b><small data-owner-auto-flow-reason>Tech Check chooses the department order from the job type, equipment, and parts.</small></div>
          <select id='ownerAssignRole' class='owner-simple-hidden-select' aria-label='Automatic department flow'><option value='it'>IT Department Only</option><option value='service'>Service Department Only</option><option value='it_service'>IT + Service Departments</option><option value='service_it'>Service + IT Departments</option></select>
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
let ownerAssignSubmitting=false;
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

function ownerAutomaticFlowRole(workType=document.getElementById('ownerAssignWorkType')?.value||'service', manifest=readOwnerEquipmentManifest(), parts=readTicketPartInputs('ownerPart')) {
  const type=String(workType||'service').toLowerCase();
  if(type==='pickup') return 'service_it';
  if(type==='delivery' || type==='swap') return 'it_service';
  const equipmentNeeded=equipmentManifestTotal(manifest)>0;
  const preparedParts=ticketPartsTotal(parts)>0;
  return (equipmentNeeded || preparedParts) ? 'it_service' : 'service';
}
function ownerAutomaticFlowLabel(workType=document.getElementById('ownerAssignWorkType')?.value||'service', role=ownerAutomaticFlowRole()) {
  const type=String(workType||'service').toLowerCase();
  if(type==='pickup') return 'SERVICE → IT INTAKE';
  if(type==='swap') return 'IT → SERVICE → IT INTAKE';
  if(type==='delivery') return 'IT → SERVICE';
  return role==='it_service' ? 'IT → SERVICE' : 'SERVICE';
}
function ownerAutomaticFlowReason(workType=document.getElementById('ownerAssignWorkType')?.value||'service', role=ownerAutomaticFlowRole()) {
  const type=String(workType||'service').toLowerCase();
  if(type==='pickup') return 'Service performs the field pickup first. Returned equipment then becomes available to IT Intake.';
  if(type==='swap') return 'IT prepares the replacement, Service performs the field swap, and the old or unused replacement returns through IT Intake.';
  if(type==='delivery') return 'IT prepares and verifies the equipment first. Service cannot start until the IT → Service handoff is ready.';
  if(role==='it_service') return 'This Service job includes shop equipment or replacement parts, so IT prepares them before Service starts.';
  return 'No shop equipment or replacement-part prep is required, so Service goes directly to the field.';
}
function applyOwnerAutomaticFlow(options={}) {
  const roleEl=document.getElementById('ownerAssignRole');
  if(!roleEl) return 'service';
  const desired=ownerAutomaticFlowRole();
  const changed=roleEl.value!==desired;
  roleEl.value=desired;
  roleEl.dataset.ownerConfirmed='1';
  roleEl.dataset.autoFlow='1';
  if(changed && options.refreshTechs!==false) refreshOwnerAssignmentTechOptions({skipWorkTypeRefresh:true,preserveExisting:true});
  const card=document.getElementById('ownerAutoFlowCard');
  if(card){
    const label=card.querySelector('[data-owner-auto-flow-label]');
    const reason=card.querySelector('[data-owner-auto-flow-reason]');
    if(label)label.textContent=ownerAutomaticFlowLabel(undefined,desired);
    if(reason)reason.textContent=ownerAutomaticFlowReason(undefined,desired);
  }
  return desired;
}

function refreshOwnerAssignmentTechOptions(options={}) {
  const role = document.getElementById('ownerAssignRole')?.value || ownerAutomaticFlowRole();
  const select = document.getElementById('ownerAssignTech');
  const hint = document.getElementById('ownerAssignTechHint');
  if (!select) return;
  const pills=document.getElementById('ownerAssignedTechPills');
  const existingIds=options.preserveExisting!==false
    ? [...(pills?.querySelectorAll('[data-tech-id]')||[])].map(el=>el.dataset.techId).filter(Boolean)
    : [];
  if(pills) pills.innerHTML='';

  const dual=role==='it_service'||role==='service_it';
  if(dual){
    select.disabled=false;
    select.innerHTML="<option value=''>Choose an IT or Service technician to add…</option>"+
      ownerAssignmentProfiles
        .filter(p=>p.role==='it'||p.role==='service')
        .map(p=>`<option value='${p.user_id}'>${esc(p.full_name || p.username || 'Technician')} — ${p.role==='it'?'IT':'Service'}</option>`).join('');
    if(hint)hint.textContent='Add specific technicians if needed. Any department without a selected technician will use that department queue automatically.';
  }else{
    select.disabled=false;
    select.innerHTML=ownerAssignmentTechOptions(role);
    if(hint)hint.textContent=`Select one or more ${role==='it'?'IT':'Service'} technicians. Leave all unselected to assign it to the ${role==='it'?'IT':'Service'} Department queue.`;
  }

  if(pills&&existingIds.length){
    existingIds.forEach(id=>{
      const p=ownerAssignmentProfiles.find(row=>row.user_id===id);
      if(!p)return;
      if(!dual&&p.role!==role)return;
      const label=(p.full_name||p.username||'Technician')+' — '+(p.role==='it'?'IT':'Service');
      const el=document.createElement('span');
      el.className='wl-tech-pill';
      el.dataset.techId=id;
      el.innerHTML=`<span>${esc(label)}</span><button type='button' data-owner-remove-tech aria-label='Remove ${esc(label)}'>×</button>`;
      pills.appendChild(el);
    });
  }
  document.getElementById('ownerAssignParts')?.classList.remove('hidden');
  if(!options.skipWorkTypeRefresh) refreshOwnerWorkTypeLabels({skipTechRefresh:true});
}
function refreshOwnerWorkTypeLabels(options={}) {
  const type=document.getElementById('ownerAssignWorkType')?.value||'service';
  const priorRole=document.getElementById('ownerAssignRole')?.value||'';
  const role=applyOwnerAutomaticFlow({refreshTechs:false});
  if(priorRole!==role&&!options.skipTechRefresh) refreshOwnerAssignmentTechOptions({skipWorkTypeRefresh:true,preserveExisting:true});
  syncOwnerSimplePills();

  const pickup=type==='pickup', swap=type==='swap', delivery=type==='delivery';
  const action=pickup?'Being Picked Up':swap?'Being Swapped':delivery?'Being Delivered':'Required';
  const flowHint=document.getElementById('ownerFlowHint');
  if(flowHint) flowHint.innerHTML=`<b>Automatic workflow:</b> ${esc(ownerAutomaticFlowLabel(type,role))}<br><span class='small'>${esc(ownerAutomaticFlowReason(type,role))}</span>`;

  const autoCard=document.getElementById('ownerAutoFlowCard');
  if(autoCard){
    const label=autoCard.querySelector('[data-owner-auto-flow-label]');
    const reason=autoCard.querySelector('[data-owner-auto-flow-reason]');
    if(label)label.textContent=ownerAutomaticFlowLabel(type,role);
    if(reason)reason.textContent=ownerAutomaticFlowReason(type,role);
  }

  const totalHeading=document.getElementById('ownerEquipmentTotalHeading');
  const totalHelp=document.getElementById('ownerEquipmentTotalHelp');
  if(totalHeading)totalHeading.textContent=pickup?'Total Equipment Being Picked Up':delivery?'Total Equipment Being Delivered':swap?'Total Equipment Being Swapped':'Equipment / Parts Required';
  if(totalHelp)totalHelp.textContent=type==='service'
    ? 'Only select equipment or replacement parts that must come from the shop. Selecting any automatically adds IT before Service.'
    : 'Enter each equipment type and quantity once. Enter the specific MHelpDesk equipment numbers below.';

  const unitHeading=document.querySelector('#ownerAssignParts .unitArea .wl-requirement-heading');
  if(unitHeading)unitHeading.textContent=`UNIT AREA — Units / Devices ${action}`;
  const unitHelp=document.querySelector('#ownerAssignParts .unitArea .small');
  if(unitHelp)unitHelp.textContent=pickup
    ? 'Enter the unit types and quantities being PICKED UP from the customer/site. These are coming back to the shop — they are not shelf inventory.'
    : swap
      ? 'Enter the replacement units going out for the SWAP. IT will prepare them before Service can leave.'
      : delivery
        ? 'Enter the unit types and quantities being DELIVERED. IT will prepare them before Service can leave.'
        : 'For Service jobs, select equipment here only when something must be prepared at the shop before Service goes to the field.';

  const standHeading=document.querySelector('#ownerAssignParts .standArea .wl-requirement-heading');
  if(standHeading)standHeading.textContent=pickup
    ? 'STAND AREA — Solar Stands / Poles / Panels Being Picked Up'
    : swap
      ? 'STAND AREA — Solar Stands / Poles / Panels Being Swapped'
      : delivery
        ? 'STAND AREA — Solar Stands / Poles / Panels Being Delivered'
        : 'STAND AREA — Shop Equipment Needed for Service';
  const standHelp=document.querySelector('#ownerAssignParts .standArea .small');
  if(standHelp)standHelp.textContent=pickup
    ? 'Enter the solar stands, poles, and removable solar panels being PICKED UP and returned to the shop.'
    : swap
      ? 'Enter the solar stands, poles, and removable solar panels being SWAPPED.'
      : delivery
        ? 'Enter any solar stands, poles, and removable solar panels being DELIVERED. Automatic Solar Spotter/Ranger requirements still apply.'
        : 'Use this only when the Service job requires this equipment to leave the shop.';

  document.querySelectorAll('#ownerAssignParts [data-owner-stock-count]').forEach(el=>{el.style.display=pickup?'none':'';});
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
  // Department flow is automatic from job type + equipment/parts.

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
  applyOwnerAutomaticFlow();
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
  applyOwnerAutomaticFlow();
  const manifest=readOwnerEquipmentManifest();
  const roleValue=role?.value||"";
  const partsOnlyCount=ticketPartsTotal(readTicketPartInputs("ownerPart"));
  if ((roleValue==="it" || roleValue==="it_service" || roleValue==="service_it") && !manifest.length && partsOnlyCount<1) missing.push("equipment type / quantity or loose parts");
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
  const flow=ownerAutomaticFlowLabel(a.work_type,a.role);
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
  const role=document.getElementById('ownerAssignRole')?.value||ownerAutomaticFlowRole();
  document.querySelectorAll('[data-owner-work-pill]').forEach(b=>b.classList.toggle('selected',b.dataset.ownerWorkPill===work));
  document.querySelectorAll('[data-owner-role-pill]').forEach(b=>b.classList.toggle('selected',b.dataset.ownerRolePill===role));
  const card=document.getElementById('ownerAutoFlowCard');
  if(card){
    const label=card.querySelector('[data-owner-auto-flow-label]');
    const reason=card.querySelector('[data-owner-auto-flow-reason]');
    if(label)label.textContent=ownerAutomaticFlowLabel(work,role);
    if(reason)reason.textContent=ownerAutomaticFlowReason(work,role);
  }
}
function ownerAIReview(){
  const role=applyOwnerAutomaticFlow();
  const a=ownerAIDraft(),type=a.work_type,issues=[];
  const manifest=normalizedEquipmentManifest(a.equipment_manifest||[]);
  const deviceCount=equipmentManifestDeviceTotal(manifest),standCount=equipmentManifestStandTotal(manifest);
  const un=(document.getElementById('ownerAssignUnitNumbers')?.value||'').split(',').map(v=>v.trim()).filter(Boolean);
  const sn=(document.getElementById('ownerAssignStandNumbers')?.value||'').split(',').map(v=>v.trim()).filter(Boolean);
  const parts=readTicketPartInputs('ownerPart');
  if(!a.ticket_no)issues.push('Enter the MHelpDesk ticket number.');
  if(!a.job_description)issues.push('Add a short description of what needs to be done.');
  if((type==='delivery'||type==='swap'||type==='pickup')&&deviceCount+standCount<1)issues.push('Choose the equipment involved in this job.');
  const autoSolarPlan=automaticServiceSolarPlan(manifest,type);
  if(autoSolarPlan.spotters>0&&manifestQty(manifest,'Solar Stand')>0)issues.push('Remove Solar Stand from the IT list. Service gets it automatically after the IT handoff.');
  if(deviceCount&&un.length&&deviceCount!==un.length)issues.push('The unit quantity and the number of Unit #s do not match.');
  if(standCount&&sn.length&&standCount!==sn.length)issues.push('The stand quantity and the number of Stand #s do not match.');

  const box=document.getElementById('ownerAIReviewBox');if(!box)return;
  box.classList.remove('hidden','is-ready','is-pending');
  box.classList.toggle('ready',issues.length===0);
  box.classList.toggle('pending',issues.length>0);
  const flow=ownerAutomaticFlowLabel(type,role);
  const equipmentText=manifest.length?manifest.map(r=>r.qty+' × '+equipmentDisplayLabel(r.label)).join(', '):'No shop equipment selected';
  const partTotal=Object.values(parts).reduce((sum,v)=>sum+Number(v||0),0);
  const summary=[type.toUpperCase(),flow,equipmentText,partTotal?partTotal+' extra part'+(partTotal===1?'':'s'):null].filter(Boolean);
  box.innerHTML=issues.length
    ? `<h3>${issues.length===1?'Almost done — one thing left':'Almost done — '+issues.length+' things left'}</h3><p>Fix the item${issues.length===1?'':'s'} below, then assign the job.</p><div class='owner-simple-review-list'>${issues.slice(0,4).map(v=>'<div><i>→</i><span>'+esc(v)+'</span></div>').join('')}</div><div class='owner-simple-summary'>${summary.map(v=>'<span>'+esc(v)+'</span>').join('')}</div>`
    : `<h3>✓ Ready to assign</h3><p>Tech Check chose the workflow automatically.</p><div class='owner-simple-summary'>${summary.map(v=>'<span>'+esc(v)+'</span>').join('')}</div>`;
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
  let role = document.getElementById('ownerAssignRole')?.value || 'service';
  const assignees = [...document.querySelectorAll('#ownerAssignedTechPills [data-tech-id]')].map(el => el.dataset.techId).filter(Boolean);
  const serviceQueueSelected = !!document.querySelector('#ownerAssignedTechPills [data-queue-role="service"]');
  const assignee = assignees[0] || null;
  const notes = document.getElementById('ownerAssignNotes')?.value.trim() || '';
  const scheduledFor = document.getElementById('ownerAssignDate')?.value || techCheckDateKey(new Date());
  const scheduledTime = document.getElementById('ownerAssignTime')?.value || '';
  const workType = document.getElementById('ownerAssignWorkType')?.value || 'service';
  const equipmentManifest = readOwnerEquipmentManifest();
  const parts = readTicketPartInputs('ownerPart');
  role = ownerAutomaticFlowRole(workType,equipmentManifest,parts);
  const roleEl=document.getElementById('ownerAssignRole');
  if(roleEl)roleEl.value=role;
  if (!ticket) return alert('Enter the MHelpDesk reference number.');
  const selectedDeviceCount = equipmentManifestDeviceTotal(equipmentManifest);
  const selectedStandCount = equipmentManifestStandTotal(equipmentManifest);
  if (['it','it_service','service_it'].includes(role) && selectedDeviceCount + selectedStandCount < 1 && ticketPartsTotal(parts) < 1) return alert('Choose equipment or at least one loose part because this workflow includes IT.');
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
    const flow=ownerAutomaticFlowLabel(workType,role);
    const techNames=assignees.map(id=>ownerAssignmentProfiles.find(p=>p.user_id===id)?.full_name||ownerAssignmentProfiles.find(p=>p.user_id===id)?.username).filter(Boolean);
    const confirmText="ONSITE VISION CONFIRMATION\n\nMHelpDesk #"+ticket+"\nSite: "+(site||"—")+"\nWork date/time: "+ownerAIScheduleText(scheduledFor,scheduledTime)+"\nJob: "+workType.toUpperCase()+"\nFlow: "+flow+"\nAssigned: "+(techNames.length?techNames.join(", "):"Department queue")+"\nEquipment: "+eq+"\n\nAssign this Tech Check job?";
    if (!confirm(confirmText)) return;
  }

  if(ownerAssignSubmitting)return;
  ownerAssignSubmitting=true;
  document.body.classList.add('busy');
  const assignButton=document.querySelector('[data-wl-owner-assign]');
  const originalAssignText=assignButton?.textContent||'Assign Job →';
  if(assignButton){assignButton.disabled=true;assignButton.textContent='Assigning…';}
  const dualDept = role === 'it_service' || role === 'service_it';
  const orderedRoles = workType === 'pickup' && dualDept ? ['service','it'] : (role === 'service_it' ? ['service','it'] : ['it','service']);
  const targets = dualDept
    ? orderedRoles.flatMap(r => { const ids=assignees.filter(id => ownerAssignmentProfiles.find(p=>p.user_id===id)?.role===r); if(r==='service' && serviceQueueSelected) return [{role:'service',assignee:null}]; return ids.length ? ids.map(id=>({role:r,assignee:id})) : [{role:r,assignee:null}]; })
    : (assignees.length ? assignees.map(id => ({ role, assignee:id })) : [{ role, assignee:null }]);
  const unitSummary=[units, unitNumbers ? 'Unit #s: '+unitNumbers : '', standNumbers ? 'Stand / Solar Stand #s: '+standNumbers : ''].filter(Boolean).join(' | ');
  const bundleTargets=targets.map(target=>({
    role:target.role,
    assignee_user_id:target.assignee||null,
    requires_it_handoff:workType==='pickup'
      ? false
      : (role==='it_service' && target.role==='service')
  }));
  const { data: assignmentBundle, error: assignmentError } = await liveDb.rpc('owner_assign_job_bundle_v1', {
    p_request:{
      ticket_no:ticket,
      site,
      targets:bundleTargets,
      requested_unit_count:requestedUnitCount,
      unit_summary:unitSummary,
      job_description:description,
      notes,
      solar_panel_qty:parts.solar_panel_qty,
      battery_replacement_qty:parts.battery_replacement_qty,
      camera_replacement_qty:parts.camera_replacement_qty,
      sim_replacement_qty:parts.sim_replacement_qty,
      micro_sd_qty:parts.micro_sd_qty,
      equipment_manifest:equipmentManifest,
      scheduled_for:scheduledFor,
      scheduled_time:scheduledTime||null,
      work_type:workType
    }
  });
  if (assignmentError) {
    ownerAssignSubmitting=false;
    document.body.classList.remove('busy');
    if(assignButton&&document.contains(assignButton)){assignButton.disabled=false;assignButton.textContent=originalAssignText;}
    return alert(assignmentError.message);
  }
  const assignmentIds=(assignmentBundle?.assignments||[]).map(row=>row?.assignment_id).filter(Boolean);
  const pushAssignmentIds=(assignmentBundle?.push_assignment_ids||[]).filter(Boolean);

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

  ownerAssignSubmitting=false;
  document.body.classList.remove('busy');
  if(assignButton&&document.contains(assignButton)){assignButton.disabled=false;assignButton.textContent=originalAssignText;}
  ownerClearAssignDraft();
  ['ownerAssignTicket','ownerAssignSite','ownerAssignUnitNumbers','ownerAssignStandNumbers','ownerAssignDescription','ownerAssignNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const dateInput=document.getElementById('ownerAssignDate'); if (dateInput) dateInput.value=techCheckDateKey(new Date());
  const timeInput=document.getElementById('ownerAssignTime'); if (timeInput) timeInput.value='';
  const workTypeInput=document.getElementById('ownerAssignWorkType'); if (workTypeInput) workTypeInput.value='service';
  const roleInput=document.getElementById('ownerAssignRole'); if(roleInput) roleInput.value='service';
  const techPills=document.getElementById('ownerAssignedTechPills'); if(techPills) techPills.innerHTML='';
  fillTicketPartInputs({}, 'ownerPart');
  document.querySelectorAll('#ownerJobAssignments [data-owner-equipment-qty]').forEach(input => { input.value='0'; });
  ownerAIDispatchPrepared=false;
  ownerAIDispatchLastParse=null;
  await installOwnerAssignments(true);
  const target = ownerAutomaticFlowLabel(workType,role);
  alert('Assigned to ' + target + ' in Tech Check.' + pushMessage + ' MHelpDesk remains unchanged.');
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
  const menuGo=e.target.closest('[data-wl-menu-go]');
  if(menuGo){
    document.getElementById('wlTechMenuPanel')?.classList.add('hidden');
    const action=menuGo.dataset.wlMenuGo;
    if(action==='service-home')return showSvcHome();
    if(action==='service-ticket')return showServiceJobLookup();
    if(action==='service-return')return showServiceReturn();
    if(action==='service-returns')return showServiceReturnHistory();
    if(action==='service-offline')return showOfflineUnitForm();
    if(action==='service-history')return showInspectionHistory();
    if(action==='it-home')return showITHome();
    if(action==='it-ticket')return showITJobLookup();
    if(action==='it-intake')return showITIntake();
    if(action==='it-prep')return showPendingList();
    if(action==='it-history')return showITStatus();
  }
  if (e.target.closest('[data-wl-menu-help]')) {
    const role=currentRoleKey();
    if(['service','it'].includes(role)){document.getElementById('wlTechMenuPanel')?.classList.add('hidden');return startGuidedTour(role,false);}
    return openHelpCenter();
  }
  if (e.target.closest('[data-wl-menu-notifications]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return openNotificationPanel(); }
  if (e.target.closest('[data-wl-menu-signout]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return window.logout?.(); }
  if (e.target.closest('[data-wl-menu-phone-alerts]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); return enableBrowserAlerts(); }
  if (e.target.closest('[data-wl-menu-refresh]')) { document.getElementById('wlTechMenuPanel')?.classList.add('hidden'); await window.refreshData?.(); return; }
  if (e.target.closest('[data-wl-menu-ai-dispatch]')) return openOwnerAIDispatch();
  if (e.target.closest('#helpTrainingButton')) { const role=currentRoleKey(); return ['service','it'].includes(role)?startGuidedTour(role,false):openHelpCenter(); }
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
  const workflowRepair=e.target.closest('[data-owner-repair-workflow]');
  if(workflowRepair)return ownerRepairWorkflow(workflowRepair.dataset.ownerRepairWorkflow);
  const heliosReview=e.target.closest('[data-wl-owner-helios-review]'); if(heliosReview) return ownerOpenHeliosFinalReview(heliosReview.dataset.wlOwnerHeliosReview);
  const heliosVerify=e.target.closest('[data-wl-owner-helios-verify]'); if(heliosVerify) return ownerVerifyHeliosFinal(heliosVerify.dataset.wlOwnerHeliosVerify);
  if(e.target.closest('[data-wl-owner-helios-close]')) { document.getElementById('ownerHeliosFinalReview')?.remove(); return; }
  if(e.target.closest('[data-wl-tour-close]')) return finishGuidedTour(false);
  if(e.target.closest('[data-wl-tour-back]')) { guidedTourStep=Math.max(0,guidedTourStep-1); return showGuidedTourStep(); }
  if(e.target.closest('[data-wl-tour-next]')) { const steps=guidedTourSteps(guidedTourRole); if(guidedTourStep>=steps.length-1)return finishGuidedTour(true); guidedTourStep++; return showGuidedTourStep(); }
  if (e.target.closest('[data-wl-help-skip]')) { walkthroughDismissedSession = true; document.getElementById('wlHelpOverlay')?.classList.add('hidden'); return; }
  if (e.target.closest('[data-wl-help-prev]')) { helpWalkthroughStep = Math.max(0, helpWalkthroughStep - 1); return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-help-next]')) { const pages=helpWalkthroughPages(helpWalkthroughRole || currentRoleKey()); if (helpWalkthroughStep >= pages.length - 1) return completeHelpWalkthrough(); helpWalkthroughStep++; return renderHelpWalkthrough(); }
  if (e.target.closest('[data-wl-enable-browser-alerts]')) return enableBrowserAlerts();
  if (e.target.closest('[data-wl-it-find-home-job]')) return openITHomeTicketSearch();
  if (e.target.closest('[data-wl-it-open-job]')) return showITJobLookup();
  if (e.target.closest('[data-wl-it-find-job]')) return itFindJobByTicket();
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
    if(ownerRolePill){applyOwnerAutomaticFlow();ownerAIReview();return;}

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
  const cancelAssignment = e.target.closest('[data-wl-cancel-assignment]');
  if (cancelAssignment) return ownerCancelAssignment(cancelAssignment.dataset.wlCancelAssignment);
});
document.addEventListener('change', e => {
  if (e.target?.matches?.('.wl-file')) {
    const panel=e.target.closest('.wl-proof');
    if(panel?.dataset.stage==='service' && (e.target.files?.length||0)){
      panel.querySelectorAll('.wl-file').forEach(input=>{if(input!==e.target)input.value='';});
    }
    const count=e.target.files?.length||0;
    const status=panel?.querySelector('[data-wl-photo-selected]');
    if(status) status.textContent=count ? (count===1?'✓ PHOTO READY TO SAVE':('✓ '+count+' PHOTOS READY TO SAVE')) : 'No photo selected yet.';
    const preview=panel?.querySelector('[data-wl-photo-preview]');
    if(preview){
      const files=[...(e.target.files||[])];
      preview.innerHTML=files.length ? "<div class='wl-solar-preview-grid'>"+files.map((file,index)=>"<img src='"+URL.createObjectURL(file)+"' alt='Selected photo "+(index+1)+"'>").join('')+"</div>" : '';
    }
    const save=panel?.querySelector('[data-wl-upload]');
    if(save){save.disabled=!count;save.textContent=count?(count===1?'SAVE PHOTO →':('SAVE '+count+' PHOTOS →')):'Save Photo';}
  }

  if (e.target?.id === 'ownerAssignDate') e.target.dataset.ownerConfirmed='1';
  if (e.target?.id === 'ownerAssignTime') e.target.dataset.ownerConfirmed='1';
  if (e.target?.id === 'ownerAssignWorkType') {
    e.target.dataset.ownerConfirmed='1';
    applyOwnerAutomaticFlow();
    refreshOwnerWorkTypeLabels();
    refreshOwnerAutoServicePlan();
  }
  if(e.target?.closest?.('#ownerJobAssignments')&&e.target?.matches?.('input,select,textarea')) {
    if(e.target?.matches?.('[data-owner-equipment-qty]')||e.target?.id?.startsWith('ownerPart')){
      applyOwnerAutomaticFlow();
      refreshOwnerWorkTypeLabels();
      refreshOwnerAutoServicePlan();
    }
    ownerSaveAssignDraftNow();
    ownerAIReview();
  }
});

document.addEventListener('input', e => { if (e.target?.id === 'ownerReturnSearch') filterOwnerReturns(e.target.value); if(e.target?.matches?.('[data-owner-equipment-qty]')||e.target?.id?.startsWith('ownerPart')) {applyOwnerAutomaticFlow();refreshOwnerWorkTypeLabels();refreshOwnerAutoServicePlan();} if(e.target?.closest?.('#ownerJobAssignments')&&e.target?.matches?.('input,textarea')) {ownerSaveAssignDraftNow();ownerAIReview();} if (e.target?.id === 'wlReturnTicket') { serviceReturn.ticket=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnUnit') { if(norm(e.target.value)!==norm(serviceReturn.unit)){serviceReturn.photo=null;serviceReturn.tagScan=null;} serviceReturn.unit=e.target.value; saveServiceReturnDraft(); } if (e.target?.id === 'wlReturnNotes') { serviceReturn.notes=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('change', e => { if(e.target?.id==='wlOfflineKnownUnit'){const card=document.getElementById('wlOfflineUnitForm');let units=[];try{units=JSON.parse(card?.dataset.units||'[]');}catch{}const u=units[Number(e.target.value)]||{};const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};set('wlOfflineTicket',u.ticket_no);set('wlOfflineSite',u.site);set('wlOfflineUnit',u.unit_tag);set('wlOfflineType',u.equipment_type);} if (e.target?.id === 'wlReturnType') { if(serviceReturn.type!==e.target.value){serviceReturn.photo=null;serviceReturn.tagScan=null;} serviceReturn.type=e.target.value; saveServiceReturnDraft(); } });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if(e.target?.id==='wlITJobSearch'){e.preventDefault();itFindJobByTicket();return;} if(e.target?.id==='ownerUnitLookupInput'){e.preventDefault();ownerLookupUnitHistory();return;} if (e.target?.id === 'wlItUnitValue' || e.target?.id === 'wlReconRequired') { e.preventDefault(); document.querySelector('#wlItWizardOnly [data-wl-it-next]')?.click(); return; } if (e.target?.id === 'wlSvcCount') { e.preventDefault(); document.querySelector('#wlSvcWizardOnly [data-wl-svc-next]')?.click(); return; } if (e.target?.id === 'wlTicketInput') { e.preventDefault(); document.querySelector('[data-wl-match]')?.click(); return; } if (e.target?.id === 'wlReturnTicket' || e.target?.id === 'wlReturnUnit') { e.preventDefault(); document.querySelector('#wlSvcReturn [data-wl-return-next]')?.click(); } });
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
      techDashboardTimeout(installOwnerFieldEscalations(force),null,12000),
      techDashboardTimeout(installOwnerWorkflowHealth(),null,12000)
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

let techWorkflowRealtimeChannel=null;
let techWorkflowRealtimeUserId=null;
let techWorkflowRealtimeGeneration=0;
let techWorkflowRealtimeState='reconnecting';
let techWorkflowReconnectTimer=null;
let techWorkflowRefreshTimer=null;
let techWorkflowHeartbeatTimer=null;
let techWorkflowRefreshPending=false;
let techWorkflowReconnectAttempt=0;
const techWorkflowEventSeen=new Map();

function techLiveIndicator(){
  let el=document.getElementById('wlTechLiveStatus');
  if(!el){
    el=document.createElement('div');
    el.id='wlTechLiveStatus';
    el.className='wl-tech-live-status reconnecting';
    el.innerHTML="<i></i><span>RECONNECTING</span>";
    document.body.append(el);
  }
  return el;
}
function setTechLiveStatus(state='reconnecting'){
  techWorkflowRealtimeState=state;
  const el=techLiveIndicator();
  const appVisible=!document.getElementById('appView')?.classList.contains('hidden');
  el.classList.toggle('hidden',!appVisible);
  el.classList.remove('live','reconnecting','offline');
  const normalized=state==='live'?'live':state==='offline'?'offline':'reconnecting';
  el.classList.add(normalized);
  const label=normalized==='live'?'LIVE':normalized==='offline'?'OFFLINE':'RECONNECTING';
  const span=el.querySelector('span'); if(span)span.textContent=label;
}
function techElementVisible(el){
  if(!el)return false;
  if(el.classList.contains('hidden')||el.style.display==='none')return false;
  let parent=el.parentElement;
  while(parent&&parent!==document.body){
    if(parent.classList?.contains('hidden')||parent.style?.display==='none')return false;
    parent=parent.parentElement;
  }
  return true;
}
function techWorkflowEventKey(source,payload){
  const row=payload?.new||payload?.old||payload?.payload||{};
  const id=row.id||row.assignment_id||row.ticket_no||'global';
  const stamp=row.updated_at||row.released_at||row.closed_at||row.status||payload?.eventType||payload?.type||'event';
  return source+'|'+id+'|'+stamp;
}
function techWorkflowDuplicate(source,payload){
  const now=Date.now(),key=techWorkflowEventKey(source,payload);
  for(const [k,t] of techWorkflowEventSeen){if(now-t>5000)techWorkflowEventSeen.delete(k);}
  if(techWorkflowEventSeen.has(key))return true;
  techWorkflowEventSeen.set(key,now);
  return false;
}
async function forceTechWorkflowRefresh(reason='live'){
  if(document.hidden||document.getElementById('appView')?.classList.contains('hidden'))return;
  techWorkflowRefreshPending=false;
  const role=currentRoleKey();
  if(role==='owner'){
    scheduleOwnerRefresh(true,reason==='resume'?80:140);
    return;
  }
  if(role==='it'&&!viewIT()?.classList.contains('hidden')){
    if(techElementVisible(document.getElementById('wlItHome'))||techElementVisible(document.getElementById('wlItDayComplete')))return showITHome();
    if(techElementVisible(document.getElementById('wlItJobLookup'))){
      const input=document.getElementById('wlITJobSearch');
      if(input?.value?.trim())return itFindJobByTicket();
    }
    if(techElementVisible(document.getElementById('wlPendingList')))return showPendingList();
    techWorkflowRefreshPending=true;
    return;
  }
  if(role==='service'&&!viewSvc()?.classList.contains('hidden')){
    if(techElementVisible(document.getElementById('wlSvcHome'))||techElementVisible(document.getElementById('wlSvcDayComplete')))return showSvcHome();
    if(techElementVisible(document.getElementById('wlSvcLookup'))){
      const input=document.getElementById('wlServiceJobSearch');
      if(input?.value?.trim())return serviceFindJobByTicket();
    }
    if(techElementVisible(document.getElementById('wlSvcSpareResolution'))&&!document.querySelector('.wl-unused-backup-proof'))return showServiceSpareResolution();
    techWorkflowRefreshPending=true;
  }
}
function scheduleTechWorkflowRefresh(source='live',payload=null,delay=220){
  if(payload&&techWorkflowDuplicate(source,payload))return;
  clearTimeout(techWorkflowRefreshTimer);
  techWorkflowRefreshTimer=setTimeout(()=>forceTechWorkflowRefresh(source),delay);
}
function scheduleTechWorkflowReconnect(){
  clearTimeout(techWorkflowReconnectTimer);
  if(document.hidden||navigator.onLine===false)return;
  techWorkflowReconnectAttempt++;
  const delay=Math.min(12000,1200*Math.pow(1.7,Math.min(techWorkflowReconnectAttempt,5)));
  techWorkflowReconnectTimer=setTimeout(()=>setupTechWorkflowRealtime(true),delay);
}
async function sendTechWorkflowBroadcast(kind,payload={}){
  const channel=techWorkflowRealtimeChannel;
  if(!channel||techWorkflowRealtimeState!=='live')return;
  try{
    await channel.send({type:'broadcast',event:'workflow',payload:{kind,at:new Date().toISOString(),...payload}});
  }catch(error){console.warn('Workflow broadcast failed',error);}
}
function onTechWorkflowDbEvent(table,payload){
  scheduleTechWorkflowRefresh(table,payload);
}
async function setupTechWorkflowRealtime(force=false){
  if(document.getElementById('appView')?.classList.contains('hidden'))return;
  const tech=await currentTechIdentity().catch(()=>null);
  if(!tech?.id)return;
  if(!force&&techWorkflowRealtimeChannel&&techWorkflowRealtimeUserId===tech.id)return;

  const generation=++techWorkflowRealtimeGeneration;
  clearTimeout(techWorkflowReconnectTimer);
  if(techWorkflowRealtimeChannel){
    const old=techWorkflowRealtimeChannel;
    techWorkflowRealtimeChannel=null;
    try{await liveDb.removeChannel(old);}catch{}
  }

  techWorkflowRealtimeUserId=tech.id;
  setTechLiveStatus(navigator.onLine===false?'offline':'reconnecting');
  if(navigator.onLine===false)return;

  const channel=liveDb.channel('tech-check-workflow-live-v4')
    .on('broadcast',{event:'workflow'},message=>{
      if(generation!==techWorkflowRealtimeGeneration)return;
      scheduleTechWorkflowRefresh('broadcast',message);
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'job_assignments'},payload=>onTechWorkflowDbEvent('job_assignments',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'prep_tickets'},payload=>onTechWorkflowDbEvent('prep_tickets',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'prep_items'},payload=>onTechWorkflowDbEvent('prep_items',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'unit_returns'},payload=>onTechWorkflowDbEvent('unit_returns',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'truck_spare_batteries'},payload=>onTechWorkflowDbEvent('truck_spare_batteries',payload))
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},payload=>{
      if(currentRoleKey()==='owner')onTechWorkflowDbEvent('profiles',payload);
    });

  techWorkflowRealtimeChannel=channel;
  channel.subscribe(status=>{
    if(generation!==techWorkflowRealtimeGeneration||channel!==techWorkflowRealtimeChannel)return;
    if(status==='SUBSCRIBED'){
      techWorkflowReconnectAttempt=0;
      setTechLiveStatus('live');
      scheduleTechWorkflowRefresh('subscribed',null,80);
      return;
    }
    if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
      setTechLiveStatus(navigator.onLine===false?'offline':'reconnecting');
      scheduleTechWorkflowReconnect();
    }
  });

  if(!techWorkflowHeartbeatTimer){
    techWorkflowHeartbeatTimer=setInterval(()=>{
      if(document.hidden||document.getElementById('appView')?.classList.contains('hidden'))return;
      if(navigator.onLine===false){setTechLiveStatus('offline');return;}
      // Safety sync covers RLS edge cases such as a department job being claimed by someone else.
      forceTechWorkflowRefresh('safety');
    },30000);
  }
}

function setupOwnerLiveRealtime(){
  return setupTechWorkflowRealtime();
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
  setupTechWorkflowRealtime();
  if (roleText().includes('Owner/Admin')) setupServiceSolarRealtime();
  refreshNotificationBadge();
  if (roleText().includes('Owner/Admin')) organizeOwnerDashboard();

  const appVisible = !document.getElementById('appView')?.classList.contains('hidden');
  if (!appVisible) { setTechLiveStatus('reconnecting'); return; }

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
window.addEventListener('techcheck:owner-test-role', async event => {
  const role=event?.detail?.preview_role;
  const ticket=String(event?.detail?.ticket||'');
  if(role==='service'){
    document.getElementById('wlSvcHome')?.remove();
    await showSvcHome();
    setTimeout(()=>{const input=document.getElementById('wlServiceJobSearch');if(input&&ticket)input.value=ticket;},120);
  }else if(role==='it'){
    document.getElementById('wlItHome')?.remove();
    await showITHome();
  }
});

let lastLifecycleRefresh=0;
function refreshAfterResume() {
  if (document.hidden) return;
  const now=Date.now();
  if (now-lastLifecycleRefresh < 5000) return;
  lastLifecycleRefresh=now;
  setTechLiveStatus(navigator.onLine===false?'offline':'reconnecting');
  scheduleBoot();
  setupTechWorkflowRealtime(true);
  setupNotificationRealtime(true);
  forceTechWorkflowRefresh('resume');
  if (roleText().includes('Owner/Admin')) scheduleOwnerRefresh(true,80);
}
document.addEventListener('visibilitychange', refreshAfterResume);
window.addEventListener('focus', refreshAfterResume);
window.addEventListener('pageshow',event=>{if(event.persisted)refreshAfterResume();});
window.addEventListener('online',()=>{
  setTechLiveStatus('reconnecting');
  setupTechWorkflowRealtime(true);
  setupNotificationRealtime(true);
  forceTechWorkflowRefresh('online');
});
window.addEventListener('offline',()=>setTechLiveStatus('offline'));
window.addEventListener('beforeunload', ownerSaveAssignDraftNow);
boot();

// ASSIGNMENT_NOTIFICATION_PUBLISH_STAMP_V1

// OWNER_ASSIGNMENT_TOP_CARD_V2
