// Presentation only. Callers validate the active authenticated frame and origin.
const expanded = new WeakMap();
export function setFieldMapDisplay(frame, active) {
  if (!frame) return;
  const saved = expanded.get(frame);
  if (!active) {
    if (saved) { frame.style.cssText = saved.style; document.body.style.overflow = saved.overflow; expanded.delete(frame); }
    return;
  }
  if (!saved) expanded.set(frame, {style: frame.style.cssText, overflow: document.body.style.overflow});
  Object.assign(frame.style, {position:'fixed',inset:'0',width:'100vw',height:'100dvh',maxHeight:'none',border:'0',zIndex:'2147483646',background:'#09121f'});
  document.body.style.overflow = 'hidden';
}
