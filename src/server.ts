// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * AiFP 记忆感知系统 — HTTP 传输层（安全版）
 * 支持 HTTPS、API 密钥鉴权、速率限制
 */

import http from 'http'
import https from 'https'
import { readFileSync, existsSync } from 'fs'
import { handleRequest, initServer } from './mcp-enhanced.js'

const {
  port,
  apiKey,
  allowedOrigin,
  rateLimitPerMinute,
} = (await import('./config.js')).config

const SSL_KEY = process.env['SSL_KEY'] || ''
const SSL_CERT = process.env['SSL_CERT'] || ''
const USE_HTTPS = !!(SSL_KEY && SSL_CERT)

// ── 速率限制 ──
const requestCounts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = requestCounts.get(ip)
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60000 })
    return true
  }
  if (entry.count >= rateLimitPerMinute) return false
  entry.count++
  return true
}

function requesterIp(req: http.IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'unknown'
}

// ── 鉴权 ──
function checkAuth(req: http.IncomingMessage): boolean {
  if (!apiKey) return true // 未设 key 不鉴权（兼容已有部署）
  const auth = req.headers['authorization'] || ''
  return auth === `Bearer ${apiKey}` // 只接受 Bearer 格式
}

const corsHeaders: Record<string, string> = {
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}
if (allowedOrigin) {
  corsHeaders['access-control-allow-origin'] = allowedOrigin
} else {
  corsHeaders['access-control-allow-origin'] = '*'
}

async function main() {
  await initServer()

  // ── 后台调度：仅 Hebbian 关联加载（识别器运行在客户端本地） ──
  try {
    const { initMemoryAssociations } = await import('./association.js')
    initMemoryAssociations()
  } catch (e) { console.error('[记忆感知] Hebbian 关联加载失败:', (e as Error)?.message) }

  // 周期整理：每 30 分钟跑一轮（巩固+衰减+去重+成长箱+批量关联）
  const CONSOLIDATE_INTERVAL_MS = 30 * 60 * 1000
  let consolidateRunning = false
  const runConsolidateOnce = async (label: string) => {
    if (consolidateRunning) return
    consolidateRunning = true
    try {
      const { runConsolidateCycle } = await import('./consolidator.js')
      const r = await runConsolidateCycle()
      const total = r.promoted + r.decayed + r.deduped + r.ironEscalated + r.ironMerged + r.batchLinked
      if (total > 0) {
        console.error(`[记忆感知] ${label}整理完成: 晋升${r.promoted} 衰减${r.decayed} 去重${r.deduped} 铁律${r.ironEscalated}+${r.ironMerged} 关联${r.batchLinked}`)
      }
    } catch (e) { console.error('[记忆感知] 整理失败:', (e as Error)?.message) }
    finally { consolidateRunning = false }
  }
  setTimeout(() => runConsolidateOnce('启动'), 60 * 1000)  // 启动 1 分钟后跑一次
  setInterval(() => runConsolidateOnce('周期'), CONSOLIDATE_INTERVAL_MS)


  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders)
      res.end('Method not allowed')
      return
    }

    // 速率限制
    const ip = requesterIp(req)
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { ...corsHeaders, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32000, message: 'Too Many Requests' },
      }))
      return
    }

    // 鉴权
    if (!checkAuth(req)) {
      res.writeHead(401, { ...corsHeaders, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Unauthorized: invalid or missing API key' },
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
          res.writeHead(413, { ...corsHeaders, 'content-type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: null,
            error: { code: -32600, message: 'Request body too large (max 1MB)' },
          }))
          return
        }
        buffers.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(buffers).toString('utf-8'))
      const resp = await handleRequest(body)
      if (!resp) {
        res.writeHead(202, corsHeaders)
        res.end()
        return
      }
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' })
      res.end(JSON.stringify(resp))
    } catch (err: any) {
      res.writeHead(400, { ...corsHeaders, 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32700, message: err.message },
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
    console.error('  警告: 以 HTTP 模式启动，所有数据明文传输！')
    console.error('  生产环境请设置 SSL_KEY + SSL_CERT 环境变量启用 HTTPS')
    console.error('  或使用反向代理（nginx/Caddy）终止 TLS')
    console.error('═' .repeat(55))
    http.createServer(handler).listen(port, () => {
      console.error(`[记忆感知] HTTP Server 已启动，端口: ${port}`)
    })
  }
}

main()
