from __future__ import annotations

import re
from dataclasses import dataclass

import torch
import torch.nn.functional as F


DEFAULT_PALETTE = """#00000000
#18181B
#3F3F46
#71717A
#F4F4F5
#7C3AED
#DB2777
#DC2626
#EA580C
#EAB308
#16A34A
#0891B2
#2563EB
#A16207
#D6A57A
#8B5E3C"""

HEX_PATTERN = re.compile(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?")


@dataclass(frozen=True)
class PaletteSpec:
    hex_colors: tuple[str, ...]
    rgba: torch.Tensor
    transparent_index: int


def _validate_image(image: torch.Tensor) -> None:
    if image.ndim != 4 or image.shape[-1] != 3:
        raise ValueError(f"Expected Comfy IMAGE [B,H,W,3], got {tuple(image.shape)}")


def _parse_hex_color(value: str) -> tuple[float, float, float, float]:
    raw = value.lstrip("#")
    if len(raw) == 6:
        raw += "FF"
    channels = tuple(int(raw[index : index + 2], 16) / 255.0 for index in range(0, 8, 2))
    return channels  # type: ignore[return-value]


def _parse_palette(text: str) -> PaletteSpec:
    colors = tuple(match.upper() for match in HEX_PATTERN.findall(text))
    if len(colors) < 2:
        raise ValueError("EFSS Palette requires at least two #RRGGBB or #RRGGBBAA colors.")
    if len(colors) > 256:
        raise ValueError("EFSS Palette supports at most 256 colors.")

    rgba = torch.tensor([_parse_hex_color(color) for color in colors], dtype=torch.float32)
    transparent = torch.where(rgba[:, 3] <= 0.001)[0]
    transparent_index = int(transparent[0].item()) if len(transparent) else -1
    return PaletteSpec(colors, rgba, transparent_index)


def _palette_on(palette: PaletteSpec, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    return palette.rgba.to(device=device, dtype=dtype)


def _palette_from_rgb(rgb: torch.Tensor) -> PaletteSpec:
    rgb = rgb.detach().to(dtype=torch.float32).clamp(0.0, 1.0)
    luma = rgb[:, 0] * 0.299 + rgb[:, 1] * 0.587 + rgb[:, 2] * 0.114
    order = torch.argsort(luma)
    rgb = rgb[order]

    rgba = torch.cat(
        [rgb, torch.ones((rgb.shape[0], 1), device=rgb.device, dtype=rgb.dtype)],
        dim=1,
    )
    values = (rgb * 255.0).round().to(dtype=torch.uint8).cpu().tolist()
    colors = tuple(f"#{r:02X}{g:02X}{b:02X}" for r, g, b in values)
    return PaletteSpec(colors, rgba, -1)


def _extract_palette_kmeans(
    image: torch.Tensor,
    color_count: int,
    iterations: int,
    sample_limit: int,
) -> PaletteSpec:
    _validate_image(image)
    flat = image.reshape(-1, 3).to(dtype=torch.float32).clamp(0.0, 1.0)

    if flat.shape[0] > sample_limit:
        positions = torch.linspace(
            0,
            flat.shape[0] - 1,
            steps=sample_limit,
            device=flat.device,
        ).round().to(dtype=torch.long)
        flat = flat[positions]

    k = max(2, min(int(color_count), int(flat.shape[0])))

    mean = flat.mean(dim=0, keepdim=True)
    first_index = ((flat - mean) ** 2).sum(dim=1).argmin()
    centroids = [flat[first_index]]
    min_distance = ((flat - centroids[0]) ** 2).sum(dim=1)

    for _ in range(1, k):
        next_index = min_distance.argmax()
        next_centroid = flat[next_index]
        centroids.append(next_centroid)
        distance = ((flat - next_centroid) ** 2).sum(dim=1)
        min_distance = torch.minimum(min_distance, distance)

    centers = torch.stack(centroids, dim=0)

    for _ in range(iterations):
        distances = ((flat[:, None, :] - centers[None, :, :]) ** 2).sum(dim=-1)
        labels = distances.argmin(dim=1)
        updated = centers.clone()

        for index in range(k):
            members = flat[labels == index]
            if members.numel() > 0:
                updated[index] = members.mean(dim=0)

        if torch.max(torch.abs(updated - centers)).item() < 1e-5:
            centers = updated
            break
        centers = updated

    return _palette_from_rgb(centers)


def _resample_logical(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    mode: str,
) -> torch.Tensor:
    _validate_image(image)
    _, source_height, source_width, _ = image.shape

    if target_width <= 0 or target_height <= 0:
        raise ValueError("Target dimensions must be positive.")

    bchw = image.permute(0, 3, 1, 2)

    if mode == "area":
        sampled = F.interpolate(
            bchw,
            size=(target_height, target_width),
            mode="area",
        )
        return sampled.permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)

    if mode == "nearest":
        sampled = F.interpolate(
            bchw,
            size=(target_height, target_width),
            mode="nearest",
        )
        return sampled.permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)

    if mode == "medoid":
        if source_width % target_width != 0 or source_height % target_height != 0:
            raise ValueError(
                "medoid sampling requires source dimensions to be exact integer multiples "
                f"of the target grid; got {source_width}x{source_height} -> "
                f"{target_width}x{target_height}."
            )

        cell_width = source_width // target_width
        cell_height = source_height // target_height
        blocks = (
            image.reshape(
                image.shape[0],
                target_height,
                cell_height,
                target_width,
                cell_width,
                3,
            )
            .permute(0, 1, 3, 2, 4, 5)
            .reshape(
                image.shape[0],
                target_height,
                target_width,
                cell_height * cell_width,
                3,
            )
        )

        mean = blocks.mean(dim=3, keepdim=True)
        distance = ((blocks - mean) ** 2).sum(dim=-1)
        choice = distance.argmin(dim=3, keepdim=True)
        gather_index = choice.unsqueeze(-1).expand(-1, -1, -1, 1, 3)
        sampled = torch.gather(blocks, dim=3, index=gather_index).squeeze(3)
        return sampled.contiguous().clamp(0.0, 1.0)

    raise ValueError(f"Unsupported logical sampling mode: {mode}")


