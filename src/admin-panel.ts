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
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { listKeys, createKey, revokeKey, renewKey, updateQuota } from './server-keys.js'

const ADMIN_PASSWORD = process.env['COGNITION_ADMIN_PASSWORD'] || ''

// ── 管理密码持久化：admin.json（与 keys.json 同目录），修改后重启不丢 ──
// 存储格式：{ salt, hash } — scrypt 加盐哈希（抗离线破解）；env 初始密码用 sha256 兼容
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { resolve } from 'path'

function adminFile(): string {
  const keysFile = process.env['COGNITION_KEYS_FILE'] || resolve(process.cwd(), 'keys.json')
  return join(dirname(keysFile), 'admin.json')
}

interface AdminAuth { salt: string; hash: string } // hash 为 scrypt(pwd, salt, 32) hex

/** 当前生效的管理密码（文件优先，其次环境变量）；null = 未启用 */
function currentAdminAuth(): AdminAuth | null {
  try {
    const f = adminFile()
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, 'utf-8'))
      if (j && typeof j.salt === 'string' && typeof j.hash === 'string' && j.hash.length === 64) {
        return { salt: j.salt, hash: j.hash }
      }
    }
  } catch { /* 文件损坏则回退 env */ }
  if (ADMIN_PASSWORD) {
    // env 初始密码：sha256（兼容旧部署）；首次改密后转为 scrypt 存文件
    return { salt: '', hash: createHash('sha256').update(ADMIN_PASSWORD).digest('hex') }
  }
  return null
}

function hashPassword(pwd: string, salt: string): string {
  return scryptSync(pwd, salt, 32).toString('hex')
}

