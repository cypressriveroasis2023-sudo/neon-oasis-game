// One button, eight answers, and the thing to do next.
import {useState} from 'react';
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {troubleshootUnit,type CheckVerdict,type UnitCheck} from './unitTroubleshoot';

const MARK:Record<CheckVerdict,string>={pass:'✓',fail:'✗',warn:'!',unknown:'?'};
// Written out beside every mark: the colour and the glyph are never the only cue.
const SAID:Record<CheckVerdict,string>={pass:'Pass',fail:'Fail',warn:'Check',unknown:'Not checked'};

export default function UnitTroubleshoot({unit,evidence,onAction}:{
 unit:UnitCameraStatus;
 evidence?:Parameters<typeof troubleshootUnit>[1];
 onAction?:(actionId:string,unit:UnitCameraStatus)=>void;
}){
 const [result,setResult]=useState<ReturnType<typeof troubleshootUnit>|null>(null);
 const [ranAt,setRanAt]=useState('');
 const run=()=>{
  setResult(troubleshootUnit(unit,evidence||{}));
  setRanAt(new Date().toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}));
 };
 return <section className='cos-troubleshoot' aria-label={'Troubleshoot '+unit.unit}>
  <button type='button' className='cos-troubleshoot-run cos-motion-sweep' onClick={run}>
   {result?'RUN AGAIN':'TROUBLESHOOT'}
  </button>
  {result&&<>
   <div className='cos-troubleshoot-head'>
    <span>RESULTS</span>
    <span>ran {ranAt} · {result.checks.length} checks{result.unknowns?' · '+result.unknowns+' not checked':''}</span>
   </div>
   <ul className='cos-troubleshoot-checks'>
    {result.checks.map((check:UnitCheck,index:number)=>
     <li key={check.id} className={'cos-motion-rise cos-check-'+check.verdict} style={{animationDelay:index*40+'ms'}}>
      <i className='cos-check-mark' aria-hidden='true'>{MARK[check.verdict]}</i>
      <span className='cos-check-body'>
       <span className='cos-check-label'><b className='cos-check-step'>{index+1}</b>{check.label}</span>
       <span className='cos-check-detail'>{check.detail}</span>
      </span>
      <span className='cos-check-said'>{SAID[check.verdict]}</span>
      {check.action&&<button type='button' className='cos-check-action'
       onClick={()=>onAction?.(check.action!.id,unit)}>{check.action.label}</button>}
     </li>)}
   </ul>
   <div className='cos-troubleshoot-advice'>
    <span className='cos-troubleshoot-advice-title'>WHAT TO DO</span>
    <p>{result.advice}</p>
   </div>
  </>}
 </section>;
}
