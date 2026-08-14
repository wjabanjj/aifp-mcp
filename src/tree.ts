// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * 记忆树操作
 * 移植自 aifp-web memory-tree.ts
 */

import { getDb } from './db.js'

export interface MemoryNode {
  id: string
  content: string
  type: string
  nodeType: 'branch' | 'leaf'
  parentId: string | null
  importance: number
  tier: string
  tags: string
}

export interface MemoryTree {
  node: MemoryNode
  children: MemoryTree[]
}

function buildTree(nodes: MemoryNode[]): MemoryTree[] {
  const map = new Map<string, MemoryTree>()
  const roots: MemoryTree[] = []
  for (const n of nodes) map.set(n.id, { node: n, children: [] })
  for (const n of nodes) {
    const tn = map.get(n.id)!
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(tn)
    else roots.push(tn)
  }
  return roots
}

export function loadTree(): MemoryTree[] {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, type, content, node_type, parent_id, importance, tier, tags FROM memories WHERE visibility = 1 ORDER BY updated_at DESC`
    ).all() as Record<string, unknown>[]
    const nodes: MemoryNode[] = rows.map(r => ({
      id: String(r.id), content: String(r.content || ''),
      type: String(r.type || ''), nodeType: (r.node_type === 'branch' ? 'branch' : 'leaf') as 'branch' | 'leaf',
      parentId: r.parent_id ? String(r.parent_id) : null,
      importance: Number(r.importance ?? 0.3),
      tier: String(r.tier || 'episodic'), tags: String(r.tags || ''),
    }))
    return buildTree(nodes)
  } catch { return [] }
}
