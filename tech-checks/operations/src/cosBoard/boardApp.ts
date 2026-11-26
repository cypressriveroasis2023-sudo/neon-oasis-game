// @ts-nocheck
/* The COS Board screen, running inside the Fleet page.
 *
 * This is the board's own drawing code, so the tiles, unit list and unit page are the same screen James uses,
 * not a second design. What changed for the app:
 *  - it draws inside a shadow root, so its styles and the app's styles cannot touch each other;
 *  - it is handed the app's camera feed and mHelp list (see boardData.ts) and never reads anything itself;
 *  - shop or field, and up or down, are the app's shared count's own calls, not a second set of rules;
 *  - a hand fix is handed to Fleet, which saves it through the same route as Camera status. The board itself
 *    still sends nothing. The work log and the board's own tech check form need a place to save and are off.
 */
import mapData from './boardMap.json';
import {BOARD_CSS} from './boardStyle';
import {troubleWalk, troubleKnown, troubleNote, TROUBLE_CSS} from './boardTrouble';
import {ROUTER_DETAIL_FRESH_MS, signalWord, milesBetween, unitKeyOf} from '../routerDetails';

/* The router box on a unit card: the open-router button, signal bars and the warnings. */
const ROUTER_CSS = `
.rtr .rtop{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.rtr .rbtn{display:flex;flex-direction:column;gap:2px;padding:12px 14px;margin:0 0 12px;border-radius:10px;background:#0e7a3c;color:#fff;text-decoration:none;border:1px solid #13a352}
.rtr .rbtn b{font-size:16px}.rtr .rbtn span{font-size:12px;opacity:.85}
.rtr .rbtn:hover,.rtr .rbtn:focus-visible{background:#11904a;outline:2px solid #fff;outline-offset:2px}
.rtr .rbtn.off{background:#2a2d33;border-color:#555;color:#ddd}.rtr .rbtn.off:hover,.rtr .rbtn.off:focus-visible{background:#33373e}
.rtr .bars{display:inline-flex;align-items:flex-end;gap:2px;height:14px;vertical-align:middle}
.rtr .bars i{display:block;width:4px;background:rgba(255,255,255,.18);border-radius:1px}
.rtr .bars i:nth-child(1){height:20%}.rtr .bars i:nth-child(2){height:40%}.rtr .bars i:nth-child(3){height:60%}.rtr .bars i:nth-child(4){height:80%}.rtr .bars i:nth-child(5){height:100%}
.rtr .bars.good i.on{background:#2ecc71}.rtr .bars.fair i.on{background:#f1c40f}.rtr .bars.poor i.on{background:#e74c3c}.rtr .bars i.on{background:#9aa}
.rtr .note.warn{color:#ffcf66;border-left:3px solid #ffcf66;padding-left:8px}
.rtr dd a{color:inherit}
`;

const SHELL = "<div class=\"cosb\" id=\"cosb\"><header class=\"top\"><div class=\"wrap\">\n  <div class=\"logo\"><span class=\"mk\" aria-hidden=\"true\"><i></i></span><div><h1>COS Board</h1><div class=\"eyebrow\">Cameras Onsite</div></div></div>\n  <span class=\"topbtns\"><button class=\"tvgo\" id=\"tvGo\" type=\"button\">TV board</button><button class=\"refresh\" id=\"refresh\" type=\"button\">Refresh</button></span>\n</div></header>\n<div class=\"asof\" id=\"asof\"><div class=\"wrap\"><span id=\"asofMain\">Loading the camera reading…</span><span id=\"asofSub\"></span></div></div>\n\n<main class=\"wrap\">\n  <div class=\"tabs\" role=\"tablist\">\n    <button class=\"tab\" role=\"tab\" id=\"tabBoard\" aria-selected=\"true\" type=\"button\">Board</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabMap\" aria-selected=\"false\" type=\"button\">Map</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabTech\" aria-selected=\"false\" type=\"button\">Tech check</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabManager\" aria-selected=\"false\" type=\"button\" hidden>Manager</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabPunch\" aria-selected=\"false\" type=\"button\">Punch list</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabActivity\" aria-selected=\"false\" type=\"button\">Changes</button>\n  </div>\n\n  <section id=\"viewBoard\">\n    <div id=\"boardMain\">\n    <div class=\"mode\" id=\"modeRow\"></div>\n    <div class=\"kpi\" id=\"kpi\">\n    <p class=\"provnote\" id=\"provNote\" hidden></p>\n    <div class=\"tiles\" id=\"tiles\"></div>\n    <div class=\"shoprow\" id=\"shoprow\"></div>\n    </div>\n    <div id=\"boardList\">\n    <div class=\"controls\">\n      <input class=\"search\" id=\"q\" type=\"search\" placeholder=\"Find a unit, site, A# or IP\" autocomplete=\"off\" aria-label=\"Find a unit, site, A number or IP\">\n      <div class=\"chips\" id=\"fam\"></div>\n    </div>\n    <div class=\"count\" id=\"count\"></div>\n    <div class=\"list\" id=\"list\"></div>\n    <div class=\"screens\" id=\"screensRow\"><h3>Other COS screens</h3><div class=\"links\" id=\"screensLinks\"></div></div><ul class=\"foot\"><li>One unit counts once, however many cameras it has.</li><li>One count here, and it is mHelp’s camera units. mHelp’s own field total is higher because it counts stands and poles as well. The camera systems see fewer, because some units in mHelp have no camera record in COS yet; those show Unknown.</li><li>A unit in the shop never counts as down.</li><li>A reading that is missing or too old shows Unknown, never Down.</li><li>Router checks are a reference only. A router online does not prove the cameras work.</li><li>Hand fixes made here are saved in COS with your name and the time. Nothing here changes mHelp, Star4Live or InHand.</li></ul>\n    </div>\n    </div>\n    <aside id=\"boardSide\" aria-label=\"Map of field units\" hidden></aside>\n  </section>\n\n  <section id=\"viewMap\" hidden>\n    <div id=\"mapBlock\">\n    <div class=\"chips\" id=\"mapChips\"></div>\n    <div class=\"chips\" id=\"mapGo\" style=\"margin-top:8px\"></div>\n    <div class=\"mapwrap\" id=\"mapWrap\">\n      <svg id=\"mapSvg\" role=\"img\" aria-label=\"Map of field units\"><g id=\"mapBase\"></g><g id=\"mapLabels\"></g><g id=\"mapPins\"></g></svg>\n      <div class=\"mapbtns\"><button type=\"button\" id=\"zin\" aria-label=\"Zoom in\">+</button><button type=\"button\" id=\"zout\" aria-label=\"Zoom out\">&minus;</button></div>\n      <div class=\"mapmsg\" id=\"mapMsg\" hidden></div>\n      <div class=\"mapsel\" id=\"mapSel\" hidden></div>\n    </div>\n    <p class=\"note\" id=\"mapNote\" style=\"margin-top:10px\"></p>\n    <div class=\"list\" id=\"mapList\"></div>\n    </div>\n  </section>\n\n  <section id=\"viewTech\" hidden>\n    <div id=\"techForm\"></div>\n    <div id=\"techList\"></div>\n  </section>\n\n  <section id=\"viewManager\" hidden>\n    <div id=\"mgNow\"></div>\n    <div id=\"mgChecks\"></div>\n    <div id=\"mgTrucks\"></div>\n    <div id=\"mgStd\"></div>\n    <div id=\"mgGap\"></div>\n    <div id=\"mgVen\"></div>\n    <div id=\"mgSim\"></div>\n    <div id=\"mgX\"></div>\n    <div id=\"mgTools\"></div>\n  </section>\n\n  <section id=\"viewPunch\" hidden>\n    <div class=\"box\" id=\"punchTop\"><p class=\"note\">Loading the mHelp list…</p></div>\n    <div class=\"chips\" id=\"punchChips\" style=\"margin-top:12px\"></div>\n    <div class=\"count\" id=\"punchCount\"></div>\n    <div class=\"list\" id=\"punchList\"></div>\n  </section>\n\n  <section id=\"viewActivity\" hidden>\n    <p class=\"note\" id=\"actNote\">Every change made by hand on this board, newest first.</p>\n    <ul class=\"hist\" id=\"activity\"></ul>\n  </section>\n</main>\n\n<section id=\"viewTv\" hidden><header class=\"tvtop\"><div class=\"logo\"><span class=\"mk\" aria-hidden=\"true\"><i></i></span><div><h1>COS Board</h1><div class=\"eyebrow\">Cameras Onsite</div></div></div><div class=\"tvread\" id=\"tvRead\" role=\"status\">Loading the camera reading…</div><div class=\"tvclock\"><b id=\"tvClock\"></b><span id=\"tvDate\"></span></div><button type=\"button\" class=\"tvx\" id=\"tvExitTop\">Exit TV</button></header><div class=\"tvgrid\" id=\"tvGrid\"><div class=\"tvleft\" id=\"tvKpi\"><div class=\"tvtiles\" id=\"tvTiles\"></div><div class=\"tvminis\" id=\"tvMinis\"></div><div class=\"tvhead\" id=\"tvHead\"></div><div class=\"tvlist\" id=\"tvList\"></div></div><div class=\"tvright\" id=\"tvRight\"><div class=\"tvmaptitle\" id=\"tvMapTitle\"></div><div class=\"tvmap\" id=\"tvMap\"></div></div></div><footer class=\"tvfoot\"><span id=\"tvNote\"></span><span class=\"tvbtns\"><button type=\"button\" id=\"tvRefresh\">Refresh</button><button type=\"button\" id=\"tvFull\">Full screen</button><button type=\"button\" id=\"tvExit\">Exit TV</button></span></footer></section><div class=\"sheet\" id=\"sheet\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pname\"><div class=\"panel\" id=\"panel\"></div></div>\n<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\"></div></div>";
/* A shadow root can be attached to an element only once, so a host that is mounted again gets its first root back. */
const ROOTS = new WeakMap();

export function mountCosBoard(host, hooks){
/* Closed, so a page-wide lookup anywhere else in COS can never match a board element by accident. */
let root = ROOTS.get(host);
if(!root){ root = host.attachShadow({mode:'closed'}); ROOTS.set(host, root); }
root.replaceChildren();
const VENDOR_CSS = `
.ven .vlabel{margin:12px 0 6px;font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--tx2)}
.ven .vbtns{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.ven .vbtn{min-height:52px;border:0;border-radius:12px;padding:12px 14px;font-weight:800;font-size:15.5px;background:var(--s2);color:var(--tx);box-shadow:inset 0 0 0 1px var(--line2);cursor:pointer}
.ven .vbtn.vsend{background:#c8102e;color:#fff;box-shadow:none}
.ven .vbtn.alt{background:transparent}
.ven .vbtn:disabled{opacity:.5}
.ven .vhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:16px}
.ven .mgfield{display:flex;flex-direction:column;gap:4px;margin:10px 0;font-weight:700}
.ven .vsec{border:1px solid var(--line2);border-radius:12px;margin:10px 0;padding:0 12px;background:var(--bg2)}
.ven .vsec>summary{display:flex;justify-content:space-between;gap:8px;align-items:center;min-height:52px;font-weight:800;font-size:15.5px;cursor:pointer;list-style:none}
.ven .vsec>summary::-webkit-details-marker{display:none}
.ven .vsec[open]>summary{border-bottom:1px solid var(--line2);margin-bottom:6px}
.ven .vcount{font-size:13px;font-weight:800;color:var(--tx2)}
.ven select.tin{min-height:44px}
.ven .vdays{display:grid;grid-template-columns:minmax(84px,1.1fr) 1fr 1fr 1fr;gap:6px;align-items:center;margin:10px 0;font-size:14px}
.ven .vdays b{font-size:12px;text-transform:uppercase;color:var(--tx2)}
.ven .vday{font-weight:700}
.ven .vcam{border:1px solid var(--line2);border-radius:10px;padding:10px;margin:10px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 10px}
.ven .vcam>b{grid-column:1/-1}
.ven .vcam .mgfield{margin:6px 0}
@media (max-width:520px){.ven .vdays{grid-template-columns:1fr 1fr 1fr}.ven .vdays b:first-child,.ven .vday{grid-column:1/-1}.ven .vdays b:first-child{display:none}}
.ven .vmail{white-space:pre-wrap;font:13.5px/1.5 ui-monospace,Menlo,monospace;background:var(--bg2);border:1px solid var(--line2);border-radius:10px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
`;
const style = document.createElement('style'); style.textContent = BOARD_CSS + TROUBLE_CSS + ROUTER_CSS + VENDOR_CSS;
const frame = document.createElement('template'); frame.innerHTML = SHELL;
root.append(style, frame.content);
const cleanups=[];
const onWin=(type,fn,opt)=>{ window.addEventListener(type,fn,opt); cleanups.push(()=>window.removeEventListener(type,fn,opt)); };
const onDoc=(type,fn,opt)=>{ document.addEventListener(type,fn,opt); cleanups.push(()=>document.removeEventListener(type,fn,opt)); };

/* ---------- settings ---------- */
const VCC_STALE_MIN = 45;                          // board reading older than this = stale banner
const TZ = "America/Chicago";
/* ---------- state ---------- */
const S = { meta:null, units:[], edits:{}, filter:"down", fam:"all", q:"", view:"board", openId:null, form:null,
            db:null, user:null, mcp:null, uid:null, canWrite:null, feedNote:"", editsReady:false, busy:false,
            mh:null, pdone:{}, psec:"place", pins0:null, checks:{}, tc:null, tcOpen:false, chk:null, tr:null };
/* One count. A device that had picked a way of counting forgets it. */
try{ localStorage.removeItem("cos-count-mode"); }catch(_){}
const $ = id => root.getElementById(id);

function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if(attrs) for(const [k,v] of Object.entries(attrs)){
    if(v==null || v===false) continue;
    if(k==="class") e.className = v; else if(k==="text") e.textContent = v;
    else if(k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v===true ? "" : v);
  }
  for(const kid of kids.flat()){ if(kid==null || kid===false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}
const fmtDay = new Intl.DateTimeFormat("en-US",{weekday:"short",hour:"numeric",minute:"2-digit",timeZone:TZ});
const fmtDate = new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:TZ});
function when(sec){ if(!sec) return ""; const d=new Date(sec*1000); return (Date.now()-d.getTime() < 6*864e5 ? fmtDay : fmtDate).format(d); }
function ago(sec, nowSec){ const m=Math.max(0,Math.round(((nowSec||Date.now()/1000)-sec)/60)); if(m<60) return m+" min"; const hr=Math.round(m/60); if(hr<48) return hr+" h"; return Math.round(hr/24)+" days"; }
let toastTimer=null;
function toast(msg, keep){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"), keep||7000); }

function unitId(k){ let x=5381; for(let i=0;i<k.length;i++) x=((x*33)^k.charCodeAt(i))>>>0; return (k.replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60)||"unit")+"~"+x.toString(36); }
function typeOf(k,s){ const K=k.toUpperCase();
  if(s==="r") return "Recon II";
  if(/^SNIPER ALIBI/.test(K)) return "Sniper (Alibi)";
  if(/^SNIPER [24] \d/.test(K)) return "Sniper "+K.charAt(7);
  if(/^SNIPER/.test(K)) return "Sniper";
  if(/^CAM ?V/.test(K)) return "CAM V";
  if(/^SS HYBRID/.test(K)) return "SS Hybrid";
  if(/^SOLAR ?SPOTTER|^SS ?\d/.test(K)) return "Solar Spotter";
  if(/^SPOTTER/.test(K)) return "Spotter";
  if(/^RANGER/.test(K)) return "Ranger";
  if(/^HELIOS/.test(K)) return "Helios";
  return "Other"; }
function nameOf(k,s){
  if(s==="r"){ const m=k.match(/^RII[- ]?0*(\d+)/i); return m ? "RII-"+m[1].padStart(3,"0") : k; }
  const pairs=[[/^SOLAR ?SPOTTER\s*/i,"Solar Spotter "],[/^SS HYBRID\s*/i,"SS Hybrid "],[/^SPOTTER NVR\s*/i,"Spotter NVR "],[/^SPOTTER\s*/i,"Spotter "],
    [/^RANGER\s*/i,"Ranger "],[/^HELIOS\s*/i,"Helios "],[/^SNIPER ALIBI\s*/i,"Sniper Alibi "],[/^SNIPER\s*/i,"Sniper "],[/^CAM ?V\s*/i,"CAM V "]];
  for(const [re,rep] of pairs) if(re.test(k)) return k.replace(re,rep).trim();
  return k; }
function famOfCat(c){ if(/^Spotter/.test(c)) return "SP"; if(c==="Solar Spotter") return "SS"; if(c==="Sniper 4") return "S4"; if(/^Thermal/.test(c)) return "TH"; if(/^Radar/.test(c)) return "RD";
  if(/^Sniper/.test(c)) return "SN"; if(c==="CAM-V") return "CV"; if(c==="Recon II") return "RC"; if(/^RANGER/i.test(c)) return "RG"; if(/^Helios/.test(c)) return "HE"; return c; }
function numFirst(t){ const m=String(t).replace(/\(.*?\)/g," ").match(/(\d+(?:\.\d+)?)/); return m ? String(parseFloat(m[1])) : ""; }
function numLast(t){ const m=String(t).match(/\d+/g); return m ? String(parseInt(m[m.length-1],10)) : ""; }
const LASTNUM = { SN:1, S4:1, SA:1, TH:1, RD:1 };
function mhKey(r){ const fam=famOfCat(r.cat); const lab=r.label.replace(/-?\s*DO NOT USE/i,"").replace(/\bES\b/i,""); return [fam, LASTNUM[fam] ? numLast(lab) : numFirst(lab)]; }
function bdKey(v){ const N=v.name.toUpperCase(); let fam=null;
  if(v.u.s==="r") fam = /^RII/.test(N) ? "RC" : null;
  else if(/^RII|^RECON II/.test(N)) fam="RC";
  else if(/^SOLAR ?SPOTTER/.test(N) || /^SS ?\d/.test(N)) fam="SS";
  else if(/^SS ?HYBRID/.test(N)) fam="SH";
  else if(/^SPOTTER/.test(N)) fam="SP";
  else if(/^RANGER/.test(N)) fam="RG";
  else if(/^HELIOS/.test(N)) fam="HE";
  else if(/^SNIPER ALIBI/.test(N)) fam="SA";
  else if(/^SNIPER 4[ -]\d/.test(N)) fam="S4";
  else if(/^SNIPER/.test(N)) fam="SN";
  else if(/^CAM ?V/.test(N)) fam="CV";
  if(!fam) return [null,""];
  return [fam, LASTNUM[fam] ? numLast(N) : numFirst(N.replace(/^SS ?HYBRID|^SOLAR ?SPOTTER|^SPOTTER( NVR)?|^SS|^RECON II|^CAM ?V/,""))]; }
const GROUP = { SP:1, SS:1, SH:1, SN:2, SA:2, TH:2, RD:2 };
/* Line the board up against mHelp. Exact name first, then same number inside the same family group. */
function reconcile(vs, mh){
  const out={ match:{}, items:[], mhOnly:[] }; if(!mh) return out;
  const used=new Set(), byKey={}, keys=mh.recs.map(mhKey);
  mh.recs.forEach((r,i)=>{ const k=keys[i].join("|"); (byKey[k]=byKey[k]||[]).push(i); });
  const sorted=vs.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})), bk=new Map(), left=[];
  const byId={}; mh.recs.forEach((r,i)=>{ byId[r.id]=i; });
  for(const v of sorted){ const i = v.u.pid ? byId[v.u.pid] : undefined; if(i!=null && !used.has(i)){ used.add(i); out.match[v.id]={ rec:mh.recs[i], fuzzy:false }; } }
  for(const v of sorted){ const k=bdKey(v); bk.set(v.id,k); if(out.match[v.id]) continue; let hit=-1;
    if(k[0] && k[1]!=="") for(const i of (byKey[k.join("|")]||[])) if(!used.has(i)){ hit=i; break; }
    if(hit>=0){ used.add(hit); out.match[v.id]={ rec:mh.recs[hit], fuzzy:false }; } else left.push(v); }
  const still=[];
  for(const v of left){ const k=bk.get(v.id), g=GROUP[k[0]]; let best=-1;
    if(g && k[1]!==""){ const n=Math.floor(parseFloat(k[1]));
      mh.recs.forEach((r,i)=>{ if(used.has(i) || GROUP[keys[i][0]]!==g || keys[i][1]==="" || Math.floor(parseFloat(keys[i][1]))!==n) return;
        if(best<0 || (r.place===v.place && mh.recs[best].place!==v.place)) best=i; }); }
    if(best>=0){ used.add(best); out.match[v.id]={ rec:mh.recs[best], fuzzy:true }; } else still.push(v); }
  const pl=p=>p==="field"?"Field":"Shop";
  for(const v of sorted){ const m=out.match[v.id]; if(!m) continue; const r=m.rec;
    if(v.place!==r.place) out.items.push({ id:"place~"+v.id, sec:"place", fixed:!!v.hand.place, unit:v.id, name:v.name, st:v.status,
      text:[["mHelp: ",pl(r.place)+(r.cust?" at "+r.cust:"")+(m.fuzzy?" (listed as "+r.label+")":"")],[SRC(v)+": ",pl(v.place)+(v.site?" at "+v.site:"")]] });
    else if(m.fuzzy) out.items.push({ id:"name~"+v.id, sec:"name", fixed:!!v.hand.name, unit:v.id, name:v.name, st:v.status, text:[["mHelp: ",r.label+" (A# "+r.id+")"],[SRC(v)+": ",v.name]] });
  }
  /* Field units COS checks itself with no address saved: Unknown for good until someone types the IP. */
  for(const v of sorted){
    if(v.mhOnly || v.place!=="field" || v.u.s!=="a" || v.ip) continue;
    out.items.push({ id:"noip~"+v.id, sec:"noip", fixed:!!v.hand.ip, unit:v.id, name:v.name, st:v.status,
      text:[["COS: ","no IP address saved, so this unit has never been checked"],["What to do: ","open the unit and add the IP under Fix the record"]] });
  }
  const seen={}; for(const v of sorted){ if(out.match[v.id]) { const k=bk.get(v.id).join("|"); seen[k]=1; } }
  for(const v of still){ const k=bk.get(v.id); const dup = k[0] && seen[k.join("|")];
    out.items.push({ id:"bd~"+v.id, sec: v.place==="field"?"bdField":"bdShop", unit:v.id, name:v.name, st:v.status,
      text:[[SRC(v)+": ",pl(v.place)+(v.site?" at "+v.site:"")+" · "+v.type],["mHelp: ", dup ? "no second record. Another unit already uses this number. Not counted." : "nothing by this name. Not counted."]] }); }
  mh.recs.forEach((r,i)=>{ if(used.has(i)) return; out.mhOnly.push(r);
    out.items.push({ id:"mh~"+r.id, sec: r.place==="field"?"mhField":"mhShop", unit:"mh~"+r.id, name:r.label, st:null, flag:r.flag,
      text:[["mHelp: ",pl(r.place)+(r.cust?" at "+r.cust:"")+" · "+r.cat+" · A# "+r.id],["Camera feed: ","none under this name"]] }); });
  return out;
}
const FAM = { v:"Alibi", a:"Avigilon", r:"Recon II", x:"Other" };
const LABEL = { down:"Down", issues:"Camera issues", up:"Up", unknown:"Unknown", shop:"In shop", shopOnline:"Online in shop", notin:"Not in mHelp", excl:"Not counted" };
const SRC = v => v.hand && v.hand.place ? "COS, by hand" : v.u.s==="v" ? "Star4Live" : v.u.s==="a" ? "COS record" : "Recon cloud";
const ORDER = { down:0, issues:1, unknown:2, up:3, shopOnline:4, shop:5, notin:6, excl:7 };

/* Turn one unit from the app's camera feed into what the board shows. Shop or field, and up or down, are the
   app's own calls: the same ones its shared count makes, so a tile here always equals the headline.
   What the provider says and what a person set by hand in COS are kept apart, so the unit page can show both. */
function view(u){
  const place = u.pl==="shop" ? "shop" : "field", site = u.st || "";
  const e = {}; if(u.hp) e.pin = {lat:u.hp[0],lng:u.hp[1]}; if((u.he||[]).includes("place")) e.place = place;
  const v = { u, id:u.id, k:u.k, fam:FAM[u.s]||"Other", type:typeOf(u.k,u.s), hand:{}, e };
  v.feedName = nameOf(u.k,u.s); v.name = u.nm || v.feedName;
  v.retired = false; v.feedPlace = u.fp || place; v.feedSite = u.fst!=null ? u.fst : site; v.feedIp = u.fip!=null ? u.fip : u.ip;
  for(const f of (u.he||[])) v.hand[f]=1;
  v.ip = u.ip; v.place = place; v.site = site; v.note = "";
  v.edited = Object.keys(v.hand).length>0;
  const unk = Math.max(0,u.n-u.on-u.off), fs = u.vd || "unknown";
  if(u.s==="a") v.last = u.on ? "online" : u.off ? "offline" : "";
  v.fs = fs; v.unk = unk; v.excl = !!u.x;
  v.why = fs!=="unknown" ? "" : u.s==="a" ? (u.ip ? "No fresh check of this unit's address." : "COS has no IP address saved for this unit, so there is nothing to check.") : u.s==="r" ? "The Recon cloud has no fresh reading for this unit." : "Star4Live has no fresh reading for every camera on this unit.";
  v.status = (v.excl && !S.mh) ? "excl" : place==="shop" ? (u.so ? "shopOnline" : "shop") : fs;
  v.side = (u.s==="a" || u.on+u.off===0) ? "" : (u.on+"/"+(u.on+u.off));
  return v;
}

/* ---------- drawing ---------- */
/* A unit that is in mHelp but has no camera record. It still counts, because mHelp is the official count. */
function pseudo(r){ const f=famOfCat(r.cat), place=r.place;
  const fam = ({SP:1,SS:1,RG:1,HE:1}[f]) ? "Alibi" : ({SN:1,S4:1,CV:1,TH:1,RD:1,RSU:1}[f]) ? "Avigilon" : (f==="RC"||f==="Recon") ? "Recon II" : "Other";
  return { id:"mh~"+r.id, k:r.label, name:r.label.replace(/\s*-?\s*DO NOT USE/i,"").trim(), fam, type:r.cat, place, site: place==="field" ? r.cust : "", ip:"", note:"", hand:{}, e:S.edits["mh~"+r.id]||{}, edited:false,
    mhOnly:true, counted:true, rec:r, fs:"unknown", status: place==="field" ? "unknown" : "shop", side:"",
    why:"mHelp lists this unit. COS has no camera record under this name, so the board cannot tell whether it is up.",
    u:{ s:"m", o:"", n:0, on:0, off:0, t:0, lo:0, ip:"", bad:"", pid:r.id, fl:r.flag==="D"?"x":"", rs:"", rt:0, ri:"", rp:"", rr:"", ro:0, rm:"" } }; }
