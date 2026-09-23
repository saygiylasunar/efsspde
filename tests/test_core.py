from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import torch

from efsspde.core import (
    PRIMITIVE_METHODS,
    consolidate_palette,
    disciplined_downscale,
    extract_palette_kmeans,
    inspect_palette,
    palette_preview,
    parse_palette,
    reduce_primitive,
)


def _source_values(image):
    return {tuple(row.tolist()) for row in image.reshape(-1, 3)}


def test_exact_medoid_is_deterministic_and_source_faithful():
    image = torch.tensor(
        [[[
            [0.0, 0.0, 0.0], [0.1, 0.1, 0.1], [0.8, 0.8, 0.8], [1.0, 1.0, 1.0],
        ], [
            [0.2, 0.2, 0.2], [0.3, 0.3, 0.3], [0.7, 0.7, 0.7], [0.9, 0.9, 0.9],
        ], [
            [1.0, 0.0, 0.0], [0.9, 0.1, 0.0], [0.0, 1.0, 0.0], [0.0, 0.9, 0.1],
        ], [
            [0.8, 0.2, 0.0], [0.7, 0.3, 0.0], [0.0, 0.8, 0.2], [0.1, 0.7, 0.2],
        ]]],
        dtype=torch.float32,
    )
    a = reduce_primitive(image, 2, 2, "medoid")
    b = reduce_primitive(image, 2, 2, "medoid")
    assert torch.equal(a, b)
    source = _source_values(image)
    assert all(tuple(row.tolist()) in source for row in a.reshape(-1, 3))



def test_exact_ratio_matches_golden_area_nearest_medoid_semantics():
    torch.manual_seed(23)
    image = torch.rand((1, 8, 12, 3), dtype=torch.float32)
    target_width, target_height = 4, 2

    bchw = image.permute(0, 3, 1, 2)
    golden_area = torch.nn.functional.interpolate(
        bchw, size=(target_height, target_width), mode="area"
    ).permute(0, 2, 3, 1).contiguous()
    golden_nearest = torch.nn.functional.interpolate(
        bchw, size=(target_height, target_width), mode="nearest"
    ).permute(0, 2, 3, 1).contiguous()

    cell_width = image.shape[2] // target_width
    cell_height = image.shape[1] // target_height
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
    golden_medoid = torch.gather(
        blocks,
        dim=3,
        index=choice.unsqueeze(-1).expand(-1, -1, -1, 1, 3),
    ).squeeze(3)

    assert torch.allclose(
        reduce_primitive(image, target_width, target_height, "area"),
        golden_area,
        atol=1e-6,
        rtol=0.0,
    )
    assert torch.equal(
        reduce_primitive(image, target_width, target_height, "nearest"),
        golden_nearest,
    )
    assert torch.equal(
        reduce_primitive(image, target_width, target_height, "medoid"),
        golden_medoid,
    )

def test_non_integer_reduction_supports_all_primitives():
    torch.manual_seed(4)
    image = torch.rand((1, 7, 11, 3), dtype=torch.float32)
    source = _source_values(image)
    for method in PRIMITIVE_METHODS:
        out = reduce_primitive(image, 4, 3, method, phase_samples=9)
        assert out.shape == (1, 3, 4, 3)
        assert torch.isfinite(out).all()
        if method in {"nearest", "medoid", "dominant", "phase"}:
            assert all(tuple(row.tolist()) in source for row in out.reshape(-1, 3))


def test_reduction_fails_closed_on_upscale():
    image = torch.rand((1, 4, 4, 3))
    try:
        reduce_primitive(image, 8, 8, "medoid")
    except ValueError as exc:
        assert "reduction engine" in str(exc)
    else:
        raise AssertionError("upscale must fail closed")


def test_disciplined_non_integer_is_deterministic():
    torch.manual_seed(12)
    image = torch.rand((1, 13, 17, 3))
    kwargs = dict(
        target_width=7,
        target_height=5,
        profile="balanced",
        adaptive_strength=0.75,
        contour_priority=0.70,
        soft_depth=0.45,
        source_fidelity=0.65,
        edge_threshold=0.045,
        variance_threshold=0.012,
        context_radius=1,
        phase_samples=4,
        contour_lock=0.50,
        noise_rejection=0.25,
    )
    a = disciplined_downscale(image, **kwargs)
    b = disciplined_downscale(image, **kwargs)
    assert torch.equal(a, b)
    assert a.shape == (1, 5, 7, 3)


def test_palette_kmeans_is_deterministic():
    torch.manual_seed(7)
    image = torch.rand((1, 16, 16, 3))
    a = extract_palette_kmeans(image, 8, 8)
    b = extract_palette_kmeans(image, 8, 8)
    assert a.hex_colors == b.hex_colors
    assert torch.equal(a.rgba, b.rgba)


def test_palette_inspector_and_preview():
    image = torch.tensor(
        [[[[1.0, 0.0, 0.0], [1.0, 0.0, 0.0]], [[0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]]]
    )
    count, palette, report = inspect_palette(image)
    assert count == 3
    assert "#FF0000" in palette
    assert "2 px" in report

    spec = parse_palette("#00000000\n#FF0000\n#00FF00\n#0000FF")
    swatch = palette_preview(spec, swatch_size=8, columns=2)
    assert swatch.shape == (1, 16, 16, 3)


def test_palette_consolidation_uses_existing_medoid_color():
    spec = parse_palette("#101010\n#111111\n#121212\n#FFFFFF")
    merged = consolidate_palette(spec, threshold=0.02, metric="rgb")
    assert len(merged.hex_colors) == 2
    assert any(color in {"#101010", "#111111", "#121212"} for color in merged.hex_colors)
    assert "#FFFFFF" in merged.hex_colors
