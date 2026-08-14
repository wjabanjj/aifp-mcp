// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 拼音搜索工具 — 中文→拼音转换，用于跨语言匹配（可选依赖 pinyin-pro）
 *
 * pinyin-pro 放在 optionalDependencies：安装了启用，未安装静默跳过，不影响主流程。
 * 用 createRequire 同步加载（searchMemories 是同步函数，不能 await import）。
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)

/** CJK 正则：匹配连续 2+ 汉字 */
const CJK_REGEX = /[一-鿿]{2,}/g

// pinyin-pro 懒加载：装了就启用，没装返回空
let _pinyin: ((text: string, opts?: { toneType?: string }) => string) | null = null
try {
  const mod = require('pinyin-pro')
  _pinyin = mod?.pinyin ?? null
} catch { /* pinyin-pro 未安装，拼音搜索不可用 */ }

export const pinyinSearchAvailable = _pinyin !== null

/**
 * 将中文文本转为拼音搜索词列表
 *
 * 输入 "数据库性能" → 滑动窗口切 2-3 字 → 拼音 → 紧凑拼音
 * 结果: ["shujuku", "kuxingneng", "shuju", "kuxing", "xingneng"]
 *
 * 注意：仅返回长度 >= 2 的紧凑拼音，避免 "a"/"de"/"le" 等单字母噪声
 */
export function getPinyinTerms(text: string): string[] {
  if (!_pinyin) return []
  const terms: string[] = []
  const chineseBlocks = text.match(CJK_REGEX)
  if (!chineseBlocks) return terms

  for (const block of chineseBlocks) {
    const seen = new Set<string>()
    for (const win of [3, 2] as const) {
      for (let i = 0; i + win <= block.length; i++) {
        const seg = block.slice(i, i + win)
        if (seen.has(seg)) continue
        seen.add(seg)
        try {
          const py = _pinyin(seg, { toneType: 'none' })
          const compact = String(py).replace(/\s+/g, '')
          if (compact.length >= 2 && !terms.includes(compact)) terms.push(compact)
        } catch { /* 跳过转换失败的词 */ }
      }
    }
  }

  return terms
}
