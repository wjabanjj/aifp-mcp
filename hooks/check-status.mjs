#!/usr/bin/env node
/**
 * AiFP 记忆感知系统 — SessionStart Hook（Claude Code）
 *
 * 会话启动时检测记忆系统状态，打印提示。
 * 500ms 硬超时 fail-open，从不阻塞启动。
 */

'use strict'

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const DATA_DIR = process.env.COGNITION_DATA_DIR || join(homedir(), '.ai-cognition')
const DB_PATH = join(DATA_DIR, 'cognition.db')

try {
  if (!existsSync(DB_PATH)) {
    console.log('AiFP 记忆库未初始化（首次使用将自动创建）')
    process.exit(0)
  }

  // 用只读方式快速查记忆总数（避免锁）
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  let total = 0
  let queue = 0
  try {
    total = Number(db.prepare('SELECT COUNT(*) as c FROM memories').get().c ?? 0)
  } catch { /* 表可能不存在 */ }
  try {
    queue = Number(db.prepare("SELECT COUNT(*) as c FROM recognition_queue WHERE status = 'pending'").get().c ?? 0)
  } catch { /* 表可能不存在 */ }
  db.close()

  const parts = [`AiFP 记忆感知系统：${total} 条记忆`]
  if (queue > 0) parts.push(`${queue} 条待识别`)
  console.log(parts.join(' · '))
} catch {
  // 静默失败，不阻塞
}
