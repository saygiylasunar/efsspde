import type {
  PixelChange,
  PixelCommand,
  PixelFrame,
  PixelLayer,
  PixelProjectFile,
  PixelProjectFileV3,
} from "../types";

export const DEFAULT_PALETTE = [
  "#00000000",
  "#18181b",
  "#3f3f46",
  "#71717a",
  "#f4f4f5",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#eab308",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#a16207",
  "#d6a57a",
  "#8b5e3c",
];

const DEFAULT_FRAME_DURATION = 120;

export class PixelDocument {
  width: number;
  height: number;
  palette: string[];
  layers: PixelLayer[];
  frames: PixelFrame[];
  activeLayerId: string;
  activeFrameId: string;

  private undoStack: PixelCommand[] = [];
  private redoStack: PixelCommand[] = [];
  private layerCounter = 0;
  private frameCounter = 0;

  constructor(width = 24, height = 40, palette = DEFAULT_PALETTE) {
    this.width = width;
    this.height = height;
    this.palette = [...palette];
    const frame = this.createFrame(DEFAULT_FRAME_DURATION);
    this.frames = [frame];
    const base = this.createLayer("Layer 1");
    this.layers = [base];
    this.activeLayerId = base.id;
    this.activeFrameId = frame.id;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get activeLayer() { return this.layers.find((layer) => layer.id === this.activeLayerId) ?? this.layers[0]; }
  get activeFrame() { return this.frames.find((frame) => frame.id === this.activeFrameId) ?? this.frames[0]; }
  get activeFrameIndex() { const index = this.frames.findIndex((frame) => frame.id === this.activeFrameId); return index >= 0 ? index : 0; }
  get pixels() { return this.activeLayer.cels[this.activeFrameIndex]; }
  get layerCount() { return this.layers.length; }
  get frameCount() { return this.frames.length; }

  private resetHistory() { this.undoStack = []; this.redoStack = []; }
  private createFrame(durationMs: number): PixelFrame { this.frameCounter += 1; return { id: `frame-${this.frameCounter}`, durationMs: this.clampDuration(durationMs) }; }
  private createLayer(name: string): PixelLayer { this.layerCounter += 1; return { id: `layer-${this.layerCounter}`, name, visible: true, cels: this.frames.map(() => new Uint8Array(this.width * this.height)) }; }
  private clampDuration(durationMs: number) { const value = Number.isFinite(durationMs) ? Math.round(durationMs) : DEFAULT_FRAME_DURATION; return Math.max(20, Math.min(5000, value)); }

  getLayer(id: string) { return this.layers.find((layer) => layer.id === id); }
  getFrame(id: string) { return this.frames.find((frame) => frame.id === id); }
  private frameIndexForId(id: string) { return this.frames.findIndex((frame) => frame.id === id); }
  private celFor(layerId: string, frameId: string) { const layer = this.getLayer(layerId); const frameIndex = this.frameIndexForId(frameId); if (!layer || frameIndex < 0) return undefined; return layer.cels[frameIndex]; }
  private applyHistoryChange(change: PixelChange, direction: "before" | "after") { const cel = this.celFor(change.layerId, change.frameId); if (!cel) return; cel[change.index] = change[direction]; }
  rollbackChanges(changes: PixelChange[]) { for (let index = changes.length - 1; index >= 0; index--) this.applyHistoryChange(changes[index], "before"); }

  setActiveLayer(id: string) { if (!this.getLayer(id)) return false; this.activeLayerId = id; return true; }
  setActiveFrame(id: string) { if (!this.getFrame(id)) return false; this.activeFrameId = id; return true; }
  nextFrame(loop = true) { const next = this.activeFrameIndex + 1; if (next < this.frames.length) { this.activeFrameId = this.frames[next].id; return true; } if (loop && this.frames.length > 0) { this.activeFrameId = this.frames[0].id; return true; } return false; }
  previousFrame(loop = true) { const previous = this.activeFrameIndex - 1; if (previous >= 0) { this.activeFrameId = this.frames[previous].id; return true; } if (loop && this.frames.length > 0) { this.activeFrameId = this.frames[this.frames.length - 1].id; return true; } return false; }
  setFrameDuration(id: string, durationMs: number) { const frame = this.getFrame(id); if (!frame) return false; frame.durationMs = this.clampDuration(durationMs); return true; }

  addFrame(duplicateCurrent = false) {
    const currentIndex = this.activeFrameIndex;
    const insertIndex = currentIndex + 1;
    const frame = this.createFrame(this.activeFrame.durationMs);
    this.frames.splice(insertIndex, 0, frame);
    for (const layer of this.layers) {
      const source = duplicateCurrent ? layer.cels[currentIndex] : undefined;
      layer.cels.splice(insertIndex, 0, source ? new Uint8Array(source) : new Uint8Array(this.width * this.height));
    }
    this.activeFrameId = frame.id;
    this.resetHistory();
    return frame;
  }

  deleteFrame(id: string) {
    if (this.frames.length <= 1) return false;
    const index = this.frameIndexForId(id);
    if (index < 0) return false;
    this.frames.splice(index, 1);
    for (const layer of this.layers) layer.cels.splice(index, 1);
    if (this.activeFrameId === id) this.activeFrameId = this.frames[Math.min(index, this.frames.length - 1)].id;
    this.resetHistory();
    return true;
  }

  addLayer(name?: string) { const layer = this.createLayer(name?.trim() || `Layer ${this.layerCounter + 1}`); this.layers.push(layer); this.activeLayerId = layer.id; this.resetHistory(); return layer; }
  deleteLayer(id: string) { if (this.layers.length <= 1) return false; const index = this.layers.findIndex((layer) => layer.id === id); if (index < 0) return false; this.layers.splice(index, 1); if (this.activeLayerId === id) this.activeLayerId = this.layers[Math.min(index, this.layers.length - 1)].id; this.resetHistory(); return true; }
  renameLayer(id: string, name: string) { const layer = this.getLayer(id); const next = name.trim(); if (!layer || !next) return false; layer.name = next; return true; }
  toggleLayerVisibility(id: string) { const layer = this.getLayer(id); if (!layer) return false; layer.visible = !layer.visible; return true; }
  moveLayer(id: string, direction: "up" | "down") { const index = this.layers.findIndex((layer) => layer.id === id); if (index < 0) return false; const target = direction === "up" ? index + 1 : index - 1; if (target < 0 || target >= this.layers.length) return false; [this.layers[index], this.layers[target]] = [this.layers[target], this.layers[index]]; this.resetHistory(); return true; }

  getPixel(x: number, y: number) { if (!this.inBounds(x, y)) return 0; return this.pixels[y * this.width + x]; }
  getCompositePixel(x: number, y: number, frameId = this.activeFrameId) { if (!this.inBounds(x, y)) return 0; const frameIndex = this.frameIndexForId(frameId); if (frameIndex < 0) return 0; const index = y * this.width + x; for (let layerIndex = this.layers.length - 1; layerIndex >= 0; layerIndex--) { const layer = this.layers[layerIndex]; if (!layer.visible) continue; const color = layer.cels[frameIndex][index]; if (color !== 0) return color; } return 0; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  indexOf(x: number, y: number) { return y * this.width + x; }

  makeChange(x: number, y: number, color: number): PixelChange | null { if (!this.inBounds(x, y)) return null; const index = this.indexOf(x, y); const before = this.pixels[index]; if (before === color) return null; this.pixels[index] = color; return { frameId: this.activeFrameId, layerId: this.activeLayerId, index, before, after: color }; }
  commit(label: string, changes: PixelChange[]) { if (changes.length === 0) return; const deduped = new Map<string, PixelChange>(); for (const change of changes) { const key = `${change.frameId}:${change.layerId}:${change.index}`; const existing = deduped.get(key); if (existing) existing.after = change.after; else deduped.set(key, { ...change }); } const effective = [...deduped.values()].filter((change) => change.before !== change.after); if (effective.length === 0) return; this.undoStack.push({ label, changes: effective }); this.redoStack = []; }
  undo() { const command = this.undoStack.pop(); if (!command) return false; for (let index = command.changes.length - 1; index >= 0; index--) this.applyHistoryChange(command.changes[index], "before"); this.redoStack.push(command); return true; }
  redo() { const command = this.redoStack.pop(); if (!command) return false; for (const change of command.changes) this.applyHistoryChange(change, "after"); this.undoStack.push(command); return true; }

  fill(x: number, y: number, replacement: number) { if (!this.inBounds(x, y)) return [] as PixelChange[]; const target = this.getPixel(x, y); if (target === replacement) return [] as PixelChange[]; const changes: PixelChange[] = []; const stack: Array<[number, number]> = [[x, y]]; const visited = new Uint8Array(this.width * this.height); while (stack.length) { const [cx, cy] = stack.pop()!; if (!this.inBounds(cx, cy)) continue; const index = this.indexOf(cx, cy); if (visited[index] || this.pixels[index] !== target) continue; visited[index] = 1; const change = this.makeChange(cx, cy, replacement); if (change) changes.push(change); stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]); } return changes; }
  clear() { const changes: PixelChange[] = []; const pixels = this.pixels; for (let i = 0; i < pixels.length; i++) { const before = pixels[i]; if (before !== 0) { pixels[i] = 0; changes.push({ frameId: this.activeFrameId, layerId: this.activeLayerId, index: i, before, after: 0 }); } } this.commit(`Clear ${this.activeLayer.name}`, changes); }

