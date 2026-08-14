// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * Confidence Engine — 置信度跃迁 + 证据链
 *
 * 对标 aifp-web memory-confidence.ts 的移植版本。
 * 4 级置信度体系：[0.3, 0.5, 0.7, 0.9]
 *
 * 设计原则：
 * - 阈值驱动晋升（不调 LLM）
 * - 证据链 append-only 防篡改
 * - 跨项目检测自动标记
 * - 批量评估只升不降，矛盾由 evaluateConfidence 按需传入
 *
 * @module confidence
 */

import { getDb } from './db.js'

// ── 置信度常量 ──

export const CONFIDENCE_TIERS = [0.3, 0.5, 0.7, 0.9] as const
export type ConfidenceTier = 0.3 | 0.5 | 0.7 | 0.9

// ── 证据链类型 ──

export interface EvidenceEntry {
  source_id: string
  type: string
  summary: string
  project: string
  timestamp: number
}

// ── 核心函数 ──

/**
 * 计算下一级置信度（阈值驱动）
 * @param currentConfidence - 当前置信度
 * @param observationCount - 正向观察次数
 * @param recentContradictions - 近期矛盾次数
 * @returns 晋升后的置信度（不变则返回原值）
 */
export function computeNextTier(
  currentConfidence: number,
  observationCount: number,
  recentContradictions = 0,
): number {
  // 矛盾降档
  if (recentContradictions > 0) {
    // 3 次以上矛盾 → 直接降回 0.3
    if (recentContradictions >= 3) return 0.3
    const idx = CONFIDENCE_TIERS.indexOf(currentConfidence as ConfidenceTier)
    if (idx > 0) return CONFIDENCE_TIERS[idx - 1]
    return currentConfidence
  }

  // 晋升阈值
  if (observationCount >= 8 && currentConfidence < 0.9) return 0.9
  if (observationCount >= 5 && currentConfidence < 0.7) return 0.7
  if (observationCount >= 2 && currentConfidence < 0.5) return 0.5

  return currentConfidence
}

/**
 * 追加证据条目（按 source_id + type 去重）
 */
export function appendEvidence(existing: string, entry: EvidenceEntry): string {
  try {
    const arr: EvidenceEntry[] = JSON.parse(existing)
    if (!Array.isArray(arr)) throw new Error('not array')
    const dup = arr.find(e => e.source_id === entry.source_id && e.type === entry.type)
    if (dup) {
      dup.timestamp = entry.timestamp
      dup.summary = entry.summary
      return JSON.stringify(arr)
    }
    arr.push(entry)
    return JSON.stringify(arr)
  } catch {
    return JSON.stringify([entry])
  }
}

/**
 * 检测证据中的跨项目信号
 * @returns 不同的项目列表
 */
export function detectCrossProject(evidence: string): string[] {
  try {
    const arr: EvidenceEntry[] = JSON.parse(evidence)
    if (!Array.isArray(arr)) return []
    const projects = [...new Set(arr.map(e => e.project?.trim()).filter(Boolean))]
    return projects
  } catch {
    return []
  }
}

/**
 * 原子级置信度评估
 * 读取记忆的当前状态 → 计算晋升 → 写入新置信度 + 追加证据
 */
