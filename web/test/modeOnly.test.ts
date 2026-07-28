import { describe, it, expect } from 'vitest';
import { isModeOnlyChange, type CompareFile } from '../src/lib/github';

describe('isModeOnlyChange', () => {
  it('flags a mode-only change (no blob sha, zero line changes)', () => {
    const f: CompareFile = {
      filename: 'scripts/bootstrap/tailwind/tailwindcss-linux-x64',
      status: 'modified',
      sha: null,
      changes: 0,
    };
    expect(isModeOnlyChange(f)).toBe(true);
  });

  it('does not flag a normal content change', () => {
    const f: CompareFile = {
      filename: 'src/index.ts',
      status: 'modified',
      sha: 'a'.repeat(40),
      changes: 12,
    };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag an entry that has a blob sha but no reported line changes', () => {
    // Binary content edits report changes: 0 but still carry a blob sha — those
    // are real content changes and must still be transported.
    const f: CompareFile = {
      filename: 'assets/logo.png',
      status: 'modified',
      sha: 'b'.repeat(40),
      changes: 0,
    };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag a removal, even though removals carry no blob sha at head', () => {
    const f: CompareFile = { filename: 'gone.txt', status: 'removed', sha: null, changes: 0 };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag a rename, which still needs a delete of the previous path', () => {
    const f: CompareFile = {
      filename: 'new/name.sh',
      previous_filename: 'old/name.sh',
      status: 'renamed',
      sha: null,
      changes: 0,
    };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag an addition, which has no existing file to chmod', () => {
    const f: CompareFile = { filename: 'brand/new.sh', status: 'added', sha: null, changes: 0 };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag an entry whose changes count is missing', () => {
    const f: CompareFile = { filename: 'weird.txt', status: 'modified', sha: undefined };
    expect(isModeOnlyChange(f)).toBe(false);
  });

  it('does not flag an entry whose blob sha is an empty string', () => {
    const f: CompareFile = { filename: 'weird.txt', status: 'modified', sha: '', changes: 0 };
    expect(isModeOnlyChange(f)).toBe(false);
  });
});
