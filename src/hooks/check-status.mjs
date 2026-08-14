#!/usr/bin/env node
// AiFP 记忆感知系统 — Claude Code SessionStart 检测 hook
// 检查 MCP 配置 + npm 新版检测

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK_DIR = resolve(__dirname, '..')

const homedirPath = homedir()
const claudeJson = join(homedirPath, '.claude.json')
const settingsPath = join(homedirPath, '.claude', 'settings.json')
const mcpJsonPath = join(homedirPath, '.claude', '.mcp.json')

function checkMcpConfig(configPath) {
  if (!existsSync(configPath)) return false
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return !!(config.mcpServers?.['ai-cognition'])
  } catch { return false }
}

// 读取当前安装版本
function getCurrentVersion() {
  try {
    const pkgPath = resolve(HOOK_DIR, 'package.json')
    if (!existsSync(pkgPath)) return null
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version
  } catch { return null }
}

// 检测 npm 是否有新版（超时 3 秒）
async function checkNpmVersion(currentVer) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('https://registry.npmjs.org/aifp-mcp/latest', {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    return data.version
  } catch { return null }
}

const mcpActive = checkMcpConfig(claudeJson) || checkMcpConfig(settingsPath) || checkMcpConfig(mcpJsonPath)

if (mcpActive) {
  const currentVer = getCurrentVersion()
  const latestVer = await checkNpmVersion(currentVer)

  const instruction = `[startup-instruction]
你已连接 ai-cognition 长期记忆系统。
感知到需要时按需调取（save_memory | search_memories | recall_context | reimport_sources）
不要每个会话开头无脑加载记忆。
[/startup-instruction]`

  if (currentVer && latestVer && currentVer !== latestVer) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`AiFP 新版: v${currentVer} → v${latestVer}`)
    console.log(`升级: npm install -g aifp-mcp@latest`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(instruction)
  } else {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('AiFP 记忆感知系统 ✓ 已就绪')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(instruction)
  }
}
