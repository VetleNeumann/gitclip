import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
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

const FROM = '0000001234567890';
const TARGET = 'cafef00d';

describe('round-trip: generated bash script applied in a temp dir', () => {
  if (!bashAvailable()) {
    it.skip('bash not available on this host', () => {});
    return;
  }

  it('writes added/modified files, removes deleted ones, leaves a head marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      mkdirSync(join(root, 'pre'), { recursive: true });
      writeFileSync(join(root, 'pre/keep.txt'), 'unchanged');
      writeFileSync(join(root, 'pre/replace.txt'), 'old contents');
      writeFileSync(join(root, 'pre/remove.txt'), 'goodbye');
      writeFileSync(join(root, '.gitclip-head'), `${FROM}\n`);

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
        targetSha: TARGET,
        fromSha: FROM,
      });

      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], { cwd: root, stdio: 'pipe' });

      expect(readFileSync(join(root, 'pre/keep.txt'), 'utf8')).toBe('unchanged');
      expect(new Uint8Array(readFileSync(join(root, 'src/feature.ts')))).toEqual(text);
      expect(new Uint8Array(readFileSync(join(root, 'assets/logo.bin')))).toEqual(binary);
      expect(new Uint8Array(readFileSync(join(root, 'pre/replace.txt')))).toEqual(replacement);
      expect(existsSync(join(root, 'pre/remove.txt'))).toBe(false);
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies mode-only changes without rewriting file contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      writeFileSync(join(root, '.gitclip-head'), `${FROM}\n`);
      writeFileSync(join(root, 'vendored.bin'), 'unchanged bytes', { mode: 0o644 });
      writeFileSync(join(root, 'nolonger.sh'), '#!/bin/sh\n', { mode: 0o755 });

      const { bash } = generateScripts({
        ops: [
          { kind: 'chmod', path: 'vendored.bin', executable: true },
          { kind: 'chmod', path: 'nolonger.sh', executable: false },
        ],
        targetSha: TARGET,
        fromSha: FROM,
      });
      // The whole point: no content is carried for a mode-only change.
      expect(bash).not.toContain('GITCLIP_B64');

      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], { cwd: root, stdio: 'pipe' });

      expect(statSync(join(root, 'vendored.bin')).mode & 0o111).not.toBe(0);
      expect(statSync(join(root, 'nolonger.sh')).mode & 0o111).toBe(0);
      expect(readFileSync(join(root, 'vendored.bin'), 'utf8')).toBe('unchanged bytes');
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts short fromSha as prefix of full anchor file', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      const fullAnchor = '0000001234567890abcdef0000001234567890ab';
      writeFileSync(join(root, '.gitclip-head'), fullAnchor);
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'x.txt', content: enc.encode('y') }],
        targetSha: TARGET,
        fromSha: '0000001',
      });
      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], { cwd: root, stdio: 'pipe' });
      expect(readFileSync(join(root, 'x.txt'), 'utf8')).toBe('y');
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aborts with non-zero exit when .gitclip-head mismatches fromSha', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      writeFileSync(join(root, '.gitclip-head'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'should-not-exist.txt', content: enc.encode('nope') }],
        targetSha: TARGET,
        fromSha: FROM,
      });
      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      const result = spawnSync('bash', [scriptPath], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/paste expects/);
      expect(existsSync(join(root, 'should-not-exist.txt'))).toBe(false);
      // Anchor file untouched.
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mismatch is bypassed by GITCLIP_FORCE=1', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      writeFileSync(join(root, '.gitclip-head'), 'deadbeefdeadbeef\n');
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'forced.txt', content: enc.encode('ok') }],
        targetSha: TARGET,
        fromSha: FROM,
      });
      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], {
        cwd: root,
        stdio: 'pipe',
        env: { ...process.env, GITCLIP_FORCE: '1' },
      });
      expect(readFileSync(join(root, 'forced.txt'), 'utf8')).toBe('ok');
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aborts when no .gitclip-head and no TTY (non-interactive)', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'should-not-exist.txt', content: enc.encode('nope') }],
        targetSha: TARGET,
        fromSha: FROM,
      });
      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      // Detach from any inherited TTY by closing stdin.
      const result = spawnSync('bash', [scriptPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/no \.gitclip-head/i);
      expect(existsSync(join(root, 'should-not-exist.txt'))).toBe(false);
      expect(existsSync(join(root, '.gitclip-head'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('proceeds without .gitclip-head when GITCLIP_FORCE=1', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'fresh.txt', content: enc.encode('hi') }],
        targetSha: TARGET,
        fromSha: FROM,
      });
      const scriptPath = join(root, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], {
        cwd: root,
        stdio: 'pipe',
        env: { ...process.env, GITCLIP_FORCE: '1' },
      });
      expect(readFileSync(join(root, 'fresh.txt'), 'utf8')).toBe('hi');
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('walks up to find .gitclip-head in a parent directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'gitclip-rt-'));
    try {
      writeFileSync(join(root, '.gitclip-head'), `${FROM}\n`);
      const sub = join(root, 'deep/nested');
      mkdirSync(sub, { recursive: true });
      const { bash } = generateScripts({
        ops: [{ kind: 'write', path: 'top.txt', content: enc.encode('top') }],
        targetSha: TARGET,
        fromSha: FROM,
      });
      const scriptPath = join(sub, 'apply.sh');
      writeFileSync(scriptPath, bash);
      execFileSync('bash', [scriptPath], { cwd: sub, stdio: 'pipe' });
      // File written at root, not in sub.
      expect(readFileSync(join(root, 'top.txt'), 'utf8')).toBe('top');
      expect(existsSync(join(sub, 'top.txt'))).toBe(false);
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(TARGET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
