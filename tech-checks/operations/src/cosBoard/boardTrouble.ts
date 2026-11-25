/* Troubleshoot, on the unit card: one question at a time, starting from what COS already knows.
 *
 * COS answers what it can by itself (which cameras are off and since when, the router, Victron power),
 * so a tech is only asked what COS cannot see. Every step says where to look, and the places are in COS:
 * this card's Check it now, its Router page and its camera pages. Nothing here writes anywhere.
 * A router reading is a hint only, never proof the cameras work.
 */

export type TroubleFacts = {
  status: string;                       // board verdict: 'issues' | 'down' | 'unknown' | ...
  place: 'field' | 'shop';
  offCams: {name: string; since: number}[];   // cameras COS has as offline, with last online (unix seconds, 0 = unknown)
  routerOn: boolean;
  routerOff: boolean;
  power: {low: boolean; battery: number | null} | null;   // Victron, only when current
  canCheck: boolean;                    // the card has Check it now
  routerPage: boolean;                  // the card links the router's own page
  camPages: boolean;                    // the card links the unit's own camera pages
};

export type TroubleOption = {key: string; label: string};
export type TroubleStep = {kind: 'step'; id: string; question: string; how: string[]; who: string; options: TroubleOption[]};
export type TroubleResult = {kind: 'result'; title: string; tone: 'good' | 'info' | 'bad'; todo: string[]; next: string; managerHelp: boolean};
export type TroubleAnswers = Record<string, string>;

type Node = {question: string; how: string[]; who?: string; options: [string, string, string][]};   // [key, label, goes to]
type Result = Omit<TroubleResult, 'kind'>;

const REMOTE = 'You or IT · from here';
const camWord = (f: TroubleFacts) => f.offCams.length === 1 ? f.offCams[0].name : f.offCams.length ? 'the cameras listed above' : 'the camera';

function nodes(f: TroubleFacts): Record<string, Node> {
  const cam = camWord(f);
  const pingHow = f.routerPage
    ? ['Tap Router page under Open on this card.', 'Go to Tools → Ping and ping ' + cam + '’s local address.', 'Replies mean it has power and a cable link.']
    : ['Open the unit’s router in InHand (iot.inhandnetworks.com).', 'Open its page, then Tools → Ping, and ping ' + cam + '’s local address.', 'Replies mean it has power and a cable link.'];
  return {
    night: {
      question: 'Does it go off at night and come back in the daytime?',
      how: f.power
        ? ['Look at Power on this card: last night’s low and whether it is charging now.', 'A battery that runs down overnight shuts cameras off first.']
        : ['Look at when it went off, above. Off since the evening and back by morning points to power.', 'Several cloudy days in a row also point to power, not the camera.'],
      options: [['yes', 'Yes, or the battery is low', 'r:power'], ['no', 'No, or not sure', f.status === 'down' && f.routerOff ? 'sim' : f.status === 'down' ? 'pingAll' : f.canCheck ? 'check' : 'ping']],
    },
    check: {
      question: 'Tap Check this unit now. Is ' + cam + ' still off?',
      how: ['Check it now is on this card, above.', 'It asks the cameras right now instead of waiting for the next reading.'],
      options: [['back', 'It’s back online', 'r:fixed'], ['off', 'Still off', f.status === 'down' ? 'pingAll' : 'ping']],
    },
    ping: {
      question: 'Ping ' + cam + ' from inside the unit. Does it answer?',
      how: pingHow,
      options: [['yes', 'Yes, it answers', 'reboot'], ['no', 'No answer', 'port'], ['cant', 'Can’t get to the router', 'port']],
    },
    reboot: {
      question: 'Reboot ' + cam + ' from its own page. Is it back after 5 minutes?',
      how: [f.camPages ? 'Under Open on this card, tap the camera’s page and sign in.' : 'Open the camera’s own page through the router and sign in.', 'Reboot only this camera. Rebooting the router drops every camera.', 'Wait 5 minutes, then tap Check this unit now.'],
      options: [['back', 'It’s back', 'r:fixed'], ['off', 'Still off', 'r:camera']],
    },
    port: {
      question: 'Can you turn ' + cam + '’s power port off and on from here?',
      how: ['No ping reply means no power or a bad cable at that camera.', 'If the unit’s switch lets you turn one port off and on, do it for this camera only.'],
      options: [['back', 'Did it, it came back', 'r:fixed'], ['off', 'Did it, still off', 'r:cable'], ['cant', 'Can’t do it from here', 'r:cable']],
    },
    pingAll: {
      question: 'Ping the cameras from inside the unit. Do any answer?',
      how: pingHow.map(t => t.replace(cam + '’s local address', 'each camera’s local address')),
      options: [['none', 'None answer', 'r:switch'], ['some', 'Some or all answer', 'r:cloud'], ['cant', 'Can’t get to the router', 'r:switch']],
    },
    sim: {
      question: 'Is the router’s SIM active and under its data limit?',
      how: ['The router is not answering either, and power does not look like the cause.', 'Look the SIM up in the carrier portal: active, not suspended, not over data.'],
      options: [['bad', 'The SIM has a problem', 'r:sim'], ['ok', 'The SIM looks fine', 'r:dead']],
    },
  };
}

