import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const GraphState = Annotation.Root({
  userInput: Annotation(),
  authHeader: Annotation(),
  kbId: Annotation(),
  kbIds: Annotation(),
  topK: Annotation(),
  dbTopK: Annotation(),
  selectedDbTables: Annotation(),
  selectedSkills: Annotation(),
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
  answer: Annotation({ reducer: (_x, y) => y, default: () => '' }),
})

function pushTrace(state, trace) {
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
    const shouldStartNewRound = (step === 'plan' || step.startsWith('think'))
      && (current.thought || current.action || current.observation)
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
      const intent = await tools.classifyIntent(state.userInput)
      const demand = await tools.parseDemand(state.userInput)
      const keywords = Array.isArray(demand?.keywords) ? demand.keywords.filter(Boolean) : []
      const hasStrongKeyword = keywords.length > 0
      const executionPlan = {
        useDb: intent !== 'kb_qa',
        useRag: intent !== 'db_only',
        useWeb: demand?.needWebSearch === true,
        dbQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        ragQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        webQuery: hasStrongKeyword ? `${keywords.join(' ')} 供应商` : `${String(state.userInput || '')} 供应商`,
        fallbackWhenDbFails: true,
        fallbackWhenRagFails: true,
      }
      if (typeof tools.traceStep === 'function') {
        await tools.traceStep('plan.built', { intent, executionPlan, keywords })
      }
      const steps = [
        '步骤1：按需求抽取关键词与约束条件',
        '步骤2：检索数据库候选供应商',
        '步骤3：检索知识库证据并交叉验证',
        '步骤4：融合证据并输出候选与建议',
      ]
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
              detail: `意图=${intent}；计划=${JSON.stringify(executionPlan)}；${steps.join('；')}`,
            }),
          }, {
            step: 'act_plan',
            title: '执行',
            detail: '生成执行计划并提取关键词/约束。',
            input: {
              userInput: String(state.userInput || ''),
              extractedKeywords: Array.isArray(demand?.keywords) ? demand.keywords : [],
              executionPlan,
            },
          }),
        }, {
          step: 'observe_plan',
          title: '观察',
          detail: `规划完成：关键词=${Array.isArray(demand?.keywords) && demand.keywords.length > 0 ? demand.keywords.join(', ') : '未提取到显式关键词'}`,
        }),
      }
    })
    .addNode('think_db', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_1',
        title: '思考',
        detail: state.intent === 'kb_qa'
          ? '当前意图偏知识问答，DB 检索可降级或跳过。'
          : '优先执行 DB 检索，获得结构化候选供应商。',
      }),
    }))
    .addNode('act_db', async (state) => {
      if (state.executionPlan?.useDb === false) {
        return {
          supplierRows: [],
          traces: pushTrace(state, {
            step: 'observe_db',
            title: '观察',
            detail: '意图为知识问答，DB 检索已跳过。',
          }),
        }
      }
      const selectedDbTables = Array.isArray(state.selectedDbTables) ? state.selectedDbTables : []
      let supplierRows = []
      let dbError = ''
      try {
        supplierRows = await tools.searchSuppliers(state.executionPlan?.dbQuery || state.userInput, state.authHeader, {
          selectedDbTables: state.selectedDbTables,
          dbTopK: state.dbTopK,
          demand: state.demand,
        })
      } catch (error) {
        dbError = String(error?.message || error || '')
      }
      if (typeof tools.traceStep === 'function') {
        await tools.traceStep('db.executed', {
          query: state.executionPlan?.dbQuery || state.userInput,
          rows: Array.isArray(supplierRows) ? supplierRows.length : 0,
          dbError,
        })
      }
      return {
        supplierRows,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
            step: 'act_db',
            title: '执行',
            detail: `调用 DB Tool：${selectedDbTables.length > 0 ? selectedDbTables.join(', ') : '默认全库'}；关键词=${Array.isArray(state?.demand?.keywords) && state.demand.keywords.length > 0 ? state.demand.keywords.join(', ') : String(state.userInput || '').slice(0, 80)}`,
            tool: 'db.searchSuppliers',
            input: {
              keyword: state.executionPlan?.dbQuery || state.userInput,
              extractedKeywords: Array.isArray(state?.demand?.keywords) ? state.demand.keywords : [],
              limit: state.dbTopK || 10,
              fuzzy: true,
              selectedDbTables,
            },
          }),
        }, {
          step: 'observe_db',
          title: '观察',
          detail: dbError
            ? `DB 检索失败，已降级继续执行 RAG。错误=${dbError}`
            : `supplier 表命中 ${Array.isArray(supplierRows) ? supplierRows.length : 0} 条`,
        }),
      }
    })
    .addNode('think_rag', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_2',
        title: '思考',
        detail: state.intent === 'db_only'
          ? '当前意图偏数据库检索，RAG 可选补充。'
          : '执行知识库检索，用于证据补强与交叉验证。',
      }),
    }))
    .addNode('act_rag', async (state) => {
      if (state.executionPlan?.useRag === false) {
        return {
          kbHits: [],
          traces: pushTrace(state, {
            step: 'observe_rag',
            title: '观察',
            detail: '意图为 DB 优先，RAG 检索已跳过。',
          }),
        }
      }
      const targetKbIds = Array.isArray(state.kbIds) && state.kbIds.length > 0
        ? state.kbIds
        : (state.kbId ? [state.kbId] : [])
      if (targetKbIds.length === 0) {
        return {
          kbHits: [],
          traces: pushTrace(state, {
            step: 'observe_rag',
            title: '观察',
            detail: '未选择知识库，跳过 RAG。',
          }),
        }
      }
      let kbHits = []
      let ragError = ''
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
      if (typeof tools.traceStep === 'function') {
        await tools.traceStep('rag.executed', {
          query: state.executionPlan?.ragQuery || state.userInput,
          hits: Array.isArray(kbHits) ? kbHits.length : 0,
          ragError,
        })
      }
      return {
        kbHits,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
          step: 'act_rag',
          title: '执行',
          detail: `调用 RAG Tool：/api/knowledge-bases/:id/search（kb=${targetKbIds.join(',')}）`,
          tool: 'rag.searchKnowledgeBase',
          input: {
            kbIds: targetKbIds,
            query: state.executionPlan?.ragQuery || state.userInput,
            topK: state.topK,
            metric: 'cosine',
            strictKeyword: true,
          },
        }),
      }, {
        step: 'observe_rag',
        title: '观察',
        detail: ragError
          ? `RAG 检索失败，已降级继续回答。错误=${ragError}`
          : `知识库命中 ${Array.isArray(kbHits) ? kbHits.length : 0} 条`,
      }),
    }
  })
    .addNode('act_web', async (state) => {
      if (state.executionPlan?.useWeb !== true) {
        return {
          webHits: [],
          traces: pushTrace(state, {
            step: 'observe_web',
            title: '观察',
            detail: '未请求互联网补充检索，跳过 Web 搜索。',
          }),
        }
      }
      let webHits = []
      let webError = ''
      try {
        webHits = await tools.searchWeb(state.executionPlan?.webQuery || state.userInput, 5)
      } catch (error) {
        webError = String(error?.message || error || '')
      }
      if (typeof tools.traceStep === 'function') {
        await tools.traceStep('web.executed', {
          query: state.executionPlan?.webQuery || state.userInput,
          hits: Array.isArray(webHits) ? webHits.length : 0,
          webError,
        })
      }
      return {
        webHits,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
            step: 'act_web',
            title: '执行',
            detail: '调用 Web Tool：公开互联网检索供应商线索。',
            tool: 'web.searchSupplierSignals',
            input: { query: state.executionPlan?.webQuery || state.userInput, topK: 5 },
          }),
        }, {
          step: 'observe_web',
          title: '观察',
          detail: webError
            ? `Web 检索失败，已降级继续。错误=${webError}`
            : `Web 命中 ${Array.isArray(webHits) ? webHits.length : 0} 条`,
        }),
      }
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
          detail: `证据融合完成：DB ${Array.isArray(fusedEvidence?.suppliers) ? fusedEvidence.suppliers.length : 0} 条，RAG ${Array.isArray(fusedEvidence?.kbHits) ? fusedEvidence.kbHits.length : 0} 条`,
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
    .addEdge(START, 'plan')
    .addEdge('plan', 'think_db')
    .addEdge('think_db', 'act_db')
    .addEdge('act_db', 'think_rag')
    .addEdge('think_rag', 'act_rag')
    .addEdge('act_rag', 'act_web')
    .addEdge('act_web', 'fuse_evidence')
    .addEdge('fuse_evidence', 'think_llm')
    .addEdge('think_llm', 'act_llm')
    .addEdge('act_llm', END)

  const app = graph.compile()

  return {
    async run(input) {
      const result = await app.invoke({
        userInput: input.userInput,
        authHeader: input.authHeader || '',
        kbId: input.kbId,
        kbIds: Array.isArray(input.kbIds) ? input.kbIds : [],
        topK: input.topK,
        dbTopK: input.dbTopK,
        selectedDbTables: Array.isArray(input.selectedDbTables) ? input.selectedDbTables : [],
        selectedSkills: Array.isArray(input.selectedSkills) ? input.selectedSkills : [],
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
        answer: '',
      })
      return {
        traces: result.traces || [],
        react: { rounds: buildReActRoundsFromTraces(result.traces || []) },
        supplierRows: result.fusedEvidence?.suppliers || result.supplierRows || [],
        kbHits: result.fusedEvidence?.kbHits || result.kbHits || [],
        intent: result.intent || 'supplier_search',
        demand: result.demand || {},
        answer: result.answer || '',
      }
    },
  }
}
