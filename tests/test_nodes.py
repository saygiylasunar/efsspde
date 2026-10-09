"""Small tensor regressions for the public Comfy node reducer.

Run in a Python environment with PyTorch installed:
    python -m unittest discover -s tests -v
"""

import unittest

import torch

from nodes import (
    EFSSDisciplinedDownscale,
    _parse_palette,
    _resample_logical,
    _validate_image,
)


class ReducerRegressionTests(unittest.TestCase):
    def test_image_shape_contract(self):
        with self.assertRaises(ValueError):
            _validate_image(torch.zeros(1, 3, 8, 8))

    def test_direct_modes_produce_exact_grid(self):
        image = torch.arange(48, dtype=torch.float32).reshape(1, 4, 4, 3) / 47
        for mode in ("nearest", "area", "medoid"):
            with self.subTest(mode=mode):
                output = _resample_logical(image, 2, 2, mode)
                self.assertEqual(tuple(output.shape), (1, 2, 2, 3))
                self.assertTrue(torch.isfinite(output).all().item())

    def test_nearest_and_area_are_not_silent_aliases(self):
        image = torch.zeros(1, 4, 4, 3)
        image[:, 1::2, 1::2, :] = 1
        nearest = _resample_logical(image, 2, 2, "nearest")
        area = _resample_logical(image, 2, 2, "area")
        self.assertTrue(torch.all(nearest == 0).item())
        self.assertTrue(torch.allclose(area, torch.full_like(area, 0.25)))

    def test_medoid_is_a_real_source_color_and_deterministic(self):
        image = torch.tensor([[[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
                               [[0.0, 1.0, 0.0], [1.0, 1.0, 1.0]]]])
        first = _resample_logical(image, 1, 1, "medoid")
        second = _resample_logical(image, 1, 1, "medoid")
        self.assertTrue(torch.equal(first, second))
        self.assertTrue(any(torch.equal(first[0, 0, 0], color)
                            for color in image.reshape(-1, 3)))

    def test_medoid_rejects_fractional_cells(self):
        with self.assertRaisesRegex(ValueError, "exact integer multiples"):
            _resample_logical(torch.zeros(1, 5, 6, 3), 4, 3, "medoid")

    def test_adaptive_node_handles_noninteger_ratios(self):
        image = torch.rand(1, 7, 9, 3, generator=torch.Generator().manual_seed(91))
        kwargs = dict(
            target_width=4, target_height=5, profile="sprite",
            adaptive_strength=0.75, contour_priority=0.7, soft_depth=0.45,
            source_fidelity=0.65, edge_threshold=0.045,
            variance_threshold=0.012, context_radius=1,
            phase_samples="4", contour_lock=0.5, noise_rejection=0.25,
        )
        node = EFSSDisciplinedDownscale()
        first, = node.downscale(image, **kwargs)
        second, = node.downscale(image, **kwargs)
        self.assertEqual(tuple(first.shape), (1, 5, 4, 3))
        self.assertTrue(torch.equal(first, second))
        self.assertGreaterEqual(first.min().item(), 0)
        self.assertLessEqual(first.max().item(), 1)

    def test_palette_contract(self):
        palette = _parse_palette("#00000000\n#BBAACC\n#112233")
        self.assertEqual(len(palette.hex_colors), 3)
        self.assertEqual(palette.transparent_index, 0)
        with self.assertRaises(ValueError):
            _parse_palette("#112233")


if __name__ == "__main__":
    unittest.main()
