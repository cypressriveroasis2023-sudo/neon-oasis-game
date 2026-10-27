export type FieldProductFollowUp={
 category:'source_review'|'lifecycle_review'|'tracker_ip'|'endpoint_ownership'|'saved_endpoint'|'saved_check'|'source_unavailable'|'device_link'|'evidence_review';
 label:string;
 responsibleRole:'Owner'|'IT'|'IT and Owner';
 nextStep:string;
};

const sourceReview:FieldProductFollowUp={
 category:'source_review',label:'Source records need review',responsibleRole:'Owner',
 nextStep:'Compare this Product ID with the existing tracker, mHelpDesk and COS equipment records. Use the existing review process to confirm its identity and placement.'
};
const ownershipReview:FieldProductFollowUp={
 category:'endpoint_ownership',label:'Endpoint ownership needs review',responsibleRole:'IT and Owner',
 nextStep:'IT: identify which exact Product ID owns the saved endpoint. Owner: review the conflicting records before any connection is assigned.'
};
const knownReasons:Record<string,FieldProductFollowUp>={
 'Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.':sourceReview,
 'Equipment identity or placement is held for review.':sourceReview,
 'No verified public tracker IP is available for this Product ID.':{
  category:'tracker_ip',label:'Tracker IP not verified',responsibleRole:'IT',
  nextStep:'Confirm the current network assignment for this exact Product ID. Submit any tracker correction through the existing review process.'
 },
 'Another Product ID claims this tracker IP; verify endpoint ownership.':ownershipReview,
 'More than one saved endpoint claims this tracker IP; verify exact device ownership.':ownershipReview,
 'No saved camera endpoint matches the current tracker IP.':{
  category:'saved_endpoint',label:'Saved connection needs review',responsibleRole:'IT',
  nextStep:'Review the saved camera connection for this exact Product ID and compare it with the current tracker record.'
 },
 'No fresh, completed, exact-target TCP/service-port check is available.':{
  category:'saved_check',label:'Saved check needs review',responsibleRole:'IT',
  nextStep:'Open the existing unit or source record and review its last saved check and connection settings. A more specific cause has not been established.'
 },
 'The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.':{
  category:'source_unavailable',label:'Connection source unavailable',responsibleRole:'IT',
  nextStep:'Refresh the Fleet view once. If this message remains, check whether COS can read the current tracker and saved camera checks.'
 }
};
const knownReason=(reason?:string):FieldProductFollowUp|undefined=>typeof reason==='string'&&Object.hasOwn(knownReasons,reason)?knownReasons[reason]:undefined;

/** Read-only guidance from known reasons and existing classified states.
 * It never diagnoses a more specific failure than the source supplies, and
 * never changes health, placement, permissions or observation timestamps. */
export function fieldProductFollowUp(state:string,reason:string,exactUnknownReason?:string):FieldProductFollowUp|null{
 if(state==='online'||state==='offline')return null;
 const exact=knownReason(exactUnknownReason);
 // Support has no camera outage. A separate, explicit source/ownership hold
 // can still need review; a missing IP alone does not create support work.
 if(state==='support')return exact&&['source_review','endpoint_ownership'].includes(exact.category)?{...exact}:null;
 if(state==='inactive')return {
  category:'lifecycle_review',label:'Inactive record needs review',responsibleRole:'Owner',
  nextStep:'Review the existing Missing, Do Not Use or inactive restriction before returning this equipment to operational use.'
 };
 if(state==='review')return {...sourceReview};
 if(!['unverified','unlinked'].includes(state))return null;
 const known=knownReason(reason);
 if(known)return {...known};
 if(state==='unlinked')return {
  category:'device_link',label:'Device link needs review',responsibleRole:'IT and Owner',
  nextStep:'Review the exact Product ID and its existing COS equipment and device records. Confirm the association through the existing review process.'
 };
 return {
  category:'evidence_review',label:'Saved evidence needs review',responsibleRole:'IT',
  nextStep:'Open the existing unit or source record and review the saved evidence for this Product ID. A more specific cause has not been established.'
 };
}
