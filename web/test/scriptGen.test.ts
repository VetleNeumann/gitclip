import { describe, it, expect } from 'vitest';
import { generateScripts, type FileOp } from '../src/lib/scriptGen';

const enc = new TextEncoder();
const FROM = '0000001';
const TARGET = 'abc1234';

describe('generateScripts', () => {
  it('emits a bash script with shebang, strict mode, and a trailing head marker', () => {
    const { bash } = generateScripts({
      ops: [{ kind: 'write', path: 'a.txt', content: enc.encode('hi\n') }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(bash.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(bash).toContain('set -euo pipefail');
    expect(bash).toContain('.gitclip-head');
    expect(bash).toContain('echo "GitClip: now at abc1234"');
  });

  it('emits a GITCLIP/1 signature line in both flavours', () => {
    const { bash, powershell } = generateScripts({
      ops: [{ kind: 'write', path: 'a.txt', content: enc.encode('hi\n') }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(bash.split('\n')[1]).toBe('# GITCLIP/1');
    expect(powershell.split('\r\n')[0]).toBe('#!GITCLIP/1');
  });

  it('emits a powershell script with strict mode and CRLF line endings', () => {
    const { powershell } = generateScripts({
      ops: [{ kind: 'write', path: 'a.txt', content: enc.encode('hi\n') }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(powershell).toContain("$ErrorActionPreference = 'Stop'");
    expect(powershell).toContain('\r\n');
    expect(powershell).toContain('Write-Host "GitClip: now at abc1234"');
  });

  it('encodes file content as base64 in both shells', () => {
    const content = enc.encode('hello world\n');
    const expected = Buffer.from(content).toString('base64');
    const { bash, powershell } = generateScripts({
      ops: [{ kind: 'write', path: 'src/x.txt', content }],
      targetSha: 'deadbee',
      fromSha: FROM,
    });
    expect(bash).toContain(expected);
    expect(powershell).toContain(expected);
  });

  it('handles binary content (NUL bytes, non-utf8) byte-exact via base64', () => {
    const content = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f, 0x00]);
    const b64 = Buffer.from(content).toString('base64');
    const { bash, powershell } = generateScripts({
      ops: [{ kind: 'write', path: 'logo.bin', content }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(bash).toContain(b64);
    expect(powershell).toContain(b64);
  });

  it('emits remove commands for both shells', () => {
    const { bash, powershell } = generateScripts({
      ops: [{ kind: 'remove', path: 'old/file.ts' }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(bash).toContain("rm -f -- 'old/file.ts'");
    expect(powershell).toContain(
      "Remove-Item -LiteralPath 'old/file.ts' -Force -ErrorAction SilentlyContinue",
    );
  });

  it('escapes single quotes in paths for both shells', () => {
    const ops: FileOp[] = [{ kind: 'remove', path: "weird'name.txt" }];
    const { bash, powershell } = generateScripts({ ops, targetSha: TARGET, fromSha: FROM });
    expect(bash).toContain(`'weird'\\''name.txt'`);
    expect(powershell).toContain(`'weird''name.txt'`);
  });

  it('rejects absolute and parent-traversal paths', () => {
    expect(() =>
      generateScripts({ ops: [{ kind: 'remove', path: '/etc/passwd' }], targetSha: TARGET, fromSha: FROM }),
    ).toThrow(/relative/);
    expect(() =>
      generateScripts({ ops: [{ kind: 'remove', path: '../escape' }], targetSha: TARGET, fromSha: FROM }),
    ).toThrow(/relative/);
  });

  it('rejects non-hex or too-short shas', () => {
    expect(() =>
      generateScripts({ ops: [], targetSha: 'sha', fromSha: FROM }),
    ).toThrow(/hex/);
    expect(() =>
      generateScripts({ ops: [], targetSha: TARGET, fromSha: 'xyz' }),
    ).toThrow(/hex/);
  });

  it('chunks long base64 to fixed-width lines for clipboard friendliness', () => {
    const big = new Uint8Array(4000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const { bash } = generateScripts({
      ops: [{ kind: 'write', path: 'big.bin', content: big }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    const lines = bash.split('\n');
    const start = lines.indexOf("_gc_write 'big.bin' <<'GITCLIP_B64'");
    const end = lines.indexOf('GITCLIP_B64', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    for (let i = start + 1; i < end; i++) {
      expect(lines[i]!.length).toBeLessThanOrEqual(76);
    }
  });

  it('mkdir uses the dirname so nested paths work', () => {
    const { bash, powershell } = generateScripts({
      ops: [{ kind: 'write', path: 'a/b/c/d.txt', content: enc.encode('x') }],
      targetSha: TARGET,
      fromSha: FROM,
    });
    expect(bash).toContain("_gc_write 'a/b/c/d.txt'");
    expect(powershell).toContain("_Gc-Write -Path 'a/b/c/d.txt'");
  });

  it('embeds anchor guard with expected fromSha and force env in both shells', () => {
    const { bash, powershell } = generateScripts({
      ops: [],
      targetSha: TARGET,
      fromSha: 'abc1234',
    });
    // bash guard
    expect(bash).toContain("_gc_expect='abc1234'");
    expect(bash).toContain('GITCLIP_FORCE');
    expect(bash).toContain('paste expects');
    expect(bash).toContain('9<>/dev/tty');
    // pwsh guard
    expect(powershell).toContain("$_gcExpect = 'abc1234'");
    expect(powershell).toContain('GITCLIP_FORCE');
    expect(powershell).toContain('paste expects');
    expect(powershell).toContain('[Console]::In.ReadLine()');
  });

  it('lowercases fromSha in the embedded guard', () => {
    const { bash, powershell } = generateScripts({
      ops: [],
      targetSha: TARGET,
      fromSha: 'ABC1234',
    });
    expect(bash).toContain("_gc_expect='abc1234'");
    expect(powershell).toContain("$_gcExpect = 'abc1234'");
  });
});
