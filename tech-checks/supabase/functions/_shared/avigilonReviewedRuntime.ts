import {avigilonAuthorityClient} from './avigilonAuthorityClient.ts';
/** Deployment gate: no entrypoint configures this in this candidate. A reviewed
 * server bootstrap supplies existing credentials/actor through the fixed factory.
 * There is no environment flag, request header or client command enabling it. */
type Runtime={sources:{mutate:(commands:any[])=>Promise<any>;reconcile:()=>Promise<any>};checkManaged:()=>Promise<any>};
let runtime:Runtime|undefined;
export function configureReviewedAvigilonRuntime(value:Runtime){if(runtime)throw Error('Runtime already configured');runtime=value;}
export function reviewedAvigilonRuntime(){return runtime;}
export function guardedAvigilonClient(db:any){return avigilonAuthorityClient(db,runtime?.sources);}
