// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * AiFP 记忆感知系统 — HTTP 算法增强服务（安全加固版）
 * 支持 HTTPS、API 密钥鉴权（强制）、速率限制、计算量限制、错误脱敏
 */

import http from 'http'
import https from 'https'
import { readFileSync, existsSync } from 'fs'
import { handleRequest, initServer } from './mcp-enhanced.js'

const {
  port,
  allowedOrigin,
  rateLimitPerMinute,
} = (await import('./config.js')).config

const SSL_KEY = process.env['SSL_KEY'] || ''
const SSL_CERT = process.env['SSL_CERT'] || ''
const USE_HTTPS = !!(SSL_KEY && SSL_CERT)

// ── 启动校验：无 key 或弱 key 拒绝启动（防裸奔） ──
const { isAuthorized, keyCount, consumeQuota } = await import('./server-keys.js')
const singleApiKey = process.env['COGNITION_API_KEY'] || ''
if (!process.env['COGNITION_KEYS_FILE'] && (!singleApiKey || singleApiKey.length < 16)) {
  console.error('[记忆感知] 启动失败：必须设置 COGNITION_API_KEY（至少 16 字符）或 COGNITION_KEYS_FILE')
  console.error('  示例: COGNITION_API_KEY=<32位随机串> node dist/server.js')
  console.error('      或 COGNITION_KEYS_FILE=/etc/aifp/keys.txt（每行 用户名:key，支持热吊销）')
  process.exit(1)
}
if (singleApiKey) console.error(`[记忆感知] 已加载密钥：${process.env['COGNITION_KEYS_FILE'] ? `key 文件(${keyCount()} 个用户)` : '单 key 模式'}`)
if (USE_HTTPS && (!existsSync(SSL_KEY) || !existsSync(SSL_CERT))) {
  console.error('[记忆感知] SSL_KEY/SSL_CERT 指向的文件不存在')
  process.exit(1)
}

// ── 速率限制：IP + 失败计数，容量封顶防内存 DoS ──
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const FAIL_LIMIT = 20          // 每 IP 每分钟鉴权失败上限（防爆破）
const MAX_TRACKED_IPS = 10000  // 跟踪 IP 上限（防无限增长）

function pruneExpired(): void {
  if (requestCounts.size <= MAX_TRACKED_IPS) return
  const now = Date.now()
  for (const [k, v] of requestCounts) {
    if (v.resetAt < now) requestCounts.delete(k)
  }
  // 仍超限：清理最旧的条目
  if (requestCounts.size > MAX_TRACKED_IPS) {
    const sorted = [...requestCounts.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    const toDelete = Math.ceil(requestCounts.size - MAX_TRACKED_IPS / 2)
    for (let i = 0; i < toDelete; i++) requestCounts.delete(sorted[i][0])
  }
}

function checkRateLimit(ip: string, isFailure: boolean): boolean {
  const now = Date.now()
  const entry = requestCounts.get(ip)
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: isFailure ? 1 : 0, resetAt: now + 60000 })
    return true
  }
  entry.count += isFailure ? 1 : 0
  return entry.count < (isFailure ? FAIL_LIMIT : rateLimitPerMinute)
}

function requesterIp(req: http.IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'unknown'
}

// ── 鉴权：Bearer 比对（常数时间比较，防时序攻击；支持多用户 key） ──
function checkAuth(req: http.IncomingMessage): boolean {
  const auth = req.headers['authorization'] || ''
  if (!auth.startsWith('Bearer ')) return false
  return isAuthorized(auth.slice(7))
}

// ── CORS：仅配置的来源可跨域；未配置则不开放跨域 ──
function corsHeadersFor(req: http.IncomingMessage): Record<string, string> {
  const origin = req.headers['origin'] as string | undefined
  if (allowedOrigin && origin && origin === allowedOrigin) {
    return {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    }
  }
  return {} // 未配置/不匹配来源：不返回 CORS 头（浏览器跨域被拦）
}

// ── 安全响应头 ──
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
}

// ── 计算量限制（防算法放大攻击：超大图/超深 BFS 打满 CPU） ──
const MAX_ARRAY_ITEMS = 5000 // edges/candidates/memories 等数组上限
const MAX_DEPTH = 8          // BFS 深度服务端硬上限

