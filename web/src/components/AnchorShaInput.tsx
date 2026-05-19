import { useState, type FormEvent } from 'react';
import { parseAnchorSha } from '../lib/anchorSha';

interface Props {
  onSet: (sha: string) => void;
  resolve?: (sha: string) => Promise<{ ok: true; sha: string } | { ok: false; reason: string }>;
}

export function AnchorShaInput({ onSet, resolve }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = parseAnchorSha(value);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    let finalSha = parsed.sha;
    if (resolve) {
      setBusy(true);
      try {
        const result = await resolve(parsed.sha);
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        finalSha = result.sha;
      } finally {
        setBusy(false);
      }
    }
    onSet(finalSha);
    setValue('');
  };

  return (
    <form onSubmit={submit} className="px-4 py-3 border-t border-zinc-800 space-y-1.5">
      <label className="block text-xs text-zinc-500">
        Or paste your <code className="text-zinc-400">.gitclip-head</code> sha:
      </label>
      <div className="flex gap-2">
        <input
          className={`flex-1 rounded bg-zinc-900 border px-2 py-1 font-mono text-xs focus:outline-none ${
            error ? 'border-red-700 focus:border-red-500' : 'border-zinc-700 focus:border-emerald-500'
          }`}
          placeholder="e.g. 68d60cc or full 40-char sha"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button
          type="submit"
          className="px-3 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs hover:bg-zinc-700 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Set'}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </form>
  );
}
