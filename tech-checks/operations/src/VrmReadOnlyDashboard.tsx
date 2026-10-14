import type { VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';
import type { SafeVrmPower } from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import type { PowerMetric } from '../../supabase/functions/cos-operations-pages/vrmPower';
import { chargeReadings, dashboardPowerFor, readingIsFresh, selectReading } from './vrmReadOnlyModel';

const cards: { metric: PowerMetric; label: string; kind: string }[] = [
  {metric:'solar_power',label:'Solar generation',kind:'solar'},
  {metric:'battery_soc',label:'Battery charge',kind:'battery'},
  {metric:'load_power',label:'DC system power',kind:'load'},
  {metric:'battery_voltage',label:'Battery voltage',kind:'detail'},
  {metric:'battery_current',label:'Battery current',kind:'detail'},
  {metric:'battery_power',label:'Battery power',kind:'detail'},
];
const time = (value:string) => new Date(value).toLocaleString(undefined,{timeZoneName:'short',hour12:true});
export default function VrmReadOnlyDashboard({unit,rows,invalid=false,readFailed=false,now}:{unit:VrmUnit;rows:SafeVrmPower[];invalid?:boolean;readFailed?:boolean;now:number}) {
  const row = dashboardPowerFor(unit, rows);
  const selected = cards.map(card => ({...card,readings:card.metric === 'battery_soc' ? chargeReadings(row,now) : [selectReading(row,card.metric,now)].filter(reading => reading !== undefined)}));
  const reported = selected.flatMap(card => card.readings);
  const old = reported.some(reading => !readingIsFresh(reading,now));
  const issue = readFailed || invalid || Boolean(row?.errorCode);
  const status = unit.available === false ? 'Installation unavailable' : issue ? 'Readings could not be refreshed' : !reported.length ? 'Waiting for readings' : old ? 'Saved readings · some are stale' : 'Recent saved readings';
  const alarms = row?.measurements.filter(reading => reading.unit === 'state' && reading.value > 0) ?? [];
  return <section id='vrm-native-dashboard' className='vrm-native-dashboard' aria-label={unit.name+' read-only power dashboard'}>
    <div className='vrm-native-heading'><div><span className='vrm-eyebrow'>COS · READ-ONLY ENERGY</span><h4>Power overview</h4></div><span className={'vrm-native-status'+(old||issue?' vrm-native-warning':'')} role='status'>{status}</span></div>
    <p className='vrm-native-caption'>Saved Victron measurements. This view updates with fleet sync; it is not a live Remote Console.</p>
    <div className='vrm-native-grid'>{selected.map(({metric,label,kind,readings}) => <article key={metric} className={'vrm-native-card vrm-native-'+kind} aria-label={label}>
      <h5>{label}</h5>{metric === 'battery_soc' && readings.length > 1 && <p className='vrm-native-multiple'>Separate source readings · no combined charge</p>}
      {readings.length ? readings.map((reading,index) => <div className='vrm-native-reading' key={reading.source+':'+reading.instance+':'+index}>
        <strong className='vrm-native-value'>{reading.value.toLocaleString(undefined,{maximumFractionDigits:2})}<small> {reading.unit}</small></strong>
        <p><span className={readingIsFresh(reading,now)?'':'vrm-native-warning'}>{readingIsFresh(reading,now)?'Saved reading':'Stale'} · {time(reading.observedAt)}</span><span className='vrm-native-source'>{reading.source} · instance {reading.instance}</span></p>
      </div>) : <><strong className='vrm-native-value'>—</strong><p>Not reported</p></>}
    </article>)}</div>
    {alarms.length > 0 && <p className='vrm-native-warning' role='status'>Reported alarms: {alarms.map(reading => reading.metric.replaceAll('_',' ')+' ('+(readingIsFresh(reading,now)?'reported':'stale')+' '+time(reading.observedAt)+')').join('; ')}.</p>}
    <p className='vrm-native-caption'>{row?.lastAttemptAt ? 'Last telemetry check: '+time(row.lastAttemptAt)+'. ' : ''}Readings older than 30 minutes are marked stale. Missing measurements stay blank.</p>
    <p className='vrm-native-caption'>Solar and DC system power show one labeled source, preferring recent system readings when available. DC system power may be an estimate. Battery charge keeps each reported source separate. Signed battery power/current are shown as supplied by Victron; DC system power is not total site consumption. Use Open in VRM for history, grid/AC details, inverter state and Remote Console.</p>
  </section>;
}
