// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * AiFP 记忆感知系统 — 数据库层
 * SQLite + FTS5 全文搜索 + CJK 分词
 *
 * 移植自 aifp-web memory-db.ts + schema
 * 移除 aifp-web 特定依赖，适配独立运行
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'fs'
import { config } from './config.js'
import { extractEntities } from './entity-extractor.js'
import { getPinyinTerms } from './pinyin.js'

// ── 单例 DB ──

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true })
  }

  _db = new DatabaseSync(config.dbPath)
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA busy_timeout=5000') // 多 AI 工具进程并发写时等待而非报锁
  _db.exec('PRAGMA foreign_keys=ON')
  initSchema(_db)
  return _db
}

// ── Schema ──

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      detail TEXT DEFAULT '',
      title TEXT DEFAULT '',
      mem_id TEXT,
      entities TEXT DEFAULT '[]',
      tags TEXT DEFAULT '',
      salience INTEGER DEFAULT 3,
      visibility INTEGER NOT NULL DEFAULT 1,
      embedding TEXT DEFAULT '',
      usage_count INTEGER DEFAULT 0,
      session_id TEXT DEFAULT '',
      parent_id TEXT DEFAULT NULL,
      node_type TEXT DEFAULT 'leaf',
      tier TEXT DEFAULT 'episodic',
      importance REAL DEFAULT 0.3,
      perspective TEXT DEFAULT 'owner_trait',
      location TEXT DEFAULT '',
      domain TEXT DEFAULT 'personal',
      agent_id TEXT DEFAULT '',
      cross_agent_share INTEGER DEFAULT 0,
      project TEXT DEFAULT '',
      round INTEGER DEFAULT 0,
      hidden_at TEXT,
      merged_into TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS perception_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK(relation_type IN ('LEADS_TO','BECAUSE_OF','ENABLES','PREVENTS','RESPONSE_TO','CO_OCCURS_WITH')),
      confidence REAL NOT NULL DEFAULT 0.5,
      explanation TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_perception_source ON perception_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_perception_target ON perception_links(target_id);
    CREATE INDEX IF NOT EXISTS idx_perception_type ON perception_links(relation_type);

    CREATE TABLE IF NOT EXISTS memory_associations (
      user_id TEXT NOT NULL,
      mem_a TEXT NOT NULL,
      mem_b TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, mem_a, mem_b)
    );

    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Recognizer 待识别队列
    CREATE TABLE IF NOT EXISTS recognition_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_message TEXT NOT NULL,
      session_id TEXT DEFAULT '',
      project TEXT DEFAULT '',
      turn_data_json TEXT DEFAULT '{}',
      guard_signals TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','skipped')),
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_recognition_queue_status ON recognition_queue(status, created_at);

  `)

  // 迁移：确保旧数据库有新增列
  for (const col of ['hidden_at TEXT', 'merged_into TEXT', 'project TEXT DEFAULT \'\'', 'round INTEGER DEFAULT 0', 'injection_count INTEGER DEFAULT 0']) {
    try { db.exec(`ALTER TABLE memories ADD COLUMN ${col}`) } catch {}
  }
  // v1.3 迁移：矛盾检测 + 置信度 + 时效性
  for (const col of [
    'contradicts TEXT DEFAULT \'\'',
    'confidence REAL DEFAULT 0.3',
    'valid_until INTEGER DEFAULT NULL',
  ]) {
    try { db.exec(`ALTER TABLE memories ADD COLUMN ${col}`) } catch {}
  }
  // v1.4 迁移：证据链 + 观察计数
  for (const col of [
    'evidence TEXT DEFAULT \'[]\'',
    'confidence_observation_count INTEGER DEFAULT 0',
  ]) {
    try { db.exec(`ALTER TABLE memories ADD COLUMN ${col}`) } catch {}
  }
  // v1.5 迁移：噪声惩罚计数（注入/落地/纠正三维）
  for (const col of [
    'grounded_count INTEGER DEFAULT 0',
    'correction_hits INTEGER DEFAULT 0',
  ]) {
    try { db.exec(`ALTER TABLE memories ADD COLUMN ${col}`) } catch {}
  }

  // FTS5 全文索引（CJK 友好）
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts5 USING fts5(
      content, detail, title, tags, mem_id,
      tokenize='unicode61'
    )`)
  } catch {
    // 已存在则忽略
  }

  // FTS5 同步触发器
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts5_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
        VALUES (new.rowid, new.content, new.detail, new.title, new.tags, new.mem_id);
      END
    `)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts5_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts5(memories_fts5, rowid) VALUES ('delete', old.rowid);
      END
    `)
    db.exec(`DROP TRIGGER IF EXISTS memories_fts5_update`)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_fts5_update AFTER UPDATE ON memories WHEN
        old.content IS NOT new.content OR
        old.detail IS NOT new.detail OR
        old.title IS NOT new.title OR
        old.tags IS NOT new.tags OR
        old.mem_id IS NOT new.mem_id
      BEGIN
        INSERT OR REPLACE INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
        VALUES (new.rowid, new.content, new.detail, new.title, new.tags, new.mem_id);
      END
    `)

    // 回填已有数据到 FTS5
    const ftsCount = (db.prepare('SELECT COUNT(*) as c FROM memories_fts5').all() as any[])[0]?.c || 0
    const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories').all() as any[])[0]?.c || 0
    if (memCount > 0 && ftsCount < memCount) {
      db.exec(`
        INSERT INTO memories_fts5(rowid, content, detail, title, tags, mem_id)
        SELECT rowid, content, detail, title, tags, mem_id FROM memories
        WHERE rowid NOT IN (SELECT rowid FROM memories_fts5)
      `)
    }

    // FTS5 bigram 迁移：对所有 CJK 内容做 bigram 覆盖（幂等）
    try {
      const bigramDone = db.prepare("SELECT value FROM _meta WHERE key = 'fts5_bigram_v1'").all() as Record<string, unknown>[]
      if (!bigramDone.length) {
        const allRows = db.prepare('SELECT m.id, m.content, m.detail, m.title FROM memories m INNER JOIN memories_fts5 f ON m.rowid = f.rowid').all() as Record<string, unknown>[]
        const patch = db.prepare('UPDATE memories_fts5 SET content = ?, detail = ?, title = ? WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)')
        let patched = 0
        for (const r of allRows) {
          const id = String(r.id || '')
          const content = cjkBigram(String(r.content || ''))
          const detail = cjkBigram(String(r.detail || ''))
          const title = cjkBigram(String(r.title || ''))
          if (id && (content || detail || title)) {
            patch.run(content, detail, title, id)
            patched++
          }
        }
        if (patched > 0) {
          db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('fts5_bigram_v1', '1')").run()
        }
      }
    } catch { /* bigram 迁移失败不影响启动 */ }
  } catch (e) {
    console.warn('[DB] FTS5 触发器创建失败:', (e as Error)?.message)
  }

  // 索引
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_salience ON memories(salience)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_parent ON memories(parent_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entities ON memories(entities)`)
  } catch { /* 忽略重复创建 */ }
}

