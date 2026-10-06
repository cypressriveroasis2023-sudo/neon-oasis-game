import { useEffect, useRef, useState } from 'react';

/** Presentation-only navigation. Callers retain their existing role and API gates. */
export default function WorkspaceMenu({ items, navigate }: {
  items: string[];
  navigate: (workspace: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === 'Tab') {
        const controls = panel.current?.querySelectorAll<HTMLButtonElement>('button');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard);
      trigger.current?.focus();
    };
  }, [open]);

  return <div className='cos-workspace-menu'>
    <button ref={trigger} type='button' aria-expanded={open} onClick={() => setOpen(true)}>☰ Menu</button>
    {open && <div className='cos-workspace-menu-overlay' onClick={event => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <div ref={panel} className='cos-workspace-menu-sheet' role='dialog' aria-modal='true' aria-label='Workspace menu'>
        <header><div><small>VISION · CAMERAS ONSITE</small><h2>All your tools</h2></div><button type='button' onClick={() => setOpen(false)}>Close menu</button></header>
        <nav aria-label='Available workspaces'>{items.map(name => <button type='button' key={name} onClick={() => {
          setOpen(false);
          navigate(name);
        }}>{name}</button>)}</nav>
      </div>
    </div>}
  </div>;
}
