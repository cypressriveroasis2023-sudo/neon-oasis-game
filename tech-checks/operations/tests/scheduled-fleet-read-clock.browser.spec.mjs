import {test,expect} from '@playwright/test';
import {advanceToScheduledFleetRead} from './helpers/scheduled-fleet-read.mjs';

test('scheduled-read clock tolerates delayed CI delivery without pausing in the past',async({page})=>{
 await page.clock.install({time:new Date('2026-11-08T12:00:00.000Z')});
 await page.goto('/');
 await page.evaluate(()=>{
  document.body.replaceChildren();
  const started=Date.now();
  window.syntheticScheduledReads=0;
  const timer=setInterval(()=>{
   if(Date.now()-started>=10*60000){window.syntheticScheduledReads++;clearInterval(timer);}
  },1000);
 });
 const delayedPage={clock:{
  pauseAt:async time=>{await new Promise(resolve=>setTimeout(resolve,1500));await page.clock.pauseAt(time);},
  setSystemTime:time=>page.clock.setSystemTime(time),
  runFor:time=>page.clock.runFor(time),
  resume:()=>page.clock.resume(),
 }};
 await advanceToScheduledFleetRead(delayedPage,page,()=>page.evaluate(()=>window.syntheticScheduledReads===1));
 await expect.poll(()=>page.evaluate(()=>window.syntheticScheduledReads)).toBe(1);
});
