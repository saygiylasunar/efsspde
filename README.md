# EFSS PDE Nodes

**EFSS PDE** is a standalone ComfyUI custom-node package for disciplined pixel reduction.

Instead of treating downscale as a single resize filter, EFSS PDE evaluates multiple reduction methods per logical target cell and resolves them according to local structure such as contour strength, variance, softness and source fidelity.

> Current development focus: **EFSS Disciplined Downscale**

## Golden baseline

The last known-good direct-method baseline is pinned at:

```text
golden/medoid-baseline-c4609aac
```

Commit:

```text
c4609aac010e6277f0e000ef034c41dfd56b48b3
```

This snapshot preserves the simple `nearest / area / medoid` behavior before adaptive and single-node resolver experiments. See [GOLDEN_BASELINE.md](GOLDEN_BASELINE.md) for the regression contract and comparison checklist.

## Quick workflow

```text
VAE Decode / IMAGE
        ↓
EFSS Disciplined Downscale
        ↓
native-grid IMAGE
        ↓
Preview / Save
```

The recommended node has only one image socket in and one image socket out. Target dimensions and behavior are controlled with node widgets, so the workflow stays compact.

## EFSS Disciplined Downscale

The node currently evaluates a candidate pool including:

- **Area** — stable for soft shading, blur and depth; may introduce averaged colors.
- **Nearest** — crisp and useful for hard transitions and contours.
- **Medoid** — selects a real source pixel closest to the logical cell mean.
- **Median** — robust against local noise.
- **Dominant Cluster** — detects a coarse RGB majority group and returns a real source pixel.
- **Phase Sampling** — evaluates 1 / 4 / 9 offset samples to reduce grid-alignment loss.

The resolver decides which candidate should own each output pixel instead of forcing one resize method over the entire image.

### Controls

- `target_width`
- `target_height`
- `profile`: balanced / crisp / soft / sprite / portrait
- `adaptive_strength`
- `contour_priority`
- `soft_depth`
- `source_fidelity`
- `edge_threshold`
- `variance_threshold`
- `context_radius`
- `phase_samples`: 1 / 4 / 9
- `contour_lock`
- `noise_rejection`

## Design principle

EFSS PDE treats downscale as **information reduction**, not merely image resizing.

```text
large IMAGE
   ↓
logical target cells
   ↓
candidate methods
   ↓
local analysis
   ↓
per-cell resolver
   ↓
native pixel IMAGE
```

A hard contour and a soft depth region can therefore use different reduction behavior inside the same result.

## Optional palette layer

Palette is intentionally **not** a structural dependency of the main pipeline.

Optional advanced nodes:

- **EFSS Palette**
- **EFSS Auto Palette**
- **EFSS Palette Quantize**

Use them only when fixed or reduced palette control is actually part of the art direction.

```text
EFSS Disciplined Downscale
        ↓
[optional Palette Quantize]
        ↓
IMAGE
```

## Advanced / low-level nodes

The lower-level building blocks remain available for explicit experiments:

- **EFSS Pixel Map**
- **EFSS Pixel Guide**
- **EFSS Pixel Canvas**
- **EFSS Pixel Preview**

They are not required for the recommended one-node path.

## Learned downscale sibling

A future learned model is planned as a **separate sibling node**, not as a hidden AI switch inside the deterministic resolver.

Possible implementation formats may include `.pth`, `.safetensors`, TorchScript or another suitable runtime format.

The learned path may use tiled inference similar to tiled upscale workflows, but in the opposite direction: each tile contributes to a disciplined native-grid reduction.

See [LEARNED_DOWNSCALE.md](LEARNED_DOWNSCALE.md).

## Installation

Clone the repository into ComfyUI custom nodes:

```text
ComfyUI/custom_nodes/efsspde
```

Then restart ComfyUI.

No `npm install` is required. The current custom-node package is Python-based and uses PyTorch provided by ComfyUI.

To update an existing clone:

```bash
git pull
```

Then restart ComfyUI.

## Scope

This package owns the Comfy-side pixel reduction boundary:

```text
VAE Decode / IMAGE
        ↓
EFSS reduction
        ↓
native-grid IMAGE
```

Editor UI, Tauri runtime, MCP connectivity and prompt orchestration belong outside this standalone node package.
