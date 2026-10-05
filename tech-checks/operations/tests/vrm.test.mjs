import test from 'node:test';
import assert from 'node:assert/strict';
import {heliosVrmUnits,vrmPortalConfig,readVrmPortalConfig,validVrmEmbed} from '../../supabase/functions/cos-operations-pages/vrm.ts';
const ids=[1022969,1022961,1018314,1022780,1023504,1026733,1027440,1039531,1039500];
test('Helios 1–9 use the verified installations without fabricated telemetry',()=>{
 const result=vrmPortalConfig();assert.deepEqual(result.items.map(u=>u.installationId),ids);
 assert.equal(result.items.length,9);assert.ok(result.items.every(u=>u.embedUrl===null));
 assert.deepEqual(readVrmPortalConfig(result),result.items);
 assert.ok(result.items.every(u=>Object.keys(u).sort().join(',')==='embedUrl,installationId,name,number,portalUrl'));
});
test('Only the correct Victron per-installation embed is accepted',()=>{
 const url='https://vrm.victronenergy.com/installation/1022969/embed/synthetic-only';
 assert.ok(validVrmEmbed(url,ids[0]));
 assert.equal(vrmPortalConfig(JSON.stringify({1022969:url})).items[0].embedUrl,url);
 for(const wrong of [url.replace('https:','http:'),url.replace('1022969','1022961'),url.replace('vrm.victronenergy.com','evil.example'),url.replace('/embed/','/dashboard/'),url+'#secret',url.replace('https://','https://owner:secret@'),null])assert.equal(validVrmEmbed(wrong,ids[0]),false);
 for(const raw of ['bad JSON','[]','null','{"unknown":"secret"}',JSON.stringify({1022969:'https://evil.example/secret'})])assert.throws(()=>vrmPortalConfig(raw));
});
test('A malformed server fleet cannot swap units or inject iframe origins',()=>{
 for(const change of [items=>items.pop(),items=>items[1]={...items[0]},items=>items[0].name='HELIOS 009',items=>items[0].portalUrl='https://evil.example',items=>items[0].embedUrl='javascript:alert(1)',items=>delete items[0].embedUrl]){
  const result=vrmPortalConfig();change(result.items);assert.throws(()=>readVrmPortalConfig(result));
 }
 assert.equal(heliosVrmUnits.length,9);
});
