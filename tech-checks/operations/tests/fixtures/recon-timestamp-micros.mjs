import assert from 'node:assert/strict';
// Test-only comparator. Preserve all six PostgreSQL fractional digits; reject
// malformed calendars instead of allowing Date.parse's rollover normalization.
export function timestampMicros(value) {
 assert.equal(typeof value,'string');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 assert(m,'invalid ISO timestamp: '+value);
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 assert(year>=1000&&month>=1&&month<=12&&day>=1&&hour<=23&&minute<=59&&second<=59,'invalid date fields');
 const base=Date.UTC(year,month-1,day,hour,minute,second);
 const d=new Date(base);assert.equal(d.getUTCFullYear(),year);assert.equal(d.getUTCMonth(),month-1);assert.equal(d.getUTCDate(),day);
 let offset=0;
 if(m[8]!=='Z'){
  const oh=Number(m[8].slice(1,3)),om=Number(m[8].slice(4,6));assert(oh<=23&&om<=59,'invalid timezone offset');
  offset=(m[8][0]==='-'?-1:1)*(oh*60+om)*60000;
 }
 return BigInt(base-offset)*1000n+BigInt((m[7]??'').padEnd(6,'0'));
}
