// @deploy npm — MCP 协议核心，所有工具定义+路由，随 npm 分发
/**
 * AiFP 记忆感知系统 — MCP 协议核心
 * 双模式：stdio（MCP SDK StdioServerTransport） + HTTP（JSON-RPC over HTTP）
 *
 * stdio 模式（默认）：startStdioServer() → SDK Server + StdioServerTransport
 * HTTP 模式：server.ts → initServer() + handleRequest()
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js'
import { vectorEngine } from './vector.js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { validateMemoryContent, extractEntityTags } from './extractor.js'
import { writeObservation, rotateObservationLogs, scanRecentPatterns } from './obs-log.js'
import { mineSession } from './session-miner.js'
import { hasMemorySignal, detectGuardSignals } from './guard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const _pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'))
const VERSION = _pkg.version

// ── 工具路由 ──

type ToolHandler = (params: any) => Promise<any>

const tools = new Map<string, ToolHandler>()

// ── 工具定义 ──

const toolDefinitions = [
  {
    name: 'save_memory',
    description: '保存一条记忆。当用户明确告知关于他自己的新信息（偏好、事实、经历、观点、项目决策等），且你觉得值得长期记住时，调用此工具。内容会自动建立全文索引和向量索引，后续搜索可命中。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆内容，用户说的关键信息' },
        type: { type: 'string', enum: ['observation', 'preference', 'fact', 'insight', 'experience'], description: '记忆类型', default: 'observation' },
        title: { type: 'string', description: '可选的标题' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
        salience: { type: 'integer', description: '重要性 1-5', default: 3 },
        detail: { type: 'string', description: '详细描述或上下文' },
        mem_id: { type: 'string', description: '更新已有记忆时传入此 ID；不传则新建' },
        agent_id: { type: 'string', description: '所属 Agent ID（多 Agent 共享用）' },
        cross_agent_share: { type: 'boolean', description: '是否允许其他 Agent 访问此记忆', default: false },
        confidence: { type: 'number', description: '置信度 0-1（默认 0.3），4 级体系: 0.3 试探/0.5 中等/0.7 强/0.9 近乎确定', default: 0.3 },
        valid_until: { type: 'number', description: '有效期限（UNIX 时间戳），超过后置信度衰减' },
        perception_links: {
          type: 'array',
          description: '关联的感知链（新记忆自动关联后不需手动传），格式：[{ target_id, relation_type, explanation?, confidence? }]',
          items: {
            type: 'object',
            properties: {
              target_id: { type: 'string', description: '目标记忆ID' },
              relation_type: { type: 'string', enum: ['LEADS_TO', 'BECAUSE_OF', 'ENABLES', 'PREVENTS', 'RESPONSE_TO', 'CO_OCCURS_WITH'], default: 'CO_OCCURS_WITH' },
              explanation: { type: 'string', description: '关系说明' },
              confidence: { type: 'number', description: '置信度 0-1（默认 0.3），4 级体系: 0.3 试探/0.5 中等/0.7 强/0.9 近乎确定', default: 0.3 },
            },
            required: ['target_id'],
          },
        },
        session_id: { type: 'string', description: '会话 ID（可选），用于日志记录' },
        project: { type: 'string', description: '所属项目（可选），用于日志记录' },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_memories',
    description: '搜索记忆。当用户提及之前讨论过的话题、项目、偏好、技术决策时，主动调用此工具检索相关记忆。支持关键词搜索（FTS5全文索引）+ 向量语义兜底。自动连接服务器进行 Z-score 融合排序；服务器不可用时降级为本地按重要性排序。返回结果含 source 字段标识 "server" 或 "local"。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'integer', description: '返回条数上限', default: 20 },
        types: { type: 'array', items: { type: 'string' }, description: '按类型过滤' },
        use_vector: { type: 'boolean', description: '是否使用向量语义搜索', default: true },
        include_heb: { type: 'boolean', description: '是否包含关联记忆', default: false },
        agent_id: { type: 'string', description: 'Agent ID（多 Agent 过滤用）' },
        scope: { type: 'string', enum: ['all', 'personal', 'shared'], description: '检索范围: all=全部, personal=仅自己, shared=仅共享', default: 'all' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_memory',
    description: '按ID获取单条记忆详情',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆ID' },
      },
      required: ['mem_id'],
    },
  },
  {
    name: 'list_memories',
    description: '分页列出记忆，按重要性倒序',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '按类型过滤' },
        tier: { type: 'string', description: '按层级过滤: episodic/internalized/growth/core_identity' },
        limit: { type: 'integer', default: 50 },
        offset: { type: 'integer', default: 0 },
      },
    },
  },
  {
    name: 'trace_perception_chain',
    description: '追踪记忆的感知链（BFS），查看"为什么"和"导致什么"。自动连接服务器进行深度 BFS（depth=8，双向）；服务器不可用时降级为本地 2 步简易 BFS。返回结果含 depth 和 relation 字段。',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆ID' },
        direction: { type: 'string', enum: ['forward', 'backward', 'both'], default: 'both' },
        max_depth: { type: 'integer', default: 3, description: '最大追踪深度' },
      },
      required: ['mem_id'],
    },
  },
  {
    name: 'find_perception_path',
    description: '查找两个记忆节点之间的最短因果路径（双向 BFS）。自动连接服务器进行深度搜索；服务器不可用时返回空数组。',
    inputSchema: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: '起始记忆ID' },
        target_id: { type: 'string', description: '目标记忆ID' },
        max_depth: { type: 'integer', default: 5, description: '最大搜索深度，默认5' },
      },
      required: ['source_id', 'target_id'],
    },
  },
  {
    name: 'get_perception_graph_stats',
    description: '获取因果图统计信息——节点数、边数、关系类型分布、中心节点',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'diffuse_memories',
    description: '记忆扩散搜索——从一组记忆出发，沿关联关系向外多跳扩散，发现间接相关的知识。自动连接服务器进行加权扩散（按 relation_type 区分权重）；服务器不可用时返回空数组。',
    inputSchema: {
      type: 'object',
      properties: {
        seed_ids: { type: 'array', items: { type: 'string' }, description: '种子记忆ID列表' },
        max_hops: { type: 'integer', default: 2, description: '最大扩散跳数' },
      },
      required: ['seed_ids'],
    },
  },
  {
    name: 'get_memory_tree',
    description: '获取记忆树结构（按 parent_id 组织的层级树）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_related_memories',
    description: '获取与指定记忆关联的其他记忆（Hebbian 共现关联）',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆ID' },
      },
      required: ['mem_id'],
    },
  },
  {
    name: 'get_stats',
    description: '获取记忆感知系统统计信息（记忆总数、类型分布等）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reimport_sources',
    description: '重新扫描 COGNITION_SOURCES 目录，将新增/修改的 .md/.json 文件导入记忆库。内容哈希去重，不会产生重复。用户新加了笔记后调用此工具。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'recall_context',
    description: '一键回忆（比 search_memories 更全面）：当需要全面了解某个主题的来龙去脉时调用此工具，同时检索 FTS5 全文 + 向量语义 + 感知链 + Hebbian 关联 + 多跳扩散。适合在新任务开始时调用，获取任务相关的完整背景。自动连接服务器进行深度因果追踪（backward depth=8）和一站式评分；服务器不可用时降级为本地 salience 排序。返回结果含 source 字段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '回忆查询词，如"用户对 AI 的看法"' },
        limit: { type: 'integer', default: 10, description: '直接命中记忆上限' },
        include_perception: { type: 'boolean', default: true, description: '是否展开感知链' },
        include_assoc: { type: 'boolean', default: true, description: '是否展开 Hebbian 关联' },
        include_diffusion: { type: 'boolean', default: true, description: '是否多跳扩散' },
      },
      required: ['query'],
    },
  },
  {
    name: 'consolidate_memories',
    description: '手动触发记忆巩固：根据使用频率和重要性自动晋升记忆层级（episodic → internalized → growth）。系统启动时也会自动运行。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'share_memory',
    description: '设置记忆的共享状态，允许其他 Agent 访问',
    inputSchema: {
      type: 'object',
      properties: {
        mem_id: { type: 'string', description: '记忆 ID' },
        share: { type: 'boolean', description: '是否共享', default: true },
      },
      required: ['mem_id'],
    },
  },
  {
    name: 'merge_memories',
    description: '合并重复记忆，将多条记忆合并到一条目标记忆',
    inputSchema: {
      type: 'object',
      properties: {
        source_ids: { type: 'array', items: { type: 'string' }, description: '被合并的记忆 ID 列表' },
        target_id: { type: 'string', description: '目标记忆 ID（保留此条）' },
      },
      required: ['source_ids', 'target_id'],
    },
  },
  {
    name: 'batch_delete',
    description: '批量删除记忆（软删除）',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '要删除的记忆 ID 列表' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'batch_update',
    description: '批量更新记忆的标签/重要性',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '要更新的记忆 ID 列表' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签（覆盖）' },
        salience: { type: 'integer', description: '新重要性 1-5' },
      },
    },
  },
  {
    name: 'export_memories',
    description: '导出记忆为 JSON。支持按类型/层级筛选',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '按类型筛选' },
        tier: { type: 'string', description: '按层级筛选' },
        limit: { type: 'integer', default: 1000 },
        offset: { type: 'integer', default: 0 },
      },
    },
  },
  {
    name: 'explain_query',
    description: '解释检索结果路径分解，展示每条记忆来自哪些路径（FTS/向量/实体/时间/关键词）以及分数构成',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询词' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_confidence_stats',
    description: '查看置信度分布统计。展示当前记忆库中各置信度层级（0.3/0.5/0.7/0.9）的数量分布',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scan_memory_patterns',
    description: '扫描近期记忆模式：按类型/标签聚类分析，了解当前记忆库的内容分布和趋势',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'integer', description: '回溯小时数', default: 24 },
        min_count: { type: 'integer', description: '最小聚类数量', default: 3 },
      },
    },
  },
  {
    name: 'validate_memory',
    description: '验证记忆内容质量（长度/瞬态/猜测三重门禁）',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆文本内容' },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_top_experiences',
    description: '获取按衰减分数排序的 Top N 经验教训',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: '返回条数，默认 15', default: 15 },
      },
    },
  },
  {
    name: 'deduplicate_memories',
    description: '按内容前 80 字分组去重，保留 salience 最高的',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '限定项目名（可选）' },
      },
    },
  },
  {
    name: 'scan_observation_patterns',
    description: '扫描最近 N 小时的观察日志，返回高频错误模式',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: '回溯小时数，默认 2', default: 2 },
      },
    },
  },
  {
    name: 'rotate_observation_logs',
    description: '清理 7 天前的观察日志文件',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_mine',
    description: '挖掘对话会话中的决策、踩坑、编辑循环',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array', description: '对话消息数组 [{role, content}]' },
        session_id: { type: 'string', description: '会话 ID' },
        project: { type: 'string', description: '项目路径（可选）' },
      },
      required: ['messages', 'session_id'],
    },
  },
  {
    name: 'derive_memories',
    description: '从对话中识别并保存长期记忆（需先调用 set_llm_fallback 配置 LLM）',
    inputSchema: {
      type: 'object',
      properties: {
        messages: { type: 'array', description: '对话消息数组 [{role, content}]' },
        session_id: { type: 'string', description: '会话 ID（可选）' },
        project: { type: 'string', description: '项目路径（可选）' },
      },
      required: ['messages'],
    },
  },
  {
    name: 'flush_recognizer',
    description: '手动触发 Recognizer 立即处理待识别队列。通常由后台调度器自动运行，但需要立即落库时可用此工具。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'observe_turn',
    description: '记录对话内容到记忆识别队列。当本轮对话中用户透露了可能值得记住的偏好、事实、决策时，可调用此工具让系统自动判断是否值得入记忆。轻量快速（<5ms），仅入队不阻塞。',
    inputSchema: {
      type: 'object',
      properties: {
        user_message: { type: 'string', description: '用户的最后一条消息' },
        session_id: { type: 'string', description: '会话 ID（可选）' },
        project: { type: 'string', description: '项目路径（可选）' },
      },
      required: ['user_message'],
    },
  },
]

// ── 工具实现 ──

tools.set('save_memory', async (params) => {
  const { saveMemory, addPerceptionLink } = await import('./db.js')
  if (!params.content) return { error: 'content 不能为空' }
  const gate = validateMemoryContent(params.content)
  if (!gate.valid) return { error: gate.reason, gate }
  const entityTags = extractEntityTags(params.content)

  // 偏好自动提权：默认 salience=4 + confidence=0.7（豁免噪声惩罚，锚点可捕获）
  const isPreference = (params.type || 'observation') === 'preference'
  const autoSalience = isPreference && params.salience == null ? 4 : params.salience
  const autoConfidence = isPreference && params.confidence == null ? 0.7 : params.confidence

  const result = saveMemory({
    content: params.content,
    type: params.type || 'observation',
    title: params.title,
    tags: params.tags,
    salience: autoSalience,
    detail: params.detail,
    mem_id: params.mem_id,
    agent_id: params.agent_id,
    cross_agent_share: params.cross_agent_share,
    confidence: autoConfidence,
    valid_until: params.valid_until,
    entities: entityTags,
  })
  const createdLinks: { source_id: string; target_id: string; relation_type: string }[] = []
  if (result?.id && Array.isArray(params.perception_links)) {
    for (const link of params.perception_links) {
      if (!link.target_id) continue
      const r = addPerceptionLink(
        result.id,
        link.target_id,
        link.relation_type || 'CO_OCCURS_WITH',
        link.confidence ?? 0.5,
        link.explanation || '',
      )
      if (r) createdLinks.push({ source_id: result.id, target_id: link.target_id, relation_type: link.relation_type || 'CO_OCCURS_WITH' })
    }
  }

  // 写入观察日志
  writeObservation({
    tool: 'save_memory',
    args: { content: params.content, session_id: params.session_id, project: params.project, valid: gate.valid, tags: entityTags },
    session: params.session_id,
    project: params.project,
    success: gate.valid,
  })

  return {
    id: result?.id,
    action: result?.action || 'unknown',
    mem_id: result?.id,
    perception_links: createdLinks.length > 0 ? createdLinks : undefined,
  }
})

tools.set('search_memories', async (params) => {
  const start = Date.now()
  const query = params.query ?? ''
  const limit = params.limit || 20
  const types = params.types?.length ? params.types : undefined
  const useVector = params.use_vector !== false

  // remote 模式：发到服务器重排序（保留原路径）
  if (config.mode === 'remote') {
    try {
      const { searchMemories: ftsSearch } = await import('./db.js')
      const { remoteClient } = await import('./remote-client.js')
      const ftsResults = ftsSearch(query, { limit: params.limit || 50 })
      const candidates = ftsResults.map((row: any) => ({
        id: row.id, content: row.content, title: row.title, type: row.type,
        salience: row.salience, confidence: row.confidence, created_at: row.created_at, updated_at: row.updated_at,
      }))
      // 用本地存储的 embedding 算向量分数，让服务器拿到有意义的分数做重排序
      let vectorScores: Record<string, number> = {}
      if (vectorEngine.isReady) {
        try {
          const queryVec = await vectorEngine.embed(query)
          for (const row of ftsResults) {
            if (row.embedding) {
              try {
                const memVec = JSON.parse(row.embedding)
                vectorScores[row.id] = vectorEngine.cosineSimilarity(queryVec, memVec)
              } catch {}
            }
          }
        } catch {}
      }
      const serverResult = await remoteClient.searchMemories({
        query,
        candidates,
        vectorScores,
        ftsMatchIds: candidates.map((m: any) => m.id),
        options: { limit },
      })
      return {
        memories: serverResult.memories,
        scores: serverResult.scores,
        latencyMs: Date.now() - start,
        source: 'server',
      }
    } catch {}
  }

  // 本地：6 路检索管线（FTS5 + 向量语义 + 关键词 + 实体 + 时间窗口）
  // 自动降级：向量模型不可用时用 FTS5+LIKE 兜底
  const { retrieve } = await import('./retrieval.js')
  const result = await retrieve(query, {
    limit,
    types,
    useVector,
    includeHidden: false,
  })

  return {
    memories: result.memories,
    scores: result.scores,
    explain: result.explain,
    latencyMs: result.latencyMs,
    source: result.source,
  }
})

tools.set('get_memory', async (params) => {
  const { getMemory } = await import('./db.js')
  const mem = getMemory(params.mem_id)
  if (!mem) return { error: '记忆不存在' }
  return { memory: mem }
})

tools.set('list_memories', async (params) => {
  const { listMemories, countMemories } = await import('./db.js')
  const mems = listMemories({
    type: params.type,
    tier: params.tier,
    limit: params.limit || 50,
    offset: params.offset || 0,
  })
  const total = countMemories({ type: params.type, tier: params.tier })
  return { memories: mems, total }
})

tools.set('trace_perception_chain', async (params) => {
  const { getDb: gdb } = await import('./db.js')
  const db = gdb()
  // 从本地 DB 读取因果边
  const edges = db.prepare('SELECT source_id, target_id, relation_type, confidence, explanation FROM perception_links').all() as any[]

  // remote 模式：发到服务器做深度 BFS（depth=8）
  if (config.mode === 'remote') {
    try {
      const { remoteClient } = await import('./remote-client.js')
      const result = await remoteClient.tracePerception(edges, params.mem_id, params.direction, params.max_depth || 8)
      // 补充内容
      for (const node of [...(result.forward || []), ...(result.backward || [])]) {
        try {
          const row = db.prepare('SELECT content, title, type FROM memories WHERE id = ? LIMIT 1').all(node.memoryId) as any[]
          if (row.length) { (node as any).content = row[0].content; (node as any).title = row[0].title }
        } catch {}
      }
      return { chain: [...(result.forward || []), ...(result.backward || [])], forward: result.forward, backward: result.backward }
    } catch {}
  }

  return { chain: [], forward: [], backward: [], message: '感知链追踪需要连接服务器，本地模式不可用' }
})

tools.set('find_perception_path', async (params) => {
  if (!params.source_id || !params.target_id) return { error: 'source_id 和 target_id 是必需的' }

  if (config.mode === 'remote') {
    try {
      const { getDb: gdb } = await import('./db.js')
      const edges = gdb().prepare('SELECT source_id, target_id, relation_type, confidence, explanation FROM perception_links').all() as any[]
      const { remoteClient } = await import('./remote-client.js')
      const path = await remoteClient.findPerceptionPath(edges, params.source_id, params.target_id, params.max_depth || 8)
      return { path: path || [] }
    } catch {}
  }

  return { path: [], message: '路径查找需要连接服务器，本地模式不可用' }
})

tools.set('get_perception_graph_stats', async () => {
  // remote 模式：服务器端统计因果图
  if (config.mode === 'remote') {
    try {
      const { remoteClient } = await import('./remote-client.js')
      const stats = await remoteClient.perceptionGraphStats()
      return { ...stats, source: 'server' }
    } catch { /* 服务器不可用降级 */ }
  }
  return { message: '感知图统计需要连接服务器，本地模式不可用' }
})

