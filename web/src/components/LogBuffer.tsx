import { useState } from 'react';
import { pushToBuffer, clearBuffer } from '../lib/buffer';

interface Props {
  sessionId: string;
  onRotate: () => void;
}

export function LogBuffer({ sessionId, onRotate }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await pushToBuffer(sessionId, text);
      setStatus(`sent ${text.length} chars to the buffer`);
      setText('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await clearBuffer(sessionId);
      setStatus('buffer cleared');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const mcpCommand = `claude mcp add gitclip --env GITCLIP_SESSION=${sessionId} --env GITCLIP_URL=${typeof location === 'undefined' ? '' : location.origin} -- npx -y gitclip-mcp`;

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Log buffer → Claude Code</h2>
        <span className="text-xs text-zinc-500">
          session <code className="font-mono text-emerald-400">{sessionId.slice(0, 8)}…</code>
          <button onClick={onRotate} className="ml-2 underline hover:text-zinc-300">
            rotate
          </button>
        </span>
      </header>

      <textarea
        className="w-full h-32 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 font-mono text-sm focus:outline-none focus:border-emerald-500"
        placeholder="Paste error logs / stack traces / anything you want Claude Code to read…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={send}
          disabled={busy || !text.trim()}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-sm"
        >
          send to buffer
        </button>
        <button
          onClick={clear}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-sm"
        >
          clear buffer
        </button>
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>

      <details className="text-sm text-zinc-400">
        <summary className="cursor-pointer hover:text-zinc-200">First-time setup: wire this into Claude Code</summary>
        <p className="mt-2">Run this once on your dev laptop:</p>
        <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{mcpCommand}
        </pre>
        <p className="mt-2">
          Then in any Claude Code session: <em>"read the buffer"</em> — Claude calls the
          <code className="font-mono"> read_buffer</code> tool, your pasted logs land in its
          context, and the buffer is cleared.
        </p>
      </details>
    </section>
  );
}
