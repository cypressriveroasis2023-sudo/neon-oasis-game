/* Explicit inventory display rules only. These labels never prove a resource's
 * physical parent, change placement, or authorize a health observation. */
(function(root){
  'use strict';
  const solarCompatible=new Set(['182','252','253','254','263','285','298','310']);
  const plain=value=>typeof value==='string'?value.trim():'';
  const compact=value=>plain(value).replace(/\s/g,'').toUpperCase();
  // Exact descriptor/model forms from the saved current tracker readback.
  // Arbitrary suffixes could hide a restriction, a decimal unit, or a rename.
  const approvedMasterLabels=new Set([
    'SPOTTER182HDC2S','SPOTTER252(SOLAR)','SPOTTER253-SOLARCOMPATIBLE',
    'SPOTTER254-SOLARCOMPATIBLE','SPOTTER263HDC4S(SOLARCOMPATIBLE)',
    'SPOTTER285-SOLARCOMPATIBLE','SPOTTER298HDC2S-SOLARCOMPATIBLE',
    'SPOTTER310(SOLARCOMPATIBLE)'
  ]);
  function solarCompatibleSpotterKey(value){
    const match=/^(?:SPOTTER|SOLAR[ _-]*SPOTTER|SS)\s*[-#]?\s*(\d+)$/i.exec(plain(value));
    if(!match)return null;
    const tag=String(Number(match[1]));
    return solarCompatible.has(tag)?'spotter|'+tag:null;
  }
  function inventoryLabel(value,tracker){
    if(tracker!==undefined){
      const key=inventoryTrackerAlias(value,tracker);
      if(!key)return value;
      const tag=key.split('|')[1];
      return tracker.find(row=>plain(row.canonical_family).replace(/[ _-]/g,'').toUpperCase()==='SPOTTER'&&/^\d+$/.test(plain(row.unit_tag))&&String(Number(row.unit_tag))===tag).source_label;
    }
    const key=solarCompatibleSpotterKey(value);
    return key?'Spotter '+key.split('|')[1]:value;
  }
  function witnessStatusNotChecked(value){return /^SPOTTER\s*[-#]?\s*0*(?:46|52|88)$/i.test(plain(value));}
  // Deduplicate a tracker placeholder only when the current master has one
  // matching Spotter identity and no competing newer exact/family identity.
  function inventoryTrackerAlias(value,tracker){
    const key=solarCompatibleSpotterKey(value);
    if(!key||!Array.isArray(tracker))return null;
    const tag=key.split('|')[1],label=plain(value).toUpperCase();
    const tagOf=row=>/^\d+$/.test(plain(row?.unit_tag))?String(Number(row.unit_tag)):null;
    const familyOf=row=>plain(row?.canonical_family).replace(/[ _-]/g,'').toUpperCase();
    const candidates=tracker.filter(row=>tagOf(row)===tag&&familyOf(row)==='SPOTTER');
    if(candidates.length!==1)return null;
    const candidate=candidates[0],masterLabel=compact(candidate.source_label);
    if(plain(candidate.tracker_state).toLowerCase()!=='field_or_unknown')return null;
    const base=/^SPOTTER\s*[-#]?\s*(\d+)$/i.exec(plain(candidate.source_label));
    if(!(base&&String(Number(base[1]))===tag)&&!(approvedMasterLabels.has(masterLabel)&&masterLabel.startsWith('SPOTTER'+tag))&&masterLabel!=='SPOTTER'+tag+'(SOLARCOMPATIBLE)')return null;
    const exact=tracker.filter(row=>plain(row?.source_label).toUpperCase()===label);
    if(exact.length>1||exact.some(row=>row!==candidates[0]))return null;
    if(tracker.some(row=>tagOf(row)===tag&&['SOLARSPOTTER','SSHYBRID'].includes(familyOf(row))))return null;
    return key;
  }
  root.COSInventoryPresentation=Object.freeze({solarCompatibleSpotterKey,inventoryTrackerAlias,inventoryLabel,witnessStatusNotChecked});
})(globalThis);
