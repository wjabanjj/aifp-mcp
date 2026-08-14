// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 双路记忆检索 — 关键词搜索 + 向量语义兜底 + 多源融合
 * 移植自 aifp-web memory-retrieval.ts
 *
 * 重活（DB/向量）在这里。
 * 排序/融合逻辑：本地保底简易版，remote 模式委托服务器。
 */

import {
  searchMemories, searchMemoriesByKeywords,
  getMemoriesByEntity, getMemoriesByDateRange,
  getAllVisibleMemories, getDb, type MemoryRow,
} from './db.js'
import { vectorEngine } from './vector.js'
import { extractKeywords } from './keywords.js'
import { parseTemporalHints, stripTemporalWords } from './temporal.js'
import { fixTypo } from './typo.js'
import { disambiguateKeywords } from './disambiguate.js'
import { config } from './config.js'

// ── 本地保底算法（core 降级 —— 纯公开公式，不开源价值） ──

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, dot / denom))
}

/** 噪声惩罚：低 salience 记忆降权 */
function noisePenalty(
  score: number,
  salience: number,
  confidence: number,
): number {
  // 高置信度记忆豁免噪声惩罚
  if (confidence >= 0.7) return score
  if (salience >= 4) return score
  const penalty = Math.min(0.15, (4 - Math.min(salience || 3, 4)) * 0.05)
  return Math.max(0.01, score - penalty)
}

/** 置信度增益系数：0.3→0, 0.5→0.2, 0.7→0.4, 0.9→0.6 */
function confidenceBoost(confidence: number): number {
  return Math.max(0, Math.min(1, (confidence - 0.3) / 0.6 * 0.6))
}

function computeFusionScores(inputs: { id: string; vectorScore?: number; salience: number; hasFtsMatch: boolean; confidence: number }[]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const item of inputs) {
    let score = (item.salience || 3) / 5
    if (item.vectorScore !== undefined) score = item.vectorScore * 0.6 + (item.salience / 5) * 0.4
    if (item.hasFtsMatch) score = Math.min(score * 1.12, 0.999)
    // 置信度增益：高置信度记忆在排序中占优
    const cb = confidenceBoost(item.confidence)
    if (cb > 0) score = score * 0.85 + cb * 0.15
    score = noisePenalty(score, item.salience, item.confidence)
    scores[item.id] = +(+score).toFixed(4)
  }
  return scores
}

function rankByScores<T extends { id: string }>(items: T[], scores: Record<string, number>): T[] {
  return [...items].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
}

function selectContextMemories<T>(ranked: T[], options: { cap: number }): T[] {
  return ranked.slice(0, options.cap)
}

// ── 查询信号解析 ──

export interface QuerySignals {
  temporalHints: ReturnType<typeof parseTemporalHints>
  cleanText: string
  entityRefs: string[]
}

function parseQuerySignals(text: string): QuerySignals {
  const temporalHints = parseTemporalHints(text)
  const cleanText = temporalHints.length > 0 ? stripTemporalWords(text) : text
  const entityRefs: string[] = []
  const atMentions = text.match(/@(\w+)/g)
  if (atMentions) entityRefs.push(...atMentions.map(m => m.slice(1)))
  return { temporalHints, cleanText, entityRefs }
}

// ── 完整检索流程 ──

export interface RetrievalResult {
  memories: MemoryRow[]
  vectorResults: { id: string; content: string; score: number }[]
  scores: Record<string, number>
  latencyMs: number
  source: 'fts' | 'vector' | 'mixed'
  /** 检索路径分解 — 每条记忆来自哪些路径 */
  explain?: { id: string; content: string; score: number; paths: string[]; vectorScore?: number; salience: number; hasFtsMatch: boolean }[]
}

