# Architecture

This document explains *why* GitClip is shaped the way it is — the constraints driving the design and the non-obvious decisions a contributor would otherwise have to reverse-engineer from the code.

## Problem & constraints

The user develops on a normal dev laptop with Claude Code, but the target machine is airgapped and only reachable through a Citrix browser session. The network channel between the two boxes is therefore: **clipboard + browser-initiated downloads**. No `git`, no `ssh`, no inbound connections from the internet, no installable tooling.

GitClip turns that channel into something useful by riding *only* on what the airgapped machine already has: a browser, a shell (bash on Linux, PowerShell on Windows), and the coreutils that come with each.

Three distinct workflows fall out of this:

1. **Commit sync** — getting a new GitHub commit's tree onto the airgapped machine, fully through the browser.
2. **Log buffer** — getting paste-able context (errors, stack traces) from the airgapped machine back into Claude Code's context on the dev laptop.
3. **Command queue** — getting runnable shell commands *from* Claude Code on the dev laptop *to* the airgapped browser, where the user copies and runs them. The mirror image of the log buffer.

These workflows share nothing except the deployment target and the session UUID, but co-locating them keeps the "set up GitClip once, get all three" story simple.

## System diagram

```
        ┌────────────────────────┐                               ┌─────────────────────────┐
        │ Airgapped target box   │                               │ Dev laptop              │
        │ (Citrix browser only)  │                               │ (Claude Code, normal    │
        │                        │                               │  network access)        │
        └─────────┬──────────────┘                               └────────────┬────────────┘
                  │                                                            │
            paste│ + clipboard                                       reads via │ MCP stdio
                  │                                                            │
                  ▼                                                            ▼
       ┌─────────────────────────────────────────────────────────────────────────────────┐
       │                            gitclip.netlify.app  (SPA)                            │
       │  ───────────────────────────────────────────────────────────────────────────    │
       │  React + Vite SPA (web/)                                                         │
       │   • talks to api.github.com directly (PAT in localStorage, never to backend)     │
       │   • polls branch HEAD every 30s with If-None-Match (ETag)                        │
       │   • lays out the commit DAG into lanes, renders SVG graph                        │
       │   • generates the bash + PowerShell apply scripts in-page (no server side)       │
       └────────────┬────────────────────────────────────────────┬───────────────────────┘
                    │                                            │
        copy script │ to clipboard                  POST/GET     │ /api/buffer-{write,read,clear}
                    ▼                                            ▼
            ┌──────────────────┐                    ┌────────────────────────────────┐
            │ user's terminal  │                    │ Netlify Functions (netlify/    │
            │ runs the script  │                    │  functions/) over Netlify      │
            │ → working tree   │                    │  Blobs storage                 │
            │   moves to new   │                    │   • bearer-auth (session UUID) │
            │   commit         │                    │   • atomic clear-on-read       │
            └──────────────────┘                    │   • 24h TTL, 1 MB session cap  │
                                                    └────────────────────────────────┘
                                                                ▲
                                                                │
                                                       drained via tool call
                                                                │
                                                    ┌────────────────────────────────┐
                                                    │ gitclip-mcp (mcp/)             │
                                                    │   stdio MCP server             │
                                                    │   reads session from           │
                                                    │   ~/.config/gitclip/session    │
                                                    │   exposes read_buffer / clear  │
                                                    └────────────────────────────────┘
```

## Layers

| Path | Role |
|---|---|
| `web/` | Vite + React + TS SPA. The only piece the airgapped browser ever loads. |
| `netlify/functions/` | Netlify Functions backed by Netlify Blobs. Log-buffer side: `buffer-write`, `buffer-read` (read-and-clear, atomic), `buffer-clear`. Command-queue side: `cmd-write`, `cmd-read` (non-destructive, ETag-conditional), `cmd-dismiss` (per-entry), `cmd-clear-all`. |
| `mcp/` | `gitclip-mcp` — stdio MCP server that the dev laptop's Claude Code spawns. The only piece on the *trusted* side of the airgap. Exposes `read_buffer`, `clear_buffer`, `send_command`, `list_pending_commands`. |
| `netlify.toml` | Build & functions config. SPA builds from `web/`, functions bundle from `netlify/functions/`. |
| `package.json` (root) | npm workspaces declaration. Each layer is a workspace; the root is purely orchestration. |

