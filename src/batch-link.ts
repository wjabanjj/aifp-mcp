// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * 批量关联 — 同会话/同项目记忆自动建立因果关联
 * 在 consolidate 流程中被调用，创建 perception_links 表记录
 */
import { getDb } from './db.js'

interface LinkResult {
  linked: number
  total: number
  skipped: number
}

/**
 * 扫描同 session 同 project 的记忆，按时间顺序建立感知链接
 * 避免重复链接（已关联的跳过）
 */
export function batchLinkMemories(limitHours: number = 24): LinkResult {
  const db = getDb()
  const now = Date.now()
  const cutoff = now - limitHours * 3600 * 1000

  // 按 session + project 分组最近的记忆
  const rows = db.prepare(`
    SELECT id, session_id, project, created_at, type
    FROM memories
    WHERE created_at >= ? AND session_id IS NOT NULL AND session_id != ''
    ORDER BY session_id, project, created_at
  `).all(cutoff) as any[]

  let linked = 0
  let skipped = 0

  // 已有链接用于去重
  const existing = new Set(
    (db.prepare(`SELECT source_id || '->' || target_id AS key FROM perception_links`).all() as any[])
      .map(r => r.key)
  )

  // 按 (session, project) 分组，同组内顺序创建链接
  const groups = new Map<string, any[]>()
  for (const row of rows) {
    const key = `${row.session_id}::${row.project || ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  // stmt 复用
  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO perception_links (id, source_id, target_id, relation_type, confidence, created_at, updated_at)
    VALUES (?, ?, ?, 'CO_OCCURS_WITH', 0.5, ?, ?)
  `)

  for (const [_, mems] of groups) {
    if (mems.length < 2) { skipped += mems.length; continue }

    // 时间相邻的记忆建立关联
    for (let i = 0; i < mems.length - 1; i++) {
      const key = `${mems[i].id}->${mems[i + 1].id}`
      if (existing.has(key)) continue

      const linkId = crypto.randomUUID()
      insertLink.run(linkId, mems[i].id, mems[i + 1].id, now, now)
      existing.add(key) // 避免本轮重复
      linked++
    }
  }

  return { linked, total: rows.length, skipped }
}
