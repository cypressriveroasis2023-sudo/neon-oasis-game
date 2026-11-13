import { expect } from '@playwright/test';

// Test navigation only: normal clicks and browser Back; never route injection.
export async function primaryNav(frame) {
  const mobile=await frame.locator('body').evaluate(()=>innerWidth<=700);
  return frame.getByRole('navigation',{name:mobile?'Mobile Operations navigation':'COS Operations',exact:true});
}
export async function expectApprovedAreas(frame) {
  const nav=await primaryNav(frame);
  await expect(nav).toBeVisible();
  // Four areas since 2026-11-12: Boards (the Daily Board) is retired with the
  // other ticketing and billing workspaces. It must not come back silently.
  await expect(nav.getByRole('button')).toHaveCount(4);
  for(const name of ['Fleet','Tech Check','Team','More'])await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();
  await expect(nav.getByRole('button',{name:'Boards',exact:true})).toHaveCount(0);
  await expect(frame.locator('.company-utility-bar .operations-open-menu')).toHaveCount(0);
  return nav;
}
export async function openApprovedMore(frame) {
  const mobile=await frame.locator('body').evaluate(()=>innerWidth<=700);
  const priorHash=await frame.locator('body').evaluate(()=>location.hash);
  const more=(await primaryNav(frame)).getByRole('button',{name:'More',exact:true});
  await more.click();
  const dialog=frame.getByRole('dialog',{name:'Operations navigation'});
  const tools=mobile?dialog.locator('.cos-approved-tools'):frame.locator('main .cos-approved-tools');
  await expect(tools).toBeVisible();
  if(mobile){
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole('button',{name:'Close menu'})).toBeFocused();
    await expect(dialog.locator('.operations-area-nav')).toBeHidden();
    expect(await frame.locator('body').evaluate(()=>location.hash)).toBe(priorHash);
  }else{
    await expect(dialog).toHaveCount(0);
    expect(await frame.locator('body').evaluate(()=>location.hash)).toBe('#operations');
  }
  return {mobile,priorHash,more,dialog,tools};
}
export async function dismissApprovedMore(frame,opened) {
  if(opened.mobile){
    await opened.dialog.getByRole('button',{name:'Close menu'}).press('Escape');
    await expect(opened.dialog).toHaveCount(0);
    await expect(opened.more).toBeFocused();
  }else{
    await frame.locator('body').evaluate(()=>history.back());
  }
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe(opened.priorHash);
}
export async function openCheckManagement(frame) {
  const group=frame.getByRole('region',{name:'Tech Check workspaces'}).locator('details').filter({has:frame.locator('summary').filter({hasText:/^Manage Tech Checks$/})});
  if(await group.getAttribute('open')===null)await group.locator('summary').click();
  await expect(group).toHaveAttribute('open','');
}
