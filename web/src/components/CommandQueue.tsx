import { useEffect, useRef, useState } from 'react';
import { dismissCommandEntry, readCommandQueue, type CommandEntry } from '../lib/commandQueue';
import {
  clearCommandCopied,
  listCopiedCommandIds,
  markCommandCopied,
} from '../lib/commandCopied';

const POLL_MS = 5_000;

interface Props {
  sessionId: string;
}

function formatAt(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function CommandQueue({ sessionId }: Props) {
  const [entries, setEntries] = useState<CommandEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [copiedIds, setCopiedIds] = useState<Set<string>>(() => new Set());
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    etagRef.current = null;
    setCopiedIds(new Set());

    const tick = async (showBusy: boolean) => {
      if (showBusy) setBusy(true);
      try {
        const result = await readCommandQueue(sessionId, etagRef.current);
        if (!cancelled) {
          if (result.etag) etagRef.current = result.etag;
          if (result.state) setEntries(result.state.entries);
          setStatus(null);
        }
      } catch (err) {
        if (!cancelled) setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && showBusy) setBusy(false);
      }
    };

    void tick(true);
    const id = window.setInterval(() => {
      void tick(false);
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId]);

  useEffect(() => {
    setCopiedIds(listCopiedCommandIds(entries.map((entry) => entry.id)));
  }, [entries]);

  const copy = async (entry: CommandEntry) => {
    setStatus(null);
    try {
      await navigator.clipboard.writeText(entry.script);
      markCommandCopied(entry.id);
      setCopiedIds((current) => {
        const next = new Set(current);
        next.add(entry.id);
        return next;
      });
      setStatus(`copied command ${entry.id.slice(0, 8)}…`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const dismiss = async (entry: CommandEntry) => {
    if (dismissingId) return;
    const priorEntries = entries;
    setStatus(null);
    setDismissingId(entry.id);
    setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
    try {
      const state = await dismissCommandEntry(sessionId, entry.id);
      setEntries(state.entries);
      clearCommandCopied(entry.id);
      setCopiedIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
      setStatus(`dismissed command ${entry.id.slice(0, 8)}…`);
    } catch (err) {
      setEntries(priorEntries);
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setDismissingId(null);
    }
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>Command queue ← Claude Code</span>
          {entries.length > 0 && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-label="pending commands" />
              <span className="text-sm font-normal text-zinc-300">({entries.length} pending)</span>
            </>
          )}
        </h2>
        <span className="text-xs text-zinc-500">
          polls every 5s{busy ? ' (refreshing...)' : ''}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">No pending commands.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const copied = copiedIds.has(entry.id);
            return (
              <article key={entry.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                  <span>
                    {formatAt(entry.at)} · <span className="text-zinc-300">{entry.shell}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void copy(entry)}
                      className={`px-2 py-1 rounded border text-xs whitespace-nowrap ${
                        copied
                          ? 'bg-emerald-700/40 border-emerald-600 text-emerald-300'
                          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
                      }`}
                    >
                      {copied ? 'copied' : 'copy'}
                    </button>
                    <button
                      onClick={() => void dismiss(entry)}
                      disabled={Boolean(dismissingId)}
                      className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed text-xs whitespace-nowrap"
                      aria-label={`dismiss command ${entry.id.slice(0, 8)}`}
                      title="Dismiss command"
                    >
                      {dismissingId === entry.id ? '...' : 'x'}
                    </button>
                  </div>
                </div>
                <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
                  <code>{entry.script}</code>
                </pre>
              </article>
            );
          })}
        </div>
      )}

      {status && <p className="text-xs text-zinc-400">{status}</p>}
    </section>
  );
}
