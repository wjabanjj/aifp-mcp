// @deploy npm — 客户端模块，随 npm 分发到用户本地
import { join } from 'path'
import { homedir } from 'os'

// 作为 npm 全局包运行时，默认存 ~/.ai-cognition/
const DEFAULT_DATA_DIR = join(homedir(), '.ai-cognition')
const dataDir = process.env['COGNITION_DATA_DIR'] || DEFAULT_DATA_DIR

export interface SourceDir {
  path: string
  formats: ('md' | 'json')[]
}

export const config = {
  /** 数据目录（DB + 向量索引） */
  dataDir,

  /** SQLite 数据库路径 */
  dbPath: join(dataDir, 'cognition.db'),

  /** FTS5 全文搜索限制 */
  ftsLimit: 50,

  /** 外部记忆来源目录 — 启动时自动扫描导入 .md/.json 文件 */
  sourceDirs: [] as SourceDir[],

  /** 运行模式：remote = 调服务器增强（默认）；local = 仅本地 */
  mode: (process.env['COGNITION_MODE'] || 'remote') as 'local' | 'remote',

  /** 远程服务器地址（remote 模式）— 无默认值，须用户显式配置；不内置具体服务器地址 */
  serverUrl: process.env['COGNITION_SERVER_URL'] || '',

  /** API 密钥 — remote 模式下必须设置。无默认值，不硬编码 */
  apiKey: process.env['COGNITION_API_KEY'] || '',

  /** 监听端口（server.ts 用） */
  port: parseInt(process.env['PORT'] || '5000', 10),

  /** 允许的 CORS 来源 */
  allowedOrigin: process.env['CORS_ORIGIN'] || '',

  /** 速率限制：每 IP 每分钟最大请求数 */
  rateLimitPerMinute: parseInt(process.env['RATE_LIMIT'] || '60', 10),

  /** ── Recognizer 自动识别 ── */

  /** Recognizer 是否启用（设置 COGNITION_RECOGNIZER=1 启用，需 ANTHROPIC_API_KEY） */
  recognizerEnabled: (process.env['COGNITION_RECOGNIZER'] || '0') === '1',

  /** 最大批次：一次攒几条后强制刷新 */
  recognizerMaxBatch: parseInt(process.env['COGNITION_RECOGNIZER_MAX_BATCH'] || '5', 10),

  /** 最长等待(ms)：从第一条入队起最多等多久 */
  recognizerMaxWaitMs: parseInt(process.env['COGNITION_RECOGNIZER_MAX_WAIT_MS'] || '120000', 10),

  /** 轮询间隔(ms)：后台检查队列的频率 */
  recognizerPollMs: parseInt(process.env['COGNITION_RECOGNIZER_POLL_MS'] || '30000', 10),
}

// 从环境变量读取来源目录：COGNITION_SOURCES=/path/to/dir1|/path/to/dir2
const sourcesEnv = process.env['COGNITION_SOURCES'] || ''
if (sourcesEnv) {
  config.sourceDirs = sourcesEnv.split('|').map(p => ({
    path: p,
    formats: ['md', 'json'] as ('md' | 'json')[],
  }))
}

// remote 模式校验（--check 自检时跳过硬校验，由 self-check 报告问题）
const skipValidation = process.env['COGNITION_SKIP_VALIDATION'] === '1' || process.argv.includes('--check')
if (config.mode === 'remote' && !skipValidation) {
  if (!config.serverUrl) {
    console.error('[aifp-mcp] COGNITION_MODE=remote 但未设置 COGNITION_SERVER_URL')
    console.error('  示例: COGNITION_SERVER_URL=https://your-server.com:5000 COGNITION_API_KEY=xxx aifp-mcp')
    process.exit(1)
  }
  if (!config.apiKey) {
    console.error('[aifp-mcp] COGNITION_MODE=remote 但未设置 COGNITION_API_KEY')
    console.error('  remote 模式下必须设置 API 密钥以鉴权')
    console.error('  示例: COGNITION_API_KEY=your-key-here COGNITION_SERVER_URL=... aifp-mcp')
    process.exit(1)
  }
}

// 非生产模式警告（自检时不重复输出）
if (config.mode === 'remote' && !skipValidation && !config.serverUrl.startsWith('https://')) {
  console.warn('[aifp-mcp] 警告: remote 模式使用 HTTP 而非 HTTPS，API key 和中间结果以明文传输')
  console.warn('  建议: 配置 SSL_KEY + SSL_CERT 环境变量启用 HTTPS，或使用 https:// 前缀')
}
