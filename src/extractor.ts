// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 记忆质量门禁 — 纯规则引擎
 * 三重过滤：长度 / 瞬态信息 / 猜测内容
 */

// ── 质量门禁 ──

export interface GateResult {
  valid: boolean
  reason?: string
}

/**
 * 三重质量门禁。通过返回 { valid: true }，拒绝返回具体原因。
 * 与 aifp-web heuristic.ts 的 validateMemoryContent 规则一致。
 */
export function validateMemoryContent(content: string): GateResult {
  // 1. 空内容门禁
  if (!content.trim()) {
    return { valid: false, reason: '内容不能为空' }
  }

  // 2. 瞬态信息拦截
  const transientPatterns = [
    /当前(正在|在|的)(页面|标签|窗口|界面|会话|对话)/,
    /正在(查看|编辑|打开|浏览|处理)/,
    /^(这|那)条消息/,
    /刚刚(说|发|提到)/,
    /上一条(消息|回复)/,
  ]
  for (const p of transientPatterns) {
    if (p.test(content)) {
      return { valid: false, reason: '包含瞬态信息，不予保存' }
    }
  }

  // 3. 猜测内容拦截
  const speculationPatterns = [
    /我觉得用户(可能|大概|应该|也许)/,
    /用户(可能|大概|应该|也许)(想|要|需要|喜欢)/,
    /(可能|大概|也许|应该)是(因为|由于)/,
    /我(猜|推测|估计|认为)(用户)?/,
    /不出意外的话/,
  ]
  for (const p of speculationPatterns) {
    if (p.test(content)) {
      return { valid: false, reason: '包含推测内容，不予保存' }
    }
  }

  return { valid: true }
}

// ── 实体标签提取 ──

/** 实体标签提取上限 */
const MAX_ENTITY_TAGS = 10

/**
 * 从文本提取实体标签数组。
 * 纯正则，不调 LLM。从 aifp-web heuristic.ts extractEntityTags 移植。
 */
export function extractEntityTags(text: string): string[] {
  const tags: string[] = []

  // 文件路径（含扩展名且含路径分隔符）
  const fileRe = /([a-zA-Z0-9_\-./\\]+\.(ts|tsx|js|jsx|json|md|css|html|yml|yaml|toml|env|gitignore|py|rs|go|java|kt|swift))/g
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(text)) !== null) {
    const path = m[1]!.replace(/\\/g, '/').trim()
    if (path.includes('/') || path.includes('\\')) {
      tags.push(`file:${path}`)
    }
  }

  // 工具名（MCP 工具集）
  const toolRe = /\b(bash|file_edit|file_write|file_read|glob|grep|web_search|web_fetch|powershell|save_memory|search_memory|append_project_knowledge|recall_project_knowledge)\b/g
  while ((m = toolRe.exec(text)) !== null) {
    tags.push(`tool:${m[1]}`)
  }

  // 系统错误码（POSIX 常用集）
  const errorRe = /\b(ENOENT|EACCES|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EADDRINUSE|EPERM|ENOSPC|EPIPE|EINVAL|EIO|ENOMEM|ENODEV|ENOTDIR|EISDIR|ENOTEMPTY|EXDEV|EBUSY|EMFILE|ENFILE|EAGAIN|EINTR|ELOOP|ENETDOWN|ENETUNREACH|ENETRESET|ENOBUFS|ENODATA|ENOSR|ENOSTR|ENOSYS|ENOTCONN|ENOTRECOVERABLE|ENOTSOCK|ENOTSUP|ENOTTY|ENXIO|EOPNOTSUPP|EOVERFLOW|EPROTO|EPROTONOSUPPORT|EPROTOTYPE|ERANGE|EREMOTE|ESHUTDOWN|ESOCKET|ESPIPE|ESRCH|ESTALE|ETIME|EWOULDBLOCK|EXFULL)\b/g
  while ((m = errorRe.exec(text)) !== null) {
    tags.push(`error:${m[1]}`)
  }

  // HTTP 状态码
  const httpRe = /\b(404|500|502|503|403|401|400|301|302|304)\b/g
  while ((m = httpRe.exec(text)) !== null) {
    tags.push(`http:${m[1]}`)
  }

  // 端口号（前面有"端口/port"关键词）
  const portRe = /端口\s*[是为:：]?\s*(\d{2,5})|port\s*[:：]?\s*(\d{2,5})/gi
  while ((m = portRe.exec(text)) !== null) {
    const port = m[1] || m[2]
    if (port && parseInt(port) <= 65535) tags.push(`port:${port}`)
  }

  // 去重 + 截上限
  return [...new Set(tags)].slice(0, MAX_ENTITY_TAGS)
}
