import {
  bufferStore,
  isExpired,
  jsonResponse,
  readSession,
  type BufferState,
} from './_lib.js';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'GET' && req.method !== 'POST')
    return jsonResponse(405, { error: 'GET (or POST) only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  const store = bufferStore();
  const existing = (await store.get(session, { type: 'json' })) as BufferState | null;

  if (!existing || isExpired(existing) || existing.entries.length === 0) {
    return jsonResponse(200, { entries: [], cleared: false });
  }

  const entries = existing.entries.map((e) => ({ at: e.at, text: e.text }));
  await store.delete(session);

  return jsonResponse(200, {
    entries,
    cleared: true,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  });
};

export const config = { path: '/api/buffer-read' };
