# AiFP Cognitive Memory — MCP Server

Persistent memory for AI coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io/).

[中文文档](./README.zh.md) · [npm](https://www.npmjs.com/package/aifp-mcp) · [GitHub](https://github.com/wjabanjj/aifp-mcp)

Give Obsidian, DeepSeek Harness, Claude Code, Cursor, Codex, and any other MCP-capable tool **continuous memory across sessions**. It runs fully locally — your data never leaves your machine (default `~/.ai-cognition/`).

## Why AiFP — one brain, one shared memory for all your AI tools

Are you tired of AI's "amnesia"?

- You chat all morning, it forgets the project name — **stored, but useless**
- You say "拍森" (pinyin for Python), it only understands "Python" — **one typo and it can't find it**
- Yesterday it was "can't connect to Docker", today it's "can't connect to MySQL" — it doesn't know they're the same thing — **related memories never connect**
- What DeepSeek Harness learned today, Claude Code doesn't know — **every AI is a memory island**

Most AI memory systems just **store** — they store, but you can't use it. AiFP makes AI actually **remember, connect, and share**, solving all of the above at once.

**What others can't do (sharing):**

> **One memory, shared by all AI tools.** What DeepSeek Harness learns today, Claude Code still remembers tomorrow; the preferences Codex collected, VS Code Copilot never needs to ask again. Other memory systems can't do this — each one keeps its own records, completely isolated. AiFP gives every AI tool on the same machine one shared brain — **remember once, use everywhere**.

**Why it's good (capabilities):**

- **Judges what to remember** — not every sentence gets stored. Messages go into a "pending zone" first, and a recognizer decides whether it's worth long-term memory: worth it → formally saved; not worth it → skipped. No hoarding everything, no missing the important stuff.
- **Understands human speech** — say "拍森", it knows you mean Python; say "上个月" (last month), it knows exactly which month. Typos, colloquialisms, time phrases — all understood.
- **Sees connections** — "can't connect to database" yesterday and "changed the config, still broken" today are recognized as the same ongoing issue. It can also chain from one clue to related content.
- **Clean storage, useful retrieval** — each memory keeps only its core meaning, no junk piled on. When retrieving, only the most relevant few are surfaced — fast and tidy.
- **Knows you better over time** — your preferences and habits gradually accumulate into a "profile", but it distinguishes *facts* from *suggestions* and never mixes your thoughts with its own.
- **Forgets what should be forgotten** — rarely-used memories naturally fade; important ones grow stronger. The memory base stays clean forever — never becomes a dump you can't search.

**These names tell you it's serious** — memory is built like a brain:

| Concept | What it does (plain language) |
|---------|-------------------------------|
| 🧠 **Hippocampus · perception** | Judges what to remember — messages go to a "pending zone", the recognizer decides, only worth-it ones are formally stored |
| 🔗 **Synapses · perception chain** | Automatically discovers connections between information and traces the most direct relationships |
| 👃 **Olfactory cortex · semantic retrieval** | Finds it even when misspelled — say "拍森", it knows you're looking for Python |
| ⚡ **Hebbian neurons · association** | Things that appear together get bound together — ask about A, surface B |
| 🗣 **Language cortex · understanding** | Understands colloquial speech, recognizes typos, knows which month "上个月" is |
| 🌊 **Neural diffusion · associative recall** | One clue can recall several layers of related memories |
| 🧬 **Synaptic consolidation · reinforcement** | The more it's used, the stronger it gets — gradually promoted from temporary to long-term memory |
| ⏳ **Forgetting curve** | Rarely-used memories naturally fade; the memory base stays clean and never piles up |
| 📊 **Neural signal · confidence** | Every memory carries a trust score — the more reliable, the higher it surfaces |
| 👤 **Owner cognition model · profile** | Understands *you* — preferences and habits accumulate into a profile, never mixed with its own thoughts |
| 💪 **Muscle memory · cross-turn reuse** | Lessons from past work persist across sessions — no relearning from scratch |

**Built for Chinese first**: typo tolerance, colloquial understanding, time-phrase parsing — all designed for Chinese. English-first memory systems fall flat when you say "拍森" looking for Python.

**Private by default**: all data lives on your machine — no cloud, no account, no telemetry. The "sharing" only means multiple tools read/write the same local memory — **your data never leaves this computer**.

**One-command setup**: `npm install -g` auto-configures 12 AI tools (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Qwen Code, Zed, VS Code Copilot, Codex CLI, Trae, DeepSeek Harness, pi-coding-agent).

**One brain, many assistants**: what DeepSeek Harness learns today, Claude Code remembers tomorrow — like talking to a colleague with a memory, no need to re-introduce yourself every time.

## Quick start

```bash
npm install -g aifp-mcp
claude mcp add ai-cognition -s user -- npx aifp-mcp
```

Restart Claude Code and you're done. Data lives in `~/.ai-cognition/data/cognition.db`.

### One-command install for DeepSeek Harness (dsh)

AiFP is an official `dsh-plugin` ecosystem bundle — install it into dsh with a single command:

```bash
dsh plugin --profile <your-profile> add aifp-mcp
```

Restart dsh and all memory tools register automatically as `mcp__aifp__*` (e.g. `mcp__aifp__search_memories`, `mcp__aifp__save_memory`) — no manual config needed.

### Install from any AI assistant's chat (recommended)

You don't need to configure anything manually. In Claude Code, Codex, Cursor, DeepSeek Harness, or any other tool, just type:

> Install my memory system: `npm install -g aifp-mcp`

The `postinstall` hook **auto-detects and configures every installed AI tool** (Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Qwen Code, Zed, VS Code Copilot, Codex CLI, Trae, DeepSeek Harness, pi-coding-agent) and prints a status report. Restart the tool and memory tools are available — the AI sees the report and tells you which one to restart. **No manual MCP config file editing needed.**

> **First launch**: downloads a ~30 MB embedding model (bge-small-zh), blocking up to 45 s. Later launches are instant (cached).

## Local mode vs server-enhanced mode

AiFP runs in two modes (env `COGNITION_MODE`, default `remote`):

Local mode is fully private (data never leaves your machine) but **perception-chain tools require the server**. The server address is not shipped with the package (anti-attack); get it through the official channel.

### One command to connect (after you have a key)

> Access address and key are distributed through the official channel: **contact the author (WeChat: zm8571806 / QQ: 8571806 / email: 8571806@qq.com) to subscribe** — never bundled in this package. Subscriptions can be revoked individually without affecting other users.

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

### Obsidian integration (notes ↔ memory, both ways)

**Obsidian notes → memory** (AI can semantically search your vault): just ask your AI — **no env vars needed**:

> Import my Obsidian notes into memory: directory = C:/Users/you/Obsidian/MyVault

The AI calls `reimport_sources` to sync (frontmatter stripped, hash-deduped). Say it again when you add notes.

**Memory → Obsidian notes** (see all memories inside Obsidian): ask your AI to call `export_memories_md`:

> Export memories to Obsidian: directory = C:/Users/you/Obsidian/MyVault/AiFP-memory

Exported notes carry frontmatter (type/tier/tags) that Obsidian recognizes; same-name notes are overwritten to stay in sync with the memory base.


## MCP tools (33 total)

Core tools (15):

| Tool | Purpose | Chain |
|------|---------|-------|
| `save_memory` | Save a memory (auto-dedup + vector index) | Core |
| `search_memories` | Dual-path retrieval: FTS5 keywords + vector semantics | **Logic** |
| `recall_context` | One-shot recall (direct hits + perception chains + associations + diffusion) | **Composite** |
| `get_memory` | Fetch a memory by ID | Core |
| `list_memories` | Paginated listing | Core |
| `trace_perception_chain` | BFS perception-chain tracing (6 causal relations) | **Up/down** |
| `find_perception_path` | Bidirectional BFS: shortest path between two memories | **Relational** |
| `get_perception_graph_stats` | Perception-graph statistics | **Relational** |
| `diffuse_memories` | Multi-hop graph diffusion search | **Relational** |
| `get_memory_tree` | Hierarchical tree structure | Core |
| `get_related_memories` | Hebbian co-occurrence associations | **Relational** |
| `get_user_profile` | User profile — aggregated preferences / facts / habits | **Profile** |
| `observe_turn` | Queue a conversation turn for auto-recognition (cross-platform memory entry) | **Automatic** |
| `reimport_sources` | Re-scan external notes directories | Import |
| `get_stats` | System statistics | Core |

Plus 18 management tools: `consolidate_memories` / `share_memory` / `merge_memories` / `batch_delete` / `batch_update` / `export_memories` / `export_memories_md` (Obsidian) / `explain_query` / `get_confidence_stats` / `scan_memory_patterns` / `validate_memory` / `get_top_experiences` / `deduplicate_memories` / `scan_observation_patterns` / `rotate_observation_logs` / `session_mine` / `derive_memories` / `flush_recognizer`.

## Automatic memory across platforms

Claude Code uses native hooks (100% automatic, zero gaps). Other tools use the `observe_turn` tool + instruction files (see `rules/`):

| Platform | Mechanism | Automation |
|----------|-----------|------------|
| **Claude Code** | hooks (native) | 100% automatic, zero gaps |
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
| **pi-coding-agent** | extension generated at `~/.pi/agent/extensions/aifp-memory/` (pi has no built-in MCP, uses the extension mechanism) |

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
export COGNITION_LLM_BASE_URL=https://api.deepseek.com   # optional, default as left
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
