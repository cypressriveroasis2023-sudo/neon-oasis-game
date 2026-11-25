// My truck: reads and writes for the Service tech's own truck, extras and tech-to-tech moves.
// The server decides everything; this only talks to it and uploads photos.
export const BUCKET = 'techcheck-truck-moves';
export const TYPES = ['Sniper', 'Ranger', 'Spotter', 'Solar Spotter'];

export function truckClient(context) {
  const actor = context.getSession()?.user?.id, role = context.getRole();
  const current = () => {
    const p = context.getProfile();
    return Boolean(actor && context.getSession()?.user?.id === actor && context.getRole() === role && p?.user_id === actor && p.active === true && !p.archived_at);
  };
  const assert = () => { if (!current()) throw new Error('Your signed-in account changed. Close this and open My truck again.'); };
  const rpc = async (name, args = {}) => {
    assert();
    const {data, error} = await context.db.rpc(name, args);
    assert();
    if (error) throw new Error(error.message || 'That did not save. Check your signal and try again.');
    return shape(data);
  };
  async function upload(move, blobs) {
    const paths = [];
    for (const blob of blobs) {
      assert();
      const bytes = await blob.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      const path = actor + '/' + move + '/' + hash + '.jpg';
      const {error} = await context.db.storage.from(BUCKET).upload(path, blob, {contentType: 'image/jpeg', upsert: false});
      assert();
      if (error && String(error.statusCode) !== '409') throw new Error('A photo did not upload. Check your signal and tap again. Nothing was lost.');
      paths.push(path);
    }
    return paths;
  }
  return {
    actor, current, assert,
    read: () => rpc('truck_my_v1'),
    putFromIt: (type, tag) => rpc('truck_put_from_it_v1', {p_type: type, p_tag: tag}),
    async give({move, to, type, tag, photos, note}) {
      const paths = await upload(move, photos);
      return rpc('truck_give_v1', {p_move: move, p_to: to, p_type: type, p_tag: tag, p_photos: paths, p_note: note || ''});
    },
    cancel: move => rpc('truck_cancel_give_v1', {p_move: move}),
    refuse: (move, note) => rpc('truck_take_v1', {p_move: move, p_accept: false, p_checks: null, p_photos: [], p_signature: null, p_note: note}),
    async take({move, checks, photos, signature, note}) {
      const paths = await upload(move, photos);
      let sign = {method: 'typed', name: signature.typedName || ''};
      if (signature.method === 'drawn') sign = {method: 'drawn', path: (await upload(move, [signature.blob]))[0]};
      return rpc('truck_take_v1', {p_move: move, p_accept: true, p_checks: checks, p_photos: paths, p_signature: sign, p_note: note || ''});
    },
    async photoUrl(path) {
      assert();
      const {data, error} = await context.db.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) throw new Error('Photo not available.');
      return data.signedUrl;
    },
  };
}

// Keep only what the screens use, in a fixed shape.
const text = (v, max = 120) => typeof v === 'string' ? v.slice(0, max) : '';
const list = v => Array.isArray(v) ? v.slice(0, 200) : [];
const move = m => ({id: text(m?.id, 40), from: text(m?.from), fromId: text(m?.from_id, 40), to: text(m?.to), toId: text(m?.to_id, 40),
  type: text(m?.type, 30), tag: text(m?.tag, 40), state: text(m?.state, 20), note: text(m?.note, 500), takeNote: text(m?.take_note, 500),
  photos: list(m?.photos).filter(p => typeof p === 'string'), toPlace: text(m?.to_place, 10), sentAt: text(m?.sent_at, 40), decidedAt: text(m?.decided_at, 40)});
export function shape(d) {
  if (!d || typeof d !== 'object') throw new Error('My truck could not be read. Pull down to refresh.');
  return {
    me: {id: text(d.me?.id, 40), name: text(d.me?.name)},
    kinds: list(d.kinds).map(k => ({type: text(k.type, 30), required: Number(k.required) || 0, have: Number(k.have) || 0,
      slot: k.slot?.tag ? text(k.slot.tag, 40) : '', slotUsed: k.slot_used === true,
      extras: list(k.extras).map(x => ({id: text(x.id, 40), tag: text(x.tag, 40)}))})).filter(k => TYPES.includes(k.type)),
    coming: list(d.coming).map(move), sent: list(d.sent).map(move), recent: list(d.recent).map(move),
    fromIt: list(d.from_it).map(x => ({type: text(x.type, 30), tag: text(x.tag, 40), from: text(x.from)})),
    techs: list(d.techs).map(t => ({id: text(t.id, 40), name: text(t.name)})).filter(t => t.id),
  };
}
// Every unit on my truck, the slot first.
export const myUnits = data => data.kinds.flatMap(k => [...(k.slot ? [{type: k.type, tag: k.slot}] : []), ...k.extras.map(x => ({type: k.type, tag: x.tag, extra: true}))]);