tools.set('diffuse_memories', async (params) => {
  const { getDb: gdb } = await import('./db.js')

  if (config.mode === 'remote') {
    try {
      const edges = gdb().prepare('SELECT source_id, target_id, relation_type, confidence FROM perception_links').all() as any[]
      const { remoteClient } = await import('./remote-client.js')
      const nodes = await remoteClient.diffuseMemories({ edges, nodes: [] }, params.seed_ids, params.max_hops || 3)
      return { nodes }
    } catch {}
  }

  return { nodes: [], message: '记忆扩散需要连接服务器，本地模式不可用' }
})

tools.set('get_memory_tree', async () => {
  const { loadTree } = await import('./tree.js')
  const tree = loadTree()
  return { tree }
})

tools.set('get_related_memories', async (params) => {
  // remote 模式：发本地因果边给服务器做 Hebbian 关联查询
  if (config.mode === 'remote') {
    try {
      const { getDb: gdb } = await import('./db.js')
      const edges = gdb().prepare('SELECT source_id, target_id, relation_type, confidence FROM perception_links').all() as any[]
      const { remoteClient } = await import('./remote-client.js')
      const result = await remoteClient.getRelatedMemories(edges, params.mem_id)
      return { memories: result.memories || [], source: 'server' }
    } catch { /* 服务器不可用降级 */ }
  }
  // local 模式：本地 Hebbian 共现关联查询
  try {
    const { getAssociatedMemoryIds } = await import('./association.js')
    const { getDb } = await import('./db.js')
    const ids = getAssociatedMemoryIds(params.mem_id)
    if (!ids.length) return { memories: [], source: 'local' }
    const placeholders = ids.map(() => '?').join(',')
    const rows = getDb().prepare(
      `SELECT id, mem_id, content, type, title, salience FROM memories WHERE id IN (${placeholders}) AND visibility = 1`
    ).all(...ids) as any[]
    return { memories: rows, source: 'local' }
  } catch (e: any) {
    return { memories: [], error: e?.message ?? String(e) }
  }
})

