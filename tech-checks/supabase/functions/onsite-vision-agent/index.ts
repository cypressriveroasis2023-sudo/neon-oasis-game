import { createClient } from 'npm:@supabase/supabase-js@2'
import './tech-check-rules.js'
import './company-knowledge.js'
import './workflow-engine.js'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const KNOWLEDGE = (globalThis as any).OnSiteVisionKnowledge
const ENGINE = (globalThis as any).OnSiteVisionWorkflowEngine

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors })

const clean = (value: unknown) => String(value ?? '').trim()
const lower = (value: unknown) => clean(value).toLowerCase()
const todayCentral = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

function stripNulls(value: any): any {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined || item === '') continue
    out[key] = stripNulls(item)
  }
  return out
}

function compactJobContext(context: any) {
  if (!context) return null
  return stripNulls({
    context_version: context.context_version,
    fetched_at: context.fetched_at,
    ticket_no: context.ticket_no,
    found: context.found,
    summary: context.summary,
    assignments: (context.assignments || []).map((a: any) => ({
      ticket_no: a.ticket_no,
      site: a.site,
      assigned_role: a.assigned_role,
      assignee_user_id: a.assignee_user_id,
      assignee_name: a.assignee_name,
      assignment_scope: a.assignment_scope,
      status: a.status,
      work_type: a.work_type,
      scheduled_for: a.scheduled_for,
      scheduled_time: a.scheduled_time,
      requested_unit_count: a.requested_unit_count,
      equipment_manifest: a.equipment_manifest,
      unit_summary: a.unit_summary,
      job_description: a.job_description,
      notes: a.notes,
      requires_it_handoff: a.requires_it_handoff,
      assigned_at: a.assigned_at,
      started_at: a.started_at,
      completed_at: a.completed_at,
      updated_at: a.updated_at,
    })),
    prep: context.prep,
    items: context.items,
    service_solar_check: context.service_solar_check,
    handoff_evidence: (context.handoff_evidence || []).map((e: any) => ({
      stage: e.stage,
      kind: e.kind,
      original_name: e.original_name,
      storage_path: e.storage_path,
      created_by_name: e.created_by_name,
      created_at: e.created_at,
      prep_item_id: e.prep_item_id,
    })),
    service_solar_evidence: (context.service_solar_evidence || []).map((e: any) => ({
      category: e.category,
      kind: e.kind,
      original_name: e.original_name,
      storage_path: e.storage_path,
      created_by_name: e.created_by_name,
      created_at: e.created_at,
    })),
    returns: context.returns,
    unit_registry: context.unit_registry,
    asset_inventory: context.asset_inventory,
    truck_spare_batteries: context.truck_spare_batteries,
    workflow_checkpoints: (context.workflow_checkpoints || []).slice(-12).map((w: any) => ({
      source_table: w.source_table,
      operation: w.operation,
      changed_by_name: w.changed_by_name,
      created_at: w.created_at,
      restored_at: w.restored_at,
      restored_by_name: w.restored_by_name,
    })),
  })
}

function engineContext(context: any) {
  return {
    ticket_no: context?.ticket_no || '',
    work_type: context?.summary?.effective_work_type || context?.prep?.work_type || context?.assignments?.[0]?.work_type || '',
    prep: context?.prep || null,
    assignments: Array.isArray(context?.assignments) ? context.assignments : [],
    items: Array.isArray(context?.items) ? context.items : [],
    service_solar_check: context?.service_solar_check || null,
    service_solar_checks: Array.isArray(context?.service_solar_checks) ? context.service_solar_checks : [],
    returns: Array.isArray(context?.returns) ? context.returns : [],
    unit_registry: Array.isArray(context?.unit_registry) ? context.unit_registry : [],
    handoff_evidence: Array.isArray(context?.handoff_evidence) ? context.handoff_evidence : [],
    service_solar_evidence: Array.isArray(context?.service_solar_evidence) ? context.service_solar_evidence : [],
    truck_spare_batteries: Array.isArray(context?.truck_spare_batteries) ? context.truck_spare_batteries : [],
    workflow_checkpoints: Array.isArray(context?.workflow_checkpoints) ? context.workflow_checkpoints : [],
  }
}

