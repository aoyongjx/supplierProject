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

function toToolResult({
  ok = true,
  content = '',
  artifact = null,
  error = '',
  data = {},
  meta = {},
} = {}) {
  return {
    ok: Boolean(ok),
    content: toText(content),
    artifact: artifact && typeof artifact === 'object' ? artifact : null,
    error: toText(error),
    data: data && typeof data === 'object' ? data : {},
    meta: meta && typeof meta === 'object' ? meta : {},
  }
}

function quoteIdent(name = '') {
  const value = toText(name)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return ''
  return `"${value.replaceAll('"', '""')}"`
}

export function buildLangChainToolbox({
  pool,
  schemaName = 'public',
  knowledgeBaseSearch,
  webSearch,
  rerank,
  trace,
  generateChart,
  exportFile,
} = {}) {
  const sqlSearchSuppliers = new DynamicStructuredTool({
    name: 'sql_search_suppliers',
    description: '从结构化数据库检索供应商主数据。支持按 selectedDbTables 指定搜索范围。',
    schema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
      selectedDbTables: z.array(z.string()).default([]),
      strictMode: z.boolean().default(false),
    }),
    func: async ({ query, limit, selectedDbTables }) => {
      if (!pool) return JSON.stringify(toToolResult({ ok: false, error: 'pool_not_configured', data: { rows: [] } }))
      const q = `%${toText(query)}%`
      try {
        const tableAliasMap = {
          suppliers: 'supplier_base_info',
          supplier_profiles: 'supplier_profile',
          supply_chain_node: 'supply_chain_node',
          gas_supply_chain_node: 'gas_supply_chain_node',
          gas_suppliers: 'gas_supplier',
          gas_supplier_profiles: 'supplier_profile',
          gas_oems: 'gas_oem',
          inventories: 'asset_inventory',
        }
        const selected = (Array.isArray(selectedDbTables) ? selectedDbTables : [])
          .map((item) => {
            const raw = toText(item)
            const part = raw.includes('.') ? raw.split('.')[1] : raw
            const key = toText(part)
            return tableAliasMap[key] || key
          })
          .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
        const targetTables = selected.length > 0 ? [...new Set(selected)] : ['supplier_base_info']
        const safeSchema = quoteIdent(schemaName)
        const rows = []
        const perTableLimit = Math.max(1, Math.ceil(Number(limit) / Math.max(targetTables.length, 1)))
        for (const tableName of targetTables) {
          const safeTable = quoteIdent(tableName)
          if (!safeSchema || !safeTable) continue
          const sql = `
            SELECT *
            FROM ${safeSchema}.${safeTable} AS t
            WHERE to_jsonb(t)::text ILIKE $1
            LIMIT $2
          `
          try {
            const result = await pool.query(sql, [q, perTableLimit])
            const tableRows = Array.isArray(result.rows) ? result.rows : []
            rows.push(...tableRows.map((item) => ({ ...item, _fromTable: tableName })))
          } catch {
            continue
          }
        }
        return JSON.stringify(toToolResult({
          ok: true,
          content: `DB命中 ${rows.length} 条`,
          data: { rows },
          meta: {
            tool: 'sql_search_suppliers',
            query: toText(query),
            limit: Number(limit),
            selectedDbTables: targetTables,
          },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error), data: { rows: [] } }))
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
        return JSON.stringify(toToolResult({ ok: false, error: 'knowledge_base_search_not_configured', data: { hits: [] } }))
      }
      try {
        const hits = await knowledgeBaseSearch({ kbIds, query, topK, strictKeyword })
        const normalizedHits = Array.isArray(hits) ? hits : []
        return JSON.stringify(toToolResult({
          ok: true,
          content: `知识库命中 ${normalizedHits.length} 条`,
          data: { hits: normalizedHits },
          meta: { tool: 'rag_search_evidence', kbIds, topK: Number(topK) },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error), data: { hits: [] } }))
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
        return JSON.stringify(toToolResult({ ok: false, error: 'web_search_not_configured', data: { results: [] } }))
      }
      try {
        const results = await webSearch({ query, topK })
        const normalizedResults = Array.isArray(results) ? results : []
        return JSON.stringify(toToolResult({
          ok: true,
          content: `互联网命中 ${normalizedResults.length} 条`,
          data: { results: normalizedResults },
          meta: { tool: 'web_search_supplier_signals', topK: Number(topK) },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error), data: { results: [] } }))
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
        const rows = items.slice(0, Number(topN))
        return JSON.stringify(toToolResult({
          ok: true,
          content: `重排完成（fallback），返回 ${rows.length} 条`,
          data: { rows, mode: 'fallback_no_reranker' },
        }))
      }
      try {
        const rows = await rerank({ query, candidates: items, topN: Number(topN) })
        const normalizedRows = Array.isArray(rows) ? rows : []
        return JSON.stringify(toToolResult({
          ok: true,
          content: `重排完成，返回 ${normalizedRows.length} 条`,
          data: { rows: normalizedRows },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({
          ok: false,
          error: toText(error?.message || error),
          data: { rows: items.slice(0, Number(topN)) },
        }))
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
        return JSON.stringify(toToolResult({ ok: true, content: 'trace logged', data: { skipped: false } }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error) }))
      }
    },
  })

  const chartGeneratorTool = new DynamicStructuredTool({
    name: 'python_chart_generator',
    description: '根据结构化数据生成图表文件（PNG），返回下载信息。',
    schema: z.object({
      chartType: z.string().default('bar'),
      title: z.string().default('供应商匹配分布'),
      labels: z.array(z.string()).default([]),
      values: z.array(z.number()).default([]),
    }),
    func: async ({ chartType, title, labels, values }) => {
      if (typeof generateChart !== 'function') {
        return JSON.stringify(toToolResult({ ok: false, error: 'chart_generator_not_configured' }))
      }
      try {
        const result = await generateChart({ chartType, title, labels, values })
        return JSON.stringify(toToolResult({
          ok: true,
          content: `图表已生成：${toText(result?.fileName || title)}`,
          artifact: result && typeof result === 'object' ? result : null,
          data: result && typeof result === 'object' ? result : {},
          meta: { tool: 'python_chart_generator', chartType: toText(chartType) },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error) }))
      }
    },
  })

  const fileExporterTool = new DynamicStructuredTool({
    name: 'file_exporter',
    description: '将寻源结果导出为文件（md/csv/xlsx），返回下载信息。',
    schema: z.object({
      format: z.enum(['md', 'csv', 'xlsx']).default('md'),
      title: z.string().default('精准寻源报告'),
      rows: z.array(z.any()).default([]),
      summary: z.string().default(''),
    }),
    func: async ({ format, title, rows, summary }) => {
      if (typeof exportFile !== 'function') {
        return JSON.stringify(toToolResult({ ok: false, error: 'file_exporter_not_configured' }))
      }
      try {
        const result = await exportFile({ format, title, rows, summary })
        return JSON.stringify(toToolResult({
          ok: true,
          content: `文件已导出：${toText(result?.fileName || title)}`,
          artifact: result && typeof result === 'object' ? result : null,
          data: result && typeof result === 'object' ? result : {},
          meta: { tool: 'file_exporter', format: toText(format) },
        }))
      } catch (error) {
        return JSON.stringify(toToolResult({ ok: false, error: toText(error?.message || error) }))
      }
    },
  })

  return {
    tools: [sqlSearchSuppliers, ragSearchEvidence, webSearchTool, rerankTool, traceTool, chartGeneratorTool, fileExporterTool],
    byName: {
      sqlSearchSuppliers,
      ragSearchEvidence,
      webSearchTool,
      rerankTool,
      traceTool,
      chartGeneratorTool,
      fileExporterTool,
    },
  }
}

