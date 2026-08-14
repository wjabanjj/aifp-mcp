// @deploy server — 运营方管理面板（生成/吊销 key、查看用量）
/**
 * 路由（挂载在 server.ts 同端口）：
 *   GET  /admin            — 管理页面（HTML）
 *   POST /admin/login      — 登录（COGNITION_ADMIN_PASSWORD）
 *   GET  /admin/api/keys   — key 列表（需登录）
 *   POST /admin/api/keys   — 生成 key { username, days, quotaPerDay }（需登录）
 *   POST /admin/api/keys/revoke — 吊销 { username }（需登录）
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { createHash, randomBytes } from 'crypto'
import { listKeys, createKey, revokeKey } from './server-keys.js'

const ADMIN_PASSWORD = process.env['COGNITION_ADMIN_PASSWORD'] || ''

/** 简单会话 token（登录后发放，内存态，重启失效需重新登录） */
const sessions = new Map<string, number>() // token → 过期时间(ms)
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 小时

function newSession(): string {
  const token = randomBytes(24).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  return token
}

function isSessionValid(token: string | undefined): boolean {
  if (!token) return false
  const exp = sessions.get(token)
  if (!exp) return false
  if (Date.now() > exp) { sessions.delete(token); return false }
  return true
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')) }
      catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AiFP 密钥管理</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 16px;background:#0f1420;color:#e6e9f0}
  h1{font-size:20px}.card{background:#1a2130;border:1px solid #2a3348;border-radius:10px;padding:20px;margin:16px 0}
  input,select,button{font-size:14px;padding:8px 12px;border-radius:6px;border:1px solid #3a4660;background:#141b2a;color:#e6e9f0;margin:4px}
  button{cursor:pointer;background:#2f6feb}.btn-danger{background:#c0392b}
  table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #2a3348;text-align:left;word-break:break-all}
  .ok{color:#4caf50}.expired{color:#e74c3c}.copy{cursor:pointer;color:#2f6feb}
  .hidden{display:none}.kv{background:#0d1220;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap}
</style>
</head>
<body>
<h1>🧠 AiFP 记忆感知 — 密钥管理</h1>
<div id="login" class="card">
  <input type="password" id="pw" placeholder="管理密码">
  <button onclick="login()">登录</button>
</div>
<div id="panel" class="hidden">
  <div class="card">
    <h2>生成新密钥</h2>
    <input id="username" placeholder="用户名（如 张三）">
    <input id="days" type="number" min="1" max="365" value="30" style="width:80px"> 天
    <input id="quota" type="number" min="0" value="2000" style="width:100px"> 每日调用上限
    <button onclick="createKey()">生成并发放</button>
    <div id="issued" class="kv hidden"></div>
  </div>
  <div class="card">
    <h2>已发放密钥（<span id="count">0</span>）</h2>
    <table><thead><tr><th>用户</th><th>Key</th><th>到期</th><th>今日用量</th><th>状态</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table>
  </div>
</div>
<script>
let token = sessionStorage.getItem('aifp_admin_token') || '';
if (token) { showPanel(); loadKeys(); }
async function api(path, opts={}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json', ...(token?{authorization:'Bearer '+token}:{}) }, ...opts });
  const j = await r.json().catch(()=>({}));
  if (r.status === 401 && path !== '/admin/login') { sessionStorage.removeItem('aifp_admin_token'); location.reload(); }
  return j;
}
async function login() {
  const pw = document.getElementById('pw').value;
  const j = await api('/admin/login', { method:'POST', body: JSON.stringify({ password: pw }) });
  if (j.token) { token = j.token; sessionStorage.setItem('aifp_admin_token', token); showPanel(); loadKeys(); }
  else alert(j.error || '登录失败');
}
function showPanel(){ document.getElementById('login').classList.add('hidden'); document.getElementById('panel').classList.remove('hidden'); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function createKey() {
  const username = document.getElementById('username').value.trim();
  const days = parseInt(document.getElementById('days').value) || 30;
  const quota = parseInt(document.getElementById('quota').value) || 2000;
  if (!username) return alert('填用户名');
  const j = await api('/admin/api/keys', { method:'POST', body: JSON.stringify({ username, days, quotaPerDay: quota }) });
  if (j.key) {
    document.getElementById('issued').classList.remove('hidden');
    document.getElementById('issued').textContent = '发给用户（2 行）：\nCOGNITION_MODE=remote\nCOGNITION_SERVER_URL=https://<你的域名>\nCOGNITION_API_KEY=' + j.key + '\n有效期至: ' + j.expiresAt;
    loadKeys();
  } else alert(j.error || '生成失败');
}
async function loadKeys() {
  const j = await api('/admin/api/keys');
  if (!j.keys) return;
  document.getElementById('count').textContent = j.keys.length;
  document.getElementById('rows').innerHTML = j.keys.map(k => {
    const expired = new Date(k.expiresAt).getTime() < Date.now();
    return '<tr><td>'+esc(k.user)+'</td><td><span class="copy" onclick="navigator.clipboard.writeText(\\''+esc(k.key)+'\\')">'+esc(k.key.slice(0,8))+'…</span></td><td>'+esc(k.expiresAt)+'</td><td>'+k.usedToday+'/'+k.quotaPerDay+'</td><td class="'+(expired?'expired':'ok')+'">'+(expired?'已过期':'有效')+'</td><td><button class="btn-danger" onclick="revoke(\\''+esc(k.user)+'\\')">吊销</button></td></tr>';
  }).join('');
}
async function revoke(username) {
  if (!confirm('吊销 '+username+' ？立即生效')) return;
  await api('/admin/api/keys/revoke', { method:'POST', body: JSON.stringify({ username }) });
  loadKeys();
}
</script>
</body>
</html>`

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/admin')) return false

  // 管理面板未配置密码 → 拒绝
  if (!ADMIN_PASSWORD) {
    json(res, 503, { error: '管理面板未启用：服务器需设置 COGNITION_ADMIN_PASSWORD' })
    return true
  }

  // 页面
  if (req.method === 'GET' && url.pathname === '/admin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(PAGE_HTML)
    return true
  }

  // 登录
  if (req.method === 'POST' && url.pathname === '/admin/login') {
    const body = await readBody(req).catch(() => ({}))
    const pwd = String(body.password || '')
    const givenHash = createHash('sha256').update(pwd).digest('hex')
    const expectHash = createHash('sha256').update(ADMIN_PASSWORD).digest('hex')
    if (givenHash !== expectHash) { json(res, 401, { error: '密码错误' }); return true }
    json(res, 200, { token: newSession() })
    return true
  }

  // 以下 API 需登录
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '')
  if (!isSessionValid(auth)) { json(res, 401, { error: '未登录或会话过期' }); return true }

  if (req.method === 'GET' && url.pathname === '/admin/api/keys') {
    json(res, 200, { keys: listKeys() })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/keys') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    const days = Math.min(Math.max(parseInt(String(body.days)) || 30, 1), 365)
    const quotaPerDay = Math.min(Math.max(parseInt(String(body.quotaPerDay)) || 2000, 0), 100000)
    if (!username) { json(res, 400, { error: '缺少用户名' }); return true }
    const r = createKey(username, days, quotaPerDay)
    if (!r) { json(res, 409, { error: '用户已存在' }); return true }
    json(res, 200, r)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/admin/api/keys/revoke') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    if (!revokeKey(username)) { json(res, 404, { error: '用户不存在' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  json(res, 404, { error: 'not found' })
  return true
}
