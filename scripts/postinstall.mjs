#!/usr/bin/env node
/**
 * postinstall — 安装后自动完成全套配置（复用 dist/setup.js 的多平台逻辑）
 * 1. 配置各 AI 工具的 MCP 连接（Claude Code / Cursor / Windsurf / Cline / Gemini / Qwen / Zed / VS Code / Codex / Trae）
 * 2. 生成 pi-coding-agent 扩展（~/.pi/agent/extensions/aifp-memory）
 * 3. 注入启动规则到各 AI 工具的全局规则文件
 * 4. 注册 Claude Code hooks（SessionStart 状态检测 + UserPromptSubmit 记忆注入）
 * 只在全局安装时生效（npm install -g aifp-mcp）
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..')

// ── 1. 多平台 MCP 配置 + pi 扩展（核心逻辑在 dist/setup） ──

try {
  const setupEntry = resolve(PACKAGE_ROOT, 'dist', 'setup', 'index.js')
  if (existsSync(setupEntry)) {
    const { configureAll } = await import(`file://${setupEntry.replace(/\\/g, '/')}`)
    // 完整报告（非 silent）：列出各平台配置结果，AI/用户可直接读取
    configureAll()
    console.error('')
    console.error('[aifp-mcp] ✓ 安装配置完成：已自动接入所有检测到的 AI 工具，重启对应工具即可使用记忆系统')
  } else {
    console.error('[aifp-mcp] dist/setup 不存在，跳过自动配置（可手动运行 node dist/setup/index.js）')
  }
} catch (e) {
  console.error(`[aifp-mcp] 自动配置失败: ${e?.message ?? e}`)
}

// ── 2. Claude Code hooks（源文件在 hooks/ 根目录，npm files 已包含） ──

const HOOKS = [
  { src: 'check-status.mjs', dst: 'check-aifp-status.mjs', event: 'SessionStart', matcher: 'startup', timeout: 10 },
  { src: 'recall-hook.mjs', dst: 'recall-aifp-memory.mjs', event: 'UserPromptSubmit', matcher: undefined, timeout: 15 },
]

try {
  const hooksDir = join(homedir(), '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  let settings = {}
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) } catch { settings = {} }
  settings.hooks = settings.hooks || {}
  let changed = false

  for (const h of HOOKS) {
    const srcFile = resolve(PACKAGE_ROOT, 'hooks', h.src)
    if (!existsSync(srcFile)) continue
    const dstFile = join(hooksDir, h.dst)
    copyFileSync(srcFile, dstFile)
    const targetCmd = `node "${dstFile}"`.replace(/\\/g, '/')
    if (!Array.isArray(settings.hooks[h.event])) settings.hooks[h.event] = []
    const exists = settings.hooks[h.event].some((entry) =>
      entry.matcher === h.matcher && entry.hooks?.some((x) => String(x.command).replace(/\\/g, '/') === targetCmd),
    )
    if (!exists) {
      const hookEntry = { matcher: h.matcher, hooks: [{ type: 'command', command: `node "${dstFile}"`, timeout: h.timeout }] }
      if (h.event === 'SessionStart') hookEntry.hooks[0].statusMessage = 'AiFP 记忆感知系统检测中...'
      settings.hooks[h.event].push(hookEntry)
      changed = true
    }
  }

  if (changed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    console.error('[aifp-mcp] ✓ Claude Code hooks 已注册（SessionStart + UserPromptSubmit）')
  }
} catch (e) {
  console.error(`[aifp-mcp] hooks 注册失败: ${e?.message ?? e}`)
}


