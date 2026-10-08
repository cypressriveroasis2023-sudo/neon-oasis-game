/* Saved, source-bound diagnostics only. Exports deliberately allowlisted text. */
(function(root){
  'use strict';
  const history=()=>root.CameraHealthHistory;
  const validPort=value=>/^[1-9]\d{0,4}$/.test(String(value))&&Number(value)<=65535;
  function ports(device={},health={}){
    const observed=health.port_status&&typeof health.port_status==='object'&&!Array.isArray(health.port_status)?Object.keys(health.port_status):[];
    return [...new Set([...(Array.isArray(device.expected_ports)?device.expected_ports:[]),...observed].filter(validPort).map(Number))].sort((a,b)=>a-b);
  }
  function portResult(device,health,key,now=Date.now()){
    if(!validPort(key))return {state:'unchecked',label:'Not checked',at:null,latencyMs:null};
    const result=history().port(health,key,now,device);
    if(result.state!=='failed')return result;
    // Never export raw errors: they can contain credentials, URLs or provider payloads.
    const error=String(history().connectionSnapshot(health,device).port_status?.[key]?.error||'');
    const label=/refused|ECONNREFUSED/i.test(error)?'Connection refused':/timeout|timed?\s*out|ETIMEDOUT/i.test(error)?'Timed out':'Failed (cause unverified)';
    return {...result,label};
  }
  function direct(device={},health={},now=Date.now()){
    const bound=history().connectionSnapshot(health,device),stamp=history().timestamp(bound.checked_at,now);
    const results=ports(device,health).map(key=>portResult(device,health,key,now));
    const responding=results.some(value=>value.state==='responding'),failed=results.some(value=>value.state==='failed');
    return {fresh:stamp.state==='fresh'&&(responding||failed),checked_at:stamp.at,
      state:responding?'responding':failed?'failed':stamp.state==='stale'?'stale / not verified':results.some(value=>value.state==='unverified')?'not verified':'not checked'};
  }
  function safeText(value,fallback='Not recorded') {
  return String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ')
    .replace(/<[^>]*>/g,'')
    .replace(/(?:\b[a-z][a-z0-9+.-]*:\/\/|\/\/|\bwww\.|\b(?:data|javascript):)\S+/gi,'[link omitted]')
    .replace(/\bBearer\s+\S+/gi,'[credential omitted]')
    .replace(/\b(?:password|passwd|pass|secret|token|api[_ -]?key|authorization|credentials?|username|user|login)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&},]+)/gi,'[credential omitted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[credential omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[contact omitted]')
    .replace(/\b\d{10,15}\b/g,'[contact omitted]')
    .replace(/(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\b\d{3}[ .-]?)\d{3}[ .-]?\d{4}\b/g,'[contact omitted]')
    .replace(/\s+/g,' ').trim().slice(0,180)||fallback;
}
  function timestamp(value,now){const result=history().timestamp(value,now);return result.at?result.at+(result.state==='stale'?' (historical / stale)':''):result.state==='invalid'?'Unknown (invalid timestamp)':'Never recorded';}
  function report(unit,devices,health={},now=Date.now(),options={}){
    const lines=['COS unit diagnostic report','Unit: '+safeText(unit),'Generated: '+new Date(now).toISOString(),'Saved observations only. Generating this report does not run a check.','Service connectivity does not verify individual camera video or recording.',''];
    if(options.unavailable)lines.push('The latest diagnostic refresh did not complete. Current results are UNKNOWN / REVIEW; recorded times below are historical evidence.','');
    if(!devices.length)lines.push('No linked camera records. Mapping review required; no camera outage established.');
    for(const device of devices){
      const current=health[device.id]||{},bound=history().connectionSnapshot(current,device),result=direct(device,current,now);
      const provider=device.source==='reconeyez'?'Reconeyez':device.source==='vigilant_control_center'?'Star4Live':null;
      const providerStatus=!options.unavailable&&!(options.unavailableProviders||[]).includes(provider)&&['online','offline'].includes(root.CameraHealthOverview?.providerState(device,now))?root.CameraHealthOverview.providerState(device,now).toUpperCase():'UNKNOWN / REVIEW';
      const endpoint=history().connections(device,{},device.public_ip)[0]?.address;
      lines.push('Device: '+safeText(device.device_name||device.unit_key), 'Record: '+safeText(device.id), 'Source: '+(provider?provider+' provider; direct service-port evidence separate':'Direct service-port check'));
      if(provider){lines.push('Last provider observation: '+timestamp(device.source_last_seen_at,now),'Current provider result: '+providerStatus,'Historical provider success: '+timestamp(device.last_online_at,now));if(provider==='Reconeyez')lines.push('Inventory sync is not detector health. A live detector health event is required.');}
      lines.push('Saved endpoint: '+(endpoint||'Missing / invalid; mapping review required'),'Last bound direct attempt: '+timestamp(bound.checked_at,now),(provider?'Legacy success timestamp (direct provenance unverified): ':'Historical direct success: ')+timestamp(device.last_probe_online_at,now)+' (may predate connection changes)','Current bound direct result: '+(options.unavailable?'UNKNOWN / REVIEW':result.state.toUpperCase()));
      const keys=ports(device,current);
      for(const key of keys){const value=portResult(device,current,key,now);lines.push('Port '+key+': '+(options.unavailable?'Unverified after incomplete refresh':value.label)+(value.at?' · '+value.at:'')+(value.latencyMs!==null?' · '+value.latencyMs+' ms':''));}
      if(!keys.length)lines.push('Ports: No configured or recorded numeric ports');
      const next=options.unavailable?'The diagnostic refresh did not complete. Review source access and run the supported Verify action again before relying on current status.':device.__trackerOnly||!endpoint&&!provider?'Review the device mapping and saved endpoint before verification.':provider&&providerStatus==='UNKNOWN / REVIEW'?'Review provider mapping, authentication and last live observation; do not classify an outage from inventory refresh.':result.state==='responding'?'Service responds. Confirm camera video and recording in the authorized viewer before dispatch.':result.fresh?'Review the recorded port categories, endpoint and network service. Verify again using the existing supported action; failed ports alone do not establish a camera outage.':'Run the existing Verify action for this device and review the timestamp. Stale or missing evidence does not establish an outage.';
      lines.push('Suggested next step: '+next,'');
    }
    lines.push('Review before pasting into COS ticket notes or mHelpDesk. No ticket has been created or sent.');
    return lines.join('\n');
  }
  function filename(unit){return 'cos-diagnostic-'+safeText(unit,'unit').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60)+'.txt';}
  root.CameraDiagnosticReport={ports,portResult,direct,safeText,report,filename};
})(globalThis);