  resize(width: number, height: number) { this.width = width; this.height = height; this.layerCounter = 0; this.frameCounter = 0; const frame = this.createFrame(DEFAULT_FRAME_DURATION); this.frames = [frame]; const base = this.createLayer("Layer 1"); this.layers = [base]; this.activeLayerId = base.id; this.activeFrameId = frame.id; this.resetHistory(); }

  toProject(): PixelProjectFileV3 { return { format: "efsspde-pixel-project", version: 3, width: this.width, height: this.height, palette: [...this.palette], layers: this.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, cels: layer.cels.map((cel) => Array.from(cel)) })), frames: this.frames.map((frame) => ({ ...frame })), activeLayerId: this.activeLayerId, activeFrameId: this.activeFrameId }; }

  loadProject(project: PixelProjectFile) {
    if (project.format !== "efsspde-pixel-project") throw new Error("Unsupported EFSS PDE project format.");
    if (project.width <= 0 || project.height <= 0 || project.width > 512 || project.height > 512) throw new Error("Invalid project dimensions.");
    if (!Array.isArray(project.palette) || project.palette.length < 2 || project.palette.length > 256) throw new Error("Invalid palette.");
    this.width = project.width; this.height = project.height; this.palette = [...project.palette]; const pixelCount = project.width * project.height;
    if (project.version === 1) {
      if (project.pixels.length !== pixelCount) throw new Error("Invalid v1 pixel buffer.");
      this.frames = [{ id: "frame-1", durationMs: DEFAULT_FRAME_DURATION }];
      this.layers = [{ id: "layer-1", name: "Layer 1", visible: true, cels: [Uint8Array.from(project.pixels)] }];
      this.activeLayerId = "layer-1"; this.activeFrameId = "frame-1"; this.layerCounter = 1; this.frameCounter = 1;
    } else if (project.version === 2) {
      if (!Array.isArray(project.layers) || project.layers.length === 0) throw new Error("Project must contain at least one layer.");
      this.frames = [{ id: "frame-1", durationMs: DEFAULT_FRAME_DURATION }];
      const seen = new Set<string>();
      this.layers = project.layers.map((layer, index) => { if (!layer.id || seen.has(layer.id)) throw new Error("Layer IDs must be unique."); seen.add(layer.id); if (layer.pixels.length !== pixelCount) throw new Error(`Invalid pixel buffer for layer ${index + 1}.`); return { id: layer.id, name: layer.name?.trim() || `Layer ${index + 1}`, visible: layer.visible !== false, cels: [Uint8Array.from(layer.pixels)] }; });
      this.activeLayerId = seen.has(project.activeLayerId) ? project.activeLayerId : this.layers[0].id; this.activeFrameId = "frame-1"; this.frameCounter = 1; this.layerCounter = this.maxNumericId(this.layers.map((layer) => layer.id), "layer");
    } else if (project.version === 3) {
      if (!Array.isArray(project.frames) || project.frames.length === 0) throw new Error("Project must contain at least one frame.");
      if (!Array.isArray(project.layers) || project.layers.length === 0) throw new Error("Project must contain at least one layer.");
      const frameIds = new Set<string>();
      this.frames = project.frames.map((frame) => { if (!frame.id || frameIds.has(frame.id)) throw new Error("Frame IDs must be unique."); frameIds.add(frame.id); return { id: frame.id, durationMs: this.clampDuration(frame.durationMs) }; });
      const layerIds = new Set<string>();
      this.layers = project.layers.map((layer, layerIndex) => { if (!layer.id || layerIds.has(layer.id)) throw new Error("Layer IDs must be unique."); layerIds.add(layer.id); if (!Array.isArray(layer.cels) || layer.cels.length !== this.frames.length) throw new Error(`Layer ${layerIndex + 1} must contain one cel per frame.`); const cels = layer.cels.map((cel, frameIndex) => { if (!Array.isArray(cel) || cel.length !== pixelCount) throw new Error(`Invalid cel for layer ${layerIndex + 1}, frame ${frameIndex + 1}.`); return Uint8Array.from(cel); }); return { id: layer.id, name: layer.name?.trim() || `Layer ${layerIndex + 1}`, visible: layer.visible !== false, cels }; });
      this.activeLayerId = layerIds.has(project.activeLayerId) ? project.activeLayerId : this.layers[0].id;
      this.activeFrameId = frameIds.has(project.activeFrameId) ? project.activeFrameId : this.frames[0].id;
      this.layerCounter = this.maxNumericId(this.layers.map((layer) => layer.id), "layer"); this.frameCounter = this.maxNumericId(this.frames.map((frame) => frame.id), "frame");
    } else throw new Error("Unsupported EFSS PDE project version.");
    this.resetHistory();
  }

  private maxNumericId(ids: string[], prefix: "layer" | "frame") { return ids.reduce((max, id) => { const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id); return match ? Math.max(max, Number(match[1])) : max; }, ids.length); }
}
