function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export async function pushToBuffer(sessionId: string, content: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/buffer-write', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ content: toBase64Utf8(content), enc: 'b64' }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `buffer-write network error: ${msg}. Likely WAF / corp proxy / browser extension blocking the request.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`buffer-write failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function clearBuffer(sessionId: string): Promise<void> {
  const res = await fetch('/api/buffer-clear', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${sessionId}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`buffer-clear failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
}
