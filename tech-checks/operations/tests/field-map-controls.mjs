export async function revealMapFilters(frame){const diagnostics=frame.locator('.cos-fleet-diagnostic-records');if(await diagnostics.count()&&await diagnostics.getAttribute('open')===null)await diagnostics.locator(':scope > summary').click();const filters=frame.locator('.cos-fleet-filters .cos-fleet-advanced-filters'),summary=filters.locator(':scope>summary');if(await summary.count()&&await filters.getAttribute('open')===null)await summary.click();}
export async function revealMapInfo(frame){const summary=frame.locator('.cos-fleet-map-info>summary');if(await summary.count()&&await frame.locator('.cos-fleet-map-info').getAttribute('open')===null)await summary.click();}
export async function showAllFieldHealth(frame){await revealMapFilters(frame);await frame.getByLabel('Fleet status',{exact:true}).selectOption('all');}

export async function revealUnitTroubleshooting(frame){const details=frame.locator('.cos-fleet-troubleshooting'),summary=details.locator(':scope>summary');if(await summary.count()&&await details.getAttribute('open')===null)await summary.click();}

export async function revealInstallationEvidence(frame){const details=frame.locator('.cos-fleet-installation-evidence'),summary=details.locator(':scope>summary');await summary.waitFor({state:'visible'});if(await details.getAttribute('open')===null)await summary.click();}
