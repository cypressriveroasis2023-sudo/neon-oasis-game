let who={name:'James M.',initials:'JM',role:'Owner'};
const q=new URLSearchParams(location.search);
let S=q.get('s')||'fleet';
const D=q.get('d')||(matchMedia('(max-width:700px)').matches?'phone':'desktop');
const ST=q.get('st')||(S==='fleet'?'ok':'late');
function shellHref(screen){
  if(screen==='boards')return '/#daily-board';
  if(screen==='tv')return '/?tvBoard=1#daily-board';
  const params=new URLSearchParams(location.search);
  params.set('s',screen);
  if(!params.get('d'))params.set('d',D);
  return '?'+params.toString();
}
const P={map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
alert:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',units:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
boards:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/>',team:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.3c2.5.2 4.3 2 5 4.7"/>',
details:'<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>',more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
cam:'<path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/>',wifi:'<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5h.01"/>',
bat:'<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/><path d="M5.5 10.5v3M9 10.5v3"/>',shield:'<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',chev:'<path d="m9 6 6 6-6 6"/>',back:'<path d="m15 6-6 6 6 6"/>',check:'<path d="m5 12 5 5 9-10"/>',
unit:'<rect x="6" y="2" width="12" height="9" rx="2"/><path d="M12 11v9M8 20h8"/><circle cx="12" cy="6.5" r="2"/>',truck:'<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8"/><circle cx="6" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
out:'<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M10 12H3M6 8l-4 4 4 4"/>',in:'<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M3 12h9M8 8l4 4-4 4"/>',
clip:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',nav:'<path d="M3 11 21 3l-8 18-2-8-8-2z"/>',tool:'<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-3-3 2.5-2.5z"/>',
tv:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
box:'<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',plug:'<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'};
const I=(n,st='')=>`<svg class="i" viewBox="0 0 24 24" style="${st}">${P[n]}</svg>`;
const phone=D==='phone',tv=D==='tv',late=ST==='late';
const NOW='6:42 AM';
const FLAG=t=>`<span class="flag">NOT SUPPORTED YET · ${t}</span>`;
const FI=t=>`<span class="flagi">NOT SUPPORTED YET · ${t}</span>`;
const RULE=t=>`<span class="flagi rule">NEEDS JAMES RULING · ${t}</span>`;
/* ---------- map ---------- */
function mapSVG(vb){
 const W=1000,H=560;let s=11;const R=()=>(s=(s*16807)%2147483647)/2147483647;
 const Pp=(lo,la)=>[(lo+99.2)/(5.7)*W,(30.9-la)/2.6*H];
 const coast=[[-93.5,29.72],[-93.86,29.7],[-94.39,29.56],[-94.75,29.37],[-95.12,29.08],[-95.36,28.94],[-95.97,28.62],[-96.6,28.3],[-97,28.05],[-99.2,28.05],[-99.2,27.6],[-93.5,27.6]];
 let h=`<defs><radialGradient id="land" cx="65%" cy="40%" r="70%"><stop offset="0" stop-color="#14223a"/><stop offset="1" stop-color="#0c1422"/></radialGradient>
 <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff07" stroke-width="1"/></pattern>
 <filter id="gl" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
 <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#081526"/><stop offset="1" stop-color="#050c17"/></linearGradient></defs>
 <rect x="-500" y="-500" width="2000" height="1600" fill="url(#land)"/><rect x="-500" y="-500" width="2000" height="1600" fill="url(#grid)"/>
 <path d="M${coast.map(p=>Pp(...p).join(',')).join('L')}Z" fill="url(#sea)" stroke="#1f3554" stroke-width="1.5"/>`;
 const roads=[[[-98.49,29.42],[-97.7,29.62],[-96.6,29.75],[-95.37,29.76],[-94.1,30.08],[-93.5,30.15]],[[-98.49,29.42],[-97.74,30.27],[-97.6,30.9]],[[-95.37,29.76],[-95.46,30.31],[-95.5,30.9]],[[-95.37,29.76],[-94.8,29.3]],[[-95.37,29.76],[-96.1,30.6]]];
 roads.forEach(r=>h+=`<path d="M${r.map(p=>Pp(...p).join(',')).join('L')}" fill="none" stroke="#243652" stroke-width="2"/>`);
 const hx=Pp(-95.37,29.76);h+=`<circle cx="${hx[0]}" cy="${hx[1]}" r="60" fill="none" stroke="#2a3f60" stroke-dasharray="3 5"/><circle cx="${hx[0]}" cy="${hx[1]}" r="110" fill="none" stroke="#1f3150" stroke-dasharray="3 6"/>`;
 [['HOUSTON',-95.9,30.16,1],['San Antonio',-98.49,29.42],['Austin',-97.74,30.27],['Beaumont',-94.1,30.08],['Conroe',-95.46,30.31],['Galveston',-94.8,29.3],['Katy',-95.82,29.79]].forEach(([n,lo,la,b])=>{const[x,y]=Pp(lo,la);h+=`<text x="${x+9}" y="${y-9}" fill="${b?'#9fb3cf':'#5f7391'}" font-family="Inter" font-size="${b?15:11.5}" font-weight="${b?800:600}" letter-spacing="${b?3:.3}">${n}</text>`});
 const pts=[];const add=(lo,la,sp,n)=>{for(let i=0;i<n;i++){const a=R()*6.283,r=Math.sqrt(R())*sp;pts.push(Pp(lo+Math.cos(a)*r*1.25,la+Math.sin(a)*r))}};
 add(-95.42,29.74,.34,78);add(-98.49,29.45,.15,9);add(-97.74,30.3,.13,7);add(-94.1,30.08,.08,4);add(-95.46,30.3,.06,4);add(-95.8,29.78,.05,4);
 const red=new Set([4,17,29,41,53,66,90]),unk=new Set([9,23,58,77,95]);
 const k=phone?.75:tv?1.25:1;
 pts.forEach(([x,y],i)=>{const c=late?'#7b879a':red.has(i)?'#fb4f63':unk.has(i)?'#7b879a':'#34d399';const r=(red.has(i)?6.5:4.6)*k;
  if(late){}else if(red.has(i))h+=`<circle cx="${x}" cy="${y}" r="${r*2.6}" fill="#fb4f63" opacity=".35" filter="url(#gl)"/>`;
  else if(!unk.has(i))h+=`<circle cx="${x}" cy="${y}" r="${r*1.8}" fill="#34d399" opacity=".12"/>`;
  h+=`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="${red.has(i)?'#fff':'#06101c'}" stroke-width="${red.has(i)?1.6:1}"/>`});
 return `<svg class="m" viewBox="${vb||'0 0 1000 560'}" preserveAspectRatio="xMidYMid slice">${h}</svg>`;
}
const legend=`<div class="legend"><span><i style="background:var(--g)"></i>All good</span><span><i style="background:var(--r)"></i>Needs attention</span><span><i style="background:var(--u)"></i>Unknown</span><span style="color:var(--tx3)">Pins: mHelp address, not GPS${late?' · as of 5:36 PM':''}</span></div>`;
/* ---------- data (synthetic) ---------- */
const PROB=[['r','cam','Spotter 901','2 of 4 cameras offline','Katy area','6:38 AM'],['r','wifi','Ranger 902','Router not answering','North Houston','6:40 AM'],
 ['r','cam','Sniper 903','Camera offline','Pasadena','6:38 AM'],['a','bat','Helios 904','Battery low · 18%','Conroe','6:35 AM'],
 ['r','cam','Solar Spotter 905','Camera offline','San Antonio','6:38 AM'],['r','wifi','Spotter 907','Router not answering','Sugar Land','6:40 AM']];
