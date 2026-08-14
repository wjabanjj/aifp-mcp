// @deploy npm — 多平台 MCP 配置
/**
 * 各 AI 工具平台的 MCP 配置（Claude 兼容 mcpServers 格式为主，
 * Zed 用 context_servers，VS Code 用 servers，pi 用扩展生成）
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

export interface ServerDef {
  command: string
  args: string[]
}

export interface PlatformResult {
  id: string
  name: string
  status: 'ok' | 'exists' | 'skip' | 'error'
  detail?: string
}

const HOME = homedir()

function readJson(p: string): any {
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return {} }
}

function writeJson(p: string, obj: any): void {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore', timeout: 3000 })
    return true
  } catch { return false }
}

export { hasCommand }

/** 通用 mcpServers 写入（Claude 兼容格式） */
function setMcpServers(configPath: string, server: ServerDef, serverName = 'ai-cognition'): 'ok' | 'exists' | 'error' {
  try {
    const cfg = readJson(configPath)
    if (!cfg.mcpServers) cfg.mcpServers = {}
    if (cfg.mcpServers[serverName]) return 'exists'
    cfg.mcpServers[serverName] = server
    writeJson(configPath, cfg)
    return 'ok'
  } catch { return 'error' }
}

interface Platform {
  id: string
  name: string
  detected: () => boolean
  configure(server: ServerDef): 'ok' | 'exists' | 'skip' | 'error'
}

// ── 各平台 ──

const CLAUDE = 'settings.json'

const platforms: Platform[] = [
  {
    id: 'claude-code', name: 'Claude Code',
    detected: () => hasCommand('claude') || existsSync(join(HOME, '.claude')),
    configure: (s) => setMcpServers(join(HOME, '.claude', 'settings.json'), s),
  },
  {
    id: 'cursor', name: 'Cursor',
    detected: () => hasCommand('cursor') || existsSync(join(HOME, '.cursor')),
    configure: (s) => setMcpServers(join(HOME, '.cursor', 'mcp.json'), s),
  },
  {
    id: 'windsurf', name: 'Windsurf',
    detected: () => hasCommand('windsurf') || existsSync(join(HOME, '.codeium', 'windsurf')),
    configure: (s) => setMcpServers(join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), s),
  },
  {
    id: 'cline', name: 'Cline',
    detected: () => hasCommand('cline') || existsSync(join(HOME, '.config', 'cline')),
    configure: (s) => setMcpServers(join(HOME, '.config', 'cline', 'mcp_settings.json'), s),
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI',
    detected: () => hasCommand('gemini') || existsSync(join(HOME, '.gemini')),
    configure: (s) => setMcpServers(join(HOME, '.gemini', 'settings.json'), s),
  },
  {
    id: 'qwen-code', name: 'Qwen Code',
    detected: () => hasCommand('qwen') || hasCommand('qwen-code') || existsSync(join(HOME, '.qwen')),
    configure: (s) => setMcpServers(join(HOME, '.qwen', 'settings.json'), s),
  },
  {
    id: 'zed', name: 'Zed',
    detected: () => hasCommand('zed') || existsSync(join(HOME, '.config', 'zed')),
    configure: (s) => {
      // Zed 用 context_servers 字段
      const p = join(HOME, '.config', 'zed', 'settings.json')
      try {
        const cfg = readJson(p)
        if (!cfg.context_servers) cfg.context_servers = {}
        if (cfg.context_servers['ai-cognition']) return 'exists'
        cfg.context_servers['ai-cognition'] = { command: s.command, args: s.args, env: {} }
        writeJson(p, cfg)
        return 'ok'
      } catch { return 'error' }
    },
  },
  {
    id: 'vscode-copilot', name: 'VS Code Copilot',
    detected: () => {
      const userDir = process.platform === 'win32'
        ? join(process.env.APPDATA || '', 'Code', 'User')
        : join(HOME, '.config', 'Code', 'User')
      return existsSync(userDir)
    },
    configure: (s) => {
      // VS Code 用户级 mcp.json：servers + type: stdio
      const userDir = process.platform === 'win32'
        ? join(process.env.APPDATA || '', 'Code', 'User')
        : join(HOME, '.config', 'Code', 'User')
      const p = join(userDir, 'mcp.json')
      try {
        const cfg = readJson(p)
        if (!cfg.servers) cfg.servers = {}
        if (cfg.servers['ai-cognition']) return 'exists'
        cfg.servers['ai-cognition'] = { type: 'stdio', command: s.command, args: s.args }
        writeJson(p, cfg)
        return 'ok'
      } catch { return 'error' }
    },
  },
  {
    id: 'trae', name: 'Trae',
    detected: () => hasCommand('trae') || existsSync(join(HOME, '.trae')) || existsSync(join(process.env.APPDATA || '', 'Trae')) || existsSync(join(process.env.APPDATA || '', 'Trae CN')),
    // Trae 无官方命令行配置文件，需 GUI 添加（设置 → MCP）；规则见 rules/trae-rules.md
    configure: () => 'skip',
  },
  {
    id: 'codex', name: 'Codex CLI',
    detected: () => hasCommand('codex') || existsSync(join(HOME, '.codex')),
    configure: (s) => {
      // TOML 格式
      const p = join(HOME, '.codex', 'config.toml')
      try {
        mkdirSync(dirname(p), { recursive: true })
        let toml = ''
        try { toml = readFileSync(p, 'utf-8') } catch { /* 新建 */ }
        if (toml.includes('[mcp_servers.ai-cognition]')) return 'exists'
        const args = s.args.map((a) => a.replace(/\\/g, '\\\\')).join('", "')
        toml += `\n[mcp_servers.ai-cognition]\ncommand = "${s.command}"\nargs = ["${args}"]\n`
        writeFileSync(p, toml, 'utf-8')
        return 'ok'
      } catch { return 'error' }
    },
  },
  {
    id: 'dsh', name: 'DeepSeek Harness (dsh)',
    detected: () => existsSync(join(HOME, '.dsh')),
    configure: (s) => {
      // Cordis 补丁层：~/.dsh/cordis.patch.yml（对所有 profile 生效）
      const p = join(HOME, '.dsh', 'cordis.patch.yml')
      try {
        mkdirSync(dirname(p), { recursive: true })
        let yaml = ''
        try { yaml = readFileSync(p, 'utf-8') } catch { /* 新建 */ }
        if (yaml.includes('id: memory-aifp')) return 'exists'
        const entry = s.args[0].replace(/\\/g, '/')
        const root = dirname(dirname(s.args[0])).replace(/\\/g, '/')
        const block = [
          '',
          '# AiFP 记忆感知系统（aifp-mcp）— 由 postinstall 自动添加，删除本段即可卸载',
          '- insert:',
          '    - id: memory-aifp',
          "      name: '@deepseek-ai/dsh-mcp-client'",
          '      config:',
          '        serverName: ai-cognition',
          '        transport: stdio',
          `        command: '${s.command}'`,
          `        args: ['${entry}']`,
          `        cwd: '${root}'`,
          '        env:',
          '          COGNITION_RECOGNIZER: "1"',
          '',
        ].join('\n')
        writeFileSync(p, yaml.trimEnd() + '\n' + block, 'utf-8')
        return 'ok'
      } catch { return 'error' }
    },
  },
]

