import {Children,isValidElement,useRef,type ReactElement,type ReactNode} from 'react';
import './approvedFleetViews.css';

type ViewButton = ReactElement<{'aria-current'?:string;children?:ReactNode}>;

/** Group existing view buttons only. Their eligibility, values and callbacks remain in FleetDashboard. */
export default function ApprovedFleetViews({children,compact=false}:{children:ReactNode;compact?:boolean}) {
 const disclosure=useRef<HTMLDetailsElement>(null);
 const buttons=Children.toArray(children);
 // Map, Fleet health and Camera status stay on the bar; the rest sit under More fleet tools.
 const primary=buttons.slice(0,3);
 const secondary=buttons.slice(3);
 const selected=secondary.find((button):button is ViewButton=>isValidElement<ViewButton['props']>(button)&&button.props['aria-current']==='page');
 const close=(returnFocus=false)=>{
  const element=disclosure.current;
  if(!element?.open)return;
  element.open=false;
  if(returnFocus)element.querySelector<HTMLElement>('summary')?.focus();
 };
 return <nav className={'cos-fleet-tabs'+(compact?' cos-approved-fleet-views':'')} aria-label='Fleet dashboard views'
  onClick={event=>{
   const target=event.target;
   if(!(target instanceof Element))return;
   const button=target.closest('button');
   if(button&&!button.disabled&&!event.defaultPrevented)close(Boolean(disclosure.current?.contains(button)));
  }}>
  {!compact?children:<>{primary}{secondary.length>0&&<details ref={disclosure} className='cos-approved-fleet-tools'
   onKeyDown={event=>{if(event.key==='Escape'&&disclosure.current?.open){event.preventDefault();event.stopPropagation();close(true);}}}
   onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))close();}}>
   <summary aria-label='More fleet tools' aria-current={selected?'page':undefined}>
    <span>More fleet tools</span>{selected&&<small>{selected.props.children}</small>}
   </summary>
   <div className='cos-approved-fleet-tool-buttons'>{secondary}</div>
  </details>}</>}
 </nav>;
}
