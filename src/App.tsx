import { useEffect, useMemo, useRef, useState } from "react";
import { PixelCanvas } from "./components/PixelCanvas";
import { executePixelCommandJson, formatCommandResult } from "./core/commandEngine";
import { PixelDocument } from "./core/pixelDocument";
import { useEditorStore } from "./store/editorStore";
import type { PixelProjectFile, Tool } from "./types";

const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: "pencil", label: "Pencil", key: "P" },
  { id: "eraser", label: "Eraser", key: "E" },
  { id: "picker", label: "Picker", key: "I" },
  { id: "fill", label: "Fill", key: "F" },
];

const COMMAND_EXAMPLE = `[
  { "op": "paint_stroke", "color": 5, "points": [
    { "x": 8, "y": 10 },
    { "x": 9, "y": 10 },
    { "x": 10, "y": 10 }
  ]},
  { "op": "set_pixel", "x": 9, "y": 11, "color": 6 }
]`;

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const pixelDocument = useMemo(() => new PixelDocument(), []);
  const [revision, setRevision] = useState(0);
  const [width, setWidth] = useState(pixelDocument.width);
  const [height, setHeight] = useState(pixelDocument.height);
  const [status, setStatus] = useState("Ready");
  const [commandText, setCommandText] = useState(COMMAND_EXAMPLE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    tool,
    zoom,
    gridVisible,
    selectedColor,
    setTool,
    setZoom,
    toggleGrid,
    setSelectedColor,
  } = useEditorStore();

  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        const changed = event.shiftKey ? pixelDocument.redo() : pixelDocument.undo();
        if (changed) refresh();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        if (pixelDocument.redo()) refresh();
        return;
      }
      const match = TOOLS.find((item) => item.key.toLowerCase() === key);
      if (match) setTool(match.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pixelDocument, setTool]);

  const newCanvas = () => {
    const safeWidth = Math.max(1, Math.min(512, Math.floor(width || 1)));
    const safeHeight = Math.max(1, Math.min(512, Math.floor(height || 1)));
    pixelDocument.resize(safeWidth, safeHeight);
    setWidth(safeWidth);
    setHeight(safeHeight);
    setStatus(`New ${safeWidth}×${safeHeight} canvas`);
    refresh();
  };

  const saveProject = () => {
    const json = JSON.stringify(pixelDocument.toProject(), null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "untitled.efsspde.json");
    setStatus("Project saved");
  };

  const loadProject = async (file: File) => {
    try {
      const project = JSON.parse(await file.text()) as PixelProjectFile;
      pixelDocument.loadProject(project);
      setWidth(pixelDocument.width);
      setHeight(pixelDocument.height);
      if (selectedColor >= pixelDocument.palette.length) setSelectedColor(1);
      setStatus(`Loaded ${file.name}`);
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load project");
    }
  };

  const exportPng = () => {
    const canvas = document.createElement("canvas");
    canvas.width = pixelDocument.width;
    canvas.height = pixelDocument.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < pixelDocument.height; y++) {
      for (let x = 0; x < pixelDocument.width; x++) {
        const index = pixelDocument.getPixel(x, y);
        if (index === 0) continue;
        ctx.fillStyle = pixelDocument.palette[index];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "untitled.png");
    }, "image/png");
    setStatus(`PNG exported at native ${pixelDocument.width}×${pixelDocument.height}`);
  };

  const runCommand = () => {
    try {
      const result = executePixelCommandJson(pixelDocument, commandText);
      setStatus(formatCommandResult(result));
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `Command error: ${error.message}` : "Command failed");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>EFSS PDE</strong>
          <span>Pixel Discipline Editor · M1 Command Engine</span>
        </div>
        <div className="top-actions">
          <label className="size-field">W <input value={width} type="number" min="1" max="512" onChange={(e) => setWidth(Number(e.target.value))} /></label>
          <label className="size-field">H <input value={height} type="number" min="1" max="512" onChange={(e) => setHeight(Number(e.target.value))} /></label>
          <button onClick={newCanvas}>New</button>
          <button onClick={() => fileInputRef.current?.click()}>Open</button>
          <button onClick={saveProject}>Save JSON</button>
          <button className="primary" onClick={exportPng}>Export PNG</button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".json,.efsspde"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadProject(file);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <section className="workspace">
        <aside className="panel tools-panel">
          <div className="panel-title">TOOLS</div>
          {TOOLS.map((item) => (
            <button key={item.id} className={tool === item.id ? "active" : ""} onClick={() => setTool(item.id)}>
              <span>{item.label}</span><kbd>{item.key}</kbd>
            </button>
          ))}
          <div className="separator" />
          <button disabled={!pixelDocument.canUndo} onClick={() => { if (pixelDocument.undo()) refresh(); }}>Undo <kbd>Ctrl Z</kbd></button>
          <button disabled={!pixelDocument.canRedo} onClick={() => { if (pixelDocument.redo()) refresh(); }}>Redo <kbd>Ctrl Y</kbd></button>
          <button onClick={() => { pixelDocument.clear(); setStatus("Canvas cleared"); refresh(); }}>Clear</button>
        </aside>

        <section className="canvas-stage">
          <div className="canvas-scroll">
            <PixelCanvas
              document={pixelDocument}
              revision={revision}
              onChange={refresh}
              onPickColor={(index) => { setSelectedColor(index); setStatus(`Picked palette #${index}`); }}
            />
          </div>
        </section>

        <aside className="panel inspector-panel">
          <section>
            <div className="panel-title">PALETTE</div>
            <div className="palette-grid">
              {pixelDocument.palette.map((color, index) => (
                <button
                  key={`${color}-${index}`}
                  className={`swatch ${selectedColor === index ? "selected" : ""}`}
                  style={{ background: index === 0 ? undefined : color }}
                  title={index === 0 ? "Transparent" : `${index}: ${color}`}
                  onClick={() => setSelectedColor(index)}
                >
                  {index === 0 ? "×" : ""}
                </button>
              ))}
            </div>
            <div className="color-readout">
              <span>Index</span><strong>{selectedColor}</strong>
              <span>Color</span><code>{pixelDocument.palette[selectedColor]}</code>
            </div>
          </section>

          <section className="command-lab">
            <div className="panel-title">COMMAND ENGINE</div>
            <p>Deterministic JSON operations. A batch is committed as one undoable transaction.</p>
            <textarea
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              spellCheck={false}
              aria-label="Pixel command JSON"
            />
            <div className="command-actions">
              <button onClick={() => setCommandText(COMMAND_EXAMPLE)}>Example</button>
              <button className="primary" onClick={runCommand}>Apply Command</button>
            </div>
            <div className="op-list">set_pixel · clear_pixel · paint_stroke · fill · move_region · replace_color · flip_x · flip_y</div>
          </section>
        </aside>
      </section>

      <footer className="statusbar">
        <span>{status}</span>
        <div className="status-actions">
          <button className={gridVisible ? "active" : ""} onClick={toggleGrid}>Grid</button>
          {[4, 8, 12, 16, 24, 32].map((value) => (
            <button key={value} className={zoom === value ? "active" : ""} onClick={() => setZoom(value)}>{value}×</button>
          ))}
          <span>{pixelDocument.width}×{pixelDocument.height}px</span>
        </div>
      </footer>
    </main>
  );
}
