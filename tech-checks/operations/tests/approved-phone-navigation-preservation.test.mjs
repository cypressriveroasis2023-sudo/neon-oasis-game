import test from 'node:test';
import {readFileSync} from 'node:fs';
import {cases,verify} from './approved-phone-navigation-source.mjs';
for(const file of Object.keys(cases))test('phone navigation retains exact original behavior outside declared UI changes: '+file,()=>{
 verify(file,readFileSync(new URL(file,import.meta.url),'utf8'));
});
