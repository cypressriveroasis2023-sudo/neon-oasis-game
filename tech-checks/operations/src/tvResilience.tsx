import {Component,type ReactNode} from 'react';

export const TV_WATCHDOG_MS=30*60*1000;
export const TV_NETWORK_BACKOFF_MS=[5_000,15_000,30_000] as const;
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

export function isTvNetworkStatus(status:number|null):boolean{
  return status!==null&&[502,503,504,546].includes(status);
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
