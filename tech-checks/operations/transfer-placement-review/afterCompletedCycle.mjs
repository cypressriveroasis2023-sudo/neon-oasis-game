// Optional server-only admission after the existing camera cycle has committed.
// Never changes its outcome, restarts it, or runs on a read/already-running path.
export async function afterCompletedCycle(result,{publisher,deadline,signal,now=Date.now}){
 if(!publisher||result?.state!=='completed')return result;
 const remaining=deadline-now();
 if(signal?.aborted||remaining<1000)return {...result,transferPlacement:{state:'deferred'}};
 const controller=new AbortController(),linked=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
 let timer;
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({state:'uncertain'});},Math.min(30000,remaining));});
 try{
  const work=Promise.resolve().then(()=>publisher.run({signal:linked})).then(r=>({state:'admitted',generation:r.generation}),()=>({state:'unavailable'}));
  return {...result,transferPlacement:await Promise.race([work,timeout])};
 }finally{clearTimeout(timer);controller.abort();}
}
