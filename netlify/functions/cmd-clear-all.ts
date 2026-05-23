import { bufferStore, jsonResponse, readSession } from './_lib.js';

const CMD_SUFFIX = ':cmd';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'DELETE') return jsonResponse(405, { error: 'DELETE only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  const store = bufferStore();
  await store.delete(`${session}${CMD_SUFFIX}`);

  return jsonResponse(200, { ok: true });
};

export const config = { path: '/api/cmd-clear-all' };
