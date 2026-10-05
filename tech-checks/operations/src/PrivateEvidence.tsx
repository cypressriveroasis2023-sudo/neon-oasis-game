import { useCallback, useEffect, useRef, useState } from 'react';

type Reader = { get(path: string): Promise<{ data: unknown }> };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export function evidenceDocumentId(value: unknown, documentId?: unknown): string | null {
  if (typeof documentId === 'string' && ID.test(documentId)) return documentId.toLowerCase();
  if (typeof value !== 'string') return null;
  const match = /^\/api\/evidence\/([0-9a-f-]+)$/i.exec(value);
  return match && ID.test(match[1]) ? match[1].toLowerCase() : null;
}
function evidenceBlob(value: unknown, id: string): Blob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preview response.');
  const data = value as Record<string, unknown>;
  if (data.documentId !== id || typeof data.contentType !== 'string' || !RASTER.has(data.contentType) ||
      typeof data.byteLength !== 'number' || !Number.isSafeInteger(data.byteLength) || data.byteLength <= 0 || data.byteLength > MAX_BYTES ||
      typeof data.content !== 'string' || data.content.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.content)) {
    throw new Error('Invalid preview response.');
  }
  const binary = atob(data.content);
  if (binary.length !== data.byteLength) throw new Error('Incomplete preview response.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Blob([bytes], { type: data.contentType });
}
export default function PrivateEvidence({ api, value, documentId, label = 'photo' }: {
  api: Reader; value?: unknown; documentId?: unknown; label?: string;
}) {
  const id = evidenceDocumentId(value, documentId);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const objectUrl = useRef<string | null>(null);
  const sequence = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    sequence.current += 1;
    busy.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setUrl(null);
    setStatus('idle');
    setMessage('');
  }, []);
  useEffect(() => {
    clear();
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    const parentHidden = (event: MessageEvent) => {
      if (window.parent !== window && event.source === window.parent && event.origin === location.origin &&
          event.data?.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE') clear();
    };
    window.addEventListener('message', parentHidden);
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      sequence.current += 1;
      busy.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      window.removeEventListener('message', parentHidden);
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [id, clear]);
  const load = async () => {
    if (!id || busy.current) return;
    clear();
    busy.current = true;
    const request = ++sequence.current;
    setStatus('loading');
    try {
      const result = await api.get('/api/evidence/' + id);
      if (request !== sequence.current) return;
      const blob = evidenceBlob(result.data, id);
      objectUrl.current = URL.createObjectURL(blob);
      setUrl(objectUrl.current);
      setStatus('ready');
      timer.current = setTimeout(() => { clear(); setMessage('Preview closed. Open it again to recheck access.'); }, 60000);
    } catch (cause) {
      if (request !== sequence.current) return;
      const response = cause as { response?: { status?: number; data?: { error?: string } } };
      const code = response.response?.status;
      setMessage(code === 401 ? 'Your sign-in expired. Sign in again to view evidence.' :
        code === 403 ? 'Your account no longer has permission to view this evidence.' :
        code === 404 ? 'The evidence file is unavailable. Its record is preserved.' :
        code === 413 ? 'This file is larger than the private preview limit (4 MiB). Its record is preserved.' :
        code === 415 ? 'This file cannot be shown in the private image preview. Its record is preserved.' :
        'The evidence preview could not be loaded. Retry to check the saved file.');
      setStatus('error');
    } finally { if (request === sequence.current) busy.current = false; }
  };
  if (!id) return <span className='owner-photo-missing'>{label === 'signature' ? 'Signature recorded; file link unavailable.' : 'Photo preserved; file link unavailable.'}</span>;
  return <span className='private-evidence' style={{ display: 'block', maxWidth: '100%', overflowWrap: 'anywhere' }}>
    {url && <img src={url} alt={'Saved ' + label} style={{ display: 'block', width: '100%', height: 'auto', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} onError={() => {
      clear(); setStatus('error'); setMessage('The saved image could not be decoded. Its record is preserved.');
    }}/>}
    {status !== 'ready' && <button type='button' disabled={status === 'loading'} onClick={() => void load()}>
      {status === 'loading' ? 'Loading ' + label + '…' : (status === 'error' ? 'Retry ' : 'View ') + label}
    </button>}
    {(status === 'loading' || status === 'ready') && <button type='button' onClick={clear}>Close {label}</button>}
    {message && <span role={status === 'error' ? 'alert' : 'status'} style={{ display: 'block' }}>{message}</span>}
    {status === 'ready' && <small style={{ display: 'block' }}>Private preview · closes after 1 minute</small>}
  </span>;
}
