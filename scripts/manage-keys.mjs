#!/usr/bin/env node
/**
 * AiFP 服务器密钥管理（运营方用）
 *
 * 用法：
 *   node scripts/manage-keys.mjs add <用户名> [key文件路径]
 *   node scripts/manage-keys.mjs list [key文件路径]
 *   node scripts/manage-keys.mjs revoke <用户名> [key文件路径]
 *   node scripts/manage-keys.mjs gen            # 仅生成一个随机 key（不写入）
 *
 * key 文件默认 ./keys.txt（每行 `用户名:key`，# 注释）。服务端设
 * COGNITION_KEYS_FILE 指向同一文件，吊销（revoke）后热生效，无需重启。
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'

const DEFAULT_FILE = resolve(process.cwd(), 'keys.txt')

function genKey() {
  return randomBytes(32).toString('hex') // 64 字符 hex
}

function loadKeys(file) {
  const map = new Map()
  if (!existsSync(file)) return map
  for (const raw of readFileSync(file, 'utf-8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }
  return map
}

function saveKeys(file, map) {
  const lines = [...map.entries()].map(([u, k]) => `${u}:${k}`)
  writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8')
}

const [, , cmd, arg, fileArg] = process.argv
const file = fileArg || process.env['COGNITION_KEYS_FILE'] || DEFAULT_FILE

switch (cmd) {
  case 'gen':
    console.log(genKey())
    break
  case 'add': {
    if (!arg) { console.error('用法: manage-keys.mjs add <用户名>'); process.exit(1) }
    const map = loadKeys(file)
    if (map.has(arg)) { console.error(`用户 ${arg} 已存在，先 revoke 再重新添加`); process.exit(1) }
    const key = genKey()
    map.set(arg, key)
    saveKeys(file, map)
    console.log(`✓ 已为 ${arg} 生成 key 并写入 ${file}`)
    console.log(`  COGNITION_SERVER_URL=<你的地址>`)
    console.log(`  COGNITION_API_KEY=${key}`)
    console.log('  把这 2 行发给用户即可')
    break
  }
  case 'list': {
    const map = loadKeys(file)
    if (map.size === 0) { console.log('（无 key）'); break }
    for (const [u, k] of map) console.log(`${u}\t${k.slice(0, 8)}...\t${k}`)
    console.log(`共 ${map.size} 个用户`)
    break
  }
  case 'revoke': {
    if (!arg) { console.error('用法: manage-keys.mjs revoke <用户名>'); process.exit(1) }
    const map = loadKeys(file)
    if (!map.delete(arg)) { console.error(`用户 ${arg} 不存在`); process.exit(1) }
    saveKeys(file, map)
    console.log(`✓ 已吊销 ${arg}（服务端热生效，无需重启）`)
    break
  }
  default:
    console.log(`用法:\n  node scripts/manage-keys.mjs add <用户名>\n  node scripts/manage-keys.mjs list\n  node scripts/manage-keys.mjs revoke <用户名>\n  node scripts/manage-keys.mjs gen`)
}
