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
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus(null);
    try {
      await pushToBuffer(sessionId, trimmed);
      setStatus(`sent ${trimmed.length} chars to the buffer`);
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

  const origin = typeof location === 'undefined' ? '' : location.origin;
  const bashWriteSession = `mkdir -p ~/.config/gitclip && printf '%s' '${sessionId}' > ~/.config/gitclip/session`;
  const pwshWriteSession = `$d="$HOME/.config/gitclip"; New-Item -ItemType Directory -Force -Path $d | Out-Null; Set-Content -LiteralPath "$d/session" -Value '${sessionId}' -NoNewline -Encoding utf8`;
  const bashWriteShell = `mkdir -p ~/.config/gitclip && printf '%s' 'bash' > ~/.config/gitclip/shell`;
  const pwshWriteShell = `$d="$HOME/.config/gitclip"; New-Item -ItemType Directory -Force -Path $d | Out-Null; Set-Content -LiteralPath "$d/shell" -Value 'bash' -NoNewline -Encoding utf8`;
  const claudeAddCommand = `claude mcp add gitclip --env GITCLIP_URL=${origin} -- npx -y gitclip-mcp`;

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

      <details className="text-sm text-zinc-400 space-y-2">
        <summary className="cursor-pointer hover:text-zinc-200">Setup: wire this into Claude Code</summary>

        <p className="mt-3">
          <span className="text-zinc-300 font-medium">Step 1.</span> Save the session id into a
          file the MCP looks for. Run this on your dev laptop whenever you rotate the session:
        </p>
        <div className="space-y-1.5">
          <div className="text-xs text-zinc-500">bash / WSL / macOS:</div>
          <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{bashWriteSession}
          </pre>
          <div className="text-xs text-zinc-500">PowerShell (Windows):</div>
          <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{pwshWriteSession}
          </pre>
        </div>

        <p className="mt-3">
          <span className="text-zinc-300 font-medium">Step 2.</span> Save your default command
          shell label for <code className="font-mono">send_command</code> (set to{' '}
          <code className="font-mono">bash</code> or <code className="font-mono">pwsh</code>; examples below use{' '}
          <code className="font-mono">bash</code>):
        </p>
        <div className="space-y-1.5">
          <div className="text-xs text-zinc-500">bash / WSL / macOS:</div>
          <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{bashWriteShell}
          </pre>
          <div className="text-xs text-zinc-500">PowerShell (Windows):</div>
          <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{pwshWriteShell}
          </pre>
          <p className="text-xs text-zinc-500">
            Swap <code className="font-mono">bash</code> for <code className="font-mono">pwsh</code> if your airgapped target is PowerShell.
          </p>
        </div>

        <p className="mt-3">
          <span className="text-zinc-300 font-medium">Step 3.</span> One-time only — register the
          MCP with Claude Code (after you've published <code className="font-mono">gitclip-mcp</code> to npm,
          or substitute the local path: <code className="font-mono">node /path/to/gitclip/mcp/dist/index.js</code>):
        </p>
        <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono overflow-auto whitespace-pre-wrap break-all">
{claudeAddCommand}
        </pre>

        <p className="mt-3 text-xs">
          Then in any Claude Code session: <em>"read the buffer"</em> — the
          <code className="font-mono"> read_buffer</code> tool fires, the entries land in
          context, the buffer clears. Rotate freely; only step 1 needs to be re-run, and
          Claude Code picks up the new session on the next tool call. For command queue writes,
          <code className="font-mono"> send_command</code> now defaults to your saved shell file and
          still allows a per-call <code className="font-mono">shell</code> override.
        </p>
      </details>
    </section>
  );
}
