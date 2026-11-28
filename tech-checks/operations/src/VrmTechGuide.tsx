/** "How to read this page" for techs: every color, symbol and alert on Victron Power, in plain words. */
const ALERTS: [string, string, string][] = [
  ['Victron alarm / warning', 'Victron itself flagged low battery, low voltage or high voltage.', 'Check this unit today. Alarm (red) first, warning (amber) next.'],
  ['Low battery', 'Under 20% right now.', 'Check its cameras on the COS Board and plan a visit or swap.'],
  ['Will run low tonight', 'At the rate it is draining, it reaches 20% before 7 AM.', 'Open the unit and follow "What to do" under Tonight.'],
  ['Getting low', 'Between 20% and 34%.', 'Keep an eye on it. Look again later in the day.'],
  ['Just set up · …', 'A Field Helios that came on in the last two days (moved from the Shop to a site, or back on after being off) gets a checklist: reporting to Victron, battery reading, solar charger, panels producing in daylight, charged to full after a day of sun, and its first night above 30%. This line means one of those failed.', 'Fix it while the crew is still near the site: check the panel cables and the charger, and that the battery switch is on. A unit that is set up wrong usually goes dark on its first or second night.'],
  ['Second battery monitor reads low', 'Each Helios has a second battery monitor next to the system reading. On these units it reads more than 10 points below the system. Saved readings show the system number is the right one (it matches the energy the battery takes and gives), so the second monitor has drifted.', 'Not urgent. Next time a tech is at the unit, re-sync the second battery monitor (let the battery reach full in the sun so it resets to 100%, or set it to 100% by hand). The page and alerts already go by the system number.'],
  ['Dropped to N% overnight', 'Last night it went under 30% before sunrise.', 'The battery is not lasting the night. Check panels, the load and battery age.'],
  ["Didn't fill up today · best was N%", 'The sun is done and the battery never got to 95% today.', 'It will start the night short. Check for dirty or shaded panels, a loose solar cable, or a cloudy day. Two days in a row = tell the manager.'],
  ['Using more power than usual', 'At night it is pulling much more than its normal (1.5x and 10 W or more).', 'Something new is drawing power: a camera rebooting over and over, a heater, or extra gear plugged in. Check its cameras on the COS Board.'],
  ['Solar charger error', 'The Victron solar charger (MPPT) is reporting a fault, named in the alert.', 'Tell the manager. The unit may not be charging at all, so watch its battery and plan a visit.'],
  ['Panels not producing', 'It is daytime and the charger sees almost no voltage from the panels.', 'A panel cable is unplugged or broken, a breaker is off, or the panels are covered. This needs a site visit: tell the manager.'],
  ['Panels made N kWh yesterday · the others made about M', 'Its battery had room to charge that day, but its panels made less than half of what the other Field units made.', 'Look for dirt, shade, a panel facing the wrong way or a loose solar cable. One bad day can be shade; two in a row, tell the manager.'],
  ['Cloudy days ahead', 'The weather for this unit\'s job site shows gray days coming, and the battery is already down (under 80% with two gray days, or under 60% with one). The forecast is for the unit\'s map point, or the area of its mHelp ZIP code.', 'The sun will not refill it. Watch it each evening, and if it also says Tight or Will run low, plan a battery swap or visit before the gray days.'],
  ['Solar N% of yesterday', 'Today it is making much less solar than yesterday by this time.', 'If it was cloudy, ignore it. If it was sunny, check for dirty or shaded panels or a charger problem.'],
  ['Tight tonight', 'Should make it, but only about 20–29% at 7 AM.', 'Check again before end of shift.'],
  ['Power unknown / Not in the latest sync', 'No reading from Victron in the last 45 minutes.', 'If the unit should be running, check its internet connection or router. If it was unplugged on purpose, ignore it.'],
];

