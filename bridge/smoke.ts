import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { WebSocket } from "ws";

const EDITOR_URL = process.env.EFSS_EDITOR_URL ?? "ws://127.0.0.1:8787/editor";
const MCP_URL = process.env.EFSS_MCP_URL ?? "http://127.0.0.1:8787/mcp";
const EDITOR_TOKEN = process.env.EFSS_EDITOR_TOKEN ?? "ci-editor-token";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function waitForEditor() {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(EDITOR_URL);
    const timer = setTimeout(() => reject(new Error("Editor WebSocket handshake timed out.")), 5_000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "hello",
        protocol: 1,
        role: "editor",
        token: EDITOR_TOKEN,
        editor: { name: "EFSS PDE Smoke", version: "0.4.0" },
      }));
    });

    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (message.type === "hello_ack") {
        clearTimeout(timer);
        resolve(socket);
        return;
      }

      if (message.type !== "request" || typeof message.id !== "string" || typeof message.method !== "string") return;

      let result: unknown;
      switch (message.method) {
        case "get_state":
          result = {
            protocol: 1,
            width: 4,
            height: 4,
            palette: ["#00000000", "#ffffff"],
            layers: [{ id: "layer-1", name: "Layer 1", visible: true }],
            frames: [{ id: "frame-1", index: 0, durationMs: 120 }],
            activeLayerId: "layer-1",
            activeFrameId: "frame-1",
            canUndo: false,
            canRedo: false,
          };
          break;
        case "get_frame":
          result = { frameId: "frame-1", width: 4, height: 4, pixels: new Array(16).fill(0) };
          break;
        case "preview_operations":
          result = { label: "smoke", operations: 1, changedPixels: 1, addedPixels: 1, removedPixels: 0, recoloredPixels: 0 };
          break;
        case "execute_operations":
          result = { label: "smoke", operations: 1, changedPixels: 1, addedPixels: 1, removedPixels: 0, recoloredPixels: 0, activeLayerId: "layer-1", activeFrameId: "frame-1" };
          break;
        case "set_context":
          result = { activeLayerId: "layer-1", activeFrameId: "frame-1" };
          break;
        case "undo":
        case "redo":
          result = { changed: false };
          break;
        default:
          socket.send(JSON.stringify({ type: "response", id: message.id, ok: false, error: "unsupported smoke method" }));
          return;
      }

      socket.send(JSON.stringify({ type: "response", id: message.id, ok: true, result }));
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const editor = await waitForEditor();

  const health = await fetch("http://127.0.0.1:8787/health");
  assert(health.ok, "Bridge health endpoint failed.");
  const healthBody = await health.json() as { editorConnected?: boolean };
  assert(healthBody.editorConnected === true, "Bridge did not report the editor as connected.");

  const client = new Client(
    { name: "efsspde-smoke", version: "0.4.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);

  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const required of [
    "pde_get_state",
    "pde_get_frame",
    "pde_preview_operations",
    "pde_execute_operations",
    "pde_set_context",
    "pde_undo",
    "pde_redo",
  ]) {
    assert(names.has(required), `Missing MCP tool: ${required}`);
  }

  const result = await client.callTool({ name: "pde_get_state", arguments: {} });
  const text = result.content.find((item) => item.type === "text");
  assert(text?.type === "text", "pde_get_state did not return text content.");
  const state = JSON.parse(text.text) as { width?: number; activeLayerId?: string };
  assert(state.width === 4, "Unexpected state width.");
  assert(state.activeLayerId === "layer-1", "Unexpected active layer.");

  await client.callTool({
    name: "pde_preview_operations",
    arguments: {
      operations: [{ op: "set_pixel", x: 1, y: 1, color: 1 }],
    },
  });

  await client.close();
  editor.close(1000, "Smoke complete");
  process.stdout.write("EFSS PDE Operator Bridge smoke test passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
