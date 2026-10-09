// Standalone registration shim for the known Node 24 Playwright CLI collection issue.
// The exact same browser cases and Playwright assertions run in CI and this local runner.
export { expect } from '@playwright/test';
export const cases = [];
export const test = (name, run) => { cases.push({ name, run }); };
