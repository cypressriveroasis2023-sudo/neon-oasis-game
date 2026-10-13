export async function revealMapFilters(frame){const summary=frame.locator('.cos-fleet-advanced-filters>summary');if(await summary.count()&&await frame.locator('.cos-fleet-advanced-filters').getAttribute('open')===null)await summary.click();}
export async function revealMapInfo(frame){const summary=frame.locator('.cos-fleet-map-info>summary');if(await summary.count()&&await frame.locator('.cos-fleet-map-info').getAttribute('open')===null)await summary.click();}
export async function showAllFieldHealth(frame){await frame.getByLabel('Fleet status',{exact:true}).selectOption('all');}
