import {defineConfig} from '../../operations/node_modules/@playwright/test/index.mjs';
export default defineConfig({
 testDir:'.',testMatch:'owner-host-routing.browser.spec.mjs',timeout:45000,
 expect:{timeout:10000},workers:1,retries:0,reporter:[['list']],
 outputDir:'../../operations/test-results-transfers/owner-routing',
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',viewport:{width:1440,height:900},trace:'retain-on-failure',screenshot:'only-on-failure'},
});