// ── 工具函数 ──

export interface MemoryRow {
  id: string
  type: string
  content: string
  detail: string
  title: string
  mem_id: string | null
  entities: string
  tags: string
  salience: number
  visibility: number
  embedding: string
  usage_count: number
  injection_count?: number
  session_id: string
  parent_id: string | null
  node_type: string | null
  tier: string | null
  importance: number
  created_at: number
  updated_at: number
  contradicts: string
  confidence: number
  valid_until: number | null
  agent_id: string
  cross_agent_share: number
  evidence: string
  confidence_observation_count: number
  grounded_count?: number
  correction_hits?: number
}

function safeId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
}

const nowMs = () => Date.now()

function queryRows(db: DatabaseSync, sql: string, params: any[] = []): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[]
}

function toMemoryRow(row: Record<string, unknown>): MemoryRow {
  return {
    id: String(row.id),
    type: String(row.type),
    content: String(row.content),
    detail: String(row.detail || ''),
    title: String(row.title || ''),
    mem_id: row.mem_id ? String(row.mem_id) : null,
    entities: String(row.entities || '[]'),
    tags: String(row.tags || ''),
    salience: Number(row.salience ?? 3),
    visibility: Number(row.visibility ?? 1),
    embedding: String(row.embedding || ''),
    usage_count: Number(row.usage_count ?? 0),
    injection_count: Number((row as any).injection_count ?? 0),
    session_id: String(row.session_id || ''),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    node_type: row.node_type ? String(row.node_type) : null,
    tier: row.tier ? String(row.tier) : null,
    importance: Number(row.importance ?? 0.3),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    contradicts: String(row.contradicts || ''),
    confidence: Number(row.confidence ?? 0.3),
    valid_until: row.valid_until ? Number(row.valid_until) : null,
    agent_id: String(row.agent_id || ''),
    cross_agent_share: Number(row.cross_agent_share ?? 0),
    evidence: String((row as any).evidence || '[]'),
    confidence_observation_count: Number((row as any).confidence_observation_count ?? 0),
    grounded_count: Number((row as any).grounded_count ?? 0),
    correction_hits: Number((row as any).correction_hits ?? 0),
  }
}

// ── 矛盾检测（v1.3） ──

/** 中文情感对立词对 */
const OPPOSITION_PAIRS: [string, string[]][] = [
  ['喜欢', ['不喜欢', '讨厌', '厌恶', '憎恶']],
  ['好', ['不好', '差', '坏', '糟糕']],
  ['是', ['不是', '并非', '并非不是']],
  ['要', ['不要', '别']],
  ['会', ['不会', '不可能']],
  ['能', ['不能', '无法']],
  ['有', ['没有', '没']],
  ['支持', ['反对', '不支持']],
  ['同意', ['不同意', '反对']],
  ['对', ['不对', '错', '错误']],
  ['正确', ['错误', '不正确']],
  ['行', ['不行', '不可以']],
  ['可以', ['不可以', '不能', '不行']],
  ['推荐', ['不推荐', '不建议']],
  ['值得', ['不值得', '不值']],
  ['容易', ['难', '困难', '不容易']],
  ['简单', ['复杂', '难', '不简单']],
  ['快', ['慢', '不快']],
  ['多', ['少', '不多']],
  ['大', ['小', '不大']],
  ['高', ['低', '不高']],
  ['新', ['旧', '老', '不新']],
  ['好', ['坏', '不好']],
  ['美', ['丑', '不美']],
  ['真', ['假', '不真']],
  ['懂', ['不懂', '不明白']],
  ['知道', ['不知道', '不懂']],
  ['想', ['不想', '不愿意']],
  ['愿', ['不愿', '不情愿']],
]

// ── CJK Bigram 分词（用于 FTS5 中文检索） ──

/** 将 CJK 连续字符串转为滑动窗口双字词，使 unicode61 能逐词索引 */
function cjkBigram(text: string): string {
  return String(text).replace(/[一-鿿]+/g, m => {
    const grams: string[] = []
    for (let i = 0; i < m.length - 1; i++) grams.push(m.slice(i, i + 2))
    return ' ' + grams.join(' ')
  }).replace(/\s+/g, ' ').trim()
}

/** 写入 FTS5 bigram 内容（每次 memories INSERT/UPDATE 后调用） */
function syncFts5Bigram(id: string, content: string, detail: string, title: string): void {
  try {
    const db = getDb()
    // FTS5 表不支持直接 WHERE id，需要用 rowid 子查询
    const row = (db.prepare('SELECT rowid FROM memories WHERE id = ?').all(id) as Record<string, unknown>[])[0]
    if (row) {
      const rowid = row.rowid as number
      db.prepare(
        'UPDATE memories_fts5 SET content = ?, detail = ?, title = ? WHERE rowid = ?'
      ).run(cjkBigram(content), cjkBigram(detail), cjkBigram(title), rowid)
    }
  } catch { /* FTS5 bigram 同步失败不影响主流程 */ }
}

