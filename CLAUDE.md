# AiFP 记忆感知系统 — MCP 记忆服务器

通过 MCP 工具连接本地 SQLite + 向量索引的长期记忆系统。所有工具已通过 MCP 协议暴露，AI 自主判断何时使用。

## 工具选型

### 读取 — 搜索已有记忆

| 场景 | 工具 |
|------|------|
| 关键词/语义搜索已有记忆 | `search_memories` — FTS5 全文索引 + 向量语义双路搜索 |
| 全面了解某主题的来龙去脉 | `recall_context` — 直接命中 + 因果链 + 关联 + 扩散，适合新任务开始时 |
| 查看单条记忆详情 | `get_memory` |
| 浏览记忆库概览 | `list_memories`、`get_stats` |
| 理解检索结果怎么来的 | `explain_query` — 路径分解和分数构成 |

### 写入 — 记录新信息

| 场景 | 工具 |
|------|------|
| 用户分享值得记住的新信息 | `save_memory`（type: observation/preference/fact/insight/experience） |
| 对话可能包含值得记住的信息 | `observe_turn` — 入队让系统自动判断，不阻塞 |
| 新增了笔记文件 | `reimport_sources` — 扫描导入 .md/.json |
| 验证内容质量 | `validate_memory` — 三重门禁检查 |

### 探索 — 深入分析

| 场景 | 工具 |
|------|------|
| 查看因果链 | `trace_perception_chain` |
| 多跳关联扩散 | `diffuse_memories` |
| 追踪 Hebbian 关联 | `get_related_memories` |
| 查看层级树 | `get_memory_tree` |
| 模式分析 | `scan_memory_patterns`、`scan_observation_patterns` |

## 常见误区

- **不需要每句话都搜索。** 话题明显是新内容、用户第一次提及的，无需搜索。
- **save_memory 只存值得长期记住的信息，不是每轮对话都存。** 日常闲聊不需要记录。
- **向量引擎后台异步加载。** 首次搜索可能走 FTS5 降级，不影响使用，就绪后自动切换。
- **感知链/扩散/关联需要连接服务器（remote 模式）。** 本地模式只提供基础检索加排序。
- **不要凭训练数据猜测用户说过什么。** 先查记忆再回答。

## 隐私

- 所有记忆数据存在本地 SQLite，不外传
- embedding 模型在本地运行，不上传任何数据

## 工作流程参考

- **任务开始时** — 如果涉及之前讨论过的内容，先调 `search_memories` 或 `recall_context`；新话题无需搜索
- **用户分享信息时** — 判断是否值得长期记住（偏好、决策、踩坑、约束），是则调 `save_memory`
- **排查问题时** — 先搜相关错误码、技术决策、历史踩坑记录
- **用户说"我之前说过"时** — 调 `search_memories`，不凭训练数据猜测
- **用户说新增了笔记** — 调 `reimport_sources`
