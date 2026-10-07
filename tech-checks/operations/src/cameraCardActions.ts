import {cameraTimestamp,type CameraRow} from './cameraEvidence';
import {cameraResourcePath} from './cameraHealthCounts';
/** Saved destinations, never credentials or a claim of verified video. */
export function cameraCardLinks(rows:CameraRow[]){
  const found=new Map<string,{url:string;label:string}>();
  for(const row of rows){
    if(row.trackerOnly)continue;
    if(row.evidence?.kind==='provider'&&row.evidence.source==='Reconeyez'){found.set('https://na.reconeyez.com',{url:'https://na.reconeyez.com',label:'Open Reconeyez cameras'});continue;}
    const ip=row.connection?.publicIp;
    if(typeof ip!=='string'||! /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.split('.').some(p=>Number(p)>255||p.length>1&&p.startsWith('0')))continue;
    const ports=[...new Set(Array.isArray(row.connection?.ports)?row.connection.ports:[])];
    for(const port of ports){if(![80,443,8443].includes(port))continue;const url=(port===80?'http':'https')+'://'+ip+(port===8443?':8443':'');found.set(url,{url,label:'Open '+ip+(port===80?'':':'+port)});}
  }
  return [...found.values()];
}
export function cameraCardTimes(rows:CameraRow[],now:number){
  const entries=rows.filter(row=>!row.trackerOnly).flatMap(row=>[row.evidence,row.serviceEvidence].filter(e=>e&&['provider','service_port'].includes(e.kind)).map(e=>({name:row.name,source:e!.source,kind:e!.kind,checked:cameraTimestamp(e!.observedAt,now).at,success:cameraTimestamp(e!.lastOnlineAt,now).at})));
  const latest=(key:'checked'|'success')=>entries.filter(e=>e[key]).sort((a,b)=>Date.parse(b[key]!)-Date.parse(a[key]!))[0]||null;
  return {checked:latest('checked'),success:latest('success')};
}
export function unitCardPath(unit:string,action?:'edit-field'){
  return '../../camera-health.html?unit='+encodeURIComponent(unit)+(action?'&action='+action:'');
}
export function cameraIpEditLinks(rows:CameraRow[]){return rows.filter(r=>r.evidence?.source!=='Reconeyez').flatMap(row=>{const url=cameraResourcePath(row);return url?[{url:url+'&action=edit-ip',name:row.name}]:[];});}
