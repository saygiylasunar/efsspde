# Changelog

## 0.2.0 — Core v2

### Reduction engine

- Split deterministic image-reduction logic into `core.py`.
- Added **EFSS Primitive Downscale** as the direct method-testing surface.
- Promoted area / nearest / medoid / median / dominant / phase to explicit primitives.
- Added deterministic arbitrary-ratio logical-cell partitioning.
- Removed silent non-integer `medoid -> nearest` substitution.
- Made the disciplined resolver select from actual primitive outputs.
- Added fail-closed protection against accidental upscaling.

### Palette

- Added **EFSS Palette Inspector**.
- Added **EFSS Palette Preview**.
- Added **EFSS Palette Consolidate**.
- Consolidation uses existing-color medoids instead of averaged replacement colors.
- Preserved deterministic Auto Palette extraction and chunked palette quantization.

### Compatibility

- Retained legacy Pixel Map `EFSS_INDEXED` output slot.
- Accept and ignore obsolete Pixel Map `palette` arguments.
- Accept and ignore obsolete Pixel Guide `indexed` arguments.
- Reclassified Pixel Map as an advanced compatibility surface.

### Quality

- Added PyTorch regression tests for exact and non-integer reduction.
- Added determinism and source-fidelity assertions.
- Added node-registry and legacy-call tests.
- Expanded GitHub Actions from compile-only checks to real regression tests.
- Updated Comfy package metadata and version to `0.2.0`.

### Documentation

- Reworked README around layered primitives and selectors.
- Added `ARCHITECTURE.md`.
- Kept the historical golden baseline immutable.
