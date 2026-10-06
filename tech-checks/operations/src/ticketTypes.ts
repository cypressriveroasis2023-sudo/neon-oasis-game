/** Presentation labels for the existing, server-supported COS job types. */
export const ticketTypes = [
  { value: 'SERVICE', label: 'Service', description: 'Service visit · optional IT shop prep' },
  { value: 'PICKUP', label: 'Pickup', description: 'Service pickup → IT intake' },
  { value: 'DELIVERY', label: 'Install / Delivery', description: 'IT prep → Service installation' },
  { value: 'SWAP', label: 'Swap', description: 'IT prep → Service swap → IT intake' },
] as const;
export type TicketType = typeof ticketTypes[number]['value'];
export const isTicketType = (value: unknown): value is TicketType => ticketTypes.some(type => type.value === value);