export function evaluateConfidence(
  memId: string,
  evidenceEntry?: EvidenceEntry,
  recentContradictions = 0,
): { promoted: boolean; from: number; to: number } {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, confidence, evidence, confidence_observation_count FROM memories WHERE id = ? AND visibility = 1'
  ).all(memId) as Record<string, unknown>[]
  if (!rows.length) return { promoted: false, from: 0, to: 0 }

  const row = rows[0]
  const currentConfidence = Number(row.confidence ?? 0.3)
  const existingEvidence = String((row as any).evidence || '[]')
  const obsCount = Number((row as any).confidence_observation_count ?? 0)

  // 追加证据
  let newEvidence = existingEvidence
  let evidenceIsNew = false
  if (evidenceEntry) {
    const beforeLen = existingEvidence === '[]' ? 0 : JSON.parse(existingEvidence).length
    newEvidence = appendEvidence(existingEvidence, evidenceEntry)
    const afterLen = newEvidence === '[]' ? 0 : JSON.parse(newEvidence).length
    evidenceIsNew = afterLen > beforeLen
  }

  // 矛盾数：仅使用参数传入的新矛盾（历史矛盾已在发生时处理）
  const contradictionCount = recentContradictions
  const obsDelta = evidenceIsNew ? 1 : 0

  // 计算新置信度
  const nextConfidence = computeNextTier(
    currentConfidence,
    obsCount + obsDelta,
    contradictionCount,
  )

  const promoted = nextConfidence !== currentConfidence
  const newObsCount = obsCount + obsDelta

  db.prepare(
    'UPDATE memories SET confidence = ?, evidence = ?, confidence_observation_count = ?, updated_at = ? WHERE id = ?'
  ).run(nextConfidence, newEvidence, newObsCount, Date.now(), memId)

  if (promoted) {
    console.log(`[置信度] ${memId.slice(0, 8)}… ${currentConfidence} → ${nextConfidence}`)
  }

  return { promoted, from: currentConfidence, to: nextConfidence }
}

// ── 批量评估（从 confidence-stats.ts 合并而来） ──

export interface BatchConfidenceResult {
  evaluated: number
  promoted: number
  demoted: number
  cross_project_promotions: number
}

/**
 * 批量评估所有可见记忆的置信度（只升不降，跨项目记忆直接提到 0.9）
 * 用于服务器端批量整理；客户端识别写入时走 evaluateConfidence 单条路径
 */
export function batchEvaluateConfidence(): BatchConfidenceResult {
  let evaluated = 0
  let promoted = 0
  let crossProject = 0

  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, confidence, evidence, confidence_observation_count
       FROM memories WHERE visibility = 1`
    ).all() as Record<string, unknown>[]

    for (const row of rows) {
      try {
        const id = String(row.id)
        const currentConfidence = Number(row.confidence ?? 0.3)
        const existingEvidence = String((row as any).evidence || '[]')
        const obsCount = Number((row as any).confidence_observation_count ?? 0)

        // 跨项目检测
        const projects = detectCrossProject(existingEvidence)
        const isCrossProject = projects.length >= 2
        if (isCrossProject && currentConfidence >= 0.7) {
          crossProject++
        }

        // 晋升（跨项目记忆直接提到 0.9；批量评估仅晋升，不自动降档）
        let effectiveObs = obsCount
        if (isCrossProject && currentConfidence >= 0.7) {
          effectiveObs = Math.max(effectiveObs, 8)
        }
        const newConfidence = computeNextTier(currentConfidence, effectiveObs, 0)

        if (newConfidence > currentConfidence) {
          db.prepare(
            'UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?'
          ).run(newConfidence, Date.now(), id)
          promoted++
        }

        evaluated++
      } catch { /* 单条跳过 */ }
    }
  } catch (e) {
    console.warn('[置信度] 批量评估失败:', (e as Error)?.message)
  }

  return { evaluated, promoted, demoted: 0, cross_project_promotions: crossProject }
}

/**
 * 置信度分布统计
 */
export function getConfidenceDistribution(): Record<string, number> {
  const dist: Record<string, number> = {}
  try {
    const db = getDb()
    for (const tier of CONFIDENCE_TIERS) {
      const rows = db.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE visibility = 1 AND confidence = ?'
      ).all(tier) as Record<string, unknown>[]
      dist[String(tier)] = Number(rows[0]?.c ?? 0)
    }
    // 其他值
    const other = db.prepare(
      'SELECT COUNT(*) as c FROM memories WHERE visibility = 1 AND confidence NOT IN (0.3, 0.5, 0.7, 0.9)'
    ).all() as Record<string, unknown>[]
    dist['other'] = Number(other[0]?.c ?? 0)
  } catch { /* 忽略 */ }
  return dist
}
