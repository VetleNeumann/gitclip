export async function pushToBuffer(sessionId: string, content: string): Promise<void> {
  const res = await fetch('/api/buffer-write', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({ content }),
  });
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
