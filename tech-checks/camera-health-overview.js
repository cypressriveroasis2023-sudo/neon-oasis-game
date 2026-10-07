/* Read-only unit presentation. Infrastructure components never become camera rows. */
(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const statusLabel=value=>({verifying:'NOT VERIFIED',mapping:'STATUS UNVERIFIED',service:'SERVICE REACHABLE',placement:'LOCATION REVIEW',shop:'SHOP / ROOT',inactive:'INACTIVE'})[value]||String(value||'unknown').toUpperCase();
  const normalized=value=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toUpperCase():'';
  function placement(device,tracker=[]){
    const activation=normalized(device.activation_state),org=normalized(device.organization),unit=normalized(device.unit_key);
    if(/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(unit)||/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(org)||['RETIRED','STOLEN','NOT IN USE'].includes(org)||/^RII?[-\s]*\d+\s*-?\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit))return 'inactive';
    if(['ROOT','SHOP','SHOP EQUIPMENT'].includes(org)||unit==='SHOP EQUIPMENT'||/^RII?[-\s]*\d+\s*-?\s*SHOP$/.test(unit))return 'shop';
    if(activation==='DEACTIVATED')return 'inactive';
    if(activation!=='ACTIVE')return 'unknown';
    if(device.activation_source==='owner_location_override_v2'&&org)return 'field';
    // Only an exact stored unit label may supply placement evidence. No fuzzy joins.
    const matches=tracker.filter(t=>normalized(t.source_label)===unit);
    if(matches.length>1||matches.some(t=>['shop','retired'].includes(t.tracker_state)))return 'unknown';
    if(device.__trackerOnly||!org||['TRACKER FIELD','TRACKER · SITE NOT LINKED','UNKNOWN','FIELD OR UNKNOWN'].includes(org))return 'unknown';
    return 'field';
  }
  function cameraRecord(device){return !device.__trackerOnly&&['ipc','camera','detector','reconeyez detector'].includes(String(device.device_type||'').trim().toLowerCase());}
  function cameraState(device,now=Date.now()){
    if(device.__trackerOnly)return 'mapping';
    if(normalized(device.activation_state)!=='ACTIVE'||!cameraRecord(device)||!['vigilant_control_center','reconeyez'].includes(device.source))return 'verifying';
    const value=root.CameraHealthHistory.timestamp(device.source_last_seen_at,now);
    return value.state==='fresh'&&['online','offline'].includes(device.source_status)?device.source_status:'verifying';
  }
  function recorderFailure(d,now=Date.now()){return normalized(d.activation_state)==='ACTIVE'&&normalized(d.device_type)==='NVR'&&['vigilant_control_center','reconeyez'].includes(d.source)&&d.source_status==='offline'&&root.CameraHealthHistory.timestamp(d.source_last_seen_at,now).state==='fresh'}
  function validateSources(devices,health,tracker){
    const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
    const id=value=>(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)||(typeof value==='string'&&/^[1-9]\d*$/.test(value));
    if(![devices,health,tracker].every(Array.isArray))throw new Error('Camera sources are unavailable.');
    const seen=new Set(),checked=new Set();
    for(const d of devices){if(!object(d)||!id(d.id)||seen.has(String(d.id))||['unit_key','device_name','organization','source','source_status','source_last_seen_at','activation_state','device_type'].some(k=>d[k]!=null&&typeof d[k]!=='string'))throw new Error('Camera inventory contains malformed or duplicate identities.');seen.add(String(d.id))}
    for(const h of health){if(!object(h)||!id(h.camera_device_id)||!seen.has(String(h.camera_device_id))||checked.has(String(h.camera_device_id)))throw new Error('Camera health contains malformed or duplicate identities.');checked.add(String(h.camera_device_id))}
    for(const t of tracker)if(!object(t)||['canonical_family','unit_tag','source_label','tracker_state'].some(k=>typeof t[k]!=='string'))throw new Error('Tracker placement records are malformed.');
  }
  function providerRecord(d){return !d.__trackerOnly&&['vigilant_control_center','reconeyez'].includes(d.source)&&(cameraRecord(d)||normalized(d.device_type)==='NVR')}
  function providerState(d,now=Date.now()){
    if(normalized(d.activation_state)!=='ACTIVE'||!providerRecord(d))return 'verifying';
    return root.CameraHealthHistory.timestamp(d.source_last_seen_at,now).state==='fresh'&&['online','offline'].includes(d.source_status)?d.source_status:'verifying';
  }
  function serviceState(d,health={},now=Date.now()){
    if(normalized(d.activation_state)!=='ACTIVE')return 'verifying';
    const h=d.__trackerOnly&&d.__providerLabel==='Witness'?d.__evidence:root.CameraHealthHistory.connectionSnapshot(health[d.id]||{},d);
    if(!h||root.CameraHealthHistory.timestamp(h.checked_at,now).state!=='fresh')return 'verifying';
    const state=d.__trackerOnly?h.status:h.overall_status;
    if(state==='online'&&(d.__trackerOnly?h.reachable===true:h.ip_reachable===true))return 'online';
    if(state==='offline'&&(h.confirmed_outage===true||Number.isInteger(h.consecutive_failures)&&h.consecutive_failures>=3))return 'offline';
    return state==='degraded'&&h.ip_reachable===true?'degraded':'verifying';
  }
  function combinedState(states,empty='verifying'){
    if(!states.length)return empty;
    return states.every(s=>s==='online')?'online':states.every(s=>s==='offline')?'offline':states.some(s=>['online','offline','degraded'].includes(s))?'degraded':'verifying';
  }
  function classifyUnit(ds,tracker=[],now=Date.now(),health={}){
    const active=ds.filter(d=>placement(d,tracker)!=='inactive');
    if(!active.length)return {scope:'inactive',state:'inactive'};
    const scopes=new Set(active.map(d=>placement(d,tracker))),scope=scopes.size===1?[...scopes][0]:'unknown';
    if(scope==='shop')return {scope,state:'shop'};
    const cameras=active.filter(cameraRecord),providers=active.filter(providerRecord);
    const camera=combinedState(cameras.map(d=>cameraState(d,now)),'mapping');
    const provider=combinedState(providers.map(d=>providerState(d,now)));
    const service=combinedState(active.map(d=>serviceState(d,health,now)));
    const state=provider!=='verifying'?provider:service==='online'?'service':providers.length?'verifying':'mapping';
    const systemKind=providers.length&&providers.every(d=>normalized(d.device_type)==='NVR')?'recorder':providers.length&&providers.every(d=>normalized(d.device_type).includes('DETECTOR'))?'detector':'system';
    return {scope,state,providerState:provider,cameraState:camera,serviceState:service,systemKind,recorderOffline:active.some(d=>recorderFailure(d,now))};
  }
  function coverage(groups){
    const active=groups.filter(g=>['field','unknown'].includes(g.scope));
    const count=(key,state)=>active.filter(g=>g[key]===state).length;
    const online=count('providerState','online'),offline=count('providerState','offline');
    return {total:active.length,online,offline,review:active.length-online-offline,degraded:count('providerState','degraded'),serviceReachable:active.filter(g=>g.providerState==='verifying'&&g.serviceState==='online').length,cameraOnline:count('cameraState','online'),cameraOffline:count('cameraState','offline'),cameraMixed:active.filter(g=>['degraded','verifying'].includes(g.cameraState)).length,cameraUnavailable:count('cameraState','mapping')};
  }
  function card(g,{effectiveHealth,cameraGroup,isShop,canManage=false,canEditConnection=false,health={},movePending=false,moveMessage=''}){
    const active=g.ds.filter(d=>placement(d)!=='inactive'),cameras=active.filter(cameraRecord),states=cameras.map(effectiveHealth);
    const online=states.filter(s=>s==='online').length,offline=states.filter(s=>s==='offline').length,count=cameras.length;
    const sources=[...new Set(active.map(cameraGroup))].join(' / ')||cameraGroup(g.ds[0]);
    const cameraSummary=count?`${online} online · ${offline} offline · ${states.length-online-offline} to verify`:'Camera channel status unavailable';
    const providerSummary=g.systemKind==='recorder'?'Recorder '+(g.providerState==='verifying'?'status unverified':g.providerState)+'; camera channel status unavailable':g.providerState==='degraded'?'Mixed provider status; review the individual camera/recorder observations':g.state==='service'?'Service endpoint reachable; provider and camera status unverified':g.serviceState==='offline'&&g.providerState==='verifying'?'Service check failed; camera status remains unverified':'';
    const site=g.scope==='inactive'?'Inactive inventory':g.scope==='shop'?'SHOP / ROOT':g.scope==='unknown'?'Location unverified · saved site: '+(active[0]?.organization||'not linked'):active[0]?.organization||'Site not linked';
    const direct=g.ds.some(d=>['Sniper','CAM V'].includes(cameraGroup(d)))&&['field','unknown'].includes(g.scope)&&g.providerState==='verifying';
    const displayState=direct?g.serviceState:g.state;
    const primary=direct?'IP / PORT '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED',verifying:'UNVERIFIED'}[g.serviceState]||'UNVERIFIED'):(g.systemKind==='recorder'?'RECORDER ':g.systemKind==='detector'?'DETECTOR ':'')+statusLabel(g.state);
    const frontAction=canManage&&['field','unknown'].includes(g.scope)&&g.ds.some(d=>!d.__trackerOnly)?'<button type="button" class="mini send-root-unit front-shop-action" data-unit="'+esc(g.k)+'" '+(movePending?'disabled':'')+'>Move to ROOT / SHOP</button><span class="unit-move-status" role="status">'+esc(moveMessage)+'</span>':'';
    const real=g.ds.filter(d=>!d.__trackerOnly),destinations=new Map();
    for(const d of real){
      if(cameraGroup(d)==='Reconeyez'){destinations.set('https://na.reconeyez.com',{url:'https://na.reconeyez.com',label:'Open Reconeyez cameras'});continue;}
      for(const link of root.CameraHealthHistory.connections(d,{},d.public_ip).filter(link=>link.url))destinations.set(link.url,{url:link.url,label:link.port===null?'Open public IP (HTTP default) · '+link.address:'Open '+link.address});
    }
    const access=[...destinations.values()].map(link=>'<a class="mini" target="_blank" rel="noopener noreferrer" href="'+esc(link.url)+'">'+esc(link.label)+' ↗</a>').join('');
    const edits=canEditConnection?real.filter(d=>cameraGroup(d)!=='Reconeyez').map(d=>'<a class="mini" href="./camera-detail.html?id='+encodeURIComponent(d.id)+'&action=edit-ip">Edit IP · '+esc(d.device_name||g.k)+'</a>').join(''):'';
    const quick='<div class="unit-card-quick-actions" aria-label="'+esc(g.k)+' quick actions">'+access+'<button type="button" class="mini unit-troubleshoot" data-unit="'+esc(g.k)+'">Troubleshoot</button><a class="mini unit-field-map-link" href="./?fieldUnit='+encodeURIComponent(g.k)+'">Field View →</a>'+(canManage&&real.length&&g.scope==='field'?'<button type="button" class="mini move-field-unit" data-unit="'+esc(g.k)+'">Edit field information</button>':'')+edits+'</div>';
    return '<article class="unitcard compact-unit '+esc(displayState)+'" data-unit="'+esc(g.k)+'"><button type="button" class="unit-card-open" aria-label="Open '+esc(g.k)+' unit details">'+
      '<span class="compact-unit-top"><span class="compact-unit-title">'+esc(g.k)+'</span><span class="statuspill '+esc(displayState)+'">'+esc(primary)+'</span></span>'+
      (g.scope==='unknown'?'<span class="placement-warning">LOCATION REVIEW · Field or shop not verified</span>':'')+
      '<span class="compact-unit-site">'+esc(site)+'</span><span class="compact-unit-meta">'+esc(sources)+' · '+esc(g.systemKind==='recorder'?'Provider recorder observation':count?count+' camera/detector resource'+(count===1?'':'s'):g.state==='service'?'Service-port observation':'Provider status not verified')+'</span>'+
      '<span class="compact-unit-summary">'+(providerSummary?'<span class="system-evidence-summary">'+esc(providerSummary)+'</span>':'')+'<span class="camera-evidence-badge">'+esc(g.state==='shop'?'Active shop inventory; excluded from operational outage totals':g.state==='inactive'?'Deactivated or retired; excluded from operational outage totals':cameraSummary)+'</span><span class="compact-unit-open">View unit details <span aria-hidden="true">→</span></span></span></button>'+root.CameraHealthHistory.strip(real,health,cameraGroup)+quick+frontAction+(canManage&&['shop','inactive'].includes(g.scope)&&g.ds.some(d=>!d.__trackerOnly)?'<button type="button" class="mini move-field-unit" data-unit="'+esc(g.k)+'">Move to Field</button>':'')+'</article>';
  }
  function details(g,{health,cameraGroup,effectiveHealth,reconBatteryBadge,canManage=false}){
    const ds=g.ds.filter(d=>!d.__trackerOnly);
    const components=g.ds.map(d=>{
      const recorder=normalized(d.device_type)==='NVR',state=recorder?providerState(d):effectiveHealth(d),provider=cameraGroup(d),service=serviceState(d,health);
      if(d.__trackerOnly){const observation=d.__evidence;return '<article class="unit-component"><h3>'+esc(d.device_name||g.k)+'</h3><p>'+esc(d.__reason)+' Camera health and physical location are not verified.</p><p class="small">Service evidence: '+esc(service==='online'?'Reachable':service==='offline'?'Check failed':'Unverified')+(observation?.checked_at?' · '+esc(root.CameraHealthHistory.format(observation.checked_at)):'')+'</p></article>'}
      const diagnostic=recorder?'<p>Camera channel status unavailable. Last reported recorder status: <b>'+esc(String(d.source_status||'unknown').toUpperCase())+'</b> · '+esc(root.CameraHealthHistory.format(d.source_last_seen_at))+(root.CameraHealthHistory.timestamp(d.source_last_seen_at).state==='fresh'?' · Current provider observation':' · Stale or invalid observation; current recorder status unverified')+'</p>':!providerRecord(d)?'<p>Service-port evidence: '+esc(service==='online'?'Reachable':service==='offline'?'Check failed':'Unverified')+'. Provider and camera status are unverified.</p>':'';
      return '<article class="unit-component"><div class="unit-component-heading"><h3>'+esc(d.device_name||'Camera')+'</h3><span class="statuspill '+esc(state)+'">'+esc((recorder?'RECORDER ':'')+statusLabel(state))+'</span></div><p class="small">'+esc(provider)+(provider==='Reconeyez'?' · DETECTOR · '+esc(reconBatteryBadge(d)):' · '+esc(d.device_type||'Camera resource'))+'</p>'+(provider==='Reconeyez'?'<p class="small">'+esc(root.ReconBattery.text(d.source_metadata))+'</p>':'')+diagnostic+root.CameraHealthHistory.strip([d],health,cameraGroup)+'<a class="btn" href="./camera-detail.html?id='+encodeURIComponent(d.id)+'">'+(provider==='Reconeyez'?'Open Recon details & history':'Open resource & ports')+' →</a></article>';
    }).join('');
    return '<section class="unit-components" aria-label="Camera and detector components">'+components+'</section>'+(ds.length&&canManage?'<details class="unit-manage"><summary>Unit management</summary><button type="button" class="mini '+(['shop','inactive'].includes(g.scope)?'move-field-unit':'send-root-unit')+'" data-unit="'+esc(g.k)+'">'+(['shop','inactive'].includes(g.scope)?'Move to Field':'Move to ROOT / SHOP')+'</button>'+(!['shop','inactive'].includes(g.scope)?'<button type="button" class="mini move-field-unit" data-unit="'+esc(g.k)+'">Edit field address</button>':'')+'</details>':'');
  }
  function mappedArea(unit,devices){
    const own=devices.filter(d=>d.source==='reconeyez'&&String(d.unit_key||'').trim().toUpperCase()===unit);
    const areaOf=d=>{const metadata=d.source_metadata||{};const area=typeof metadata.area==='string'?metadata.area:null;const observed=metadata.reconeyez_area;return observed&&observed!==area?null:area};
    const areas=[...new Set(own.map(areaOf).filter(Boolean))];
    if(!own.length||areas.length!==1||own.some(d=>areaOf(d)!==areas[0]))return null;
    const area=areas[0],units=new Set(devices.filter(d=>d.source==='reconeyez'&&(d.source_metadata?.area===area||d.source_metadata?.reconeyez_area===area)).map(d=>String(d.unit_key||'').trim().toUpperCase()));
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
    return '<article class="component-observation" data-component-id="'+esc(value.id)+'"><div class="unit-component-heading"><h3>'+esc(value.name)+' · '+value.type+'</h3><span class="statuspill '+esc(value.state)+'">'+esc(label)+'</span></div><p>Last reported status: <b>'+esc(value.reported.toUpperCase())+'</b> · '+esc(value.event)+'</p><p>Observed: '+esc(time)+(value.freshness==='stale'?' · Saved observation is older than 20 minutes; current health is not verified.':'')+'</p><p class="'+(value.battery!=null&&value.battery<=25?'yellow':'small')+'">Battery: '+esc(battery)+' · Recorded with this observation</p><p class="small">Device ID: '+esc(value.id)+' · Exact provider area: '+esc(value.area)+'</p><details><summary>Recent '+value.type.toLowerCase()+' events</summary><ul>'+events+'</ul></details></article>';
  }
  root.CameraHealthOverview={card,details,statusLabel,placement,cameraRecord,cameraState,providerRecord,providerState,serviceState,coverage,classifyUnit,validateSources,mappedArea,componentType,eventStatus,component,componentHtml};
})(globalThis);
