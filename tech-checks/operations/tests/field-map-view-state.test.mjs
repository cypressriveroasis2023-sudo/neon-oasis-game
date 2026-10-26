import test from 'node:test';import assert from 'node:assert/strict';import {readFieldMapView} from '../src/fieldMapViewState.ts';
test('map history restores only bounded presentation values, not source records',()=>{assert.deepEqual(readFieldMapView(null),{});const view=readFieldMapView({cosFieldMapView:{search:'Ranger',status:'field',health:'offline',selectedId:'unit',nearbyId:'center',radius:25,showHistorical:false,center:[29,-95],zoom:14,token:'secret',rows:[{}]}});assert.equal(view.radius,25);assert.deepEqual(view.center,[29,-95]);assert.equal('token' in view,false);assert.equal('rows' in view,false);const invalid=readFieldMapView({cosFieldMapView:{radius:100000,center:[91,400],zoom:100,status:'bad',health:'port'}});assert.equal(invalid.radius,10);assert.equal(invalid.status,'field');assert.equal(invalid.health,'all');assert.equal(invalid.center,undefined);assert.equal(invalid.zoom,undefined);});
test('support-only filter survives navigation history',()=>{assert.equal(readFieldMapView({cosFieldMapView:{health:'support'}}).health,'support');});
test('individual pin preference survives history and invalid modes keep the grouped dashboard default',()=>{
 assert.equal(readFieldMapView({cosFieldMapView:{pinMode:'individual',center:[30,-96],zoom:8}}).pinMode,'individual');
 assert.equal(readFieldMapView({cosFieldMapView:{pinMode:'invalid'}}).pinMode,'grouped');
});

test('old auto-selected history is not treated as an explicit selection',()=>{assert.equal(readFieldMapView({cosFieldMapView:{selectedId:'old-first-unit'}}).selectionExplicit,false);assert.equal(readFieldMapView({cosFieldMapView:{selectedId:'chosen-unit',selectionExplicit:true}}).selectionExplicit,true);});

test('an explicit saved operational health filter remains explicit after the all-states default changes',()=>{assert.equal(readFieldMapView({cosFieldMapView:{health:'operational'}}).health,'operational');assert.equal(readFieldMapView({cosFieldMapView:{health:'unknown'}}).health,'unknown');});

test('explicit Field product review categories survive navigation without admitting arbitrary health values',()=>{for(const health of ['unverified','unlinked','review','inactive'])assert.equal(readFieldMapView({cosFieldMapView:{health}}).health,health);assert.equal(readFieldMapView({cosFieldMapView:{health:'healthy_by_name'}}).health,'all');});
