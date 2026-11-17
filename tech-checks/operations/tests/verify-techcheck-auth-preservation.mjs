import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const original = "    const { data: currentProfile } = await db.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();\n    if (!currentProfile || !currentProfile.active || currentProfile.archived_at || currentProfile.role === 'pending') {";
export const replacement = "    const { data: currentProfile, error: profileError, status: profileStatus } = await db.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();\n    // A failed read does not establish that the account was removed or disabled.\n    // Keep the existing session; refreshData reports the failure without signing out.\n    if (profileError && (profileStatus === 0 || profileStatus === 408 || profileStatus === 429 || profileStatus >= 500)) {\n      throw new Error('Account connection interrupted. Your session remains open; try refreshing data when the connection returns.');\n    }\n    if (!currentProfile || !currentProfile.active || currentProfile.archived_at || currentProfile.role === 'pending') {";
const globalSignOut = 'db.auth.signOut()';
const localSignOut = "db.auth.signOut({ scope: 'local' })";
export function applyReviewedTechCheck(baseline) {
  if (baseline.split(original).length !== 2) {
    throw new Error('Protected Tech Check app no longer contains the reviewed profile-read site.');
  }
  const withProfile = baseline.replace(original, replacement);
  if (withProfile.split(globalSignOut).length < 2) {
    throw new Error('Protected Tech Check app no longer contains the reviewed sign-out calls.');
  }
  return withProfile.replaceAll(globalSignOut, localSignOut);
}
export function verifyAuthOnlyChange(baseline, current) {
  if (current !== applyReviewedTechCheck(baseline)) {
    throw new Error('Protected Tech Check app differs beyond the reviewed profile-read recovery and local sign-out scope.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = execFileSync('git',['show','f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3:tech-checks/app.js'],{encoding:'utf8'});
  verifyAuthOnlyChange(baseline,readFileSync(new URL('../../app.js',import.meta.url),'utf8'));
  console.log('Protected Tech Check app: only the reviewed temporary-profile-read fix and local sign-out scope differ.');
}
