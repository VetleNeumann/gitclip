import type { Tab } from '../lib/tabs';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

export function TabBar({ tabs, activeTabId, onActivate, onClose, onAdd }: Props) {
  return (
    <div className="flex items-stretch gap-px border-b border-zinc-800 overflow-x-auto">
      {tabs.map((tab) => {
        const hasNew =
          (!!tab.headSha && !!tab.anchorSha && tab.headSha !== tab.anchorSha) ||
          (!!tab.defaultBranchName &&
            tab.branch !== tab.defaultBranchName &&
            !!tab.defaultHeadSha &&
            tab.defaultHeadSha !== tab.defaultLastSeenSha);
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onActivate(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate(tab.id);
              }
            }}
            className={`group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-b-2 -mb-px whitespace-nowrap ${
              active
                ? 'border-emerald-500 text-zinc-100 bg-zinc-900/50'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'
            }`}
          >
            <span className="font-mono text-xs">
              {tab.ref.owner}/<span className="text-zinc-100">{tab.ref.repo}</span>
            </span>
            {tab.branch && (
              <span className="text-xs text-zinc-500">@ {tab.branch}</span>
            )}
            {hasNew && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                aria-label="new commits"
              />
            )}
            {tab.busy && <span className="text-xs text-zinc-500 animate-pulse">…</span>}
            <button
              type="button"
              aria-label={`close ${tab.ref.owner}/${tab.ref.repo}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="text-zinc-600 hover:text-zinc-200 px-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        aria-label="add tab"
        className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-200 border-b-2 border-transparent -mb-px"
      >
        +
      </button>
    </div>
  );
}
