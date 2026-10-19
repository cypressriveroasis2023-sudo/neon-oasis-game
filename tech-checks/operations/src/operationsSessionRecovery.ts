export type OperationsSession = Record<string, any>;
export type SessionRecoveryState = {
  session: OperationsSession | null;
  checking: boolean;
  error: string;
  reloadRequired: boolean;
  generation: number;
};
export const SESSION_VERIFICATION_TIMEOUT_MS = 45000;
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

/** One read-only revalidation, with every private view fenced by the same epoch.
 * A second transition during verification, or any hard reason, requires reload.
 * Neither verification failures nor previously submitted writes are replayed. */
export function createOperationsSessionRecovery({read, mode, changed, defer = callback => setTimeout(callback, 0)}: {
  read: () => Promise<OperationsSession>;
  mode: () => string;
  changed: (state: SessionRecoveryState) => void;
  defer?: (callback: () => void) => void;
}) {
  let active = true, epoch = 0, baseline: string | null = null, verifiedMode: string | null = null;
  let verificationTimer: ReturnType<typeof setTimeout> | undefined;
  let phase: 'idle' | 'queued' | 'verifying' = 'idle';
  let state: SessionRecoveryState = {session:null, checking:true, error:'', reloadRequired:false, generation:0};
  const publish = (next: SessionRecoveryState) => { state = next; if (active) changed(state); };
  const blocked = () => {
    phase = 'idle';
    publish({...state, session:null, checking:false, error:reloadMessage, reloadRequired:true});
  };
  async function verify(recovering: boolean) {
    if (!active || state.reloadRequired) return;
    phase = 'verifying';
    const requestEpoch = epoch, requestMode = mode();
    publish({...state, session:null, checking:true, error:''});
    try {
      const data = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          verificationTimer = setTimeout(() => reject(new Error('Account verification timed out. Retry Operations access or reload the app.')), SESSION_VERIFICATION_TIMEOUT_MS);
        }),
      ]);
      if (!active || requestEpoch !== epoch) return;
      if (requestMode !== mode()) { blocked(); return; }
      if (!data || typeof data.authorized !== 'boolean') throw new Error('Operations authorization could not be verified.');
      const fingerprint = ownerSessionFingerprint(data, requestMode);
      if (recovering && (!baseline || fingerprint !== baseline)) { blocked(); return; }
      baseline = fingerprint;
      verifiedMode = requestMode;
      phase = 'idle';
      publish({...state, session:data, checking:false, error:'', reloadRequired:false, generation:state.generation+1});
    } catch (cause) {
      if (!active || requestEpoch !== epoch) return;
      if (recovering) { blocked(); return; }
      phase = 'idle';
      publish({...state, session:null, checking:false, error:cause instanceof Error ? cause.message : 'Operations authorization could not be verified.'});
    } finally {
      clearTimeout(verificationTimer);
      verificationTimer = undefined;
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
      publish({...state, session:null, checking:false, error:'', generation:state.generation+1});
      if (state.reloadRequired || verifying || typeof reason !== 'string' || !transientReasons.has(reason) || !baseline) {
        blocked(); return;
      }
      publish({...state, checking:true});
      if (phase === 'queued') return;
      phase = 'queued';
      defer(() => { if (active && phase === 'queued' && !state.reloadRequired) void verify(true); });
    },
    stop() { active = false; epoch++; phase = 'idle'; clearTimeout(verificationTimer); verificationTimer = undefined; },
  };
  return controller;
}

export function guardSessionCallback<Args extends unknown[]>(isCurrent: (generation: number) => boolean, generation: number, callback: (...args: Args) => void) {
  return (...args: Args) => { if (isCurrent(generation)) callback(...args); };
}
