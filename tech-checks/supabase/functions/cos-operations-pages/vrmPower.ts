// Read-only diagnostics. Store numeric measurements and their source timestamps only.
const API='https://vrmapi.victronenergy.com/v2';
const MAX_BYTES=2*1024*1024, PAGE_SIZE=500, MAX_PAGES=4;
export type PowerMetric='battery_soc'|'battery_voltage'|'battery_current'|'battery_power'|'solar_power'|'load_power'|'low_voltage_alarm'|'low_soc_alarm'|'high_voltage_alarm';
export type PowerObservation={metric:PowerMetric;value:number;unit:'%'|'V'|'A'|'W'|'state';observedAt:string;instance:number;source:'system'|'battery'|'solarcharger'};
export type PowerResult={checkedAt:string;observations:PowerObservation[];errorCode:null|'access'|'provider'|'rate_limit'|'invalid_response'|'no_data'};
const metrics:Record<string,{metric:PowerMetric;unit:PowerObservation['unit'];min:number;max:number}>={
 '/Dc/Battery/Soc':{metric:'battery_soc',unit:'%',min:0,max:100},'/Soc':{metric:'battery_soc',unit:'%',min:0,max:100},
 '/Dc/Battery/Voltage':{metric:'battery_voltage',unit:'V',min:0,max:200},'/Dc/0/Voltage':{metric:'battery_voltage',unit:'V',min:0,max:200},
 '/Dc/Battery/Current':{metric:'battery_current',unit:'A',min:-10000,max:10000},'/Dc/0/Current':{metric:'battery_current',unit:'A',min:-10000,max:10000},
 '/Dc/Battery/Power':{metric:'battery_power',unit:'W',min:-1000000,max:1000000},'/Dc/0/Power':{metric:'battery_power',unit:'W',min:-1000000,max:1000000},
 '/Dc/Pv/Power':{metric:'solar_power',unit:'W',min:0,max:1000000},'/Yield/Power':{metric:'solar_power',unit:'W',min:0,max:1000000},
 '/Dc/System/Power':{metric:'load_power',unit:'W',min:-1000000,max:1000000},
 '/Alarms/LowVoltage':{metric:'low_voltage_alarm',unit:'state',min:0,max:2},'/Alarms/LowSoc':{metric:'low_soc_alarm',unit:'state',min:0,max:2},'/Alarms/HighVoltage':{metric:'high_voltage_alarm',unit:'state',min:0,max:2},
};
export function parsePowerRecords(records:unknown,installationId:number,now=Date.now()):PowerObservation[]{
 if(!Array.isArray(records)||records.length>PAGE_SIZE*MAX_PAGES)throw Error('invalid_response');
 const found=new Map<string,PowerObservation>();
 for(const candidate of records){if(!candidate||typeof candidate!=='object')continue;const r=candidate as Record<string,unknown>;
  if(r.idSite!==installationId||!Number.isSafeInteger(r.instance)||Number(r.instance)<0||Number(r.instance)>1000)continue;
  const source=r.dbusServiceType;if(!['system','battery','solarcharger'].includes(String(source)))continue;
  const path=typeof r.dbusPath==='string'?r.dbusPath:'',m=metrics[path];if(!m)continue;
  if(source==='system'&&(!path.startsWith('/Dc/')&&!path.startsWith('/Alarms/'))||source==='battery'&&!(path==='/Soc'||path.startsWith('/Dc/0/')||path.startsWith('/Alarms/'))||source==='solarcharger'&&path!=='/Yield/Power')continue;
  if(typeof r.rawValue!=='number'&&typeof r.rawValue!=='string'||r.rawValue===''||typeof r.rawValue==='string'&&!/^-?\d+(?:\.\d+)?$/.test(r.rawValue))continue;
  const value=Number(r.rawValue),stamp=Number(r.timestamp)*1000;if(!Number.isFinite(value)||value<m.min||value>m.max||!Number.isFinite(stamp)||stamp<Date.UTC(2000,0,1)||stamp>now+300000)continue;
  const o:PowerObservation={metric:m.metric,value,unit:m.unit,observedAt:new Date(stamp).toISOString(),instance:Number(r.instance),source:source as PowerObservation['source']};
  const key=o.metric+'|'+o.source+'|'+o.instance,prior=found.get(key);if(!prior||Date.parse(prior.observedAt)<stamp)found.set(key,o);
 }
 return [...found.values()].sort((a,b)=>(a.metric+'|'+a.source+'|'+a.instance).localeCompare(b.metric+'|'+b.source+'|'+b.instance)).slice(0,40);
}
async function diagnosticPage(id:number,page:number,token:string,fetcher:typeof fetch):Promise<{records:unknown[];total:number}>{
 const response=await fetcher(API+'/installations/'+id+'/diagnostics?count='+PAGE_SIZE+'&page='+page,{method:'GET',headers:{'X-Authorization':'Token '+token,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8500)});
 if(response.status===401||response.status===403)throw Error('access');if(response.status===429)throw Error('rate_limit');if(!response.ok)throw Error('provider');
 if(!response.body||Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('invalid_response');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
 try{for(;;){const c=await reader.read();if(c.done)break;bytes+=c.value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw Error('invalid_response');}parts.push(c.value);}}finally{reader.releaseLock();}
 const buffer=new Uint8Array(bytes);let pos=0;for(const p of parts){buffer.set(p,pos);pos+=p.byteLength;}
 let data:Record<string,unknown>;try{data=JSON.parse(new TextDecoder().decode(buffer));}catch{throw Error('invalid_response');}
 if(!data||data.success!==true)throw Error('invalid_response');
 const records=Array.isArray(data.records)?data.records:data.records&&typeof data.records==='object'&&'idSite' in data.records?[data.records]:null;
 if(!records||records.length>PAGE_SIZE||!Number.isSafeInteger(data.num_records)||Number(data.num_records)<0||Number(data.num_records)>PAGE_SIZE*MAX_PAGES)throw Error('invalid_response');
 return{records,total:Number(data.num_records)};
}
export async function collectInstallationPower(id:number,token:string,fetcher:typeof fetch=fetch,now=Date.now()):Promise<PowerResult>{
 const checkedAt=new Date(now).toISOString();try{
  if(!Number.isSafeInteger(id)||id<1||!token||token.length>8192||/[\r\n]/.test(token))throw Error('access');
  const all:unknown[]=[];let total=0;
  for(let page=1;page<=MAX_PAGES;page++){const data=await diagnosticPage(id,page,token,fetcher);if(page===1)total=data.total;else if(data.total!==total)throw Error('invalid_response');all.push(...data.records);if(all.length>=total)break;if(!data.records.length)throw Error('invalid_response');}
  if(all.length<total)throw Error('invalid_response');const observations=parsePowerRecords(all,id,now);return{checkedAt,observations,errorCode:observations.length?null:'no_data'};
 }catch(error){const code=error instanceof Error?error.message:'';return{checkedAt,observations:[],errorCode:['access','rate_limit','invalid_response'].includes(code)?code as PowerResult['errorCode']:'provider'};}
}
export async function collectHeliosPower<T extends {installationId:number;name:string}>(items:T[],token:string,fetcher:typeof fetch=fetch,now=Date.now()):Promise<Array<T&{power?:PowerResult}>>{
 const result:Array<T&{power?:PowerResult}>=[],start=Date.now();let stop=false;
 if(items.filter(x=>/^HELIOS\s+\d{1,3}$/i.test(x.name)).length>100)return items;
 for(const item of items){if(!/^HELIOS\s+\d{1,3}$/i.test(item.name)||stop||Date.now()-start>20000){result.push(item);continue;}
  const power=await collectInstallationPower(item.installationId,token,fetcher,now);result.push({...item,power});
  if(power.errorCode==='access'||power.errorCode==='rate_limit'||power.errorCode==='provider')stop=true;
  else if(items.indexOf(item)<items.length-1)await new Promise(resolve=>setTimeout(resolve,350));
 }return result;
}
