# EFSS PDE Nodes

Standalone ComfyUI custom-node package for deterministic pixel mapping and guiding.

This branch intentionally contains only the ComfyUI node package. It does not include the EFSS PDE Tauri/React editor, browser UI, MCP Operator Bridge, or application runtime.

## Core nodes

- **EFSS Pixel Canvas** — maps a native target grid to an integer-aligned generation canvas.
- **EFSS Pixel Map** — converts a Comfy IMAGE to the exact native target grid using medoid / area / nearest sampling.
- **EFSS Pixel Guide** — palette-free RGB neighborhood cleanup on the native grid.
- **EFSS Pixel Preview** — integer nearest-neighbor preview scaling.

## Optional palette nodes

Palette control is no longer part of the required path.

- **EFSS Palette**
- **EFSS Auto Palette**
- **EFSS Palette Quantize**

Use them only when a fixed or reduced palette is actually desired.

## Intended workflow

```text
Prompt / Conditioning
        ↓
Model / Sampler
        ↓
VAE Decode
        ↓
EFSS Pixel Map
        ↓
[optional: Palette Quantize]
        ↓
EFSS Pixel Guide
        ↓
native pixel output
        ↓
EFSS Pixel Preview / Save Image
```

## Sampling

### medoid
Recommended default for strict pixel work. Each logical cell chooses the real source pixel closest to that cell's mean RGB. It preserves a representative source color without inventing a new averaged color.

Requires source dimensions to be exact integer multiples of the target grid.

### area
Averages each target cell. Stable, but can create intermediate colors.

### nearest
Takes one source sample. Fast and crisp, but can miss thin features.

## Pixel Guide

The guide no longer depends on palette indices.

It compares each native pixel with its 8 neighbors in weighted RGB space. A pixel with too few similar neighbors is considered weak and may be replaced by a representative real neighboring color.

Key controls:

- `passes`
- `min_similar_neighbors`
- `similarity_threshold`

This keeps palette as an optional art-direction layer rather than a structural dependency.

## Install

Clone or copy this package into:

```text
ComfyUI/custom_nodes/efsspde_nodes
```

Restart ComfyUI after installation.

## Scope

This package owns only the Comfy-side conversion boundary:

```text
VAE Decode / IMAGE
        ↓
EFSS pixel mapping + guiding
        ↓
strict native-grid output
```

Editor UI, Tauri, MCP connectivity, prompt orchestration and other EFSS PDE application code belong elsewhere.
