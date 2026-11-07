import {expect} from '@playwright/test';

// Exercise the real saved-read timer. Only tests that install an advancing clock
// use this helper; advancing wall time does not send requests or invoke UI handlers.
export async function advanceToScheduledFleetRead(page,app,observed){
 await expect(app.getByRole('button',{name:/Refresh data|Reading data|Reload saved results|Reading saved results|Refresh saved evidence|Retry saved data/})).toHaveCount(0);
 const current=await app.locator('body').evaluate(()=>Date.now());
 await page.clock.pauseAt(new Date(current+1000));
 await page.clock.setSystemTime(new Date(current+10*60000));
 for(let tick=0;tick<61&&!await observed();tick++)await page.clock.runFor(1000);
 await page.clock.resume();
 await expect.poll(observed).toBe(true);
}

export async function nextScheduledFleetRead(page,app,state,path='/api/camera-health/summary-v3'){
 const reads=()=>state.calls.filter(call=>call.path===path).length,before=reads();
 await advanceToScheduledFleetRead(page,app,()=>reads()>before);
 await expect.poll(reads).toBe(before+1);
}
