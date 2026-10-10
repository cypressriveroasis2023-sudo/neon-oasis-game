import {expect} from '@playwright/test';

// Operations routes live in the iframe's same-document history. A top-level
// page.goBack/goForward waits for a document load that hash traversal cannot emit.
export async function traverseIframeHistory(frame, direction, expectedHash) {
  if (direction !== 'back' && direction !== 'forward') throw new Error('Unsupported history direction');
  await frame.locator('body').evaluate((_element, direction) => { history[direction](); }, direction);
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe(expectedHash);
}
