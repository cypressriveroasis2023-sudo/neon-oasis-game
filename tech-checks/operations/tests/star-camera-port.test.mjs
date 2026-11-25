import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraWebPort, projectUnitCameraStatus} from '../shared/starUnitStatus.ts';

test('a camera on the company standard gets its forwarded web port, and nothing else does', () => {
  assert.equal(cameraWebPort('192.168.10.14'), 1400);
  assert.equal(cameraWebPort('192.168.10.17'), 1700);
  assert.equal(cameraWebPort('192.168.10.19'), 1900);
  for (const off of ['192.168.10.18', '192.168.10.24', '192.168.1.14', '10.0.10.14', '', null, undefined]) assert.equal(cameraWebPort(off), null);
});

test('the camera list sends the port, never the local address', () => {
  const rows = [
    {device_name: 'SS044_1', unit_key: 'SOLARSPOTTER 044', organization: 'Site A', vigilant_status: 'online', activation_state: 'active', public_ip: '203.0.113.130', local_ip: '192.168.10.14'},
    {device_name: 'SS044_9', unit_key: 'SOLARSPOTTER 044', organization: 'Site A', vigilant_status: 'offline', activation_state: 'active', public_ip: '203.0.113.130', local_ip: '192.168.10.40'},
  ];
  const out = projectUnitCameraStatus(rows);
  const list = out.units[0].cameraList;
  assert.equal(list.find(c => c.name === 'SS044_1').port, 1400);
  assert.equal('port' in list.find(c => c.name === 'SS044_9'), false);
  assert.equal(JSON.stringify(out).includes('192.168.10'), false);
});
