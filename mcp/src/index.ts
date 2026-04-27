#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

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

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'gitclip', version: '0.1.0' },
    {
      instructions:
        'Use read_buffer to drain logs/error output that the user pasted into the GitClip web UI. The buffer is cleared atomically on read.',
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
