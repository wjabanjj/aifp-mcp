// @deploy npm — 记忆导出为 Markdown（Obsidian vault 兼容）
/**
 * 把记忆库导出为 .md 笔记，写入指定目录（如 Obsidian vault），
 * 带 frontmatter（type/tier/tags）供 Obsidian 识别与检索。
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from './db.js'

export interface ExportMdOptions {
  directory: string
  type?: string
  tier?: string
  limit?: number
}

export interface ExportMdResult {
  written: number
  directory: string
  sample: string[]
}

/** 导出记忆为 md 笔记（同名覆盖更新，保证与记忆库同步） */
export function exportMemoriesAsMd(opts: ExportMdOptions): ExportMdResult {
  const db = getDb()
  const where = ['visibility = 1', 'hidden_at IS NULL']
  const params: (string | number)[] = []
  if (opts.type) { where.push('type = ?'); params.push(opts.type) }
  if (opts.tier) { where.push('tier = ?'); params.push(opts.tier) }
  const limit = Math.min(Math.max(opts.limit || 200, 1), 1000)
  const rows = db.prepare(
    `SELECT id, type, content, title, detail, tags, tier, salience, created_at
     FROM memories WHERE ${where.join(' AND ')}
     ORDER BY salience DESC, updated_at DESC LIMIT ?`
  ).all(...params, limit) as {
    id: string; type: string; content: string; title: string; detail: string | null
    tags: string; tier: string; salience: number; created_at: number
  }[]

  mkdirSync(opts.directory, { recursive: true })
  const sample: string[] = []
  for (const r of rows) {
    const title = (r.title || '').trim() || r.content.slice(0, 30)
    const safeTitle = title
      .replace(/[\\/:*?"<>|#^[\]]/g, '_')              // 文件名非法字符
      .replace(/[\n\r\t\u0000-\u001f]/g, ' ')         // 控制字符/换行（Windows 文件名非法）
      .replace(/\s+/g, ' ').trim().slice(0, 50) || 'untitled'
    const idSuffix = r.id.slice(0, 6)
    const fileName = `${safeTitle}_${idSuffix}.md`
    const tags = (r.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    const frontmatter = [
      '---',
      `type: ${r.type}`,
      `tier: ${r.tier}`,
      `salience: ${r.salience}`,
      `created: ${new Date(r.created_at).toISOString().slice(0, 10)}`,
      tags.length ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : '',
      '---',
    ].filter(Boolean).join('\n')
    const md = [
      frontmatter,
      '',
      `# ${title}`,
      '',
      r.content,
      r.detail ? `\n> ${r.detail}` : '',
      '',
      `<!-- aifp-memory id: ${r.id} -->`,
    ].join('\n')
    writeFileSync(join(opts.directory, fileName), md, 'utf-8')
    sample.push(fileName)
  }
  return { written: rows.length, directory: opts.directory, sample: sample.slice(0, 5) }
}
