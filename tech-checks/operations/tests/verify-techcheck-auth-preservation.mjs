import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const original = "    const { data: currentProfile } = await db.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();\n    if (!currentProfile || !currentProfile.active || currentProfile.archived_at || currentProfile.role === 'pending') {";
export const replacement = "    const { data: currentProfile, error: profileError, status: profileStatus } = await db.from('profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();\n    // A failed read does not establish that the account was removed or disabled.\n    // Keep the existing session; refreshData reports the failure without signing out.\n    if (profileError && (profileStatus === 0 || profileStatus === 408 || profileStatus === 429 || profileStatus >= 500)) {\n      throw new Error('Account connection interrupted. Your session remains open; try refreshing data when the connection returns.');\n    }\n    if (!currentProfile || !currentProfile.active || currentProfile.archived_at || currentProfile.role === 'pending') {";
// Sign out ends this screen's sign-in only, so a board left up on another screen stays signed in.
// The account-removed, inactive, archived and pending sign-outs are unchanged and still end every session.
export const logoutOriginal = "async function logout() {\n  await db.auth.signOut();\n  showAuth();\n}";
export const logoutReplacement = "async function logout() {\n  // Sign out this screen only. A board left up on another screen keeps its own sign-in.\n  await db.auth.signOut({ scope: 'local' });\n  showAuth();\n}";
export function verifyAuthOnlyChange(baseline, current) {
  if (baseline.split(original).length !== 2 || baseline.split(logoutOriginal).length !== 2
    || current !== baseline.replace(original, replacement).replace(logoutOriginal, logoutReplacement)) {
    throw new Error('Protected Tech Check app differs beyond the profile-read recovery change and the this-screen-only sign-out.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = execFileSync('git',['show','f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3:tech-checks/app.js'],{encoding:'utf8'});
  verifyAuthOnlyChange(baseline,readFileSync(new URL('../../app.js',import.meta.url),'utf8'));
  console.log('Protected Tech Check app: only the temporary-profile-read fix and the this-screen-only sign-out differ.');
}
