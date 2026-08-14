# AiFP 记忆感知系统 — MCP Server

**没有记录，只做记忆感知。** 通过 [Model Context Protocol](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久记忆。

[English](./README.md) · [npm](https://www.npmjs.com/package/aifp-mcp)

让 Claude Code、Cursor、Codex、DeepSeek Harness 等一切支持 MCP 的 AI 工具拥有**跨会话的持续记忆**。完全本地运行，数据不出本机（默认 `~/.ai-cognition/`）。

## 为什么选 AiFP

- **中文优先检索** — `bge-small-zh-v1.5` 向量嵌入（本地 512 维）+ CJK 感知的 FTS5 全文检索。竞品英文优先，AiFP 为中文而生。
- **感知链（云端）** — 有向因果链（LEADS_TO / BECAUSE_OF / ENABLES / PREVENTS / RESPONSE_TO / CO_OCCURS_WITH）、Hebbian 共现、BFS 图扩散，能挖出关键词搜索永远找不到的知识。
- **默认私有** — SQLite 数据库 + 本地嵌入，无云、无账号、无遥测。
- **一条命令配好** — `npm install -g` 自动配置 10+ 个 AI 工具（Claude Code、Cursor、Windsurf、Cline、Gemini CLI、Qwen Code、Zed、VS Code Copilot、Codex CLI、Trae、pi-coding-agent）。

## 快速开始

```bash
npm install -g aifp-mcp
claude mcp add ai-cognition -s user -- npx aifp-mcp
```

重启 Claude Code 即可使用。数据存在 `~/.ai-cognition/data/cognition.db`。

### 在任意 AI 对话中安装（推荐）

不需要手动配任何东西。在 Claude Code、Codex、Cursor、DeepSeek Harness 等任意工具里直接输入：

> 帮我安装记忆系统：`npm install -g aifp-mcp`

`postinstall` 钩子会**自动检测并配置所有已安装的 AI 工具**（Claude Code、Cursor、Windsurf、Cline、Gemini CLI、Qwen Code、Zed、VS Code Copilot、Codex CLI、Trae、DeepSeek Harness、pi-coding-agent），并打印状态报告。重启工具即可使用记忆工具——AI 看到报告后会告诉你重启哪个，**无需手动改任何 MCP 配置文件**。

> **首次启动**：需要下载 ~30MB 的 bge-small-zh 嵌入模型，最多阻塞 45 秒。后续启动有缓存，秒开。

## 本地模式 vs 服务器增强模式

AiFP 支持两种运行模式（环境变量 `COGNITION_MODE`，默认 `remote`）：

| 能力 | 本地模式 | 服务器增强（`remote`） |
|------|:---:|:---:|
| 保存 / 读取 / 列出记忆 | ✅ | ✅ |
| 双路检索（FTS5 + 向量） | ✅ | ✅ + Z-score 融合排序 |
| Hebbian 共现（get_related_memories） | ✅ | ✅（更完整） |
| 自动识别（observe_turn → 识别器） | ⚠️ 需自配 LLM key | ✅ 服务器 LLM，零配置 |
| 一键回忆（recall_context） | 仅基础检索 | ✅ + 感知链深度溯源 |
| **感知链**（追踪/寻路/图统计/扩散） | ❌ | ✅ depth=8 BFS |
| **记忆提炼**（derive_memories） | ❌ | ✅ 服务器 LLM |

本地模式完全私有（数据不出本机），但**感知链工具需要连接服务器**。设置 `COGNITION_SERVER_URL` + `COGNITION_API_KEY` 后自动启用。

## 12 个 MCP 工具

| 工具 | 功能 | 链路 |
|------|------|------|
| `save_memory` | 保存记忆（自动去重 + 向量索引） | 基础 |
| `search_memories` | 双路检索：FTS5 关键词 + 向量语义 | **逻辑链** |
| `recall_context` | 一键回忆（直接命中 + 因果链 + 关联 + 扩散） | **综合链** |
| `get_memory` | 按 ID 获取记忆详情 | 基础 |
| `list_memories` | 分页列出 | 基础 |
| `trace_causal_chain` | BFS 因果链追踪 | **上下链** |
| `diffuse_memories` | 图扩散搜索（关联多跳） | **关系链** |
| `get_memory_tree` | 层级树结构 | 基础 |
| `get_related_memories` | Hebbian 共现关联 | **关系链** |
| `observe_turn` | 记录对话轮次到识别队列（跨平台自动记忆入口） | **自动** |
| `reimport_sources` | 重新扫描外部笔记目录 | 导入 |
| `get_stats` | 系统统计 | 基础 |

## 跨平台自动记忆识别

Claude Code 使用原生 hooks（100% 自动，零遗漏）。其他工具通过 `observe_turn` 工具 + 指令文件实现（详见 `rules/` 目录）：

| 平台 | 配置方式 | 自动程度 |
|------|----------|----------|
| **Claude Code** | hooks（原生） | 100% 自动，零遗漏 |
| **Cursor** | `.cursor/rules/` 指令文件 | AI 遵守指令时自动触发 |
| **Codex CLI** | `AGENTS.md` 指令文件 | AI 遵守指令时自动触发 |
| **Trae** | 项目规则（手动配置） | AI 遵守指令时自动触发 |

指令文件告诉 AI："每次回答完用户后调用 `observe_turn` 记录本轮消息"。系统会自动判断是否有值得记住的内容，不需手动决定。

## 核心技术

- **SQLite + FTS5** 全文索引（CJK 感知，unicode61 tokenizer）
- **bge-small-zh-v1.5 向量嵌入**（本地 512 维语义搜索，自动重试 + 多镜像回退）
- **Hebbian 共现矩阵**（"一起发射的神经元连在一起"）
- **有向因果链**（6 种关系类型）
- **BFS 图扩散**（沿关联多跳发现间接知识）
- **纠错 + 消歧 + 中文时间词解析**

## 一键配置所有 AI 助手

`npm install -g aifp-mcp` 时自动执行（postinstall），无需手动操作。手动运行：

```bash
node dist/setup/index.js     # npm 安装后
npx tsx src/setup/index.ts   # 源码模式
```

自动检测并配置已安装的 AI 工具（检测到才写入，不重复覆盖）：

| 平台 | 配置方式 |
|------|----------|
| Claude Code | `~/.claude/settings.json` → mcpServers + 启动 hook |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | `~/.config/cline/mcp_settings.json` |
| Gemini CLI | `~/.gemini/settings.json` → mcpServers |
| Qwen Code | `~/.qwen/settings.json` → mcpServers |
| Zed | `~/.config/zed/settings.json` → context_servers |
| VS Code Copilot | `%APPDATA%/Code/User/mcp.json` → servers |
| Codex CLI | `~/.codex/config.toml` |
| **pi-coding-agent** | 生成扩展到 `~/.pi/agent/extensions/aifp-memory/`（pi 无内置 MCP，用扩展机制） |

## 手动配置

### Claude Code / Cursor

```json
{
  "mcpServers": {
    "ai-cognition": {
      "command": "node",
      "args": ["path/to/aifp-mcp/dist/index.js"]
    }
  }
}
```

### 自定义数据目录

```bash
COGNITION_DATA_DIR=/path/to/data npx aifp-mcp
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `COGNITION_DATA_DIR` | `~/.ai-cognition/` | 数据存储目录 |
| `COGNITION_MODE` | `remote` | `local` 本地保底 / `remote` 连接服务器增强 |
| `COGNITION_SERVER_URL` | `http://43.143.222.90:5000` | 远程 core-server 地址 |
| `COGNITION_API_KEY` | - | 远程模式 API 密钥 |
| `COGNITION_RECOGNIZER` | `0` | 设为 `1` 启用自动识别 |
| `COGNITION_LLM_API_KEY` | - | 识别器 LLM 密钥（OpenAI 兼容） |
| `COGNITION_LLM_BASE_URL` | `https://api.deepseek.com` | 识别器 LLM 地址 |
| `COGNITION_LLM_MODEL` | `deepseek-chat` | 识别器 LLM 模型 |
| `HF_MIRROR` | `https://hf-mirror.com` | 嵌入模型下载镜像（失败自动回退 huggingface.co） |
| `CORS_ORIGIN` | `*` | HTTP 模式跨域白名单 |
| `PORT` | `5000` | HTTP 端口 |

## 识别器 LLM 配置（启用自动记忆识别）

观察队列需要 LLM 判断是否值得入记忆，二选一：

```bash
# OpenAI 兼容（推荐：DeepSeek 等）
export COGNITION_RECOGNIZER=1
export COGNITION_LLM_API_KEY=你的DeepSeek密钥
export COGNITION_LLM_BASE_URL=https://api.deepseek.com   # 可选，默认同左
export COGNITION_LLM_MODEL=deepseek-chat                 # 可选

# 或 Anthropic
# export COGNITION_RECOGNIZER=1
# export ANTHROPIC_API_KEY=sk-ant-...
```

不配置则只记录观察日志，自动识别不落地（AI 主动 `save_memory` 不受影响）。

## 技术栈
- Node.js 22+ (node:sqlite) + TypeScript
- SQLite (内置) + FTS5
- @xenova/transformers (bge-small-zh-v1.5)
- @modelcontextprotocol/sdk (MCP 协议)

## License

专有软件 — 见 [LICENSE](./LICENSE)。个人/非商业用途免费；商业用途需授权。第三方依赖遵循各自开源许可。
