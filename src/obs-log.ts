// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 观察日志 — JSONL 按天轮转
 * 记录工具调用，供模式扫描使用
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, appendFileSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'

// ── 目录 ──

const OBS_DIR = join(config.dataDir, 'observations')

function ensureDir(): void {
  if (!existsSync(OBS_DIR)) {
    mkdirSync(OBS_DIR, { recursive: true })
  }
}

function todayFile(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return join(OBS_DIR, `observations-${yyyy}-${mm}-${dd}.jsonl`)
}

// ── 写入 ──

interface ObservationEntry {
  t: number
  seq: number
  tool: string
  args: Record<string, unknown>
  session?: string
  project?: string
  result?: string
  duration_ms?: number
  success?: boolean
}

let _seq = 0

/**
 * 写入一条观察记录。fire-and-forget，异常静默吞掉。
 */
export function writeObservation(entry: Omit<ObservationEntry, 't' | 'seq'>): void {
  try {
    ensureDir()
    const record: ObservationEntry = { ...entry, t: Date.now(), seq: ++_seq }
    appendFileSync(todayFile(), JSON.stringify(record) + '\n')
  } catch {
    // 静默吞掉，不阻塞主流程
  }
}

// ── 轮转 ──

/**
 * 清理 7 天前的日志文件。返回删除的文件数。
 */
export function rotateObservationLogs(): number {
  try {
    if (!existsSync(OBS_DIR)) return 0
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    let deleted = 0

    for (const f of readdirSync(OBS_DIR)) {
      const match = f.match(/^observations-(\d{4}-\d{2}-\d{2})\.jsonl$/)
      if (!match) continue
      const fileDate = new Date(match[1]).getTime()
      if (fileDate < cutoff) {
        unlinkSync(join(OBS_DIR, f))
        deleted++
      }
    }
    return deleted
  } catch {
    return 0
  }
}

// ── 模式扫描 ──

export interface PatternSummary {
  pattern: string
  frequency: number
}

export interface ScanResult {
  patterns: PatternSummary[]
  total: number
}

/**
 * 扫描最近 N 小时内的观察日志，返回高频模式 Top 20。
 */
export function scanRecentPatterns(hours: number = 2): ScanResult {
  try {
    if (!existsSync(OBS_DIR)) return { patterns: [], total: 0 }

    const cutoff = Date.now() - hours * 60 * 60 * 1000
    const counter = new Map<string, number>()
    let total = 0

    for (const f of readdirSync(OBS_DIR)) {
      if (!f.endsWith('.jsonl')) continue

      const content = readFileSync(join(OBS_DIR, f), 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue

        try {
          const entry: ObservationEntry = JSON.parse(line)
          if (entry.t < cutoff) continue

          const prefix = entry.result ? JSON.stringify(entry.result).slice(0, 50) : ''

          const key = `${entry.tool}::${entry.success ? 'ok' : 'error'}:${prefix}`
          counter.set(key, (counter.get(key) || 0) + 1)
          total++
        } catch {
          // skip malformed lines
        }
      }
    }

    const minFreq = Math.max(3, Math.ceil(total * 0.02))
    const patterns: PatternSummary[] = []

    for (const [pattern, frequency] of counter) {
      if (frequency >= minFreq) {
        patterns.push({ pattern, frequency })
      }
    }

    patterns.sort((a, b) => b.frequency - a.frequency)
    return { patterns: patterns.slice(0, 20), total }
  } catch {
    return { patterns: [], total: 0 }
  }
}
