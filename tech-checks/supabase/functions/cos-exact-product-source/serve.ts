import {createProductProofHandler} from '../_shared/exact-product-producer/attestationTransport.ts';
declare const Deno:{serve:(handler:(request:Request)=>Promise<Response>)=>void};
// No environment credentials or role claims. Mount into the existing native
// authenticated Owner/IT context only after exact runtime review.
Deno.serve(createProductProofHandler());
