import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const fixtureUrl=process.env.COS_FULL_UPLOAD_REPO_ROOT?pathToFileURL(resolve(process.env.COS_FULL_UPLOAD_REPO_ROOT,'tech-checks/operations/tests/fixtures/placement-label-index.mjs')):new URL('../../fixtures/placement-label-index.mjs',import.meta.url);
const fixture=await import(fixtureUrl),require=createRequire(new URL('../../package.json',fixtureUrl));
export const {smallFixture,representativeFixture,t,n,sha,org}=fixture;
export const {PGlite}=require('@electric-sql/pglite');
export const testDir=dirname(fileURLToPath(import.meta.url));
export const dbDir=resolve(testDir,'../db');
