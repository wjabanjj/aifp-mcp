// @deploy npm — pi 扩展生成模块
/**
 * pi-coding-agent 适配：生成 pi 扩展（pi 无内置 MCP，用扩展机制对接）
 * 生成到 ~/.pi/agent/extensions/aifp-memory/
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { renderIndexTs } from './pi-template.js'

const PI_EXT_DIR = join(homedir(), '.pi', 'agent', 'extensions', 'aifp-memory')

/** 生成 pi 扩展（含 package.json + npm install） */
export function configurePi(serverEntry: string): { ok: boolean; detail?: string } {
  try {
    if (!existsSync(PI_EXT_DIR)) mkdirSync(PI_EXT_DIR, { recursive: true })

    const pkg = {
      name: 'pi-aifp-memory',
      version: '1.0.0',
      private: true,
      type: 'module',
      description: 'AiFP 记忆感知系统对接扩展（MCP 客户端）',
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.29.0',
        typebox: '^1.3.0',
      },
    }

    writeFileSync(join(PI_EXT_DIR, 'index.ts'), renderIndexTs(serverEntry), 'utf-8')
    writeFileSync(join(PI_EXT_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

    // 依赖未装则自动安装
    if (!existsSync(join(PI_EXT_DIR, 'node_modules'))) {
      execSync('npm install --no-audit --no-fund', { cwd: PI_EXT_DIR, stdio: 'ignore', timeout: 300000 })
    }
    return { ok: true, detail: PI_EXT_DIR }
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) }
  }
}
