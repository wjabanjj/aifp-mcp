// @deploy server — 服务端密钥管理（多用户独立 key，有效期 + 每日配额 + 热吊销）
/**
 * key 来源优先级：
 *   1. COGNITION_KEYS_FILE — keys.json（支持用户/有效期/配额/热吊销）
 *   2. COGNITION_API_KEY   — 单个 key（兼容旧部署，无配额）
 * keys.json 格式：{ "keys": { "<用户名>": { "key": "...", "expiresAt": ms, "quotaPerDay": n, "createdAt": ms } } }
 * 文件 mtime 变化即重载 → 吊销/新增热生效，无需重启。
 */

import { existsSync, readFileSync, writeFileSync, statSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'

const KEYS_FILE = process.env['COGNITION_KEYS_FILE'] || ''
const SINGLE_KEY = process.env['COGNITION_API_KEY'] || ''

export interface KeyInfo {
  user: string
  key: string
  expiresAt: number
  quotaPerDay: number
  usedToday: number
  createdAt: number
}

interface StoredKey { key: string; expiresAt: number; quotaPerDay: number; createdAt: number }
interface KeysFile { keys: Record<string, StoredKey> }

let _store: KeysFile = { keys: {} }
let _loadedMtimeMs = 0
/** 配额用量（内存态：date 用于每日重置） */
const usage = new Map<string, { date: string; used: number }>()

/** 配额重置按本地时区（非 UTC）：中国用户北京时间零点重置，受 TZ 环境变量影响 */
function today(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function loadStore(): KeysFile {
  if (!KEYS_FILE || !existsSync(KEYS_FILE)) return { keys: {} }
  const mtimeMs = statSync(KEYS_FILE).mtimeMs
  if (mtimeMs !== _loadedMtimeMs) {
    _loadedMtimeMs = mtimeMs
    try { _store = JSON.parse(readFileSync(KEYS_FILE, 'utf-8')) as KeysFile } catch { _store = { keys: {} } }
  }
  return _store
}

function persist(): void {
  if (!KEYS_FILE) return
  const tmp = KEYS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(_store, null, 2) + '\n', 'utf-8')
  renameSync(tmp, KEYS_FILE)
}

function allEntries(): KeyInfo[] {
  const store = loadStore()
  const todayStr = today()
  const out: KeyInfo[] = []
  for (const [user, k] of Object.entries(store.keys)) {
    const u = usage.get(user)
    const used = u && u.date === todayStr ? u.used : 0
    out.push({ user, key: k.key, expiresAt: k.expiresAt, quotaPerDay: k.quotaPerDay, usedToday: used, createdAt: k.createdAt })
  }
  return out
}

/** 鉴权：key 有效（多用户模式：命中 + 未过期；单 key 模式：命中） */
export function isAuthorized(supplied: string): boolean {
  if (!supplied || supplied.length < 16) return false
  if (KEYS_FILE) {
    for (const e of allEntries()) {
      if (e.expiresAt < Date.now()) continue
      if (constantTimeEqual(supplied, e.key)) return true
    }
    return false
  }
  if (!SINGLE_KEY || SINGLE_KEY.length < 16) return false
  return constantTimeEqual(supplied, SINGLE_KEY)
}

/** 配额消费：鉴权通过后调用；返回剩余额度，<0 表示已超限 */
export function consumeQuota(supplied: string): number {
  if (!KEYS_FILE) return 999999 // 单 key 模式不限
  const store = loadStore()
  const todayStr = today()
  for (const [user, k] of Object.entries(store.keys)) {
    if (k.expiresAt < Date.now()) continue
    if (!constantTimeEqual(supplied, k.key)) continue
    let u = usage.get(user)
    if (!u || u.date !== todayStr) { u = { date: todayStr, used: 0 }; usage.set(user, u) }
    u.used++
    return k.quotaPerDay - u.used
  }
  return -1
}

/** 生成 key（管理面板/脚本用），返回 null 表示用户名已存在 */
export function createKey(username: string, days: number, quotaPerDay: number): { key: string; expiresAt: string } | null {
  const store = loadStore()
  if (store.keys[username]) return null
  const key = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + days * 86400000
  store.keys[username] = { key, expiresAt, quotaPerDay, createdAt: Date.now() }
  persist()
  return { key, expiresAt: new Date(expiresAt).toISOString().slice(0, 10) }
}

export function revokeKey(username: string): boolean {
  const store = loadStore()
  if (!store.keys[username]) return false
  delete store.keys[username]
  usage.delete(username)
  persist()
  return true
}

export function listKeys(): KeyInfo[] {
  return allEntries()
}

export function keyCount(): number {
  return KEYS_FILE ? allEntries().length : (SINGLE_KEY ? 1 : 0)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── 兼容：COGNITION_KEYS_FILE 为空时用默认路径（当前目录 keys.json） ──
export function effectiveKeysFile(): string {
  return KEYS_FILE || resolve(process.cwd(), 'keys.json')
}
