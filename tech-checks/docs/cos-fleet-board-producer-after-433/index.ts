// Dedicated worker for the durable Fleet board batch. Same recorded handler and
// the same caller authorization as cos-operations-pages; it only ever serves
// POST /api/fleet-saved-board/produce for a claimed lease.
// Merged PR #374: a declined source is asked once, not three times.
import { AsyncLocalStorage } from "node:async_hooks";
import { annotateSavedBoard, loadRouterBoardSources } from "./routerBoardJoin.mjs";
const routerBoardAuth = new AsyncLocalStorage();
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input && input.url || "";
  if (url.includes("/rpc/cos_fleet_board_finish") && init && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (body && body.p_payload && body.p_payload.contract === "COS_SAVED_FLEET_BOARD_V1") {
        const sources = await loadRouterBoardSources(nativeFetch, routerBoardAuth.getStore() || {});
        body.p_payload = annotateSavedBoard(body.p_payload, sources, Date.now());
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch { /* the camera board still commits */ }
  }
  return nativeFetch(input, init);
};
const PRODUCER_BODY_LIMIT=65536;
const nativeServe=Deno.serve.bind(Deno);
Deno.serve=(first,second)=>{
  const handler=typeof first==="function"?first:second;
  if(typeof handler!=="function")throw new TypeError("COS producer expected a request handler.");
  const restricted=async request=>{
    if(request.method==="OPTIONS")return handler(request);
    const pathname=new URL(request.url).pathname;
    const own=(pathname.match(/\/cos-fleet-board-producer(?=\/|$)/g)||[]).length;
    const pages=(pathname.match(/\/cos-operations-pages(?=\/|$)/g)||[]).length;
    if(own>1||pages>1)return producerNotFound();
    const urlPath=pathname.replace(/^.*\/cos-(?:operations-(?:pages|bridge)|fleet-board-producer)(?=\/|$)/,"").replace(/\/$/,"");
    const directProduce=request.method==="POST"&&urlPath==="/api/fleet-saved-board/produce";
    if(!directProduce&&!(request.method==="POST"&&!urlPath))return producerNotFound();
    const limited=await readProducerBody(request);
    if(limited.tooBig)return new Response(JSON.stringify({error:"Request body is too large."}),{status:413,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
    if(directProduce)return routerBoardAuth.run(request.headers,()=>handler(new Request(request.url,{method:request.method,headers:request.headers,body:limited.text})));
    let envelope=null;
    try{envelope=JSON.parse(limited.text);}catch{envelope=null;}
    const path=envelope&&typeof envelope==="object"&&!Array.isArray(envelope)&&typeof envelope.path==="string"?envelope.path.replace(/\/$/,""):"";
    if(!(envelope&&envelope.method==="POST"&&path==="/api/fleet-saved-board/produce"))return producerNotFound();
    return routerBoardAuth.run(request.headers,()=>handler(new Request(request.url,{method:request.method,headers:request.headers,body:limited.text})));
  };
  return typeof first==="function"?nativeServe(restricted):nativeServe(first,restricted);
};
function producerNotFound(){
  return new Response(JSON.stringify({error:"COS endpoint not found."}),{status:404,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
}
async function readProducerBody(request){
  const reader=request.body?.getReader();
  if(!reader)return {tooBig:false,text:""};
  const chunks=[];
  let size=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      size+=next.value.byteLength;
      if(size>PRODUCER_BODY_LIMIT){await reader.cancel();return {tooBig:true,text:""};}
      chunks.push(next.value);
    }
  }finally{try{reader.releaseLock();}catch{}}
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {tooBig:false,text:new TextDecoder("utf-8",{fatal:false}).decode(bytes)};
}
await import("https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/b5b188229346182d9a4e29da42415a1b9d3b9d53/tech-checks/docs/vision-native-preview-20261107/source/serve.ts");
