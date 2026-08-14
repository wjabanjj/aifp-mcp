// @deploy server — 服务端模块，服务端模块，不随 npm 包发布
/**
 * LLM API 调用器 — 支持工具调用的非流式 LLM 调用
 * 用于 Recognizer 后台任务。
 *
 * 双协议自动选择（按环境变量）：
 *   OpenAI 兼容（优先）：COGNITION_LLM_API_KEY + COGNITION_LLM_BASE_URL + COGNITION_LLM_MODEL
 *   Anthropic 兼容（回退）：ANTHROPIC_API_KEY [+ ANTHROPIC_BASE_URL + COGNITION_LLM_MODEL]
 */

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ToolCallResult {
  id: string
  name: string
  input: unknown
  result: string
}

export interface LlmCallOptions {
  systemPrompt: string
  message?: string
  messages?: any[]
  tools?: ToolDefinition[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface LlmCallResponse {
  content: string
  toolCalls: ToolCallResult[]
  usage?: { inputTokens: number; outputTokens: number }
  stopReason: string | null
}

function getEnv(key: string): string {
  return process.env[key] || ''
}

// ── Anthropic Messages API（回退路径） ──

async function callAnthropic(options: LlmCallOptions, apiKey: string): Promise<LlmCallResponse> {
  const { systemPrompt, message, messages: optMessages, tools, temperature = 0, maxTokens = 2048, signal } = options

  const baseURL = getEnv('ANTHROPIC_BASE_URL') || undefined
  const model = getEnv('COGNITION_LLM_MODEL') || 'claude-sonnet-4-6-20250618'

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey, baseURL })

  const msgs = optMessages || [{ role: 'user', content: message || '' }]

  const body: any = {
    model,
    system: systemPrompt,
    messages: msgs,
    max_tokens: maxTokens,
    temperature,
  }

  if (tools?.length) {
    body.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
  }

  try {
    const response = await client.messages.create(body, { signal })

    const content: string[] = []
    const toolCalls: ToolCallResult[] = []

    for (const block of response.content) {
      if (block.type === 'text') content.push(block.text)
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: block.input, result: '' })
      }
    }

    return {
      content: content.join('\n').trim(),
      toolCalls,
      usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : undefined,
      stopReason: response.stop_reason || null,
    }
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('LLM 调用被中止')
    throw err
  }
}

// ── OpenAI 兼容 API（DeepSeek 等，优先路径） ──

/** Anthropic tool_use/tool_result 消息格式 → OpenAI 兼容格式 */
function toOpenAIMessages(optMessages: any[] | undefined, fallbackMessage: string | undefined): any[] {
  const msgs: any[] = []
  for (const m of optMessages || [{ role: 'user', content: fallbackMessage || '' }]) {
    const content = m.content
    if (typeof content === 'string') {
      msgs.push({ role: m.role, content })
    } else if (Array.isArray(content)) {
      if (m.role === 'assistant') {
        const toolCalls = content
          .filter((b: any) => b.type === 'tool_use')
          .map((b: any) => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          }))
        const text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        msgs.push(toolCalls.length ? { role: 'assistant', content: text || null, tool_calls: toolCalls } : { role: 'assistant', content: text })
      } else if (m.role === 'user') {
        for (const b of content) {
          if (b.type === 'tool_result') {
            msgs.push({ role: 'tool', tool_call_id: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) })
          } else if (b.type === 'text') {
            msgs.push({ role: 'user', content: b.text })
          }
        }
      }
    }
  }
  return msgs
}

async function callOpenAICompatible(options: LlmCallOptions, apiKey: string, baseUrl: string, model: string): Promise<LlmCallResponse> {
  const { systemPrompt, message, messages: optMessages, tools, temperature = 0, maxTokens = 2048, signal } = options

  const msgs: any[] = []
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
  msgs.push(...toOpenAIMessages(optMessages, message))

  const body: any = {
    model,
    messages: msgs,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  }
  if (tools?.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: (t.input_schema as any) ?? { type: 'object', properties: {} },
      },
    }))
  }

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`LLM API ${res.status}: ${errText.slice(0, 300)}`)
      }
      const data = await res.json()
      const choice = data.choices?.[0]
      const msg = choice?.message ?? {}
      const rawContent = msg.content
      const content = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((b: any) => b.text || '').join('')
          : ''
      const toolCalls: ToolCallResult[] = (msg.tool_calls ?? []).map((tc: any) => {
        let input: unknown = {}
        try { input = JSON.parse(tc.function?.arguments ?? '{}') } catch { input = {} }
        return { id: tc.id ?? '', name: tc.function?.name ?? '', input, result: '' }
      })
      return {
        content: content.trim(),
        toolCalls,
        usage: data.usage ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } : undefined,
        stopReason: choice?.finish_reason ?? null,
      }
    } catch (err: any) {
      lastErr = err
      if (err?.name === 'AbortError') throw new Error('LLM 调用被中止')
      // 网络层错误（fetch failed）等：退避重试
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr ?? new Error('LLM API 调用失败')
}

// ── 入口 ──

export async function callLlm(options: LlmCallOptions): Promise<LlmCallResponse> {
  const oaiKey = getEnv('COGNITION_LLM_API_KEY')
  if (oaiKey) {
    const baseUrl = getEnv('COGNITION_LLM_BASE_URL') || 'https://api.deepseek.com'
    const model = getEnv('COGNITION_LLM_MODEL') || 'deepseek-chat'
    return callOpenAICompatible(options, oaiKey, baseUrl, model)
  }
  const anthropicKey = getEnv('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    throw new Error('Recognizer 需要 COGNITION_LLM_API_KEY 或 ANTHROPIC_API_KEY 环境变量')
  }
  return callAnthropic(options, anthropicKey)
}
