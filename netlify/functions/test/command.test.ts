import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendCommandEntry,
  clearCommandEntries,
  dismissCommandEntryById,
  etagFor,
  emptyCommandState,
  MAX_TOTAL_BYTES,
  MAX_WRITE_BYTES,
  SESSION_TTL_MS,
  totalCommandBytes,
  trimCommandToCap,
  UUID_RE,
  type CommandState,
} from '../_lib.js';

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

const { default: writeHandler } = await import('../cmd-write.js');
const { default: readHandler } = await import('../cmd-read.js');
const { default: dismissHandler } = await import('../cmd-dismiss.js');
const { default: clearAllHandler } = await import('../cmd-clear-all.js');

const SESSION = 'abcdefghijklmnop1234';

function req(method: string, path: string, body?: unknown, session: string | null = SESSION): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session) headers.authorization = `Bearer ${session}`;
  return new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function toB64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

beforeEach(() => {
  store.clear();
  vi.useRealTimers();
});

describe('command state helpers', () => {
  it('appends command entries with UUID ids and tracks totals', () => {
    const state = emptyCommandState(1000);
    const first = appendCommandEntry(state, { shell: 'bash', script: 'echo one' }, 1100);
    const second = appendCommandEntry(state, { shell: 'pwsh', script: 'Get-Process' }, 1200);

    expect(first.id).toMatch(UUID_RE);
    expect(second.id).toMatch(UUID_RE);
    expect(state.entries.map((entry) => entry.script)).toEqual(['echo one', 'Get-Process']);
    expect(state.updatedAt).toBe(1200);
    expect(totalCommandBytes(state)).toBe('echo one'.length + 'Get-Process'.length);
  });

  it('trims FIFO when over the cap', () => {
    const state: CommandState = {
      createdAt: 0,
      updatedAt: 0,
      entries: [
        { id: 'a', at: 1, shell: 'bash', script: 'A' },
        { id: 'b', at: 2, shell: 'bash', script: 'B' },
        { id: 'c', at: 3, shell: 'bash', script: 'C' },
      ],
    };
    trimCommandToCap(state, 2);
    expect(state.entries.map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('etagFor stays stable on no-op and changes across write/dismiss/clear', () => {
    const state = emptyCommandState(1000);

    const initial = etagFor(state);
    expect(etagFor(state)).toBe(initial);

    const first = appendCommandEntry(state, { shell: 'bash', script: 'echo one' }, 1100);
    const afterWrite = etagFor(state);
    expect(afterWrite).not.toBe(initial);

    const dismissed = dismissCommandEntryById(state, first.id, 1200);
    expect(dismissed).toBe(true);
    const afterDismiss = etagFor(state);
    expect(afterDismiss).not.toBe(afterWrite);

    appendCommandEntry(state, { shell: 'pwsh', script: 'Get-Date' }, 1300);
    const beforeClear = etagFor(state);
    clearCommandEntries(state, 1400);
    expect(state.entries).toEqual([]);
    expect(etagFor(state)).not.toBe(beforeClear);
  });
});

describe('cmd-write', () => {
  it('rejects without bearer', async () => {
    const r = await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo hi'), enc: 'b64', shell: 'bash' }, null));
    expect(r.status).toBe(401);
  });

  it('rejects malformed session', async () => {
    const r = await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo hi'), enc: 'b64', shell: 'bash' }, 'short'));
    expect(r.status).toBe(400);
  });

  it('rejects oversized command payloads', async () => {
    const oversized = 'x'.repeat(MAX_WRITE_BYTES + 1);
    const r = await writeHandler(req('POST', '/api/cmd-write', { content: toB64(oversized), enc: 'b64', shell: 'bash' }));
    expect(r.status).toBe(413);
  });

  it('persists UUID entries and enforces FIFO cap', async () => {
    const chunkSize = 250 * 1024;

    for (let i = 0; i < 5; i++) {
      const script = `${i}:${'x'.repeat(chunkSize - 2)}`;
      const r = await writeHandler(req('POST', '/api/cmd-write', { content: toB64(script), enc: 'b64', shell: 'bash' }));
      expect(r.status).toBe(200);
      const body = (await r.json()) as { id: string };
      expect(body.id).toMatch(UUID_RE);
    }

    const read = await readHandler(req('GET', '/api/cmd-read'));
    expect(read.status).toBe(200);
    const body = (await read.json()) as { entries: { id: string; script: string }[] };
    expect(body.entries).toHaveLength(4);
    expect(body.entries[0]!.script.startsWith('1:')).toBe(true);
    expect(body.entries[3]!.script.startsWith('4:')).toBe(true);
    for (const entry of body.entries) {
      expect(entry.id).toMatch(UUID_RE);
    }
    const total = body.entries.reduce((n, entry) => n + entry.script.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});

describe('cmd-read', () => {
  it('is non-destructive across repeated reads', async () => {
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo first'), enc: 'b64', shell: 'bash' }));
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo second'), enc: 'b64', shell: 'pwsh' }));

    const r1 = await readHandler(req('GET', '/api/cmd-read'));
    expect(r1.headers.get('etag')).toBeTruthy();
    const body1 = (await r1.json()) as { entries: { shell: string; script: string }[] };

    const r2 = await readHandler(req('GET', '/api/cmd-read'));
    expect(r2.headers.get('etag')).toBeTruthy();
    const body2 = (await r2.json()) as { entries: { shell: string; script: string }[] };

    expect(body1.entries).toEqual([
      { shell: 'bash', script: 'echo first', id: expect.any(String), at: expect.any(Number) },
      { shell: 'pwsh', script: 'echo second', id: expect.any(String), at: expect.any(Number) },
    ]);
    expect(body2.entries).toEqual(body1.entries);
  });

  it('returns 304 with no body on matching If-None-Match', async () => {
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo first'), enc: 'b64', shell: 'bash' }));

    const firstRead = await readHandler(req('GET', '/api/cmd-read'));
    expect(firstRead.status).toBe(200);
    const etag = firstRead.headers.get('etag');
    expect(etag).toBeTruthy();

    const secondRead = await readHandler(
      new Request('http://x/api/cmd-read', {
        method: 'GET',
        headers: {
          authorization: `Bearer ${SESSION}`,
          'if-none-match': etag!,
        },
      }),
    );
    expect(secondRead.status).toBe(304);
    expect(secondRead.headers.get('etag')).toBe(etag);
    expect(await secondRead.text()).toBe('');
  });

  it('treats stale queue data as expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo stale'), enc: 'b64', shell: 'bash' }));

    vi.setSystemTime(SESSION_TTL_MS + 1);
    const read = await readHandler(req('GET', '/api/cmd-read'));
    const body = (await read.json()) as { entries: unknown[] };

    expect(body.entries).toEqual([]);
  });
});

describe('cmd-dismiss', () => {
  it('dismisses one entry and keeps siblings intact', async () => {
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo first'), enc: 'b64', shell: 'bash' }));
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo second'), enc: 'b64', shell: 'pwsh' }));
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo third'), enc: 'b64', shell: 'bash' }));

    const before = await readHandler(req('GET', '/api/cmd-read'));
    const beforeBody = (await before.json()) as {
      entries: { id: string; at: number; shell: string; script: string }[];
      updatedAt: number;
    };
    const [first, second, third] = beforeBody.entries;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(third).toBeTruthy();

    const dismissed = await dismissHandler(req('DELETE', `/api/cmd-dismiss?id=${second!.id}`));
    expect(dismissed.status).toBe(200);
    const dismissedBody = (await dismissed.json()) as {
      entries: { id: string; at: number; shell: string; script: string }[];
      updatedAt: number;
    };
    expect(dismissedBody.entries).toEqual([first, third]);
    expect(dismissedBody.updatedAt).toBeGreaterThan(beforeBody.updatedAt);

    const after = await readHandler(req('GET', '/api/cmd-read'));
    const afterBody = (await after.json()) as { entries: { id: string }[] };
    expect(afterBody.entries.map((entry) => entry.id)).toEqual([first!.id, third!.id]);
  });

  it('rejects missing id query', async () => {
    const r = await dismissHandler(req('DELETE', '/api/cmd-dismiss'));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('query id is required');
  });

  it('rejects malformed id query', async () => {
    const r = await dismissHandler(req('DELETE', '/api/cmd-dismiss?id=not-a-uuid'));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('query id must be a UUID');
  });

  it('returns 404 when id is not in queue', async () => {
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo hi'), enc: 'b64', shell: 'bash' }));
    const missing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const r = await dismissHandler(req('DELETE', `/api/cmd-dismiss?id=${missing}`));
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('command id not found');
  });
});

describe('cmd-clear-all', () => {
  it('deletes all entries and cmd-read returns empty', async () => {
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo one'), enc: 'b64', shell: 'bash' }));
    await writeHandler(req('POST', '/api/cmd-write', { content: toB64('echo two'), enc: 'b64', shell: 'pwsh' }));

    const cleared = await clearAllHandler(req('DELETE', '/api/cmd-clear-all'));
    expect(cleared.status).toBe(200);

    const read = await readHandler(req('GET', '/api/cmd-read'));
    const body = (await read.json()) as { entries: unknown[] };
    expect(body.entries).toEqual([]);
  });

  it('returns success when the queue is already empty', async () => {
    const r = await clearAllHandler(req('DELETE', '/api/cmd-clear-all'));
    expect(r.status).toBe(200);
  });

  it('rejects missing and malformed bearer sessions', async () => {
    const missing = await clearAllHandler(req('DELETE', '/api/cmd-clear-all', undefined, null));
    expect(missing.status).toBe(401);

    const malformed = await clearAllHandler(req('DELETE', '/api/cmd-clear-all', undefined, 'short'));
    expect(malformed.status).toBe(400);
  });
});