def _nearest_palette_indices(
    image: torch.Tensor,
    palette: PaletteSpec,
    metric: str,
) -> torch.Tensor:
    rgba = _palette_on(palette, image.device, image.dtype)
    candidate_indices = torch.arange(rgba.shape[0], device=image.device)

    if palette.transparent_index >= 0:
        candidate_indices = candidate_indices[candidate_indices != palette.transparent_index]
    if candidate_indices.numel() == 0:
        raise ValueError("Palette must contain at least one non-transparent color.")

    candidate_rgb = rgba[candidate_indices, :3]
    flat = image.reshape(-1, 3)
    weights = torch.tensor(
        [0.299, 0.587, 0.114] if metric == "luma_weighted" else [1.0, 1.0, 1.0],
        device=image.device,
        dtype=image.dtype,
    )

    result: list[torch.Tensor] = []
    chunk_size = 65_536
    for start in range(0, flat.shape[0], chunk_size):
        chunk = flat[start : start + chunk_size]
        distance = ((chunk[:, None, :] - candidate_rgb[None, :, :]) ** 2 * weights).sum(dim=-1)
        nearest = distance.argmin(dim=-1)
        result.append(candidate_indices[nearest])

    return torch.cat(result, dim=0).reshape(image.shape[0], image.shape[1], image.shape[2])


def _render_palette_indices(
    indices: torch.Tensor,
    palette: PaletteSpec,
    dtype: torch.dtype,
) -> torch.Tensor:
    rgba = _palette_on(palette, indices.device, torch.float32)
    return rgba[:, :3][indices].clamp(0.0, 1.0).to(dtype=dtype)


def _shift_image(
    image: torch.Tensor,
    dy: int,
    dx: int,
) -> tuple[torch.Tensor, torch.Tensor]:
    batch, height, width, channels = image.shape
    shifted = torch.zeros_like(image)
    valid = torch.zeros((batch, height, width), device=image.device, dtype=torch.bool)

    src_y0 = max(0, -dy)
    src_y1 = min(height, height - dy)
    src_x0 = max(0, -dx)
    src_x1 = min(width, width - dx)
    dst_y0 = max(0, dy)
    dst_y1 = min(height, height + dy)
    dst_x0 = max(0, dx)
    dst_x1 = min(width, width + dx)

    if src_y1 > src_y0 and src_x1 > src_x0:
        shifted[:, dst_y0:dst_y1, dst_x0:dst_x1, :] = image[:, src_y0:src_y1, src_x0:src_x1, :]
        valid[:, dst_y0:dst_y1, dst_x0:dst_x1] = True

    return shifted, valid