## Data flows

### Commit-sync flow

1. User pastes a GitHub repo URL into the SPA. The SPA hits `GET /repos/:o/:r` and `…/branches` directly against `api.github.com`. PAT (if any) is sent as `Authorization: Bearer …`. Auth never touches our backend.
2. The SPA fetches the latest 30 commits on the chosen branch, runs them through `lib/graphLayout.ts` to assign lane indices, and renders SVG with the commit DAG.
3. User clicks the commit they're currently at locally → `anchorSha` set, persisted in `localStorage`.
4. Every 30s the SPA polls `…/branches/:branch` with `If-None-Match: <previous-etag>`. A 304 response uses zero rate-limit; a 200 means HEAD advanced.
5. When HEAD advances past the visible window's `commits[0].sha`, the SPA re-fetches the commit list (so the graph stays current) and surfaces a "Generate apply script" panel.
6. On click: SPA calls `…/compare/:anchor...:head`, then for each changed file, fetches its content via `…/contents/{path}?ref=:head` (base64) — falling back to `…/git/blobs/:sha` for files larger than 1 MB.
7. `lib/scriptGen.ts` emits two scripts: bash (heredoc'd base64) and PowerShell (`[Convert]::FromBase64String` + `[IO.File]::WriteAllBytes`). The user copies whichever flavour they want.
8. Pasted into the airgapped terminal, the script `mkdir -p`s every directory, base64-decodes every file, deletes removed files, and writes the new SHA to `.gitclip-head`.

The non-obvious bit: **every file (text or binary) is encoded as base64**, not as a heredoc'd literal. This trades ~33% size growth for byte-exact reproduction with no escaping pitfalls (no quoting, no terminator collisions, no LF/CRLF surprise, no UTF-8 normalization). On the strictly-text-only side, both `base64` (Linux coreutils) and `[Convert]::FromBase64String` (Windows .NET, in-process) ship with the OS.

### Log-buffer flow

1. The SPA generates a 32-char URL-safe random session id on first visit and persists it in `localStorage` (rotatable from the UI).
2. User pastes log lines into the textarea, clicks "send". SPA `POST`s `/api/buffer-write` with `Authorization: Bearer <session>` and the text in JSON.
3. The Function appends to a list stored as JSON in Netlify Blobs at key `<session>`. Caps: 256 KB per write, 1 MB per session (oldest entries trimmed FIFO), 24h since `createdAt`.
4. On the dev laptop, `gitclip-mcp` reads the session id from (in priority order) `GITCLIP_SESSION` env var → `$GITCLIP_SESSION_FILE` → `$XDG_CONFIG_HOME/gitclip/session` → `$HOME/.config/gitclip/session`. The session is re-read on every tool call, so rotating doesn't require restarting Claude Code.
5. When Claude calls `read_buffer`, the MCP `GET`s `/api/buffer-read` with the same bearer. The Function reads the entries, then `delete`s the key. The MCP returns the entries as `text` content; Claude's context now contains the logs.

### Command-queue flow

The mirror direction: Claude on the dev laptop pushes shell commands the user runs on the airgapped box.

1. Claude calls the `send_command` MCP tool with `{ script, shell? }`. The MCP picks the shell flavor in this priority order: per-call `shell` arg → `GITCLIP_SHELL` env var → `$XDG_CONFIG_HOME/gitclip/shell` (or `$HOME/.config/gitclip/shell`). If none is set and no per-call arg was given, the call errors.
2. The MCP `POST`s `/api/cmd-write` with the same `Bearer <session>` it uses for log reads, and a body of `{ content: <b64-of-script>, enc: 'b64', shell }`. Base64 reuses the WAF-dodge path already proven for `buffer-write`.
3. The Function assigns the entry a UUID (`crypto.randomUUID()`), appends `{ id, at, shell, script }` to the JSON list stored at `<session>:cmd` in the same `gitclip-buffers` Blob store, applies the same caps (256 KB / write, 1 MB / queue, 24 h TTL from `createdAt`), and returns `{ ok, id, pendingCount, totalBytes }`.
4. The SPA polls `GET /api/cmd-read` every 5 s with `Authorization: Bearer <session>` and `If-None-Match: W/"<updatedAt>-<n>"`. A 304 short-circuits; a 200 returns the full entry list plus the new ETag.
5. The "Commands from Claude" section in the SPA renders each entry as `timestamp · shell label · <pre><code>script</code></pre> · copy · dismiss`. The header shows a green dot and a `(N pending)` count when entries are present. A "clear all" link sits next to the count.
6. The user clicks **copy** → script lands on the clipboard, the entry gains a persistent "copied" badge stored in component state. Clicks **dismiss** → SPA fires `DELETE /api/cmd-dismiss?id=<uuid>`; the Function rewrites the list without that entry and bumps `updatedAt`.
7. Clicks **clear all** → SPA fires `DELETE /api/cmd-clear-all`; the Function `delete`s the `<session>:cmd` key entirely.
8. Two extra MCP tools complement `send_command`:
   - `list_pending_commands` — read-only peek so Claude can warn when the user is falling behind ("you have 3 unrun commands still pending"). Does not mutate state.
   - There is deliberately **no** clear-from-MCP. Only the user — the side with the full execution context — can dismiss.

The non-obvious bit: **the log buffer and the command queue share a session UUID but live in two distinct Blob keys** (`<session>` and `<session>:cmd`). This keeps the setup story one-step (one id in one file) while giving each direction independent size caps, independent ETags, and independent clear semantics. See ADR-0002.

### Why the two directions don't share semantics

The log buffer reads atomically clear; the command queue reads don't. The asymmetry is deliberate (ADR-0001): Claude is a single, idempotent consumer of logs ("I have them now, they're gone"), but the human at the airgapped browser may copy, paste, retry on failure, and only then mark a command done. Forcing clear-on-read on the command direction would lose commands every time a paste failed.

### Decoupling session config from Claude Code config

The MCP could have read the session straight from a `--env` flag passed at `claude mcp add` time. We deliberately don't, because:

- `claude mcp add` is **not idempotent** — re-running with a different `--env` errors with `"already exists"`. Rotating a session would mean `mcp remove && mcp add` every time.
- The session id changes more often than the registration (rotation, multiple browsers, debugging) but the registration only changes when you reinstall the MCP. Decoupling them along their natural lifecycles means rotation is a one-line file write and Claude Code's MCP config never gets touched again.

The MCP still honours `GITCLIP_SESSION` for users who *do* want to bake it in (or who run multiple MCP processes pointing at different buffers).

## Key design decisions

### Browser-direct GitHub calls (no proxy)

The SPA could have proxied GitHub through a Netlify Function, which would let us share auth or cache responses. We don't, because:

- It would force the user's PAT through our backend. With direct calls, the PAT only ever sees `api.github.com` — even if our Functions were somehow compromised, no PAT material is exposed.
- Free Netlify Functions have invocation quotas; a 30-second poll over an 8-hour day = ~960 invocations per user per day. Direct calls cost zero quota.
- ETag conditional GETs work natively. Proxying through Functions would either lose them or require we reimplement the cache layer.

The downside is no shared rate-limit pool — but unauthenticated GitHub gives 60 req/hr/IP, and the polling design uses 304s aggressively to stay well under that. With a PAT, the limit is 5 000/hr.

### Pull-based MCP, not push-based

A "shell-listens-for-pushes" design would be more elegant on paper: the website POSTs to the dev laptop's MCP whenever a buffer write happens, no polling, no draining tool call. We don't, because:

- The dev laptop isn't reachable from the internet. Building a tunnel (ngrok, cloudflared) introduces an inbound attack surface, requires the user to keep a tunnel daemon running, and complicates auth.
- Pull-based means Claude *invokes* the tool when it wants the buffer — that's the natural flow anyway. The MCP doesn't need to be "always on" beyond Claude Code's normal MCP server lifecycle.

### Atomic clear-on-read

Buffer reads are destructive — the act of reading the buffer clears it. Two reasons:

1. The user's mental model: "I sent these errors to Claude" should mean those errors won't be re-delivered the next time Claude calls `read_buffer`. Otherwise you get drift between the user's expectation and the buffer's state.
2. Implements the auto-shrinking behaviour for free. No background expiry needed for the common case.

The "clear" is a Blob `delete` *after* the read returns the entries. There's a small race: a write that lands between read-and-delete will be lost. We accept this — it's rare, it's a logs use case (re-paste is fine), and avoiding it would require a CAS layer that Netlify Blobs doesn't natively expose.

### `lib/graphLayout.ts` — the lane algorithm

A standard top-down sweep over commits in newest-first order. `active` is a sparse array indexed by lane number; each cell holds the SHA that lane is currently waiting to encounter (a parent of an already-rendered commit).

For each commit:

1. Find the lane already expecting our SHA. If none exists, allocate a fresh slot (first null hole, else append).
2. Clear *every* lane that was waiting for our SHA (multiple branches can converge here — e.g. a tag and a branch both pointing at the same commit).
3. Assign each parent to a lane. The first parent inherits this commit's lane if free; additional parents always go to fresh lanes — unless that parent is already being awaited by some other lane (the descending edge then becomes a future merge point).

The renderer (`web/src/components/CommitGraph.tsx`) uses each row's `inLanes` and `outLanes` snapshots to draw straight verticals for pass-through lanes and bezier curves for diverging/converging lanes. Hollow-centre dots mark merge commits (multi-parent). Lane colour is purely a function of lane *index*, cycling an 8-colour pastel palette — same lane, same colour, even after lane reuse.

## Trust & security model

- **PAT (GitHub)**. User-provided. Stored in `localStorage`. Sent only to `api.github.com` as a bearer token. Never traverses GitClip's backend, never logged. Required only for private repos or to lift the 60/hr unauthenticated rate limit.
- **Session UUID (buffer auth)**. 32-char URL-safe random, generated client-side via `crypto.getRandomValues`. The *only* secret that protects buffer entries. The buffer endpoint validates `^[A-Za-z0-9_-]{16,64}$` and rejects malformed tokens with 400. Buffer entries are isolated by session — no cross-session reads.
- **Buffer payloads**. Capped at 256 KB per write, 1 MB total per session (oldest entries trimmed FIFO), 24-hour TTL since first write.
- **No accounts, no email, no OAuth**. The system has no user identity. Identity is the session UUID. If you paste your session UUID somewhere risky, rotate it (UI button) — old entries auto-expire after 24h regardless.

## Performance notes

- **Bundle**: 162 KB JS / 52 KB gzipped, 11 KB CSS. No octokit, no `@gitgraph/react`, no router — just React + the small in-house `github.ts`, `scriptGen.ts`, `graphLayout.ts`. Loads fast even over Citrix.
- **Polling**: 30 s cadence with ETag conditional GETs. A 304 response uses no quota — typical idle session burns essentially zero rate-limit.
- **Apply-script size**: roughly 1.4× the raw changed-bytes (base64 overhead). For most commits this is comfortably copy-pasteable; the SyncOutput component falls back to a "download as `.sh`/`.ps1`" path for large changesets.
- **Function cold starts**: trivial — the buffer endpoints are tiny single-file handlers, p95 cold start <300 ms.

## Deliberately out of scope

- **Multi-host providers**. GitLab/Bitbucket support is intentionally deferred. The provider boundary is `lib/github.ts`; making it pluggable is straightforward but not required for the airgapped-LRM use case the project was built for.
- **Webhook-based push updates**. Polling is fine for one user; webhooks would require persistent backend state and per-repo webhook configuration on each tracked repo.
- **Multi-branch tracking on one session**. A session tracks one branch at a time. Switching branches resets the head/anchor state.
- **Two-way *file* sync**. The buffer/queue carry log text and shell scripts only — never working-tree state. Pushing local edits *back* to the airgapped machine is the apply-script flow's domain only.
- **User accounts / auth providers**. The session UUID is the entire identity model. No login, no email verification, no OAuth.

If any of these become real needs, the current shape doesn't preclude them — but adding them speculatively would compromise the "tiny single-purpose utility" character of the project today.
