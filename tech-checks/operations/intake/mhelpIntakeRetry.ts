/** Only numeric cooldowns cross the source boundary; provider header values stay private. */
export const MAX_RETRY_AFTER_SECONDS=86400;
export const DEFAULT_RETRY_AFTER_SECONDS=300;
export const isRetryAfterSeconds=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=MAX_RETRY_AFTER_SECONDS;
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
/** RFC 9110 delay-seconds / HTTP-date, bounded before arithmetic or serialization. */
export function parseRetryAfter(value:string|null,now=Date.now()):number|undefined {
  if(value===null||value.length>128||!Number.isFinite(now))return undefined;
  const raw=value.trim();
  if(/^\d+$/.test(raw)){const n=Number(raw);return Number.isFinite(n)?Math.min(MAX_RETRY_AFTER_SECONDS,n):MAX_RETRY_AFTER_SECONDS;}
  let dayName:string,day:number,month:string,year:number,hour:number,minute:number,second:number;
  let m=raw.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/);
  if(m){[,dayName]=m;day=Number(m[2]);month=m[3];year=Number(m[4]);hour=Number(m[5]);minute=Number(m[6]);second=Number(m[7]);}
  else if((m=raw.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(\w{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/))){
    dayName=m[1].slice(0,3);day=Number(m[2]);month=m[3];const currentYear=new Date(now).getUTCFullYear();year=Math.floor(currentYear/100)*100+Number(m[4]);if(year>currentYear+50)year-=100;hour=Number(m[5]);minute=Number(m[6]);second=Number(m[7]);
  }else if((m=raw.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\w{3}) ( [1-9]|[12]\d|3[01]) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/))){
    dayName=m[1];month=m[2];day=Number(m[3]);hour=Number(m[4]);minute=Number(m[5]);second=Number(m[6]);year=Number(m[7]);
  }else return undefined;
  const monthIndex=months.indexOf(month),date=new Date(Date.UTC(year,monthIndex,day,hour,minute,second));
  if(year<1601||monthIndex<0||hour>23||minute>59||second>59||date.getUTCFullYear()!==year||date.getUTCMonth()!==monthIndex||date.getUTCDate()!==day||weekdays[date.getUTCDay()]!==dayName)return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS,Math.max(0,Math.ceil((date.getTime()-now)/1000)));
}
