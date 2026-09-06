import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PixelDocument } from "../core/pixelDocument";
import { useEditorStore } from "../store/editorStore";
import type { PixelChange } from "../types";

interface Props {
  document: PixelDocument;
  revision: number;
  onionSkin: boolean;
  readOnly?: boolean;
  onChange: () => void;
  onPickColor: (index: number) => void;
}

export function PixelCanvas({
  document,
  revision,
  onionSkin,
  readOnly = false,
  onChange,
  onPickColor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokeChanges = useRef<PixelChange[]>([]);
  const lastCell = useRef<string>("");
  const { tool, zoom, gridVisible, selectedColor } = useEditorStore();
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const drawFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    frameId: string,
    alpha: number,
  ) => {
    ctx.globalAlpha = alpha;
    for (let y = 0; y < document.height; y++) {
      for (let x = 0; x < document.width; x++) {
        const colorIndex = document.getCompositePixel(x, y, frameId);
        if (colorIndex === 0) continue;
        ctx.fillStyle = document.palette[colorIndex] ?? "#ff00ff";
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    ctx.globalAlpha = 1;
  }, [document, zoom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = document.width * zoom;
    const cssHeight = document.height * zoom;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const checker = Math.max(4, Math.floor(zoom / 2));
    for (let y = 0; y < cssHeight; y += checker) {
      for (let x = 0; x < cssWidth; x += checker) {
        ctx.fillStyle = ((x / checker + y / checker) & 1) === 0 ? "#2a2b30" : "#232429";
        ctx.fillRect(x, y, checker, checker);
      }
    }

    const activeIndex = document.activeFrameIndex;
    if (onionSkin && document.frameCount > 1) {
      if (activeIndex > 0) drawFrame(ctx, document.frames[activeIndex - 1].id, 0.2);
      if (activeIndex < document.frameCount - 1) drawFrame(ctx, document.frames[activeIndex + 1].id, 0.1);
    }

    drawFrame(ctx, document.activeFrameId, 1);

    if (gridVisible && zoom >= 6) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= document.width; x++) {
        const px = x * zoom + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, cssHeight);
      }
      for (let y = 0; y <= document.height; y++) {
        const py = y * zoom + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(cssWidth, py);
      }
      ctx.stroke();
    }

    if (cursor && !readOnly) {
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cursor.x * zoom + 0.5, cursor.y * zoom + 0.5, zoom - 1, zoom - 1);
    }
  }, [cursor, document, drawFrame, gridVisible, onionSkin, readOnly, revision, zoom]);

  useEffect(() => draw(), [draw]);

  const cellFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.floor((event.clientX - rect.left) / zoom), y: Math.floor((event.clientY - rect.top) / zoom) };
  };

  const applyCell = (x: number, y: number) => {
    if (readOnly || !document.inBounds(x, y)) return;
    const key = `${x}:${y}`;
    if (lastCell.current === key && tool !== "fill") return;
    lastCell.current = key;
    if (tool === "picker") { onPickColor(document.getCompositePixel(x, y)); return; }
    if (tool === "fill") {
      const changes = document.fill(x, y, selectedColor);
      document.commit(`Fill · ${document.activeLayer.name} · ${document.activeFrame.id}`, changes);
      onChange(); drawing.current = false; return;
    }
    const color = tool === "eraser" ? 0 : selectedColor;
    const change = document.makeChange(x, y, color);
    if (change) { strokeChanges.current.push(change); onChange(); }
  };

  const finishStroke = () => {
    if (!drawing.current) return;
    drawing.current = false; lastCell.current = "";
    if (strokeChanges.current.length) {
      const label = tool === "eraser" ? "Erase stroke" : "Pencil stroke";
      document.commit(`${label} · ${document.activeLayer.name} · ${document.activeFrame.id}`, strokeChanges.current);
      strokeChanges.current = []; onChange();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={`pixel-canvas ${readOnly ? "read-only" : ""}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (readOnly) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true; strokeChanges.current = [];
        const { x, y } = cellFromEvent(event); setCursor({ x, y }); applyCell(x, y);
      }}
      onPointerMove={(event) => {
        const { x, y } = cellFromEvent(event);
        if (document.inBounds(x, y) && !readOnly) setCursor({ x, y }); else setCursor(null);
        if (!readOnly && drawing.current && (tool === "pencil" || tool === "eraser")) applyCell(x, y);
      }}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onPointerLeave={() => { setCursor(null); finishStroke(); }}
      aria-label={`${document.width} by ${document.height} pixel canvas`}
    />
  );
}
