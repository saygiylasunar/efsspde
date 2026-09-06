# EFSS PDE

**Ersen Filiz Saygıyla Sunar's Pixel Discipline Editor (PDE)**

EFSS PDE is a deterministic, grid-first pixel-art editor aimed at game-ready assets and AI-operable editing workflows. The editor treats pixels as indexed data instead of asking a generative image model to imitate pixel art.

## M2 — Layers and compositing

M2 upgrades the document model from one pixel buffer to an ordered layer stack.

- Add, select, delete, show/hide and reorder layers
- Topmost visible non-transparent pixel wins during compositing
- Drawing and Command Engine operations target the active layer
- PNG export uses the visible composite
- Undo/redo changes carry `layerId`, so history remains correct after layer switching
- Project format upgraded to v2 with automatic v1 migration
- Existing M0/M1 project JSON remains loadable

## M1 — Command Engine

Supported deterministic operations:

- `set_pixel`
- `clear_pixel`
- `paint_stroke`
- `fill`
- `move_region`
- `replace_color`
- `flip_x`
- `flip_y`

Commands are validated before execution. JSON arrays run as one transaction, produce a pixel-diff summary and can be reverted with one Undo.

## M0 — First Pixel

- Native indexed pixel canvas
- Pencil, eraser, eyedropper and flood fill
- Indexed 16-color palette with transparent index 0
- Integer zoom and optional pixel grid
- Stroke-based undo / redo
- Native-resolution PNG export
- React + TypeScript + Vite frontend
- Tauri 2 desktop shell
- Zustand UI state
- `Uint8Array` pixel buffers

## Development

```bash
npm install
npm run dev
```

Desktop:

```bash
npm run tauri:dev
```

Build:

```bash
npm run build
```

## Roadmap

- **M3:** Frames, animation and onion skin
- **M4:** Semantic regions, anchors and deterministic AI operator bridge
- **M5:** Pixel linting, isometric constraints and discipline profiles