/* mHelp is the official count: a unit counts only if mHelp has it, and mHelp decides shop or field unless someone set it by hand here. */
function allViews(){
  const vs = S.units.map(view), rec = reconcile(vs, S.mh); S.rec = rec;
  if(S.mh){
    for(const v of vs){ const m=rec.match[v.id];
      if(m){ v.mh=m; v.counted=true;
        if(!v.hand.place && v.place!==m.rec.place){ v.srcDiff=true; v.place=m.rec.place; if(!v.hand.site) v.site = m.rec.place==="field" ? m.rec.cust : ""; }
        v.status = v.place==="shop" ? ((v.fs==="up"||v.fs==="issues") ? "shopOnline" : "shop") : v.fs;
      } else { v.counted=false; v.status="notin"; }
    }
    for(const r of rec.mhOnly) vs.push(pseudo(r));
  }
  const map={}; for(const v of vs) map[v.id]=v; S.vmap=map;
  return vs;
}
function render(){
  if(!S.meta){ return; }
  const now = Date.now()/1000, ageMin = (now - S.meta.v)/60, stale = ageMin > VCC_STALE_MIN;
  $("cosb").classList.toggle("stale", stale); $("asof").classList.toggle("stale", stale);
  if(!S.meta.v) $("asofMain").replaceChildren("Star4Live has not given a reading time. Tap Refresh for a new one.");
  else $("asofMain").replaceChildren(stale ? "Old reading. " : "", "Star4Live read ", h("b",{text:when(S.meta.v)}), " · "+ago(S.meta.v)+" ago"+(stale ? ". Tap Refresh for a new one." : "")+(S.feedNote ? " · "+S.feedNote : ""));
  const sub=[];
  if(S.refreshNote) sub.push(S.refreshNote);
  $("asofSub").replaceChildren(...sub.map(t=>h("span",{class:"warnline",text:t})));

  const vs = allViews(); const c = {down:0,issues:0,up:0,unknown:0,shop:0,shopOnline:0,notin:0,excl:0};
  /* Count what the family chips are showing. The tiles used to count every unit
     while the list under them obeyed the chips, so with Avigilon picked the tile
     could read "2 online in shop" above a list that said nothing matches. A tile
     and the list it sits over must never disagree. The TV board has no chips. */
  const inFamily = (v:any) => S.fam === "all" || v.fam === S.fam;
  for(const v of (TV.on ? vs : vs.filter(inFamily))) c[v.status]++;
  if(TV.on){ drawTv(vs, c); return; }
  /* One count. mHelp is the official list: a unit is in the field, at the site mHelp gives, until mHelp shows it back in the shop or it is moved by hand here. */
  if(S.mh ? S.filter==="excl" : S.filter==="notin") S.filter="field";
  $("modeRow").replaceChildren(h("span",{class:"hint",text: S.mh ? "One count: mHelp, the official list"+(S.mh.meta.at ? ", read "+when(S.mh.meta.at) : "")+". A unit is in the field, at the site mHelp gives, until mHelp shows it back in the shop or it is moved by hand here."
    : "The mHelp list has not loaded, so this shows only what the camera systems can see. It is not the official count."}));
  /* James read the board twice within a minute and got two different counts, because the first read came before
     the mHelp list arrived. Both counts were honest: without mHelp the board can only count the camera records
     COS holds, which is a different set of units. That count is still worth showing, and a board with no numbers
     is worse, so it stays, marked so it cannot be taken for the official one. A sentence above the tiles did not
     do that: a glance takes in the numbers, not the caveat. Dimmed, dashed and labelled in the block, it does. */
  $("kpi").classList.toggle("prov", !S.mh);
  const tile=(key,cls)=>h("button",{class:"tile "+cls,type:"button","aria-pressed":String(S.filter===key),onclick:()=>setFilter(key)},h("span",{class:"num",text:c[key]}),h("span",{class:"lab",text:LABEL[key]}));
  $("tiles").replaceChildren(tile("down","t-down"),tile("issues","t-issues"),tile("unknown","t-unknown"),tile("up","t-up"));
  const mini=(key,num,lab)=>h("button",{class:"mini",type:"button","aria-pressed":String(S.filter===key),onclick:()=>setFilter(key)},h("b",{text:num}),lab);
  $("shoprow").replaceChildren(...[mini("field",c.down+c.issues+c.up+c.unknown,"in the field"),mini("shopAll",c.shop+c.shopOnline,"in the shop"),mini("shopOnline",c.shopOnline,"online in shop"), !S.mh ? (c.excl ? mini("excl",c.excl,"marked do not use") : null) : mini("notin",c.notin,"not in mHelp")].filter(Boolean));
  $("provNote").textContent = S.mh ? "" : "Not the official count. These are what the camera systems can see, until mHelp has loaded.";
  $("provNote").hidden = Boolean(S.mh);
  const fams=[["all","All"],["Alibi","Alibi"],["Avigilon","Avigilon"],["Recon II","Recon II"]];
  $("fam").replaceChildren(...fams.map(([k,l])=>h("button",{class:"chip",type:"button","aria-pressed":String(S.fam===k),onclick:()=>{S.fam=k;render();}},l)));

  const q=S.q.trim().toLowerCase();
  const rows = vs.filter(v=>{
    if(S.filter==="field"){ if(v.place!=="field" || v.status==="notin" || v.status==="excl") return false; }
    else if(S.filter==="shopAll"){ if(v.place!=="shop" || v.status==="notin" || v.status==="excl") return false; }
    else if(v.status!==S.filter) return false;
    if(S.fam!=="all" && v.fam!==S.fam) return false;
    if(q && !(v.name+" "+v.k+" "+v.site+" "+v.u.o+" "+v.type+" "+(v.u.pid||"")+" "+(v.ip||"")+" "+v.note).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>ORDER[a.status]-ORDER[b.status] || a.name.localeCompare(b.name,undefined,{numeric:true}));
  const what = {field:"units in the field",shopAll:"units in the shop",shopOnline:"units online in the shop",down:"field units down",issues:"field units with camera issues",up:"field units up",unknown:"field units unknown",notin:"camera records not in mHelp (not counted)",excl:"units marked DO NOT USE (not counted)"}[S.filter];
  $("count").textContent = rows.length+" "+what+(S.fam!=="all"?" · "+S.fam:"")+(q?" · matching “"+S.q.trim()+"”":"");
  $("list").replaceChildren(...(rows.length ? rows.map(rowEl) : [h("div",{class:"empty",text: S.filter==="down"||S.filter==="issues" ? "None right now." : "Nothing matches."})]));
  if(S.openId) drawPanel();
  if(S.view==="activity") drawActivity();
  if(S.view==="punch") drawPunch(vs);
  sideFilter();
  if(S.view==="map" || W.side) drawMap(vs);
  if(S.view==="manager") mgDraw("feed");
}
const PSEC = [["place","Placed differently","mHelp is official, so the board shows mHelp's placement. The other system says something different, and the other system is the one to fix. Never change mHelp or the tracker to match it."],
  ["noip","Field, no IP in COS","COS tells whether these are up by pinging an address it has on record, and there is none, so they can only show Unknown. Open the unit and add the IP under Fix the record. Only a tech or the 2027 tracker has it: mHelp does not hold it and no camera system reports it."],
  ["mhField","Field, no camera feed","mHelp says these are in the field. COS has no camera record for them, so the board cannot show whether they are up."],
  ["bdField","Field feed, not in mHelp","Cameras are reporting from a site under this name, but mHelp has no equipment by that name. Not counted until mHelp has it."],
  ["name","Names differ","Same number, different name in each system. Worth making the names match."],
  ["mhShop","Shop, no camera feed","In mHelp's shop list with no camera record. Normal for units on the shelf."],
  ["bdShop","Shop feed, not in mHelp","Camera records under shop with nothing in mHelp: test devices, retired units, old tracker rows. Not counted."],
  ["morning","Morning list","Field units with cameras down. New ones (last 24 hours) first, then the ones still down, each with a likely cause from the router. Copy the lines straight onto the IT sheet. Units in the shop are left out."],
  ["sent","Sent to IT","Troubleshoot results sent to IT that nobody has closed yet, oldest first. Open the unit to read the note and close it as Fixed or Not needed once something is done; the card keeps it for 7 days after."],
  ["swap","Router swapped","A unit still linked to its old router, which is offline, while InHand has a newer router named for that unit online and linked to nothing. Use the new router moves the unit's link, so the card and the morning list read the router that is really there. Its reading shows after the next InHand pull, within 30 minutes."],
  ["vcc","Moved in VCC","Camera records in COS that no longer match VCC: a camera VCC names for another unit, a camera VCC has that COS has never recorded, or one VCC stopped listing. VCC is right about its own cameras. Fix one with its button, or fix the name in VCC when there is no button."],
  ["done","Fixed by hand","Set by hand in COS, so these are off the list and stay off. mHelp still shows them differently: make the same change there when you can."]];
/* The answers James added for the punch list: where each unit really is, what record to fix, and who fixes it. */
function normName(n){ return String(n||"").toUpperCase().replace(/SOLAR\s*SPOTTER/,"SS").replace(/RECON\s*(II|2)/,"RII").replace(/CAM[\s-]*V/,"CAMV").replace(/[^A-Z0-9.]/g,""); }
function resFor(...names){ if(!S.res) return null;
  for(const nm of names){ const k=normName(nm); if(!k) continue;
    for(const r of S.res.items){ const i=k.indexOf(r.key); if(i<0) continue; const nx=k[i+r.key.length]||"", pv=i>0?k[i-1]:""; if(/[0-9.]/.test(nx) || /[0-9]/.test(pv)) continue; if(i>0 && r.key.startsWith("SS")) continue; return r; } }
  return null; }
const CONF = { confirmed:"confirmed", likely:"likely, not yet confirmed", unknown:"not known yet" };
function resBox(r){ if(!r) return null;
  return h("div",{class:"box res"},h("h3",{text:"Punch list answer"}),
    h("p",{class:"cause",style:"font-size:16.5px",text:r.verdict}),
    h("dl",{class:"kv"},h("dt",{text:"How sure"}),h("dd",{text:CONF[r.conf]||r.conf}),h("dt",{text:"Fix"}),h("dd",{text:r.fix||"—"}),h("dt",{text:"Who fixes it"}),h("dd",{text:r.who||"—"})),
    h("p",{class:"note",text:"From James's resolution of "+S.res.at+". Nothing has been changed in COS, Star4Live, mHelp or the tracker from this board."})); }
function drawPunch(vs){
  const top=$("punchTop"), mh=S.mh;
  if(!mh){ top.replaceChildren(h("p",{class:"note",text:"The mHelp list has not loaded. Tap Refresh, or reopen COS."})); $("punchChips").replaceChildren(); $("punchList").replaceChildren(); $("punchCount").textContent=""; return; }
  vs = vs || allViews(); const items=S.rec.items, done=S.pdone;
  /* What a person set by hand in COS is settled: it is off the open list for as long as the hand fix stands. */
  const settled=i=>!!(done[i.id] || i.fixed);
  const open=items.filter(i=>!settled(i)), cnt={}; for(const i of open) cnt[i.sec]=(cnt[i.sec]||0)+1; cnt.done=items.filter(settled).length;
  const real=vs.filter(v=>!v.mhOnly), sf=real.filter(v=>v.feedPlace==="field").length, cam=mh.recs.length, mf=mh.recs.filter(r=>r.place==="field").length;
  const blocking=(cnt.place||0)+(cnt.mhField||0)+(cnt.bdField||0);
  top.replaceChildren(
    h("p",{class:"big"}, blocking ? h("em",{text:blocking}) : "0", blocking===1 ? " place where the camera systems disagree with mHelp" : " places where the camera systems disagree with mHelp"),
    h("div",{class:"cmp"}, h("span",{class:"hd",text:""}),h("span",{class:"hd",text:"mHelp (official)"}),h("span",{class:"hd",text:"Camera systems"}),
      h("span",{class:"lb",text:"In the field"}),h("b",{text:mf}),h("b",{text:sf}),
      h("span",{class:"lb",text:"In the shop"}),h("b",{text:cam-mf}),h("b",{text:real.length-sf}),
      h("span",{class:"lb",text:"Camera units"}),h("b",{text:cam}),h("b",{text:real.length})),
    h("p",{class:"note",text:"mHelp is the official count: "+mh.meta.total+" pieces of equipment, "+mh.meta.field+" in the field and "+mh.meta.shop+" in the shop. "+mh.meta.stands+" of those are stands, poles and skids ("+mh.meta.standsField+" in the field). They count, but they have no cameras, so they are not listed on this board."}),
    h("p",{class:"note",text:"mHelp read "+when(mh.meta.at)+". Camera systems read "+when(S.meta.v)+"."}));
  cnt.vcc = S.vcc ? S.vcc.items.length : 0;
  cnt.morning = S.morning ? morningItems().length : 0;
  cnt.swap = S.swaps ? S.swaps.length : 0;
  cnt.sent = S.tsr ? S.tsr.filter(r=>!r.closed).length : 0;
  $("punchChips").replaceChildren(...PSEC.filter(([k])=>(k!=="vcc" || S.vcc) && (k!=="morning" || S.morning) && (k!=="swap" || (S.swaps && S.swaps.length)) && (k!=="sent" || S.tsr)).map(([k,l])=>h("button",{class:"chip",type:"button","aria-pressed":String(S.psec===k),onclick:()=>{S.psec=k;drawPunch();}},l+" · "+(cnt[k]||0))));
  if(S.psec==="vcc"){ drawVcc(); return; }
  if(S.psec==="morning"){ drawMorning(); return; }
  if(S.psec==="swap"){ drawSwaps(); return; }
  if(S.psec==="sent"){ drawSent(); return; }
  const sec=PSEC.find(p=>p[0]===S.psec), rows = S.psec==="done" ? items.filter(settled) : open.filter(i=>i.sec===S.psec);
  $("punchCount").textContent=sec[2];
  const can = S.db && S.canWrite!==false;
  $("punchList").replaceChildren(...(rows.length ? rows.slice(0,400).map(it=>{
    const main=h("button",{class:"pmain",type:"button",disabled:!it.unit,onclick:()=>{ if(it.unit) openUnit(it.unit); }},
      h("span",{class:"name"},it.name, it.flag==="D"?h("span",{class:"tag",text:"Do not use"}):null),
      it.text.map(([a,b])=>h("span",{class:"sub"},h("b",{text:a}),b)),
      (r=>r ? [h("span",{class:"sub ans"},h("b",{text:"Answer: "}),r.verdict+" ("+(CONF[r.conf]||r.conf)+")"),h("span",{class:"sub ans"},h("b",{text:"Fix: "}),r.fix),h("span",{class:"sub ans"},h("b",{text:"Who: "}),r.who)] : null)(resFor(it.name)));
    const btn = can ? h("button",{class:"pdone",type:"button",disabled:S.busy,onclick:()=>markPunch(it, !done[it.id])}, done[it.id] ? "Reopen" : "Handled") : null;
    const uv = it.unit && S.vmap ? S.vmap[it.unit] : null;
    return h("div",{class:"prow"+(uv?" s-"+uv.status:"")},main,btn);
  }) : [h("div",{class:"empty",text:"Nothing here."})]));
}
/* Moved in VCC (James, 25 Nov). VCC is right about its own cameras; COS's records follow it one tap at a time.
   Tech Check works the list out again before any change and refuses one that is no longer listed or not safe. */
const VCC_KIND = { moved:"Moved in VCC", new:"New in VCC", gone:"Gone from VCC" };
const VCC_BTN = { moved:"Move it", new:"Add it", gone:"Turn it off in COS" };
function drawVcc(){
  const vc=S.vcc, sec=PSEC.find(p=>p[0]==="vcc");
  $("punchCount").textContent = sec[2] + (vc && !vc.fresh ? " The last VCC read is too old to act on, so nothing can be changed until the next one." : "");
  const items = vc ? vc.items : [];
  const go = !!(hooks && typeof hooks.onVccMove==="function") && S.can===true && vc && vc.fresh;
  $("punchList").replaceChildren(...(items.length ? items.map(it=>{
    const unit = it.toUnit || it.fromUnit || "", uv = Object.values(S.vmap||{}).find(v=>v.k===unit);
    const lines = [["What: ", it.rename ? "Camera number differs from VCC" : (VCC_KIND[it.kind]||it.kind)], it.vccName ? ["VCC calls it: ", it.vccName] : null, it.cosName ? ["COS calls it: ", it.cosName+(it.fromUnit ? " on "+it.fromUnit : "")] : null,
      it.toUnit && !it.rename ? ["Goes to: ", it.toUnit] : null, ["Why: ", it.why||""]].filter(Boolean);
    const main=h("button",{class:"pmain",type:"button",disabled:!uv,onclick:()=>{ if(uv) openUnit(uv.id); }},
      h("span",{class:"name",text: it.vccName || it.cosName || it.serial}), lines.map(([a,b])=>h("span",{class:"sub"},h("b",{text:a}),b)));
    const btn = go && it.canApply ? h("button",{class:"pdone",type:"button",disabled:S.busy,onclick:()=>vccMove(it)}, it.rename ? "Use VCC's name" : (VCC_BTN[it.kind]||"Apply")) : null;
    return h("div",{class:"prow"+(uv?" s-"+uv.status:"")},main,btn);
  }) : [h("div",{class:"empty",text: vc ? "COS and VCC agree on every camera." : "Nothing here."})]));
}
async function vccMove(it){
  if(S.busy || S.can!==true || !hooks || typeof hooks.onVccMove!=="function") return;
  S.busy=true; drawPunch();
  try{ const said = await hooks.onVccMove(it.key); toast(said || "Done.", 9000); }
  catch(err){ toast("Not changed. "+((err && err.message) || "COS could not confirm the change."), 14000); }
  S.busy=false; render();
}
/* The morning list (James, 25 Nov: "build the morning list"). Tech Check lists field cameras that are down;
   the board drops units it knows are in the shop and adds nothing of its own. It only reads. */
function morningItems(){
  const byKey={}; for(const v of Object.values(S.vmap||{})) byKey[String(v.k).toUpperCase()]=v;
  return (S.morning ? S.morning.items : []).filter(it=>{ const v=byKey[String(it.unitKey||"").toUpperCase()]; return !v || (v.place!=="shop" && v.status!=="excl" && v.status!=="notin"); });
}
function morningWhen(t){ if(!t) return ""; const d=new Date(t); return isNaN(d) ? "" : d.toLocaleString([], {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}); }
function drawMorning(){
  const sec=PSEC.find(p=>p[0]==="morning"), items=morningItems(), fresh=items.filter(it=>it.new), old=items.filter(it=>!it.new);
  $("punchCount").textContent = sec[2];
  const byKey={}; for(const v of Object.values(S.vmap||{})) byKey[String(v.k).toUpperCase()]=v;
  const row = it => {
    const uv=byKey[String(it.unitKey||"").toUpperCase()], r=it.router||{};
    const cams=(it.cameras||[]).map(c=>c.name).join(", ");
    const lines=[["Down: ", it.down+" of "+it.total+" camera"+(it.total===1?"":"s")+(it.downSince ? " since "+morningWhen(it.downSince) : "")], cams ? ["Cameras: ", cams] : null,
      ["Router: ", r.status ? r.status+(r.carrier ? " · "+r.carrier : "")+(r.bars ? " · "+r.bars+" bars" : "") : "none linked"], ["Likely: ", it.cause||""]].filter(Boolean);
    return h("div",{class:"prow"+(uv?" s-"+uv.status:"")},h("button",{class:"pmain",type:"button",disabled:!uv,onclick:()=>{ if(uv) openUnit(uv.id); }},
      h("span",{class:"name",text:(uv && uv.name) || it.unitKey}), lines.map(([a,b])=>h("span",{class:"sub"},h("b",{text:a}),b))));
  };
  const copy = h("button",{class:"fixbtn",type:"button",disabled:!items.length,onclick:async()=>{
    const text=["New since yesterday:",...(fresh.length?fresh.map(it=>"- "+it.sheetLine):["- none"]),"","Still down:",...(old.length?old.map(it=>"- "+it.sheetLine):["- none"])].join("\n");
    try{ await navigator.clipboard.writeText(text); toast("Copied "+items.length+" line"+(items.length===1?"":"s")+" for the IT sheet.", 6000); }
    catch(_){ toast("Copy did not work here. Long-press a line to copy it instead.", 8000); }
  }},"Copy for the IT sheet");
  $("punchList").replaceChildren(...(items.length ? [
    h("div",{class:"btns"},copy),
    h("h3",{class:"mhead",text:"New since yesterday · "+fresh.length}), ...(fresh.length ? fresh.map(row) : [h("div",{class:"empty",text:"Nothing new went down in the last 24 hours."})]),
    h("h3",{class:"mhead",text:"Still down · "+old.length}), ...old.map(row)
  ] : [h("div",{class:"empty",text:"Every field camera COS can see is up."})]));
}
/* Router swapped (James, 25 Nov: "build router swap"). Tech Check lists it and checks again before the swap. */
function drawSwaps(){
  const sec=PSEC.find(p=>p[0]==="swap"), items=S.swaps||[];
  $("punchCount").textContent = sec[2];
  const go = !!(hooks && typeof hooks.onRouterSwap==="function") && S.can===true;
  const byKey={}; for(const v of Object.values(S.vmap||{})) byKey[String(v.k).toUpperCase()]=v;
  $("punchList").replaceChildren(...(items.length ? items.map(it=>{
    const uv=byKey[String(it.unit||"").toUpperCase()];
    const lines=[["Unit: ", it.unit], ["Linked now: ", "old router, "+(it.oldStatus||"not reporting")+(it.oldLastOnline ? ", last online "+morningWhen(it.oldLastOnline) : "")],
      ["In InHand: ", "\u201c"+it.newName+"\u201d, online, linked to nothing"], ["Why: ", it.why||""]];
    return h("div",{class:"prow"+(uv?" s-"+uv.status:"")},h("button",{class:"pmain",type:"button",disabled:!uv,onclick:()=>{ if(uv) openUnit(uv.id); }},
      h("span",{class:"name",text:(uv && uv.name) || it.unit}), lines.map(([a,b])=>h("span",{class:"sub"},h("b",{text:a}),b))),
      go ? h("button",{class:"pdone",type:"button",disabled:S.busy,onclick:()=>routerSwap(it)},"Use the new router") : null);
  }) : [h("div",{class:"empty",text:"No router swaps waiting."})]));
}
async function routerSwap(it){
  if(S.busy || S.can!==true || !hooks || typeof hooks.onRouterSwap!=="function") return;
  S.busy=true; drawPunch();
  try{ const said = await hooks.onRouterSwap(it.key); toast(said || "Swapped.", 9000); }
  catch(err){ toast("Not swapped. "+((err && err.message) || "COS could not confirm the swap."), 14000); }
  S.busy=false; render();
}
/* Send to IT, closed loop (James, 26 Nov). A report stays Open until someone closes it with a note. */
function sentFor(v){ const k=String(v.k||"").toUpperCase(); return (S.tsr||[]).filter(r=>String(r.unitKey||"").toUpperCase()===k); }
function drawSent(){
  const sec=PSEC.find(p=>p[0]==="sent"), items=(S.tsr||[]).filter(r=>!r.closed).slice().sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  $("punchCount").textContent = sec[2];
  const byKey={}; for(const v of Object.values(S.vmap||{})) byKey[String(v.k).toUpperCase()]=v;
  $("punchList").replaceChildren(...(items.length ? items.map(r=>{
    const uv=byKey[String(r.unitKey||"").toUpperCase()];
    return h("div",{class:"prow"+(uv?" s-"+uv.status:"")},h("button",{class:"pmain",type:"button",disabled:!uv,onclick:()=>{ if(uv) openUnit(uv.id); }},
      h("span",{class:"name",text:(uv && uv.name) || r.unitName || r.unitKey}),
      h("span",{class:"sub"},h("b",{text:"Sent: "}),morningWhen(r.at)+" by "+(r.by||"someone")+(r.managerHelp ? " · manager help asked" : "")),
      h("span",{class:"sub"},h("b",{text:"Found: "}),r.result||""),
      h("span",{class:"sub"},h("b",{text:"Note: "}),r.note||"")));
  }) : [h("div",{class:"empty",text:"Nothing sent to IT is waiting."})]));
}
function sentBox(v){
  const list=sentFor(v); if(!list.length) return null;
  const can = S.can===true && !!(hooks && typeof hooks.onTroubleClose==="function");
  const rows=list.map(r=>{
    const head=h("p",{class:"note"},h("b",{text:r.closed ? (r.outcome==="not_needed" ? "Not needed" : "Fixed")+" · " : "Open · "}),"sent "+morningWhen(r.at)+" by "+(r.by||"someone")+": "+(r.result||""));
    const note=h("p",{class:"note",text:r.note||""});
    if(r.closed) return h("div",{class:"tsr done"},head,note,h("p",{class:"note"},h("b",{text:"Closed: "}),morningWhen(r.closedAt)+" by "+(r.closedBy||"someone")+": "+(r.closedNote||"")));
    if(!can) return h("div",{class:"tsr open"},head,note);
    const inp=h("input",{type:"text",maxlength:"1000",placeholder:"What was done (last octet only, no full IP)","aria-label":"What was done"});
    const close=async(outcome)=>{
      const said=inp.value.trim(); if(!said){ toast("Say what was done before closing it.", 6000); inp.focus(); return; }
      if(S.busy) return; S.busy=true; drawPanel();
      try{ await hooks.onTroubleClose(r.id, outcome, said); toast(outcome==="fixed" ? "Closed as fixed." : "Closed as not needed.", 6000); }
      catch(err){ toast("Not closed. "+((err && err.message) || "COS could not confirm it."), 12000); }
      S.busy=false; render();
    };
    return h("div",{class:"tsr open"},head,note,inp,h("div",{class:"btns"},
      h("button",{class:"fixbtn",type:"button",disabled:S.busy,onclick:()=>close("fixed")},"Fixed"),
      h("button",{class:"fixbtn alt",type:"button",disabled:S.busy,onclick:()=>close("not_needed")},"Not needed")));
  });
  return h("div",{class:"box",id:"sentBox"},h("h3",{text:"Sent to IT · "+list.filter(r=>!r.closed).length+" open"}),rows);
}
function setReports(v){ S.tsr = Array.isArray(v) ? v.filter(x=>x && typeof x.id==="string") : null; if(S.meta) render(); }
function setSwaps(v){ S.swaps = Array.isArray(v) ? v.filter(x=>x && typeof x.key==="string" && /^swap:/.test(x.key)) : null; if(S.meta) render(); }
function setMorning(v){ S.morning = v && Array.isArray(v.items) ? {since: v.since||null, items: v.items.filter(x=>x && typeof x.unitKey==="string")} : null; if(S.meta) render(); }
function setVcc(v){ S.vcc = v && Array.isArray(v.items) ? {fresh: v.fresh===true, syncedAt: v.syncedAt||null, items: v.items.filter(x=>x && typeof x.key==="string")} : null; if(S.meta) render(); }
async function markPunch(it, on){
  if(!S.db || S.busy) return; S.busy=true;
  try{ if(on){ const d={by:S.uid,at:Date.now(),name:it.name,sec:it.sec}; await S.db.doc("punch/"+it.id).set(d); S.pdone[it.id]=d; } else { await S.db.doc("punch/"+it.id).delete(); delete S.pdone[it.id]; } }
  catch(err){ if(err&&err.code==="invalid_argument") S.canWrite=false; toast("Not saved. "+(err&&err.code==="invalid_argument" ? "This sign-in can't change the board." : "The board couldn't be reached. Try again in a moment.")); }
  S.busy=false; drawPunch();
}
function rowEl(v){
  const sub=[h("span",{class:"pill",text:LABEL[v.status]})];
  sub.push(v.place==="field" ? (v.site||"No site on record") : (v.site||(v.retired?"Retired":"Shop")));
  if(v.edited) sub.push(h("span",{class:"tag",text:"By hand"}));
  if(v.mhOnly) sub.push(h("span",{class:"tag",text:"No camera feed"}));
  if(v.status==="down"){ const r=routerRead(v.u); if(r.off) sub.push(h("span",{class:"tag",text:"Router down too"})); else if(r.on) sub.push(h("span",{class:"tag",text:"Router up"})); }
  if(v.srcDiff) sub.push(h("span",{class:"tag",text:SRC(v)+": "+v.feedPlace}));
  if(v.u.fl.includes("x")) sub.push(h("span",{class:"tag",text:"Do not use"}));
  if(v.u.pw) sub.push(powerChip(v.u.pw));
  return h("button",{class:"row s-"+v.status,type:"button",onclick:()=>openUnit(v.id)},
    h("span",{class:"name",text:v.name}),
    h("span",{class:"side"}, v.side, h("small",{text: v.side ? "online" : v.type})),
    h("span",{class:"sub"},sub));
}
function setFilter(k){ S.filter = (S.filter===k && k!=="field") ? "field" : k; render(); }

/* ---------- one unit ---------- */
function openUnit(id){ S.openId=id; S.form=null; S.ipShown=false; S.tr={unit:id, ans:{}}; $("sheet").classList.add("open"); drawPanel(); $("sheet").scrollTop=0; }
function closeUnit(){ S.openId=null; S.form=null; S.ipShown=false; $("sheet").classList.remove("open"); }
function steps(v){
  if(v.mhOnly) return v.place==="field"
    ? ["mHelp says this unit is in the field. COS has no camera record under this name.","Find out what name its cameras go by in Star4Live, the 2027 tracker or the Recon cloud, and make the names match.","If it is not out there, tell James. James makes any mHelp edit."]
    : ["In the shop per mHelp. No camera record, which is normal for a unit on the shelf."];
  if(v.status==="excl") return ["This unit is marked DO NOT USE, so it is left out of every total.","If that is wrong, the flag is on its mHelp record."];
  if(v.status==="notin") return ["This has a camera record, but mHelp has no equipment by this name, so it is not counted.","If it is real equipment, tell James so it gets added in mHelp, or rename it here to match mHelp.","If it is a test device or an old record, leave it."];
  const pre = v.srcDiff ? ["mHelp says "+v.place+", and mHelp is the official count. "+SRC(v)+" says "+v.feedPlace+". "+(v.u.s==="a" ? "That is a COS record for James to fix. Do not change mHelp or the tracker because of it." : "Fix it in "+SRC(v)+". Do not change mHelp to match it.")] : [];
  return pre.concat(steps0(v));
}
function steps0(v){
  const u=v.u, routerOn=u.rs==="on", routerOff=u.rs==="of";
  if(v.status==="down") return [(routerOn ? "The router answers, so the unit likely has signal. Look at camera or recorder power and cabling." : routerOff ? "The router is not answering either. Check site power, then the SIM and signal." : u.rr ? "Start from the diagnosis above." : "COS has no router reading for this unit. Start with site power."),"Check mHelp for an open job on this unit before sending anyone.","When it is fixed or moved, update it here with Fix it."];
  if(v.status==="issues") return ["Some cameras are off, listed above. The unit itself is reachable.","Check power and cabling on just those cameras.","When it is fixed, tap Refresh on the board to confirm."];
  if(v.status==="unknown") return v.u.s==="a" && !v.u.ip
    ? ["COS has no IP address for this unit, so it cannot be checked at all. That is why it shows Unknown and not Down.",
       "Add the IP under Fix the record. COS checks the address within the hour and the unit stops being Unknown.",
       "Only a tech or the 2027 tracker has that address. mHelp does not hold it and no camera system reports it."]
    : ["No fresh reading. Do not treat this as down.","Tap Refresh on the board. If it stays Unknown, check the unit directly."];
  if(v.status==="shopOnline") return ["This unit is online but sits in the shop.","If it is really on a site, use Move to field and set the site.","If it is on the bench, nothing to do."];
  if(v.status==="shop") return ["In the shop. Not counted as down.","When it goes out, use Move to field and set the site."];
  return ["Nothing to do. All cameras are reporting."];
}
/* Victron power for a Helios: one reading, never an average of separate batteries. Older than 45 min draws grey. */
const PWQ = { good:"ok", fair:"warn", low:"bad", stale:"unk", none:"unk", off:"unk" };
function flowText(f){ if(!f) return ""; return f.s==="charging" ? "charging"+(f.w!==null ? " "+Math.abs(f.w)+" W" : "") : f.s==="draining" ? "draining"+(f.w!==null ? " "+Math.abs(f.w)+" W" : "") : "idle"; }
function powerText(p){ if(!p) return ""; if(p.q==="off") return "Victron: not in the latest sync"+(p.ls ? " · last connected "+when(p.ls) : "");
  if(p.q==="stale"||p.q==="none") return "No current Victron reading"+(p.ls ? " · last connected "+when(p.ls) : "");
  return (p.al ? "Victron "+(p.al.l===2 ? "alarm" : "warning")+": "+p.al.k+" · " : "")+(p.b!==null ? p.b+"% battery" : "No battery reading")+(p.f ? " · "+flowText(p.f) : "")+(p.w!==null ? " · "+p.w+" W solar" : ""); }
function powerChip(p){ if(!p) return null;
  const live = p.q!=="off" && p.q!=="stale" && p.q!=="none";
  return h("span",{class:"pwr q-"+p.q,title:powerText(p)},h("i",{"aria-hidden":"true"}),p.al && live ? "⚠ " : "",p.q==="off" ? "Victron off" : (p.b!==null ? p.b+"%" : "—"),
    live && p.f && p.f.s!=="idle" ? h("small",{class:"fl-"+p.f.s,text:p.f.s==="charging" ? "↑" : "↓"}) : null,
    p.w!==null && live ? h("small",{text:"☀ "+p.w+" W"}) : null,
    live && p.tn && (p.tn.v==="low"||p.tn.v==="tight") ? h("small",{class:"night-"+p.tn.v,text:"🌙"}) : null); }
/* The fresh InHand reading for a unit from the 30-minute pull, as "on", "of" or "" (none, or too old to trust). */
function inhandNow(u){
  const r = S.rd && u ? (S.rd.get(unitKeyOf(u.k)) || null) : null;
  if(!r || !r.at || Date.now()-Date.parse(r.at) >= ROUTER_DETAIL_FRESH_MS) return {st:"", r};
  return {st: r.status==="online" ? "on" : r.status==="offline" ? "of" : "", r};
}
/* What the router readings say, all sources together. COS's own check first, then the InHand pull, then InHand on record. */
function routerRead(u){
  const ih = inhandNow(u).st, rr = ih || u.rr;
  return { on: u.rs==="on" || (u.rs!=="of" && rr==="on"), off: u.rs==="of" || (u.rs!=="on" && rr==="of") };
}
const WORD = { ok:"OK", warn:"Check", bad:"Problem", unk:"Unknown" }, RW = { on:"Online", of:"Offline", un:"Unknown" };
/* Read the signs we have and say what is most likely wrong. A router reading is a hint only, never proof the cameras work. */
function diagnose(v){
  const u=v.u, fs=v.fs, r=routerRead(u), ck=[];
  let cam;
  if(u.s==="a") cam = u.t && v.last ? "COS checked this unit's address · "+v.last+" · "+when(u.t) : (u.ip ? "No check on record" : "No IP address saved, so COS has never checked it");
  else cam = (u.s==="r" ? "Recon cloud" : "Star4Live")+": "+u.on+" of "+u.n+" online"+(u.off ? ", "+u.off+" offline" : "")+(v.unk ? ", "+v.unk+" no reading" : "");
  ck.push({k:"Cameras", s: fs==="up"?"ok":fs==="issues"?"warn":fs==="down"?"bad":"unk", t:cam});
  if(u.rs) ck.push({k:"Router, COS check", s: u.rs==="on"?"ok":u.rs==="of"?"bad":"unk", t:(RW[u.rs]||u.rs)+(u.rt ? " · "+when(u.rt) : "")});
  /* James (25 Nov): the card said "Router readings have not loaded yet" right above a Router box that had the reading.
     The 30-minute InHand pull is the newest InHand reading, so it wins here and the two always agree. */
  const ih = inhandNow(u);
  if(ih.st) ck.push({k:"Router, InHand says", s: ih.st==="on"?"ok":"bad", t:(ih.st==="on"?"Online":"Offline")+" · "+when(secOf(ih.r.at))+(ih.st==="of" ? " · the router itself is not reaching InHand" : "")});
  else if(u.rr) ck.push({k:"Router, InHand says", s: u.rr==="on"?"ok":u.rr==="of"?"bad":"unk", t:(RW[u.rr]||u.rr)+(u.ro ? " · "+when(u.ro) : " · no time given")});
  if(!u.rs && !u.rr && !ih.st) ck.push({k:"Router", s:"unk", t: ih.r ? "No InHand reading in the last 75 minutes" : S.rd ? "No router on record for this unit" : S.meta && S.meta.rl===false ? "Router readings have not loaded yet" : "No router on record for this unit"});
  if(u.pw && u.pw.tn && (u.pw.tn.v==="low"||u.pw.tn.v==="tight")) ck.push({k:"Tonight, Victron", s:u.pw.tn.v==="low" ? "bad" : "warn", t:u.pw.tn.h});
  if(u.pw && u.pw.hf) ck.push({k:"Victron history", s:"warn", t:u.pw.hf.join(" · ")});
  if(u.pw && u.pw.sk && u.pw.sk.w) ck.push({k:"Weather, Victron", s:"warn", t:u.pw.sk.w});
  if(u.pw && u.pw.mp && u.pw.mp.w) ck.push({k:"Solar charger, Victron", s:"bad", t:u.pw.mp.w.join(" · ")});
  if(u.pw) ck.push({k:"Battery, Victron", s:u.pw.al && u.pw.q!=="stale" && u.pw.q!=="off" ? (u.pw.al.l===2 ? "bad" : "warn") : (PWQ[u.pw.q]||"unk"), t:powerText(u.pw)+(u.pw.t ? " · "+when(u.pw.t) : "")});
  if(fs==="issues"){ const off=offCams(v); if(off.length) ck.unshift({k:"Off now", s:"bad", t:off.map(c=>c.name+(c.since ? " · since "+when(c.since)+" · "+ago(c.since)+" ago" : "")).join(" · ")}); }
  if(u.lo && fs!=="up") ck.push({k:"Last online", s:"info", t:when(u.lo)+" · "+ago(u.lo)+" ago"});
  const m = S.mh && S.rec ? S.rec.match[v.id] : null;
  if(S.mh){
    if(!m) ck.push({k:"mHelp", s:"warn", t:"Nothing by this name. Not counted."});
    else { const cur = v.hand.place ? v.e.place : v.feedPlace;
      ck.push(cur!==m.rec.place ? {k:"Shop or field", s:"warn", t:"mHelp says "+m.rec.place+". "+SRC(v)+" says "+cur+"."} : {k:"Shop or field", s:"ok", t:"mHelp and "+SRC(v)+" agree: "+m.rec.place}); }
  }
  ck.push({k:"IP on record", s: v.ip ? "info" : "unk", t: v.ip ? ipCard(v.ip) : "None"});
  let cause;
  if(v.status==="notin") cause="This has a camera record but is not in mHelp, so it is not counted.";
  else if(v.place==="shop") cause = (fs==="up"||fs==="issues") ? "Online, but filed under shop. If it is really on a site, the placement is what needs fixing." : "In the shop. Nothing to troubleshoot unless it should be on a site.";
  else if(fs==="down" && lowBattery(u.pw)) cause = "Victron shows the battery at "+u.pw.b+"%"+(u.pw.w!==null ? " with "+u.pw.w+" W of solar coming in" : "")+". The unit is most likely out of power. Check the panels and the charge controller before anything else."
  else if(fs==="down") cause = r.off ? "The whole unit looks dark. Cameras and router are both not answering. Think site power, SIM or signal first."
    : r.on ? "The router answers, but nothing behind it is reporting. Think power to the cameras or recorder, the switch, or cabling."
    : "Cameras are not reporting and there is no router reading to narrow it down. Start with site power.";
  else if(fs==="issues"){ const off=offCams(v);
    cause = off.length ? "The unit is reachable. Off: "+off.map(c=>c.name+(c.since ? " (since "+when(c.since)+")" : "")).join(", ")+". Troubleshoot below walks you through it."
      : "The unit is reachable. Some cameras are off. Troubleshoot below walks you through it."; }
  else if(fs==="up") cause = r.off ? "Cameras are reporting. The router check fails, which usually means the router address on record is out of date." : "Nothing wrong. All cameras are reporting.";
  else cause = v.why || "No fresh reading. Do not treat this as down.";
  return { cause, ck };
}
function diagBox(v){ const d=diagnose(v);
  return h("div",{class:"box"},h("h3",{text:"Diagnosis"}),h("p",{class:"cause",text:d.cause}),
    h("div",{class:"chk"}, d.ck.flatMap(c=>[h("span",{class:"dot "+c.s}), h("div",null,h("b",{text:c.k}),h("span",{text:(WORD[c.s] ? WORD[c.s]+" · " : "")+c.t}))])),
    h("p",{class:"note",text:"Router readings are a hint only. A router online does not prove the cameras work."})); }
function camsBox(v){
  if(v.u.s==="a" || v.mhOnly) return null;
  const list = S.dev && S.dev[v.k];
  if(!list || !list.length) return null;
  /* James, 25 Nov: "a link to each cameras interface directly." Each camera's own page through the router's forwarded
     port (1400 → .14, 1500 → .15, 1600 → .16, 1700 → .17, 1900 → .19; https on the same port + 43). */
  const ip = v.ip && IPV4.test(v.ip) ? v.ip : "";
  const camLinks = c => ip && c.p ? h("span",{class:"camlinks"},
    h("a",{class:"lk camlk",href:"http://"+ip+":"+c.p,target:"_blank",rel:"noopener noreferrer"},"Web"),
    h("a",{class:"lk camlk",href:"https://"+ip+":"+(c.p+43),target:"_blank",rel:"noopener noreferrer"},"HTTPS")) : null;
  return h("div",{class:"box"},h("h3",{text:"Cameras on this unit"}), list.map(c=>h("div",{class:"cam"},
    h("div",null,h("b",{text:c.name}),h("span",{text:[c.type,c.model,c.fw ? "firmware "+c.fw : ""].filter(Boolean).join(" · ")}),camLinks(c)),
    h("span",{class:"cst "+(c.st===1?"ok":c.st===0?"bad":"unk"),text: c.st===1 ? "Online" : c.st===0 ? "Offline"+(c.lo ? " since "+when(c.lo) : "") : "No reading"}))),
    S.devAt ? h("p",{class:"note",text:"Camera list read "+when(S.devAt)+"."}) : null); }
/* The unit's InHand router, from the 30-minute InHand pull. A hint only: router up never means the cameras are up.
   No SIM numbers ever reach the board. The router page is plain http on a public address, so it opens in a new tab. */
const secOf = iso => { const t=Date.parse(iso||""); return isFinite(t) ? Math.round(t/1000) : 0; };
function routerBox(v){
  if(v.mhOnly || !S.rd) return null;
  const r = S.rd.get(unitKeyOf(v.k)) || S.rd.get(unitKeyOf(v.name));
  const goScreen = hooks && typeof hooks.onScreen==="function" ? h("button",{class:"lk",type:"button",onclick:()=>hooks.onScreen("InHand Routers")},"Open InHand Routers") : null;
  if(!r){
    if(v.place!=="field") return null;
    return h("div",{class:"box rtr"},h("h3",{text:"Router"}),
      h("p",{class:"note",text:"No InHand router is linked to this unit in COS. Owner or IT can link one on the InHand Routers screen."}),
      goScreen ? h("div",{class:"links"},goScreen) : null);
  }
  const fresh = r.at && Date.now()-Date.parse(r.at) < ROUTER_DETAIL_FRESH_MS;
  const st = !fresh ? "unk" : r.status==="online" ? "ok" : r.status==="offline" ? "bad" : "unk";
  const stText = st==="ok" ? "Connected" : st==="bad" ? "Offline" : "Unknown";
  const kids=[h("h3",{text:"Router"}),
    h("div",{class:"rtop"},h("span",{class:"cst "+st,text:stText}),
      h("span",{class:"note",text: r.at ? (fresh ? "InHand read "+when(secOf(r.at)) : "No InHand reading since "+when(secOf(r.at))) : "No InHand reading yet"}))];
  /* Green only when the router is connected. An offline router's page will not open, and a green button next to a red
     Offline read as "online" (James, 25 Nov, Sniper 168). */
  if(r.ip && IPV4.test(r.ip)) kids.push(h("a",{class:"rbtn"+(st==="ok"?"":" off"),href:"http://"+r.ip+":"+(r.port||8080),target:"_blank",rel:"noopener noreferrer"},
    h("b",{text:"Open router (:"+(r.port||8080)+")"}),h("span",{text: st==="ok" ? "Opens the router's own page in a new tab" : st==="bad" ? "The router is offline, so its page will not open until it is back. Last known address." : "No fresh InHand reading, so the page may not open."})));
  if(st==="bad") kids.push(h("p",{class:"note warn",text:"The router is not reaching InHand"+(r.at ? " (InHand read "+when(secOf(r.at))+")" : "")+". With the router down, the cameras behind it cannot be reached either. Check power first, then the SIM and antenna."}));
  else kids.push(h("p",{class:"note",text:"No public IP for this router yet, so there is no router page to open."}));
  const kv=[];
  const word = signalWord(r.sig);
  if(r.sig){
    const lv = typeof r.sig.level==="number" ? Math.max(0,Math.min(5,Math.round(r.sig.level))) : (word==="Good"?4:word==="Fair"?3:word==="Poor"?1:0);
    const bars=h("span",{class:"bars "+(word||"").toLowerCase(),"aria-label":(word||"Signal")+", "+lv+" of 5 bars"},...[1,2,3,4,5].map(i=>h("i",{class:i<=lv?"on":""})));
    const parts=[word, r.sig.radio, r.sig.band ? "band "+r.sig.band : "", typeof r.sig.rsrp==="number" ? r.sig.rsrp+" dBm" : ""].filter(Boolean).join(" · ");
    kv.push([st==="ok" ? "Signal" : "Last signal", h("span",null,bars," ",parts||"No reading")]);
  }
  if(r.carrier) kv.push(["Carrier", r.carrier]);
  kv.push(["Router", [r.model, r.serial].filter(Boolean).join(" · ")]);
  if(r.fw) kv.push(["Firmware", r.fw]);
  if(r.ip) kv.push(["Router IP", r.ip+(r.ipFrom==="cos" ? " (from the COS record)" : "")]);
  let far=null;
  if(r.gps){
    const pin=pinOf(v), maps="https://www.google.com/maps?q="+r.gps.lat.toFixed(5)+","+r.gps.lng.toFixed(5);
    const mi = pin ? milesBetween(r.gps, pin) : null;
    kv.push(["Cell-tower spot", h("span",null, mi===null ? "No unit pin to compare" : mi<1 ? "Under a mile from the unit's pin" : Math.round(mi)+" mi from the unit's pin"," · ",
      h("a",{href:maps,target:"_blank",rel:"noopener noreferrer"},"map"))]);
    if(mi!==null && mi>25) far=h("p",{class:"note warn",text:"The router's cell tower is about "+Math.round(mi)+" miles from where COS has this unit. The unit may have moved, or the router may be on a different unit. Cell-tower spots are rough, so check before changing anything."});
  }
  const dl=h("dl",{class:"kv"}); for(const [a,b] of kv) dl.append(h("dt",{text:a}), typeof b==="string" ? h("dd",{text:b}) : h("dd",null,b));
  kids.push(dl);
  if(r.cosDiffers) kids.push(h("p",{class:"note warn",text:"InHand reports a different public IP than the COS record. The button uses InHand's, which is newer. Correct the COS record if the cameras use the same address."}));
  if(far) kids.push(far);
  kids.push(h("p",{class:"note",text:"Router status is a hint, not camera health. A connected router with offline cameras is still a camera problem."}));
  if(goScreen) kids.push(h("div",{class:"links"},goScreen));
  return h("div",{class:"box rtr",id:"rtrBox"},kids);
}
async function loadRouters(){
  if(!hooks || typeof hooks.loadRouters!=="function") return;
  try{
    const res = await hooks.loadRouters();
    if(!res || res.ok!==true || !res.data) return;
    S.rd = new Map(res.data.routers.map(r=>[unitKeyOf(r.unit), r]));
    if(S.meta) render(); else if(S.openId) drawPanel();
  }catch(_){ /* the card simply has no router box */ }
}
/* The cameras COS has as off right now, by name, with when each was last online. The camera list first; the unit's own list as a fallback. */
function offCams(v){
  const list = S.dev && S.dev[v.k];
  if(list && list.length) return list.filter(c=>c.st===0).map(c=>({name:c.name, since:c.lo||0}));
  return v.u.bad ? v.u.bad.split(";").map(x=>x.trim()).filter(Boolean).map(name=>({name, since:v.u.lo||0})) : [];
}
/* Out of power means the battery reading itself is low (under 20%), from a current reading. A Victron alarm on a full battery
   (Felix found 95% flagged) is shown as an alarm on the card, but it is not a reason to tell a tech the unit ran out of power. */
function lowBattery(pw){ return !!(pw && pw.q!=="off" && pw.q!=="stale" && pw.q!=="none" && typeof pw.b==="number" && pw.b<20); }
function troubleFacts(v){
  const u=v.u, r=routerRead(u), pw=u.pw, live = pw && pw.q!=="off" && pw.q!=="stale" && pw.q!=="none";
  return { status:v.fs, place:v.place, offCams:v.fs==="issues" ? offCams(v) : [], routerOn:r.on, routerOff:r.off,
    power: live ? {low:lowBattery(pw), battery:pw.b, nightLow: typeof pw.nl==="number" ? pw.nl : null} : null,
    canCheck: !!(hooks && typeof hooks.onCheckUnit==="function" && checkPid(v)),
    routerPage: !!(u.ri && IPV4.test(u.ri) && /^\d+$/.test(u.rp)),
    camPages: !!(v.ip && IPV4.test(v.ip) && (u.s==="a" || u.s==="v")) };
}
/* Send to IT: the result goes onto the next daily IT sheet, Manager help YES flagged, instead of being copied by hand.
   Sent once per result; a new answer makes a new result. Drawn only where the app can send. */
function sendBox(v, at, note, tr){
  if(!hooks || typeof hooks.onSendTrouble!=="function") return null;
  const key = JSON.stringify(tr.ans), st = tr.sent && tr.sent.key===key ? tr.sent : null;
  if(st && st.state==="done") return h("p",{class:"note s-up trsent",text:"Sent to IT"+(st.by ? " by "+st.by : "")+" · "+st.at+". It goes on the next IT sheet"+(at.managerHelp ? ", flagged for the manager." : ".")});
  const go = async () => {
    if(tr.sent && tr.sent.state==="run") return;
    tr.sent = {key, state:"run", id: (tr.sent && tr.sent.key===key && tr.sent.id) || crypto.randomUUID()};
    drawPanel();
    try{
      const got = await hooks.onSendTrouble({requestId: tr.sent.id, unitKey: v.k, unitName: v.name, result: at.title, next: at.next || "", managerHelp: !!at.managerHelp, note});
      tr.sent = {key, state:"done", id: tr.sent.id, by: got && got.by || "", at: got && got.at ? when(Math.round(Date.parse(got.at)/1000)) : "just now"};
    }catch(err){
      tr.sent = {key, state:"fail", id: tr.sent.id, said: (err && err.message) || "COS could not send it. Copy the note instead."};
    }
    drawPanel();
  };
  return h("div",null,
    h("button",{class:"trbtn go trsend",type:"button",disabled: !!(st && st.state==="run"),onclick:go}, st && st.state==="run" ? "Sending…" : "Send to IT"),
    st && st.state==="fail" ? h("p",{class:"note s-down",text:st.said}) : null);
}
/* The bar of tools under the diagnosis: Troubleshoot and Check this unit now, big and in color. Null when the card has neither. */
function toolsBar(v, tb){
  const pid = !v.mhOnly && hooks && typeof hooks.onCheckUnit==="function" ? checkPid(v) : "";
  if(!tb && !pid) return null;
  const c = S.chk && S.chk.unit===v.id ? S.chk : null;
  const jump = id => { const el=$("panel").querySelector("#"+id); if(el) el.scrollIntoView({behavior:"smooth", block:"start"}); };
  return h("div",{class:"tools"},
    tb ? h("button",{class:"tool t-tr",type:"button",onclick:()=>jump("trBox")},h("b",{text:"Troubleshoot"}),h("span",{text:"Step by step, from what COS knows"})) : null,
    pid ? h("button",{class:"tool t-ck",type:"button",disabled:S.busy,onclick:()=>{ checkNow(v); jump("chkBox"); }},
      h("b",{text: c && c.state==="run" ? "Checking…" : "Check this unit now"}),h("span",{text:"Ask the cameras right now"})) : null);
}
/* Troubleshoot: what COS knows first, then one question at a time. Returns null where there is nothing to troubleshoot. */
function troubleBox(v){
  if(v.mhOnly || v.u.s==="r") return null;
  const f=troubleFacts(v), tr = S.tr && S.tr.unit===v.id ? S.tr : (S.tr={unit:v.id, ans:{}});
  const walk=troubleWalk(f, tr.ans); if(!walk.at) return null;
  const known=troubleKnown(f, when, s=>ago(s));
  const box=h("div",{class:"box trb",id:"trBox"},h("h3",{text:"Troubleshoot"}));
  if(known.length) box.append(h("ul",{class:"trknown"},known.map(k=>h("li",{text:k}))),h("p",{class:"note",text:"COS already knows this, so you don't have to look it up."}));
  if(walk.trail.length) box.append(h("ol",{class:"trtrail"},walk.trail.map((t,i)=>t.auto ? h("li",null,
    h("div",{class:"trback trauto"},h("span",{text:t.question}),h("b",{text:t.answer}))) : h("li",null,
    h("button",{class:"trback",type:"button",onclick:()=>{ const keep={}; walk.trail.slice(0,i).forEach(x=>keep[x.id]=tr.ans[x.id]); tr.ans=keep; drawPanel(); }},
      h("span",{text:t.question}),h("b",{text:t.answer}))))));
  const at=walk.at;
  if(at.kind==="step"){
    box.append(h("span",{class:"trwho",text:at.who}),h("p",{class:"trq",text:at.question}),
      h("ol",{class:"steps trhow"},at.how.map(t=>h("li",{text:t}))),
      h("div",{class:"tropts"},at.options.map(o=>h("button",{class:"trbtn",type:"button",onclick:()=>{ tr.ans[at.id]=o.key; drawPanel(); }},o.label))));
  } else {
    const note=troubleNote(v.name, known, walk, fmtDate.format(new Date()));
    box.append(h("div",{class:"trres t-"+at.tone},h("p",{class:"trq",text:at.title}),h("ul",null,at.todo.map(t=>h("li",{text:t}))),
        h("p",{class:"trhelp",text:"Manager help: "+(at.managerHelp ? "YES — write what is needed; the manager arranges any visit." : "No")})),
      h("pre",{class:"trnote",text:note}),
      sendBox(v, at, note, tr),
      h("div",{class:"tropts two"},
        h("button",{class:"trbtn go",type:"button",onclick:()=>{ try{ navigator.clipboard.writeText(note).then(()=>toast("Note copied."),()=>toast("Couldn't copy in this view.")); }catch(_){ toast("Couldn't copy in this view."); } }},"Copy note"),
        h("button",{class:"trbtn",type:"button",onclick:()=>{ tr.ans={}; drawPanel(); }},"Start over")));
  }
  if(walk.trail.length && at.kind==="step") box.append(h("p",{class:"note",text:"Tap an answer above to change it."}));
  return box;
}
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/* Cards show the last part of an IP only. Copy IP and the unit links still use the whole address. */
const ipCard = ip => S.ipShown ? String(ip||"") : ipShort(ip);
const ipShort = ip => { ip=String(ip||""); return IPV4.test(ip) ? "ending ."+ip.split(".")[3] : ip; };
function openBox(v){
  const u=v.u, m = S.mh && S.rec ? S.rec.match[v.id] : (v.mhOnly ? {rec:v.rec} : null), sys=[], own=[];
  const lk=(label,url)=>h("a",{class:"lk",href:url,target:"_blank",rel:"noopener noreferrer"},label);
  /* James, 25 Nov: keep the Star4Live button, and a VCC button (Vigilant Control Center, the address he gave). */
  if(u.s==="v"){ sys.push(lk("VCC","https://www.vigilantcontrolcenter.com/login")); sys.push(lk("Star4Live","https://global.star4live.com/userWeb/device/device-management")); }
  if(u.rs || u.rr || u.ri) sys.push(lk("InHand routers","https://iot.inhandnetworks.com/device/list"));
  if(v.type==="Helios" || /^Helios/.test(v.type)) sys.push(lk("Victron VRM","https://vrm.victronenergy.com/"));
  sys.push(lk("Watchful","https://v2.watchful.co.nz/alerts"));
  if(v.ip && IPV4.test(v.ip)){
    const ports = u.s==="a" ? [["Web","http",80],["HTTPS","https",443],["HTTPS 8443","https",8443]] : u.s==="v" ? [["Port 80","http",80],["Port 1400","http",1400],["Port 1500","http",1500],["Port 1600","http",1600],["Port 1700","http",1700]] : [];
    for(const [label,proto,port] of ports) own.push(lk(label, proto+"://"+v.ip+((port===80||port===443) ? "" : ":"+port)));
  }
  if(u.ri && IPV4.test(u.ri) && /^\d+$/.test(u.rp)) own.push(lk("Router page", "http://"+u.ri+":"+u.rp));
  /* SIM and cell signal (James, 25 Nov): carrier coverage at the site, carrier outages, and Simetry to work on the SIM.
     Simetry opens its own sign-in page; the long sign-in link James pasted expires, so it is not kept. */
  const sim=[lk("Coverage map","https://map.coveragemap.com/"), lk("Downdetector","https://downdetector.com/"), lk("Simetry","https://simetry.onelogin.com/login2/")];
  const copy = v.ip ? h("button",{class:"lk",type:"button",onclick:()=>{ try{ navigator.clipboard.writeText(v.ip).then(()=>toast("IP copied."),()=>toast("Couldn't copy the IP in this view.")); }catch(_){ toast("Couldn't copy the IP in this view."); } }},"Copy IP") : null;
  const show = v.ip && IPV4.test(v.ip) ? h("button",{class:"lk",type:"button",onclick:()=>{ S.ipShown=!S.ipShown; drawPanel(); }}, S.ipShown ? "Hide IP" : "Show IP") : null;
  return h("div",{class:"box"},h("h3",{text:"Open"}),
    S.ipShown && v.ip ? h("p",{style:"margin:0 0 8px;font-size:18px;font-weight:700;letter-spacing:.02em",text:v.ip}) : null,
    h("div",{class:"links"},sys,show,copy),
    h("p",{class:"note",style:"margin-top:10px",text:"SIM and cell signal: check the carrier's coverage at the site, look for a carrier outage, and work on the SIM in Simetry."}),
    h("div",{class:"links simtools"},sim),
    own.length ? h("p",{class:"note",style:"margin-top:10px",text:"This unit's own pages. They only open if the unit is online and your network can reach it."}) : null,
    own.length ? h("div",{class:"links"},own) : null); }
function logBox(){ return null; }
/* Email a vendor (James, 25 Nov): cancel a SIM with Vendera or Simetry, or add / remove / swap a unit at an Eyeforce
   account (Stages and Watchful). The server keeps one template per request, the same every time; the card fills the
   blanks it knows, shows the exact email, and sends it with one tap. Owner only: it goes out from James's Gmail. */
const VEN = { conn:null, denied:false, unit:null, tpls:null, err:"", kind:null, vals:{}, mail:null, missing:[], busy:false, result:null, id:null, recent:null, open:{}, cams:0, camMsg:"", form:null, account:null, acct:null };
function vendorBox(v, mm){
  if(!hooks || !hooks.vendor || VEN.denied) return null;
  if(VEN.unit!==v.name){ Object.assign(VEN,{unit:v.name,kind:null,vals:{},mail:null,missing:[],result:null,id:null,recent:null,account:null,acct:null}); vendorRecentLoad(v.name); vendorAccountLoad(v.name); }
  const box=h("div",{class:"box ven",id:"venBox"},h("h3",{text:"Email a vendor"}));
  if(!VEN.tpls){
    if(!VEN.err && !VEN.busy){ VEN.busy=true; hooks.vendor.templates().then(t=>{ VEN.tpls=t; VEN.err=""; if(typeof hooks.vendor.check==="function") hooks.vendor.check().then(c=>{ VEN.conn=c; drawPanel(); },()=>{}); },e=>{ if(e&&e.denied) VEN.denied=true; else VEN.err=(e&&e.message)||"Vendor emails are not available right now."; }).finally(()=>{ VEN.busy=false; drawPanel(); }); }
    box.append(h("p",{class:"note",text: VEN.err || "Loading…"})); return box;
  }
  const known={unit:v.name, customer:(mm&&mm.rec.cust)||"", site:v.site||"", address:(mm&&mm.rec.addr)||""};
  if(VEN.account && VEN.account.eye) known.eye=VEN.account.eye;
  const start=kind=>{ const t=VEN.tpls[kind]; VEN.kind=kind; VEN.mail=null; VEN.missing=[]; VEN.result=null; VEN.id=crypto.randomUUID();
    VEN.vals=Object.assign({}, t.defaults||{}, Object.fromEntries(t.fields.map(f=>[f.key, known[f.key]!==undefined ? known[f.key] : (t.defaults||{})[f.key]||""])));
    VEN.open={}; VEN.cams=0; VEN.camMsg=""; VEN.form=null;
    // Eyeforce forms: today's date, and the unit's cameras from COS for the camera tab (an account add only; a swap asks which unit went in).
    if(t.form){ VEN.vals.date=VEN.vals.date||new Intl.DateTimeFormat("en-US",{timeZone:TZ,month:"2-digit",day:"2-digit",year:"numeric"}).format(new Date());
      if(t.fields.some(f=>f.key==="s_sun_start")) VEN.vals.cams_total=VEN.vals.cams_total||String((v.u&&v.u.n)||"");
      VEN.cams=1; if(kind==="monitor_add") vendorCams(v.name); }
    drawPanel(); };
  const groups=[["SIM card",["sim_cancel_vendera","sim_cancel_simetry"]],["Monitoring account (Stages and Watchful)",["monitor_add","monitor_remove","monitor_swap"]]];
  const c=VEN.conn, owner=!!VEN.tpls.sim_cancel_vendera;
  if(c && (!c.account_ok || c.can_send===false)) box.append(h("p",{class:"note s-down",role:"alert",text:"COS cannot send email from "+(owner?"your":"James's")+" Gmail right now"+(c.error?": "+c.error:".")+" Nothing will be sent until the Google connection is fixed."}));
  else if(owner && c && (c.can_edit_sheets===false || c.sheet_opens===false)) box.append(h("p",{class:"note s-issues",text:"COS can send the emails, but it cannot write to the deactivation sheet yet. After a SIM or monitoring cancellation, add the row by hand."}));
  if(!VEN.kind){
    box.append(h("p",{class:"note",text: owner ? "Pick what you need. COS fills in what it knows, shows you the exact email, and sends it from your Gmail with IT@ in copy."
      : "Fill in Eyeforce's form here. COS emails it to Eyeforce TechOps from James's Gmail, with IT@ in copy and the filled form attached."}));
    for(const [label,kinds] of groups) box.append(h("p",{class:"vlabel",text:label}),h("div",{class:"vbtns"},...kinds.filter(k=>VEN.tpls[k]).map(k=>h("button",{class:"vbtn",type:"button",onclick:()=>start(k)},VEN.tpls[k].button))));
    const acct=vendorAccountRow(v); if(acct) box.append(acct);
  } else {
    const t=VEN.tpls[VEN.kind];
    box.append(h("div",{class:"vhead"},h("b",{text:t.title}),h("button",{class:"lk",type:"button",disabled:VEN.busy,onclick:()=>{ VEN.kind=null; drawPanel(); }},"Back")));
    if(VEN.result){
      const r=VEN.result, ok=r.state==="sent";
      box.append(h("p",{class:"big "+(ok?"s-up":"s-down"),role:ok?"status":"alert",text: ok ? "Sent to "+t.to+"." : r.state==="review" ? r.error : "Not sent. "+(r.error||"")}));
      if(ok && t.sheet) box.append(h("p",{class:"note",text: /^added/.test(r.sheet) ? "Added to the deactivation sheet ("+r.sheet.replace(/^added /,"")+")." : "The deactivation sheet was NOT updated ("+r.sheet+"). Add the row by hand."}));
      box.append(h("div",{class:"vbtns"},h("button",{class:"vbtn",type:"button",onclick:()=>{ VEN.kind=null; VEN.result=null; drawPanel(); }},"Done")));
    } else if(VEN.mail){
      const m=VEN.mail;
      box.append(h("dl",{class:"kv"},h("dt",{text:"To"}),h("dd",{text:m.to}),h("dt",{text:"Copy"}),h("dd",{text:m.cc}),h("dt",{text:"Subject"}),h("dd",{text:m.subject}),
          VEN.form?h("dt",{text:"Attached"}):null, VEN.form?h("dd",{},VEN.form," ",h("button",{class:"lk",type:"button",disabled:VEN.busy,onclick:()=>vendorOpenForm()},"Open it")):null),
        h("pre",{class:"vmail",text:m.body}),
        h("div",{class:"vbtns"},
          h("button",{class:"vbtn vsend",type:"button",disabled:VEN.busy,onclick:()=>vendorSend()},VEN.busy?"Sending…":"Send email"),
          h("button",{class:"vbtn alt",type:"button",disabled:VEN.busy,onclick:()=>{ VEN.mail=null; drawPanel(); }},"Change something")));
    } else if(t.form){
      vendorFormFields(t, box);
      if(VEN.missing.length) box.append(h("p",{class:"note s-down",role:"alert",text:"Fill in: "+VEN.missing.join(", ")}));
      box.append(h("div",{class:"vbtns"},h("button",{class:"vbtn vsend",type:"button",disabled:VEN.busy,onclick:()=>vendorPreview()},VEN.busy?"Preparing…":"Preview email and form")));
    } else {
      for(const f of t.fields){
        const input=f.long ? h("textarea",{class:"tin",rows:"3","aria-label":f.label,oninput:e=>{ VEN.vals[f.key]=e.target.value; }},VEN.vals[f.key]||"")
          : h("input",{class:"tin",type:"text","aria-label":f.label,value:VEN.vals[f.key]||"",oninput:e=>{ VEN.vals[f.key]=e.target.value; }});
        box.append(h("label",{class:"mgfield"},f.label+(f.required?"":" (optional)"),input,f.hint?h("span",{class:"note",text:f.hint}):null));
      }
      if(VEN.missing.length) box.append(h("p",{class:"note s-down",role:"alert",text:"Fill in: "+VEN.missing.join(", ")}));
      box.append(h("div",{class:"vbtns"},h("button",{class:"vbtn vsend",type:"button",disabled:VEN.busy,onclick:()=>vendorPreview()},VEN.busy?"Preparing…":"Preview email")));
    }
  }
  if(VEN.recent && VEN.recent.length) box.append(h("p",{class:"vlabel",text:"Sent for "+v.name}),
    ...VEN.recent.map(r=>h("p",{class:"note",text:(r.state==="sent"?"Sent":r.state==="review"?"Check Sent folder":"Not sent")+" · "+r.subject+" · "+r.by+(r.at?" · "+when(Math.round(Date.parse(r.at)/1000)):"")})));
  return box;
}
// The Eyeforce form, section by section, with Eyeforce's own drop-down lists.
function vendorFormFields(t, box){
  const vals=VEN.vals, sections=[];
  for(const f of t.fields){ const sec=f.section||""; let s=sections.find(x=>x.name===sec); if(!s){ s={name:sec,fields:[]}; sections.push(s); } s.fields.push(f); }
  const control=(f, label)=>{
    const set=e=>{ vals[f.key]=e.target.value; };
    let input;
    if(f.options){ input=h("select",{class:"tin","aria-label":label||f.label,onchange:set},h("option",{value:""},f.required?"Pick":"—"),
        ...f.options.map(o=>h("option",{value:o,selected:vals[f.key]===o},(f.labels&&f.labels[o])||o)));
      if(vals[f.key] && !f.options.includes(vals[f.key])) input.append(h("option",{value:vals[f.key],selected:true},vals[f.key])); }
    else if(f.long) input=h("textarea",{class:"tin",rows:"3","aria-label":label||f.label,oninput:set},vals[f.key]||"");
    else input=h("input",{class:"tin",type:f.secret?"password":"text",autocomplete:f.secret?"new-password":"off","aria-label":label||f.label,value:vals[f.key]||"",oninput:set});
    return input;
  };
  const blank=s=>s.fields.filter(f=>f.required && !(vals[f.key]||"").trim()).length;
  sections.forEach((s,i)=>{
    const open = VEN.open[s.name]!==undefined ? VEN.open[s.name] : i===0;
    const left=blank(s);
    const d=h("details",{class:"vsec",open:open,ontoggle:e=>{ VEN.open[s.name]=e.target.open; }},
      h("summary",{},h("span",{text:s.name}),h("span",{class:"vcount"+(left?" s-down":""),text:left?left+" to fill":"✓"})));
    const days=s.fields.filter(f=>f.group==="day"), cams=s.fields.filter(f=>f.group==="cam"), rest=s.fields.filter(f=>!f.group);
    for(const f of rest) d.append(h("label",{class:"mgfield"},f.label+(f.required?"":" (optional)"),control(f),f.hint?h("span",{class:"note",text:f.hint}):null));
    if(days.length){
      const rows=[]; for(const f of days){ const m=/^(\w)_(\w+)_(start|end|cams)$/.exec(f.key); if(!m) continue; let r=rows.find(x=>x.k===m[1]+m[2]); if(!r){ r={k:m[1]+m[2],p:m[1],d:m[2],name:f.label.replace(/ (start|end|cameras)$/,""),f:{}}; rows.push(r); } r.f[m[3]]=f; }
      const p=rows[0].p;
      d.append(h("div",{class:"vbtns"},h("button",{class:"vbtn alt",type:"button",onclick:()=>{ const a=vals[p+"_sun_start"], b=vals[p+"_sun_end"];
        if(!a||!b){ toast("Pick Sunday's start and end first."); return; }
        for(const r of rows) if(r.p===p && r.d!=="sun" && ["mon","tue","wed","thu","fri","sat"].includes(r.d)){ vals[r.k[0]+"_"+r.d+"_start"]="Same as above"; vals[r.k[0]+"_"+r.d+"_end"]="Same as above"; }
        drawPanel(); }},"Same hours every day")));
      const grid=h("div",{class:"vdays"},h("b",{text:"Day"}),h("b",{text:"Start"}),h("b",{text:"End"}),h("b",{text:"Cameras"}));
      for(const r of rows) grid.append(h("span",{class:"vday",text:r.name+(r.f.start&&r.f.start.required?" *":"")}),
        control(r.f.start,r.name+" start"),control(r.f.end,r.name+" end"),r.f.cams?control(r.f.cams,r.name+" cameras"):h("span"));
      d.append(grid);
    }
    if(cams.length){
      const unitFor = t.fields.some(f=>f.key==="new_unit") ? "new_unit" : "unit";
      d.append(h("div",{class:"vbtns"},
        h("button",{class:"vbtn alt",type:"button",disabled:VEN.busy,onclick:()=>{ const u=(vals[unitFor]||"").trim(); if(!u){ toast("Type the unit first."); return; } vendorCams(u); }},"Fill cameras from COS"),
        h("button",{class:"vbtn alt",type:"button",onclick:()=>{ const n=Math.max(1,camCount()); for(let i=2;i<=n;i++){ if(!vals["cam"+i+"_login"]) vals["cam"+i+"_login"]=vals.cam1_login||""; if(!vals["cam"+i+"_password"]) vals["cam"+i+"_password"]=vals.cam1_password||""; } drawPanel(); }},"Use camera 1's login for all")));
      if(VEN.camMsg) d.append(h("p",{class:"note",role:"status",text:VEN.camMsg}));
      const n=Math.min(16,Math.max(VEN.cams,camCount(),1));
      for(let i=1;i<=n;i++){
        const card=h("div",{class:"vcam"},h("b",{text:"Camera "+i}));
        for(const f of cams.filter(x=>x.row===i)) card.append(h("label",{class:"mgfield"},f.label,control(f,"Camera "+i+" "+f.label)));
        d.append(card);
      }
      if(n<16) d.append(h("div",{class:"vbtns"},h("button",{class:"vbtn alt",type:"button",onclick:()=>{ VEN.cams=n+1; drawPanel(); }},"Add a camera")));
    }
    box.append(d);
  });
}
function camCount(){ let n=0; for(let i=1;i<=16;i++) if(["name","type","ip","port","login","password","serial","audio"].some(k=>(VEN.vals["cam"+i+"_"+k]||"").trim())) n=i; return n; }
async function vendorCams(unit){
  if(!hooks.vendor.cameras) return;
  VEN.camMsg="Looking up "+unit+"'s cameras in COS…"; drawPanel();
  try{
    const list=await hooks.vendor.cameras(unit);
    if(!list.length){ VEN.camMsg="COS has no cameras on record for "+unit+". Type them in."; }
    else {
      for(let i=1;i<=16;i++) for(const k of ["name","type","ip","port","serial"]) delete VEN.vals["cam"+i+"_"+k];
      list.forEach((c,i)=>{ const n=i+1; VEN.vals["cam"+n+"_name"]=c.name; VEN.vals["cam"+n+"_type"]=c.type; VEN.vals["cam"+n+"_ip"]=c.ip; VEN.vals["cam"+n+"_port"]=c.port; VEN.vals["cam"+n+"_serial"]=c.serial; });
      VEN.cams=list.length;
      VEN.camMsg=list.length+" camera"+(list.length===1?"":"s")+" filled in from COS. Add the login and password for each, and whether it has audio.";
    }
  }catch(_){ VEN.camMsg="COS could not look up the cameras. Type them in."; }
  drawPanel();
}
async function vendorOpenForm(){
  if(VEN.busy || !hooks.vendor.form) return; VEN.busy=true; drawPanel();
  try{ await hooks.vendor.form(VEN.kind, VEN.vals); }catch(e){ toast((e&&e.message)||"The form could not be opened."); }
  VEN.busy=false; drawPanel();
}
/* The unit's Eyeforce account number: saved once, then Remove account and Swap unit fill it in. */
function vendorAccountRow(v){
  if(typeof hooks.vendor.account!=="function" || !VEN.account) return null;
  const a=VEN.account, e=VEN.acct, wrap=h("div",{id:"venAcct"},h("p",{class:"vlabel",text:"Eyeforce account number"}));
  if(e){
    wrap.append(h("label",{class:"mgfield"},"Account number for "+v.name,h("input",{class:"tin",type:"text",maxlength:"12",placeholder:"EYE17351","aria-label":"Eyeforce account number",value:e.text,oninput:x=>{ e.text=x.target.value; }}),
        h("span",{class:"note",text:"Leave it empty and save to clear it."})),
      e.err ? h("p",{class:"note s-down",role:"alert",text:e.err}) : null,
      h("div",{class:"vbtns"},h("button",{class:"vbtn vsend",type:"button",disabled:e.busy,onclick:()=>vendorAccountSave(v.name)},e.busy?"Saving…":"Save number"),
        h("button",{class:"vbtn alt",type:"button",disabled:e.busy,onclick:()=>{ VEN.acct=null; drawPanel(); }},"Cancel")));
    return wrap;
  }
  wrap.append(h("p",{class:"note"},a.eye ? h("b",{text:a.eye}) : "None saved for this unit yet.",
    a.eye ? (a.how==="camera_record" ? " · from the camera record" : a.by ? " · saved by "+a.by : "") : "", " ",
    h("button",{class:"lk",type:"button",onclick:()=>{ VEN.acct={text:a.eye||"",err:"",busy:false}; drawPanel(); }},a.eye?"Change":"Add it")));
  return wrap;
}
async function vendorAccountLoad(unit){ if(typeof hooks.vendor.account!=="function") return; try{ const a=await hooks.vendor.account(unit); if(VEN.unit===unit){ VEN.account=a; drawPanel(); } }catch(_){} }
async function vendorAccountSave(unit){
  const e=VEN.acct; if(!e || e.busy) return;
  const eye=String(e.text||"").toUpperCase().replace(/\s/g,"");
  if(eye && !/^EYE\d{3,8}$/.test(eye)){ e.err="An Eyeforce account number looks like EYE17351."; drawPanel(); return; }
  e.busy=true; e.err=""; drawPanel();
  try{ const a=await hooks.vendor.accountSet(unit, eye); if(VEN.unit===unit){ VEN.account=a; VEN.acct=null; } toast(eye ? eye+" is saved on "+unit+"." : "The account number is cleared.", 6000); }
  catch(x){ e.busy=false; e.err=(x&&x.message)||"The account number could not be saved."; }
  drawPanel();
}
async function vendorRecentLoad(unit){ try{ const r=await hooks.vendor.recent(unit); if(VEN.unit===unit){ VEN.recent=r; drawPanel(); } }catch(_){} }
async function vendorPreview(){
  VEN.busy=true; VEN.missing=[]; drawPanel();
  try{ const r=await hooks.vendor.preview(VEN.kind, VEN.vals); if(r.mail){ VEN.mail=r.mail; VEN.form=r.form||null; } else VEN.missing=r.missing||[]; }
  catch(e){ VEN.missing=[(e&&e.message)||"The email could not be prepared."]; }
  VEN.busy=false; drawPanel();
}
async function vendorSend(){
  if(VEN.busy) return; VEN.busy=true; drawPanel();
  try{ VEN.result=await hooks.vendor.send(VEN.kind, VEN.vals, VEN.id); }
  catch(e){ VEN.result={state:"failed",sheet:"",error:(e&&e.message)||"The email could not be sent."}; }
  VEN.busy=false; drawPanel(); vendorRecentLoad(VEN.unit);
  if(VEN.kind==="monitor_swap") vendorAccountLoad(VEN.unit);
  if(VQ.data) vqLoad();
}
function histBox(v){ const hist=(v.u && v.u.hx)||[]; return hist.length ? h("div",{class:"box"},h("h3",{text:"Set by hand on this unit"}),h("ul",{class:"hist"},hist.map(x=>histLi(x,null)))) : null; }
function drawMhPanel(v){
  const P=$("panel"), r=v.rec, dl=h("dl",{class:"kv"});
  for(const [a,b] of [["Where",(v.place==="field"?"Field":"Shop")+" · per mHelp"],["Site",v.site||"—"],["Type",v.type+" · "+v.fam],["mHelp","A# "+r.id+" · listed as "+r.label+(r.flag==="D"?" · marked DO NOT USE":"")],["Camera feed","None under this name"]]) dl.append(h("dt",{text:a}),h("dd",{text:b}));
  P.className="panel s-"+v.status;
  P.replaceChildren(h("div",{class:"phead"},h("div",null,h("span",{class:"pill s-"+v.status,text:LABEL[v.status]}),h("h2",{id:"pname",text:v.name})),h("button",{class:"close",type:"button",onclick:closeUnit},"Close")),
    h("div",{class:"pbody"}, h("div",{class:"box"},h("h3",{text:"What it says"}),dl,h("p",{class:"note",text:v.why})),
      h("div",{class:"box"},h("h3",{text:"What to do"}),h("ol",{class:"steps"},steps(v).map(t=>h("li",{text:t})))),
      resBox(resFor(v.name, v.k)), locBox(v), openBox(v), logBox(v),
      h("div",{class:"box"},h("h3",{text:"Fix it"}),h("p",{class:"note",text:"This unit comes straight from mHelp. Change its name or placement in mHelp, then tap Refresh."})),
      histBox(v)));
}
function powerBox(v){
  const p=v.u.pw, go = hooks && typeof hooks.onScreen==="function" ? h("button",{class:"lk",type:"button",onclick:()=>hooks.onScreen("Victron VRM")},"Open Victron Power") : null;
  if(!p) return h("div",{class:"box"},h("h3",{text:"Power"}),h("p",{class:"note",text:S.meta ? "No Victron installation matches this Helios number, or the Victron reading has not loaded yet." : "Loading the Victron reading…"}),go?h("div",{class:"links"},go):null);
  const fill = h("b"); fill.style.width = (p.b!==null ? Math.max(0,Math.min(100,p.b)) : 0)+"%"; const bar = h("span",{class:"pwbar"},fill);
  const tiles = h("div",{class:"pwtiles"},
    h("div",{class:"pwt q-"+p.q},h("span",{text:"Battery"}),h("b",{text:p.b!==null ? p.b+"%" : "—"}),bar),
    h("div",{class:"pwt"},h("span",{text:"Solar"}),h("b",{text:p.w!==null ? p.w+" W" : "—"})),
    h("div",{class:"pwt"},h("span",{text:"Voltage"}),h("b",{text:p.v!==null ? p.v+" V" : "—"})),
    h("div",{class:"pwt fl-"+(p.f ? p.f.s : "none")},h("span",{text:"Right now"}),h("b",{text:p.f && p.q!=="stale" ? (p.f.s==="charging" ? "↑ Charging" : p.f.s==="draining" ? "↓ Draining" : "Idle") : "—"}),p.f && p.f.s!=="idle" && p.f.w!==null ? h("small",{text:Math.abs(p.f.w)+" W"}) : null));
  const last = p.ls ? " Last connected to Victron "+when(p.ls)+"." : "";
  const note = p.q==="off" ? "This installation was not in the latest Victron sync."+last : p.q==="stale" ? "No reading in the last 45 minutes, so it is not called current."+last : p.q==="none" ? "Victron has no battery reading for this unit."+last : "Victron reading"+(p.t ? " · "+when(p.t) : "")+". Cameras come from Star4Live; power comes from Victron. A low battery is not the same as a camera being down.";
  const alarm = p.al && p.q!=="stale" && p.q!=="off" ? h("p",{class:"pwalarm l"+p.al.l,text:"⚠ Victron "+(p.al.l===2 ? "alarm" : "warning")+": "+p.al.k+". Victron raised this itself, so check the battery and charge controller."}) : null;
  const hist = p.nl!==undefined || p.hf ? h("p",{class:"pwhist"+(p.hf ? " flag" : "")},
    p.nl!==undefined ? "Last night's low: "+p.nl+"%." : "", p.hf ? " "+p.hf.join(" · ")+"." : "") : null;
  const tn = p.tn && p.q!=="stale" && p.q!=="off" ? h("div",{class:"pwnight n-"+p.tn.v},
    h("span",{class:"pwnight-k",text:"Tonight"}),h("b",{text:p.tn.h}),h("small",{text:p.tn.b}),
    p.tn.s.length ? h("ol",null,...p.tn.s.map(step => h("li",{text:step}))) : null) : null;
  const sky = p.sk ? h("p",{class:"pwsky"+(p.sk.w ? " flag" : "")},h("span",{text:"Sun ahead "}),h("b",{text:p.sk.o}),p.sk.w ? h("small",{text:p.sk.w}) : null) : null;
  const panels = p.mp ? h("p",{class:"pwsky"+(p.mp.w ? " flag" : "")},h("span",{text:"Panels "}),h("b",{text:p.mp.l}),p.mp.w ? h("small",{text:p.mp.w.join(" · ")}) : null) : null;
  return h("div",{class:"box pwbox"},h("h3",{text:"Power"}),alarm,tn,tiles,hist,sky,panels,h("p",{class:"note",text:note}),go?h("div",{class:"links"},go):null);
}
function drawPanel(){
  const v = S.vmap && S.vmap[S.openId]; if(!v){ closeUnit(); return; }
  if(v.mhOnly){ drawMhPanel(v); return; }
  const u=v.u, P=$("panel");
  const src = u.s==="v" ? "Star4Live" : u.s==="a" ? "COS's own check" : "Recon cloud";
  let reading;
  if(u.s==="a") reading = u.t && v.last ? (v.last==="online"?"Online":"Offline")+" · checked "+when(u.t) : "No check on record";
  else reading = u.on+" of "+u.n+" online"+(u.off?" · "+u.off+" offline":"")+(v.unk?" · "+v.unk+" no reading":"")+(u.s==="r"&&u.t?" · last heard "+when(u.t):"");
  const kv=[["Where", (v.place==="field" ? "Field" : "Shop")+(v.hand.place ? " · set by hand" : v.mh ? " · per mHelp" : "")],["Site", v.site|| (v.place==="field"?"No site on record":"—")],["Type", v.type+" · "+v.fam],[src, reading]];
  if(v.srcDiff) kv.splice(2,0,[SRC(v)+" says", (v.feedPlace==="field"?"Field":"Shop")+(v.feedSite?" at "+v.feedSite:"")]);
  if(u.bad) kv.push([u.off ? "Not online" : "No reading", u.bad.split(";").join(", ")]);
  if(u.lo && v.fs!=="up") kv.push(["Last online", when(u.lo)]);
  if(v.ip) kv.push(["IP", ipCard(v.ip)+(v.hand.ip?" (typed by hand)":"")]);
  const mm = S.mh ? (S.rec && S.rec.match[v.id]) : undefined;
  if(mm) kv.push(["mHelp", (mm.rec.place==="field"?"Field":"Shop")+(mm.rec.cust?" · "+mm.rec.cust:"")+" · A# "+mm.rec.id+(mm.fuzzy?" · listed as "+mm.rec.label:"")+(mm.rec.flag==="D"?" · marked DO NOT USE":"")]);
  else if(S.mh) kv.push(["mHelp","Nothing by this name. Not counted."]);
  if(u.pid && (!mm || mm.rec.id!==u.pid)) kv.push(["A# in COS", u.pid]);
  if(u.rs) kv.push(["Router check", ({on:"Online",of:"Offline",un:"Unknown"}[u.rs]||u.rs)+(u.rt?" · "+when(u.rt):"")+" · reference only"]);
  if(u.fl.includes("d")) kv.push(["COS record","Marked deactivated"]);
  if(v.retired) kv.push(["Tracker","Retired"]);
  if(u.fl.includes("x")) kv.push(["Flag","Do not use"]);
  if(v.note) kv.push(["Note", v.note]);
  const dl=h("dl",{class:"kv"}); for(const [a,b] of kv) dl.append(h("dt",{text:a}),h("dd",{text:b}));

  const tb = troubleBox(v), ob = openBox(v);
  const tbx = tb || h("div",{class:"box"},h("h3",{text:"What to do"}),h("ol",{class:"steps"},steps(v).map(s=>h("li",{text:s}))));
  const dg = diagBox(v);
  const body=[ resBox(resFor(v.name, v.k, mm&&mm.rec.label)), dg, camsBox(v), routerBox(v),
    tbx,
    ob, vendorBox(v, mm), locBox(v), logBox(v),
    h("div",{class:"box"},h("h3",{text:"Details"}),dl, v.why?h("p",{class:"note",text:v.why}):null) ];
  if(v.type==="Helios") body.push(powerBox(v));

  /* Fix it */
  const can = S.can===true;
  const fx=h("div",{class:"box"},h("h3",{text:"Fix the record"}),h("p",{class:"note",text:"Only when COS has this unit's facts wrong. These change the record, not the cameras."}));
  if(!can) fx.append(h("p",{class:"note",text: S.canWhy || "Hand fixes are not available right now."}));
  else {
    const b=(label,key,alt)=>h("button",{class:"fixbtn"+(alt?" alt":""),type:"button",disabled:S.busy,onclick:()=>{S.form=key;drawPanel();}},label);
    fx.append(h("div",{class:"fix"},
      h("button",{class:"fixbtn alt",type:"button",disabled:S.busy,onclick:()=>{ if(v.place==="field") save(v,{place:"shop"}); else { S.form="tofield"; drawPanel(); } }}, v.place==="field"?"Move to shop":"Move to field"),
      b("Change site","site",true), b("Rename","name",true), b("Correct IP","ip",true),
      canLinkA(v) ? b("Add A#","pid",true) : null,
      v.edited ? b("Undo hand edits","undo",true) : null));
    const F={ site:["Site name",v.site,"site"], tofield:["Which site is it on?",v.site||v.feedSite,"site"], name:["Unit name",v.name,"name"], ip:["IP address",v.ip||"","ip"] }[S.form];
    if(S.form==="pid" && canLinkA(v)){
      /* An A# linked by hand (James, 25 Nov): so a unit mHelp could not match by name can still be checked. */
      const inp=h("input",{id:"fixInput",type:"text",inputmode:"numeric",autocomplete:"off",placeholder:"e.g. 2226712"});
      const go=()=>linkA(v, inp.value.replace(/^\s*A#?\s*/i,"").trim());
      fx.append(h("form",{class:"form",onsubmit:ev=>{ev.preventDefault();go();}},h("label",{for:"fixInput",text:"A# from mHelp"}),inp,
        h("p",{class:"note",text:"Digits only, as mHelp shows it. COS checks it is on the mHelp list and not already on another unit, then saves it with your name and the time."}),
        h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Link A#"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{S.form=null;drawPanel();}},"Cancel"))));
      setTimeout(()=>{ try{ inp.focus(); }catch(_){} },0);
    } else if(S.form==="undo"){
      fx.append(h("div",{class:"form"},
        h("p",{class:"note",text:"This clears what was set by hand on "+v.name+": "+((u.hx||[]).map(x=>FIELD[x.f]||x.f).join(", ")||"nothing")+". The unit goes back to what "+(u.s==="v"?"Star4Live":u.s==="a"?"the COS record":"the Recon cloud")+" reports."}),
        h("div",{class:"btns"},h("button",{class:"fixbtn",type:"button",disabled:S.busy,onclick:()=>save(v,{__reset:true})},"Clear them"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{S.form=null;drawPanel();}},"Cancel"))));
    } else if(F){
      const inp=h("input",{id:"fixInput",type:"text",value:F[1]||"",autocomplete:"off"});
      const go=()=>{ const val=inp.value.trim(); const ch={}; ch[F[2]]=val; if(S.form==="tofield") ch.place="field"; if(S.form==="site" && val && v.place==="shop") ch.place="field"; save(v,ch); };
      fx.append(h("form",{class:"form",onsubmit:ev=>{ev.preventDefault();go();}},h("label",{for:"fixInput",text:F[0]}),inp,
        h("p",{class:"note",text: S.form==="ip" ? "A public IP address. COS checks the unit at this address. Leave empty to go back to the IP on record." : S.form==="name" ? "Leave empty to go back to the name on record." : S.form==="tofield" ? "Saved exactly as typed. Leave empty to move it without naming a site." : "Saved exactly as typed. Leave empty to go back to the site on record."}),
        h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Save"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{S.form=null;drawPanel();}},"Cancel"))));
      setTimeout(()=>{ try{ inp.focus(); }catch(_){} },0);
    }
    fx.append(h("p",{class:"note",text:"A fix made by hand wins in COS and stays until someone undoes it. No new reading from mHelp or Star4Live replaces it. It is saved with your name and the time. mHelp is the official count, so make the same change in mHelp."}));
  }
  /* Fixing the record comes after troubleshooting and the unit's own pages: most problems are not the record. */
  body.splice(body.indexOf(ob)+1,0,fx);

  /* Checking sits right before Troubleshoot, which uses it. James chose (25 Nov) to put troubleshooting ahead of
     record fixes: the red record buttons under the diagnosis looked like the answer to a camera fault and are not.
     Drawn only where the app can run a check and there is an A# to check against. */
  if(!v.mhOnly && hooks && typeof hooks.onCheckUnit==="function"){
    const c = S.chk && S.chk.unit===v.id ? S.chk : null, pid = checkPid(v);
    const cb=h("div",{class:"box chkb",id:"chkBox"},h("h3",{text:"Check it now"}));
    if(!pid) cb.append(h("p",{class:"note",text:"This unit has no A# in COS yet, so there is nothing to check it against. "+(canLinkA(v) && S.can===true ? "Add it under Fix the record with Add A#." : "Give it an A# in mHelp first.")}));
    else {
      cb.append(h("div",{class:"fix"},h("button",{class:"fixbtn",type:"button",disabled:S.busy,
        onclick:()=>checkNow(v)}, c && c.state==="run" ? "Checking…" : "Check this unit now")));
      if(c && c.state!=="run") cb.append(h("p",{class:"note"+(c.state==="fail" ? " s-down" : c.tone==="up" ? " s-up" : c.tone==="down" ? " s-down" : ""),text:c.said}));
      cb.append(h("p",{class:"note",text:"This asks the cameras at this unit right now instead of waiting for the next reading. It changes nothing in mHelp, Star4Live or InHand."}));
    }
    body.splice(body.indexOf(tbx),0,cb);
  }
  /* James: "i would have missed it cause it blends in." The tools sit in one bright bar right under the diagnosis,
     so nobody has to scroll or search for them. Each one jumps to its box or runs straight away. */
  const tools = toolsBar(v, tb);
  if(tools) body.splice(body.indexOf(dg)+1,0,tools);
  /* Anything sent to IT for this unit shows right under the tools, Open until someone closes it. */
  const sbx = sentBox(v); if(sbx) body.splice(body.indexOf(tools || dg)+1,0,sbx);
  body.push(histBox(v));

  P.className="panel s-"+v.status;
  P.replaceChildren(h("div",{class:"phead"},h("div",null,h("span",{class:"pill s-"+v.status,text:LABEL[v.status]}),h("h2",{id:"pname",text:v.name})),h("button",{class:"close",type:"button",onclick:closeUnit},"Close")),h("div",{class:"pbody"},body));
}
const FIELD = { place:"placement", site:"site", name:"name", ip:"IP", address:"address" };
/* A hand fix as it reads on a card: an IP by its last part only, and Shop or Field in plain words. */
const handValue = x => x.f==="ip" ? ipShort(x.b) : x.f==="place" ? (x.b==="SHOP" ? "Shop" : x.b==="FIELD" ? "Field" : x.b) : x.b;
function histLi(x, unitName){
  return h("li",null, unitName?h("b",{text:unitName+": "}):null, h("b",{text:x.by||"Someone"}),
    " set "+(FIELD[x.f]||x.f)+" to “"+(handValue(x)||"empty")+"”"+(x.why ? " · "+x.why : ""),
    h("time",{text: x.at ? when(Math.round(x.at/1000)) : "no time on record"}));
}
/* Every hand fix that is in force, across the fleet. COS keeps who made each one and when. */
function drawActivity(){
  const all=S.changes||[];
  $("actNote").textContent = all.length ? "Every hand fix in force in COS, newest first." : "No hand fixes are in force. When someone moves, renames or fixes a unit, it shows here with who and when.";
  $("activity").replaceChildren(...all.slice(0,300).map(x=>{ const v=S.vmap && S.vmap[unitId(x.k)]; return histLi(x, v ? v.name : (x.nm || x.k)); }));
}


/* ---------- where a unit is: pins ---------- */
const GEO = { W:-100.7, N:33.5, kx:86.60254037844388 };
const toXY=(lat,lng)=>[(lng-GEO.W)*GEO.kx,(GEO.N-lat)*100];
const toLL=(x,y)=>[GEO.N-y/100, x/GEO.kx+GEO.W];
const recOf = v => v.mhOnly ? v.rec : (S.rec && S.rec.match[v.id] ? S.rec.match[v.id].rec : null);
/* A pin dropped by hand wins. Otherwise the pin is the site address from mHelp, as the COS app already placed it. */
function pinOf(v){
  const e=v.e||{};
  if(e.pin && isFinite(+e.pin.lat) && isFinite(+e.pin.lng)) return {lat:+e.pin.lat,lng:+e.pin.lng,kind:"hand"};
  const rec=recOf(v); if(!rec || rec.place!=="field") return null;
  if(rec.lat && rec.lng) return {lat:rec.lat,lng:rec.lng,kind:rec.pk||"m"};
  const p=S.pins0 && S.pins0[rec.id]; return p ? {lat:p[0],lng:p[1],kind:p[2]} : null;
}
const llText = p => p.lat.toFixed(5)+", "+p.lng.toFixed(5);
/* Where a unit is. Inside COS a hand pin is an address a person typed: it is saved exactly as typed, and COS
   looks it up only to place the pin. */
function locBox(v){
  const rec=recOf(v), pin=pinOf(v), can = S.can===true && !v.mhOnly, hand = pin && pin.kind==="hand", typed = (v.u && v.u.ta) || "";
  if(v.place!=="field" && !hand) return null;
  const addr = typed || (rec && rec.addr ? rec.addr : "") || (v.u && v.u.ad) || "";
  const dest = hand ? pin.lat+","+pin.lng : addr ? addr : pin ? pin.lat+","+pin.lng : "";
  const says = hand ? "Pin is from the address typed by hand in COS, at "+llText(pin)+"."
    : typed ? "This address was typed by hand in COS. COS could not place a pin for it"+(pin ? ", so the map still shows the mHelp address." : ", so it is not on the map.")
    : !pin ? "No pin yet, so it is not on the map."
    : pin.kind==="r" ? "Pin is from the mHelp address and is approximate."
    : "Pin is from the mHelp address. It marks the address, not the unit's exact spot.";
  const box=h("div",{class:"box"},h("h3",{text:"Where it is"}),
    h("p",{style:"margin:0 0 6px;font-size:16px;font-weight:650",text: addr || (v.site ? v.site : "No address on record")}),
    h("p",{class:"note",text:says}),
    h("div",{class:"links",style:"margin-top:8px"},
      dest ? h("a",{class:"lk",href:"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(dest),target:"_blank",rel:"noopener noreferrer"},"Directions") : null,
      pin ? h("button",{class:"lk",type:"button",onclick:()=>showOnMap(v)},"Show on map") : null,
      can ? h("button",{class:"lk",type:"button",disabled:S.busy,onclick:()=>{ S.form = S.form==="pin" ? null : "pin"; drawPanel(); }}, typed ? "Change the address" : "Set the address") : null));
  if(S.form==="pin" && can){
    const inp=h("input",{id:"pinInput",type:"text",autocomplete:"off",value:typed,placeholder:"1200 Main St, Houston, TX 77002"});
    box.append(h("form",{class:"form",onsubmit:ev=>{ ev.preventDefault(); const val=inp.value.trim(); if(!val && !typed){ toast("Type the site address first."); return; } save(v,{address:val}); }},
      h("label",{for:"pinInput",text:"Site address"}), inp,
      h("p",{class:"note",text:"Saved exactly as typed. COS looks the address up only to place the pin."+(typed ? " Leave empty to clear the address typed by hand." : "")}),
      h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Save address"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{ S.form=null; drawPanel(); }},"Cancel"))));
    setTimeout(()=>{ try{ inp.focus(); }catch(_){} },0);
  }
  return box;
}

/* ---------- map ---------- */
const NS="http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids){ const e=document.createElementNS(NS,tag);
  if(attrs) for(const [k,val] of Object.entries(attrs)){ if(val==null||val===false) continue; if(k==="text") e.textContent=val; else if(k.startsWith("on")) e.addEventListener(k.slice(2),val); else e.setAttribute(k,val); }
  for(const kid of kids.flat()){ if(kid) e.append(kid); } return e; }
const M = { data:null, failed:false, built:false, z:1, tx:0, ty:0, w:0, h:0, f:"all", pts:[], none:[], sel:null, drop:null, focus:null, fitted:false, raf:0, dragged:false };
const SEV = { down:0, issues:1, unknown:2, up:3 }, PCOL = { down:"var(--down)", issues:"var(--warn)", unknown:"var(--unk)", up:"var(--up)" };
const ZMAX = 900, clampZ = z => Math.max(zMin(), Math.min(ZMAX, z));
function sizeMap(){ const r=$("mapWrap").getBoundingClientRect(); if(r.width>50){ M.w=r.width; M.h=r.height; } }
function centerOn(x,y,z){ M.z=clampZ(z); M.tx=M.w/2-x*M.z; M.ty=M.h/2-y*M.z; paint(); }
function fitPts(pts,pad,zcap){ if(!pts.length||!M.w) return; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const q of pts){ x0=Math.min(x0,q.x); y0=Math.min(y0,q.y); x1=Math.max(x1,q.x); y1=Math.max(y1,q.y); }
  pad=pad||40; let z=Math.min((M.w-2*pad)/Math.max(x1-x0,.01),(M.h-2*pad)/Math.max(y1-y0,.01),zcap||60); if(z<zMin()*1.25) z=zMin(); centerOn((x0+x1)/2,(y0+y1)/2,z); }
function zoomAt(px,py,f){ const nz=clampZ(M.z*f), k=nz/M.z; M.tx=px-(px-M.tx)*k; M.ty=py-(py-M.ty)*k; M.z=nz; paint(); }
/* The drawing has edges, so it is held inside its box: it can never be dragged away to leave the box empty.
   Pins beyond the drawn map still count as part of it, so every unit can be reached.
   When all of it already fits top to bottom there is nothing to move that way, so an up-or-down swipe scrolls the page. */
function mapEdges(){ let x0=0,y0=0,x1=M.data?M.data.w:660,y1=M.data?M.data.h:670; for(const q of M.pts){ x0=Math.min(x0,q.x-8); y0=Math.min(y0,q.y-8); x1=Math.max(x1,q.x+8); y1=Math.max(y1,q.y+8); } return [x0,y0,x1,y1]; }
/* The drawing is never smaller than its box, so the box is never part empty. */
function zMin(){ if(!M.w) return .3; const [x0,y0,x1,y1]=mapEdges(); return Math.max(M.w/(x1-x0), M.h/(y1-y0)); }
function hold(){
  if(!M.w) return;
  M.z=clampZ(M.z);
  const [x0,y0,x1,y1]=mapEdges(), cw=(x1-x0)*M.z, ch=(y1-y0)*M.z;
  M.tx = cw<=M.w ? (M.w-cw)/2-x0*M.z : Math.min(-x0*M.z, Math.max(M.w-x1*M.z, M.tx));
  M.ty = ch<=M.h ? (M.h-ch)/2-y0*M.z : Math.min(-y0*M.z, Math.max(M.h-y1*M.z, M.ty));
  $("mapSvg").style.touchAction = ch>M.h+.5 ? "none" : "pan-y";
}
function buildBase(){ if(M.built||!M.data) return; const d=M.data, P=(cls,dd)=>dd?sv("path",{class:cls,d:dd}):null;
  $("mapBase").replaceChildren(...[P("m-land",d.land),P("m-urban",d.urban),P("m-water",d.lakes),P("m-river",d.rivers),P("m-county",d.counties),P("m-road",d.roads),P("m-state",d.states),P("m-hwy",d.hwy)].filter(Boolean)); M.built=true; }
function clusters(){
  const show = M.pts.filter(q=>M.f==="all"||q.v.status===M.f).map(q=>({q,sx:q.x*M.z+M.tx,sy:q.y*M.z+M.ty})).filter(a=>a.sx>-24&&a.sy>-24&&a.sx<M.w+24&&a.sy<M.h+24);
  show.sort((a,b)=>(SEV[a.q.v.status]??2)-(SEV[b.q.v.status]??2));
  const cl=[]; for(const a of show){ let c=cl.find(c=>Math.hypot(c.sx-a.sx,c.sy-a.sy)<(M.near||26)); if(!c){ c={sx:a.sx,sy:a.sy,m:[]}; cl.push(c); } c.m.push(a.q); }
  return cl;
}
function paint(){ hold(); cancelAnimationFrame(M.raf); M.raf=requestAnimationFrame(paintNow); }
function paintNow(){
  if(!M.w) return;
  $("mapBase").setAttribute("transform","translate("+M.tx.toFixed(1)+","+M.ty.toFixed(1)+") scale("+M.z.toFixed(4)+")");
  const cl=clusters(), PK=M.pk||1, LK=M.pk?1.35:1, L=[], boxes=cl.map(c=>{ const n=c.m.length, r=(n===1?10:n>99?18:n>9?16:14.5)*PK; return [c.sx-r,c.sy-r,c.sx+r,c.sy+r]; });
  if(M.data){
    const minPop = M.z<1.5 ? 900000 : M.z<3 ? 250000 : M.z<5.5 ? 60000 : 0;
    for(const [name,x,y,pop] of M.data.places){ if(pop<minPop) continue; const sx=x*M.z+M.tx, sy=y*M.z+M.ty; if(sx<-60||sy<-10||sx>M.w+10||sy>M.h+10) continue;
      const tw=(name.length*7+10)*LK, up=9*LK, dn=7*LK;
      const under=boxes.find((o,k)=>k<cl.length && sx>o[0]&&sx<o[2]&&sy>o[1]&&sy<o[3]), a=under||[sx-3,sy-3,sx+3,sy+3], cx=(a[0]+a[2])/2, cy=(a[1]+a[3])/2;
      const spot=[[a[2]+3,cy-up,a[2]+3+tw,cy+dn,"start"],[a[0]-3-tw,cy-up,a[0]-3,cy+dn,"end"],[cx-tw/2,a[3]+2,cx+tw/2,a[3]+2+up+dn,"middle"],[cx-tw/2,a[1]-2-up-dn,cx+tw/2,a[1]-2,"middle"]].find(b=>!boxes.some(o=>o!==under && b[0]<o[2]&&b[2]>o[0]&&b[1]<o[3]&&b[3]>o[1]));
      if(!spot) continue; boxes.push(spot.slice(0,4));
      if(!under) L.push(sv("circle",{cx:sx.toFixed(1),cy:sy.toFixed(1),r:2.2,class:"pl-dot"}));
      L.push(sv("text",{x:(spot[4]==="start" ? spot[0]+3 : spot[4]==="end" ? spot[2]-3 : (spot[0]+spot[2])/2).toFixed(1),y:(spot[1]+13*LK).toFixed(1),class:"pl","text-anchor":spot[4],text:name})); }
    if(M.z>=2) for(const [name,x,y] of M.data.hl){ const sx=x*M.z+M.tx, sy=y*M.z+M.ty; if(sx<0||sy<0||sx>M.w||sy>M.h) continue;
      const b=[sx-14,sy-9,sx+14,sy+6]; if(boxes.some(o=>b[0]<o[2]&&b[2]>o[0]&&b[1]<o[3]&&b[3]>o[1])) continue; boxes.push(b); L.push(sv("text",{x:sx.toFixed(1),y:(sy+3).toFixed(1),class:"hl",text:name})); }
  }
  $("mapLabels").replaceChildren(...L);
  const G=[]; M.cl=cl;
  for(let i=cl.length-1;i>=0;i--){ const c=cl[i], n=c.m.length, st=c.m[0].v.status, focus = M.focus && c.m.some(q=>q.v.id===M.focus);
    const by={}; for(const q of c.m) by[q.v.status]=(by[q.v.status]||0)+1;
    const kinds=["down","issues","unknown","up"].filter(k=>by[k]), mixed=kinds.length>1;
    const label = n===1 ? c.m[0].v.name+", "+LABEL[st] : n+" units here: "+kinds.map(k=>by[k]+" "+LABEL[k]).join(", ");
    const R=(n===1?(st==="down"?10:8.5):n>99?17:n>9?15:13.5)*PK, kids=[focus ? sv("circle",{class:"ring",r:(R+5*PK).toFixed(1)}) : null];
    if(!mixed) kids.push(sv("circle",{r:R.toFixed(1),fill:PCOL[st]||"var(--unk)"}), n>1 ? sv("text",{y:4*PK,text:String(n)}) : null);
    else {
      /* Units in more than one state at one spot. The ring shows the mix, the middle says how many there are in
         all, and the red number on its shoulder is how many are down. One down unit never paints the rest red. */
      const RR=R-2.2*PK, C=2*Math.PI*RR, least=Math.min(6*PK, C/kinds.length*.5); let lens=kinds.map(k=>by[k]/n*C), owed=0;
      lens=lens.map(l=>{ if(l<least){ owed+=least-l; return least; } return l; }); lens[lens.indexOf(Math.max(...lens))]-=owed;
      kids.push(sv("circle",{class:"mixbase",r:R.toFixed(1)}));
      let at=0; kinds.forEach((k,j)=>{ kids.push(sv("circle",{class:"arc",r:RR.toFixed(1),style:"stroke:"+PCOL[k]+";stroke-width:"+(4.4*PK).toFixed(1)+"px","stroke-dasharray":lens[j].toFixed(2)+" "+(C-lens[j]).toFixed(2),"stroke-dashoffset":(-at).toFixed(2),transform:"rotate(-90)"})); at+=lens[j]; });
      kids.push(sv("text",{class:"mix",y:4*PK,text:String(n)}));
      if(by.down){ const b=R*.82; kids.push(sv("circle",{class:"bad",cx:b.toFixed(1),cy:(-b).toFixed(1),r:(7.4*PK).toFixed(1)}), sv("text",{class:"badn",x:b.toFixed(1),y:(-b+3.6*PK).toFixed(1),text:String(by.down)})); }
    }
    if(M.pk && n===1 && st==="down"){ const left=c.sx>M.w*.68; kids.push(sv("text",{class:"tvlab"+(left?" l":""),x:(left?-14:14)*PK,y:5*PK,text:c.m[0].v.name})); }
    G.push(sv("g",{class:"pin",role:"button",tabindex:"0","aria-label":label,transform:"translate("+c.sx.toFixed(1)+","+c.sy.toFixed(1)+")",onclick:ev=>{ if(M.drop) return; ev.stopPropagation(); if(!M.dragged) pick(c); },onkeydown:ev=>{ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); pick(c); } }}, kids)); }
  if(M.drop && M.drop.ll){ const [x,y]=toXY(M.drop.ll.lat,M.drop.ll.lng), sx=x*M.z+M.tx, sy=y*M.z+M.ty;
    G.push(sv("g",{transform:"translate("+sx.toFixed(1)+","+sy.toFixed(1)+")"},sv("path",{d:"M0,0 L-9,-18 A10,10 0 1 1 9,-18 Z",fill:"var(--brand)",stroke:"#fff","stroke-width":2}),sv("circle",{cy:-21,r:3.5,fill:"#fff"}))); }
  $("mapPins").replaceChildren(...G);
}
function pick(c){
  if(M.drop) return;
  if(c.m.length===1){ M.focus=c.m[0].v.id; openUnit(c.m[0].v.id); paint(); return; }
  let spread=0; for(const q of c.m) spread=Math.max(spread,Math.hypot(q.x-c.m[0].x,q.y-c.m[0].y));
  M.sel={ ids:c.m.map(q=>q.v.id), zoom: spread>0.03 && M.z<ZMAX*0.8, title:c.m.length+" units here" }; drawSel();
}
function drawSel(){
  const el=$("mapSel"); if(!M.sel || M.drop){ el.hidden=true; return; }
  const vs=M.sel.ids.map(id=>S.vmap&&S.vmap[id]).filter(Boolean); if(!vs.length){ M.sel=null; el.hidden=true; return; }
  vs.sort((a,b)=>(SEV[a.status]??2)-(SEV[b.status]??2)||a.name.localeCompare(b.name,undefined,{numeric:true}));
  el.replaceChildren(h("div",{class:"selhead"},h("span",{text:M.sel.title}),
    h("span",{class:"links"}, M.sel.zoom ? h("button",{class:"lk",type:"button",onclick:()=>{ const pts=M.pts.filter(q=>M.sel.ids.includes(q.v.id)); M.sel=null; drawSel(); fitPts(pts,70,ZMAX); }},"Zoom in") : null,
      h("button",{class:"lk",type:"button",onclick:()=>{ M.sel=null; drawSel(); }},"Close"))),
    h("div",{class:"list"},vs.map(rowEl)));
  el.hidden=false; el.scrollTop=0;
}
function drawMsg(){ $("mapMsg").hidden=true; }
function showOnMap(v){ const pin=pinOf(v); if(!pin) return; closeUnit(); M.focus=v.id; M.f="all"; M.sel=null; M.drop=null; setView("map");
  const [x,y]=toXY(pin.lat,pin.lng); M.fitted=true; centerOn(x,y,Math.max(M.z,40)); }
const GO = [["All units",null],["Houston",29.80,-95.42,7.5],["Austin",30.22,-97.72,9],["San Antonio",29.45,-98.5,11],["Dallas–Fort Worth",32.7,-97.2,8]];
function drawMap(vs){
  if(!(S.view==="map" || W.side || TV.on) || !S.meta) return;
  fitMap();
  vs = vs || allViews();
  const field = vs.filter(v=>v.place==="field" && v.status!=="notin" && v.status!=="excl"), pts=[], none=[];
  for(const v of field){ const p=pinOf(v); if(p){ const [x,y]=toXY(p.lat,p.lng); pts.push({v,p,x,y}); } else none.push(v); }
  M.pts=pts; M.none=none;
  const cnt={all:pts.length}; for(const q of pts) cnt[q.v.status]=(cnt[q.v.status]||0)+1;
  $("mapChips").replaceChildren(...[["all","All"],["down","Down"],["issues","Camera issues"],["unknown","Unknown"],["up","Up"]].map(([k,l])=>h("button",{class:"chip",type:"button","aria-pressed":String(M.f===k),onclick:()=>{ M.f=k; M.sel=null; drawMap(); }}, k==="all" ? null : h("i",{class:"dot s-"+k,"aria-hidden":"true"}), l+" "+(cnt[k]||0))));
  $("mapGo").replaceChildren(...GO.map(([l,la,lo,z])=>h("button",{class:"chip",type:"button",onclick:()=>{ M.sel=null; drawSel(); if(la==null) fitPts(M.pts.filter(q=>M.f==="all"||q.v.status===M.f),36,60); else { const [x,y]=toXY(la,lo); centerOn(x,y,z*(M.w/390)); } }},l)));
  sizeMap(); buildBase();
  if(!M.fitted && pts.length && M.w){ fitPts(pts,36,60); M.fitted=true; }
  const hand=pts.filter(q=>q.p.kind==="hand").length;
  // The board's tiles count every field unit; the map can only draw the ones
  // with a pin. Saying "193 of 198" here ties the two screens together, so the
  // gap reads as units without a pin rather than as the two screens disagreeing.
  $("mapNote").textContent = pts.length+" of "+field.length+" field units on the map"+(hand ? ", "+hand+" from an address typed by hand" : "")+". A full colour means every unit at that spot is in that state. A ring is a mix, and its red number is how many are down. Tap a pin to open it. Pins mark the site address from mHelp unless someone typed an address in COS. Shop units are not on the map."+(M.failed ? " The background map didn't load, but the pins still work." : "");
  $("mapList").replaceChildren(...(none.length ? [h("div",{class:"count",text:none.length+" field unit"+(none.length===1?"":"s")+" with no pin yet."}), ...none.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(rowEl)] : []));
  drawMsg(); drawSel(); paint();
}
(function wireMap(){
  const svg=$("mapSvg"), ptrs=new Map(); let pinch=0;
  svg.addEventListener("pointerdown",ev=>{ if(ev.isPrimary) ptrs.clear(); ptrs.set(ev.pointerId,{x:ev.clientX,y:ev.clientY,sx:ev.clientX,sy:ev.clientY}); if(ptrs.size===1) M.dragged=false; if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch=Math.hypot(a.x-b.x,a.y-b.y); M.dragged=true; } });
  svg.addEventListener("pointermove",ev=>{ const p=ptrs.get(ev.pointerId); if(!p) return;
    if(ptrs.size===1){ if(!M.dragged){ if(Math.hypot(ev.clientX-p.sx,ev.clientY-p.sy)<7) return; M.dragged=true; try{ svg.setPointerCapture(ev.pointerId); }catch(_){} }
      M.tx+=ev.clientX-p.x; M.ty+=ev.clientY-p.y; p.x=ev.clientX; p.y=ev.clientY; paint(); }
    else if(ptrs.size===2){ p.x=ev.clientX; p.y=ev.clientY; const [a,b]=[...ptrs.values()], d=Math.hypot(a.x-b.x,a.y-b.y), r=svg.getBoundingClientRect(); if(pinch>0 && d>0) zoomAt((a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top,d/pinch); pinch=d; } });
  const up=ev=>{ ptrs.delete(ev.pointerId); if(ptrs.size<2) pinch=0; if(ptrs.size===1){ const p=[...ptrs.values()][0]; p.sx=p.x; p.sy=p.y; } };
  svg.addEventListener("pointerup",up); svg.addEventListener("pointercancel",up); svg.addEventListener("pointerleave",up);
  svg.addEventListener("wheel",ev=>{ ev.preventDefault(); const r=svg.getBoundingClientRect(); zoomAt(ev.clientX-r.left,ev.clientY-r.top,ev.deltaY<0?1.3:1/1.3); },{passive:false});
  svg.addEventListener("click",ev=>{ if(M.dragged) return; const r=svg.getBoundingClientRect(), px=ev.clientX-r.left, py=ev.clientY-r.top;
    if(M.drop){ const [lat,lng]=toLL((px-M.tx)/M.z,(py-M.ty)/M.z); M.drop.ll={lat,lng}; drawMsg(); paint(); }
    else if(M.sel){ M.sel=null; drawSel(); } });
  $("zin").addEventListener("click",()=>zoomAt(M.w/2,M.h/2,1.8)); $("zout").addEventListener("click",()=>zoomAt(M.w/2,M.h/2,1/1.8));
  onWin("resize",()=>{ measureWide(); if(S.view==="map" || W.side){ fitMap(); sizeMap(); paint(); } });
})();

/* What a hand fix did to the count. The saved reading reaches the board a moment after the save, so the answer waits
   for it, and says a plain "Saved." when the count did not move. */
let savedTimer=null;
function countNow(){ const c={down:0,issues:0,unknown:0,up:0}; if(S.meta) for(const v of allViews()) if(c[v.status]!==undefined) c[v.status]++; return c; }
function saidSaved(){ if(!S.saved) return; const was=S.saved.was, said=S.saved.said, id=S.saved.unit, ip=S.saved.ip; S.saved=null; clearTimeout(savedTimer);
  const now=countNow(), moved=["down","issues","unknown","up"].filter(k=>was[k]!==now[k]).map(k=>LABEL[k]+" "+was[k]+" to "+now[k]);
  /* A corrected IP is kept, but it is not what makes a unit Up or Down. Say so, so a unit that still shows
     Down after its IP was fixed is not a puzzle. */
  const v=S.vmap && S.vmap[id], still = !moved.length && ip && v && ["down","issues","unknown"].includes(v.status);
  toast(said+(moved.length ? " The count changed: "+moved.join(", ")+"." : "")
    +(still ? " "+v.name+" still shows "+LABEL[v.status]+": "+(v.u.s==="a" ? "Up or Down comes from COS's own check of this unit, so it clears at the next check that finds its cameras online." : v.u.s==="r" ? "Up or Down comes from the Recon cloud's own reading, so it clears when Recon sees the cameras online." : "Up or Down comes from Star4Live's own reading of its cameras, so it clears when Star4Live sees them online.") : ""), still ? 14000 : 9000); }
/* ---------- saving a hand fix ---------- */
/* The board sends nothing itself. It hands Fleet the edits in order, and Fleet saves each one through the same
   route as Camera status. An empty value clears a hand fix, and only where there is one to clear. */
async function save(v, ch){
  if(S.can!==true || S.busy || v.mhOnly || !hooks || typeof hooks.onEdit!=="function") return;
  const steps=[];
  if(ch.__reset){ for(const [f,field] of [["address","address"],["site","site"],["name","name"],["ip","public_ip"],["place","placement"]]) if(v.hand[f]) steps.push({field, value:null}); }
  else {
    if(ch.place!==undefined && ch.place!==v.place) steps.push({field:"placement", value: ch.place==="field" ? "FIELD" : "SHOP"});
    for(const [f,field] of [["site","site"],["name","name"],["ip","public_ip"],["address","address"]]){
      if(ch[f]===undefined) continue;
      const before = f==="site" ? v.site : f==="name" ? v.name : f==="ip" ? (v.ip||"") : (v.u.ta||"");
      if(ch[f]===before) continue;
      if(ch[f]===""){ if(v.hand[f]) steps.push({field, value:null}); }
      else steps.push({field, value:ch[f]});
    }
  }
  if(!steps.length){ S.form=null; drawPanel(); return; }
  S.busy=true; drawPanel();
  const was=countNow();
  try{ const said = await hooks.onEdit(v.k, steps); S.form=null; S.saved={was, said: said || "Saved.", unit:v.id, ip:steps.some(x=>x.field==="public_ip")}; clearTimeout(savedTimer); savedTimer=setTimeout(saidSaved, 1500); }
  catch(err){ S.form=null; toast("Not saved. "+((err && err.message) || "COS could not confirm the save."), 14000); }
  S.busy=false; render();
}

/* ---------- check one unit on demand ----------
   Refresh asks for the latest saved reading. This asks the cameras themselves, for this unit only, so a tech
   standing at a unit does not wait for the next sweep. A check that does not run says so: a stale reading is
   never redrawn as if it were current, and nothing is written to mHelp, Star4Live or InHand. */
/* Add A#: drawn only where the unit has no A# to check against and the app can link one. */
function canLinkA(v){ return !v.mhOnly && v.u.s!=="r" && !checkPid(v) && !!(hooks && typeof hooks.onLinkA==="function"); }
async function linkA(v, pid){
  if(S.can!==true || S.busy || !canLinkA(v)) return;
  if(!/^[1-9][0-9]{0,14}$/.test(pid)){ toast("Not linked. Enter the A# from mHelp, digits only.", 8000); return; }
  S.busy=true; drawPanel();
  try{ const said = await hooks.onLinkA(v.k, pid); S.form=null; toast(said || ("A# "+pid+" linked."), 9000); }
  catch(err){ toast("Not linked. "+((err && err.message) || "COS could not confirm the link."), 14000); }
  S.busy=false; render();
}
function checkPid(v){
  /* The unit's own A# first. An mHelp match counts only when it is exact: a fuzzy name match can belong to another unit,
     and checking it would report that unit's cameras on this card. */
  if(v.u.pid) return v.u.pid;
  const mm = S.mh ? (S.rec && S.rec.match[v.id]) : undefined;
  return (mm && !mm.fuzzy && mm.rec && mm.rec.id) || "";
}
async function checkNow(v){
  if(S.busy || v.mhOnly || !hooks || typeof hooks.onCheckUnit!=="function") return;
  S.busy=true; S.chk={unit:v.id, state:"run", said:""}; drawPanel();
  try{
    const got = await hooks.onCheckUnit(v.k, checkPid(v));
    const said = got && typeof got==="object" ? got.said : got, tone = got && typeof got==="object" ? got.tone : "info";
    S.chk={unit:v.id, state:"done", tone: tone==="up"||tone==="down" ? tone : "info", said: said || "The check finished, but COS was not told what it found. Tap Refresh."};
  }catch(err){
    S.chk={unit:v.id, state:"fail", said: (err && err.message) || "COS could not run the check."};
  }
  S.busy=false; render();
}

/* ---------- fresh reading on demand ---------- */
async function refresh(){
  const btn=$("refresh"); if(btn.disabled) return;
  const was = S.meta ? when(S.meta.v) : "the last reading";
  if(!hooks || typeof hooks.onRefresh!=="function"){ toast("Refresh isn't available here. Still showing the reading from "+was+"."); return; }
  btn.disabled=true; btn.textContent="Reading…";
  void loadRouters();
  S.before = S.meta ? S.meta.v : null;
  try{ await hooks.onRefresh(); S.announce=true; clearTimeout(announceTimer); announceTimer=setTimeout(announce, 1500); }
  catch(_){ toast("Couldn't get a new reading. Still showing "+was+".", 12000); }
  btn.disabled=false; btn.textContent="Refresh";
}
/* The reading reaches this screen a moment after it is read. Say what came back once it is on screen:
   a newer Star4Live reading, or the same one because Star4Live has not been read again yet. */
let announceTimer=null;
function announce(){ if(!S.announce) return; S.announce=false; clearTimeout(announceTimer);
  const at = S.meta && S.meta.v;
  toast(!at ? "New reading loaded." : at===S.before ? "No newer Star4Live reading yet. Last read "+when(at)+"." : "New reading: Star4Live "+when(at)+".", 5000); }
/* ---------- manager view ----------
   For the owner sign-in only. One screen of what Tech Check already records: today's truck inspections, what each
   truck carries, and what IT and Service handed to each other. The camera numbers at the top are the board's own.
   Nothing here is read by the board: the app hands it in (hooks.manager), and takes a truck change back out. */
const MGK = hooks && hooks.manager && typeof hooks.manager.read==="function" ? hooks.manager : null;
const MG = { on:false, state:"idle", data:null, err:"", at:0, edit:null, busy:false, open:{}, shots:{}, tests:false, tools:false, allX:false };
const fmtClock = new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:TZ});
const fmtLongDay = new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"UTC"});
const mgClock = iso => iso ? fmtClock.format(new Date(iso)) : "";
const mgWhen = iso => iso ? when(Date.parse(iso)/1000) : "";
const mgDay = day => fmtLongDay.format(new Date(day+"T12:00:00Z"));
const mgFirst = name => String(name||"").trim().split(/\s+/)[0] || "The tech";
const mgPlural = (n, one, many) => n+" "+(n===1 ? one : (many || one+"s"));
const mgKey = n => normName(n).replace(/([A-Z])0+(?=\d)/g,"$1");
const mgQty = v => /^\d{1,4}$/.test(String(v).trim()) ? Number(String(v).trim()) : null;
const mgTool = (route,label) => h("button",{class:"lk",type:"button",onclick:()=>MGK.open(route)},label);
const mgCheck = (tone,label,text) => h("div",{class:"chk"},h("span",{class:"dot "+tone}),h("div",null,h("b",{text:label}),h("span",{text:text})));

function mgShow(on){ MG.on=on; $("tabManager").hidden=!on;
  $("tabTech").hidden = on || !(hooks && typeof hooks.onTechCheck==="function");
  if(MGK && typeof MGK.known==="function") MGK.known(on);
  if(!on && S.view==="manager") setView("board"); }
function mgLoad(fresh){
  if(!MGK || MG.state==="loading") return;
  MG.state="loading"; if(S.view==="manager") mgDraw();
  MGK.read(!!fresh).then(d=>{ MG.data=d; MG.err=""; MG.at=Date.now(); MG.state="ready"; if(!MG.on) mgShow(true); },
    e=>{ MG.err=(e && e.message) || "Trucks and inspections could not be read just now."; MG.state = MG.data ? "ready" : "failed"; if(e && e.gone) mgShow(false); })
   .then(()=>{ if(S.view==="manager") mgDraw(); });
}
function mgStart(){
  $("tabManager").addEventListener("click",()=>setView("manager"));
  if(!MGK) return;
  if(hooks.startView==="manager" || (typeof MGK.wasKnown==="function" && MGK.wasKnown())) mgShow(true);
  mgLoad(false);
}
function mgOpen(){ vqLoad(); mgDraw(); if(MG.state==="idle" || MG.state==="failed" || (MG.state==="ready" && Date.now()-MG.at>60000 && !MG.edit && !MG.busy)) mgLoad(true); }
/* Which board unit a truck's unit is, when exactly one carries that name. */
function mgIndex(vs){ const idx={}; for(const v of vs){ if(v.mhOnly && !v.name) continue; const k=mgKey(v.name); if(k) (idx[k]=idx[k]||[]).push(v); } return idx; }
const mgUnitOf = (idx, name) => { const hit=idx[mgKey(name)]; return hit && hit.length===1 ? hit[0] : null; };

/* part: nothing for everything, or one of "checks", "trucks", "x", "tools"; "feed" is what a new camera reading can change. */
function mgDraw(part){
  const vs = S.meta ? allViews() : [], feed = part==="feed";
  if(!part || feed) mgNow(vs);
  const d=MG.data;
  if(!d){
    if(feed) return;
    const body = MG.state==="failed" ? h("div",{class:"box"},h("p",{text:MG.err}),h("div",{class:"links"},h("button",{class:"lk",type:"button",onclick:()=>mgLoad(true)},"Try again"),mgTool("team","Open the older truck screen")))
      : h("div",{class:"box"},h("p",{class:"note",text:"Loading trucks and inspections…"}));
    $("mgChecks").replaceChildren(body); $("mgTrucks").replaceChildren(); $("mgStd").replaceChildren(); $("mgGap").replaceChildren(); $("mgVen").replaceChildren(); $("mgSim").replaceChildren(); $("mgX").replaceChildren(); $("mgTools").replaceChildren(); return;
  }
  const real=d.techs.filter(t=>!t.test), tests=d.techs.filter(t=>t.test), idx=mgIndex(vs);
  if(!part || part==="checks") $("mgChecks").replaceChildren(mgChecks(d, real));
  if(!part || feed || part==="trucks"){
    const editing = MG.edit ? d.techs.find(x=>x.id===MG.edit.id) : null;
    if(MG.edit && !editing) MG.edit=null;
    /* A truck being changed is left alone when the rest is redrawn, so the typing is never lost. */
    if(part==="trucks" || !editing || !$("mgEdit")) $("mgTrucks").replaceChildren(mgTrucks(real, tests, idx));
    if(editing) mgEditSync(editing);
  }
  if(!part || part==="x"){ $("mgGap").replaceChildren(mgGaps(d)); $("mgX").replaceChildren(mgExchanges(d, idx)); }
  if(!part || part==="x" || part==="ven") $("mgVen").replaceChildren(...[mgVendors()].filter(Boolean));
  if(!part || part==="x" || part==="sim") $("mgSim").replaceChildren(mgSims(d));
  if(!part || part==="x" || part==="std") $("mgStd").replaceChildren(mgStd(d));
  if(!part || part==="tools") $("mgTools").replaceChildren(mgTools());
}

/* Cameras right now: the same numbers as the Board tab, and the down units by name. */
function mgNow(vs){
  if(!S.meta){ $("mgNow").replaceChildren(h("div",{class:"box"},h("h3",{text:"Cameras right now"}),h("p",{class:"note",text:"Loading the camera reading…"}))); return; }
  const c={down:0,issues:0,unknown:0,up:0}; for(const v of vs) if(c[v.status]!==undefined) c[v.status]++;
  const down=vs.filter(v=>v.status==="down").sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const num=k=>h("button",{class:"mgnum s-"+k,type:"button","aria-label":c[k]+" "+LABEL[k]+". Show them on the board.",onclick:()=>{ S.filter=k; S.fam="all"; setView("board"); render(); }},h("b",{text:c[k]}),h("span",{text:LABEL[k]}));
  $("mgNow").replaceChildren(h("div",{class:"box"},h("h3",{text:"Cameras right now"}),
    h("div",{class:"mgnums"},num("down"),num("issues"),num("unknown"),num("up")),
    down.length ? [h("p",{class:"note",text:"Down now. Tap one to open it."}), h("div",{class:"chips mgdown"},...down.map(v=>h("button",{class:"chip",type:"button",onclick:()=>openUnit(v.id)},v.name)))]
                : h("p",{class:"note",text:"No field unit is down."}),
    h("div",{class:"links"},h("button",{class:"lk",type:"button",onclick:()=>{ M.f = down.length ? "down" : "all"; setView("map"); }}, down.length ? "Show the down units on the map" : "Open the map"))));
}

/* Today's truck inspections. Techs do these on their phone; this only reads them. */
function mgChecks(d, techs){
  const ready=techs.filter(t=>t.ready).length, none=techs.filter(t=>!t.inspection.done);
  const line = !techs.length ? "No service tech is set up."
    : ready===techs.length ? (techs.length===1 ? "The truck is ready." : "All "+techs.length+" trucks are ready.")
    : ready+" of "+mgPlural(techs.length,"truck")+" ready."+(none.length ? " No inspection today from "+none.map(t=>t.name).join(", ")+"." : "");
  return h("div",{class:"box"},h("h3",{text:"Truck inspections · "+mgDay(d.day)}),h("p",{class:"big",text:line}),
    ...techs.map(t=>{ const i=t.inspection, s=t.stockCheck;
      return h("div",{class:"mgtech"},
        h("div",{class:"mgwho"},h("span",{class:"who",text:t.name}),h("span",{class:"pill "+(t.ready?"s-up":"s-down"),text:t.ready?"Truck ready":"Not ready"})),
        h("div",{class:"mgchecks"},
          mgCheck(i.truck?"ok":"bad","Truck inspection", i.truck ? "Done "+mgClock(i.at) : i.done ? "Sent "+mgClock(i.at)+". Not every item passed." : "Not done today"),
          mgCheck(i.trailer==="done"?"ok":i.trailer==="not_taking"?"info":"bad","Trailer inspection", i.trailer==="done" ? "Done "+mgClock(i.at) : i.trailer==="not_taking" ? "Not taking a trailer" : i.done ? "Sent "+mgClock(i.at)+". Not every item passed." : "Not done today"),
          mgCheck(s.state==="done"?"ok":s.state==="verify"?"warn":"bad","Truck stock check", s.state==="done" ? "Done "+mgClock(s.at) : s.state==="verify" ? "Waiting on "+mgFirst(t.name)+" to check the truck" : "Stock is short")));
    }),
    h("p",{class:"note",text:"Techs do these in Tech Check on their phone. This screen only reads them."}));
}

/* What each truck carries. */
function mgTrucks(techs, tests, idx){
  return h("div",{class:"box"},h("h3",{text:"What is on each truck"}),
    techs.length ? h("div",{class:"mgcards"},...techs.map(t=>mgTruck(t, idx))) : h("p",{class:"note",text:"No truck is set up."}),
    tests.length ? h("div",{class:"links mgmore"},h("button",{class:"lk",type:"button","aria-expanded":String(MG.tests),onclick:()=>{ MG.tests=!MG.tests; mgDraw("trucks"); }},(MG.tests?"Hide ":"Show ")+mgPlural(tests.length,"test account"))) : null,
    tests.length && MG.tests ? h("div",{class:"mgcards"},...tests.map(t=>mgTruck(t, idx))) : null);
}
function mgTruck(t, idx){
  if(MG.edit && MG.edit.id===t.id) return mgEditor(t);
  const short=t.stock.filter(s=>s.have<s.need), gone=t.units.filter(u=>u.status==="missing"), used=t.units.filter(u=>u.status==="used").length+t.sims.filter(s=>s.status==="used").length, nosim=t.sims.filter(s=>s.status==="missing");
  const parts=[]; if(gone.length) parts.push(mgPlural(gone.length,"unit")+" missing"); if(nosim.length) parts.push(mgPlural(nosim.length,"SIM")+" missing"); if(short.length) parts.push("batteries short"); if(used) parts.push(used+" used, waiting on a replacement");
  const tone = gone.length||nosim.length||short.length ? " h" : used ? " p" : "";
  const flags=[];
  const unit=u=>{ if(u.status==="missing") return h("span",{class:"mgitem none",text:"No "+u.type});
    const name=u.type+" "+u.tag, v=mgUnitOf(idx,name);
    if(v && v.place==="field") flags.push(name+" is on this truck, but the board has it in the field"+(LABEL[v.status] ? " ("+LABEL[v.status]+")" : "")+".");
    const text=name+(u.status==="used" ? " · used"+(u.ticket?" on #"+u.ticket:"") : "");
    return v ? h("button",{class:"mgitem"+(u.status==="used"?" used":""),type:"button","aria-label":"Open "+name,onclick:()=>openUnit(v.id)},text) : h("span",{class:"mgitem"+(u.status==="used"?" used":""),text:text}); };
  const units=t.units.map(unit);
  return h("div",{class:"tcard mgtruck"+tone},
    h("div",{class:"mgwho"},h("span",{class:"who"},t.name,t.test?h("span",{class:"tag",text:"Test"}):null),h("span",{class:"mgsum",text:parts.length ? parts.join(" · ") : "Fully stocked"})),
    h("dl",{class:"kv mgkit"},
      h("dt",{text:"Units"}),h("dd",null,...units),
      h("dt",{text:"SIMs"}),h("dd",null,...t.sims.map(s=>s.status==="missing" ? h("span",{class:"mgitem none",text:"No SIM "+s.slot}) : h("span",{class:"mgitem"+(s.status==="used"?" used":""),text:s.number+(s.status==="used"?" · used":"")}))),
      h("dt",{text:"Batteries"}),h("dd",null,...t.stock.map(s=>h("span",{class:"mgitem"+(s.have<s.need?" none":""),text:s.label+" "+s.have+" of "+s.need})))),
    flags.map(f=>h("p",{class:"mgflag",text:f})),
    t.restock.length ? h("p",{class:"note",text:"Waiting on IT: "+t.restock.map(r=>r.item+" ("+r.status+")").join(", ")+"."}) : null,
    h("div",{class:"links"},h("button",{class:"lk",type:"button",disabled:MG.busy||!!MG.edit,onclick:()=>{ MG.edit=mgDraft(t); mgDraw("trucks"); const first=$("mgEdit") && $("mgEdit").querySelector("input"); if(first) first.focus(); }},"Add or remove")));
}

/* Changing one truck. Nothing is saved until the list of changes has been read and Save is tapped. */
function mgDraft(t){ const e={ id:t.id, units:{}, sims:{}, stock:{}, err:"" };
  for(const u of t.units) e.units[u.type]=u.tag; for(const s of t.sims) e.sims[String(s.slot)]=s.number; for(const s of t.stock) e.stock[s.key]=String(s.have); return e; }
function mgChanges(t, e){ const out=[];
  for(const u of t.units){ const now=(e.units[u.type]||"").trim();
    if(now!==u.tag) out.push(u.tag ? (now ? u.type+" "+u.tag+" comes off, "+u.type+" "+now+" goes on" : u.type+" "+u.tag+" comes off the truck") : u.type+" "+now+" goes on the truck");
    else if(u.status==="used" && now) out.push(u.type+" "+u.tag+" is marked used. Saving marks it ready on the truck again."); }
  for(const s of t.sims){ const now=(e.sims[String(s.slot)]||"").trim(); if(now && now!==s.number) out.push(s.number ? "SIM "+s.slot+": "+s.number+" is replaced by "+now : "SIM "+s.slot+": "+now+" goes on the truck"); }
  for(const s of t.stock){ const now=mgQty(e.stock[s.key]); if(now!==null && now!==s.have) out.push(s.label+": "+s.have+" becomes "+now); }
  return out; }
/* Only a real change is worth a save: a save always sends the tech back to check the truck. */
function mgReal(t, e){ return t.units.some(u=>(e.units[u.type]||"").trim()!==u.tag) || t.sims.some(s=>{ const now=(e.sims[String(s.slot)]||"").trim(); return now && now!==s.number; }) || t.stock.some(s=>{ const now=mgQty(e.stock[s.key]); return now!==null && now!==s.have; }); }
function mgBad(t, e){ for(const s of t.stock) if(mgQty(e.stock[s.key])===null) return "Enter a whole number for "+s.label+"."; return ""; }
function mgEditor(t){ const e=MG.edit;
  const field=(label, value, set, attrs)=>h("label",{class:"mgfield"},h("span",{text:label}),
    h("input",Object.assign({class:"tin",value:value,autocomplete:"off",autocapitalize:"characters",spellcheck:"false",maxlength:"40",oninput:ev=>{ set(ev.target.value); e.err=""; mgEditSync(t); }},attrs||{})));
  return h("div",{class:"tcard mgtruck mgedit",id:"mgEdit"},
    h("div",{class:"mgwho"},h("span",{class:"who",text:"Change "+t.name+"’s truck"})),
    h("h3",{text:"Units"}),
    h("div",{class:"mgfields"},...t.units.map(u=>field(u.type, e.units[u.type]||"", v=>{ e.units[u.type]=v; }, {placeholder:"None on the truck"}))),
    h("p",{class:"note",text:"Type the unit number. Clear a box to take that unit off the truck."}),
    h("h3",{text:"SIM cards"}),
    h("div",{class:"mgfields"},...t.sims.map(s=>field("SIM "+s.slot, e.sims[String(s.slot)]||"", v=>{ e.sims[String(s.slot)]=v; }, {placeholder:"None"}))),
    h("p",{class:"note",text:"A SIM can be replaced here, not removed. A cleared box leaves that SIM as it is."}),
    h("h3",{text:"Batteries on the truck"}),
    h("div",{class:"mgfields"},...t.stock.map(s=>field(s.label+" (carries "+s.need+")", e.stock[s.key], v=>{ e.stock[s.key]=v; }, {inputmode:"numeric",maxlength:"4"}))),
    h("div",{id:"mgDiff"}),
    h("div",{class:"form"},h("div",{class:"btns"},
      h("button",{class:"fixbtn",id:"mgSave",type:"button",onclick:()=>mgSave(t)},"Save truck"),
      h("button",{class:"fixbtn alt",id:"mgCancel",type:"button",onclick:()=>{ if(MG.busy) return; MG.edit=null; mgDraw("trucks"); }},"Cancel"))));
}
function mgEditSync(t){ const e=MG.edit, box=$("mgDiff"), btn=$("mgSave"); if(!e || !box || !btn) return;
  const ch=mgChanges(t,e), real=mgReal(t,e), bad=mgBad(t,e);
  box.replaceChildren(...[
    e.err ? h("p",{class:"mgerr",role:"alert",text:e.err}) : null,
    bad ? h("p",{class:"mgerr",text:bad}) : null,
    real ? [h("p",{class:"note",text:"This will change:"}),h("ul",{class:"mgdiff"},...ch.map(x=>h("li",{text:x}))),
            h("p",{class:"note",text:"It is saved with your name. "+mgFirst(t.name)+" then has to check the truck again in Tech Check before leaving."})]
         : h("p",{class:"note",text:"Nothing is changed yet."})].flat().filter(Boolean));
  btn.disabled = MG.busy || !real || !!bad; btn.textContent = MG.busy ? "Saving…" : "Save truck"; $("mgCancel").disabled = MG.busy;
  for(const input of $("mgEdit").querySelectorAll("input")) input.disabled = MG.busy; }
async function mgSave(t){ const e=MG.edit; if(!e || MG.busy || !mgReal(t,e) || mgBad(t,e)) return;
  const kit={ units:{}, sims:{}, stock:{} };
  for(const u of t.units) kit.units[u.type]=(e.units[u.type]||"").trim();
  /* A SIM that is not being replaced is sent blank, which leaves it exactly as it is. */
  for(const s of t.sims){ const now=(e.sims[String(s.slot)]||"").trim(); kit.sims[String(s.slot)] = now!==s.number ? now : ""; }
  for(const s of t.stock) kit.stock[s.key]=mgQty(e.stock[s.key]);
  MG.busy=true; e.err=""; mgEditSync(t);
  try{ const d=await MGK.save(t.id, kit); MG.data=d; MG.at=Date.now(); MG.edit=null; MG.busy=false; mgDraw();
    toast(t.name+"’s truck is saved. "+mgFirst(t.name)+" has to check the truck again before leaving.", 9000); }
  catch(x){ MG.busy=false; e.err=(x && x.message) || "The truck could not be saved."; mgEditSync(t); }
}

/* Equipment handed between IT and Service: every step signed, with its photos. */
const MGSTATE = { awaiting_service:["Waiting on Service","s-issues"], accepted:["Received","s-up"], discrepancy:["Differences to review","s-down"], cancelled:["Cancelled","s-unknown"], returned_review:["Returned for review","s-unknown"], returned_repair:["Returned for repair","s-unknown"] };
const MGKIND = { checkout:"Handed over by ", receipt:"Received by ", owner:"Completed by ", other:"Updated by " };
/* Handoff check: every unit that went on a truck without a signed handoff, and handoffs left unsigned. */
const MGGAPKIND = { owner_override:"You loaded it without a handoff", owner_edit_no_reason:"Owner truck edit, no reason given", system:"Changed by the system", log_mode:"Let through while the block was off", other:"Loaded without a handoff" };
function mgGaps(d){
  const title=h("h3",{text:"Handoff check"});
  const g=d.gaps;
  if(!g) return h("div",{class:"box"},title,h("p",{class:"note",text:"The handoff check could not be read just now."}));
  const total=g.noHandoff.length+g.loaded.length+g.late.length+(g.returns||[]).length;
  const row=(cls, main, sub)=>h("div",{class:"prow "+cls},h("div",{class:"pmain"},h("span",{class:"name",text:main}),h("span",{class:"sub",text:sub})));
  const part=(head, rows)=>rows.length ? h("div",null,h("p",null,h("b",{text:head})),...rows) : null;
  return h("div",{class:"box",id:"mgGapBox"},title,
    h("p",{class:"big",text: total ? mgPlural(total,"thing")+" to look at." : "All clear. Every unit on a truck came through a signed handoff."}),
    part("On a truck with no handoff", g.noHandoff.map(x=>row("s-down", x.tech+" · "+x.unit,
      (x.by ? "Put on by "+x.by : "On the truck")+(x.at ? " · "+mgWhen(x.at) : "")+(x.listed ? "" : " · Not in the COS equipment list")))),
    part("Loaded without a handoff (last 7 days)", g.loaded.map(x=>row("s-issues", x.tech+" · "+x.unit,
      (MGGAPKIND[x.kind]||MGGAPKIND.other)+" · "+x.by+(x.at ? " · "+mgWhen(x.at) : "")+(x.reason ? " · "+x.reason : "")))),
    part("Handoffs not finished after 4 hours", g.late.map(x=>row("s-issues", (x.units.join(", ")||"Equipment"),
      x.from+" to "+x.to+" · "+(MGSTATE[x.state]||[x.state.replace(/_/g," ")])[0]+(x.hours!==null ? " · waiting "+Math.round(x.hours)+" h" : "")))),
    part("Returns not checked in by IT after 4 hours", (g.returns||[]).map(x=>row("s-issues", x.unit,
      "Sent back by "+x.from+" · "+(x.state==="identity_review" ? "Unit ID review" : "Waiting for IT")+(x.hours!==null ? " · waiting "+Math.round(x.hours)+" h" : "")))),
    h("p",{class:"note",text:(g.enforced ? "A new unit can only go on a Service truck after IT hands it over in Tech Check and Service signs for it." : "The handoff block is switched off. Units are let through and listed here.")+" Units on the trucks on 25 Nov 2026 were counted as handed over."}));
}
/* SIM drawer: every SIM card on hand, and where each one went. */
const SIMSTATE = { in_drawer:["In the drawer","s-up"], in_unit:["In a unit","s-unknown"], on_truck:["On a truck","s-unknown"], bad:["Bad","s-down"], deactivated:["Deactivated","s-down"], removed:["Removed","s-unknown"] };
/* Truck standard: every Service truck against how many of each unit it must carry. */
const STDF = { busy:false, err:"", remove:null };
function mgStd(d){
  const title=h("h3",{text:"Truck standard"});
  const g=d.standard;
  if(!g) return h("div",{class:"box"},title,h("p",{class:"note",text:"The truck standard could not be read just now."}));
  const short=g.trucks.flatMap(t=>t.kinds.filter(k=>k.have<k.required).map(k=>t.name+": "+k.type+" "+k.have+" of "+k.required));
  const setter=s=>h("div",{class:"prow"},h("div",{class:"pmain"},h("span",{class:"name",text:s.type}),h("span",{class:"sub",text:"Every truck carries "+s.required})),
    h("div",{class:"links"},
      h("button",{class:"lk",type:"button","aria-label":"One less "+s.type,disabled:STDF.busy||s.required<=0,onclick:()=>stdSet(s.type,s.required-1)},"−"),
      h("span",{class:"big",style:"min-width:2ch;text-align:center",text:String(s.required)}),
      h("button",{class:"lk",type:"button","aria-label":"One more "+s.type,disabled:STDF.busy||s.required>=10,onclick:()=>stdSet(s.type,s.required+1)},"+")));
  const truck=t=>h("div",{class:"box",style:"margin:10px 0 0"},h("h4",{text:t.name}),
    ...t.kinds.map(k=>h("div",{class:"prow "+(k.have<k.required?"s-down":"s-up")},
      h("div",{class:"pmain"},h("span",{class:"name",text:k.type+": has "+k.have+" of "+k.required}),
        h("span",{class:"sub",text:[k.slot,...k.extras.map(x=>x.tag+" (extra)")].filter(Boolean).join(" · ")||"None"})),
      h("div",{class:"links"},...k.extras.map(x=>h("button",{class:"lk",type:"button",disabled:STDF.busy,onclick:()=>{ STDF.remove={id:x.id,label:k.type+" "+x.tag+" on "+t.name+"'s truck",reason:"",err:""}; mgDraw("std"); }},"Take "+x.tag+" off"))))),
    ...t.waiting.map(m=>h("p",{class:"note",text:"On its way: "+m.type+" "+m.tag+" from "+m.from+" to "+m.to+" (waiting for the signature)"})));
  const remove=STDF.remove ? h("div",{class:"mgedit",style:"display:flex;flex-direction:column;gap:8px;margin-top:10px"},
    h("label",{class:"mgfield"},"Why is "+STDF.remove.label+" coming off in the app?",h("input",{class:"tin",type:"text",maxlength:"300",value:STDF.remove.reason,oninput:e=>{ STDF.remove.reason=e.target.value; }})),
    STDF.remove.err ? h("p",{class:"note",role:"alert",text:STDF.remove.err}) : null,
    h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",disabled:STDF.busy,onclick:()=>stdRemove()},"Take it off"),h("button",{class:"lk",type:"button",onclick:()=>{ STDF.remove=null; mgDraw("std"); }},"Cancel"))) : null;
  const moves=g.moves.filter(m=>m.state!=="waiting").slice(0,5);
  return h("div",{class:"box",id:"mgStdBox"},title,
    h("p",{class:"big",text: short.length ? mgPlural(short.length,"type")+" short on a truck." : "Every truck meets the standard."}),
    short.length ? h("p",{class:"note",text:short.join(" · ")}) : null,
    ...g.standard.map(setter),
    STDF.err ? h("p",{class:"note",role:"alert",text:STDF.err}) : null,
    ...g.trucks.map(truck), remove,
    moves.length ? h("div",{},h("h4",{text:"Last moves between techs"}),...moves.map(m=>h("p",{class:"note",text:m.type+" "+m.tag+": "+m.from+" → "+m.to+" · "+(m.state==="accepted"?"signed":m.state==="refused"?"not taken"+(m.note?" ("+m.note+")":""):"cancelled")+(m.at?" · "+mgWhen(m.at):"")}))) : null);
}
async function stdSet(type,required){
  if(STDF.busy) return; STDF.busy=true; STDF.err=""; mgDraw("std");
  try{ MG.data=await MGK.truckStandard(type,required); MG.at=Date.now(); toast("Every truck now carries "+required+" "+type+".", 6000); }
  catch(x){ STDF.err=(x && x.message) || "That could not be saved."; }
  STDF.busy=false; mgDraw("std");
}
async function stdRemove(){
  const r=STDF.remove; if(!r || STDF.busy) return;
  if(r.reason.trim().length<10){ r.err="Write why (at least 10 characters)."; mgDraw("std"); return; }
  STDF.busy=true; mgDraw("std");
  try{ MG.data=await MGK.truckExtraRemove(r.id,r.reason.trim()); MG.at=Date.now(); STDF.remove=null; toast("Taken off in the app.", 6000); }
  catch(x){ r.err=(x && x.message) || "That could not be saved."; }
  STDF.busy=false; mgDraw("std");
}
const SIMF = { open:false, text:"", carrier:"", note:"", busy:false, err:"", done:"", mark:null, show:"in_drawer", all:false, rule:false, ruleErr:"" };
/* The owner's switch for "SIMs must come from the drawer". Turning it on asks once more, because it can stop a handoff. */
function simRule(g){
  if(!MGK || typeof MGK.simRequire!=="function") return null;
  const on=g.requireListed;
  if(SIMF.rule && !on) return h("div",{class:"mgedit",id:"simRule",style:"display:flex;flex-direction:column;gap:8px;margin:10px 0"},
    h("p",{class:"note s-issues",role:"alert",text:"When this is on, IT cannot hand over a unit with a SIM that is not on the drawer list, or that the list shows somewhere else. The handoff is refused and says what to do next."
      +(g.notListed.length ? " "+mgPlural(g.notListed.length,"SIM")+" handed out lately "+(g.notListed.length===1?"was":"were")+" not on the list, so add every card on hand first." : "")}),
    SIMF.ruleErr ? h("p",{class:"note",role:"alert",text:SIMF.ruleErr}) : null,
    h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",disabled:SIMF.busy,onclick:()=>simRequire(true)},"Yes, turn it on"),
      h("button",{class:"lk",type:"button",onclick:()=>{ SIMF.rule=false; SIMF.ruleErr=""; mgDraw("sim"); }},"Cancel")));
  return h("div",{class:"prow "+(on?"s-up":""),id:"simRule"},
    h("div",{class:"pmain"},h("span",{class:"name",text:"SIMs must come from the drawer: "+(on?"On":"Off")}),
      h("span",{class:"sub",text:(on ? "A handoff with a SIM that is not free in the drawer is refused." : "Any SIM can be handed over. A SIM not on the list is only recorded.")+(SIMF.ruleErr?" "+SIMF.ruleErr:"")})),
    h("div",{class:"links"},h("button",{class:"lk",type:"button",disabled:SIMF.busy,onclick:()=>{ if(on) simRequire(false); else { SIMF.rule=true; SIMF.ruleErr=""; mgDraw("sim"); } }},on?"Turn off":"Turn on")));
}
async function simRequire(on){
  if(SIMF.busy) return; SIMF.busy=true; SIMF.ruleErr=""; mgDraw("sim");
  try{ MG.data=await MGK.simRequire(on); MG.at=Date.now(); SIMF.rule=false; toast(on ? "On. Handoffs now only take SIMs from the drawer." : "Off. Any SIM can be handed over again.", 7000); }
  catch(x){ SIMF.ruleErr=(x && x.message) || "That could not be saved."; }
  SIMF.busy=false; mgDraw("sim");
}
/* Waiting on vendor: every email COS sent that nobody has marked done yet (owner). */
const VQ = { data:null, err:"", loading:false, busy:false, close:null, done:false };
const VKIND = { sim_cancel_vendera:"Cancel SIM (Vendera)", sim_cancel_simetry:"Cancel SIM (Simetry)", monitor_add:"Add account", monitor_remove:"Remove account", monitor_swap:"Swap unit" };
function vqLoad(){
  if(!hooks || !hooks.vendor || typeof hooks.vendor.open!=="function" || VQ.loading) return;
  VQ.loading=true;
  hooks.vendor.open().then(d=>{ VQ.data=d; VQ.err=""; },()=>{ VQ.err="The vendor list could not be read just now."; }).finally(()=>{ VQ.loading=false; mgDraw("ven"); });
}
function mgVendors(){
  if(!hooks || !hooks.vendor || typeof hooks.vendor.open!=="function") return null;
  const title=h("h3",{text:"Waiting on vendor"});
  if(!VQ.data) return h("div",{class:"box",id:"mgVenBox"},title,h("p",{class:"note",text:VQ.err||"Loading the emails sent to vendors…"}),
    VQ.err ? h("div",{class:"links"},h("button",{class:"lk",type:"button",onclick:()=>{ vqLoad(); mgDraw("ven"); }},"Try again")) : null);
  const open=VQ.data.open, waiting=open.filter(r=>r.state==="sent"), other=open.filter(r=>r.state!=="sent");
  const days=r=>r.at ? Math.floor((Date.now()-Date.parse(r.at))/864e5) : 0, late=waiting.filter(r=>days(r)>=3);
  const row=r=>{
    const sent=r.state==="sent", closing=VQ.close && VQ.close.id===r.id, c=VQ.close;
    const what=(VKIND[r.kind]||"Email")+" · "+r.unit;
    return h("div",{class:"prow "+(sent ? (days(r)>=3?"s-issues":"") : "s-down"),"data-vq":r.id},
      h("div",{class:"pmain"},h("span",{class:"name",text:what}),
        h("span",{class:"sub",text: sent ? "Sent to "+r.to+" by "+r.by+(r.at?" · "+mgWhen(r.at):"")+(days(r)>=3?" · no answer marked in "+days(r)+" days":"")
          : r.state==="review" ? "Gmail did not answer. Check your Sent folder to see if it went."+(r.at?" · "+mgWhen(r.at):"") : "Not sent"+(r.error?": "+r.error:".")+(r.at?" · "+mgWhen(r.at):"")})),
      closing ? h("div",{style:"grid-column:1 / -1;display:flex;flex-direction:column;gap:8px"},
        sent && r.kind==="monitor_add" ? h("label",{class:"mgfield"},"Eyeforce account number from their reply (optional)",h("input",{class:"tin",type:"text",maxlength:"12",placeholder:"EYE17351","aria-label":"Eyeforce account number",value:c.eye,oninput:e=>{ c.eye=e.target.value; }}),
          h("span",{class:"note",text:"COS saves it on "+r.unit+", so Remove account and Swap unit fill it in later."})) : null,
        h("label",{class:"mgfield"},"Note (optional)",h("input",{class:"tin",type:"text",maxlength:"300","aria-label":"Note",value:c.note,oninput:e=>{ c.note=e.target.value; }})),
        c.err ? h("p",{class:"note",role:"alert",text:c.err}) : null,
        h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",disabled:VQ.busy,onclick:()=>vqClose()},VQ.busy?"Saving…":sent?"Mark done":"Clear it"),
          h("button",{class:"lk",type:"button",onclick:()=>{ VQ.close=null; mgDraw("ven"); }},"Cancel")))
      : h("div",{class:"links"},h("button",{class:"lk",type:"button",disabled:VQ.busy,onclick:()=>{ VQ.close={id:r.id,eye:"",note:"",err:""}; mgDraw("ven"); }},sent?"Mark done":r.state==="review"?"Mark done":"Clear")));
  };
  return h("div",{class:"box",id:"mgVenBox"},title,
    h("p",{class:"big",text: waiting.length ? mgPlural(waiting.length,"email")+" waiting on a vendor." : "Nothing is waiting on a vendor."}),
    late.length ? h("p",{class:"note s-issues",text:mgPlural(late.length,"email")+" sent 3 or more days ago with no answer marked. Follow up with the vendor."}) : null,
    other.length ? h("p",{class:"note s-down",text:mgPlural(other.length,"email")+" did not go out cleanly. Check below."}) : null,
    VQ.err ? h("p",{class:"note",role:"alert",text:VQ.err}) : null,
    ...other.map(row), ...waiting.map(row),
    h("p",{class:"note",text:"Mark an email done when the vendor confirms. It leaves this list and stays on the unit card."}),
    VQ.data.done.length ? h("div",{class:"links"},h("button",{class:"lk",type:"button",onclick:()=>{ VQ.done=!VQ.done; mgDraw("ven"); }},VQ.done?"Hide the last done":"Show the last done ("+VQ.data.done.length+")")) : null,
    ...(VQ.done ? VQ.data.done.map(r=>h("p",{class:"note",text:(VKIND[r.kind]||"Email")+" · "+r.unit+" · done by "+r.by+(r.at?" · "+mgWhen(r.at):"")+(r.note?" · "+r.note:"")})) : []));
}
async function vqClose(){
  const c=VQ.close; if(!c || VQ.busy) return;
  const eye=String(c.eye||"").toUpperCase().replace(/\s/g,"");
  if(eye && !/^EYE\d{3,8}$/.test(eye)){ c.err="An Eyeforce account number looks like EYE17351."; mgDraw("ven"); return; }
  VQ.busy=true; c.err=""; mgDraw("ven");
  try{ VQ.data=await hooks.vendor.close(c.id, String(c.note||"").trim(), eye); VQ.close=null; toast(eye ? "Done. "+eye+" is saved on the unit." : "Done.", 6000); }
  catch(x){ c.err=(x && x.message) || "That could not be saved."; }
  VQ.busy=false; mgDraw("ven");
}
const simSplit = t => String(t||"").split(/[\r\n,;]+/).map(x=>x.replace(/[^0-9A-Za-z]/g,"")).filter(Boolean);
function mgSims(d){
  const title=h("h3",{text:"SIM drawer"});
  const g=d.sims;
  if(!g) return h("div",{class:"box"},title,h("p",{class:"note",text:"The SIM drawer could not be read just now."}));
  const by=st=>g.cards.filter(c=>c.status===st);
  const inDrawer=by("in_drawer"), out=g.cards.filter(c=>c.status==="in_unit"||c.status==="on_truck"), bad=g.cards.filter(c=>c.status==="bad"||c.status==="deactivated");
  const tab=(key,label,n)=>h("button",{type:"button",class:"lk"+(SIMF.show===key?" on":""),"aria-pressed":String(SIMF.show===key),onclick:()=>{ SIMF.show=key; SIMF.all=false; SIMF.mark=null; mgDraw("sim"); }},label+" ("+n+")");
  const shown=SIMF.show==="out"?out:SIMF.show==="bad"?bad:inDrawer;
  const rows=(SIMF.all?shown:shown.slice(0,12)).map(simRow);
  return h("div",{class:"box",id:"mgSimBox"},title,
    h("p",{class:"big",text:mgPlural(inDrawer.length,"SIM")+" in the drawer."}),
    h("p",{class:"note",text:out.length+" out in units or on trucks · "+bad.length+" bad or deactivated."}),
    simRule(g),
    g.notListed.length ? h("div",{class:"prow s-issues"},h("div",{class:"pmain"},h("span",{class:"name",text:mgPlural(g.notListed.length,"SIM")+" handed out that were not on the drawer list"}),
      h("span",{class:"sub",text:g.notListed.slice(0,5).map(x=>x.sim+" ("+x.detail+")").join(" · ")+(g.notListed.length>5?" …":"")}))) : null,
    h("div",{class:"links"},tab("in_drawer","In the drawer",inDrawer.length),tab("out","Out",out.length),tab("bad","Bad",bad.length)),
    ...(rows.length ? rows : [h("p",{class:"note",text:SIMF.show==="in_drawer" ? "No cards on the list yet. Add them below." : "None."})]),
    shown.length>12 && !SIMF.all ? h("div",{class:"links"},h("button",{class:"lk",type:"button",onclick:()=>{ SIMF.all=true; mgDraw("sim"); }},"Show all "+shown.length)) : null,
    simAddForm());
}
function simRow(c){
  const st=SIMSTATE[c.status]||SIMSTATE.removed, marking=SIMF.mark && SIMF.mark.sim===c.sim;
  const act=(status,label)=>h("button",{class:"lk",type:"button",disabled:SIMF.busy,onclick:()=>{ if(status==="in_drawer"){ simMark(c.sim,"in_drawer",""); } else { SIMF.mark={sim:c.sim,status,note:"",err:""}; mgDraw("sim"); } }},label);
  return h("div",{class:"prow "+st[1]},
    h("div",{class:"pmain"},h("span",{class:"name",text:c.sim+(c.carrier?" · "+c.carrier:"")}),
      h("span",{class:"sub",text:st[0]+(c.location?" · "+c.location:"")+(c.note?" · "+c.note:"")+(c.by?" · "+c.by:"")+(c.at?" · "+mgWhen(c.at):"")})),
    marking ? h("div",{class:"simmark",style:"grid-column:1 / -1;display:flex;flex-direction:column;gap:8px"},
      h("label",{class:"mgfield"},"Why is "+c.sim+" "+SIMF.mark.status+"?",h("input",{class:"tin",type:"text",maxlength:"300",value:SIMF.mark.note,oninput:e=>{ SIMF.mark.note=e.target.value; }})),
      SIMF.mark.err ? h("p",{class:"note",role:"alert",text:SIMF.mark.err}) : null,
      h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",disabled:SIMF.busy,onclick:()=>{ if(!SIMF.mark.note.trim()){ SIMF.mark.err="Write why first."; mgDraw("sim"); return; } simMark(c.sim,SIMF.mark.status,SIMF.mark.note); }},"Save"),
        h("button",{class:"lk",type:"button",onclick:()=>{ SIMF.mark=null; mgDraw("sim"); }},"Cancel")))
    : h("div",{class:"links"},...(c.status==="in_drawer" ? [act("bad","Mark bad"),act("removed","Remove")] : [act("in_drawer","Back in drawer"),act("bad","Mark bad"),act("deactivated","Deactivated")])));
}
async function simMark(sim,status,note){
  if(SIMF.busy) return; SIMF.busy=true;
  try{ MG.data=await MGK.simMark(sim,status,note); MG.at=Date.now(); SIMF.mark=null; toast(status==="in_drawer" ? sim+" is back in the drawer." : sim+" is marked "+status+".", 6000); }
  catch(x){ if(SIMF.mark) SIMF.mark.err=(x && x.message) || "That could not be saved."; else toast((x && x.message) || "That could not be saved.", 8000); }
  SIMF.busy=false; mgDraw("sim");
}
function simAddForm(){
  if(!SIMF.open) return h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",onclick:()=>{ SIMF.open=true; SIMF.done=""; mgDraw("sim"); }},"Add SIM cards"),
    SIMF.done ? h("span",{class:"note",role:"status",text:SIMF.done}) : null);
  const n=simSplit(SIMF.text).length;
  return h("div",{class:"simadd mgedit",style:"display:flex;flex-direction:column;gap:9px;margin-top:10px"},
    h("label",{class:"mgfield"},"SIM numbers (one per line, or scan them)",h("textarea",{class:"tin",rows:"5","aria-label":"SIM numbers",oninput:e=>{ SIMF.text=e.target.value; const c=$("simCount"); if(c) c.textContent=mgPlural(simSplit(SIMF.text).length,"number")+" entered"; }},SIMF.text)),
    h("p",{class:"note",id:"simCount",text:mgPlural(n,"number")+" entered"}),
    h("label",{class:"mgfield"},"Carrier",h("input",{class:"tin",type:"text",maxlength:"40",list:"simCarriers",value:SIMF.carrier,oninput:e=>{ SIMF.carrier=e.target.value; }}),
      h("datalist",{id:"simCarriers"},h("option",{value:"Simetry"}),h("option",{value:"Vendera"}))),
    h("label",{class:"mgfield"},"Note (optional)",h("input",{class:"tin",type:"text",maxlength:"300",value:SIMF.note,oninput:e=>{ SIMF.note=e.target.value; }})),
    SIMF.done ? h("p",{class:"note",role:"status",text:SIMF.done}) : null,
    SIMF.err ? h("p",{class:"note",role:"alert",text:SIMF.err}) : null,
    h("div",{class:"links"},h("button",{class:"fixbtn",type:"button",disabled:SIMF.busy,onclick:simAdd},SIMF.busy?"Adding…":"Add to drawer"),
      h("button",{class:"lk",type:"button",onclick:()=>{ SIMF.open=false; SIMF.err=""; mgDraw("sim"); }},"Close")));
}
async function simAdd(){
  const numbers=simSplit(SIMF.text);
  if(!numbers.length){ SIMF.err="Enter at least one SIM number."; mgDraw("sim"); return; }
  if(numbers.length>500){ SIMF.err="Add at most 500 at a time."; mgDraw("sim"); return; }
  SIMF.busy=true; SIMF.err=""; mgDraw("sim");
  try{ const {result,snapshot}=await MGK.simAdd(numbers,SIMF.carrier.trim(),SIMF.note.trim()); MG.data=snapshot; MG.at=Date.now();
    SIMF.done=mgPlural(result.added.length,"SIM")+" added."+(result.already.length?" "+result.already.length+" already on the list.":"")+(result.bad.length?" Not SIM numbers: "+result.bad.join(", ")+".":"");
    SIMF.text=""; SIMF.note=""; SIMF.open=result.bad.length>0; SIMF.show="in_drawer"; }
  catch(x){ SIMF.err=(x && x.message) || "The cards could not be added."; }
  SIMF.busy=false; mgDraw("sim");
}
function mgExchanges(d, idx){
  const title=h("h3",{text:"Handed between IT and Service"});
  if(d.exchanges===null) return h("div",{class:"box"},title,h("p",{class:"note",text:"The handoff log could not be read just now."}),h("div",{class:"links"},mgTool("handoffs","Open the handoffs desk")));
  const xs=d.exchanges, open=xs.filter(x=>x.state==="awaiting_service"||x.state==="discrepancy").length, show=MG.allX ? xs : xs.slice(0,5);
  return h("div",{class:"box"},title,
    h("p",{class:"big",text: !xs.length ? "No handoff is on record yet." : mgPlural(xs.length,"handoff")+" on record, "+(open ? open+" still open." : "none open.")}),
    h("div",{class:"mgxs"},...show.map(x=>mgExchange(x, idx))),
    xs.length>show.length ? h("div",{class:"links mgmore"},h("button",{class:"lk",type:"button",onclick:()=>{ MG.allX=true; mgDraw("x"); }},"Show all "+xs.length)) : null,
    h("p",{class:"note",text:"IT starts a handoff in Tech Check and Service signs for it. Each step is saved with its photos and signature."}),
    h("div",{class:"links"},mgTool("handoffs","Open the handoffs desk")));
}
function mgExchange(x, idx){ const st=MGSTATE[x.state]||[x.state.replace(/_/g," "),"s-unknown"], isOpen=!!MG.open[x.id];
  const shots=x.events.reduce((n,e)=>n+e.photos.filter(p=>p.kind!=="signature").length,0), signs=x.events.filter(e=>e.photos.some(p=>p.kind==="signature")).length;
  return h("div",{class:"prow mgx "+st[1]},
    h("button",{class:"pmain",type:"button","aria-expanded":String(isOpen),onclick:()=>{ MG.open[x.id]=!isOpen; mgDraw("x"); }},
      h("span",{class:"mgxtop"},h("span",{class:"name",text:x.items.join(", ")||"Equipment"}),h("span",{class:"pill "+st[1],text:st[0]})),
      h("span",{class:"sub"},x.purpose+" · ",h("b",{text:x.from})," to ",h("b",{text:x.to})),
      h("span",{class:"sub",text:mgWhen(x.at)+" · "+mgPlural(shots,"photo")+" · "+mgPlural(signs,"signature")+(isOpen ? "" : " · Tap to see them")})),
    isOpen ? h("div",{class:"mgxlog"},...x.events.map(mgEvent)) : null);
}
function mgEvent(e){ const signed=e.photos.some(p=>p.kind==="signature");
  return h("div",{class:"mgev"},
    h("p",null,h("b",{text:(MGKIND[e.kind]||MGKIND.other)+e.who})," · "+mgWhen(e.at)+(signed ? " · signed" : "")+(e.differences ? " · "+mgPlural(e.differences,"difference")+" recorded" : "")),
    e.photos.length ? h("div",{class:"mgshots"},...e.photos.map(mgShot)) : null,
    e.report ? h("div",{class:"links"},h("a",{class:"lk",href:e.report,target:"_blank",rel:"noopener noreferrer"},"Open the signed report")) : null);
}
/* A saved photo or signature. Its link is fetched when the handoff is opened and lasts a few minutes. */
function mgShot(p){ const s=MG.shots[p.path], label=p.kind==="signature" ? "Signature" : "Photo";
  if(s && s.url && Date.now()-s.at<240000) return h("a",{class:"mgshot"+(p.kind==="signature"?" sig":""),href:s.url,target:"_blank",rel:"noopener noreferrer"},h("img",{src:s.url,alt:label,loading:"lazy"}),h("span",{text:label}));
  if(!s || s.url){ MG.shots[p.path]={ wait:true };
    MGK.photo(p.path).then(url=>{ MG.shots[p.path]={ url:url, at:Date.now() }; },()=>{ MG.shots[p.path]={ failed:true }; }).then(()=>{ if(S.view==="manager") mgDraw("x"); }); }
  return h("span",{class:"mgshot wait",text: s && s.failed ? label+" not available" : "Loading…"});
}

