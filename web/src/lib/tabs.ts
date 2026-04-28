import type { Branch, Commit, RepoRef } from './github';
import type { GeneratedScripts } from './scriptGen';

export interface Tab {
  id: string;
  ref: RepoRef;
  branches: Branch[];
  branch: string;
  commits: Commit[];
  anchorSha: string | null;
  headSha: string | null;
  defaultBranchName: string | null;
  defaultHeadSha: string | null;
  defaultLastSeenSha: string | null;
  scripts: GeneratedScripts | null;
  busy: boolean;
  genStatus: string | null;
  error: string | null;
  lastPoll: number | null;
}

export interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

export type TabAction =
  | { type: 'ADD_TAB'; tab: Tab }
  | { type: 'CLOSE_TAB'; id: string }
  | { type: 'SET_ACTIVE'; id: string | null }
  | { type: 'UPDATE_TAB'; id: string; patch: Partial<Tab> }
  | { type: 'RESTORE'; tabs: Tab[]; activeTabId: string | null };

export function tabsReducer(state: TabsState, action: TabAction): TabsState {
  switch (action.type) {
    case 'ADD_TAB':
      return { tabs: [...state.tabs, action.tab], activeTabId: action.tab.id };
    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      const newTabs = [...state.tabs.slice(0, idx), ...state.tabs.slice(idx + 1)];
      let newActive = state.activeTabId;
      if (state.activeTabId === action.id) {
        newActive = newTabs[Math.max(0, idx - 1)]?.id ?? null;
      }
      return { tabs: newTabs, activeTabId: newActive };
    }
    case 'SET_ACTIVE':
      return { ...state, activeTabId: action.id };
    case 'UPDATE_TAB':
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };
    case 'RESTORE':
      return { tabs: action.tabs, activeTabId: action.activeTabId };
    default:
      return state;
  }
}

export function newTabId(): string {
  return crypto.randomUUID();
}

export function repoUrl(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

export function makeSkeletonTab(
  id: string,
  ref: RepoRef,
  opts: { branch?: string; anchorSha?: string | null } = {},
): Tab {
  return {
    id,
    ref,
    branches: [],
    branch: opts.branch ?? '',
    commits: [],
    anchorSha: opts.anchorSha ?? null,
    headSha: null,
    defaultBranchName: null,
    defaultHeadSha: null,
    defaultLastSeenSha: null,
    scripts: null,
    busy: true,
    genStatus: null,
    error: null,
    lastPoll: null,
  };
}
