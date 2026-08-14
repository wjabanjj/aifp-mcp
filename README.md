# AiFP Cognitive Memory — MCP Server

**No records, only perception.** Persistent memory for AI coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

[中文文档](./README.zh.md) · [npm](https://www.npmjs.com/package/aifp-mcp)

AiFP gives Claude Code, Cursor, Codex, DeepSeek Harness, and any other MCP-capable tool a **continuous memory that survives sessions**. It runs fully locally — your data never leaves your machine (default `~/.ai-cognition/`).

## Why AiFP

- **Chinese-first retrieval** — `bge-small-zh-v1.5` embeddings (local, 512-dim) + CJK-aware FTS5 full-text search. Competitors are English-first; AiFP is built for Chinese.
- **Perception chains (cloud)** — directional causal links (LEADS_TO / BECAUSE_OF / ENABLES / PREVENTS / RESPONSE_TO / CO_OCCURS_WITH), Hebbian co-occurrence, and BFS graph diffusion uncover knowledge that keyword search never will.
- **Private by default** — SQLite database + local embeddings. No cloud, no account, no telemetry.
- **One-command setup** — `npm install -g` auto-configures 10+ AI tools (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Qwen Code, Zed, VS Code Copilot, Codex CLI, Trae, pi-coding-agent).

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
| Auto-recognition (`observe_turn` → recognizer) | ⚠️ needs your own LLM key | ✅ server LLM, zero config |
| Recall (`recall_context`) | basic retrieval only | ✅ + perception-chain tracing |
| **Perception chains** (trace / path / graph stats / diffusion) | ❌ | ✅ depth-8 BFS |
| **Memory derivation** (`derive_memories`) | ❌ | ✅ server LLM |

Local mode is fully private (data never leaves your machine) but **perception-chain tools require the server**. Set `COGNITION_SERVER_URL` + `COGNITION_API_KEY` to enable them.

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

## One-command setup for all AI assistants

`npm install -g aifp-mcp` runs postinstall automatically. To run it manually:

```bash
node dist/setup/index.js     # after npm install
npx tsx src/setup/index.ts   # from source
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
| `COGNITION_SERVER_URL` | `http://43.143.222.90:5000` | Remote core-server URL |
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
