export type DirectoryKind = 'Customers' | 'Sites' | 'Equipment';
export type Row = Record<string, any>;
export type Client = { get: (path: string) => Promise<{data: any}>; post: (path: string, body: unknown) => Promise<{data: any}> };
export const equipmentStatuses: ReadonlyArray<string>;
export const directoryKinds: ReadonlyArray<DirectoryKind>;
export function definition(kind: DirectoryKind): {endpoint: string; title: string; primary: string; fields: string[]; required: string[]};
export function records(data: any, label?: string, primary?: string): Row[];
export function equipmentSnapshot(data: any): {items: Row[]; models: Row[]};
export function teamRecords(data: any): Row[];
export function payloadFor(kind: DirectoryKind, draft: Row): Record<string,string>;
export function matchesPayload(row: Row | undefined, payload: Record<string,string>): boolean;
export class DirectorySaveError extends Error { phase: 'rejected' | 'uncertain'; recordId: string | null; }
export function saveDirectory(client: Client, kind: DirectoryKind, draft: Row): Promise<{record: Row; data: any}>;
export function searchRecords(items: Row[], query: string, fields: string[]): Row[];
export function teamJobCount(member: Row, jobs: Row[]): number;
