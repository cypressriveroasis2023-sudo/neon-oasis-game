/** A transient UI lease. Never stores a response or identity. */
export type MhelpReadGuard={acquire:()=>symbol|null;release:(lease:symbol)=>void};
export function createMhelpReadGuard(changed:(busy:boolean)=>void):MhelpReadGuard {
 let current:symbol|null=null;
 return {acquire(){if(current!==null)return null;current=Symbol('mhelp-read');changed(true);return current;},release(lease){if(current!==lease)return;current=null;changed(false);}};
}
