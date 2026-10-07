/* Shape checks for the authenticated, unit-wide compare-and-swap editor. No secrets. */
(function(root){
 'use strict';
 function state(value,id,key){return Boolean(value&&value.device_id===id&&value.unit_key===key&&(value.public_ip===null||typeof value.public_ip==='string')&&Array.isArray(value.expected_ports)&&value.expected_ports.length<=32&&value.expected_ports.every(port=>Number.isInteger(port)&&port>=1&&port<=65535)&&new Set(value.expected_ports).size===value.expected_ports.length&&Number.isSafeInteger(value.connection_revision)&&value.connection_revision>=0&&typeof value.unit_etag==='string'&&value.unit_etag.length>0);}
 function receipt(value,id,key,ip,revision){return state(value,id,key)&&value.ok===true&&value.public_ip===ip&&value.connection_revision>=revision;}
 root.CameraConnectionEditor={state,receipt};
})(globalThis);