tools.set('get_stats', async () => {
  const db = (await import('./db.js')).getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM memories').all() as any[])[0]?.c || 0
  const visible = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE visibility = 1').all() as any[])[0]?.c || 0
  const byType = db.prepare('SELECT type, COUNT(*) as c FROM memories WHERE visibility = 1 GROUP BY type ORDER BY c DESC').all() as any[]
  const byTier = db.prepare('SELECT tier, COUNT(*) as c FROM memories WHERE visibility = 1 GROUP BY tier').all() as any[]
  const perceptionCount = (db.prepare('SELECT COUNT(*) as c FROM perception_links').all() as any[])[0]?.c || 0
  const assocCount = (db.prepare('SELECT COUNT(*) as c FROM memory_associations').all() as any[])[0]?.c || 0
  const vectorReady = vectorEngine.isReady

  return {
    totalMemories: total,
    visibleMemories: visible,
    byType,
    byTier,
    perceptionLinks: perceptionCount,
    associations: assocCount,
    vectorReady,
  }
})

tools.set('reimport_sources', async () => {
  const { importSources } = await import('./import.js')
  const result = await importSources()
  return {
    imported: result.imported,
    updated: result.updated,
    skipped: result.skipped,
    total_scanned: result.imported + result.updated + result.skipped,
  }
})