const RESULTS: Record<string, Result> = {
  fixed: {title: 'Fixed — back online', tone: 'good', todo: ['Tap Check this unit now once more to confirm.', 'Copy the note so the next person knows what worked.'], next: 'None — watch it tomorrow', managerHelp: false},
  power: {title: 'Power, not the camera', tone: 'bad', todo: ['A low battery shuts cameras off first.', 'On site: battery voltage, panels clean and aimed, charge controller charging, fuses.', 'If it keeps happening, the battery may need replacing.'], next: 'Site check of battery and solar', managerHelp: true},
  camera: {title: 'The camera itself is likely bad', tone: 'bad', todo: ['It has power and a link but will not come back after a reboot.', 'On site: factory-reset it, or swap in a known-good camera with the same label.'], next: 'Site visit: reset or swap the camera', managerHelp: true},
  cable: {title: 'Power or cable at the camera', tone: 'bad', todo: ['At the camera: cable fully seated, connector dry, no corrosion, no cut or chewed cable.', 'At the switch: link light on for that port. Move it to a known-good port.', 'Then try a known-good cable, then a known-good camera.'], next: 'Site visit: cable, port, camera', managerHelp: true},
  switch: {title: 'Switch or camera power is down', tone: 'bad', todo: ['The router is up, but nothing behind it answers.', 'On site: the PoE switch has power and lights, its fuse, and its cable to the router.'], next: 'Site visit: PoE switch and camera power', managerHelp: true},
  cloud: {title: 'Cameras are up but not reporting', tone: 'info', todo: ['They answer inside the unit, so power and cables are fine.', 'Reboot the recorder or the cameras from their own pages, then tap Check this unit now.', 'Still nothing: check the router’s data use for a capped SIM, and tell IT.'], next: 'IT: recorder and data plan', managerHelp: false},
  sim: {title: 'SIM or carrier problem', tone: 'bad', todo: ['Note what the portal shows: suspended, deactivated or over data.', 'SIM changes go through the manager.'], next: 'Manager to sort the SIM', managerHelp: true},
  dead: {title: 'No power at the unit, or the router failed', tone: 'bad', todo: ['On site: power at the unit, breaker and fuses, router lights, antenna cables.'], next: 'Site visit: power and router', managerHelp: true},
};

/** Where a unit's troubleshooting starts, or null when there is nothing to troubleshoot. */
export function troubleStart(f: TroubleFacts): string | null {
  if (f.place !== 'field') return null;
  if (f.status !== 'issues' && f.status !== 'down') return null;
  if (f.power && f.power.low) return 'r:power';
  return 'night';
}

/** What COS already knows, as lines for the note and the card, so nobody has to look it up elsewhere. */
export function troubleKnown(f: TroubleFacts, when: (sec: number) => string, ago: (sec: number) => string): string[] {
  const out: string[] = [];
  for (const c of f.offCams) out.push(c.name + ' is off' + (c.since ? ' since ' + when(c.since) + ' (' + ago(c.since) + ')' : ''));
  if (f.routerOn) out.push('Router answers');
  else if (f.routerOff) out.push('Router does not answer');
  if (f.power) out.push('Victron battery ' + (f.power.battery === null ? 'no reading' : f.power.battery + '%') + (f.power.low ? ' (low)' : ''));
  return out;
}

export type TroubleWalk = {trail: {id: string; question: string; answer: string}[]; at: TroubleStep | TroubleResult | null};

/** Walk the answers given so far and return the trail plus the next step or the result. Unknown answers stop the walk there. */
export function troubleWalk(f: TroubleFacts, answers: TroubleAnswers): TroubleWalk {
  const start = troubleStart(f);
  if (!start) return {trail: [], at: null};
  const N = nodes(f), trail: TroubleWalk['trail'] = [];
  let at = start, guard = 0;
  while (guard++ < 20) {
    if (at.startsWith('r:')) return {trail, at: {kind: 'result', ...RESULTS[at.slice(2)]}};
    const node = N[at];
    const picked = node.options.find(o => o[0] === answers[at]);
    if (!picked) return {trail, at: {kind: 'step', id: at, question: node.question, how: node.how, who: node.who || REMOTE, options: node.options.map(([key, label]) => ({key, label}))}};
    trail.push({id: at, question: node.question, answer: picked[1]});
    at = picked[2];
  }
  return {trail, at: null};
}

