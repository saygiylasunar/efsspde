import type { PixelChange, PixelCommand, PixelProjectFile } from "../types";

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
  "#8b5e3c"
];

export class PixelDocument {
  width: number;
  height: number;
  palette: string[];
  pixels: Uint8Array;

  private undoStack: PixelCommand[] = [];
  private redoStack: PixelCommand[] = [];

  constructor(width = 24, height = 40, palette = DEFAULT_PALETTE) {
    this.width = width;
    this.height = height;
    this.palette = [...palette];
    this.pixels = new Uint8Array(width * height);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  getPixel(x: number, y: number) {
    if (!this.inBounds(x, y)) return 0;
    return this.pixels[y * this.width + x];
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  indexOf(x: number, y: number) {
    return y * this.width + x;
  }

  makeChange(x: number, y: number, color: number): PixelChange | null {
    if (!this.inBounds(x, y)) return null;
    const index = this.indexOf(x, y);
    const before = this.pixels[index];
    if (before === color) return null;
    this.pixels[index] = color;
    return { index, before, after: color };
  }

  commit(label: string, changes: PixelChange[]) {
    if (changes.length === 0) return;
    const deduped = new Map<number, PixelChange>();
    for (const change of changes) {
      const existing = deduped.get(change.index);
      if (existing) existing.after = change.after;
      else deduped.set(change.index, { ...change });
    }
    this.undoStack.push({ label, changes: [...deduped.values()] });
    this.redoStack = [];
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    for (const change of command.changes) this.pixels[change.index] = change.before;
    this.redoStack.push(command);
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    for (const change of command.changes) this.pixels[change.index] = change.after;
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
      if (visited[index] || this.pixels[index] !== target) continue;
      visited[index] = 1;
      const change = this.makeChange(cx, cy, replacement);
      if (change) changes.push(change);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return changes;
  }

  clear() {
    const changes: PixelChange[] = [];
    for (let i = 0; i < this.pixels.length; i++) {
      const before = this.pixels[i];
      if (before !== 0) {
        this.pixels[i] = 0;
        changes.push({ index: i, before, after: 0 });
      }
    }
    this.commit("Clear canvas", changes);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.undoStack = [];
    this.redoStack = [];
  }

  toProject(): PixelProjectFile {
    return {
      format: "efsspde-pixel-project",
      version: 1,
      width: this.width,
      height: this.height,
      palette: [...this.palette],
      pixels: Array.from(this.pixels),
    };
  }

  loadProject(project: PixelProjectFile) {
    if (project.format !== "efsspde-pixel-project" || project.version !== 1) {
      throw new Error("Unsupported EFSS PDE project format.");
    }
    if (project.width <= 0 || project.height <= 0 || project.width * project.height !== project.pixels.length) {
      throw new Error("Invalid project dimensions.");
    }
    this.width = project.width;
    this.height = project.height;
    this.palette = [...project.palette];
    this.pixels = Uint8Array.from(project.pixels);
    this.undoStack = [];
    this.redoStack = [];
  }
}
