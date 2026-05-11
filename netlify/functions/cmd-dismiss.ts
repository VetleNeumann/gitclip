import {
  bufferStore,
  isExpired,
  jsonResponse,
  readSession,
  UUID_RE,
  type CommandState,
} from './_lib.js';

const CMD_SUFFIX = ':cmd';

function serialize(state: CommandState) {
  return {
    entries: state.entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      shell: entry.shell,
      script: entry.script,
    })),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

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

  const idx = existing.entries.findIndex((entry) => entry.id === id);
  if (idx < 0) return jsonResponse(404, { error: 'command id not found' });

  existing.entries.splice(idx, 1);
  const now = Date.now();
  existing.updatedAt = now > existing.updatedAt ? now : existing.updatedAt + 1;
  await store.setJSON(key, existing);

  return jsonResponse(200, serialize(existing));
};

export const config = { path: '/api/cmd-dismiss' };
