# Shared IT recovery checkpoints

The earlier local artifacts were lost. This reconstruction starts at published
main `6ee65ccaf566452c66464526a7a13b6ec0125bdc`; earlier test totals do not validate
these rebuilt bytes.

## Checkpoint 1: inert source-only lifecycle boundary

`source-it-lifecycle.js` is additive and is not yet imported by the live wizard.
It captures the original active actual IT identity and visible view before an
await. It correlates a strict three-part JWT's subject and logical session ID,
permits refresh within that session, and rejects replacement sessions even for
the same account. JWT decoding is only client correlation, never authorization.
The existing server membership and profile checks remain mandatory.

The scope checks fresh transport auth before continuing; cancellation is
permanent after navigation, changed visible cards or inputs, same-task
hide/restore, detach/reattach, role/profile changes or private invalidation.
It has no SQL, Storage, credential, grant, global navigation or legacy write.

Sixteen fresh runtime tests execute this actual module using synthetic session
and DOM transports. They pass. They do not constitute a browser check, an
integrated entry check or native PostgreSQL verification. The real protected
entry patch, shared CAS/evidence and actor-only release checkpoints follow
separately and must receive independent review before composition.

Session correlation follows the documented stable `session_id` claim:
https://supabase.com/docs/guides/auth/sessions
