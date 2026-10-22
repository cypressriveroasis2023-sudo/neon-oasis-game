export type OperationsSession = Record<string, any>;
export type SessionRecoveryState = {
  session: OperationsSession | null;
  checking: boolean;
  error: string;
  reloadRequired: boolean;
  generation: number;
};
export const SESSION_VERIFICATION_TIMEOUT_MS = 45000;
export const SESSION_RECOVERY_RETRY_MS = 30000;
class SessionVerificationTimeout extends Error {}
function temporaryFailure(cause: unknown): boolean {
  const status = (cause as {response?: {status?: unknown}})?.response?.status;
  return cause instanceof SessionVerificationTimeout || cause instanceof TypeError ||
    typeof status === 'number' && (status === 408 || status === 429 || status >= 500 && status <= 599);
}
const reloadMessage = 'Your session changed. Reload COS Operations to verify your account and permissions.';
const transientReasons = new Set(['token-renewed', 'parent-timeout']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the server's verified Owner identity can establish same-actor recovery.
// IT's current session DTO has no stable actor ID; names and token claims cannot substitute.
export function ownerSessionFingerprint(session: OperationsSession | null, mode: string): string | null {
  if (!session || session.authorized !== true || session.legacyOwner !== true || session.role !== 'Owner' ||
      typeof session.productionOwnerUserId !== 'string' || !uuid.test(session.productionOwnerUserId)) return null;
  const features = session.features;
  if (!features || typeof features !== 'object' || Array.isArray(features)) return null;
  const keys = Object.keys(features).sort();
  if (!keys.length || keys.some(key => typeof features[key] !== 'boolean')) return null;
  return JSON.stringify([session.productionOwnerUserId, session.legacyOwner, session.role, mode,
    keys.map(key => [key, features[key]])]);
}

/** Read-only revalidation, with every private view fenced by the same epoch.
 * One overlapping token renewal may restart verification; other transitions require reload.
 * Temporary transport failures stay quarantined and retry only the session read.
 * Previously submitted writes are never replayed. */
export function createOperationsSessionRecovery({read, mode, changed, defer = callback => setTimeout(callback, 0)}: {
  read: () => Promise<OperationsSession>;
  mode: () => string;
  changed: (state: SessionRecoveryState) => void;
  defer?: (callback: () => void) => void;
}) {
  let active = true, epoch = 0, baseline: string | null = null, verifiedMode: string | null = null;
  let verificationTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let renewalRestarted = false;
  let phase: 'idle' | 'queued' | 'verifying' | 'waiting' = 'idle';
  let state: SessionRecoveryState = {session:null, checking:true, error:'', reloadRequired:false, generation:0};
  const publish = (next: SessionRecoveryState) => { state = next; if (active) changed(state); };
  const blocked = () => {
    clearTimeout(retryTimer); retryTimer = undefined;
    phase = 'idle';
    publish({...state, session:null, checking:false, error:reloadMessage, reloadRequired:true});
  };
  const retry = () => {
    clearTimeout(retryTimer);
    phase = 'waiting';
    publish({...state, session:null, checking:true, error:'Connection interrupted. COS will reconnect automatically. Keep this window open.'});
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (active && phase === 'waiting' && !state.reloadRequired) void verify(true);
    }, SESSION_RECOVERY_RETRY_MS);
  };
  async function verify(recovering: boolean) {
    if (!active || state.reloadRequired) return;
    if (recovering && (!baseline || verifiedMode !== mode())) { blocked(); return; }
    phase = 'verifying';
    const requestEpoch = epoch, requestMode = mode();
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    publish({...state, session:null, checking:true, error:''});
    try {
      const data = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          requestTimer = setTimeout(() => reject(new SessionVerificationTimeout('Account verification timed out. Retry Operations access or reload the app.')), SESSION_VERIFICATION_TIMEOUT_MS);
          verificationTimer = requestTimer;
        }),
      ]);
      if (!active || requestEpoch !== epoch) return;
      if (requestMode !== mode()) { blocked(); return; }
      if (!data || typeof data.authorized !== 'boolean') throw new Error('Operations authorization could not be verified.');
      const fingerprint = ownerSessionFingerprint(data, requestMode);
      if (recovering && (!baseline || fingerprint !== baseline)) { blocked(); return; }
      renewalRestarted = false;
      baseline = fingerprint;
      verifiedMode = requestMode;
      phase = 'idle';
      publish({...state, session:data, checking:false, error:'', reloadRequired:false, generation:state.generation+1});
    } catch (cause) {
      if (!active || requestEpoch !== epoch) return;
      if (recovering) {
        if (temporaryFailure(cause) && verifiedMode === mode()) retry(); else blocked();
        return;
      }
      phase = 'idle';
      publish({...state, session:null, checking:false, error:cause instanceof Error ? cause.message : 'Operations authorization could not be verified.'});
    } finally {
      clearTimeout(requestTimer);
      if (verificationTimer === requestTimer) verificationTimer = undefined;
    }
  }
  const controller = {
    isCurrent(generation: number): boolean { return active && !state.checking && !state.reloadRequired && state.session?.authorized === true && state.generation === generation && verifiedMode === mode(); },
    hide(): boolean {
      // The host also hides a healthy frame for ordinary legacy-tool navigation.
      // Preserve its existing evidence/cache clearing; a pending verification is never resumable across hide.
      if (phase === 'idle') return false;
      controller.invalidate('security-hide');
      return true;
    },
    check() { if (active && phase === 'idle' && !state.reloadRequired) return verify(false); },
    invalidate(reason?: unknown) {
      if (!active) return;
      // Advance before clearing. Even a successful earlier read may not refill this view.
      epoch++;
      const verifying = phase === 'verifying';
      // A delayed parent refresh can replace the token during recovery itself.
      // Discard that read and verify the replacement against the original Owner.
      // Bound this to one restart; never accept an old response or replay writes.
      const retryTimeout = verifying && reason === 'parent-timeout' && Boolean(baseline) &&
        verifiedMode === mode() && !state.reloadRequired;
      const restartRenewal = verifying && reason === 'token-renewed' && !renewalRestarted &&
        Boolean(baseline) && verifiedMode === mode() && !state.reloadRequired;
      clearTimeout(verificationTimer); verificationTimer = undefined;
      publish({...state, session:null, checking:false, error:'', generation:state.generation+1});
      if (state.reloadRequired || (verifying && !restartRenewal && !retryTimeout) || typeof reason !== 'string' || !transientReasons.has(reason) || !baseline) {
        blocked(); return;
      }
      if (retryTimeout) { retry(); return; }
      if (restartRenewal) renewalRestarted = true;
      publish({...state, checking:true});
      if (phase === 'queued' || phase === 'waiting') return;
      phase = 'queued';
      defer(() => { if (active && phase === 'queued' && !state.reloadRequired) void verify(true); });
    },
    stop() { clearTimeout(retryTimer); retryTimer = undefined; active = false; epoch++; phase = 'idle'; clearTimeout(verificationTimer); verificationTimer = undefined; },
  };
  return controller;
}

export function guardSessionCallback<Args extends unknown[]>(isCurrent: (generation: number) => boolean, generation: number, callback: (...args: Args) => void) {
  return (...args: Args) => { if (isCurrent(generation)) callback(...args); };
}
