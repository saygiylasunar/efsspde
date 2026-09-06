export type Tool = "pencil" | "eraser" | "picker" | "fill";

export interface PixelProjectFile {
  format: "efsspde-pixel-project";
  version: 1;
  width: number;
  height: number;
  palette: string[];
  pixels: number[];
}

export interface PixelChange {
  index: number;
  before: number;
  after: number;
}

export interface PixelCommand {
  label: string;
  changes: PixelChange[];
}
