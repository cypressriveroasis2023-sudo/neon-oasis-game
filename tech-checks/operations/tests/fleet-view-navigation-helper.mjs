import {expect} from '@playwright/test';

/** Test-only navigation through the real visible Fleet UI. Never expose a denied
 * destination, mutate a route, or force a click on a hidden menu item. */
export async function fleetViewButton(frame,name) {
  const nav=frame.getByRole('navigation',{name:'Fleet dashboard views',exact:true});
  await expect(nav).toBeVisible();
  const button=nav.getByRole('button',{name,exact:typeof name==='string'});
  if(!await button.isVisible()) {
    const menu=nav.locator('details.cos-approved-fleet-tools');
    await expect(menu).toHaveCount(1);
    if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
  }
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  return button;
}
export async function openFleetView(frame,name) {
  const button=await fleetViewButton(frame,name);
  await button.click();
}