const prow=(p,sel)=>`<div class="prow" ${sel?'style="background:#1a2840"':''}><div class="sev ${p[0]}">${I(p[1])}</div><div style="min-width:0"><b>${p[2]}</b><small>${p[3]}</small></div><div class="t">${p[5]}<br><span style="color:var(--tx3)">${p[4]}</span></div>${phone?'':''}</div>`;
function kpis(){
 const k=late?[{n:'Units online',ic:'unit',v:'?',s:'Last known 186 / 196 · as of 5:36 PM',grey:1},{n:'Cameras online',ic:'cam',v:'?',s:'Last known 702 / 731 · as of 5:36 PM',grey:1}]
  :[{n:'Units online',ic:'unit',v:186,t:196,s:'Field units with cameras'},{n:'Cameras online',ic:'cam',v:702,t:731,s:'Cameras in field units'}];
 k.push({n:'Sites armed',ic:'shield',v:86,t:89,s:phone?FI('Watchful + Immix'):'+ 6 on Immix '+FI('Immix'),f:phone?null:'Watchful'},{n:'Problems',ic:'alert',v:6,s:(late?'Field list as of 5:36 PM':tv?'Need a tech today':'Tap to see the list')+' '+FI('disarmed not left out'),bad:1});
 return `<div class="kpis">${k.map(x=>`<div class="card kpi ${x.bad?'bad':''} ${x.grey?'grey':''}"><div class="glow"></div>${x.f?FLAG(x.f):''}<div class="h"><span class="ic">${I(x.ic)}</span>${x.n}</div>
 <div class="v">${x.v}${x.t?`<small>/ ${x.t}</small>`:''}</div>${x.t?`<div class="bar"><i style="width:${x.v/x.t*100}%"></i></div>`:''}<div class="s">${x.s}</div></div>`).join('')}</div>`;
}
const live=late?`<span class="pill late"><span class="lv"></span>Updates delayed · unit list from 5:36 PM</span>`:`<span class="pill"><span class="lv"></span>Live · ${NOW}</span>`;
/* ---------- shells ---------- */
const NAV=[['fleet','map','Fleet'],['problems','alert','Problems',6],['units','units','Units'],['boards','boards','Boards'],['team','team','Team'],['details','details','Details']];
function desk(title,body,extra=''){
 const on=k=>k===S||(S==='unit'&&k==='units');
 return `<div class="shell"><aside class="side"><div class="logo"><div class="mk"><i></i></div><div><b>CAMERAS ONSITE</b><small>Operations</small></div></div>
 <nav aria-label="Fleet">${NAV.map(([k,ic,l,b])=>`<a class="nav ${on(k)?'on':''}" href="${shellHref(k)}"${on(k)?' aria-current="page"':''}>${I(ic)}${l}${b?`<span class="bd">${b}</span>`:''}</a>`).join('')}</nav>
 <div class="sep"></div><a class="nav" href="${shellHref('tv')}">${I('tv')}TV board</a><div class="me"><div class="av">${who.initials}</div><div><b>${who.name}</b><small>${who.role}</small></div></div></aside>
 <main class="main"><div class="top"><h1>${title}</h1><div class="sp"></div>${extra}${['boards','team'].includes(S)?'':`<div class="search">${I('search')}Find a unit or site</div>`}${live}</div>${body}</main></div>`;
}
const TABS=[['fleet','map','Fleet'],['problems','alert','Problems',6],['units','units','Units'],['boards','boards','Boards'],['more','more','More']];
function ph(title,body,right=''){
 const on=S==='unit'?'units':['team','details'].includes(S)?'more':S;
 return `<div class="ph"><div class="bar">${title}<div class="sp"></div>${right}</div><div class="body">${body}</div>
 <nav class="tabs" aria-label="Fleet">${TABS.map(([k,ic,l,b])=>`<a class="tab ${k===on?'on':''}" href="${shellHref(k)}"${k===on?' aria-current="page"':''}><span class="pip"></span>${I(ic)}${l}${b?`<span class="bd">${b}</span>`:''}</a>`).join('')}</nav></div>`;
}
const phLive=late?'':`<span class="pill" style="height:30px;font-size:12px"><span class="lv"></span>${NOW}</span>`;
/* ---------- screens ---------- */
const SC={};
SC.fleet=()=>{
 if(tv)return `<div style="display:flex;flex-direction:column;height:100vh;padding:30px 40px 34px;gap:22px" class="tvw">
  <div class="top"><div class="logo" style="padding:0"><div class="mk" style="width:48px;height:48px"><i></i></div><div><b style="font-size:24px">CAMERAS ONSITE</b><small style="font-size:15px">Fleet board</small></div></div><div class="sp"></div>
  ${late?'<span class="pill late" style="height:46px;font-size:18px;padding:0 20px"><span class="lv"></span>Updates delayed · unit list from 5:36 PM</span>':'<span class="pill" style="height:46px;font-size:18px;padding:0 20px"><span class="lv"></span>Live</span>'}<div style="font:800 44px 'Inter Tight';letter-spacing:-.02em">${NOW}</div></div>
  ${kpis()}<div class="card mapc">${mapSVG()}${legend}</div></div>`;
 if(phone){const delay=late?`<span class="pill late" style="align-self:flex-start;height:30px;font-size:12px"><span class="lv"></span>Updates delayed · unit list from 5:36 PM</span>`:'';
  return ph('<h1>Fleet</h1>',`${delay}${kpis()}<div class="card mapc">${mapSVG('452 40 440 520')}<div class="fab">${I('alert')}6 problems</div><div class="legend" style="top:10px;bottom:auto">Pins: mHelp address, not GPS${late?' · as of 5:36 PM':''}</div>
  <div class="zoom" style="top:10px;right:10px"><b>+</b><b>−</b></div></div>`,phLive);}
 return desk('Fleet',`${kpis()}<div class="row2"><div class="card mapc">${mapSVG()}${legend}<div class="zoom"><b>+</b><b>−</b></div></div>
 <div class="card rail"><h3>${I('alert','color:var(--r)')}Needs attention<span class="c">See all 6</span></h3><div style="margin:-2px 0 6px">${FI('disarmed units not left out yet')}</div>${PROB.slice(0,6).map(p=>prow(p)).join('')}</div></div>`);
};
SC.problems=()=>{
 const chips=`<div class="chips"><span class="chip on">All <em>6</em></span><span class="chip">${I('cam','width:16px')}Cameras <em>3</em></span><span class="chip">${I('wifi','width:16px')}Routers <em>2</em></span><span class="chip">${I('bat','width:16px')}Power <em>1</em></span></div>`;
 const chipsP=chips.replace(/width:16px/g,'width:14px').replace(/class="chip/g,'style="padding:0 10px;font-size:12.5px" class="chip');
 if(phone)return ph('<h1>Problems</h1>',`${chipsP.replace('class="chips"','class="chips" style="gap:6px"')}<div class="card list">${PROB.map(p=>prow(p)).join('')}</div>`,phLive);
 return desk('Problems',`${chips}<div class="row2"><div class="card" style="flex:1;overflow:hidden"><table><tr><th></th><th>Unit</th><th>What's wrong</th><th>Area</th><th>Checked</th><th></th></tr>
 ${PROB.map((p,i)=>`<tr class="${i==0?'sel':''}"><td style="width:56px"><div class="sev ${p[0]}">${I(p[1])}</div></td><td><b>${p[2]}</b></td><td>${p[3]}</td><td>${p[4]}</td><td>${p[5]}</td><td class="chev">${I('chev')}</td></tr>`).join('')}</table></div>
 <div class="card mapc" style="flex:none;width:400px">${mapSVG('380 40 560 520')}${legend}</div></div>`);
};
function unitBody(){
 const cams=[['Camera 1 · North gate','g','Online'],['Camera 2 · Lot','r','Offline'],['Camera 3 · Entry','r','Offline'],['Camera 4 · Rear','g','Online']];
 const tiles=`<div class="grid3"><div class="card mini"><div class="l">${I('cam','width:16px;color:var(--r)')}Cameras</div><div class="x">2<span style="color:var(--tx3);font-size:16px"> / 4 up</span></div><div class="q">Checked 6:38 AM</div></div>
 <div class="card mini"><div class="l">${I('wifi','width:16px;color:var(--g)')}Router</div><div class="x" style="color:var(--g)">Online</div><div class="q">Checked 6:40 AM</div></div>
 <div class="card mini"><div class="l">${I('bat','width:16px;color:var(--g)')}Battery</div><div class="x">82%</div><div class="q">Checked 6:30 AM</div></div></div>`;
 const head=`<div style="display:flex;align-items:center;gap:14px"><div class="sev r" style="width:${phone?48:56}px;height:${phone?48:56}px;border-radius:16px">${I('unit','width:26px;height:26px')}</div><div><div class="big" style="font-size:${phone?24:30}px">Spotter 901</div><div class="tc" style="margin-top:3px">Sample Site A · Katy area</div></div>${phone?'':'<div style="flex:1"></div><span class="tag r" style="font-size:13px;padding:6px 12px">2 cameras offline</span>'}</div>`;
 const tags=`<div style="display:flex;gap:8px;flex-wrap:wrap">${phone?'<span class="tag r">2 cameras offline</span>':''}${late?'<span class="tag u">Field · as of 5:36 PM</span>':'<span class="tag b">Field</span>'}<span class="tag g" style="opacity:.6">Armed</span>${FI('Armed')}${phone?'':'<span class="tag u">Spotter</span>'}</div>`;
 const camlist=`<div class="card sec"><h3>${I('cam','width:18px')}Cameras</h3>${cams.map(c=>`<div class="kv"><span style="display:flex;gap:10px;align-items:center"><span class="dot ${c[1]}"></span>${c[0]}</span><b style="color:${c[1]=='g'?'var(--g)':'#ff8a98'}">${c[2]}</b></div>`).join('')}</div>`;
 const btns=`<div style="display:flex;gap:10px"><div class="btn p" style="flex:1">${I('tool')}Troubleshoot</div><div class="btn" style="flex:1">${I('nav')}Directions</div></div>`;
 return {head,tags,tiles,camlist,btns};
}
SC.unit=()=>{const u=unitBody();
 if(phone)return ph(`<span style="display:flex;align-items:center;gap:6px;color:var(--tx2);font-weight:600;font-size:15px">${I('back')}Units</span>`,
  `<div style="display:flex;flex-direction:column;gap:12px">${u.head}${u.tags}${u.tiles}${u.camlist}${u.btns}</div>`);
 const rows=[['Spotter 901','r','2 cameras offline'],['Spotter 908','g','All good'],['Ranger 902','r','Router not answering'],['Sniper 903','r','Camera offline'],['Helios 904','a','Battery low'],['Spotter 910','g','All good'],['Solar Spotter 911','g','All good'],['Sniper 912','u','Unknown · no recent check'],['Ranger 913','g','All good'],['Spotter 914','g','All good'],['Helios 915','g','All good']];
 return desk('Units',`<div class="row2"><div class="card" style="width:400px;flex:none;padding:14px;overflow:hidden"><div class="chips" style="margin-bottom:10px"><span class="chip on">All</span><span class="chip">Spotter</span><span class="chip">Sniper</span><span class="chip">Helios</span></div>
 ${rows.map((r,i)=>`<div class="prow" style="${i==0?'background:#1a2840':''};padding:9px 10px"><span class="dot ${r[1]}"></span><div><b>${r[0]}</b><small>${r[2]}</small></div><span class="t chev">${I('chev','width:16px')}</span></div>`).join('')}</div>
 <div style="flex:1;display:flex;flex-direction:column;gap:14px;min-width:0">${u.head}${u.tags}${u.tiles}<div style="display:flex;gap:14px;flex:1;min-height:0"><div style="flex:1;display:flex;flex-direction:column;gap:14px">${u.camlist}${u.btns}</div><div class="card mapc" style="flex:1">${mapSVG('430 110 480 330')}<div class="legend">Pin: mHelp address, not GPS</div></div></div></div></div>`,'');
};
SC.units=SC.unit;
const JOBS={todo:[['Sample Site C','Delivery · Spotter 920','Alex R.','8:00 AM'],['Sample Site D','Pickup · Ranger 921','Sam T.','9:30 AM'],['Sample Site E','Swap · Sniper 922','Unassigned','1:00 PM']],
 progress:[['Sample Site A','Service · Spotter 901','Chris D.','On site'],['Sample Site F','Delivery · Helios 923','Jordan P.','En route']],
 attention:[['Sample Site G','Go-back needed · Spotter 907','Alex R.','Overdue']],done:[['Sample Site H','Pickup · Spotter 924','Sam T.','6:10 AM'],['Sample Site J','Service · Ranger 925','Chris D.','6:25 AM']]};
const LN=[['attention','Needs attention','r'],['todo','To do','u'],['progress','In progress','b'],['done','Done','g']];
const job=j=>`<div class="card job"><b>${j[0]}</b><small>${j[1]}</small><div class="f"><div class="av" style="${j[2]=='Unassigned'?'background:#26344a':''}">${j[2]=='Unassigned'?'?':j[2].split(' ').map(x=>x[0]).join('')}</div>${j[2]}<span style="margin-left:auto">${j[3]}</span></div></div>`;
SC.boards=()=>{
 if(phone)return ph('<h1>Today</h1>',`<div>${RULE('job cards')}</div><div class="chips" style="gap:6px">${LN.map((l,i)=>`<span class="chip ${i==1?'on':''}" style="padding:0 11px;font-size:12.5px"><span class="dot ${l[2]}" style="width:8px;height:8px"></span>${l[1].replace('Needs attention','Attention').replace('In progress','Working')} <em>${JOBS[l[0]].length}</em></span>`).join('')}</div>
 ${JOBS.todo.map(job).join('')}`,`<span class="tc">Fri, Nov 20</span>`);
 return desk('Today’s board',`<div>${RULE('job cards: keep, change or drop?')}</div><div style="display:flex;gap:16px;flex:1;min-height:0">${LN.map(l=>`<div class="lane"><h4><span class="dot ${l[2]}" style="margin:0;padding:0"></span>${l[1]}<span>${JOBS[l[0]].length}</span></h4>${JOBS[l[0]].map(job).join('')}</div>`).join('')}</div>`,`<span class="chip on">Today</span><span class="chip">This week</span><div class="btn" style="height:42px">${I('tv')}Open on TV</div>`);
};
const TEAM=[['Alex R.','Service',['g','g','a'],3],['Sam T.','Service',['g','g','g'],2],['Chris D.','Service',['g','u','g'],2],['Jordan P.','Service',['a','u','u'],1],['Riley K.','IT',['g','u','g'],0],['Morgan L.','IT',['u','u','u'],0]];
const word={g:'Done',a:'Issue',u:'Not started'};
SC.team=()=>{
 if(phone)return ph('<h1>Team</h1>',`<div class="card list">${TEAM.map(t=>`<div class="prow"><div class="av">${t[0].split(' ').map(x=>x[0]).join('')}</div><div><b>${t[0]}</b><small>${t[1]} · ${t[3]} jobs today</small></div><div class="t" style="display:flex;gap:6px">${t[2].map((s,i)=>`<span title="" style="display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;color:var(--tx3)"><span class="dot ${s}"></span>${['Truck','Trailer','Stock'][i]}</span>`).join('')}</div></div>`).join('')}</div>
 <div class="tc" style="display:flex;gap:14px;justify-content:center"><span><span class="dot g" style="display:inline-block;width:8px;height:8px"></span> Done</span><span><span class="dot a" style="display:inline-block;width:8px;height:8px"></span> Issue</span><span><span class="dot u" style="display:inline-block;width:8px;height:8px"></span> Not started</span></div>`,`<span class="tc">Tech Checks today</span>`);
 return desk('Team',`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${TEAM.map(t=>`<div class="card sec"><div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:44px;height:44px;font-size:15px">${t[0].split(' ').map(x=>x[0]).join('')}</div><div><b style="font-size:16px">${t[0]}</b><div class="tc">${t[1]} · ${t[3]} jobs today</div></div></div>
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px">${t[2].map((s,i)=>`<div style="background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:10px"><div class="tc" style="font-size:11.5px">${['Truck check','Trailer','Stock'][i]}</div><div style="display:flex;align-items:center;gap:7px;margin-top:6px;font-weight:650;font-size:13.5px"><span class="dot ${s}"></span>${word[s]}</div></div>`).join('')}</div></div>`).join('')}</div>`);
};
const FEEDS=[['Camera checks','g','On time','6:40 AM'],['Router checks','g','On time','6:40 AM'],['mHelp unit list','a','Late · using 5:36 PM list','Reconnect'],['Tracker sheet','g','On time','6:30 AM'],['Battery (Victron)','g','On time','6:35 AM'],['Watchful arming','u','Not connected yet','Needs setup']];
SC.details=()=>{
 const feeds=`<div class="card sec"><h3>${I('refresh','width:18px')}Data feeds</h3>${FEEDS.map(f=>`<div class="kv"><span style="display:flex;gap:10px;align-items:center"><span class="dot ${f[1]}"></span><span><b>${f[0]}</b><br><span style="font-size:12.5px">${f[2]}</span></span></span>${f[3]=='Reconnect'?'<span class="btn w" style="height:34px;font-size:13px;padding:0 12px">Reconnect</span>':`<span class="tc">${f[3]}</span>`}</div>`).join('')}</div>`;
 const count=`<div class="card sec"><h3>${I('units','width:18px')}How the fleet adds up${late?'<span class="c" style="color:var(--a)">as of 5:36 PM</span>':''}</h3>${[['Field units','276'],['With cameras','196'],['Online · Offline · Unknown','186 · 5 · 5'],['No cameras (stands, power)','80'],['In shop','649'],['Do not use','60']].map(k=>`<div class="kv"><span>${k[0]}</span><b style="${late?'color:#8391a6':''}">${k[1]}</b></div>`).join('')}</div>`;
 const fix=`<div class="card sec"><h3>${I('tool','width:18px')}Office fix-it lists</h3>${[['Addresses to check in mHelp',12,'a'],['Units with no camera records',10,'a'],['Placement notes to confirm',1,'b'],['SIMs to cancel',2,'b']].map(k=>`<div class="kv"><span>${k[0]}</span><span style="display:flex;gap:8px;align-items:center"><span class="tag ${k[2]}">${k[1]}</span><span class="chev">${I('chev','width:16px')}</span></span></div>`).join('')}</div>`;
 if(phone)return ph('<h1>Details</h1>',`${feeds.replace(/<br><span style="font-size:12.5px">/g,'<br><span style="font-size:11.5px">')}${fix}`,`<span class="tag u">Office & IT</span>`);
 return desk('Details',`<div style="display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px;align-items:start">${feeds}${count}${fix}</div>`,`<span class="tag u" style="font-size:12.5px;padding:6px 12px">Office & IT only</span>`);
};
SC.more=()=>ph('<h1>More</h1>',`<div class="card list">${[['team','Team','Tech Checks and jobs today','team'],['tv','TV board','Show the board on a TV','boards'],['details','Details','Feeds, totals and fix-it lists','details']].map(r=>`<a class="prow" href="${shellHref(r[0])}"><div class="sev b">${I(r[3])}</div><div><b>${r[1]}</b><small>${r[2]}</small></div><span class="t chev">${I('chev')}</span></a>`).join('')}</div>`);
const ENDPOINT='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
function deny(){
  document.documentElement.dataset.shell='denied';
  document.body.innerHTML='<main style="min-height:100vh;display:grid;place-items:center;padding:32px;text-align:center"><div><h1 style="font-size:22px;font-weight:750">This view is for the office</h1><p style="color:var(--tx2);margin-top:8px">The fleet app opens for the owner and for IT.</p></div></main>';
}
function displayName(value){
  const parts=String(value||'').replace(/[^\p{L}\s.'-]/gu,'').trim().split(/\s+/).filter(Boolean).slice(0,3);
  if(!parts.length)return 'Owner';
  const last=parts.length>1?parts[parts.length-1].replace(/\./g,''):'';
  return (parts[0]+(last?' '+last[0].toUpperCase()+'.':'')).slice(0,24);
}
function initials(value){
  const parts=displayName(value).replace(/\./g,'').split(/\s+/).filter(Boolean).slice(0,2);
  return parts.map(part=>part[0]).join('').toUpperCase()||'JM';
}
function requestParentToken(){
  if(window.parent===window)return Promise.reject(new Error('denied'));
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('denied'));},10000);
    function receive(event){
      if(event.origin!==location.origin||event.source!==window.parent)return;
      const message=event.data;
      if(!message||message.type!=='COS_OPERATIONS_TOKEN_RESPONSE'||message.requestId!==requestId)return;
      cleanup();
      if(!['owner','it'].includes(message.role)||typeof message.accessToken!=='string'||!message.accessToken.trim()){reject(new Error('denied'));return;}
      resolve({token:message.accessToken,role:message.role});
    }
    function cleanup(){window.removeEventListener('message',receive);clearTimeout(timer);}
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'COS_OPERATIONS_TOKEN_REQUEST',requestId},location.origin);
  });
}
async function officeSession(){
  const parent=await requestParentToken();
  const response=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+parent.token,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/session',method:'GET',body:null}),cache:'no-store'});
  if(!response.ok)throw new Error('denied');
  const data=await response.json();
  if(!data||data.authorized!==true||(data.role!=='Owner'&&data.role!=='IT'))throw new Error('denied');
  return data;
}
function paint(){
  if(S==='boards'){location.replace('/#daily-board');return;}
  if(S==='tv'){location.replace('/?tvBoard=1#daily-board');return;}
  if(!['fleet','problems','units','unit','team','details','more'].includes(S))S='fleet';
  if(phone)document.documentElement.classList.add('phm');
  document.documentElement.dataset.shell='office';
  document.body.innerHTML=(SC[S]||SC.fleet)()+'<div class="mock">MOCKUP · SAMPLE DATA</div>';
}
officeSession().then(session=>{
  who={name:displayName(session.name),initials:initials(session.name),role:session.role==='IT'?'IT':'Owner'};
  paint();
}).catch(()=>deny());
