import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const GraphState = Annotation.Root({
  onEvent: Annotation({ reducer: (_x, y) => y, default: () => null }),
  userInput: Annotation(),
  authHeader: Annotation(),
  kbId: Annotation(),
  kbIds: Annotation(),
  topK: Annotation(),
  dbTopK: Annotation(),
  selectedDbTables: Annotation(),
  selectedSkills: Annotation(),
  selectedTools: Annotation(),
  model: Annotation(),
  systemPrompt: Annotation(),
  systemPromptPresetKey: Annotation(),
  strictMode: Annotation(),
  generateCharts: Annotation(),
  reportTemplate: Annotation(),
  temperature: Annotation(),
  intent: Annotation({ reducer: (_x, y) => y, default: () => 'supplier_search' }),
  demand: Annotation({ reducer: (_x, y) => y, default: () => ({}) }),
  executionPlan: Annotation({ reducer: (_x, y) => y, default: () => ({}) }),
  traces: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  supplierRows: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  kbHits: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  webHits: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  fusedEvidence: Annotation({ reducer: (_x, y) => y, default: () => ({ suppliers: [], kbHits: [] }) }),
  artifacts: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  answer: Annotation({ reducer: (_x, y) => y, default: () => '' }),
})

function pushTrace(state, trace) {
  try {
    if (state && typeof state.onEvent === 'function') {
      state.onEvent({ type: 'trace', trace })
    }
  } catch {
    // ignore stream callback failure
  }
  return [...(Array.isArray(state.traces) ? state.traces : []), trace]
}

function buildReActRoundsFromTraces(traces = []) {
  const rounds = []
  let current = { round: 1, thought: null, action: null, observation: null }
  rounds.push(current)
  for (const item of traces) {
    const step = String(item?.step || '').toLowerCase()
    const node = {
      step: String(item?.step || ''),
      title: String(item?.title || ''),
      detail: String(item?.detail || ''),
      tool: String(item?.tool || ''),
      input: item?.input || null,
    }
    const shouldStartNewRoundByThought = (step === 'plan' || step.startsWith('think'))
      && (current.thought || current.action || current.observation)
    const shouldStartNewRoundByAction = step.startsWith('act') && current.action && current.observation
    const shouldStartNewRoundByObservation = step.startsWith('observe') && current.observation
    const shouldStartNewRound = shouldStartNewRoundByThought || shouldStartNewRoundByAction || shouldStartNewRoundByObservation
    if (shouldStartNewRound) {
      current = { round: rounds.length + 1, thought: null, action: null, observation: null }
      rounds.push(current)
    }
    if (step === 'plan' || step.startsWith('think')) current.thought = node
    else if (step.startsWith('act')) current.action = node
    else if (step.startsWith('observe')) current.observation = node
  }
  return rounds
    .filter((r) => r.thought || r.action || r.observation)
    .map((r) => {
      const thought = r.thought || { step: 'thought', title: '思考', detail: '' }
      const action = r.action || { step: 'action', title: '执行', detail: '' }
      const observation = r.observation || { step: 'observation', title: '观察', detail: '' }
      return { ...r, thought, action, observation }
    })
}