// ── recall_context 一键回忆 ──

tools.set('recall_context', async (params) => {
  const start = Date.now()
  const { getDb: gdb } = await import('./db.js')
  const db = gdb()
  const query = params.query ?? ''
  const limit = params.limit || 10

  const includePerception = params.include_perception !== false
  const includeAssoc = params.include_assoc !== false
  const includeDiffusion = params.include_diffusion !== false

  // remote 模式：调一站式服务器（发本地中间结果，服务器做增强推理）
  if (config.mode === 'remote') {
    try {
      const edges = db.prepare('SELECT source_id, target_id, relation_type, confidence, explanation FROM perception_links').all() as any[]
      const { searchMemories } = await import('./db.js')
      const rawMemories = searchMemories(query, { limit: Math.max(limit, 50) }).map((m: any) => ({
        id: m.id, content: m.content, title: m.title, type: m.type,
        salience: m.salience, confidence: m.confidence, created_at: m.created_at,
      }))
      const { remoteClient } = await import('./remote-client.js')
      const result = await remoteClient.recallContext({
        query,
        memories: rawMemories,
        perceptionEdges: edges,
        options: { limit, includePerception, includeAssoc, includeDiffusion },
      })
      return {
        context: {
          query,
          direct: result.memories.slice(0, limit).map((m: any) => ({
            id: m.id, content: m.content, title: m.title, type: m.type, salience: m.salience,
          })),
          ...(result.extra?.perception ? { perception_chains: result.extra.perception } : {}),
        },
        stats: {
          direct_hits: result.memories.length,
          perception_links: result.extra?.perception?.length || 0,
          source: 'server',
          latencyMs: Date.now() - start,
        },
      }
    } catch {}
  }

  // 本地：基础检索（FTS5 + 向量 + 关键词，不含感知链/关联/扩散）
  const { retrieve } = await import('./retrieval.js')
  const result = await retrieve(query, { limit })

  const direct = result.memories.map(m => ({
    id: m.id, content: m.content, title: m.title, type: m.type, salience: m.salience,
  }))

  return {
    context: { query, direct },
    stats: {
      direct_hits: direct.length,
      source: 'local',
      latencyMs: Date.now() - start,
    },
  }
})

