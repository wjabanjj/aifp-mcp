// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 关键词提取模块
 *
 * 基于 TF 的轻量级中英文关键词提取。
 * 无需分词器，使用简单的 n-gram + 停用词过滤 + TF 排序。
 *
 * 设计原则：
 * - 零外部依赖
 * - 快速（纯字符串操作）
 * - 适合短文本/标题/记忆内容的关键词提取
 */

// ─── 停用词表（中文）─────────────────────────

const CN_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '地', '得', '吧', '吗', '啊', '呢', '过', '被', '把',
  '让', '给', '对', '从', '向', '往', '以', '与', '同', '跟',
  '比', '为', '因', '由', '于', '将', '使',
  '什么', '怎么', '如何', '哪个', '哪些', '何时', '哪里', '为什么',
  '可以', '能够', '应该', '可能', '需要', '必须', '已经',
  '这个', '那个', '这些', '那些', '这里', '那里', '然后', '所以',
  '但是', '因为', '如果', '虽然', '而且', '或者', '还是', '不是',
  '就是', '只是', '然而', '不过', '关于', '对于',
  '第', '个', '种', '类', '些', '点', '次', '回', '遍',
  '来', '去', '进', '出', '上', '下', '回', '过', '起',
  '做', '作', '成为', '作为', '进行', '通过', '使用', '利用',
  // 标点符号类
  '', ' ', '　', '\n', '\t',
])

// ─── 停用词表（英文）─────────────────────────

const EN_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'you',
  'your', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'him',
  'not', 'no', 'nor', 'so', 'if', 'than', 'then', 'else', 'also',
  'very', 'just', 'about', 'more', 'most', 'some', 'any', 'each',
  'every', 'both', 'all', 'into', 'over', 'such', 'only', 'other',
])

// ─── 向后兼容导出（disambiguate.ts 使用） ──────────────
export const STOP_WORDS = CN_STOP_WORDS

// ─── 字符质量过滤 ──────────────────────────────────────

// 不能作为首字的字符
const STOP_HEAD_CHARS = new Set(['的', '了', '个', '这', '那', '很', '有', '就', '还', '在', '和', '是', '不', '也', '都', '又', '再', '才', '但', '而', '或', '与', '被'])

// 不能作为尾字的字符
const STOP_TAIL_CHARS = new Set(['的', '了', '着', '过', '吧', '吗', '呢', '啊', '哦', '嗯', '啦', '呗', '么', '是', '在', '有'])

function hasInvalidDuplicate(word: string): boolean {
  const chars = [...word]
  if (chars.length < 2) return false
  const first = chars[0]
  if (chars.every(c => c === first)) return true // "哈哈哈哈"
  if (chars.length >= 4) {
    const half = Math.floor(chars.length / 2)
    const lhs = chars.slice(0, half).join('')
    const rhs = chars.slice(half).join('')
    if (lhs === rhs) return true // "高兴高兴"
  }
  return false
}

function isValidNgram(word: string): boolean {
  if (word.length < 2) return false
  if (CN_STOP_WORDS.has(word)) return false
  if (hasInvalidDuplicate(word)) return false
  const chars = [...word]
  if (STOP_HEAD_CHARS.has(chars[0])) return false
  if (STOP_TAIL_CHARS.has(chars[chars.length - 1])) return false
  return true
}

function lengthWeight(word: string): number {
  if (word.length <= 2) return 1.7
  if (word.length >= 4) return 0.7
  return 1.0
}

// ─── 核心函数 ──────────────────────────────────────────

/**
 * 从文本中提取关键词
 * @param text 输入文本
 * @param maxKeywords 最多返回的关键词数（默认 8）
 * @returns 按 TF 降序排列的关键词数组
 */
export function extractKeywords(text: string, maxKeywords = 8): string[] {
  if (!text || text.trim().length === 0) return []

  // 1. 清洗（去掉标点数字，保留中文和英文）
  const cleaned = text
    .replace(/[，。！？、；：""''''【】[\]()（）\d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length === 0) return []

  const freq = new Map<string, number>()

  // 2a. 中文 n-gram（2-4 字），带质量过滤 + 长度加权
  const cnChars = cleaned.replace(/[a-zA-Z]+/g, ' ')
  for (let i = 0; i < cnChars.length - 1; i++) {
    for (let len = 2; len <= 4 && i + len <= cnChars.length; len++) {
      const word = cnChars.slice(i, i + len).trim()
      if (word.length >= 2 && isValidNgram(word) && /[一-龥]/.test(word)) {
        const inc = lengthWeight(word)
        freq.set(word, (freq.get(word) || 0) + inc)
      }
    }
  }

  // 2b. 英文 TF 提取（权重 x2，避免被中文 n-gram 淹没）
  const enTokens = cleaned
    .split(/[^a-zA-Z]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2 && !EN_STOP_WORDS.has(t))
  for (const token of enTokens) {
    freq.set(token, (freq.get(token) || 0) + 2)
  }

  // 3. 按频率排序，取 top N
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word)

  return sorted
}
