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

// 启动 MCP Server（stdin/stdout MCP 协议）
const mcp = await import('./mcp.js')
await mcp.startStdioServer()

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
