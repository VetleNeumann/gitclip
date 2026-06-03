# gitclip-mcp

Stdio MCP server for [GitClip](https://github.com/VetleNeumann/gitclip). Drains a GitClip log buffer into Claude Code via the Model Context Protocol.

## Install

Wire into Claude Code with `npx` (no install needed):

```bash
claude mcp add gitclip -- npx -y gitclip-mcp
```

## Configuration

Set the session id GitClip generated for you in the browser:

```bash
export GITCLIP_SESSION=<uuid>
```

## Tools

- `read_buffer` — atomically reads and clears the buffer
- `clear_buffer` — clears without reading
- `send_command` — queues a payload for the airgapped user: a runnable shell script (default), or `kind: 'snippet'` for anything they paste rather than run (nvim keys, SQL, file text), with an optional `hint` label
- `list_pending_commands` — lists pending queued commands without clearing

See the [main repo](https://github.com/VetleNeumann/gitclip) for the full architecture.

## License

MIT
