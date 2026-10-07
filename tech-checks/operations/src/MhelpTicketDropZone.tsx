import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { chooseMhelpParser, hashTicketFile, verifiedMhelpParsers, type MhelpExtraction, type MhelpParser } from './mhelpImportModel';
import './mhelpTicketDrop.css';

/** Isolated pending a validated export parser and the dedicated import backend. */
export default function MhelpTicketDropZone({ parsers = verifiedMhelpParsers, disabled = false, onExtracted, captureBoardDrops = false }: {
  parsers?: readonly MhelpParser[];
  disabled?: boolean;
  captureBoardDrops?: boolean;
  /** The original is retained for staging; extraction alone never saves or deletes. */
  onExtracted: (value: { file: File; sha256: string; parserId: string; parserVersion: string; extraction: MhelpExtraction }) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (disabled) { sequence.current++; active.current?.abort(); active.current = null; setBusy(false); setDragging(false); }
  }, [disabled]);
  const cancel = () => { sequence.current++; active.current?.abort(); active.current = null; setBusy(false); setName(''); setError(''); };
  const read = async (files: File[]) => {
    if (disabled || active.current) return;
    setError('');
    if (files.length !== 1) { setError('Drop one ticket file at a time. No ticket was imported.'); return; }
    const file = files[0];
    const current = ++sequence.current;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setName(file.name);
    try {
      const parser = chooseMhelpParser(file, parsers);
      const sha256 = await hashTicketFile(file);
      if (controller.signal.aborted) return;
      const extraction = await parser.parse(file, controller.signal);
      if (!mounted.current || current !== sequence.current || controller.signal.aborted) return;
      onExtracted({ file, sha256, parserId: parser.id, parserVersion: parser.version, extraction });
    } catch (cause) {
      if (mounted.current && current === sequence.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The ticket could not be read. Keep the original file.');
    } finally {
      if (mounted.current && current === sequence.current) { active.current = null; setBusy(false); }
    }
  };
  const fileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const enabled = !disabled && !busy && parsers.length > 0;
  // This component is mounted only on Dispatch Board. File drops elsewhere on
  // that board enter the same review flow rather than navigating the browser.
  useEffect(() => {
    if (!captureBoardDrops) return;
    const over = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      setDragging(enabled);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      const alreadyHandled = event.defaultPrevented;
      event.preventDefault(); setDragging(false);
      if (!alreadyHandled && enabled) void read(Array.from(event.dataTransfer?.files || []));
    };
    window.addEventListener('dragover',over); window.addEventListener('drop',drop);
    return () => { window.removeEventListener('dragover',over); window.removeEventListener('drop',drop); };
  });
  return <section className={'mhelp-ticket-drop' + (dragging ? ' mhelp-ticket-drop-active' : '')} aria-label='Import mHelpDesk ticket'
    onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'; setDragging(enabled); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => {
      if (!fileDrag(event)) return;
      event.preventDefault(); setDragging(false);
      if (enabled) void read(Array.from(event.dataTransfer.files));
    }}>
    <h3>Drop an mHelpDesk ticket</h3>
    <p>Extract the details into a draft, then review the customer, site and work before saving.</p>
    <input ref={input} id={inputId} type='file' disabled={!enabled} hidden accept={parsers.flatMap(parser => parser.extensions).join(',')}
      onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) void read(files); }}/>
    <button type='button' className='secondary' disabled={!enabled} aria-controls={inputId} onClick={() => input.current?.click()}>Choose ticket file</button>
    {busy && <><p role='status'>Reading {name}…</p><button type='button' className='secondary' onClick={cancel}>Cancel reading</button></>}
    {error && <p role='alert'>{error}</p>}
    {!parsers.length && <p role='status'>Ticket import is awaiting a verified sample format.</p>}
    <p className='mhelp-ticket-drop-note'>Your device’s original file stays where it is. Only the imported app copy can move to recoverable trash after the complete saved ticket is verified.</p>
  </section>;
}
