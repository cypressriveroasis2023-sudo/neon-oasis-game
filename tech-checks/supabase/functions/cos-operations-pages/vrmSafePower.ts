import type {PowerObservation,PowerMetric} from './vrmPower.ts';
export type SafeVrmPower={installationId:number;name:string;measurements:PowerObservation[];lastAttemptAt:string|null;errorCode:string|null};
const rules:Record<PowerMetric,[string,number,number]>={battery_soc:['%',0,100],battery_voltage:['V',0,200],battery_current:['A',-10000,10000],battery_power:['W',-1000000,1000000],solar_power:['W',0,1000000],load_power:['W',-1000000,1000000],low_voltage_alarm:['state',0,2],low_soc_alarm:['state',0,2],high_voltage_alarm:['state',0,2]};
/** Project only bounded saved numeric evidence. No provider request or raw metadata. */
export function safeVrmPower(value:unknown,items:{installationId:number;name:string}[],now=Date.now()):SafeVrmPower[]{
 if(!Array.isArray(value)||value.length>1000)throw Error('Power evidence unavailable');const seen=new Set<number>();
 return value.flatMap(r=>{
  if(!r||!Number.isSafeInteger(r.installationId)||seen.has(r.installationId)||!Array.isArray(r.measurements)||r.measurements.length>40)throw Error('Power evidence inconsistent');seen.add(r.installationId);
  if(items.filter(i=>i.installationId===r.installationId&&i.name===r.name).length!==1||typeof r.name!=='string'||!/^HELIOS\s+\d{1,3}$/i.test(r.name))return [];
  const measurements=r.measurements.map((m:any):PowerObservation=>{
   const rule=rules[m?.metric as PowerMetric],time=Date.parse(m?.observedAt);
   if(!rule||m.unit!==rule[0]||typeof m.value!=='number'||!Number.isFinite(m.value)||m.value<rule[1]||m.value>rule[2]||!Number.isFinite(time)||time<Date.UTC(2000,0,1)||time>now+300000||!Number.isSafeInteger(m.instance)||m.instance<0||m.instance>1000||!['system','battery','solarcharger'].includes(m.source))throw Error('Power measurement invalid');
   return {metric:m.metric,value:m.value,unit:m.unit,observedAt:m.observedAt,instance:m.instance,source:m.source};
  });
  const error=r.errorCode;if(error!==null&&!['access','provider','rate_limit','invalid_response','no_data'].includes(error))throw Error('Power read state invalid');
  if(r.lastAttemptAt!==null&&(typeof r.lastAttemptAt!=='string'||!Number.isFinite(Date.parse(r.lastAttemptAt))))throw Error('Power read time invalid');
  return [{installationId:r.installationId,name:r.name,measurements,lastAttemptAt:r.lastAttemptAt,errorCode:error}];
 });
}
