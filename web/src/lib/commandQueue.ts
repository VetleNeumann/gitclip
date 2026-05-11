export type CommandShell = 'bash' | 'pwsh';

export interface CommandEntry {
  id: string;
  at: number;
  shell: CommandShell;
  script: string;
}

export interface CommandQueueResponse {
  entries: CommandEntry[];
  createdAt: number;
  updatedAt: number;
}

export async function readCommandQueue(sessionId: string): Promise<CommandQueueResponse> {
  let res: Response;
  try {
    res = await fetch('/api/cmd-read', {
      method: 'GET',
      headers: { authorization: `Bearer ${sessionId}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cmd-read network error: ${msg}. Likely WAF / corp proxy / browser extension blocking the request.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cmd-read failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as CommandQueueResponse;
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