/* The other COS screens. The board is the screen James works from, so its own doors go here, named as IT sees them. */
const SCREENS = [["Camera Health","Camera Health"],["InHand Routers","InHand Routers"],["Victron VRM","Victron Power"],["Unit Tracker","2027 Unit Tracker"]];
function screensRow(){
  const row=$("screensLinks"); if(!row) return;
  if(!hooks || typeof hooks.onScreen!=="function"){ $("screensRow").hidden = true; return; }
  row.replaceChildren(...SCREENS.map(([workspace,label])=>h("button",{class:"lk",type:"button",onclick:()=>hooks.onScreen(workspace)},label)));
}
function mgTools(){
  const tools=[["handoffs","Handoffs desk"],["history","Check history"],["review","Completed checks"],["attention","Needs attention"],["assign","Assign checks"],["calendar","Schedule"],["units","Equipment records"],["activity","Activity log"],["accounts","Tech accounts"],["team","Older truck screen"],["it","IT tech screen"],["service","Service tech screen"]];
  return h("div",{class:"box"},h("h3",{text:"More"}),
    h("div",{class:"links"},h("button",{class:"lk",type:"button","aria-expanded":String(MG.tools),onclick:()=>{ MG.tools=!MG.tools; mgDraw("tools"); }},MG.tools ? "Hide the Tech Check screens" : "Other Tech Check screens"),
      h("button",{class:"lk",type:"button",disabled:MG.state==="loading",onclick:()=>mgLoad(true)},MG.state==="loading" ? "Reading…" : "Read trucks again")),
    MG.tools ? h("div",{class:"links mgmore"},...tools.map(([r,l])=>mgTool(r,l))) : null,
    hooks && typeof hooks.onScreen==="function" ? h("div",{class:"links mgapps"},...SCREENS.map(([workspace,label])=>h("button",{class:"lk",type:"button",onclick:()=>hooks.onScreen(workspace)},label))) : null,
    h("p",{class:"note",text:(MG.err ? MG.err+" " : "")+(MG.at ? "Trucks and inspections read "+fmtClock.format(new Date(MG.at))+"." : "")}));
}

