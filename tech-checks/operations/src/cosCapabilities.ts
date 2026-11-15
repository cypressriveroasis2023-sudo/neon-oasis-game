/**
 * What a signed-in person may do in COS, in one place.
 *
 * The rule, in James's words: he and IT both see every camera and every stand
 * at once, find any of them, and fix, change or correct them anytime. The
 * restrictions sit on management and on record authority, not on the
 * equipment. So there is one app, not an owner app and a cut-down IT app.
 *
 * This map only ever NARROWS what the session already grants. The session's
 * `features` come from the server, and every write is checked again there and
 * in the database; nothing here can hand out a permission the server withheld.
 * If a capability is refused in the app, this file says why. If it is refused
 * after the app allows it, the grant is missing server-side.
 */

export type Capability =
  // Equipment: the stands and the cameras on them. Owner and IT alike.
  |'equipment.see'            // the fleet map, the unit list, every camera on every unit
  |'equipment.locate'         // find a unit on the map, read its site and address
  |'equipment.history'        // what this unit has done and what was changed on it
  |'equipment.refresh'        // ask for a fresh reading by hand
  |'equipment.routers'        // InHand router state
  |'equipment.power'          // Victron power readings
  |'equipment.tracker'        // the 2027 unit tracker
  |'equipment.placement'      // move a unit between field and shop
  |'equipment.site'           // name the customer and site
  |'equipment.address'        // set the address, which drops the map pin
  |'equipment.publicIp'       // correct the public IP
  |'equipment.cameraSwap'     // say a camera is no longer on this unit
  |'equipment.rename'         // the name the board shows for a unit
  |'equipment.ticket'         // raise a ticket from what you are looking at
  |'equipment.techCheck'      // tech checks, in the app rather than the legacy page
  // Management and record authority. The owner's, unless James moves one.
  |'owner.boards'             // daily board, today's work
  |'owner.team'               // team and owner tasks
  |'owner.mhelpSync'          // importing and syncing mHelp tickets
  |'owner.census'             // census and field location verification
  |'owner.identityReview'     // reconciling a unit's identity against mHelp
  |'owner.trackerRequests'    // asking for a 2027 tracker row to be added or changed
  |'owner.diagnostics';       // advanced diagnostics

/** Everything to do with a stand or a camera. Owner and IT are identical here. */
export const EQUIPMENT_CAPABILITIES = [
  'equipment.see','equipment.locate','equipment.history','equipment.refresh',
  'equipment.routers','equipment.power','equipment.tracker','equipment.placement',
  'equipment.site','equipment.address','equipment.publicIp','equipment.cameraSwap',
  'equipment.rename','equipment.ticket','equipment.techCheck',
] as const satisfies readonly Capability[];

/** Management and record authority. Not field work. */
export const OWNER_CAPABILITIES = [
  'owner.boards','owner.team','owner.mhelpSync','owner.census',
  'owner.identityReview','owner.trackerRequests','owner.diagnostics',
] as const satisfies readonly Capability[];

type SessionLike = {
  authorized?:unknown; role?:unknown; legacyOwner?:unknown;
  features?:Record<string,unknown>;
};

const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
const feature=(session:SessionLike,name:string)=>object(session.features)&&session.features[name]===true;

/** Signed in and linked to COS Operations. Everything else rests on this. */
export const signedIn=(session:unknown):session is SessionLike=>
  object(session)&&session.authorized===true&&['Owner','IT'].includes(String(session.role));

/**
 * A capability the server has to grant before the app offers it. Showing a
 * control the server will refuse is worse than not showing it, because the
 * person finds out only after they have done the work.
 */
const SERVER_GRANTED:Partial<Record<Capability,string>>={
  'equipment.placement':'fleetPlacementEdit',
  'equipment.publicIp':'fleetConnectionEdit',
  'equipment.tracker':'unitTracker',
  'owner.trackerRequests':'unitTracker',
  'equipment.power':'vrmRead',
  'owner.mhelpSync':'mhelpTicketImport',
  'owner.census':'fieldLocationVerification',
  'owner.identityReview':'ownerIdentityReview',
};

export function can(session:unknown,capability:Capability):boolean{
  if(!signedIn(session))return false;
  const owner=String(session.role)==='Owner'&&session.legacyOwner!==false;
  // Management stays with the owner. Equipment does not.
  if(OWNER_CAPABILITIES.includes(capability as never)&&!owner)return false;
  // Where the server issues the grant, the app follows it rather than guessing.
  const granted=SERVER_GRANTED[capability];
  if(granted&&!feature(session,granted))return false;
  return true;
}

/**
 * Which capability a workspace needs before it is offered. One app, one nav:
 * a workspace is absent because the person cannot use it, never because they
 * signed in as the wrong kind of person. Anything not named here is
 * management and belongs to the owner.
 */
const WORKSPACE_CAPABILITY:Record<string,Capability>={
  'Fleet Dashboard':'equipment.see',
  'Camera Health':'equipment.see',
  'Units On Hand':'equipment.see',
  'Equipment':'equipment.see',
  'InHand Routers':'equipment.routers',
  'Victron VRM':'equipment.power',
  'Unit Tracker':'equipment.tracker',
  'Tech Check':'equipment.techCheck',
  'Handoffs':'equipment.techCheck',
  // The More drawer itself stays for everyone; it lists only what the person
  // can open, so a tech still reaches the routers, the power and the tracker.
  'Operations':'equipment.see',
  'MHelp':'owner.mhelpSync',
  'Daily Board':'owner.boards',
  'Today':'owner.boards',
  'Team':'owner.team',
  'Owner Tasks':'owner.team',
};

/** May this person open this workspace at all? */
export function canOpenWorkspace(session:unknown,workspace:string):boolean{
  return can(session,WORKSPACE_CAPABILITY[workspace]??'owner.boards');
}

/** Every capability at once, for a shell that has to lay out a whole screen. */
export function capabilities(session:unknown):Record<Capability,boolean>{
  const all=[...EQUIPMENT_CAPABILITIES,...OWNER_CAPABILITIES];
  return Object.fromEntries(all.map(name=>[name,can(session,name)])) as Record<Capability,boolean>;
}

/**
 * Why a capability is not available, in words a person can act on. A control
 * that is simply missing teaches nobody anything; one that says who to ask
 * does.
 */
export function unavailableBecause(session:unknown,capability:Capability):string|null{
  if(can(session,capability))return null;
  if(!signedIn(session))return 'Sign in to COS Operations to use this.';
  const owner=String(session.role)==='Owner'&&session.legacyOwner!==false;
  if(OWNER_CAPABILITIES.includes(capability as never)&&!owner)return 'The owner handles this one.';
  if(SERVER_GRANTED[capability])return 'This account has not been granted this yet. The owner can turn it on.';
  return 'Not available on this account.';
}
