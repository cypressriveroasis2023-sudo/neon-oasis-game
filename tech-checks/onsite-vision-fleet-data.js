/* Source-verified Fleet Intelligence for the existing Owner Vision workspace.
 * Camera questions use the authenticated COS read path even if OpenAI AI
 * conversations are disabled. This module never probes or changes equipment.
 */
(function (root) {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const stamp = value => {
    const date = typeof value === 'string' ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    }).format(date);
  };
  const unitPattern = /\b(?:Solar\s+Spotter|Spotter|Sniper(?:\s+[24])?|CAM\s*V|Helios|Ranger|Recon(?:\s+(?:II|2))?)\s*[-#]?\s*\d{1,6}(?:[A-Za-z0-9.]*)\b/i;
  function queryFromText(raw) {
    const text = String(raw || '').trim();
    const offline = /\b(offline|outages?|down|not\s+working|disconnected)\b/i.test(text);
    const online = /\b(online|working|up|responding)\b/i.test(text);
    const attention = /\b(attention|issues?|problems?|unverified|urgent|troubleshoot|broken)\b/i.test(text);
    const location = /\b(where|locations?|located|addresses?|customers?|sites?)\b/i.test(text);
    const match = text.match(unitPattern);
    let scope = 'summary';
    if (offline && !online) scope = 'offline';
    else if (online && !offline) scope = 'online';
    else if (attention) scope = 'attention';
    else if (match) scope = 'unit';
    else if (location) scope = 'location';
    else if (/\b(history|historical|since|duration)\b/i.test(text)) scope = 'history';
    let location_query = '';
    const area = text.match(/\b(?:in|at|near|around)\s+([A-Za-z0-9][^?.,!]{1,70})/i);
    if (area) {
      location_query = area[1]
        .replace(/^(the|a|an)\s+/i,'')
        .replace(/\s+(?:right now|at the moment|that|which|with|are|is|has|have|today|currently|online|offline|down)\b[\s\S]*$/i,'')
        .replace(/\s+(?:site|location|area)\s*$/i,'')
        .trim();
      if (/^(?:shop|field|root|my|this|that|all|every|their)$/i.test(location_query)) location_query = '';
    }
    return {
      scope,
      unit_reference: match ? match[0].replace(/\s+/g,' ').trim() : '',
      location_query,
      limit: 60,
    };
  }
  function assertCounts(data, label) {
    if (!data || typeof data !== 'object') throw new Error(label + ' counts unavailable.');
    for (const key of ['total','online','offline','unverified']) {
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error(label + ' counts inconsistent.');
    }
    if (data.total !== data.online + data.offline + data.unverified)
      throw new Error(label + ' counts inconsistent.');
  }
  function statGroup(label, data) {
    assertCounts(data,label);
    return '<div class="vision-context-block"><h3>' + escape(label) + '</h3>' +
      '<div class="vision-context-grid">' +
      [['Total',data.total],['Online',data.online],['Offline',data.offline],['Unverified',data.unverified]]
        .map(([name,count])=>'<div><span>'+escape(name)+'</span><b>'+escape(count)+'</b></div>').join('') +
      '</div></div>';
  }
  function observedSpan(row) {
    const minutes=row.outage_observation_span_minutes;
    if (!Number.isSafeInteger(minutes) || minutes<0)
      return 'Continuous offline duration: not verified (historical source transition missing).';
    const duration=minutes>=1440 ? (Math.floor(minutes/1440)+' days, '+Math.floor(minutes%1440/60)+' hr') :
      minutes>=60 ? Math.floor(minutes/60)+' hr '+minutes%60+' min' : minutes+' min';
    return 'Recorded OFFLINE observations span '+duration+
      ' (from '+stamp(row.outage_observed_since)+'; not proof of uninterrupted downtime).';
  }
  function entry(row) {
    const status=['online','offline','unverified'].includes(row.status)?row.status:'unverified';
    const where=row.location&&typeof row.location==='object'
      ?[row.location.customer,row.location.site,row.location.address].filter(Boolean).map(escape).join(' · ')
      :'Field customer/site/address not verified';
    const direct=row.kind==='IP/port connection (not camera-video verification)';
    const note=status==='offline' ? observedSpan(row) : '';
    const onlineTime=row.last_online_at?'Last source-reported ONLINE: '+stamp(row.last_online_at):'Last source-reported ONLINE: not recorded';
    const unit=String(row.unit||'').trim();
    const link=unit&&unit!=='Unit identity unavailable'
      ?' <a href="./camera-health.html?q='+encodeURIComponent(unit)+'">Camera Health ↗</a>' : '';
    return '<div class="vision-context-row" style="display:block">' +
      '<b>'+escape(unit||row.name||'Unnamed resource')+' · '+escape(status.toUpperCase())+'</b>' +
      '<span>'+escape(row.kind||'camera')+' · '+escape(row.provider||'Source not confirmed')+'</span>' +
      '<small style="display:block">'+where+'</small>' +
      '<small style="display:block">Observed: '+escape(stamp(row.observed_at))+
        ' · '+escape(onlineTime)+'</small>' +
      (note?'<small style="display:block">'+escape(note)+'</small>':'') +
      (direct?'<small style="display:block">IP/port response is not a video test.</small>':'') +
      link+'</div>';
  }
  function render(fleet, question) {
    if (!fleet || typeof fleet !== 'object' || !Array.isArray(fleet.items) ||
      !Array.isArray(fleet.service_items) || !fleet.health_refreshed_at)
      throw new Error('Camera Health returned an incomplete read.');
    const cameras=fleet.monitored_cameras,detectors=fleet.monitored_detectors,
      recorders=fleet.monitored_recorders,services=fleet.service_port_checks;
    for(const [label,counts] of [['Camera',cameras],['Detector',detectors],['Recorder',recorders],['IP/port',services]])assertCounts(counts,label);
    const header=question.scope==='offline'?'Camera records reporting OFFLINE':
      question.scope==='online'?'Camera records reporting ONLINE':
      question.scope==='attention'?'Camera records needing attention':
      question.scope==='unit'?'Camera Health by unit':
      question.scope==='location'?'Camera Health by location':'Camera Fleet Health';
    const source='<div class="vision-system-note">COS Operations saved Camera Health v3 · Snapshot '+escape(stamp(fleet.health_refreshed_at))+
      ' Central. Camera, detector, recorder and service-port counts are separate; they do not establish every physical video channel.</div>';
    const groups=statGroup('Provider camera records',cameras)+statGroup('Reconeyez detector records',detectors)+
      statGroup('NVR recorder records',recorders)+statGroup('IP/port service checks — not video proof',services);
    const filter=question.location_query||question.unit_reference
      ?'<div class="vision-system-note">Filter: '+escape([question.unit_reference,question.location_query].filter(Boolean).join(' · '))+'</div>':'';
    const listed=fleet.items.concat(fleet.service_items);
    const title='<div class="vision-context-block"><h3>Matching saved records</h3>'+
      (fleet.items_truncated?'<p>More provider records exist than are shown. Narrow the request by unit or customer/site.</p>':'')+
      (!listed.length?'<p>No matching verified source records in this request. This is not proof that every camera is working.</p>':'')+
      '<div class="vision-context-list">'+listed.map(entry).join('')+'</div></div>';
    const locationWarning=fleet.location_data&&fleet.location_data.startsWith('unavailable')
      ?'<div class="vision-direct warn"><b>Recorded Field locations unavailable.</b>The source map could not be verified; no customer location was inferred.</div>':'';
    const caveat=question.scope==='offline'&&/\b(?:more than|over|longer than|for at least)\s+\d+\s*(?:hours?|days?|hrs?)\b/i.test(question.raw||'')
      ?'<div class="vision-system-note">A duration threshold cannot be certified from intermittent provider observations. The rows show verified observation spans where available, not guaranteed continuous downtime.</div>':'';
    return '<div class="vision-answer-title">'+escape(header)+'</div>'+source+groups+filter+locationWarning+caveat+title;
  }
  async function read(client, question) {
    if (!client?.functions?.invoke) throw new Error('Owner session not connected.');
    const result=await client.functions.invoke('onsite-vision-agent',{
      body: {mode:'fleet_health',question}
    });
    if (result.error || result.data?.ok!==true || result.data?.read_only!==true || !result.data?.fleet)
      throw new Error('Verified COS Camera Health read was unavailable. No camera count was confirmed.');
    return result.data.fleet;
  }
  async function answer(raw, client) {
    const question=queryFromText(raw);
    try {
      const fleet=await read(client,question);
      return render(fleet,{...question,raw:String(raw||'')});
    } catch(error) {
      return '<div class="vision-direct warn"><b>Camera Health data could not be verified.</b>'+
        'Vision could not complete the authenticated saved-health lookup. No cameras were classified online or offline by this attempt. '+
        'Use Camera Health directly and retry after checking your COS Owner session.</div>';
    }
  }
  root.OnSiteVisionFleetData={queryFromText,render,read,answer};
})(globalThis);
