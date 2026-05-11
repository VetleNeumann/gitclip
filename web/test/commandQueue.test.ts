import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCommandQueue } from '../src/lib/commandQueue';

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
