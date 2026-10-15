import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceEquipmentMarkerIdentifier,sourceEquipmentMarkerMarkup} from '../src/sourceEquipmentMarker.ts';
import {mapUnitIdentifier} from '../src/fieldMapMarkers.ts';

test('source-only solar compatibility labels display their actual equipment number',()=>{
 for(const [label,number] of [['Spotter 953 - SOLAR COMPATIBLE','953'],['Spotter 998 HDC2S - SOLAR COMPATIBLE','998'],['Spotter 0953 - Solar Compatible','0953'],['Spotter 0998HDC2S - SOLAR COMPATIBLE','0998']]){
  assert.equal(sourceEquipmentMarkerIdentifier(label),number);assert.match(sourceEquipmentMarkerMarkup(label),new RegExp('>'+number+'<\\/b>'));
 }
 // Existing native interpretation is not expanded by this source-only presentation rule.
 assert.equal(mapUnitIdentifier('Spotter 953 - SOLAR COMPATIBLE'),'');assert.equal(mapUnitIdentifier('Spotter 998 HDC2S - SOLAR COMPATIBLE'),'');
});
test('source display preserves decimals, leading zeros and the unit number after a generation',()=>{
 for(const [label,number] of [['Recon II 028.1','028.1'],['Sniper 2 017','017'],['Sniper 4 017.2 HDC4','017.2'],['Solar Stand 72 003','003'],['Solar Skid 144 002.1','002.1'],['SS Hybrid 026','026'],['ST 006','006'],['Solar Stand 902','902']]){
  assert.equal(sourceEquipmentMarkerIdentifier(label),number);const html=sourceEquipmentMarkerMarkup(label);assert(html.includes('>'+number+'</b>'));assert.equal(label.includes(number),true);
 }
 assert.match(sourceEquipmentMarkerMarkup('Recon II 028.1'),/cos-reticle-long-id/);
});
test('source marker HTML contains no imported label markup, arbitrary strings or hardware-health assertion',()=>{
 for(const label of ['Spotter 953 <script>alert(1)</script> - SOLAR COMPATIBLE','Spotter 998 HDC2S - SOLAR COMPATIBLE<img src=x onerror=alert(1)>','<svg/onload=alert(1)>','Spotter &quot; onmouseover=alert(1)','Spotter 12345678901234567890','Spotter 1.123456789','Unknown equipment <b>123</b>']){
  assert.equal(sourceEquipmentMarkerIdentifier(label),'');const html=sourceEquipmentMarkerMarkup(label);assert.doesNotMatch(html,/<script|<img|onerror|onload|onmouseover|alert|data-health/);assert.match(html,/>—<\/b>/);
 }
 assert.equal(sourceEquipmentMarkerIdentifier('x'.repeat(251)), '');assert.equal(sourceEquipmentMarkerIdentifier(null), '');
});

test('source-only WA compact and spaced labels retain bounded numeric text and reject suffixes',()=>{
 for(const label of ['WA903','WA 903']){assert.equal(sourceEquipmentMarkerIdentifier(label),'903');assert.match(sourceEquipmentMarkerMarkup(label),/>903<\/b>/);}
 for(const label of ['WA 903 HDC2S','WA903 - SOLAR COMPATIBLE','WA903<script>alert(1)</script>','WA 903<img src=x>','WA1234567','WA 903.1']){assert.equal(sourceEquipmentMarkerIdentifier(label),'');assert.match(sourceEquipmentMarkerMarkup(label),/>—<\/b>/);}
 assert.equal(mapUnitIdentifier('WA903'),'');assert.equal(mapUnitIdentifier('WA 903'),'903');
});
