import {createReviewedAvigilonDeployment} from './avigilonDeploymentBootstrap.ts';
/** Remains disabled. Activation requires a separately reviewed code change with
 * verified existing transports/actor and all nine action-time-approved grants.
 * Each deployed Edge Function isolate imports this same gate before serving. */
export const avigilonDeployment=createReviewedAvigilonDeployment({enabled:false});