/* ---------- wide screens ----------
   On a desk the board is one screen: a slim bar, the counts in one row, then the list and the live map side by
   side, each filling the window. The board's own width decides, so it is right at any size inside the app's frame. */
const W = { wide:false, side:false };
/* The one map lives on the Map tab, and on a wide Board tab it sits beside the list. */
function placeMap(){
  /* The board is the first screen of the day, so the map is on it, not a tab away. On a desk it sits beside the
     list; on a phone there is no room beside, so it goes under the counts and above the list. Same map either way. */
  const side = W.wide && S.view==="board", onBoard = !W.wide && S.view==="board";
  const block=$("mapBlock"), home = side ? $("boardSide") : onBoard ? $("boardMain") : $("viewMap");
  if(block.parentNode!==home){ if(onBoard) $("boardMain").insertBefore(block, $("boardList")); else home.append(block); }
  block.classList.toggle("onboard", onBoard);
  $("boardSide").hidden = !side;
  /* On the board the count tiles choose what the map shows. On its own tab the map shows everything again. */
  const withList = side || onBoard;
  if(W.side!==withList){ W.side=withList; M.fitted=false; M.sel=null; M.w=0; if(!withList) M.f="all"; }
  sideFilter();
}
function sideFilter(){ if(!W.side) return; const f=["down","issues","unknown","up"].includes(S.filter) ? S.filter : "all"; if(M.f!==f){ M.f=f; M.sel=null; } }
/* On a desk the tabs sit in the top bar beside the name. On a phone they are the first thing under it, as before. */
function placeTabs(){
  const tabs=root.querySelector(".tabs"), bar=root.querySelector(".top .wrap"), main=root.querySelector("main");
  if(W.wide){ if(tabs.parentNode!==bar) bar.insertBefore(tabs, bar.querySelector(".logo").nextSibling); }
  else if(tabs.parentNode!==main) main.insertBefore(tabs, main.firstChild);
}
/* The map is as tall as the pane it is in and keeps the drawing's own shape, so all of it shows.
   It never takes the room the list beside it needs. */
