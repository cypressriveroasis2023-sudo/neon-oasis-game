import VrmEnergyFlow from './VrmEnergyFlow';
import type { VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';
import type { SafeVrmPower } from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import type { PowerMetric } from '../../supabase/functions/cos-operations-pages/vrmPower';
import { chargeAgreement, chargeReadings, dashboardPowerFor, readingIsFresh, selectReading } from './vrmReadOnlyModel';

const cards: { metric: PowerMetric; label: string; kind: string }[] = [
  {metric:'solar_power',label:'Solar generation',kind:'solar'},
  {metric:'battery_soc',label:'Battery charge',kind:'battery'},
  {metric:'load_power',label:'DC system power',kind:'load'},
  {metric:'battery_voltage',label:'Battery voltage',kind:'detail'},
  {metric:'battery_current',label:'Battery current',kind:'detail'},
  {metric:'battery_power',label:'Battery power',kind:'detail'},
];
const time = (value:string) => new Date(value).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
/** On a card, a reading from today needs only its time; an older one keeps its date. */
const cardTime = (value:string, now:number) => new Date(value).toDateString() === new Date(now).toDateString()
  ? new Date(value).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : time(value);
export default function VrmReadOnlyDashboard({unit,rows,invalid=false,readFailed=false,now,embedded=false}:{unit:VrmUnit;rows:SafeVrmPower[];invalid?:boolean;readFailed?:boolean;now:number;embedded?:boolean}) {
  const row = dashboardPowerFor(unit, rows);
  const selected = cards.map(card => ({...card,readings:card.metric === 'battery_soc' ? chargeReadings(row,now) : [selectReading(row,card.metric,now)].filter(reading => reading !== undefined)}));
  const reported = selected.flatMap(card => card.readings);
  const old = reported.some(reading => !readingIsFresh(reading,now));
  const issue = readFailed || invalid || Boolean(row?.errorCode);
  const status = unit.available === false ? 'Installation unavailable' : issue ? 'Readings could not be refreshed' : !reported.length ? 'Waiting for readings' : old ? 'Saved readings · some are stale' : 'Recent saved readings';
  const alarms = row?.measurements.filter(reading => reading.unit === 'state' && reading.value > 0) ?? [];
  return <section id={embedded?undefined:'vrm-native-dashboard'} className={'vrm-native-dashboard'+(embedded?' vrm-native-embedded':'')} aria-label={unit.name+' read-only power dashboard'}>
    <div className='vrm-native-heading'><div><span className='vrm-eyebrow'>COS · READ-ONLY ENERGY</span><h4>Power overview</h4></div><span className={'vrm-native-status'+(old||issue?' vrm-native-warning':'')} role='status'>{status}</span></div>
    <p className='vrm-native-caption'>Saved Victron measurements. This view updates with fleet sync; it is not a live Remote Console.</p>
    <VrmEnergyFlow row={row} now={now} paused={issue||unit.available===false}/>
    <div className='vrm-native-grid'>{selected.map(({metric,label,kind,readings}) => {
      // Several battery monitors: when they agree, show the one the page goes by and fold the rest away.
      // When they do not, every source stays in view. Either way each is a real reading; nothing is averaged.
      const charge = metric === 'battery_soc' && readings.length > 1 ? chargeAgreement(readings, now) : null;
      const reading = (item: typeof readings[number], index: number) => <div className='vrm-native-reading' key={item.source+':'+item.instance+':'+index}>
        <strong className='vrm-native-value'>{item.value.toLocaleString(undefined,{maximumFractionDigits:2})}<small> {item.unit}</small></strong>
        {metric==='battery_soc'&&<meter className='cos-energy-charge' min={0} max={100} low={20} optimum={80} value={item.value} aria-label={'Saved battery charge · '+item.source+' '+item.instance}>{item.value}%</meter>}
        <p><span className={readingIsFresh(item,now)?'':'vrm-native-warning'}>{readingIsFresh(item,now)?'Saved reading':'Stale'} · {cardTime(item.observedAt,now)}</span><span className='vrm-native-source'>{item.source} · instance {item.instance}</span></p>
      </div>;
      return <article key={metric} className={'vrm-native-card vrm-native-'+kind+(charge&&!charge.agree?' vrm-native-multi':'')+(charge?.agree?' vrm-native-agree':'')} aria-label={label}>
      <h5>{label}</h5>
      {charge && !charge.agree && <p className='vrm-native-multiple'>Separate source readings · no combined charge</p>}
      {charge && !charge.agree && charge.lead && <p className='vrm-native-differ'>The sources differ by {Math.round(charge.spread)} points. The page goes by the {charge.lead.source} reading ({Math.round(charge.lead.value)}%).{charge.monitorLow ? ' Saved readings show that one is right: the second battery monitor has drifted low and needs a re-sync.' : ''}</p>}
      {charge?.agree && charge.lead
        ? <>{reading(charge.lead, 0)}
            <details className='vrm-native-sources'><summary>All {readings.length} sources agree · show each</summary>{readings.filter(item => item !== charge.lead).map((item, index) => reading(item, index + 1))}</details></>
        : readings.length ? readings.map(reading) : <><strong className='vrm-native-value'>—</strong><p>Not reported</p></>}
    </article>; })}</div>
    {alarms.length > 0 && <p className='vrm-native-warning' role='status'>Reported alarms: {alarms.map(reading => reading.metric.replaceAll('_',' ')+' ('+(readingIsFresh(reading,now)?'reported':'stale')+' '+time(reading.observedAt)+')').join('; ')}.</p>}
    <p className='vrm-native-caption'>{row?.lastAttemptAt ? 'Last telemetry check: '+time(row.lastAttemptAt)+'. ' : ''}Readings older than 45 minutes are marked stale. Missing measurements stay blank.</p>
    <p className='vrm-native-caption'>Solar and DC system power show one labeled source, preferring recent system readings when available. DC system power may be an estimate. Battery charge keeps each reported source separate. Signed battery power/current are shown as supplied by Victron; DC system power is not total site consumption. Use Open in VRM for history, grid/AC details, inverter state and Remote Console.</p>
  </section>;
}
