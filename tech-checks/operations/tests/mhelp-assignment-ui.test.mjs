import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import OwnerAssignmentReview from '../src/OwnerAssignmentReview.tsx';
const assignment={placement:'FIELD',customer:'Old customer',customerId:'100',address:{street:'Old street',city:'Houston',state:'TX',zip:'77064'}};
const review={contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId:'stage',sourceSha256:'a'.repeat(64),censusSha256:'c'.repeat(64),reviewDigest:'d'.repeat(64),approved:false,items:[{productId:'2229931',unitNumber:'Solar Stand 015',before:assignment,after:{...assignment,placement:'SHOP',customer:'Cameras OnSite'},identity:{trackerId:'tracker-exact',trackerLabel:'Solar Stand 72 015',nativeUnitId:null,nativeLabel:null},current:{nativePlacement:null,nativeStatus:null,internalTrackerPlacement:'FIELD',internalTrackerCustomer:'Old customer',internalTrackerSite:'Old site',gpsPresent:false,shopReceiptId:null,shopRecordedAt:null},guardChanged:false,eligible:true,blocker:null}]};
test('Owner review shows before/after exact identity and requires explicit confirmation, with no implied GPS or repeat move',()=>{
 const html=renderToStaticMarkup(React.createElement(OwnerAssignmentReview,{review,pending:false,onApprove:()=>{throw Error('No implicit approval')}}));
 for(const value of ['Before:','Proposed:','Product 2229931','tracker-exact','None — tracker-only','Google 2027','not verified installation GPS','Approve these assignments'])assert.ok(html.includes(value),value);
 assert.match(html,/<button disabled=""/);assert.match(html,/type="checkbox"/);
});
test('recorded Shop state and ineligible identity are shown instead of an automatic guard refresh',()=>{
 const item={...review.items[0],guardChanged:true,eligible:false,blocker:'Identity conflict',current:{...review.items[0].current,shopReceiptId:'recorded-move',shopRecordedAt:'2026-10-20T23:00:00Z'}};
 const html=renderToStaticMarkup(React.createElement(OwnerAssignmentReview,{review:{...review,items:[item]},pending:false,onApprove:()=>{}}));
 assert.match(html,/recorded-move/);assert.match(html,/move is not repeated/);assert.match(html,/Identity conflict/);assert.match(html,/<button disabled=""/);
});
