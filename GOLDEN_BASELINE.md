# EFSS PDE Golden Baseline

This document pins the last known-good deterministic reduction baseline before the adaptive/single-node resolver experiments changed method behavior.

## Golden branch

```text
golden/medoid-baseline-c4609aac
```

Pinned commit:

```text
c4609aac010e6277f0e000ef034c41dfd56b48b3
```

Commit title:

```text
feat: add medoid logical sampling
```

## Why this baseline exists

At this point the core reduction methods were still direct and inspectable:

- `nearest`
- `area`
- `medoid`

Selecting a method meant that method actually executed. There was no per-cell score resolver, no candidate substitution, and no silent method blending.

Later experiments introduced adaptive selection and then a single-node resolver. Those ideas are still valuable, but they also made it harder to tell whether a requested method was truly running or had been replaced/fallen back internally.

## Regression rule

Future refactors should preserve this contract:

> A named reduction method must remain independently testable and deterministic before it is used by any adaptive or learned resolver.

Adaptive systems may choose among methods, but they should not redefine the methods themselves.

## Comparison checklist

When evaluating a new downscale engine against the golden baseline, compare at least:

1. hard contour continuity
2. thin-line survival
3. soft/depth transition quality
4. source-color fidelity
5. behavior on flat-color regions
6. behavior on noisy/texture-heavy regions
7. output determinism across repeated runs
8. exact target dimensions
9. integer-ratio and non-integer-ratio source/target pairs

Useful reference targets include:

```text
720x900  -> 72x90
512x512  -> 32x32
768x1024 -> 108x144
```

The first two are exact integer-ratio cases. The third is intentionally non-integer and should be used to expose hidden fallbacks or assumptions.

## Development rule of thumb

Keep the public workflow compact if desired, but keep the engine layered internally:

```text
stable methods
    ↓
optional adaptive selector
    ↓
optional learned selector/model
```

The UI can be one node without forcing the implementation to become one opaque algorithm.

## Restore / inspect

To inspect the golden implementation locally:

```bash
git fetch
git switch golden/medoid-baseline-c4609aac
```

Do not advance or rewrite this branch. Treat it as a reference snapshot.
