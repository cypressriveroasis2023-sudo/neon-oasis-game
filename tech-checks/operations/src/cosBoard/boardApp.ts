// @ts-nocheck
/* The COS Board screen, running inside the Fleet page.
 *
 * This is the board's own drawing code, so the tiles, unit list and unit page are the same screen James uses,
 * not a second design. What changed for the app:
 *  - it draws inside a shadow root, so its styles and the app's styles cannot touch each other;
 *  - it is handed the app's camera feed and mHelp list (see boardData.ts) and never reads anything itself;
 *  - shop or field, and up or down, are the app's shared count's own calls, not a second set of rules;
 *  - it only reads: hand fixes, the work log, tech checks and the change list need a place to save and are off.
 */
import mapData from './boardMap.json';
import {BOARD_CSS} from './boardStyle';

const SHELL = "<div class=\"cosb\" id=\"cosb\"><header class=\"top\"><div class=\"wrap\">\n  <div class=\"logo\"><span class=\"mk\" aria-hidden=\"true\"><i></i></span><div><h1>COS Board</h1><div class=\"eyebrow\">Cameras Onsite</div></div></div>\n  <button class=\"refresh\" id=\"refresh\" type=\"button\">Refresh</button>\n</div></header>\n<div class=\"asof\" id=\"asof\"><div class=\"wrap\"><span id=\"asofMain\">Loading the camera reading…</span><span id=\"asofSub\"></span></div></div>\n\n<main class=\"wrap\">\n  <div class=\"tabs\" role=\"tablist\">\n    <button class=\"tab\" role=\"tab\" id=\"tabBoard\" aria-selected=\"true\" type=\"button\">Board</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabMap\" aria-selected=\"false\" type=\"button\">Map</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabTech\" aria-selected=\"false\" type=\"button\" hidden>Tech check</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabPunch\" aria-selected=\"false\" type=\"button\">Punch list</button>\n    <button class=\"tab\" role=\"tab\" id=\"tabActivity\" aria-selected=\"false\" type=\"button\" hidden>Changes</button>\n  </div>\n\n  <section id=\"viewBoard\">\n    <div class=\"mode\" id=\"modeRow\"></div>\n    <div class=\"tiles\" id=\"tiles\"></div>\n    <div class=\"shoprow\" id=\"shoprow\"></div>\n    <div class=\"controls\">\n      <input class=\"search\" id=\"q\" type=\"search\" placeholder=\"Find a unit, site, A# or IP\" autocomplete=\"off\" aria-label=\"Find a unit, site, A number or IP\">\n      <div class=\"chips\" id=\"fam\"></div>\n    </div>\n    <div class=\"count\" id=\"count\"></div>\n    <div class=\"list\" id=\"list\"></div>\n    <ul class=\"foot\"><li>One unit counts once, however many cameras it has.</li><li>A unit in the shop never counts as down.</li><li>A reading that is missing or too old shows Unknown, never Down.</li><li>Router checks are a reference only. A router online does not prove the cameras work.</li><li>This screen only reads. It does not change mHelp, Star4Live or InHand.</li></ul>\n  </section>\n\n  <section id=\"viewMap\" hidden>\n    <div class=\"chips\" id=\"mapChips\"></div>\n    <div class=\"chips\" id=\"mapGo\" style=\"margin-top:8px\"></div>\n    <div class=\"mapwrap\" id=\"mapWrap\">\n      <svg id=\"mapSvg\" role=\"img\" aria-label=\"Map of field units\"><g id=\"mapBase\"></g><g id=\"mapLabels\"></g><g id=\"mapPins\"></g></svg>\n      <div class=\"mapbtns\"><button type=\"button\" id=\"zin\" aria-label=\"Zoom in\">+</button><button type=\"button\" id=\"zout\" aria-label=\"Zoom out\">&minus;</button></div>\n      <div class=\"mapmsg\" id=\"mapMsg\" hidden></div>\n      <div class=\"mapsel\" id=\"mapSel\" hidden></div>\n    </div>\n    <p class=\"note\" id=\"mapNote\" style=\"margin-top:10px\"></p>\n    <div class=\"list\" id=\"mapList\"></div>\n  </section>\n\n  <section id=\"viewTech\" hidden>\n    <div id=\"techForm\"></div>\n    <div id=\"techList\"></div>\n  </section>\n\n  <section id=\"viewPunch\" hidden>\n    <div class=\"box\" id=\"punchTop\"><p class=\"note\">Loading the mHelp list…</p></div>\n    <div class=\"chips\" id=\"punchChips\" style=\"margin-top:12px\"></div>\n    <div class=\"count\" id=\"punchCount\"></div>\n    <div class=\"list\" id=\"punchList\"></div>\n  </section>\n\n  <section id=\"viewActivity\" hidden>\n    <p class=\"note\" id=\"actNote\">Every change made by hand on this board, newest first.</p>\n    <ul class=\"hist\" id=\"activity\"></ul>\n  </section>\n</main>\n\n<div class=\"sheet\" id=\"sheet\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pname\"><div class=\"panel\" id=\"panel\"></div></div>\n<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\"></div></div>";
/* A shadow root can be attached to an element only once, so a host that is mounted again gets its first root back. */
const ROOTS = new WeakMap();

export function mountCosBoard(host, hooks){
/* Closed, so a page-wide lookup anywhere else in COS can never match a board element by accident. */
let root = ROOTS.get(host);
if(!root){ root = host.attachShadow({mode:'closed'}); ROOTS.set(host, root); }
root.replaceChildren();
const style = document.createElement('style'); style.textContent = BOARD_CSS;
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
            mh:null, pdone:{}, psec:"place", mode:"feeds", pins0:null, checks:{}, tc:null, tcOpen:false };
