# ai-cognition 跨平台记忆指令

本目录包含各 AI 编程工具的指令文件模板，用于在不支持 hook 机制的客户端上实现自动记忆识别。

## 工作原理

Claude Code 使用 `hooks/recall-hook.mjs` 在用户每次发消息时自动触发识别。
其他工具没有 hook 机制，改为提供 `observe_turn` MCP 工具 + 指令文件，让 AI 在每次回复后主动调用。

## 使用方式

| 平台 | 文件 | 放置位置 |
|------|------|----------|
| Cursor | `cursor-rules.mdc` | `.cursor/rules/ai-cognition.mdc` |
| Codex / OpenAI CLI | `AGENTS.md` | 项目根目录 |
| Trae (字节跳动) | `trae-rules.md` | 设置 → MCP → 手动添加（Trae 不支持项目级规则文件） |
| Claude Code | `CLAUDE.md`（已有 hooks） | 项目根目录 |

## 验证

配置完成后，在对话中发一条"我喜欢用 Python 写后端"，然后调用 `search_memories` 搜索"Python 后端"。
如果能找到相关记忆，说明自动识别已生效。
