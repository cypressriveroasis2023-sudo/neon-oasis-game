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
    const direct=row.kind==='IP/port connection (not camera-video verification)';
    const note=status==='offline' ? observedSpan(row) : '';
    const onlineTime=row.last_online_at?'Last source-reported ONLINE: '+stamp(row.last_online_at):'Last source-reported ONLINE: not recorded';
    // A unit may contain several cameras; retain each resource's own identity.
    const name=String(row.name||row.unit||'Unnamed source resource').trim();
    return '<div class="vision-context-row vision-fleet-channel">' +
      '<b>'+escape(name)+' · '+escape(status.toUpperCase())+'</b>' +
      '<span>'+escape(row.kind||'camera')+' · '+escape(row.provider||'Source not confirmed')+
        ' · Source record '+escape(row.resource_id||'not available')+'</span>' +
      '<small>Observed: '+escape(stamp(row.observed_at))+'</small>' +
      '<small>'+escape(onlineTime)+'</small>' +
      (note?'<small>'+escape(note)+'</small>':'') +
      (direct?'<small>IP/port response is not a video test.</small>':'') +
      '</div>';
  }
  /** Exact normalized provider-unit label only. Do not collapse different
   * numbered assets or suffix variants such as 029 and 029HDC2. */
  function groupByUnit(rows) {
    const groups=new Map();
    for (const row of rows) {
      const unit=String(row.unit||'').trim();
      const known=unit && unit!=='Unit identity unavailable';
      const normalized=unit.toUpperCase().replace(/[^A-Z0-9]/g,'');
      const key=known&&normalized?'unit:'+normalized:'resource:'+String(row.resource_id||row.name||'unknown');
      if (!groups.has(key)) groups.set(key,{unit:known?unit:'Unmatched source resource',rows:[]});
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }
  function categoryCounts(rows,kind) {
    const items=rows.filter(row=>row.kind===kind);
    if (!items.length) return '';
    const offline=items.filter(row=>row.status==='offline').length;
    const unverified=items.filter(row=>row.status!=='offline'&&row.status!=='online').length;
    const online=items.length-offline-unverified;
    const noun={camera:'camera',detector:'detector',recorder:'recorder',
      'IP/port connection (not camera-video verification)':'service-port'}[kind]||'source';
    const plural=items.length===1?noun:noun+'s';
    return offline ? offline+'/'+items.length+' '+plural+' OFFLINE'+(unverified?' · '+unverified+' unverified':'') :
      unverified ? unverified+'/'+items.length+' '+plural+' UNVERIFIED'+(online?' · '+online+' online':'') :
      online+'/'+items.length+' '+plural+' online';
  }
  function unitRow(group,expand=false) {
    const records=group.rows;
    const cameraRows=records.filter(row=>row.kind==='camera');
    const statuses=records.map(row=>row.status);
    const status=statuses.includes('offline')?'OFFLINE OBSERVATIONS':
      statuses.includes('unverified')?'NEEDS VERIFICATION':'ONLINE OBSERVATIONS';
    const categoryText=['camera','detector','recorder','IP/port connection (not camera-video verification)']
      .map(kind=>categoryCounts(records,kind)).filter(Boolean).join(' · ');
    const needsPlacementReview=records.every(row=>row.placement==='needs_review');
    const candidate=needsPlacementReview&&records[0]?.mhelp_product_candidate&&
      records.every(row=>JSON.stringify(row.mhelp_product_candidate||null)===JSON.stringify(records[0].mhelp_product_candidate))
      ?records[0].mhelp_product_candidate:null;
    // A similar name alone is never a confirmed resource-to-equipment link.
    const sourceCandidateNote=candidate?.state==='exact_mhelp_product_candidate'
      ?'<small class="vision-mhelp-candidate"><b>MHELP SOURCE CANDIDATE · '+escape(candidate.placement)+'</b>'+
         (candidate.customer?' · '+escape(candidate.customer):'')+
         (candidate.source_address?' · '+escape(candidate.source_address):'')+
         (candidate.product_id?' · Product ID '+escape(candidate.product_id):'')+
         ' · Source observed '+escape(stamp(candidate.source_received_at))+
         ' · Camera-resource association NOT YET VERIFIED</small>'
      :candidate?.state==='unit_variant_review'
        ?'<small class="vision-mhelp-variant">POSSIBLE MHELP UNIT: '+escape(candidate.mhelp_unit||'')+
           ' · Product ID '+escape(candidate.product_id||'not verified')+
           ' · Number matches but suffix/description differs — placement and address withheld pending identity review.</small>'
        :candidate?.state==='ambiguous_source_products'
          ?'<small class="vision-mhelp-variant">Multiple MHelp source products share a related unit number. Manual identity review required.</small>'
          :'';
    const firstLocation=records[0]?.location;
    const addressKey=x=>x&&typeof x==='object'
      ?[x.customer||'',x.site||'',x.address||''].join('\u0001'):null;
    const verified=firstLocation&&records.every(row=>addressKey(row.location)===addressKey(firstLocation));
    const folders=[...new Set(records.map(row=>row.provider_customer_folder).filter(Boolean))];
    const where=needsPlacementReview
      ?(folders.length?'Star4Live customer folder: '+folders.map(escape).join(' / ')+' · ':'')+'FIELD NOT VERIFIED — customer folder is not a deployment record'
      :verified
      ?[firstLocation.customer,firstLocation.site,firstLocation.address].filter(Boolean).map(escape).join(' · ')
      :'Verified equipment, but recorded COS service address is unavailable';
    const firstObserved=records.map(row=>row.observed_at).filter(Boolean);
    const sameLastOnline=records.every(row=>row.last_online_at&&row.last_online_at===records[0].last_online_at);
    const lastOnline=sameLastOnline ? '<small>Each source last reported ONLINE: '+
      escape(stamp(records[0].last_online_at))+' (not a proven outage start)</small>' : '';
    const unit=String(group.unit||'Unmatched source resource');
    const unitLabel=unit.replace(/^SOLAR\s*SPOTTER\b/i,'Solar Spotter');
    const link=unit!=='Unmatched source resource'
      ?'<a href="./camera-health.html?q='+encodeURIComponent(unit)+'">Open Camera Health ↗</a>' : '';
    return '<details class="vision-fleet-unit'+(needsPlacementReview?' vision-fleet-placement-review':'')+'"'+(expand?' open':'')+'>' +
      '<summary><b>'+escape(unitLabel)+' · '+escape(needsPlacementReview?'PLACEMENT REVIEW · '+status:status)+'</b>' +
      '<span>'+escape(categoryText)+'</span><small>'+where+'</small>'+sourceCandidateNote+lastOnline+'</summary>' +
      '<div class="vision-fleet-unit-details"><div class="vision-fleet-unit-link">'+link+
      '</div>'+records.map(entry).join('')+'</div></details>';
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
    const grouped=groupByUnit(listed);
    const title='<div class="vision-context-block"><h3>Matching source records · '+grouped.length+' unit group'+(grouped.length===1?'':'s')+'</h3>'+
      '<p class="vision-fleet-count-note">'+listed.length+' source record'+(listed.length===1?'':'s')+' shown. Multiple camera channels on one unit are grouped together; source counts are unchanged.</p>'+
      (fleet.items_truncated?'<p>More provider records exist than are shown. Narrow the request by unit or customer/site.</p>':'')+
      (!listed.length?'<p>No matching verified source records in this request. This is not proof that every camera is working.</p>':'')+
      '<div class="vision-fleet-group-list">'+grouped.map(group=>unitRow(group,grouped.length===1)).join('')+'</div></div>';
    if(fleet.provider_source_counts){
      if(!Array.isArray(fleet.review_items)||!fleet.placement_review_counts||!fleet.shop_or_inactive_counts)
        throw new Error('Verified Field placement separation is incomplete.');
      for(const [label,counts] of [
        ['Provider source camera',fleet.provider_source_counts.cameras],
        ['Review camera',fleet.placement_review_counts.cameras],
        ['Shop camera',fleet.shop_or_inactive_counts.cameras]])assertCounts(counts,label);
      const allSource=fleet.provider_source_counts,review=fleet.placement_review_counts,shop=fleet.shop_or_inactive_counts;
      const detail='<div class="vision-system-note">COS saved provider status: '+escape(stamp(fleet.health_refreshed_at))+
        ' Central. Star4Live customer folders are NOT evidence of current Field deployment. Only complete equipment/camera identity and COS placement proofs are included in confirmed Field counts.</div>';
      const scopeTitle='<div class="vision-answer-title">Confirmed Field camera health</div>';
      const verifiedCards=fleet.field_placement_verified
        ?statGroup('Confirmed Field camera records',cameras)+statGroup('Confirmed Field detector records',detectors)+
         statGroup('Confirmed Field NVR recorders',recorders)+statGroup('Field IP/port service checks (not video)',services)
        :'<div class="vision-direct warn"><b>Field inventory proof unavailable.</b>No confirmed Field count can be established from these source records. All unlinked provider statuses are held for placement review.</div>';
      const allProvider=statGroup('All saved provider camera statuses — includes Shop / unknown',allSource.cameras);
      const reviewBanner='<div class="vision-system-note"><b>Not confirmed Field outages:</b> '+
        escape(review.cameras.offline)+' offline camera record'+(review.cameras.offline===1?'':'s')+
        ' need equipment placement/identity review; '+escape(shop.cameras.offline)+
        ' offline camera record'+(shop.cameras.offline===1?'':'s')+
        ' have a verified Shop/inactive exclusion. They do not count as confirmed Field camera outages.</div>';
      const fieldGroups=groupByUnit(fleet.items);
      const reviewPriority=group=>{
        const c=group.rows[0]?.mhelp_product_candidate;
        return c?.state==='exact_mhelp_product_candidate'&&c.placement==='FIELD'?0:
          c?.state==='exact_mhelp_product_candidate'&&c.placement==='SHOP'?1:
          c?.state==='unit_variant_review'?2:3;
      };
      const reviewGroups=groupByUnit(fleet.review_items).sort((a,b)=>reviewPriority(a)-reviewPriority(b)||
        String(a.unit).localeCompare(String(b.unit),undefined,{numeric:true}));
      const selectedField='<div class="vision-context-block"><h3>Confirmed Field matches · '+fieldGroups.length+
        ' unit group'+(fieldGroups.length===1?'':'s')+'</h3>'+
        (fieldGroups.length?'':'<p>No confirmed Field match for this question. This does not mean other provider cameras are online.</p>')+
        (fleet.items_truncated?'<p>Results are limited. Narrow by unit or location.</p>':'')+
        '<div class="vision-fleet-group-list">'+fieldGroups.map(group=>unitRow(group,fieldGroups.length===1)).join('')+'</div></div>';
      const selectedReview='<div class="vision-context-block"><h3>Star4Live / provider placement review · '+
        reviewGroups.length+' unit group'+(reviewGroups.length===1?'':'s')+'</h3>'+
        '<p class="vision-fleet-count-note">These provider observations have no complete verified COS equipment-to-camera Field link and are NOT confirmed Field outages. Current protected MHelp source candidates, when available, are shown below for review only — they do not certify resource identity, change placement or open a service call.</p>'+
        '<p class="vision-fleet-count-note">From the protected MHelp snapshot: '+
        escape(Number(fleet.review_candidate_field_source_count||0))+' source records suggest FIELD, '+
        escape(Number(fleet.review_candidate_shop_source_count||0))+' suggest SHOP, and '+
        escape(Number(fleet.review_candidate_variant_source_count||0))+
        ' have variant/ambiguous labels. These counts are candidates, NOT confirmed deployments.</p>'+
        (fleet.review_items_truncated?'<p>More records require placement review; refine by unit or customer folder.</p>':'')+
        '<div class="vision-fleet-group-list">'+reviewGroups.map(group=>unitRow(group,false)).join('')+'</div></div>';
      const threshold=/\b(?:more than|over|longer than|for at least)\s+\d+\s*(?:hours?|days?|hrs?)\b/i.test(question.raw||'')
        ?'<div class="vision-system-note">Saved provider observations cannot prove continuous outage durations across missing events.</div>':'';
      return scopeTitle+detail+verifiedCards+allProvider+reviewBanner+threshold+selectedField+selectedReview;
    }
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
