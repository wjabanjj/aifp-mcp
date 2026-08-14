#!/usr/bin/env node
// @deploy npm — 一键配置所有 AI 助手（MCP + pi 扩展）
/**
 * 用法：
 *   node dist/setup.js          （npm 包：自动检测并配置所有已安装的 AI 工具）
 *   npx tsx src/setup/index.ts  （源码模式）
 * 被 scripts/postinstall.mjs 自动调用（npm install -g 时）。
 */

import { existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { ALL_PLATFORMS, injectRules, hasCommand, type PlatformResult } from './platforms.js'
import { configurePi } from './pi-extension.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 检测运行模式并构建 MCP server 定义 */
function buildServer(): { command: string; args: string[] } {
  // npm 包：dist/index.js；源码开发：src/index.ts（tsx）
  const distEntry = resolve(__dirname, '..', 'index.js')
  const srcEntry = resolve(__dirname, '..', '..', 'src', 'index.ts')
  if (existsSync(distEntry)) {
    return { command: 'node', args: [distEntry] }
  }
  return { command: 'npx', args: ['tsx', srcEntry] }
}

export function configureAll(opts: { silent?: boolean; rules?: boolean } = {}): {
  platforms: PlatformResult[]
  pi: { ok: boolean; detail?: string } | null
  rulesInjected: string[]
} {
  const server = buildServer()
  const results: PlatformResult[] = []

  for (const p of ALL_PLATFORMS) {
    if (!p.detected()) continue
    const status = p.configure(server)
    results.push({ id: p.id, name: p.name, status })
  }

  // pi 扩展（pi 无内置 MCP，用扩展机制）
  let piResult: { ok: boolean; detail?: string } | null = null
  const hasPi = existsSync(join(homedir(), '.pi', 'agent')) || hasCommand('pi')
  if (hasPi) {
    piResult = configurePi(server.args[0])
    results.push({
      id: 'pi', name: 'pi-coding-agent', status: piResult.ok ? 'ok' : 'error', detail: piResult.detail,
    })
  }

  const rulesInjected = opts.rules === false ? [] : injectRules()

  if (!opts.silent) {
    console.log('')
    console.log('╔══════════════════════════════════════╗')
    console.log('║   AiFP 记忆感知系统 — 环境配置       ║')
    console.log('╚══════════════════════════════════════╝')
    console.log(`server: ${server.command} ${server.args.join(' ')}\n`)
    for (const r of results) {
      const mark = r.status === 'ok' ? '✓' : r.status === 'exists' ? '·' : r.status === 'error' ? '✗' : '-'
      console.log(`  ${mark} ${r.name.padEnd(14)} ${r.detail ?? r.status}`)
    }
    if (rulesInjected.length) console.log(`\n✓ 已注入启动规则: ${rulesInjected.join(', ')}`)
    console.log('\n识别器可选配置（启用自动记忆识别）：')
    console.log('  COGNITION_RECOGNIZER=1 + COGNITION_LLM_API_KEY=DeepSeek密钥（OpenAI 兼容）')
    console.log('  或 COGNITION_RECOGNIZER=1 + ANTHROPIC_API_KEY=...（Anthropic）')
    console.log('重启各 AI 工具即可使用记忆系统。')
  }
  return { platforms: results, pi: piResult, rulesInjected }
}

// 直接运行时执行（node dist/setup/index.js / npx tsx src/setup/index.ts）
const selfPath = process.argv[1]?.replace(/\\/g, '/') ?? ''
if (selfPath.endsWith('setup/index.js') || selfPath.endsWith('setup/index.ts')) {
  configureAll()
}
