// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 纠错字典 — 静态映射 + Levenshtein 编辑距离模糊匹配
 * 移植自 aifp-web memory-typo.ts
 */

const TYPO_MAP: Record<string, string> = {
  '学西': '学习', '字习': '学习', '高心': '高兴',

  '派森': 'Python', '派声': 'Python', '拍森': 'Python',
  '内寸': '内存', '内纯': '内存',
  '数剧库': '数据库', '数倨': '数据',
  '编成': '编程', '边程': '编程',
  '代玛': '代码', '带码': '代码',
  '算发': '算法', '随法': '算法',
  '循还': '循环', '寻环': '循环',
  '路游器': '路由器',
  '服雾器': '服务器', '符物器': '服务器',
  '边译器': '编译器', '编意器': '编译器',
  '阶口': '接口',

  '安状': '安装', '安转': '安装',
  '配值': '配置', '陪置': '配置',
  '布属': '部署', '部暑': '部署',
  '签出': '检出', '签入': '检入',
  '节点': '节点', '结点': '节点',

  '安情': '案情', '按情': '案情',
  '派处所': '派出所', '刑贞': '刑侦',
  '反炸': '反诈', '预敬': '预警',
  '研叛': '研判', '穿并': '串并',
  '资今': '资金', '帐号': '账号',
  '冻洁': '冻结',

  'ni hao': '你好',
  'xie xie': '谢谢',
  'bu dong': '不懂',
  'zen me': '怎么',
  'wei shen me': '为什么',
  'zen me ban': '怎么办',

  // 常见技术术语 typo
  'expres': 'Express',
  'prisama': 'Prisma',
  'redisr': 'Redis',
  'postgress': 'PostgreSQL',
  'zustnd': 'Zustand',
  'rract': 'React',
  'tyepscript': 'TypeScript',
  'javascrip': 'JavaScript',
  'phtyon': 'Python',
  'nodjs': 'Node',
  'dockr': 'Docker',
  'kubernets': 'Kubernetes',
  'grafna': 'Grafana',
  'promethus': 'Prometheus',
  'ngnix': 'Nginx',
  'postgres': 'PostgreSQL',
  'typescrit': 'TypeScript',
  'javascrit': 'JavaScript',
  'fastapi': 'FastAPI',
  'zustand': 'Zustand',
  'prisma': 'Prisma',
  'sequelize': 'Sequelize',
  'typeorm': 'TypeORM',
  'redis': 'Redis',
  'mongodb': 'MongoDB',
  'sqlite': 'SQLite',
  'docker': 'Docker',
  'github': 'GitHub',
  'gitlab': 'GitLab',
  'vscode': 'VS Code',
}

const KNOWN_TERMS = new Set([
  ...Object.values(TYPO_MAP).flatMap(v => v.split(/\s+/)),
  'JavaScript', 'TypeScript', 'Python', 'React', 'Vue', 'Node', 'Bun', 'Deno',
  'HTML', 'CSS', 'JSON', 'API', 'SQL', 'Git', 'Docker', 'Linux',
  'Express', 'FastAPI', 'Flask', 'Prisma', 'TypeORM', 'Sequelize',
  'Redis', 'PostgreSQL', 'MongoDB', 'SQLite', 'MySQL', 'MariaDB',
  'Zustand', 'Redux', 'MobX', 'ReactQuery', 'SWR',
  'Kubernetes', 'Nginx', 'Grafana', 'Prometheus', 'GitHub', 'GitLab',
  'VS Code', 'Webpack', 'Vite', 'Babel', 'ESLint', 'Prettier',
  'AWS', 'Azure', 'GCP', 'Cloudflare', 'Vercel', 'Netlify',
  'Rust', 'Go', 'Java', 'C++', 'C#', 'Swift', 'Kotlin',
  'database', 'server', 'client', 'frontend', 'backend', 'middleware',
  'function', 'variable', 'constant', 'component', 'interface', 'module',
  '异步', '同步', '回调', '事件', '队列', '缓存', '代理', '路由',
  '构造函数', '原型链', '作用域', '闭包', '迭代器', '生成器',
  '部署', '配置', '安装', '编译', '调试', '测试', '构建', '发布',
  '数据库', '服务器', '浏览器', '编译器', '依赖', '框架', '库',
])

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function fuzzySuggest(word: string, maxDist = 2): string | null {
  if (!word || word.length <= 1) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const term of KNOWN_TERMS) {
    if (Math.abs(term.length - word.length) > maxDist) continue
    const dist = levenshtein(word.toLowerCase(), term.toLowerCase())
    if (dist < bestDist && dist <= maxDist) {
      bestDist = dist
      best = term
    }
  }
  if (best && bestDist === 1 && best.length === word.length && word.length >= 2) {
    let samePos = 0
    for (let i = 0; i < word.length; i++) { if (word[i] === best[i]) samePos++ }
    if (samePos >= word.length / 2) return null
  }
  return best
}

const _userTypoDict = new Map<string, string>()

// 时间词保护名单：fuzzy 纠错绝不改动这些词（"昨天"被误纠成"学习"的历史 bug）
const TIME_WORD_GUARD = new Set([
  '今天', '明天', '昨天', '前天', '后天', '大前天', '大后天',
  '今早', '今午', '今晚', '今夜', '今晨',
  '明早', '明晚', '明夜',
  '昨晚', '昨夜', '昨儿', '昨日', '今儿', '今日', '明日',
  '早上', '上午', '中午', '下午', '傍晚', '晚上', '半夜', '凌晨',
  '当前', '现在', '此刻', '刚才', '之前', '之后', '以前', '以后',
  '上周', '本周', '下周', '上个月', '这个月', '下个月',
  '去年', '今年', '明年', '上个月',
])

export function fixTypo(text: string): string {
  if (!text) return text
  let corrected = text

  for (const [wrong, right] of Object.entries(TYPO_MAP)) {
    if (corrected.includes(wrong)) {
      corrected = corrected.replaceAll(wrong, right)
    }
  }

  for (const [wrong, right] of _userTypoDict) {
    if (corrected.includes(wrong)) {
      corrected = corrected.replaceAll(wrong, right)
    }
  }

  const tokens = corrected.split(/(\s+)/)
  const result: string[] = []
  for (const token of tokens) {
    if (token.trim() && !token.includes(' ') && !TYPO_MAP[token] && !_userTypoDict.has(token)) {
      // 时间词不参与 fuzzy 纠错（防止把"昨天"误改成"学习"，破坏时间检索）
      if (TIME_WORD_GUARD.has(token)) {
        result.push(token)
        continue
      }
      // 中文词不参与 fuzzy 纠错（系统性 bug：任意 2 字中文词都能在 KNOWN_TERMS
      // 里找到编辑距离 ≤2 的邻居，如"城市"→"缓存"、"昨天"→"学习"。
      // 中文错别字靠 TYPO_MAP 静态映射，Levenshtein 只对英文/拼音有意义）
      if (/[\u4e00-\u9fff]/.test(token)) {
        result.push(token)
        continue
      }
      const suggestion = fuzzySuggest(token)
      if (suggestion && suggestion !== token) {
        _userTypoDict.set(token, suggestion)
        result.push(suggestion)
        continue
      }
    }
    result.push(token)
  }

  return result.join('')
}
