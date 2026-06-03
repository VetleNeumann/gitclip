import {
  appendCommandEntry,
  bufferStore,
  emptyCommandState,
  isCommandKind,
  isExpired,
  jsonResponse,
  MAX_TOTAL_BYTES,
  MAX_WRITE_BYTES,
  readSession,
  totalCommandBytes,
  trimCommandToCap,
  type CommandState,
} from './_lib.js';

const CMD_SUFFIX = ':cmd';

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(204, null);
  if (req.method !== 'POST') return jsonResponse(405, { error: 'POST only' });

  const session = readSession(req);
  if (session instanceof Response) return session;

  let payload: { content?: unknown; enc?: unknown; kind?: unknown; hint?: unknown };
  try {
    payload = (await req.json()) as { content?: unknown; enc?: unknown; kind?: unknown; hint?: unknown };
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  if (typeof payload.content !== 'string')
    return jsonResponse(400, { error: 'body.content must be a string' });
  if (!isCommandKind(payload.kind))
    return jsonResponse(400, { error: "body.kind must be 'bash', 'pwsh', or 'snippet'" });
  if (payload.hint !== undefined && typeof payload.hint !== 'string')
    return jsonResponse(400, { error: 'body.hint must be a string' });

  let script: string;
  if (payload.enc === 'b64') {
    try {
      script = Buffer.from(payload.content, 'base64').toString('utf8');
    } catch {
      return jsonResponse(400, { error: 'body.content not valid base64' });
    }
  } else {
    script = payload.content;
  }

  script = script.trim();

  if (script.length === 0)
    return jsonResponse(400, { error: 'body.content must be non-empty' });
  if (script.length > MAX_WRITE_BYTES) {
    return jsonResponse(413, {
      error: `body.content exceeds ${MAX_WRITE_BYTES} byte cap`,
    });
  }

  const key = `${session}${CMD_SUFFIX}`;
  const store = bufferStore();
  const existing = (await store.get(key, { type: 'json' })) as CommandState | null;

  const now = Date.now();
  const state = !existing || isExpired(existing, now) ? emptyCommandState(now) : existing;

  const hint = payload.kind === 'snippet' ? (payload.hint as string | undefined) : undefined;
  const entry = appendCommandEntry(state, { kind: payload.kind, script, hint }, now);
  trimCommandToCap(state, MAX_TOTAL_BYTES);
  await store.setJSON(key, state);

  return jsonResponse(200, {
    ok: true,
    id: entry.id,
    pendingCount: state.entries.length,
    totalBytes: totalCommandBytes(state),
  });
};

export const config = { path: '/api/cmd-write' };
