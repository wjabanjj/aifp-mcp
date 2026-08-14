# AiFP Cognitive Memory — MCP Server

**No records, only perception.** Persistent memory for AI coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

[中文文档](./README.zh.md) · [npm](https://www.npmjs.com/package/aifp-mcp)

AiFP gives Claude Code, Cursor, Codex, DeepSeek Harness, and any other MCP-capable tool a **continuous memory that survives sessions**. It runs fully locally — your data never leaves your machine (default `~/.ai-cognition/`).

## Why AiFP — a brain, not a file cabinet

Most AI memory systems just **store** — a file cabinet you search. AiFP is built to **perceive, connect, and forget like a brain**:

| Concept | What it does | Real capability |
|---------|-------------|-----------------|
| 🧠 **Hippocampus · perception** | New info is judged before it's stored | `observe_turn` → auto-recognizer decides what's worth remembering |
| 👃 **Olfactory cortex · retrieval** | Find it even when you misspell it | Dual-path search: CJK FTS5 + `bge-small-zh` vector. Say "拍森", find Python |
| 🗣 **Language cortex · understanding** | Understand what you meant, not just matched | Typo correction + disambiguation + Chinese time parsing ("上个月" → exact date) |
| 🔗 **Synapses · perception chain** | Connect related info automatically | 6 causal relations (BECAUSE_OF / LEADS_TO / PREVENTS / ENABLES / RESPONSE_TO / CO_OCCURS_WITH) |
| ⚡ **Hebbian neurons · association** | Neurons that fire together wire together | Co-occurrence matrix: ask about A, surface B |
| 🌊 **Neural diffusion · recall** | Multi-hop discovery of indirect knowledge | BFS graph diffusion along the perception chain |
| 🧬 **Synaptic consolidation · reinforcement** | The more you use it, the more important it becomes | Tier promotion: scratch → episodic → internalized → growth |
| ⏳ **Forgetting curve** | Stale memories naturally decay | Time-based demotion & archival — the memory base never becomes a dump |
| 📊 **Neural signal · confidence** | Every memory carries a trust signal | Confidence scoring, high-confidence surfaces first |
| 👤 **Owner cognition model · profile** | Understands *you* — preferences, habits, facts | Preference/fact accumulation; AI suggestions are never mixed into your profile |
| 💪 **Muscle memory · cross-turn** | Done work persists across sessions | Tool results & lessons are mined and reused |

**Chinese-first**: built for Chinese. Competitors are English-first; AiFP's tokenizer, embeddings (`bge-small-zh`), typo rules, and temporal parser are all Chinese-native.

**Private by default**: SQLite + local embeddings, no cloud, no account, no telemetry. Perception-chain deep tracing is server-enhanced (optional).

**One-command setup**: `npm install -g` auto-configures 10+ AI tools (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Qwen Code, Zed, VS Code Copilot, Codex CLI, Trae, DeepSeek Harness, pi-coding-agent).

**One brain, many assistants**: all your AI tools share the same local memory. What Claude learns today, Cursor remembers tomorrow — one memory, zero duplication.

## Quick start

```bash
npm install -g aifp-mcp
claude mcp add ai-cognition -s user -- npx aifp-mcp
```

Restart Claude Code and you're done. Data lives in `~/.ai-cognition/data/cognition.db`.

### Install from any AI assistant's chat

You don't need to configure anything manually. In Claude Code, Codex, Cursor, DeepSeek Harness, or any other tool, just ask:

> Install my memory system: `npm install -g aifp-mcp`

The `postinstall` hook **auto-configures every detected AI tool** (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Qwen Code, Zed, VS Code Copilot, Codex CLI, Trae, DeepSeek Harness, pi-coding-agent) and prints a status report. Restart the tool and memory tools are available. The agent will see the report and tell you what to restart — no manual MCP configuration needed.

> **First launch**: downloads a ~30 MB embedding model (bge-small-zh), blocking up to 45 s. Later launches are instant (cached).

## Local mode vs server-enhanced mode

AiFP runs in two modes (env `COGNITION_MODE`, default `remote`):

| Capability | Local mode | Server-enhanced (`remote`) |
|------------|:---:|:---:|
| Save / read / list memories | ✅ | ✅ |
| Dual-path search (FTS5 + vector) | ✅ | ✅ + Z-score fusion ranking |
| Hebbian co-occurrence (`get_related_memories`) | ✅ | ✅ (fuller) |
| Auto-recognition (`observe_turn` → recognizer) | ⚠️ needs your own LLM key | ⚠️ same (LLM cost is user-side) |
| Recall (`recall_context`) | basic retrieval only | ✅ + perception-chain tracing |
| **Perception chains** (trace / path / graph stats / diffusion) | ❌ | ✅ depth-8 BFS |
| **Memory derivation** (`derive_memories`) | ⚠️ needs your LLM key | ⚠️ same (LLM cost is user-side) |

Local mode is fully private (data never leaves your machine) but **perception-chain tools require the server**. The server address is not shipped with the package (anti-attack); get it through the official channel.

### One command to connect (after you have a key)

> Access address and key are distributed through the official channel: **contact the author (WeChat / QQ / email: <fill in your contact>) to subscribe** — never bundled in this package. Subscriptions can be revoked individually without affecting other users.

```bash
# 1. Install (if not yet)
npm install -g aifp-mcp

# 2. Connect to the server (address + key from the author)
aifp-mcp --connect https://<official-address> <your-64-char-key>

# 3. Restart your AI tool (Claude Code / Cursor / dsh / ...)
#    Perception chains / deep tracing / graph diffusion become available

# Disconnect (back to pure local):
# aifp-mcp --disconnect
```

`--connect` persists the connection in `~/.ai-cognition/server.json` — no need to set env vars every time.

### Even simpler: let your AI configure it

No need to type commands. In Claude Code / Cursor / Codex / dsh or any AI tool's chat, just say:

> Here are my aifp server address and key, please configure:
> Address: https://<official-address>
> Key: <your-64-char-key>

The AI will run `aifp-mcp --connect` automatically and tell you to restart the tool. Perception-chain enhancement takes effect after restart.

> ⚠️ The key appears in the conversation log. If that bothers you, revoke & reissue it from the admin panel afterward (doesn't affect usage).

## MCP tools (31 total)

Core tools (12):

| Tool | Purpose | Chain |
|------|---------|-------|
| `save_memory` | Save a memory (auto-dedup + vector index) | Core |
| `search_memories` | Dual-path retrieval: FTS5 keywords + vector semantics | **Logic** |
| `recall_context` | One-shot recall (direct hits + causal chains + associations + diffusion) | **Composite** |
| `get_memory` | Fetch a memory by ID | Core |
| `list_memories` | Paginated listing | Core |
| `trace_causal_chain` | BFS causal-chain tracing | **Up/down** |
| `diffuse_memories` | Multi-hop graph diffusion search | **Relational** |
| `get_memory_tree` | Hierarchical tree structure | Core |
| `get_related_memories` | Hebbian co-occurrence associations | **Relational** |
| `observe_turn` | Queue a conversation turn for auto-recognition (cross-platform memory entry) | **Automatic** |
| `reimport_sources` | Re-scan external notes directories | Import |
| `get_stats` | System statistics | Core |

Plus 19 management tools: `get_memory` / `list_memories` / `get_memory_tree` / `get_related_memories` / `consolidate_memories` / `share_memory` / `merge_memories` / `batch_delete` / `batch_update` / `export_memories` / `explain_query` / `get_confidence_stats` / `scan_memory_patterns` / `validate_memory` / `get_top_experiences` / `deduplicate_memories` / `scan_observation_patterns` / `rotate_observation_logs` / `session_mine`.

## Automatic memory across platforms

Claude Code uses native hooks (100% automatic). Other tools use the `observe_turn` tool + instruction files (see `rules/`):

| Platform | Mechanism | Automation |
|----------|-----------|------------|
| **Claude Code** | hooks (native) | 100% automatic |
| **Cursor** | `.cursor/rules/` instruction file | Triggered when AI follows instructions |
| **Codex CLI** | `AGENTS.md` instruction file | Triggered when AI follows instructions |
| **Trae** | project rules (manual) | Triggered when AI follows instructions |

The instruction files tell the AI: *"After answering, call `observe_turn` to record this turn."* AiFP decides whether anything is worth remembering — no manual decisions needed.

## Core technology

- **SQLite + FTS5** full-text index (CJK-aware, unicode61 tokenizer)
- **bge-small-zh-v1.5 embeddings** (local 512-dim semantic search, auto-retry + multi-mirror fallback)
- **Hebbian co-occurrence matrix** ("neurons that fire together wire together")
- **Directional causal chains** (6 relation types)
- **BFS graph diffusion** (multi-hop discovery of indirect knowledge)
- **Typo correction + disambiguation + Chinese temporal-phrase parsing**

## How AI tools connect (auto or manual)

**Installed during `npm install -g` (postinstall)** — every detected AI tool gets the MCP config automatically. Later, when you install a NEW AI tool, just run:

```bash
aifp-mcp --setup   # re-detect & configure all AI tools
```

It detects installed AI tools (writes only what it finds, never overwrites):

| Platform | Config target |
|----------|---------------|
| Claude Code | `~/.claude/settings.json` → mcpServers + startup hook |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | `~/.config/cline/mcp_settings.json` |
| Gemini CLI | `~/.gemini/settings.json` → mcpServers |
| Qwen Code | `~/.qwen/settings.json` → mcpServers |
| Zed | `~/.config/zed/settings.json` → context_servers |
| VS Code Copilot | `%APPDATA%/Code/User/mcp.json` → servers |
| Codex CLI | `~/.codex/config.toml` |
| **pi-coding-agent** | extension generated at `~/.pi/agent/extensions/aifp-memory/` |

## Manual configuration

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

### Custom data directory

```bash
COGNITION_DATA_DIR=/path/to/data npx aifp-mcp
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COGNITION_DATA_DIR` | `~/.ai-cognition/` | Data storage directory |
| `COGNITION_MODE` | `remote` | `local` local-only / `remote` server-enhanced |
| `COGNITION_SERVER_URL` | *(none — configure explicitly)* | Remote algorithm-server URL (self-hosted) |
| `COGNITION_API_KEY` | - | API key for remote mode |
| `COGNITION_RECOGNIZER` | `0` | Set `1` to enable auto-recognition |
| `COGNITION_LLM_API_KEY` | - | LLM key for the recognizer (OpenAI-compatible) |
| `COGNITION_LLM_BASE_URL` | `https://api.deepseek.com` | Recognizer LLM base URL |
| `COGNITION_LLM_MODEL` | `deepseek-chat` | Recognizer LLM model |
| `HF_MIRROR` | `https://hf-mirror.com` | Embedding-model download mirror (falls back to huggingface.co) |
| `CORS_ORIGIN` | `*` | HTTP-mode CORS whitelist |
| `PORT` | `5000` | HTTP server port |

## Recognizer LLM config (auto memory recognition)

The observation queue needs an LLM to judge whether a turn is worth remembering. Either:

```bash
# OpenAI-compatible (DeepSeek recommended)
export COGNITION_RECOGNIZER=1
export COGNITION_LLM_API_KEY=your-deepseek-key
export COGNITION_LLM_BASE_URL=https://api.deepseek.com   # optional
export COGNITION_LLM_MODEL=deepseek-chat                 # optional

# or Anthropic
# export COGNITION_RECOGNIZER=1
# export ANTHROPIC_API_KEY=sk-ant-...
```

Without this, turns are only logged to the observation log and auto-recognition does not persist (explicit `save_memory` calls are unaffected).

## Tech stack

- Node.js 22+ (`node:sqlite`) + TypeScript
- SQLite (built-in) + FTS5
- @xenova/transformers (bge-small-zh-v1.5)
- @modelcontextprotocol/sdk (MCP protocol)

## License

Proprietary — see [LICENSE](./LICENSE). Free for personal/non-commercial use; commercial use requires a license. Third-party dependencies keep their own licenses.
