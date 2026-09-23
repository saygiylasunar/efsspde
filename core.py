from __future__ import annotations

import math
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
PRIMITIVE_METHODS = ("area", "nearest", "medoid", "median", "dominant", "phase")
SOURCE_PIXEL_METHODS = ("nearest", "medoid", "dominant", "phase")


@dataclass(frozen=True)
class PaletteSpec:
    hex_colors: tuple[str, ...]
    rgba: torch.Tensor
    transparent_index: int


def validate_image(image: torch.Tensor) -> None:
    if image.ndim != 4 or image.shape[-1] != 3:
        raise ValueError(f"Expected Comfy IMAGE [B,H,W,3], got {tuple(image.shape)}")


def validate_target(image: torch.Tensor, target_width: int, target_height: int) -> None:
    validate_image(image)
    if target_width <= 0 or target_height <= 0:
        raise ValueError("Target dimensions must be positive.")
    _, source_height, source_width, _ = image.shape
    if target_width > source_width or target_height > source_height:
        raise ValueError(
            "EFSS PDE is a reduction engine: target dimensions must not exceed the source; "
            f"got {source_width}x{source_height} -> {target_width}x{target_height}."
        )


def parse_hex_color(value: str) -> tuple[float, float, float, float]:
    raw = value.lstrip("#")
    if len(raw) == 6:
        raw += "FF"
    if len(raw) != 8:
        raise ValueError(f"Invalid hex color: {value}")
    channels = tuple(int(raw[index : index + 2], 16) / 255.0 for index in range(0, 8, 2))
    return channels  # type: ignore[return-value]


def parse_palette(text: str) -> PaletteSpec:
    colors = tuple(match.upper() for match in HEX_PATTERN.findall(text))
    if len(colors) < 2:
        raise ValueError("EFSS Palette requires at least two #RRGGBB or #RRGGBBAA colors.")
    if len(colors) > 256:
        raise ValueError("EFSS Palette supports at most 256 colors.")

    rgba = torch.tensor([parse_hex_color(color) for color in colors], dtype=torch.float32)
    transparent = torch.where(rgba[:, 3] <= 0.001)[0]
    transparent_index = int(transparent[0].item()) if len(transparent) else -1
    return PaletteSpec(colors, rgba, transparent_index)


