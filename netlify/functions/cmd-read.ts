import {
  bufferStore,
  emptyCommandState,
  isExpired,
  jsonResponse,
  readSession,
  type CommandState,
} from './_lib.js';

const CMD_SUFFIX = ':cmd';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'GET' && req.method !== 'POST')
    return jsonResponse(405, { error: 'GET (or POST) only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  const key = `${session}${CMD_SUFFIX}`;
  const store = bufferStore();
  const existing = (await store.get(key, { type: 'json' })) as CommandState | null;

  if (!existing || isExpired(existing)) {
    if (existing) await store.delete(key);
    const empty = emptyCommandState();
    return jsonResponse(200, {
      entries: [],
      createdAt: empty.createdAt,
      updatedAt: empty.updatedAt,
    });
  }

  return jsonResponse(200, {
    entries: existing.entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      shell: entry.shell,
      script: entry.script,
    })),
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  });
};

export const config = { path: '/api/cmd-read' };
