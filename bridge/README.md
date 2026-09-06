# EFSS PDE Operator Bridge

The Operator Bridge is a small Node.js process that connects an MCP client to one running EFSS PDE editor.

## Why a bridge exists

The editor's authoritative state lives in the React/Tauri runtime. An MCP server is a separate network process. The bridge joins them without moving pixel ownership out of the editor.

- MCP side: Streamable HTTP at `/mcp`
- Editor side: authenticated WebSocket at `/editor`
- Health check: JSON at `/health`
- One editor session per bridge process in M4

## Local startup

```bash
npm install
npm run bridge
```

Example output:

```text
[efsspde-bridge] listening on http://127.0.0.1:8787
[efsspde-bridge] MCP endpoint: http://127.0.0.1:8787/mcp
[efsspde-bridge] editor WebSocket: ws://127.0.0.1:8787/editor
[efsspde-bridge] editor token: <generated-token>
```

Copy the generated editor token into the EFSS PDE **Operator Bridge** panel. The token is not persisted by the editor.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `EFSS_BRIDGE_HOST` | `127.0.0.1` | HTTP/WebSocket bind address |
| `EFSS_BRIDGE_PORT` | `8787` | Bridge port |
| `EFSS_EDITOR_TOKEN` | random at startup | Authenticates the editor WebSocket |
| `EFSS_MCP_TOKEN` | unset | Optional Bearer auth on `/mcp` |

If `EFSS_MCP_TOKEN` is unset, keep the service on loopback or behind a trusted authenticated tunnel.

## Tool contract

### Read tools

- `pde_get_state`
- `pde_get_frame`
- `pde_preview_operations`

### Write tools

- `pde_execute_operations`
- `pde_set_context`
- `pde_undo`
- `pde_redo`

The recommended operator workflow is:

```text
pde_get_state
      ↓
pde_get_frame (when visual pixel data is needed)
      ↓
pde_preview_operations
      ↓
pde_execute_operations
      ↓
pde_get_frame / pde_get_state
```

`pde_preview_operations` mutates the target cel only long enough to calculate the diff and then rolls the changes back. `pde_execute_operations` commits the same operation format as one normal editor undo transaction.

## Remote access

The server intentionally binds to loopback by default. ChatGPT and other hosted MCP clients cannot reach a developer machine's localhost directly.

Use either:

1. a trusted secure MCP tunnel that forwards the local `/mcp` endpoint, or
2. a remote deployment behind HTTPS with authentication.

Do not expose an unauthenticated `0.0.0.0:8787` bridge to the public internet.
