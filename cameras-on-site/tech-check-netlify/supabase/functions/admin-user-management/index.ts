import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: cors })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: cors })

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('user_id,full_name,username,role,active')
      .eq('user_id', userData.user.id)
      .single()

    if (callerError || !caller || caller.role !== 'owner' || caller.active !== true) {
      return new Response(JSON.stringify({ error: 'Owner access required' }), { status: 403, headers: cors })
    }

    const actorName = caller.full_name || caller.username || 'Owner'
    const body = await req.json()
    const action = String(body.action || '')

    const writeHistory = async (row: Record<string, unknown>) => {
      const { error } = await admin.from('team_access_history').insert({
        actor_id: userData.user.id,
        actor_name: actorName,
        ...row,
      })
      if (error) console.warn('team_access_history insert failed', error)
    }

    const activeOwnerCount = async () => {
      const { count } = await admin
        .from('profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('role', 'owner')
        .eq('active', true)
        .is('archived_at', null)
      return Number(count || 0)
    }

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const fullName = String(body.full_name || '').trim()
      const role = String(body.role || '')
      if (!['it','service','owner'].includes(role)) {
        return new Response(JSON.stringify({ error: 'Role must be IT Tech, Service Tech, or Owner/Admin' }), { status: 400, headers: cors })
      }
      if (!email || password.length < 8 || !fullName) {
        return new Response(JSON.stringify({ error: 'Username, full name, role, and temporary password of at least 8 characters are required.' }), { status: 400, headers: cors })
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { role },
      })
      if (error) throw error

      const { error: profileError } = await admin.from('profiles').update({
        full_name: fullName,
        email,
        role,
        active: true,
        archived_at: null,
        archived_by: null,
        archived_reason: null,
        must_change_password: true,
        password_changed_at: null,
        updated_at: new Date().toISOString()
      }).eq('user_id', data.user.id)
      if (profileError) throw profileError

      await writeHistory({
        user_id: data.user.id,
        user_name: fullName,
        action: 'created',
        new_role: role,
        new_active: true,
        detail: role === 'owner' ? 'Owner/Admin login created.' : 'Team member login created.',
      })

      return new Response(JSON.stringify({ ok: true, user_id: data.user.id }), { status: 200, headers: cors })
    }

    if (action === 'set_access') {
      const userId = String(body.user_id || '')
      const role = String(body.role || '')
      const active = Boolean(body.active)
      const fullName = body.full_name == null ? null : String(body.full_name).trim()
      if (!userId || !['it','service','owner','pending'].includes(role)) {
        return new Response(JSON.stringify({ error: 'Invalid user or role' }), { status: 400, headers: cors })
      }

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('user_id,full_name,username,role,active,archived_at')
        .eq('user_id', userId)
        .single()
      if (targetError || !target) return new Response(JSON.stringify({ error: 'Team member not found' }), { status: 404, headers: cors })
      if (target.archived_at) return new Response(JSON.stringify({ error: 'Restore this archived team member before changing access.' }), { status: 400, headers: cors })

      if (userId === userData.user.id && (role !== 'owner' || !active)) {
        return new Response(JSON.stringify({ error: 'You cannot remove or disable your own Owner/Admin access.' }), { status: 400, headers: cors })
      }
      if (target.role === 'owner' && (role !== 'owner' || !active) && await activeOwnerCount() <= 1) {
        return new Response(JSON.stringify({ error: 'At least one active Owner/Admin must remain.' }), { status: 400, headers: cors })
      }

      const patch: Record<string, unknown> = { role, active, updated_at: new Date().toISOString() }
      if (fullName !== null) patch.full_name = fullName
      const { error: profileError } = await admin.from('profiles').update(patch).eq('user_id', userId)
      if (profileError) throw profileError

      const { error: authError } = await admin.auth.admin.updateUserById(userId, { app_metadata: { role } })
      if (authError) throw authError

      await writeHistory({
        user_id: userId,
        user_name: fullName || target.full_name || target.username || 'Team Member',
        action: 'access_changed',
        old_role: target.role,
        new_role: role,
        old_active: target.active,
        new_active: active,
        detail: 'Role or active access changed.',
      })

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors })
    }

    if (action === 'archive') {
      const userId = String(body.user_id || '')
      const reason = String(body.reason || '').trim()
      if (!userId) return new Response(JSON.stringify({ error: 'Team member is required.' }), { status: 400, headers: cors })

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('user_id,full_name,username,role,active,archived_at')
        .eq('user_id', userId)
        .single()
      if (targetError || !target) return new Response(JSON.stringify({ error: 'Team member not found.' }), { status: 404, headers: cors })
      if (userId === userData.user.id) return new Response(JSON.stringify({ error: 'You cannot archive your own Owner/Admin account.' }), { status: 400, headers: cors })
      if (target.role === 'owner' && target.active && await activeOwnerCount() <= 1) {
        return new Response(JSON.stringify({ error: 'At least one active Owner/Admin must remain.' }), { status: 400, headers: cors })
      }

      const now = new Date().toISOString()
      const { error: profileError } = await admin.from('profiles').update({
        active: false,
        archived_at: now,
        archived_by: userData.user.id,
        archived_reason: reason || null,
        updated_at: now,
      }).eq('user_id', userId)
      if (profileError) throw profileError

      let returnedAssignments = 0
      if (target.role === 'it' || target.role === 'service') {
        const departmentName = target.role === 'it' ? 'IT Department' : 'Service Department'
        const { data: moved, error: moveError } = await admin
          .from('job_assignments')
          .update({
            assignee_user_id: null,
            assignee_name: departmentName,
            assignment_scope: 'department',
            status: 'assigned',
            started_at: null,
            claimed_at: null,
            updated_at: now,
          })
          .eq('assignee_user_id', userId)
          .in('status', ['assigned','started'])
          .select('id')
        if (moveError) throw moveError
        returnedAssignments = moved?.length || 0
      }

      await admin.from('push_subscriptions').update({
        enabled: false,
        updated_at: now,
      }).eq('user_id', userId)

      const historyDetail = [
        reason || 'Removed from Active Team. Historical work retained.',
        returnedAssignments ? returnedAssignments + ' active assignment' + (returnedAssignments === 1 ? '' : 's') + ' returned to the department queue.' : ''
      ].filter(Boolean).join(' ')

      await writeHistory({
        user_id: userId,
        user_name: target.full_name || target.username || 'Team Member',
        action: 'archived',
        old_role: target.role,
        new_role: target.role,
        old_active: target.active,
        new_active: false,
        detail: historyDetail,
      })

      return new Response(JSON.stringify({ ok: true, returned_assignments: returnedAssignments }), { status: 200, headers: cors })
    }

    if (action === 'restore') {
      const userId = String(body.user_id || '')
      if (!userId) return new Response(JSON.stringify({ error: 'Team member is required.' }), { status: 400, headers: cors })

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('user_id,full_name,username,role,active,archived_at')
        .eq('user_id', userId)
        .single()
      if (targetError || !target) return new Response(JSON.stringify({ error: 'Team member not found.' }), { status: 404, headers: cors })

      const now = new Date().toISOString()
      const { error: profileError } = await admin.from('profiles').update({
        active: true,
        archived_at: null,
        archived_by: null,
        archived_reason: null,
        updated_at: now,
      }).eq('user_id', userId)
      if (profileError) throw profileError

      await writeHistory({
        user_id: userId,
        user_name: target.full_name || target.username || 'Team Member',
        action: 'restored',
        old_role: target.role,
        new_role: target.role,
        old_active: target.active,
        new_active: true,
        detail: 'Restored to Active Team.',
      })

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors })
    }

    if (action === 'reset_password') {
      const userId = String(body.user_id || '')
      const password = String(body.password || '')
      if (!userId || password.length < 8) {
        return new Response(JSON.stringify({ error: 'User and temporary password of at least 8 characters are required.' }), { status: 400, headers: cors })
      }

      const { data: target } = await admin.from('profiles').select('full_name,username,role,active,archived_at').eq('user_id', userId).maybeSingle()
      if (!target || target.archived_at || !target.active) {
        return new Response(JSON.stringify({ error: 'Restore and activate this team member before resetting the password.' }), { status: 400, headers: cors })
      }

      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) throw error
      const { error: profileError } = await admin.from('profiles').update({
        must_change_password: true,
        password_changed_at: null,
        updated_at: new Date().toISOString()
      }).eq('user_id', userId)
      if (profileError) throw profileError
      await admin.from('password_reset_requests').update({ status: 'expired' }).eq('user_id', userId).in('status', ['pending','approved'])

      await writeHistory({
        user_id: userId,
        user_name: target.full_name || target.username || 'Team Member',
        action: 'password_reset',
        old_role: target.role,
        new_role: target.role,
        old_active: target.active,
        new_active: target.active,
        detail: 'Owner/Admin issued a temporary password.',
      })

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: cors })
  }
})