tools.set('consolidate_memories', async () => {
  const { consolidateMemories, decayMemories } = await import('./db.js')
  const c = consolidateMemories()
  const d = decayMemories()
  return { promoted: c.promoted, decayed: d.decayed }
})

tools.set('get_confidence_stats', async () => {
  try {
    const db = (await import('./db.js')).getDb()
    const rows = db.prepare('SELECT confidence, COUNT(*) as c FROM memories WHERE visibility = 1 GROUP BY confidence ORDER BY confidence').all() as any[]
    const distribution = rows.map((r: any) => ({ level: r.confidence, count: r.c }))
    return { distribution }
  } catch (e) {
    return { error: (e as Error)?.message }
  }
})

tools.set('scan_memory_patterns', async (params) => {
  try {
    const { scanMemoryPatterns, formatPatternsForPrompt } = await import('./patterns.js')
    const result = scanMemoryPatterns(params?.hours || 24, params?.min_count || 3)
    return {
      patterns: result.patterns,
      total: result.total,
      timeRange: result.timeRange,
      typeDistribution: result.typeDistribution,
      tierDistribution: result.tierDistribution,
      summary: formatPatternsForPrompt(result),
    }
  } catch (e) {
    return { error: (e as Error)?.message }
  }
})

// ── v1.3 新工具 ──

