// @deploy npm — `aifp-mcp --check` 健康自检
/**
 * 运行 `aifp-mcp --check` 时执行：快速诊断安装状态并输出人类可读报告。
 * 退出码：0 = 健康，1 = 存在异常。只读操作，不修改任何文件。
 */

import { existsSync, accessSync, constants } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { config } from './config.js'

/** 常见 AI 工具平台配置文件的探测路径（存在即视为已安装）。 */
const PLATFORM_PROBES: Record<string, string[]> = {
  'Claude Code': [join(homedir(), '.claude', 'settings.json')],
  Cursor: [join(homedir(), '.cursor', 'mcp.json')],
  Windsurf: [join(homedir(), '.codeium', 'windsurf', 'mcp_config.json')],
  Cline: [join(homedir(), '.config', 'cline', 'mcp_settings.json')],
  'Gemini CLI': [join(homedir(), '.gemini', 'settings.json')],
  'Qwen Code': [join(homedir(), '.qwen', 'settings.json')],
  Zed: [join(homedir(), '.config', 'zed', 'settings.json')],
  'VS Code Copilot': [join(homedir(), '.vscode', 'mcp.json'), join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')],
  'Codex CLI': [join(homedir(), '.codex', 'config.toml')],
  'pi-coding-agent': [join(homedir(), '.pi', 'agent', 'extensions', 'aifp-memory')],
}

const MODEL_CACHE = join(homedir(), '.cache', 'huggingface')

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

function checkDataDir(): CheckResult {
  const dir = config.dataDir
  if (!existsSync(dir)) return { name: '数据目录', ok: false, detail: `${dir} 不存在` }
  try {
    accessSync(dir, constants.W_OK)
    return { name: '数据目录', ok: true, detail: dir }
  } catch {
    return { name: '数据目录', ok: false, detail: `${dir} 不可写` }
  }
}

function checkDb(): CheckResult {
  if (existsSync(config.dbPath)) return { name: '记忆数据库', ok: true, detail: config.dbPath }
  return { name: '记忆数据库', ok: true, detail: '尚未创建（首次使用自动创建）' }
}

function checkModel(): CheckResult {
  if (existsSync(MODEL_CACHE)) return { name: '嵌入模型缓存', ok: true, detail: MODEL_CACHE }
  return { name: '嵌入模型缓存', ok: false, detail: '未下载（首次启动时自动下载 ~30MB）' }
}

function checkEnv(): CheckResult[] {
  const results: CheckResult[] = []
  results.push({
    name: '运行模式',
    ok: true,
    detail: `COGNITION_MODE=${config.mode}${config.mode === 'remote' ? ` → ${config.serverUrl}` : ''}`,
  })
  if (config.mode === 'remote') {
    results.push({
      name: 'API 密钥',
      ok: config.apiKey.length > 0,
      detail: config.apiKey.length > 0 ? '已设置' : 'COGNITION_API_KEY 未设置，远程调用将失败',
    })
  }
  results.push({
    name: '自动识别器',
    ok: true,
    detail: config.recognizerEnabled
      ? '已启用（COGNITION_RECOGNIZER=1，观察队列自动落库）'
      : '未启用（AI 主动 save_memory 不受影响）',
  })
  return results
}

function checkPlatforms(): CheckResult {
  const found = Object.entries(PLATFORM_PROBES)
    .filter(([, paths]) => paths.some(p => existsSync(p)))
    .map(([name]) => name)
  return found.length > 0
    ? { name: '已检测平台', ok: true, detail: found.join('、') }
    : { name: '已检测平台', ok: true, detail: '未检测到已配置的 AI 工具（可运行 setup 一键配置）' }
}

/** 运行完整自检，输出报告，返回是否健康。 */
export function runSelfCheck(): boolean {
  const results: CheckResult[] = [
    { name: '版本', ok: true, detail: `aifp-mcp v${process.env['npm_package_version'] ?? '1.5.2'} · Node ${process.version} · ${process.platform}` },
    checkDataDir(),
    checkDb(),
    checkModel(),
    ...checkEnv(),
    checkPlatforms(),
  ]
  const width = Math.max(...results.map(r => r.name.length))
  console.log('── AiFP 记忆感知系统自检 ──')
  let healthy = true
  for (const r of results) {
    if (!r.ok) healthy = false
    console.log(`${r.name.padEnd(width + 2)}${r.ok ? '✓' : '✗'}  ${r.detail}`)
  }
  console.log(healthy ? '\n✓ 系统正常' : '\n✗ 存在需要处理的问题（见上方 ✗ 项）')
  return healthy
}
