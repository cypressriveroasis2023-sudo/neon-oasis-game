/** Owner-only secondary-address syntax. Provider/imported-address validation stays strict. */
export type OwnerBaseAddress = {street:string;city:string;state:string;zip:string};
export type OwnerSuite = {kind:'suite';identifier:string;sourceText:string};
export type OwnerInstallationAddress = {
  originalAddress:string;
  installation:OwnerBaseAddress;
  secondaryUnit:OwnerSuite|null;
};
/**
 * Deliberately narrow: one comma-delimited Ste/Suite segment with a numbered ID.
 * Keep the exact original text for display and the existing full-address digest.
 * This parses a building address; it never verifies a suite or resolves alternatives.
 */
export function parseOwnerInstallationAddress(
  value:unknown,
  parseFullAddress:(value:unknown)=>OwnerBaseAddress|null,
):OwnerInstallationAddress|null {
  if(typeof value!=='string'||value.length>600||/[\x00-\x1f\x7f]/.test(value))return null;
  const plain=parseFullAddress(value);
  if(plain)return {originalAddress:value,installation:plain,secondaryUnit:null};
  // Every input character must belong to exactly one captured component. In
  // particular, no greedy street capture, arbitrary comma removal, or suffix drop.
  const m=/^\s*([^,]+),\s*((?:ste\.?|suite)\s*#?\s*(\d{1,6}[A-Z]?))\s*,\s*([^,]+),\s*([A-Z]{2}(?:\s*,\s*|\s+)\d{5}(?:-\d{4})?)\s*$/i.exec(value);
  if(!m)return null;
  const installation=parseFullAddress(`${m[1].trim()}, ${m[4].trim()}, ${m[5].trim()}`);
  if(!installation||/\b(?:OR|AND|TO|THROUGH)\b/i.test(installation.street+' '+installation.city))return null;
  return {originalAddress:value,installation,secondaryUnit:{kind:'suite',identifier:m[3],sourceText:m[2]}};
}
