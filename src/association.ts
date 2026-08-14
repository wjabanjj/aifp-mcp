// @deploy server — 服务端模块，服务端模块，不随 npm 包发布
/**
 * Hebbian 记忆关联（共现增强）
 * "Cells that fire together, wire together"
 *
 * 本地保底：简易共现计数（非对称概率转移属于增值算法，在服务器）
 * remote 模式：委托 core-server
 */
import { getDb } from './db.js'

const coRetrievalMap = new Map<string, Map<string, Map<string, number>>>()
let _assocReady = false

const ASSOCIATION_THRESHOLD = 0.25

// ── 本地保底算法（core 降级 — 简单共现计数，无概率转移） ──

function strengthenPairs(
  userMap: Map<string, Map<string, number>>,
  memoryIds: string[],
): void {
  for (let i = 0; i < memoryIds.length; i++) {
    for (let j = i + 1; j < memoryIds.length; j++) {
      const a = memoryIds[i], b = memoryIds[j]
      if (!userMap.has(a)) userMap.set(a, new Map())
      if (!userMap.has(b)) userMap.set(b, new Map())
      const aMap = userMap.get(a)!
      const bMap = userMap.get(b)!
      aMap.set(b, (aMap.get(b) || 0) + 1)
      bMap.set(a, (bMap.get(a) || 0) + 1)
    }
  }
}

function getAssociatedIds(
  userMap: Map<string, Map<string, number>>,
  memoryId: string,
  threshold: number,
): string[] {
  const assocMap = userMap.get(memoryId)
  if (!assocMap) return []
  const result: string[] = []
  for (const [id, strength] of assocMap) {
    if (strength >= threshold) result.push(id)
  }
  return result
}

// ── DB 持久化 ──

export function initMemoryAssociations(): void {
  if (_assocReady) return
  try {
    const db = getDb()
    const rows = db.prepare('SELECT user_id, mem_a, mem_b, strength FROM memory_associations').all() as Record<string, unknown>[]
    if (!rows.length) { _assocReady = true; return }
    for (const r of rows) {
      const userId = r.user_id as string
      const memA = r.mem_a as string
      const memB = r.mem_b as string
      const strength = r.strength as number
      if (!coRetrievalMap.has(userId)) coRetrievalMap.set(userId, new Map())
      const userMap = coRetrievalMap.get(userId)!
      if (!userMap.has(memA)) userMap.set(memA, new Map())
      userMap.get(memA)!.set(memB, strength)
      if (!userMap.has(memB)) userMap.set(memB, new Map())
      userMap.get(memB)!.set(memA, strength)
    }
  } catch { /* 表可能不存在 */ }
  _assocReady = true
}

function saveCoRetrievalMap(): void {
  try {
    if (!_assocReady) return
    const db = getDb()
    const rows: { userId: string; memA: string; memB: string; strength: number }[] = []
    for (const [userId, userMap] of coRetrievalMap) {
      for (const [memA, assocMap] of userMap) {
        for (const [memB, str] of assocMap) {
          if (memA < memB && str >= ASSOCIATION_THRESHOLD) {
            rows.push({ userId, memA, memB, strength: +str.toFixed(3) })
          }
        }
      }
    }
    if (rows.length === 0) return
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM memory_associations').run()
      const stmt = db.prepare('INSERT OR REPLACE INTO memory_associations (user_id, mem_a, mem_b, strength) VALUES (?, ?, ?, ?)')
      for (const r of rows) {
        stmt.run(r.userId, r.memA, r.memB, r.strength)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } catch (e) { console.error('[关联] 持久化失败:', (e as Error)?.message) }
}

export function strengthenAssociations(userId: string, memoryIds: string[]): void {
  if (memoryIds.length < 2) return
  if (!coRetrievalMap.has(userId)) coRetrievalMap.set(userId, new Map())
  strengthenPairs(coRetrievalMap.get(userId)!, memoryIds)
  saveCoRetrievalMap()
}

export function getAssociatedMemoryIds(memoryId: string, userId = 'default', threshold = ASSOCIATION_THRESHOLD): string[] {
  const userMap = coRetrievalMap.get(userId)
  if (!userMap) return []
  return getAssociatedIds(userMap, memoryId, threshold)
}

export function enrichWithAssociations(
  userId: string,
  directResults: { id: string; content: string; salience?: number }[],
  maxExtra = 5,
): { id: string; content: string; salience?: number }[] {
  if (directResults.length < 2 || !userId) return directResults

  const directIds = directResults.map(m => m.id)
  strengthenAssociations(userId, directIds)

  const resultIdSet = new Set(directIds)
  const extra: { id: string; content: string; salience?: number }[] = []
  const db = getDb()

  for (const m of directResults) {
    const assocIds = getAssociatedMemoryIds(m.id, userId)
    for (const aid of assocIds) {
      if (resultIdSet.has(aid)) continue
      resultIdSet.add(aid)
      const rows = db.prepare('SELECT id, content, salience FROM memories WHERE id = ? AND visibility = 1').all(aid) as Record<string, unknown>[]
      if (rows.length) {
        extra.push({ id: String(rows[0].id), content: String(rows[0].content || ''), salience: Number(rows[0].salience || 3) })
      }
    }
  }

  extra.sort((a, b) => (b.salience || 0) - (a.salience || 0))
  return [...directResults, ...extra.slice(0, maxExtra)]
}