tools.set('share_memory', async (params) => {
  const { getDb } = await import('./db.js')
  if (!params.mem_id) return { error: 'mem_id 不能为空' }
  const db = getDb()
  const share = params.share !== false ? 1 : 0
  db.prepare('UPDATE memories SET cross_agent_share = ?, updated_at = ? WHERE mem_id = ? OR id = ?').run(share, Date.now(), params.mem_id, params.mem_id)
  return { mem_id: params.mem_id, shared: params.share !== false }
})

tools.set('merge_memories', async (params) => {
  const { mergeMemories } = await import('./db.js')
  if (!params.source_ids?.length || !params.target_id) return { error: 'source_ids 和 target_id 是必需的' }
  const result = mergeMemories(params.source_ids, params.target_id)
  return result
})

tools.set('batch_delete', async (params) => {
  const { batchDeleteMemories } = await import('./db.js')
  if (!params.ids?.length) return { error: 'ids 不能为空' }
  const result = batchDeleteMemories(params.ids)
  return result
})

tools.set('batch_update', async (params) => {
  const { batchUpdateMemories } = await import('./db.js')
  if (!params.ids?.length) return { error: 'ids 不能为空' }
  const result = batchUpdateMemories(params.ids, { tags: params.tags, salience: params.salience })
  return result
})

tools.set('export_memories', async (params) => {
  const { exportMemories } = await import('./db.js')
  const json = exportMemories({ type: params.type, tier: params.tier, limit: params.limit, offset: params.offset })
  let data
  try { data = JSON.parse(json) } catch { data = [] }
  return { data }
})

tools.set('explain_query', async (params) => {
  const start = Date.now()
  const query = params.query ?? ''
  const limit = params.limit || 10

  // 用完整检索管线的 explain 路径分解（FTS/向量/实体/时间/关键词 + 分数构成）
  try {
    const { retrieve } = await import('./retrieval.js')
    const result = await retrieve(query, { limit })
    return {
      query,
      latencyMs: Date.now() - start,
      source: 'local',
      total_memories: result.memories.length,
      breakdown: result.explain?.map(e => ({
        id: e.id,
        content: e.content,
        score: e.score,
        paths: e.paths,
        vectorScore: e.vectorScore,
        salience: e.salience,
      })) || [],
    }
  } catch (e) {
    return { error: (e as Error)?.message }
  }
})

// ── 新模块工具 ──

tools.set('validate_memory', async (params) => {
  if (!params.content) return { error: 'content 不能为空' }
  const gate = validateMemoryContent(params.content)
  return {
    valid: gate.valid,
    ...(gate.reason ? { reason: gate.reason } : {}),
    tags: gate.valid ? extractEntityTags(params.content) : [],
  }
})

