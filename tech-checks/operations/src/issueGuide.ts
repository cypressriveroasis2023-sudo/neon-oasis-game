import type {IssueKind, TodayAudience} from './todayIssues';

export type GuideControl = 'refresh' | 'notes' | 'readings' | 'photo' | 'link' | 'confirm-shop' | 'confirm-field' | 'mhelp' | 'retry-pin' | 'outcome';

export type GuideStep = { id: string; text: string; control: GuideControl; ownerOnly?: boolean };

const outcome: GuideStep = {id: 'outcome', text: 'Record the result.', control: 'outcome'};
const notes: GuideStep = {id: 'notes', text: 'Write what you found.', control: 'notes'};
const photo: GuideStep = {id: 'photo', text: 'Add a photo if you took one.', control: 'photo'};

const GUIDES: Record<IssueKind, GuideStep[]> = {
  outage: [
    {id: 'refresh', text: 'Refresh the reading. A camera is offline only when the last check says so.', control: 'refresh'},
    notes,
    photo,
    outcome,
  ],
  power: [
    {id: 'refresh', text: 'Refresh the power reading.', control: 'refresh'},
    {id: 'readings', text: 'Enter the voltage and charge you measured.', control: 'readings'},
    notes,
    outcome,
  ],
  placement: [
    {id: 'confirm-field', text: 'mHelp says this unit is in the field. Confirm that, or move it to Shop in COS. mHelp is not written.', control: 'confirm-field', ownerOnly: true},
    {id: 'confirm-shop', text: 'Move it to Shop only if it is really in the shop.', control: 'confirm-shop', ownerOnly: true},
    notes,
    outcome,
  ],
  device_link: [
    {id: 'link', text: 'Link the camera to this product. A matching name is not a link.', control: 'link', ownerOnly: true},
    notes,
    outcome,
  ],
  address: [
    {id: 'retry-pin', text: 'Try the map pin again. This does not change the address in mHelp.', control: 'retry-pin'},
    {id: 'mhelp', text: 'COS cannot change this address.', control: 'mhelp'},
    notes,
    outcome,
  ],
  no_reading: [
    {id: 'refresh', text: 'Refresh the reading. No reading is not the same as offline.', control: 'refresh'},
    notes,
    outcome,
  ],
};

export function issueGuide(kind: IssueKind, role: TodayAudience): GuideStep[] {
  return GUIDES[kind].filter(step => role === 'owner' || !step.ownerOnly);
}

export type GuideRecord = {
  notes: string;
  voltage: string;
  charge: string;
  photoName: string;
  outcome: '' | 'resolved' | 'broken' | 'escalate';
  pin: string;
};

export const emptyGuideRecord = (): GuideRecord => ({notes: '', voltage: '', charge: '', photoName: '', outcome: '', pin: ''});
