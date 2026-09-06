# EFSS PDE

**Ersen Filiz Saygıyla Sunar's Pixel Discipline Editor (PDE)**

EFSS PDE is a deterministic, grid-first pixel-art editor aimed at game-ready assets and AI-operable editing workflows.

## M3 — Frames, animation and onion skin

M3 turns the layer stack into an animation-capable cel model.

- Every layer owns one indexed cel per frame
- Add blank frames or duplicate the active frame
- Delete frames while preserving at least one frame
- Per-frame duration from 20–5000 ms
- Playback uses each frame's own duration
- Previous/next frame onion skin
- Pixel history now keys changes by `frameId + layerId + pixelIndex`
- Project format v3 with automatic v1/v2 migration
- PNG export targets the active composited frame
- Drawing and Command Engine are locked during playback

## M2 — Layers and compositing

- Add, select, delete, show/hide and reorder layers
- Visible topmost non-transparent pixel wins during compositing
- Drawing and Command Engine operations target the active layer
- PNG export uses the visible composite
- Layer-aware undo/redo
- Project format v2 with automatic v1 migration

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
- Pencil, eraser, picker and flood fill
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

Build:

```bash
npm run build
```

## Roadmap

- **M4:** Semantic regions, anchors and deterministic AI operator bridge
- **M5:** Pixel linting, isometric constraints and discipline profiles
