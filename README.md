# GitClip

> Browser-only commit sync + log buffer for airgapped dev workflows.

[![ci](https://github.com/VetleNeumann/gitclip/actions/workflows/ci.yml/badge.svg)](https://github.com/VetleNeumann/gitclip/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live:** https://gitclip-vetle.netlify.app

A Netlify-hosted bridge between an airgapped target machine (browser-only network access via Citrix or similar) and a development laptop running [Claude Code](https://claude.com/claude-code). It closes the two everyday papercuts of that split-machine workflow:

1. **Commit sync.** Pick a commit you're currently at on a GitHub repo. Whenever new commits land on the tracked branch, GitClip generates a self-contained, copy-pasteable shell script — both `bash` and `PowerShell` flavours — that mutates your local working tree onto the new commit. **No git, no clone, no installed tooling.** Files are inlined as base64 chunks, decoded with whatever ships in the OS (`base64` from coreutils on Linux, `[Convert]::FromBase64String` in built-in PowerShell).
2. **Log buffer + MCP.** Paste error logs / stack traces into the site. Then in any Claude Code session, *"read the buffer"* fires the `gitclip-mcp` MCP tool, the entries land in Claude's context, and the buffer atomically clears.

## Try it on the live demo

`https://gitclip-vetle.netlify.app/?demo=1` renders a synthetic merge-heavy DAG so you can see the lane-routed graph (octo-merges, multi-lane converges, head/anchor rings) without loading a real repo.

For real use: paste any GitHub repo URL (public or private — private needs a PAT, kept in your browser's `localStorage` only).

## Architecture

| Layer | What it does |
|---|---|
| `web/` | Vite + React + TS SPA. Calls `api.github.com` directly (PAT in browser only, never traverses our backend), polls branch HEAD with ETag conditional GETs, renders an SVG commit graph, generates the apply script in-page. |
| `netlify/functions/` | Three Netlify Functions backed by [Netlify Blobs](https://docs.netlify.com/blobs/overview/): `buffer-write`, `buffer-read` (atomic clear-on-read), `buffer-clear`. Bearer-auth'd by per-session UUIDs, with 256 KB write cap, 1 MB session cap, 24h TTL. |
| `mcp/` | `gitclip-mcp` — a stdio MCP server using `@modelcontextprotocol/sdk`. Exposes `read_buffer` and `clear_buffer` tools. Configured via `GITCLIP_SESSION` env var. |

Repo layout:

```
gitclip/
├── web/                       # Vite + React SPA
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/        # RepoForm, CommitGraph, SyncOutput, LogBuffer
│   │   ├── lib/               # github.ts, scriptGen.ts, graphLayout.ts, buffer.ts, session.ts
│   │   └── main.tsx
│   └── test/                  # vitest: scriptGen, graphLayout, live GitHub round-trip
├── netlify/functions/         # buffer-write/read/clear + Blobs storage
├── mcp/                       # gitclip-mcp stdio MCP server
├── netlify.toml
└── package.json               # npm workspaces
```

## Local development

```bash
npm install
npm run dev          # web SPA on :5173
npm test             # full vitest suite (25 tests, includes a real GitHub round-trip)
npx netlify dev      # SPA + Functions on :8888 (requires netlify-cli)
```

## Deploying

```bash
. ~/path/to/.env.with-NETLIFY_AUTH_TOKEN
npx netlify deploy --build --prod \
  --site=$NETLIFY_SITE_ID \
  --filter @gitclip/web
```

## Wiring `gitclip-mcp` into Claude Code

The MCP looks up its session id from `~/.config/gitclip/session` (or `$XDG_CONFIG_HOME/gitclip/session`, or `$GITCLIP_SESSION_FILE`, or the `GITCLIP_SESSION` env var — first match wins). That separation means you only register the MCP with Claude Code **once**, and rotating the session is a one-line file write — no Claude Code restart, no `mcp remove && add` dance.

**One-time setup on your dev laptop:**

```bash
# Local build (until gitclip-mcp is published to npm):
claude mcp add gitclip -- node /absolute/path/to/gitclip/mcp/dist/index.js

# Once on npm:
# claude mcp add gitclip -- npx -y gitclip-mcp
```

**Per-session (write the session id once, or whenever you rotate it via the UI):**

```bash
# bash / WSL / macOS:
mkdir -p ~/.config/gitclip && printf '%s' '<session-id>' > ~/.config/gitclip/session

# PowerShell:
$d="$HOME/.config/gitclip"; New-Item -ItemType Directory -Force -Path $d | Out-Null; \
  Set-Content -LiteralPath "$d/session" -Value '<session-id>' -NoNewline -Encoding utf8
```

The web UI shows both copy-pasteable forms with your current session pre-filled. In any Claude Code session: *"read the buffer"* → `read_buffer` tool fires → entries land in context → buffer clears.

## Security notes

- GitHub PATs live in `localStorage` and are sent only to `api.github.com` — never to the GitClip backend.
- Buffer entries are bearer-auth'd by random session UUIDs, capped (256 KB / write, 1 MB / session) and auto-expire after 24h.
- The session UUID is the only secret protecting your buffer; rotate it from the UI if you ever paste it somewhere risky.

## License

[MIT](LICENSE) © 2026 Vetle Neumann
