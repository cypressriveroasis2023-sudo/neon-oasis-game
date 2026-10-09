import {importPKCS8,SignJWT} from 'jose';
import type {SheetsAssertionSigner} from './googleSheets.ts';
// jose enforces RS256 and the RSA minimum key size. Deno resolves the pinned
// dependency via deno.json; the generic handler never imports a Node package.
export const signSheetsAssertion:SheetsAssertionSigner=async(privateKey,header,payload)=>
 new SignJWT(payload).setProtectedHeader(header).sign(await importPKCS8(privateKey,'RS256'));
