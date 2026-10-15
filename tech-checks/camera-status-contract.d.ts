export {};
declare global {
  var CameraStatusContract: {
    serviceState(evidence: {status?:string;reachable?:boolean|null;confirmedOutage?:boolean;consecutiveFailures?:number|null}|undefined, fresh:boolean): 'online'|'offline'|'degraded'|'verifying';
  };
}
