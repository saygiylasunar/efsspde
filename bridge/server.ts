import { randomBytes, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { URL } from "node:url";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { WebSocket, WebSocketServer } from "ws";
import * as z from "zod/v4";

const HOST = process.env.EFSS_BRIDGE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.EFSS_BRIDGE_PORT ?? 8787);
const EDITOR_TOKEN = process.env.EFSS_EDITOR_TOKEN ?? randomBytes(24).toString("base64url");
const MCP_TOKEN = process.env.EFSS_MCP_TOKEN?.trim() || null;
const REQUEST_TIMEOUT_MS = 8_000;

type JsonRecord = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let editorSocket: WebSocket | null = null;
let editorSessionId: string | null = null;
const pending = new Map<string, PendingRequest>();

function log(message: string) {
  process.stderr.write(`[efsspde-bridge] ${message}\n`);
}

function rejectPending(reason: string) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  pending.clear();
}

function callEditor(method: string, params: JsonRecord = {}) {
  return new Promise<unknown>((resolve, reject) => {
    if (!editorSocket || editorSocket.readyState !== WebSocket.OPEN || !editorSessionId) {
      reject(new Error("No authenticated EFSS PDE editor is connected."));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Editor request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    editorSocket.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

function jsonToolResult(value: unknown) {
  const text = JSON.stringify(value);
  return {
    content: [{ type: "text" as const, text }],
  };
}

const operationSchema = z.record(z.string(), z.unknown());
const contextFields = {
  frameId: z.string().min(1).optional(),
  layerId: z.string().min(1).optional(),
};

function createPdeMcpServer() {
  const server = new McpServer(
    { name: "efsspde-operator", version: "0.4.0" },
    {
      instructions:
        "Read pde_get_state before editing. Prefer pde_preview_operations before pde_execute_operations. " +
        "Pixel coordinates are integer-native and colors are palette indices. Never invent layer or frame IDs.",
    },
  );

  server.registerTool(
    "pde_get_state",
    {
      title: "Get PDE State",
      description: "Read EFSS PDE canvas size, palette, layers, frames, active context, and undo/redo availability.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => jsonToolResult(await callEditor("get_state")),
  );

  server.registerTool(
    "pde_get_frame",
    {
      title: "Get Composited Frame",
      description: "Read one composited frame as native palette-index pixels in row-major order.",
      inputSchema: z.object({
        frameId: z.string().min(1).optional().describe("Known frame ID. Omit for the active frame."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ frameId }) => jsonToolResult(await callEditor("get_frame", { frameId })),
  );

  server.registerTool(
    "pde_preview_operations",
    {
      title: "Preview Pixel Operations",
      description: "Validate and simulate deterministic pixel operations, return a diff summary, then roll every pixel back.",
      inputSchema: z.object({
        ...contextFields,
        label: z.string().max(120).optional(),
        operations: z.array(operationSchema).min(1),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => jsonToolResult(await callEditor("preview_operations", args)),
  );

  server.registerTool(
    "pde_execute_operations",
    {
      title: "Execute Pixel Operations",
      description: "Apply a deterministic pixel-operation batch to a target frame/layer as one undoable transaction.",
      inputSchema: z.object({
        ...contextFields,
        label: z.string().max(120).optional(),
        operations: z.array(operationSchema).min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => jsonToolResult(await callEditor("execute_operations", args)),
  );

  server.registerTool(
    "pde_set_context",
    {
      title: "Set Active Frame and Layer",
      description: "Select a known frame and/or layer in the connected editor.",
      inputSchema: z.object(contextFields).refine(
        (value) => Boolean(value.frameId || value.layerId),
        "At least one of frameId or layerId is required.",
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => jsonToolResult(await callEditor("set_context", args)),
  );

  server.registerTool(
    "pde_undo",
    {
      title: "Undo PDE Edit",
      description: "Undo the latest pixel transaction in the connected editor.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => jsonToolResult(await callEditor("undo")),
  );

  server.registerTool(
    "pde_redo",
    {
      title: "Redo PDE Edit",
      description: "Redo the latest undone pixel transaction in the connected editor.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => jsonToolResult(await callEditor("redo")),
  );

  return server;
}

const mcpHandler = toNodeHandler(createMcpHandler(createPdeMcpServer));
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  let authenticated = false;
  const authTimer = setTimeout(() => socket.close(4001, "Authentication timeout"), 5_000);

  socket.on("message", (raw) => {
    let message: JsonRecord;
    try {
      message = JSON.parse(raw.toString()) as JsonRecord;
    } catch {
      socket.close(4002, "Invalid JSON");
      return;
    }

    if (!authenticated) {
      if (
        message.type !== "hello" ||
        message.role !== "editor" ||
        message.protocol !== 1 ||
        message.token !== EDITOR_TOKEN
      ) {
        socket.close(4003, "Authentication failed");
        return;
      }

      clearTimeout(authTimer);
      authenticated = true;

      if (editorSocket && editorSocket !== socket) {
        editorSocket.close(4004, "Replaced by a new editor connection");
        rejectPending("Editor connection was replaced.");
      }

      editorSocket = socket;
      editorSessionId = randomUUID();
      socket.send(JSON.stringify({ type: "hello_ack", protocol: 1, sessionId: editorSessionId }));
      log(`editor connected (session ${editorSessionId})`);
      return;
    }

    if (message.type === "response" && typeof message.id === "string") {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);

      if (message.ok === true) request.resolve(message.result);
      else request.reject(new Error(typeof message.error === "string" ? message.error : "Editor request failed."));
    }
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    if (editorSocket === socket) {
      editorSocket = null;
      editorSessionId = null;
      rejectPending("Editor disconnected.");
      log("editor disconnected");
    }
  });
});

const httpServer = createHttpServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      editorConnected: Boolean(editorSocket && editorSocket.readyState === WebSocket.OPEN && editorSessionId),
      sessionId: editorSessionId,
    }));
    return;
  }

  if (url.pathname === "/mcp") {
    if (MCP_TOKEN) {
      const authorization = req.headers.authorization;
      if (authorization !== `Bearer ${MCP_TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
    }
    void mcpHandler(req, res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/editor") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

httpServer.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  log(`editor WebSocket: ws://${HOST}:${PORT}/editor`);
  log(`editor token: ${EDITOR_TOKEN}`);
  if (MCP_TOKEN) log("MCP bearer authentication: enabled");
  else log("MCP bearer authentication: disabled (safe only while bound to loopback or behind a trusted tunnel)");
});
