import type { CommandKind } from './commandKind.js';

export interface PendingCommandEntry {
  at: number;
  kind: CommandKind;
  script: string;
  hint?: string;
}

function header(entry: PendingCommandEntry): string {
  const ts = new Date(entry.at).toISOString();
  if (entry.kind === 'snippet') {
    const label = entry.hint ? `snippet (${entry.hint})` : 'snippet';
    return `--- ${label} @ ${ts} ---`;
  }
  return `--- ${entry.kind} command @ ${ts} ---`;
}

export function formatPendingCommands(entries: PendingCommandEntry[]): string {
  if (entries.length === 0) return '(no pending commands)';
  return entries.map((entry) => `${header(entry)}\n${entry.script}`).join('\n\n');
}

export function formatSendCommandQueuedText(
  kind: CommandKind,
  result: { id: string; pendingCount: number },
): string {
  const noun = kind === 'snippet' ? 'snippet' : `${kind} command`;
  return `queued ${noun} ${result.id} (pendingCount=${result.pendingCount})`;
}
