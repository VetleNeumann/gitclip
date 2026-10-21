import { createHash } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getExecutableBit, getFileContent } from '../src/lib/github';

const REF = { owner: 'acme', repo: 'widgets' };
const HEAD = 'c'.repeat(40);
const BLOB_SHA = '436f4549ac4564a280ed8241efccbce31e215eea';

/** The sha git gives `content` as a blob — what a compare entry carries. */
function blobSha(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function raw(body: BodyInit, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' },
  });
}

function acceptOf(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.accept;
}

const HELLO_SHA = blobSha('hello\n');
const FROM_BLOB_SHA = blobSha('from blob');

describe('getFileContent', () => {
  it('reads the contents API with the raw media type, never the base64 JSON envelope', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => raw('hello\n'));
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await getFileContent(REF, 'a.txt', HEAD, HELLO_SHA);

    expect(new TextDecoder().decode(bytes)).toBe('hello\n');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain(`/contents/a.txt?ref=${HEAD}`);
    expect(acceptOf(fetchMock.mock.calls[0]![1])).toBe('application/vnd.github.raw');
  });

  it('bypasses every HTTP cache', async () => {
    // GitHub marks these responses cacheable for a day, and a cache that
    // ignores `Vary: Accept` answered raw requests with the JSON envelope it
    // had stored for the same URL.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => raw('hello\n'));
    vi.stubGlobal('fetch', fetchMock);

    await getFileContent(REF, 'a.txt', HEAD, HELLO_SHA);

    expect(fetchMock.mock.calls[0]![1]?.cache).toBe('no-store');
  });

  it('rejects bytes that do not hash to the compare entry blob sha', async () => {
    const envelope = JSON.stringify({ name: 'a.txt', path: 'a.txt', content: 'aGVsbG8K' }, null, 2);
    vi.stubGlobal('fetch', vi.fn(async () => raw(envelope)));

    await expect(getFileContent(REF, 'a.txt', HEAD, HELLO_SHA)).rejects.toThrow(
      `a.txt at ${HEAD}: got blob ${blobSha(envelope)}, expected ${HELLO_SHA}`,
    );
  });

  it('returns unverified bytes when the compare entry carries no blob sha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => raw('hello\n')));

    const bytes = await getFileContent(REF, 'a.txt', HEAD, null);

    expect(new TextDecoder().decode(bytes)).toBe('hello\n');
  });

  it('returns binary bytes unaltered', async () => {
    const every = Uint8Array.from({ length: 256 }, (_, i) => i);
    vi.stubGlobal('fetch', vi.fn(async () => raw(every)));

    const bytes = await getFileContent(REF, 'blob.bin', HEAD, blobSha(every));

    expect([...bytes]).toEqual([...every]);
  });

  it('falls back to the raw blob on a 403 from the contents API', async () => {
    const calls: [string, string | undefined][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, acceptOf(init)]);
        if (url.includes('/contents/')) return json({ message: 'too large' }, 403);
        return raw('from blob');
      }),
    );

    const bytes = await getFileContent(REF, 'big.bin', HEAD, FROM_BLOB_SHA);

    expect(new TextDecoder().decode(bytes)).toBe('from blob');
    expect(calls[1]).toEqual([
      expect.stringContaining(`/git/blobs/${FROM_BLOB_SHA}`),
      'application/vnd.github.raw',
    ]);
  });

  it('falls back to the raw blob when the contents fetch dies at the network layer', async () => {
    // What an inspecting proxy that cuts the response mid-body looks like from
    // the page: fetch rejects with a bare TypeError.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/contents/')) throw new TypeError('Failed to fetch');
        return raw('from blob');
      }),
    );

    const bytes = await getFileContent(REF, 'a.ps1', HEAD, FROM_BLOB_SHA);

    expect(new TextDecoder().decode(bytes)).toBe('from blob');
  });

  it('throws when the contents API fails and the compare entry carries no blob sha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'not found' }, 404)),
    );

    await expect(getFileContent(REF, 'gone.bin', HEAD, undefined)).rejects.toThrow(
      `cannot fetch gone.bin at ${HEAD} (no blob sha for fallback)`,
    );
  });

  it('rethrows a contents API error that a fallback cannot cure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'boom' }, 500)),
    );

    await expect(getFileContent(REF, 'a.txt', HEAD, BLOB_SHA)).rejects.toThrow(/^500 /);
  });
});

describe('getExecutableBit', () => {
  it('reads an executable nested path from its parent tree', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return json({
        tree: [
          { path: 'README.md', mode: '100644', type: 'blob' },
          { path: 'tailwindcss-linux-x64', mode: '100755', type: 'blob' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const executable = await getExecutableBit(
      REF,
      HEAD,
      'scripts/bootstrap/tailwind/tailwindcss-linux-x64',
    );

    expect(executable).toBe(true);
    expect(urls[0]).toContain(`/git/trees/${HEAD}:scripts/bootstrap/tailwind`);
  });

  it('reads a non-executable root-level path from the root tree', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return json({ tree: [{ path: 'notes.md', mode: '100644', type: 'blob' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getExecutableBit(REF, HEAD, 'notes.md')).toBe(false);
    expect(urls[0]!.endsWith(`/git/trees/${HEAD}`)).toBe(true);
  });

  it('throws on a mode chmod cannot express, rather than dropping the change', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ tree: [{ path: 'vendor', mode: '160000', type: 'commit' }] })),
    );

    await expect(getExecutableBit(REF, HEAD, 'vendor')).rejects.toThrow(
      `unsupported mode 160000 for vendor at ${HEAD}`,
    );
  });

  it('throws when the path is absent from the tree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ tree: [{ path: 'other.sh', mode: '100755', type: 'blob' }] })),
    );

    await expect(getExecutableBit(REF, HEAD, 'run.sh')).rejects.toThrow(
      `unsupported mode (absent) for run.sh at ${HEAD}`,
    );
  });

  it('names truncation as the cause when the tree listing was cut short', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ tree: [{ path: 'other.sh', mode: '100755', type: 'blob' }], truncated: true })),
    );

    await expect(getExecutableBit(REF, HEAD, 'big/run.sh')).rejects.toThrow(
      `cannot read mode of big/run.sh at ${HEAD} (tree listing was truncated)`,
    );
  });

  it('propagates a rate-limit failure instead of reporting an unknown mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'API rate limit exceeded' }, 403)),
    );

    await expect(getExecutableBit(REF, HEAD, 'a/run.sh')).rejects.toThrow(/rate limit exceeded/);
  });
});
