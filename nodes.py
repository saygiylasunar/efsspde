from __future__ import annotations

import torch
import torch.nn.functional as F

from .core import (
    DEFAULT_PALETTE,
    PRIMITIVE_METHODS,
    PaletteSpec,
    adaptive_resample,
    consolidate_palette,
    disciplined_downscale,
    extract_palette_kmeans,
    guide_rgb,
    inspect_palette,
    nearest_palette_indices,
    palette_preview,
    parse_palette,
    reduce_primitive,
    render_palette_indices,
    validate_image,
)


def _legacy_indexed_payload(image: torch.Tensor) -> dict[str, object]:
    return {
        "version": 2,
        "image": image,
        "width": int(image.shape[2]),
        "height": int(image.shape[1]),
    }


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


class EFSSPrimitiveDownscale:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_width": ("INT", {"default": 72, "min": 1, "max": 2048, "step": 1}),
                "target_height": ("INT", {"default": 90, "min": 1, "max": 2048, "step": 1}),
                "method": (list(PRIMITIVE_METHODS), {"default": "medoid"}),
                "phase_samples": (["1", "4", "9"], {"default": "4"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "downscale"
    CATEGORY = "EFSS PDE"

    def downscale(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        method: str,
        phase_samples: str,
    ):
        output = reduce_primitive(
            image,
            target_width=target_width,
            target_height=target_height,
            method=method,
            phase_samples=int(phase_samples),
        )
        return (output.to(dtype=image.dtype),)


class EFSSDisciplinedDownscale:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_width": ("INT", {"default": 72, "min": 1, "max": 2048, "step": 1}),
                "target_height": ("INT", {"default": 90, "min": 1, "max": 2048, "step": 1}),
                "profile": (
                    ["balanced", "crisp", "soft", "sprite", "portrait"],
                    {"default": "balanced"},
                ),
                "adaptive_strength": (
                    "FLOAT",
                    {"default": 0.75, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "contour_priority": (
                    "FLOAT",
                    {"default": 0.70, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "soft_depth": (
                    "FLOAT",
                    {"default": 0.45, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "source_fidelity": (
                    "FLOAT",
                    {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "edge_threshold": (
                    "FLOAT",
                    {"default": 0.045, "min": 0.001, "max": 0.25, "step": 0.001},
                ),
                "variance_threshold": (
                    "FLOAT",
                    {"default": 0.012, "min": 0.001, "max": 0.10, "step": 0.001},
                ),
                "context_radius": (
                    "INT",
                    {"default": 1, "min": 0, "max": 4, "step": 1},
                ),
                "phase_samples": (["1", "4", "9"], {"default": "4"}),
                "contour_lock": (
                    "FLOAT",
                    {"default": 0.50, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "noise_rejection": (
                    "FLOAT",
                    {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "downscale"
    CATEGORY = "EFSS PDE"

    def downscale(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        profile: str,
        adaptive_strength: float,
        contour_priority: float,
        soft_depth: float,
        source_fidelity: float,
        edge_threshold: float,
        variance_threshold: float,
        context_radius: int,
        phase_samples: str,
        contour_lock: float,
        noise_rejection: float,
    ):
        output = disciplined_downscale(
            image,
            target_width=target_width,
            target_height=target_height,
            profile=profile,
            adaptive_strength=adaptive_strength,
            contour_priority=contour_priority,
            soft_depth=soft_depth,
            source_fidelity=source_fidelity,
            edge_threshold=edge_threshold,
            variance_threshold=variance_threshold,
            context_radius=context_radius,
            phase_samples=int(phase_samples),
            contour_lock=contour_lock,
            noise_rejection=noise_rejection,
        )
        return (output.to(dtype=image.dtype),)


class EFSSPixelMap:
    """Compatibility/advanced node. Prefer Primitive or Disciplined Downscale for new graphs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_width": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "target_height": ("INT", {"default": 32, "min": 1, "max": 2048, "step": 1}),
                "sampling": (
                    ["adaptive", "medoid", "area", "nearest", "median", "dominant", "phase"],
                    {"default": "adaptive"},
                ),
                "profile": (
                    ["balanced", "outline", "sprite", "soft", "background"],
                    {"default": "balanced"},
                ),
            },
            "optional": {
                "phase_samples": (["1", "4", "9"], {"default": "4"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "EFSS_INDEXED")
    RETURN_NAMES = ("pixel_image", "legacy_indexed")
    FUNCTION = "map_pixels"
    CATEGORY = "EFSS PDE/Advanced"

    def map_pixels(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        sampling: str,
        profile: str,
        phase_samples: str = "4",
        palette=None,
        **legacy_inputs,
    ):
        if sampling == "adaptive":
            sampled = adaptive_resample(
                image,
                target_width=target_width,
                target_height=target_height,
                profile=profile,
                phase_samples=int(phase_samples),
            )
        else:
            sampled = reduce_primitive(
                image,
                target_width=target_width,
                target_height=target_height,
                method=sampling,
                phase_samples=int(phase_samples),
            )
        sampled = sampled.to(dtype=image.dtype)
        return (sampled, _legacy_indexed_payload(sampled))


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
    CATEGORY = "EFSS PDE/Advanced"

    def guide(
        self,
        image: torch.Tensor,
        passes: int,
        min_similar_neighbors: int,
        similarity_threshold: float,
        indexed=None,
        **legacy_inputs,
    ):
        guided, changed = guide_rgb(
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
        validate_image(image)
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
                    {"multiline": True, "default": DEFAULT_PALETTE},
                ),
            }
        }

    RETURN_TYPES = ("EFSS_PALETTE", "INT", "STRING")
    RETURN_NAMES = ("palette", "color_count", "normalized_hex")
    FUNCTION = "build"
    CATEGORY = "EFSS PDE/Palette"

    def build(self, palette_text: str):
        palette = parse_palette(palette_text)
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
    CATEGORY = "EFSS PDE/Palette"

    def extract(self, image: torch.Tensor, color_count: int, iterations: int):
        palette = extract_palette_kmeans(
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
    CATEGORY = "EFSS PDE/Palette"

    def quantize(self, image: torch.Tensor, palette: PaletteSpec, distance_metric: str):
        indices = nearest_palette_indices(image, palette, distance_metric)
        return (render_palette_indices(indices, palette, image.dtype),)


class EFSSPaletteInspector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "max_colors_report": ("INT", {"default": 64, "min": 1, "max": 256, "step": 1}),
            }
        }

    RETURN_TYPES = ("INT", "STRING", "STRING")
    RETURN_NAMES = ("unique_color_count", "hex_palette", "usage_report")
    FUNCTION = "inspect"
    CATEGORY = "EFSS PDE/Palette"

    def inspect(self, image: torch.Tensor, max_colors_report: int):
        return inspect_palette(image, max_colors_report=max_colors_report)


class EFSSPalettePreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "palette": ("EFSS_PALETTE",),
                "swatch_size": ("INT", {"default": 24, "min": 4, "max": 128, "step": 1}),
                "columns": ("INT", {"default": 8, "min": 1, "max": 32, "step": 1}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("swatch_image",)
    FUNCTION = "preview"
    CATEGORY = "EFSS PDE/Palette"

    def preview(self, palette: PaletteSpec, swatch_size: int, columns: int):
        return (palette_preview(palette, swatch_size=swatch_size, columns=columns),)


class EFSSPaletteConsolidate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "palette": ("EFSS_PALETTE",),
                "threshold": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 1.0, "step": 0.005}),
                "distance_metric": (["luma_weighted", "rgb"], {"default": "luma_weighted"}),
            }
        }

    RETURN_TYPES = ("EFSS_PALETTE", "INT", "STRING")
    RETURN_NAMES = ("palette", "color_count", "normalized_hex")
    FUNCTION = "consolidate"
    CATEGORY = "EFSS PDE/Palette"

    def consolidate(self, palette: PaletteSpec, threshold: float, distance_metric: str):
        merged = consolidate_palette(palette, threshold=threshold, metric=distance_metric)
        return (merged, len(merged.hex_colors), "\n".join(merged.hex_colors))


NODE_CLASS_MAPPINGS = {
    "EFSSPDE_PixelCanvas": EFSSPixelCanvas,
    "EFSSPDE_PrimitiveDownscale": EFSSPrimitiveDownscale,
    "EFSSPDE_DisciplinedDownscale": EFSSDisciplinedDownscale,
    "EFSSPDE_PixelMap": EFSSPixelMap,
    "EFSSPDE_PixelGuide": EFSSPixelGuide,
    "EFSSPDE_PixelPreview": EFSSPixelPreview,
    "EFSSPDE_Palette": EFSSPalette,
    "EFSSPDE_AutoPalette": EFSSAutoPalette,
    "EFSSPDE_PaletteQuantize": EFSSPaletteQuantize,
    "EFSSPDE_PaletteInspector": EFSSPaletteInspector,
    "EFSSPDE_PalettePreview": EFSSPalettePreview,
    "EFSSPDE_PaletteConsolidate": EFSSPaletteConsolidate,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EFSSPDE_PixelCanvas": "EFSS Pixel Canvas",
    "EFSSPDE_PrimitiveDownscale": "EFSS Primitive Downscale",
    "EFSSPDE_DisciplinedDownscale": "EFSS Disciplined Downscale",
    "EFSSPDE_PixelMap": "EFSS Pixel Map (Compatibility)",
    "EFSSPDE_PixelGuide": "EFSS Pixel Guide",
    "EFSSPDE_PixelPreview": "EFSS Pixel Preview",
    "EFSSPDE_Palette": "EFSS Palette",
    "EFSSPDE_AutoPalette": "EFSS Auto Palette",
    "EFSSPDE_PaletteQuantize": "EFSS Palette Quantize",
    "EFSSPDE_PaletteInspector": "EFSS Palette Inspector",
    "EFSSPDE_PalettePreview": "EFSS Palette Preview",
    "EFSSPDE_PaletteConsolidate": "EFSS Palette Consolidate",
}
