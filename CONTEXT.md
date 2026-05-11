# GitClip

A clipboard-shaped bridge between a normal dev laptop (running Claude Code) and an airgapped target box reachable only through a Citrix browser session. Two unidirectional flows ride the same session id: code state moving in (commit-sync apply scripts), and information moving in both directions (logs out, commands in).

## Language

**Session**:
A 32-char URL-safe random string, generated client-side in the browser, persisted in `localStorage`. The sole identity primitive — owns both buffers, rotatable, auto-expires server-side after 24h of inactivity.
_Avoid_: account, user, login, token

**Anchor SHA**:
The commit the user is currently at on the airgapped box. Persisted per-tab in `localStorage`. Apply scripts move the working tree *from* the anchor *to* a newer head.
_Avoid_: base, current commit, head

**Apply script**:
A bash or PowerShell blob generated in the SPA from `…/compare/anchor...head`. Pasted into the airgapped terminal, it base64-decodes every changed file, deletes removed paths, and writes `.gitclip-head`. Always emitted in *both* shell flavors so the user picks at copy time.
_Avoid_: patch, diff

**Log buffer**:
The airgapped → laptop flow. The user pastes logs / stack traces / errors into the SPA; the laptop's Claude Code reads them via the `read_buffer` MCP tool. Atomically cleared on read.
_Avoid_: outbox, log queue

**Command queue**:
The laptop → airgapped flow. Claude calls the `send_command` MCP tool with a script; the entry appears in the SPA with a copy button. The user runs it on the airgapped box, then explicitly dismisses it. Non-destructive on read.
_Avoid_: inbox, command buffer, task queue

**Entry**:
One item in either the log buffer or command queue. Log entries are `{at, text}`; command entries are `{id, at, shell, script}`. Command entries get a server-assigned UUID at write time so per-entry dismiss is unambiguous.
_Avoid_: message, payload

**Dismiss**:
The explicit user action that removes a single command entry from the queue after the user has run it (or decided not to). Per-entry by id. Distinct from "clear all", which wipes the entire queue at once.
_Avoid_: ack, resolve, done, complete

**Shell flavor**:
Either `bash` or `pwsh`. For apply scripts, both are always generated and the user picks at copy time. For command-queue entries, the flavor is configured once on the laptop (`GITCLIP_SHELL` env or fallback file alongside the session) and travels with every `send_command` call.
_Avoid_: shell type, platform

## Relationships

- A **Session** owns exactly one **Log buffer** and exactly one **Command queue**, stored as two separate Netlify Blob keys (`<session>` and `<session>:cmd`).
- A **Log buffer** contains zero or more log **Entries**; reading drains them atomically.
- A **Command queue** contains zero or more command **Entries**; reading is non-destructive, **Dismiss** is the only way an entry leaves.
- An **Anchor SHA** belongs to a tab, not a session — a session can track multiple repos, each with its own anchor.
- An **Apply script** is generated client-side from an anchor → head delta. It never flows through the buffer or queue.

## Example dialogue

> **User:** "Can Claude push a follow-up command before I've run the first one?"
> **Designer:** "Yes — the **Command queue** is FIFO. Claude calls `send_command` again and gets `pendingCount: 2` back, so it can mention that to you. Each **Entry** has its own copy and **Dismiss** buttons in the SPA. Nothing is lost unless you click 'clear all'."

> **User:** "If I rotate the **Session**, do my pending commands vanish?"
> **Designer:** "Yes — the **Command queue** lives at `<session>:cmd`, so a new session id means a new (empty) queue. The laptop's MCP re-reads the session file on every tool call, so once you write the new id, Claude's next `send_command` lands in the new queue."

## Flagged ambiguities

- "Buffer" was tempting for both directions, but the existing **Log buffer** is destructive-on-read and the new **Command queue** is not — resolved by giving them distinct names and only sharing the word "Entry" for the generic item.
- "Inbox / outbox" framing was rejected because perspective flips depending on which machine you're standing on. Direction-of-flow names (log buffer = airgapped→laptop, command queue = laptop→airgapped) avoid that.