function verifyPassword(pwd: string, auth: AdminAuth): boolean {
  if (!pwd) return false
  if (auth.salt) {
    const derived = hashPassword(pwd, auth.salt)
    const a = Buffer.from(auth.hash, 'hex')
    const b = Buffer.from(derived, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }
  // env 初始（sha256）路径
  return createHash('sha256').update(pwd).digest('hex') === auth.hash
}

function persistAdminAuth(salt: string, hash: string): void {
  mkdirSync(dirname(adminFile()), { recursive: true })
  writeFileSync(adminFile(), JSON.stringify({ salt, hash, updatedAt: Date.now() }, null, 2) + '\n', 'utf-8')
}

// ── 登录失败锁定（防暴力破解）：每 IP 最多错 2 次，第 3 次直接锁 IP（连页面都打不开） ──
const loginFails = new Map<string, { count: number; lockedUntil: number }>()
const LOGIN_FAIL_LIMIT = 2        // 允许 2 次错误
const IP_LOCK_MS = 60 * 60 * 1000  // 锁定 1 小时

function clientIp(req: IncomingMessage): string {
  // nginx 反代后 remoteAddress 是内网地址，必须用 x-forwarded-for
  const fwd = (req.headers['x-forwarded-for'] as string) || ''
  return fwd.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
}

/** 该 IP 是否被锁定（锁定期间整个管理面板不可访问） */
function isIpLocked(ip: string): boolean {
  const e = loginFails.get(ip)
  if (!e) return false
  if (e.lockedUntil > Date.now()) return true
  if (e.lockedUntil > 0) loginFails.delete(ip) // 仅清除过期锁定，保留未锁定计数
  return false
}

/** 记录一次失败；第 3 次（>2）触发锁 IP，返回 true */
function recordLoginFail(ip: string): boolean {
  const now = Date.now()
  const e = loginFails.get(ip)
  if (e && e.lockedUntil > now) return true // 已锁定
  const count = (e && e.lockedUntil === 0 ? e.count : 0) + 1
  if (count > LOGIN_FAIL_LIMIT) {
    loginFails.set(ip, { count, lockedUntil: now + IP_LOCK_MS })
    console.error('[管理面板] IP ' + ip + ' 因多次密码错误被锁定（' + new Date(now + IP_LOCK_MS).toLocaleString() + ' 解锁）')
    return true // 第 3 次失败 → 锁 IP
  }
  loginFails.set(ip, { count, lockedUntil: 0 })
  return false
}

function clearLoginFails(ip: string): void {
  loginFails.delete(ip)
}

// 定期清理过期锁定（防内存增长）
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of loginFails) if (v.lockedUntil > 0 && v.lockedUntil < now) loginFails.delete(k)
  if (loginFails.size > 5000) loginFails.clear()
}, 60000).unref()

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
  body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 16px;background:#0f1420;color:#e6e9f0}
  h1{font-size:20px}.card{background:#1a2130;border:1px solid #2a3348;border-radius:10px;padding:20px;margin:16px 0}
  input,select{padding:8px 12px;border-radius:6px;border:1px solid #3a4660;background:#141b2a;color:#e6e9f0;margin:4px}
  button{cursor:pointer;background:#2f6feb;color:#e6e9f0;border:none;border-radius:6px}
  /* 小按钮：缩小字号内边距，淡色背景 */
  button.mini{font-size:11px;padding:2px 8px;border-radius:4px;background:#2a3348;color:#9aa7bd;margin:0 2px}
  button.mini:hover{background:#3a4660;color:#e6e9f0}
  .btn-danger{background:#c0392b}.btn-danger.mini{background:#4a2530;color:#d98a8a}
  .btn-danger.mini:hover{background:#6b3440;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #2a3348;text-align:left;word-break:break-all}
  .ok{color:#4caf50}.expired{color:#e74c3c}.copy{cursor:pointer;color:#2f6feb}
  .keycell{cursor:pointer;color:#2f6feb;text-decoration:underline}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}
  .modal-card{background:#1a2130;border:1px solid #3a4660;border-radius:12px;padding:24px;max-width:560px;width:90%}
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
    <input id="quota" type="number" min="0" value="3000" style="width:100px"> 每日调用上限
    <button onclick="createKey()">生成并发放</button>
    <button class="mini" onclick="showPwdModal()">修改管理密码</button>
    <div id="issued" class="kv hidden"></div>
  </div>
  <div id="pwdModal" class="modal hidden" onclick="if(event.target===this)closePwdModal()">
    <div class="modal-card">
      <h2>修改管理密码</h2>
      <input type="password" id="oldPwd" placeholder="旧密码" style="width:100%">
      <input type="password" id="newPwd" placeholder="新密码（至少 6 位）" style="width:100%;margin-top:6px">
      <div style="margin-top:10px"><button onclick="changePwd()">确认修改</button> <button class="mini" onclick="closePwdModal()">取消</button></div>
    </div>
  </div>
  <div class="card">
    <h2>已发放密钥（<span id="count">0</span>）</h2>
    <input id="search" placeholder="搜索用户名 / key…" oninput="renderTable()" style="width:100%;margin-bottom:10px">
    <table><thead><tr><th>用户</th><th>Key</th><th>到期（可续期）</th><th>用量（可改）</th><th>状态</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table>
  </div>
  <div id="modal" class="modal hidden" onclick="if(event.target===this)closeModal()">
    <div class="modal-card">
      <h2>完整 Key</h2>
      <p>用户：<span id="modal-user"></span></p>
      <p>到期：<span id="modal-expire"></span></p>
      <code id="modal-key" style="display:block;word-break:break-all;background:#0d1220;padding:12px;border-radius:6px;margin:10px 0"></code>
      <button onclick="copyModalKey()">复制完整 Key</button>
      <button onclick="closeModal()">关闭</button>
    </div>
  </div>
</div>
<script>
let token = sessionStorage.getItem('aifp_admin_token') || '';
if (token) { showPanel(); loadKeys(); }
async function api(path, opts={}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json', ...(token?{authorization:'Bearer '+token}:{}) }, ...opts });
  const j = await r.json().catch(()=>({}));
  if (r.status === 401 && path !== 'mm/login') { sessionStorage.removeItem('aifp_admin_token'); location.reload(); }
  return j;
}
async function login() {
  const pw = document.getElementById('pw').value;
  const j = await api('mm/login', { method:'POST', body: JSON.stringify({ password: pw }) });
  if (j.token) { token = j.token; sessionStorage.setItem('aifp_admin_token', token); showPanel(); loadKeys(); }
  else alert(j.error || '登录失败');
}
function showPanel(){ document.getElementById('login').classList.add('hidden'); document.getElementById('panel').classList.remove('hidden'); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function createKey() {
  const username = document.getElementById('username').value.trim();
  const days = parseInt(document.getElementById('days').value) || 30;
  const quota = parseInt(document.getElementById('quota').value) || 3000;
  if (!username) return alert('填用户名');
  const j = await api('mm/api/keys', { method:'POST', body: JSON.stringify({ username, days, quotaPerDay: quota }) });
  if (j.key) {
    document.getElementById('issued').classList.remove('hidden');
    document.getElementById('issued').textContent = '发给用户（2 行）：\\nCOGNITION_MODE=remote\\nCOGNITION_SERVER_URL=https://<你的域名>\\nCOGNITION_API_KEY=' + j.key + '\\n有效期至: ' + j.expiresAt;
    loadKeys();
  } else alert(j.error || '生成失败');
}
async function loadKeys() {
  const j = await api('mm/api/keys');
  if (!j.keys) return;
  allKeys = j.keys;
  document.getElementById('count').textContent = j.keys.length;
  renderTable();
}
let allKeys = [];
function renderTable() {
  const q = (document.getElementById('search')?.value || '').toLowerCase();
  const list = allKeys.filter(k => !q || k.user.toLowerCase().includes(q) || k.key.toLowerCase().includes(q));
  document.getElementById('rows').innerHTML = list.map(k => {
    const expired = new Date(k.expiresAt).getTime() < Date.now();
    const expireStr = new Date(k.expiresAt).toISOString().slice(0, 10);
    return '<tr><td>'+esc(k.user)+'</td>'
      + '<td><code class="keycell" data-user="'+esc(k.user)+'" onclick="showKey(this)">'+esc(k.key.slice(0,12))+'…</code> <button class="mini" data-key="'+esc(k.key)+'" onclick="copyKey(this)">复制</button></td>'
      + '<td>'+esc(expireStr)+' <button class="mini" data-user="'+esc(k.user)+'" onclick="renew(this)">续期</button></td>'
      + '<td>'+k.usedToday+'/'+k.quotaPerDay+' <button class="mini" data-user="'+esc(k.user)+'" onclick="setQuota(this)">改</button></td>'
      + '<td class="'+(expired?'expired':'ok')+'">'+(expired?'已过期':'有效')+'</td>'
      + '<td><button class="btn-danger mini" data-user="'+esc(k.user)+'" onclick="revoke(this)">吊销</button></td></tr>';
  }).join('') || '<tr><td colspan="6">无匹配</td></tr>';
}
async function copyKey(btn) {
  const key = btn.dataset.key;
  try { await navigator.clipboard.writeText(key); alert('已复制完整 key'); }
  catch { prompt('复制 key（手动复制）:', key); }
}
function showKey(btn) {
  const k = allKeys.find(x => x.user === btn.dataset.user);
  if (!k) return;
  document.getElementById('modal-user').textContent = k.user;
  document.getElementById('modal-key').textContent = k.key;
  document.getElementById('modal-expire').textContent = new Date(k.expiresAt).toISOString().slice(0, 10);
  document.getElementById('modal').classList.remove('hidden');
}
async function copyModalKey() {
  const key = document.getElementById('modal-key').textContent;
  try { await navigator.clipboard.writeText(key); alert('已复制'); }
  catch { prompt('手动复制:', key); }
}
async function renew(btn) {
  const username = btn.dataset.user;
  const days = prompt('续期天数（默认 30）:', '30');
  if (!days) return;
  await api('admin/api/keys/renew', { method:'POST', body: JSON.stringify({ username, days: parseInt(days) || 30 }) });
  loadKeys();
}
async function setQuota(btn) {
  const username = btn.dataset.user;
  const k = allKeys.find(x => x.user === username);
  const q = prompt('每日调用上限（0=不限）：', String(k ? k.quotaPerDay : 0));
  if (q === null) return;
  await api('admin/api/keys/quota', { method:'POST', body: JSON.stringify({ username, quotaPerDay: parseInt(q) || 0 }) });
  loadKeys();
}
async function revoke(btn) {
  const username = btn.dataset.user;
  if (!confirm('吊销 '+username+' ？立即生效')) return;
  await api('admin/api/keys/revoke', { method:'POST', body: JSON.stringify({ username }) });
  loadKeys();
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
function showPwdModal() { document.getElementById('pwdModal').classList.remove('hidden'); document.getElementById('oldPwd').value=''; document.getElementById('newPwd').value=''; }
function closePwdModal() { document.getElementById('pwdModal').classList.add('hidden'); }
async function changePwd() {
  const oldPassword = document.getElementById('oldPwd').value;
  const newPassword = document.getElementById('newPwd').value;
  if (newPassword.length < 6) return alert('新密码至少 6 位');
  const j = await api('mm/api/password', { method:'POST', body: JSON.stringify({ oldPassword, newPassword }) });
  if (j.ok) { alert('密码已修改'); closePwdModal(); }
  else alert(j.error || '修改失败');
}
</script>
</body>
</html>`

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/mm')) return false

  // 锁定检查：锁定期内整个管理面板不可访问（连页面都打不开）
  const ip = clientIp(req)
  if (isIpLocked(ip)) {
    json(res, 403, { error: '该 IP 已被锁定' })
    return true
  }

  // 管理面板未配置密码 → 拒绝
  const adminAuth = currentAdminAuth()
  if (!adminAuth) {
    json(res, 503, { error: '管理面板未启用：服务器需设置 COGNITION_ADMIN_PASSWORD' })
    return true
  }

  // 页面
  if (req.method === 'GET' && url.pathname === '/mm') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(PAGE_HTML)
    return true
  }

  // 登录（2 次错误后第 3 次锁 IP）
  if (req.method === 'POST' && url.pathname === '/mm/login') {
    const body = await readBody(req).catch(() => ({}))
    const pwd = String(body.password || '')
    if (!verifyPassword(pwd, adminAuth)) {
      if (recordLoginFail(ip)) {
        json(res, 403, { error: '该 IP 已被锁定' }); return true
      }
      json(res, 401, { error: '密码错误' }); return true
    }
    clearLoginFails(ip) // 成功后清零
    json(res, 200, { token: newSession() })
    return true
  }

  // 以下 API 需登录
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '')
  if (!isSessionValid(auth)) { json(res, 401, { error: '未登录或会话过期' }); return true }

  if (req.method === 'GET' && url.pathname === '/mm/api/keys') {
    json(res, 200, { keys: listKeys() })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/mm/api/keys') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    const days = Math.min(Math.max(parseInt(String(body.days)) || 30, 1), 365)
    const quotaPerDay = Math.min(Math.max(parseInt(String(body.quotaPerDay)) || 3000, 0), 100000)
    if (!username) { json(res, 400, { error: '缺少用户名' }); return true }
    const r = createKey(username, days, quotaPerDay)
    if (!r) { json(res, 409, { error: '用户已存在' }); return true }
    json(res, 200, r)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/mm/api/keys/revoke') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    if (!revokeKey(username)) { json(res, 404, { error: '用户不存在' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/mm/api/keys/renew') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    const days = Math.min(Math.max(parseInt(String(body.days)) || 30, 1), 365)
    const r = renewKey(username, days)
    if (!r) { json(res, 404, { error: '用户不存在' }); return true }
    json(res, 200, { ...r, days })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/mm/api/keys/quota') {
    const body = await readBody(req).catch(() => ({}))
    const username = String(body.username || '').trim()
    const quotaPerDay = Math.min(Math.max(parseInt(String(body.quotaPerDay)) || 0, 0), 100000)
    const r = updateQuota(username, quotaPerDay)
    if (!r) { json(res, 404, { error: '用户不存在' }); return true }
    json(res, 200, r)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/mm/api/password') {
    const body = await readBody(req).catch(() => ({}))
    const oldPwd = String(body.oldPassword || '')
    const newPwd = String(body.newPassword || '')
    if (!verifyPassword(oldPwd, adminAuth)) { json(res, 401, { error: '旧密码错误' }); return true }
    if (newPwd.length < 6) { json(res, 400, { error: '新密码至少 6 位' }); return true }
    const salt = randomBytes(16).toString('hex')
    persistAdminAuth(salt, hashPassword(newPwd, salt))
    json(res, 200, { ok: true, message: '密码已修改' })
    return true
  }

  json(res, 404, { error: 'not found' })
  return true
}
