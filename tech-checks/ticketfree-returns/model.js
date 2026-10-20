export const INTAKE_CHECKS = Object.freeze([
 ['physical_condition_ok','Physical condition'], ['accessories_ok','Accessories and mounting'],
 ['batteries_ok','Batteries'], ['sd_cards_ok','SD cards'],
 ['electronics_ok','Camera / electronics'], ['power_functions_ok','Power functions'],
]);
export const stateLabel = state => ({waiting_it:'Waiting for IT',checked_in:'Checked in — Ready inventory',repair:'Checked in — Needs repair',identity_review:'Received — Unit ID review'}[state] || 'Status unavailable');
export function validateContext(value, actor, role) {
 if (value?.version!==1 || value.actor_id!==actor || value.role!==role || !Array.isArray(value.truck) || !Array.isArray(value.equipment) || !Array.isArray(value.returns) || !Number.isInteger(value.pending_count)) throw new Error('Return information could not be verified. Refresh before continuing.');
 return value;
}
export function assertIntake({received,disposition,checks,notes,needsReview=false}) {
 if(received!==true)throw new Error('Confirm that IT has physically received this unit.');
 if(needsReview&&disposition!=='review')throw new Error('This unit needs identity verification and cannot be marked Ready.');
 if(!(needsReview?['review']:['ready','repair']).includes(disposition))throw new Error('Choose Ready inventory or Needs repair.');
 if(INTAKE_CHECKS.some(([key])=>typeof checks?.[key]!=='boolean'))throw new Error('Answer all six condition checks.');
 if(disposition==='ready'&&INTAKE_CHECKS.some(([key])=>checks[key]!==true))throw new Error('A failed check must go to repair, not Ready inventory.');
 if(disposition==='repair'&&!String(notes||'').trim())throw new Error('Describe the problem before sending the unit to repair.');
}
export function freshDraft(kind,returnId=null) {
 return {id:crypto.randomUUID(),kind,returnId,returnedKey:'',usedKey:'',notes:'',photos:[],received:false,disposition:'',checks:{},request:null};
}
