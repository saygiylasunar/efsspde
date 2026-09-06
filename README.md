# EFSS PDE Nodes

Standalone ComfyUI custom-node package for deterministic pixel mapping and guiding.

This branch intentionally contains **only the ComfyUI node package**. It does not include the EFSS PDE Tauri/React editor, browser UI, MCP Operator Bridge, or application runtime.

## Nodes

- **EFSS Pixel Canvas** — maps a native target grid to an integer-aligned generation canvas.
- **EFSS Palette** — optional manual 2–256 color palette contract.
- **EFSS Auto Palette** — extracts a deterministic palette from the decoded image at the logical target scale.
- **EFSS Pixel Map** — maps a decoded Comfy `IMAGE` to the exact target grid and exact palette indices.
- Logical sampling modes: **medoid** (recommended), **area**, and **nearest**.
- **EFSS Pixel Guide** — conservative deterministic neighborhood cleanup on indexed pixels.
- **EFSS Pixel Preview** — integer nearest-neighbor preview scaling.

## Intended workflow

```text
Prompt / Conditioning
        ↓
Model / Sampler
        ↓
VAE Decode ─────→ EFSS Auto Palette
        │                 │
        └────────────→ EFSS Pixel Map
                          ↓
                   EFSS Pixel Guide
                          ↓
                  native pixel output
                          ↓
             EFSS Pixel Preview / Save Image
```

If you already have an art-directed palette, replace **EFSS Auto Palette** with the manual **EFSS Palette** node.

`EFSS Pixel Canvas` can be used earlier in the workflow to calculate generation dimensions from a native target size and integer cell scale.

## Install

Clone or copy this package into:

```text
ComfyUI/custom_nodes/efsspde_nodes
```

For a Windows portable install from a checkout of this branch:

```powershell
.\install.ps1 -ComfyRoot "D:\ComfyUI_windows_portable"
```

Restart ComfyUI after installation.

## Scope

This package owns only the Comfy-side pixel conversion boundary:

```text
VAE Decode / IMAGE
        ↓
EFSS pixel mapping + guiding
        ↓
strict native-grid output
```

Editor UI, Tauri, MCP connectivity, prompt orchestration and other EFSS PDE application code belong elsewhere.


## Logical sampling

### medoid
Recommended default for strict pixel work. Each logical target cell chooses the real source pixel closest to that cell's mean RGB. This preserves cell-level structure without inventing an averaged color.

`medoid` requires source width and height to be exact integer multiples of the target grid. This is intentional: generated canvases should normally be derived from **EFSS Pixel Canvas**.

### area
Averages each target cell. Stable for photographic reduction, but may create intermediate colors that never existed in the source.

### nearest
Takes a single source sample. Fast and crisp, but can miss thin features depending on sampling position.

Auto Palette and Pixel Map should normally use the **same sampling mode and target dimensions**.
