#!/usr/bin/env node
/**
 * AiFP 服务器密钥管理（运营方用，兼容管理面板 keys.json）
 *
 * 用法：
 *   node scripts/manage-keys.mjs add <用户名> [天数=30] [每日配额=2000] [key文件路径]
 *   node scripts/manage-keys.mjs list [key文件路径]
 *   node scripts/manage-keys.mjs revoke <用户名> [key文件路径]
 *   node scripts/manage-keys.mjs gen            # 仅生成随机 key（不写入）
 *
 * key 文件默认 ./keys.json。服务器设 COGNITION_KEYS_FILE 指向同一文件。
 * 推荐直接用管理面板（http://<服务器>/admin），本脚本用于无页面环境。
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'

const DEFAULT_FILE = resolve(process.cwd(), 'keys.json')

function genKey() { return randomBytes(32).toString('hex') }

function load(file) {
  if (!existsSync(file)) return { keys: {} }
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return { keys: {} } }
}
function save(file, store) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  renameSync(tmp, file)
}
function today() { return new Date().toISOString().slice(0, 10) }

const [, , cmd, arg, p2, p3, p4] = process.argv
const file = p4 || process.env['COGNITION_KEYS_FILE'] || DEFAULT_FILE

switch (cmd) {
  case 'gen': console.log(genKey()); break
  case 'add': {
    if (!arg) { console.error('用法: manage-keys.mjs add <用户名> [天数] [每日配额]'); process.exit(1) }
    const days = parseInt(p2) || 30
    const quota = parseInt(p3) || 2000
    const store = load(file)
    if (store.keys[arg]) { console.error(`用户 ${arg} 已存在`); process.exit(1) }
    const key = genKey()
    store.keys[arg] = { key, expiresAt: Date.now() + days * 86400000, quotaPerDay: quota, createdAt: Date.now() }
    save(file, store)
    const expire = new Date(store.keys[arg].expiresAt).toISOString().slice(0, 10)
    console.log(`✓ 已为 ${arg} 生成 key（有效期至 ${expire}，每日配额 ${quota}）`)
    console.log(`  COGNITION_MODE=remote`)
    console.log(`  COGNITION_SERVER_URL=<你的域名>`)
    console.log(`  COGNITION_API_KEY=${key}`)
    break
  }
  case 'list': {
    const store = load(file)
    const entries = Object.entries(store.keys || {})
    if (!entries.length) { console.log('（无 key）'); break }
    const now = Date.now()
    for (const [u, k] of entries) {
      const expired = k.expiresAt < now
      console.log(`${expired ? '[过期]' : '[有效]'} ${u}\t${k.key.slice(0, 8)}...\t到期 ${new Date(k.expiresAt).toISOString().slice(0,10)}\t配额 ${k.quotaPerDay}/日`)
    }
    console.log(`共 ${entries.length} 个用户`)
    break
  }
  case 'revoke': {
    if (!arg) { console.error('用法: manage-keys.mjs revoke <用户名>'); process.exit(1) }
    const store = load(file)
    if (!store.keys[arg]) { console.error(`用户 ${arg} 不存在`); process.exit(1) }
    delete store.keys[arg]
    save(file, store)
    console.log(`✓ 已吊销 ${arg}（热生效，无需重启）`)
    break
  }
  default:
    console.log(`用法:\n  node scripts/manage-keys.mjs add <用户名> [天数] [配额]\n  node scripts/manage-keys.mjs list\n  node scripts/manage-keys.mjs revoke <用户名>\n  node scripts/manage-keys.mjs gen`)
}