def _guide_rgb(
    image: torch.Tensor,
    passes: int,
    min_similar_neighbors: int,
    similarity_threshold: float,
) -> tuple[torch.Tensor, int]:
    _validate_image(image)
    work = image.clone()
    changed_total = 0
    offsets = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),             (0, 1),
        (1, -1),  (1, 0),   (1, 1),
    ]
    weights = torch.tensor(
        [0.299, 0.587, 0.114],
        device=image.device,
        dtype=image.dtype,
    )
    threshold_sq = float(similarity_threshold) ** 2

    for _ in range(passes):
        shifted_pairs = [_shift_image(work, dy, dx) for dy, dx in offsets]
        neighbors = torch.stack([pair[0] for pair in shifted_pairs], dim=0)
        valid = torch.stack([pair[1] for pair in shifted_pairs], dim=0)

        current_distance = (
            (neighbors - work.unsqueeze(0)) ** 2 * weights.view(1, 1, 1, 1, 3)
        ).sum(dim=-1)
        similar = valid & (current_distance <= threshold_sq)
        similar_count = similar.sum(dim=0)
        weak = similar_count < min_similar_neighbors

        valid_float = valid.to(dtype=work.dtype).unsqueeze(-1)
        neighbor_count = valid_float.sum(dim=0).clamp_min(1.0)
        mean = (neighbors * valid_float).sum(dim=0) / neighbor_count

        candidate_distance = (
            (neighbors - mean.unsqueeze(0)) ** 2 * weights.view(1, 1, 1, 1, 3)
        ).sum(dim=-1)
        candidate_distance = torch.where(
            valid,
            candidate_distance,
            torch.full_like(candidate_distance, float("inf")),
        )
        choice = candidate_distance.argmin(dim=0)
        gather_index = choice.unsqueeze(0).unsqueeze(-1).expand(1, -1, -1, -1, 3)
        replacement = torch.gather(neighbors, dim=0, index=gather_index).squeeze(0)

        replacement_distance = (
            (replacement - work) ** 2 * weights.view(1, 1, 1, 3)
        ).sum(dim=-1)
        change_mask = weak & (replacement_distance > 1e-10)

        changed = int(change_mask.sum().item())
        if changed == 0:
            break

        work = torch.where(change_mask.unsqueeze(-1), replacement, work)
        changed_total += changed

    return work.clamp(0.0, 1.0), changed_total


class EFSSPixelCanvas:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_width": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "target_height": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "cell_scale": ("INT", {"default": 16, "min": 1, "max": 64, "step": 1}),
                "latent_alignment": (["8", "16", "32", "64"], {"default": "8"}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("generation_width", "generation_height", "target_width", "target_height", "cell_scale")
    FUNCTION = "calculate"
    CATEGORY = "EFSS PDE/Setup"

    def calculate(self, target_width: int, target_height: int, cell_scale: int, latent_alignment: str):
        generation_width = target_width * cell_scale
        generation_height = target_height * cell_scale
        alignment = int(latent_alignment)
        if generation_width % alignment != 0 or generation_height % alignment != 0:
            raise ValueError(
                f"Generation canvas {generation_width}x{generation_height} is not aligned to {alignment}. "
                "Choose a different cell_scale or target grid."
            )
        return (generation_width, generation_height, target_width, target_height, cell_scale)


class EFSSPixelMap:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_width": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "target_height": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "sampling": (["medoid", "area", "nearest"], {"default": "medoid"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pixel_image",)
    FUNCTION = "map_pixels"
    CATEGORY = "EFSS PDE/Pixel"

    def map_pixels(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        sampling: str,
    ):
        sampled = _resample_logical(
            image,
            target_width=target_width,
            target_height=target_height,
            mode=sampling,
        )
        return (sampled.to(dtype=image.dtype),)


