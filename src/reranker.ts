// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * Cross-Encoder 重排序 — 懒加载，降级安全
 *
 * 使用 ms-marco-MiniLM-L-6-v2（~80MB），
 * 对检索结果做 query-doc pairwise 相关性重排序。
 * 精度提升 +30~50%，代价是 ~50ms/条（CPU）。
 *
 * 设计要点：
 * - 懒加载（init-first-call），不阻塞启动
 * - 大结果集时只 rerank top-K（默认 20），避免过重
 * - 降级：模型不可用时原序返回
 */

import type { MemoryRow } from './db.js'

let _pipeline: any = null
let _ready = false
let _initPromise: Promise<void> | null = null

async function loadModel(): Promise<void> {
  if (_ready) return
  if (_initPromise) return _initPromise
  _initPromise = _doLoad()
  return _initPromise
}

async function _doLoad(): Promise<void> {
  const mirrors = [
    process.env['HF_MIRROR'] || 'https://hf-mirror.com',
    'https://huggingface.co',
  ]
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { pipeline, env } = await import('@xenova/transformers')
      env.remoteHost = mirrors[Math.min(attempt, mirrors.length - 1)]
      _pipeline = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', {
        quantized: true,
      })
      _ready = true
      return
    } catch (e) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }
  }
  console.warn('[重排序] Cross-Encoder 模型加载失败，跳过重排序')
}

/**
 * 对检索结果做 Cross-Encoder 重排序
 * @param query 原始查询
 * @param memories 候选记忆列表
 * @param topK 返回 topK
 * @returns 重排序后的记忆列表（与输入相同对象引用）
 */
export async function rerank<T extends MemoryRow>(
  query: string,
  memories: T[],
  topK: number,
): Promise<T[]> {
  if (!memories.length || !query) return memories

  try {
    await loadModel()
  } catch {
    return memories
  }

  if (!_ready) return memories

  const candidates = memories.slice(0, 20) // 只 rerank 前 20
  const remaining = memories.slice(20)

  try {
    // transformers.js 的 text-classification 只接受字符串输入，
    // 用 [SEP] 拼接 query 与文档（ms-marco 的 cross-encoder 训练格式）
    const pairs = candidates.map(m => `${query}[SEP]${m.content.slice(0, 512)}`)
    const scores = await _pipeline(pairs, { topk: 1 })

    const scored: { mem: T; score: number }[] = []
    for (let i = 0; i < candidates.length; i++) {
      const s = scores[i]
      const score = s?.[0]?.score ?? 0
      scored.push({ mem: candidates[i], score })
    }

    scored.sort((a, b) => b.score - a.score)

    // 重排序后的 topK + 未参与 rerank 的按原序拼接
    return [...scored.map(s => s.mem), ...remaining].slice(0, topK)
  } catch (e) {
    console.warn('[重排序] 执行失败，使用原序:', (e as Error)?.message)
    return memories
  }
}
