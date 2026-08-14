// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 时间词解析 — 将相对时间词转为日期区间
 * 移植自 aifp-web memory-temporal-parser.ts
 */

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

// 词表：只收确定能算出日期的高频词
const PATTERNS: {
  match: string[]
  label: string
  offsetDays?: number
  fn?: (today: Date) => { from: Date; to: Date; label: string }
}[] = [
  { match: ['今天', '今早', '今晨', '今夜', '今晚', '今儿', '今日'], label: '今天', offsetDays: 0 },
  { match: ['明天', '明日'], label: '明天', offsetDays: 1 },
  { match: ['昨天', '昨晚', '昨夜', '昨儿', '昨日'], label: '昨天', offsetDays: -1 },
  { match: ['前天'], label: '前天', offsetDays: -2 },
  { match: ['大前天'], label: '大前天', offsetDays: -3 },
  // 上周一~周日
  {
    match: ['上周', '上星期'],
    label: '上周',
    fn: (today: Date) => {
      const d = new Date(today)
      const dayOfWeek = d.getDay()
      const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek + 6
      const monday = new Date(d)
      monday.setDate(d.getDate() - daysToLastMonday)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: monday, to: sunday, label: '上周' }
    },
  },
  // 上个月（整个自然月）
  {
    match: ['上个月', '上月'],
    label: '上个月',
    fn: (today: Date) => {
      const y = today.getFullYear()
      const m = today.getMonth()
      const prevM = m === 0 ? 11 : m - 1
      const prevY = m === 0 ? y - 1 : y
      const from = new Date(prevY, prevM, 1)
      const to = new Date(prevY, prevM + 1, 0)
      return { from, to, label: '上个月' }
    },
  },
  // 最近 N 天（默认 7 天）
  {
    match: ['最近', '近日', '近来', '近期'],
    label: '最近',
    fn: (today: Date) => {
      const from = new Date(today)
      from.setDate(today.getDate() - 7)
      return { from, to: new Date(today), label: '最近7天' }
    },
  },
  // 前几天（≈3-7 天前）
  {
    match: ['前几天', '前幾天'],
    label: '前几天',
    fn: (today: Date) => {
      const from = new Date(today)
      from.setDate(today.getDate() - 7)
      const to = new Date(today)
      to.setDate(today.getDate() - 3)
      return { from, to, label: '前几天' }
    },
  },
  // 上次（fallback 7 天窗口，偏近期）
  {
    match: ['上次', '上回', '上一回'],
    label: '上次',
    fn: (today: Date) => {
      const from = new Date(today)
      from.setDate(today.getDate() - 14)
      return { from, to: new Date(today), label: '上次' }
    },
  },
  // 下个月
  {
    match: ['下个月', '下月'],
    label: '下个月',
    fn: (today: Date) => {
      const y = today.getFullYear()
      const m = today.getMonth()
      const nextM = m === 11 ? 0 : m + 1
      const nextY = m === 11 ? y + 1 : y
      const from = new Date(nextY, nextM, 1)
      const to = new Date(nextY, nextM + 1, 0)
      return { from, to, label: '下个月' }
    },
  },
  // 下周
  {
    match: ['下周', '下星期'],
    label: '下周',
    fn: (today: Date) => {
      const d = new Date(today)
      const dayOfWeek = d.getDay()
      const daysToNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)
      const monday = new Date(d)
      monday.setDate(d.getDate() + daysToNextMonday)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: monday, to: sunday, label: '下周' }
    },
  },
  // 去年（整个自然年）
  {
    match: ['去年', '上年'],
    label: '去年',
    fn: (today: Date) => {
      const y = today.getFullYear() - 1
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: '去年' }
    },
  },
  // 前年（2 年前）
  {
    match: ['前年'],
    label: '前年',
    fn: (today: Date) => {
      const y = today.getFullYear() - 2
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: '前年' }
    },
  },
  // 大前年（3 年前）
  {
    match: ['大前年'],
    label: '大前年',
    fn: (today: Date) => {
      const y = today.getFullYear() - 3
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: '大前年' }
    },
  },
  // 今年
  {
    match: ['今年', '本年'],
    label: '今年',
    fn: (today: Date) => {
      const y = today.getFullYear()
      return { from: new Date(y, 0, 1), to: new Date(today), label: '今年' }
    },
  },
]

// ── 数字转换辅助 ──
const CN_DIGITS: Record<string, number> = {一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 半:0.5}
const CN_PLACES: Record<string, number> = {十:10, 百:100, 千:1000, 万:10000}

function parseChineseNum(s: string): number {
  const n = parseInt(s, 10)
  if (!isNaN(n)) return n
  if (s.length === 1 && CN_DIGITS[s]) return CN_DIGITS[s]
  let result = 0, current = 0, foundPlace = false
  for (const ch of s) {
    if (CN_DIGITS[ch]) {
      current = CN_DIGITS[ch]
      foundPlace = false
    } else if (CN_PLACES[ch]) {
      if (current === 0 && !foundPlace) current = 1
      result += current * CN_PLACES[ch]
      current = 0
      foundPlace = true
    }
  }
  result += current
  return result || 3
}

