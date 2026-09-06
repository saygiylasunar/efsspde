# EFSS PDE

**Ersen Filiz Saygıyla Sunar's Pixel Discipline Editor (PDE)**

EFSS PDE is a deterministic, grid-first pixel-art editor aimed at game-ready assets and AI-operable editing workflows. The editor treats pixels as indexed data instead of asking a generative image model to imitate pixel art.

## M1 — Command Engine

M1 introduces the deterministic operation layer that human UI actions and future AI operators can share.

Supported operations:

- `set_pixel`
- `clear_pixel`
- `paint_stroke`
- `fill`
- `move_region`
- `replace_color`
- `flip_x`
- `flip_y`

Commands are validated before execution. JSON arrays run as one transaction, produce a pixel-diff summary and can be reverted with one Undo.

Example:

```json
[
  {
    "op": "paint_stroke",
    "color": 5,
    "points": [
      { "x": 8, "y": 10 },
      { "x": 9, "y": 10 }
    ]
  },
  {
    "op": "set_pixel",
    "x": 9,
    "y": 11,
    "color": 6
  }
]
```

## M0 — First Pixel

- Native indexed pixel canvas
- Pencil, eraser, eyedropper and flood fill
- Indexed 16-color palette with transparent index 0
- Integer zoom and optional pixel grid
- Stroke-based undo / redo
- Native-resolution PNG export
- JSON project save / load
- React + TypeScript + Vite frontend
- Tauri 2 desktop shell
- Zustand UI state
- `Uint8Array` pixel buffer

## Development

```bash
npm install
npm run dev
```

Desktop development:

```bash
npm run tauri:dev
```

Production frontend build:

```bash
npm run build
```

## Roadmap

- **M2:** Layers and compositing
- **M3:** Frames, animation and onion skin
- **M4:** Semantic regions, anchors and deterministic AI operator bridge
- **M5:** Pixel linting, isometric constraints and discipline profiles
