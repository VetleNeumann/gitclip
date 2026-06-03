import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveKind } from './commandKind.js';
import { formatPendingCommands, formatSendCommandQueuedText } from './commandQueue.js';

test('snippet kind resolves without touching shell config', () => {
  const reads: string[] = [];
  const kind = resolveKind({
    kind: 'snippet',
    env: {},
    read: (path) => {
      reads.push(path);
      return null;
    },
  });

  assert.equal(kind, 'snippet');
  assert.deepEqual(reads, []);
});

test('omitted kind resolves the configured shell flavor', () => {
  const kind = resolveKind({
    env: { GITCLIP_SHELL: 'pwsh', HOME: '/home/me' },
    read: () => null,
  });

  assert.equal(kind, 'pwsh');
});

test('explicit shell kind overrides config', () => {
  const kind = resolveKind({
    kind: 'bash',
    env: { GITCLIP_SHELL: 'pwsh', HOME: '/home/me' },
    read: () => null,
  });

  assert.equal(kind, 'bash');
});

test('snippet success text drops the "command" noun', () => {
  assert.equal(
    formatSendCommandQueuedText('snippet', {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pendingCount: 1,
    }),
    'queued snippet aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa (pendingCount=1)',
  );
});

test('pending snippet renders its hint in the header', () => {
  const text = formatPendingCommands([
    { at: Date.parse('2026-01-02T03:04:05.000Z'), kind: 'snippet', script: 'SELECT 1;', hint: 'psql query' },
  ]);

  assert.equal(text, '--- snippet (psql query) @ 2026-01-02T03:04:05.000Z ---\nSELECT 1;');
});
