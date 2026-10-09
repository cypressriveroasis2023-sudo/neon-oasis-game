// Presentation only. Callers validate the active authenticated frame and origin.
const expanded = new WeakMap();
export function setFieldMapDisplay(frame, active) {
  if (!frame) return;
  const saved = expanded.get(frame);
  if (!active) {
    if (saved) { frame.style.cssText = saved.style; document.body.style.overflow = saved.overflow; for (const item of saved.obscured) { item.node.style.visibility=item.visibility; item.node.style.pointerEvents=item.pointerEvents; item.node.inert=item.inert; } expanded.delete(frame); }
    return;
  }
  if (!saved) {
    const obscured=[];
    for (let child=frame; child?.parentElement; child=child.parentElement) {
      for (const node of Array.from(child.parentElement.children)) {
        if (node===child||!node.style) continue;
        obscured.push({node,visibility:node.style.visibility,pointerEvents:node.style.pointerEvents,inert:node.inert});
        node.style.visibility='hidden';node.style.pointerEvents='none';node.inert=true;
      }
    }
    expanded.set(frame, {style: frame.style.cssText, overflow: document.body.style.overflow, obscured});
  }
  Object.assign(frame.style, {position:'fixed',inset:'0',width:'100vw',height:'100dvh',minWidth:'0',maxWidth:'none',maxHeight:'none',margin:'0',padding:'0',boxSizing:'border-box',border:'0',zIndex:'2147483646',background:'#09121f'});
  document.body.style.overflow = 'hidden';
}
