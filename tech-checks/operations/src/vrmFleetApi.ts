type FleetApi = { get(path:string):Promise<{data:any}> };

/** New clients use the dynamic fleet. Only an absent route on an older backend
 * may fall back to its legacy nine-installation contract during deployment. */
export async function getVrmFleet(api:FleetApi, discover = false):Promise<{data:any}> {
  try {
    return await api.get(discover ? '/api/vrm-fleet/refresh' : '/api/vrm-fleet');
  } catch (cause) {
    if ((cause as {response?:{status?:number}}|null)?.response?.status !== 404) throw cause;
    return api.get('/api/vrm-portal');
  }
}
