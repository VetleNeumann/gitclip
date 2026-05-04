import { useEffect, useState } from 'react';
import type { GeneratedScripts } from '../lib/scriptGen';

interface Props {
  scripts: GeneratedScripts;
  onApplied: () => void;
  targetSha: string;
}

const TAB_KEY = 'gitclip.shellTab';

const RUNNER_ONELINER = 'iex (Get-Clipboard -Raw)';

const ALIAS_INSTALL = `New-Item -Path $PROFILE -ItemType File -Force | Out-Null
if (-not (Select-String -Path $PROFILE -Pattern 'function gitclip' -Quiet)) {
  Add-Content $PROFILE "\`nfunction gitclip { & ([scriptblock]::Create((Get-Clipboard -Raw))) }"
}`;

function loadTab(): 'bash' | 'powershell' {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
  return saved === 'powershell' ? 'powershell' : 'bash';
}

export function SyncOutput({ scripts, onApplied, targetSha }: Props) {
  const [tab, setTabState] = useState<'bash' | 'powershell'>(() => loadTab());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const text = tab === 'bash' ? scripts.bash : scripts.powershell;

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const setTab = (t: 'bash' | 'powershell') => setTabState(t);

  const copyText = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const copy = () => copyText(text, 'script');

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tab === 'bash' ? `gitclip-apply-${targetSha.slice(0, 7)}.sh` : `gitclip-apply-${targetSha.slice(0, 7)}.ps1`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sizeKb = (text.length / 1024).toFixed(1);

  return (
    <div className="rounded border border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex gap-1">
          <button
            className={`px-3 py-1 text-sm rounded ${tab === 'bash' ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
            onClick={() => setTab('bash')}
          >
            bash
          </button>
          <button
            className={`px-3 py-1 text-sm rounded ${tab === 'powershell' ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
            onClick={() => setTab('powershell')}
          >
            PowerShell
          </button>
          <span className="ml-2 text-xs text-zinc-500 self-center">{sizeKb} KB</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-sm"
          >
            {copiedKey === 'script' ? 'copied!' : 'copy'}
          </button>
          <button onClick={download} className="px-3 py-1 rounded bg-zinc-800 border border-zinc-700 text-sm">
            download
          </button>
          <button
            onClick={onApplied}
            className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-sm"
            title={`Mark local working tree as up-to-date with ${targetSha.slice(0, 7)}`}
          >
            mark applied
          </button>
        </div>
      </div>
      {tab === 'powershell' && (
        <div className="border-b border-zinc-800 px-3 py-2 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 shrink-0">Run on target:</span>
            <code className="font-mono text-zinc-200 bg-zinc-900 px-2 py-1 rounded flex-1 overflow-x-auto">
              {RUNNER_ONELINER}
            </code>
            <button
              onClick={() => copyText(RUNNER_ONELINER, 'runner')}
              className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 shrink-0"
            >
              {copiedKey === 'runner' ? 'copied!' : 'copy'}
            </button>
          </div>
          <details className="text-zinc-400">
            <summary className="cursor-pointer select-none hover:text-zinc-200">
              install <code className="font-mono">gitclip</code> alias (run once on target)
            </summary>
            <div className="mt-2 flex items-start gap-2">
              <pre className="font-mono text-zinc-200 bg-zinc-900 px-2 py-1 rounded flex-1 overflow-x-auto whitespace-pre">
                {ALIAS_INSTALL}
              </pre>
              <button
                onClick={() => copyText(ALIAS_INSTALL, 'install')}
                className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 shrink-0"
              >
                {copiedKey === 'install' ? 'copied!' : 'copy'}
              </button>
            </div>
            <p className="mt-2 text-zinc-500">
              after install: <code className="font-mono">gitclip</code> in PowerShell runs whatever's on the
              clipboard, isolated in a child scope.
            </p>
          </details>
        </div>
      )}
      <pre className="text-xs font-mono p-3 overflow-auto max-h-[40vh] whitespace-pre">
        {text}
      </pre>
    </div>
  );
}
