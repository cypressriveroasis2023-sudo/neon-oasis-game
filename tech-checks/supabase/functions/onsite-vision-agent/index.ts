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

const SOURCE_REPO = 'cypressriveroasis2023-sudo/neon-oasis-game'
const SOURCE_FILES = [
  'tech-checks/onsite-vision.js',
  'tech-checks/onsite-vision-live-data.js',
  'tech-checks/onsite-vision-actions.js',
  'tech-checks/onsite-vision-persistence.js',
  'tech-checks/onsite-vision-knowledge-admin.js',
  'tech-checks/onsite-vision-workflow-engine.js',
  'tech-checks/onsite-vision-company-knowledge.js',
  'tech-checks/tech-check-rules.js',
  'tech-checks/app.js',
  'tech-checks/technician-wizard-owner-dashboard-v5.js',
  'tech-checks/index.html',
  'tech-checks/sw.js',
]

const unitNumber = (value: unknown) => {
  const digits = clean(value).match(/\d+/g)?.join('') || ''
  return digits ? String(Number(digits)) : ''
}
const matchesOfflineUnit = (row: any, reference: unknown) => {
  const ref = clean(reference)
  if (!ref) return true
  const refLower = lower(ref)
  const tag = clean(row?.unit_tag)
  const equipment = clean(row?.equipment_type)
  const want = unitNumber(ref)
  const got = unitNumber(tag)
  if (want && got && want === got) {
    const namedType = refLower
      .replace(/[\d#._-]+/g, ' ')
      .replace(/\b(unit|number|no)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return !namedType || lower(equipment).includes(namedType) || namedType.includes(lower(equipment))
  }
  return lower(equipment + ' ' + tag).includes(refLower) || lower(tag) === refLower
}
const todayCentral = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const timeCentral = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
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
  const retiredEquipment = KNOWLEDGE?.retired_equipment || {}
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

  const retiredName = Object.keys(retiredEquipment).find((name) =>
    q === lower(name) || q.includes(lower(name))
  )
  if (retiredName) {
    return {
      certainty: 'COMPANY RULE',
      topic: 'retired_equipment',
      retired_equipment: retiredName,
      definition: retiredEquipment[retiredName],
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

function knowledgeCoverage() {
  const equipment = KNOWLEDGE?.equipment || {}
  const names = Object.keys(equipment)
  const fullyDocumented = names.filter((name) => equipment?.[name]?.documented === true)
  const gaps = KNOWLEDGE?.phase_7_gap_inventory?.products || {}
  return {
    knowledge_version: KNOWLEDGE?.version || 'unknown',
    equipment_total: names.length,
    fully_documented_equipment: fullyDocumented.length,
    partial_or_incomplete_equipment: Math.max(0, names.length - fullyDocumented.length),
    known_gap_products: Object.keys(gaps),
    known_gap_product_count: Object.keys(gaps).length,
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
    name: 'find_people',
    description: 'Find Cameras On Site people/profile records by name or username across Owner, IT, and Service, including inactive or archived records. Use for questions like who is Mike, tell me about Teddy, or does this person work here.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_system_health',
    description: 'Get the Owner-only live Tech Check health report: security exposure, workflow attention, data-integrity violations, profile ambiguity, Vision persistence/audit counts, knowledge counts, and migration count. Use for system/database/AI health or integrity questions.',
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
    name: 'get_company_history',
    description: 'Read the permanent Cameras On Site history for a technician, numbered unit, or customer/site. Use this for who last worked on a unit, prior problems/work at a site, or a technician work-history question.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['technician', 'unit', 'site'] },
        value: { type: 'string', description: 'Technician name/username/user id, unit tag, or exact customer/site name.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['kind', 'value', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_owner_review_queue',
    description: 'Get the current Owner closeout queue, including jobs ready for Owner Review and jobs the Owner returned for correction. This is Tech Check only; MHelpDesk remains separate.',
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
    name: 'get_offline_escalations',
    description: 'Read live Tech Check offline-unit escalation records. Use for currently offline units, cases waiting for IT, cases needing an Owner decision, troubleshooting already attempted, backup-swap authorization, and whether a failed unit reached IT Intake. MHelpDesk remains separate.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['active', 'waiting_it', 'owner_decision', 'resolved', 'all'] },
        unit_reference: { type: 'string', description: 'Optional natural unit reference such as Helios 7. Use an empty string when not filtering by unit.' },
        ticket_no: { type: 'string', description: 'Optional MHelpDesk ticket reference. Use an empty string when not filtering by ticket.' },
      },
      required: ['scope', 'unit_reference', 'ticket_no'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_damage_holds',
    description: 'Read live Tech Check damaged-equipment / Needs Replacement return records. Use for equipment needing replacement or repair attention, IT damage documentation, Owner damage notification evidence, Maintenance/Shop Inventory status, and whether a damaged unit can return to Shop Inventory. MHelpDesk remains separate.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['active', 'all'] },
        unit_reference: { type: 'string', description: 'Optional natural unit reference. Use an empty string when not filtering by unit.' },
        ticket_no: { type: 'string', description: 'Optional MHelpDesk ticket reference. Use an empty string when not filtering by ticket.' },
      },
      required: ['scope', 'unit_reference', 'ticket_no'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_departure_readiness',
    description: 'Read live Tech Check truck/day departure readiness: charged battery minimums and IT-checked-out backup units. Use before saying Service is ready to leave the shop.',
    strict: true,
    parameters: { type: 'object', properties: { ticket_no: { type: 'string' } }, required: ['ticket_no'], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'get_workload',
    description: 'Read live Tech Check scheduled job assignments for a date, department, or specific technician. Use for natural questions like how many jobs IT has today, what Service has Monday, or how many jobs a named technician has.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD date.' },
        role: { type: 'string', enum: ['', 'it', 'service'] },
        technician_name: { type: 'string', description: 'Technician name or username, or empty string.' }
      },
      required: ['date','role','technician_name'],
      additionalProperties: false
    },
  },
  {
    type: 'function',
    name: 'get_operations_snapshot',
    description: 'Build one read-only Owner operations snapshot for a date. It combines scheduled workload, technician load, overdue active work, workflow blockers/next steps, Owner Review, active offline escalations, and damaged-equipment holds. Use first for broad questions like what needs attention today, give me the rundown, what is behind, who has room, what do I need to deal with, or how are operations looking.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD date to review.' },
        include_overdue: { type: 'boolean', description: 'Include active jobs scheduled before today and jobs whose scheduled time has passed today.' }
      },
      required: ['date','include_overdue'],
      additionalProperties: false
    },
  },
  {
    type: 'function',
    name: 'search_app_source',
    description: 'Search the current GitHub main-branch Tech Check source code read-only. Use for questions about programming, exact implementation, why a UI/workflow behaves a certain way, which file/function controls behavior, cache/version wiring, or whether code contains a rule.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Plain-language or code search terms.' },
        file_hint: { type: 'string', description: 'Optional exact allowlisted repo path, or empty string to search the Tech Check source allowlist.' }
      },
      required: ['query','file_hint'],
      additionalProperties: false
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
            enum: ['VERIFIED DATABASE FACT', 'VERIFIED SOURCE CODE FACT', 'COMPANY RULE', 'AI INFERENCE', 'MISSING INFORMATION'],
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
    action_plan: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        summary: { type: 'string' },
        steps: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              sequence: { type: 'integer', minimum: 1, maximum: 12 },
              type: {
                type: 'string',
                enum: ['create_job', 'assign', 'schedule', 'update', 'handoff', 'verify', 'complete', 'cancel', 'return', 'check_out', 'check_in', 'owner_approve'],
              },
              ticket_no: { type: 'string' },
              work_type: { type: 'string' },
              role: { type: 'string' },
              technician_name: { type: 'string' },
              date: { type: 'string' },
              time: { type: 'string' },
              summary: { type: 'string' },
              reason: { type: 'string' },
              execution_mode: { type: 'string', enum: ['audited', 'guided', 'needs_input'] },
              requires_confirmation: { type: 'boolean' },
            },
            required: ['sequence','type','ticket_no','work_type','role','technician_name','date','time','summary','reason','execution_mode','requires_confirmation'],
            additionalProperties: false,
          },
        },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['detected','summary','steps','notes'],
      additionalProperties: false,
    },
    working_memory_update: {
      type: 'object',
      properties: {
        active_ticket: { type: 'string' },
        site: { type: 'string' },
        work_type: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        current_subject: { type: 'string' },
        workflow_stage: { type: 'string' },
        technician_names: { type: 'array', items: { type: 'string' } },
        unit_references: { type: 'array', items: { type: 'string' } },
        unresolved_reference: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['active_ticket','site','work_type','date','time','current_subject','workflow_stage','technician_names','unit_references','unresolved_reference','notes'],
      additionalProperties: false,
    },
    knowledge_proposal: {
      type: 'object',
      properties: {
        detected: { type: 'boolean' },
        title: { type: 'string' },
        domain: { type: 'string', enum: ['technical','product','workflow','sop','troubleshooting','configuration','safety','operations'] },
        equipment_type: { type: 'string' },
        workflow_type: { type: 'string' },
        topic: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
      },
      required: ['detected','title','domain','equipment_type','workflow_type','topic','content','tags','rationale'],
      additionalProperties: false,
    },
  },
  required: ['answer', 'active_ticket', 'facts', 'proposed_action', 'action_plan', 'working_memory_update', 'knowledge_proposal'],
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
        agent_version: 'onsite-vision-agent-v31',
        model,
        model_configured: Boolean(apiKey),
        knowledge_version: KNOWLEDGE?.version || 'unknown',
        knowledge_coverage: knowledgeCoverage(),
        workflow_engine_version: ENGINE?.version || 'unknown',
        shared_rules_version: (globalThis as any).TechCheckRules?.version || 'unknown',
        write_tools_enabled: false,
        managed_knowledge_enabled: true,
        working_memory_enabled: true,
        source_code_search_enabled: true,
        owner_correction_learning_enabled: true,
        operations_orchestration_enabled: true,
        multi_action_planning_enabled: true,
      })
    }

    const message = clean(body.message)
    if (!message) return json({ error: 'Message is required.' }, 400)
    if (message.length > 12000) return json({ error: 'Message is too long.' }, 400)

    const activeTicket = clean(body.active_ticket)
    const workingMemory = body.working_memory && typeof body.working_memory === 'object' && !Array.isArray(body.working_memory)
      ? stripNulls(body.working_memory)
      : {}
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

      if (name === 'find_people') {
        const queryText = clean(args.query)
        const terms = lower(queryText).split(/\s+/).filter(Boolean)
        const { data, error } = await userClient
          .from('profiles')
          .select('user_id,full_name,username,role,active,archived_at')
          .order('full_name')
          .limit(250)
        if (error) throw error
        const people = (data || []).filter((person: any) => {
          const hay = lower((person.full_name || '') + ' ' + (person.username || ''))
          return terms.every((term: string) => hay.includes(term))
        }).slice(0, 20)
        return { query: queryText, people }
      }

      if (name === 'get_system_health') {
        const { data, error } = await userClient.rpc('get_owner_system_health_v1')
        if (error) throw error
        return {
          ...(data || {}),
          ai_layer: {
            knowledge: knowledgeCoverage(),
            shared_rules_version: (globalThis as any).TechCheckRules?.version || 'unknown',
            workflow_engine_version: ENGINE?.version || 'unknown',
            agent_version: 'onsite-vision-agent-v31',
          }
        } as Json
      }

      if (name === 'get_company_history') {
        const kind=clean(args.kind).toLowerCase()
        const value=clean(args.value)
        const limit=Math.max(1,Math.min(Number(args.limit||50),100))
        const { data, error } = await userClient.rpc('get_company_history_v1', {
          p_kind: kind,
          p_value: value,
          p_limit: limit,
        })
        if (error) throw error
        return (data || { kind, query:value, found:false, events:[] }) as Json
      }

      if (name === 'get_owner_review_queue') {
        const { data, error } = await userClient.rpc('owner_review_queue_v1', { p_limit: 40 })
        if (error) throw error
        return { reviews: Array.isArray(data) ? data : [] } as Json
      }

      if (name === 'get_offline_escalations') {
        const scope = clean(args.scope).toLowerCase()
        const unitReference = clean(args.unit_reference)
        const ticketNo = clean(args.ticket_no)
        if (!['active','waiting_it','owner_decision','resolved','all'].includes(scope)) {
          throw new Error('Invalid offline escalation scope.')
        }

        let query = userClient
          .from('field_escalations')
          .select([
            'id','ticket_no','site','unit_tag','equipment_type','service_tech_name',
            'original_problem','service_power_verified','service_troubleshooting_notes',
            'service_started_at','it_tech_name','it_troubleshooting_notes','status',
            'backup_unit_tag','backup_equipment_type','backup_authorized_at',
            'failed_return_id','owner_summary','owner_notified_at','owner_resolution',
            'owner_resolved_by_name','owner_resolved_at','resolved_at','created_at','updated_at'
          ].join(','))
          .order('updated_at', { ascending: false })
          .limit(100)

        if (scope === 'active') {
          query = query
            .in('status', ['waiting_it','joint_troubleshooting','backup_swap_authorized','unresolved_owner'])
            .is('resolved_at', null)
        } else if (scope === 'waiting_it') {
          query = query.eq('status', 'waiting_it').is('resolved_at', null)
        } else if (scope === 'owner_decision') {
          query = query.eq('status', 'unresolved_owner').is('resolved_at', null)
        } else if (scope === 'resolved') {
          query = query.not('resolved_at', 'is', null)
        }
        if (ticketNo) query = query.eq('ticket_no', ticketNo)

        const { data, error } = await query
        if (error) throw error
        const escalations = (Array.isArray(data) ? data : [])
          .filter((row: any) => matchesOfflineUnit(row, unitReference))

        return {
          scope,
          unit_reference: unitReference,
          ticket_no: ticketNo,
          count: escalations.length,
          escalations,
          rule: 'resolved_at is authoritative for active vs resolved. failed_unit_in_it_intake is resolved because the failed-unit return has entered Service Return → IT Intake.',
        } as Json
      }

      if (name === 'get_damage_holds') {
        const scope = clean(args.scope).toLowerCase()
        const unitReference = clean(args.unit_reference)
        const ticketNo = clean(args.ticket_no)
        if (!['active','all'].includes(scope)) throw new Error('Invalid damage-hold scope.')

        let query = userClient
          .from('unit_returns')
          .select([
            'id','ticket_no','unit_tag','equipment_type','service_tech_name','returned_at','return_notes',
            'status','it_tech_name','it_received_at','physical_condition_ok','accessories_ok','batteries_ok',
            'sd_cards_ok','electronics_ok','power_functions_ok','damage_notes','intake_photo_paths',
            'mhelp_inventory_confirmed','mhelp_confirmed_at','completed_at','created_at','updated_at'
          ].join(','))
          .order('updated_at', { ascending: false })
          .limit(100)

        if (scope === 'active') query = query.eq('status', 'needs_replacement')
        else query = query.not('damage_notes', 'is', null)
        if (ticketNo) query = query.eq('ticket_no', ticketNo)

        const { data, error } = await query
        if (error) throw error
        const returns = (Array.isArray(data) ? data : [])
          .filter((row: any) => matchesOfflineUnit(row, unitReference))

        const tickets = [...new Set(returns.map((row: any) => clean(row.ticket_no)).filter(Boolean))]
        const tags = [...new Set(returns.map((row: any) => clean(row.unit_tag)).filter(Boolean))]
        let assets: any[] = []
        let notifications: any[] = []
        let reports: any[] = []

        if (tags.length) {
          const assetResult = await userClient
            .from('asset_inventory')
            .select('unit_key,unit_tag,asset_type,availability_status,last_event,notes,updated_at')
            .in('unit_tag', tags)
            .limit(Math.max(20, tags.length * 3))
          if (assetResult.error) throw assetResult.error
          assets = Array.isArray(assetResult.data) ? assetResult.data : []
        }

        if (tickets.length) {
          const notificationResult = await userClient
            .from('app_notifications')
            .select('id,recipient_user_id,kind,title,ticket_no,unit_tag,read_at,created_at')
            .eq('title', 'Damaged equipment needs replacement')
            .in('ticket_no', tickets)
            .order('created_at', { ascending: false })
            .limit(250)
          if (notificationResult.error) throw notificationResult.error
          notifications = Array.isArray(notificationResult.data) ? notificationResult.data : []

          const reportResult = await userClient
            .from('reports')
            .select('id,kind,ticket_no,actor_name,text,created_at')
            .eq('kind', 'DAMAGED EQUIPMENT NEEDS REPLACEMENT')
            .in('ticket_no', tickets)
            .order('created_at', { ascending: false })
            .limit(250)
          if (reportResult.error) throw reportResult.error
          reports = Array.isArray(reportResult.data) ? reportResult.data : []
        }

        const damageHolds = returns.map((row: any) => {
          const tag = clean(row.unit_tag)
          const ticket = clean(row.ticket_no)
          const asset = assets.find((a: any) => clean(a.unit_tag) === tag) || null
          const rowNotifications = notifications.filter((n: any) =>
            clean(n.ticket_no) === ticket &&
            (!tag || !clean(n.unit_tag) || clean(n.unit_tag) === tag)
          )
          const rowReports = reports.filter((r: any) => clean(r.ticket_no) === ticket)
          return {
            ...row,
            asset_inventory_status: asset?.availability_status || null,
            asset_last_event: asset?.last_event || null,
            owner_notified: rowNotifications.length > 0,
            owner_notification_count: rowNotifications.length,
            owner_notification_latest_at: rowNotifications[0]?.created_at || null,
            permanent_damage_report_present: rowReports.length > 0,
            permanent_damage_report_at: rowReports[0]?.created_at || null,
            shop_inventory_blocked: row.status === 'needs_replacement',
          }
        })

        return {
          scope,
          unit_reference: unitReference,
          ticket_no: ticketNo,
          count: damageHolds.length,
          damage_holds: damageHolds,
          rules: [
            'A needs_replacement return is held out of available Shop Inventory.',
            'Owner notification is VERIFIED DATABASE FACT only when a matching app_notifications record is present.',
            'The permanent damage report does not substitute for missing notification evidence.',
            'The normal final repair/replacement disposition remains MISSING INFORMATION until Cameras On Site defines and completes that procedure.'
          ],
        } as Json
      }

      if (name === 'get_departure_readiness') {
        const ticketNo=clean(args.ticket_no)
        let batteryQuery=userClient.from('truck_spare_batteries').select('ticket_no,equipment_type,battery_type,qty_prepared,ready_ok,service_tech_name,status,it_checked_out_at,it_checked_out_by_name,resolved_at').neq('status','resolved').is('resolved_at',null).limit(250)
        if(ticketNo)batteryQuery=batteryQuery.eq('ticket_no',ticketNo)
        const batteryResult=await batteryQuery
        if(batteryResult.error)throw batteryResult.error
        const batteries=Array.isArray(batteryResult.data)?batteryResult.data:[]

        let spareQuery=userClient.from('prep_items').select('equipment_type,purpose,unit_tag,power_ok,functions_ok,safe_ok,verified_at,spare_outcome,spare_checked_out_at,spare_checked_out_to_name,spare_it_checked_out_at,spare_it_checked_out_by_name,prep_tickets!inner(ticket_no,work_type,status)').eq('purpose','spare').limit(250)
        if(ticketNo)spareQuery=spareQuery.eq('prep_tickets.ticket_no',ticketNo)
        const spareResult=await spareQuery
        if(spareResult.error)throw spareResult.error
        const spares=(Array.isArray(spareResult.data)?spareResult.data:[]).filter((row:any)=>!['returned','used'].includes(clean(row.spare_outcome).toLowerCase()))

        const readyBatteries=batteries.filter((row:any)=>row.ready_ok===true&&Boolean(row.it_checked_out_at))
        const standardQty=readyBatteries.filter((row:any)=>/110\s*ah/i.test(clean(row.battery_type))).reduce((sum:number,row:any)=>sum+Number(row.qty_prepared||0),0)
        const litimeQty=readyBatteries.filter((row:any)=>/litime/i.test(clean(row.battery_type))&&/100\s*ah/i.test(clean(row.battery_type))).reduce((sum:number,row:any)=>sum+Number(row.qty_prepared||0),0)
        const eligibleBackup=spares.filter((row:any)=>['spotter','sniper','solar spotter'].includes(clean(row.equipment_type).toLowerCase())&&row.power_ok===true&&row.functions_ok===true&&row.safe_ok===true&&Boolean(row.verified_at)&&Boolean(row.spare_it_checked_out_at)&&Boolean(row.spare_checked_out_at))
        return {
          ticket_no:ticketNo,batteries,spares,
          counts:{standard_12v_110ah:standardQty,litime_12v_100ah:litimeQty,eligible_backup_units:eligibleBackup.length},
          minimums:{standard_12v_110ah:4,litime_12v_100ah:2,eligible_backup_units:1},
          ready:standardQty>=4&&litimeQty>=2&&eligibleBackup.length>=1,
          rules:['Minimum 4 x charged 12V 110Ah batteries.','Minimum 2 x charged LiTime 12V 100Ah batteries.','One IT-checked-out Spotter, Sniper, or Solar Spotter backup appropriate for the day. Solar Pole is retired.','Anything not recorded is MISSING INFORMATION.']
        } as Json
      }

      if (name === 'get_workload') {
        const date=clean(args.date),role=clean(args.role).toLowerCase(),technicianName=clean(args.technician_name)
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('A YYYY-MM-DD workload date is required.')
        if(!['','it','service'].includes(role))throw new Error('Invalid workload role.')

        let technician:any=null
        let technicianMatches:any[]=[]
        if(technicianName){
          const {data:profiles,error:profileError}=await userClient
            .from('profiles')
            .select('user_id,full_name,username,role,active,archived_at')
            .eq('active',true)
            .is('archived_at',null)
            .in('role',['it','service'])
            .limit(100)
          if(profileError)throw profileError
          const pool=(Array.isArray(profiles)?profiles:[]).filter((p:any)=>!role||clean(p.role).toLowerCase()===role)
          const q=technicianName.toLowerCase().trim()
          const exact=pool.filter((p:any)=>[p.full_name,p.username].filter(Boolean).some((v:any)=>clean(v).toLowerCase()===q))
          const loose=pool.filter((p:any)=>{
            const names=[p.full_name,p.username].filter(Boolean).map((v:any)=>clean(v).toLowerCase())
            const first=clean(p.full_name).toLowerCase().split(/\s+/)[0]
            return names.some((v:string)=>v.includes(q)||q.includes(v)) || (q.length>=3&&first===q)
          })
          technicianMatches=(exact.length?exact:loose).filter((p:any,i:number,arr:any[])=>arr.findIndex((x:any)=>clean(x.user_id)===clean(p.user_id))===i)
          if(technicianMatches.length>1){
            return {
              date,role,technician_name:technicianName,
              ambiguous:true,
              matches:technicianMatches.map((p:any)=>({full_name:p.full_name,username:p.username,role:p.role})),
              missing_information:'More than one active technician matched that name. Ask which technician the Owner means.'
            } as Json
          }
          technician=technicianMatches[0]||null
          if(!technician)return {date,role,technician_name:technicianName,scheduled_ticket_count:0,remaining_ticket_count:0,completed_ticket_count:0,assignments:[],missing_information:'No active Tech Check technician matched that name.'} as Json
        }

        let query=userClient
          .from('job_assignments')
          .select('id,ticket_no,site,assigned_role,assignee_user_id,assignee_name,status,scheduled_for,scheduled_time,work_type,unit_summary,job_description,requires_it_handoff,equipment_manifest,requested_unit_count,updated_at')
          .eq('scheduled_for',date)
          .neq('status','cancelled')
          .order('scheduled_time',{ascending:true,nullsFirst:false})
          .limit(250)
        if(role)query=query.eq('assigned_role',role)
        if(technician?.user_id)query=query.eq('assignee_user_id',technician.user_id)
        const {data,error}=await query
        if(error)throw error
        const assignments=Array.isArray(data)?data:[]
        const grouped=new Map<string,any[]>()
        for(const row of assignments){
          const ticket=clean(row.ticket_no)
          if(!ticket)continue
          if(!grouped.has(ticket))grouped.set(ticket,[])
          grouped.get(ticket)!.push(row)
        }
        const tickets=[...grouped.keys()]
        const completedTickets=tickets.filter((ticket)=>grouped.get(ticket)!.every((row:any)=>clean(row.status).toLowerCase()==='completed'))
        const remainingTickets=tickets.filter((ticket)=>!completedTickets.includes(ticket))
        const departmentTicketCounts={
          it:new Set(assignments.filter((row:any)=>clean(row.assigned_role).toLowerCase()==='it').map((row:any)=>clean(row.ticket_no)).filter(Boolean)).size,
          service:new Set(assignments.filter((row:any)=>clean(row.assigned_role).toLowerCase()==='service').map((row:any)=>clean(row.ticket_no)).filter(Boolean)).size
        }
        return {
          date,role,
          technician:technician?{full_name:technician.full_name,username:technician.username,role:technician.role}:null,
          scheduled_ticket_count:tickets.length,
          remaining_ticket_count:remainingTickets.length,
          completed_ticket_count:completedTickets.length,
          department_ticket_counts:departmentTicketCounts,
          tickets,
          remaining_tickets:remainingTickets,
          completed_tickets:completedTickets,
          assignments,
          mhelpdesk_separate:true
        } as Json
      }

      if (name === 'get_operations_snapshot') {
        const date=clean(args.date)
        const includeOverdue=args.include_overdue===true
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('A YYYY-MM-DD operations date is required.')

        const [workloadRaw,techniciansRaw,reviewsRaw,offlineRaw,damageRaw,activeRaw]=await Promise.all([
          toolCall('get_workload',{date,role:'',technician_name:''}),
          toolCall('list_technicians',{role:'all'}),
          toolCall('get_owner_review_queue',{}),
          toolCall('get_offline_escalations',{scope:'active',unit_reference:'',ticket_no:''}),
          toolCall('get_damage_holds',{scope:'active',unit_reference:'',ticket_no:''}),
          toolCall('list_active_jobs',{})
        ])
        const workload:any=workloadRaw||{}
        const technicians:any[]=(techniciansRaw as any)?.technicians||[]
        const assignments:any[]=Array.isArray(workload.assignments)?workload.assignments:[]
        const scheduledTickets:string[]=Array.isArray(workload.tickets)?workload.tickets:[]
        const currentDate=todayCentral(),currentTime=timeCentral()

        const analyses:any[]=[]
        for(const ticket of scheduledTickets.slice(0,20)){
          const context=await getContext(ticket)
          if(!context?.found)continue
          const ec=engineContext(context)
          const activeAssignments=(context.assignments||[]).filter((row:any)=>clean(row.status).toLowerCase()!=='cancelled')
          analyses.push(stripNulls({
            ticket_no:clean(ticket),
            site:context?.summary?.site||activeAssignments[0]?.site||'',
            work_type:context?.summary?.effective_work_type||context?.prep?.work_type||activeAssignments[0]?.work_type||'',
            statuses:activeAssignments.map((row:any)=>({
              role:row.assigned_role,
              technician:row.assignee_name||'Department queue',
              status:row.status,
              scheduled_time:row.scheduled_time
            })),
            blockers:ENGINE?.getWorkflowBlockers?.(ec)||[],
            next_step:ENGINE?.getWorkflowNextStep?.(ec)||null
          }))
        }

        const activeRows:any[]=(activeRaw as any)?.jobs||[]
        const overdueMap=new Map<string,any[]>()
        if(includeOverdue){
          for(const row of activeRows){
            const ticket=clean(row.ticket_no),scheduledFor=clean(row.scheduled_for),scheduledTime=clean(row.scheduled_time).slice(0,5)
            if(!ticket)continue
            const oldDate=Boolean(scheduledFor&&scheduledFor<currentDate)
            const lateToday=Boolean(scheduledFor===currentDate&&scheduledTime&&scheduledTime<currentTime)
            if(!oldDate&&!lateToday)continue
            if(!overdueMap.has(ticket))overdueMap.set(ticket,[])
            overdueMap.get(ticket)!.push(row)
          }
        }
        const overdue=[...overdueMap.entries()].map(([ticket,rows])=>({
          ticket_no:ticket,
          site:rows[0]?.site||'',
          scheduled_for:rows[0]?.scheduled_for||'',
          scheduled_time:rows[0]?.scheduled_time||'',
          assignments:rows.map((row:any)=>({role:row.assigned_role,technician:row.assignee_name||'Department queue',status:row.status}))
        }))

        const groupedByTech=new Map<string,{tech:any,tickets:Set<string>,remaining:Set<string>}>()
        for(const tech of technicians){
          const key=clean(tech.user_id)||lower(tech.full_name||tech.username)
          groupedByTech.set(key,{tech,tickets:new Set(),remaining:new Set()})
        }
        for(const row of assignments){
          const ticket=clean(row.ticket_no)
          if(!ticket)continue
          const key=clean(row.assignee_user_id)||lower(row.assignee_name)
          const bucket=groupedByTech.get(key)
          if(!bucket)continue
          bucket.tickets.add(ticket)
          if(clean(row.status).toLowerCase()!=='completed')bucket.remaining.add(ticket)
        }
        const technicianLoads=[...groupedByTech.values()].map(bucket=>({
          name:bucket.tech.full_name||bucket.tech.username||'',
          username:bucket.tech.username||'',
          role:bucket.tech.role,
          scheduled_ticket_count:bucket.tickets.size,
          remaining_ticket_count:bucket.remaining.size
        })).sort((a,b)=>a.remaining_ticket_count-b.remaining_ticket_count||a.scheduled_ticket_count-b.scheduled_ticket_count||clean(a.name).localeCompare(clean(b.name)))

        const queueCounts={it:0,service:0}
        for(const row of assignments){
          if(clean(row.status).toLowerCase()==='completed')continue
          const assigned=Boolean(clean(row.assignee_user_id)||clean(row.assignee_name))
          const role=clean(row.assigned_role).toLowerCase()
          if(!assigned&&(role==='it'||role==='service'))queueCounts[role as 'it'|'service']++
        }

        const reviews:any[]=(reviewsRaw as any)?.reviews||[]
        const offline:any[]=(offlineRaw as any)?.escalations||[]
        const damage:any[]=(damageRaw as any)?.damage_holds||[]
        const blocked=analyses.filter(row=>Array.isArray(row.blockers)&&row.blockers.length>0)
        const ownerDecisionOffline=offline.filter(row=>clean(row.status).toLowerCase()==='unresolved_owner')

        return {
          snapshot_version:'operations-snapshot-v1',
          date,
          generated_date:currentDate,
          generated_time_central:currentTime,
          workload:{
            scheduled_ticket_count:Number(workload.scheduled_ticket_count||0),
            remaining_ticket_count:Number(workload.remaining_ticket_count||0),
            completed_ticket_count:Number(workload.completed_ticket_count||0),
            tickets:scheduledTickets,
            assignments
          },
          workflow_analysis:{
            analyzed_ticket_count:analyses.length,
            blocked_ticket_count:blocked.length,
            tickets:analyses
          },
          overdue:{count:overdue.length,tickets:overdue},
          team:{
            technicians:technicianLoads,
            department_queue_remaining:queueCounts,
            capacity_note:'Technician load reflects only Tech Check tickets on this date. It does not prove travel, PTO, skill fit, or real-world availability.'
          },
          owner_attention:{
            owner_review_count:reviews.length,
            owner_reviews:reviews,
            offline_active_count:offline.length,
            offline_owner_decision_count:ownerDecisionOffline.length,
            offline_escalations:offline,
            damage_hold_count:damage.length,
            damage_holds:damage
          },
          mhelpdesk_separate:true
        } as Json
      }

      if (name === 'search_app_source') {
        const queryText=clean(args.query)
        const fileHint=clean(args.file_hint)
        if(!queryText)throw new Error('Source search query is required.')
        const requested=fileHint ? SOURCE_FILES.filter(path=>path===fileHint) : SOURCE_FILES
        if(fileHint && !requested.length){
          return {query:queryText,file_hint:fileHint,matches:[],missing_information:'That file is not in the approved Tech Check source-search allowlist.'} as Json
        }
        const words=lower(queryText).split(/\s+/).map((x:string)=>x.replace(/[^a-z0-9_]+/g,'')).filter((x:string)=>x.length>=2)
        const matches:any[]=[]
        for(const path of requested){
          if(matches.length>=18)break
          try{
            const url='https://raw.githubusercontent.com/'+SOURCE_REPO+'/main/'+path+'?vision='+Date.now()
            const response=await fetch(url,{headers:{'Cache-Control':'no-cache'}})
            if(!response.ok)continue
            const source=(await response.text()).slice(0,450000)
            const lines=source.split('\n')
            for(let i=0;i<lines.length;i++){
              const lineLower=lines[i].toLowerCase()
              const exact=lineLower.includes(queryText.toLowerCase())
              const score=words.reduce((n:number,w:string)=>n+(lineLower.includes(w)?1:0),0)
              if(!exact && score<Math.min(2,Math.max(1,words.length)))continue
              matches.push({
                path,
                line:i+1,
                snippet:lines.slice(Math.max(0,i-2),Math.min(lines.length,i+3)).map((line:string,j:number)=>String(Math.max(0,i-2)+j+1)+': '+line).join('\n')
              })
              if(matches.length>=18)break
            }
          }catch(_error){}
        }
        return {
          query:queryText,
          file_hint:fileHint,
          branch:'main',
          repository:SOURCE_REPO,
          matches,
          note:'Read-only source search of the current GitHub main branch. A match proves source text, not that a workflow database row currently has that state.'
        } as Json
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
      'Conversation working memory (context, not company truth): ' + JSON.stringify(workingMemory).slice(0, 7000),
      '',
      'GROUNDING RULES:',
      '- For current job, assignment, schedule, equipment, return, evidence, handoff, blocker, or completion facts, call a live database tool before answering.',
      '- For system health, database health, AI data integrity, security exposure, profile ambiguity, or whether Tech Check is ready for review, call get_system_health and distinguish critical integrity failures from normal workflow attention.',
      '- For questions about a named company person, employee, technician, owner, or whether someone exists in Tech Check, call find_people. This lookup includes Owner/IT/Service and active/inactive/archived profile records.',
      '- For permanent historical questions about a technician, numbered unit, or customer/site, call get_company_history before answering. History remains available after job closeout and after equipment returns to Shop Inventory.',
      '- For Ready for Owner Review, Owner closeout, or returned-for-correction questions, call get_owner_review_queue before answering. Do not claim MHelpDesk was closed or changed.',
      '- For offline-unit questions, cases waiting for IT, Owner decisions on offline cases, troubleshooting already attempted, backup swap authorization, or whether a failed unit reached IT Intake, call get_offline_escalations before answering.',
      '- For damaged equipment, Needs Replacement holds, IT damage notes, Owner damage-notification evidence, Maintenance status, or Shop Inventory eligibility after damage, call get_damage_holds before answering.',
      '- For truck readiness, departure readiness, battery minimums, or backup-unit readiness, call get_departure_readiness before answering. Never assume unrecorded equipment is on the truck.',
      '- For questions about how many jobs are scheduled on a date, call get_workload. If the current message names a technician, filter to that technician. If it names only IT or Service, filter to that department. If it asks broadly how many jobs today / total jobs / jobs scheduled today with no explicit technician or department, use role="" and technician_name="" for the company-wide distinct-ticket total. Do NOT inherit a previously named technician from working memory for a new broad workload question. If both IT and Service are named, use the company-wide result and department_ticket_counts; explain that department counts can overlap because one ticket can flow through both. MHelpDesk remains separate.',
      '- A live needs_replacement hold means the unit is NOT available Shop Inventory. Do not say it may return to Shop Inventory through a generic path while that hold exists.',
      '- Treat Owner notification as VERIFIED DATABASE FACT only when the matching app_notifications row is present. A permanent report alone does not prove the notification row is still recorded.',
      '- The final repair/replacement disposition is MISSING INFORMATION unless a documented Cameras On Site procedure and completed outcome are present. Do not invent a repair, purchase, retirement, or return-to-shop decision.',
      '- For offline escalations, resolved_at is authoritative for active vs resolved. A failed_unit_in_it_intake record is resolved because the failed-unit return reached Service Return → IT Intake.',
      '- If a requested offline-escalation fact was never recorded, label it MISSING INFORMATION instead of inferring it.',
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
      '- For source-code/programming questions, call search_app_source. Treat exact matched implementation as VERIFIED SOURCE CODE FACT. Source code tells you implementation; live database tools tell you current operational state.',
      '',
      'OPERATIONS ORCHESTRATION:',
      '- For broad Owner requests such as "what needs attention today", "give me the rundown", "what is behind", "who has room", "who can take this", "what do I need to deal with", "how are operations looking", or a daily/morning operations brief, call get_operations_snapshot FIRST for the relevant date.',
      '- The operations snapshot is intentionally broad: scheduled work, workflow blockers, overdue work, team Tech Check load, Owner Review, offline escalations, and damage holds. Use it to synthesize one coherent answer instead of making the Owner ask each subsystem separately.',
      '- If the snapshot identifies one ticket whose exact details matter, then call analyze_job or get_job_context for that ticket before making a ticket-specific factual claim.',
      '- Prioritize concrete Owner action items: unresolved Owner decisions, damaged-equipment holds, Owner Review/corrections, overdue jobs, then workflow blockers. Do not manufacture urgency when the data does not show it.',
      '- When asked who can take additional work, compare technician_loads only as recorded Tech Check workload. Say "lighter Tech Check load" rather than claiming someone is truly free or available. Travel, PTO, geography, and skill fit are MISSING INFORMATION unless recorded elsewhere.',
      '- If the Owner asks you to actually assign one of those technicians, prepare the normal confirmed assign action; the operations snapshot itself never writes.',
      '- MHelpDesk remains separate throughout any operations brief.',
      '',
      'MULTI-ACTION PLANNING:',
      '- When the Owner asks to handle several changes together, says "take care of everything you can", "do all of that", "make those changes", "fix everything you safely can", or gives multiple assignment/schedule/cancel/Owner-approval instructions in one message, create action_plan.detected=true.',
      '- Re-read the relevant live state before building the plan. For a broad operations request, call get_operations_snapshot again rather than relying on an older conversational rundown.',
      '- action_plan.steps must be ordered so prerequisites come before dependent steps. Keep the plan to at most 12 concrete steps.',
      '- execution_mode="audited" only for actions that can safely go through the existing Vision audit validator: assign, schedule, cancel, and owner_approve. The client will prepare each audited step and the Owner will see one explicit confirmation before execution.',
      '- execution_mode="guided" for create_job, handoff, verify, complete, return, check_out, check_in, or update when the existing Tech Check workflow requires evidence/checklists or guided data collection.',
      '- execution_mode="needs_input" when a required decision is missing, such as which technician, which ticket, a date/time, exact unit, or an Owner judgment that cannot be derived from company rules.',
      '- Do not pick a named technician solely because they have a lighter recorded workload unless the Owner explicitly authorizes load-based assignment in this request. A lighter Tech Check load is not proof of travel, PTO, geography, skill fit, or true availability.',
      '- You MAY propose a department-queue assignment when live workflow rules clearly require IT or Service next and no named technician is required. You MAY propose final Owner approval only when live data indicates the item is actually in the Owner review path; the audit validator still rechecks eligibility.',
      '- If action_plan.detected=true, set proposed_action.type="none" so the client does not render a duplicate single-action card.',
      '- Never claim the plan has executed. The plan is a proposal until the Owner presses the plan confirmation button. The client executes audited steps sequentially and stops on the first failure.',
      '- MHelpDesk remains separate from every plan step.',
      '',
      'PLAIN TALK / DICTATION:',
      '- Treat the Owner’s message like normal spoken conversation, not command syntax. Understand slang, shorthand, missing punctuation, speech-to-text wording, and reasonable typos when the intended meaning is clear.',
      '- Infer workload questions from normal speech. Examples: "what’s IT got today?", "what does Josh have?", "is Service busy tomorrow?", "how many jobs today?", "how many total jobs do I have today?", and "how many jobs are scheduled today?". Use get_workload. A fresh broad question resets the named-technician subject unless the Owner explicitly refers back with language such as "him", "her", "that tech", "same tech", or a terse continuation such as "and tomorrow?".',
      '- For workload answers, scheduled_ticket_count means all non-cancelled Tech Check tickets scheduled for that day; also tell the Owner how many remain and how many are completed when useful.',
      '- Resolve a partial technician name only when it uniquely matches one active IT or Service technician. If more than one matches, ask one short natural clarification instead of guessing.',
      '- Understand assignment phrasing such as "put Josh on this", "have Josh handle it", "give this to IT", or "let Mike take that one" as assignment intent.',
      '- Understand creation phrasing such as "make me a delivery", "throw in a pickup tomorrow", "start a swap", or "I need a service call" as create_job intent even if the words job or ticket are omitted.',
      '- For create_job, fill proposed_action.work_type, date, time, and technician_name whenever the Owner already supplied or clearly implied them. The client’s guided draft will ask only for required details that are still missing, including MHelpDesk number, site, equipment, unit numbers, work description, parts, assignment, and notes.',
      '- For questions about how Tech Check is programmed or why its workflow behaves a certain way, use live database facts, get_company_knowledge, workflow rules, and system health. Clearly distinguish code/company rules from live job data. If source-level implementation detail is not available through these tools, say that detail is not exposed here instead of inventing it.',
      '- Keep conversational context across follow-ups such as "him", "her", "that one", "this job", "move it to tomorrow", and "give it to Service" when the prior messages make the referent clear.',
      '',
      'WORKING MEMORY:',
      '- Populate working_memory_update on every answer with useful context learned or confirmed in this turn. Preserve stable context from the supplied working memory unless the Owner corrects it.',
      '- Working memory may contain the active ticket, site, workflow type, date/time, named technicians, numbered units, current subject, workflow stage, and a short unresolved reference. Do not put passwords, tokens, secrets, or speculative facts in memory.',
      '- Empty strings/arrays mean no new value for that field; do not erase good prior context merely because the current turn did not mention it.',
      '',
      'OWNER CORRECTION LEARNING:',
      '- Set knowledge_proposal.detected=true only when the Owner explicitly corrects Vision or defines a reusable Cameras On Site rule, term, convention, workflow, configuration, or SOP that should apply beyond the current one-off job.',
      '- Examples: "No, when I say inspections I mean truck inspections", "we do not do inspections on weekends", or "from now on call this a handoff".',
      '- Do NOT propose permanent knowledge for a temporary ticket instruction, one-time schedule, technician assignment, customer-specific fact, or ordinary question.',
      '- A detected correction is only a DRAFT proposal. Never say it is learned/published yet. The client requires Owner approval before it becomes approved company knowledge.',
      '- Make the proposed content concise, operational, and faithful to exactly what the Owner established. If the correction is ambiguous, ask a clarification and set detected=false.',
      '',
      'ACTION SAFETY:',
      '- This server agent is READ ONLY. It has no mutation tools.',
      '- If the owner asks to create, assign, reschedule, update, hand off, complete, cancel, return, check out, check in, verify, or approve something, explain the proposed action and populate proposed_action.',
      '- For proposed schedule actions, proposed_action.date must be YYYY-MM-DD and proposed_action.time should be HH:MM in local Central time when known.',
      '- For proposed assignment actions, use role exactly "it" or "service" when known.',
      '- If the Owner names a technician in an assignment request (for example "assign it to Josh"), call list_technicians when needed and ALWAYS put that exact matched active technician in proposed_action.technician_name. Do not propose a department queue when the Owner explicitly named a technician.',
      '- An Owner may directly reassign an existing IT or Service department-queue assignment to a specific active technician. Treat that as an assign action to the named technician; the client confirmation remains required.',
      '- Never say a write occurred. The Tech Check client will show a confirmation and execute an approved write path separately.',
      '- If a request is ambiguous, ask a natural clarifying question rather than guessing.',
      '',
      'CONVERSATION:',
      '- Understand natural references such as it, that job, this ticket, the unit, and follow-ups using the supplied active ticket and history.',
      '- If find_people returns multiple profile records for the same name, describe the records clearly and do not guess which account the owner means. Distinguish active, inactive, and archived status.',
      '- Be concise but operationally thorough. State the immediate next step when it helps.',
      '- Do not expose internal UUIDs unless the user explicitly asks for them.',
    ].join('\n')

    const input: any[] = [
      ...history,
      { role: 'user', content: message },
    ]

    const broadOperations=/\b(operations?|ops|rundown|what needs attention|needs attention|behind|who can take|who has room|what do i need to deal with|how are we looking|how are operations|morning brief|daily brief|today'?s brief|run the company)\b/i.test(message)
    const multiAction=/\b(take care of everything|everything you can|do all of that|do all that|make those changes|make all those changes|fix everything|handle all of|all of these|all of those|batch|in one go)\b/i.test(message)
      || ((message.match(/\b(assign|move|schedule|reschedule|cancel|approve)\b/gi)||[]).length>=2)
    const reasoningEffort = broadOperations || multiAction || /\b(code|program|programming|implementation|source|why|root cause|analy[sz]e|review everything|compare|workflow blocker|system health|database health|troubleshoot|what happened|history)\b/i.test(message)
      ? 'high'
      : 'medium'
    const maxToolTurns=(broadOperations||multiAction)?8:6

    let response: any = null
    for (let turn = 0; turn < maxToolTurns; turn++) {
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
          reasoning: { effort: reasoningEffort },
          text: {
            format: {
              type: 'json_schema',
              name: 'onsite_vision_response',
              strict: true,
              schema: outputSchema,
            },
          },
          max_output_tokens: 3200,
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
        action_plan: {
          detected:false,summary:'',steps:[],notes:[]
        },
        working_memory_update: {
          active_ticket:'',site:'',work_type:'',date:'',time:'',current_subject:'',workflow_stage:'',
          technician_names:[],unit_references:[],unresolved_reference:'',notes:[]
        },
        knowledge_proposal: {
          detected:false,title:'',domain:'operations',equipment_type:'',workflow_type:'',topic:'',content:'',tags:[],rationale:''
        },
      }
    }

    parsed.action_plan = parsed.action_plan || {detected:false,summary:'',steps:[],notes:[]}
    parsed.working_memory_update = parsed.working_memory_update || {
      active_ticket:'',site:'',work_type:'',date:'',time:'',current_subject:'',workflow_stage:'',
      technician_names:[],unit_references:[],unresolved_reference:'',notes:[]
    }
    parsed.knowledge_proposal = parsed.knowledge_proposal || {
      detected:false,title:'',domain:'operations',equipment_type:'',workflow_type:'',topic:'',content:'',tags:[],rationale:''
    }

    return json({
      ok: true,
      agent_version: 'onsite-vision-agent-v31',
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
