/* Presentation adapter: the original Service lookup owns authorization, readiness,
   record reads and all writes. This form forwards to its existing controls. */
const decorateService=()=>{
  const home=document.querySelector('#wlSvcHome .wl-service-simple-shell');
  if(!home||home.querySelector('.vision-ticket-entry'))return;
  const trigger=home.querySelector('[data-wl-service-open-job]');
  if(!trigger)return;
  const form=document.createElement('form');
  form.className='vision-ticket-entry';
  const label=document.createElement('label');label.textContent='Ticket number';
  const input=document.createElement('input');input.name='ticket';input.inputMode='numeric';input.autocomplete='off';input.placeholder='Enter ticket number';input.required=true;
  label.append(input);
  const button=document.createElement('button');button.type='submit';button.textContent='Open service check →';
  form.append(label,button);
  form.addEventListener('submit',event=>{
    event.preventDefault();const ticket=input.value.trim();if(!ticket){input.focus();return;}
    trigger.click();
    requestAnimationFrame(()=>{
      const target=document.getElementById('wlServiceJobSearch');
      if(target instanceof HTMLInputElement){target.value=ticket;target.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-wl-service-find-job]')?.click();}
    });
  });
  home.querySelector('.wl-service-action-list')?.before(form);
};
let queued=false;
const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;decorateService();});}});
observer.observe(document.getElementById('view-svc')||document.body,{childList:true,subtree:true});
decorateService();
