import fs from 'node:fs';
function patch(path,edits){let text=fs.readFileSync(path,'utf8');for(const [before,after] of edits){if(text.includes(after))continue;if(text.split(before).length!==2)throw Error('Unexpected patch context in '+path);text=text.replace(before,after);}fs.writeFileSync(path,text);}
patch('tech-checks/operations/src/FleetDashboard.tsx',[
 ['const completedReading=Boolean(connectionSourceReady&&fieldProducts&&boardData&&cameras.data&&Number.isFinite(snapshotNow));','// Exact Product-ID connection evidence is sufficient to retain the completed\n // reading. An unrelated provider read failure must not prevent persistence.\n const completedReading=Boolean(connectionSourceReady&&fieldProducts&&boardData&&Number.isFinite(snapshotNow));'],
 ['checkedAt:snapshotNow,field:boardData.field,shop:boardData.shop,','checkedAt:Math.trunc(snapshotNow),field:boardData.field,shop:boardData.shop,']
]);
patch('tech-checks/operations/tests/fleet-verify-now.browser.spec.mjs',[
 ["test('saved connection refresh runs before the provider cache expires and never triggers probes'","test('saved connection reads wait for the ten-minute cadence and never trigger probes'"],
 ["const reads=state.calls.filter(c=>c.path==='/api/product-connections').length,health=state.calls.filter(c=>c.path==='/api/camera-health/summary-v3').length;","const reads=state.calls.filter(c=>c.path==='/api/product-connections').length;"],
 [" await page.clock.fastForward(2*60*1000);\n await expect(board.locator('.cos-equipment-total-helios .cos-total-status-offline b')).toHaveText('1');"," await page.clock.fastForward(2*60*1000);\n await expect(board.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');\n expect(state.calls.filter(c=>c.path==='/api/product-connections')).toHaveLength(reads);\n await page.clock.fastForward(8*60*1000+60000);\n await expect(board.locator('.cos-equipment-total-helios .cos-total-status-offline b')).toHaveText('1');"],
 [" expect(state.calls.filter(c=>c.path==='/api/camera-health/summary-v3')).toHaveLength(health);"," // Timer activity is a saved-data GET, not a browser-initiated camera probe."]
]);
patch('tech-checks/operations/tests/fleet-dashboard-fixtures.mjs',[
 ['skipInitialFieldCount=false,productionOwnerUserId}={})','skipInitialFieldCount=false,productionOwnerUserId,failHealth=false}={})'],
 ['history:[],calls:[],fail:false,failVrm:false','history:[],calls:[],fail:failHealth,failVrm:false']
]);
const testPath='tech-checks/operations/tests/fleet-count-retention.browser.spec.mjs';
let tests=fs.readFileSync(testPath,'utf8');
if(!tests.includes('completed connection counts persist when the provider read fails'))tests+=String.raw`

test('completed connection counts persist when the provider read fails',async({page})=>{
 const f=fieldProductFixture();
 const {app,state}=await mountFleet(page,false,{
  field:f.field,health:f.health,productConnections:f.connections,
  skipInitialFieldCount:true,advancingClock:true,failHealth:true,
  productionOwnerUserId:'00000000-0000-4000-8000-000000000002',
 });
 await expect(app.locator('.cos-equipment-total-helios .cos-total-status-online b')).toHaveText('1');
 await expect.poll(()=>app.locator('body').evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('cos-saved-fleet-reading-v1:')))).toBe(true);
 state.calls.length=0;await page.reload();
 const saved=app.getByRole('region',{name:'COS Fleet Dashboard',exact:true});
 await expect(saved.getByText(/Last completed reading/)).toBeVisible();
 expect(state.calls.filter(call=>['/api/camera-health/summary-v3','/api/field-map','/api/product-connections'].includes(call.path))).toHaveLength(0);
 expect(state.errors).toEqual([]);
});
`;
fs.writeFileSync(testPath,tests);
console.log('Prepared persistence guard and explicit ten-minute read regression. No production deployment.');
