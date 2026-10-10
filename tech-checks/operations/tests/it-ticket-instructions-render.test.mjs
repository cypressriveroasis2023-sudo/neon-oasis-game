import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const browser=readFileSync(new URL('./it-ticket-instructions.browser.spec.mjs',import.meta.url),'utf8');
// This is only a runtime dependency smoke test, not a replacement browser pass.
// Execute the same protected render functions/helper sources as the browser
// fixture, before its event wiring. No alternate prep renderer is supplied.
const fixture=new Function('readFileSync','resolve','repo',browser.slice(browser.indexOf('const legacy='),browser.indexOf('new vm.Script(fixture);'))+'\nreturn fixture;')(readFileSync,resolve,repo);
test('actual resumed-prep renderer produces the selector contract and follows the current persisted ticket',async()=>{
  const nodes=new Map();
  class Node {
    constructor(){this.style={};this.children=[];this.innerHTML='';}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
    append(node){this.children.push(node);}
  }
  const view=new Node();view.id='view-it';const role=new Node();role.id='whoRole';role.textContent='IT Technician';
  const context={document:{getElementById:id=>nodes.get(id)||null,createElement:()=>new Node()},structuredClone};context.window=context;
  vm.createContext(context);vm.runInContext(fixture.slice(0,fixture.indexOf("document.addEventListener('click'")),context);
  await vm.runInContext("fixture.resume=true;showItPrep('fixture-prep')",context);
  const wizard=nodes.get('wlItWizardOnly');assert.ok(wizard);assert.match(wizard.innerHTML,/MHelpDesk Ticket #1001<\/div>/);assert.match(wizard.innerHTML,/id='wlItUnitValue'/);
  await vm.runInContext('itQuestionIndex=1;renderItUnitStep()',context);assert.match(wizard.innerHTML,/MHelpDesk Ticket #1001<\/div>/);assert.match(wizard.innerHTML,/Confirm 1 Helios battery box is prepared/);assert.match(wizard.innerHTML,/type='number'/);
  await vm.runInContext("fixture.prepTicket='1002';showItPrep('fixture-prep')",context);assert.match(wizard.innerHTML,/MHelpDesk Ticket #1002<\/div>/);assert.doesNotMatch(wizard.innerHTML,/Ticket #1001/);
  assert.equal(vm.runInContext('fixture.actions.length',context),0);
});