export async function retrieve(query: string, options: {
  limit?: number
  types?: string[]
  includeHidden?: boolean
  useVector?: boolean
  entityFilter?: string
  agentId?: string
  scope?: 'all' | 'personal' | 'shared'
  /** @internal 递归重试深度（防止无限递归） */
  _retryDepth?: number
} = {}): Promise<RetrievalResult> {
  const start = Date.now()
  const limit = options.limit || 20

  // 1. 纠错 + 解析信号
  const corrected = fixTypo(query)
  const signals = parseQuerySignals(corrected)
  const searchTerm = signals.cleanText || corrected

  // 2. 关键词提取 + 多关键词搜索 + 消歧
  const keywords = extractKeywords(searchTerm, 10)
  const extraEntityTags = disambiguateKeywords(keywords, searchTerm)
  const kwMemories = keywords.length > 0 ? searchMemoriesByKeywords(keywords, 3) : []

  // 3. FTS5 搜索
  const ftsMemories = searchMemories(searchTerm, {
    limit: limit * 2,
    types: options.types,
    includeHidden: options.includeHidden,
  })

  // 4. 实体补充（含消歧结果）
  const entityRefs = [
    ...(options.entityFilter ? [options.entityFilter] : []),
    ...signals.entityRefs,
    ...extraEntityTags,
  ]
  let entityMemories: MemoryRow[] = []
  for (const ref of [...new Set(entityRefs)]) {
    const hits = getMemoriesByEntity(ref, limit)
    entityMemories.push(...hits)
  }

  // 5. 时间窗口
  let temporalMemories: MemoryRow[] = []
  if (signals.temporalHints.length > 0) {
    for (const hint of signals.temporalHints) {
      const hits = getMemoriesByDateRange(new Date(hint.from).getTime(), new Date(hint.to).getTime(), limit)
      temporalMemories.push(...hits)
    }
  }

  // 6. 去重合并（含关键词搜索结果）
  // 时间词结果单独收集，不参与 focusLimit 竞争（预防"昨天说了什么"被关键词挤掉）
  const seen = new Set<string>()
  const temporalIds = new Set<string>()
  let combined: MemoryRow[] = []
  for (const list of [kwMemories, ftsMemories, entityMemories, temporalMemories]) {
    for (const m of list) {
      if (!seen.has(m.id)) { seen.add(m.id); combined.push(m) }
    }
  }
  for (const m of temporalMemories) temporalIds.add(m.id)

  // 6a. 多 Agent 过滤
  if (options.scope && options.scope !== 'all') {
    combined = combined.filter(m => {
      if (options.scope === 'personal') return !options.agentId || m.agent_id === options.agentId || !m.agent_id
      if (options.scope === 'shared') return m.cross_agent_share === 1
      return true
    })
  }

  const ftsMatchIds = new Set(combined.map(m => m.id))

  // 7. 向量语义搜索
  let vectorResults: { id: string; content: string; score: number }[] = []

  const useVector = options.useVector !== false && vectorEngine.isReady

  let _allVisibleEmbeds: { id: string; content: string; embedding: number[]; createdAt: number; entities: string }[] | null = null

  if (useVector) {
    try {
      const repaired = await vectorEngine.repairMissingEmbeddings(20)
    } catch {}

    _allVisibleEmbeds = getAllVisibleMemories()
    const allMemories = _allVisibleEmbeds.map(m => ({
      id: m.id, type: '', content: m.content,
      embedding: m.embedding, createdAt: m.createdAt,
      tags: '', salience: 0, entities: m.entities,
    }))
    vectorResults = await vectorEngine.search(searchTerm, allMemories, limit)
  }

  // 8. 融合 FTS5 + 向量结果（去重填充字段）
  const vectorScoreMap = new Map(vectorResults.map(r => [r.id, r.score]))
  const allFinal = [...combined]

  const vectorOnlyIds = vectorResults.filter(vr => !seen.has(vr.id)).map(vr => vr.id)
  if (vectorOnlyIds.length > 0) {
    const ph = vectorOnlyIds.map(() => '?').join(',')
    try {
      const extraRows = getDb().prepare(
        `SELECT id, type, content, title, tags, salience, detail, entities, tier, importance FROM memories WHERE id IN (${ph})`,
      ).all(...vectorOnlyIds) as Record<string, unknown>[]
      const extraMap = new Map(extraRows.map(r => [String(r.id), r]))
      for (const vr of vectorResults) {
        if (seen.has(vr.id)) continue
        seen.add(vr.id)
        const full = extraMap.get(vr.id)
        allFinal.push(full ? {
          id: String(full.id), type: String(full.type || ''),
          content: String(full.content || ''),
          detail: String(full.detail || ''), title: String(full.title || ''),
          mem_id: null, entities: String(full.entities || '[]'), tags: String(full.tags || ''),
          salience: Number(full.salience ?? 3), visibility: 1, embedding: '',
          usage_count: 0, session_id: '', parent_id: null, node_type: null,
          tier: full.tier ? String(full.tier) : null,
          importance: Number(full.importance ?? 0.3), created_at: 0, updated_at: 0,
          contradicts: '', confidence: 0.3, valid_until: null, agent_id: '', cross_agent_share: 0, evidence: '[]', confidence_observation_count: 0,
        } : {
          id: vr.id, type: '', content: vr.content,
          detail: '', title: '', mem_id: null, entities: '[]', tags: '',
          salience: 3, visibility: 1, embedding: '', usage_count: 0,
          session_id: '', parent_id: null, node_type: null, tier: null,
          importance: 0.3, created_at: 0, updated_at: 0,
          contradicts: '', confidence: 0.3, valid_until: null, agent_id: '', cross_agent_share: 0, evidence: '[]', confidence_observation_count: 0,
        })
      }
    } catch {
      for (const vr of vectorResults) {
        if (!seen.has(vr.id)) {
          seen.add(vr.id)
          allFinal.push({
            id: vr.id, type: '', content: vr.content,
            detail: '', title: '', mem_id: null, entities: '[]', tags: '',
            salience: 3, visibility: 1, embedding: '', usage_count: 0,
            session_id: '', parent_id: null, node_type: null, tier: null,
            importance: 0.3, created_at: 0, updated_at: 0,
          contradicts: '', confidence: 0.3, valid_until: null, agent_id: '', cross_agent_share: 0, evidence: '[]', confidence_observation_count: 0,
          })
        }
      }
    }
  }

  // 重新过滤 allFinal（向量补充的记忆可能绕过 scope）
  if (options.scope && options.scope !== 'all') {
    const filtered: typeof allFinal = []
    for (const m of allFinal) {
      if (options.scope === 'personal') {
        if (!options.agentId || m.agent_id === options.agentId || !m.agent_id) filtered.push(m)
      } else if (options.scope === 'shared') {
        if (m.cross_agent_share === 1) filtered.push(m)
      } else {
        filtered.push(m)
      }
    }
    allFinal.length = 0
    allFinal.push(...filtered)
  }

  // types 过滤（所有来源合并后的最终过滤）
  if (options.types?.length) {
    const typeSet = new Set(options.types)
    const filtered2: typeof allFinal = []
    for (const m of allFinal) { if (typeSet.has(m.type)) filtered2.push(m) }
    allFinal.length = 0
    allFinal.push(...filtered2)
  }

  // 9. 分数融合 + 排序
  // remote 模式：发 ID+分数到服务器做增强融合
  // local 模式（默认）：本地简易保底排序
  const scores: Record<string, number> = {}
  const scoreInputs = allFinal.map(m => ({
    id: m.id,
    vectorScore: vectorScoreMap.get(m.id),
    salience: m.salience,
    hasFtsMatch: ftsMatchIds.has(m.id),
    confidence: m.confidence ?? 0.3,
  }))

  if (config.mode === 'remote') {
    // ── remote 模式：服务器做增强融合 ──
    try {
      const { remoteClient } = await import('./remote-client.js')
      const remoteScores = await remoteClient.fusion(scoreInputs)
      Object.assign(scores, remoteScores.scores)
    } catch (e) {
      console.warn('[检索] core-server 不可用，降级到本地融合:', (e as Error)?.message)
      const localScores = computeFusionScores(scoreInputs)
      Object.assign(scores, localScores)
    }
  } else {
    // ── local 模式：简易保底融合 ──
    let queryVec: number[] | undefined
    if (vectorEngine.isReady) {
      try { queryVec = await vectorEngine.embed(searchTerm || corrected) } catch {}
    }

    if (queryVec) {
      const embList = _allVisibleEmbeds ?? getAllVisibleMemories()
      const embMap = new Map(embList.map(m => [m.id, m.embedding]))
      const baseScores = computeFusionScores(scoreInputs)

      for (const m of allFinal) {
        let score = baseScores[m.id]
        if (vectorScoreMap.get(m.id) === undefined) {
          const emb = embMap.get(m.id)
          if (emb && emb.length > 0) {
            score = cosineSimilarity(queryVec, emb)
          } else {
            score = (m.salience || 3) / 5
          }
          if (ftsMatchIds.has(m.id)) score = Math.min(score * 1.12, 0.999)
        }
        scores[m.id] = +(+score).toFixed(4)
      }
    } else {
      // 向量不可用：salience + confidence 降序
      for (const m of allFinal) {
        let s = (m.salience || 3) / 5
        const cb = confidenceBoost(m.confidence ?? 0.3)
        if (cb > 0) s = s * 0.85 + cb * 0.15
        scores[m.id] = s
      }
    }
  }

  // 按分数降序排列 + 记忆选择器
  let ranked = rankByScores(allFinal, scores)
  let result = selectContextMemories(ranked, { cap: limit })

  // 时间词命中的记忆优先保留：被截断时少量追加（不参与 focusLimit 竞争）
  if (temporalIds.size > 0) {
    const missingTemporal = ranked.filter(m => temporalIds.has(m.id) && !result.some(r => r.id === m.id))
    if (missingTemporal.length > 0) {
      result = [...result, ...missingTemporal.slice(0, 3)]
    }
  }

  // Cross-Encoder 重排序
  try {
    const { rerank } = await import('./reranker.js')
    result = await rerank(searchTerm || corrected, result, limit)
  } catch { /* 重排序不可用则保持原序 */ }

  // 噪声惩罚：注入多次但从未被落地引用 → 移末尾；被用户纠正 ≥2 次（主动误导）→ 移末尾（更强）
  // 在重排序之后执行，避免 rerank 把噪声记忆重新提上来。
  // 计数不从对象字段读：向量补充的裸对象不带这些字段，从 DB 直读
  try {
    const ids = result.map(m => m.id).filter(Boolean)
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',')
      const rows = getDb().prepare(
        `SELECT id, injection_count, grounded_count, correction_hits FROM memories WHERE id IN (${ph})`,
      ).all(...ids) as Record<string, unknown>[]
      const noiseMap = new Map(rows.map(r => [String(r.id), r]))
      const noiseIds = result
        .filter(m => {
          const r = noiseMap.get(m.id)
          if (!r) return false
          const inj = Number(r.injection_count ?? 0)
          const grounded = Number(r.grounded_count ?? 0)
          const corr = Number(r.correction_hits ?? 0)
          return (inj > 3 && grounded === 0) || corr >= 2
        })
        .slice(0, 3)
        .map(m => m.id)
      if (noiseIds.length > 0) {
        const noiseSet = new Set(noiseIds)
        const clean = result.filter(m => !noiseSet.has(m.id))
        const noise = result.filter(m => noiseSet.has(m.id))
        result = [...clean, ...noise]
      }
    }
  } catch { /* 噪声惩罚失败不影响主流程 */ }

  // 充分性验证：结果稀疏且查询有实质内容 → 放宽参数重搜一次
  if ((options._retryDepth ?? 0) < 1 && result.length < 3 && query.trim().length >= 4 && !options.entityFilter) {
    return retrieve(query, {
      ...options,
      limit: Math.round(limit * 1.5),
      _retryDepth: (options._retryDepth ?? 0) + 1,
    })
  }

  // 追踪命中的记忆使用次数 + 注入次数，用于后续巩固和噪声惩罚
  try {
    const db = getDb()
    const now = Date.now()
    for (const m of result) {
      db.prepare(
        'UPDATE memories SET usage_count = usage_count + 1, injection_count = injection_count + 1, updated_at = ? WHERE id = ?'
      ).run(now, m.id)
    }
  } catch { /* 不影响检索结果 */ }

  // 检索路径分解（explain）
  const explain = result.map(m => {
    const paths: string[] = []
    if (ftsMatchIds.has(m.id)) paths.push('fts')
    if (kwMemories.some(k => k.id === m.id)) paths.push('keyword')
    if (entityMemories.some(e => e.id === m.id)) paths.push('entity')
    if (temporalMemories.some(t => t.id === m.id)) paths.push('temporal')
    if (vectorScoreMap.has(m.id)) paths.push('vector')
    if (!paths.length) paths.push('salience')
    return {
      id: m.id, content: m.content.slice(0, 120),
      score: scores[m.id] ?? 0,
      paths,
      vectorScore: vectorScoreMap.get(m.id),
      salience: m.salience,
      hasFtsMatch: ftsMatchIds.has(m.id),
    }
  })

  return {
    memories: result,
    vectorResults,
    scores,
    latencyMs: Date.now() - start,
    source: vectorResults.length > 0 ? 'mixed' : 'fts',
    explain,
  }
}
