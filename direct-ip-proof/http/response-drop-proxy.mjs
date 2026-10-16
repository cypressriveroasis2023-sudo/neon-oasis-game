/** Drop a completed upstream response after the separate admin connection sees commit. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {assertHostedHttp,RPC_PATH,token} from './common.mjs';

export async function loseCommittedResponse(args,verifyCommitted){
 assertHostedHttp();
 let resolveEvidence,rejectEvidence;
 const evidence=new Promise((resolve,reject)=>{resolveEvidence=resolve;rejectEvidence=reject;});
 // Install a rejection handler immediately, including failures before client setup.
 evidence.catch(()=>{});
 let requestCount=0;
 const server=http.createServer((incoming,downstream)=>{
  requestCount++;
  if(requestCount!==1||incoming.method!=='POST'||incoming.url!==RPC_PATH){downstream.destroy();rejectEvidence(new Error('Unexpected proxy request'));return;}
  const upstream=http.request({hostname:'127.0.0.1',port:3000,path:RPC_PATH,method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},timeout:10_000},response=>{
   let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
   response.on('error',error=>{downstream.destroy();rejectEvidence(error);});
   response.on('end',async()=>{
    try{
     assert.equal(response.statusCode,200,'Only a successful real upstream response may be dropped.');
     const receipt=JSON.parse(body);
     // The upstream HTTP body alone is not our commit oracle. A separate database
     // session must already see exactly this receipt before closing the socket.
     await verifyCommitted(receipt);
     downstream.destroy(); // no headers or body are ever sent to the caller
     resolveEvidence({receipt,upstreamStatus:response.statusCode,downstreamBytes:0,requestCount});
    }catch(error){downstream.destroy();rejectEvidence(error);}
   });
  });
  upstream.on('timeout',()=>upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error',error=>{downstream.destroy();rejectEvidence(error);});
  incoming.pipe(upstream);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{
  const port=server.address().port;
  const clientResult=new Promise((resolve,reject)=>{
   const request=http.request({hostname:'127.0.0.1',port,path:RPC_PATH,method:'POST',
    headers:{'Content-Type':'application/json'},timeout:15_000},response=>{
    response.resume();reject(new Error('Proxy unexpectedly delivered HTTP headers '+response.statusCode));
   });
   request.on('timeout',()=>{request.destroy();reject(new Error('Client timed out instead of observing deliberate response loss'));});
   request.on('error',error=>{if(error.code==='ECONNRESET')resolve({error:error.code});else reject(error);});
   request.end(JSON.stringify(args));
  });
  const [upstream,client]=await Promise.all([evidence,clientResult]);
  return {...upstream,client};
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
}
