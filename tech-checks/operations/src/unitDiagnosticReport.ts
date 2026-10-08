import {cameraTimestamp,classifyCameraUnit,providerState,resourceKind,cameraEvidenceLabel,serviceEvidenceLabel,type CameraRow,type CameraEvidence} from './cameraEvidence';
import {savedConnectionObservation} from './savedConnectionObservation';
import {isSupportEquipment,type FieldHealthUnit} from './fieldCameraHealth';

export type UnitDiagnosticInput={unit:FieldHealthUnit;rows:CameraRow[];trusted:boolean;now:number;refreshedAt?:string|null;identity?:'matched'|'missing'|'ambiguous'};
/** Export only selected presentation fields. Never serialize the DTO or connection configuration. */
export function diagnosticLabel(value:unknown):string {
  return String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ')
    .replace(/<[^>]*>/g,'')
    .replace(/(?:\b[a-z][a-z0-9+.-]*:\/\/|\/\/|\bwww\.|\b(?:data|javascript):)\S+/gi,'[link omitted]')
    .replace(/\bBearer\s+\S+/gi,'[credential omitted]')
    .replace(/\b(?:password|passwd|pass|secret|token|api[_ -]?key|authorization|credentials?|username|user|login)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&},]+)/gi,'[credential omitted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[credential omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[contact omitted]')
    .replace(/\b\d{10,15}\b/g,'[contact omitted]')
    .replace(/(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\b\d{3}[ .-]?)\d{3}[ .-]?\d{4}\b/g,'[contact omitted]')
    .replace(/\s+/g,' ').trim().slice(0,180)||'Not recorded';
}
const stamp=(value:unknown,now:number)=>cameraTimestamp(value,now).at||'Not recorded / invalid';
const state=(value:string)=>value==='verifying'?'UNKNOWN / NOT VERIFIED':value.toUpperCase();
const resourceId=(row:CameraRow)=>/^[1-9]\d*$/.test(String(row.id))?String(row.id):row.trackerOnly?'Inventory reference (no diagnostic resource ID)':'Resource ID unavailable';
function observationLines(label:string,evidence:CameraEvidence|undefined,now:number){
  if(!evidence)return [label+': No source-separated observation available.'];
  const time=cameraTimestamp(evidence.observedAt,now);
  return [label+' source: '+diagnosticLabel(evidence.source),
    (evidence.kind==='provider'?'Last provider observation: ':'Last service check attempted: ')+stamp(evidence.observedAt,now),
    'Last reported result: '+state(evidence.status)+(time.fresh?' (recent saved observation)':' (older, missing or invalid observation; current status unverified)'),
    'Last recorded successful '+(evidence.kind==='provider'?'provider connection':'service connection')+': '+stamp(evidence.lastOnlineAt,now)+' (historical only)'];
}
export function unitDiagnosticNextStep(input:UnitDiagnosticInput):string {
  if(input.identity==='ambiguous')return 'Resolve the conflicting unit identity in current inventory before choosing a resource to verify.';
  if(isSupportEquipment(input.unit))return 'Review the linked power/support equipment source if needed; camera testing does not apply.';
  if(input.identity==='missing'||!input.trusted||!input.rows.length||input.rows.every(row=>row.trackerOnly))return 'Verify the unit-to-resource mapping and provider access in Camera Health diagnostics, then run the existing unit verification and review its result.';
  if(input.rows.some(row=>providerState(row,input.now)==='offline'))return 'Verify the named offline provider resource in Camera Health diagnostics. Review camera live view and recording separately before deciding on repair work.';
  if(input.rows.some(row=>savedConnectionObservation(row,input.now)==='offline'))return 'Open the saved resource diagnostics, verify the network/IP and observed service-port results, then check camera live view and recording separately.';
  if(input.rows.some(row=>providerState(row,input.now)==='verifying'))return 'Use existing unit diagnostics to verify source access, unit mapping and fresh observations. Missing, stale or authentication-limited evidence does not establish an outage.';
  return 'Review expected camera coverage, live view and recording in the provider before closing the issue; saved connectivity alone is insufficient.';
}
export function unitDiagnosticReport(input:UnitDiagnosticInput):string {
  const {unit,now,trusted,identity}=input,support=isSupportEquipment(unit)&&identity!=='ambiguous';
  // Unknown API versions must not revive unverified provider claims in an export.
  const rows=trusted&&!support?input.rows:[],classification=rows.length?classifyCameraUnit(rows,now):null;
  const lines=['COS UNIT DIAGNOSTIC REPORT','Unit: '+diagnosticLabel(unit.unitNumber),'Prepared: '+stamp(new Date(now).toISOString(),now)+' (UTC)',
    'Saved records refreshed: '+stamp(input.refreshedAt,now)+' (read time, not a new diagnostic)',
    'Evidence: '+(trusted?'Source-separated saved observations (version 2)':'Unavailable / unverified response'),
    'Unit mapping: '+(support?'Support equipment':identity==='ambiguous'?'Conflicting unit identity':identity==='missing'?'No exact current resource match':rows.length?'Exact saved unit resource group':'No matching resource'),
    'Current trusted result: '+(support?'SUPPORT EQUIPMENT · 0 CAMERAS':classification&&identity==='matched'?cameraEvidenceLabel(classification.cameraState):'Camera status UNKNOWN / NOT VERIFIED'),
    ...(classification?['Saved resource placement: '+classification.scope.toUpperCase(),'Saved resource provider system: '+state(classification.providerState)]:[]),
    support?'Camera online/offline totals do not apply to solar stands, poles or skids.':'Service connectivity never proves camera video or recording. Expected camera/channel coverage is not established.',
    'Next step: '+unitDiagnosticNextStep(input),''];
  if(!support){
    lines.push('Observed per-port results: Unavailable in this summary. Configured ports are not test results. Open existing unit/resource diagnostics for observed port details.');
    if(!rows.length)lines.push('No trusted resource observations are available. Missing data is not an outage.');
    for(const row of rows){
      const provider=row.evidence?.kind==='provider'?row.evidence:undefined,service=row.serviceEvidence||(row.evidence?.kind==='service_port'?row.evidence:undefined);
      lines.push('', 'Resource: '+diagnosticLabel(row.name)+' | '+resourceId(row)+' | '+resourceKind(row),
        'Current trusted provider result: '+state(providerState(row,now)),
        ...observationLines('Provider',provider,now),
        'Current saved service result: '+serviceEvidenceLabel(savedConnectionObservation(row,now)),
        ...observationLines('Service',service,now));
      if(row.trackerOnly)lines.push('Inventory-only resource: no camera observation is established.');
      if(resourceKind(row)==='recorders')lines.push('Recorder state does not establish camera channel status.');
    }
  }
  lines.push('','Review this report before pasting into COS work instructions or an mHelpDesk ticket. No ticket was created or sent.');
  return lines.join('\n');
}
export function unitDiagnosticFilename(unit:FieldHealthUnit){
  const label=diagnosticLabel(unit.unitNumber).replace(/[^a-z0-9-]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'unit';
  return 'cos-'+label.toLowerCase()+'-diagnostic.txt';
}
/** Leave room for the existing ticket reference and optional contact instructions (12k backend limit). */
export function unitDiagnosticDraft(text:string):string {
  if(text.length<=6000)return text;
  const end=text.lastIndexOf('\nResource:',5600),excerpt=text.slice(0,end>0?end:5600);
  return excerpt+'\n\nReport shortened for the ticket draft. Copy or download the full report from this unit’s Camera Health details for remaining resource observations. Review before saving.';
}
