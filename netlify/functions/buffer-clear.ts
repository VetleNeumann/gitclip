import { bufferStore, jsonResponse, readSession } from './_lib.js';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'DELETE' && req.method !== 'POST')
    return jsonResponse(405, { error: 'DELETE (or POST) only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  await bufferStore().delete(session);
  return jsonResponse(200, { ok: true });
};

export const config = { path: '/api/buffer-clear' };
