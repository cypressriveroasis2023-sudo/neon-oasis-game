import {cameraTimestamp} from './cameraEvidence';
import type {FieldProduct} from './mhelpFieldHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {VrmFleetConfig} from '../../supabase/functions/cos-operations-pages/vrm';

export type VerifiedFleetPower={online:boolean;reason:string};
const unknown=(reason:string):VerifiedFleetPower=>({online:false,reason});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

/** Reuse a current server-reviewed Product-ID association, never a name/IP match.
 * Missing camera observations are independent of saved power measurements.
 * No freshness extension, new identity, provider probe, or Offline inference. */
export function verifiedFleetPower(
 source:Record<string,unknown>|undefined,link:FieldProduct|null,
 rows:FleetDashboardRow[],config:VrmFleetConfig|null,now:number
):VerifiedFleetPower {
 if(!source||source.placement!=='FIELD'||source.uploadLifecycle!=='UNFLAGGED')
  return unknown('The source equipment is not active Field inventory. Power cannot reactivate it.');
 const binding=source.binding as Record<string,unknown>|null|undefined;
 if(!link||link.productId!==source.productId||!uuid(link.unitId)
   ||!['online','offline','unverified'].includes(link.state)
   ||binding?.state!=='linked'||!Array.isArray(binding.unitIds)
   ||new Set(binding.unitIds).size!==binding.unitIds.length||!binding.unitIds.includes(link.unitId)
   ||binding.placementHeld===true||Array.isArray(binding.candidateUnitIds)&&binding.candidateUnitIds.length>0)
  return unknown('A current, exact Product-ID / COS equipment association is required to verify Victron power.');
 const matches=rows.filter(row=>row.id===link.unitId);
 const row=matches.length===1?matches[0]:null;
 if(!row||row.placement!=='field'||row.retired||row.support)
  return unknown('The reviewed COS equipment is unavailable, duplicated, or not active in the Field.');
 const power=row.power;
 if(!power)return unknown('The verified COS equipment has no unique saved Victron installation association.');
 if(rows.filter(candidate=>candidate.power?.installationId===power.installationId).length!==1)
  return unknown('More than one COS equipment record claims this Victron installation. Review the association.');
 const installations=config?.items.filter(item=>item.installationId===power.installationId&&item.name===power.name)||[];
 if(installations.length!==1||installations[0].available===false)
  return unknown('The saved Victron installation is unavailable or cannot be confirmed against its exact installation ID.');
 if(power.errorCode)return unknown('The saved Victron power read reports an error. No outage is inferred.');
 if(config?.sync.state!=='current'||config.sync.error!==null||config.sync.connectionConfigured===false
   ||!cameraTimestamp(config.sync.lastSuccessAt,now).fresh)
  return unknown('The Victron provider sync is not current. A fresh successful read is required.');
 if(!power.measurements.some(measurement=>cameraTimestamp(measurement.observedAt,now).fresh))
  return unknown('Victron telemetry is stale or missing. Refreshing the screen does not renew the measurement time.');
 return {online:true,reason:'Fresh telemetry from the uniquely linked Victron installation. Power connectivity is verified independently of camera health; low battery remains a separate warning.'};
}
