import { useEffect, useState } from 'react';
import { readCommandQueue, type CommandEntry } from '../lib/commandQueue';

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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async (showBusy: boolean) => {
      if (showBusy) setBusy(true);
      try {
        const state = await readCommandQueue(sessionId);
        if (!cancelled) {
          setEntries(state.entries);
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

  const copy = async (entry: CommandEntry) => {
    setStatus(null);
    try {
      await navigator.clipboard.writeText(entry.script);
      setCopiedId(entry.id);
      setStatus(`copied command ${entry.id.slice(0, 8)}…`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Command queue ← Claude Code</h2>
        <span className="text-xs text-zinc-500">
          polls every 5s{busy ? ' (refreshing...)' : ''}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">No pending commands.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <article key={entry.id} className="rounded border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                <span>
                  {formatAt(entry.at)} · <span className="text-zinc-300">{entry.shell}</span>
                </span>
                <button
                  onClick={() => void copy(entry)}
                  className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-xs whitespace-nowrap"
                >
                  {copiedId === entry.id ? 'copied' : 'copy'}
                </button>
              </div>
              <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
                <code>{entry.script}</code>
              </pre>
            </article>
          ))}
        </div>
      )}

      {status && <p className="text-xs text-zinc-400">{status}</p>}
    </section>
  );
}
