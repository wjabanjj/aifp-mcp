// @deploy server — 服务端模块，仅在腾讯服务器运行，不发布到 npm
/**
 * Recognizer Scheduler — 记忆识别的调度层
 *
 * 功能：
 * 1. 规则级预筛守卫：过滤明显无信号的轮次，避免浪费 LLM 调用
 * 2. 去抖批处理：有信号的轮次进缓冲区，攒批再调 LLM
 * 3. 后台轮询：定期检查 recognition_queue 表，处理待识别轮次
 *
 * 设计移植自 aifp-web recognizer-scheduler.ts
 */

import { runRecognizerBatch, type RecognizerTurn } from './recognizer.js'
import { getPendingTurns, markQueueDone, markQueueSkipped, cleanQueue } from './db.js'
import { config } from './config.js'
import { isToolNoise } from './guard.js'

export { hasMemorySignal, detectGuardSignals } from './guard.js'

// ── 调度器状态 ──

let pollTimer: ReturnType<typeof setInterval> | null = null
let running = false

/**
 * 启动后台轮询调度器
 * 定期检查 recognition_queue 表，批量处理待识别轮次
 */
export function startScheduler(): void {
  if (pollTimer) return
  if (!config.recognizerEnabled) {
    console.log('[Recognizer] 未启用（设置 COGNITION_RECOGNIZER=1 启用）')
    return
  }

  console.log(`[Recognizer] 调度器已启动（轮询间隔 ${config.recognizerPollMs}ms）`)
  pollTimer = setInterval(pollQueue, config.recognizerPollMs)
  pollTimer.unref()

  // 启动时立即检查一次
  setTimeout(() => pollQueue(), 5000)
}

/** 停止调度器 */
export function stopScheduler(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  running = false
}

// ── 队列轮询 ──

async function pollQueue(): Promise<void> {
  if (running) return  // 防并发
  running = true

  try {
    const pending = getPendingTurns(config.recognizerMaxBatch)
    if (!pending.length) {
      // 定期清理已处理的队列项
      cleanQueue()
      running = false
      return
    }

    // 检查第一条是否超时
    const first = pending[0]
    const now = Date.now()
    const elapsed = first.created_at ? now - first.created_at : Infinity

    // 条件：攒够批次 || 第一条等了够久
    if (pending.length < config.recognizerMaxBatch && elapsed < config.recognizerMaxWaitMs) {
      running = false
      return  // 还不够条件，等下次轮询
    }

    // 收集待处理的 IDs
    const batchIds = pending.map(t => t.id!).filter(Boolean)

    // 构建 recognizer turns
    const turns: RecognizerTurn[] = pending.map(t => ({
      userMessage: t.user_message,
      sessionId: t.session_id || undefined,
      project: t.project || undefined,
      guardSignals: t.guard_signals || undefined,
    }))

    // 工具/系统通知噪音（如 Claude 后台任务通知）直接跳过，不浪费 LLM
    const noiseIds = pending
      .filter(t => t.user_message && isToolNoise(t.user_message))
      .map(t => t.id!)
      .filter(Boolean)
    if (noiseIds.length > 0) {
      markQueueSkipped(noiseIds)
      console.log(`[Recognizer] 跳过 ${noiseIds.length} 条工具/系统通知噪音`)
    }
    const realTurns = turns.filter(t => !(t.userMessage && isToolNoise(t.userMessage)))
    const realIds = batchIds.filter(id => !noiseIds.includes(id))
    if (realTurns.length === 0) {
      cleanQueue()
      running = false
      return
    }

    console.log(`[Recognizer] 处理 ${realTurns.length} 条待识别（等待 ${elapsed}ms）`)

    // 运行识别（仅非噪音 turn）
    const written = await runRecognizerBatch(realTurns)

    if (written.length > 0) {
      markQueueDone(realIds)
      console.log(`[Recognizer] ✅ 完成：写入 ${written.length} 条记忆`)
    } else {
      markQueueSkipped(realIds)
      console.log(`[Recognizer] 跳过：无值得保存的内容`)
    }

    // 清理旧数据
    cleanQueue()
  } catch (err) {
    console.error('[Recognizer] 调度器错误:', (err as Error)?.message || err)
  } finally {
    running = false
  }
}

/**
 * MCP 工具：手动触发立即刷新（可被 AI agent 调用）
 */
export async function flushNow(): Promise<{ processed: number; written: number }> {
  const pending = getPendingTurns(config.recognizerMaxBatch)
  if (!pending.length) return { processed: 0, written: 0 }

  const batchIds = pending.map(t => t.id!).filter(Boolean)
  const turns: RecognizerTurn[] = pending.map(t => ({
    userMessage: t.user_message,
    sessionId: t.session_id || undefined,
    project: t.project || undefined,
  }))

  const written = await runRecognizerBatch(turns)

  if (written.length > 0) {
    markQueueDone(batchIds)
  } else {
    markQueueSkipped(batchIds)
  }

  cleanQueue()
  return { processed: turns.length, written: written.length }
}
