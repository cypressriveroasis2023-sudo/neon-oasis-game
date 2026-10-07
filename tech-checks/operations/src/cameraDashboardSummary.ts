import {cameraOverview} from './cameraHealthCounts';
import {validateCameraHealth} from './fieldCameraHealth';
/** Both dashboards consume the same verified, source-separated unit coverage as native health. */
export function cameraDashboardSummary(value:unknown,now=Date.now()) {
  const unavailable={available:false as const,headline:'Health unavailable',systems:'Provider system totals not verified',cameraCoverage:'Camera/detector coverage not verified',serviceCoverage:'Service coverage not verified',placement:'Placement scope not verified',note:'Source-separated inventory is not available. Open Camera Health to review.',attention:null,refreshedAt:null,coverage:null,scopes:null};
  if(!value)return unavailable;
  try{
    const health=validateCameraHealth(value),overview=cameraOverview(health,now);
    if(!overview.scopeVerified)return unavailable;
    const c=overview.coverage,s=overview.scopes,attention=c.offline+c.review;
    return {available:true as const,
      headline:c.total===0?'No active / unresolved units recorded':attention===0?'No provider systems flagged':attention+' provider system'+(attention===1?' needs':'s need')+' review',
      systems:c.total+' active / unresolved units · Provider systems: '+c.online+' online · '+c.offline+' offline · '+c.review+' review',
      cameraCoverage:'Camera/detector evidence by unit: '+c.cameraOnline+' online · '+c.cameraOffline+' offline · '+c.cameraMixed+' mixed/unverified · '+c.cameraUnavailable+' channel status unavailable',
      serviceCoverage:c.serviceReachable+' service-reachable only · '+c.degraded+' mixed provider systems',
      placement:s.field+' confirmed-field units · '+s.unknown+' location review · '+s.shop+' shop/root · '+s.inactive+' inactive',
      note:'Counts describe reported resources, not full camera coverage. Older observations remain unverified; silence is not an outage.',
      attention,refreshedAt:health.refreshedAt,coverage:c,scopes:s};
  }catch{return unavailable;}
}
