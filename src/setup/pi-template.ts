// @deploy npm — pi 扩展模板
/**
 * 生成 pi 扩展 index.ts 的内容（模板字符串）
 * 与 pi-extension.ts 分离，控制文件行数
 */

export function renderIndexTs(serverEntry: string): string {
  return `/**
 * AiFP 记忆感知系统 — pi 对接扩展（由 aifp-mcp setup 自动生成）
 * 通过 MCP stdio 连接本地 AiFP server，注册全部记忆工具。
 * 识别器配置（可选，通过环境变量）：
 *   COGNITION_RECOGNIZER=1 + COGNITION_LLM_API_KEY/BASE_URL/MODEL（OpenAI 兼容）
 *   或 COGNITION_RECOGNIZER=1 + ANTHROPIC_API_KEY（Anthropic）
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_ENTRY = ${JSON.stringify(serverEntry)};

/** 从 pi 的 auth.json 读取 DeepSeek key（本地识别器用，不落日志） */
function deepseekKey(): string {
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf-8"));
    return auth?.deepseek?.key ?? "";
  } catch {
    return "";
  }
}

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

async function ensureClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const key = process.env.COGNITION_LLM_API_KEY || deepseekKey();
    const t = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      cwd: join(SERVER_ENTRY, "..", ".."),
      env: {
        ...(process.env as Record<string, string>),
        COGNITION_MODE: "local",
        COGNITION_RECOGNIZER: process.env.COGNITION_RECOGNIZER || (key ? "1" : "0"),
        ...(process.env.COGNITION_LLM_API_KEY
          ? { COGNITION_LLM_API_KEY: process.env.COGNITION_LLM_API_KEY }
          : {}),
        ...(key && !process.env.COGNITION_LLM_API_KEY
          ? { COGNITION_LLM_API_KEY: key, COGNITION_LLM_BASE_URL: "https://api.deepseek.com", COGNITION_LLM_MODEL: "deepseek-chat" }
          : {}),
      },
      stderr: "inherit",
    });
    const c = new Client({ name: "pi-aifp-memory", version: "1.0.0" });
    await c.connect(t);
    transport = t;
    client = c;
    return c;
  })();
  try {
    return await connecting;
  } catch (err) {
    connecting = null;
    throw err;
  }
}

function jsonSchemaToType(schema: any): any {
  if (!schema || typeof schema !== "object") return Type.Any();
  switch (schema.type) {
    case "string":
      return Array.isArray(schema.enum) && schema.enum.length > 0
        ? Type.Union(schema.enum.map((v: string) => Type.Literal(v)))
        : Type.String();
    case "integer":
      return Type.Integer();
    case "number":
      return Type.Number();
    case "boolean":
      return Type.Boolean();
    case "array":
      return Type.Array(jsonSchemaToType(schema.items));
    case "object": {
      const props: Record<string, any> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const t = jsonSchemaToType(sub);
        props[key] = (schema.required ?? []).includes(key) ? t : Type.Optional(t);
      }
      return Type.Object(props);
    }
    default:
      return Type.Any();
  }
}

function textOf(result: any): string {
  const parts = (result?.content ?? [])
    .filter((x: any) => x?.type === "text")
    .map((x: any) => x.text);
  return parts.join("\\n");
}

async function registerAiFpTools(pi: ExtensionAPI): Promise<number> {
  const c = await ensureClient();
  const { tools } = await c.listTools();
  const existing = new Set(pi.getAllTools().map((t) => t.name));
  let count = 0;
  for (const tool of tools) {
    if (existing.has(tool.name)) continue;
    count++;
    const schema =
      tool.inputSchema && (tool.inputSchema as any).type === "object"
        ? tool.inputSchema
        : { type: "object", properties: {} };
    pi.registerTool({
      name: tool.name,
      label: tool.name.replace(/_/g, " "),
      description: tool.description ?? \`AiFP 记忆工具：\${tool.name}\`,
      parameters: jsonSchemaToType(schema),
      async execute(_toolCallId, params, signal) {
        const result = await c.callTool(
          { name: tool.name, arguments: params ?? {} },
          undefined,
          { signal },
        );
        return {
          content: [
            { type: "text", text: textOf(result) || JSON.stringify(result ?? {}) },
          ],
          details: { tool: tool.name, isError: result.isError === true },
        };
      },
    });
  }
  return count;
}

let lastObserved = "";
let toolsReady = false;
let toolCount = 0;
let notified = false;

export default async function (pi: ExtensionAPI) {
  const markReady = (n: number) => {
    toolsReady = true;
    toolCount = n;
    console.error(\`[aifp-memory] 记忆工具已就绪（\${n} 个）：save_memory / search_memories / recall_context 等\`);
  };
  registerAiFpTools(pi)
    .then((n) => markReady(n))
    .catch((err) => {
      console.error("[aifp-memory] 工具注册失败:", err);
      pi.on("session_start", () =>
        registerAiFpTools(pi)
          .then((n) => markReady(n))
          .catch(() => {}),
      );
    });

  // 启动就绪提示（Toast，只在 TUI/RPC 且有 UI 时生效）
  pi.on("session_start", async (_event, ctx) => {
    if (notified || !toolsReady) return;
    notified = true;
    try {
      ctx.ui?.notify?.(\`AiFP 记忆系统已就绪 · \${toolCount} 个记忆工具\`, "info");
    } catch {
      /* UI 不可用时静默 */
    }
  });

  pi.on("agent_end", async (event) => {
    try {
      const users = (event.messages ?? [])
        .filter((m: any) => m.role === "user" && Array.isArray(m.content))
        .map((m: any) =>
          m.content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join(" "),
        )
        .filter(Boolean);
      const text = users[users.length - 1];
      if (!text || text === lastObserved) return;
      lastObserved = text;
      const c = await ensureClient();
      await c.callTool({
        name: "observe_turn",
        arguments: { user_message: text.slice(0, 2000) },
      });
    } catch {
      /* 静默 */
    }
  });

  pi.registerCommand("aifp-status", {
    description: "AiFP 记忆系统：连接状态 + 记忆统计",
    handler: async (_args, ctx) => {
      try {
        const c = await ensureClient();
        const res = await c.callTool({ name: "get_stats", arguments: {} });
        ctx.ui.notify(textOf(res) || "AiFP 连接正常", "info");
      } catch (err: any) {
        ctx.ui.notify(\`AiFP 连接失败: \${err?.message ?? String(err)}\`, "error");
      }
    },
  });

  // 手动状态：/aifp-memory-log 输出最近启动日志（排查加载失败用）
  pi.registerCommand("aifp-memory-log", {
    description: "AiFP 记忆系统：最近启动/加载日志",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        \`状态: \${toolsReady ? "已就绪(" + toolCount + "个工具)" : "未就绪"}\`,
        toolsReady ? "info" : "error",
      );
    },
  });

  pi.on("session_shutdown", async () => {
    connecting = null;
    client = null;
    try {
      await transport?.close();
    } catch {
      /* ignore */
    }
    transport = null;
  });
}
`
}
