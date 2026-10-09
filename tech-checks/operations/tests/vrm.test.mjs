import test from 'node:test';
import assert from 'node:assert/strict';
import {heliosVrmUnits,vrmPortalConfig,readVrmPortalConfig,readVrmFleetConfig,validVrmEmbed} from '../../supabase/functions/cos-operations-pages/vrm.ts';
const ids=[1022969,1022961,1018314,1022780,1023504,1026733,1027440,1039531,1039500];
test('Verified bootstrap remains available before account connection, without telemetry',()=>{
 const result=vrmPortalConfig();assert.deepEqual(result.items.map(u=>u.installationId),ids);
 assert.ok(result.items.every(u=>u.embedUrl===null));assert.deepEqual(readVrmPortalConfig(result),result.items);
 assert.equal(result.sync.state,'not_configured');assert.equal(result.sync.scheduleActive,false);
});
test('Dynamic fleet supports zero, nine, eleven, gaps, renamed and duplicate display names',()=>{
 for(const count of [0,9,11]){
  const rows=Array.from({length:count},(_,i)=>({installationId:i*3+1,name:i<2?'Duplicate name':'Renamed '+i}));
  const result=vrmPortalConfig(undefined,rows);assert.equal(result.items.length,count);
  assert.deepEqual(readVrmPortalConfig(result).map(u=>u.installationId),rows.map(u=>u.installationId));
 }
});
test('Only the exact approved Victron embed is accepted, independent of fleet size',()=>{
 const url='https://vrm.victronenergy.com/installation/55/embed/synthetic-only';
 assert.ok(validVrmEmbed(url,55));
 assert.ok(validVrmEmbed(url+'?theme=dark',55)); // Existing approved same-origin query options remain compatible.
 assert.equal(vrmPortalConfig(JSON.stringify({55:url}),[{installationId:55,name:'New unit'}]).items[0].embedUrl,url);
 for(const wrong of [url.replace('https:','http:'),url.replace('/55/','/56/'),url.replace('vrm.victronenergy.com','evil.example'),url.replace('/embed/','/dashboard/'),url+'#secret',url.replace('https://','https://owner:secret@'),null])assert.equal(validVrmEmbed(wrong,55),false);
 for(const raw of ['bad JSON','[]','null','{"unknown":"secret"}',JSON.stringify({55:'https://evil.example/secret'})])assert.throws(()=>vrmPortalConfig(raw));
 const absent=vrmPortalConfig(JSON.stringify({55:url}),[]);assert.deepEqual(absent.items,[]);
 const unavailable=vrmPortalConfig(JSON.stringify({55:url}),[{installationId:55,name:'Old unit',available:false}]);assert.equal(unavailable.items[0].embedUrl,null);
});
test('Malformed identities, links, sync metadata and duplicate IDs fail closed',()=>{
 for(const change of [items=>items[1]={...items[0]},items=>items[0].installationId=NaN,items=>items[0].name='',items=>items[0].name='name\n',items=>items[0].portalUrl='https://evil.example',items=>items[0].embedUrl='javascript:alert(1)',items=>delete items[0].embedUrl,items=>items[0].available='yes',items=>items[0].lastSeenAt='yesterday']){
  const result=vrmPortalConfig();change(result.items);assert.throws(()=>readVrmPortalConfig(result));
 }
 for(const sync of [{},null,{...vrmPortalConfig().sync,state:'made-up'},{...vrmPortalConfig().sync,lastSuccessAt:'bad'}]) {
  if(sync!==null)assert.throws(()=>readVrmFleetConfig({items:[],sync}));
 }
 assert.throws(()=>vrmPortalConfig(undefined,Array.from({length:5001},(_,i)=>({installationId:i+1,name:'Unit'}))));
 assert.equal(heliosVrmUnits.length,9);
});