function knowledgeForTopic(topic: string) {
  const q = lower(topic)
  const aliases = KNOWLEDGE?.equipment_aliases || {}
  const equipment = KNOWLEDGE?.equipment || {}
  const workflows = KNOWLEDGE?.workflows || {}
  const truckSpares = KNOWLEDGE?.truck_spares || null
  const gapInventory = KNOWLEDGE?.phase_7_gap_inventory || null

  // Truck-spare questions must resolve against the server-enforced spare mappings
  // before a normal product battery label can be mistaken for an allowed spare batch.
  if (truckSpares && /(truck\s+spare|truck\s+backup|spare\s+batter|backup\s+unit)/.test(q)) {
    return {
      certainty: 'COMPANY RULE',
      topic: 'truck_spares',
      definition: truckSpares,
    }
  }

  let equipmentName = Object.keys(equipment).find((name) => lower(name) === q)
  if (!equipmentName && aliases[q]) equipmentName = aliases[q]
  if (!equipmentName) {
    equipmentName = Object.keys(equipment).find((name) => q.includes(lower(name)))
  }
  if (equipmentName && equipment[equipmentName]) {
    return {
      certainty: equipment[equipmentName].documented === true ? 'COMPANY RULE' : 'COMPANY RULE — PARTIAL',
      equipment: equipmentName,
      definition: equipment[equipmentName],
    }
  }

  const workflowName = Object.keys(workflows).find((name) =>
    q === name || q.includes(name) || q.includes(lower(workflows[name]?.label))
  )
  if (workflowName) {
    return {
      certainty: 'COMPANY RULE',
      workflow: workflowName,
      definition: workflows[workflowName],
    }
  }

  if (gapInventory && /(phase\s*7|knowledge\s+gap|missing\s+(?:company\s+)?knowledge|what.*(?:teach|learn)|teach.*vision|still\s+unknown)/.test(q)) {
    return {
      certainty: 'MISSING INFORMATION',
      topic: 'phase_7_gap_inventory',
      definition: gapInventory,
    }
  }

  const technicalHits = Object.entries(equipment)
    .filter(([name, def]: any) => {
      const hay = JSON.stringify({ name, def }).toLowerCase()
      return q.split(/\s+/).filter((x) => x.length > 2).some((word) => hay.includes(word))
    })
    .slice(0, 4)
    .map(([name, definition]) => ({ name, definition }))

  return {
    certainty: technicalHits.length ? 'COMPANY RULE' : 'MISSING INFORMATION',
    topic,
    matches: technicalHits,
    available_equipment: Object.keys(equipment),
    available_workflows: Object.keys(workflows),
  }
}

function responseText(response: any) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim()
  const parts: string[] = []
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

