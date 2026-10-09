export async function revealMapFilters(frame) {
  const toggle=frame.getByRole('button',{name:/^Filters/});
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
export async function revealMapInfo(frame) {
  const detail=frame.locator('.field-map-info');
  if(!(await detail.evaluate(node=>node.open)))await detail.locator('summary').first().click();
}
