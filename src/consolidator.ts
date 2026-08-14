// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * 记忆合并 — 本地保底版本
 * 去重：前 80 字分组，保留最高 salience
 * 衰减：固定线性衰减 salience / (days + 1)
 * 服务器增强版：Ebbinghaus 三因子 + 铁律升级阈值
 */

import { getDb } from './db.js'

// ── 去重 ──

interface DedupResult {
  merged: number
  skipped: number
}

/**
 * 按前 80 字分组去重。
 * 同组保留 salience 最高的那条，其余标记 hidden_at。
 */
export function deduplicateMemories(project?: string): DedupResult {
  const db = getDb()

  let rows: any[]
  if (project) {
    rows = db
      .prepare(
        `SELECT id, content, salience FROM memories
         WHERE visibility = 1 AND hidden_at IS NULL
         AND (tags LIKE ? OR project = ?)`,
      )
      .all(`%project:${project}%`, project)
  } else {
    rows = db
      .prepare(
        'SELECT id, content, salience FROM memories WHERE visibility = 1 AND hidden_at IS NULL',
      )
      .all()
  }

  // 按前 80 字分组（去除标点后）
  const groups = new Map<string, { id: string; content: string; salience: number }[]>()
  for (const r of rows) {
    const key = cleanContent(r.content).slice(0, 80)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  let merged = 0
  let skipped = 0
  const now = Date.now()

  const hideStmt = db.prepare(
    'UPDATE memories SET visibility = 0, hidden_at = ? WHERE id = ?',
  )

  for (const [_, group] of groups) {
    if (group.length <= 1) {
      skipped++
      continue
    }

    // 按 salience 降序，第一条保留
    group.sort((a, b) => b.salience - a.salience)
    const [keep, ...rest] = group

    for (const dup of rest) {
      hideStmt.run(now, dup.id)
      merged++
    }
  }

  return { merged, skipped }
}

// ── 辅助 ──

/** 去除标点、换行、多余空格，只保留中英文字符和数字 */
function cleanContent(text: string): string {
  return text
    .replace(/[\s\n\r]+/g, ' ')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
    .trim()
}

// ── 成长箱：跨实体重复 lesson/feedback 升级铁律 ──
// 对标 aifp-web escalateRepeatedLessons：同一教训在不同项目/实体反复出现 → 升级为"铁律"（salience=5 + 标签）。
// MCP 版无 tree_level/merge_count 字段，用 salience=5 + 'rule:iron' 标签标记铁律，merge_count 记在标签里。

export function escalateRepeatedLessons(all: any[]): { escalated: number; merged: number } {
  const db = getDb()
  const now = Date.now()
  let escalated = 0
  let merged = 0

  const lessons = all.filter((m: any) => (m.type === 'lesson' || m.type === 'feedback') && m.content)
  if (lessons.length < 2) return { escalated, merged }

  // 按内容前 80 字聚类（去标点）；已升格为铁律的记忆不参与聚类（避免重复升级）
  const clusters = new Map<string, any[]>()
  for (const m of lessons) {
    if (String(m.tags || '').includes('rule:iron')) continue
    const key = cleanContent(String(m.content || '')).slice(0, 80)
    if (!key || key.length < 5) continue
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key)!.push(m)
  }

  for (const [, group] of clusters) {
    // 跨实体判断：entities 去重后 ≥2 个不同实体，或同实体多条（重复教训）
    const entities = [...new Set(group.flatMap((m: any) => {
      try { return JSON.parse(m.entities || '[]') } catch { return [] }
    }))].filter(Boolean)
    // 单条新记忆 + 已有铁律 → 仍算重复出现（合并计数）；无铁律时需 ≥2 条才升级
    const hasEnough = entities.length >= 2 || group.length >= 2

    // 已有铁律 → 合并标签 + merge_count
    // LIKE 模式用内容里最长的连续汉字片段（原文含 * , 空格等特殊字符会匹配失败；
    // 正则 {3,} 取最长的连续汉字段，如"查大表会卡死"）
    const zhBlocks = String(group[0].content || '').match(/[一-鿿]{3,}/g) || []
    const zhFragment = zhBlocks.reduce((a, b) => b.length > a.length ? b : a, '')
    const likePattern = zhFragment ? `%${zhFragment}%` : `%${cleanContent(String(group[0].content || '')).slice(0, 20)}%`
    const existing = db.prepare(
      `SELECT id FROM memories WHERE type = 'lesson' AND salience >= 5 AND tags LIKE '%rule:iron%' AND content LIKE ? LIMIT 1`
    ).all(likePattern) as Record<string, unknown>[]

    if (!hasEnough && existing.length === 0) continue

    const allTags = [...new Set(group.flatMap((m: any) =>
      String(m.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean)
    ))].filter(t => t !== 'rule:iron')

    if (existing.length > 0) {
      const eid = String(existing[0].id || '')
      if (eid) {
        // merge_count 记在标签里（rule:merge:N）
        const curRow = db.prepare('SELECT tags FROM memories WHERE id = ?').get(eid) as Record<string, unknown> | undefined
        const curTags = String(curRow?.tags || '')
        const mergeMatch = curTags.match(/rule:merge:(\d+)/)
        const curMerges = mergeMatch ? parseInt(mergeMatch[1], 10) : 1
        const nextTags = [...allTags, 'rule:iron', `rule:merge:${curMerges + group.length}`].join(', ')
        db.prepare('UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?').run(nextTags, now, eid)
        merged++
      }
    } else {
      // 新建铁律：salience=5 + rule:iron 标签
      const id = crypto.randomUUID()
      const content = String(group[0].content || '')
      db.prepare(
        `INSERT INTO memories (id, type, content, salience, tags, created_at, updated_at, visibility, tier, importance)
         VALUES (?, 'lesson', ?, 5, ?, ?, ?, 1, 'internalized', 0.7)`
      ).run(id, content, [...allTags, 'rule:iron', `rule:merge:${group.length}`].join(', '), now, now)
      escalated++
    }

    // 原始重复记忆标 hidden：避免下次重复处理（铁律已代表它们）
    const groupIds = group.map(m => m.id).filter(Boolean)
    if (groupIds.length > 0) {
      const ph = groupIds.map(() => '?').join(',')
      db.prepare(`UPDATE memories SET visibility = 0, hidden_at = ? WHERE id IN (${ph})`).run(now, ...groupIds)
    }
  }

  return { escalated, merged }
}

