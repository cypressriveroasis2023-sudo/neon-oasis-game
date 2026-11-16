// The card at the top of the board: what needs a person, worst first.
import type {NeedsYouRow,NeedsYouTone} from './fleetNeedsYou';

const TONE_LABEL:Record<NeedsYouTone,string>={down:'Down',partial:'Partly down'};

export default function FleetNeedsYou({rows,total,unchecked=0,onPick}:{
 rows:NeedsYouRow[];total:number;unchecked?:number;onPick?:(unit:string)=>void;
}){
 // Said once, the same way, whether or not anything is wrong: a unit that
 // could not be checked is not known to be faulty and is not a job.
 const uncheckedNote=unchecked>0?<p className='cos-needs-you-unchecked'>
  {unchecked} field {unchecked===1?'unit was':'units were'} not checked. Not known to be faulty; nobody needs to drive out for these.
 </p>:null;
 if(!rows.length)return <section className='cos-needs-you cos-needs-you-clear' aria-label='Units needing attention'>
  <p><strong>Nothing needs you.</strong> Every field unit the app could check reported its cameras up.</p>
  {uncheckedNote}
 </section>;
 return <section className='cos-needs-you' aria-label='Units needing attention'>
  <header className='cos-motion-sweep'>
   <span className='cos-needs-you-title'>NEEDS YOU</span>
   <span className='cos-needs-you-count'>{total}</span>
  </header>
  <ul>
   {rows.map((row,index)=><li key={row.unit} className={'cos-motion-rise cos-needs-tone-'+row.tone}
    style={{animationDelay:index*60+'ms'}}>
    <button type='button' onClick={()=>onPick?.(row.unit)}>
     <i className={'cos-needs-dot'+(row.tone==='down'?' cos-motion-pulse':'')} aria-hidden='true'/>
     <span className='cos-needs-you-body'>
      <span className='cos-needs-you-unit'>{row.name}</span>
      <span className='cos-needs-you-where'>{row.site} · {row.detail}</span>
     </span>
     <span className='cos-needs-you-state'>{TONE_LABEL[row.tone]}</span>
     <span aria-hidden='true' className='cos-needs-you-go'>›</span>
    </button>
   </li>)}
  </ul>
  {total>rows.length&&<p className='cos-needs-you-more'>{total-rows.length} more below.</p>}
  {uncheckedNote}
 </section>;
}
