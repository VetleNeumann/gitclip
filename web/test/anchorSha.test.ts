import { describe, it, expect } from 'vitest';
import { parseAnchorSha } from '../src/lib/anchorSha';

describe('parseAnchorSha', () => {
  it('accepts a 40-character lowercase sha and returns it unchanged', () => {
    const sha = '4a8b1111f50152343d7b9c22cc977da215526e6e';
    const result = parseAnchorSha(sha);
    expect(result).toEqual({ ok: true, sha });
  });

  it('accepts a 7-character abbreviated sha', () => {
    const result = parseAnchorSha('68d60cc');
    expect(result).toEqual({ ok: true, sha: '68d60cc' });
  });

  it('trims surrounding whitespace and newlines', () => {
    const result = parseAnchorSha('  68d60cc\n');
    expect(result).toEqual({ ok: true, sha: '68d60cc' });
  });

  it('lowercases uppercase input', () => {
    const result = parseAnchorSha('68D60CC');
    expect(result).toEqual({ ok: true, sha: '68d60cc' });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseAnchorSha('')).toEqual({ ok: false, reason: expect.any(String) });
    expect(parseAnchorSha('   \n\t')).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('rejects input containing non-hex characters', () => {
    expect(parseAnchorSha('68d60czz')).toEqual({ ok: false, reason: expect.any(String) });
    expect(parseAnchorSha('68d60cc xyz123')).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('rejects input shorter than 7 characters', () => {
    expect(parseAnchorSha('abc123')).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('rejects input longer than 40 characters', () => {
    const tooLong = 'a'.repeat(41);
    expect(parseAnchorSha(tooLong)).toEqual({ ok: false, reason: expect.any(String) });
  });
});
