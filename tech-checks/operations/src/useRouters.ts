import {automaticRefreshDue} from './refreshCadence';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { readRouterSnapshot, type RouterSnapshot } from '../../supabase/functions/cos-operations-pages/routers';
export function useRouters() {
  const [data, setData] = useState<RouterSnapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [now, setNow] = useState(Date.now());
  const revision = useRef(0), running = useRef(false), lastAttemptAt = useRef(0);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true; lastAttemptAt.current = Date.now(); const request = ++revision.current; setLoading(true);
    try { const next = readRouterSnapshot((await api.get('/api/routers')).data); if (revision.current === request) { setData(next); setError(''); setNow(Date.now()); } }
    catch (cause) {
      if (revision.current === request) {
        const status = (cause as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) setData(null);
        setError(cause instanceof Error ? cause.message : 'Router inventory could not be loaded.');
      }
    } finally { if (revision.current === request) { running.current = false; setLoading(false); } }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); if (automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden)) void refresh(); }, 60000);
    const visible = () => { if (!document.hidden) { setNow(Date.now()); if (automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden)) void refresh(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { revision.current++; running.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  return { data, error, loading, refresh, now };
}
