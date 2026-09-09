# EFSS Learned Downscale — design note

This is a planned sibling to **EFSS Disciplined Downscale**.

It should not be implemented as a hidden switch inside the deterministic node.

## Contract

```text
IMAGE
  ↓
EFSS Learned Downscale
  ↓
IMAGE
```

The external contract should stay similarly simple while the internal engine is learned rather than heuristic.

## Intended role

The learned model should learn how to preserve pixel-relevant information during reduction, for example:

- contour continuity
- hard transitions
- thin features
- local depth/shading structure
- source-color fidelity
- texture suppression

A first useful learned system may act as a **resolver/policy model** over deterministic candidate reductions rather than redrawing the image from scratch.

That keeps the learned path controllable and comparable with the pure mathematical path.

## Tiled execution

The learned node may use tiled inference in the same spirit as tiled upscale nodes:

```text
source IMAGE
   ↓
overlapping source tiles
   ↓
learned reduction per tile
   ↓
overlap-aware reconciliation
   ↓
native-grid IMAGE
```

Potential widgets:

- model
- target width / height
- tile size
- overlap
- strength
- contour bias
- depth bias
- detail bias

Exact controls should be decided only after the model architecture exists.

## Model format

Do not hard-bind the design to `.pth`.

Possible deployment formats may include:

- PyTorch state dict (`.pth`)
- safetensors
- TorchScript
- another runtime format that proves more appropriate

The node contract matters more than the container format.

## Relationship to deterministic downscale

```text
EFSS Disciplined Downscale
        ≠
EFSS Learned Downscale
```

They solve the same high-level reduction problem through different engines.

A future hybrid is possible:

```text
deterministic candidate stack
          +
learned resolver
          ↓
native-grid IMAGE
```

but hybridization is explicitly out of scope until both sibling approaches can be evaluated independently.
