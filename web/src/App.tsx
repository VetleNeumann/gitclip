import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { RepoForm } from './components/RepoForm';
import { CommitGraph } from './components/CommitGraph';
import { SyncOutput } from './components/SyncOutput';
import { LogBuffer } from './components/LogBuffer';
import { TabBar } from './components/TabBar';
import { AnchorShaInput } from './components/AnchorShaInput';
import {
  compareCommits,
  getBranchHead,
  getFileContent,
  getMergeBase,
  getRepoMeta,
  listBranches,
  listCommits,
  parseRepoUrl,
  type Commit,
  type RepoRef,
} from './lib/github';
import { generateScripts, type FileOp } from './lib/scriptGen';
import { getOrCreateSessionId, rotateSessionId } from './lib/session';
import {
  makeSkeletonTab,
  newTabId,
  repoUrl,
  tabsReducer,
  type Tab,
  type TabAction,
  type TabsState,
} from './lib/tabs';

const POLL_MS = 30_000;
const BURST_POLL_MS = 5_000;
const BURST_DURATION_MS = 30_000;
const TABS_KEY = 'gitclip.tabs';
const ACTIVE_TAB_KEY = 'gitclip.activeTab';
const PAT_KEY = 'gitclip.pat';

interface PersistedTab {
  url: string;
  branch?: string;
  anchorSha?: string | null;
}

function lastSeenKey(ref: RepoRef): string {
  return `gitclip.lastSeen.default.${ref.owner}/${ref.repo}`;
}

function readPersistedTabs(): PersistedTab[] {
  const raw = localStorage.getItem(TABS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as PersistedTab[];
    } catch {
      // fall through to legacy migration
    }
  }
  // Legacy single-repo migration.
  const lastUrl = localStorage.getItem('gitclip.lastUrl');
  if (lastUrl) {
    const anchorSha = localStorage.getItem('gitclip.anchorSha');
    return [{ url: lastUrl, anchorSha }];
  }
  return [];
}

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

function buildDemoState(): TabsState {
  const id = newTabId();
  const tab: Tab = {
    id,
    ref: { owner: 'demo', repo: 'graph' },
    branches: [{ name: 'main', sha: DEMO_COMMITS[0]!.sha, isDefault: true }],
    branch: 'main',
    commits: DEMO_COMMITS,
    anchorSha: DEMO_COMMITS[5]!.sha,
    headSha: DEMO_COMMITS[0]!.sha,
    defaultBranchName: 'main',
    defaultHeadSha: DEMO_COMMITS[0]!.sha,
    defaultLastSeenSha: DEMO_COMMITS[0]!.sha,
    scripts: null,
    busy: false,
    genStatus: null,
    error: null,
    lastPoll: null,
    pollBurstUntil: null,
  };
  return { tabs: [tab], activeTabId: id };
}

