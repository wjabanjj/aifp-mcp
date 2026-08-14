#!/usr/bin/env node
// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * AiFP 记忆感知系统 — 入口（npm 版瘦身入口）
 * 不包含 Recognizer 调度器，不初始化 Hebbian 关联——这些在服务器端
 *
 * 安装: npm install -g aifp-mcp
 * AI 助手配置: claude mcp add ai-cognition -s user -- node <全局安装路径>/dist/index.js
 *   用 node 直接路径代替 npx，避免冷启动超时。安装后用 npm root -g 查看路径。
 */

import { existsSync, mkdirSync } from 'fs'
import { config } from './config.js'

// 确保数据目录存在
if (!existsSync(config.dataDir)) {
  mkdirSync(config.dataDir, { recursive: true })
}

// --check 模式：健康自检后立即退出（0=健康，1=异常）
if (process.argv.includes('--check')) {
  process.env['COGNITION_SKIP_VALIDATION'] = '1'
  const { runSelfCheck } = await import('./self-check.js')
  process.exit(runSelfCheck() ? 0 : 1)
}

// --connect <地址> <key>：持久化服务器连接，之后启动自动 remote 模式
if (process.argv.includes('--connect')) {
  const idx = process.argv.indexOf('--connect')
  const serverUrl = process.argv[idx + 1]
  const apiKey = process.argv[idx + 2]
  if (!serverUrl || !serverUrl.startsWith('http') || !apiKey || apiKey.length < 16) {
    console.error('用法: aifp-mcp --connect <服务器地址> <API密钥>')
    console.error('示例: aifp-mcp --connect https://memory.aifp.com 你的64位密钥')
    process.exit(1)
  }
  const { connectToServer } = await import('./server-config.js')
  const cfg = connectToServer(serverUrl, apiKey)
  console.error(`✓ 已连接服务器增强模式（${cfg.serverUrl}）`)
  console.error('  重启你的 AI 工具后，感知链/深度追踪/图扩散自动可用')
  console.error('  断开: aifp-mcp --disconnect')
  process.exit(0)
}

// --disconnect：恢复纯本地模式
if (process.argv.includes('--disconnect')) {
  const { disconnectServer } = await import('./server-config.js')
  if (disconnectServer()) console.error('✓ 已断开服务器，恢复纯本地模式')
  else console.error('当前未连接服务器')
  process.exit(0)
}

// --setup：重新检测并配置所有 AI 工具（新装工具后跑一次即可接入）
if (process.argv.includes('--setup')) {
  const { configureAll } = await import('./setup/index.js')
  configureAll()
  process.exit(0)
}

// 启动 MCP Server（stdin/stdout MCP 协议）
const mcp = await import('./mcp.js')
await mcp.startStdioServer()
console.error('AiFP 记忆感知系统已加载')

// 本地 Recognizer 调度器（COGNITION_RECOGNIZER=1 时启用，自动轮询识别队列）
if (config.recognizerEnabled) {
  try {
    const { startScheduler } = await import('./recognizer-scheduler.js')
    startScheduler()
  } catch (e: any) {
    console.error('[Recognizer] 本地调度器启动失败:', e?.message ?? e)
  }
}

// 加载 Hebbian 关联到内存（get_related_memories 本地查询需要）
try {
  const { initMemoryAssociations } = await import('./association.js')
  initMemoryAssociations()
} catch (e: any) {
  console.error('[关联] 初始化失败:', e?.message ?? e)
}

// 进程保持存活 — stdin resume 防止 Node.js v24 "unsettled top-level await" 警告
process.stdin.resume()
