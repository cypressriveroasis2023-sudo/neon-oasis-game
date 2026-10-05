const defaultOrigin='http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
export const fixtureUnit='11111111-1111-4111-8111-111111111111';
export function routerFixture(){
 const fresh=new Date(Date.now()-60000).toISOString(),old=new Date(Date.now()-3600000).toISOString();
 const row={id:'r1',unitKey:'HELIOS 001',name:'Fixture InHand',model:'IR302',publicIp:'192.0.2.1/32',unitIp:'192.0.2.2',port:8080,protocol:'http',probeStatus:'online',checkedAt:fresh,lastRecoveredAt:'2026-09-10T00:00:00Z',reportedStatus:'online',reportedAt:'2026-09-22T00:00:00Z',reportedSource:'inhand_export',savedLatencyMs:40,match:'exact_name',candidateUnit:{id:fixtureUnit,unitNumber:'HELIOS 001'},gps:null};
 return {source:'camera_health',gpsAvailable:false,generatedAt:new Date().toISOString(),items:[row,{...row,id:'r2',unitKey:'SS 019',name:'Duplicate fixture',probeStatus:'offline',publicIp:'192.0.2.3',match:'ambiguous',candidateUnit:null},{...row,id:'r3',unitKey:'SS 039',name:'Stale fixture',checkedAt:old,publicIp:'192.0.2.4',match:'unmatched',candidateUnit:null},{...row,id:'r4',unitKey:'RANGER 001',name:'Unchecked fixture',checkedAt:null,probeStatus:'unknown',publicIp:null,unitIp:null,match:'unmatched',candidateUnit:null}]};
}
export async function mountRouterFixture(page,{origin=defaultOrigin,fail=false,role='owner',gps=true}={}){
 const state={fail,requests:[],snapshot:routerFixture()};
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/router-test')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Native COS" src="/?theme=vision"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'${role}'},location.origin)});</script></body></html>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(url!==edge)return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();state.requests.push(request);
  if(request.method!=='GET')throw Error('Unexpected write in read-only router test');
  if(request.path==='/api/routers'&&state.fail)return route.fulfill({status:state.fail===403?403:503,headers,contentType:'application/json',body:JSON.stringify({error:'Router fixture unavailable'})});
  const data=request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}:request.path==='/api/routers'?state.snapshot:request.path==='/api/field-map'?{items:[{id:fixtureUnit,unitNumber:'HELIOS 001',status:'installed',latitude:gps?30:null,longitude:gps?-95:null,coordinateSource:gps?'manual':null,gpsRecordedAt:gps?'2026-09-01T00:00:00Z':null,hasUnitGps:gps}],summary:{fieldUnits:1,mappedUnits:gps?1:0,unitGps:gps?1:0,missingGps:gps?0:1},generatedAt:new Date().toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(origin+'/router-test');
 return {frame:page.frameLocator('iframe'),state};
}
