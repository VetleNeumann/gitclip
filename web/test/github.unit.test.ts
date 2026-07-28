import { describe, it, expect, vi, afterEach } from 'vitest';
import { getExecutableBit, getFileContent } from '../src/lib/github';

const REF = { owner: 'acme', repo: 'widgets' };
const HEAD = 'c'.repeat(40);
const BLOB_SHA = '436f4549ac4564a280ed8241efccbce31e215eea';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getFileContent', () => {
  it('returns inline base64 content when the contents API inlines it', async () => {
    const fetchMock = vi.fn(async () =>
      json({ content: b64('hello\n'), encoding: 'base64', size: 6, sha: BLOB_SHA }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await getFileContent(REF, 'a.txt', HEAD, BLOB_SHA);

    expect(new TextDecoder().decode(bytes)).toBe('hello\n');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the blob sha carried by a 200 contents response with encoding "none"', async () => {
    // Files over 1 MB come back as HTTP 200 with an empty body and encoding
    // "none" — the response still carries the blob sha the blobs API needs.
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/contents/')) {
        return json({ content: '', encoding: 'none', size: 42_243_803, sha: BLOB_SHA });
      }
      return json({ content: b64('big payload'), encoding: 'base64' });
    });
    vi.stubGlobal('fetch', fetchMock);

    // No blob sha from the compare entry — a mode-only commit nulls it out.
    const bytes = await getFileContent(REF, 'big.bin', HEAD, undefined);

    expect(new TextDecoder().decode(bytes)).toBe('big payload');
    expect(urls[1]).toContain(`/git/blobs/${BLOB_SHA}`);
  });

  it('still falls back on a 403 from the contents API using the compare blob sha', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/contents/')) return json({ message: 'too large' }, 403);
      return json({ content: b64('from blob'), encoding: 'base64' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const bytes = await getFileContent(REF, 'big.bin', HEAD, BLOB_SHA);

    expect(new TextDecoder().decode(bytes)).toBe('from blob');
    expect(urls[1]).toContain(`/git/blobs/${BLOB_SHA}`);
  });

  it('throws when neither the compare entry nor the contents response yields a blob sha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'not found' }, 404)),
    );

    await expect(getFileContent(REF, 'gone.bin', HEAD, undefined)).rejects.toThrow(
      `cannot fetch gone.bin at ${HEAD} (no blob sha for fallback)`,
    );
  });

  it('rejects a blob response that is not base64', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/contents/')) {
          return json({ content: '', encoding: 'none', size: 2_000_000, sha: BLOB_SHA });
        }
        return json({ content: '', encoding: 'utf-8' });
      }),
    );

    await expect(getFileContent(REF, 'big.bin', HEAD, undefined)).rejects.toThrow(
      'unexpected blob encoding utf-8',
    );
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
