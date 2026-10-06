/* Read-only unit presentation. Infrastructure components never become camera rows. */
(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const statusLabel=value=>value==='verifying'?'NOT VERIFIED':String(value||'unknown').toUpperCase();
  function card(g,{effectiveHealth,cameraGroup,isShop}){
    const states=g.ds.map(effectiveHealth),online=states.filter(s=>s==='online').length,offline=states.filter(s=>s==='offline').length;
    const count=g.ds.filter(d=>!d.__trackerOnly).length;
    const summary=count?`${online} online · ${offline} offline · ${states.length-online-offline} to verify`:'Camera mapping not verified';
    const site=g.ds.every(isShop)?'SHOP / ROOT':g.ds[0]?.organization||'Site not linked';
    return '<button type="button" class="unitcard compact-unit '+esc(g.state)+'" data-unit="'+esc(g.k)+'" aria-label="Open '+esc(g.k)+' unit details">'+
      '<span class="compact-unit-top"><span class="compact-unit-title">'+esc(g.k)+'</span><span class="statuspill '+esc(g.state)+'">'+esc((cameraGroup(g.ds[0])==='Reconeyez'?'DETECTORS ':'')+statusLabel(g.state))+'</span></span>'+
      '<span class="compact-unit-site">'+esc(site)+'</span><span class="compact-unit-meta">'+esc(cameraGroup(g.ds[0]))+' · '+(count?count+' resource'+(count===1?'':'s'):'Tracker equipment')+'</span>'+
      '<span class="compact-unit-summary">'+esc(summary)+'</span><span class="compact-unit-open">View unit details <span aria-hidden="true">→</span></span></button>';
  }
  function details(g,{health,cameraGroup,effectiveHealth,reconBatteryBadge}){
    const ds=g.ds.filter(d=>!d.__trackerOnly);
    const components=g.ds.map(d=>{
      const state=effectiveHealth(d),provider=cameraGroup(d);
      if(d.__trackerOnly)return '<article class="unit-component"><h3>'+esc(d.device_name||g.k)+'</h3><p>'+esc(d.__reason)+'</p><p class="small">'+esc(d.public_ip?'Configured endpoint is available for this unit.':'No configured endpoint.')+'</p></article>';
      return '<article class="unit-component"><div class="unit-component-heading"><h3>'+esc(d.device_name||'Camera')+'</h3><span class="statuspill '+esc(state)+'">'+esc(statusLabel(state))+'</span></div><p class="small">'+esc(provider)+(provider==='Reconeyez'?' · DETECTOR · '+esc(reconBatteryBadge(d)):' · '+esc(d.device_type||'Camera resource'))+'</p>'+root.CameraHealthHistory.strip([d],health,cameraGroup)+'<a class="btn" href="./camera-detail.html?id='+encodeURIComponent(d.id)+'">Open resource & ports →</a></article>';
    }).join('');
    return '<section class="unit-components" aria-label="Camera and detector components">'+components+'</section>'+(ds.length?'<details class="unit-manage"><summary>Unit management</summary><button type="button" class="mini send-root-unit" data-unit="'+esc(g.k)+'">Move to ROOT / SHOP</button></details>':'');
  }
  function mappedArea(unit,devices){
    const own=devices.filter(d=>d.source==='reconeyez'&&String(d.unit_key||'').trim().toUpperCase()===unit);
    const areaOf=d=>{const metadata=d.source_metadata||{};const area=typeof metadata.area==='string'?metadata.area:null;const observed=metadata.reconeyez_area;return observed&&observed!==area?null:area};
    const areas=[...new Set(own.map(areaOf).filter(Boolean))];
    if(!own.length||areas.length!==1||own.some(d=>areaOf(d)!==areas[0]))return null;
    const area=areas[0],units=new Set(devices.filter(d=>d.source==='reconeyez'&&areaOf(d)===area).map(d=>String(d.unit_key||'').trim().toUpperCase()));
    return units.size===1&&units.has(unit)?area:null;
  }
  function componentType(value){const type=String(value||'').toLowerCase();return /^bridge(?:_|$)/.test(type)?'Bridge':/^siren(?:_|$)/.test(type)?'Siren':null}
  function eventStatus(value){
    const type=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(['yc','yt','tz','connectionlost','communicationfail','criticalbatteryshutdown','systemstopped'].includes(type))return 'offline';
    if(['xt','ta','batterylow','tamper','tamperalarm'].includes(type))return 'degraded';
    if(['yk','xr','rp','tw','deviceconnected','communicationrestore','batteryrestored','routinecheck','automatictest','systemstarted'].includes(type))return 'online';
    return 'unknown';
  }
  function component(rows,area,now=Date.now()){
    if(!rows.length)return null;
    const time=row=>root.CameraHealthHistory.timestamp(row.observed_at,now);
    const invalid=rows.some(row=>!time(row).at);
    const copy=[...rows].sort((a,b)=>{const ta=time(a).at,tb=time(b).at;if(!ta&&!tb)return Number(b.id)-Number(a.id);if(!ta)return -1;if(!tb)return 1;return Date.parse(tb)-Date.parse(ta)||Number(b.id)-Number(a.id)});
    const latest=copy[0],type=componentType(latest.component_type);
    // A later move, contradictory identity, or unrecognized type must never retain the old mapping.
    if(!type||latest.component_area!==area||!latest.external_device_id||latest.component_guid!==latest.external_device_id)return null;
    const stamp=root.CameraHealthHistory.timestamp(latest.observed_at,now);
    const conflicting=copy.some(row=>row.observed_at===latest.observed_at&&(row.component_area!==area||row.component_guid!==latest.external_device_id||row.component_type!==latest.component_type||eventStatus(row.event_type||row.event_code)!==eventStatus(latest.event_type||latest.event_code)));
    const reported=conflicting||invalid?'unknown':eventStatus(latest.event_type||latest.event_code);
    const rawBattery=latest.battery_percent;
    const numeric=rawBattery===null||rawBattery===undefined||String(rawBattery).trim()===''?NaN:Number(rawBattery);
    const battery=Number.isFinite(numeric)&&numeric>=0&&numeric<=100?numeric:null;
    return {id:latest.external_device_id,type,name:latest.component_name||type,area,at:stamp.at,freshness:stamp.state,reported,state:stamp.state==='fresh'?reported:'unknown',battery,event:latest.event_type||latest.event_code||'Unknown event',signal:latest.signal_strength_dbm,history:copy.slice(0,12)};
  }
  function componentHtml(value){
    const time=value.at?root.CameraHealthHistory.format(value.at):'Unknown (invalid timestamp)';
    const label=value.freshness==='fresh'?statusLabel(value.state):'NOT VERIFIED';
    const battery=value.battery==null?'Not reported':Math.round(value.battery)+'%'+(value.battery<=10?' · Critical':value.battery<=25?' · Low':'');
    const events=value.history.map(row=>'<li>'+esc(root.CameraHealthHistory.format(row.observed_at))+' · '+esc(row.event_type||row.event_code||'Unknown event')+' · '+esc(eventStatus(row.event_type||row.event_code).toUpperCase())+'</li>').join('');
    return '<article class="component-observation" data-component-id="'+esc(value.id)+'"><div class="unit-component-heading"><h3>'+esc(value.name)+' · '+value.type+'</h3><span class="statuspill '+esc(value.state)+'">'+esc(label)+'</span></div><p>Last reported status: <b>'+esc(value.reported.toUpperCase())+'</b> · '+esc(value.event)+'</p><p>Observed: '+esc(time)+(value.freshness==='stale'?' · Saved observation is older than 15 minutes; current health is not verified.':'')+'</p><p class="'+(value.battery!=null&&value.battery<=25?'yellow':'small')+'">Battery: '+esc(battery)+' · Recorded with this observation</p><p class="small">Device ID: '+esc(value.id)+' · Exact provider area: '+esc(value.area)+'</p><details><summary>Recent '+value.type.toLowerCase()+' events</summary><ul>'+events+'</ul></details></article>';
  }
  root.CameraHealthOverview={card,details,statusLabel,mappedArea,componentType,eventStatus,component,componentHtml};
})(globalThis);
