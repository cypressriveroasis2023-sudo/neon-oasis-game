import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {readingIsFresh,selectReading} from './vrmReadOnlyModel';

/** Fine line icons in the node's own colour. Decorative. */
const FlowIcon=({d}:{d:string})=><svg viewBox='0 0 24 24' focusable='false'><path d={d}/></svg>;

/** Motion represents fresh reported power, never a simulated reading. */
export default function VrmEnergyFlow({row,now,paused=false}:{row?:SafeVrmPower;now:number;paused?:boolean}){
 const solar=selectReading(row,'solar_power',now),load=selectReading(row,'load_power',now);
 const flowing=(reading:typeof solar)=>!paused&&!row?.errorCode&&Boolean(reading&&readingIsFresh(reading,now)&&reading.value>0);
 const label=(reading:typeof solar)=>reading?reading.value.toLocaleString(undefined,{maximumFractionDigits:1})+' '+reading.unit:'Not reported';
 return <div className='cos-energy-flow' aria-label='Saved solar and DC power flow'>
  <div className='cos-energy-node'><span aria-hidden='true'><FlowIcon d='M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9ZM12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6'/></span><small>Solar</small><strong>{label(solar)}</strong></div>
  <div className={'cos-energy-line'+(flowing(solar)?' is-flowing':'')} aria-hidden='true'><i/><i/><i/></div>
  <div className='cos-energy-node cos-energy-hub'><span aria-hidden='true'><FlowIcon d='M4 8h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM21.5 10.5v3M6.5 11v2M9.5 11v2M12.5 11v2'/></span><small>Helios energy</small><strong>Victron</strong></div>
  <div className={'cos-energy-line'+(flowing(load)?' is-flowing':'')} aria-hidden='true'><i/><i/><i/></div>
  <div className='cos-energy-node'><span aria-hidden='true'><FlowIcon d='M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z'/></span><small>DC load</small><strong>{label(load)}</strong></div>
  <small className='cos-energy-flow-caption'>{paused||row?.errorCode?'Saved power · refresh unavailable':!solar&&!load?'Waiting for saved power': [solar,load].some(r=>r&&!readingIsFresh(r,now))?'Stale saved power · animation paused':'Saved power · follows fleet sync'}</small>
 </div>;
}