function sanitizeParams(params: unknown): { ok: boolean; reason?: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, reason: 'invalid params' }
  }
  const p = params as Record<string, unknown>
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v) && v.length > MAX_ARRAY_ITEMS) {
      return { ok: false, reason: `param "${k}" exceeds ${MAX_ARRAY_ITEMS} items` }
    }
  }
  // 深度参数服务端钳制（不信任客户端）
  if (typeof p.max_depth === 'number' && p.max_depth > MAX_DEPTH) p.max_depth = MAX_DEPTH
  if (typeof p.max_hops === 'number' && p.max_hops > 5) p.max_hops = 5
  return { ok: true }
}

async function main() {
  await initServer()

  // ── 后台调度：仅 Hebbian 关联加载（识别器运行在客户端本地） ──
  try {
    const { initMemoryAssociations } = await import('./association.js')
    initMemoryAssociations()
  } catch (e) { console.error('[记忆感知] Hebbian 关联加载失败:', (e as Error)?.message) }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const cors = corsHeadersFor(req)
    const headers = { ...cors, ...SECURITY_HEADERS }

    // 管理面板路由（/admin*）
    if (req.url?.startsWith('/admin')) {
      const { handleAdmin } = await import('./admin-panel.js')
      if (await handleAdmin(req, res, new URL(req.url, 'http://localhost'))) return
    }

    // CORS 预检
    if (req.method === 'OPTIONS') {
      if (!cors['access-control-allow-origin']) {
        res.writeHead(403, headers); res.end(); return
      }
      res.writeHead(204, headers); res.end(); return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, headers)
      res.end('Method not allowed')
      return
    }

    // 速率限制（普通请求）
    const ip = requesterIp(req)
    if (!checkRateLimit(ip, false)) {
      res.writeHead(429, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32000, message: 'Too Many Requests' },
      }))
      return
    }

    // 鉴权（失败计入限流，防爆破）
    if (!checkAuth(req)) {
      checkRateLimit(ip, true)
      res.writeHead(401, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Unauthorized' },
      }))
      return
    }

    // 配额消费（鉴权通过后；超限返回 429）
    const authToken = (req.headers['authorization'] || '').slice(7)
    if (consumeQuota(authToken) < 0) {
      res.writeHead(429, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32002, message: 'Daily quota exceeded' },
      }))
      return
    }

    try {
      // 请求体大小限制：1MB
      const MAX_BODY = 1024 * 1024
      const buffers: Buffer[] = []
      let totalBytes = 0
      for await (const chunk of req) {
        totalBytes += chunk.length
        if (totalBytes > MAX_BODY) {
          res.writeHead(413, { ...headers, 'content-type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: null,
            error: { code: -32600, message: 'Request body too large (max 1MB)' },
          }))
          return
        }
        buffers.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(buffers).toString('utf-8'))

      // 参数安全检查（计算量钳制）
      if (body?.params && !sanitizeParams(body.params).ok) {
        res.writeHead(400, { ...headers, 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: null,
          error: { code: -32602, message: 'Invalid params' },
        }))
        return
      }

      const resp = await handleRequest(body)
      if (!resp) {
        res.writeHead(202, headers)
        res.end()
        return
      }
      res.writeHead(200, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify(resp))
    } catch {
      // 错误脱敏：不向客户端泄露内部异常细节
      res.writeHead(400, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Bad Request' },
      }))
    }
  }

  if (USE_HTTPS) {
    https.createServer({
      key: readFileSync(SSL_KEY),
      cert: readFileSync(SSL_CERT),
    }, handler).listen(port, () => {
      console.error(`[记忆感知] HTTPS Server 已启动，端口: ${port}`)
    })
  } else {
    console.error('═' .repeat(55))
    console.error('  警告: 以 HTTP 模式启动，API key 和数据明文传输！')
    console.error('  生产环境必须启用 HTTPS（设置 SSL_KEY + SSL_CERT）或使用 Nginx/Caddy 终止 TLS')
    console.error('═' .repeat(55))
    http.createServer(handler).listen(port, () => {
      console.error(`[记忆感知] HTTP Server 已启动，端口: ${port}`)
    })
  }
}

main()