function fitMap(){
  if(!W.wide) return;
  const pane = W.side ? $("boardSide") : S.view==="map" ? $("viewMap") : null; if(!pane) return;
  const above = W.side ? $("mapGo").getBoundingClientRect().height + 8 : 0;
  const tall = pane.clientHeight - above - (W.side ? 0 : 14);
  const across = $("cosb").getBoundingClientRect().width, room = across - 56 - 18 - (W.side ? 480 : 380);
  const size = Math.floor(Math.max(240, Math.min(tall, room / 0.9841)));
  if(W.mh!==size){ W.mh=size; $("cosb").style.setProperty("--mh", size+"px"); }
}
function measureWide(){
  const across = $("cosb").getBoundingClientRect().width, on = across >= 880;
  $("cosb").classList.toggle("roomy", across >= 1200);
  if(W.wide!==on){ W.wide=on; $("cosb").classList.toggle("wide",on); placeTabs(); placeMap(); if(S.meta) render(); }
}
/* The app can give the board more room without the window changing size, so the board watches its own size. */
function watchWidth(){
  if(typeof ResizeObserver!=="function") return;
  const seen=new ResizeObserver(()=>{ measureWide(); if(S.meta && (S.view==="map" || W.side)){ fitMap(); sizeMap(); paint(); } });
  seen.observe($("cosb")); cleanups.push(()=>seen.disconnect());
}
/* ---------- the TV board ---------- */
/* The same reading and the same count as the board, drawn to be read from across the shop. Nothing on it needs
   a tap: it lists the field units that are down or have camera issues, and walks the map one area at a time. */