/** The note a tech copies onto the IT sheet or the COS log. Addresses never appear in it. */
export function troubleNote(unit: string, known: string[], walk: TroubleWalk, stamp: string): string {
  const r = walk.at && walk.at.kind === 'result' ? walk.at : null;
  return [unit + ' — troubleshoot',
    ...known.map(k => 'COS: ' + k),
    ...walk.trail.map(t => ' - ' + t.question + ' → ' + t.answer),
    r ? 'Result: ' + r.title : 'Not finished',
    r ? 'Next: ' + r.next : '',
    r ? 'Manager help: ' + (r.managerHelp ? 'YES' : 'NO') : '',
    'Checked ' + stamp].filter(Boolean).join('\n');
}

/* Troubleshoot's own look, in the board's colors. Answers are big enough to hit with a thumb. */
export const TROUBLE_CSS = `
.box.trb{border:2px solid var(--warn);background:linear-gradient(180deg,rgba(251,191,36,.10),rgba(251,191,36,0) 120px),var(--s1)}
.box.trb>h3,.box.chkb>h3{font-size:15px;letter-spacing:.02em;color:var(--warn)}
.box.chkb{border:2px solid var(--shop);background:linear-gradient(180deg,rgba(96,165,250,.10),rgba(96,165,250,0) 120px),var(--s1)}
.box.chkb>h3{color:var(--shop)}
.tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px}
.tool{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;border:0;border-radius:14px;padding:14px 16px;min-height:64px;cursor:pointer;font-family:var(--body)}
.tool b{font-family:var(--display);font-weight:800;font-size:18px;line-height:1.15}
.tool span{font-size:13px;font-weight:600;opacity:.85}
.tool.t-tr{background:var(--warn);color:#1a1300}
.tool.t-ck{background:var(--shop);color:#04111f}
.tool:disabled{opacity:.6;cursor:default}
.tool:focus-visible{outline:3px solid var(--tx);outline-offset:2px}
.trknown{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:4px}
.trknown li{background:var(--s2);border:1px solid var(--line2);border-radius:10px;padding:7px 11px;font-size:15px;font-weight:600}
.trtrail{list-style:none;margin:8px 0 10px;padding:0;display:flex;flex-direction:column;gap:6px}
.trback{display:block;width:100%;text-align:left;background:transparent;border:0;border-left:3px solid var(--line2);padding:3px 0 3px 10px;font-size:14px;color:var(--tx2)}
.trback b{display:block;color:var(--tx);font-weight:650}
.trwho{display:inline-block;background:var(--s2);border:1px solid var(--line2);border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:650;color:var(--tx2);margin:6px 0 6px}
.trq{font-family:var(--display);font-weight:800;font-size:20px;line-height:1.25;margin:0 0 8px!important;color:var(--tx)}
.trhow{background:var(--s2);border-radius:12px;padding:10px 12px 10px 32px!important;margin:0 0 10px!important;font-size:15px}
.tropts{display:grid;gap:9px}
.trbtn{background:var(--s2);color:var(--tx);border:0;box-shadow:inset 0 0 0 1px var(--line2);border-radius:12px;padding:14px;min-height:50px;font-weight:700;font-size:15.5px;text-align:left}
.trbtn.go{background:var(--brand);color:#fff;box-shadow:none}
.tropts.two{grid-template-columns:repeat(2,1fr);margin-top:10px}.tropts.two .trbtn{text-align:center}
.trres{border-left:5px solid var(--warn);padding:2px 0 2px 12px;margin:6px 0 10px}
.trres.t-good{border-left-color:var(--up)}.trres.t-bad{border-left-color:var(--down)}.trres.t-info{border-left-color:var(--shop)}
.trres ul{margin:0 0 8px;padding-left:20px}.trres li{margin:3px 0}
.trhelp{font-weight:700;background:var(--s2);border-radius:10px;padding:8px 11px}
.trnote{white-space:pre-wrap;font-size:13px;line-height:1.45;background:var(--bg2);border:1px solid var(--line2);border-radius:10px;padding:10px 12px;margin:0;color:var(--tx2);overflow-wrap:anywhere}
`;
