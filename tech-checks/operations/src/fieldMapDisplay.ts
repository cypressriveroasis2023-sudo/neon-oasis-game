import { useEffect, useRef, useState, type RefObject } from 'react';

/** Keep fallback fullscreen as isolated as native fullscreen, including keyboard access. */
export function isolateMapDisplay(element: HTMLElement) {
  const siblings: {element: HTMLElement; visibility: string; pointerEvents: string; inert: boolean; aria: string|null}[] = [];
  for (let child: HTMLElement|null = element; child?.parentElement; child = child.parentElement) {
    for (const sibling of Array.from(child.parentElement.children)) {
      if (sibling === child || !(sibling instanceof HTMLElement)) continue;
      siblings.push({element:sibling,visibility:sibling.style.visibility,pointerEvents:sibling.style.pointerEvents,inert:sibling.inert,aria:sibling.getAttribute('aria-hidden')});
      sibling.style.visibility='hidden';sibling.style.pointerEvents='none';sibling.inert=true;sibling.setAttribute('aria-hidden','true');
    }
  }
  const overflow = document.body.style.overflow, rootOverflow = document.documentElement.style.overflow;
  document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
  return () => {
    for (const saved of siblings) {
      saved.element.style.visibility=saved.visibility;saved.element.style.pointerEvents=saved.pointerEvents;saved.element.inert=saved.inert;
      if(saved.aria===null)saved.element.removeAttribute('aria-hidden');else saved.element.setAttribute('aria-hidden',saved.aria);
    }
    document.body.style.overflow=overflow;document.documentElement.style.overflow=rootOverflow;
  };
}

export function useFieldMapDisplay(workspace: RefObject<HTMLElement|null>, readView:()=>unknown) {
  const [active,setActive]=useState(false);
  const activeRef=useRef(false), nativeRef=useRef(false), historyToken=useRef('');
  const opener=useRef<HTMLElement|null>(null);
  const readViewRef=useRef(readView);readViewRef.current=readView;
  const entryHash=useRef(''),pendingView=useRef<unknown>(null),traversing=useRef(false);
  const restoreView=()=>{if(pendingView.current&&location.hash===entryHash.current)history.replaceState({...history.state,cosFieldMapView:pendingView.current},'');pendingView.current=null;};
  const exit=()=>{
    if(!activeRef.current)return;
    pendingView.current=readViewRef.current();
    activeRef.current=false;setActive(false);
    if(document.fullscreenElement===workspace.current)void document.exitFullscreen().catch(()=>{});
    if(historyToken.current&&history.state?.cosFieldMapDisplay===historyToken.current){traversing.current=true;history.back();}else restoreView();
    historyToken.current='';
  };
  useEffect(()=>{
    const changed=()=>{if(document.fullscreenElement===workspace.current)nativeRef.current=true;else if(nativeRef.current){nativeRef.current=false;exit();}};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&activeRef.current){event.preventDefault();exit();}};
    const back=()=>{traversing.current=false;if(activeRef.current&&history.state?.cosFieldMapDisplay!==historyToken.current){historyToken.current='';exit();}else if(!activeRef.current)restoreView();};
    document.addEventListener('fullscreenchange',changed);document.addEventListener('keydown',escape);window.addEventListener('popstate',back);
    return()=>{document.removeEventListener('fullscreenchange',changed);document.removeEventListener('keydown',escape);window.removeEventListener('popstate',back);if(historyToken.current&&history.state?.cosFieldMapDisplay===historyToken.current){const {cosFieldMapDisplay,...state}=history.state;history.replaceState(state,'');}};
  },[]);
  useEffect(()=>{
    if(window.parent!==window)window.parent.postMessage({type:'COS_FIELD_MAP_DISPLAY_MODE',active},window.location.origin);
    if(!active||!workspace.current)return;
    const restore=isolateMapDisplay(workspace.current);
    workspace.current.querySelector<HTMLButtonElement>('.field-map-fullscreen-exit')?.focus({preventScroll:true});
    return()=>{
      restore();opener.current?.isConnected&&opener.current.focus({preventScroll:true});
      if(window.parent!==window)window.parent.postMessage({type:'COS_FIELD_MAP_DISPLAY_MODE',active:false},window.location.origin);
    };
  },[active]);
  const toggle=()=>{
    if(traversing.current)return;
    if(activeRef.current){exit();return;}
    opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    entryHash.current=location.hash;
    historyToken.current='field-map-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    history.pushState({...history.state,cosFieldMapDisplay:historyToken.current},'');
    activeRef.current=true;setActive(true);
    // iPhone Safari and embedded frames can reject or omit this API; the same map-only layout remains available.
    try{void workspace.current?.requestFullscreen?.().then(()=>{if(!activeRef.current&&document.fullscreenElement===workspace.current)void document.exitFullscreen().catch(()=>{});}).catch(()=>{});}catch{/* Presentation fallback. */}
  };
  return {active,toggle};
}
