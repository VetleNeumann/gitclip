#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { formatPendingCommands, formatSendCommandQueuedText } from './commandQueue.js';
import { resolveShellFlavor, type ShellFlavor } from './shellFlavor.js';

const DEFAULT_URL = 'https://gitclip-vetle.netlify.app';
const SESSION_RE = /^[a-zA-Z0-9_-]{16,64}$/;

function defaultSessionPath(): string {
  if (process.env.GITCLIP_SESSION_FILE) return process.env.GITCLIP_SESSION_FILE;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'gitclip', 'session');
}

function readSessionFromFile(): string | null {
  try {
    return readFileSync(defaultSessionPath(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

interface BufferResponse {
  entries: { at: number; text: string }[];
  cleared: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface CommandReadResponse {
  entries: { at: number; shell: ShellFlavor; script: string }[];
  createdAt?: number;
  updatedAt?: number;
}

interface CommandWriteResponse {
  ok: boolean;
  id: string;
  pendingCount: number;
  totalBytes: number;
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function getSession(): string {
  const s = process.env.GITCLIP_SESSION ?? readSessionFromFile();
  if (!s) {
    throw new Error(
      `gitclip-mcp: no session configured. Write your session id to ${defaultSessionPath()} ` +
        `(e.g. \`mkdir -p ~/.config/gitclip && echo <session-id> > ~/.config/gitclip/session\`), ` +
        `or set the GITCLIP_SESSION env var.`,
    );
  }
  if (!SESSION_RE.test(s)) {
    throw new Error('gitclip-mcp: session id must be 16-64 chars matching [A-Za-z0-9_-].');
  }
  return s;
}

function getOrigin(): string {
  return (process.env.GITCLIP_URL ?? DEFAULT_URL).replace(/\/+$/, '');
}

function formatEntries(resp: BufferResponse): string {
  if (resp.entries.length === 0) return '(buffer empty)';
  const blocks = resp.entries.map((e) => {
    const ts = new Date(e.at).toISOString();
    return `--- entry @ ${ts} ---\n${e.text}`;
  });
  const tail = resp.cleared ? '\n\n(buffer cleared)' : '';
  return blocks.join('\n\n') + tail;
}

async function readBuffer(): Promise<string> {
  const session = getSession();
  const url = `${getOrigin()}/api/buffer-read`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${session}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`buffer-read failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as BufferResponse;
  return formatEntries(json);
}

async function clearBuffer(): Promise<void> {
  const session = getSession();
  const url = `${getOrigin()}/api/buffer-clear`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${session}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`buffer-clear failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

async function sendCommand(script: string, shell: ShellFlavor): Promise<CommandWriteResponse> {
  const session = getSession();
  const url = `${getOrigin()}/api/cmd-write`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      content: Buffer.from(script, 'utf8').toString('base64'),
      enc: 'b64',
      shell,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cmd-write failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as CommandWriteResponse;
}

async function listPendingCommands(): Promise<string> {
  const session = getSession();
  const url = `${getOrigin()}/api/cmd-read`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${session}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cmd-read failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as CommandReadResponse;
  return formatPendingCommands(json.entries);
}

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'gitclip', version: '0.1.0' },
    {
      instructions:
        'Use read_buffer to drain logs/error output from the GitClip web UI, clear_buffer to drop pending logs, send_command to queue a script for the user to copy on the airgapped browser, and list_pending_commands to peek at queued commands without clearing.',
    },
  );

  server.registerTool(
    'read_buffer',
    {
      title: 'Read GitClip log buffer',
      description:
        'Fetch all log/error entries the user has pasted into the GitClip web UI for this session, then clear the buffer. Returns "(buffer empty)" if there is nothing pending.',
      inputSchema: z.object({}).shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async () => {
      try {
        const text = await readBuffer();
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'send_command',
    {
      title: 'Send command to GitClip command queue',
      description:
        'Queue a shell command/script in the GitClip command queue for this session. The airgapped browser polls and shows each entry with a copy button.',
      inputSchema: z
        .object({
          script: z.string().min(1, 'script must be non-empty'),
          shell: z.string().optional(),
        })
        .shape,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ script, shell }) => {
      try {
        const resolvedShell = resolveShellFlavor({
          shell,
          env: process.env,
          read: readTextFile,
        });
        const result = await sendCommand(script, resolvedShell);
        return {
          content: [
            {
              type: 'text',
              text: formatSendCommandQueuedText(resolvedShell, result),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'list_pending_commands',
    {
      title: 'List pending GitClip commands',
      description:
        'Fetch pending command-queue entries for this session without mutating the queue. Returns "(no pending commands)" when empty.',
      inputSchema: z.object({}).shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const text = await listPendingCommands();
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    'clear_buffer',
    {
      title: 'Clear GitClip log buffer',
      description: 'Drop any pending entries in the GitClip log buffer without reading them.',
      inputSchema: z.object({}).shape,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => {
      try {
        await clearBuffer();
        return { content: [{ type: 'text', text: 'buffer cleared' }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`gitclip-mcp running on stdio (origin=${getOrigin()})`);
}

main().catch((error) => {
  console.error('gitclip-mcp fatal:', error);
  process.exit(1);
});
