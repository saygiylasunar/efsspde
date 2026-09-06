export type Tool = "pencil" | "eraser" | "picker" | "fill";

export interface PixelProjectFileV1 {
  format: "efsspde-pixel-project";
  version: 1;
  width: number;
  height: number;
  palette: string[];
  pixels: number[];
}

export interface PixelLayerFileV2 {
  id: string;
  name: string;
  visible: boolean;
  pixels: number[];
}

export interface PixelProjectFileV2 {
  format: "efsspde-pixel-project";
  version: 2;
  width: number;
  height: number;
  palette: string[];
  layers: PixelLayerFileV2[];
  activeLayerId: string;
}

export interface PixelFrameFile {
  id: string;
  durationMs: number;
}

export interface PixelLayerFileV3 {
  id: string;
  name: string;
  visible: boolean;
  cels: number[][];
}

export interface PixelProjectFileV3 {
  format: "efsspde-pixel-project";
  version: 3;
  width: number;
  height: number;
  palette: string[];
  layers: PixelLayerFileV3[];
  frames: PixelFrameFile[];
  activeLayerId: string;
  activeFrameId: string;
}

export type PixelProjectFile = PixelProjectFileV1 | PixelProjectFileV2 | PixelProjectFileV3;

export interface PixelFrame {
  id: string;
  durationMs: number;
}

export interface PixelLayer {
  id: string;
  name: string;
  visible: boolean;
  cels: Uint8Array[];
}

export interface PixelChange {
  frameId: string;
  layerId: string;
  index: number;
  before: number;
  after: number;
}

export interface PixelCommand {
  label: string;
  changes: PixelChange[];
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PixelOperation =
  | { op: "set_pixel"; x: number; y: number; color: number }
  | { op: "clear_pixel"; x: number; y: number }
  | { op: "paint_stroke"; points: PixelPoint[]; color: number }
  | { op: "fill"; x: number; y: number; color: number }
  | { op: "move_region"; region: PixelRegion; dx: number; dy: number }
  | { op: "replace_color"; from: number; to: number }
  | { op: "flip_x"; region?: PixelRegion }
  | { op: "flip_y"; region?: PixelRegion };

export interface CommandExecutionResult {
  label: string;
  operations: number;
  changedPixels: number;
  addedPixels: number;
  removedPixels: number;
  recoloredPixels: number;
}
