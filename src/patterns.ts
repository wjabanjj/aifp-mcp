// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 记忆模式扫描器 — 按类型/标签聚类分析记忆库
 */
import { getDb } from './db.js'

interface PatternGroup {
  label: string
  type: string
  count: number
  items: string[]
}

interface ScanResult {
  patterns: PatternGroup[]
  total: number
  timeRange: { from: number; to: number }
  typeDistribution: Record<string, number>
  tierDistribution: Record<string, number>
}

/**
 * 扫描最近 N 小时的记忆，按类型/标签聚类
 */
export function scanMemoryPatterns(hours: number, minCount: number = 3): ScanResult {
  const db = getDb()
  const now = Date.now()
  const cutoff = now - hours * 3600 * 1000

  const rows = db.prepare(`
    SELECT id, type, content, tags, tier, created_at
    FROM memories
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `).all(cutoff) as any[]

  const total = rows.length
  const typeDist: Record<string, number> = {}
  const tierDist: Record<string, number> = {}
  const tagMap: Record<string, { type: string; items: string[] }> = {}

  for (const row of rows) {
    // 类型分布
    typeDist[row.type] = (typeDist[row.type] || 0) + 1

    // 层级分布
    const tier = row.tier ?? 'base'
    tierDist[tier] = (tierDist[tier] || 0) + 1

    // 按标签聚类
    let tags: string[] = []
    try { tags = JSON.parse(row.tags || '[]') } catch { tags = [] }
    for (const tag of tags) {
      if (!tagMap[tag]) tagMap[tag] = { type: 'tag', items: [] }
      if (tagMap[tag].items.length < 5) tagMap[tag].items.push(row.content?.slice(0, 60) || '')
    }

    // 也按类型聚类
    if (!tagMap[`type:${row.type}`]) tagMap[`type:${row.type}`] = { type: 'type', items: [] }
    if (tagMap[`type:${row.type}`].items.length < 5) tagMap[`type:${row.type}`].items.push(row.content?.slice(0, 60) || '')
  }

  const patterns: PatternGroup[] = Object.entries(tagMap)
    .filter(([_, v]) => v.items.length >= minCount)
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .slice(0, 20)
    .map(([label, v]) => ({
      label,
      type: v.type,
      count: v.items.length,
      items: v.items,
    }))

  const from = rows.length > 0 ? Math.min(...rows.map(r => r.created_at)) : cutoff
  const to = rows.length > 0 ? Math.max(...rows.map(r => r.created_at)) : now

  return {
    patterns,
    total,
    timeRange: { from, to },
    typeDistribution: typeDist,
    tierDistribution: tierDist,
  }
}

/**
 * 将模式分析结果格式化为可读摘要
 */
export function formatPatternsForPrompt(result: ScanResult): string {
  const lines: string[] = []
  lines.push(`📊 记忆库概览（最近 ${result.patterns.length > 0 ? '有' : '无'} 聚类）`)
  lines.push(`总记忆数: ${result.total}`)
  lines.push(`类型分布: ${Object.entries(result.typeDistribution).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (Object.keys(result.tierDistribution).length > 0) {
    lines.push(`层级分布: ${Object.entries(result.tierDistribution).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
  if (result.patterns.length > 0) {
    lines.push(`\n聚类模式 (>=${result.patterns[0]?.count || 0}条):`)
    for (const p of result.patterns.slice(0, 10)) {
      const samples = p.items.map(s => `"${s}…"`).join(', ')
      lines.push(`  · ${p.label}: ${p.count}条 [${samples}]`)
    }
  }
  return lines.join('\n')
}