export function getLangChainIntegrationHealth() {
  const keys = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    serpapi: Boolean(process.env.SERPAPI_API_KEY),
    langsmith: Boolean(process.env.LANGSMITH_API_KEY),
    unstructured: Boolean(process.env.UNSTRUCTURED_API_KEY),
  }
  return {
    ok: Object.values(keys).some(Boolean),
    keys,
  }
}

export function getLangchainToolCatalog() {
  const health = getLangChainIntegrationHealth()
  return [
    {
      key: 'db_chat',
      label: '数据库检索',
      available: true,
      reason: '',
      scopes: ['precise_sourcing', 'langchain_shell'],
    },
    {
      key: 'local_kb',
      label: '知识库检索',
      available: true,
      reason: '',
      scopes: ['precise_sourcing', 'langchain_shell'],
    },
    {
      key: 'web_search',
      label: '互联网搜索',
      available: Boolean(health.keys.serpapi),
      reason: health.keys.serpapi ? '' : '未配置 SERPAPI_API_KEY',
      scopes: ['precise_sourcing', 'langchain_shell'],
    },
    {
      key: 'image_gen',
      label: '图片生成',
      available: Boolean(health.keys.openai),
      reason: health.keys.openai ? '' : '未配置 OPENAI_API_KEY/LLM_API_KEY',
      scopes: ['precise_sourcing', 'langchain_shell'],
    },
    {
      key: 'python_chart_generator',
      label: '图表生成',
      available: true,
      reason: '',
      scopes: ['precise_sourcing'],
    },
    {
      key: 'file_exporter',
      label: '文件导出',
      available: true,
      reason: '',
      scopes: ['precise_sourcing'],
    },
    {
      key: 'arxiv',
      label: 'ARXIV论文',
      available: false,
      reason: '当前项目未接入该工具执行链路',
      scopes: [],
    },
    {
      key: 'calculator',
      label: '数学计算器',
      available: false,
      reason: '当前项目未接入该工具执行链路',
      scopes: [],
    },
    {
      key: 'youtube',
      label: '油管视频',
      available: false,
      reason: '当前项目未接入该工具执行链路',
      scopes: [],
    },
    {
      key: 'shell',
      label: '系统命令',
      available: false,
      reason: '当前项目未接入该工具执行链路',
      scopes: [],
    },
  ]
}

export function normalizeToolJsonResult(text) {
  const raw = toText(text)
  const parsed = parseJsonSafe(raw, null)
  return parsed && typeof parsed === 'object' ? parsed : { ok: false, error: 'invalid_tool_result', raw }
}
