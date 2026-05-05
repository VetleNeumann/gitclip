import { useState, type FormEvent } from 'react';
import { parseAnchorSha } from '../lib/anchorSha';

interface Props {
  onSet: (sha: string) => void;
}

export function AnchorShaInput({ onSet }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseAnchorSha(value);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onSet(result.sha);
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
        />
        <button
          type="submit"
          className="px-3 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs hover:bg-zinc-700"
        >
          Set
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </form>
  );
}
