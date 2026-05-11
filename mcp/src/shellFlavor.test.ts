import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveShellFlavor } from './shellFlavor.js';

test('returns per-call override and skips config lookup', () => {
  const reads: string[] = [];
  const shell = resolveShellFlavor({
    shell: 'pwsh',
    env: {
      GITCLIP_SHELL: 'bash',
      GITCLIP_SHELL_FILE: '/custom/shell',
      XDG_CONFIG_HOME: '/xdg',
      HOME: '/home/me',
    },
    read: (path) => {
      reads.push(path);
      return 'bash';
    },
  });

  assert.equal(shell, 'pwsh');
  assert.deepEqual(reads, []);
});

test('uses GITCLIP_SHELL before file-based config', () => {
  const reads: string[] = [];
  const shell = resolveShellFlavor({
    env: {
      GITCLIP_SHELL: 'bash',
      GITCLIP_SHELL_FILE: '/custom/shell',
      XDG_CONFIG_HOME: '/xdg',
      HOME: '/home/me',
    },
    read: (path) => {
      reads.push(path);
      return 'pwsh';
    },
  });

  assert.equal(shell, 'bash');
  assert.deepEqual(reads, []);
});

test('falls back through shell files in order', () => {
  const reads: string[] = [];
  const shell = resolveShellFlavor({
    env: {
      GITCLIP_SHELL_FILE: '/custom/shell',
      XDG_CONFIG_HOME: '/xdg',
      HOME: '/home/me',
    },
    read: (path) => {
      reads.push(path);
      if (path === '/home/me/.config/gitclip/shell') return 'pwsh\n';
      return null;
    },
  });

  assert.equal(shell, 'pwsh');
  assert.deepEqual(reads, ['/custom/shell', '/xdg/gitclip/shell', '/home/me/.config/gitclip/shell']);
});

test('errors on invalid shell values with offending source', () => {
  assert.throws(
    () =>
      resolveShellFlavor({
        shell: 'fish',
        env: { HOME: '/home/me' },
        read: () => null,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /send_command\.shell argument/);
      assert.match(err.message, /Allowed values: bash, pwsh/);
      return true;
    },
  );

  assert.throws(
    () =>
      resolveShellFlavor({
        env: { GITCLIP_SHELL: 'zsh', HOME: '/home/me' },
        read: () => null,
      }),
    /GITCLIP_SHELL/,
  );
});

test('errors with all writable config locations when unset', () => {
  assert.throws(
    () =>
      resolveShellFlavor({
        env: {
          XDG_CONFIG_HOME: '/xdg',
          HOME: '/home/me',
        },
        read: () => null,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /no shell flavor configured/);
      assert.match(err.message, /\/xdg\/gitclip\/shell/);
      assert.match(err.message, /\/home\/me\/\.config\/gitclip\/shell/);
      return true;
    },
  );
});