export default function VrmTechGuide() {
  return <details className='vrm-guide'>
    <summary>How to read this page</summary>
    <div className='vrm-guide-body'>
      <h5>1. Unit tiles</h5>
      <ul className='vrm-guide-keys'>
        <li><i className='g-good'/>The ring is the battery; the number inside is the percent. Green — 50% or more.</li>
        <li><i className='g-fair'/>Amber — battery 20–49%, or a Victron warning.</li>
        <li><i className='g-low'/>Red — battery under 20%, or a Victron alarm.</li>
        <li><i className='g-stale'/>Grey — no reading in the last 45 minutes. "Last reading" shows when it last reported.</li>
        <li><i className='g-off'/>Faded, dashed — not in the latest Victron sync.</li>
        <li><i className='g-shop'/>A dotted ring marked OFF, under "In the shop" — mHelp says the unit is in the shop and it is switched off. That is normal. "Not powered since" shows its last reading. It is not counted as down and never raises an alert. When it goes to a site and mHelp says Field, it joins the alerts by itself.</li>
        <li><i className='g-shop'/>"Powered up" on a Shop tile — the unit is running but mHelp still says Shop. If it is at a site, move it to Field in mHelp so its alerts switch on.</li>
      </ul>
      <ul className='vrm-guide-symbols'>
        <li><b>Sun · 380 W</b> — solar coming in right now.</li>
        <li><b className='g-in'>↑ 203 W in</b> — battery charging.</li>
        <li><b className='g-out'>↓ 37 W out</b> — battery draining.</li>
        <li><b>Moon · 20% by 3:40 AM</b> — will run low tonight (shown from 5 PM to 7 AM).</li>
        <li><b>about 87% · filling</b> (amber, under the ring) — on a few units the system number jumps to 100% early in the morning, before the battery is really full. This line shows where the battery actually is by the energy that has gone in. It goes away once the battery stops taking charge (usually by late morning).</li>
        <li><b>Moon · Low 72%</b> — lowest battery last night (5 PM–7 AM). Green 50%+, yellow 20–49%, red under 20%.</li>
        <li><b>Plug · Plugged in</b> — stayed full all night on outside power. Nothing to do.</li>
        <li><b>Panels line</b> (on a unit's chart) — what the panels made today and yesterday in kWh, today's peak watts, and panel voltage. A healthy sunny day is about 0.8–1.1 kWh. The charger starts counting its next day a few hours after dark; the page still shows the day that just ended as today until midnight.</li>
        <li><b>In the field / In the shop</b> — where the unit is. The saved equipment list decides; for a Helios it does not have, mHelp's own list answers.</li>
        <li><b>Champagne outline</b> — the unit you have selected. It is not a warning.</li>
      </ul>
      <h5>2. Needs attention</h5>
      <p>Field units only, most urgent at the top. Tap a name to open that unit.</p>
      <ul className='vrm-guide-alerts'>
        {ALERTS.map(([name, means, todo]) => <li key={name}><b>{name}</b><span>{means}</span><em>{todo}</em></li>)}
      </ul>
      <h5>3. Tonight (on each unit)</h5>
      <p>From 5 PM to 7 AM, COS uses the last 2 hours of battery readings to guess where the battery will be at 7 AM. It updates every 15 minutes. It is an estimate: a heater kicking on or a cloudy morning can change it.</p>
      <h5>4. Not a problem</h5>
      <ul className='vrm-guide-ok'>
        <li>Shop units are never listed in Needs attention.</li>
        <li>Grey units that were tested and unplugged on purpose.</li>
        <li>"Idle" at night with a full battery.</li>
      </ul>
      <h5>5. Tell the manager right away if</h5>
      <ul className='vrm-guide-escalate'>
        <li>A Field unit shows a Victron alarm.</li>
        <li>A Field unit is red and its cameras are down.</li>
        <li>A unit "Will run low tonight" and there is no plan to reach it.</li>
      </ul>
    </div>
  </details>;
}
