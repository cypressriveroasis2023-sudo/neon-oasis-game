// Existing same-person accounts. Checklist presentation, never authorization.
const noCompanyVehicle = new Set([
  'd0757b64-9623-4adc-afff-21cc7853e88a','3caf7c00-627f-445f-bce4-ddeae574ee5c',
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc','b7cc3cbf-d11e-4d4a-9742-c07701857911',
]);
export function vehicleInspectionExempt(person:{userId?:string;name?:string}) {
  return noCompanyVehicle.has(String(person.userId||'').toLowerCase()) || ['teddy hopper','victor garcia'].includes(String(person.name||'').trim().toLowerCase());
}
