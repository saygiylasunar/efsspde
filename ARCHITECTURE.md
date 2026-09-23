# EFSS PDE Architecture

## Purpose

EFSS PDE owns the Comfy-side boundary between a decoded source image and a disciplined native pixel grid.

Its primary invariant is:

> Public convenience may be compact; internal reduction methods must remain explicit, independently testable and deterministic.

## Layer 1 — Primitive reduction

Primitive methods are the ground truth.

```text
area
nearest
medoid
median
dominant
phase
```

No primitive may silently become another primitive.

### Logical-cell partition

For a source axis length `S` and target length `T`, target cell `i` owns:

```text
start = floor(i * S / T)
end   = floor((i + 1) * S / T)
```

For valid reductions `T <= S`, this creates deterministic, non-empty, non-overlapping cells that cover the source axis exactly.

This removes the former integer-ratio-only restriction from medoid, median, dominant and phase methods.

### Source-fidelity classes

The primitive pool has two useful semantic groups.

Methods guaranteed to emit a real source sample:

```text
nearest
medoid
dominant
phase
```

Methods allowed to synthesize a representative RGB value:

```text
area
median
```

Median is channel-wise and can therefore create a channel combination that was not a literal source pixel.

## Layer 2 — Selectors

Selectors are allowed to choose primitive outputs, not redefine them.

### Compatibility adaptive selector

`EFSS Pixel Map (Compatibility)` retains the older three-way behavior:

```text
smooth cell      -> area
structured cell  -> medoid
hard edge        -> nearest
```

The difference from the older implementation is that medoid now genuinely exists for non-integer ratios instead of silently falling back to nearest.

### Disciplined selector

`EFSS Disciplined Downscale` scores all six primitive outputs using:

- local edge strength
- logical-cell variance
- neighborhood context
- profile bias
- contour priority
- soft-depth preference
- source-fidelity preference
- contour lock
- noise rejection

The selected output is gathered from the already-computed primitive candidate stack.

## Layer 3 — Palette

Palette is not a dependency of structural reduction.

```text
reduction geometry
       ≠
palette quantization
```

This separation keeps the geometry engine useful for:

- full-RGB pixel art
- art-directed fixed palettes
- post-reduction palette extraction
- experimental color pipelines

### Palette consolidation

Similar palette colors are grouped by threshold-connected components.

Each component is represented by its **medoid**, so consolidation selects an existing palette entry instead of averaging a new color into existence.

Transparent and opaque colors are never merged into the same component.

## Fail-closed rules

The engine rejects:

- malformed Comfy IMAGE tensors
- non-positive target dimensions
- target dimensions larger than the source
- unsupported primitive names
- invalid or empty palette contracts

Hidden method fallback is intentionally excluded.

## Compatibility surface

Legacy workflow tolerance is isolated to node wrappers.

Old `palette` and `indexed` arguments may be accepted and ignored, while the deterministic core remains unaware of legacy indexed payloads.

This keeps compatibility policy out of the reduction engine.

## Regression boundary

The immutable historical reference remains:

```text
golden/medoid-baseline-c4609aac
c4609aac010e6277f0e000ef034c41dfd56b48b3
```

Core-v2 tests extend that contract to arbitrary-ratio reduction and the expanded primitive pool.
