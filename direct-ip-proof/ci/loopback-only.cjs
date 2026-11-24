// Test-process guard: no provider, production, DNS-name or nonloopback sockets.
// Synthetic PostgREST/PostgreSQL and Node HTTP listeners use 127.0.0.1 only.
const net=require('node:net');
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let options=args[0];if(Array.isArray(options))options=options[0];
 if(typeof options==='number')options={port:options,host:typeof args[1]==='string'?args[1]:'127.0.0.1'};
 if(!options||typeof options!=='object'||options.path||!['127.0.0.1','::1'].includes(options.host||options.hostname||'127.0.0.1'))throw Error('Proof harness blocks nonloopback socket');
 return connect.apply(this,args);
};
const fetch=globalThis.fetch;
globalThis.fetch=(input,options={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Proof harness blocks nonloopback HTTP');
 return fetch(input,{...options,redirect:'error'});
};
