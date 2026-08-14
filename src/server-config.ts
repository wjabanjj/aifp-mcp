// @deploy npm — 服务器连接配置持久化（aifp-mcp --connect）
/**
 * 用户拿到 key 后：aifp-mcp --connect <地址> <key>
 * 写入 ~/.ai-cognition/server.json，之后启动自动 remote 模式（感知链增强）。
 * 断开：aifp-mcp --disconnect（恢复纯本地）。
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DATA_DIR = process.env['COGNITION_DATA_DIR'] || join(homedir(), '.ai-cognition')
const CONFIG_PATH = join(DATA_DIR, 'server.json')

export interface PersistedServer {
  serverUrl: string
  apiKey: string
  connectedAt: number
}

/** 读取持久化服务器配置（不存在返回 null） */
export function readServerConfig(): PersistedServer | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    if (raw && typeof raw.serverUrl === 'string' && raw.serverUrl.length > 0) return raw as PersistedServer
    return null
  } catch {
    return null
  }
}

/** 连接：写入 server.json（覆盖旧配置） */
export function connectToServer(serverUrl: string, apiKey: string): PersistedServer {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const cfg: PersistedServer = { serverUrl, apiKey, connectedAt: Date.now() }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
  return cfg
}

/** 断开：删除 server.json，恢复纯本地 */
export function disconnectServer(): boolean {
  if (!existsSync(CONFIG_PATH)) return false
  rmSync(CONFIG_PATH)
  return true
}
