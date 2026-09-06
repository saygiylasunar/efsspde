# EFSS PDE

**Ersen Filiz Saygıyla Sunar's Pixel Discipline Editor (PDE)**

EFSS PDE is a deterministic, grid-first pixel-art editor aimed at game-ready assets and AI-operable editing workflows.

## M4 — Operator Bridge

M4 adds the runtime line between the open editor and an MCP-capable operator.

```text
ChatGPT / MCP client
        │
        │ Streamable HTTP
        ▼
127.0.0.1:8787/mcp
   Operator Bridge
        │
        │ authenticated WebSocket
        ▼
EFSS PDE runtime
        │
        ▼
Pixel Command Engine
```

The bridge exposes:

- `pde_get_state` — canvas, palette, layers, frames, active context
- `pde_get_frame` — composited native palette-index pixels
- `pde_preview_operations` — simulate operations and return a diff without committing
- `pde_execute_operations` — execute one undoable deterministic transaction
- `pde_set_context` — select a known frame/layer
- `pde_undo`
- `pde_redo`

The MCP server follows the 2026-era TypeScript SDK and Streamable HTTP model. The editor connects to the bridge over a token-authenticated WebSocket. The bridge binds to loopback by default.

### Start the runtime bridge

```bash
npm install
npm run bridge
```

The bridge prints a one-time editor token when `EFSS_EDITOR_TOKEN` is not set. Paste that token into **Operator Bridge → Editor token** in EFSS PDE and press **Connect**.

Default endpoints:

```text
MCP:       http://127.0.0.1:8787/mcp
Health:    http://127.0.0.1:8787/health
Editor WS: ws://127.0.0.1:8787/editor
```

For local development, keep the bridge bound to `127.0.0.1`. A remote MCP client cannot reach localhost directly; use a trusted MCP tunnel or deploy the bridge behind HTTPS. If you bind the bridge publicly, configure both `EFSS_EDITOR_TOKEN` and `EFSS_MCP_TOKEN`.

See [bridge/README.md](bridge/README.md).

## M3 — Frames, animation and onion skin

- Per-layer cels for every frame
- Blank/duplicate/delete frame
- Per-frame duration
- Variable-duration playback
- Previous/next frame onion skin
- Frame + layer aware history
- Project v3 with v1/v2 migration

## M2 — Layers and compositing

- Add/select/delete/show-hide/reorder layers
- Visible topmost-pixel compositing
- Active-layer editing
- Composite PNG export
- Layer-aware undo/redo

## M1 — Command Engine

Deterministic operations:

- `set_pixel`
- `clear_pixel`
- `paint_stroke`
- `fill`
- `move_region`
- `replace_color`
- `flip_x`
- `flip_y`

## M0 — First Pixel

- Native indexed pixel canvas
- Pencil, eraser, picker and fill
- Indexed palette
- Integer zoom and pixel grid
- Undo / redo
- Native PNG export
- React + TypeScript + Vite
- Tauri 2
- Zustand
- `Uint8Array` pixel storage

## Development

```bash
npm install
npm run dev
```

Desktop:

```bash
npm run tauri:dev
```

Full build/type-check, including the Operator Bridge:

```bash
npm run build
```

## Roadmap

- **M4.1:** Semantic regions and anchors on top of the runtime bridge
- **M5:** Pixel linting, isometric constraints and discipline profiles