function TabPoller({
  tab,
  pat,
  dispatch,
  demoMode,
}: {
  tab: Tab;
  pat: string | null;
  dispatch: React.Dispatch<TabAction>;
  demoMode: boolean;
}) {
  const headEtagRef = useRef<string | null>(null);
  const defaultHeadEtagRef = useRef<string | null>(null);
  const commitsRef = useRef(tab.commits);
  commitsRef.current = tab.commits;

  useEffect(() => {
    if (demoMode || !tab.ref || !tab.branch) return;
    let cancelled = false;
    const burstActive = tab.pollBurstUntil != null && tab.pollBurstUntil > Date.now();
    const tick = async () => {
      try {
        const result = await getBranchHead(tab.ref, tab.branch, pat, headEtagRef.current);
        if (cancelled) return;
        const lastPoll = Date.now();
        if (!result) {
          dispatch({ type: 'UPDATE_TAB', id: tab.id, patch: { lastPoll } });
          return;
        }
        headEtagRef.current = result.etag;
        const shaChanged = result.sha !== commitsRef.current[0]?.sha;
        const patch: Partial<Tab> = { headSha: result.sha, lastPoll };
        if (shaChanged && burstActive) patch.pollBurstUntil = null;
        dispatch({ type: 'UPDATE_TAB', id: tab.id, patch });
        if (shaChanged) {
          try {
            const fresh = await listCommits(tab.ref, tab.branch, pat);
            if (!cancelled) dispatch({ type: 'UPDATE_TAB', id: tab.id, patch: { commits: fresh } });
          } catch (e) {
            console.warn('gitclip: refresh of commit list failed', e);
          }
        }
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: 'UPDATE_TAB',
            id: tab.id,
            patch: { error: e instanceof Error ? e.message : String(e) },
          });
        }
      }
    };
    void tick();
    const intervalMs = burstActive ? BURST_POLL_MS : POLL_MS;
    const id = window.setInterval(tick, intervalMs);
    let clearTimer: number | undefined;
    if (burstActive) {
      const remaining = Math.max(0, tab.pollBurstUntil! - Date.now());
      clearTimer = window.setTimeout(() => {
        dispatch({ type: 'UPDATE_TAB', id: tab.id, patch: { pollBurstUntil: null } });
      }, remaining);
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (clearTimer != null) window.clearTimeout(clearTimer);
      headEtagRef.current = null;
    };
  }, [tab.id, tab.ref, tab.branch, pat, demoMode, dispatch, tab.pollBurstUntil]);

  useEffect(() => {
    if (demoMode || !tab.defaultBranchName || tab.defaultBranchName === tab.branch) return;
    const defaultBranch = tab.defaultBranchName;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await getBranchHead(tab.ref, defaultBranch, pat, defaultHeadEtagRef.current);
        if (cancelled || !result) return;
        defaultHeadEtagRef.current = result.etag;
        dispatch({ type: 'UPDATE_TAB', id: tab.id, patch: { defaultHeadSha: result.sha } });
      } catch (e) {
        console.warn('gitclip: default-branch poll failed', e);
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      defaultHeadEtagRef.current = null;
    };
  }, [tab.id, tab.ref, tab.defaultBranchName, tab.branch, pat, demoMode, dispatch]);

  return null;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export default function App() {
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateSessionId());
  const [pat, setPat] = useState<string | null>(() => localStorage.getItem(PAT_KEY));
  const demoMode = useMemo(() => new URLSearchParams(location.search).has('demo'), []);
  const [{ tabs, activeTabId }, dispatch] = useReducer(
    tabsReducer,
    null,
    () => (demoMode ? buildDemoState() : { tabs: [], activeTabId: null }),
  );
  const [inputExpanded, setInputExpanded] = useState(true);
  const [hydrated, setHydrated] = useState(demoMode);

  const initialPat = useMemo(() => localStorage.getItem(PAT_KEY) ?? '', []);
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  // Auto-collapse input once we have at least one tab; auto-expand when last closes.
  useEffect(() => {
    if (tabs.length === 0) setInputExpanded(true);
    else setInputExpanded(false);
  }, [tabs.length]);

  const loadIntoTab = useCallback(
    async (
      tabId: string,
      ref: RepoRef,
      tabPat: string | null,
      opts: { branch?: string; anchorSha?: string | null } = {},
    ) => {
      dispatch({ type: 'UPDATE_TAB', id: tabId, patch: { busy: true, error: null } });
      try {
        const meta = await getRepoMeta(ref, tabPat);
        const targetBranch = opts.branch || meta.defaultBranch;
        const [b, c] = await Promise.all([
          listBranches(ref, tabPat),
          listCommits(ref, targetBranch, tabPat),
        ]);
        const seedHead = c[0]?.sha ?? null;
        const seedAnchor = opts.anchorSha ?? seedHead;
        const storedSeen = localStorage.getItem(lastSeenKey(ref));
        dispatch({
          type: 'UPDATE_TAB',
          id: tabId,
          patch: {
            ref,
            branches: b,
            branch: targetBranch,
            commits: c,
            anchorSha: seedAnchor,
            headSha: seedHead,
            defaultBranchName: meta.defaultBranch,
            defaultHeadSha: targetBranch === meta.defaultBranch ? seedHead : null,
            defaultLastSeenSha:
              storedSeen ?? (targetBranch === meta.defaultBranch ? seedHead : null),
            busy: false,
          },
        });
      } catch (e) {
        dispatch({
          type: 'UPDATE_TAB',
          id: tabId,
          patch: { busy: false, error: e instanceof Error ? e.message : String(e) },
        });
      }
    },
    [],
  );

  const addTab = useCallback(
    (ref: RepoRef, newPat: string | null) => {
      if (newPat !== pat) {
        setPat(newPat);
        if (newPat) localStorage.setItem(PAT_KEY, newPat);
        else localStorage.removeItem(PAT_KEY);
      }
      const existing = tabs.find((t) => t.ref.owner === ref.owner && t.ref.repo === ref.repo);
      if (existing) {
        dispatch({ type: 'SET_ACTIVE', id: existing.id });
        return;
      }
      const id = newTabId();
      const skeleton = makeSkeletonTab(id, ref);
      dispatch({ type: 'ADD_TAB', tab: skeleton });
      void loadIntoTab(id, ref, newPat);
    },
    [pat, tabs, loadIntoTab],
  );

  // One-time hydration from localStorage.
  const hydrationStartedRef = useRef(false);
  useEffect(() => {
    if (hydrated || demoMode || hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    const persisted = readPersistedTabs();
    if (persisted.length === 0) {
      setHydrated(true);
      return;
    }
    const skeletons: { tab: Tab; persisted: PersistedTab }[] = [];
    for (const p of persisted) {
      const ref = parseRepoUrl(p.url);
      if (!ref) continue;
      const id = newTabId();
      skeletons.push({
        tab: makeSkeletonTab(id, ref, { branch: p.branch, anchorSha: p.anchorSha }),
        persisted: p,
      });
    }
    if (skeletons.length === 0) {
      setHydrated(true);
      return;
    }
    const activeKey = localStorage.getItem(ACTIVE_TAB_KEY);
    const activeId =
      skeletons.find(({ tab }) => repoUrl(tab.ref) === activeKey)?.tab.id ??
      skeletons[0]!.tab.id;
    dispatch({
      type: 'RESTORE',
      tabs: skeletons.map((s) => s.tab),
      activeTabId: activeId,
    });
    setHydrated(true);
    for (const { tab, persisted: p } of skeletons) {
      void loadIntoTab(tab.id, tab.ref, pat, { branch: p.branch, anchorSha: p.anchorSha });
    }
  }, [hydrated, demoMode, loadIntoTab, pat]);

  // Persist tabs and active id on change.
  useEffect(() => {
    if (!hydrated || demoMode) return;
    const data: PersistedTab[] = tabs.map((t) => ({
      url: repoUrl(t.ref),
      branch: t.branch,
      anchorSha: t.anchorSha,
    }));
    localStorage.setItem(TABS_KEY, JSON.stringify(data));
    if (activeTab) {
      localStorage.setItem(ACTIVE_TAB_KEY, repoUrl(activeTab.ref));
    } else {
      localStorage.removeItem(ACTIVE_TAB_KEY);
    }
  }, [tabs, activeTab, hydrated, demoMode]);

  const setAnchor = useCallback(
    (sha: string) => {
      if (!activeTab) return;
      dispatch({
        type: 'UPDATE_TAB',
        id: activeTab.id,
        patch: { anchorSha: sha, scripts: null },
      });
    },
    [activeTab],
  );

  const jumpToBranch = useCallback(
    async (target: string) => {
      if (!activeTab || target === activeTab.branch) return;
      const tabId = activeTab.id;
      const { ref, defaultBranchName } = activeTab;
      const previousHead = activeTab.headSha ?? activeTab.commits[0]?.sha;
      dispatch({
        type: 'UPDATE_TAB',
        id: tabId,
        patch: { busy: true, error: null, genStatus: `Jumping to ${target}…` },
      });
      try {
        const headResult = await getBranchHead(ref, target, pat, null);
        const targetHead = headResult?.sha;
        if (!targetHead) throw new Error(`could not resolve HEAD of ${target}`);
        let mergeBase = targetHead;
        if (previousHead && previousHead !== targetHead) {
          mergeBase = await getMergeBase(ref, previousHead, targetHead, pat);
        }
        const fresh = await listCommits(ref, target, pat);
        const status =
          mergeBase === targetHead
            ? `Already at ${target} HEAD — nothing to apply.`
            : mergeBase === previousHead
              ? `${target} is strictly ahead of your previous position.`
              : `Anchored at merge-base ${mergeBase.slice(0, 7)}.`;
        const patch: Partial<Tab> = {
          branch: target,
          commits: fresh,
          headSha: targetHead,
          anchorSha: mergeBase,
          scripts: null,
          busy: false,
          genStatus: status,
        };
        if (target === defaultBranchName) {
          patch.defaultLastSeenSha = targetHead;
          localStorage.setItem(lastSeenKey(ref), targetHead);
        }
        dispatch({ type: 'UPDATE_TAB', id: tabId, patch });
      } catch (e) {
        dispatch({
          type: 'UPDATE_TAB',
          id: tabId,
          patch: { busy: false, error: e instanceof Error ? e.message : String(e), genStatus: null },
        });
      }
    },
    [activeTab, pat],
  );

  const refreshBranches = useCallback(async () => {
    if (!activeTab) return;
    try {
      const b = await listBranches(activeTab.ref, pat);
      dispatch({ type: 'UPDATE_TAB', id: activeTab.id, patch: { branches: b } });
    } catch (e) {
      console.warn('gitclip: branch list refresh failed', e);
    }
  }, [activeTab, pat]);

  const generate = useCallback(async () => {
    if (
      !activeTab ||
      !activeTab.anchorSha ||
      !activeTab.headSha ||
      activeTab.anchorSha === activeTab.headSha
    )
      return;
    const tabId = activeTab.id;
    const { ref, anchorSha, headSha } = activeTab;
    dispatch({
      type: 'UPDATE_TAB',
      id: tabId,
      patch: { busy: true, error: null, genStatus: 'Comparing commits…' },
    });
    try {
      const cmp = await compareCommits(ref, anchorSha, headSha, pat);
      if (cmp.truncated) {
        dispatch({
          type: 'UPDATE_TAB',
          id: tabId,
          patch: {
            busy: false,
            error: `GitHub compare API truncated at 300 files (this commit range changed ≥300 files). Pick a closer anchor or sync in steps.`,
            genStatus: null,
          },
        });
        return;
      }
      const total = cmp.files.length;
      let done = 0;
      const slots = await mapPool(cmp.files, 8, async (f) => {
        let result: FileOp[];
        if (f.status === 'removed') {
          result = [{ kind: 'remove', path: f.filename }];
        } else if (f.status === 'unchanged') {
          result = [];
        } else if (f.status === 'renamed' && f.previous_filename) {
          const content = await getFileContent(ref, f.filename, headSha, f.sha, pat);
          result = [
            { kind: 'remove', path: f.previous_filename },
            { kind: 'write', path: f.filename, content },
          ];
        } else {
          const content = await getFileContent(ref, f.filename, headSha, f.sha, pat);
          result = [{ kind: 'write', path: f.filename, content }];
        }
        done++;
        dispatch({
          type: 'UPDATE_TAB',
          id: tabId,
          patch: { genStatus: `Fetched ${done}/${total}: ${f.filename}` },
        });
        return result;
      });
      const ops: FileOp[] = slots.flat();
      dispatch({ type: 'UPDATE_TAB', id: tabId, patch: { genStatus: 'Rendering scripts…' } });
      const generated = generateScripts({ ops, targetSha: headSha });
      dispatch({
        type: 'UPDATE_TAB',
        id: tabId,
        patch: {
          scripts: generated,
          busy: false,
          genStatus: `Ready: ${ops.length} file ops, ${(generated.bash.length / 1024).toFixed(1)} KB bash / ${(generated.powershell.length / 1024).toFixed(1)} KB pwsh`,
        },
      });
    } catch (e) {
      dispatch({
        type: 'UPDATE_TAB',
        id: tabId,
        patch: {
          busy: false,
          error: e instanceof Error ? e.message : String(e),
          genStatus: null,
        },
      });
    }
  }, [activeTab, pat]);

  const markApplied = useCallback(() => {
    if (!activeTab || !activeTab.scripts) return;
    dispatch({
      type: 'UPDATE_TAB',
      id: activeTab.id,
      patch: { anchorSha: activeTab.scripts.targetSha, scripts: null, genStatus: null },
    });
  }, [activeTab]);

  const closeTab = useCallback((id: string) => {
    dispatch({ type: 'CLOSE_TAB', id });
  }, []);

  const newCommitsAvailable =
    activeTab && activeTab.headSha && activeTab.anchorSha && activeTab.headSha !== activeTab.anchorSha;
  const defaultBranchAhead =
    !!activeTab &&
    !!activeTab.defaultBranchName &&
    activeTab.branch !== activeTab.defaultBranchName &&
    !!activeTab.defaultHeadSha &&
    activeTab.defaultHeadSha !== activeTab.defaultLastSeenSha;

  return (
    <div className="min-h-screen px-4 py-6 max-w-7xl mx-auto space-y-5">
      {tabs.map((tab) => (
        <TabPoller key={tab.id} tab={tab} pat={pat} dispatch={dispatch} demoMode={demoMode} />
      ))}
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">
          GitClip <span className="text-zinc-500 text-base font-normal">— browser-only commit sync</span>
        </h1>
        <p className="text-sm text-zinc-400 max-w-xl">
          Pick a repo and the commit you're on. When new commits arrive on the tracked branch, copy-paste the resulting bash or PowerShell script into your terminal — no git, no clone, no installs.
        </p>
      </header>

      <section className="rounded border border-zinc-800 p-4 space-y-3">
        <RepoForm
          initialUrl=""
          initialPat={initialPat}
          onLoad={addTab}
          busy={!!activeTab?.busy}
          collapsed={!inputExpanded && tabs.length > 0}
          onExpand={() => setInputExpanded(true)}
          onCollapse={() => setInputExpanded(false)}
        />
      </section>

      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={(id) => dispatch({ type: 'SET_ACTIVE', id })}
          onClose={closeTab}
          onAdd={() => setInputExpanded(true)}
        />
      )}

      {activeTab ? (
        <>
          <div className="text-sm text-zinc-400 flex items-center gap-3 flex-wrap">
            <span>
              <span className="text-zinc-500">repo</span>{' '}
              <span className="font-mono text-zinc-200">
                {activeTab.ref.owner}/{activeTab.ref.repo}
              </span>
            </span>
            {activeTab.branches.length > 0 && (
              <span>
                <span className="text-zinc-500">branch</span>{' '}
                <select
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
                  value={activeTab.branch}
                  onFocus={refreshBranches}
                  onChange={(e) => jumpToBranch(e.target.value)}
                  disabled={activeTab.busy}
                >
                  {activeTab.branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="text-xs text-zinc-500 ml-auto flex items-center gap-2">
              <span>
                {activeTab.lastPoll
                  ? `last polled ${new Date(activeTab.lastPoll).toLocaleTimeString()}`
                  : 'polling…'}
              </span>
              <button
                type="button"
                title="Refresh now (poll every 5s for 30s)"
                aria-label="Refresh now"
                onClick={() =>
                  dispatch({
                    type: 'UPDATE_TAB',
                    id: activeTab.id,
                    patch: { pollBurstUntil: Date.now() + BURST_DURATION_MS },
                  })
                }
                className="text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={
                    activeTab.pollBurstUntil != null && activeTab.pollBurstUntil > Date.now()
                      ? 'animate-spin'
                      : ''
                  }
                >
                  <path d="M21 12a9 9 0 1 1-3-6.7" />
                  <polyline points="21 4 21 10 15 10" />
                </svg>
              </button>
            </span>
          </div>
          {activeTab.error && (
            <div className="text-sm text-red-400 break-words">{activeTab.error}</div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
            <section className="rounded border border-zinc-800 overflow-hidden flex flex-col min-h-0">
              <header className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-sm">
                <span className="font-medium">
                  {activeTab.ref ? (
                    <>
                      commits on <span className="font-mono text-zinc-300">{activeTab.branch}</span>
                    </>
                  ) : (
                    'Commits'
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {activeTab.commits.length > 0 && `showing latest ${activeTab.commits.length}`}
                </span>
              </header>
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                {activeTab.commits.length > 0 ? (
                  <CommitGraph
                    commits={activeTab.commits}
                    anchorSha={activeTab.anchorSha}
                    headSha={activeTab.headSha}
                    onSelect={setAnchor}
                  />
                ) : (
                  <div className="p-8 text-sm text-zinc-500 text-center">
                    {activeTab.busy ? 'Loading commits…' : 'No commits yet.'}
                  </div>
                )}
              </div>
              {activeTab.commits.length > 0 && (
                <div className="px-4 py-2 border-t border-zinc-800 text-xs text-zinc-500">
                  Click a commit to mark it as your current local state.
                </div>
              )}
              <AnchorShaInput onSet={setAnchor} />
            </section>

            <div className="space-y-5 min-w-0">
              {defaultBranchAhead && (
                <section className="rounded border border-zinc-700 bg-zinc-900/60 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        <span className="font-mono text-zinc-200">
                          {activeTab.defaultBranchName}
                        </span>{' '}
                        has new commits
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {activeTab.defaultLastSeenSha && (
                          <>
                            <span className="font-mono">
                              {activeTab.defaultLastSeenSha.slice(0, 7)}
                            </span>{' '}
                            →{' '}
                          </>
                        )}
                        <span className="font-mono">{activeTab.defaultHeadSha!.slice(0, 7)}</span> —
                        jumping anchors you at the merge-base with your current branch.
                      </p>
                    </div>
                    <button
                      onClick={() => jumpToBranch(activeTab.defaultBranchName!)}
                      disabled={activeTab.busy}
                      className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-sm whitespace-nowrap"
                    >
                      Jump to {activeTab.defaultBranchName}
                    </button>
                  </div>
                </section>
              )}
              {newCommitsAvailable ? (
                <section className="rounded border border-emerald-800 bg-emerald-950/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        New commit on {activeTab.branch}:{' '}
                        <span className="font-mono">{activeTab.headSha!.slice(0, 7)}</span>
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        From <span className="font-mono">{activeTab.anchorSha!.slice(0, 7)}</span> →{' '}
                        <span className="font-mono">{activeTab.headSha!.slice(0, 7)}</span>
                      </p>
                    </div>
                    <button
                      onClick={generate}
                      disabled={activeTab.busy}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-sm whitespace-nowrap"
                    >
                      {activeTab.busy ? 'Working…' : 'Generate apply script'}
                    </button>
                  </div>
                  {activeTab.genStatus && (
                    <div className="text-xs text-zinc-400">{activeTab.genStatus}</div>
                  )}
                  {activeTab.scripts && (
                    <SyncOutput
                      scripts={activeTab.scripts}
                      onApplied={markApplied}
                      targetSha={activeTab.headSha!}
                    />
                  )}
                </section>
              ) : activeTab.commits.length > 0 ? (
                <section className="rounded border border-zinc-800 p-4">
                  <h2 className="text-base font-semibold mb-1">Up to date</h2>
                  <p className="text-sm text-zinc-400">
                    {activeTab.anchorSha ? (
                      <>
                        You're at{' '}
                        <span className="font-mono text-zinc-300">
                          {activeTab.anchorSha.slice(0, 7)}
                        </span>
                        , the branch HEAD. The page polls every 30s — when a new commit lands, an
                        apply script will appear here.
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
        </>
      ) : (
        <section className="rounded border border-zinc-800 p-8 text-sm text-zinc-500 text-center">
          No repos open — paste a GitHub URL above to add a tab.
        </section>
      )}

      <footer className="text-xs text-zinc-500 pt-4 border-t border-zinc-900">
        PATs are stored in <code>localStorage</code> and sent only to <code>api.github.com</code>.
        Buffer entries auto-expire after 24h.
      </footer>
    </div>
  );
}
