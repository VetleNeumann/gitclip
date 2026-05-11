import type { ShellFlavor } from './shellFlavor.js';

export interface PendingCommandEntry {
  at: number;
  shell: ShellFlavor;
  script: string;
}

export function formatPendingCommands(entries: PendingCommandEntry[]): string {
  if (entries.length === 0) return '(no pending commands)';
  return entries
    .map((entry) => `--- ${entry.shell} command @ ${new Date(entry.at).toISOString()} ---\n${entry.script}`)
    .join('\n\n');
}

export function formatSendCommandQueuedText(
  shell: ShellFlavor,
  result: { id: string; pendingCount: number },
): string {
  return `queued ${shell} command ${result.id} (pendingCount=${result.pendingCount})`;
}
