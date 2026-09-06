import { executePixelCommands, previewPixelCommands } from "../core/commandEngine";
import { PixelDocument } from "../core/pixelDocument";

export type BridgeStatus = "disconnected" | "connecting" | "connected" | "error";

interface BridgeRequest {
  type: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface BridgeHooks {
  onStatus: (status: BridgeStatus, detail?: string) => void;
  onChange: () => void;
  isWriteLocked: () => boolean;
}

interface ContextParams {
  frameId?: string;
  layerId?: string;
}

function asString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function contextFrom(params: Record<string, unknown> | undefined): ContextParams {
  if (!params) return {};
  return {
    frameId: params.frameId === undefined ? undefined : asString(params.frameId, "frameId"),
    layerId: params.layerId === undefined ? undefined : asString(params.layerId, "layerId"),
  };
}

export class OperatorBridge {
  private socket: WebSocket | null = null;
  private manuallyClosed = false;

  constructor(
    private readonly document: PixelDocument,
    private readonly hooks: BridgeHooks,
  ) {}

  connect(url: string, token: string) {
    this.disconnect();
    if (!url.trim()) throw new Error("Bridge URL is required.");
    if (!token.trim()) throw new Error("Editor token is required.");

    this.manuallyClosed = false;
    this.hooks.onStatus("connecting", url);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        type: "hello",
        protocol: 1,
        role: "editor",
        token,
        editor: {
          name: "EFSS PDE",
          version: "0.4.0",
        },
      }));
    });

    socket.addEventListener("message", (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      void this.handleMessage(message);
    });

    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.socket = null;
      this.hooks.onStatus(
        this.manuallyClosed ? "disconnected" : "error",
        event.reason || `Socket closed (${event.code})`,
      );
    });

    socket.addEventListener("error", () => {
      this.hooks.onStatus("error", "WebSocket connection failed.");
    });
  }

  disconnect() {
    this.manuallyClosed = true;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "Editor disconnected");
    this.hooks.onStatus("disconnected");
  }

  private async handleMessage(value: unknown) {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;

    if (record.type === "hello_ack") {
      this.hooks.onStatus("connected", typeof record.sessionId === "string" ? record.sessionId : undefined);
      return;
    }

    if (record.type !== "request" || typeof record.id !== "string" || typeof record.method !== "string") return;
    const request = record as unknown as BridgeRequest;

    try {
      const result = await this.dispatch(request.method, request.params);
      this.send({ type: "response", id: request.id, ok: true, result });
    } catch (error) {
      this.send({
        type: "response",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private withContext<T>(params: ContextParams, restore: boolean, callback: () => T): T {
    const previousFrame = this.document.activeFrameId;
    const previousLayer = this.document.activeLayerId;

    if (params.frameId && !this.document.setActiveFrame(params.frameId)) {
      throw new Error(`Unknown frameId: ${params.frameId}`);
    }
    if (params.layerId && !this.document.setActiveLayer(params.layerId)) {
      if (restore) this.document.setActiveFrame(previousFrame);
      throw new Error(`Unknown layerId: ${params.layerId}`);
    }

    try {
      return callback();
    } finally {
      if (restore) {
        this.document.setActiveFrame(previousFrame);
        this.document.setActiveLayer(previousLayer);
      }
    }
  }

  private requireWritable() {
    if (this.hooks.isWriteLocked()) throw new Error("Editor is currently write-locked (animation playback is active).");
  }

  private async dispatch(method: string, params?: Record<string, unknown>) {
    switch (method) {
      case "get_state":
        return {
          protocol: 1,
          width: this.document.width,
          height: this.document.height,
          palette: [...this.document.palette],
          layers: this.document.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
          })),
          frames: this.document.frames.map((frame, index) => ({
            id: frame.id,
            index,
            durationMs: frame.durationMs,
          })),
          activeLayerId: this.document.activeLayerId,
          activeFrameId: this.document.activeFrameId,
          canUndo: this.document.canUndo,
          canRedo: this.document.canRedo,
        };

      case "get_frame": {
        const frameId = params?.frameId === undefined
          ? this.document.activeFrameId
          : asString(params.frameId, "frameId");
        if (!this.document.getFrame(frameId)) throw new Error(`Unknown frameId: ${frameId}`);

        const pixels = new Array<number>(this.document.width * this.document.height);
        for (let y = 0; y < this.document.height; y++) {
          for (let x = 0; x < this.document.width; x++) {
            pixels[y * this.document.width + x] = this.document.getCompositePixel(x, y, frameId);
          }
        }

        return {
          frameId,
          width: this.document.width,
          height: this.document.height,
          pixels,
        };
      }

      case "preview_operations": {
        const context = contextFrom(params);
        const operations = params?.operations;
        const label = typeof params?.label === "string" ? params.label : "Operator preview";
        return this.withContext(context, true, () => previewPixelCommands(this.document, operations, label));
      }

      case "execute_operations": {
        this.requireWritable();
        const context = contextFrom(params);
        const operations = params?.operations;
        const label = typeof params?.label === "string" ? params.label : "Remote operator";
        const result = this.withContext(context, false, () =>
          executePixelCommands(this.document, operations, { label, commit: true }),
        );
        this.hooks.onChange();
        return {
          ...result,
          activeLayerId: this.document.activeLayerId,
          activeFrameId: this.document.activeFrameId,
        };
      }

      case "set_context": {
        this.requireWritable();
        const context = contextFrom(params);
        if (context.frameId && !this.document.setActiveFrame(context.frameId)) throw new Error(`Unknown frameId: ${context.frameId}`);
        if (context.layerId && !this.document.setActiveLayer(context.layerId)) throw new Error(`Unknown layerId: ${context.layerId}`);
        this.hooks.onChange();
        return {
          activeLayerId: this.document.activeLayerId,
          activeFrameId: this.document.activeFrameId,
        };
      }

      case "undo":
        this.requireWritable();
        if (!this.document.undo()) return { changed: false };
        this.hooks.onChange();
        return { changed: true };

      case "redo":
        this.requireWritable();
        if (!this.document.redo()) return { changed: false };
        this.hooks.onChange();
        return { changed: true };

      default:
        throw new Error(`Unsupported bridge method: ${method}`);
    }
  }
}