try{ if(localStorage.getItem("cos-count-mode")==="mhelp") S.mode="mhelp"; }catch(_){}
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
    if(v.place!==r.place) out.items.push({ id:"place~"+v.id, sec:"place", unit:v.id, name:v.name, st:v.status,
      text:[["mHelp: ",pl(r.place)+(r.cust?" at "+r.cust:"")+(m.fuzzy?" (listed as "+r.label+")":"")],[SRC(v)+": ",pl(v.place)+(v.site?" at "+v.site:"")]] });
    else if(m.fuzzy) out.items.push({ id:"name~"+v.id, sec:"name", unit:v.id, name:v.name, st:v.status, text:[["mHelp: ",r.label+" (A# "+r.id+")"],[SRC(v)+": ",v.name]] });
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
   app's own calls: the same ones its shared count makes, so a tile here always equals the headline. */
function view(u){
  const place = u.pl==="shop" ? "shop" : "field", site = u.st || "";
  const e = {}; if(u.hp) e.pin = {lat:u.hp[0],lng:u.hp[1]}; if((u.he||[]).includes("place")) e.place = place;
  const v = { u, id:u.id, k:u.k, fam:FAM[u.s]||"Other", type:typeOf(u.k,u.s), hand:{}, e };
  v.name = u.nm || nameOf(u.k,u.s);
  v.retired = false; v.feedPlace = place; v.feedSite = site; v.feedName = v.name; v.feedIp = u.ip;
  for(const f of (u.he||[])) v.hand[f]=1;
  v.ip = u.ip; v.place = place; v.site = site; v.note = "";
  v.edited = Object.keys(v.hand).length>0;
  const unk = Math.max(0,u.n-u.on-u.off), fs = u.vd || "unknown";
  if(u.s==="a") v.last = u.on ? "online" : u.off ? "offline" : "";
  v.fs = fs; v.unk = unk; v.excl = !!u.x;
  v.why = fs!=="unknown" ? "" : u.s==="a" ? "No fresh Avigilon check for this unit." : u.s==="r" ? "The Recon cloud has no fresh reading for this unit." : "Star4Live has no fresh reading for every camera on this unit.";
  v.status = (v.excl && S.mode==="feeds") ? "excl" : place==="shop" ? (u.so ? "shopOnline" : "shop") : fs;
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
  if(S.mh && S.mode!=="feeds"){
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
  for(const v of vs) c[v.status]++;
  const setMode=m=>{ S.mode=m; try{ localStorage.setItem("cos-count-mode",m); }catch(_){} if(S.filter==="notin"||S.filter==="excl") S.filter="field"; render(); };
  $("modeRow").replaceChildren("Count by",
    h("button",{class:"chip",type:"button","aria-pressed":String(S.mode!=="feeds"),onclick:()=>setMode("mhelp")},"mHelp (official)"),
    h("button",{class:"chip",type:"button","aria-pressed":String(S.mode==="feeds"),onclick:()=>setMode("feeds")},"Camera systems"),
    h("span",{class:"hint",text: !S.mh && S.mode!=="feeds" ? "The mHelp list has not loaded, so this is showing what the camera systems can see." : S.mode==="feeds" ? "Counting only what the camera systems can see. Shop or field comes from Star4Live, COS's own Sniper and CAM V records, and the Recon cloud. This is not the official count." : "Counting what mHelp lists. Shop or field comes from mHelp."}));
  const tile=(key,cls)=>h("button",{class:"tile "+cls,type:"button","aria-pressed":String(S.filter===key),onclick:()=>setFilter(key)},h("span",{class:"num",text:c[key]}),h("span",{class:"lab",text:LABEL[key]}));
  $("tiles").replaceChildren(tile("down","t-down"),tile("issues","t-issues"),tile("unknown","t-unknown"),tile("up","t-up"));
  const mini=(key,num,lab)=>h("button",{class:"mini",type:"button","aria-pressed":String(S.filter===key),onclick:()=>setFilter(key)},h("b",{text:num}),lab);
  $("shoprow").replaceChildren(...[mini("field",c.down+c.issues+c.up+c.unknown,"in the field"),mini("shopAll",c.shop+c.shopOnline,"in the shop"),mini("shopOnline",c.shopOnline,"online in shop"), S.mode==="feeds" ? (c.excl ? mini("excl",c.excl,"marked do not use") : null) : mini("notin",c.notin,"not in mHelp")].filter(Boolean));
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
  if(S.view==="map") drawMap(vs);
}
const PSEC = [["place","Placed differently","mHelp is official, so the board shows mHelp's placement. The other system says something different, and the other system is the one to fix. Never change mHelp or the tracker to match it. Each answer says who fixes it."],
  ["mhField","Field, no camera feed","mHelp says these are in the field. COS has no camera record for them, so the board cannot show whether they are up."],
  ["bdField","Field feed, not in mHelp","Cameras are reporting from a site under this name, but mHelp has no equipment by that name. Not counted until mHelp has it."],
  ["name","Names differ","Same number, different name in each system. Worth making the names match."],
  ["mhShop","Shop, no camera feed","In mHelp's shop list with no camera record. Normal for units on the shelf."],
  ["bdShop","Shop feed, not in mHelp","Camera records under shop with nothing in mHelp: test devices, retired units, old tracker rows. Not counted."],
  ["done","Handled","Items someone marked handled. They drop off by themselves once the systems agree."]];
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
  const open=items.filter(i=>!done[i.id]), cnt={}; for(const i of open) cnt[i.sec]=(cnt[i.sec]||0)+1; cnt.done=items.filter(i=>done[i.id]).length;
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
  $("punchChips").replaceChildren(...PSEC.map(([k,l])=>h("button",{class:"chip",type:"button","aria-pressed":String(S.psec===k),onclick:()=>{S.psec=k;drawPunch();}},l+" · "+(cnt[k]||0))));
  const sec=PSEC.find(p=>p[0]===S.psec), rows = S.psec==="done" ? items.filter(i=>done[i.id]) : open.filter(i=>i.sec===S.psec);
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
  return h("button",{class:"row s-"+v.status,type:"button",onclick:()=>openUnit(v.id)},
    h("span",{class:"name",text:v.name}),
    h("span",{class:"side"}, v.side, h("small",{text: v.side ? "online" : v.type})),
    h("span",{class:"sub"},sub));
}
function setFilter(k){ S.filter = (S.filter===k && k!=="field") ? "field" : k; render(); }

