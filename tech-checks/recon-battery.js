/* Recon telemetry is vendor-reported; inventory refresh is not a battery measurement. */
(function(root){
  'use strict';
  function percent(value){const n=typeof value==='number'?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN;return Number.isFinite(n)&&n>=0&&n<=100?n:null}
  function evidence(metadata){const m=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?metadata:{};return {percent:percent(m.battery_percent),percentAt:m.battery_updated_at,status:['normal','low','critical'].includes(m.battery_status)?m.battery_status:null,statusAt:m.battery_status_updated_at}}
  function time(value,now){const stamp=root.CameraHealthHistory.timestamp(value,now);return root.CameraHealthHistory.format(value,now)+(stamp.state==='fresh'?' · recent vendor reading':stamp.state==='stale'?' · older reading; current battery unverified':' · current battery unverified')}
  function text(metadata,now=Date.now()){const value=evidence(metadata),parts=[];parts.push(value.percent===null?'Percentage not reported':Math.round(value.percent)+'% · Level observed '+time(value.percentAt,now));parts.push(value.status?'Condition '+value.status.toUpperCase()+' · observed '+time(value.statusAt,now):'Battery condition not reported');return parts.join(' · ')}
  function badge(metadata){const value=evidence(metadata);return value.percent!==null?'BATTERY '+Math.round(value.percent)+'%':value.status?'BATTERY '+value.status.toUpperCase():'BATTERY WAITING'}
  function cloudUrl(metadata){const raw=metadata?.cloud_url||metadata?.event_url;try{const u=new URL(raw);if(u.protocol==='https:'&&u.hostname==='na.reconeyez.com'&&!u.username&&!u.password&&(!u.port||u.port==='443'))return u.href}catch{}return 'https://na.reconeyez.com'}
  root.ReconBattery={percent,evidence,text,badge,cloudUrl};
})(globalThis);
