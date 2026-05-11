import {
  bufferStore,
  dismissCommandEntryById,
  isExpired,
  jsonResponse,
  readSession,
  serializeCommandState,
  UUID_RE,
  type CommandState,
} from './_lib.js';

const CMD_SUFFIX = ':cmd';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'DELETE') return jsonResponse(405, { error: 'DELETE only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonResponse(400, { error: 'query id is required' });
  if (!UUID_RE.test(id)) return jsonResponse(400, { error: 'query id must be a UUID' });

  const key = `${session}${CMD_SUFFIX}`;
  const store = bufferStore();
  const existing = (await store.get(key, { type: 'json' })) as CommandState | null;

  if (!existing || isExpired(existing)) {
    if (existing) await store.delete(key);
    return jsonResponse(404, { error: 'command id not found' });
  }

  if (!dismissCommandEntryById(existing, id)) return jsonResponse(404, { error: 'command id not found' });
  await store.setJSON(key, existing);

  return jsonResponse(200, serializeCommandState(existing));
};

export const config = { path: '/api/cmd-dismiss' };