const TV = { on:false, step:0, every: Math.max(5, Math.min(300, (hooks && +hooks.tvEvery) || 10)), turn:null, tick:null, areas:[], rows:[] };
/* The TV board is a wall screen: a reload must not drop it back to the board.
   Only Exit TV or Escape turns it off, so the choice is remembered per browser
   and read back at start. Storage can be unavailable, so never let it throw. */
const TV_KEY = "cos-tv-board";
function tvRemember(on){ try{ on ? localStorage.setItem(TV_KEY,"1") : localStorage.removeItem(TV_KEY); }catch(_){} }
function tvWanted(){ try{ return localStorage.getItem(TV_KEY)==="1"; }catch(_){ return false; } }
const TVAREAS = [["Houston",29.80,-95.42],["Austin",30.27,-97.74],["San Antonio",29.45,-98.50],["Dallas–Fort Worth",32.80,-97.00]];
const tvClockFmt = new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:TZ});
const tvDayFmt = new Intl.DateTimeFormat("en-US",{weekday:"long",month:"short",day:"numeric",timeZone:TZ});
function tvNow(){ const d=new Date(); $("tvClock").textContent=tvClockFmt.format(d); $("tvDate").textContent=tvDayFmt.format(d)+" · CT"; }
function tvRow(v){
  const more=[];
  if(v.side) more.push(v.side.replace("/"," of ")+" online");
  if(v.status==="down"){ const r=routerRead(v.u); if(r.off) more.push("router down too"); else if(r.on) more.push("router up"); }
  return h("div",{class:"tvrow s-"+v.status},
    h("span",{class:"name",text:v.name}),
    h("span",{class:"pill",text:LABEL[v.status]}),
    h("span",{class:"site"},v.site||"No site on record", more.length ? h("span",{class:"more",text:" · "+more.join(" · ")}) : null));
}
/* As many rows as fit, never a cut-off one. More than fit take turns, a screenful at a time. */
function tvList(){
  const box=$("tvList"), rows=TV.rows, head=$("tvHead");
  if(!rows.length){ head.replaceChildren(); box.replaceChildren(h("div",{class:"tvnone"},h("b",{text:"Nothing is down."}),h("span",{text:"No field unit is down or showing camera issues on this reading."}))); return; }
  const down=rows.filter(v=>v.status==="down").length, issues=rows.length-down, said=[];
  if(down) said.push(down+" down"); if(issues) said.push(issues+" with camera issues");
  let per=rows.length;
  if(box.clientHeight>40 && !matchMedia("(max-width:899px)").matches){
    const probe=tvRow(rows[0]); box.classList.remove("two"); box.replaceChildren(probe);
    const rh=probe.getBoundingClientRect().height, gap=parseFloat(getComputedStyle(box).rowGap)||0;
    const down1=rh>0 ? Math.max(1,Math.floor((box.clientHeight+gap)/(rh+gap))) : rows.length;
    /* One column while everything fits in it. Two when it does not and there is the width for them. */
    const two = rows.length>down1 && box.clientWidth>=760;
    box.classList.toggle("two",two);
    per = down1*(two?2:1);
  }
  const pages=Math.max(1,Math.ceil(rows.length/per)), page=TV.step%pages;
  head.replaceChildren(...[h("span",{text:said.join(" · ")}), pages>1 ? h("span",{class:"tvstep",text:(page+1)+" / "+pages}) : null].filter(Boolean));
  box.replaceChildren(...rows.slice(page*per,page*per+per).map(tvRow));
}
/* Pins near a city are that city's page. A city holding every pin would only repeat the first page. */
function tvAreas(){
  const near={};
  for(const q of M.pts){ let best=-1, bd=1.7; TVAREAS.forEach(([,la,lo],i)=>{ const d=Math.hypot(q.p.lat-la,(q.p.lng-lo)*.86); if(d<bd){ bd=d; best=i; } }); if(best>=0) (near[best]=near[best]||[]).push(q); }
  const list=[{name:"All field units",pts:M.pts}];
  TVAREAS.forEach(([name],i)=>{ if(near[i] && near[i].length<M.pts.length) list.push({name,pts:near[i]}); });
  TV.areas=list;
}
function tvTour(){
  const title=$("tvMapTitle");
  if(!M.pts.length){ title.replaceChildren(h("b",{text:"Map"})," · no field unit has a pin yet"); paint(); return; }
  const at=TV.step%TV.areas.length, a=TV.areas[at], n=a.pts.length, cnt={}; for(const q of a.pts) cnt[q.v.status]=(cnt[q.v.status]||0)+1;
  const said=[n+(n===1?" unit":" units")]; if(cnt.down) said.push(cnt.down+" down"); if(cnt.issues) said.push(cnt.issues+" with camera issues");
  title.replaceChildren(...[h("b",{text:a.name}), " · "+said.join(" · "), TV.areas.length>1 ? h("span",{class:"tvstep",text:(at+1)+" / "+TV.areas.length}) : null].filter(Boolean));
  if(M.w) fitPts(a.pts, Math.max(44, Math.min(M.w,M.h)*.1), 60);
}
/* The map panel takes the drawing's own shape, as tall as the screen allows. The counts and the list take the rest. */
function tvSize(){
  const right=$("tvRight");
  if(matchMedia("(max-width:899px)").matches){ right.style.width=""; M.pk=1.25; return; }
  const grid=$("tvGrid"), gw=grid.clientWidth, room=grid.clientHeight-$("tvMapTitle").offsetHeight-(parseFloat(getComputedStyle(right).rowGap)||0);
  right.style.width=Math.round(Math.max(gw*.36, Math.min(gw*.6, room*(M.data ? M.data.w/M.data.h : 1))))+"px";
  M.pk=Math.max(1.25, Math.min(2.4, room/430));
}
function drawTv(vs, c){
  const at=S.meta.v, now=Date.now()/1000, stale=!at || (now-at)/60 > VCC_STALE_MIN, read=$("tvRead");
  read.classList.toggle("stale", stale);
  if(!at) read.replaceChildren("Star4Live has not given a reading time.");
  else read.replaceChildren(stale ? "Old reading. " : "", "Star4Live read ", h("b",{text:when(at)}), " · "+ago(at)+" ago");
  /* The wall screen is read from across the shop, so the mark has to carry at that distance: the block dims. */
  $("tvKpi").classList.toggle("prov", !S.mh);
  const tile=(key,cls)=>h("div",{class:"tile "+cls+(c[key]?"":" zero")},h("span",{class:"num",text:c[key]}),h("span",{class:"lab",text:LABEL[key]}));
  $("tvTiles").replaceChildren(tile("down","t-down"),tile("issues","t-issues"),tile("unknown","t-unknown"),tile("up","t-up"));
  const mini=(num,lab)=>h("span",{},h("b",{text:num}),lab);
  $("tvMinis").replaceChildren(mini(c.down+c.issues+c.up+c.unknown,"in the field"),mini(c.shop+c.shopOnline,"in the shop"),mini(c.shopOnline,"online in shop"));
  const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true});
  TV.rows=[...vs.filter(v=>v.status==="down").sort(byName), ...vs.filter(v=>v.status==="issues").sort(byName)];
  const feeds = !S.mh;
  $("tvNote").textContent=(feeds ? "Not the official count: what the camera systems see, until mHelp has loaded." : "Counting what mHelp lists.")+" A unit in the shop never counts as down. A reading that is missing or too old shows Unknown, never Down.";
  tvSize(); tvList();
  drawMap(vs); tvAreas(); tvTour();
}
/* On and off. The one map moves onto the TV screen and back to where it was. */
function tvEnter(){
  if(TV.on) return;
  closeUnit(); TV.on=true; TV.step=0; tvRemember(true);
  $("cosb").classList.add("tv"); $("viewTv").hidden=false;
  $("tvMap").append($("mapWrap"));
  M.near=40;                                        // bigger pins need more room before they share a circle
  M.f="all"; M.sel=null; M.drop=null; M.fitted=false;
  tvNow(); TV.tick=setInterval(tvNow,10000); tvTurn(TV.every);
  if(hooks && typeof hooks.onTv==="function") hooks.onTv(true);
  if(S.meta) render();
}
function tvLeave(){
  if(!TV.on) return;
  TV.on=false; tvRemember(false); clearInterval(TV.tick); clearInterval(TV.turn);
  $("cosb").classList.remove("tv"); $("viewTv").hidden=true;
  $("mapBlock").insertBefore($("mapWrap"), $("mapNote"));
  M.near=0; M.pk=0; M.fitted=false; M.sel=null; M.w=0;
  if(hooks && typeof hooks.onTv==="function") hooks.onTv(false);
  setView(S.view); if(S.meta) render();
}
function tvStart(){
  $("tvGo").addEventListener("click",tvEnter);
  $("tvRefresh").addEventListener("click",refresh);
  $("tvFull").addEventListener("click",async()=>{ try{ if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }catch(_){ toast("Use the browser's own full-screen option to fill the TV."); } });
  $("tvExit").addEventListener("click",tvLeave); $("tvExitTop").addEventListener("click",tvLeave);
  /* Escape leaves. The arrow keys step to the next or the last page by hand, and the turn starts again from there. */
  onDoc("keydown",ev=>{ if(!TV.on || S.openId) return;
    if(ev.key==="Escape") tvLeave();
    else if(ev.key==="ArrowRight" || ev.key==="ArrowLeft"){ TV.step=Math.max(0,TV.step+(ev.key==="ArrowRight"?1:-1)); tvTurn(TV.every); if(S.meta){ tvList(); tvTour(); } } });
  onWin("resize",()=>{ if(TV.on && S.meta) render(); });
  cleanups.push(()=>{ clearInterval(TV.tick); clearInterval(TV.turn); });
  if((hooks && hooks.startView==="tv") || tvWanted()) tvEnter();
}
/* How long each page stays up. */
function tvTurn(seconds){
  TV.every=Math.max(5,Math.min(300,+seconds||15)); clearInterval(TV.turn);
  TV.turn=setInterval(()=>{ TV.step++; if(S.meta){ tvList(); tvTour(); } }, TV.every*1000);
}

