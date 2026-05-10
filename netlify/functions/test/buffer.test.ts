import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory mock of Netlify Blobs.
const store = new Map<string, unknown>();
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    async get(key: string, opts: { type?: string }) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (opts.type === 'json') return v;
      return JSON.stringify(v);
    },
    async setJSON(key: string, value: unknown) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  }),
}));

const { default: writeHandler } = await import('../buffer-write.js');
const { default: readHandler } = await import('../buffer-read.js');
const { default: clearHandler } = await import('../buffer-clear.js');

const SESSION = 'abcdefghijklmnop1234'; // 20 chars, matches /^[A-Za-z0-9_-]{16,64}$/

function req(method: string, path: string, body?: unknown, session: string | null = SESSION): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session) headers.authorization = `Bearer ${session}`;
  return new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => store.clear());

describe('buffer-write', () => {
  it('rejects without bearer', async () => {
    const r = await writeHandler(req('POST', '/api/buffer-write', { content: 'hi' }, null));
    expect(r.status).toBe(401);
  });

  it('rejects malformed session', async () => {
    const r = await writeHandler(req('POST', '/api/buffer-write', { content: 'hi' }, 'short'));
    expect(r.status).toBe(400);
  });

  it('rejects empty / non-string content', async () => {
    expect((await writeHandler(req('POST', '/api/buffer-write', { content: '' }))).status).toBe(400);
    expect((await writeHandler(req('POST', '/api/buffer-write', {}))).status).toBe(400);
    expect((await writeHandler(req('POST', '/api/buffer-write', { content: 123 }))).status).toBe(400);
  });

  it('decodes base64 content when enc=b64 and stores plaintext', async () => {
    const plain = 'PS C:\\ws> whoami\nkda\\vetlean';
    const b64 = Buffer.from(plain, 'utf8').toString('base64');
    const r = await writeHandler(req('POST', '/api/buffer-write', { content: b64, enc: 'b64' }));
    expect(r.status).toBe(200);
    const read = await readHandler(req('GET', '/api/buffer-read'));
    const body = (await read.json()) as { entries: { text: string }[] };
    expect(body.entries[0]!.text).toBe(plain);
  });

  it('appends entries and reports counts', async () => {
    const r1 = await writeHandler(req('POST', '/api/buffer-write', { content: 'first' }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ ok: true, entryCount: 1 });

    const r2 = await writeHandler(req('POST', '/api/buffer-write', { content: 'second' }));
    expect((await r2.json()).entryCount).toBe(2);
  });
});

describe('buffer-read', () => {
  it('returns empty when nothing stored', async () => {
    const r = await readHandler(req('GET', '/api/buffer-read'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ entries: [], cleared: false });
  });

  it('returns entries and clears the buffer atomically', async () => {
    await writeHandler(req('POST', '/api/buffer-write', { content: 'log line A' }));
    await writeHandler(req('POST', '/api/buffer-write', { content: 'log line B' }));

    const r = await readHandler(req('GET', '/api/buffer-read'));
    const body = (await r.json()) as { entries: { text: string }[]; cleared: boolean };
    expect(body.cleared).toBe(true);
    expect(body.entries.map((e) => e.text)).toEqual(['log line A', 'log line B']);

    // Second read returns empty (buffer was cleared).
    const r2 = await readHandler(req('GET', '/api/buffer-read'));
    expect(await r2.json()).toEqual({ entries: [], cleared: false });
  });
});

describe('buffer-clear', () => {
  it('clears without reading', async () => {
    await writeHandler(req('POST', '/api/buffer-write', { content: 'x' }));
    const r = await clearHandler(req('DELETE', '/api/buffer-clear'));
    expect(r.status).toBe(200);
    const after = await readHandler(req('GET', '/api/buffer-read'));
    expect(((await after.json()) as { entries: unknown[] }).entries).toEqual([]);
  });
});
