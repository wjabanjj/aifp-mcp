#!/usr/bin/env node
/**
 * ⚠️ 行数红线豁免（2026-08-11 审批）
 * 本文件 460 行，超过“工具/脚本 ≤200 行”红线。
 * 豁免原因（功能性硬约束，不可拆分）：
 *   Claude Code hook 必须为单文件自包含脚本 —— 安装时整体复制到
 *   ~/.claude/hooks/ 独立运行，拆成多文件会导致依赖缺失、hook 失效。
 * 修改本文件时保持单文件结构，禁止拆分。
 */
/**
 * AiFP 记忆感知系统 — UserPromptSubmit Hook
 *
 * 每句用户消息自动触发 → FTS5 快速召回 → 相关记忆注入上下文
 * 确保每次响应前 Claude 已感知到相关记忆。
 *
 * 设计参考 vault-mcp (felipevdc1) + agent-memory-mcp (ahmedshaikh):
 * - command 类型，直连 SQLite，零 MCP 协议开销
 * - FTS5 纯文本搜索，不加载 embedding 模型 (< 50ms)
 * - 500ms 硬超时 fail-open，从不阻塞用户消息
 * - 无匹配静默退出，不污染上下文
 * - COGNITION_AUTO_INJECT=0 可退出
 */

'use strict'

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, appendFileSync } from 'node:fs'

const DATA_DIR = process.env.COGNITION_DATA_DIR || join(homedir(), '.ai-cognition')
const DB_PATH = join(DATA_DIR, 'cognition.db')
const LOG_PATH = join(DATA_DIR, 'hook.log')
const TIMEOUT_MS = 500
const MEMORY_BUDGET = 720     // 相关记忆区块字数预算（锚点独立不受限），替代固定条数+截断
const FETCH_LIMIT = 20         // DB 查询取回上限（预算制的缓冲池），远大于展示数
const MIN_QUERY_LENGTH = 8
const MAX_EXPAND_IDS = 100  // 单次扩散最大节点数，防止 10万+ 数据时 SQLite 占位符溢出

// Hard timeout — exit silently if exceeded (fail-open)
const hardTimeout = setTimeout(() => {
  try {
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), status: 'timeout', latency_ms: TIMEOUT_MS }) + '\n')
  } catch {}
  process.exit(0)
}, TIMEOUT_MS)
hardTimeout.unref()

