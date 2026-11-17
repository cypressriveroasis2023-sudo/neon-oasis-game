/** Same-person links already used by the fleet function. A changed role does not match. */

export type PowerAlarmLink = { actorId: string; role: 'owner' | 'it' | 'service'; write: boolean };

export const POWER_ALARM_LINKS: Record<string, PowerAlarmLink> = {
  'e4abc521-1ef3-45a6-9829-b87faff78210': { actorId: '3f073784-96e7-43d8-b9e0-33ab31c3c8b1', role: 'owner', write: true },
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc': { actorId: 'd0757b64-9623-4adc-afff-21cc7853e88a', role: 'it', write: true },
  'b7cc3cbf-d11e-4d4a-9742-c07701857911': { actorId: '3caf7c00-627f-445f-bce4-ddeae574ee5c', role: 'it', write: true },
  '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf': { actorId: 'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7', role: 'it', write: true },
  '78e54fbd-c2db-4d18-8e3d-a9740adcf285': { actorId: '7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', role: 'service', write: false },
  '49dce28e-099a-40bb-a8d8-b39f9ffbabee': { actorId: '1a7d3523-8a3c-488a-9216-4e37f4f7ecb9', role: 'service', write: false },
};

export function powerAlarmActor(profile: { id?: unknown; role?: unknown; active?: unknown }): { actorId: string; canWrite: boolean } | null {
  if (!profile || profile.active !== true || typeof profile.id !== 'string' || typeof profile.role !== 'string') return null;
  const link = POWER_ALARM_LINKS[profile.id.toLowerCase()];
  if (!link || link.role !== profile.role) return null;
  return { actorId: link.actorId, canWrite: link.write };
}
