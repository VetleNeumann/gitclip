import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandEntryLabel, readCommandQueue, type CommandEntry } from '../src/lib/commandQueue';

function entry(partial: Partial<CommandEntry>): CommandEntry {
  return { id: 'x', at: 0, kind: 'bash', script: '', ...partial };
}

describe('commandEntryLabel', () => {
  it('shows the bare kind for shell commands', () => {
    expect(commandEntryLabel(entry({ kind: 'bash' }))).toBe('bash');
    expect(commandEntryLabel(entry({ kind: 'pwsh' }))).toBe('pwsh');
  });

  it('appends the hint for snippets', () => {
    expect(commandEntryLabel(entry({ kind: 'snippet', hint: 'psql query' }))).toBe('snippet · psql query');
  });

  it('shows bare snippet when no hint', () => {
    expect(commandEntryLabel(entry({ kind: 'snippet' }))).toBe('snippet');
  });
});

describe('readCommandQueue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends If-None-Match and treats 304 as not-modified', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { etag: 'W/"100-1"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await readCommandQueue('abcdefghijklmnop1234', 'W/"90-1"');

    expect(fetchMock).toHaveBeenCalledWith('/api/cmd-read', {
      method: 'GET',
      headers: {
        authorization: 'Bearer abcdefghijklmnop1234',
        'if-none-match': 'W/"90-1"',
      },
    });
    expect(result).toEqual({
      state: null,
      etag: 'W/"100-1"',
      notModified: true,
    });
  });

  it('returns state and ETag on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [],
          createdAt: 100,
          updatedAt: 100,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'W/"100-0"',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await readCommandQueue('abcdefghijklmnop1234');

    expect(fetchMock).toHaveBeenCalledWith('/api/cmd-read', {
      method: 'GET',
      headers: {
        authorization: 'Bearer abcdefghijklmnop1234',
      },
    });
    expect(result.notModified).toBe(false);
    expect(result.etag).toBe('W/"100-0"');
    expect(result.state).toEqual({
      entries: [],
      createdAt: 100,
      updatedAt: 100,
    });
  });
});
