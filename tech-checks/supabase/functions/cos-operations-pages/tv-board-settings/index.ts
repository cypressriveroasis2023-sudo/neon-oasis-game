export const TV_SECTIONS = [
  {key:'today',label:'Today’s jobs'}, {key:'pickup',label:'Pending pickups'},
  {key:'swap',label:'Pending swaps'}, {key:'delivery',label:'Pending deliveries'},
  {key:'service',label:'Pending service calls'}, {key:'shop',label:'Shop updates'},
  {key:'readiness',label:'Team readiness'}, {key:'camera',label:'Camera Health'}, {key:'map',label:'Field Map'},
] as const;
export type TvSection = typeof TV_SECTIONS[number]['key'];
export type TvSettings = {sections:TvSection[];revision:number;updatedAt:string|null};
export const DEFAULT_TV_SECTIONS:TvSection[] = ['today','pickup','swap','delivery','service','shop','camera','map'];
export function checkedTvSections(value:unknown):TvSection[] {
  if(!Array.isArray(value)||value.length>TV_SECTIONS.length||value.some(key=>!TV_SECTIONS.some(section=>section.key===key))||new Set(value).size!==value.length)throw new Error('Choose valid TV board sections.');
  return TV_SECTIONS.map(section=>section.key).filter(key=>value.includes(key));
}
export function checkedTvSettings(value:unknown):TvSettings {
  const row=value as TvSettings;
  if(!row||typeof row!=='object'||!Number.isSafeInteger(row.revision)||row.revision<0||!(row.updatedAt===null||typeof row.updatedAt==='string'&&Number.isFinite(Date.parse(row.updatedAt))))throw new Error('TV settings could not be verified. Refresh before saving.');
  return {...row,sections:checkedTvSections(row.sections)};
}
