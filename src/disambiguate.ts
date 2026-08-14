// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 消歧模块 — 从查询词中提取实体标签，用于检索增强
 */

// 复用 keywords.ts 的停用词表，避免重复维护
import { STOP_WORDS } from './keywords.js'

/**
 * disambiguateKeywords — retrieval.ts 调用的消歧标签函数
 * 从查询词中提取实体标签，用于检索增强
 * @param keywords 已有关键词列表
 * @param searchTerm 原始搜索词
 * @returns 额外实体标签列表
 */
export function disambiguateKeywords(keywords: string[], searchTerm: string): string[] {
  if (!searchTerm) return []
  const extraTags: string[] = []

  // 从搜索词中提取 2-6 字中文词作为实体标签
  const chars = searchTerm.replace(/[，。！？、；：""''''【】[\]()（）\d\s]/g, ' ')
  for (let i = 0; i < chars.length - 1; i++) {
    for (let len = 2; len <= 6 && i + len <= chars.length; len++) {
      const word = chars.slice(i, i + len).trim()
      if (word.length >= 2 && /[一-龥]/.test(word) && !keywords.includes(word) && !STOP_WORDS.has(word)) {
        extraTags.push(word)
      }
    }
  }

  return [...new Set(extraTags)].slice(0, 10)
}
