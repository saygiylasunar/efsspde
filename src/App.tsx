import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OperatorBridge, type BridgeStatus } from "./bridge/operatorBridge";
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
  const [onionSkin, setOnionSkin] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("disconnected");
  const [bridgeDetail, setBridgeDetail] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState("ws://127.0.0.1:8787/editor");
  const [bridgeToken, setBridgeToken] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playingRef = useRef(false);

  const { tool, zoom, gridVisible, selectedColor, setTool, setZoom, toggleGrid, setSelectedColor } = useEditorStore();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const operatorBridge = useMemo(() => new OperatorBridge(pixelDocument, {
    onStatus: (nextStatus, detail) => {
      setBridgeStatus(nextStatus);
      setBridgeDetail(detail ?? "");
    },
    onChange: refresh,
    isWriteLocked: () => playingRef.current,
  }), [pixelDocument, refresh]);

  useEffect(() => () => operatorBridge.disconnect(), [operatorBridge]);

  useEffect(() => {
    if (!playing || pixelDocument.frameCount < 2) return;
    const timeout = window.setTimeout(() => {
      pixelDocument.nextFrame(true);
      refresh();
    }, pixelDocument.activeFrame.durationMs);
    return () => window.clearTimeout(timeout);
  }, [playing, pixelDocument, refresh, revision]);

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
      if (key === " ") {
        event.preventDefault();
        if (pixelDocument.frameCount > 1) setPlaying((value) => !value);
        return;
      }
      const match = TOOLS.find((item) => item.key.toLowerCase() === key);
      if (match) setTool(match.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pixelDocument, refresh, setTool]);

  const newCanvas = () => {
    setPlaying(false);
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
    setStatus("Project v3 saved");
  };

  const loadProject = async (file: File) => {
    try {
      setPlaying(false);
      const project = JSON.parse(await file.text()) as PixelProjectFile;
      pixelDocument.loadProject(project);
      setWidth(pixelDocument.width);
      setHeight(pixelDocument.height);
      if (selectedColor >= pixelDocument.palette.length) setSelectedColor(1);
      setStatus(`Loaded ${file.name} · ${pixelDocument.layerCount} layer(s) · ${pixelDocument.frameCount} frame(s)`);
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
        const index = pixelDocument.getCompositePixel(x, y);
        if (index === 0) continue;
        ctx.fillStyle = pixelDocument.palette[index];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `frame-${pixelDocument.activeFrameIndex + 1}.png`);
    }, "image/png");
    setStatus(`Frame ${pixelDocument.activeFrameIndex + 1} PNG exported`);
  };

  const runCommand = () => {
    try {
      const result = executePixelCommandJson(pixelDocument, commandText);
      setStatus(`${formatCommandResult(result)} · ${pixelDocument.activeLayer.name} · F${pixelDocument.activeFrameIndex + 1}`);
      refresh();
    } catch (error) {
      setStatus(error instanceof Error ? `Command error: ${error.message}` : "Command failed");
    }
  };

  const connectBridge = () => {
    try {
      operatorBridge.connect(bridgeUrl, bridgeToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridgeStatus("error");
      setBridgeDetail(message);
      setStatus(`Bridge: ${message}`);
    }
  };

  const addLayer = () => {
    const layer = pixelDocument.addLayer();
    setStatus(`Added ${layer.name}`);
    refresh();
  };

  const deleteLayer = () => {
    const name = pixelDocument.activeLayer.name;
    if (pixelDocument.deleteLayer(pixelDocument.activeLayerId)) {
      setStatus(`Deleted ${name}`);
      refresh();
    }
  };

  const moveLayer = (direction: "up" | "down") => {
    if (pixelDocument.moveLayer(pixelDocument.activeLayerId, direction)) {
      setStatus(`Moved ${pixelDocument.activeLayer.name} ${direction}`);
      refresh();
    }
  };

  const addFrame = (duplicate: boolean) => {
    setPlaying(false);
    const frame = pixelDocument.addFrame(duplicate);
    setStatus(`${duplicate ? "Duplicated" : "Added"} ${frame.id}`);
    refresh();
  };

  const deleteFrame = () => {
    setPlaying(false);
    const label = pixelDocument.activeFrame.id;
    if (pixelDocument.deleteFrame(pixelDocument.activeFrameId)) {
      setStatus(`Deleted ${label}`);
      refresh();
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>EFSS PDE</strong>
          <span>Pixel Discipline Editor · M4 Operator Bridge</span>
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
          <button disabled={!pixelDocument.canUndo || playing} onClick={() => { if (pixelDocument.undo()) refresh(); }}>Undo <kbd>Ctrl Z</kbd></button>
          <button disabled={!pixelDocument.canRedo || playing} onClick={() => { if (pixelDocument.redo()) refresh(); }}>Redo <kbd>Ctrl Y</kbd></button>
          <button disabled={playing} onClick={() => { pixelDocument.clear(); setStatus(`Cleared ${pixelDocument.activeLayer.name}`); refresh(); }}>Clear cel</button>
        </aside>

        <section className="canvas-stage">
          <div className="canvas-scroll">
            <PixelCanvas
              document={pixelDocument}
              revision={revision}
              onionSkin={onionSkin && !playing}
              readOnly={playing}
              onChange={refresh}
              onPickColor={(index) => {
                setSelectedColor(index);
                setStatus(`Picked palette #${index}`);
              }}
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

          <section className="layers-panel">
            <div className="panel-title">LAYERS</div>
            <div className="layer-toolbar">
              <button onClick={addLayer}>+ Layer</button>
              <button disabled={pixelDocument.layerCount <= 1} onClick={deleteLayer}>Delete</button>
              <button onClick={() => moveLayer("up")}>↑</button>
              <button onClick={() => moveLayer("down")}>↓</button>
            </div>
            <div className="layer-list">
              {[...pixelDocument.layers].reverse().map((layer) => (
                <div key={layer.id} className={`layer-row ${pixelDocument.activeLayerId === layer.id ? "selected" : ""}`}>
                  <button
                    className="visibility-button"
                    title={layer.visible ? "Hide layer" : "Show layer"}
                    onClick={() => {
                      pixelDocument.toggleLayerVisibility(layer.id);
                      refresh();
                    }}
                  >
                    {layer.visible ? "●" : "○"}
                  </button>
                  <button
                    className="layer-name"
                    onClick={() => {
                      pixelDocument.setActiveLayer(layer.id);
                      setStatus(`Active: ${layer.name}`);
                      refresh();
                    }}
                  >
                    {layer.name}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="bridge-panel">
            <div className="panel-title">OPERATOR BRIDGE</div>
            <div className={`bridge-status ${bridgeStatus}`}>
              <span className="bridge-dot" />
              <strong>{bridgeStatus}</strong>
              {bridgeDetail ? <span title={bridgeDetail}>{bridgeDetail}</span> : null}
            </div>
            <label className="bridge-field">
              <span>Editor socket</span>
              <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} spellCheck={false} />
            </label>
            <label className="bridge-field">
              <span>Editor token</span>
              <input
                type="password"
                value={bridgeToken}
                onChange={(event) => setBridgeToken(event.target.value)}
                autoComplete="off"
                placeholder="printed by npm run bridge"
              />
            </label>
            <div className="bridge-actions">
              <button
                className="primary"
                disabled={bridgeStatus === "connecting" || bridgeStatus === "connected"}
                onClick={connectBridge}
              >
                Connect
              </button>
              <button disabled={bridgeStatus === "disconnected"} onClick={() => operatorBridge.disconnect()}>
                Disconnect
              </button>
            </div>
            <p>
              The token stays in memory only. The bridge exposes MCP tools; pixel writes remain deterministic and undoable.
            </p>
          </section>

          <section className="command-lab">
            <div className="panel-title">COMMAND ENGINE</div>
            <p>Commands affect the active layer and active frame as one undoable transaction.</p>
            <textarea
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              spellCheck={false}
              aria-label="Pixel command JSON"
              disabled={playing}
            />
            <div className="command-actions">
              <button disabled={playing} onClick={() => setCommandText(COMMAND_EXAMPLE)}>Example</button>
              <button disabled={playing} className="primary" onClick={runCommand}>Apply Command</button>
            </div>
            <div className="op-list">set_pixel · clear_pixel · paint_stroke · fill · move_region · replace_color · flip_x · flip_y</div>
          </section>
        </aside>
      </section>

      <section className="timeline">
        <div className="timeline-controls">
          <button className={playing ? "active" : ""} disabled={pixelDocument.frameCount < 2} onClick={() => setPlaying((value) => !value)}>
            {playing ? "Pause" : "Play"} <kbd>Space</kbd>
          </button>
          <button disabled={playing} onClick={() => addFrame(false)}>+ Frame</button>
          <button disabled={playing} onClick={() => addFrame(true)}>Duplicate</button>
          <button disabled={playing || pixelDocument.frameCount <= 1} onClick={deleteFrame}>Delete</button>
          <button className={onionSkin ? "active" : ""} disabled={playing} onClick={() => setOnionSkin((value) => !value)}>Onion</button>
          <label className="duration-field">
            Duration
            <input
              type="number"
              min="20"
              max="5000"
              step="10"
              value={pixelDocument.activeFrame.durationMs}
              disabled={playing}
              onChange={(event) => {
                pixelDocument.setFrameDuration(pixelDocument.activeFrameId, Number(event.target.value));
                refresh();
              }}
            /> ms
          </label>
        </div>
        <div className="frame-strip">
          {pixelDocument.frames.map((frame, index) => (
            <button
              key={frame.id}
              className={`frame-chip ${pixelDocument.activeFrameId === frame.id ? "active" : ""}`}
              onClick={() => {
                setPlaying(false);
                pixelDocument.setActiveFrame(frame.id);
                setStatus(`Frame ${index + 1}`);
                refresh();
              }}
            >
              <strong>F{index + 1}</strong><span>{frame.durationMs}ms</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="statusbar">
        <span>{status}</span>
        <div className="status-actions">
          <span className={`bridge-mini ${bridgeStatus}`}>Bridge: {bridgeStatus}</span>
          <span className="active-layer-status">F{pixelDocument.activeFrameIndex + 1} · {pixelDocument.activeLayer.name}</span>
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