export const ALL_PLATFORMS = platforms

/** 注入启动规则到各 AI 工具的全局规则文件 */
export function injectRules(serverName = 'ai-cognition'): string[] {
  const rules = [
    { path: join(HOME, '.claude', 'CLAUDE.md'), name: 'Claude Code' },
    { path: join(HOME, '.cursorrules'), name: 'Cursor' },
    { path: join(HOME, '.windsurfrules'), name: 'Windsurf' },
    { path: join(HOME, '.clinerules'), name: 'Cline' },
    { path: join(HOME, '.codex', 'CODEX.md'), name: 'Codex CLI' },
  ]
  // 连接指引独立段落：老用户已注入过主段落时，仅追加缺失的连接段
  const CONNECT_GUIDE = `## 连接服务器增强（用户提供 key/地址时）

用户说"配置 aifp 服务器"、"这是我的 aifp key：XXX"、或给你一段"地址+密钥"时：

1. 若 aifp-mcp 未安装：先执行 \`npm install -g aifp-mcp\`
2. 执行 \`aifp-mcp --connect <地址> <密钥>\`（地址和密钥**必须来自用户**，不要猜测/编造地址）
3. 看到 "✓ 已连接" 后，提示用户**重启当前工具**（感知链等增强功能在重启后生效）
4. 不要手动编辑任何配置文件（~/.ai-cognition/server.json 由 --connect 自动写入）
5. 用户说断开时：执行 \`aifp-mcp --disconnect\`
`
  const content = `## AiFP 记忆感知系统

你已连接 ${serverName} MCP Server（长期记忆系统）。
在对话中**感知到需要时按需调取**，不要每个会话开头无脑加载：

- 用户问起过去的事 → \`search_memories\` 或 \`recall_context\`
- 用户分享新信息 → \`save_memory\`
- 用户说新增了笔记 → \`reimport_sources\`
- 需要综合回顾 → \`recall_context\`

## 连接服务器增强（用户提供 key/地址时）

用户说"配置 aifp 服务器"、"这是我的 aifp key：XXX"、或给你一段"地址+密钥"时：

1. 若 aifp-mcp 未安装：先执行 \`npm install -g aifp-mcp\`
2. 执行 \`aifp-mcp --connect <地址> <密钥>\`（地址和密钥**必须来自用户**，不要猜测/编造地址）
3. 看到 "✓ 已连接" 后，提示用户**重启当前工具**（感知链等增强功能在重启后生效）
4. 不要手动编辑任何配置文件（~/.ai-cognition/server.json 由 --connect 自动写入）
5. 用户说断开时：执行 \`aifp-mcp --disconnect\`

## 安装/重装引导（用户要求时）

用户说"安装/重装/升级记忆系统"或"npm install -g aifp-mcp"时：

1. 直接执行 \`npm install -g aifp-mcp\`（或 \`npm i -g aifp-mcp@latest\` 升级）
2. 安装完成后 **postinstall 会自动配置所有已安装的 AI 工具**（Claude Code、Cursor、Codex、DeepSeek Harness、pi 等），无需手动改任何配置文件
3. 看到 "[aifp-mcp] ✓ 配置完成" 后，提示用户**重启当前工具**（MCP 工具在工具启动时加载）
4. 不要手动创建或编辑 MCP 配置文件（.claude/settings.json、.codex/config.toml、~/.dsh/cordis.patch.yml 等）
`
  const done: string[] = []
  const CONNECT_MARKER = '## 连接服务器增强'
  for (const { path, name } of rules) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      let text = ''
      try { text = readFileSync(path, 'utf-8') } catch { /* 新建 */ }
      let next = text
      if (!text.includes(SECTION_MARKER)) {
        // 新装：整体追加
        next = text.trimEnd() + (text ? '\n\n' : '') + content
      } else if (!text.includes(CONNECT_MARKER)) {
        // 老用户：仅追加连接指引段（增量更新）
        next = text.trimEnd() + '\n\n' + CONNECT_GUIDE
      }
      if (next !== text) {
        writeFileSync(path, next, 'utf-8')
        done.push(name)
      }
    } catch { /* 跳过 */ }
  }
  return done
}

const SECTION_MARKER = '## AiFP 记忆感知系统'