/* ---------- start ---------- */
const VIEWS = { board:["viewBoard","tabBoard"], map:["viewMap","tabMap"], punch:["viewPunch","tabPunch"], activity:["viewActivity","tabActivity"], manager:["viewManager","tabManager"] };
function setView(vw){ S.view=vw; placeMap(); for(const [k,[sec,tab]] of Object.entries(VIEWS)){ $(sec).hidden = k!==vw; $(tab).setAttribute("aria-selected",String(k===vw)); }
  if(vw!=="map"){ M.drop=null; M.sel=null; }
  if(vw==="activity") drawActivity(); if(vw==="punch" && S.meta) drawPunch(); if(vw==="map" || W.side) drawMap(); if(vw==="manager") mgOpen(); }
$("tabBoard").addEventListener("click",()=>setView("board"));
$("tabMap").addEventListener("click",()=>setView("map"));
$("tabPunch").addEventListener("click",()=>setView("punch"));
$("tabActivity").addEventListener("click",()=>setView("activity"));
/* Tech checks are their own screen in COS. The tab goes there. */
if(hooks && typeof hooks.onTechCheck==="function") $("tabTech").addEventListener("click",()=>hooks.onTechCheck(MG.on===true || MG.state!=="failed")); else $("tabTech").hidden = true;
mgStart();
screensRow();
$("q").addEventListener("input",ev=>{ S.q=ev.target.value; render(); });
$("refresh").addEventListener("click",refresh);
$("sheet").addEventListener("click",ev=>{ if(ev.target===$("sheet")) closeUnit(); });
onDoc("keydown",ev=>{ if(ev.key==="Escape" && S.openId) closeUnit(); });
const tick=setInterval(()=>{ if(S.meta && !S.openId) render(); }, 60000);
cleanups.push(()=>clearInterval(tick));
M.data = mapData;
measureWide(); watchWidth();
setView(MGK && hooks.startView==="manager" ? "manager" : "board");
tvStart();
void loadRouters();
const rtrTick=setInterval(()=>{ void loadRouters(); }, 15*60000);
cleanups.push(()=>clearInterval(rtrTick));

