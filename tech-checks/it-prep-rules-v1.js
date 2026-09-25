// Authoritative IT Prep checklist adapter.
// Primary checklist definitions remain in tech-check-rules.js; this module gives IT Prep one stable API.
function checklist(item,unitNo,deps={}){
  if(window.TechCheckRules?.itChecklist)return window.TechCheckRules.itChecklist(item,unitNo);
  if(typeof deps.fallbackChecklist==='function')return deps.fallbackChecklist(item,unitNo);
  return legacyChecklist(item,unitNo,deps);
}
function legacyChecklist(item,unitNo,deps={}) {
  if (window.TechCheckRules?.itChecklist) return window.TechCheckRules.itChecklist(item, unitNo);
  const isSolarSupport=deps.isSolarSupport||((type)=>window.TechCheckRules?.isSolarSupport?window.TechCheckRules.isSolarSupport(type):type==='Solar Stand');
  const isSimpleSupport=deps.isSimpleSupport||((type)=>window.TechCheckRules?.isSimpleSupport?window.TechCheckRules.isSimpleSupport(type):['110V Stand','Pole'].includes(type));
  const isSupport=deps.isSupport||((type)=>window.TechCheckRules?.isSupport?window.TechCheckRules.isSupport(type):(isSolarSupport(type)||isSimpleSupport(type)));
  const itItemIdentity=deps.identity||((row,n)=>{const tag=String(row?.unit_tag||'').trim();if(tag)return `${row.equipment_type} ${tag}`;if(row?.equipment_type==='110V Stand')return '110V Stand · no tag';return `Unit ${n}`;});
  const isHeliosDeploy=deps.isHeliosDeploy||((row)=>window.TechCheckRules?.isHeliosDeploy?window.TechCheckRules.isHeliosDeploy(row):(row?.equipment_type==='Helios'&&['DELIVERY','SWAP','BACKUP'].includes(row?.purpose)));
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
      { kind:'bool', field:'helios_camera1_hardware_ok', label:`Is Camera 1 installed and secure on ${identity}?` },
      { kind:'bool', field:'helios_camera2_hardware_ok', label:`Is Camera 2 installed and secure on ${identity}?` },
      { kind:'bool', field:'helios_ptz_assembly_ok', label:`Is the PTZ/180 camera installed correctly on ${identity}?` },
      { kind:'bool', field:'helios_cameras_12v_ok', label:`Are all Helios cameras powered by 12V?` },
      { kind:'bool', field:'helios_ptz_plate_4bolts_ok', label:`Is the PTZ/180 camera secured with all 4 mounting bolts?` },
      { kind:'bool', field:'helios_router_sim_ok', label:`Is the router installed with the SIM card in place?` },
      { kind:'bool', field:'helios_proxicast_4x4_ok', label:`Is the Proxicast 4x4 antenna connected and secure?` },
      { kind:'bool', field:'helios_speaker_24v_ok', label:`Is the IP Speaker installed and powered by 24V?` },
      { kind:'bool', field:'helios_camera_router_programming_ok', label:`Are the cameras and router programmed for this Helios?` },
      { kind:'bool', field:'delivery_sim_ok', label:`Is the SIM active and is the router online?` },
      { kind:'bool', field:'delivery_camera_app_ok', label:`Can you see ${identity} in the camera app?` },
      { kind:'bool', field:'helios_camera1_ports_ok', label:`Camera 1: are ports 81 / 554 / 1400 open on the camera and router?` },
      { kind:'bool', field:'helios_camera2_ports_ok', label:`Camera 2: are ports 81 / 554 / 1500 open on the camera and router?` },
      { kind:'bool', field:'helios_ptz_ports_ok', label:`PTZ/180: are ports 81 / 554 / 1600 open on the camera and router?` },
      { kind:'bool', field:'helios_speaker_ports_ok', label:`IP Speaker: are ports 81 / 554 / 1700 open on the speaker and router?` },
      { kind:'bool', field:'helios_alibi_vigilant_ok', label:`Can you see ${identity} in Alibi / Vigilant Control Center?` },
      { kind:'bool', field:'helios_cerbo_network_ok', label:`Is the Cerbo connected to the Helios network?` },
      { kind:'bool', field:'helios_cerbo_vrm_ok', label:`Can you see the Cerbo online in Victron VRM?` },
      { kind:'bool', field:'helios_rear_unit_tag_ok', label:`Is the Helios unit tag on the back and easy to read?` },
      { kind:'bool', field:'helios_battery_box_installed_ok', label:`Is the Helios battery box installed inside ${identity}?` },
      { kind:'bool', field:'helios_battery_120v_charged_ok', label:`Was the Helios battery box charged while ${identity} was plugged into 120V?` },
      { kind:'bool', field:'helios_3x1tb_sd_ok', label:`Are all 3 × 1TB SD cards installed in ${identity}?` },
      { kind:'bool', field:'delivery_recording_ok', label:`Is ${identity} recording correctly?` },
      { kind:'bool', field:'delivery_sd_formatted_ok', label:`Are all 3 × 1TB SD cards formatted and ready?` }
    );
    if (item.purpose!=='BACKUP') {
      steps.push({ kind:'bool', field:'delivery_monitoring_ok', label:`Is Central Station monitoring set up for ${identity}?` });
      steps.push({ kind:'bool', field:'delivery_customer_email_app_ok', label:`Is ${identity} added to the customer email account in the camera app?` });
    }
    steps.push({ kind:'bool', field:'functions_ok', label:`Did you test ${identity} and confirm everything works?` });
    steps.push({ kind:'bool', field:'safe_ok', label:`Is ${identity} ready to hand off to Service?` });
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

function isHeliosDeploy(item){
  return window.TechCheckRules?.isHeliosDeploy
    ? window.TechCheckRules.isHeliosDeploy(item)
    : (item?.equipment_type==='Helios'&&['DELIVERY','SWAP','BACKUP'].includes(item?.purpose));
}
window.TechCheckITPrepRules=Object.freeze({checklist,isHeliosDeploy,legacyChecklist});
