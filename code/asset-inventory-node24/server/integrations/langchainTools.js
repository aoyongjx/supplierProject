import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

function toText(value = '') {
  return String(value ?? '').trim()
}

function parseJsonSafe(input, fallback = null) {
  try {
    return JSON.parse(input)
  } catch {
    return fallback
  }
}

export function buildLangChainToolbox({
  pool,
  schemaName = 'public',
  knowledgeBaseSearch,
  webSearch,
  rerank,
  trace,
} = {}) {
  const sqlSearchSuppliers = new DynamicStructuredTool({
    name: 'sql_search_suppliers',
    description: '从结构化数据库检索供应商主数据。输入关键词与上限，返回候选供应商。',
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    func: async ({ query, limit }) => {
      if (!pool) return JSON.stringify({ ok: false, error: 'pool_not_configured', rows: [] })
      const q = `%${toText(query)}%`
      const sql = `
        SELECT *
        FROM "${schemaName}"."supplier_base_info"
        WHERE COALESCE(company_name::text, '') ILIKE $1
           OR COALESCE(main_products::text, '') ILIKE $1
           OR COALESCE(company_intro::text, '') ILIKE $1
        LIMIT $2
      `
      try {
        const result = await pool.query(sql, [q, Number(limit)])
        return JSON.stringify({ ok: true, rows: result.rows || [] })
      } catch (error) {
        return JSON.stringify({ ok: false, error: toText(error?.message || error), rows: [] })
      }
    },
  })

  const ragSearchEvidence = new DynamicStructuredTool({
    name: 'rag_search_evidence',
    description: '在知识库中检索证据片段，用于供应商线索补强。',
    schema: z.object({
      kbIds: z.array(z.string()).min(1),
      query: z.string().min(1),
      topK: z.number().int().min(1).max(20).default(8),
      strictKeyword: z.boolean().default(true),
    }),
    func: async ({ kbIds, query, topK, strictKeyword }) => {
      if (typeof knowledgeBaseSearch !== 'function') {
        return JSON.stringify({ ok: false, error: 'knowledge_base_search_not_configured', hits: [] })
      }
      try {
        const hits = await knowledgeBaseSearch({ kbIds, query, topK, strictKeyword })
        return JSON.stringify({ ok: true, hits: Array.isArray(hits) ? hits : [] })
      } catch (error) {
        return JSON.stringify({ ok: false, error: toText(error?.message || error), hits: [] })
      }
    },
  })

  const webSearchTool = new DynamicStructuredTool({
    name: 'web_search_supplier_signals',
    description: '搜索供应商公开网络信号（新闻/官网/认证/公告）。',
    schema: z.object({
      query: z.string().min(1),
      topK: z.number().int().min(1).max(10).default(5),
    }),
    func: async ({ query, topK }) => {
      if (typeof webSearch !== 'function') {
        return JSON.stringify({ ok: false, error: 'web_search_not_configured', results: [] })
      }
      try {
        const results = await webSearch({ query, topK })
        return JSON.stringify({ ok: true, results: Array.isArray(results) ? results : [] })
      } catch (error) {
        return JSON.stringify({ ok: false, error: toText(error?.message || error), results: [] })
      }
    },
  })

  const rerankTool = new DynamicStructuredTool({
    name: 'rerank_supplier_candidates',
    description: '对候选供应商进行重排，输出更相关的TopN。',
    schema: z.object({
      query: z.string().min(1),
      candidates: z.array(z.any()).default([]),
      topN: z.number().int().min(1).max(20).default(10),
    }),
    func: async ({ query, candidates, topN }) => {
      const items = Array.isArray(candidates) ? candidates : []
      if (typeof rerank !== 'function') {
        return JSON.stringify({ ok: true, rows: items.slice(0, Number(topN)), mode: 'fallback_no_reranker' })
      }
      try {
        const rows = await rerank({ query, candidates: items, topN: Number(topN) })
        return JSON.stringify({ ok: true, rows: Array.isArray(rows) ? rows : [] })
      } catch (error) {
        return JSON.stringify({ ok: false, error: toText(error?.message || error), rows: items.slice(0, Number(topN)) })
      }
    },
  })

  const traceTool = new DynamicStructuredTool({
    name: 'trace_agent_step',
    description: '记录关键步骤日志到外部观测系统（如 LangSmith）。',
    schema: z.object({
      step: z.string().min(1),
      payload: z.any().optional(),
    }),
    func: async ({ step, payload }) => {
      if (typeof trace !== 'function') return JSON.stringify({ ok: true, skipped: true })
      try {
        await trace({ step, payload })
        return JSON.stringify({ ok: true })
      } catch (error) {
        return JSON.stringify({ ok: false, error: toText(error?.message || error) })
      }
    },
  })

  return {
    tools: [sqlSearchSuppliers, ragSearchEvidence, webSearchTool, rerankTool, traceTool],
    byName: {
      sqlSearchSuppliers,
      ragSearchEvidence,
      webSearchTool,
      rerankTool,
      traceTool,
    },
  }
}

export function getLangChainIntegrationHealth() {
  const keys = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    tavily: Boolean(process.env.TAVILY_API_KEY),
    langsmith: Boolean(process.env.LANGSMITH_API_KEY),
    unstructured: Boolean(process.env.UNSTRUCTURED_API_KEY),
  }
  return {
    ok: Object.values(keys).some(Boolean),
    keys,
  }
}

export function normalizeToolJsonResult(text) {
  const raw = toText(text)
  const parsed = parseJsonSafe(raw, null)
  return parsed && typeof parsed === 'object' ? parsed : { ok: false, error: 'invalid_tool_result', raw }
}
