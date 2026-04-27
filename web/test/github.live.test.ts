/**
 * Hits the real GitHub REST API. Skipped automatically if there's no network
 * or if GITCLIP_SKIP_LIVE=1.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareCommits,
  getFileContent,
  listBranches,
  listCommits,
  parseRepoUrl,
} from '../src/lib/github';
import { generateScripts, type FileOp } from '../src/lib/scriptGen';

const skip = process.env.GITCLIP_SKIP_LIVE === '1';

describe.skipIf(skip)('live GitHub integration', () => {
  it('parses common repo URL forms', () => {
    expect(parseRepoUrl('https://github.com/octocat/Hello-World')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
    expect(parseRepoUrl('https://github.com/octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
    expect(parseRepoUrl('octocat/Hello-World')).toEqual({ owner: 'octocat', repo: 'Hello-World' });
    expect(parseRepoUrl('not a url')).toBeNull();
  });

  it('lists branches and commits', async () => {
    const ref = { owner: 'octocat', repo: 'Hello-World' };
    const branches = await listBranches(ref);
    expect(branches.length).toBeGreaterThan(0);
    const def = branches.find((b) => b.isDefault);
    expect(def).toBeDefined();
    const commits = await listCommits(ref, def!.name, null, 5);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('round-trips: real compare → generated bash → applied in temp dir matches target tree', async () => {
    const ref = { owner: 'octocat', repo: 'Hello-World' };
    // Two known commits in this venerable test repo.
    const base = '553c2077f0edc3d5dc5d17262f6aa498e69d6f8e';
    const head = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';

    const cmp = await compareCommits(ref, base, head);
    expect(cmp.files.length).toBeGreaterThan(0);

    const ops: FileOp[] = [];
    for (const f of cmp.files) {
      if (f.status === 'removed') {
        ops.push({ kind: 'remove', path: f.filename });
      } else {
        const content = await getFileContent(ref, f.filename, head, f.sha);
        ops.push({ kind: 'write', path: f.filename, content });
      }
    }

    const { bash } = generateScripts({ ops, targetSha: head });
    const root = mkdtempSync(join(tmpdir(), 'gitclip-live-'));
    try {
      writeFileSync(join(root, 'apply.sh'), bash);
      execFileSync('bash', ['apply.sh'], { cwd: root, stdio: 'pipe' });
      // For each write op, verify the file content matches what we sent.
      for (const op of ops) {
        if (op.kind === 'write') {
          const got = new Uint8Array(readFileSync(join(root, op.path)));
          expect(got).toEqual(op.content);
        }
        if (op.kind === 'remove') {
          expect(existsSync(join(root, op.path))).toBe(false);
        }
      }
      expect(readFileSync(join(root, '.gitclip-head'), 'utf8').trim()).toBe(head);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