def palette_on(palette: PaletteSpec, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    return palette.rgba.to(device=device, dtype=dtype)


def _palette_from_rgba(rgba: torch.Tensor) -> PaletteSpec:
    rgba = rgba.detach().to(dtype=torch.float32).clamp(0.0, 1.0)
    rgb = rgba[:, :3]
    luma = rgb[:, 0] * 0.299 + rgb[:, 1] * 0.587 + rgb[:, 2] * 0.114
    alpha_sort_bias = (rgba[:, 3] > 0.001).to(dtype=luma.dtype) * 10.0
    order = torch.argsort(alpha_sort_bias + luma)
    rgba = rgba[order]

    values = (rgba * 255.0).round().to(dtype=torch.uint8).cpu().tolist()
    colors: list[str] = []
    for r, g, b, a in values:
        if a == 255:
            colors.append(f"#{r:02X}{g:02X}{b:02X}")
        else:
            colors.append(f"#{r:02X}{g:02X}{b:02X}{a:02X}")
    transparent = torch.where(rgba[:, 3] <= 0.001)[0]
    transparent_index = int(transparent[0].item()) if len(transparent) else -1
    return PaletteSpec(tuple(colors), rgba, transparent_index)


def palette_from_rgb(rgb: torch.Tensor) -> PaletteSpec:
    rgb = rgb.detach().to(dtype=torch.float32).clamp(0.0, 1.0)
    alpha = torch.ones((rgb.shape[0], 1), device=rgb.device, dtype=rgb.dtype)
    return _palette_from_rgba(torch.cat([rgb, alpha], dim=1))


def extract_palette_kmeans(
    image: torch.Tensor,
    color_count: int,
    iterations: int,
    sample_limit: int = 16_384,
) -> PaletteSpec:
    validate_image(image)
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

    for _ in range(max(1, int(iterations))):
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

    return palette_from_rgb(centers)


def _partition_bounds(source_length: int, target_length: int) -> list[tuple[int, int]]:
    if target_length <= 0 or target_length > source_length:
        raise ValueError(
            f"Cannot partition source length {source_length} into {target_length} non-empty logical cells."
        )
    return [
        ((index * source_length) // target_length, ((index + 1) * source_length) // target_length)
        for index in range(target_length)
    ]


def _phase_indices(height: int, width: int, phase_samples: int) -> list[int]:
    if phase_samples <= 1:
        fractions = (0.5,)
    elif phase_samples <= 4:
        fractions = (0.25, 0.75)
    else:
        fractions = (1.0 / 6.0, 0.5, 5.0 / 6.0)

    indices: list[int] = []
    for fy in fractions:
        y = min(height - 1, max(0, int(round(fy * height - 0.5))))
        for fx in fractions:
            x = min(width - 1, max(0, int(round(fx * width - 0.5))))
            index = y * width + x
            if index not in indices:
                indices.append(index)
    return indices


def _logical_candidate_bundle(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    phase_samples: int,
) -> tuple[dict[str, torch.Tensor], torch.Tensor, torch.Tensor]:
    validate_target(image, target_width, target_height)
    batch, source_height, source_width, _ = image.shape
    y_bounds = _partition_bounds(source_height, target_height)
    x_bounds = _partition_bounds(source_width, target_width)

    shape = (batch, target_height, target_width, 3)
    area = torch.empty(shape, device=image.device, dtype=image.dtype)
    medoid = torch.empty_like(area)
    median = torch.empty_like(area)
    dominant = torch.empty_like(area)
    phase = torch.empty_like(area)
    variance = torch.empty((batch, target_height, target_width), device=image.device, dtype=image.dtype)

    for oy, (y0, y1) in enumerate(y_bounds):
        for ox, (x0, x1) in enumerate(x_bounds):
            region = image[:, y0:y1, x0:x1, :].reshape(batch, -1, 3)
            mean = region.mean(dim=1, keepdim=True)
            area[:, oy, ox, :] = mean.squeeze(1)
            variance[:, oy, ox] = ((region - mean) ** 2).mean(dim=(1, 2))

            distance = ((region - mean) ** 2).sum(dim=-1)
            medoid_index = distance.argmin(dim=1)
            medoid[:, oy, ox, :] = region[torch.arange(batch, device=image.device), medoid_index]

            median[:, oy, ox, :] = region.median(dim=1).values

            quantized = (region.clamp(0.0, 1.0) * 31.0).round().to(dtype=torch.int64)
            codes = quantized[..., 0] * 1024 + quantized[..., 1] * 32 + quantized[..., 2]
            mode_index = torch.mode(codes, dim=1).indices
            dominant[:, oy, ox, :] = region[torch.arange(batch, device=image.device), mode_index]

            region_height = y1 - y0
            region_width = x1 - x0
            indices = _phase_indices(region_height, region_width, phase_samples)
            phase_pool = region[:, indices, :]
            phase_distance = ((phase_pool - mean) ** 2).sum(dim=-1)
            phase_index = phase_distance.argmin(dim=1)
            phase[:, oy, ox, :] = phase_pool[torch.arange(batch, device=image.device), phase_index]

    bchw = image.permute(0, 3, 1, 2)
    nearest = F.interpolate(
        bchw,
        size=(target_height, target_width),
        mode="nearest",
    ).permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)

    luma = area[..., 0] * 0.299 + area[..., 1] * 0.587 + area[..., 2] * 0.114
    dx = torch.zeros_like(luma)
    dy = torch.zeros_like(luma)
    dx[:, :, 1:] = torch.abs(luma[:, :, 1:] - luma[:, :, :-1])
    dy[:, 1:, :] = torch.abs(luma[:, 1:, :] - luma[:, :-1, :])
    edge = torch.maximum(dx, dy)

    return {
        "area": area.clamp(0.0, 1.0),
        "nearest": nearest,
        "medoid": medoid.clamp(0.0, 1.0),
        "median": median.clamp(0.0, 1.0),
        "dominant": dominant.clamp(0.0, 1.0),
        "phase": phase.clamp(0.0, 1.0),
    }, edge, variance


def reduce_primitive(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    method: str,
    phase_samples: int = 4,
) -> torch.Tensor:
    if method not in PRIMITIVE_METHODS:
        raise ValueError(f"Unsupported EFSS primitive: {method}")
    candidates, _, _ = _logical_candidate_bundle(
        image,
        target_width=target_width,
        target_height=target_height,
        phase_samples=phase_samples,
    )
    return candidates[method].to(dtype=image.dtype)


def adaptive_resample(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    profile: str,
    phase_samples: int = 4,
) -> torch.Tensor:
    candidates, edge, variance = _logical_candidate_bundle(
        image,
        target_width=target_width,
        target_height=target_height,
        phase_samples=phase_samples,
    )
    profiles = {
        "balanced": (0.045, 0.012, 0.095),
        "outline": (0.025, 0.008, 0.060),
        "sprite": (0.030, 0.009, 0.070),
        "soft": (0.075, 0.020, 0.140),
        "background": (0.090, 0.025, 0.170),
    }
    edge_threshold, variance_threshold, hard_edge_threshold = profiles.get(
        profile, profiles["balanced"]
    )

    use_medoid = (edge >= edge_threshold) | (variance >= variance_threshold)
    use_nearest = edge >= hard_edge_threshold
    result = torch.where(use_medoid.unsqueeze(-1), candidates["medoid"], candidates["area"])
    result = torch.where(use_nearest.unsqueeze(-1), candidates["nearest"], result)
    return result.contiguous().clamp(0.0, 1.0)


def _context_average(value: torch.Tensor, radius: int) -> torch.Tensor:
    if radius <= 0:
        return value
    kernel = radius * 2 + 1
    return F.avg_pool2d(
        value.unsqueeze(1),
        kernel_size=kernel,
        stride=1,
        padding=radius,
    ).squeeze(1)


def disciplined_downscale(
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
    phase_samples: int,
    contour_lock: float,
    noise_rejection: float,
) -> torch.Tensor:
    candidates, edge, variance = _logical_candidate_bundle(
        image,
        target_width=target_width,
        target_height=target_height,
        phase_samples=phase_samples,
    )
    order = PRIMITIVE_METHODS
    candidate_stack = torch.stack([candidates[name] for name in order], dim=0)

    edge_context = _context_average(edge, context_radius)
    variance_context = _context_average(variance, context_radius)

    edge_scale = max(float(edge_threshold), 1e-6)
    variance_scale = max(float(variance_threshold), 1e-6)
    edge_n = (edge_context / edge_scale).clamp(0.0, 2.0) * 0.5
    variance_n = (variance_context / variance_scale).clamp(0.0, 2.0) * 0.5
    smooth_n = (1.0 - torch.maximum(edge_n, variance_n)).clamp(0.0, 1.0)

    scores = torch.zeros(
        (len(order), image.shape[0], target_height, target_width),
        device=image.device,
        dtype=image.dtype,
    )

    adaptive = float(adaptive_strength)
    contour = float(contour_priority)
    soft = float(soft_depth)
    fidelity = float(source_fidelity)
    lock = float(contour_lock)
    noise = float(noise_rejection)

    scores[0] = (1.35 * soft * smooth_n) + (1.0 - adaptive) * 1.25
    scores[1] = adaptive * contour * edge_n * (1.0 + 0.8 * lock)
    scores[2] = adaptive * fidelity * (0.35 + 0.65 * torch.maximum(edge_n, variance_n))
    scores[3] = adaptive * noise * variance_n * (0.35 + 0.65 * (1.0 - edge_n))
    scores[4] = adaptive * (0.45 + 0.55 * noise) * variance_n * (0.55 + 0.45 * smooth_n)
    scores[5] = adaptive * fidelity * (0.25 + 0.75 * edge_n) * (0.55 + 0.45 * contour)

    profile_bias = {
        "balanced": (1.00, 1.00, 1.00, 1.00, 1.00, 1.00),
        "crisp": (0.70, 1.35, 1.20, 0.70, 0.90, 1.15),
        "soft": (1.40, 0.55, 0.85, 1.10, 1.00, 0.75),
        "sprite": (0.55, 1.35, 1.25, 0.65, 1.25, 1.20),
        "portrait": (1.20, 0.75, 1.05, 1.10, 0.95, 0.90),
    }.get(profile, (1.00, 1.00, 1.00, 1.00, 1.00, 1.00))

    for index, bias in enumerate(profile_bias):
        scores[index] *= bias

    hard_edge = edge_n >= 0.5
    scores[0] = torch.where(hard_edge, scores[0] * (1.0 - 0.75 * lock), scores[0])
    scores[3] = torch.where(hard_edge, scores[3] * (1.0 - 0.60 * lock), scores[3])

    choice = scores.argmax(dim=0)
    gather_index = choice.unsqueeze(0).unsqueeze(-1).expand(1, -1, -1, -1, 3)
    result = torch.gather(candidate_stack, dim=0, index=gather_index).squeeze(0)
    return result.contiguous().clamp(0.0, 1.0)


def nearest_palette_indices(
    image: torch.Tensor,
    palette: PaletteSpec,
    metric: str,
) -> torch.Tensor:
    validate_image(image)
    rgba = palette_on(palette, image.device, image.dtype)
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


def render_palette_indices(
    indices: torch.Tensor,
    palette: PaletteSpec,
    dtype: torch.dtype,
) -> torch.Tensor:
    rgba = palette_on(palette, indices.device, torch.float32)
    return rgba[:, :3][indices].clamp(0.0, 1.0).to(dtype=dtype)


def _shift_image(
    image: torch.Tensor,
    dy: int,
    dx: int,
) -> tuple[torch.Tensor, torch.Tensor]:
    batch, height, width, _ = image.shape
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


def guide_rgb(
    image: torch.Tensor,
    passes: int,
    min_similar_neighbors: int,
    similarity_threshold: float,
) -> tuple[torch.Tensor, int]:
    validate_image(image)
    work = image.clone()
    changed_total = 0
    offsets = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),             (0, 1),
        (1, -1),  (1, 0),   (1, 1),
    ]
    weights = torch.tensor([0.299, 0.587, 0.114], device=image.device, dtype=image.dtype)
    threshold_sq = float(similarity_threshold) ** 2

    for _ in range(max(0, int(passes))):
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


