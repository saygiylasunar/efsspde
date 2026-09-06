import type {
  PixelChange,
  PixelCommand,
  PixelLayer,
  PixelProjectFile,
  PixelProjectFileV2,
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

export class PixelDocument {
  width: number;
  height: number;
  palette: string[];
  layers: PixelLayer[];
  activeLayerId: string;

  private undoStack: PixelCommand[] = [];
  private redoStack: PixelCommand[] = [];
  private layerCounter = 0;

  constructor(width = 24, height = 40, palette = DEFAULT_PALETTE) {
    this.width = width;
    this.height = height;
    this.palette = [...palette];
    const base = this.createLayer("Layer 1");
    this.layers = [base];
    this.activeLayerId = base.id;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get activeLayer() {
    return this.layers.find((layer) => layer.id === this.activeLayerId) ?? this.layers[0];
  }

  get pixels() {
    return this.activeLayer.pixels;
  }

  get layerCount() {
    return this.layers.length;
  }

  private createLayer(name: string): PixelLayer {
    this.layerCounter += 1;
    return {
      id: `layer-${this.layerCounter}`,
      name,
      visible: true,
      pixels: new Uint8Array(this.width * this.height),
    };
  }

  private layerForChange(change: PixelChange) {
    return this.layers.find((layer) => layer.id === change.layerId);
  }

  private applyHistoryChange(change: PixelChange, direction: "before" | "after") {
    const layer = this.layerForChange(change);
    if (!layer) return;
    layer.pixels[change.index] = change[direction];
  }

  rollbackChanges(changes: PixelChange[]) {
    for (let index = changes.length - 1; index >= 0; index--) {
      this.applyHistoryChange(changes[index], "before");
    }
  }

  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id);
  }

  setActiveLayer(id: string) {
    if (!this.getLayer(id)) return false;
    this.activeLayerId = id;
    return true;
  }

  addLayer(name?: string) {
    const layer = this.createLayer(name?.trim() || `Layer ${this.layerCounter + 1}`);
    this.layers.push(layer);
    this.activeLayerId = layer.id;
    this.undoStack = [];
    this.redoStack = [];
    return layer;
  }

  deleteLayer(id: string) {
    if (this.layers.length <= 1) return false;
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return false;
    this.layers.splice(index, 1);
    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers[Math.min(index, this.layers.length - 1)].id;
    }
    this.undoStack = [];
    this.redoStack = [];
    return true;
  }

  renameLayer(id: string, name: string) {
    const layer = this.getLayer(id);
    const next = name.trim();
    if (!layer || !next) return false;
    layer.name = next;
    return true;
  }

  toggleLayerVisibility(id: string) {
    const layer = this.getLayer(id);
    if (!layer) return false;
    layer.visible = !layer.visible;
    return true;
  }

  moveLayer(id: string, direction: "up" | "down") {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return false;
    const target = direction === "up" ? index + 1 : index - 1;
    if (target < 0 || target >= this.layers.length) return false;
    [this.layers[index], this.layers[target]] = [this.layers[target], this.layers[index]];
    this.undoStack = [];
    this.redoStack = [];
    return true;
  }

  getPixel(x: number, y: number) {
    if (!this.inBounds(x, y)) return 0;
    return this.activeLayer.pixels[y * this.width + x];
  }

  getCompositePixel(x: number, y: number) {
    if (!this.inBounds(x, y)) return 0;
    const index = y * this.width + x;
    for (let layerIndex = this.layers.length - 1; layerIndex >= 0; layerIndex--) {
      const layer = this.layers[layerIndex];
      if (!layer.visible) continue;
      const color = layer.pixels[index];
      if (color !== 0) return color;
    }
    return 0;
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  indexOf(x: number, y: number) {
    return y * this.width + x;
  }

  makeChange(x: number, y: number, color: number): PixelChange | null {
    if (!this.inBounds(x, y)) return null;
    const layer = this.activeLayer;
    const index = this.indexOf(x, y);
    const before = layer.pixels[index];
    if (before === color) return null;
    layer.pixels[index] = color;
    return { layerId: layer.id, index, before, after: color };
  }

  commit(label: string, changes: PixelChange[]) {
    if (changes.length === 0) return;
    const deduped = new Map<string, PixelChange>();
    for (const change of changes) {
      const key = `${change.layerId}:${change.index}`;
      const existing = deduped.get(key);
      if (existing) existing.after = change.after;
      else deduped.set(key, { ...change });
    }
    const effective = [...deduped.values()].filter((change) => change.before !== change.after);
    if (effective.length === 0) return;
    this.undoStack.push({ label, changes: effective });
    this.redoStack = [];
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    for (let index = command.changes.length - 1; index >= 0; index--) {
      this.applyHistoryChange(command.changes[index], "before");
    }
    this.redoStack.push(command);
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    for (const change of command.changes) this.applyHistoryChange(change, "after");
    this.undoStack.push(command);
    return true;
  }

  fill(x: number, y: number, replacement: number) {
    if (!this.inBounds(x, y)) return [] as PixelChange[];
    const target = this.getPixel(x, y);
    if (target === replacement) return [] as PixelChange[];

    const changes: PixelChange[] = [];
    const stack: Array<[number, number]> = [[x, y]];
    const visited = new Uint8Array(this.width * this.height);

    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (!this.inBounds(cx, cy)) continue;
      const index = this.indexOf(cx, cy);
      if (visited[index] || this.activeLayer.pixels[index] !== target) continue;
      visited[index] = 1;
      const change = this.makeChange(cx, cy, replacement);
      if (change) changes.push(change);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return changes;
  }

  clear() {
    const changes: PixelChange[] = [];
    const layer = this.activeLayer;
    for (let i = 0; i < layer.pixels.length; i++) {
      const before = layer.pixels[i];
      if (before !== 0) {
        layer.pixels[i] = 0;
        changes.push({ layerId: layer.id, index: i, before, after: 0 });
      }
    }
    this.commit(`Clear ${layer.name}`, changes);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.layerCounter = 0;
    const base = this.createLayer("Layer 1");
    this.layers = [base];
    this.activeLayerId = base.id;
    this.undoStack = [];
    this.redoStack = [];
  }

  toProject(): PixelProjectFileV2 {
    return {
      format: "efsspde-pixel-project",
      version: 2,
      width: this.width,
      height: this.height,
      palette: [...this.palette],
      layers: this.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        pixels: Array.from(layer.pixels),
      })),
      activeLayerId: this.activeLayerId,
    };
  }

  loadProject(project: PixelProjectFile) {
    if (project.format !== "efsspde-pixel-project") {
      throw new Error("Unsupported EFSS PDE project format.");
    }
    if (
      project.width <= 0 ||
      project.height <= 0 ||
      project.width > 512 ||
      project.height > 512
    ) {
      throw new Error("Invalid project dimensions.");
    }
    if (!Array.isArray(project.palette) || project.palette.length < 2 || project.palette.length > 256) {
      throw new Error("Invalid palette.");
    }

    this.width = project.width;
    this.height = project.height;
    this.palette = [...project.palette];

    if (project.version === 1) {
      if (project.width * project.height !== project.pixels.length) {
        throw new Error("Invalid v1 pixel buffer.");
      }
      this.layerCounter = 1;
      this.layers = [{
        id: "layer-1",
        name: "Layer 1",
        visible: true,
        pixels: Uint8Array.from(project.pixels),
      }];
      this.activeLayerId = "layer-1";
    } else if (project.version === 2) {
      if (!Array.isArray(project.layers) || project.layers.length === 0) {
        throw new Error("Project must contain at least one layer.");
      }
      const seen = new Set<string>();
      this.layers = project.layers.map((layer, index) => {
        if (!layer.id || seen.has(layer.id)) throw new Error("Layer IDs must be unique.");
        seen.add(layer.id);
        if (layer.pixels.length !== project.width * project.height) {
          throw new Error(`Invalid pixel buffer for layer ${index + 1}.`);
        }
        return {
          id: layer.id,
          name: layer.name?.trim() || `Layer ${index + 1}`,
          visible: layer.visible !== false,
          pixels: Uint8Array.from(layer.pixels),
        };
      });
      this.activeLayerId = seen.has(project.activeLayerId) ? project.activeLayerId : this.layers[0].id;
      this.layerCounter = this.layers.reduce((max, layer) => {
        const match = /^layer-(\d+)$/.exec(layer.id);
        return match ? Math.max(max, Number(match[1])) : max;
      }, this.layers.length);
    } else {
      throw new Error("Unsupported EFSS PDE project version.");
    }

    this.undoStack = [];
    this.redoStack = [];
  }
}
