import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateScripts } from '../src/lib/scriptGen';

const enc = new TextEncoder();

function bashAvailable(): boolean {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('round-trip: generated bash script applied in a temp dir', () => {
  if (!bashAvailable()) {
    it.skip('bash not available on this host', () => {});
    return;
  }

  it('writes added/modified files, removes deleted ones, leaves a head marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      // Pre-existing files: one to be modified, one to be removed, one untouched.
      mkdirSync(join(root, 'pre'), { recursive: true });
      writeFileSync(join(root, 'pre/keep.txt'), 'unchanged');
      writeFileSync(join(root, 'pre/replace.txt'), 'old contents');
      writeFileSync(join(root, 'pre/remove.txt'), 'goodbye');

      const binary = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f, 0x00, 0xab]);
      const text = enc.encode('export const greeting = "hi"\n');
      const replacement = enc.encode('new contents\n');

      const { bash } = generateScripts({
        ops: [
          { kind: 'write', path: 'src/feature.ts', content: text },
          { kind: 'write', path: 'assets/logo.bin', content: binary },
          { kind: 'write', path: 'pre/replace.txt', content: replacement },
          { kind: 'remove', path: 'pre/remove.txt' },
        ],
        targetSha: 'cafef00d',
      });

      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], { cwd: root, stdio: 'pipe' });

      // Untouched file is still there.
      expect(readFileSync(join(root, 'pre/keep.txt'), 'utf8')).toBe('unchanged');
      // New text file matches byte-for-byte.
      expect(new Uint8Array(readFileSync(join(root, 'src/feature.ts')))).toEqual(text);
      // Binary file matches byte-for-byte.
      expect(new Uint8Array(readFileSync(join(root, 'assets/logo.bin')))).toEqual(binary);
      // Modified file replaced.
      expect(new Uint8Array(readFileSync(join(root, 'pre/replace.txt')))).toEqual(replacement);
      // Removed file is gone.
      expect(existsSync(join(root, 'pre/remove.txt'))).toBe(false);
      // Head marker pinned.
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe('cafef00d');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
