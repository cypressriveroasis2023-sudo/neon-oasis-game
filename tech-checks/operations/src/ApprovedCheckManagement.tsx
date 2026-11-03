import {useRef,type ReactNode} from 'react';
import './approvedCheckManagement.css';

/** Presentation only: the caller owns the original check destinations and callbacks. */
export default function ApprovedCheckManagement({children}:{children:ReactNode}) {
  const disclosure=useRef<HTMLDetailsElement>(null);
  return <details className='cos-approved-tool-group cos-approved-check-management' ref={disclosure}
    onKeyDown={event=>{
      if(event.key==='Escape'&&disclosure.current?.open){
        event.preventDefault();event.stopPropagation();
        disclosure.current.open=false;
        disclosure.current.querySelector<HTMLElement>('summary')?.focus();
      }
    }}>
    <summary>Manage Tech Checks</summary>
    {children}
  </details>;
}
