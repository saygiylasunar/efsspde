import type {
  CommandExecutionResult,
  PixelChange,
  PixelOperation,
  PixelPoint,
  PixelRegion,
} from "../types";
import { PixelDocument } from "./pixelDocument";

type UnknownRecord = Record<string, unknown>;

export interface ExecutePixelCommandOptions {
  label?: string;
  commit?: boolean;
}

function asRecord(value: unknown, name: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as UnknownRecord;
}

function integer(value: unknown, name: string) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value as number;
}

function pointFrom(value: unknown, name: string): PixelPoint {
  const record = asRecord(value, name);
  return {
    x: integer(record.x, `${name}.x`),
    y: integer(record.y, `${name}.y`),
  };
}

function regionFrom(value: unknown, name = "region"): PixelRegion {
  const record = asRecord(value, name);
  const region = {
    x: integer(record.x, `${name}.x`),
    y: integer(record.y, `${name}.y`),
    width: integer(record.width, `${name}.width`),
    height: integer(record.height, `${name}.height`),
  };
  if (region.width <= 0 || region.height <= 0) {
    throw new Error(`${name} width and height must be positive.`);
  }
  return region;
}

function colorFrom(value: unknown, name: string, document: PixelDocument) {
  const color = integer(value, name);
  if (color < 0 || color >= document.palette.length) {
    throw new Error(`${name} must be a valid palette index (0-${document.palette.length - 1}).`);
  }
  return color;
}

function assertPointInBounds(document: PixelDocument, x: number, y: number, name = "point") {
  if (!document.inBounds(x, y)) {
    throw new Error(`${name} (${x}, ${y}) is outside the ${document.width}×${document.height} canvas.`);
  }
}

function assertRegionInBounds(document: PixelDocument, region: PixelRegion, name = "region") {
  const x2 = region.x + region.width - 1;
  const y2 = region.y + region.height - 1;
  if (!document.inBounds(region.x, region.y) || !document.inBounds(x2, y2)) {
    throw new Error(`${name} is outside the ${document.width}×${document.height} canvas.`);
  }
}

export function parsePixelOperation(value: unknown, document: PixelDocument): PixelOperation {
  const record = asRecord(value, "command");
  const op = record.op;
  if (typeof op !== "string") throw new Error("command.op must be a string.");

  switch (op) {
    case "set_pixel": {
      const x = integer(record.x, "x");
      const y = integer(record.y, "y");
      assertPointInBounds(document, x, y);
      return { op, x, y, color: colorFrom(record.color, "color", document) };
    }
    case "clear_pixel": {
      const x = integer(record.x, "x");
      const y = integer(record.y, "y");
      assertPointInBounds(document, x, y);
      return { op, x, y };
    }
    case "paint_stroke": {
      if (!Array.isArray(record.points) || record.points.length === 0) {
        throw new Error("points must be a non-empty array.");
      }
      const points = record.points.map((item, index) => pointFrom(item, `points[${index}]`));
      points.forEach((point, index) => assertPointInBounds(document, point.x, point.y, `points[${index}]`));
      return { op, points, color: colorFrom(record.color, "color", document) };
    }
    case "fill": {
      const x = integer(record.x, "x");
      const y = integer(record.y, "y");
      assertPointInBounds(document, x, y);
      return { op, x, y, color: colorFrom(record.color, "color", document) };
    }
    case "move_region": {
      const region = regionFrom(record.region);
      assertRegionInBounds(document, region);
      const dx = integer(record.dx, "dx");
      const dy = integer(record.dy, "dy");
      const destination = { ...region, x: region.x + dx, y: region.y + dy };
      assertRegionInBounds(document, destination, "destination region");
      return { op, region, dx, dy };
    }
    case "replace_color":
      return {
        op,
        from: colorFrom(record.from, "from", document),
        to: colorFrom(record.to, "to", document),
      };
    case "flip_x":
    case "flip_y": {
      const region = record.region === undefined
        ? { x: 0, y: 0, width: document.width, height: document.height }
        : regionFrom(record.region);
      assertRegionInBounds(document, region);
      return { op, region };
    }
    default:
      throw new Error(`Unsupported pixel operation: ${op}`);
  }
}

