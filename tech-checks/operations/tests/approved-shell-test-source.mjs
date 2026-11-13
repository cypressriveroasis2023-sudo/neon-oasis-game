import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const base='c8d2bbc4348ec94dd44e9edd1e01d92e5fa307f3';
export const hashes={
 'company-theme.browser.spec.mjs':['89b63f512c452c295fd7c9c1b84f0097ef2ea3fb','f96ced1cee499bf2461ec1fa4518d83a64593b98'],
 'company-overview.browser.spec.mjs':['f261f559afb18cc046b7a2f1ef81916f60436f30','990d2ccf4ef121f0ff8c6c5da7204faa98f642ad'],
 'responsive-host.browser.spec.mjs':['2f922425469d2ba3db5e3a7d577713b4bcad5a0b','6e8822b2874a7c56f77fee1702617e07e599ebb4'],
 'approved-layout.browser.spec.mjs':['7899baeebeb7ee574fb393bcb8eec0c55ec9d194','31fad1676f162016a78f238e31f80342461cc3a1'],
};
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
export function adapt(file,original){
 if(blob(original)!==hashes[file]?.[0])throw Error('Original test differs: '+file);
 let text=original;
 const replace=(before,after)=>{if(text.split(before).length!==2)throw Error('Non-unique replacement: '+file);text=text.replace(before,after);};
 const between=(start,end,after)=>{const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<a||text.indexOf(start,a+1)>=0)throw Error('Invalid boundary: '+file);text=text.slice(0,a)+after+text.slice(b);};
 replace("import { openWorkspace } from './navigation-helper.mjs';","import { openWorkspace } from './navigation-helper.mjs';\nimport { primaryNav, expectApprovedAreas, openApprovedMore, dismissApprovedMore, openCheckManagement } from './approved-shell-acceptance.mjs';");
 if(file==='company-theme.browser.spec.mjs'){
  replace("expect(facts.sidebar).toBe('rgb(23, 35, 55)')","expect(facts.sidebar).toBe('rgb(13, 33, 55)')");
  replace("if(facts.viewport>700){expect(facts.width).toBe(184);expect(facts.bar).toBe(76);await expect(frame.getByRole('navigation',{name:'COS Operations'}).getByRole('button')).toHaveCount(8);}else{await expect(frame.getByRole('navigation',{name:'Mobile Operations navigation'}).getByRole('button')).toHaveCount(4);}","if(facts.viewport>700){expect(facts.width).toBe(184);expect(facts.bar).toBe(76);}\n  await expectApprovedAreas(frame);");
  between("test('Single menu,","test('native records",`test('Single phone menu traps focus; desktop More is a page and browser Back restores the route',async({page})=>{
  const {frame,requests}=await mount(page);
  await expectApprovedAreas(frame);
  const opened=await openApprovedMore(frame),{tools,dialog,mobile}=opened;
  expect((await auditDarkPresentation(mobile?dialog:tools)).failures).toEqual([]);
  await expect(tools.locator('details')).toHaveCount(4); // four tool groups since the 2026-11-12 menu cleanup
  await tools.getByRole('searchbox',{name:'Find a tool',exact:true}).fill('InHand Routers');
  await expect(tools.getByRole('button',{name:'InHand Routers',exact:true})).toBeVisible();
  await expect(tools.getByRole('button',{name:'Customers',exact:true})).toHaveCount(0);
  if(mobile){
    const close=dialog.getByRole('button',{name:'Close menu'});
    await close.focus();await close.press('Shift+Tab');
    await expect(dialog.getByRole('button',{name:'Sign out',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(close).toBeFocused();
  }
  await dismissApprovedMore(frame,opened);
  await expect(frame.getByRole('heading',{name:'Company overview',exact:true})).toBeVisible();
  expect(requests.every(request=>request.method==='GET')).toBe(true);
});
`);
 }else if(file==='company-overview.browser.spec.mjs'){
  between("    const more = frame.getByRole('button', { name: 'More', exact: true });","    await openWorkspace(frame, 'Jobs');",`    await expectApprovedAreas(frame);
    const opened=await openApprovedMore(frame);
    if(opened.mobile){
      // The approved compact drawer intentionally does not repeat the large logo.
      await expect(opened.dialog.locator('.company-brand')).toBeHidden();
      await expect(opened.dialog.getByRole('heading',{name:'More',exact:true})).toBeVisible();
      expect((await opened.dialog.getByRole('button',{name:'Close menu'}).boundingBox()).height).toBeGreaterThanOrEqual(44);
    }else{
      await expect(brand).toBeVisible();
      await expect(brand.locator('.cos-company-logo')).toHaveAttribute('data-company-logo','full');
    }
    await dismissApprovedMore(frame,opened);
`);
 }else if(file==='approved-layout.browser.spec.mjs'){
  between(" await frame.getByRole('button',{name:'More',exact:true}).click();"," await frame.locator('.company-utility-bar').screenshot",` const nav=await expectApprovedAreas(frame);
 const selected=nav.locator('button.cos-approved-selected');
 await expect(selected).toHaveCount(1);
 await expect(selected).toHaveText('More');
 await expect(selected).toHaveCSS('background-color','rgb(200, 13, 36)');
 await expect(selected).toHaveCSS('color','rgb(255, 255, 255)');
 const backgrounds=await nav.locator('button:not(.cos-approved-selected)').evaluateAll(buttons=>buttons.map(button=>getComputedStyle(button).backgroundColor));
 expect(backgrounds.every(color=>color!=='rgb(200, 13, 36)')).toBe(true);
 const opened=await openApprovedMore(frame);await dismissApprovedMore(frame,opened);
`);
 }else if(file==='responsive-host.browser.spec.mjs'){
  between("  const more=frame.getByRole('button',{name:'More',exact:true});","  const sizes=",`  await responsiveLayout(page,frame);
  const opened=await openApprovedMore(frame);
  await opened.tools.screenshot({path:testInfo.outputPath('unified-menu.png')});
  await dismissApprovedMore(frame,opened);
  await openWorkspace(frame,'Tech Check');
  await expect(frame.getByRole('dialog',{name:'Operations navigation'})).toHaveCount(0);
  await expect(frame.getByRole('region',{name:'Tech Check workspaces'})).toBeVisible();
  expect(await frame.locator('body').evaluate(()=>location.hash)).toBe('#tech-check');
`);
  replace("  await expect(frame.getByRole('button',{name:'More',exact:true})).toBeVisible();","  await expectApprovedAreas(frame);");
  replace("menu:header.querySelector('.operations-open-menu').getBoundingClientRect().toJSON()","menu:main.parentElement.querySelector(innerWidth>700?'.operations-area-nav button:last-child':'.operations-bottom-nav button:last-child').getBoundingClientRect().toJSON()");
  replace("expect(size.menu.left).toBeGreaterThanOrEqual(size.header.left);\n    expect(size.menu.right).toBeLessThanOrEqual(size.header.right);","expect(size.menu.left).toBeGreaterThanOrEqual(0);\n    expect(size.menu.right).toBeLessThanOrEqual(size.main.left);");
  replace("  await frame.getByRole('button', { name:'More', exact:true }).click();\n  await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Tech Checks',exact:true}).click();","  await openWorkspace(frame,'Tech Check');\n  await openCheckManagement(frame);");
  replace("      await frame.getByRole('button',{name:'More',exact:true}).click();\n      await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Tech Checks',exact:true}).click();","      await openWorkspace(frame,'Tech Check');\n      await openCheckManagement(frame);");
 }
 if(blob(text)!==hashes[file][1])throw Error('Candidate mismatch: '+file);
 return text;
}
if(process.argv[2]){
 const mode=process.argv[2];if(!['apply','check'].includes(mode))throw Error('Use apply or check');
 for(const file of Object.keys(hashes)){
  const original=execFileSync('git',['show',base+':tech-checks/operations/tests/'+file],{encoding:'utf8'});
  const path=new URL(file,import.meta.url),candidate=adapt(file,original),current=readFileSync(path,'utf8');
  if(mode==='apply'){if(current!==original)throw Error('Working test differs: '+file);writeFileSync(path,candidate);}
  else if(current!==candidate)throw Error('Committed test differs: '+file);
  console.log(mode+': '+file+' verified against exact original');
 }
}