export function createPreciseSourcingLangGraph(tools) {
  const graph = new StateGraph(GraphState)
    .addNode('plan', async (state) => {
      const selectedTools = Array.isArray(state.selectedTools)
        ? state.selectedTools.map((item) => String(item || '').trim()).filter(Boolean)
        : (Array.isArray(state.selectedSkills) ? state.selectedSkills.map((item) => String(item || '').trim()).filter(Boolean) : [])
      const selectedSet = new Set(selectedTools)
      const hasToolFilter = selectedSet.size > 0
      const allowDb = !hasToolFilter || selectedSet.has('db_chat')
      const allowRag = !hasToolFilter || selectedSet.has('local_kb')
      const allowWeb = !hasToolFilter || selectedSet.has('web_search')
      const intent = await tools.classifyIntent(state.userInput)
      const demand = await tools.parseDemand(state.userInput)
      const keywords = Array.isArray(demand?.keywords) ? demand.keywords.filter(Boolean) : []
      const hasStrongKeyword = keywords.length > 0
      const executionPlan = {
        useDb: allowDb && intent !== 'kb_qa',
        useRag: allowRag && intent !== 'db_only',
        // When tool filter is explicit, selected web_search must execute.
        // Without explicit filter, keep intent-based auto trigger.
        useWeb: allowWeb && (hasToolFilter ? selectedSet.has('web_search') : demand?.needWebSearch === true),
        dbQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        ragQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        webQuery: hasStrongKeyword ? `${keywords.join(' ')} 供应商` : `${String(state.userInput || '')} 供应商`,
        fallbackWhenDbFails: true,
        fallbackWhenRagFails: true,
        selectedTools,
      }
      const plannedBranches = [
        executionPlan.useDb ? '数据库检索' : '',
        executionPlan.useRag ? '知识库检索' : '',
        executionPlan.useWeb ? '互联网搜索' : '',
      ].filter(Boolean)
      const plannedSteps = [
        `1) ${plannedBranches.length > 0 ? plannedBranches.join(' + ') : '无检索分支（配置问题）'}`,
        '2) 证据融合（DB/RAG/WEB）',
        '3) 模型总结输出',
      ]
      if (typeof tools.traceStep === 'function') {
        await tools.traceStep('plan.built', { intent, executionPlan, keywords, plannedBranches, plannedSteps })
      }
      return {
        intent,
        demand,
        executionPlan,
        traces: pushTrace({
          ...state,
          traces: pushTrace({
            ...state,
            traces: pushTrace(state, {
            step: 'plan',
            title: '需求解析',
          detail: `意图=${intent}；已选工具=${selectedTools.join(',') || '全部'}；计划分解=${plannedSteps.join('；')}；执行开关(DB=${executionPlan.useDb ? '是' : '否'}, RAG=${executionPlan.useRag ? '是' : '否'}, WEB=${executionPlan.useWeb ? '是' : '否'})`,
            }),
          }, {
            step: 'act_plan',
            title: '执行',
            detail: `生成执行计划并拆分分支：${plannedBranches.join(' / ') || '无'}`,
            input: {
              userInput: String(state.userInput || ''),
              extractedKeywords: Array.isArray(demand?.keywords) ? demand.keywords : [],
              plannedBranches,
              plannedSteps,
              executionPlan,
            },
          }),
        }, {
          step: 'observe_plan',
          title: '观察',
          detail: `规划完成：关键词=${Array.isArray(demand?.keywords) && demand.keywords.length > 0 ? demand.keywords.join(', ') : '未提取到显式关键词'}；分支=${plannedBranches.join(' / ') || '无'}；后续=分支执行->融合->模型输出`,
        }),
      }
    })
    .addNode('think_retrieval', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_retrieval',
        title: '思考',
        detail: `按规划执行检索分支：DB=${state.executionPlan?.useDb ? '是' : '否'}，RAG=${state.executionPlan?.useRag ? '是' : '否'}，WEB=${state.executionPlan?.useWeb ? '是' : '否'}`,
      }),
    }))
    .addNode('act_retrieval', async (state) => {
      let traces = Array.isArray(state.traces) ? state.traces : []
      let supplierRows = []
      let kbHits = []
      let webHits = []
      const selectedDbTables = Array.isArray(state.selectedDbTables) ? state.selectedDbTables : []
      const targetKbIds = Array.isArray(state.kbIds) && state.kbIds.length > 0
        ? state.kbIds
        : (state.kbId ? [state.kbId] : [])
      const branches = [
        {
          key: 'db',
          enabled: state.executionPlan?.useDb === true,
          run: async () => {
            let dbError = ''
            try {
              supplierRows = await tools.searchSuppliers(state.executionPlan?.dbQuery || state.userInput, state.authHeader, {
                selectedDbTables: state.selectedDbTables,
                dbTopK: state.dbTopK,
                demand: state.demand,
                strictMode: state.strictMode === true,
              })
            } catch (error) {
              dbError = String(error?.message || error || '')
            }
            traces = pushTrace({ traces }, {
              step: 'act_db',
              title: '执行',
              detail: `调用 DB Tool：${selectedDbTables.length > 0 ? selectedDbTables.join(', ') : '默认全库'}`,
              tool: 'db.searchSuppliers',
              input: { keyword: state.executionPlan?.dbQuery || state.userInput, limit: state.dbTopK || 10, selectedDbTables },
            })
            traces = pushTrace({ traces }, {
              step: 'observe_db',
              title: '观察',
              detail: dbError ? `DB 检索失败，已降级继续。错误=${dbError}` : `supplier 表命中 ${Array.isArray(supplierRows) ? supplierRows.length : 0} 条`,
            })
          },
        },
        {
          key: 'rag',
          enabled: state.executionPlan?.useRag === true,
          run: async () => {
            let ragError = ''
            if (targetKbIds.length > 0) {
              try {
                kbHits = await tools.searchRag(
                  targetKbIds,
                  state.executionPlan?.ragQuery || state.userInput,
                  state.topK,
                  state.authHeader,
                  state.demand,
                  state.strictMode === true,
                )
              } catch (error) {
                ragError = String(error?.message || error || '')
              }
            }
            traces = pushTrace({ traces }, {
              step: 'act_rag',
              title: '执行',
              detail: targetKbIds.length > 0
                ? `调用 RAG Tool：/api/knowledge-bases/:id/search（kb=${targetKbIds.join(',')}）`
                : '未选择知识库，跳过 RAG。',
              tool: 'rag.searchKnowledgeBase',
              input: { kbIds: targetKbIds, query: state.executionPlan?.ragQuery || state.userInput, topK: state.topK },
            })
            traces = pushTrace({ traces }, {
              step: 'observe_rag',
              title: '观察',
              detail: targetKbIds.length === 0
                ? '未选择知识库，跳过 RAG。'
                : (ragError ? `RAG 检索失败，已降级继续。错误=${ragError}` : `知识库命中 ${Array.isArray(kbHits) ? kbHits.length : 0} 条`),
            })
          },
        },
        {
          key: 'web',
          enabled: state.executionPlan?.useWeb === true,
          run: async () => {
            let webError = ''
            try {
              webHits = await tools.searchWeb(state.executionPlan?.webQuery || state.userInput, 5)
            } catch (error) {
              webError = String(error?.message || error || '')
            }
            traces = pushTrace({ traces }, {
              step: 'act_web',
              title: '执行',
              detail: '调用 Web Tool：公开互联网检索供应商线索。',
              tool: 'web.searchSupplierSignals',
              input: { query: state.executionPlan?.webQuery || state.userInput, topK: 5 },
            })
            traces = pushTrace({ traces }, {
              step: 'observe_web',
              title: '观察',
              detail: webError ? `Web 检索失败，已降级继续。错误=${webError}` : `Web 命中 ${Array.isArray(webHits) ? webHits.length : 0} 条`,
            })
          },
        },
      ]

      for (const branch of branches) {
        if (!branch.enabled) continue
        await branch.run()
      }
      if (branches.every((b) => !b.enabled)) {
        traces = pushTrace({ traces }, {
          step: 'observe_retrieval',
          title: '观察',
          detail: '未启用任何检索分支，请检查工具选择。',
        })
      }
      return { supplierRows, kbHits, webHits, traces }
    })
    .addNode('fuse_evidence', async (state) => {
      const fusedEvidence = await tools.fuseEvidence({
        supplierRows: state.supplierRows,
        kbHits: state.kbHits,
        webHits: state.webHits,
        demand: state.demand,
      })
      return {
        fusedEvidence,
        traces: pushTrace(state, {
          step: 'observe_fuse',
          title: '观察',
          detail: `证据融合完成：DB ${Array.isArray(fusedEvidence?.suppliers) ? fusedEvidence.suppliers.length : 0} 条，RAG ${Array.isArray(fusedEvidence?.kbHits) ? fusedEvidence.kbHits.length : 0} 条，WEB ${Array.isArray(fusedEvidence?.webHits) ? fusedEvidence.webHits.length : 0} 条`,
        }),
      }
    })
    .addNode('think_llm', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_3',
        title: '思考',
        detail: '基于融合证据生成答复，并按模板组织报告结构。',
      }),
    }))
    .addNode('act_llm', async (state) => {
      const answer = await tools.generateAnswer({
        userInput: state.userInput,
        supplierRows: state.fusedEvidence?.suppliers || state.supplierRows,
        kbHits: state.fusedEvidence?.kbHits || state.kbHits,
        intent: state.intent,
        demand: state.demand,
        model: state.model,
        systemPrompt: state.systemPrompt,
        systemPromptPresetKey: state.systemPromptPresetKey,
        temperature: state.temperature,
        reportTemplate: state.reportTemplate,
        generateCharts: state.generateCharts,
      })
      return {
        answer,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
            step: 'act_llm',
            title: '执行',
            detail: '调用 LLM 生成综合答复。',
            tool: 'llm.chatCompletions',
            input: { withDbEvidence: (state.supplierRows || []).length, withRagEvidence: (state.kbHits || []).length },
          }),
        }, {
          step: 'observe_llm',
          title: '观察',
          detail: `已融合 DB(${(state.supplierRows || []).length}) + RAG(${(state.kbHits || []).length}) 证据并生成答复`,
        }),
      }
    })
    .addNode('act_tools', async (state) => {
      const selectedTools = Array.isArray(state.selectedTools)
        ? state.selectedTools.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      const artifacts = []
      if (selectedTools.includes('python_chart_generator') && typeof tools.generateChart === 'function') {
        try {
          const labels = (state.supplierRows || []).slice(0, 5).map((row) => String(
            row?.companyName || row?.company_name || row?.name || row?.supplier_name || row?.oem_name || '-',
          ))
          const values = (state.supplierRows || []).slice(0, 5).map((row) => Number(row?._matchScore || 0))
          const chart = await tools.generateChart({
            chartType: 'bar',
            title: '候选供应商匹配分布',
            labels,
            values,
          })
          if (chart && chart.ok !== false) artifacts.push({ type: 'chart', ...chart })
        } catch {}
      }
      if (selectedTools.includes('file_exporter') && typeof tools.exportReport === 'function') {
        try {
          const rows = (state.supplierRows || []).slice(0, 20).map((row) => ({
            supplierName: String(row?.companyName || row?.company_name || row?.name || ''),
            score: Number(row?._matchScore || 0),
            reason: Array.isArray(row?._matchFieldScores)
              ? row._matchFieldScores.slice(0, 3).map((item) => `${String(item?.field || '')}(${Number(item?.score || 0).toFixed(2)})`).join('; ')
              : '',
            sourceUrl: String(row?.sourceUrl || row?.source_url || row?.detailUrl || row?.detail_url || ''),
          }))
          const report = await tools.exportReport({
            format: 'xlsx',
            title: '精准寻源候选清单',
            rows,
            summary: `DB命中${(state.supplierRows || []).length}条，RAG命中${(state.kbHits || []).length}条`,
          })
          if (report && report.ok !== false) artifacts.push({ type: 'file', ...report })
        } catch {}
      }
      return {
        artifacts,
        traces: pushTrace(state, {
          step: 'observe_tools',
          title: '观察',
          detail: artifacts.length > 0 ? `工具产出完成：${artifacts.map((x) => x.fileName || x.title || x.type).join(', ')}` : '未选择额外产出工具或无产出',
        }),
      }
    })
    .addEdge(START, 'plan')
    .addEdge('plan', 'think_retrieval')
    .addEdge('think_retrieval', 'act_retrieval')
    .addEdge('act_retrieval', 'fuse_evidence')
    .addEdge('fuse_evidence', 'think_llm')
    .addEdge('think_llm', 'act_llm')
    .addEdge('act_llm', 'act_tools')
    .addEdge('act_tools', END)

  const app = graph.compile()

  return {
    async run(input) {
      const result = await app.invoke({
        onEvent: typeof input.onEvent === 'function' ? input.onEvent : null,
        userInput: input.userInput,
        authHeader: input.authHeader || '',
        kbId: input.kbId,
        kbIds: Array.isArray(input.kbIds) ? input.kbIds : [],
        topK: input.topK,
        dbTopK: input.dbTopK,
        selectedDbTables: Array.isArray(input.selectedDbTables) ? input.selectedDbTables : [],
        selectedSkills: Array.isArray(input.selectedSkills) ? input.selectedSkills : [],
        selectedTools: Array.isArray(input.selectedTools) ? input.selectedTools : [],
        model: String(input.model || '').trim(),
        systemPrompt: String(input.systemPrompt || ''),
        systemPromptPresetKey: String(input.systemPromptPresetKey || ''),
        strictMode: input.strictMode === true,
        generateCharts: input.generateCharts !== false,
        reportTemplate: input.reportTemplate || null,
        temperature: Number(input.temperature || 0.2),
        intent: 'supplier_search',
        demand: {},
        executionPlan: {},
        traces: [],
        supplierRows: [],
        kbHits: [],
        webHits: [],
        fusedEvidence: { suppliers: [], kbHits: [] },
        artifacts: [],
        answer: '',
      })
      return {
        traces: result.traces || [],
        react: { rounds: buildReActRoundsFromTraces(result.traces || []) },
        supplierRows: result.fusedEvidence?.suppliers || result.supplierRows || [],
        kbHits: result.fusedEvidence?.kbHits || result.kbHits || [],
        webHits: result.fusedEvidence?.webHits || result.webHits || [],
        intent: result.intent || 'supplier_search',
        demand: result.demand || {},
        executionPlan: result.executionPlan || {},
        answer: result.answer || '',
        artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
      }
    },
  }
}
