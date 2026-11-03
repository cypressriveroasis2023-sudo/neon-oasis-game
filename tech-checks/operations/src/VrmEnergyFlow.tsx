import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {readingIsFresh,selectReading} from './vrmReadOnlyModel';

/** Motion represents fresh reported power, never a simulated reading. */
export default function VrmEnergyFlow({row,now,paused=false}:{row?:SafeVrmPower;now:number;paused?:boolean}){
 const solar=selectReading(row,'solar_power',now),load=selectReading(row,'load_power',now);
 const flowing=(reading:typeof solar)=>!paused&&!row?.errorCode&&Boolean(reading&&readingIsFresh(reading,now)&&reading.value>0);
 const label=(reading:typeof solar)=>reading?reading.value.toLocaleString(undefined,{maximumFractionDigits:1})+' '+reading.unit:'Not reported';
 return <div className='cos-energy-flow' aria-label='Saved solar and DC power flow'>
  <div className='cos-energy-node'><span aria-hidden='true'>☀</span><small>Solar</small><strong>{label(solar)}</strong></div>
  <div className={'cos-energy-line'+(flowing(solar)?' is-flowing':'')} aria-hidden='true'><i/><i/><i/></div>
  <div className='cos-energy-node cos-energy-hub'><span aria-hidden='true'>▰</span><small>Helios energy</small><strong>Victron</strong></div>
  <div className={'cos-energy-line'+(flowing(load)?' is-flowing':'')} aria-hidden='true'><i/><i/><i/></div>
  <div className='cos-energy-node'><span aria-hidden='true'>⚡</span><small>DC load</small><strong>{label(load)}</strong></div>
  <small className='cos-energy-flow-caption'>{paused||row?.errorCode?'Saved power · refresh unavailable':!solar&&!load?'Waiting for saved power': [solar,load].some(r=>r&&!readingIsFresh(r,now))?'Stale saved power · animation paused':'Saved power · follows fleet sync'}</small>
 </div>;
}
