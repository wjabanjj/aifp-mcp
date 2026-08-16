# AiFP 记忆感知系统 — MCP Server

通过 [Model Context Protocol](https://modelcontextprotocol.io/) 为 AI 编程助手提供持久记忆。

[English](./README.en.md) · [npm](https://www.npmjs.com/package/aifp-mcp) · [GitHub](https://github.com/wjabanjj/aifp-mcp)

让 Obsidian、DeepSeek Harness、Claude Code、Cursor、Codex 等一切支持 MCP 的 AI 工具拥有**跨会话的持续记忆**。完全本地运行，数据不出本机（默认 `~/.ai-cognition/`）。

## 为什么选 AiFP — 一套记忆，所有 AI 共享

你受够了 AI 的"健忘"吗？

- 聊了一上午，它忘了项目名——**存了，但用不上**
- 你说"拍森"，它只认 Python——**说错一个字就搜不到**
- 昨天说 Docker 连不上，今天说 MySQL 连不上，它不知道是同一件事——**相关的记不住**
- DeepSeek Harness 学会的，Claude Code 不知道——**每个 AI 都是记忆孤岛**

多数 AI 记忆系统只是**存**——存是存了，但用不上。AiFP 是让 AI 真正**记住、想通、共享**，把上面这些毛病一次解决。

**先讲别人做不到的（共享）：**

> **一套记忆，所有 AI 共用。** 今天 DeepSeek Harness 学会的，明天 Claude Code 还记得；Codex 攒的偏好，VS Code Copilot 不用重新问。别的记忆系统做不到——因为它们每个各记各的，互不相通。AiFP 让同电脑上所有 AI 工具共用一个大脑，**记一份，处处用**。

**再讲它为什么好用（能力）：**

- **会掂量着记**——不是每句话都存。聊的东西先进"待定区"，由识别器判断这条值不值得长期记住：值得才正式记下，不值得就跳过。不会一股脑全存，也不会错漏重要的。
- **能听懂人话**——你说"拍森"，它知道是 Python；你说"上个月"，它知道是哪个月。说错字、口语、时间词都能理解。
- **能看出关联**——昨天说"连不上数据库"，今天说"改了配置还不行"，它知道是同一件事的延续。还能顺着一条线索联想出相关的内容。
- **记得清，用得上**——一条记忆只留核心意思，不堆垃圾。用的时候只挑最相关的几条给你，又快又不乱。
- **越用越懂你**——你的偏好、习惯它会慢慢积累成"画像"，但它分得清"事实"和"建议"，不会把你的想法和它自己的混在一起。
- **该忘的就忘**——太久没用的记忆会自然淡出，重要的记忆会越来越牢。记忆库永远干净，不会变成堆不动的垃圾场。

**看这些名字，就知道它不简单**——记忆被做成了大脑的结构：

| 概念 | 它到底在干嘛（大白话） |
|------|----------------------|
| 🧠 **海马体 · 记忆感知** | 会掂量着记——先进"待定区"，识别器判断值不值得长期记住，值得才正式记下，不值得就跳过 |
| 🔗 **神经元突触 · 感知链** | 自动发现信息之间的联系，还能顺着线索找到最直接的关系 |
| 👃 **嗅觉皮层 · 语义检索** | 说错也能找到——你说"拍森"，它知道你要找 Python |
| ⚡ **共燃神经元 · 关联** | 一起出现的东西自动绑在一起，问 A 顺带带出 B |
| 🗣 **语言中枢 · 理解** | 懂口语、认错字、认得"上个月"是哪个月 |
| 🌊 **神经扩散 · 联想回忆** | 一条线索能联想出好几层相关的记忆 |
| 🧬 **突触固化 · 记忆巩固** | 用得越多记得越牢，从临时记忆慢慢变成长期记忆 |
| ⏳ **遗忘曲线** | 太久不用的自然淡出，记忆库永远干净不堆积 |
| 📊 **神经信号 · 置信度** | 每条记忆带个"可信度"标尺，越靠谱的越优先给你 |
| 👤 **主人认知模型 · 画像** | 懂你这个人——偏好习惯会积累成画像，但不跟它的想法混 |
| 💪 **肌肉记忆 · 跨轮复用** | 做过的经验跨会话记得，不用每次从头学 |

**天生为中文服务**：认错字、懂口语、认时间词，全都是为中文设计的。英文为主的记忆系统，遇到"拍森找 Python"这种就抓瞎了。

**默认完全私有**：所有数据都存你本机，不上云、不注册、不偷偷上报。所谓"共享"只是多个工具读写同一份本地记忆——**你的数据从没离开过这台电脑**。

**一条命令装好**：`npm install -g` 自动帮你配好 12 个 AI 工具（Claude Code、Cursor、Windsurf、Cline、Gemini CLI、Qwen Code、Zed、VS Code Copilot、Codex CLI、Trae、DeepSeek Harness、pi-coding-agent）。

**一个大脑，多个助手**：今天 DeepSeek Harness 学到的，明天 Claude Code 还记得——像跟一个有记忆的同事说话，不用每次都重新自我介绍。

## 快速开始

```bash
npm install -g aifp-mcp
claude mcp add ai-cognition -s user -- npx aifp-mcp
```

重启 Claude Code 即可使用。数据存在 `~/.ai-cognition/data/cognition.db`。

### DeepSeek Harness (dsh) 一键安装

AiFP 是官方 `dsh-plugin` 生态组合包，一条命令装进 dsh：

```bash
dsh plugin --profile <你的profile名> add aifp-mcp
```

装完重启 dsh，记忆工具会自动注册为 `mcp__aifp__*`（如 `mcp__aifp__search_memories`、`mcp__aifp__save_memory`），无需手动改任何配置。

### 在任意 AI 对话中安装（推荐）

不需要手动配任何东西。在 Claude Code、Codex、Cursor、DeepSeek Harness 等任意工具里直接输入：

> 帮我安装记忆系统：`npm install -g aifp-mcp`

`postinstall` 钩子会**自动检测并配置所有已安装的 AI 工具**（Claude Code、Cursor、Windsurf、Cline、Gemini CLI、Qwen Code、Zed、VS Code Copilot、Codex CLI、Trae、DeepSeek Harness、pi-coding-agent），并打印状态报告。重启工具即可使用记忆工具——AI 看到报告后会告诉你重启哪个，**无需手动改任何 MCP 配置文件**。

> **首次启动**：需要下载 ~30MB 的 bge-small-zh 嵌入模型，最多阻塞 45 秒。后续启动有缓存，秒开。

## 本地模式 vs 服务器增强模式

AiFP 支持两种运行模式（环境变量 `COGNITION_MODE`，默认 `remote`）：

本地模式完全私有（数据不出本机），但**感知链工具需要连接服务器**。服务器地址不随包分发，需通过官方接入渠道获取。

### 拿到 key 后，一条命令连上

> 接入地址和密钥通过官方渠道发放：**联系作者（微信：zm8571806/QQ：8571806/邮箱：8571806@qq.com）订阅后发放**，不随包公开。订阅到期可单独吊销，不影响其他用户。

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

### 接入 Obsidian（笔记 ↔ 记忆双向）

**Obsidian 笔记 → 记忆库**（AI 可语义检索你的笔记）：直接让你的 AI 导入，**无需配置环境变量**：

> 把 Obsidian 笔记导入记忆：directory = C:/Users/你/Obsidian/我的笔记库

AI 会调用 `reimport_sources` 同步导入（frontmatter 自动剥离、哈希去重）。以后新增笔记再说一次即可。

**记忆库 → Obsidian 笔记**（在 Obsidian 里看到全部记忆）：让 AI 调用 `export_memories_md`：

> 把记忆导出到 Obsidian：directory = C:/Users/你/Obsidian/我的笔记库/AiFP记忆

导出的笔记带 frontmatter（type/tier/tags），Obsidian 可直接识别和检索；同名笔记自动覆盖更新，保持与记忆库同步。


## MCP 工具（共 33 个）

核心工具（15 个）：

| 工具 | 功能 | 链路 |
|------|------|------|
| `save_memory` | 保存记忆（自动去重 + 向量索引） | 基础 |
| `search_memories` | 双路检索：FTS5 关键词 + 向量语义 | **逻辑链** |
| `recall_context` | 一键回忆（直接命中 + 因果链 + 关联 + 扩散） | **综合链** |
| `get_memory` | 按 ID 获取记忆详情 | 基础 |
| `list_memories` | 分页列出 | 基础 |
| `trace_perception_chain` | BFS 感知链追踪（6 类因果） | **上下链** |
| `find_perception_path` | 双向 BFS 找两条记忆间最短路径 | **关系链** |
| `get_perception_graph_stats` | 感知图统计 | **关系链** |
| `diffuse_memories` | 图扩散搜索（关联多跳） | **关系链** |
| `get_memory_tree` | 层级树结构 | 基础 |
| `get_related_memories` | Hebbian 共现关联 | **关系链** |
| `get_user_profile` | 用户画像——聚合偏好/事实/习惯 | **画像** |
| `observe_turn` | 记录对话轮次到识别队列（跨平台自动记忆入口） | **自动** |
| `reimport_sources` | 重新扫描外部笔记目录 | 导入 |
| `get_stats` | 系统统计 | 基础 |

另有 18 个管理/进阶工具：`consolidate_memories` / `share_memory` / `merge_memories` / `batch_delete` / `batch_update` / `export_memories` / `export_memories_md`（Obsidian）/ `explain_query` / `get_confidence_stats` / `scan_memory_patterns` / `validate_memory` / `get_top_experiences` / `deduplicate_memories` / `scan_observation_patterns` / `rotate_observation_logs` / `session_mine` / `derive_memories` / `flush_recognizer`。

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
