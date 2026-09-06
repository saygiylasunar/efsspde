# EFSS PDE Nodes for ComfyUI

Small deterministic node pack that constrains the final stages of an image-generation workflow toward EFSS PDE pixel output.

## Nodes

### EFSS Pixel Canvas
Calculates an integer generation canvas from the target native pixel grid.

Example:

```text
target 32×32
cell_scale 16
→ generation canvas 512×512
```

The node rejects dimensions that violate the selected latent alignment instead of silently rounding them.

### EFSS Palette
Parses 2–256 `#RRGGBB` / `#RRGGBBAA` entries and exposes an `EFSS_PALETTE` object.

The first fully transparent palette entry is remembered as the transparent index. RGB images are **not** automatically mapped to transparency because Comfy `IMAGE` has no alpha channel.

### EFSS Pixel Map
Designed to sit after `VAE Decode`.

```text
VAE Decode IMAGE
      ↓
EFSS Pixel Map
      ↓
native target grid + exact palette indices
```

Processing:

1. Downsample the decoded IMAGE to the exact target grid using area or nearest sampling.
2. Project every logical pixel to the closest allowed palette color.
3. Return both a normal Comfy `IMAGE` and an exact `EFSS_INDEXED` payload.

### EFSS Pixel Guide
Conservative deterministic cluster cleanup over `EFSS_INDEXED` data.

The default `majority_only` mode only changes a weak pixel when at least two neighboring pixels agree on a replacement color.

### EFSS Pixel Preview
Integer nearest-neighbor preview scaling. It never changes the native mapped image.

## Suggested workflow

```text
EFSS Pixel Canvas ─────────────→ Empty Latent dimensions
                                   ↓
Prompt → Model → Sampler → VAE Decode
                                   ↓
EFSS Palette ─────────────→ EFSS Pixel Map
                                   ↓
                           EFSS Pixel Guide
                             ↙           ↘
                       Save Image   EFSS Pixel Preview
```

## Local install from the EFSS PDE monorepo

Run from the repository root on Windows:

```powershell
.\scripts\install_comfy_nodes.ps1 -ComfyRoot "D:\ComfyUI_windows_portable"
```

The script accepts either the portable root containing `ComfyUI\custom_nodes` or the `ComfyUI` directory itself.

Restart ComfyUI after installation.

## Status

This is the first local/monorepo package. Once the node API stabilizes, it can be split into its own Registry-ready repository.
