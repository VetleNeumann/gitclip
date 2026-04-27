import { useState } from 'react';
import type { GeneratedScripts } from '../lib/scriptGen';

interface Props {
  scripts: GeneratedScripts;
  onApplied: () => void;
  targetSha: string;
}

export function SyncOutput({ scripts, onApplied, targetSha }: Props) {
  const [tab, setTab] = useState<'bash' | 'powershell'>('bash');
  const [copied, setCopied] = useState(false);
  const text = tab === 'bash' ? scripts.bash : scripts.powershell;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
            {copied ? 'copied!' : 'copy'}
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
      <pre className="text-xs font-mono p-3 overflow-auto max-h-[40vh] whitespace-pre">
        {text}
      </pre>
    </div>
  );
}