class EFSSPixelGuide:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "passes": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
                "min_similar_neighbors": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
                "similarity_threshold": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 0.5, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("guided_image", "changed_pixels")
    FUNCTION = "guide"
    CATEGORY = "EFSS PDE/Pixel"

    def guide(
        self,
        image: torch.Tensor,
        passes: int,
        min_similar_neighbors: int,
        similarity_threshold: float,
    ):
        guided, changed = _guide_rgb(
            image,
            passes=passes,
            min_similar_neighbors=min_similar_neighbors,
            similarity_threshold=similarity_threshold,
        )
        return (guided.to(dtype=image.dtype), changed)


class EFSSPixelPreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "scale": ("INT", {"default": 8, "min": 1, "max": 64, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("preview",)
    FUNCTION = "preview"
    CATEGORY = "EFSS PDE/Pixel"

    def preview(self, image: torch.Tensor, scale: int):
        _validate_image(image)
        bchw = image.permute(0, 3, 1, 2)
        output = F.interpolate(bchw, scale_factor=scale, mode="nearest")
        return (output.permute(0, 2, 3, 1).contiguous(),)


class EFSSPalette:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "palette_text": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": DEFAULT_PALETTE,
                    },
                ),
            }
        }

    RETURN_TYPES = ("EFSS_PALETTE", "INT", "STRING")
    RETURN_NAMES = ("palette", "color_count", "normalized_hex")
    FUNCTION = "build"
    CATEGORY = "EFSS PDE/Advanced"

    def build(self, palette_text: str):
        palette = _parse_palette(palette_text)
        return (palette, len(palette.hex_colors), "\n".join(palette.hex_colors))


class EFSSAutoPalette:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "color_count": ("INT", {"default": 16, "min": 2, "max": 64, "step": 1}),
                "iterations": ("INT", {"default": 8, "min": 1, "max": 32, "step": 1}),
            }
        }

    RETURN_TYPES = ("EFSS_PALETTE", "INT", "STRING")
    RETURN_NAMES = ("palette", "color_count", "normalized_hex")
    FUNCTION = "extract"
    CATEGORY = "EFSS PDE/Advanced"

    def extract(
        self,
        image: torch.Tensor,
        color_count: int,
        iterations: int,
    ):
        palette = _extract_palette_kmeans(
            image,
            color_count=color_count,
            iterations=iterations,
            sample_limit=16_384,
        )
        return (palette, len(palette.hex_colors), "\n".join(palette.hex_colors))


class EFSSPaletteQuantize:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "palette": ("EFSS_PALETTE",),
                "distance_metric": (["luma_weighted", "rgb"], {"default": "luma_weighted"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("quantized_image",)
    FUNCTION = "quantize"
    CATEGORY = "EFSS PDE/Advanced"

    def quantize(
        self,
        image: torch.Tensor,
        palette: PaletteSpec,
        distance_metric: str,
    ):
        _validate_image(image)
        indices = _nearest_palette_indices(image, palette, distance_metric)
        return (_render_palette_indices(indices, palette, image.dtype),)


NODE_CLASS_MAPPINGS = {
    "EFSSPDE_PixelCanvas": EFSSPixelCanvas,
    "EFSSPDE_PixelMap": EFSSPixelMap,
    "EFSSPDE_PixelGuide": EFSSPixelGuide,
    "EFSSPDE_PixelPreview": EFSSPixelPreview,
    "EFSSPDE_Palette": EFSSPalette,
    "EFSSPDE_AutoPalette": EFSSAutoPalette,
    "EFSSPDE_PaletteQuantize": EFSSPaletteQuantize,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EFSSPDE_PixelCanvas": "EFSS Pixel Canvas",
    "EFSSPDE_PixelMap": "EFSS Pixel Map",
    "EFSSPDE_PixelGuide": "EFSS Pixel Guide",
    "EFSSPDE_PixelPreview": "EFSS Pixel Preview",
    "EFSSPDE_Palette": "EFSS Palette",
    "EFSSPDE_AutoPalette": "EFSS Auto Palette",
    "EFSSPDE_PaletteQuantize": "EFSS Palette Quantize",
}
