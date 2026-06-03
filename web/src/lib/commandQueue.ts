export type CommandKind = 'bash' | 'pwsh' | 'snippet';

export interface CommandEntry {
  id: string;
  at: number;
  kind: CommandKind;
  script: string;
  hint?: string;
}

// Shell kinds self-describe; a snippet appends its hint so a full queue stays unambiguous.
export function commandEntryLabel(entry: CommandEntry): string {
  if (entry.kind === 'snippet' && entry.hint) return `snippet · ${entry.hint}`;
  return entry.kind;
}

export interface CommandQueueResponse {
  entries: CommandEntry[];
  createdAt: number;
  updatedAt: number;
}

const CLEAR_ALL_ENDPOINT = '/api/cmd-clear-all';
const CLEAR_ALL_OP = 'cmd-clear-all';

export interface CommandQueueReadResult {
  state: CommandQueueResponse | null;
  etag: string | null;
  notModified: boolean;
}

export async function readCommandQueue(
  sessionId: string,
  etag: string | null = null,
): Promise<CommandQueueReadResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${sessionId}` };
  if (etag) headers['if-none-match'] = etag;

  let res: Response;
  try {
    res = await fetch('/api/cmd-read', {
      method: 'GET',
      headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cmd-read network error: ${msg}. Likely WAF / corp proxy / browser extension blocking the request.`,
    );
  }
  const nextEtag = res.headers.get('etag');
  if (res.status === 304) {
    return {
      state: null,
      etag: nextEtag ?? etag,
      notModified: true,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cmd-read failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return {
    state: (await res.json()) as CommandQueueResponse,
    etag: nextEtag,
    notModified: false,
  };
}

export async function dismissCommandEntry(sessionId: string, id: string): Promise<CommandQueueResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/cmd-dismiss?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${sessionId}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cmd-dismiss network error: ${msg}. Likely WAF / corp proxy / browser extension blocking the request.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cmd-dismiss failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as CommandQueueResponse;
}

export async function clearCommandQueue(sessionId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(CLEAR_ALL_ENDPOINT, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${sessionId}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${CLEAR_ALL_OP} network error: ${msg}. Likely WAF / corp proxy / browser extension blocking the request.`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${CLEAR_ALL_OP} failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
}
