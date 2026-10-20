import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'.',timeout:45000,expect:{timeout:10000},fullyParallel:false,workers:1,retries:0,reporter:[['list']],outputDir:'../test-results-ticketfree',use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[
 {name:'chromium',testMatch:['ticketfree-returns.browser.spec.mjs','service-basics.browser.spec.mjs','transfer.browser.spec.mjs','transfer-readiness.browser.spec.mjs'],use:{browserName:'chromium',viewport:{width:390,height:844},launchOptions:process.env.COS_TEST_CHROMIUM?{executablePath:process.env.COS_TEST_CHROMIUM}:undefined}},
 {name:'iphone-webkit',testMatch:['ticketfree-returns.browser.spec.mjs'],use:{...devices['iPhone 13'],browserName:'webkit'}}
]});
