import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from './api';
import {createOperationsSessionRecovery, guardSessionCallback, type SessionRecoveryState} from './operationsSessionRecovery';
import {boardSessionHold,tvSessionHold} from './tvSessionHold';

export function useOperationsSession(onInvalidated: (reason?: unknown, detail?: {path?: string}) => void) {
  const [state, setState] = useState<SessionRecoveryState>({session:null, checking:true, error:'', reloadRequired:false, generation:0});
  const controller = useRef<ReturnType<typeof createOperationsSessionRecovery> | null>(null);
  const clearView = useRef(onInvalidated);
  clearView.current = onInvalidated;
  useEffect(() => {
    const current = createOperationsSessionRecovery({
      read: async () => (await api.get('/api/session')).data,
      mode: () => new URLSearchParams(location.search).get('mode') || '',
      changed: setState,
    });
    controller.current = current;
    const invalidate = (event: Event) => {
      const detail=(event as CustomEvent<{reason?: unknown; path?: string}>).detail;
      const reason=detail?.reason;
      const path=typeof detail?.path==='string'?detail.path:'';
      if((tvSessionHold()||boardSessionHold())&&reason==='authentication-denied'&&path&&path!=='/api/session'){
        current.quietRefresh();
        clearView.current(reason, detail);
        return;
      }
      current.invalidate(reason);
      clearView.current(reason, detail);
    };
    const leave = () => { current.invalidate('security-hide'); clearView.current('security-hide'); };
    // A bfcache restore retains the terminal security-hide controller. Start a
    // fresh document and normal parent/server verification; never revive it.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
    const hidden = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === window.parent && event.data?.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE' && current.hide()) clearView.current('security-hide');
    };
    window.addEventListener('cos-private-data-invalidated', invalidate);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    window.addEventListener('message', hidden);
    void current.check();
    return () => {
      current.stop();
      if (controller.current === current) controller.current = null;
      window.removeEventListener('cos-private-data-invalidated', invalidate);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('message', hidden);
    };
  }, []);
  const check = useCallback(() => controller.current?.check(), []);
  const isCurrent = useCallback((generation: number) => controller.current?.isCurrent(generation) === true, []);
  const guardCurrent = useCallback(<Args extends unknown[]>(callback: (...args: Args) => void) => guardSessionCallback(isCurrent, state.generation, callback), [isCurrent, state.generation]);
  return {...state, check, guardCurrent};
}
