// Public Playwright API only. Trial runs the real hit-target check and does not
// click. The element click is only for a headless mouseReleased that never returns.
export async function clickAfterTrial(locator) {
  await locator.click({ trial: true });
  await locator.evaluate(element => element.click());
}
