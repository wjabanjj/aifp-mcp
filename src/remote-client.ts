// @deploy npm — 客户端模块，随 npm 分发到用户本地
/**
 * remote-client.ts — 本地 daemon → 云端 core-server 的 HTTP 客户端
 * 只在 COGNITION_MODE=remote 时使用。
 * 发送中间结果（ID+分数+边），不发送用户原始文本。
 *
 * 安全说明：
 * - 必须配置 COGNITION_API_KEY 才会发送请求
 * - 建议使用 HTTPS 协议传输
 */
import { config } from './config.js'

export interface ScoreInput {
  id: string
  vectorScore?: number
  salience: number
  hasFtsMatch: boolean
}

interface FusionResponse {
  scores: Record<string, number>
}

interface TracePerceptionResponse {
  forward: { memoryId: string; relation: string; confidence: number; explanation: string; depth: number }[]
  backward: { memoryId: string; relation: string; confidence: number; explanation: string; depth: number }[]
}

class RemoteClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = config.serverUrl.replace(/\/+$/, '')
  }

  private async call(method: string, params: any): Promise<any> {
    if (!this.baseUrl) {
      throw new Error('COGNITION_SERVER_URL 未配置，无法调用远程服务')
    }
    if (!config.apiKey) {
      throw new Error('COGNITION_API_KEY 未配置，远程服务需要鉴权')
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${config.apiKey}`,
    }

    const res = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, params }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`core-server ${res.status}: ${text}`)
    }
    const body = await res.json() as { result?: any; error?: { message: string } }
    if (body.error) throw new Error(body.error.message)
    return body.result
  }

  /** 增强分数融合 */
  async fusion(items: ScoreInput[], options?: any): Promise<FusionResponse> {
    return this.call('fusion', { items, options })
  }

  /** 感知链追踪（depth=8） */
  async tracePerception(edges: any[], seedId: string, direction?: string, maxDepth?: number): Promise<TracePerceptionResponse> {
    return this.call('trace_perception', { edges, seedId, direction, maxDepth })
  }

  /** 搜索记忆：发候选结果+查询给服务器重排序 */
  async searchMemories(params: {
    query: string
    candidates: any[]
    vectorScores: Record<string, number>
    ftsMatchIds: string[]
    options?: any
  }): Promise<{ memories: any[]; scores: Record<string, number>; explain?: string }> {
    return this.call('search_memories', params)
  }

  /** 深度召回：搜索+因果+关联+扩散 一站式 */
  async recallContext(params: {
    query: string
    memories: any[]
    perceptionEdges: any[]
    options?: any
  }): Promise<{ memories: any[]; extra?: any }> {
    return this.call('recall_context', params)
  }

  /** 查找感知路径 */
  async findPerceptionPath(edges: any[], sourceId: string, targetId: string, maxDepth?: number): Promise<any[]> {
    return this.call('find_perception_path', { edges, sourceId, targetId, maxDepth })
  }

  /** 多跳扩散 */
  async diffuseMemories(graph: { edges: any[]; nodes: any[] }, seedIds: string[], maxHops?: number): Promise<any[]> {
    return this.call('diffuse_memories', { graph, seedIds, maxHops })
  }

  /** Hebbian 关联查询（get_related_memories 工具） */
  async getRelatedMemories(edges: any[], memId: string): Promise<{ memories: any[] }> {
    return this.call('get_related_memories', { edges, memId })
  }

  /** 感知图统计（get_perception_graph_stats 工具） */
  async perceptionGraphStats(): Promise<any> {
    return this.call('get_perception_graph_stats', {})
  }

}

export const remoteClient = new RemoteClient()
