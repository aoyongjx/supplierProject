import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const GraphState = Annotation.Root({
  onEvent: Annotation({ reducer: (_x, y) => y, default: () => null }),
  userInput: Annotation(),
  authHeader: Annotation(),
  kbId: Annotation(),
  kbIds: Annotation(),
  topK: Annotation(),
  finalTopN: Annotation(),
  webTopK: Annotation(),
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
  fusionWeights: Annotation(),
  sourceQuota: Annotation(),
  streamTokens: Annotation({ reducer: (_x, y) => y, default: () => false }),
  intent: Annotation({ reducer: (_x, y) => y, default: () => 'supplier_search' }),
  demand: Annotation({ reducer: (_x, y) => y, default: () => ({}) }),
  executionPlan: Annotation({ reducer: (_x, y) => y, default: () => ({}) }),
  traces: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  supplierRows: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  kbHits: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  webHits: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  fusedEvidence: Annotation({ reducer: (_x, y) => y, default: () => ({ suppliers: [], kbHits: [] }) }),
  rerankedEvidence: Annotation({ reducer: (_x, y) => y, default: () => ({ suppliers: [], meta: {} }) }),
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

function buildPlanStep({ id, title, objective, tool, enabled, budget = {}, successCriteria = '', fallback = '' }) {
  return {
    id,
    title,
    objective,
    tool,
    enabled: enabled === true,
    budget,
    successCriteria,
    fallback,
  }
}

function summarizePlanSteps(steps = []) {
  return steps
    .filter((step) => step?.enabled)
    .map((step, index) => `${index + 1}) ${step.title}`)
}

function summarizeWebProviders(hits = []) {
  const list = Array.isArray(hits) ? hits : []
  const stat = new Map()
  for (const item of list) {
    const key = String(item?._provider || 'unknown').trim() || 'unknown'
    stat.set(key, Number(stat.get(key) || 0) + 1)
  }
  const parts = Array.from(stat.entries()).map(([k, v]) => `${k}:${v}`)
  return parts.length > 0 ? parts.join(', ') : 'none'
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
      const route = typeof tools.routeRequest === 'function'
        ? await tools.routeRequest({
          userInput: state.userInput,
          selectedTools,
          selectedDbTables: state.selectedDbTables,
          kbIds: state.kbIds,
          kbId: state.kbId,
          model: state.model,
        })
        : null
      const intent = String(route?.intent || await tools.classifyIntent(state.userInput) || 'direct_answer')
      const parsedDemand = await tools.parseDemand(state.userInput)
      const demand = {
        ...parsedDemand,
        ...(route?.demand && typeof route.demand === 'object' ? route.demand : {}),
        route: route || null,
      }
      const keywords = Array.isArray(demand?.keywords) ? demand.keywords.filter(Boolean) : []
      const hasStrongKeyword = keywords.length > 0
      const routeNeedsTools = route
        ? (route.needDb === true || route.needRag === true || route.needWeb === true)
        : intent !== 'direct_answer'
      // 仅在“已判定需要工具”时，才把已选工具视为强制执行约束；
      // 对纯自然语言直答保持 direct_answer，不触发检索流程。
      const forceUseSelectedTools = routeNeedsTools && hasToolFilter
      const shouldUseTools = routeNeedsTools
      const executionPlan = {
        needsTools: shouldUseTools,
        useDb: shouldUseTools && allowDb && (forceUseSelectedTools || route?.needDb === true),
        useRag: shouldUseTools && allowRag && (forceUseSelectedTools || route?.needRag === true),
        useWeb: shouldUseTools && allowWeb && (forceUseSelectedTools || route?.needWeb === true),
        directAnswer: String(route?.directAnswer || ''),
        routeReason: forceUseSelectedTools
          ? `按用户已选工具强制执行。${String(route?.reason || '')}`.trim()
          : String(route?.reason || ''),
        routeTarget: shouldUseTools ? 'langchain_tools' : 'direct_llm',
        dbQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        ragQuery: hasStrongKeyword ? keywords.join(' ') : String(state.userInput || ''),
        webQuery: hasStrongKeyword ? `${keywords.join(' ')} 供应商` : `${String(state.userInput || '')} 供应商`,
        fallbackWhenDbFails: true,
        fallbackWhenRagFails: true,
        selectedTools,
      }
      const keywordList = Array.isArray(demand?.keywords) ? demand.keywords.filter(Boolean) : []
      const routeHints = route && typeof route === 'object'
        ? `routeNeed(DB=${route.needDb === true ? '是' : '否'},RAG=${route.needRag === true ? '是' : '否'},WEB=${route.needWeb === true ? '是' : '否'})`
        : 'routeNeed(未知)'
      executionPlan.steps = [
        buildPlanStep({
          id: 'db',
          title: '数据库候选召回',
          objective: '优先从结构化供应商、画像和产业链表中召回可解释候选。',
          tool: 'db.searchSuppliers',
          enabled: executionPlan.useDb,
          budget: { topK: Math.min(Math.max(Number(state.dbTopK || 10), 1), 50), attempts: 1 },
          successCriteria: '返回至少 1 条带公司名称或节点名称的候选。',
          fallback: executionPlan.useRag || executionPlan.useWeb ? '无命中时继续执行知识库/互联网分支。' : '无命中时输出缺口与建议关键词。',
        }),
        buildPlanStep({
          id: 'rag',
          title: '知识库证据补强',
          objective: '用本地知识库补充产品、客户、资质和风险等上下文证据。',
          tool: 'rag.searchKnowledgeBase',
          enabled: executionPlan.useRag,
          budget: { topK: Math.min(Math.max(Number(state.topK || 3), 1), 20), attempts: 1 },
          successCriteria: '返回至少 1 条与需求关键词相关的知识片段。',
          fallback: executionPlan.useDb || executionPlan.useWeb ? '无命中时保留其他分支证据继续融合。' : '无命中时说明知识库覆盖不足。',
        }),
        buildPlanStep({
          id: 'web',
          title: '互联网线索校验',
          objective: '只在需要或显式选择时搜索公开线索，用于发现外部候选和交叉验证。',
          tool: 'web.searchSupplierSignals',
          enabled: executionPlan.useWeb,
          budget: { topK: Math.min(Math.max(Number(state.webTopK || 10), 1), 50), attempts: 1 },
          successCriteria: '返回至少 1 条公开网页线索。',
          fallback: 'Web 失败不阻断主流程，标记为待人工核验。',
        }),
        buildPlanStep({
          id: 'fuse',
          title: '证据融合与排序',
          objective: '对 DB/RAG/Web 结果去重、打分和归因，形成候选清单。',
          tool: 'evidence.fuse',
          enabled: routeNeedsTools,
          budget: { maxSuppliers: 20, maxKbHits: 20, maxWebHits: 10 },
          successCriteria: '输出候选、证据命中和缺口说明。',
          fallback: '证据为空时输出无命中原因和下一步检索建议。',
        }),
        buildPlanStep({
          id: 'answer',
          title: routeNeedsTools ? 'LLM结构化生成（基于Rerank结果）' : '直接回答',
          objective: routeNeedsTools ? '用融合证据生成结论、理由、风险和下一步动作。' : '不调用外部工具，直接回答用户当前问题。',
          tool: 'llm.chatCompletions',
          enabled: true,
          budget: { temperature: Number(state.temperature || 0.2), evidenceTopK: 5 },
          successCriteria: routeNeedsTools ? '回答必须引用已有证据，不编造供应商。' : '回答要贴合用户问题，不展示检索命中统计。',
          fallback: routeNeedsTools ? '模型失败时使用规则化 fallback 报告。' : '模型失败时给出当前已选模型和能力说明。',
        }),
      ]
      const plannedBranches = [
        executionPlan.useDb ? '数据库检索' : '',
        executionPlan.useRag ? '知识库检索' : '',
        executionPlan.useWeb ? '互联网搜索' : '',
      ].filter(Boolean)
      const plannedSteps = summarizePlanSteps(executionPlan.steps)
      if (typeof tools.traceStep === 'function' && shouldUseTools) {
        await tools.traceStep('plan.built', { intent, executionPlan, keywords, plannedBranches, plannedSteps })
      }
      const nextState = {
        intent,
        demand,
        executionPlan,
      }
      if (!shouldUseTools) {
        return { ...nextState, traces: [] }
      }
      return {
        ...nextState,
        traces: pushTrace({
          ...state,
          traces: pushTrace({
            ...state,
            traces: pushTrace(state, {
            step: 'plan',
            title: '需求解析',
          detail: `意图=${intent}；关键词=${keywordList.join(',') || '无'}；已选工具=${selectedTools.join(',') || '全部'}；${routeHints}；计划分解=${plannedSteps.join('；')}；执行开关(DB=${executionPlan.useDb ? '是' : '否'}, RAG=${executionPlan.useRag ? '是' : '否'}, WEB=${executionPlan.useWeb ? '是' : '否'})`,
            }),
          }, {
            step: 'act_plan',
            title: '执行',
            detail: `生成 Plan-then-ReAct 执行计划：${plannedSteps.join(' / ') || '无'}`,
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
          detail: routeNeedsTools
            ? `规划完成：关键词=${Array.isArray(demand?.keywords) && demand.keywords.length > 0 ? demand.keywords.join(', ') : '未提取到显式关键词'}；分支=${plannedBranches.join(' / ') || '无'}；后续=分支执行->融合->模型输出`
            : `规划完成：该问题不需要 DB/RAG/Web；原因=${executionPlan.routeReason || '模型判断可直接回答'}；后续=直接回答`,
        }),
      }
    })
    .addNode('act_direct_answer', async (state) => {
      const rawAnswer = typeof tools.generateDirectAnswer === 'function'
        ? await tools.generateDirectAnswer({
          userInput: state.userInput,
          model: state.model,
          directAnswer: state.executionPlan?.directAnswer,
          routeReason: state.executionPlan?.routeReason,
          selectedTools: Array.isArray(state.selectedTools) ? state.selectedTools : [],
          selectedDbTables: Array.isArray(state.selectedDbTables) ? state.selectedDbTables : [],
          kbId: state.kbId || '',
          kbIds: Array.isArray(state.kbIds) ? state.kbIds : [],
          systemPrompt: state.systemPrompt || '',
          systemPromptPresetKey: state.systemPromptPresetKey || '',
          strictMode: state.strictMode === true,
        })
        : String(state.executionPlan?.directAnswer || '')
      const answer = String(rawAnswer || '').trim() || '你好，我是精准寻源智能体。你可以告诉我想查询的主机厂、品类或供应商线索，我会按你选的工具执行。'
      return {
        answer,
        fusedEvidence: { suppliers: [], kbHits: [], webHits: [] },
        traces: [],
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
      const planSteps = Array.isArray(state.executionPlan?.steps) ? state.executionPlan.steps : []
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
              webHits = await tools.searchWeb(
                state.executionPlan?.webQuery || state.userInput,
                Math.min(Math.max(Number(state.webTopK || 10), 1), 50),
              )
            } catch (error) {
              webError = String(error?.message || error || '')
            }
            traces = pushTrace({ traces }, {
              step: 'act_web',
              title: '执行',
              detail: '调用 Web Tool：公开互联网检索供应商线索。',
              tool: 'web.searchSupplierSignals',
              input: {
                query: state.executionPlan?.webQuery || state.userInput,
                topK: Math.min(Math.max(Number(state.webTopK || 10), 1), 50),
              },
            })
            traces = pushTrace({ traces }, {
              step: 'observe_web',
              title: '观察',
              detail: webError
                ? `Web 检索失败，已降级继续。错误=${webError}`
                : `Web 命中 ${Array.isArray(webHits) ? webHits.length : 0} 条；provider分布=${summarizeWebProviders(webHits)}`,
            })
          },
        },
      ]

      for (const branch of branches) {
        if (!branch.enabled) continue
        const stepPlan = planSteps.find((step) => step?.id === branch.key) || {}
        traces = pushTrace({ traces }, {
          step: `think_${branch.key}`,
          title: '思考',
          detail: `计划步骤：${stepPlan.title || branch.key}；目标=${stepPlan.objective || '按分支检索'}；预算=${JSON.stringify(stepPlan.budget || {})}；成功标准=${stepPlan.successCriteria || '获得可用证据'}`,
        })
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
      const planSteps = Array.isArray(state.executionPlan?.steps) ? state.executionPlan.steps : []
      const stepPlan = planSteps.find((step) => step?.id === 'fuse') || {}
      const fusedEvidence = await tools.fuseEvidence({
        supplierRows: state.supplierRows,
        kbHits: state.kbHits,
        webHits: state.webHits,
        demand: state.demand,
        userInput: state.userInput,
        fusionWeights: state.fusionWeights || {},
      })
      return {
        fusedEvidence,
        traces: pushTrace({
          ...state,
          traces: pushTrace({
            ...state,
            traces: pushTrace(state, {
              step: 'think_fuse',
              title: '思考',
              detail: `计划步骤：${stepPlan.title || '证据融合与排序'}；目标=${stepPlan.objective || '融合多源证据'}；预算=${JSON.stringify(stepPlan.budget || {})}`,
            }),
          }, {
            step: 'act_fuse',
            title: '执行',
            detail: '执行多源证据去重、排序与归因。',
            tool: stepPlan.tool || 'evidence.fuse',
            input: {
              supplierRows: Array.isArray(state.supplierRows) ? state.supplierRows.length : 0,
              kbHits: Array.isArray(state.kbHits) ? state.kbHits.length : 0,
              webHits: Array.isArray(state.webHits) ? state.webHits.length : 0,
            },
          }),
        }, {
          step: 'observe_fuse',
          title: '观察',
          detail: `证据融合完成：DB ${Array.isArray(fusedEvidence?.suppliers) ? fusedEvidence.suppliers.length : 0} 条，RAG ${Array.isArray(fusedEvidence?.kbHits) ? fusedEvidence.kbHits.length : 0} 条，WEB ${Array.isArray(fusedEvidence?.webHits) ? fusedEvidence.webHits.length : 0} 条`,
        }),
      }
    })
    .addNode('rerank_evidence', async (state) => {
      const rerankedEvidence = typeof tools.rerankEvidence === 'function'
        ? await tools.rerankEvidence({
          userInput: state.userInput,
          fusedEvidence: state.fusedEvidence,
          requestedTopN: Math.min(Math.max(Number(state.finalTopN || 10), 1), 50),
          boundaryCount: 3,
          sourceQuota: state.sourceQuota && typeof state.sourceQuota === 'object' ? state.sourceQuota : undefined,
        })
        : { suppliers: state.fusedEvidence?.suppliers || [], meta: {} }
      return {
        rerankedEvidence,
        traces: pushTrace({
          ...state,
          traces: pushTrace({
            ...state,
            traces: pushTrace(state, {
              step: 'think_rerank',
              title: '思考',
              detail: '计划步骤：候选重排；目标=对“查询-候选-证据片段”进行相关性评分，并保留 TopN + 边界样本。',
            }),
          }, {
            step: 'act_rerank',
            title: '执行',
            detail: '执行候选 Rerank，并输出 TopN + 边界样本。',
            tool: 'rerank_supplier_candidates',
            input: {
              fusedSuppliers: Array.isArray(state.fusedEvidence?.suppliers) ? state.fusedEvidence.suppliers.length : 0,
              topK: Math.min(Math.max(Number(state.topK || 10), 1), 20),
            },
          }),
        }, {
          step: 'observe_rerank',
          title: '观察',
          detail: `重排完成：输出 ${Array.isArray(rerankedEvidence?.suppliers) ? rerankedEvidence.suppliers.length : 0} 条；边界样本 ${Array.isArray(rerankedEvidence?.meta?.boundary) ? rerankedEvidence.meta.boundary.length : 0} 条`,
        }),
      }
    })
    .addNode('think_llm', async (state) => ({
      traces: pushTrace(state, {
        step: 'think_3',
        title: '思考',
        detail: '计划步骤：结构化报告输出；基于融合证据生成答复，并按模板组织候选、证据、风险和下一步。',
      }),
    }))
    .addNode('act_llm', async (state) => {
      const answer = await tools.generateAnswer({
        userInput: state.userInput,
        supplierRows: state.rerankedEvidence?.suppliers || state.fusedEvidence?.suppliers || state.supplierRows,
        kbHits: state.fusedEvidence?.kbHits || state.kbHits,
        webHits: state.fusedEvidence?.webHits || state.webHits,
        intent: state.intent,
        demand: state.demand,
        model: state.model,
        systemPrompt: state.systemPrompt,
        systemPromptPresetKey: state.systemPromptPresetKey,
        temperature: state.temperature,
        reportTemplate: state.reportTemplate,
        generateCharts: state.generateCharts,
        streamTokens: state.streamTokens === true,
        onDelta: typeof state.onEvent === 'function'
          ? (delta) => state.onEvent({ type: 'delta', delta: String(delta || '') })
          : null,
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
            input: { withDbEvidence: (state.supplierRows || []).length, withRagEvidence: (state.kbHits || []).length, withWebEvidence: (state.webHits || []).length },
          }),
        }, {
          step: 'observe_llm',
          title: '观察',
          detail: `已融合并重排候选：DB(${(state.supplierRows || []).length}) + RAG(${(state.kbHits || []).length}) + WEB(${(state.webHits || []).length})，并生成答复`,
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
    .addConditionalEdges('plan', (state) => (
      state.executionPlan?.needsTools === true ? 'think_retrieval' : 'act_direct_answer'
    ))
    .addEdge('act_direct_answer', END)
    .addEdge('think_retrieval', 'act_retrieval')
    .addEdge('act_retrieval', 'fuse_evidence')
    .addEdge('fuse_evidence', 'rerank_evidence')
    .addEdge('rerank_evidence', 'think_llm')
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
        finalTopN: input.finalTopN,
        webTopK: input.webTopK,
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
        fusionWeights: input.fusionWeights && typeof input.fusionWeights === 'object' ? input.fusionWeights : {},
        sourceQuota: input.sourceQuota && typeof input.sourceQuota === 'object' ? input.sourceQuota : {},
        streamTokens: input.streamTokens === true,
        intent: 'supplier_search',
        demand: {},
        executionPlan: {},
        traces: [],
        supplierRows: [],
        kbHits: [],
        webHits: [],
        fusedEvidence: { suppliers: [], kbHits: [] },
        rerankedEvidence: { suppliers: [], meta: {} },
        artifacts: [],
        answer: '',
      })
      const needsTools = result.executionPlan?.needsTools === true
      const traces = needsTools ? (result.traces || []) : []
      return {
        traces,
        react: { rounds: needsTools ? buildReActRoundsFromTraces(traces) : [] },
        supplierRows: result.rerankedEvidence?.suppliers || result.fusedEvidence?.suppliers || result.supplierRows || [],
        kbHits: result.fusedEvidence?.kbHits || result.kbHits || [],
        webHits: result.fusedEvidence?.webHits || result.webHits || [],
        rerankMeta: result.rerankedEvidence?.meta || result.fusedEvidence?.rerankMeta || null,
        intent: result.intent || 'supplier_search',
        demand: result.demand || {},
        executionPlan: result.executionPlan || {},
        answer: result.answer || '',
        artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
      }
    },
  }
}
