import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createCameraMhelpLinkHandler} from './index.ts';

const LEGACY = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const FIELD_LIST = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-mhelp-field-list';

const service = () => {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || Deno.env.get('SUPABASE_URL') !== LEGACY) throw Error('Backend unavailable');
  return createClient(LEGACY, key, {
    global: {fetch: (input, init = {}) => fetch(input, {...init, signal: AbortSignal.timeout(30000)})},
  });
};

async function json(response: Response, max = 4194304) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) throw Error('Read unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let raw = '', bytes = 0;
  try {
    for (;;) {
      const r = await reader.read(); if (r.done) break;
      bytes += r.value.length; if (bytes > max) throw Error('Read unavailable');
      raw += decoder.decode(r.value, {stream: true});
    }
    return JSON.parse(raw + decoder.decode());
  } finally { void reader.cancel().catch(() => {}); }
}

Deno.serve(createCameraMhelpLinkHandler({
  verifyCron: async candidate => {
    const {data, error} = await service().rpc('verify_camera_health_cron_secret', {candidate});
    return !error && data === true;
  },

  readServed: async secret => json(await fetch(FIELD_LIST, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret},
    body: '{"action":"list"}', redirect: 'error', signal: AbortSignal.timeout(60000),
  })),

  // This project's own copy of the list. Nothing else reads or writes this table.
  saveFieldList: async (records, sourceSha256) => {
    const db = service();
    const rows = records.map(row => ({
      mhelp_product_id: row.productId, unit_number: row.unitNumber, placement: row.placement,
      lifecycle: row.lifecycle, category: row.category, customer: row.customer,
      source_address: row.sourceAddress, hold_reason: row.holdReason,
      placement_observed_at: row.placementObservedAt, source_sha256: sourceSha256,
      refreshed_at: new Date().toISOString(),
    }));
    for (let at = 0; at < rows.length; at += 500) {
      const {error} = await db.schema('app_private').from('cos_mhelp_field_list')
        .upsert(rows.slice(at, at + 500), {onConflict: 'mhelp_product_id'});
      if (error) throw Error('Save unavailable');
    }
    return rows.length;
  },

  // One candidate per unit, not per camera row: camera_devices holds a row per
  // camera and a unit can have up to seven.
  readCosUnits: async () => {
    const db = service();
    const seen = new Map<string, {id: string; name: string}>();
    for (let from = 0; ; from += 1000) {
      const {data, error} = await db.from('camera_devices')
        .select('unit_key, device_name, do_not_use').range(from, from + 999);
      if (error) throw Error('Read unavailable');
      if (!data || !data.length) break;
      for (const row of data) {
        const key = typeof row.unit_key === 'string' ? row.unit_key.trim() : '';
        if (!key || row.do_not_use === true || seen.has(key)) continue;
        seen.set(key, {id: key, name: key});
      }
      if (data.length < 1000) break;
    }
    return [...seen.values()];
  },

  readExistingLinks: async () => {
    const db = service();
    const {data, error} = await db.schema('app_private').from('cos_mhelp_unit_link')
      .select('unit_key, mhelp_product_id');
    if (error) throw Error('Read unavailable');
    return {
      unitKeys: (data || []).map(row => String(row.unit_key)),
      productIds: (data || []).map(row => String(row.mhelp_product_id)),
    };
  },

  applyLinks: async links => {
    const db = service();
    let unitsLinked = 0, cameraRowsWritten = 0;
    for (const link of links) {
      // The link is recorded first and only once. A unit that somehow gained a
      // link between the plan and here is left alone, and its camera rows with it.
      const {data: recorded, error: recordError} = await db.schema('app_private').from('cos_mhelp_unit_link')
        .insert({
          unit_key: link.unitKey, mhelp_product_id: link.productId, mhelp_label: link.mhelpName,
          decided_by: 'auto_link',
          agreement: {
            key: link.key, cosName: link.cosName, cosVariant: link.cosVariant,
            mhelpVariant: link.mhelpVariant, reader: 'mhelpUnitIdentity, model suffix ignored',
          },
        })
        .select('unit_key');
      if (recordError || !recorded || !recorded.length) continue;
      unitsLinked += 1;
      // Only mhelp_product_id, only on rows that have none, only for this unit.
      const {data: written, error: writeError} = await db.from('camera_devices')
        .update({mhelp_product_id: link.productId})
        .eq('unit_key', link.unitKey).is('mhelp_product_id', null)
        .select('id');
      if (writeError) throw Error('Write unavailable');
      cameraRowsWritten += (written || []).length;
    }
    return {unitsLinked, cameraRowsWritten};
  },
}));
