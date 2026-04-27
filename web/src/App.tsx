import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RepoForm } from './components/RepoForm';
import { CommitGraph } from './components/CommitGraph';
import { SyncOutput } from './components/SyncOutput';
import { LogBuffer } from './components/LogBuffer';
import {
  compareCommits,
  getBranchHead,
  getFileContent,
  getRepoMeta,
  listBranches,
  listCommits,
  type Branch,
  type Commit,
  type RepoRef,
} from './lib/github';
import { generateScripts, type FileOp, type GeneratedScripts } from './lib/scriptGen';
import { getOrCreateSessionId, rotateSessionId } from './lib/session';

const POLL_MS = 30_000;

const DEMO_COMMITS: Commit[] = [
  { sha: 'aaaaaa1', message: 'merge feature-x into main', authorName: 'alice', authorEmail: '', date: '2026-04-27T12:00:00Z', parents: ['bbbbbb1', 'ccccc1'] },
  { sha: 'bbbbbb1', message: 'main: tweak readme', authorName: 'bob', authorEmail: '', date: '2026-04-27T11:00:00Z', parents: ['ddddd1'] },
  { sha: 'ccccc1', message: 'feature-x: add API', authorName: 'carol', authorEmail: '', date: '2026-04-27T10:30:00Z', parents: ['ccccc2'] },
  { sha: 'ccccc2', message: 'feature-x: scaffold', authorName: 'carol', authorEmail: '', date: '2026-04-27T10:00:00Z', parents: ['ddddd1'] },
  { sha: 'ddddd1', message: 'merge release-1 into main', authorName: 'dave', authorEmail: '', date: '2026-04-27T09:00:00Z', parents: ['eeeee1', 'fffff1'] },
  { sha: 'eeeee1', message: 'main: bump version', authorName: 'eve', authorEmail: '', date: '2026-04-27T08:30:00Z', parents: ['ggggg1'] },
  { sha: 'fffff1', message: 'release-1: hotfix', authorName: 'frank', authorEmail: '', date: '2026-04-27T08:00:00Z', parents: ['fffff2'] },
  { sha: 'fffff2', message: 'release-1: open branch', authorName: 'frank', authorEmail: '', date: '2026-04-27T07:30:00Z', parents: ['ggggg1'] },
  { sha: 'ggggg1', message: 'main: refactor logger', authorName: 'grace', authorEmail: '', date: '2026-04-27T06:00:00Z', parents: ['hhhhh1'] },
  { sha: 'hhhhh1', message: 'octo-merge: experiments a, b', authorName: 'heidi', authorEmail: '', date: '2026-04-27T05:00:00Z', parents: ['iiiii1', 'jjjjj1', 'kkkkk1'] },
  { sha: 'iiiii1', message: 'main: fix typo', authorName: 'ivan', authorEmail: '', date: '2026-04-27T04:30:00Z', parents: ['lllll1'] },
  { sha: 'jjjjj1', message: 'experiment-a: try thing', authorName: 'judy', authorEmail: '', date: '2026-04-27T04:00:00Z', parents: ['lllll1'] },
  { sha: 'kkkkk1', message: 'experiment-b: try other thing', authorName: 'mallory', authorEmail: '', date: '2026-04-27T03:30:00Z', parents: ['lllll1'] },
  { sha: 'lllll1', message: 'common ancestor', authorName: 'oscar', authorEmail: '', date: '2026-04-27T03:00:00Z', parents: ['mmmmm1'] },
  { sha: 'mmmmm1', message: 'init', authorName: 'oscar', authorEmail: '', date: '2026-04-27T02:00:00Z', parents: [] },
];

