# AiFP 记忆感知系统 — MCP Server

**没有记录，只做记忆感知。** 通过 [Model Context Protocol](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久记忆。

[English](./README.md) · [npm](https://www.npmjs.com/package/aifp-mcp)

让 Claude Code、Cursor、Codex、DeepSeek Harness 等一切支持 MCP 的 AI 工具拥有**跨会话的持续记忆**。完全本地运行，数据不出本机（默认 `~/.ai-cognition/`）。

## 为什么选 AiFP — 是大脑，不是文件柜

多数 AI 记忆系统只是**存储**——一个供搜索的文件柜。AiFP 的目标是像大脑一样**感知、联结、遗忘**：

| 概念 | 干什么 | 真实能力 |
|------|--------|---------|
| 🧠 **海马体 · 记忆感知** | 新信息先判断再存储 | `observe_turn` → 自动识别器判断值不值得记 |
| 👃 **嗅觉皮层 · 语义检索** | 说错也能找到 | 双路检索：CJK FTS5 全文 + `bge-small-zh` 向量。说"拍森"能找到 Python |
| 🗣 **语言中枢 · 理解** | 懂你说的意思，不只是匹配 | 错别字纠正 + 同义消歧 + 中文时间词解析（"上个月"→具体日期） |
| 🔗 **神经元突触 · 感知链** | 相关信息自动建链 | 6 类因果关系（BECAUSE_OF / LEADS_TO / PREVENTS / ENABLES / RESPONSE_TO / CO_OCCURS_WITH） |
| ⚡ **共燃神经元 · Hebbian 关联** | 一起出现的自动绑定 | 共现矩阵：问 A 带出 B |
| 🌊 **神经扩散 · 联想回忆** | 多跳发现间接知识 | 沿感知链 BFS 图扩散 |
| 🧬 **突触固化 · 记忆巩固** | 用得越多越重要 | 层级晋升：scratch → episodic → internalized → growth |
| ⏳ **遗忘曲线** | 久不用的自然衰减 | 时间降级 + 归档——记忆库永不变成垃圾场 |
| 📊 **神经信号 · 置信度** | 每条记忆带可信度 | 置信度评分，高置信优先 |
| 👤 **主人认知模型 · 画像** | 懂你这个人——偏好、习惯、事实 | 偏好/事实自动积累；AI 建议绝不混入你的画像 |
| 💪 **肌肉记忆 · 跨轮复用** | 做过的事跨会话记得 | 工具结果与经验沉淀复用 |

**为中文而生**：tokenizer、嵌入（`bge-small-zh`）、纠错规则、时间词解析全部中文原生。竞品英文优先。

**默认私有**：SQLite + 本地嵌入，无云、无账号、无遥测。感知链深度溯源为可选服务器增强。

**一条命令配好**：`npm install -g` 自动配置 10+ 个 AI 工具（Claude Code、Cursor、Windsurf、Cline、Gemini CLI、Qwen Code、Zed、VS Code Copilot、Codex CLI、Trae、DeepSeek Harness、pi-coding-agent）。

**一个大脑，多个助手**：同一台电脑上所有 AI 工具共享同一套本地记忆。今天 Claude Code 学到的，明天 Cursor 还记得——一份记忆，零重复。

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
| 自动识别（observe_turn → 识别器） | ⚠️ 需自配 LLM key | ⚠️ 同样需自配 LLM key（成本归用户，服务器不做 LLM） |
| 一键回忆（recall_context） | 仅基础检索 | ✅ + 感知链深度溯源 |
| **感知链**（追踪/寻路/图统计/扩散） | ❌ | ✅ depth=8 BFS |
| **记忆提炼**（derive_memories） | ⚠️ 需自配 LLM key | ⚠️ 同样需自配 LLM key（成本归用户） |

本地模式完全私有（数据不出本机），但**感知链工具需要连接服务器**。服务器地址不随包分发（防攻击），需通过官方接入渠道获取。

### 拿到 key 后，一条命令连上

> 接入地址和密钥通过官方渠道发放：**联系作者（微信/QQ/邮箱：<此处填你的联系方式>）订阅后发放**，不随包公开。订阅到期可单独吊销，不影响其他用户。

```bash
# 1. 安装（如未安装）
npm install -g aifp-mcp

# 2. 一条命令连接服务器（地址和 key 由作者发放）
aifp-mcp --connect https://<官方地址> <你的64位key>

# 3. 重启你的 AI 工具（Claude Code / Cursor / dsh 等）
#    感知链 / 深度追踪 / 图扩散自动可用

# 断开（恢复纯本地）：
# aifp-mcp --disconnect
```

`--connect` 会把连接信息保存在本机 `~/.ai-cognition/server.json`，之后启动自动生效，无需每次配置环境变量。

### 更简单：直接让你的 AI 配置

不需要手动敲命令。在 Claude Code / Cursor / Codex / dsh 等任何 AI 工具的输入框里说：

> 这是我的 aifp 服务器地址和 key，帮我配置：
> 地址：https://<官方地址>
> key：<你的64位key>

AI 会自动执行 `aifp-mcp --connect` 并提示你重启工具。重启后感知链增强自动生效。

> ⚠️ key 会出现在对话记录中，介意的话配置完可在管理后台吊销重发（不影响使用）。

## MCP 工具（共 32 个）

核心工具（13 个）：

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
| `get_user_profile` | 用户画像——聚合偏好/事实/习惯 | **画像** |
| `observe_turn` | 记录对话轮次到识别队列（跨平台自动记忆入口） | **自动** |
| `reimport_sources` | 重新扫描外部笔记目录 | 导入 |
| `get_stats` | 系统统计 | 基础 |

另有 19 个管理/进阶工具：`get_memory` / `list_memories` / `get_memory_tree` / `get_related_memories` / `consolidate_memories` / `share_memory` / `merge_memories` / `batch_delete` / `batch_update` / `export_memories` / `explain_query` / `get_confidence_stats` / `scan_memory_patterns` / `validate_memory` / `get_top_experiences` / `deduplicate_memories` / `scan_observation_patterns` / `rotate_observation_logs` / `session_mine`。

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

## 各 AI 工具怎么接入（自动或手动）

`npm install -g aifp-mcp` 时自动完成（postinstall 检测所有已装 AI 工具并写入 MCP 配置）。**以后新装了某个 AI 工具**，跑一次即可接入：

```bash
aifp-mcp --setup   # 重新检测并配置所有 AI 工具
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
| `COGNITION_SERVER_URL` | *（无默认，须显式配置）* | 远程算法服务器地址（自建） |
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
