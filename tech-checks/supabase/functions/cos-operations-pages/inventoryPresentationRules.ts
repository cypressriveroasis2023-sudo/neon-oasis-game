/** Mirrors the classic browser helper; contract-tested together. These are
 * inventory presentation rules, never equipment-to-resource identity proof. */
const solarCompatible=new Set(['182','252','253','254','263','285','298','310']);
const plain=(value:unknown)=>typeof value==='string'?value.trim():'';
const compact=(value:unknown)=>plain(value).replace(/\s/g,'').toUpperCase();
// Approved descriptor/model forms from the saved current tracker readback.
const approvedMasterLabels=new Set([
  'SPOTTER182HDC2S','SPOTTER252(SOLAR)','SPOTTER253-SOLARCOMPATIBLE',
  'SPOTTER254-SOLARCOMPATIBLE','SPOTTER263HDC4S(SOLARCOMPATIBLE)',
  'SPOTTER285-SOLARCOMPATIBLE','SPOTTER298HDC2S-SOLARCOMPATIBLE',
  'SPOTTER310(SOLARCOMPATIBLE)'
]);
export function solarCompatibleSpotterKey(value:unknown):string|null {
  const match=/^(?:SPOTTER|SOLAR[ _-]*SPOTTER|SS)\s*[-#]?\s*(\d+)$/i.exec(plain(value));
  if(!match)return null;
  const tag=String(Number(match[1]));
  return solarCompatible.has(tag)?'spotter|'+tag:null;
}
export function inventoryLabel(value:string,tracker?:TrackerRow[]):string {
  if(tracker!==undefined){
    const key=inventoryTrackerAlias(value,tracker);
    if(!key)return value;
    const tag=key.split('|')[1];
    return tracker.find(row=>plain(row.canonical_family).replace(/[ _-]/g,'').toUpperCase()==='SPOTTER'&&/^\d+$/.test(plain(row.unit_tag))&&String(Number(row.unit_tag))===tag)!.source_label;
  }
  const key=solarCompatibleSpotterKey(value);
  return key?'Spotter '+key.split('|')[1]:value;
}
export function witnessStatusNotChecked(value:unknown):boolean {return /^SPOTTER\s*[-#]?\s*0*(?:46|52|88)$/i.test(plain(value));}
type TrackerRow={canonical_family:string;unit_tag:string;source_label:string;tracker_state:string};
/** Suppress only a duplicate tracker placeholder, preserving exact current
 * source labels and every stored physical/resource association. */
export function inventoryTrackerAlias(value:unknown,tracker:TrackerRow[]):string|null {
  const key=solarCompatibleSpotterKey(value);
  if(!key||!Array.isArray(tracker))return null;
  const tag=key.split('|')[1],label=plain(value).toUpperCase();
  const tagOf=(row:TrackerRow)=>/^\d+$/.test(plain(row?.unit_tag))?String(Number(row.unit_tag)):null;
  const familyOf=(row:TrackerRow)=>plain(row?.canonical_family).replace(/[ _-]/g,'').toUpperCase();
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
