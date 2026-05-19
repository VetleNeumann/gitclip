import {
  appendCommandEntry,
  bufferStore,
  emptyCommandState,
  isCommandShell,
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

  let payload: { content?: unknown; enc?: unknown; shell?: unknown };
  try {
    payload = (await req.json()) as { content?: unknown; enc?: unknown; shell?: unknown };
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  if (typeof payload.content !== 'string')
    return jsonResponse(400, { error: 'body.content must be a string' });
  if (!isCommandShell(payload.shell))
    return jsonResponse(400, { error: "body.shell must be 'bash' or 'pwsh'" });

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

  const entry = appendCommandEntry(state, { shell: payload.shell, script }, now);
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
