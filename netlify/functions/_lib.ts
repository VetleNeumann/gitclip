import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

export const SESSION_RE = /^[a-zA-Z0-9_-]{16,64}$/;
export const MAX_WRITE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface BufferState {
  createdAt: number;
  updatedAt: number;
  entries: { at: number; text: string }[];
}

export type CommandKind = 'bash' | 'pwsh' | 'snippet';

export interface CommandEntry {
  id: string;
  at: number;
  kind: CommandKind;
  script: string;
  hint?: string;
}

export interface CommandState {
  createdAt: number;
  updatedAt: number;
  entries: CommandEntry[];
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function corsHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    ...extraHeaders,
  };
}

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders(extraHeaders),
    },
  });
}

export function readSession(req: Request): string | Response {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return jsonResponse(401, { error: 'missing bearer token' });
  const token = m[1]!.trim();
  if (!SESSION_RE.test(token))
    return jsonResponse(400, { error: 'session id must be 16-64 chars [A-Za-z0-9_-]' });
  return token;
}

export function bufferStore() {
  return getStore({ name: 'gitclip-buffers', consistency: 'strong' });
}

export function totalBytes(state: BufferState): number {
  return state.entries.reduce((n, e) => n + e.text.length, 0);
}

export function trimToCap(state: BufferState, cap: number): void {
  while (state.entries.length > 1 && totalBytes(state) > cap) {
    state.entries.shift();
  }
}

export function totalCommandBytes(state: CommandState): number {
  return state.entries.reduce((n, e) => n + e.script.length, 0);
}

export function trimCommandToCap(state: CommandState, cap: number): void {
  while (state.entries.length > 1 && totalCommandBytes(state) > cap) {
    state.entries.shift();
  }
}

export function appendCommandEntry(
  state: CommandState,
  input: { kind: CommandKind; script: string; hint?: string },
  now = Date.now(),
): CommandEntry {
  const entry: CommandEntry = {
    id: randomUUID(),
    at: now,
    kind: input.kind,
    script: input.script,
  };
  if (input.kind === 'snippet' && input.hint !== undefined) entry.hint = input.hint;
  state.entries.push(entry);
  bumpUpdatedAt(state, now);
  return entry;
}

export function dismissCommandEntryById(state: CommandState, id: string, now = Date.now()): boolean {
  const idx = state.entries.findIndex((entry) => entry.id === id);
  if (idx < 0) return false;
  state.entries.splice(idx, 1);
  bumpUpdatedAt(state, now);
  return true;
}

export function clearCommandEntries(state: CommandState, now = Date.now()): void {
  if (state.entries.length === 0) return;
  state.entries = [];
  bumpUpdatedAt(state, now);
}

export function etagFor(state: Pick<CommandState, 'updatedAt' | 'entries'>): string {
  return `W/"${state.updatedAt}-${state.entries.length}"`;
}

export function serializeCommandState(state: CommandState) {
  return {
    entries: state.entries.map((entry) => {
      const out: { id: string; at: number; kind: CommandKind; script: string; hint?: string } = {
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        script: entry.script,
      };
      if (entry.hint !== undefined) out.hint = entry.hint;
      return out;
    }),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function bumpUpdatedAt(state: { updatedAt: number }, now = Date.now()): void {
  state.updatedAt = now > state.updatedAt ? now : state.updatedAt + 1;
}

export function isCommandKind(value: unknown): value is CommandKind {
  return value === 'bash' || value === 'pwsh' || value === 'snippet';
}

export function isExpired(state: { createdAt: number }, now = Date.now()): boolean {
  return now - state.createdAt > SESSION_TTL_MS;
}

// Pre-deploy entries carried a `shell` field and no `kind`. We wipe rather than
// migrate them — the queue is ephemeral (24h TTL) and a deploy clearing it is fine.
export function isLegacyCommandState(state: CommandState): boolean {
  return state.entries.some((entry) => !isCommandKind((entry as { kind?: unknown }).kind));
}

export function emptyState(now = Date.now()): BufferState {
  return { createdAt: now, updatedAt: now, entries: [] };
}

export function emptyCommandState(now = Date.now()): CommandState {
  return { createdAt: now, updatedAt: now, entries: [] };
}
