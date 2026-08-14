// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * mcp-enhanced.ts — 服务端增强版 handleRequest
 * 在 mcp.ts 的 baseHandleRequest 基础上增加所有算法逻辑端点
 * 此文件仅部署在腾讯服务器上，不进入 npm 包
 *
 * 包含所有核心逻辑：搜索排序、感知链、扩散、关联、合并等
 * 客户端只发数据，逻辑全在服务端
 */

import { handleRequest as baseHandleRequest, initServer, type JsonRpcRequest, type JsonRpcResponse } from './mcp.js'

// ─── 共享 BFS 工具函数 ─────────────────────────────────
function _createBFS(start: string, maxD: number, adj: Map<string, { e: any; nid: string }[]>) {
  const visited = new Set<string>([start])
  const queue: { id: string; depth: number }[] = [{ id: start, depth: 0 }]
  const result: any[] = []
  while (queue.length > 0) {
    const curr = queue.shift()!
    if (curr.depth >= maxD) continue
    for (const { e, nid } of adj.get(curr.id) || []) {
      if (!visited.has(nid)) {
        visited.add(nid)
        result.push({
          memoryId: nid,
          relation: e.relation_type || e.relation || 'CO_OCCURS_WITH',
          confidence: e.confidence ?? 0.5,
          explanation: e.explanation || '',
          depth: curr.depth + 1,
        })
        queue.push({ id: nid, depth: curr.depth + 1 })
      }
    }
  }
  return result
}