function applyOperation(document: PixelDocument, operation: PixelOperation): PixelChange[] {
  const changes: PixelChange[] = [];

  const set = (x: number, y: number, color: number) => {
    const change = document.makeChange(x, y, color);
    if (change) changes.push(change);
  };

  switch (operation.op) {
    case "set_pixel":
      set(operation.x, operation.y, operation.color);
      break;
    case "clear_pixel":
      set(operation.x, operation.y, 0);
      break;
    case "paint_stroke":
      operation.points.forEach((point) => set(point.x, point.y, operation.color));
      break;
    case "fill":
      changes.push(...document.fill(operation.x, operation.y, operation.color));
      break;
    case "replace_color":
      if (operation.from !== operation.to) {
        for (let y = 0; y < document.height; y++) {
          for (let x = 0; x < document.width; x++) {
            if (document.getPixel(x, y) === operation.from) set(x, y, operation.to);
          }
        }
      }
      break;
    case "move_region": {
      const { region, dx, dy } = operation;
      const snapshot = new Uint8Array(region.width * region.height);
      for (let ry = 0; ry < region.height; ry++) {
        for (let rx = 0; rx < region.width; rx++) {
          snapshot[ry * region.width + rx] = document.getPixel(region.x + rx, region.y + ry);
        }
      }
      for (let ry = 0; ry < region.height; ry++) {
        for (let rx = 0; rx < region.width; rx++) set(region.x + rx, region.y + ry, 0);
      }
      for (let ry = 0; ry < region.height; ry++) {
        for (let rx = 0; rx < region.width; rx++) {
          set(region.x + dx + rx, region.y + dy + ry, snapshot[ry * region.width + rx]);
        }
      }
      break;
    }
    case "flip_x":
    case "flip_y": {
      const region = operation.region ?? { x: 0, y: 0, width: document.width, height: document.height };
      const snapshot = new Uint8Array(region.width * region.height);
      for (let ry = 0; ry < region.height; ry++) {
        for (let rx = 0; rx < region.width; rx++) {
          snapshot[ry * region.width + rx] = document.getPixel(region.x + rx, region.y + ry);
        }
      }
      for (let ry = 0; ry < region.height; ry++) {
        for (let rx = 0; rx < region.width; rx++) {
          const sx = operation.op === "flip_x" ? region.width - 1 - rx : rx;
          const sy = operation.op === "flip_y" ? region.height - 1 - ry : ry;
          set(region.x + rx, region.y + ry, snapshot[sy * region.width + sx]);
        }
      }
      break;
    }
  }

  return changes;
}

function summarize(label: string, operations: number, changes: PixelChange[]): CommandExecutionResult {
  const unique = new Map<string, PixelChange>();
  for (const change of changes) {
    const key = `${change.frameId}:${change.layerId}:${change.index}`;
    const existing = unique.get(key);
    if (existing) existing.after = change.after;
    else unique.set(key, { ...change });
  }

  let changedPixels = 0;
  let addedPixels = 0;
  let removedPixels = 0;
  let recoloredPixels = 0;

  for (const change of unique.values()) {
    if (change.before === change.after) continue;
    changedPixels++;
    if (change.before === 0 && change.after !== 0) addedPixels++;
    else if (change.before !== 0 && change.after === 0) removedPixels++;
    else recoloredPixels++;
  }

  return { label, operations, changedPixels, addedPixels, removedPixels, recoloredPixels };
}

export function executePixelCommands(
  document: PixelDocument,
  input: unknown,
  options: ExecutePixelCommandOptions | string = {},
): CommandExecutionResult {
  const normalized = typeof options === "string" ? { label: options } : options;
  const label = normalized.label ?? "Command Engine";
  const commit = normalized.commit ?? true;

  const rawCommands = Array.isArray(input) ? input : [input];
  if (rawCommands.length === 0) throw new Error("Command batch cannot be empty.");

  const operations = rawCommands.map((command) => parsePixelOperation(command, document));
  const changes: PixelChange[] = [];

  try {
    for (const operation of operations) changes.push(...applyOperation(document, operation));
  } catch (error) {
    document.rollbackChanges(changes);
    throw error;
  }

  const result = summarize(label, operations.length, changes);
  if (commit) document.commit(label, changes);
  else document.rollbackChanges(changes);
  return result;
}

export function previewPixelCommands(document: PixelDocument, input: unknown, label = "Preview") {
  return executePixelCommands(document, input, { label, commit: false });
}

export function executePixelCommandJson(document: PixelDocument, json: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Command JSON is not valid.");
  }
  return executePixelCommands(document, parsed);
}

export function formatCommandResult(result: CommandExecutionResult) {
  return [
    `${result.operations} op`,
    `${result.changedPixels} px changed`,
    `+${result.addedPixels}`,
    `-${result.removedPixels}`,
    `~${result.recoloredPixels}`,
  ].join(" · ");
}
