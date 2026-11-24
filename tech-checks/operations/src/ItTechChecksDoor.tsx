import {useEffect, useRef} from 'react';

/**
 * Tech Check in the IT view.
 *
 * James: "i clicked tech check on the IT board and it is showing return to my
 * IT tech checks. it needs to be perfect."
 *
 * An IT sign-in keeps its tech checks in the Tech Check app around this frame,
 * so this tab used to ask to be told twice: a page whose only content was a
 * button back to where the tab was already going. It goes there by itself now.
 * The button stays for the one case left: the frame did not take the message,
 * so nothing happened.
 */
export default function ItTechChecksDoor({open}: {open: () => void}) {
  const asked = useRef(false);
  useEffect(() => { if (asked.current) return; asked.current = true; open(); }, [open]);
  return <section className='panel module'>
    <h2>IT Tech Checks</h2>
    <p role='status'>Opening your IT tech checks…</p>
    <button type='button' onClick={open}>Open my IT Tech Checks</button>
  </section>;
}
