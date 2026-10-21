import {defineConfig} from '@playwright/test';

// This fixture intercepts every request and runs only disposable local SQL.
// It does not start the application server or read production credentials.
export default defineConfig({
 testDir:'.',testMatch:'transfer-corrections.browser.spec.mjs',
 timeout:45000,expect:{timeout:10000},fullyParallel:false,workers:1,retries:0,
 reporter:[['list'],['json',{outputFile:new URL('../test-results-corrections/results.json',import.meta.url).pathname}]],outputDir:'../test-results-corrections',
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',viewport:{width:390,height:844},timezoneId:'UTC',
  launchOptions:process.env.COS_TEST_CHROMIUM?{executablePath:process.env.COS_TEST_CHROMIUM,args:['--no-sandbox']}:undefined,
  trace:'retain-on-failure',screenshot:'only-on-failure'},
});
