// @deploy server — 服务端密钥管理（多用户独立 key，支持热吊销）
/**
 * key 来源优先级：
 *   1. COGNITION_KEYS_FILE — key 文件（每行 `用户名:key`，# 开头为注释）
 *   2. COGNITION_API_KEY   — 单个 key（兼容旧部署）
 * 鉴权时检查文件 mtime，变化即重载 → 吊销（删行）热生效，无需重启。
 */

import { existsSync, readFileSync, statSync } from 'fs'

const KEYS_FILE = process.env['COGNITION_KEYS_FILE'] || ''
const SINGLE_KEY = process.env['COGNITION_API_KEY'] || ''

interface KeyEntry {
  user: string
  key: string
}

let _entries: KeyEntry[] = []
let _loadedMtimeMs = 0

function parseKeyFile(text: string): KeyEntry[] {
  const out: KeyEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    out.push({ user: line.slice(0, idx).trim(), key: line.slice(idx + 1).trim() })
  }
  return out.filter(e => e.key.length >= 16)
}

function reloadIfChanged(): void {
  if (!KEYS_FILE || !existsSync(KEYS_FILE)) return
  const mtimeMs = statSync(KEYS_FILE).mtimeMs
  if (mtimeMs === _loadedMtimeMs) return
  _loadedMtimeMs = mtimeMs
  _entries = parseKeyFile(readFileSync(KEYS_FILE, 'utf-8'))
}

/** 鉴权：key 是否有效（单 key 或 key 文件之一） */
export function isAuthorized(supplied: string): boolean {
  if (!supplied || supplied.length < 16) return false
  // key 文件优先（支持多用户 + 热吊销）
  if (KEYS_FILE) {
    reloadIfChanged()
    for (const e of _entries) {
      if (constantTimeEqual(supplied, e.key)) return true
    }
    return false
  }
  // 单 key 兼容
  if (!SINGLE_KEY || SINGLE_KEY.length < 16) return false
  return constantTimeEqual(supplied, SINGLE_KEY)
}

/** 当前 key 数（日志用） */
export function keyCount(): number {
  if (KEYS_FILE) {
    reloadIfChanged()
    return _entries.length
  }
  return SINGLE_KEY ? 1 : 0
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
