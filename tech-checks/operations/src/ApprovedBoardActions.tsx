import {Children,useRef,type ReactNode} from 'react';
import './approvedBoardActions.css';

/** The final child is the existing workspace link; preceding children are existing management actions.
 * Eligibility, disabled states, confirmations and callbacks remain in DailyBoard. */
export default function ApprovedBoardActions({children}:{children:ReactNode}) {
  const disclosure=useRef<HTMLDetailsElement>(null);
  const actions=Children.toArray(children);
  const workspace=actions.at(-1);
  const management=actions.slice(0,-1);
  return <div className='cos-approved-board-actions'>
    <div className='daily-board-actions'>{workspace}</div>
    {management.length>0&&<details className='cos-approved-board-management' ref={disclosure}
      onKeyDown={event=>{
        if(event.key==='Escape'&&disclosure.current?.open){
          event.preventDefault();event.stopPropagation();
          disclosure.current.open=false;
          disclosure.current.querySelector<HTMLElement>('summary')?.focus();
        }
      }}>
      <summary>Manage this work</summary>
      <p>Existing scheduling and job-management actions. Review the saved work details before making changes.</p>
      <div className='daily-board-actions'>{management}</div>
    </details>}
  </div>;
}
