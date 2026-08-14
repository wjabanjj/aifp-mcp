// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 语义向量引擎
 * 使用 @xenova/transformers 的 bge-small-zh-v1.5 模型（中文优化）
 * 嵌入维度 512，归一化后用于余弦相似度计算
 * 搜索走 JS 全表扫描（O(n) 余弦相似度）
 */

interface CachedMemory {
  id: string
  type: string
  content: string
  embedding: number[]
  createdAt: number
  tags: string
  salience: number
  entities: string
}

class VectorEngine {
  private extractor: any = null
  private ready = false
  private initPromise: Promise<void> | null = null
  private _started = false
  private _failCount = 0
  private _maxRetries = 6
  /** embedding 缓存：文本 → { vector, time }，5 秒 TTL，防止同轮重复计算 */
  private _embedCache = new Map<string, { vector: number[]; time: number }>()
  private _embedTtl = 5000
  private _embedMaxSize = 200

  get initStarted(): boolean { return this._started }

  async init(): Promise<void> {
    if (this.ready) return
    if (this._failCount >= this._maxRetries) throw new Error('向量引擎已超过最大重试次数')
    if (this.initPromise) return this.initPromise
    this._started = true
    this.initPromise = this._doInit()
    return this.initPromise
  }

  private async _doInit(): Promise<void> {
    const maxAttempts = 3
    const mirrors = [
      process.env['HF_MIRROR'] || 'https://hf-mirror.com',
      'https://huggingface.co',
    ]

    let lastErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { pipeline, env } = await import('@xenova/transformers')
        env.remoteHost = attempt <= 2 ? mirrors[0] : mirrors[1]
        if (attempt > 1) console.warn(`[向量] 第 ${attempt} 次尝试 (${env.remoteHost})...`)
        this.extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
          quantized: true,
        })
        this.ready = true
        return
      } catch (e) {
        lastErr = e as Error
        if (attempt < maxAttempts) {
          const delay = attempt * 3000
          console.warn(`[向量] 加载失败 (${attempt}/${maxAttempts})，${delay}ms 后重试:`, (e as Error).message)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    // 全部尝试失败，允许后续重试
    this.initPromise = null
    this._failCount++
    console.warn(`[向量] 嵌入模型加载失败 (第${this._failCount}轮)，向量搜索降级:`, lastErr!.message)
    throw lastErr!
  }

  // ══════════════════════════════════════════════════════
  // 语义搜索（JS 余弦相似度）
  // ══════════════════════════════════════════════════════

  get isReady(): boolean { return this.ready }

  async embed(text: string): Promise<number[]> {
    const now = Date.now()
    const cached = this._embedCache.get(text)
    if (cached && now - cached.time < this._embedTtl) return cached.vector
    if (cached) this._embedCache.delete(text) // 过期淘汰

    if (!this.ready) await this.init()
    if (!this.extractor) throw new Error('嵌入模型不可用')
    const result = await this.extractor(text, { pooling: 'mean', normalize: true })
    if (!result || !result.data) throw new Error('嵌入结果为空')

    let vec: number[]
    const data = result.data
    if (Array.isArray(data)) {
      vec = data
    } else if (data && typeof data === 'object') {
      const inner = data.data ?? data
      if (Array.isArray(inner)) {
        vec = inner
      } else if (typeof inner === 'object' && inner !== null && typeof inner.length === 'number') {
        vec = Array.from(inner as ArrayLike<number>)
      } else if (typeof data.toArray === 'function') {
        vec = data.toArray()
      } else if (typeof data.tolist === 'function') {
        vec = data.tolist()
      } else if (typeof data.val === 'function') {
        vec = data.val()
      } else {
        throw new Error('无法读取嵌入结果')
      }
    } else {
      throw new Error('无法读取嵌入结果')
    }

    // 缓存管理：LRU 淘汰
    if (this._embedCache.size >= this._embedMaxSize) {
      const key = this._embedCache.keys().next().value
      if (key) this._embedCache.delete(key)
    }
    this._embedCache.set(text, { vector: vec, time: Date.now() })
    return vec
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
  }

  /** 语义搜索：余弦相似度排序，支持时间分片 */
  async search(
    query: string,
    memories: CachedMemory[],
    topK = 10,
    minScore = parseFloat(process.env['VEC_MIN_SCORE'] ?? '0.40'),
    preVec?: number[],
    entityFilter?: string,
    maxAgeDays?: number,
  ): Promise<{ id: string; content: string; score: number }[]> {
    if (!memories.length) return []

    let candidates = memories
    if (entityFilter) {
      candidates = memories.filter(m => {
        if (!m.entities) return false
        try {
          const entities = JSON.parse(m.entities) as string[]
          return Array.isArray(entities) && entities.includes(entityFilter)
        } catch { return false }
      })
    }

    const now = Date.now()
    const windows = maxAgeDays
      ? [{ cutoff: now - maxAgeDays * 86400000 }]
      : [
          { cutoff: now - 14 * 86400000 },
          { cutoff: now - 90 * 86400000 },
          { cutoff: 0 },
        ]

    const queryVec = preVec ?? await this.embed(query)
    const seenIds = new Set<string>()
    const allResults: { id: string; content: string; score: number }[] = []

    for (const w of windows) {
      const windowed = w.cutoff > 0
        ? candidates.filter(m => m.createdAt >= w.cutoff && !seenIds.has(m.id))
        : candidates.filter(m => !seenIds.has(m.id))
      if (!windowed.length) continue

      const results = this._scoreAndRank(windowed, queryVec, minScore, topK)
      for (const r of results) { seenIds.add(r.id); allResults.push(r) }
      if (allResults.length >= topK) {
        return allResults.sort((a, b) => b.score - a.score).slice(0, topK)
      }
    }

    return allResults
  }

  /** 后台修复缺失 embedding 的记忆，使向量搜索能覆盖新写入的记忆 */
  async repairMissingEmbeddings(batchSize = 10): Promise<number> {
    const { getDb } = await import('./db.js')
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, content FROM memories WHERE (embedding IS NULL OR embedding = '') AND content != '' LIMIT ?`,
    ).all(batchSize) as Record<string, unknown>[]
    if (!rows.length) return 0

    let repaired = 0
    for (const r of rows) {
      try {
        const vec = await this.embed(r.content as string)
        db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), String(r.id))
        repaired++
      } catch { /* 单条失败跳过 */ }
    }
    if (repaired > 0) this._embedCache.clear()
    return repaired
  }

  /** 扫描所有缺失 embedding 的记忆并全量修复 */
  async repairAllEmbeddings(): Promise<number> {
    const { getDb } = await import('./db.js')
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, content FROM memories WHERE (embedding IS NULL OR embedding = '') AND content != ''`,
    ).all() as Record<string, unknown>[]
    if (!rows.length) return 0

    let repaired = 0
    for (const r of rows) {
      try {
        const vec = await this.embed(r.content as string)
        db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), String(r.id))
        repaired++
        if (repaired % 5 === 0) await new Promise(r => setTimeout(r, 0)) // 不阻塞事件循环
      } catch { /* 单条失败跳过 */ }
    }
    if (repaired > 0) this._embedCache.clear()
    return repaired
  }

  private _scoreAndRank(
    memories: CachedMemory[],
    queryVec: number[],
    minScore: number,
    topK: number,
  ): { id: string; content: string; score: number }[] {
    return memories
      .filter(m => m.embedding && Array.isArray(m.embedding) && m.embedding.length > 0)
      .map(m => ({
        id: m.id,
        content: m.content,
        score: this.cosineSimilarity(queryVec, m.embedding),
      }))
      .filter(m => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

export const vectorEngine = new VectorEngine()
