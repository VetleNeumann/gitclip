import { useState, type FormEvent } from 'react';
import { parseRepoUrl, type RepoRef } from '../lib/github';

interface Props {
  initialUrl: string;
  initialPat: string;
  onLoad: (ref: RepoRef, pat: string | null) => void;
  busy: boolean;
}

export function RepoForm({ initialUrl, initialPat, onLoad, busy }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [pat, setPat] = useState(initialPat);
  const [showPat, setShowPat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ref = parseRepoUrl(url);
    if (!ref) {
      setError('Could not parse a GitHub owner/repo from that input.');
      return;
    }
    setError(null);
    localStorage.setItem('gitclip.lastUrl', url);
    if (pat) localStorage.setItem('gitclip.pat', pat);
    else localStorage.removeItem('gitclip.pat');
    onLoad(ref, pat || null);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-sm text-zinc-400 mb-1">GitHub repo URL or owner/repo</label>
        <input
          className="w-full rounded bg-zinc-900 border border-zinc-700 px-3 py-2 font-mono text-sm focus:outline-none focus:border-emerald-500"
          placeholder="https://github.com/octocat/Hello-World"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div>
        <label className="block text-sm text-zinc-400 mb-1">
          Personal Access Token <span className="text-zinc-500">(optional, kept in your browser only)</span>
        </label>
        <div className="flex gap-2">
          <input
            type={showPat ? 'text' : 'password'}
            className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 font-mono text-sm focus:outline-none focus:border-emerald-500"
            placeholder="ghp_… (only needed for private repos)"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowPat((v) => !v)}
            className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm hover:bg-zinc-700"
          >
            {showPat ? 'hide' : 'show'}
          </button>
        </div>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-sm font-medium"
      >
        {busy ? 'Loading…' : 'Load repo'}
      </button>
    </form>
  );
}
