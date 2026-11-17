import {useState} from 'react';
import {denyStaffRoute, staffRole as roleOf, type StaffRole} from '../../supabase/functions/cos-operations-pages/staffAccess';

/** Account and password settings. The owner can open them. IT and service are refused. */
export default function AccountGate({role}:{role: StaffRole | null}) {
  const [opened, setOpened] = useState(false);
  const blocked = denyStaffRoute(role, 'POST', '/api/account/password');
  if (role === 'service') return null;
  return <section className='cos-account-gate' aria-label='Account and password'>
    <button type='button' onClick={() => setOpened(true)}>Account and password</button>
    {opened && (blocked
      ? <p role='alert'>{blocked}</p>
      : <form onSubmit={event => event.preventDefault()}>
          <p>Owner account settings. Password changes are not sent from this preview.</p>
          <label>New password<input type='password' autoComplete='new-password' disabled/></label>
          <button type='submit' disabled>Save password</button>
        </form>)}
  </section>;
}

export function accountRole(session: {role?: unknown; legacyOwner?: unknown}): StaffRole | null {
  return roleOf(session);
}