def inspect_palette(
    image: torch.Tensor,
    max_colors_report: int = 64,
) -> tuple[int, str, str]:
    validate_image(image)
    rgb8 = (image.clamp(0.0, 1.0) * 255.0).round().to(dtype=torch.int64).reshape(-1, 3)
    codes = (rgb8[:, 0] << 16) | (rgb8[:, 1] << 8) | rgb8[:, 2]
    unique, counts = torch.unique(codes, return_counts=True)
    order = torch.argsort(counts, descending=True)
    unique = unique[order]
    counts = counts[order]

    total_unique = int(unique.numel())
    limit = min(total_unique, max(1, int(max_colors_report)))
    top_codes = unique[:limit].cpu().tolist()
    top_counts = counts[:limit].cpu().tolist()
    total_pixels = max(1, int(codes.numel()))

    colors = [f"#{(code >> 16) & 255:02X}{(code >> 8) & 255:02X}{code & 255:02X}" for code in top_codes]
    report_lines = [
        f"{color}  {count} px  ({100.0 * count / total_pixels:.2f}%)"
        for color, count in zip(colors, top_counts)
    ]
    if total_unique > limit:
        report_lines.append(f"... {total_unique - limit} additional colors omitted")
    return total_unique, "\n".join(colors), "\n".join(report_lines)


