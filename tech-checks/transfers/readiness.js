// Rollout readiness is separate from account authorization and saved handoff data.
// Missing/old backend code must never replace a working technician screen.
export const TRANSFER_READINESS_RPC = 'techcheck_transfer_readiness_v1';
export const TRANSFER_READINESS_TIMEOUT_MS = 6000;
const unavailable = reason => ({ready:false,reason});
function actorScope(context, role) {
  const id=context?.getSession?.()?.user?.id, profile=context?.getProfile?.();
  return id && context?.getRole?.()===role && profile?.user_id===id &&
    profile?.active===true && !profile?.archived_at ? id : null;
}
export async function transferReadiness(context, role, {timeoutMs=TRANSFER_READINESS_TIMEOUT_MS}={}) {
  const actor=actorScope(context,role);
  if(!actor || !['it','service'].includes(role)) return unavailable('access');
  let timer;
  try {
    const response=await Promise.race([
      Promise.resolve().then(()=>context.db.rpc(TRANSFER_READINESS_RPC)),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),timeoutMs);}),
    ]);
    // Ignore both late successes and late denials belonging to an earlier account.
    if(actorScope(context,role)!==actor) return unavailable('session_changed');
    if(response?.timeout) return unavailable('timeout');
    if(response?.error) return unavailable(response.error.code==='PGRST202'?'not_installed':
      ['42501','PGRST301','PGRST302'].includes(response.error.code)?'access':'unavailable');
    const data=response?.data;
    if(data?.version!==1 || data.actor_id!==actor || data.role!==role || typeof data.ready!=='boolean') return unavailable('incompatible');
    // Do not trust a lone `ready:true` from a partially upgraded server.
    const gates=[data.enabled,data.dependencies?.read,data.dependencies?.submit,data.dependencies?.privateEvidence,
      data.release?.reports,data.release?.receiptLink,data.release?.custody];
    if(gates.some(gate=>typeof gate!=='boolean')) return unavailable('incompatible');
    if(!data.ready || !gates.every(gate=>gate===true)) return unavailable('held');
    return {ready:true,reason:'ready',actor,role};
  } catch {
    return unavailable(actorScope(context,role)===actor?'unavailable':'session_changed');
  } finally {clearTimeout(timer);}
}
export const transferReadinessMessage = reason => ({
  not_installed:'Equipment handoffs are not installed yet.',
  held:'Equipment handoffs are held until reporting and inventory checks are ready.',
  timeout:'Equipment handoff readiness could not be verified in time.',
  access:'Equipment handoff access could not be verified for this account.',
  session_changed:'Your account changed. Sign in again to check handoff access.',
  incompatible:'Equipment handoffs are waiting for a compatible backend.',
  unavailable:'Equipment handoff readiness is temporarily unavailable.',
}[reason] || 'Equipment handoffs are not available.');
