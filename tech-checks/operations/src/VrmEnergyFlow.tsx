import type {SafeVrmPower} from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import {readingIsFresh,selectReading} from './vrmReadOnlyModel';

/** Fine line icons in the node's own colour. Decorative. */
const FlowIcon=({d}:{d:string})=><svg viewBox='0 0 24 24' focusable='false'><path d={d}/></svg>;
const SUN='M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9ZM12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6';
const BOLT='M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z';
const w=(v:number)=>Math.round(Math.abs(v))+' W';

/** Solar → battery → load, with the battery in the middle. Motion only shows fresh reported power, never a
 * simulated reading: a slow, continuous glow along each line, still when stale, paused, failed or zero. */
export default function VrmEnergyFlow({row,now,paused=false}:{row?:SafeVrmPower;now:number;paused?:boolean}){
 const solar=selectReading(row,'solar_power',now),load=selectReading(row,'load_power',now);
 const soc=selectReading(row,'battery_soc',now),batt=selectReading(row,'battery_power',now);
 const live=(r:typeof solar)=>!paused&&!row?.errorCode&&Boolean(r&&readingIsFresh(r,now));
 const flowing=(r:typeof solar)=>live(r)&&Boolean(r&&r.value>0);
 const label=(r:typeof solar)=>r?r.value.toLocaleString(undefined,{maximumFractionDigits:1})+' '+r.unit:'Not reported';
 const bw=live(batt)?batt!.value:null, sw=live(solar)?solar!.value:null, lw=live(load)?load!.value:null;
 const full=live(soc)&&soc!.value>=99.5&&(bw===null||Math.abs(bw)<10);
 const state=bw===null?'':full?'Full':bw>=10?'Charging':bw<=-10?'On battery':'Holding';
 const fromBattery=bw!==null&&bw<=-10;
 const story=!state?'':full?(sw&&sw>5?'Battery full. The sun is covering the '+(lw!==null?w(lw)+' ':'')+'load.':'Battery full.')
  :state==='Charging'?'The sun is covering the '+(lw!==null?w(lw)+' ':'')+'load and putting '+w(bw!)+' into the battery.'
  :state==='On battery'?(sw&&sw>5?'Not enough sun yet: the battery is making up '+w(bw!)+'.':'Running on battery: '+w(bw!)+' out, no sun.')
  :'Sun and load are about even.';
 return <div className={'cos-energy-flow'+(fromBattery?' is-on-battery':'')} aria-label='Saved solar, battery and DC power flow'>
  <div className='cos-energy-node'><span aria-hidden='true'><FlowIcon d={SUN}/></span><small>Solar</small><strong>{label(solar)}</strong></div>
  <div className={'cos-energy-line cos-energy-in'+(flowing(solar)?' is-flowing':'')} aria-hidden='true'><i/></div>
  <div className={'cos-energy-node cos-energy-hub'+(state?' is-'+state.toLowerCase().replace(' ','-'):'')}>
   <span aria-hidden='true' className='cos-energy-soc' style={soc?{['--soc' as string]:Math.max(0,Math.min(100,soc.value))+'%'}:undefined}><b>{soc?Math.round(soc.value):'–'}</b><em>%</em></span>
   <small>Battery</small><strong>{state||'Victron'}</strong></div>
  <div className={'cos-energy-line cos-energy-out'+(flowing(load)?' is-flowing':'')} aria-hidden='true'><i/></div>
  <div className='cos-energy-node'><span aria-hidden='true'><FlowIcon d={BOLT}/></span><small>DC load</small><strong>{label(load)}</strong></div>
  {story&&<p className='cos-energy-story'>{story}</p>}
  <small className='cos-energy-flow-caption'>{paused||row?.errorCode?'Saved power · refresh unavailable':!solar&&!load?'Waiting for saved power': [solar,load].some(r=>r&&!readingIsFresh(r,now))?'Stale saved power · animation paused':'Saved power · follows fleet sync'}</small>
 </div>;
}
