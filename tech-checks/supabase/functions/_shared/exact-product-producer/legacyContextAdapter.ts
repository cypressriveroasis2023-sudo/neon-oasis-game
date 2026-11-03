import {createRemoteGroupReader} from './attestationTransport.ts';
import {createSupabaseReceiptRpc} from './receiptAdapter.ts';
import type {TcpConnect} from './tcpProbe.ts';
/** Call only after the EXISTING legacy Owner/verified-IT gate verifies the user.
 * The bearer is forwarded unchanged for independent native authentication.
 * Own-project privileged client stays here; no cross-project service key. */
export function existingLegacyProductTcpContext(options:{
 proofUrl:string;expectedOrigin:string;authorization:string;fetch:typeof fetch;
 legacyServiceClient:Parameters<typeof createSupabaseReceiptRpc>[0];
 connect:TcpConnect;canProbe:boolean;now?:()=>number;
}){
 return {readGroups:createRemoteGroupReader(options),receiptRpc:createSupabaseReceiptRpc(options.legacyServiceClient),connect:options.connect,canProbe:options.canProbe};
}
