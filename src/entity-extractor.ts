// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 实体自动提取 — 纯规则，零依赖
 *
 * 从记忆内容中自动识别：
 * - PascalCase / camelCase 标识符（函数名、类名、框架名）
 * - @提及
 * - URL / 文件路径
 * - 版本号 (如 v1.2.3)
 * - 常见技术栈关键词
 *
 * 输出与 entities JSON 数组格式兼容。
 */

const TECH_KEYWORDS = new Set([
  'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'nestjs',
  'express', 'fastify', 'koa', 'hono', 'elysia',
  'typescript', 'javascript', 'python', 'rust', 'go', 'golang',
  'node', 'deno', 'bun', 'prisma', 'drizzle', 'typeorm',
  'postgresql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis',
  'docker', 'kubernetes', 'k8s', 'nginx', 'caddy',
  'graphql', 'trpc', 'rest', 'grpc', 'websocket',
  'tailwind', 'bootstrap', 'shadcn', 'mui',
  'vitest', 'jest', 'playwright', 'cypress',
  'vite', 'webpack', 'turbopack', 'esbuild',
  'github', 'gitlab', 'git', 'actions',
  'aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify',
  'linux', 'ubuntu', 'debian', 'alpine',
  'zustand', 'redux', 'jotai', 'pinia',
  'nextauth', 'clerk', 'authjs', 'lucia',
  'openai', 'anthropic', 'claude', 'gpt',
  '/ai', '/memory', '/search', '/sql', '/tool',
])

function extractPascalCase(text: string): string[] {
  const results = new Set<string>()

  // PascalCase (class/FrameworkName)
  const pascalMatches = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)
  if (pascalMatches) {
    for (const m of pascalMatches) {
      if (m.length >= 3 && m.length <= 40) results.add(m)
    }
  }

  // PascalCase at start of sentence (single word) — filter out common words
  const singlePascal = text.match(/\b[A-Z][a-z]{2,}\b/g)
  if (singlePascal) {
    const common = new Set(['The', 'This', 'That', 'What', 'When', 'Where', 'How', 'Why', 'Which', 'Who', 'Not', 'All', 'One', 'Can', 'Will', 'May', 'Should', 'Would', 'Could', 'Also', 'Then', 'Than', 'Now', 'Just', 'Very', 'Much', 'Many', 'Some', 'Any', 'Each', 'Every', 'Both', 'Such', 'Only', 'Other', 'Another', 'First', 'Last', 'Next', 'New', 'Old', 'Good', 'Bad', 'High', 'Low', 'Big', 'Small', 'Long', 'Short', 'Fast', 'Slow', 'Hard', 'Soft', 'Sure', 'Real', 'Same', 'Able', 'Even', 'Well', 'Here', 'There', 'Done', 'Given', 'Using', 'Based', 'Built', 'Known', 'Named', 'Added', 'Fixed', 'Made', 'Took', 'Told', 'Said', 'Went', 'Came', 'Gave', 'Left', 'Lost', 'Found', 'Let', 'Set', 'Put', 'Got', 'Run', 'Ran', 'Saw', 'Seen', 'Used', 'Need', 'Take', 'Make', 'Want', 'Help', 'Work', 'Play', 'Show', 'Keep', 'Find', 'Give', 'Have', 'Know', 'Think', 'Look', 'Like', 'Love', 'Hate', 'Hope'])
    for (const m of singlePascal) {
      if (!common.has(m) && m.length >= 3 && m.length <= 40) results.add(m)
    }
  }

  return [...results]
}

function extractTechTerms(text: string): string[] {
  const results = new Set<string>()
  const lower = text.toLowerCase()

  for (const term of TECH_KEYWORDS) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (regex.test(text)) {
      results.add(term)
    }
  }

  // node:module or npm:package patterns
  const scoped = text.match(/@[\w-]+\/[\w-]+/g)
  if (scoped) for (const m of scoped) results.add(m)

  return [...results]
}

function extractUrls(text: string): string[] {
  const results = new Set<string>()
  const urlMatches = text.match(/https?:\/\/[^\s,，。；;)]+/g)
  if (urlMatches) {
    for (const url of urlMatches) {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, '')
        if (hostname) results.add(hostname)
      } catch { /* invalid URL */ }
    }
  }
  return [...results]
}

function extractFilePaths(text: string): string[] {
  const results = new Set<string>()

  // Unix paths
  const unixPaths = text.match(/\/(?:[\w.-]+\/)+[\w.-]+/g)
  if (unixPaths) for (const p of unixPaths) {
    const parts = p.split('/').filter(Boolean)
    if (parts.length >= 2) {
      for (const part of parts) {
        if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(part) && part.length <= 40) results.add(part)
      }
    }
  }

  // file extensions
  const fileExts = text.match(/\b[\w.-]+\.(ts|tsx|js|jsx|py|rs|go|vue|css|scss|json|yml|yaml|md|sql|prisma|toml)\b/g)
  if (fileExts) for (const f of fileExts) {
    results.add(f)
  }

  return [...results]
}

function extractMentions(text: string): string[] {
  const results = new Set<string>()
  const atMentions = text.match(/@(\w{2,})/g)
  if (atMentions) {
    for (const m of atMentions) results.add(m.slice(1))
  }
  return [...results]
}

function extractVersions(text: string): string[] {
  const results = new Set<string>()
  const versions = text.match(/\bv?\d+\.\d+\.\d+(?:-[a-z]+\d*)?\b/gi)
  if (versions) {
    for (const v of versions) results.add(v)
  }
  return [...results]
}

/**
 * 从文本中自动提取实体
 * @param text 输入文本
 * @returns 唯一实体名称数组
 */
export function extractEntities(text: string): string[] {
  if (!text || text.trim().length === 0) return []

  const results = new Set<string>()

  for (const extractor of [
    extractTechTerms,
    extractPascalCase,
    extractUrls,
    extractFilePaths,
    extractMentions,
    extractVersions,
  ]) {
    for (const entity of extractor(text)) {
      if (entity.length <= 60) results.add(entity)
    }
  }

  return [...results].slice(0, 30)
}
