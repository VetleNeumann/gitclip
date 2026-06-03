import { resolveShellFlavor } from './shellFlavor.js';

export const COMMAND_KINDS = ['bash', 'pwsh', 'snippet'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

interface ResolveKindInput {
  kind?: string;
  env: NodeJS.ProcessEnv;
  read: (path: string) => string | null;
}

// `kind` omitted or a shell name → resolve the configured shell flavor (ADR-0003).
// `kind === 'snippet'` → an inert paste-payload; no shell config is consulted.
export function resolveKind(input: ResolveKindInput): CommandKind {
  if (input.kind === 'snippet') return 'snippet';
  return resolveShellFlavor({ shell: input.kind, env: input.env, read: input.read });
}
