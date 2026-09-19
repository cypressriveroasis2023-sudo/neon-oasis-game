# OnSite Vision Server Agent

Phase 3 introduced a protected server-side AI agent for Cameras On Site Tech Check.

## Security model

- Supabase Edge Function: `onsite-vision-agent`
- `verify_jwt=true`
- Owner/Admin profile required after JWT validation
- Model has **read-only tools only**
- Current job facts are read through `get_tech_check_job_context_v1`
- Database RLS remains active for the user-scoped Supabase client
- Production writes are not available to the model
- Requested writes return a structured `proposed_action` for the Tech Check client to confirm separately

## Model configuration

Required Edge Function secret:

- `OPENAI_API_KEY`

Optional:

- `ONSITE_VISION_MODEL`

Default model when not overridden:

- `gpt-5.6-sol`

The browser calls the function with `{ mode: "status" }` after Owner authentication. It displays:

- **AI LIVE** when a model credential is configured
- **DATA LIVE** when live Tech Check data is available but the model credential is not configured or cannot be confirmed

If the agent is unavailable, the dedicated Vision page falls back to the existing deterministic assistant rather than breaking.

## Approved read-only agent tools

- `get_job_context`
- `analyze_job`
- `find_job_by_unit`
- `list_active_jobs`
- `list_jobs_for_date`
- `list_technicians`
- `get_company_knowledge`

## Grounding contract

The agent must distinguish:

- VERIFIED DATABASE FACT
- COMPANY RULE
- AI INFERENCE
- MISSING INFORMATION

It must use live Tech Check data for current operational facts and the Cameras On Site Company Knowledge Layer for technical rules. It must not replace missing company documentation with generic technical guesses.


## Managed knowledge

Agent v3 adds Owner-managed company knowledge through `vision_search_knowledge_v1`.

Knowledge lifecycle:

- Draft — editable, never returned to the AI as company truth.
- Approved — eligible for grounding as COMPANY RULE.
- Retired — preserved but excluded from AI grounding.

Authority order used by the agent:

1. Live database / server enforcement
2. Approved managed company knowledge
3. Code baseline knowledge
4. AI inference

If an approved managed entry conflicts with a live database rule, the database remains authoritative. If it conflicts with the code baseline, Vision should report the conflict so the application/workflow rules can be brought into parity rather than silently drifting.
