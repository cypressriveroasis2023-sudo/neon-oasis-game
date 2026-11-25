/** "How to read this page" for techs: every color, symbol and alert on Victron Power, in plain words. */
const ALERTS: [string, string, string][] = [
  ['Victron alarm / warning', 'Victron itself flagged low battery, low voltage or high voltage.', 'Check this unit today. Alarm (red) first, warning (amber) next.'],
  ['Low battery', 'Under 20% right now.', 'Check its cameras on the COS Board and plan a visit or swap.'],
  ['Will run low tonight', 'At the rate it is draining, it reaches 20% before 7 AM.', 'Open the unit and follow "What to do" under Tonight.'],
  ['Getting low', 'Between 20% and 34%.', 'Keep an eye on it. Look again later in the day.'],
  ['Dropped to N% overnight', 'Last night it went under 30% before sunrise.', 'The battery is not lasting the night. Check panels, the load and battery age.'],
  ["Didn't fill up today · best was N%", 'The sun is done and the battery never got to 95% today.', 'It will start the night short. Check for dirty or shaded panels, a loose solar cable, or a cloudy day. Two days in a row = tell the manager.'],
  ['Using more power than usual', 'At night it is pulling much more than its normal (1.5x and 10 W or more).', 'Something new is drawing power: a camera rebooting over and over, a heater, or extra gear plugged in. Check its cameras on the COS Board.'],
  ['Cloudy days ahead', 'The weather for this unit\'s job site shows gray days coming, and the battery is already down (under 80% with two gray days, or under 60% with one).', 'The sun will not refill it. Watch it each evening, and if it also says Tight or Will run low, plan a battery swap or visit before the gray days.'],
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
        <li><i className='g-good'/>Green — battery 50% or more.</li>
        <li><i className='g-fair'/>Amber — battery 20–49%, or a Victron warning.</li>
        <li><i className='g-low'/>Red — battery under 20%, or a Victron alarm.</li>
        <li><i className='g-stale'/>Grey — no reading in the last 45 minutes. "Last seen" shows when it last reported.</li>
        <li><i className='g-off'/>Faded, dashed — not in the latest Victron sync.</li>
      </ul>
      <ul className='vrm-guide-symbols'>
        <li><b>☀ 380 W</b> — solar coming in right now.</li>
        <li><b className='g-in'>↑ 203 W in</b> — battery charging.</li>
        <li><b className='g-out'>↓ 37 W out</b> — battery draining.</li>
        <li><b>🌙 20% by 3:40 AM</b> — will run low tonight (shown from 5 PM to 7 AM).</li>
        <li><b>🌙 Low 72%</b> — lowest battery last night (5 PM–7 AM). Green 50%+, yellow 20–49%, red under 20%.</li>
        <li><b>🔌 Plugged in</b> — stayed full all night on outside power. Nothing to do.</li>
        <li><b>FIELD / SHOP</b> — where mHelp says the unit is.</li>
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
