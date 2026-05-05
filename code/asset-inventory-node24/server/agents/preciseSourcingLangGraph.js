import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const GraphState = Annotation.Root({
  userInput: Annotation(),
  authHeader: Annotation(),
  kbId: Annotation(),
  topK: Annotation(),
  traces: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  supplierRows: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  kbHits: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  answer: Annotation({ reducer: (_x, y) => y, default: () => '' }),
})

function pushTrace(state, trace) {
  return [...(Array.isArray(state.traces) ? state.traces : []), trace]
}

function buildReActRoundsFromTraces(traces = []) {
  const rounds = []
  let current = null
  for (const item of traces) {
    const step = String(item?.step || '').toLowerCase()
    const node = {
      step: String(item?.step || ''),
      title: String(item?.title || ''),
      detail: String(item?.detail || ''),
      tool: String(item?.tool || ''),
      input: item?.input || null,
    }
    if (!current || step === 'plan' || step.startsWith('think')) {
      current = { round: rounds.length + 1, thought: null, action: null, observation: null }
      rounds.push(current)
    }
    if (step === 'plan' || step.startsWith('think')) current.thought = node
    else if (step.startsWith('act')) current.action = node
    else if (step.startsWith('observe')) current.observation = node
  }
  return rounds
}

export function createPreciseSourcingLangGraph(tools) {
  const graph = new StateGraph(GraphState)
    .addNode('plan', async (state) => ({
      traces: pushTrace(state, {
        step: 'plan',
        title: '需求解析',
        detail: `已解析用户需求：${String(state.userInput || '').slice(0, 160)}`,
      }),
    }))
    .addNode('think_db', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_1',
        title: '思考',
        detail: '先执行 DB 检索获取结构化供应商，再判断是否扩展到 RAG。',
      }),
    }))
    .addNode('act_db', async (state) => {
      const supplierRows = await tools.searchSuppliers(state.userInput, state.authHeader)
      return {
        supplierRows,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
            step: 'act_db',
            title: '执行',
            detail: '调用 DB Tool：/api/suppliers',
            tool: 'db.searchSuppliers',
            input: { keyword: state.userInput, limit: 20, fuzzy: true },
          }),
        }, {
          step: 'observe_db',
          title: '观察',
          detail: `supplier 表命中 ${Array.isArray(supplierRows) ? supplierRows.length : 0} 条`,
        }),
      }
    })
    .addNode('think_rag', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_2',
        title: '思考',
        detail: Array.isArray(state.supplierRows) && state.supplierRows.length > 0
          ? 'DB 有命中，继续用 RAG 做证据补强。'
          : 'DB 命中不足，转向 RAG 扩大召回。',
      }),
    }))
    .addNode('act_rag', async (state) => {
      if (!state.kbId) {
        return {
          kbHits: [],
          traces: pushTrace(state, {
            step: 'observe_rag',
            title: '观察',
            detail: '未选择知识库，跳过 RAG。',
          }),
        }
      }
      const kbHits = await tools.searchRag(state.kbId, state.userInput, state.topK, state.authHeader)
      return {
        kbHits,
        traces: pushTrace({
          ...state,
          traces: pushTrace(state, {
            step: 'act_rag',
            title: '执行',
            detail: `调用 RAG Tool：/api/knowledge-bases/${state.kbId}/search`,
            tool: 'rag.searchKnowledgeBase',
            input: { kbId: state.kbId, query: state.userInput, topK: state.topK, metric: 'cosine', strictKeyword: false },
          }),
        }, {
          step: 'observe_rag',
          title: '观察',
          detail: `知识库命中 ${Array.isArray(kbHits) ? kbHits.length : 0} 条（kbId=${state.kbId}）`,
        }),
      }
    })
    .addNode('think_llm', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_3',
        title: '思考',
        detail: '基于 DB + RAG 证据归纳，生成最终建议。',
      }),
    }))
    .addNode('act_llm', async (state) => {
      const answer = await tools.generateAnswer({
        userInput: state.userInput,
        supplierRows: state.supplierRows,
        kbHits: state.kbHits,
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
    .addEdge('act_rag', 'think_llm')
    .addEdge('think_llm', 'act_llm')
    .addEdge('act_llm', END)

  const app = graph.compile()

  return {
    async run(input) {
      const result = await app.invoke({
        userInput: input.userInput,
        authHeader: input.authHeader || '',
        kbId: input.kbId,
        topK: input.topK,
        traces: [],
        supplierRows: [],
        kbHits: [],
        answer: '',
      })
      return {
        traces: result.traces || [],
        react: { rounds: buildReActRoundsFromTraces(result.traces || []) },
        supplierRows: result.supplierRows || [],
        kbHits: result.kbHits || [],
        answer: result.answer || '',
      }
    },
  }
}
