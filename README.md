# EFSS PDE

**Ersen Filiz Saygıyla Sunar's Pixel Discipline Editor (PDE)**

EFSS PDE is a deterministic, grid-first pixel-art editor aimed at game-ready assets and AI-operable editing workflows. The editor treats pixels as indexed data instead of asking a generative image model to imitate pixel art.

## M0 — First Pixel

The first milestone provides a usable single-layer indexed-pixel editor:

- 24×40 default native canvas (custom 1–512 px dimensions)
- Pencil, eraser, eyedropper and flood fill
- Indexed 16-color palette with transparent index 0
- Integer zoom and optional pixel grid
- Stroke-based undo / redo
- Native-resolution PNG export
- JSON project save / load
- React + TypeScript + Vite frontend
- Tauri 2 desktop shell
- Zustand for editor UI state
- `Uint8Array` pixel buffer for deterministic pixel data

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

## Architecture direction

The M0 editor deliberately keeps the pixel core independent from React state. Future milestones will add layers, frames, semantic regions, command operations, pixel linting, isometric constraints and AI-generated deterministic edit commands.
