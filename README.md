# EFSS PDE Nodes

**EFSS PDE** is a standalone ComfyUI custom-node package for deterministic, structure-aware pixel reduction.

The project treats downscaling as **information reduction**, not as a single resize filter. Its engine keeps direct reduction methods independently testable, then lets an optional resolver choose among those real methods per logical target cell.

## Design contract

The core is deliberately layered:

```text
stable primitive methods
        ↓
optional adaptive / disciplined selector
        ↓
native-grid IMAGE
```

A named primitive must execute that primitive. The resolver may choose among primitives, but it must not silently redefine or substitute them.

The historical regression reference remains pinned at:

```text
golden/medoid-baseline-c4609aac
c4609aac010e6277f0e000ef034c41dfd56b48b3
```

See [GOLDEN_BASELINE.md](GOLDEN_BASELINE.md) for the original contract.

## Recommended workflow

```text
VAE Decode / IMAGE
        ↓
EFSS Disciplined Downscale
        ↓
native-grid IMAGE
        ↓
[optional Palette Quantize]
        ↓
Preview / Save
```

For method comparison, regression work, or strict manual control use **EFSS Primitive Downscale** instead.

## EFSS Primitive Downscale

This node exposes every deterministic reduction method directly:

- **area** — logical-cell mean; stable for soft shading, but may invent averaged colors.
- **nearest** — crisp nearest source sample.
- **medoid** — real source pixel closest to the logical-cell mean.
- **median** — per-channel median for local noise resistance.
- **dominant** — real source pixel from the dominant coarse RGB cluster.
- **phase** — real source sample selected from 1 / 4 / 9 internal phase positions.

### Arbitrary-ratio logical cells

Primitive methods now support non-integer reductions such as:

```text
768x1024 -> 108x144
```

The source image is partitioned into deterministic, non-overlapping logical cells using integer boundaries. Source-sensitive methods operate on the actual pixels owned by each cell.

There is no silent `medoid -> nearest` fallback.

Upscaling is rejected: EFSS PDE is a reduction engine.

## EFSS Disciplined Downscale

The disciplined node evaluates the same real primitive pool per logical target cell:

```text
area
nearest
medoid
median
dominant
phase
   ↓
edge + variance + local context
   ↓
profile-weighted resolver
   ↓
native-grid IMAGE
```

Controls:

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

The resolver is a selector over explicit primitives; it is not a replacement implementation for them.

## Palette tools

Palette remains optional and structurally separate from geometry/reduction.

Available nodes:

- **EFSS Palette** — build an explicit 2–256 color palette from HEX.
- **EFSS Auto Palette** — deterministic K-Means palette extraction.
- **EFSS Palette Quantize** — map an image to an EFSS palette.
- **EFSS Palette Inspector** — report exact 8-bit unique colors and pixel usage.
- **EFSS Palette Preview** — render palette swatches inside ComfyUI.
- **EFSS Palette Consolidate** — merge nearby palette colors while choosing a real existing palette color as the group medoid.

```text
Disciplined / Primitive Downscale
              ↓
      [optional palette tools]
              ↓
            IMAGE
```

## Supporting nodes

- **EFSS Pixel Canvas** — calculate integer-aligned generation dimensions.
- **EFSS Pixel Guide** — conservative RGB-neighborhood cleanup.
- **EFSS Pixel Preview** — integer nearest-neighbor preview scaling.
- **EFSS Pixel Map (Compatibility)** — advanced/legacy mapping surface retained for older workflows.

## Legacy workflow compatibility

Older workflows may still contain stale:

- `palette` input on Pixel Map
- `EFSS_INDEXED` output links from Pixel Map
- `indexed` input on Pixel Guide

The compatibility surface accepts these obsolete values so saved workflows do not fail immediately after upgrading.

New workflows should use **EFSS Primitive Downscale** or **EFSS Disciplined Downscale** and should not build new dependencies on legacy indexed wiring.

## Determinism and source fidelity

The package deliberately avoids random palette initialization and hidden method fallback.

Regression tests cover:

- exact-ratio medoid determinism
- non-integer reduction for all primitives
- source-pixel fidelity for nearest / medoid / dominant / phase
- fail-closed upscale behavior
- disciplined-resolver determinism
- deterministic auto-palette extraction
- palette inspection / preview / consolidation
- legacy node-call compatibility

See [ARCHITECTURE.md](ARCHITECTURE.md) for the engine contract.

## Learned downscale sibling

A future learned implementation remains a separate sibling concept rather than a hidden AI switch in the deterministic node.

See [LEARNED_DOWNSCALE.md](LEARNED_DOWNSCALE.md).

## Installation

### ComfyUI Manager / Registry

Package metadata is defined in `pyproject.toml` under the **saygiylasunar** publisher.

### Manual

Clone into your ComfyUI custom nodes directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/saygiylasunar/efsspde.git
```

Restart ComfyUI after installation or update.

To update:

```bash
git pull
```

No `npm install` is required. Runtime PyTorch is supplied by ComfyUI.

## Development

CI compiles the package and runs the PyTorch regression suite.

Local test example:

```bash
python -m pip install pytest
pytest -q tests
```

The repository's standalone Comfy node boundary is:

```text
VAE Decode / IMAGE
        ↓
EFSS reduction
        ↓
native-grid IMAGE
```

Editor UI, Tauri runtime, MCP connectivity and prompt orchestration belong outside this standalone node package.