function writeLog(entry) {
  try {
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

function writeStderr(msg) {
  process.stderr.write(`\x1b[2m[aifp]\x1b[0m ${msg}\n`)
}

// CJK Bigram 分词 — 匹配 FTS5 索引中的 bigram 内容
function cjkBigram(text) {
  return String(text).replace(/[一-鿿]+/g, (m) => {
    const grams = []
    for (let i = 0; i < m.length - 1; i++) grams.push(m.slice(i, i + 2))
    return ' ' + grams.join(' ')
  }).replace(/\s+/g, ' ').trim()
}

// Mirror db.ts buildFts5Query — CJK 用 bigram，非 CJK 用 unicode61 前缀
function buildFts5Query(text) {
  const raw = String(text)
  const hasCjk = /[一-鿿]/.test(raw)
  const processed = hasCjk ? cjkBigram(raw) : raw
  const parts = processed.split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return parts.map(p => /^[a-zA-Z0-9]+$/.test(p) ? `${p}*` : p).join(' AND ')
}

function truncate(text, maxLen = 120) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

function getTypeLabel(type) {
  const labels = {
    observation: 'observation',
    preference: 'preference',
    fact: 'fact',
    experience: 'experience',
    insight: 'insight',
    gotcha: 'gotcha',
    decision: 'decision',
    convention: 'convention',
  }
  return labels[type] || type
}

// ── 规则守卫 —— Recognizer 预筛 ──
// 从消息中检测是否有"值得记"的信号，避免无意义轮次浪费 LLM 调用

const GUARD_EXPLICIT_RE = /(?:记住|记一下|记得|别忘了|以后(?:你)?(?:要|记得|别|不要)?|保存(?:一下|到记忆)?|remember|keep in mind|note that|don't forget)/i
const GUARD_DECISION_RE = /决定\s*(?:使用|采用|改用|用|选)|改用\s+\S+|选择\s+(?:使用|用|了)|还是用\s+\S+|换(?:成|到)\s+\S+|弃\S+用\S+/
const GUARD_FACT_RE = /我(?:是|叫|有|在|用|做|能|可以|记住|喜欢|不|会|要|想|需要|负责|写过|做过|用过的)|(?:我|我们)的\S{1,6}(?:是|有|叫)/
const GUARD_PREFERENCE_RE = /喜欢|不喜欢|讨厌|推荐|最好|更(?:好|倾向|愿意|喜欢|爱)|比较(?:喜欢|倾向|推荐)|首选|优先/
const GUARD_KNOWLEDGE_RE = /是指|意思是|分为|包括|指的是|指的就是|本质上|核心(?:是|在于)|关键(?:是|在于)|区别(?:在|是)|原理|机制|架构|模式/
const GUARD_ERROR_RE = /报错|失败|错误|遇到了|发现.*问题|bug|issue|error|Error|FAIL|failed|超时|timed out|permission denied|EACCES|EPERM|unauthorized|SyntaxError|TypeError|ReferenceError|ENOTFOUND|ECONNRESET|ECONNREFUSED|EADDRINUSE|ENOENT|fetch failed|ENOSPC|OOM|out of memory|rate limit|429/
const GUARD_PROJECT_RE = /项目|任务|目标|计划|打算|下(?:一步|次)要/

function _detectGuardSignals(text) {
  if (!text || text.length < 8) return []
  const signals = []
  if (GUARD_EXPLICIT_RE.test(text)) signals.push('explicit')
  if (GUARD_DECISION_RE.test(text)) signals.push('decision')
  if (GUARD_FACT_RE.test(text)) signals.push('fact')
  if (GUARD_PREFERENCE_RE.test(text)) signals.push('preference')
  if (GUARD_KNOWLEDGE_RE.test(text)) signals.push('knowledge')
  if (GUARD_ERROR_RE.test(text)) signals.push('error')
  if (GUARD_PROJECT_RE.test(text)) signals.push('project')
  if (text.length >= 20) signals.push('long')  // 长消息含信息的概率高
  else if (/[，。？、：；]/u.test(text)) signals.push('punctuation')  // 短消息但有标点
  return signals
}

function _recencyLabel(ts) {
  if (ts == null) return ''
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!t) return ''
  const days = (Date.now() - t) / 86400000
  if (days < 1) return '今天'
  if (days < 2) return '昨天'
  if (days < 7) return `${Math.round(days)}天前`
  if (days < 30) return `${Math.round(days / 7)}周前`
  return `${Math.round(days / 30)}个月前`
}

;(async () => {
  const start = Date.now()

  try {
    // 1. Read stdin (JSON payload from Claude Code)
    let raw
    try {
      raw = readFileSync(0, 'utf-8').trim()
    } catch {
      clearTimeout(hardTimeout)
      process.exit(0)
    }
    if (!raw) { clearTimeout(hardTimeout); process.exit(0) }

    // 2. Parse payload
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      clearTimeout(hardTimeout); process.exit(0)
    }

    const prompt = (payload.prompt || payload.user_prompt || '').trim()
    if (!prompt || prompt.length < MIN_QUERY_LENGTH) {
      clearTimeout(hardTimeout); process.exit(0)
    }

    // 3. Check opt-out
    const autoInject = process.env.COGNITION_AUTO_INJECT
    if (autoInject === '0' || autoInject === 'false') {
      clearTimeout(hardTimeout); process.exit(0)
    }

    // 3a. 规则守卫预筛 → 写入 Recognizer 队列（fire-and-forget，不阻塞）
    const recognizerEnabled = process.env.COGNITION_RECOGNIZER === '1'
    if (recognizerEnabled && prompt.length >= 8) {
      try {
        const guardSignals = _detectGuardSignals(prompt)
        if (guardSignals.length > 0) {
          const { DatabaseSync } = await import('node:sqlite')
          const qdb = new DatabaseSync(DB_PATH)
          qdb.exec('PRAGMA journal_mode=WAL')
          qdb.prepare(
            `INSERT INTO recognition_queue (user_message, guard_signals, status, created_at) VALUES (?, ?, 'pending', ?)`
          ).run(prompt.slice(0, 1000), guardSignals.join(','), Date.now())
          qdb.close()
        }
      } catch { /* 队列写入失败不影响主流程 */ }
    }

    // 4. Open DB (read-only)
    let db
    try {
      const { DatabaseSync } = await import('node:sqlite')
      db = new DatabaseSync(DB_PATH, { readOnly: true })
    } catch {
      clearTimeout(hardTimeout); process.exit(0)
    }

    // 4a. 锚点记忆 — 系统级预载（始终参考，不受用户查询影响）
    let anchorMemories = []
    try {
      // 核心锚点：高重要性洞察/事实（preference 靠独立通道，不挤占名额）
      const coreAnchors = db.prepare(`
        SELECT id, type, content, tags, salience, importance, updated_at
        FROM memories
        WHERE visibility = 1 AND salience >= 4 AND type IN ('insight', 'fact', 'convention', 'decision')
        ORDER BY salience DESC, updated_at DESC
        LIMIT 3
      `).all()

      // 偏好独立通道 — 用户偏好永远有展示位，不被核心锚点挤占
      const preferenceAnchors = db.prepare(`
        SELECT id, type, content, tags, salience, importance, updated_at
        FROM memories
        WHERE visibility = 1 AND salience >= 4 AND type = 'preference'
        ORDER BY salience DESC, updated_at DESC
        LIMIT 2
      `).all()

      anchorMemories = [...coreAnchors, ...preferenceAnchors]
    } catch { /* 锚点查询失败不影响主流程 */ }

    // 5. FTS5 search (mirrors db.ts searchMemories)
    const ftsQuery = buildFts5Query(prompt)
    let rows = []

    try {
      rows = db.prepare(`
        SELECT m.id, m.type, m.content, m.tags, m.salience, m.importance
        FROM memories m
        INNER JOIN memories_fts5 ON m.rowid = memories_fts5.rowid
        WHERE memories_fts5 MATCH ? AND m.visibility = 1
        ORDER BY m.salience DESC, m.updated_at DESC
        LIMIT ?
      `).all(ftsQuery, FETCH_LIMIT)
    } catch {
      // FTS5 failed — LIKE fallback
      try {
        const like = `%${prompt}%`
        rows = db.prepare(`
          SELECT id, type, content, tags, salience, importance
          FROM memories
          WHERE (content LIKE ? OR title LIKE ? OR detail LIKE ? OR tags LIKE ?)
          AND visibility = 1
          ORDER BY salience DESC, updated_at DESC
          LIMIT ?
        `).all(like, like, like, like, FETCH_LIMIT)
      } catch {}
    }

    // Chinese sliding-window fallback (same as db.ts)
    if (!rows || rows.length === 0) {
      try {
        const chineseChars = prompt.match(/[一-鿿]{2,}/g)
        if (chineseChars) {
          const substrings = new Set()
          for (const match of chineseChars) {
            for (let len = 3; len >= 2; len--) {
              for (let i = 0; i + len <= match.length; i++) {
                substrings.add(match.slice(i, i + len))
                if (substrings.size >= 12) break
              }
              if (substrings.size >= 12) break
            }
            if (substrings.size >= 12) break
          }
          if (substrings.size > 0) {
            const orClauses = [...substrings].map(() => '(content LIKE ? OR title LIKE ? OR detail LIKE ? OR tags LIKE ?)').join(' OR ')
            const params = []
            for (const sub of substrings) {
              const p = `%${sub}%`
              params.push(p, p, p, p)
            }
            rows = db.prepare(`
              SELECT id, type, content, tags, salience, importance
              FROM memories WHERE (${orClauses}) AND visibility = 1
              ORDER BY salience DESC, updated_at DESC LIMIT ?
            `).all(...params, FETCH_LIMIT)
          }
        }
      } catch {}
    }

    if (!rows || rows.length === 0) {
      // 即使 FTS5 无匹配，锚点记忆仍要输出（系统级注入不受搜索影响）
      if (anchorMemories.length > 0) {
        db.close()
        writeStderr(`no matches, ${anchorMemories.length} anchors injected (${Date.now() - start}ms)`)
        writeLog({ status: 'anchor_only', prompt_len: prompt.length, anchors: anchorMemories.length, latency_ms: Date.now() - start })

        process.stdout.write('<ai-cognition>\n')
        process.stdout.write('## 锚点记忆（始终参考）\n')
        for (const r of anchorMemories) {
          const label = getTypeLabel(r.type)
          const recency = _recencyLabel(r.updated_at)
          const tagHint = r.tags ? ` [${String(r.tags).split(',').map(t => t.trim()).filter(Boolean).slice(0, 2).join(', ')}]` : ''
          process.stdout.write(`- [${label}] ${truncate(r.content)} (${recency})${tagHint}\n`)
        }
        // 上下文不足时提示深化检索
        if (anchorMemories.length < 3) {
          process.stdout.write('\n> 如需深化检索，可调用 `recall_context` 工具获取更多上下文\n')
        }
        process.stdout.write('</ai-cognition>\n')

        clearTimeout(hardTimeout)
        process.exit(0)
      }

      db.close()
      writeStderr(`no matches (${Date.now() - start}ms)`)
      writeLog({ status: 'no_match', prompt_len: prompt.length, latency_ms: Date.now() - start })
      clearTimeout(hardTimeout)
      process.exit(0)
    }

    // 6. Graph expansion — recursive CTE causal + Hebbian diffusion
    const initialIds = []
    for (const r of rows) {
      initialIds.push(r.id)
    }

    const expandedRows = []
    const seenExpanded = new Set()

    // Helper: fetch memory content by ID from DB (自动分批，防 SQLite 变量上限 999；累计达到 MAX_EXPAND_IDS 后停止)
    function fetchMemoriesByIds(ids, labelFn) {
      if (!ids.length) return
      const batchSize = 500
      for (let i = 0; i < ids.length && expandedRows.length < MAX_EXPAND_IDS; i += batchSize) {
        const batch = ids.slice(i, i + batchSize)
        const ph = batch.map(() => '?').join(',')
        try {
          const extra = db.prepare(`
            SELECT id, type, content, tags, salience, importance
            FROM memories WHERE id IN (${ph}) AND visibility = 1
          `).all(...batch)
          for (const r of extra) {
            const key = String(r.id)
            if (!seenExpanded.has(key)) {
              seenExpanded.add(key)
              r._source = labelFn(r)
              expandedRows.push(r)
            }
          }
        } catch {}
      }
    }

    // 6a. Causal recursive CTE — backward unlimited (溯源到根源) + forward depth-3
    try {
      // Backward: trace to root cause via source_id ← target_id (depth = 5，超过 5 层的因果链实践上已无关联意义)
      const backwardIds = new Set()
      for (const id of initialIds) {
        if (backwardIds.size >= MAX_EXPAND_IDS) break
        try {
          const rows = db.prepare(`
            WITH RECURSIVE chain(id, depth) AS (
              SELECT ?, 0
              UNION ALL
              SELECT source_id, depth + 1 FROM perception_links, chain
              WHERE perception_links.target_id = chain.id AND depth < 5
            )
            SELECT id FROM chain WHERE depth > 0
          `).all(id)
          for (const r of rows) {
            if (!seenExpanded.has(String(r.id))) backwardIds.add(String(r.id))
          }
        } catch {}
      }
      fetchMemoriesByIds([...backwardIds], () => '原因链溯源')

      // Forward: trace to effects via source_id → target_id (depth = 5)
      const forwardIds = new Set()
      for (const id of initialIds) {
        if (forwardIds.size >= MAX_EXPAND_IDS) break
        try {
          const rows = db.prepare(`
            WITH RECURSIVE chain(id, depth) AS (
              SELECT ?, 0
              UNION ALL
              SELECT target_id, depth + 1 FROM perception_links, chain
              WHERE perception_links.source_id = chain.id AND depth < 5
            )
            SELECT id FROM chain WHERE depth > 0
          `).all(id)
          for (const r of rows) {
            if (!seenExpanded.has(String(r.id))) forwardIds.add(String(r.id))
          }
        } catch {}
      }
      fetchMemoriesByIds([...forwardIds], () => '结果链延伸')
    } catch { /* causal expansion failed — non-critical */ }

    // 6b. Hebbian associations: for each initial result, get associated memories
    try {
      for (const id of initialIds) {
        const assocNeighbors = db.prepare(`
          SELECT mem_b AS linked_id FROM memory_associations WHERE mem_a = ?
          UNION
          SELECT mem_a AS linked_id FROM memory_associations WHERE mem_b = ?
        `).all(id, id)
        const ids = assocNeighbors.map(r => r.linked_id).filter(id => !seenExpanded.has(id))
        fetchMemoriesByIds(ids, () => 'Hebbian 共现关联')
      }
    } catch { /* hebbian expansion failed — non-critical */ }

    // 6c. Merge: 预算制替代固定条数 + 截断
    // 按 salience 排序，直到字数预算耗尽
    const merged = []
    const seen = new Set()
    let processedCount = 0
    let expandedCount = 0
    let budgetLeft = MEMORY_BUDGET
    for (const r of [...rows, ...expandedRows]) {
      if (budgetLeft <= 0) break
      const key = typeof r.content === 'string' ? r.content.slice(0, 40) : String(r.content || '').slice(0, 40)
      if (seen.has(key)) continue
      seen.add(key)
      // 估算本条需要的字数（标签 + 来源标注）
      const lineLen = (r.content || '').length + 20
      if (budgetLeft - lineLen < 0 && merged.length > 0) break
      budgetLeft -= lineLen
      merged.push(r)
      if (r._source) expandedCount++; else processedCount++
    }

    db.close()

    // 7. Output context block (stdout → injected into conversation)
    const latency = Date.now() - start
    writeStderr(`${merged.length} matches (${latency}ms, ${processedCount} direct + ${expandedCount} expanded) → ${merged.map(r => getTypeLabel(r.type)).join(', ')}`)
    writeLog({ status: 'ok', prompt_len: prompt.length, matches: merged.length, direct: processedCount, expanded: expandedCount, latency_ms: latency })

    process.stdout.write('<ai-cognition>\n')

    // Anchor memories first — 系统级锚点（始终参考，不受搜索影响）
    if (anchorMemories.length > 0) {
      process.stdout.write('## 锚点记忆（始终参考）\n')
      for (const r of anchorMemories) {
        const label = getTypeLabel(r.type)
        const recency = _recencyLabel(r.updated_at)
        const tagHint = r.tags ? ` [${String(r.tags).split(',').map(t => t.trim()).filter(Boolean).slice(0, 2).join(', ')}]` : ''
        process.stdout.write(`- [${label}] ${truncate(r.content)} (${recency})${tagHint}\n`)
      }
      process.stdout.write('\n')
    }

    if (merged.length > 0) {
      process.stdout.write('## 相关记忆\n')
      for (const r of merged) {
        const label = getTypeLabel(r.type)
        const source = r._source ? ` (${r._source})` : ''
        process.stdout.write(`- [${label}] ${truncate(r.content)}${source}\n`)
      }
    }

    // 上下文不足时提示深化检索
    const totalInjected = (anchorMemories?.length || 0) + (merged?.length || 0)
    if (totalInjected < 3) {
      process.stdout.write('\n> 如需深化检索，可调用 `recall_context` 工具获取更多上下文\n')
    }

    process.stdout.write('</ai-cognition>\n')

    clearTimeout(hardTimeout)
    process.exit(0)
  } catch (err) {
    writeStderr(`error: ${err.message ? err.message.slice(0, 80) : 'unknown'}`)
    writeLog({ status: 'error', latency_ms: Date.now() - start, error: err.message })
    clearTimeout(hardTimeout)
    process.exit(0)
  }
})()
