/** Display-only codes. Never accepts messages, identity values or arbitrary keys. */
const codes={
 product_native_binding:['binding_absent','guard_not_current','projection_not_linked','placement_held','projection_reason_present','alias_candidates_present','represented_membership_mismatch'],
 preview_request:['invalid_request'],preview_source:['source_unavailable'],preview_evaluation:['source_validation_failed'],
 mhelp_census:['source_unavailable'],tracker_census:['source_unavailable'],saved_endpoints:['source_unavailable'],saved_checks:['source_unavailable'],endpoint_evaluation:['source_unavailable'],
 connection_transport:['request_failed','timeout','cancelled','incomplete_response'],connection_envelope:['validation_rejected']
} as const;
export type ConnectionDiagnostic={stage:keyof typeof codes;code:string};
export function readConnectionDiagnostic(value:unknown):ConnectionDiagnostic|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==2||!Object.hasOwn(v,'stage')||!Object.hasOwn(v,'code')||typeof v.stage!=='string'||typeof v.code!=='string'||!Object.hasOwn(codes,v.stage))return;
 if(!(codes[v.stage as keyof typeof codes] as readonly string[]).includes(v.code))return;
 return {stage:v.stage as keyof typeof codes,code:v.code};
}
export function connectionDiagnosticText(value:unknown):string{
 const d=readConnectionDiagnostic(value);return d?`Diagnostic: ${d.stage} / ${d.code}.`:'';
}