/* ---------- one unit ---------- */
function openUnit(id){ S.openId=id; S.form=null; S.ipShown=false; $("sheet").classList.add("open"); drawPanel(); $("sheet").scrollTop=0; }
function closeUnit(){ S.openId=null; S.form=null; S.ipShown=false; $("sheet").classList.remove("open"); }
function steps(v){
  if(v.mhOnly) return v.place==="field"
    ? ["mHelp says this unit is in the field. COS has no camera record under this name.","Find out what name its cameras go by in Star4Live, the 2027 tracker or the Recon cloud, and make the names match.","If it is not out there, tell James. James makes any mHelp edit."]
    : ["In the shop per mHelp. No camera record, which is normal for a unit on the shelf."];
  if(v.status==="excl") return ["This unit is marked DO NOT USE, so it is left out of every total.","If that is wrong, the flag is on its mHelp record."];
  if(v.status==="notin") return ["This has a camera record, but mHelp has no equipment by this name, so it is not counted.","If it is real equipment, tell James so it gets added in mHelp, or its name gets corrected to match mHelp.","If it is a test device or an old record, leave it."];
  const pre = v.srcDiff ? ["mHelp says "+v.place+", and mHelp is the official count. "+SRC(v)+" says "+v.feedPlace+". "+(v.u.s==="a" ? "That is a COS record for James to fix. Do not change mHelp or the tracker because of it." : "Fix it in "+SRC(v)+". Do not change mHelp to match it.")] : [];
  return pre.concat(steps0(v));
}
function steps0(v){
  const u=v.u, routerOn=u.rs==="on", routerOff=u.rs==="of";
  if(v.status==="down") return [(routerOn ? "The router answers, so the unit likely has signal. Look at camera or recorder power and cabling." : routerOff ? "The router is not answering either. Check site power, then the SIM and signal." : u.rr ? "Start from the diagnosis above." : "COS has no router reading for this unit. Start with site power."),"Check mHelp for an open job on this unit before sending anyone."];
  if(v.status==="issues") return ["Some cameras are off, listed above. The unit itself is reachable.","Check power and cabling on just those cameras.","When it is fixed, tap Refresh to confirm."];
  if(v.status==="unknown") return ["No fresh reading. Do not treat this as down.","Tap Refresh. If it stays Unknown, check the unit directly."];
  if(v.status==="shopOnline") return ["This unit is online but sits in the shop.","If it is really on a site, its placement needs correcting under Camera status.","If it is on the bench, nothing to do."];
  if(v.status==="shop") return ["In the shop. Not counted as down."];
  return ["Nothing to do. All cameras are reporting."];
}
function routerRead(u){ return { on: u.rs==="on" || (u.rs!=="of" && u.rr==="on"), off: u.rs==="of" || (u.rs!=="on" && u.rr==="of") }; }
const WORD = { ok:"OK", warn:"Check", bad:"Problem", unk:"Unknown" }, RW = { on:"Online", of:"Offline", un:"Unknown" };
/* Read the signs we have and say what is most likely wrong. A router reading is a hint only, never proof the cameras work. */
function diagnose(v){
  const u=v.u, fs=v.fs, r=routerRead(u), ck=[];
  let cam;
  if(u.s==="a") cam = u.t && v.last ? "Avigilon check said "+v.last+" · "+when(u.t) : "No Avigilon check on record";
  else cam = (u.s==="r" ? "Recon cloud" : "Star4Live")+": "+u.on+" of "+u.n+" online"+(u.off ? ", "+u.off+" offline" : "")+(v.unk ? ", "+v.unk+" no reading" : "");
  ck.push({k:"Cameras", s: fs==="up"?"ok":fs==="issues"?"warn":fs==="down"?"bad":"unk", t:cam});
  if(u.rs) ck.push({k:"Router, COS check", s: u.rs==="on"?"ok":u.rs==="of"?"bad":"unk", t:(RW[u.rs]||u.rs)+(u.rt ? " · "+when(u.rt) : "")});
  if(u.rr) ck.push({k:"Router, InHand says", s: u.rr==="on"?"ok":u.rr==="of"?"bad":"unk", t:(RW[u.rr]||u.rr)+(u.ro ? " · "+when(u.ro) : " · no time given")});
  if(!u.rs && !u.rr) ck.push({k:"Router", s:"unk", t:"No router on record for this unit"});
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
  else if(fs==="down") cause = r.off ? "The whole unit looks dark. Cameras and router are both not answering. Think site power, SIM or signal first."
    : r.on ? "The router answers, but nothing behind it is reporting. Think power to the cameras or recorder, the switch, or cabling."
    : "Cameras are not reporting and there is no router reading to narrow it down. Start with site power.";
  else if(fs==="issues") cause="The unit is reachable. Only the cameras listed below are off. Check their power and cable.";
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
  return h("div",{class:"box"},h("h3",{text:"Cameras on this unit"}), list.map(c=>h("div",{class:"cam"},
    h("div",null,h("b",{text:c.name}),h("span",{text:[c.type,c.model,c.fw ? "firmware "+c.fw : ""].filter(Boolean).join(" · ")})),
    h("span",{class:"cst "+(c.st===1?"ok":c.st===0?"bad":"unk"),text: c.st===1 ? "Online" : c.st===0 ? "Offline"+(c.lo ? " since "+when(c.lo) : "") : "No reading"}))),
    S.devAt ? h("p",{class:"note",text:"Camera list read "+when(S.devAt)+"."}) : null); }
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/* Cards show the last part of an IP only. Copy IP and the unit links still use the whole address. */
const ipCard = ip => S.ipShown ? String(ip||"") : ipShort(ip);
const ipShort = ip => { ip=String(ip||""); return IPV4.test(ip) ? "ending ."+ip.split(".")[3] : ip; };
function openBox(v){
  const u=v.u, m = S.mh && S.rec ? S.rec.match[v.id] : (v.mhOnly ? {rec:v.rec} : null), sys=[], own=[];
  const lk=(label,url)=>h("a",{class:"lk",href:url,target:"_blank",rel:"noopener noreferrer"},label);
  if(u.s==="v") sys.push(lk("Star4Live","https://global.star4live.com/userWeb/device/device-management"));
  if(u.rs || u.rr || u.ri) sys.push(lk("InHand routers","https://iot.inhandnetworks.com/device/list"));
  if(v.type==="Helios" || /^Helios/.test(v.type)) sys.push(lk("Victron VRM","https://vrm.victronenergy.com/"));
  sys.push(lk("Watchful","https://v2.watchful.co.nz/alerts"));
  if(v.ip && IPV4.test(v.ip)){
    const ports = u.s==="a" ? [["Web","http",80],["HTTPS","https",443],["HTTPS 8443","https",8443]] : u.s==="v" ? [["Port 80","http",80],["Port 1400","http",1400],["Port 1500","http",1500],["Port 1600","http",1600],["Port 1700","http",1700]] : [];
    for(const [label,proto,port] of ports) own.push(lk(label, proto+"://"+v.ip+((port===80||port===443) ? "" : ":"+port)));
  }
  if(u.ri && IPV4.test(u.ri) && /^\d+$/.test(u.rp)) own.push(lk("Router page", "http://"+u.ri+":"+u.rp));
  const copy = v.ip ? h("button",{class:"lk",type:"button",onclick:()=>{ try{ navigator.clipboard.writeText(v.ip).then(()=>toast("IP copied."),()=>toast("Couldn't copy the IP in this view.")); }catch(_){ toast("Couldn't copy the IP in this view."); } }},"Copy IP") : null;
  const show = v.ip && IPV4.test(v.ip) ? h("button",{class:"lk",type:"button",onclick:()=>{ S.ipShown=!S.ipShown; drawPanel(); }}, S.ipShown ? "Hide IP" : "Show IP") : null;
  return h("div",{class:"box"},h("h3",{text:"Open"}),
    S.ipShown && v.ip ? h("p",{style:"margin:0 0 8px;font-size:18px;font-weight:700;letter-spacing:.02em",text:v.ip}) : null,
    h("div",{class:"links"},sys,show,copy),
    own.length ? h("p",{class:"note",style:"margin-top:10px",text:"This unit's own pages. They only open if the unit is online and your network can reach it."}) : null,
    own.length ? h("div",{class:"links"},own) : null); }
