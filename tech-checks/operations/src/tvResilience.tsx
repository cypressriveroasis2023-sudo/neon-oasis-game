import {Component,type ReactNode} from 'react';

export const TV_WATCHDOG_MS=30*60*1000;
export const TV_NETWORK_BACKOFF_MS=[5_000,15_000,30_000] as const;
/** A silent re-login must finish inside this window or the board is cleared. */
export const TV_RELOGIN_DEADLINE_MS=30_000;
export const TV_SIGN_IN_PROMPT='Sign in again to load fleet information.';

export type TvAuthAction='keep'|'retry-sign-in'|'sign-in-prompt';

/** A renewed token keeps the board. The first 401 tries one silent sign-in.
 * A second 401, or any other private-data stop, clears the board. */
export function tvAuthDecision(reason:string|undefined,reloginUsed:boolean):TvAuthAction{
  if(reason==='token-renewed')return 'keep';
  if(reason==='authentication-denied'&&!reloginUsed)return 'retry-sign-in';
  return 'sign-in-prompt';
}

export function tvNetworkBackoff(attempt:number):number|null{
  return attempt>=0&&attempt<TV_NETWORK_BACKOFF_MS.length?TV_NETWORK_BACKOFF_MS[attempt]:null;
}

/** 502, 503 and 504 use the same caps as a lost connection, with jitter in the
 * upper half of each step. The wait is never zero, so a struggling function is
 * not retried immediately, and never longer than that step's cap. Attempt 3 stops. */
export function tvGatewayBackoff(attempt:number,random:()=>number=Math.random):number|null{
  const cap=tvNetworkBackoff(attempt);
  if(cap===null)return null;
  const unit=random();
  const fraction=Number.isFinite(unit)?Math.min(1,Math.max(0,unit)):0;
  return Math.round(cap*(0.5+fraction*0.5));
}

/** HTTP 546 keeps its one 30-second cold retry. A plain 502, 503 or 504 waits
 * on the jittered gateway steps instead. A dropped or timed-out fetch keeps
 * the fixed 5/15/30 steps. A good field read schedules nothing. */
export function tvSavedReadRetry(input:{status:number|null;transport?:TvTransportFailure;initial:boolean;retryUsed:boolean;hasField:boolean;recoveryBlocked:boolean;attempt:number;random?:()=>number}):number|null{
  if(input.hasField)return null;
  const transport=isTvTransportFailure(input.transport);
  const gateway=!transport&&input.status!==null&&[502,503,504].includes(input.status);
  if(input.initial&&!input.retryUsed&&!input.recoveryBlocked&&!transport&&!gateway&&input.status===546)return 30_000;
  if(transport)return tvNetworkBackoff(input.attempt);
  if(gateway)return tvGatewayBackoff(input.attempt,input.random);
  return null;
}

/** A fetch that rejected, or the request timer aborting it. HTTP 546 and a
 * plain gateway status are not transport failures. */
export type TvTransportFailure='rejected'|'timeout';
export function isTvTransportFailure(value:unknown):value is TvTransportFailure{
  return value==='rejected'||value==='timeout';
}

type BoundaryProps={children:ReactNode};
type BoundaryState={failed:boolean};
export class TvFleetErrorBoundary extends Component<BoundaryProps,BoundaryState>{
  state:BoundaryState={failed:false};
  static getDerivedStateFromError():BoundaryState{return {failed:true};}
  render(){
    if(this.state.failed)return <p className='tv-fleet-warning' role='alert'>{TV_SIGN_IN_PROMPT}</p>;
    return this.props.children;
  }
}
