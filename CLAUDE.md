# AiFP 记忆感知系统 — MCP 记忆服务器

通过 MCP 工具连接本地 SQLite + 向量索引的长期记忆系统。所有工具通过 MCP 协议暴露，AI 自主判断何时使用。

## 工具选型

### 读取 — 搜索已有记忆

| 场景 | 工具 |
|------|------|
| 关键词/语义搜索已有记忆 | `search_memories` — FTS5 全文 + 向量语义双路 |
| 全面了解某主题的来龙去脉 | `recall_context` — 直接命中 +（服务器）因果链/关联/扩散 |
| 查看单条记忆详情 | `get_memory` |
| 浏览记忆库概览 | `list_memories`、`get_stats` |
| 理解检索结果怎么来的 | `explain_query` — 路径分解和分数构成 |
| 查看用户完整画像 | `get_user_profile` — 偏好/事实/习惯聚合 |
| 查看因果链 | `trace_perception_chain` ⚠️ **需服务器** |
| 多跳关联扩散 | `diffuse_memories` ⚠️ **需服务器** |
| 追踪 Hebbian 关联 | `get_related_memories`（本地可用）|
| 查看层级树 | `get_memory_tree` |
| 模式分析 | `scan_memory_patterns`、`scan_observation_patterns` |

### 写入 — 保存记忆

| 场景 | 工具 |
|------|------|
| 用户透露新信息（偏好/事实/决策）| `save_memory` — 自动去重、实体提取、建感知链边 |
| 对话轮次自动识别 | `observe_turn` — 入队，识别器（需 LLM key）判断值不值得记 |
| 笔记/文件导入 | `reimport_sources` — 传 directory 可导入 Obsidian vault |
| 记忆导出为笔记 | `export_memories_md` — 写 Obsidian 兼容 md（frontmatter）|

### 管理

| 场景 | 工具 |
|------|------|
| 巩固/层级晋升 | `consolidate_memories`、`deduplicate_memories` |
| 修改/删除 | `batch_update`、`batch_delete`、`merge_memories` |
| 共享 | `share_memory` |

## 本地 vs 服务器边界（重要）

| 能力 | 本地（默认）| 服务器（--connect 后）|
|------|:---:|:---:|
| 保存/检索/关联/画像/导入导出 | ✅ | ✅ |
| 感知链追踪 / 图扩散 / 图统计 | ❌ 提示需服务器 | ✅ 深度 BFS / 加权扩散 |
| 回忆深度 | 基础检索 | ✅ + 深度溯源 |
| 检索排序 | 基础 | ✅ 服务器融合排序 |

> 连接服务器：`aifp-mcp --connect <地址> <key>`（或让 AI 帮你配置）。
> 断开：`aifp-mcp --disconnect`。

## 常见误区

- **不需要每句话都搜索。** 话题明显是新内容、用户第一次提及的，无需搜索。
- **save_memory 只存值得长期记住的信息，不是每轮对话都存。** 日常闲聊不需要记录。
- **感知链/扩散/图统计必须连服务器（remote）。** 本地模式只提供基础检索+关联，感知链工具会提示"需要连接服务器"——不要反复重试。
- **Obsidian 笔记导入直接传目录**：`reimport_sources(directory: vault路径)`，无需配置环境变量。
- **不要凭训练数据猜测用户说过什么。** 先查记忆再回答。
- **识别器需要用户配 LLM key**（COGNITION_LLM_API_KEY 或 ANTHROPIC_API_KEY），没配则 observe_turn 只记录不落库。

## 隐私

- 所有记忆数据存在本地 SQLite，不外传
- embedding 模型在本地运行，不上传任何数据
- 服务器模式仅发送边/候选等中间数据做算法计算，不存储用户记忆

## 工作流程参考

- **任务开始时** — 涉及之前讨论过的内容，先 `search_memories` 或 `recall_context`；新话题无需搜索
- **用户分享信息时** — 判断是否值得长期记住（偏好、决策、踩坑、约束），是则 `save_memory`
- **排查问题时** — 先搜相关错误码、技术决策、历史踩坑记录
- **用户说"我之前说过"时** — `search_memories`，不凭训练数据猜测
- **用户说新增了笔记/Obsidian** — `reimport_sources(directory: 路径)`
- **用户想看记忆/画像** — `get_user_profile`；想导出到 Obsidian — `export_memories_md`