def palette_preview(
    palette: PaletteSpec,
    swatch_size: int = 24,
    columns: int = 8,
) -> torch.Tensor:
    size = max(2, int(swatch_size))
    cols = max(1, int(columns))
    rgba = palette.rgba.detach().to(dtype=torch.float32).clamp(0.0, 1.0).cpu()
    rows = math.ceil(rgba.shape[0] / cols)
    canvas = torch.zeros((rows * size, cols * size, 3), dtype=torch.float32)

    for index, color in enumerate(rgba):
        row, col = divmod(index, cols)
        y0, y1 = row * size, (row + 1) * size
        x0, x1 = col * size, (col + 1) * size
        if color[3] <= 0.001:
            yy = torch.arange(size).view(-1, 1)
            xx = torch.arange(size).view(1, -1)
            checker = ((yy // max(1, size // 4) + xx // max(1, size // 4)) % 2).float()
            patch = 0.25 + checker.unsqueeze(-1) * 0.5
            canvas[y0:y1, x0:x1] = patch.expand(-1, -1, 3)
        else:
            canvas[y0:y1, x0:x1] = color[:3]
    return canvas.unsqueeze(0)


def consolidate_palette(
    palette: PaletteSpec,
    threshold: float,
    metric: str = "luma_weighted",
) -> PaletteSpec:
    rgba = palette.rgba.detach().to(dtype=torch.float32).clamp(0.0, 1.0)
    if rgba.shape[0] <= 1 or threshold <= 0.0:
        return palette

    rgb = rgba[:, :3]
    weights = torch.tensor(
        [0.299, 0.587, 0.114] if metric == "luma_weighted" else [1.0, 1.0, 1.0],
        dtype=torch.float32,
        device=rgb.device,
    )
    delta = rgb[:, None, :] - rgb[None, :, :]
    distance = torch.sqrt(((delta * delta) * weights).sum(dim=-1))
    alpha_compatible = (rgba[:, None, 3] <= 0.001) == (rgba[None, :, 3] <= 0.001)
    adjacency = (distance <= float(threshold)) & alpha_compatible

    visited = [False] * rgba.shape[0]
    representatives: list[torch.Tensor] = []

    for start in range(rgba.shape[0]):
        if visited[start]:
            continue
        stack = [start]
        component: list[int] = []
        visited[start] = True
        while stack:
            current = stack.pop()
            component.append(current)
            neighbors = torch.where(adjacency[current])[0].cpu().tolist()
            for nxt in neighbors:
                if not visited[nxt]:
                    visited[nxt] = True
                    stack.append(nxt)

        if len(component) == 1:
            representatives.append(rgba[component[0]])
            continue

        component_indices = torch.tensor(component, dtype=torch.long, device=rgba.device)
        sub_distance = distance[component_indices][:, component_indices]
        medoid_local = sub_distance.sum(dim=1).argmin()
        representatives.append(rgba[component_indices[medoid_local]])

    merged = torch.stack(representatives, dim=0)
    return _palette_from_rgba(merged)