tools.set('get_top_experiences', async (_params) => {
  const n = _params.n || 15
  try {
    const { getDb, decayByTime } = await import('./db.js')
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, type, content, salience, project, created_at, usage_count
       FROM memories WHERE type IN ('experience', 'insight', 'preference', 'lesson', 'feedback')
       AND visibility = 1 AND hidden_at IS NULL
       ORDER BY salience DESC LIMIT 200`
    ).all() as any[]
    const scored = rows.map((r: any) => ({
      memId: r.id, content: r.content,
      score: decayByTime(r.salience ?? 3, r.created_at),
      salience: r.salience ?? 3, type: r.type, project: r.project || '',
    }))
    scored.sort((a: any, b: any) => b.score - a.score)
    return { n, total: scored.length, experiences: scored.slice(0, n) }
  } catch (e) {
    return { error: (e as Error)?.message }
  }
})

tools.set('deduplicate_memories', async (params) => {
  try {
    const db = (await import('./db.js')).getDb()
    const rows = db.prepare(
      'SELECT id, content, salience FROM memories WHERE visibility = 1 AND hidden_at IS NULL'
    ).all() as any[]
    const groups = new Map<string, { id: string; salience: number }[]>()
    for (const r of rows) {
      const key = r.content.replace(/[\s\n\r]+/g, ' ').replace(/[^\w一-鿿]/g, '').slice(0, 80)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }
    let merged = 0
    const now = Date.now()
    for (const [_, group] of groups) {
      if (group.length <= 1) continue
      group.sort((a, b) => b.salience - a.salience)
      for (const dup of group.slice(1)) {
        db.prepare('UPDATE memories SET visibility = 0, hidden_at = ? WHERE id = ?').run(now, dup.id)
        merged++
      }
    }
    return { merged }
  } catch (e) {
    return { error: (e as Error)?.message }
  }
})

tools.set('scan_observation_patterns', async (params) => {
  const hours = params.hours || 2
  const result = scanRecentPatterns(hours)
  return result
})

tools.set('rotate_observation_logs', async (_params) => {
  const deleted = rotateObservationLogs()
  return { deleted }
})

tools.set('session_mine', async (params) => {
  const messages = params.messages
  const sessionId = params.session_id || `session_${Date.now()}`
  await mineSession(messages, sessionId, params.project)
  return { session_id: sessionId, status: 'mined' }
})

tools.set('derive_memories', async (params) => {
  // remote 模式：发消息给服务器做 LLM 识别
  if (config.mode === 'remote') {
    try {
      const { remoteClient } = await import('./remote-client.js')
      const result = await remoteClient.deriveMemories(params.messages, params.session_id, params.project)
      return { memories: result.memories || [], source: 'server' }
    } catch { /* 服务器不可用降级 */ }
  }
  return { error: 'LLM 记忆识别需要连接服务器，本地模式不可用' }
})

tools.set('flush_recognizer', async (_params) => {
  // remote 模式：服务器端跑识别器（服务器持有 recognizer）
  if (config.mode === 'remote') {
    try {
      const { remoteClient } = await import('./remote-client.js')
      const result = await remoteClient.flushRecognizer()
      return { ...result, source: 'server' }
    } catch { /* 服务器不可用降级 */ }
  }
  // local 模式：本地识别器（llm-helper 支持 OpenAI 兼容 / Anthropic）
  try {
    const { flushNow } = await import('./recognizer-scheduler.js')
    const result = await flushNow()
    return { ...result, source: 'local' }
  } catch (e: any) {
    return { error: `本地识别失败: ${e?.message ?? e}` }
  }
})

tools.set('observe_turn', async (params) => {
  const msg = params?.user_message
  if (!msg || !msg.trim()) return { queued: false, reason: 'empty_message' }

  const { enqueueTurn } = await import('./db.js')
  const { writeObservation } = await import('./obs-log.js')

  const hasSignal = hasMemorySignal(msg)
  if (!hasSignal) {
    writeObservation({ tool: 'observe_turn', args: { length: msg.length }, session: params.session_id, project: params.project, success: false })
    return { queued: false, reason: 'no_signal', message_length: msg.length }
  }

  const signals = detectGuardSignals(msg)
  enqueueTurn({
    user_message: msg,
    session_id: params.session_id || '',
    project: params.project || '',
    guard_signals: signals.join(','),
  })

  writeObservation({ tool: 'observe_turn', args: { length: msg.length, signals }, session: params.session_id, project: params.project, success: true })
  return { queued: true, signals, message_length: msg.length }
})

// ── SDK MCP Server ──

const server = new Server({
  name: 'AiFP 记忆感知系统',
  version: VERSION,
}, {
  capabilities: { tools: {}, resources: {} },
})

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}))

// ── MCP Resources ──
// 支持 Resources 的客户端（Claude Desktop、Cursor 等）会在会话启动时自动加载
// 这提供了 baseline context，而 UserPromptSubmit hook 提供每轮精准注入

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'cognition://status',
      name: 'AiFP 记忆感知系统状态',
      description: '系统概览：记忆总数、层级分布、链系统状态',
      mimeType: 'text/plain',
    },
  ],
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'cognition://status') {
    const db = (await import('./db.js')).getDb()
    const total = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE visibility = 1').all() as any[])[0]?.c || 0
    const byType = db.prepare('SELECT type, COUNT(*) as c FROM memories WHERE visibility = 1 GROUP BY type ORDER BY c DESC').all() as any[]
    const perceptionCount = (db.prepare('SELECT COUNT(*) as c FROM perception_links').all() as any[])[0]?.c || 0
    const assocCount = (db.prepare('SELECT COUNT(*) as c FROM memory_associations').all() as any[])[0]?.c || 0

    const typeSummary = byType.map((r: any) => `${r.type}: ${r.c}`).join(', ')
    const lines = [
      `AiFP 记忆感知系统 v${VERSION} — 已激活`,
      `记忆总数: ${total}`,
      `类型分布: ${typeSummary || '无'}`,
      `感知链: ${perceptionCount} 条`,
      `Hebbian 关联: ${assocCount} 条`,
      `自动记忆注入已启用 (UserPromptSubmit hook)`,
      ``,
      `可用工具: search_memories, recall_context, save_memory, observe_turn, trace_perception_chain 等`,
      `输入 #stats 查看详细统计`,
      ``,
      `升级: npm install -g aifp-mcp@latest`,
      `查看版本: npm ls -g aifp-mcp`,
    ]

    return {
      contents: [
        {
          uri: 'cognition://status',
          mimeType: 'text/plain',
          text: lines.join('\n'),
        },
      ],
    }
  }
  throw new McpError(ErrorCode.InvalidParams, `未知资源: ${request.params.uri}`)
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = tools.get(request.params.name)
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
  }
  try {
    const result = await handler(request.params.arguments || {})
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// ── 初始化 ──

export async function initServer(): Promise<void> {
  // 后台启动向量引擎，不阻塞 MCP 初始化
  vectorEngine.init().then(() => {
    if (vectorEngine.isReady) {
      Promise.all([
        vectorEngine.repairAllEmbeddings().catch(() => {}),
        import('./import.js').then(m => m.importSources()).catch(() => {}),
      ])
    }
  }).catch(() => {
    import('./import.js').then(m => m.importSources()).catch(() => {})
  })

  // 启动时跑一次记忆巩固 + 遗忘衰减
  try {
    const { consolidateMemories, decayMemories } = await import('./db.js')
    consolidateMemories()
    decayMemories()
  } catch { /* 巩固/衰减失败不影响启动 */ }
}

// 启动向量引擎（在背景运行，不阻塞 transport 连接）
server.oninitialized = () => {
  initServer()
}

// ── Stdio 模式（MCP SDK） ──

export async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ── HTTP 模式 JSON-RPC handler ──

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: any
  error?: { code: number; message: string }
}

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { method, id, params } = req

  if (method === 'notifications/initialized') return null

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'AiFP 记忆感知系统', version: VERSION },
        },
      }

    case 'tools/list':
      return {
        jsonrpc: '2.0', id,
        result: { tools: toolDefinitions },
      }

    case 'tools/call': {
      const handler = tools.get(params.name)
      if (!handler) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params.name}` } }
      }
      try {
        const result = await handler(params.arguments || {})
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }
      } catch (err: any) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } }
      }
    }

    case 'resources/list':
      return {
        jsonrpc: '2.0', id,
        result: {
          resources: [
            {
              uri: 'cognition://status',
              name: 'AiFP 记忆感知系统状态',
              description: '系统概览：记忆总数、层级分布、链系统状态',
              mimeType: 'text/plain',
            },
          ],
        },
      }

    case 'resources/read': {
      if (params.uri !== 'cognition://status') {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${params.uri}` } }
      }
      const db = (await import('./db.js')).getDb()
      const total = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE visibility = 1').all() as any[])[0]?.c || 0
      const byType = db.prepare('SELECT type, COUNT(*) as c FROM memories WHERE visibility = 1 GROUP BY type ORDER BY c DESC').all() as any[]
      const perceptionCount = (db.prepare('SELECT COUNT(*) as c FROM perception_links').all() as any[])[0]?.c || 0
      const assocCount = (db.prepare('SELECT COUNT(*) as c FROM memory_associations').all() as any[])[0]?.c || 0
      const typeSummary = byType.map((r: any) => `${r.type}: ${r.c}`).join(', ')
      const text = [
        'AiFP 记忆感知系统 v' + VERSION + ' — 已激活',
        `记忆总数: ${total}`,
        `类型分布: ${typeSummary || '无'}`,
        `感知链: ${perceptionCount} 条`,
        `Hebbian 关联: ${assocCount} 条`,
        `自动记忆注入已启用 (UserPromptSubmit hook)`,
        '',
        `可用工具: search_memories, recall_context, save_memory, observe_turn, trace_perception_chain 等`,
        '输入 #stats 查看详细统计',
        '',
        '升级: npm install -g aifp-mcp@latest',
        '查看版本: npm ls -g aifp-mcp',
      ].join('\n')
      return {
        jsonrpc: '2.0', id,
        result: { contents: [{ uri: params.uri, mimeType: 'text/plain', text }] },
      }
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Not supported: ${method}` } }
  }
}

// 捕获未处理错误避免进程退出
process.on('uncaughtException', (err) => {
  console.error('[记忆感知] 未捕获错误:', err.message)
})
process.on('unhandledRejection', (err: any) => {
  console.error('[记忆感知] 未捕获 Promise 拒绝:', err?.message || String(err))
})