export default function App() {
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateSessionId());
  const [ref, setRef] = useState<RepoRef | null>(null);
  const [pat, setPat] = useState<string | null>(() => localStorage.getItem('gitclip.pat'));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState<string>('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [anchorSha, setAnchorSha] = useState<string | null>(() => localStorage.getItem('gitclip.anchorSha'));
  const [headSha, setHeadSha] = useState<string | null>(null);
  const [headEtag, setHeadEtag] = useState<string | null>(null);
  const [scripts, setScripts] = useState<GeneratedScripts | null>(null);
  const [busy, setBusy] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<number | null>(null);

  const initialUrl = useMemo(() => localStorage.getItem('gitclip.lastUrl') ?? '', []);
  const initialPat = useMemo(() => localStorage.getItem('gitclip.pat') ?? '', []);
  const demoMode = useMemo(() => new URLSearchParams(location.search).has('demo'), []);

  useEffect(() => {
    if (!demoMode || ref) return;
    setRef({ owner: 'demo', repo: 'graph' });
    setBranch('main');
    setCommits(DEMO_COMMITS);
    setAnchorSha(DEMO_COMMITS[5]!.sha);
    setHeadSha(DEMO_COMMITS[0]!.sha);
  }, [demoMode, ref]);

  const loadRepo = useCallback(async (newRef: RepoRef, newPat: string | null) => {
    setBusy(true);
    setError(null);
    setScripts(null);
    setHeadSha(null);
    setHeadEtag(null);
    try {
      const meta = await getRepoMeta(newRef, newPat);
      const [b, c] = await Promise.all([
        listBranches(newRef, newPat),
        listCommits(newRef, meta.defaultBranch, newPat),
      ]);
      setRef(newRef);
      setPat(newPat);
      setBranches(b);
      setBranch(meta.defaultBranch);
      setCommits(c);
      const persistedAnchor = localStorage.getItem('gitclip.anchorSha');
      if (!persistedAnchor && c.length > 0) {
        setAnchorSha(c[0]!.sha);
        localStorage.setItem('gitclip.anchorSha', c[0]!.sha);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const switchBranch = useCallback(
    async (name: string) => {
      if (!ref) return;
      setBranch(name);
      setBusy(true);
      try {
        const c = await listCommits(ref, name, pat);
        setCommits(c);
        setHeadSha(null);
        setHeadEtag(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [ref, pat],
  );

  const setAnchor = useCallback((sha: string) => {
    setAnchorSha(sha);
    localStorage.setItem('gitclip.anchorSha', sha);
    setScripts(null);
  }, []);

  // Polling loop for branch HEAD with ETag-based conditional GETs.
  const pollRef = useRef<number | null>(null);
  const commitsRef = useRef<Commit[]>(commits);
  commitsRef.current = commits;
  useEffect(() => {
    if (!ref || !branch || demoMode) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await getBranchHead(ref, branch, pat, headEtag);
        if (cancelled) return;
        setLastPoll(Date.now());
        if (result) {
          setHeadSha(result.sha);
          setHeadEtag(result.etag);
          // Branch HEAD advanced past what we have visible — refresh the graph.
          if (result.sha !== commitsRef.current[0]?.sha) {
            try {
              const fresh = await listCommits(ref, branch, pat);
              if (!cancelled) setCommits(fresh);
            } catch (e) {
              console.warn('gitclip: refresh of commit list failed', e);
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [ref, branch, pat, headEtag, demoMode]);

  const generate = useCallback(async () => {
    if (!ref || !anchorSha || !headSha || anchorSha === headSha) return;
    setBusy(true);
    setError(null);
    setGenStatus('Comparing commits…');
    try {
      const cmp = await compareCommits(ref, anchorSha, headSha, pat);
      if (cmp.truncated) {
        setError(
          `GitHub compare API truncated at 300 files (this commit range changed ≥300 files). Pick a closer anchor or sync in steps.`,
        );
        setBusy(false);
        return;
      }
      const ops: FileOp[] = [];
      let i = 0;
      for (const f of cmp.files) {
        i++;
        setGenStatus(`Fetching file ${i}/${cmp.files.length}: ${f.filename}`);
        if (f.status === 'removed') {
          ops.push({ kind: 'remove', path: f.filename });
        } else if (f.status === 'renamed' && f.previous_filename) {
          ops.push({ kind: 'remove', path: f.previous_filename });
          const content = await getFileContent(ref, f.filename, headSha, f.sha, pat);
          ops.push({ kind: 'write', path: f.filename, content });
        } else if (f.status === 'unchanged') {
          continue;
        } else {
          const content = await getFileContent(ref, f.filename, headSha, f.sha, pat);
          ops.push({ kind: 'write', path: f.filename, content });
        }
      }
      setGenStatus('Rendering scripts…');
      const generated = generateScripts({ ops, targetSha: headSha });
      setScripts(generated);
      setGenStatus(
        `Ready: ${ops.length} file ops, ${(generated.bash.length / 1024).toFixed(1)} KB bash / ${(generated.powershell.length / 1024).toFixed(1)} KB pwsh`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGenStatus(null);
    } finally {
      setBusy(false);
    }
  }, [ref, anchorSha, headSha, pat]);

  const markApplied = useCallback(() => {
    if (headSha) {
      setAnchor(headSha);
      setScripts(null);
      setGenStatus(null);
    }
  }, [headSha, setAnchor]);

  const newCommitsAvailable = headSha && anchorSha && headSha !== anchorSha;

  return (
    <div className="min-h-screen px-4 py-6 max-w-7xl mx-auto space-y-5">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">
          GitClip <span className="text-zinc-500 text-base font-normal">— browser-only commit sync</span>
        </h1>
        <p className="text-sm text-zinc-400 max-w-xl">
          Pick a repo and the commit you're on. When new commits arrive on the tracked branch, copy-paste the resulting bash or PowerShell script into your terminal — no git, no clone, no installs.
        </p>
      </header>

      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <RepoForm initialUrl={initialUrl} initialPat={initialPat} onLoad={loadRepo} busy={busy} />
        {ref && (
          <div className="text-sm text-zinc-400 flex items-center gap-3 flex-wrap">
            <span>
              <span className="text-zinc-500">repo</span>{' '}
              <span className="font-mono text-zinc-200">
                {ref.owner}/{ref.repo}
              </span>
            </span>
            {branches.length > 0 && (
              <span>
                <span className="text-zinc-500">branch</span>{' '}
                <select
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
                  value={branch}
                  onChange={(e) => switchBranch(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="text-xs text-zinc-500 ml-auto">
              {lastPoll ? `last polled ${new Date(lastPoll).toLocaleTimeString()}` : 'polling…'}
            </span>
          </div>
        )}
        {error && <div className="text-sm text-red-400 break-words">{error}</div>}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
        {/* LEFT: graph + commits */}
        <section className="rounded border border-zinc-800 overflow-hidden flex flex-col min-h-0">
          <header className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-sm">
            <span className="font-medium">
              {ref ? <>commits on <span className="font-mono text-zinc-300">{branch}</span></> : 'Commits'}
            </span>
            <span className="text-xs text-zinc-500">
              {commits.length > 0 && `showing latest ${commits.length}`}
            </span>
          </header>
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            {commits.length > 0 ? (
              <CommitGraph commits={commits} anchorSha={anchorSha} headSha={headSha} onSelect={setAnchor} />
            ) : (
              <div className="p-8 text-sm text-zinc-500 text-center">
                {ref ? 'Loading commits…' : 'Load a repo above to see its commit graph.'}
              </div>
            )}
          </div>
          {commits.length > 0 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500">
              Click a commit to mark it as your current local state.
            </div>
          )}
        </section>

        {/* RIGHT: sync output + log buffer */}
        <div className="space-y-5 min-w-0">
          {newCommitsAvailable ? (
            <section className="rounded border border-emerald-800 bg-emerald-950/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">
                    New commit on {branch}: <span className="font-mono">{headSha!.slice(0, 7)}</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    From <span className="font-mono">{anchorSha!.slice(0, 7)}</span> →{' '}
                    <span className="font-mono">{headSha!.slice(0, 7)}</span>
                  </p>
                </div>
                <button
                  onClick={generate}
                  disabled={busy}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-sm whitespace-nowrap"
                >
                  {busy ? 'Working…' : 'Generate apply script'}
                </button>
              </div>
              {genStatus && <div className="text-xs text-zinc-400">{genStatus}</div>}
              {scripts && <SyncOutput scripts={scripts} onApplied={markApplied} targetSha={headSha!} />}
            </section>
          ) : ref && commits.length > 0 ? (
            <section className="rounded border border-zinc-800 p-4">
              <h2 className="text-base font-semibold mb-1">Up to date</h2>
              <p className="text-sm text-zinc-400">
                {anchorSha ? (
                  <>
                    You're at <span className="font-mono text-zinc-300">{anchorSha.slice(0, 7)}</span>, the
                    branch HEAD. The page polls every 30s — when a new commit lands, an apply script will
                    appear here.
                  </>
                ) : (
                  'Pick a commit on the left to set your local state.'
                )}
              </p>
            </section>
          ) : null}

          <section className="rounded border border-zinc-800 p-4">
            <LogBuffer
              sessionId={sessionId}
              onRotate={() => setSessionId(rotateSessionId())}
            />
          </section>
        </div>
      </div>

      <footer className="text-xs text-zinc-500 pt-4 border-t border-zinc-900">
        PATs are stored in <code>localStorage</code> and sent only to <code>api.github.com</code>. Buffer entries auto-expire after 24h.
      </footer>
    </div>
  );
}
