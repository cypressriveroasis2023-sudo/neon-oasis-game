// Signature input only. The server records the account, statement and timestamp.
export const SIGNOFF_STATEMENT = 'I confirm that I physically checked the truck, trailer if applicable, equipment, SIM cards and battery quantities, and that the answers and images in this report accurately show what is on my truck.';
export const newSignature = () => ({method:'drawn',typedName:'',strokes:[],confirmed:false,blob:null});
const canvasFor = state => {
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=180;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,180);ctx.strokeStyle='#111';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
  for(const stroke of state.strokes||[]){if(!stroke.length)continue;ctx.beginPath();ctx.moveTo(stroke[0].x,stroke[0].y);for(const point of stroke.slice(1))ctx.lineTo(point.x,point.y);ctx.stroke();}
  return canvas;
};
export const hasSignatureInk = state => (state.strokes||[]).some(stroke=>stroke.length>1 && stroke.some(p=>Math.hypot(p.x-stroke[0].x,p.y-stroke[0].y)>3));
export async function signatureJpeg(state){
  if(!hasSignatureInk(state))throw new Error('Draw your signature, or choose Type signature and enter your full name.');
  return await new Promise((resolve,reject)=>canvasFor(state).toBlob(blob=>blob?resolve(blob):reject(new Error('Could not save your signature. Please retry.')),'image/jpeg',0.95));
}
export function createDailySignoff({state,actorName,onChange,isBusy,statementText=SIGNOFF_STATEMENT,signatureGroup='daily-signature-method-'+crypto.randomUUID()}) {
  const section=document.createElement('section');section.className='cos-daily-signoff';
  const title=document.createElement('h3');title.textContent='Technician signature';
  const account=document.createElement('p');account.textContent='Signed-in technician: '+actorName;
  const statement=document.createElement('p');statement.textContent=statementText;
  const choices=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Signature method';choices.append(legend);
  const radios={};
  for(const [value,caption] of [['drawn','Draw signature'],['typed','Type signature']]){
    const label=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name=signatureGroup;input.value=value;input.checked=state.method===value;radios[value]=input;label.append(input,' '+caption);choices.append(label);
    input.addEventListener('change',()=>{if(isBusy())return;state.method=value;invalidate();render();});
  }
  const draw=document.createElement('div'),canvas=canvasFor(state);canvas.setAttribute('aria-label','Draw technician signature');canvas.setAttribute('role','img');canvas.className='cos-signature-canvas';
  const hint=document.createElement('p');hint.textContent='Sign with your finger or mouse. Use Type signature if you prefer the keyboard.';
  const clear=document.createElement('button');clear.type='button';clear.textContent='Clear signature';clear.addEventListener('click',()=>{if(isBusy())return;state.strokes=[];state.blob=null;invalidate();paint();});draw.append(hint,canvas,clear);
  const typed=document.createElement('label');typed.append('Type your full name');const input=document.createElement('input');input.type='text';input.autocomplete='name';input.setAttribute('aria-label','Type your full name');input.placeholder=actorName;input.value=state.typedName||'';input.maxLength=150;typed.append(input);
  const typedHint=document.createElement('p');typedHint.textContent='Enter '+actorName+' to sign as the technician on this account.';typed.append(typedHint);
  input.addEventListener('input',()=>{if(isBusy())return;state.typedName=input.value;invalidate();});
  const accept=document.createElement('label'),confirmed=document.createElement('input');confirmed.type='checkbox';confirmed.checked=state.confirmed===true;confirmed.setAttribute('aria-label','I confirm this report is accurate');accept.append(confirmed,' I confirm this report is accurate and I am signing it as the technician shown above.');
  confirmed.addEventListener('change',()=>{if(isBusy())return;state.confirmed=confirmed.checked;onChange();});
  const time=document.createElement('p');time.textContent='Date and time: recorded automatically when you complete this report (America/Chicago).';
  function invalidate(){state.confirmed=false;confirmed.checked=false;onChange();}
  function paint(){canvas.getContext('2d').drawImage(canvasFor(state),0,0);}
  function render(){draw.hidden=state.method!=='drawn';typed.hidden=state.method!=='typed';}
  let pointer=null,stroke;
  const point=e=>{const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(600,(e.clientX-rect.left)*600/rect.width)),y:Math.max(0,Math.min(180,(e.clientY-rect.top)*180/rect.height))};};
  canvas.addEventListener('pointerdown',e=>{if(isBusy()||e.button!==0)return;e.preventDefault();pointer=e.pointerId;canvas.setPointerCapture(pointer);stroke=[point(e)];state.strokes.push(stroke);state.blob=null;state.confirmed=false;confirmed.checked=false;});
  canvas.addEventListener('pointermove',e=>{if(pointer!==e.pointerId||isBusy())return;e.preventDefault();stroke.push(point(e));paint();});
  const finish=e=>{if(pointer!==e.pointerId)return;pointer=null;state.blob=null;invalidate();};
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  section.append(title,account,statement,choices,draw,typed,accept,time);render();return section;
}
