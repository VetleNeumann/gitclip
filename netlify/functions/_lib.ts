import { getStore } from '@netlify/blobs';

export const SESSION_RE = /^[a-zA-Z0-9_-]{16,64}$/;
export const MAX_WRITE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface BufferState {
  createdAt: number;
  updatedAt: number;
  entries: { at: number; text: string }[];
}

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      ...extraHeaders,
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

export function isExpired(state: BufferState, now = Date.now()): boolean {
  return now - state.createdAt > SESSION_TTL_MS;
}

export function emptyState(now = Date.now()): BufferState {
  return { createdAt: now, updatedAt: now, entries: [] };
}
