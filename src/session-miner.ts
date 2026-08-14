// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 会话挖掘 — 后台对话分析
 * 提取决策 / 踩坑 / 编辑循环
 */

import { getDb } from './db.js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

// ── 结果类型 ──

interface MiningResult {
  decisions: string[]
  pitfalls: { file: string; error: string; count: number }[]
  hasStruggle: boolean
}

// ── 正则 ──

const DECISION_PATTERNS = [
  /决定[：:]\s*(.+)/,
  /方案[：:]\s*(.+)/,
  /采用[：:]\s*(.+)/,
  /最终选[：:择定]\s*(.+)/,
]

const ERROR_PATTERNS = [
  /(error|Error|ERROR)[：:\s]+(.+)/,
  /(失败|报错|出错)[：:]\s*(.+)/,
  /遇到错误[：:]\s*(.+)/,
]

const EDIT_PATTERN = /(?:编辑|修改|改了?|更新了?|写了?)\s*(?:文件)?\s*`?([\w./\\-]+\.\w{1,6})`?/g

// ── 主函数 ──

/**
 * 挖掘会话，写入 session_mine 类型记忆。
 * 后台执行，不阻塞调用方。
 */
export async function mineSession(
  messages: Array<{ role: string; content: string }>,
  sessionId: string,
  projectPath?: string,
): Promise<MiningResult> {
  if (!messages || messages.length < 3) return { decisions: [], pitfalls: [], hasStruggle: false }

  const result = extractMiningResult(messages)
  if (result.decisions.length === 0 && result.pitfalls.length === 0) return result

  const db = getDb()
  const now = Date.now()

  // 决策
  for (const decision of result.decisions.slice(0, 5)) {
    const id = `session_mine_${sessionId}_${crc32(decision)}`
    db.prepare(`
      INSERT OR IGNORE INTO memories (id, type, content, salience, session_id, project, created_at, updated_at)
      VALUES (?, 'session_mine', ?, 3, ?, ?, ?, ?)
    `).run(id, decision, sessionId, projectPath || '', now, now)
  }

  // 踩坑
  for (const pit of result.pitfalls.slice(0, 3)) {
    const content = `文件 ${pit.file} 出错 (${pit.count}次): ${pit.error}`
    const id = `session_pit_${sessionId}_${crc32(content)}`
    db.prepare(`
      INSERT OR IGNORE INTO memories (id, type, content, salience, session_id, project, created_at, updated_at)
      VALUES (?, 'session_mine', ?, 4, ?, ?, ?, ?)
    `).run(id, content, sessionId, projectPath || '', now, now)
  }

  // 同步追加到全局工作轨迹
  try { appendToGlobalTrace(result, projectPath, now) } catch {}

  return result
}

// ── 提取逻辑 ──

function extractMiningResult(
  messages: Array<{ role: string; content: string }>,
): MiningResult {
  const decisions: string[] = []
  const pitfalls: Array<{ file: string; error: string; count: number }> = []
  const fileEditCounts = new Map<string, number>()

  for (const msg of messages) {
    const text = msg.content || ''

    // 决策检测
    for (const pattern of DECISION_PATTERNS) {
      const m = text.match(pattern)
      if (m) decisions.push(m[1].trim())
    }

    // 错误检测
    for (const pattern of ERROR_PATTERNS) {
      const m = text.match(pattern)
      if (m) {
        // 尝试从错误上下文中提取文件名
        const fileMatch = text.match(/`?([\w./\\-]+\.\w{1,6})`?/)
        pitfalls.push({
          file: fileMatch ? fileMatch[1] : 'unknown',
          error: m[2] ? m[2].trim() : m[1].trim(),
          count: 1,
        })
      }
    }

    // 编辑计数
    EDIT_PATTERN.lastIndex = 0
    let editMatch: RegExpExecArray | null
    while ((editMatch = EDIT_PATTERN.exec(text)) !== null) {
      const f = editMatch[1]
      fileEditCounts.set(f, (fileEditCounts.get(f) || 0) + 1)
    }
  }

  // 检测编辑循环
  let hasStruggle = false
  for (const [file, count] of fileEditCounts) {
    if (count >= 3 && pitfalls.some((p) => p.file === file)) {
      hasStruggle = true
      break
    }
  }

  // 合并同文件错误
  const pitMap = new Map<string, { file: string; error: string; count: number }>()
  for (const p of pitfalls) {
    const k = `${p.file}::${p.error}`
    if (pitMap.has(k)) {
      pitMap.get(k)!.count++
    } else {
      pitMap.set(k, p)
    }
  }

  return {
    decisions: Array.from(new Set(decisions)),
    pitfalls: Array.from(pitMap.values()),
    hasStruggle,
  }
}

// ── 简单哈希 ──

function crc32(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/** 追加到全局工作轨迹 ~/.AiFP/工作轨迹.md，自动清理7天前的记录 */
function appendToGlobalTrace(result: MiningResult, projectPath?: string, now?: number): void {
  const projectName = projectPath ? basename(projectPath) : 'unknown'
  const summary = result.decisions?.[0] || ''
  if (!summary && !result.hasStruggle) return

  const dt = now ? new Date(now) : new Date()
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  const dateStr = `${y}-${m}-${d}`
  const line = `- [${hh}:${mm}] ${projectName} — ${summary}`

  const dirPath = join(homedir(), '.AiFP')
  const filePath = join(dirPath, '工作轨迹.md')
  mkdirSync(dirPath, { recursive: true })

  let content = ''
  try { content = readFileSync(filePath, 'utf-8') }
  catch { content = '# 工作轨迹\n\n' }

  // 按日期章节拆分 + 清理7天前的
  const sections = content.split(/\n(?=## \d{4}-\d{2}-\d{2})/)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  cutoff.setHours(0, 0, 0, 0)
  const filtered = sections.filter(s => {
    const m2 = s.match(/^## (\d{4}-\d{2}-\d{2})/)
    if (!m2) return true
    return new Date(m2[1]).getTime() >= cutoff.getTime()
  })
  content = filtered.join('\n').replace(/\n{3,}/g, '\n\n')

  // 追加到今日下方（新日期排在前面）
  const todayHeader = `## ${dateStr}`
  if (content.includes(todayHeader)) {
    content = content.replace(todayHeader, `${todayHeader}\n${line}`)
  } else {
    const firstSection = content.indexOf('\n## ')
    if (firstSection !== -1) {
      content = content.slice(0, firstSection) + `\n${todayHeader}\n${line}` + content.slice(firstSection)
    } else {
      content += `\n${todayHeader}\n${line}\n`
    }
  }
  writeFileSync(filePath, content, 'utf-8')
}
