import {
  bufferStore,
  corsHeaders,
  emptyCommandState,
  etagFor,
  isExpired,
  isLegacyCommandState,
  jsonResponse,
  readSession,
  serializeCommandState,
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

  let state: CommandState;
  if (!existing || isExpired(existing) || isLegacyCommandState(existing)) {
    if (existing) await store.delete(key);
    state = emptyCommandState();
  } else {
    state = existing;
  }

  const etag = etagFor(state);
  const ifNoneMatch = req.headers.get('if-none-match');
  const isNotModified =
    ifNoneMatch?.split(',').some((candidate) => candidate.trim() === etag) ?? false;

  if (isNotModified) {
    return new Response(null, {
      status: 304,
      headers: corsHeaders({ etag }),
    });
  }

  return jsonResponse(200, serializeCommandState(state), { etag });
};

export const config = { path: '/api/cmd-read' };