/* ---------- data in ---------- */
function update(data){
  if(!data || !data.meta || !Array.isArray(data.units)) return;
  const units = data.units.map(u=>Object.assign({}, u, {id:unitId(u.k)}));
  S.dev = data.cameras || {}; S.devAt = data.meta.v;
  S.mh = data.mhelp || null;
  S.meta = data.meta; S.units = units; S.feedNote = ""; S.changes = Array.isArray(data.changes) ? data.changes : [];
  render();
  announce();
  saidSaved();
  if(S.ask) openByName(S.ask);
}
/* Another COS screen asked for a unit ("take me to the unit in COS"). James: the unit card here is the troubleshooting
   screen, so the unit opens on this card, never on the older Fleet details drawer. A name matches when it is the same
   once spaces, dashes and case are ignored, against the unit's name, its key and its mHelp listing; only one unit may
   match. Asked before the first reading arrives, it waits for it. Returns whether a unit was opened. */
const squash = x => String(x||"").toUpperCase().replace(/\d+/g,d=>"#"+String(+d)).replace(/[^A-Z0-9#]/g,"").replace(/^SS(?=#)/,"SOLARSPOTTER");
function openByName(name){
  const want=squash(name); if(!want) return false;
  if(!S.meta || !S.vmap){ S.ask=name; return false; }
  S.ask=null;
  const hits=Object.values(S.vmap).filter(v=>[v.k, v.name, v.mh && v.mh.rec && v.mh.rec.label, v.rec && v.rec.label].some(x=>x && squash(x)===want));
  if(hits.length!==1){ toast(hits.length ? name+" matches more than one unit on the board. Search for it to pick the right one." : name+" is not on the board. Search for it, or check the Punch list."); return false; }
  if(S.view!=="board") setView("board");
  openUnit(hits[0].id);
  return true;
}
/* Whether this person may make a hand fix right now, and the reason when not. */
function setEdit(state){ S.can = !!(state && state.can===true); S.canWhy = (state && state.why) || ""; if(S.meta) render(); }
function destroy(){ for(const fn of cleanups.splice(0)){ try{ fn(); }catch(_){} } clearTimeout(toastTimer); clearTimeout(announceTimer); clearTimeout(savedTimer); cancelAnimationFrame(M.raf); root.replaceChildren(); }
return { update, setEdit, setVcc, setMorning, setSwaps, setReports, destroy, root, setTurn: tvTurn, openByName };
}
