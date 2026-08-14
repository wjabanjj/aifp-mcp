// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 记忆导入器 — 扫描指定目录/文件，导入为记忆
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { resolve, extname, basename } from 'path'
import { config } from './config.js'
import { getDb } from './db.js'

interface ImportResult {
  imported: number
  updated: number
  skipped: number
}

/**
 * 从 sources 列表中导入内容到记忆库
 * 支持 .txt/.md/.json/.jsonl 文件；目录会递归扫描
 */
export async function importSources(sources?: string[], projectPath?: string): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0 }

  const db = getDb()
  const now = Date.now()

  const targets: string[] = []

  if (!sources || sources.length === 0) {
    // 仅扫描显式配置的 COGNITION_SOURCES 目录；
    // 无配置时不自动导入（避免 MCP 启动 cwd=包目录时把包自身文件当记忆）
    if (config.sourceDirs.length > 0) {
      for (const sd of config.sourceDirs) {
        if (existsSync(sd.path) && statSync(sd.path).isDirectory()) {
          targets.push(...walkDir(sd.path))
        }
      }
    }
  } else {
    for (const src of sources) {
      const p = resolve(process.cwd(), src)
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) {
        targets.push(...walkDir(p))
      } else {
        targets.push(p)
      }
    }
  }

/** 剥离 YAML frontmatter（Obsidian 等 Markdown 笔记标准头） */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end === -1) return text
  return text.slice(end + 4).trimStart()
}

const supported = ['.md', '.txt', '.json', '.jsonl', '.ts', '.js', '.yaml', '.yml', '.toml']

  for (const fp of targets) {
    const ext = extname(fp).toLowerCase()
    if (!supported.includes(ext)) { result.skipped++; continue }

    try {
      const raw = readFileSync(fp, 'utf-8').slice(0, 5000)
      const content = stripFrontmatter(raw) // Obsidian 等笔记的 YAML frontmatter 剥离
      if (!content.trim()) { result.skipped++; continue }

      const fileName = basename(fp)
      const relative = fp.startsWith(process.cwd()) ? fp.slice(process.cwd().length + 1) : fp
      // 使用文件路径作为稳定 ID（不含时间戳），重复导入可覆盖更新
      const id = `import_${relative.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      const type = ext === '.json' || ext === '.jsonl' ? 'data' : 'doc'
      const tags = JSON.stringify([fileName, ext.slice(1)])

      // 检查已存在条目，实现内容哈希去重
      const existing = db.prepare('SELECT content FROM memories WHERE id = ?').get(id) as { content: string } | undefined
      if (existing) {
        if (existing.content === content) {
          result.skipped++
          continue
        }
        // 内容变更 → 更新
        db.prepare('UPDATE memories SET content = ?, type = ?, tags = ?, updated_at = ? WHERE id = ?')
          .run(content, type, tags, now, id)
        result.updated++
        continue
      }

      // 新建条目
      db.prepare(
        `INSERT INTO memories (id, type, content, entities, tags, session_id, project, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, type, content, '[]', tags, 'import', projectPath || '', now, now)
      result.imported++
    } catch {
      result.skipped++
    }
  }

  return result
}

function walkDir(dir: string): string[] {
  const files: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        files.push(...walkDir(p))
      } else {
        files.push(p)
      }
    }
  } catch { /* skip unreadable dirs */ }
  return files
}