// ── 冲突记忆补充（对标 aifp-web supplementConflictedMemories） ──
// 检索到带 conflict:xxx 标签的记忆时，把冲突的另一端也拉进来，
// 让 AI 看到"用户先说 X 后说 Y"的对立证据，避免被单边信息误导。
function _supplementConflicted(candidates: any[], maxExtra = 3): any[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return candidates

  const conflictPairs: { a: string; b: string }[] = []
  for (const m of candidates) {
    const tags = String(m.tags || '')
    const match = tags.match(/conflict:([\w,]+)/)
    if (match) {
      const others = match[1].split(',').filter(Boolean)
      for (const other of others) {
        conflictPairs.push({ a: m.mem_id || m.id, b: other })
      }
    }
  }
  if (conflictPairs.length === 0) return candidates

  // 查找冲突另一端的完整记忆（在 candidates 里找，找不到就跳过——
  // 服务器不直接连库，冲突端的全文由客户端补充）
  const existingIds = new Set(candidates.map(m => m.mem_id || m.id).filter(Boolean))
  const extras: any[] = []
  for (const pair of conflictPairs) {
    if (extras.length >= maxExtra) break
    if (existingIds.has(pair.b)) continue
    const other = candidates.find(c => (c.mem_id || c.id) === pair.b)
    if (other && !existingIds.has(other.id || other.mem_id)) {
      existingIds.add(other.id || other.mem_id)
      extras.push({ ...other, _conflictSupplemented: true })
    }
  }
  return extras.length ? [...candidates, ...extras] : candidates
}

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { method, id, params } = req

  try {
    switch (method) {

      // ── fusion：Z-score 归一化分数融合 ──
      case 'fusion': {
        const { items } = params
        if (!Array.isArray(items)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'items must be an array' } }
        }
        const vecScores = items.filter((i: any) => i.vectorScore !== undefined).map((i: any) => i.vectorScore!)
        const vecMean = vecScores.length ? vecScores.reduce((a: number, b: number) => a + b, 0) / vecScores.length : 0
        const vecStd = vecScores.length ? Math.sqrt(vecScores.reduce((a: number, b: number) => a + (b - vecMean) ** 2, 0) / vecScores.length) : 1

        const scores: Record<string, number> = {}
        for (const item of items) {
          let score = (item.salience ?? 3) / 5
          if (item.vectorScore !== undefined) {
            const z = vecStd > 0.01 ? (item.vectorScore - vecMean) / vecStd : 0
            const normalizedVec = 0.5 + Math.tanh(z * 0.5) * 0.25
            score = normalizedVec * 0.7 + (item.salience / 5) * 0.3
          }
          // 服务端 FTS boost 更高
          if (item.hasFtsMatch) score = Math.min(score * 1.15, 0.999)
          // 服务端额外置信度增益（比本地更强）
          const conf = item.confidence ?? 0.3
          if (conf >= 0.7) score = Math.min(score * 1.1, 0.999)
          scores[item.id] = +(+score).toFixed(4)
        }
        return { jsonrpc: '2.0', id, result: { scores } }
      }

      // ── trace_perception：深度感知链追踪（BFS depth=8） ──
      case 'trace_perception': {
        const { edges, seedId, direction = 'both', maxDepth = 8 } = params
        if (!Array.isArray(edges) || !seedId) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'edges[] and seedId required' } }
        }
        const fwdMap = new Map<string, { e: any; nid: string }[]>()
        const bwdMap = new Map<string, { e: any; nid: string }[]>()
        for (const edge of edges) {
          const src = edge.source_id || edge.sourceId
          const tgt = edge.target_id || edge.targetId
          if (!src || !tgt) continue
          if (!fwdMap.has(src)) fwdMap.set(src, [])
          fwdMap.get(src)!.push({ e: edge, nid: tgt })
          if (!bwdMap.has(tgt)) bwdMap.set(tgt, [])
          bwdMap.get(tgt)!.push({ e: edge, nid: src })
        }

        const bfs = _createBFS

        return {
          jsonrpc: '2.0', id,
          result: {
            forward: (direction === 'forward' || direction === 'both') ? bfs(seedId, maxDepth, fwdMap) : [],
            backward: (direction === 'backward' || direction === 'both') ? bfs(seedId, maxDepth, bwdMap) : [],
          },
        }
      }

      // ── search_memories：服务端重排序 + 智能融合 ──
      case 'search_memories': {
        const { query, candidates, vectorScores = {}, ftsMatchIds = [], options } = params
        if (!Array.isArray(candidates)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'candidates[] required' } }
        }

        // 服务端融合逻辑：Z-score + salience + FTS boost
        const inputs = candidates.map((m: any) => ({
          id: m.id,
          vectorScore: vectorScores[m.id],
          salience: m.salience ?? 3,
          hasFtsMatch: ftsMatchIds.includes(m.id),
          confidence: m.confidence ?? 0.3,
        }))
        const vecItems = inputs.filter((i: any) => i.vectorScore !== undefined)
        const vecMean = vecItems.length ? vecItems.reduce((a: number, b: any) => a + b.vectorScore, 0) / vecItems.length : 0
        const vecStd = vecItems.length ? Math.sqrt(vecItems.reduce((a: number, b: any) => a + (b.vectorScore - vecMean) ** 2, 0) / vecItems.length) : 1

        const scores: Record<string, number> = {}
        for (const item of inputs) {
          let score = (item.salience ?? 3) / 5
          if (item.vectorScore !== undefined) {
            const z = vecStd > 0.01 ? (item.vectorScore - vecMean) / vecStd : 0
            score = (0.5 + Math.tanh(z * 0.5) * 0.25) * 0.7 + (item.salience / 5) * 0.3
          }
          if (item.hasFtsMatch) score = Math.min(score * 1.15, 0.999)
          if (item.confidence >= 0.7) score = Math.min(score * 1.08, 0.999)
          scores[item.id] = +(+score).toFixed(4)
        }

        // 按分数排序
        const ranked = [...candidates].sort((a: any, b: any) => (scores[b.id] || 0) - (scores[a.id] || 0))
        const limit = options?.limit || 20

        // 冲突记忆补充：把 conflict 标签的另一端拉进结果
        const supplemented = _supplementConflicted(ranked)

        return {
          jsonrpc: '2.0', id,
          result: {
            memories: supplemented.slice(0, limit + 3),
            scores,
            source: 'server',
          },
        }
      }

      // ── recall_context：一站式深度召回 ──
      case 'recall_context': {
        const { query, memories, perceptionEdges, options } = params
        if (!Array.isArray(memories)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'memories[] required' } }
        }

        const extra: any = {}

        // 服务端感知链增强：对前3条记忆做深度溯源
        if (options?.includePerception !== false && perceptionEdges?.length > 0) {
          for (const mem of memories.slice(0, 3)) {
            const chain = traceChain(perceptionEdges, mem.id, 'backward', 8)
            if (chain.length > 0) {
              extra.perception = extra.perception || []
              extra.perception.push(...chain.map((n: any) => ({
                ...n, queryContext: `溯源: ${(mem.content || '').slice(0, 50)}`,
              })))
            }
          }
        }

        return {
          jsonrpc: '2.0', id,
          result: { memories, extra },
        }
      }

      // ── find_perception_path：双向 BFS 最短路径 ──
      case 'find_perception_path': {
        const { edges = [], sourceId, targetId, maxDepth = 8 } = params
        if (!sourceId || !targetId) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'sourceId and targetId required' } }
        }

        const fwdMap = new Map<string, { e: any; nid: string }[]>()
        const bwdMap = new Map<string, { e: any; nid: string }[]>()
        for (const edge of edges) {
          const src = edge.source_id || edge.sourceId
          const tgt = edge.target_id || edge.targetId
          if (!src || !tgt) continue
          if (!fwdMap.has(src)) fwdMap.set(src, [])
          fwdMap.get(src)!.push({ e: edge, nid: tgt })
          if (!bwdMap.has(tgt)) bwdMap.set(tgt, [])
          bwdMap.get(tgt)!.push({ e: edge, nid: src })
        }

        // 双向 BFS
        const fwdVisited = new Map<string, { prev: string; edge: any }>()
        const bwdVisited = new Map<string, { prev: string; edge: any }>()
        fwdVisited.set(sourceId, { prev: '', edge: null })
        bwdVisited.set(targetId, { prev: '', edge: null })
        const fwdQ = [sourceId], bwdQ = [targetId]
        let meeting: string | null = null

        for (let d = 0; d < maxDepth && !meeting; d++) {
          // 前向扩一层
          for (const cur of fwdQ.splice(0)) {
            for (const { e, nid } of fwdMap.get(cur) || []) {
              if (!fwdVisited.has(nid)) {
                fwdVisited.set(nid, { prev: cur, edge: e })
                if (bwdVisited.has(nid)) { meeting = nid; break }
                fwdQ.push(nid)
              }
            }
            if (meeting) break
          }
          if (meeting) break
          // 后向扩一层
          for (const cur of bwdQ.splice(0)) {
            for (const { e, nid } of bwdMap.get(cur) || []) {
              if (!bwdVisited.has(nid)) {
                bwdVisited.set(nid, { prev: cur, edge: e })
                if (fwdVisited.has(nid)) { meeting = nid; break }
                bwdQ.push(nid)
              }
            }
            if (meeting) break
          }
        }

        // 重建路径
        const path: any[] = []
        if (meeting) {
          const fwdPath: any[] = []
          let cur = meeting
          while (cur && cur !== sourceId) {
            const info = fwdVisited.get(cur)
            if (!info || !info.edge) break
            fwdPath.unshift({
              memoryId: cur,
              relation: info.edge.relation_type || 'CO_OCCURS_WITH',
              confidence: info.edge.confidence ?? 0.5,
            })
            cur = info.prev
          }
          const bwdPath: any[] = []
          cur = meeting
          while (cur && cur !== targetId) {
            const info = bwdVisited.get(cur)
            if (!info || !info.edge) break
            bwdPath.push({
              memoryId: cur,
              relation: info.edge.relation_type || 'CO_OCCURS_WITH',
              confidence: info.edge.confidence ?? 0.5,
            })
            cur = info.prev
          }
          path.push(...fwdPath, ...bwdPath)
        }

        return { jsonrpc: '2.0', id, result: path }
      }

      // ── diffuse_memories：多跳扩散 ──
      case 'diffuse_memories': {
        const { graph, seedIds, maxHops = 3 } = params
        if (!graph?.edges || !Array.isArray(seedIds)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'graph.edges[] and seedIds[] required' } }
        }

        const visited = new Set<string>(seedIds)
        // 构建邻接表（加权扩散：按 relation_type 给不同权重）
        const adj = new Map<string, { nid: string; weight: number }[]>()
        for (const e of graph.edges) {
          const src = e.source_id || e.sourceId
          const tgt = e.target_id || e.targetId
          if (!src || !tgt) continue
          // PREVENTS 关系传播权重低
          const weight = (e.relation_type === 'PREVENTS') ? 0.3 : 0.8
          if (!adj.has(src)) adj.set(src, [])
          adj.get(src)!.push({ nid: tgt, weight })
          if (!adj.has(tgt)) adj.set(tgt, [])
          adj.get(tgt)!.push({ nid: src, weight: weight * 0.5 })
        }

        const reached: any[] = []
        const queue = seedIds.map(id => ({ id, depth: 0, score: 1 }))
        while (queue.length > 0) {
          const curr = queue.shift()!
          if (curr.depth >= maxHops) continue
          for (const { nid, weight } of adj.get(curr.id) || []) {
            if (!visited.has(nid)) {
              visited.add(nid)
              const node: any = { memoryId: nid, depth: curr.depth + 1, score: +(curr.score * weight).toFixed(3) }
              reached.push(node)
              queue.push({ id: nid, depth: curr.depth + 1, score: node.score })
            }
          }
        }

        return { jsonrpc: '2.0', id, result: reached }
      }

      // ── flush_recognizer：手动触发识别器 ──
      case 'flush_recognizer': {
        // 识别器运行在客户端本地（使用用户配置的 LLM key），服务器不提供识别服务
        return { jsonrpc: '2.0', id, result: { error: '识别器运行在客户端本地（使用用户配置的 LLM key），服务器不提供识别服务' } }
      }

      // ── derive_memories：从对话识别记忆（LLM） ──
      case 'derive_memories': {
        // 同上：LLM 识别运行在客户端本地
        return { jsonrpc: '2.0', id, result: { memories: [], error: 'LLM 识别运行在客户端本地（使用用户配置的 key）' } }
      }

      // ── get_related_memories：Hebbian 关联查询（无状态：用客户端发的边图） ──
      case 'get_related_memories': {
        const { memId, edges } = params
        if (!memId || !Array.isArray(edges)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'memId and edges[] required' } }
        }
        // 用客户端发的感知链边构建邻接图，返回 memId 的直接邻居
        const neighbors = new Map<string, string>()
        for (const e of edges) {
          const s = e.source_id || e.sourceId
          const t = e.target_id || e.targetId
          if (!s || !t) continue
          if (s === memId && !neighbors.has(t)) neighbors.set(t, e.relation_type || 'CO_OCCURS_WITH')
          if (t === memId && !neighbors.has(s)) neighbors.set(s, e.relation_type || 'CO_OCCURS_WITH')
        }
        return {
          jsonrpc: '2.0', id,
          result: { memories: [...neighbors.entries()].map(([id, relation]) => ({ id, relation })) },
        }
      }

      // ── get_perception_graph_stats：因果图统计（无状态：用客户端发的边） ──
      case 'get_perception_graph_stats': {
        const { edges } = params
        if (!Array.isArray(edges)) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'edges[] required' } }
        }
        const byType = new Map<string, number>()
        const nodeSet = new Set<string>()
        for (const e of edges) {
          const s = e.source_id || e.sourceId
          const t = e.target_id || e.targetId
          if (s) nodeSet.add(s)
          if (t) nodeSet.add(t)
          const rel = e.relation_type || 'CO_OCCURS_WITH'
          byType.set(rel, (byType.get(rel) || 0) + 1)
        }
        return {
          jsonrpc: '2.0', id,
          result: {
            nodes: nodeSet.size,
            edges: edges.length,
            relationDistribution: [...byType.entries()]
              .map(([type, count]) => ({ type, count }))
              .sort((a, b) => b.count - a.count),
            source: 'server',
          },
        }
      }

      // ── 其他 MCP 协议方法交回 base
      default:
        return baseHandleRequest(req)
    }
  } catch (e: any) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }
  }
}

export { initServer }

// ── 内部工具函数 ──

function traceChain(edges: any[], seedId: string, direction: string, maxDepth: number): any[] {
  const fwdMap = new Map<string, { e: any; nid: string }[]>()
  const bwdMap = new Map<string, { e: any; nid: string }[]>()
  for (const edge of edges) {
    const src = edge.source_id || edge.sourceId
    const tgt = edge.target_id || edge.targetId
    if (!src || !tgt) continue
    if (!fwdMap.has(src)) fwdMap.set(src, [])
    fwdMap.get(src)!.push({ e: edge, nid: tgt })
    if (!bwdMap.has(tgt)) bwdMap.set(tgt, [])
    bwdMap.get(tgt)!.push({ e: edge, nid: src })
  }

  const adj = direction === 'backward' ? bwdMap : fwdMap
  return _createBFS(seedId, maxDepth, adj)
}