// ── Top-N 原子经验 ──

// ── 统一整理周期入口 ──
// 服务器端定时调用：巩固 + 衰减 + 去重 + 成长箱 + 批量关联 一次跑完。
// 对标 aifp-web consolidateAll() 的职责拆分。

export interface ConsolidateCycleResult {
  promoted: number
  decayed: number
  deduped: number
  ironEscalated: number
  ironMerged: number
  batchLinked: number
}

/**
 * 跑一轮完整整理：
 * 1. tier 巩固（scratch→episodic→internalized→growth）
 * 2. 遗忘衰减（growth→…→hidden）
 * 3. 内容去重（前 80 字分组，保留高 salience）
 * 4. 成长箱（跨实体重复 lesson/feedback 升级铁律）
 * 5. 批量关联（同会话时间相邻记忆建 CO_OCCURS_WITH 链）
 */
export async function runConsolidateCycle(): Promise<ConsolidateCycleResult> {
  const result: ConsolidateCycleResult = {
    promoted: 0, decayed: 0, deduped: 0,
    ironEscalated: 0, ironMerged: 0, batchLinked: 0,
  }

  // 1+2. 巩固 + 衰减（本地 db.ts 提供）
  try {
    const { consolidateMemories, decayMemories } = await import('./db.js')
    const c = consolidateMemories()
    const d = decayMemories()
    result.promoted = c.promoted
    result.decayed = d.decayed
  } catch { /* 巩固/衰减失败不影响 */ }

  // 3. 去重
  try {
    result.deduped = deduplicateMemories().merged
  } catch { /* 去重失败不影响 */ }

  // 4. 成长箱（需要 embedding 的记忆，只取有 embedding 的前 500 条）
  try {
    const rows = getDb().prepare(
      `SELECT id, type, content, entities, tags FROM memories
       WHERE visibility = 1 AND embedding IS NOT NULL AND embedding != ''
       ORDER BY created_at DESC LIMIT 500`
    ).all() as Record<string, unknown>[]
    const growth = escalateRepeatedLessons(rows)
    result.ironEscalated = growth.escalated
    result.ironMerged = growth.merged
  } catch { /* 成长箱失败不影响 */ }

  // 5. 批量关联（同会话时间相邻记忆建链）
  try {
    const { batchLinkMemories } = await import('./batch-link.js')
    const link = batchLinkMemories(24)
    result.batchLinked = link.linked
  } catch { /* 批量关联失败不影响 */ }

  return result
}