// "N年前/N个月前/N天前/几年前/几个月前/几天前"
const QUANTITY_PATTERNS: {
  regex: RegExp
  label: string
  fn: (today: Date, num: number, half?: boolean) => { from: Date; to: Date; label: string }
}[] = [
  { regex: /(\d+|(?:[一二两三四五六七八九十百千万亿]+|[十半]))\s*年(?:\s*(半))?\s*(?:前|以前)/, label: 'N年前', fn: (today, n, half) => {
    const adjN = half ? n + 0.5 : n
    const y = today.getFullYear() - Math.ceil(adjN)
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: `${adjN}年前` }
  }},
  { regex: /(\d+|(?:[一二两三四五六七八九十百千万亿]+|[十半]))\s*个?月\s*(?:前|以前)/, label: 'N个月前', fn: (today, n) => {
    const m = today.getMonth()
    const targetM = (m - n) % 12
    const yearOffset = Math.floor((m - n) / 12)
    const y = today.getFullYear() - yearOffset
    const from = new Date(y, targetM < 0 ? targetM + 12 : targetM, 1)
    const to = new Date(y, (targetM < 0 ? targetM + 12 : targetM) + 1, 0)
    return { from, to, label: `${n}个月前` }
  }},
  { regex: /(\d+|(?:[一二两三四五六七八九十百千万亿]+|[十半]))\s*天\s*(?:前|以前)/, label: 'N天前', fn: (today, n) => {
    const from = new Date(today)
    from.setDate(from.getDate() - n)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    return { from, to, label: `${n}天前` }
  }},
  { regex: /几\s*年\s*前/, label: '几年前', fn: (today) => {
    const y = today.getFullYear() - 3
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: '几年前' }
  }},
  { regex: /几\s*个?\s*月\s*(?:前|以前)/, label: '几个月前', fn: (today) => {
    const m = today.getMonth() - 3
    const y = m < 0 ? today.getFullYear() - 1 : today.getFullYear()
    const from = new Date(y, (m + 12) % 12, 1)
    const to = new Date(y, ((m + 12) % 12) + 1, 0)
    return { from, to, label: '几个月前' }
  }},
  { regex: /几\s*天\s*前/, label: '几天前', fn: (today) => {
    const from = new Date(today)
    from.setDate(from.getDate() - 3)
    const to = new Date(today)
    return { from, to, label: '几天前' }
  }},
]

const ALL_TEMPORAL_WORDS = PATTERNS.flatMap(p => p.match)
  .sort((a, b) => b.length - a.length)

export interface TemporalHint {
  label: string
  from: string
  to: string
  offsetDays: number
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  const offsetStr = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetStr}`
}

export function parseTemporalHints(text: string, now = new Date()): TemporalHint[] {
  if (!text || typeof text !== 'string') return []
  const today = startOfDay(now)
  const hits: TemporalHint[] = []
  let scratch = text

  // 先处理带数量的正则模式（如"两年前/3个月前"）
  for (const qp of QUANTITY_PATTERNS) {
    while (true) {
      const m = scratch.match(qp.regex)
      if (!m) break
      const num = m[1] ? parseChineseNum(m[1]) : 3
      const half = !!(m[2] && m[2] === '半')
      scratch = scratch.replace(qp.regex, ' ')
      const result = qp.fn(today, num, half)
      const from = startOfDay(result.from)
      const to = new Date(result.to)
      to.setDate(to.getDate() + 1)
      hits.push({
        label: result.label,
        from: isoLocal(from),
        to: isoLocal(to),
        offsetDays: NaN,
      })
    }
  }

  // 最长匹配：长词先扫
  const sortedPatterns = [...PATTERNS].sort((a, b) => {
    const maxA = Math.max(...a.match.map(w => w.length))
    const maxB = Math.max(...b.match.map(w => w.length))
    return maxB - maxA
  })

  for (const p of sortedPatterns) {
    if (!p.match.some(w => scratch.includes(w))) continue
    for (const w of p.match) scratch = scratch.split(w).join(' ')

    if (p.fn) {
      const result = p.fn(today)
      const from = startOfDay(result.from)
      const to = new Date(result.to)
      to.setDate(to.getDate() + 1)
      hits.push({
        label: result.label,
        from: isoLocal(from),
        to: isoLocal(to),
        offsetDays: NaN,
      })
    } else {
      const from = new Date(today)
      from.setDate(from.getDate() + (p.offsetDays ?? 0))
      const to = new Date(from)
      to.setDate(to.getDate() + 1)
      hits.push({
        label: p.label,
        from: isoLocal(from),
        to: isoLocal(to),
        offsetDays: p.offsetDays ?? 0,
      })
    }
  }

  hits.sort((a, b) => {
    if (!isNaN(a.offsetDays) && !isNaN(b.offsetDays)) return b.offsetDays - a.offsetDays
    if (!isNaN(a.offsetDays)) return -1
    if (!isNaN(b.offsetDays)) return 1
    return 0
  })
  return hits
}

export function stripTemporalWords(text: string): string {
  if (!text || typeof text !== 'string') return text || ''
  let out = text
  for (const w of ALL_TEMPORAL_WORDS) {
    out = out.split(w).join(' ')
  }
  for (const qp of QUANTITY_PATTERNS) {
    out = out.replace(qp.regex, ' ')
  }
  return out.replace(/\s+/g, ' ').trim()
}
