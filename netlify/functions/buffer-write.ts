import {
  bufferStore,
  emptyState,
  isExpired,
  jsonResponse,
  MAX_TOTAL_BYTES,
  MAX_WRITE_BYTES,
  readSession,
  totalBytes,
  trimToCap,
  type BufferState,
} from './_lib.js';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  let payload: { content?: unknown; enc?: unknown };
  try {
    payload = (await req.json()) as { content?: unknown; enc?: unknown };
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  if (typeof payload.content !== 'string')
    return jsonResponse(400, { error: 'body.content must be a string' });

  let content: string;
  if (payload.enc === 'b64') {
    try {
      content = Buffer.from(payload.content, 'base64').toString('utf8');
    } catch {
      return jsonResponse(400, { error: 'body.content not valid base64' });
    }
  } else {
    content = payload.content;
  }

  content = content.trim();

  if (content.length === 0)
    return jsonResponse(400, { error: 'body.content must be non-empty' });
  if (content.length > MAX_WRITE_BYTES)
    return jsonResponse(413, {
      error: `body.content exceeds ${MAX_WRITE_BYTES} byte cap`,
    });

  const store = bufferStore();
  const existing = (await store.get(session, { type: 'json' })) as BufferState | null;

  const now = Date.now();
  let state: BufferState;
  if (!existing || isExpired(existing, now)) {
    state = emptyState(now);
  } else {
    state = existing;
  }

  state.entries.push({ at: now, text: content });
  state.updatedAt = now;
  trimToCap(state, MAX_TOTAL_BYTES);

  await store.setJSON(session, state);

  return jsonResponse(200, {
    ok: true,
    entryCount: state.entries.length,
    totalBytes: totalBytes(state),
  });
};

export const config = { path: '/api/buffer-write' };
