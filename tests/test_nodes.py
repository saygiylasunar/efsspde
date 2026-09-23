from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import torch

from efsspde.nodes import (
    EFSSPaletteInspector,
    EFSSPixelGuide,
    EFSSPixelMap,
    EFSSPrimitiveDownscale,
    NODE_CLASS_MAPPINGS,
)


def test_node_registry_contains_new_nodes():
    expected = {
        "EFSSPDE_PrimitiveDownscale",
        "EFSSPDE_DisciplinedDownscale",
        "EFSSPDE_PaletteInspector",
        "EFSSPDE_PalettePreview",
        "EFSSPDE_PaletteConsolidate",
    }
    assert expected.issubset(NODE_CLASS_MAPPINGS)


def test_pixel_map_accepts_legacy_palette_keyword():
    image = torch.rand((1, 8, 8, 3))
    node = EFSSPixelMap()
    out, legacy = node.map_pixels(
        image=image,
        target_width=4,
        target_height=4,
        sampling="medoid",
        profile="balanced",
        palette={"legacy": True},
    )
    assert out.shape == (1, 4, 4, 3)
    assert legacy["version"] == 2


def test_pixel_guide_accepts_legacy_indexed_keyword():
    image = torch.rand((1, 4, 4, 3))
    node = EFSSPixelGuide()
    out, changed = node.guide(
        image=image,
        passes=1,
        min_similar_neighbors=1,
        similarity_threshold=0.08,
        indexed={"legacy": True},
    )
    assert out.shape == image.shape
    assert isinstance(changed, int)


def test_primitive_node_executes_non_integer_reduction():
    image = torch.rand((1, 9, 13, 3))
    node = EFSSPrimitiveDownscale()
    (out,) = node.downscale(image, 5, 4, "dominant", "4")
    assert out.shape == (1, 4, 5, 3)


def test_inspector_node_returns_usage_report():
    image = torch.zeros((1, 2, 2, 3))
    node = EFSSPaletteInspector()
    count, colors, report = node.inspect(image, 8)
    assert count == 1
    assert colors == "#000000"
    assert "4 px" in report


def test_portable_installer_copies_core_module():
    install_script = Path(__file__).resolve().parents[1] / "install.ps1"
    assert '"core.py"' in install_script.read_text(encoding="utf-8")