function checkContradictions(content: string, excludeId?: string): string[] {
  const contradictions: string[] = []
  const keywords = content.replace(/[，。！？、；：""''''【】[\]()（）\d\s]/g, ' ').split(/\s+/).filter(s => s.length >= 2)
  if (!keywords.length) return []

  const similarMemories = searchMemories(keywords.slice(0, 5).join(' '), { limit: 10 })
    .filter(m => m.id !== excludeId)

  for (const mem of similarMemories) {
    for (const [pos, negs] of OPPOSITION_PAIRS) {
      const newHasPos = content.includes(pos)
      const newHasNeg = negs.some(n => content.includes(n))
      const oldHasPos = mem.content.includes(pos)
      const oldHasNeg = negs.some(n => mem.content.includes(n))

      if ((newHasPos && oldHasNeg) || (newHasNeg && oldHasPos)) {
        contradictions.push(mem.id)
        break
      }
    }
  }

  return contradictions
}

// ── CRUD ──

// ── 单值槽位 LWW（"新压旧"） ──
// 语义是"最新一条为准"的槽位：城市/职业/称呼/昵称/出生/作息/目标等。
// 用户说了新值，旧值就作废——同一槽位不能并排多行，否则检索排序会让旧值抢赢（历史 bug）。
// 多值槽位（兴趣/习惯/偏好）不在此列：它们是集合语义，新旧并存是正常的。
// 称呼与昵称是两个不同槽位（称呼=名字/正式称谓，昵称=AI 对他的亲昵叫法），各占一行互不覆盖。
// 各自稳定句柄：称呼 → mem_id='user_identity_name'；昵称 → mem_id='user_identity_nickname'。
// 同义前缀归一单值槽：老家/家乡/籍贯→同槽、出生/生日→同槽，
// 否则同义写法会并存多行，检索时新旧信息打架（LWW 单值语义被破坏）。
const SINGLE_VALUE_SLOTS = [
  '城市', '所在城市', '居住地', '居住城市', '工作地点', '职业',
  '老家', '家乡', '籍贯', '感情状态', '婚姻状况', '感情', '子女', '有娃',
  '居住形态', '居住方式', '作息', '作息时间', '出生', '生日', '出生日期', '出生年月', '出生时间', '年龄', '性别',
  '昵称', '称呼', '名字', '出行方式', '出发时间', '语气', '格式', '目标', '项目路径', '项目位置',
]
const SINGLE_VALUE_SLOT_RE = new RegExp(`^(${SINGLE_VALUE_SLOTS.join('|')})\\s*[|｜：:](.+)$`)
const _SLOT_GROUPS: string[][] = [
  ['老家', '家乡', '籍贯'],
  ['感情状态', '婚姻状况', '感情'],
  ['子女', '有娃'],
  ['居住形态', '居住方式'],
  ['作息时间', '作息'],
  ['出生', '生日', '出生日期', '出生年月', '出生时间'],
  ['所在城市', '居住地', '居住城市', '城市'],
]

/** 查找同槽位已有记忆：命中则覆盖旧值而非新增并行行 */
function findSingleValueSlot(type: string, content: string): { id: string; memId: string | null } | null {
  const slotMatch = content.match(SINGLE_VALUE_SLOT_RE)
  if (!slotMatch) return null
  const slotName = slotMatch[1]
  try {
    const db = getDb()
    // 称呼/名字/昵称 走稳定句柄：句柄优先，其次历史行（legacy 昵称/称呼 合并行归并到称呼槽）
    if (slotName === '称呼' || slotName === '名字' || slotName === '昵称') {
      const canonicalId = slotName === '昵称' ? 'user_identity_nickname' : 'user_identity_name'
      const canonical = queryRows(db, 'SELECT id, mem_id FROM memories WHERE mem_id = ? AND visibility = 1 LIMIT 1', [canonicalId])
      if (canonical.length) return { id: String(canonical[0].id), memId: canonicalId }
      const any = queryRows(db,
        `SELECT id, mem_id FROM memories WHERE (content LIKE ? OR content LIKE ?) AND visibility = 1 ORDER BY updated_at DESC LIMIT 1`,
        [`${slotName}%`, `昵称/称呼%`])
      if (any.length) {
        // legacy 昵称/称呼 合并行归并到称呼槽：改 mem_id，防后续昵称写入误覆盖
        let memId = any[0].mem_id ? String(any[0].mem_id) : null
        if (slotName !== '昵称' && memId === 'user_identity_nickname') {
          db.prepare("UPDATE memories SET mem_id = 'user_identity_name' WHERE id = ?").run(String(any[0].id))
          memId = 'user_identity_name'
        }
        return { id: String(any[0].id), memId }
      }
      return null
    }
    // 同义前缀归一同槽：查组内任一前缀的既有行（老家|西安 可被 家乡|洛阳 覆盖，反之亦然）
    const group = _SLOT_GROUPS.find(g => g.includes(slotName))
    const prefixes = group || [slotName]
    const like = prefixes.map(() => 'content LIKE ?').join(' OR ')
    const params = prefixes.map(p => `${p}%`)
    const rows = queryRows(db,
      `SELECT id, mem_id FROM memories WHERE type = ? AND (${like}) AND visibility = 1 ORDER BY updated_at DESC LIMIT 1`,
      [type, ...params])
    return rows.length ? { id: String(rows[0].id), memId: rows[0].mem_id ? String(rows[0].mem_id) : null } : null
  } catch { return null }
}

// ── AI 输出污染标记（防混流：AI 建议/结论绝不进用户画像） ──
// 识别器把 AI 行为/建议/知识复述打包进 user 记忆时，即使没打 src:ai_advice 标签也拦下——
// AI已=AI行为日志、建议/推荐=AI建议、已理解=AI知识复述。fail-closed：宁可漏记（留在 memories 可检索），
// 也不放混流进身份画像。
// 注意：单信号词（如"推荐"）可能是用户自己的陈述（"推荐一部好电影"），不能直接降级；
// 必须同时满足强信号（AI已/已理解）+ 弱信号（建议/推荐），或连续出现多个弱信号，才判为 AI 污染。
const AI_STRONG_MARKERS = ['AI已', '已理解', 'AI 已', '已为你', '已帮你']
const AI_WEAK_MARKERS = ['建议', '推荐']

export function hasAIContamination(content: string): boolean {
  const strong = AI_STRONG_MARKERS.some(m => content.includes(m))
  const weakCount = AI_WEAK_MARKERS.filter(m => content.includes(m)).length
  // 强信号单独触发；无强信号时需 ≥2 个弱信号才触发（防"推荐一部好电影"误伤）
  return strong || weakCount >= 2
}

export interface SaveMemoryInput {
  type: string
  content: string
  detail?: string
  title?: string
  mem_id?: string
  entities?: string[]
  tags?: string[]
  salience?: number
  session_id?: string
  embedding?: number[]
  parent_id?: string | null
  node_type?: 'branch' | 'leaf'
  tier?: string
  importance?: number
  perspective?: string
  project?: string
  round?: number
  agent_id?: string
  cross_agent_share?: boolean
  confidence?: number
  valid_until?: number | null
}

export function saveMemory(input: SaveMemoryInput): { id: string; action: 'inserted' | 'updated'; existing?: MemoryRow; contradictions?: MemoryRow[] } | null {
  const db = getDb()
  const now = nowMs()

  // 防混流：type='user'（用户画像）且内容带 AI 污染标记 → 降级为 observation，不进画像语义
  // （信息不丢，仍在 memories 可检索，但不污染"用户是谁"的画像事实）
  if (input.type === 'user' && hasAIContamination(input.content)) {
    console.warn('[DB] 防混流：AI 建议内容降级为 observation（不进用户画像）:', input.content.slice(0, 40))
    input = { ...input, type: 'observation' }
    input.tags = [...(input.tags || []), 'src:ai_contaminated']
  }

  // 去重：检查 mem_id 是否已存在
  if (input.mem_id) {
    const existing = queryRows(db, 'SELECT * FROM memories WHERE mem_id = ? AND visibility = 1 LIMIT 1', [input.mem_id])
    if (existing.length > 0) {
      const row = toMemoryRow(existing[0])
      const sets: string[] = ['updated_at = ?']
      const params: any[] = [now]
      if (input.content !== undefined) { sets.push('content = ?'); params.push(input.content) }
      if (input.detail !== undefined) { sets.push('detail = ?'); params.push(input.detail) }
      if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
      if (input.entities !== undefined) { sets.push('entities = ?'); params.push(JSON.stringify(input.entities)) }
      if (input.tags !== undefined) { sets.push('tags = ?'); params.push(input.tags.join(', ')) }
      if (input.salience !== undefined) { sets.push('salience = ?'); params.push(input.salience) }
      if (input.embedding !== undefined) { sets.push('embedding = ?'); params.push(JSON.stringify(input.embedding)) }
      if (input.parent_id !== undefined) { sets.push('parent_id = ?'); params.push(input.parent_id) }
      if (input.node_type !== undefined) { sets.push('node_type = ?'); params.push(input.node_type) }
      if (input.tier !== undefined) { sets.push('tier = ?'); params.push(input.tier) }
      if (input.importance !== undefined) { sets.push('importance = ?'); params.push(input.importance) }
      if (input.perspective !== undefined) { sets.push('perspective = ?'); params.push(input.perspective) }
      if (input.project !== undefined) { sets.push('project = ?'); params.push(input.project) }
      if (input.agent_id !== undefined) { sets.push('agent_id = ?'); params.push(input.agent_id) }
      if (input.cross_agent_share !== undefined) { sets.push('cross_agent_share = ?'); params.push(input.cross_agent_share ? 1 : 0) }
      if (input.confidence !== undefined) { sets.push('confidence = ?'); params.push(input.confidence) }
      if (input.valid_until !== undefined) { sets.push('valid_until = ?'); params.push(input.valid_until ?? null) }

      params.push(input.mem_id)
      db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE mem_id = ?`).run(...params)
      // FTS5 bigram 覆盖（内容变更时）
      if (input.content !== undefined) {
        syncFts5Bigram(row.id, input.content, input.detail || input.content, input.title || row.title)
      }
      // 内容变更时重新自动关联
      if (input.content !== undefined) {
        autoLinkNewMemory(row.id, input.content, input.tags || []).catch(() => {})
      }
      return { id: row.id, action: 'updated', existing: row }
    }
  }

  // 内容去重：检查是否已存在相同内容的记忆
  // lesson/feedback 不做精确内容去重——它们靠成长箱（escalateRepeatedLessons）
  // 周期检测"跨实体重复"并升级铁律，立即合并会丢失重复信号（历史：两条同内容不同实体的教训
  // 被合并成一条，entities 只剩第一个，成长箱永远检测不到重复）
  if (!input.mem_id && input.type !== 'lesson' && input.type !== 'feedback') {
    try {
      const dup = queryRows(db,
        'SELECT * FROM memories WHERE content = ? AND visibility = 1 LIMIT 1',
        [input.content]
      )
      if (dup.length > 0) {
        const row = toMemoryRow(dup[0])
        const sets: string[] = ['updated_at = ?', 'usage_count = usage_count + 1']
        const params: any[] = [now]
        if (input.salience !== undefined && input.salience > row.salience) {
          sets.push('salience = ?'); params.push(input.salience)
        }
        if (input.tags !== undefined && input.tags.length > 0) {
          const merged = [...new Set([...row.tags.split(',').map(t => t.trim()).filter(Boolean), ...input.tags])]
          sets.push('tags = ?'); params.push(merged.join(', '))
        }
        params.push(row.id)
        db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
        autoLinkNewMemory(row.id, input.content, input.tags || []).catch(() => {})
        return { id: row.id, action: 'updated', existing: row }
      }
    } catch { /* 去重检查失败，继续插入 */ }
  }

  // 单值槽位 LWW：同槽位已有记忆 → 覆盖旧值（"新压旧"），不新增并行行
  if (!input.mem_id) {
    const slotMatch = input.content.match(SINGLE_VALUE_SLOT_RE)
    if (slotMatch) {
      const slotHit = findSingleValueSlot(input.type, input.content)
      if (slotHit) {
        const sets: string[] = ['content = ?', 'updated_at = ?']
        const params: any[] = [input.content, now]
        if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
        if (input.detail !== undefined) { sets.push('detail = ?'); params.push(input.detail) }
        if (input.entities !== undefined) { sets.push('entities = ?'); params.push(JSON.stringify(input.entities)) }
        if (input.tags !== undefined) { sets.push('tags = ?'); params.push(input.tags.join(', ')) }
        if (input.salience !== undefined) { sets.push('salience = ?'); params.push(input.salience) }
        if (input.embedding !== undefined) { sets.push('embedding = ?'); params.push(JSON.stringify(input.embedding)) }
        if (input.confidence !== undefined) { sets.push('confidence = ?'); params.push(input.confidence) }
        const where = slotHit.memId ? 'mem_id = ?' : 'id = ?'
        params.push(slotHit.memId || slotHit.id)
        db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE ${where}`).run(...params)
        // FTS5 bigram 覆盖（内容变更时）
        syncFts5Bigram(slotHit.id, input.content, input.detail || input.content, input.title || '')
        return { id: slotHit.id, action: 'updated' }
      }
      // 无历史行：称呼/名字/昵称 新建时打稳定句柄，后续所有路径稳定命中（其他槽位普通插入即可）
      if (slotMatch[1] === '称呼' || slotMatch[1] === '名字' || slotMatch[1] === '昵称') {
        input.mem_id = slotMatch[1] === '昵称' ? 'user_identity_nickname' : 'user_identity_name'
      }
    }
  }

  // 自动提取实体（如未提供则从内容中提取）
  const finalEntities = input.entities && input.entities.length > 0 ? input.entities
    : (() => { try { return extractEntities(input.content + ' ' + (input.title || '')) } catch { return [] } })()

  // 插入
  const id = safeId()
  const memId = input.mem_id || id

  const initialEvidence = JSON.stringify([{
    source_id: id,
    type: input.type || 'unknown',
    summary: (input.content || '').slice(0, 100),
    project: input.project || '',
    timestamp: now,
  }])

  db.prepare(
    `INSERT INTO memories (id, type, content, detail, title, mem_id, entities, tags, salience, session_id, embedding, parent_id, node_type, tier, importance, perspective, project, round, agent_id, cross_agent_share, confidence, valid_until, evidence, confidence_observation_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.type, input.content, input.detail || input.content, input.title || '',
    memId, JSON.stringify(finalEntities || []), (input.tags || []).join(', '),
    input.salience ?? 3, input.session_id || '', input.embedding ? JSON.stringify(input.embedding) : '',
    input.parent_id || null, input.node_type || 'leaf', input.tier || 'episodic', input.importance ?? 0.3,
    input.perspective || 'owner_trait', input.project || '', input.round ?? 0,
    input.agent_id || '', input.cross_agent_share ? 1 : 0, input.confidence ?? 0.3, input.valid_until ?? null,
    initialEvidence, 1, now, now,
  )

  // FTS5 bigram 覆盖（触发器已写入原始内容，改写为 bigram 分词）
  syncFts5Bigram(id, input.content, input.detail || input.content, input.title || '')

  // 保存后自动关联（不阻塞保存）
  autoLinkNewMemory(id, input.content, input.tags || []).catch(() => {})

  // 矛盾检测（不阻塞保存）— 检测到矛盾时建立 PREVENTS 感知链而非降置信度
  try {
    const contradictedIds = checkContradictions(input.content, id)
    for (const cid of contradictedIds) {
      addPerceptionLink(id, cid, 'PREVENTS', 0.7, `与 "${(input.content || '').slice(0, 60)}" 矛盾`)
    }
    if (!contradictedIds.length) {
      nliContradictionCheck(input.content, id).catch(() => {})
    }
  } catch { /* 矛盾检测失败不影响保存 */ }

  return { id, action: 'inserted' }
}

// ── Meta 键值存取（用于跟踪批量关联等一次性操作） ──

export function getMeta(key: string): string | null {
  try {
    const db = getDb()
    const row = db.prepare('SELECT value FROM _meta WHERE key = ?').all(key) as Record<string, unknown>[]
    return row.length ? String(row[0].value) : null
  } catch { return null }
}

export function setMeta(key: string, value: string): void {
  try {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(key, value)
  } catch { /* 元数据写入失败不影响主流程 */ }
}

// ── Recognizer Queue CRUD ──

export interface QueueTurn {
  id?: number
  user_message: string
  session_id?: string
  project?: string
  turn_data_json?: string
  guard_signals?: string
  status: 'pending' | 'processing' | 'done' | 'skipped'
  created_at?: number
  processed_at?: number | null
}

export function enqueueTurn(turn: { user_message: string; session_id?: string; project?: string; guard_signals?: string }): void {
  try {
    const db = getDb()
    const now = Date.now()
    db.prepare(
      `INSERT INTO recognition_queue (user_message, session_id, project, guard_signals, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(turn.user_message, turn.session_id || '', turn.project || '', turn.guard_signals || '', now)
  } catch { /* 队列写入失败不影响主流程 */ }
}

export function countPendingTurns(): number {
  try {
    const db = getDb()
    const row = db.prepare("SELECT COUNT(*) as c FROM recognition_queue WHERE status = 'pending'").all() as Record<string, unknown>[]
    return Number(row[0]?.c ?? 0)
  } catch { return 0 }
}

export function getPendingTurns(limit: number = 10): QueueTurn[] {
  try {
    const db = getDb()
    const rows = db.prepare(
      "SELECT * FROM recognition_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?"
    ).all(limit) as Record<string, unknown>[]
    return rows.map(r => ({
      id: Number(r.id),
      user_message: String(r.user_message || ''),
      session_id: String(r.session_id || ''),
      project: String(r.project || ''),
      guard_signals: String(r.guard_signals || ''),
      status: String(r.status) as QueueTurn['status'],
      created_at: Number(r.created_at),
      processed_at: r.processed_at ? Number(r.processed_at) : null,
    }))
  } catch { return [] }
}

export function markQueueDone(ids: number[]): void {
  if (!ids.length) return
  try {
    const db = getDb()
    const ph = ids.map(() => '?').join(',')
    db.prepare(
      `UPDATE recognition_queue SET status = 'done', processed_at = ? WHERE id IN (${ph})`
    ).run(Date.now(), ...ids)
  } catch { /* 标记完成失败不影响主流程 */ }
}

export function markQueueSkipped(ids: number[]): void {
  if (!ids.length) return
  try {
    const db = getDb()
    const ph = ids.map(() => '?').join(',')
    db.prepare(
      `UPDATE recognition_queue SET status = 'skipped' WHERE id IN (${ph})`
    ).run(...ids)
  } catch { /* 标记跳过失败不影响主流程 */ }
}

/** 清理已处理的队列项（保留最近 1000 条） */
export function cleanQueue(): void {
  try {
    const db = getDb()
    db.exec("DELETE FROM recognition_queue WHERE status IN ('done','skipped') AND id NOT IN (SELECT id FROM recognition_queue WHERE status IN ('done','skipped') ORDER BY id DESC LIMIT 1000)")
  } catch { /* 队列清理失败不影响主流程 */ }
}

export function getMemory(memId: string): MemoryRow | null {
  try {
    const db = getDb()
    const rows = queryRows(db, 'SELECT * FROM memories WHERE (mem_id = ? OR id = ?) AND visibility = 1 LIMIT 1', [memId, memId])
    return rows.length ? toMemoryRow(rows[0]) : null
  } catch { return null }
}

export function countMemories(
  options: {
    type?: string
    tier?: string
    includeHidden?: boolean
  } = {},
): number {
  try {
    const db = getDb()
    const conditions: string[] = [options.includeHidden ? '1=1' : 'visibility = 1']
    const params: unknown[] = []
    if (options.type) { conditions.push('type = ?'); params.push(options.type) }
    if (options.tier) { conditions.push('tier = ?'); params.push(options.tier) }
    const result = db.prepare(
      `SELECT COUNT(*) as c FROM memories WHERE ${conditions.join(' AND ')}`,
    ).all(...params as any) as Record<string, unknown>[]
    return Number(result[0]?.c ?? 0)
  } catch { return 0 }
}

export function listMemories(
  options: {
    type?: string
    tier?: string
    limit?: number
    offset?: number
    includeHidden?: boolean
  } = {},
): MemoryRow[] {
  try {
    const db = getDb()
    const conditions: string[] = [options.includeHidden ? '1=1' : 'visibility = 1']
    const params: unknown[] = []
    if (options.type) { conditions.push('type = ?'); params.push(options.type) }
    if (options.tier) { conditions.push('tier = ?'); params.push(options.tier) }
    params.push(options.limit || 50)
    params.push(options.offset || 0)
    const rows = queryRows(db,
      `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY salience DESC, created_at DESC LIMIT ? OFFSET ?`,
      params,
    )
    return rows.map(toMemoryRow)
  } catch { return [] }
}

// ── FTS5 全文搜索 ──

function buildFts5Query(keyword: string): string {
  // CJK 用 bigram 分词（匹配 cjkBigram 索引），非 CJK 用 unicode61 原生前缀
  const text = String(keyword)
  const hasCjk = /[一-鿿]/.test(text)
  const processed = hasCjk ? cjkBigram(text) : text
  const parts = processed.split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return parts.map(p => /^[a-zA-Z0-9]+$/.test(p) ? `${p}*` : p).join(' AND ')
}

function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

function extractChineseSubstrings(text: string, minLen = 2, maxLen = 3): string[] {
  const result = new Set<string>()
  const clean = text.replace(/[^一-鿿]/g, '')
  for (let len = maxLen; len >= minLen; len--) {
    for (let i = 0; i + len <= clean.length; i++) {
      result.add(clean.slice(i, i + len))
      if (result.size >= 12) return [...result]
    }
  }
  return [...result]
}

export function searchMemories(
  keyword: string,
  options: { limit?: number; types?: string[]; includeHidden?: boolean } = {},
): MemoryRow[] {
  const kw = (keyword == null ? '' : String(keyword)).trim()
  if (!kw) return []

  try {
    const db = getDb()
    const limit = options.limit || config.ftsLimit
    const visibleClause = options.includeHidden ? '1=1' : 'visibility = 1'
    const typeClause = options.types?.length
      ? `AND type IN (${options.types.map(() => '?').join(',')})`
      : ''

    // FTS5 MATCH
    const ftsQuery = buildFts5Query(kw)
    try {
      const rows = queryRows(db,
        `SELECT m.* FROM memories m
         INNER JOIN memories_fts5 ON m.rowid = memories_fts5.rowid
         WHERE memories_fts5 MATCH ? AND ${visibleClause} ${typeClause}
         ORDER BY m.salience DESC, m.updated_at DESC
         LIMIT ?`,
        [ftsQuery, ...(options.types ?? []), limit],
      )
      if (rows.length) return rows.map(toMemoryRow)
    } catch { /* FTS5 失败降级 LIKE */ }

    // LIKE 兜底
    const like = `%${kw}%`
    const likeRows = queryRows(db,
      `SELECT * FROM memories
       WHERE (title LIKE ? OR content LIKE ? OR detail LIKE ? OR entities LIKE ? OR tags LIKE ?)
       AND ${visibleClause} ${typeClause}
       ORDER BY salience DESC, updated_at DESC
       LIMIT ?`,
      [like, like, like, like, like, ...(options.types ?? []), limit],
    )
    if (likeRows.length) return likeRows.map(toMemoryRow)

    // 拼音兜底（可选依赖 pinyin-pro，未安装则跳过）："beijing" 搜到 "北京"
    if (hasChinese(kw)) {
      try {
        const terms = getPinyinTerms(kw)
        if (terms.length > 0) {
          const orClauses = terms.map(() =>
            '(title LIKE ? OR content LIKE ? OR detail LIKE ? OR tags LIKE ?)'
          ).join(' OR ')
          const pParams: string[] = []
          for (const t of terms) {
            const p = `%${t}%`
            pParams.push(p, p, p, p)
          }
          try {
            const pRows = queryRows(db,
              `SELECT * FROM memories
               WHERE (${orClauses}) AND ${visibleClause} ${typeClause}
               ORDER BY salience DESC, updated_at DESC
               LIMIT ?`,
              [...pParams, ...(options.types ?? []), limit],
            )
            if (pRows.length) return pRows.map(toMemoryRow)
          } catch { /* 拼音查询失败忽略 */ }
        }
      } catch { /* pinyin-pro 未安装，跳过拼音兜底 */ }
    }

    // 中文滑动窗口兜底
    if (hasChinese(kw)) {
      const substrings = extractChineseSubstrings(kw)
      if (substrings.length > 0) {
        const orClauses = substrings.map(() =>
          '(title LIKE ? OR content LIKE ? OR detail LIKE ? OR tags LIKE ?)'
        ).join(' OR ')
        const subParams: string[] = []
        for (const sub of substrings) {
          const p = `%${sub}%`
          subParams.push(p, p, p, p)
        }
        try {
          const subRows = queryRows(db,
            `SELECT * FROM memories
             WHERE (${orClauses}) AND ${visibleClause} ${typeClause}
             ORDER BY salience DESC, updated_at DESC
             LIMIT ?`,
            [...subParams, ...(options.types ?? []), limit],
          )
          if (subRows.length) return subRows.map(toMemoryRow)
        } catch { /* 滑动窗口降级 */ }
      }
    }

    return []
  } catch { return [] }
}

export function searchMemoriesByKeywords(keywords: string[], limitPerKw = 5): MemoryRow[] {
  if (!keywords.length) return []
  const seen = new Set<string>()
  const results: MemoryRow[] = []
  for (const kw of keywords) {
    const hits = searchMemories(kw, { limit: limitPerKw })
    for (const m of hits) {
      if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }
    }
  }
  return results
}

// ── 关联查询 ──

export function getMemoriesByEntity(entityId: string, limit = 10): MemoryRow[] {
  try {
    const db = getDb()
    const like = `%${entityId}%`
    const rows = queryRows(db,
      `SELECT * FROM memories WHERE (entities LIKE ? OR entities LIKE ?) AND visibility = 1 ORDER BY salience DESC, updated_at DESC LIMIT ?`,
      [like, like, limit],
    )
    return rows.map(toMemoryRow)
  } catch { return [] }
}

export function getMemoriesByDateRange(from: number, to: number, limit = 10): MemoryRow[] {
  try {
    const db = getDb()
    const rows = queryRows(db,
      `SELECT * FROM memories WHERE created_at >= ? AND created_at < ? AND visibility = 1 ORDER BY salience DESC, created_at ASC LIMIT ?`,
      [from, to, limit],
    )
    return rows.map(toMemoryRow)
  } catch { return [] }
}

export function getAllVisibleMemories(): { id: string; content: string; embedding: number[]; createdAt: number; entities: string }[] {
  try {
    const db = getDb()
    const rows = queryRows(db,
      `SELECT id, content, embedding, created_at, entities FROM memories WHERE visibility = 1 AND embedding IS NOT NULL AND embedding != ''`,
    )
    return rows.map(r => ({
      id: String(r.id),
      content: String(r.content),
      embedding: JSON.parse(String(r.embedding)) as number[],
      createdAt: Number(r.created_at),
      entities: String(r.entities ?? '[]'),
    }))
  } catch { return [] }
}

// ── 记忆巩固 + 遗忘衰减 ──

export function consolidateMemories(): { promoted: number } {
  try {
    const db = getDb()
    const now = Date.now()

    // scratch → episodic: 首次巩固
    const r0 = db.prepare(
      `UPDATE memories SET tier = 'episodic', updated_at = ?
       WHERE tier = 'scratch' AND usage_count >= 1 AND visibility = 1`
    ).run(now)

    // episodic → internalized: 高频命中且重要性达标
    const r1 = db.prepare(
      `UPDATE memories SET tier = 'internalized', updated_at = ?
       WHERE tier = 'episodic' AND usage_count >= 10 AND salience >= 3 AND visibility = 1`
    ).run(now)

    // internalized → growth: 长期高频命中，高重要性
    const r2 = db.prepare(
      `UPDATE memories SET tier = 'growth', updated_at = ?
       WHERE tier = 'internalized' AND usage_count >= 30 AND salience >= 4 AND visibility = 1`
    ).run(now)

    const promoted = Number(r0.changes ?? 0) + Number(r1.changes ?? 0) + Number(r2.changes ?? 0)
    return { promoted }
  } catch (e) {
    console.warn('[DB] 巩固失败:', (e as Error)?.message)
    return { promoted: 0 }
  }
}

/**
 * 记忆衰减
 */
export function decayMemories(): { decayed: number } {
  try {
    const db = getDb()
    const now = Date.now()

    // growth → internalized: 45+ 天未访问且低频
    const r1 = db.prepare(
      `UPDATE memories SET tier = 'internalized', updated_at = ?
       WHERE tier = 'growth' AND updated_at < ? AND usage_count < 5 AND salience < 4 AND visibility = 1`
    ).run(now, now - 45 * 86400000)

    // internalized → episodic: 90+ 天未访问且低频
    const r2 = db.prepare(
      `UPDATE memories SET tier = 'episodic', updated_at = ?
       WHERE tier = 'internalized' AND updated_at < ? AND usage_count < 3 AND salience < 4 AND visibility = 1`
    ).run(now, now - 90 * 86400000)

    // episodic → hidden（归档）: 180+ 天未访问且从未被使用
    const r3 = db.prepare(
      `UPDATE memories SET visibility = 0, updated_at = ?
       WHERE tier = 'episodic' AND updated_at < ? AND usage_count < 1 AND salience < 4 AND visibility = 1`
    ).run(now, now - 180 * 86400000)

    const decayed = Number(r1.changes ?? 0) + Number(r2.changes ?? 0) + Number(r3.changes ?? 0)
    return { decayed }
  } catch (e) {
    console.warn('[DB] 衰减失败:', (e as Error)?.message)
    return { decayed: 0 }
  }
}

// ── 分数衰减工具（get_top_experiences 等共用） ──

/** 按时间衰减分数：salience / (days + 1)。入参 createdAt 为毫秒时间戳 */
export function decayByTime(salience: number, createdAt: number): number {
  const days = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  if (days < 0) return salience
  return salience / (days + 1)
}

// ── 批量操作（v1.3） ──

export function batchDeleteMemories(ids: string[]): { deleted: number } {
  if (!ids.length) return { deleted: 0 }
  try {
    const db = getDb()
    const now = Date.now()
    const placeholders = ids.map(() => '?').join(',')
    const r = db.prepare(
      `UPDATE memories SET visibility = 0, updated_at = ? WHERE id IN (${placeholders}) AND visibility = 1`
    ).run(now, ...ids)
    return { deleted: Number(r.changes ?? 0) }
  } catch (e) {
    console.warn('[DB] 批量删除失败:', (e as Error)?.message)
    return { deleted: 0 }
  }
}

export function batchUpdateMemories(ids: string[], updates: { tags?: string[]; salience?: number; project?: string }): { updated: number } {
  if (!ids.length) return { updated: 0 }
  try {
    const db = getDb()
    const now = Date.now()
    const sets: string[] = ['updated_at = ?']
    const params: any[] = [now]
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(updates.tags.join(', ')) }
    if (updates.salience !== undefined) { sets.push('salience = ?'); params.push(updates.salience) }
    if (updates.project !== undefined) { sets.push('project = ?'); params.push(updates.project) }
    if (sets.length === 1) return { updated: 0 }
    const placeholders = ids.map(() => '?').join(',')
    const r = db.prepare(
      `UPDATE memories SET ${sets.join(', ')} WHERE id IN (${placeholders}) AND visibility = 1`
    ).run(...params, ...ids)
    return { updated: Number(r.changes ?? 0) }
  } catch (e) {
    console.warn('[DB] 批量更新失败:', (e as Error)?.message)
    return { updated: 0 }
  }
}

export function mergeMemories(sourceIds: string[], targetId: string): { merged: number; target?: MemoryRow } {
  if (!sourceIds.length || !targetId) return { merged: 0 }
  try {
    const db = getDb()
    const now = Date.now()

    const target = getMemory(targetId)
    if (!target) return { merged: 0 }

    const sources = sourceIds.map(id => getMemory(id)).filter(Boolean) as MemoryRow[]
    if (!sources.length) return { merged: 0 }

    const allContent = [target.content, ...sources.map(s => s.content)].filter(Boolean)
    const allDetail = [target.detail, ...sources.map(s => s.detail)].filter(Boolean)
    const allTags = [
      ...target.tags.split(',').map(t => t.trim()).filter(Boolean),
      ...sources.flatMap(s => s.tags.split(',').map(t => t.trim()).filter(Boolean)),
    ]
    const uniqueTags = [...new Set(allTags)]

    db.prepare(
      `UPDATE memories SET content = ?, detail = ?, tags = ?, usage_count = usage_count + ?, updated_at = ? WHERE id = ?`
    ).run(
      allContent.join('\n---\n'),
      allDetail.join('\n---\n'),
      uniqueTags.join(', '),
      sources.reduce((sum, s) => sum + s.usage_count, 0),
      now, targetId,
    )

    // FTS5 bigram 覆盖
    syncFts5Bigram(targetId, allContent.join('\n---\n'), allDetail.join('\n---\n'), target.title)

    const srcIds = sources.map(s => s.id)
    const ph = srcIds.map(() => '?').join(',')
    db.prepare(
      `UPDATE memories SET visibility = 0, merged_into = ?, updated_at = ? WHERE id IN (${ph})`
    ).run(targetId, now, ...srcIds)

    const updated = getMemory(targetId)
    return { merged: sources.length, target: updated ?? undefined }
  } catch (e) {
    console.warn('[DB] 合并失败:', (e as Error)?.message)
    return { merged: 0 }
  }
}

export function exportMemories(options: { type?: string; tier?: string; limit?: number; offset?: number } = {}): string {
  try {
    const db = getDb()
    const conditions: string[] = ['visibility = 1']
    const params: any[] = []
    if (options.type) { conditions.push('type = ?'); params.push(options.type) }
    if (options.tier) { conditions.push('tier = ?'); params.push(options.tier) }
    params.push(options.limit || 1000)
    params.push(options.offset || 0)
    const rows = queryRows(db,
      `SELECT id, mem_id, type, content, detail, title, tags, entities, salience, usage_count, tier, importance, confidence, valid_until, agent_id, cross_agent_share, project, contradicts, created_at, updated_at
       FROM memories WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      params,
    )
    return JSON.stringify(rows, null, 2)
  } catch (e) {
    return JSON.stringify({ error: (e as Error)?.message })
  }
}

// ── 感知链写入 ──

export function addPerceptionLink(
  sourceId: string,
  targetId: string,
  relationType: string = 'CO_OCCURS_WITH',
  confidence = 0.5,
  explanation = '',
): { id: string } | null {
  // 自环保护
  if (sourceId === targetId) return null
  const VALID_TYPES = ['LEADS_TO', 'BECAUSE_OF', 'ENABLES', 'PREVENTS', 'RESPONSE_TO', 'CO_OCCURS_WITH']
  if (!VALID_TYPES.includes(relationType)) return null
  try {
    const db = getDb()
    // 去重：LLM + auto 双路径不打架
    const existing = db.prepare(
      `SELECT id FROM perception_links WHERE source_id = ? AND target_id = ? AND relation_type = ? LIMIT 1`
    ).get(sourceId, targetId, relationType) as Record<string, unknown> | undefined
    if (existing) return { id: existing.id as string }

    // 源/目标存在性校验
    if (!db.prepare('SELECT 1 FROM memories WHERE id = ?').get(sourceId)) return null
    if (!db.prepare('SELECT 1 FROM memories WHERE id = ?').get(targetId)) return null

    const id = safeId()
    const now = nowMs()
    db.prepare(
      `INSERT OR IGNORE INTO perception_links (id, source_id, target_id, relation_type, confidence, explanation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sourceId, targetId, relationType, confidence, explanation, now, now)
    return { id }
  } catch { return null }
}

/**
 * 保存后自动关联：搜索相似记忆，创建感知链 + Hebbian 关联
 * v2: 自动检测语义关系类型（LEADS_TO / BECAUSE_OF / PREVENTS / ENABLES / CO_OCCURS_WITH）
 */
async function autoLinkNewMemory(newId: string, content: string, tags: string[]): Promise<void> {
  try {
    const db = getDb()

    // ── 语义相似关联（FTS5 + LIKE 兜底） ──
    const similar = searchMemories(content, { limit: 10 })
      .filter(m => m.id !== newId)
      .slice(0, 5)

    // ── 关键词交集召回（宽松兜底：语义召回不足时用关键词 LIKE 补齐，保证相关记忆能建边） ──
    const seen = new Set(similar.map(m => m.id))
    try {
      const { extractKeywords } = await import('./keywords.js')
      const kws = extractKeywords(content, 10).filter(k => k.length >= 2)
      if (kws.length > 0) {
        const orSql = kws.map(() => 'content LIKE ?').join(' OR ')
        const kwRows = db.prepare(
          `SELECT id, content FROM memories WHERE (${orSql}) AND id != ? AND visibility = 1 LIMIT 10`
        ).all(...kws.map(k => `%${k}%`), newId) as { id: string; content: string }[]
        for (const row of kwRows) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          similar.push({ id: row.id, content: row.content } as any)
        }
      }
    } catch { /* 关键词召回失败不影响主线 */ }

    for (const mem of similar.slice(0, 8)) {
      const relType = inferPerceptionRelation(content, mem.content)
      addPerceptionLink(newId, mem.id, relType, 0.5, `通过内容相似性自动关联`)
    }

    // 感知链关联（标签匹配的额外添加）
    if (tags.length > 0) {
      const tc = tags.map(() => 'tags LIKE ?').join(' OR ')
      const tp = tags.map(t => `%${t}%`)
      const extraTagged = db.prepare(`SELECT id FROM memories WHERE (${tc}) AND id != ? AND visibility = 1`).all(...tp, newId) as Record<string, unknown>[]
      for (const row of extraTagged) {
        const tid = String(row.id)
        if (!similar.some(m => m.id === tid)) {
          addPerceptionLink(newId, tid, 'CO_OCCURS_WITH', 0.4, `通过标签 [${tags.join(', ')}] 关联`)
        }
      }
    }
  } catch (e) {
    console.warn('[DB] 自动关联失败:', (e as Error)?.message)
  }
}

/**
 * 推断两段内容之间的语义因果类型
 * 启发式规则，基于常见中英文因果/偏好/能力表达模式
 */
export function inferPerceptionRelation(newContent: string, existingContent: string): 'LEADS_TO' | 'BECAUSE_OF' | 'ENABLES' | 'PREVENTS' | 'RESPONSE_TO' | 'CO_OCCURS_WITH' {
  const n = newContent, e = existingContent

  // 偏好 → 行为：new是偏好/existing是行为 → BECAUSE_OF
  const newPref = /喜欢|prefer|推荐|recommend|爱|想|要|want|hope/i.test(n)
  const existingPref = /喜欢|prefer|推荐|recommend|爱|想|要|want|hope/i.test(e)
  const newAct = /每天|早上|开始|在.*工作|去|用|使用|尝试|试用|架设|部署|实现|学习|build|use|start|deploy|learn/i.test(n)
  const existingAct = /每天|早上|开始|在.*工作|去|用|使用|尝试|试用|架设|部署|实现|学习|build|use|start|deploy|learn/i.test(e)

  if (newPref && existingAct) return 'BECAUSE_OF'
  if (existingPref && newAct) return 'LEADS_TO'

  // 避免/厌恶 → PREVENTS
  if (/不(喜欢|要|会|能|吃|喝|行|推荐|建议)|讨厌|避免|担忧|担心|avoid|prevent|hate|dislike|sensitive/i.test(n)) return 'PREVENTS'

  // 能力/工具 → 行为: new有能力/existing有动作 → ENABLES
  if (/能|可以|会|擅长|支持|精通|can|enable|allow|support|proficient/i.test(n) && existingAct) return 'ENABLES'
  if (/能|可以|会|擅长|支持|精通|can|enable|allow|support|proficient/i.test(e) && newAct) return 'RESPONSE_TO'

  // 显式因果词
  if (/因为|所以|导致|引发|原因|因此|cause|lead to|result in|because|therefore/i.test(n)) return 'LEADS_TO'
  if (/因为|所以|导致|引发|原因|因此|cause|lead to|result in|because|therefore/i.test(e)) return 'BECAUSE_OF'

  // 对比/差异 → 默认共现
  return 'CO_OCCURS_WITH'
}

// ── NLI 矛盾检测（lazy-load 增强） ──

let _nliPipeline: any = null

/**
 * 使用 NLI 模型做深度矛盾检测
 * 懒加载 nli-deberta-v3-xsmall，fire-and-forget，
 * 发现矛盾时追加到 contradicts 字段
 */
async function nliContradictionCheck(content: string, excludeId: string): Promise<void> {
  try {
    if (!_nliPipeline) {
      const { pipeline, env } = await import('@xenova/transformers')
      env.remoteHost = process.env['HF_MIRROR'] || 'https://hf-mirror.com'
      _nliPipeline = await pipeline('text-classification', 'Xenova/nli-deberta-v3-xsmall', { quantized: true })
    }

    const candidates = searchMemories(content, { limit: 5, includeHidden: true })
      .filter(m => m.id !== excludeId && !m.tier?.includes('core_identity'))
    if (!candidates.length) return

    const pairs = candidates.map(m => [content, m.content.slice(0, 380)] as [string, string])
    const results = await _nliPipeline(pairs, { topk: 1 })
    const contradictedIds: string[] = []
    for (let i = 0; i < results.length; i++) {
      const label = results[i]?.[0]?.label
      if (label === 'CONTRADICTION' || label === 'contradiction') {
        contradictedIds.push(candidates[i].id)
      }
    }
    if (contradictedIds.length > 0) {
      for (const cid of contradictedIds) {
        addPerceptionLink(excludeId, cid, 'PREVENTS', 0.6, 'NLI 模型检测到语义矛盾')
      }
    }
  } catch { /* NLI 矛盾检测失败不影响主线 */ }
}
