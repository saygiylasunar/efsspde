# EFSS PDE Nodes

Standalone ComfyUI custom-node package for deterministic pixel mapping and guiding.

This branch intentionally contains **only the ComfyUI node package**. It does not include the EFSS PDE Tauri/React editor, browser UI, MCP Operator Bridge, or application runtime.

## Nodes

- **EFSS Pixel Canvas** — maps a native target grid to an integer-aligned generation canvas.
- **EFSS Palette** — defines an exact 2–256 color palette contract.
- **EFSS Pixel Map** — maps a decoded Comfy `IMAGE` to the exact target grid and exact palette indices.
- **EFSS Pixel Guide** — conservative deterministic neighborhood cleanup on indexed pixels.
- **EFSS Pixel Preview** — integer nearest-neighbor preview scaling.

## Intended workflow

```text
Prompt / Conditioning
        ↓
Model / Sampler
        ↓
VAE Decode
        ↓
EFSS Pixel Map ← EFSS Palette
        ↓
EFSS Pixel Guide
        ↓
native pixel output
        ↓
EFSS Pixel Preview / Save Image
```

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
