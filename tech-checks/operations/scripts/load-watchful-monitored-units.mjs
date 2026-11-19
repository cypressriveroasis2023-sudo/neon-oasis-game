/**
 * Review a sanitized Watchful export and write a snapshot file.
 * This script does not connect to a database. Applying the snapshot is a
 * separate owner-approved step. Do not pass a live export on the command line
 * in a place that gets logged; the script prints counts, not cell values.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {loadWatchfulExport} from '../src/watchfulMonitoredLoad.ts';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};

if (args.includes('--apply') || args.includes('--database')) {
  console.error('This loader does not write to the database. Data loads are a separate owner-approved step.');
  process.exit(2);
}

const input = value('--in');
const suppliedRead = args.includes('--at') ? value('--at') : undefined;
if (!input || (args.includes('--at') && !suppliedRead)) {
  console.error('Usage: node --import tsx scripts/load-watchful-monitored-units.mjs --in export.csv [--at <our-read-time>] [--out snapshot.json]');
  console.error('Our read time is --at or a read_at column. With neither, the export is Unknown and this command stops.');
  process.exit(2);
}

const csv = readFileSync(input, 'utf8');
const snapshot = loadWatchfulExport(csv, suppliedRead);
if (!snapshot.fetchedAt) {
  console.error('No read time was supplied. The export is Unknown, not fresh.');
  process.exit(2);
}
const out = value('--out');
const body = JSON.stringify(snapshot, null, 2);
if (out) writeFileSync(out, body);
else process.stdout.write(body + '\n');
console.error(`Reviewed snapshot: ${snapshot.units.length} units. Speakers dropped: ${snapshot.droppedSpeakers}. Camera rows collapsed: ${snapshot.collapsedCameraRows}.`);