const QUICK = ["Power cycled","Rebooted router","Checked SIM","Checked cabling","Called customer","Opened a job","Fixed"];
function logBox(v){
  const can = S.db && S.canWrite!==false; if(!can) return null;
  const box=h("div",{class:"box"},h("h3",{text:"Log what you did"}),
    h("div",{class:"links"}, QUICK.map(t=>h("button",{class:"lk",type:"button",disabled:S.busy,onclick:()=>logWork(v,t)},t)),
      h("button",{class:"lk",type:"button",disabled:S.busy,onclick:()=>{ S.form="log"; drawPanel(); }},"Something else")));
  if(S.form==="log"){ const inp=h("input",{id:"logInput",type:"text",autocomplete:"off"});
    box.append(h("form",{class:"form",onsubmit:ev=>{ ev.preventDefault(); logWork(v, inp.value.trim()); }},h("label",{for:"logInput",text:"What did you do?"}),inp,
      h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Log it"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{ S.form=null; drawPanel(); }},"Cancel"))));
    setTimeout(()=>{ try{ inp.focus(); }catch(_){} },0); }
  box.append(h("p",{class:"note",text:"One tap adds a line to this unit's history with your name and the time."}));
  return box; }
function histBox(v){ const hist=(v.e.hist||[]).slice().reverse(); return hist.length ? h("div",{class:"box"},h("h3",{text:"History on this unit"}),h("ul",{class:"hist"},hist.map(x=>histLi(x,null)))) : null; }
async function logWork(v, text){
  if(!S.db || S.busy || !text) return;
  const cur = JSON.parse(JSON.stringify(S.edits[v.id]||{})); cur.k=v.k; const at=Date.now();
  cur.hist = (cur.hist||[]).concat([{f:"log",a:"",b:String(text).slice(0,200),by:S.uid,at}]).slice(-60); cur.by=S.uid; cur.at=at;
  S.busy=true; drawPanel();
  try{ await S.db.doc("units/"+v.id).set(cur); S.edits[v.id]=cur; S.form=null; toast("Logged: "+text); }
  catch(err){ if(err&&err.code==="invalid_argument") S.canWrite=false; toast("Not saved. "+(err&&err.code==="invalid_argument" ? "This sign-in can't change the board." : "The board couldn't be reached. Try again in a moment.")); }
  S.busy=false; render();
}
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
  fillNames();
}
function drawPanel(){
  const v = S.vmap && S.vmap[S.openId]; if(!v){ closeUnit(); return; }
  if(v.mhOnly){ drawMhPanel(v); return; }
  const u=v.u, P=$("panel");
  const src = u.s==="v" ? "Star4Live" : u.s==="a" ? "Avigilon check" : "Recon cloud";
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

  const body=[ resBox(resFor(v.name, v.k, mm&&mm.rec.label)), diagBox(v),
    h("div",{class:"box"},h("h3",{text:"What to do"}),h("ol",{class:"steps"},steps(v).map(s=>h("li",{text:s})))),
    camsBox(v), locBox(v), openBox(v), logBox(v),
    h("div",{class:"box"},h("h3",{text:"Details"}),dl, v.why?h("p",{class:"note",text:v.why}):null) ];
  if(v.type==="Helios") body.push(h("div",{class:"box"},h("h3",{text:"Power"}),h("p",{class:"note",text:"Victron solar and battery are not on this board yet."})));

  /* Fix it */
  const can = S.db && S.canWrite!==false;
  const fx=h("div",{class:"box"},h("h3",{text:"Fix it"}));
  if(!can) fx.append(h("p",{class:"note",text:"Hand fixes are not switched on for this screen yet. Correct a unit under Camera status."}));
  else {
    const b=(label,key,alt)=>h("button",{class:"fixbtn"+(alt?" alt":""),type:"button",disabled:S.busy,onclick:()=>{S.form=key;drawPanel();}},label);
    fx.append(h("div",{class:"fix"},
      h("button",{class:"fixbtn",type:"button",disabled:S.busy,onclick:()=>{ if(v.place==="field") save(v,{place:"shop"}); else { S.form="tofield"; drawPanel(); } }}, v.place==="field"?"Move to shop":"Move to field"),
      b("Change site","site"), b("Rename","name",true), b("Correct IP","ip",true), b("Add note","note",true),
      v.edited ? h("button",{class:"fixbtn alt",type:"button",disabled:S.busy,onclick:()=>save(v,{__reset:true})},"Undo hand edits") : null));
    if(S.form && S.form!=="log" && S.form!=="pin"){
      const F={ site:["Site name",v.site,"site"], tofield:["Which site is it on?",v.site||v.feedSite,"site"], name:["Unit name",v.name,"name"], ip:["IP address",v.ip||"","ip"], note:["Note",v.note,"note"] }[S.form];
      const inp=h("input",{id:"fixInput",type:"text",value:F[1]||"",autocomplete:"off"});
      const go=()=>{ const val=inp.value.trim(); const ch={}; ch[F[2]]=val; if(S.form==="tofield") ch.place="field"; if(S.form==="site" && val && v.place==="shop") ch.place="field"; save(v,ch); };
      fx.append(h("form",{class:"form",onsubmit:ev=>{ev.preventDefault();go();}},h("label",{for:"fixInput",text:F[0]}),inp,
        h("p",{class:"note",text: S.form==="ip" ? "Saved exactly as typed. Leave empty to go back to the IP on record." : S.form==="note" ? "Leave empty to clear the note." : S.form==="name" ? "Leave empty to go back to the name on record." : "Saved exactly as typed."}),
        h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Save"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>{S.form=null;drawPanel();}},"Cancel"))));
      setTimeout(()=>{ try{ inp.focus(); }catch(_){} },0);
    }
    fx.append(h("p",{class:"note",text:"A change made by hand wins on this board and is logged with who and when. mHelp is the official count, so make the same change in mHelp."}));
  }
  body.push(fx);
  body.push(histBox(v));

  P.className="panel s-"+v.status;
  P.replaceChildren(h("div",{class:"phead"},h("div",null,h("span",{class:"pill s-"+v.status,text:LABEL[v.status]}),h("h2",{id:"pname",text:v.name})),h("button",{class:"close",type:"button",onclick:closeUnit},"Close")),h("div",{class:"pbody"},body));
  fillNames();
}
const FIELD = { place:"placement", site:"site", name:"name", ip:"IP", note:"note", reset:"hand edits" };
function histLi(x, unitName){
  const who=h("b",{"data-uid":x.by||"",text: x.by ? "Someone" : "Someone"});
  const line = x.f==="log" ? [" logged: “"+(x.b||"")+"”"] : x.f==="pin" ? [x.b ? " dropped a pin at "+x.b : " removed the hand pin"] : x.f==="reset" ? [" cleared the hand edits"] : [" changed "+(FIELD[x.f]||x.f)+" from “"+((x.f==="ip"?ipShort(x.a):x.a)||"empty")+"” to “"+((x.f==="ip"?ipShort(x.b):x.b)||"empty")+"”"];
  return h("li",null, unitName?h("b",{text:unitName+": "}):null, who, line, h("time",{text:when(Math.round((x.at||0)/1000))}));
}
function drawActivity(){
  const all=[]; const names={}; for(const u of S.units) names[u.id]=(S.edits[u.id]&&S.edits[u.id].name)||nameOf(u.k,u.s);
  for(const [id,e] of Object.entries(S.edits)) for(const x of (e.hist||[])) all.push([x, names[id]||e.k||id]);
  all.sort((a,b)=>(b[0].at||0)-(a[0].at||0));
  $("actNote").textContent = !S.db ? "The change log can't be reached in this view." : !S.editsReady ? "Loading the change log…" : all.length ? "Every change made by hand on this board, newest first." : "No changes made by hand yet. When someone moves, renames or fixes a unit, it shows here with who and when.";
  $("activity").replaceChildren(...all.slice(0,200).map(([x,n])=>histLi(x,n)));
  fillNames();
}
async function fillNames(){
  const els=[...root.querySelectorAll("[data-uid]")].filter(e=>e.dataset.uid); if(!els.length || !S.user) return;
  try{ const ps=await S.user.profiles([...new Set(els.map(e=>e.dataset.uid))]); for(const e of els){ const p=ps[e.dataset.uid]; e.textContent=(p&&p.name)||"Someone"; } }catch(_){}
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
function parseLL(t){
  t=String(t||"").trim();
  const m = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || t.match(/[?&](?:q|query|ll|destination|daddr)=(?:loc:)?(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i) || t.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || t.match(/^\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if(!m) return null; const lat=+m[1], lng=+m[2];
  return (lat>=24 && lat<=50 && lng>=-125 && lng<=-66) ? {lat,lng} : null;
}
const llText = p => p.lat.toFixed(5)+", "+p.lng.toFixed(5);
async function savePin(v, pin){
  if(!S.db || S.busy) return false;
  const cur = JSON.parse(JSON.stringify(S.edits[v.id]||{})); cur.k=v.k; const at=Date.now();
  const old = cur.pin && isFinite(+cur.pin.lat) ? llText({lat:+cur.pin.lat,lng:+cur.pin.lng}) : "";
  if(pin) cur.pin={lat:+pin.lat.toFixed(6),lng:+pin.lng.toFixed(6)}; else delete cur.pin;
  cur.hist=(cur.hist||[]).concat([{f:"pin",a:old,b:pin?llText(pin):"",by:S.uid,at}]).slice(-60); cur.by=S.uid; cur.at=at;
  S.busy=true; let ok=false;
  try{ await S.db.doc("units/"+v.id).set(cur); S.edits[v.id]=cur; ok=true; toast(pin ? "Pin saved for "+v.name+"." : "Hand pin removed from "+v.name+"."); }
  catch(err){ if(err&&err.code==="invalid_argument") S.canWrite=false; toast("Not saved. "+(err&&err.code==="invalid_argument" ? "This sign-in can't change the board." : "The board couldn't be reached. Try again in a moment.")); }
  S.busy=false; S.form=null; render(); return ok;
}
function locBox(v){
  const rec=recOf(v), pin=pinOf(v), can = S.db && S.canWrite!==false, hand = pin && pin.kind==="hand";
  if(v.place!=="field" && !hand) return null;
  const addr = rec && rec.addr ? rec.addr : (v.u && v.u.ad) || "";
  const dest = hand ? pin.lat+","+pin.lng : addr ? addr : pin ? pin.lat+","+pin.lng : "";
  const box=h("div",{class:"box"},h("h3",{text:"Where it is"}),
    h("p",{style:"margin:0 0 6px;font-size:16px;font-weight:650",text: addr || (v.site ? v.site : "No address on record")}),
    h("p",{class:"note",text: hand ? "Pin is from the address typed by hand in COS, at "+llText(pin)+"." : !pin ? "No pin yet, so it is not on the map." : pin.kind==="r" ? "Pin is from the mHelp address and is approximate." : "Pin is from the mHelp address. It marks the address, not the unit's exact spot."}),
    h("div",{class:"links",style:"margin-top:8px"},
      dest ? h("a",{class:"lk",href:"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(dest),target:"_blank",rel:"noopener noreferrer"},"Directions") : null,
      pin ? h("button",{class:"lk",type:"button",onclick:()=>showOnMap(v)},"Show on map") : null,
      can ? h("button",{class:"lk",type:"button",disabled:S.busy,onclick:()=>{ S.form = S.form==="pin" ? null : "pin"; drawPanel(); }}, pin ? "Move the pin" : "Drop a pin") : null));
  if(S.form==="pin" && can){
    const inp=h("input",{id:"pinInput",type:"text",autocomplete:"off",placeholder:"29.7604, -95.3698"});
    box.append(h("form",{class:"form",onsubmit:ev=>{ ev.preventDefault(); const p=parseLL(inp.value); if(!p){ toast("Couldn't read that. It should look like 29.7604, -95.3698"); return; } savePin(v,p); }},
      h("label",{for:"pinInput",text:"Paste the spot from Google Maps"}), inp,
      h("p",{class:"note",text:"In Google Maps, press and hold on the unit's spot. Copy the two numbers it shows and paste them here. A copied Google Maps link works too."}),
      h("div",{class:"btns"},h("button",{class:"fixbtn",type:"submit",disabled:S.busy},"Save pin"),h("button",{class:"fixbtn alt",type:"button",onclick:()=>startDrop(v)},"Tap the map instead")),
      hand ? h("button",{class:"fixbtn alt",type:"button",disabled:S.busy,onclick:()=>savePin(v,null)},"Remove my pin") : null));
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
const ZMAX = 900, clampZ = z => Math.max(M.w ? Math.min(M.w/660, M.h/670) : .3, Math.min(ZMAX, z));
function sizeMap(){ const r=$("mapWrap").getBoundingClientRect(); if(r.width>50){ M.w=r.width; M.h=r.height; } }
function centerOn(x,y,z){ M.z=clampZ(z); M.tx=M.w/2-x*M.z; M.ty=M.h/2-y*M.z; paint(); }
function fitPts(pts,pad,zcap){ if(!pts.length||!M.w) return; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for(const q of pts){ x0=Math.min(x0,q.x); y0=Math.min(y0,q.y); x1=Math.max(x1,q.x); y1=Math.max(y1,q.y); }
  pad=pad||40; const z=Math.min((M.w-2*pad)/Math.max(x1-x0,.01),(M.h-2*pad)/Math.max(y1-y0,.01),zcap||60); centerOn((x0+x1)/2,(y0+y1)/2,z); }
function zoomAt(px,py,f){ const nz=clampZ(M.z*f), k=nz/M.z; M.tx=px-(px-M.tx)*k; M.ty=py-(py-M.ty)*k; M.z=nz; paint(); }
function buildBase(){ if(M.built||!M.data) return; const d=M.data, P=(cls,dd)=>dd?sv("path",{class:cls,d:dd}):null;
  $("mapBase").replaceChildren(...[P("m-land",d.land),P("m-urban",d.urban),P("m-water",d.lakes),P("m-river",d.rivers),P("m-county",d.counties),P("m-road",d.roads),P("m-state",d.states),P("m-hwy",d.hwy)].filter(Boolean)); M.built=true; }
function clusters(){
  const show = M.pts.filter(q=>M.f==="all"||q.v.status===M.f).map(q=>({q,sx:q.x*M.z+M.tx,sy:q.y*M.z+M.ty})).filter(a=>a.sx>-24&&a.sy>-24&&a.sx<M.w+24&&a.sy<M.h+24);
  show.sort((a,b)=>(SEV[a.q.v.status]??2)-(SEV[b.q.v.status]??2));
  const cl=[]; for(const a of show){ let c=cl.find(c=>Math.hypot(c.sx-a.sx,c.sy-a.sy)<26); if(!c){ c={sx:a.sx,sy:a.sy,m:[]}; cl.push(c); } c.m.push(a.q); }
  return cl;
}
function paint(){ cancelAnimationFrame(M.raf); M.raf=requestAnimationFrame(paintNow); }
function paintNow(){
  if(!M.w) return;
  $("mapBase").setAttribute("transform","translate("+M.tx.toFixed(1)+","+M.ty.toFixed(1)+") scale("+M.z.toFixed(4)+")");
  const L=[], boxes=[];
  if(M.data){
    const minPop = M.z<1.5 ? 900000 : M.z<3 ? 250000 : M.z<5.5 ? 60000 : 0;
    for(const [name,x,y,pop] of M.data.places){ if(pop<minPop) continue; const sx=x*M.z+M.tx, sy=y*M.z+M.ty; if(sx<-60||sy<-10||sx>M.w+10||sy>M.h+10) continue;
      const b=[sx,sy-9,sx+name.length*7+12,sy+7]; if(boxes.some(o=>b[0]<o[2]&&b[2]>o[0]&&b[1]<o[3]&&b[3]>o[1])) continue; boxes.push(b);
      L.push(sv("circle",{cx:sx.toFixed(1),cy:sy.toFixed(1),r:2.2,class:"pl-dot"}), sv("text",{x:(sx+6).toFixed(1),y:(sy+4).toFixed(1),class:"pl",text:name})); }
    if(M.z>=2) for(const [name,x,y] of M.data.hl){ const sx=x*M.z+M.tx, sy=y*M.z+M.ty; if(sx<0||sy<0||sx>M.w||sy>M.h) continue;
      const b=[sx-14,sy-9,sx+14,sy+6]; if(boxes.some(o=>b[0]<o[2]&&b[2]>o[0]&&b[1]<o[3]&&b[3]>o[1])) continue; boxes.push(b); L.push(sv("text",{x:sx.toFixed(1),y:(sy+3).toFixed(1),class:"hl",text:name})); }
  }
  $("mapLabels").replaceChildren(...L);
  const G=[], cl=clusters(); M.cl=cl;
  for(let i=cl.length-1;i>=0;i--){ const c=cl[i], n=c.m.length, st=c.m[0].v.status, focus = M.focus && c.m.some(q=>q.v.id===M.focus);
    const label = n===1 ? c.m[0].v.name+", "+LABEL[st] : n+" units here, worst is "+LABEL[st];
    G.push(sv("g",{class:"pin",role:"button",tabindex:"0","aria-label":label,transform:"translate("+c.sx.toFixed(1)+","+c.sy.toFixed(1)+")",onclick:ev=>{ if(M.drop) return; ev.stopPropagation(); if(!M.dragged) pick(c); },onkeydown:ev=>{ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); pick(c); } }},
      focus ? sv("circle",{class:"ring",r:n===1?14:18}) : null,
      sv("circle",{r:n===1?(st==="down"?10:8.5):13,fill:PCOL[st]||"var(--unk)"}),
      n>1 ? sv("text",{y:4,text:String(n)}) : null)); }
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
function drawMsg(){
  const el=$("mapMsg"); if(!M.drop){ el.hidden=true; return; }
  const d=M.drop;
  el.replaceChildren(h("div",{text: d.ll ? "Put "+d.name+" here?" : "Tap where "+d.name+" is. Zoom in first with + or a pinch."}),
    h("div",{class:"btns"}, d.ll ? h("button",{class:"fixbtn",type:"button",disabled:S.busy,onclick:async()=>{ const v=S.vmap&&S.vmap[d.id]; if(!v){ M.drop=null; drawMap(); return; } const ok=await savePin(v,d.ll); if(ok){ M.focus=d.id; M.drop=null; drawMap(); } }},"Save pin") : null,
      h("button",{class:"fixbtn alt",type:"button",onclick:()=>{ M.drop=null; drawMap(); }},"Cancel")));
  el.hidden=false;
}
function startDrop(v){ const pin=pinOf(v); closeUnit(); M.drop={id:v.id,name:v.name,ll:null}; M.sel=null; M.f="all"; setView("map");
  if(pin){ const [x,y]=toXY(pin.lat,pin.lng); M.fitted=true; centerOn(x,y,Math.max(M.z,22)); } }
function showOnMap(v){ const pin=pinOf(v); if(!pin) return; closeUnit(); M.focus=v.id; M.f="all"; M.sel=null; M.drop=null; setView("map");
  const [x,y]=toXY(pin.lat,pin.lng); M.fitted=true; centerOn(x,y,Math.max(M.z,40)); }
const GO = [["All units",null],["Houston",29.80,-95.42,7.5],["Austin",30.22,-97.72,9],["San Antonio",29.45,-98.5,11],["Dallas–Fort Worth",32.7,-97.2,8]];
function drawMap(vs){
  if(S.view!=="map" || !S.meta) return;
  vs = vs || allViews();
  const field = vs.filter(v=>v.place==="field" && v.status!=="notin" && v.status!=="excl"), pts=[], none=[];
  for(const v of field){ const p=pinOf(v); if(p){ const [x,y]=toXY(p.lat,p.lng); pts.push({v,p,x,y}); } else none.push(v); }
  M.pts=pts; M.none=none;
  const cnt={all:pts.length}; for(const q of pts) cnt[q.v.status]=(cnt[q.v.status]||0)+1;
  $("mapChips").replaceChildren(...[["all","All"],["down","Down"],["issues","Camera issues"],["unknown","Unknown"],["up","Up"]].map(([k,l])=>h("button",{class:"chip",type:"button","aria-pressed":String(M.f===k),onclick:()=>{ M.f=k; M.sel=null; drawMap(); }},l+" "+(cnt[k]||0))));
  $("mapGo").replaceChildren(...GO.map(([l,la,lo,z])=>h("button",{class:"chip",type:"button",onclick:()=>{ M.sel=null; drawSel(); if(la==null) fitPts(M.pts.filter(q=>M.f==="all"||q.v.status===M.f),36,60); else { const [x,y]=toXY(la,lo); centerOn(x,y,z*(M.w/390)); } }},l)));
  sizeMap(); buildBase();
  if(!M.fitted && pts.length && M.w){ fitPts(pts,36,60); M.fitted=true; }
  const hand=pts.filter(q=>q.p.kind==="hand").length;
  $("mapNote").textContent = pts.length+" field units on the map"+(hand ? ", "+hand+" from an address typed by hand" : "")+". Tap a pin to open the unit. Pins mark the site address from mHelp unless someone typed an address in COS. Shop units are not on the map."+(M.failed ? " The background map didn't load, but the pins still work." : "");
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
  onWin("resize",()=>{ if(S.view==="map"){ sizeMap(); paint(); } });
})();

/* ---------- saving a hand edit ---------- */
async function save(v, ch){
  if(!S.db || S.busy) return;
  const cur = JSON.parse(JSON.stringify(S.edits[v.id]||{})); cur.k=v.k; const hist=cur.hist||[]; const at=Date.now(); let changed=false;
  if(ch.__reset){ for(const f of ["name","site","place","ip","note","pin"]) delete cur[f]; hist.push({f:"reset",a:"",b:"",by:S.uid,at}); changed=true; }
  else for(const [f,val] of Object.entries(ch)){
    const before = f==="place"?v.place : f==="site"?v.site : f==="name"?v.name : f==="ip"?(v.ip||"") : v.note;
    if(val===before) continue;
    if(val==="") delete cur[f]; else cur[f]=val;
    const after = val!=="" ? val : (f==="name"?v.feedName : f==="ip"?(v.feedIp||"") : f==="site"?v.feedSite : "");
    if(after===before) { changed=true; continue; }
    hist.push({f,a:String(before||""),b:String(after||""),by:S.uid,at}); changed=true;
  }
  if(!changed){ S.form=null; drawPanel(); return; }
  cur.hist=hist.slice(-60); cur.by=S.uid; cur.at=at;
  S.busy=true; drawPanel();
  try{ await S.db.doc("units/"+v.id).set(cur); S.edits[v.id]=cur; S.form=null; toast("Saved."); }
  catch(err){ const code=err&&err.code; if(code==="invalid_argument") S.canWrite=false;
    toast(code==="invalid_argument" ? "Not saved. This sign-in can't change the board. Ask James for edit access." : code==="quota_exceeded" ? "Not saved. The board's storage is full. Tell James." : "Not saved. The board couldn't be reached. Try again in a moment."); }
  S.busy=false; render();
}

/* ---------- fresh reading on demand ---------- */
async function refresh(){
  const btn=$("refresh"); if(btn.disabled) return;
  const was = S.meta ? when(S.meta.v) : "the last reading";
  if(!hooks || typeof hooks.onRefresh!=="function"){ toast("Refresh isn't available here. Still showing the reading from "+was+"."); return; }
  btn.disabled=true; btn.textContent="Reading…";
  try{ await hooks.onRefresh(); S.announce=true; clearTimeout(announceTimer); announceTimer=setTimeout(announce, 1500); }
  catch(_){ toast("Couldn't get a new reading. Still showing "+was+".", 12000); }
  btn.disabled=false; btn.textContent="Refresh";
}
/* The new reading reaches this screen a moment after it is read. Say so once it is on screen. */
let announceTimer=null;
function announce(){ if(!S.announce) return; S.announce=false; clearTimeout(announceTimer); toast(S.meta && S.meta.v ? "New reading: Star4Live "+when(S.meta.v)+"." : "New reading loaded.", 5000); }
/* ---------- start ---------- */
const VIEWS = { board:["viewBoard","tabBoard"], map:["viewMap","tabMap"], punch:["viewPunch","tabPunch"], activity:["viewActivity","tabActivity"] };
function setView(vw){ S.view=vw; for(const [k,[sec,tab]] of Object.entries(VIEWS)){ $(sec).hidden = k!==vw; $(tab).setAttribute("aria-selected",String(k===vw)); }
  if(vw!=="map"){ M.drop=null; M.sel=null; }
  if(vw==="activity") drawActivity(); if(vw==="punch" && S.meta) drawPunch(); if(vw==="map") drawMap(); }
$("tabBoard").addEventListener("click",()=>setView("board"));
$("tabMap").addEventListener("click",()=>setView("map"));
$("tabPunch").addEventListener("click",()=>setView("punch"));
$("q").addEventListener("input",ev=>{ S.q=ev.target.value; render(); });
$("refresh").addEventListener("click",refresh);
$("sheet").addEventListener("click",ev=>{ if(ev.target===$("sheet")) closeUnit(); });
onDoc("keydown",ev=>{ if(ev.key==="Escape" && S.openId) closeUnit(); });
const tick=setInterval(()=>{ if(S.meta && !S.openId) render(); }, 60000);
cleanups.push(()=>clearInterval(tick));
M.data = mapData;
setView("board");

/* ---------- data in ---------- */
function update(data){
  if(!data || !data.meta || !Array.isArray(data.units)) return;
  const units = data.units.map(u=>Object.assign({}, u, {id:unitId(u.k)}));
  S.dev = data.cameras || {}; S.devAt = data.meta.v;
  S.mh = data.mhelp || null;
  S.meta = data.meta; S.units = units; S.feedNote = "";
  render();
  announce();
}
function destroy(){ for(const fn of cleanups.splice(0)){ try{ fn(); }catch(_){} } clearTimeout(toastTimer); clearTimeout(announceTimer); cancelAnimationFrame(M.raf); root.replaceChildren(); }
return { update, destroy, root };
}
