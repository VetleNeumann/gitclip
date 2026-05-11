import { homedir } from 'node:os';
import { join } from 'node:path';

export const SHELL_FLAVORS = ['bash', 'pwsh'] as const;
export type ShellFlavor = (typeof SHELL_FLAVORS)[number];

interface ResolveShellFlavorInput {
  shell?: string;
  env: NodeJS.ProcessEnv;
  read: (path: string) => string | null;
}

const ALLOWED = SHELL_FLAVORS.join(', ');

function shellConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];

  const shellFile = env.GITCLIP_SHELL_FILE?.trim();
  if (shellFile) paths.push(shellFile);

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) paths.push(join(xdg, 'gitclip', 'shell'));

  const home = env.HOME?.trim() || homedir();
  if (home) paths.push(join(home, '.config', 'gitclip', 'shell'));

  return [...new Set(paths)];
}

function parseShell(source: string, value: string): ShellFlavor {
  const trimmed = value.trim();
  if (trimmed === 'bash' || trimmed === 'pwsh') return trimmed;
  throw new Error(
    `gitclip-mcp: invalid shell flavor from ${source}: "${trimmed}". Allowed values: ${ALLOWED}.`,
  );
}

export function resolveShellFlavor(input: ResolveShellFlavorInput): ShellFlavor {
  if (input.shell !== undefined) {
    return parseShell('send_command.shell argument', input.shell);
  }

  if (input.env.GITCLIP_SHELL !== undefined) {
    return parseShell('GITCLIP_SHELL', input.env.GITCLIP_SHELL);
  }

  const paths = shellConfigPaths(input.env);
  for (const path of paths) {
    let value: string | null = null;
    try {
      value = input.read(path);
    } catch {
      value = null;
    }
    if (value === null) continue;
    return parseShell(path, value);
  }

  const lines = paths.map((path) => `- ${path}`).join('\n');
  throw new Error(
    `gitclip-mcp: no shell flavor configured. Set GITCLIP_SHELL to 'bash' or 'pwsh', or write one of those values to:\n${lines}`,
  );
}