const tools = [
  {
    type: 'function',
    name: 'get_job_context',
    description: 'Get the current authoritative Tech Check context for one MHelpDesk ticket. Use this before answering current status, assignments, evidence, equipment, returns, or schedule questions about a ticket.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { ticket_no: { type: 'string', description: 'MHelpDesk ticket number.' } },
      required: ['ticket_no'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'analyze_job',
    description: 'Analyze one live Tech Check job using Cameras On Site workflow rules. Returns blockers, next step, product requirements, and the authoritative current context.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { ticket_no: { type: 'string', description: 'MHelpDesk ticket number.' } },
      required: ['ticket_no'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'find_job_by_unit',
    description: 'Resolve a natural unit reference such as Helios 7, Helio 007, or 007 to current Tech Check unit/ticket records.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { unit_reference: { type: 'string' } },
      required: ['unit_reference'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_active_jobs',
    description: 'List currently active assigned/started Tech Check jobs.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_jobs_for_date',
    description: 'List Tech Check assignments scheduled for an exact date.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Date in YYYY-MM-DD format.' } },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_technicians',
    description: 'List active Cameras On Site IT and/or Service technicians. Use when the owner asks who can be assigned.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['it', 'service', 'all'] },
      },
      required: ['role'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_company_knowledge',
    description: 'Read verified Cameras On Site product, workflow, configuration, checklist, battery, port, handoff, or troubleshooting knowledge. Never substitute generic internet knowledge for this tool.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string' } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
]

const outputSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    active_ticket: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          certainty: {
            type: 'string',
            enum: ['VERIFIED DATABASE FACT', 'COMPANY RULE', 'AI INFERENCE', 'MISSING INFORMATION'],
          },
          statement: { type: 'string' },
        },
        required: ['certainty', 'statement'],
        additionalProperties: false,
      },
    },
    proposed_action: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['none', 'create_job', 'assign', 'schedule', 'update', 'handoff', 'verify', 'complete', 'cancel', 'return', 'check_out', 'check_in', 'owner_approve'],
        },
        ticket_no: { type: 'string' },
        work_type: { type: 'string' },
        role: { type: 'string' },
        technician_name: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        summary: { type: 'string' },
        requires_confirmation: { type: 'boolean' },
      },
      required: ['type', 'ticket_no', 'work_type', 'role', 'technician_name', 'date', 'time', 'summary', 'requires_confirmation'],
      additionalProperties: false,
    },
  },
  required: ['answer', 'active_ticket', 'facts', 'proposed_action'],
  additionalProperties: false,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Authentication required' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (!supabaseUrl || !anonKey) return json({ error: 'Supabase function environment is incomplete.' }, 500)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401)

    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('user_id,full_name,username,role,active,archived_at')
      .eq('user_id', userData.user.id)
      .maybeSingle()

    if (profileError || !profile || profile.role !== 'owner' || profile.active !== true || profile.archived_at) {
      return json({ error: 'Owner/Admin access required' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const apiKey = Deno.env.get('OPENAI_API_KEY') || ''
    const model = Deno.env.get('ONSITE_VISION_MODEL') || 'gpt-5.6-sol'

    if (body.mode === 'status') {
      return json({
        ok: true,
        agent_version: 'onsite-vision-agent-v7',
        model,
        model_configured: Boolean(apiKey),
        knowledge_version: KNOWLEDGE?.version || 'unknown',
        workflow_engine_version: ENGINE?.version || 'unknown',
        shared_rules_version: (globalThis as any).TechCheckRules?.version || 'unknown',
        write_tools_enabled: false,
        managed_knowledge_enabled: true,
      })
    }

    const message = clean(body.message)
    if (!message) return json({ error: 'Message is required.' }, 400)
    if (message.length > 12000) return json({ error: 'Message is too long.' }, 400)

    const activeTicket = clean(body.active_ticket)
    const history = Array.isArray(body.history)
      ? body.history.slice(-10)
          .filter((m: any) => ['user', 'assistant'].includes(m?.role) && clean(m?.content))
          .map((m: any) => ({ role: m.role, content: clean(m.content).slice(0, 8000) }))
      : []

    if (!apiKey) {
      return json({
        error: 'OnSite Vision AI model is not configured yet.',
        code: 'OPENAI_API_KEY_MISSING',
        fallback_ok: true,
      }, 503)
    }

    const currentDate = todayCentral()

    const getContext = async (ticketNo: string) => {
      const { data, error } = await userClient.rpc('get_tech_check_job_context_v1', { p_ticket_no: clean(ticketNo) })
      if (error) throw error
      return data
    }

    const toolTrace: Array<{ name: string; args: unknown }> = []
    const toolCall = async (name: string, args: any): Promise<Json> => {
      toolTrace.push({ name, args })
      if (name === 'get_job_context') {
        const context = await getContext(args.ticket_no)
        return compactJobContext(context) as Json
      }

      if (name === 'analyze_job') {
        const context = await getContext(args.ticket_no)
        if (!context?.found) return { found: false, ticket_no: clean(args.ticket_no) }
        const ec = engineContext(context)
        const manifest = context?.prep?.equipment_manifest || context?.assignments?.[0]?.equipment_manifest || []
        return stripNulls({
          found: true,
          ticket_no: context.ticket_no,
          summary: context.summary,
          blockers: ENGINE?.getWorkflowBlockers?.(ec) || [],
          next_step: ENGINE?.getWorkflowNextStep?.(ec) || null,
          product_requirements: ENGINE?.productRequirements?.({ equipment_manifest: manifest }) || [],
          context: compactJobContext(context),
        }) as Json
      }

      if (name === 'find_job_by_unit') {
        const raw = clean(args.unit_reference)
        const numeric = raw.match(/\b(\d{1,6})\b/)?.[1] || ''
        const variants = [...new Set([
          raw,
          numeric,
          numeric ? numeric.padStart(3, '0') : '',
        ].filter(Boolean))]

        let query = userClient
          .from('unit_registry')
          .select('unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,current_holder_name,last_event,updated_at')
          .order('updated_at', { ascending: false })
          .limit(20)

        if (variants.length === 1) query = query.eq('unit_tag', variants[0])
        else if (variants.length > 1) query = query.in('unit_tag', variants)

        let { data, error } = await query
        if (error) throw error

        if ((!data || !data.length) && numeric) {
          const retry = await userClient
            .from('unit_registry')
            .select('unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,current_holder_name,last_event,updated_at')
            .ilike('unit_tag', '%' + numeric + '%')
            .order('updated_at', { ascending: false })
            .limit(20)
          if (retry.error) throw retry.error
          data = retry.data
        }
        return { query: raw, matches: data || [] }
      }

      if (name === 'list_active_jobs') {
        const { data, error } = await userClient
          .from('job_assignments')
          .select('ticket_no,site,assigned_role,assignee_name,assignment_scope,status,scheduled_for,scheduled_time,work_type,equipment_manifest,unit_summary,job_description,updated_at')
          .in('status', ['assigned', 'started'])
          .order('scheduled_for', { ascending: true, nullsFirst: false })
          .order('updated_at', { ascending: false })
          .limit(120)
        if (error) throw error
        return { jobs: data || [] }
      }

      if (name === 'list_jobs_for_date') {
        const date = clean(args.date)
        const { data, error } = await userClient
          .from('job_assignments')
          .select('ticket_no,site,assigned_role,assignee_name,assignment_scope,status,scheduled_for,scheduled_time,work_type,equipment_manifest,unit_summary,job_description,updated_at')
          .eq('scheduled_for', date)
          .neq('status', 'cancelled')
          .order('scheduled_time', { ascending: true, nullsFirst: false })
          .limit(120)
        if (error) throw error
        return { date, jobs: data || [] }
      }

      if (name === 'list_technicians') {
        const role = clean(args.role)
        let query = userClient
          .from('profiles')
          .select('user_id,full_name,username,role,active')
          .eq('active', true)
          .is('archived_at', null)
          .in('role', ['it', 'service'])
          .order('full_name')
        if (role === 'it' || role === 'service') query = query.eq('role', role)
        const { data, error } = await query
        if (error) throw error
        return { role, technicians: data || [] }
      }

      if (name === 'get_company_knowledge') {
        const topic=clean(args.topic)
        const baseline=knowledgeForTopic(topic)
        const managed=await userClient.rpc('vision_search_knowledge_v1',{
          p_query:topic,
          p_equipment_type:'',
          p_workflow_type:'',
          p_limit:12,
        })
        if(managed.error) throw managed.error
        return {
          authority_order:[
            'LIVE DATABASE / SERVER ENFORCEMENT',
            'APPROVED MANAGED COMPANY KNOWLEDGE',
            'CODE BASELINE KNOWLEDGE',
            'AI INFERENCE'
          ],
          baseline,
          approved_managed_knowledge:Array.isArray(managed.data)?managed.data:[],
          note:'Draft and retired knowledge are excluded. If approved managed knowledge conflicts with a live database rule, the database rule remains authoritative. If approved managed knowledge conflicts with the code baseline, report the conflict so Tech Check can be brought into parity rather than silently guessing.'
        } as Json
      }

      throw new Error('Unknown agent tool: ' + name)
    }

    const instructions = [
      'You are OnSite Vision, the internal AI operations assistant for Cameras On Site Tech Check.',
      'The authenticated user is an active Owner/Admin.',
      'Your job is to help run technical operations from beginning to end using Cameras On Site company rules and live Tech Check data.',
      'Current local date for Cameras On Site (America/Chicago): ' + currentDate + '.',
      activeTicket ? 'Current conversation ticket context: MHelpDesk #' + activeTicket + '.' : 'There is no current ticket context.',
      '',
      'GROUNDING RULES:',
      '- For current job, assignment, schedule, equipment, return, evidence, handoff, blocker, or completion facts, call a live database tool before answering.',
      '- For technical product configuration, required checks, batteries, ports, workflow rules, or troubleshooting, call get_company_knowledge before answering.',
      '- Product/checklist requirements returned through Company Knowledge are synchronized from the shared TechCheckRules runtime used by the technician app. Treat shared_it_checklist/shared_it_check_fields as the technician-side checklist contract.',
      '- Never substitute generic internet knowledge for undocumented Cameras On Site technical rules.',
      '- If company knowledge marks something partial/unknown, say what is missing instead of inventing an answer.',
      '- When a product definition includes teaching_needed, use it to state exactly what Cameras On Site information is still missing; do not convert those questions into assumed procedures.',
      '- get_company_knowledge may return owner-approved managed knowledge in addition to the code baseline. Draft and retired entries are never company truth.',
      '- Live database enforcement outranks editable knowledge. If approved managed knowledge conflicts with the code baseline, call out the conflict instead of silently choosing one.',
      '- Distinguish VERIFIED DATABASE FACT, COMPANY RULE, AI INFERENCE, and MISSING INFORMATION.',
      '- Historical raw work_type can be stale. Prefer summary.effective_work_type from live job context.',
      '- MHelpDesk is separate from Tech Check; never claim you changed MHelpDesk.',
      '',
      'ACTION SAFETY:',
      '- This server agent is READ ONLY. It has no mutation tools.',
      '- If the owner asks to create, assign, reschedule, update, hand off, complete, cancel, return, check out, check in, verify, or approve something, explain the proposed action and populate proposed_action.',
      '- For proposed schedule actions, proposed_action.date must be YYYY-MM-DD and proposed_action.time should be HH:MM in local Central time when known.',
      '- For proposed assignment actions, use role exactly "it" or "service" when known.',
      '- Never say a write occurred. The Tech Check client will show a confirmation and execute an approved write path separately.',
      '- If a request is ambiguous, ask a natural clarifying question rather than guessing.',
      '',
      'CONVERSATION:',
      '- Understand natural references such as it, that job, this ticket, the unit, and follow-ups using the supplied active ticket and history.',
      '- Be concise but operationally thorough. State the immediate next step when it helps.',
      '- Do not expose internal UUIDs unless the user explicitly asks for them.',
    ].join('\n')

    const input: any[] = [
      ...history,
      { role: 'user', content: message },
    ]

    let response: any = null
    for (let turn = 0; turn < 6; turn++) {
      const apiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          instructions,
          input,
          tools,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          reasoning: { effort: 'medium' },
          text: {
            format: {
              type: 'json_schema',
              name: 'onsite_vision_response',
              strict: true,
              schema: outputSchema,
            },
          },
          max_output_tokens: 2200,
          store: false,
        }),
      })

      const raw = await apiResponse.text()
      if (!apiResponse.ok) {
        console.error('OpenAI Responses API error', apiResponse.status, raw.slice(0, 1200))
        return json({
          error: 'OnSite Vision model request failed.',
          code: 'OPENAI_RESPONSE_ERROR',
          fallback_ok: true,
        }, 502)
      }

      response = JSON.parse(raw)
      const calls = (response.output || []).filter((item: any) => item?.type === 'function_call')
      if (!calls.length) break

      input.push(...(response.output || []))
      for (const call of calls) {
        let result: Json
        try {
          const args = JSON.parse(call.arguments || '{}')
          result = await toolCall(call.name, args)
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) }
        }
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        })
      }
    }

    const text = responseText(response)
    if (!text) {
      return json({ error: 'OnSite Vision did not produce a final answer.', code: 'EMPTY_MODEL_RESPONSE', fallback_ok: true }, 502)
    }

    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = {
        answer: text,
        active_ticket: activeTicket,
        facts: [],
        proposed_action: {
          type: 'none',
          ticket_no: '',
          work_type: '',
          role: '',
          technician_name: '',
          date: '',
          time: '',
          summary: '',
          requires_confirmation: false,
        },
      }
    }

    return json({
      ok: true,
      agent_version: 'onsite-vision-agent-v5',
      model,
      tool_trace: toolTrace,
      ...parsed,
    })
  } catch (error) {
    console.error('OnSite Vision agent failure', error)
    return json({
      error: error instanceof Error ? error.message : String(error),
      code: 'VISION_AGENT_FAILURE',
      fallback_ok: true,
    }, 500)
  }
})
