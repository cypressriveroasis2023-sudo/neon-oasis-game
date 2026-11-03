import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {openWorkspace} from './navigation-helper.mjs';
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);};

test('all check-card labels and descriptions remain readable against their actual backgrounds',async({page})=>{
 const {app,state}=await mountFleet(page);await openWorkspace(app,'Tech Check');const hub=app.getByRole('region',{name:'Tech Check workspaces',exact:true});await hub.locator('summary').click();
 const check=async()=>{
  const colors=await hub.locator('.operations-tool-grid > button').evaluateAll(buttons=>{
   const rgb=value=>{const m=value.match(/^rgba?\(([^)]+)\)$/);if(!m)throw Error('Unexpected computed color '+value);const parts=m[1].split(',').map(Number);if(parts.length===4&&parts[3]!==1)throw Error('Transparent button color');return parts.slice(0,3).map(v=>v/255);};
   const lum=value=>rgb(value).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
   return buttons.flatMap(button=>[...button.querySelectorAll('b,span')].map(text=>{const bg=lum(getComputedStyle(button).backgroundColor),fg=lum(getComputedStyle(text).color);return {text:text.textContent,contrast:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};}));
  });
  expect(colors).toHaveLength(26);for(const item of colors)expect(item.contrast,item.text).toBeGreaterThanOrEqual(4.5);
 };
 await check();await hub.getByRole('button',{name:/^Check handoffs & returns/}).hover();await check();safe(state);
});
