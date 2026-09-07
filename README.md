# EFSS PDE Nodes

Standalone ComfyUI custom-node package for deterministic pixel reduction and guidance.

This package owns only the Comfy-side conversion boundary. It intentionally does not include the EFSS PDE Tauri/React editor, browser UI, MCP Operator Bridge, or application runtime.

## Recommended core node

### EFSS Disciplined Downscale

The front-door node is intentionally simple:

```text
IMAGE
  ↓
EFSS Disciplined Downscale
  ↓
IMAGE
```

There is only one image socket in and one image socket out. Target size, resolver behavior and guidance are internal node widgets instead of extra wiring.

### Current candidate pool

The node evaluates multiple reduction candidates per logical target cell:

- **area** — stable smooth/depth representation, may invent averaged colors
- **nearest** — crisp source sample, useful for hard transitions
- **medoid** — real source pixel closest to the cell mean
- **median** — robust against local noise
- **dominant cluster** — coarse 5-bit RGB majority bin, returning a real source pixel
- **phase sampling** — 1 / 4 / 9 offset samples, resolved to the representative source sample

The resolver chooses among these candidates per target cell using local structure rather than forcing one global resize method over the whole image.

### Main controls

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
- `phase_samples`
- `contour_lock`
- `noise_rejection`

The current resolver uses local luma edge strength, source-cell color variance and contextual averaging to decide which candidate should own each logical pixel.

## Core philosophy

EFSS PDE treats downscale as a disciplined information-reduction problem, not merely a resize operation.

```text
large decoded IMAGE
        ↓
logical target cells
        ↓
candidate reduction methods
        ↓
local structural analysis
        ↓
per-cell resolver
        ↓
native pixel IMAGE
```

Sharp contours and soft/depth regions may therefore use different reduction behavior inside the same output image.

## Advanced nodes

Lower-level nodes remain available for experiments and explicit workflows:

- **EFSS Pixel Map**
- **EFSS Pixel Guide**
- **EFSS Pixel Canvas**
- **EFSS Pixel Preview**

These are not required for the recommended one-node downscale path.

## Optional palette layer

Palette is not a structural dependency.

- **EFSS Palette**
- **EFSS Auto Palette**
- **EFSS Palette Quantize**

Use palette quantization only when a fixed/reduced palette is actually part of the art direction.

Example:

```text
VAE Decode
   ↓
EFSS Disciplined Downscale
   ↓
[optional EFSS Palette Quantize]
   ↓
Save / Preview
```

## Learned sibling path

A learned downscale model is intentionally treated as a separate sibling implementation rather than an "AI mode" hidden inside the deterministic node.

See [LEARNED_DOWNSCALE.md](LEARNED_DOWNSCALE.md).

## Install

Clone or copy the package into:

```text
ComfyUI/custom_nodes/efsspde
```

Restart ComfyUI after installation.

No npm install is required. The current node package uses PyTorch supplied by ComfyUI.

## Scope

```text
VAE Decode / IMAGE
        ↓
EFSS deterministic or learned reduction boundary
        ↓
native-grid IMAGE
```

Prompt orchestration, editor runtime and MCP connectivity belong outside this package.
