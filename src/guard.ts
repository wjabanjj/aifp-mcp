// @deploy npm — 共享守卫模块，npm 端 mcp.ts 和服务器端 recognizer-scheduler.ts 共用
/**
 * 规则守卫 — 对话信号检测正则
 */

export const EXPLICIT_MEMORY_RE = /(?:记住|记一下|记得|别忘了|以后(?:你)?(?:要|记得|别|不要)?|保存(?:一下|到记忆)?|remember|keep in mind|note that|don't forget|do not forget)/i
export const GUARD_DECISION_RE = /决定\s*(?:使用|采用|改用|用|选)|改用\s+\S+|选择\s+(?:使用|用|了)|还是用\s+\S+|换(?:成|到)\s+\S+|弃\S+用\S+/
export const GUARD_FACT_RE = /我(?:是|叫|有|在|用|做|能|可以|记住|喜欢|不|会|要|想|需要|负责|写过|做过|用过的)|(?:我|我们)的\S{1,6}(?:是|有|叫)/
export const GUARD_PREFERENCE_RE = /喜欢|不喜欢|讨厌|推荐|最好|更(?:好|倾向|愿意|喜欢|爱)|比较(?:喜欢|倾向|推荐)|首选|优先/
export const GUARD_KNOWLEDGE_RE = /是指|意思是|分为|包括|指的是|指的就是|本质上|核心(?:是|在于)|关键(?:是|在于)|区别(?:在|是)|原理|机制|架构|模式/
export const GUARD_ERROR_RE = /报错|失败|错误|遇到了|发现.*问题|bug|issue|error|Error|FAIL|failed|超时|timed out|ETIMEDOUT|permission denied|EACCES|EPERM|unauthorized|SyntaxError|TypeError|ReferenceError|ENOTFOUND|ECONNRESET|ECONNREFUSED|EADDRINUSE|ENOENT|fetch failed|ENOSPC|OOM|out of memory|rate limit|429/
export const GUARD_PROJECT_RE = /项目|任务|目标|计划|打算|下(?:一步|次)要/

/** 工具/系统通知噪音 — 这些不该进入长期记忆 */
export const TOOL_NOISE_TAG_RE = /<task-notification>|<task-id>|<task-result>|<tool-use-id>|<tool-result>/i
export const TOOL_NOISE_CMD_RE = /background command/i
export const TOOL_NOISE_EXIT_RE = /(?:completed|finished|finished with|exited with).{0,20}exit code \d+|^exit code \d+/i
// 代码堆栈 / 调试输出噪音：函数名|文件名:行号、管道符分隔的调试段等。这些不该进长期记忆。
export const TOOL_NOISE_STACK_RE = /\b[\w./-]+\.(?:ts|js|jsx|tsx|cjs|mjs|py|go|rs):\d+\b/i
// 多个管道符分隔的调试标识符段，如 `| autoCompactConversation | auto-compact.ts`
export const TOOL_NOISE_PIPE_RE = /(?:^|\s)\|[\s\S]*\|[\s\S]*(?:\.ts|\.js|\.tsx|\.jsx|:\d+|\b[A-Za-z]+\(\))/i

/** 判断是否为工具/系统通知噪音（如 Claude 后台任务完成通知） */
export function isToolNoise(text: string): boolean {
  if (!text || !text.trim()) return true
  const t = text.trim()
  // XML 标签包裹的系统通知（<task-notification> 等）
  if (TOOL_NOISE_TAG_RE.test(t)) return true
  // “Background command ... completed (exit code N)” 后台命令完成通知
  if (TOOL_NOISE_CMD_RE.test(t) && TOOL_NOISE_EXIT_RE.test(t)) return true
  // 独立成段的 exit code 通知（可能被截断）
  if (/^[\s\S]{0,30}exit code \d+[\s\S]{0,10}$/i.test(t) && /completed|finished|done|exit/i.test(t)) return true
  // 代码堆栈 / 调试输出（文件名:行号）
  if (TOOL_NOISE_STACK_RE.test(t)) return true
  // 管道符分隔的调试信息段
  if (TOOL_NOISE_PIPE_RE.test(t)) return true
  return false
}

/** 规则级记忆信号检测 */
export function hasMemorySignal(text: string): boolean {
  if (!text || !text.trim()) return false
  const msg = text.trim()
  // 任何长度的文本都先过滤工具/调试噪音，噪音一律不算记忆信号
  if (isToolNoise(msg)) return false
  if (EXPLICIT_MEMORY_RE.test(msg)) return true
  if (msg.length >= 20) return true
  if (msg.length >= 8) {
    if (GUARD_DECISION_RE.test(msg)) return true
    if (GUARD_FACT_RE.test(msg)) return true
    if (GUARD_PREFERENCE_RE.test(msg)) return true
    if (GUARD_KNOWLEDGE_RE.test(msg)) return true
    if (GUARD_ERROR_RE.test(msg)) return true
    if (GUARD_PROJECT_RE.test(msg)) return true
    if (/[，。？、：；]/u.test(msg)) return true
  }
  return false
}

/** 检测有哪些守卫模式命中 */
export function detectGuardSignals(text: string): string[] {
  const signals: string[] = []
  if (!text) return signals
  if (EXPLICIT_MEMORY_RE.test(text)) signals.push('explicit')
  if (GUARD_DECISION_RE.test(text)) signals.push('decision')
  if (GUARD_FACT_RE.test(text)) signals.push('fact')
  if (GUARD_PREFERENCE_RE.test(text)) signals.push('preference')
  if (GUARD_KNOWLEDGE_RE.test(text)) signals.push('knowledge')
  if (GUARD_ERROR_RE.test(text)) signals.push('error')
  if (GUARD_PROJECT_RE.test(text)) signals.push('project')
  return signals
}
