/** Turn the map-centered stage off. The reviewed board underneath is unchanged. */
export function rollbackFleetMapStageSource(source){
  const from = 'export const FLEET_MAP_STAGE_LAYOUT = true;';
  const to = 'export const FLEET_MAP_STAGE_LAYOUT = false;';
  if(!source.includes(from))throw new Error('stage layout flag missing');
  if(source.split(from).length!==2)throw new Error('stage layout flag is not singular');
  return source.replace(from,to);
}
