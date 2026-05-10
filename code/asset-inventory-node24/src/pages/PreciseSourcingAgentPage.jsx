import { AppstoreOutlined, DeploymentUnitOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Checkbox, Collapse, Empty, Input, Modal, Select, Slider, Space, Tabs, Tag, Typography, Upload, message } from 'antd'
import { CanvasWidget, SelectionBoxLayerFactory } from '@projectstorm/react-canvas-core'
import { DefaultDiagramState, DiagramEngine, DiagramModel, LinkLayerFactory, NodeLayerFactory } from '@projectstorm/react-diagrams-core'
import { DefaultLinkFactory, DefaultLinkModel, DefaultNodeFactory, DefaultNodeModel, DefaultPortFactory } from '@projectstorm/react-diagrams-defaults'
import { useEffect, useMemo, useRef, useState } from 'react'
import { chatPreciseSourcingAgentStream } from '../api/agentApi'
import { fetchKnowledgeBases } from '../api/knowledgeBaseApi'
import { fetchLangchainSessionState, fetchLangchainTools, saveLangchainSessionState } from '../api/langchainShellApi'
import { fetchModelProviders } from '../api/modelManagementApi'
import { testModelProvider } from '../api/modelManagementApi'
import assistantAvatarSrc from '../assets/chatchat_icon_blue_square_v2.png'

const { Text } = Typography

const DB_OPTIONS = [
  { label: 'PostgreSQL(main/public) / suppliers', value: 'main.suppliers' },
  { label: 'PostgreSQL(main/public) / supplier_profiles', value: 'main.supplier_profiles' },
  { label: 'PostgreSQL(main/public) / supply_chain_node', value: 'main.supply_chain_node' },
  { label: 'PostgreSQL(main/public) / gas_supply_chain_node', value: 'main.gas_supply_chain_node' },
  { label: 'PostgreSQL(main/public) / gas_suppliers', value: 'main.gas_suppliers' },
  { label: 'PostgreSQL(main/public) / gas_supplier_profiles', value: 'main.gas_supplier_profiles' },
  { label: 'PostgreSQL(main/public) / gas_oems', value: 'main.gas_oems' },
  { label: 'PostgreSQL(main/public) / inventories', value: 'main.inventories' },
]

const TEMPLATE_TYPE_OPTIONS = [
  { label: '无', value: 'none' },
  { label: 'PPT 模板', value: 'ppt' },
  { label: 'Word 模板', value: 'word' },
  { label: 'Excel 模板', value: 'excel' },
]
const PRECISE_SOURCING_TOOL_KEYS = new Set(['db_chat', 'local_kb', 'web_search', 'image_gen', 'python_chart_generator', 'file_exporter'])
const REQUIRED_PRECISE_TOOL_OPTIONS = [
  { key: 'db_chat', label: '数据库检索' },
  { key: 'local_kb', label: '知识库检索' },
  { key: 'web_search', label: '互联网搜索' },
  { key: 'image_gen', label: '图片生成' },
  { key: 'python_chart_generator', label: '图表生成' },
  { key: 'file_exporter', label: '文件导出' },
]
const TOOL_LABEL_MAP = {
  db_chat: '数据库检索',
  local_kb: '知识库检索',
  web_search: '互联网搜索',
  image_gen: '图片生成',
  python_chart_generator: '图表生成',
  file_exporter: '文件导出',
}
const MODEL_STORAGE_KEY = 'precise_sourcing_selected_model_v1'
const FLOW_NODE_STYLE = {
  border: '1px solid #dbeafe',
  background: '#eff6ff',
  borderRadius: 8,
  padding: '8px 10px',
}
const DEFAULT_SYSTEM_PROMPT = `你是汽车供应链精准寻源助手。
目标：基于数据库/知识库/互联网证据，为用户输出可执行的候选供应商建议。
要求：
1) 优先给结论，再给证据与下一步。
2) 候选供应商输出TopN（由证据质量决定），每条包含：名称、匹配理由、风险提示。
3) 不编造；无证据时明确说明并给补充检索建议。
4) 输出简洁、结构化，使用中文。`
const PROMPT_PRESETS = [
  {
    key: 'default',
    label: '默认平衡版',
    prompt: DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'risk',
    label: '严格采购风控版',
    prompt: `你是汽车供应链采购风控助手。
目标：优先控制风险，再推荐候选供应商。
要求：
1) 先给风险结论（高/中/低）与原因，再给候选。
2) 每个候选包含：名称、匹配点、主要风险、建议核验项。
3) 证据不足时必须标注“待核验”，禁止主观推断。
4) 输出TopN，中文，简洁结构化。`,
  },
  {
    key: 'fast',
    label: '快速线索筛选版',
    prompt: `你是汽车供应链线索筛选助手。
目标：快速给出可跟进的供应商线索清单。
要求：
1) 先直接回答，再给TopN候选。
2) 每个候选只写：名称 + 一句话理由 + 推荐动作。
3) 控制篇幅，优先高相关结果；无命中就给替代关键词。
4) 中文输出，节奏快，不展开冗长解释。`,
  },
]

export default function PreciseSourcingAgentPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)

  const [tools, setTools] = useState([])
  const [selectedTools, setSelectedTools] = useState([])
  const [kbList, setKbList] = useState([])
  const [selectedKbIds, setSelectedKbIds] = useState([])
  const [selectedDbTables, setSelectedDbTables] = useState([])
  const [strictMode, setStrictMode] = useState(false)
  const [templateType, setTemplateType] = useState('none')
  const [templateFile, setTemplateFile] = useState(null)
  const [kbTopK, setKbTopK] = useState(3)
  const [dbTopK, setDbTopK] = useState(10)
  const [temperature, setTemperature] = useState(0.7)
  const [fusionWeightDb, setFusionWeightDb] = useState(1)
  const [fusionWeightKb, setFusionWeightKb] = useState(0.8)
  const [fusionWeightWeb, setFusionWeightWeb] = useState(1.2)
  const [selectedModelName, setSelectedModelName] = useState('gpt-5.4')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [systemPromptEnabled, setSystemPromptEnabled] = useState(true)
  const [systemPromptPresetKey, setSystemPromptPresetKey] = useState('default')
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState('gpt-5.4')
  const [modelProviderDraft, setModelProviderDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [promptEnabledDraft, setPromptEnabledDraft] = useState(true)
  const [promptPresetKeyDraft, setPromptPresetKeyDraft] = useState('default')
  const [modelProviders, setModelProviders] = useState([])
  const [modelTestLoading, setModelTestLoading] = useState(false)
  const [modelTestResult, setModelTestResult] = useState(null)
  const [flowDialogOpen, setFlowDialogOpen] = useState(false)
  const [flowTabKey, setFlowTabKey] = useState('logic')
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false)
  const [artifactPreviewTitle, setArtifactPreviewTitle] = useState('')
  const [artifactPreviewUrl, setArtifactPreviewUrl] = useState('')

  const [sessions, setSessions] = useState([{ name: 'default', messages: [] }])
  const [currentSession, setCurrentSession] = useState('default')
  const viewportRef = useRef(null)

  useEffect(() => {
    try {
      const savedModelRaw = String(window.localStorage.getItem(MODEL_STORAGE_KEY) || '').trim()
      const savedModel = savedModelRaw
      if (savedModel) {
        setSelectedModelName(savedModel)
        setModelDraft(savedModel)
      }
    } catch (error) {
      void error
    }

    fetchLangchainTools()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setTools(list)
      })
      .catch(() => setTools([]))

    fetchModelProviders()
      .then((rows) => setModelProviders(Array.isArray(rows) ? rows : []))
      .catch(() => setModelProviders([]))

    fetchKnowledgeBases()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setKbList(list)
      })
      .catch((error) => {
        message.error(error?.message || '读取知识库失败，请稍后重试')
      })

    fetchLangchainSessionState('precise_sourcing')
      .then((state) => {
        const rows = Array.isArray(state?.sessions) ? state.sessions : []
        if (rows.length > 0) {
          setSessions(rows)
          const current = String(state?.currentSession || rows[0].name)
          const exists = rows.some((item) => item.name === current)
          setCurrentSession(exists ? current : rows[0].name)
        }
      })
      .catch((error) => message.error(error.message || '加载历史会话失败'))
      .finally(() => setSessionStateHydrated(true))
  }, [])

  useEffect(() => {
    try {
      if (selectedModelName) window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModelName)
    } catch (error) {
      void error
    }
  }, [selectedModelName])

  useEffect(() => {
    if (!sessionStateHydrated) return
    const timer = window.setTimeout(() => {
      void saveLangchainSessionState({ chatType: 'precise_sourcing', sessions, currentSession }).catch((error) => {
        message.error(error.message || '保存会话失败')
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sessions, currentSession, sessionStateHydrated])

  const toolOptions = useMemo(
    () => {
      const base = (Array.isArray(tools)
        ? tools
          .filter((item) => item
            && item.available !== false
            && (
              (Array.isArray(item.scopes) && item.scopes.includes('precise_sourcing'))
              || PRECISE_SOURCING_TOOL_KEYS.has(String(item.key || ''))
            ))
          .map((item) => ({ label: item.label || item.key, value: item.key }))
        : [])
      const merged = new Map(base.map((item) => [item.value, item]))
      for (const req of REQUIRED_PRECISE_TOOL_OPTIONS) {
        if (!merged.has(req.key)) merged.set(req.key, { label: req.label, value: req.key })
      }
      return Array.from(merged.values())
    },
    [tools],
  )
  const kbOptions = useMemo(
    () => (Array.isArray(kbList) ? kbList.map((item) => ({ label: item.name, value: String(item.id) })) : []),
    [kbList],
  )
  const activeSession = useMemo(
    () => sessions.find((item) => item.name === currentSession) || sessions[0],
    [sessions, currentSession],
  )
  const activeMessages = activeSession?.messages || []
  const latestAssistantMessage = useMemo(
    () => [...activeMessages].reverse().find((item) => item?.role === 'assistant') || null,
    [activeMessages],
  )
  const promptPreviewText = systemPromptEnabled ? systemPrompt : ''
  const providerOptions = useMemo(
    () => (Array.isArray(modelProviders)
      ? modelProviders.map((item) => ({ label: item.providerName, value: item.providerName }))
      : []),
    [modelProviders],
  )
  const modelNameOptions = useMemo(() => {
    const provider = (Array.isArray(modelProviders) ? modelProviders : []).find((item) => item.providerName === modelProviderDraft)
    const rows = Array.isArray(provider?.fetchedModels) && provider.fetchedModels.length > 0
      ? provider.fetchedModels
      : (Array.isArray(provider?.models) ? provider.models : [])
    const names = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)
    return [...new Set(names)].map((name) => ({ label: name, value: name }))
  }, [modelProviders, modelProviderDraft])
  const activeFlowBranches = useMemo(() => {
    const toolsSet = new Set(Array.isArray(selectedTools) ? selectedTools : [])
    const evidence = latestAssistantMessage?.evidence || {}
    const rounds = Array.isArray(latestAssistantMessage?.react?.rounds) ? latestAssistantMessage.react.rounds : []
    const qs = latestAssistantMessage?.queryStatements && typeof latestAssistantMessage.queryStatements === 'object'
      ? latestAssistantMessage.queryStatements
      : {}
    const usedWebByTrace = rounds.some((r) => {
      const actionText = `${String(r?.action?.title || '')} ${String(r?.action?.detail || '')}`.toLowerCase()
      return actionText.includes('web') || actionText.includes('互联网')
    })
    const usedWebByQuery = Boolean(String(qs?.web?.keyword || '').trim())
    return {
      db: (Array.isArray(evidence?.suppliers) && evidence.suppliers.length > 0) || (toolsSet.has('db_chat') && selectedDbTables.length > 0),
      kb: (Array.isArray(evidence?.kbHits) && evidence.kbHits.length > 0) || (toolsSet.has('local_kb') && selectedKbIds.length > 0),
      web: usedWebByTrace || usedWebByQuery || toolsSet.has('web_search'),
      image: toolsSet.has('image_gen'),
      chart: toolsSet.has('python_chart_generator'),
      export: toolsSet.has('file_exporter') || templateType !== 'none',
    }
  }, [selectedTools, selectedDbTables, selectedKbIds, templateType, latestAssistantMessage])
  const selectedToolLabels = useMemo(
    () => (Array.isArray(selectedTools) ? selectedTools.map((key) => TOOL_LABEL_MAP[key] || key).filter(Boolean) : []),
    [selectedTools],
  )
  const activeFusionTools = useMemo(() => {
    const set = new Set(Array.isArray(selectedTools) ? selectedTools : [])
    return [
      { key: 'db', label: 'DB', enabled: set.has('db_chat') },
      { key: 'kb', label: '知识库', enabled: set.has('local_kb') },
      { key: 'web', label: 'Web', enabled: set.has('web_search') },
    ].filter((x) => x.enabled)
  }, [selectedTools])
  const effectiveFusionWeights = useMemo(() => {
    const count = activeFusionTools.length
    const has = (k) => activeFusionTools.some((x) => x.key === k)
    if (count === 1) {
      return {
        db: has('db') ? 3 : 0,
        kb: has('kb') ? 3 : 0,
        web: has('web') ? 3 : 0,
      }
    }
    return {
      db: has('db') ? Number(fusionWeightDb) : 0,
      kb: has('kb') ? Number(fusionWeightKb) : 0,
      web: has('web') ? Number(fusionWeightWeb) : 0,
    }
  }, [activeFusionTools, fusionWeightDb, fusionWeightKb, fusionWeightWeb])
  const flowConfigSummary = useMemo(() => ({
    tools: selectedToolLabels.length > 0 ? selectedToolLabels.join('、') : '未选择',
    kb: selectedKbIds.length > 0 ? `${selectedKbIds.length} 个` : '未选择',
    db: selectedDbTables.length > 0 ? `${selectedDbTables.length} 张表` : '未选择',
    model: selectedModelName || '未设置',
    prompt: systemPromptEnabled ? '启用' : '未启用',
    template: templateType === 'none' ? '无' : templateType,
  }), [selectedToolLabels, selectedKbIds, selectedDbTables, selectedModelName, systemPromptEnabled, templateType])
  const flowLogicText = useMemo(() => [
    `开始`,
    ` -> 读取当前配置（工具=${flowConfigSummary.tools}；知识库=${flowConfigSummary.kb}；数据库=${flowConfigSummary.db}；模型=${flowConfigSummary.model}；提示词=${flowConfigSummary.prompt}）`,
    ` -> 需求解析（关键词、意图、约束）`,
    ` -> 自动编排（仅执行已启用分支）`,
    ` -> 数据库检索（${activeFlowBranches.db ? `启用，${flowConfigSummary.db}` : '跳过'}）`,
    ` -> 知识库检索（${activeFlowBranches.kb ? `启用，${flowConfigSummary.kb}` : '跳过'}）`,
    ` -> 互联网检索（${activeFlowBranches.web ? '启用' : '跳过'}）`,
    ` -> 证据融合（去重、相关性排序、风险归纳）`,
    ` -> 大模型总结（候选、风险、下一步、查询语句）`,
    ` -> 产出工具（图表=${activeFlowBranches.chart ? '启用' : '跳过'}；文件导出=${activeFlowBranches.export ? '启用' : '跳过'}）`,
    ` -> 返回前端（答案 + 结构化结果 + artifacts）`,
  ].join('\n'), [flowConfigSummary, activeFlowBranches])
  const flowSequenceText = useMemo(() => [
    `用户 -> 前端：输入问题 + 当前配置`,
    `前端 -> 后端：/api/agents/precise-sourcing/chat（携带工具、知识库、数据库、模型、提示词）`,
    `后端 -> LangGraph：plan`,
    `LangGraph -> 工具层：按配置执行（DB=${activeFlowBranches.db ? '是' : '否'}，KB=${activeFlowBranches.kb ? '是' : '否'}，WEB=${activeFlowBranches.web ? '是' : '否'}）`,
    `LangGraph -> LLM：使用模型 ${flowConfigSummary.model}`,
    `LangGraph -> 产出工具：图表=${activeFlowBranches.chart ? '是' : '否'}，导出=${activeFlowBranches.export ? '是' : '否'}`,
    `LangGraph -> 后端：answer + structured + artifacts + queryStatements`,
    `后端 -> 前端：渲染结果`,
  ].join('\n'), [activeFlowBranches, flowConfigSummary.model])
  const sequenceDiagramEngine = useMemo(() => {
    const engine = new DiagramEngine()
    engine.getLayerFactories().registerFactory(new NodeLayerFactory())
    engine.getLayerFactories().registerFactory(new LinkLayerFactory())
    engine.getLayerFactories().registerFactory(new SelectionBoxLayerFactory())
    engine.getNodeFactories().registerFactory(new DefaultNodeFactory())
    engine.getLinkFactories().registerFactory(new DefaultLinkFactory())
    engine.getPortFactories().registerFactory(new DefaultPortFactory())
    engine.getStateMachine().pushState(new DefaultDiagramState())
    const model = new DiagramModel()
    const mkNode = (name, color, x, y) => {
      const node = new DefaultNodeModel({ name, color })
      node.setPosition(x, y)
      return node
    }
    const mkLink = (source, target, color = '#111827') => {
      const link = new DefaultLinkModel({ color, width: 2 })
      link.setSourcePort(source)
      link.setTargetPort(target)
      return link
    }

    const readConfigNode = mkNode('读取用户配置', 'rgb(14, 165, 233)', 20, 150)
    const parseNode = mkNode('需求解析', 'rgb(59, 130, 246)', 180, 150)
    const orchestrateNode = mkNode('自动编排', 'rgb(37, 99, 235)', 340, 150)
    const fusionNode = mkNode('证据融合与排序', 'rgb(126, 34, 206)', 540, 150)
    const llmNode = mkNode(`模型输出 (${flowConfigSummary.model})`, 'rgb(101, 163, 13)', 730, 150)
    const returnNode = mkNode('返回前端结果', 'rgb(2, 132, 199)', 1080, 150)

    const readOut = readConfigNode.addOutPort('输出')
    const parseIn = parseNode.addInPort('输入')
    const parseOut = parseNode.addOutPort('输出')
    const orchIn = orchestrateNode.addInPort('输入')
    const orchOut = orchestrateNode.addOutPort('输出')
    const fusionIn = fusionNode.addInPort('输入')
    const fusionOut = fusionNode.addOutPort('输出')
    const llmIn = llmNode.addInPort('输入')
    const llmOut = llmNode.addOutPort('输出')
    const retIn = returnNode.addInPort('输入')

    const graphNodes = [readConfigNode, parseNode, orchestrateNode, fusionNode, llmNode, returnNode]
    const graphLinks = [
      mkLink(readOut, parseIn),
      mkLink(parseOut, orchIn),
      mkLink(orchOut, fusionIn),
      mkLink(fusionOut, llmIn),
    ]

    const retrievalDefs = [
      { enabled: activeFlowBranches.db, name: '数据库检索', color: 'rgb(180, 83, 9)' },
      { enabled: activeFlowBranches.kb, name: '知识库检索', color: 'rgb(15, 118, 110)' },
      { enabled: activeFlowBranches.web, name: '互联网搜索', color: 'rgb(14, 165, 164)' },
    ].filter((item) => item.enabled)
    const retrievalStartY = 20
    retrievalDefs.forEach((item, idx) => {
      const node = mkNode(item.name, item.color, 360, retrievalStartY + idx * 80)
      const inPort = node.addInPort('输入')
      const outPort = node.addOutPort('输出')
      graphNodes.push(node)
      graphLinks.push(mkLink(orchOut, inPort))
      graphLinks.push(mkLink(outPort, fusionIn))
    })

    const outputDefs = [
      { enabled: activeFlowBranches.image, name: '图片生成', color: 'rgb(217, 70, 239)' },
      { enabled: activeFlowBranches.chart, name: '图表生成', color: 'rgb(245, 158, 11)' },
      { enabled: activeFlowBranches.export, name: '文件导出', color: 'rgb(8, 145, 178)' },
    ].filter((item) => item.enabled)
    const outputStartY = 40
    if (outputDefs.length === 0) {
      graphLinks.push(mkLink(llmOut, retIn))
    } else {
      outputDefs.forEach((item, idx) => {
        const node = mkNode(item.name, item.color, 900, outputStartY + idx * 80)
        const inPort = node.addInPort('输入')
        const outPort = node.addOutPort('输出')
        graphNodes.push(node)
        graphLinks.push(mkLink(llmOut, inPort))
        graphLinks.push(mkLink(outPort, retIn))
      })
    }

    model.addAll(...graphNodes, ...graphLinks)

    engine.setModel(model)
    return engine
  }, [activeFlowBranches, flowConfigSummary.model])
  useEffect(() => {
    if (!flowDialogOpen || flowTabKey !== 'sequence') return
    const timer = window.setTimeout(() => {
      try {
        sequenceDiagramEngine.repaintCanvas()
        sequenceDiagramEngine.zoomToFit({ margin: 40, maxZoom: 1 })
      } catch (error) {
        void error
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [flowDialogOpen, flowTabKey, sequenceDiagramEngine])

  useEffect(() => {
    if (!Array.isArray(modelProviders) || modelProviders.length === 0) return
    if (modelProviderDraft) return
    const firstProvider = modelProviders[0]
    const rows = Array.isArray(firstProvider?.fetchedModels) && firstProvider.fetchedModels.length > 0
      ? firstProvider.fetchedModels
      : (Array.isArray(firstProvider?.models) ? firstProvider.models : [])
    const firstModel = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)[0] || selectedModelName
    setModelProviderDraft(firstProvider.providerName || '')
    if (!selectedModelName && firstModel) setSelectedModelName(firstModel)
    if (!modelDraft && firstModel) setModelDraft(firstModel)
  }, [modelProviders, modelProviderDraft, selectedModelName, modelDraft])

  useEffect(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [activeMessages])
  useEffect(() => {
    const validValues = new Set(toolOptions.map((item) => String(item.value)))
    setSelectedTools((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((item) => validValues.has(String(item)))
      return next.length === prev.length ? prev : next
    })
  }, [toolOptions])

  function patchActiveMessages(nextMessages) {
    setSessions((current) => current.map((item) => (item.name === currentSession ? { ...item, messages: nextMessages } : item)))
  }

  function patchLastAssistantMessage(mutator) {
    setSessions((current) => current.map((item) => {
      if (item.name !== currentSession) return item
      const messages = Array.isArray(item.messages) ? [...item.messages] : []
      const idx = messages.length - 1
      if (idx < 0 || messages[idx]?.role !== 'assistant') return item
      messages[idx] = mutator(messages[idx]) || messages[idx]
      return { ...item, messages }
    }))
  }

  function onCreateSession() {
    const base = '会话'
    let idx = sessions.length + 1
    let nextName = `${base}${idx}`
    while (sessions.some((s) => s.name === nextName)) {
      idx += 1
      nextName = `${base}${idx}`
    }
    setSessions((current) => [...current, { name: nextName, messages: [] }])
    setCurrentSession(nextName)
  }

  function onRenameSession() {
    Modal.confirm({
      title: '重命名会话',
      content: (
        <Input
          defaultValue={currentSession}
          id="rename-precise-session-input"
          onPressEnter={() => {
            const inputEl = document.getElementById('rename-precise-session-input')
            if (inputEl) inputEl.blur()
          }}
        />
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-precise-session-input')
        const nextName = String(inputEl?.value || '').trim()
        if (!nextName) return
        if (sessions.some((s) => s.name === nextName && s.name !== currentSession)) {
          message.error('会话名称已存在')
          return
        }
        setSessions((current) => current.map((s) => (s.name === currentSession ? { ...s, name: nextName } : s)))
        setCurrentSession(nextName)
      },
    })
  }

  function onDeleteSession() {
    if (sessions.length <= 1) {
      message.warning('这是最后一个会话，无法删除')
      return
    }
    const next = sessions.filter((s) => s.name !== currentSession)
    setSessions(next)
    setCurrentSession(next[0].name)
  }

  function onExportSession() {
    const payload = {
      session: currentSession,
      exportedAt: new Date().toISOString(),
      messages: activeMessages,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentSession}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function stepNumber(current, delta, min, max, setter) {
    const next = Math.min(max, Math.max(min, Number(current || 0) + delta))
    setter(next)
  }

  function onSelectAllDbTables() {
    setSelectedDbTables(DB_OPTIONS.map((item) => item.value))
  }

  function onClearDbTables() {
    setSelectedDbTables([])
  }

  function onTemplateUpload(info) {
    const rawFile = info?.file?.originFileObj || info?.file
    if (!rawFile) return
    setTemplateFile(rawFile)
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('模板读取失败'))
      reader.readAsDataURL(file)
    })
  }

  function renderMessageContent(text = '') {
    const pretty = String(text || '')
      .replace(/(【[^】]+】)/g, '\n$1')
      .replace(/\s*-\s*/g, '\n- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, maxWidth: '100%' }}>{pretty}</div>
  }

  function parseAnswerSections(text = '') {
    const raw = String(text || '')
    const normalized = raw.replace(/【候选供应商Top\d+】/g, '【候选供应商TopN】')
    const keys = ['【直接回答】', '【结论】', '【意图】', '【命中统计】', '【候选供应商TopN】']
    const result = {}
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      const start = normalized.indexOf(key)
      if (start < 0) continue
      const nextStarts = keys
        .filter((k) => k !== key)
        .map((k) => normalized.indexOf(k, start + key.length))
        .filter((idx) => idx > start)
      const end = nextStarts.length > 0 ? Math.min(...nextStarts) : normalized.length
      result[key] = normalized.slice(start + key.length, end).trim()
    }
    return result
  }

  function extractArtifactEntries(item) {
    const selected = Array.isArray(item?.selectedTools) ? item.selectedTools.map((x) => String(x || '')) : []
    const allowArtifactFallback = selected.includes('python_chart_generator') || selected.includes('file_exporter')
    const fromArtifacts = Array.isArray(item?.artifacts)
      ? item.artifacts
        .map((artifact, idx) => ({
          title: String(artifact?.title || artifact?.fileName || `文件${idx + 1}`),
          url: String(artifact?.downloadUrl || ''),
        }))
        .filter((row) => row.url)
      : []
    if (fromArtifacts.length > 0) return fromArtifacts
    if (!allowArtifactFallback) return []

    const raw = String(item?.rawAnswer || item?.content || '')
    const lines = raw.split(/\r?\n/)
    const rows = []
    let inBlock = false
    for (const line of lines) {
      const txt = String(line || '').trim()
      if (!txt) continue
      if (txt.includes('【产出文件】')) {
        inBlock = true
        continue
      }
      if (!inBlock) continue
      if (/^【.+】/.test(txt)) break
      const match = txt.match(/^\d+\.\s*(.+?)[:：]\s*(\/api\/\S+)$/)
      if (match) rows.push({ title: match[1].trim(), url: match[2].trim() })
    }
    return rows
  }

  function renderAssistantExtraText(item) {
    return null
  }

  function openArtifactPreview(title, url) {
    setArtifactPreviewTitle(String(title || '产出文件'))
    setArtifactPreviewUrl(String(url || ''))
    setArtifactPreviewOpen(true)
  }

  function renderAssistantResultCard(item) {
    return null
  }

  function renderArtifactCard(item) {
    const artifacts = extractArtifactEntries(item)
    if (artifacts.length === 0) return null
    return (
      <div style={{ marginTop: 10, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 10 }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>产出文件</div>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {artifacts.map((artifact, idx) => {
            const title = String(artifact?.title || `文件${idx + 1}`)
            const url = String(artifact?.url || '')
            return (
              <div key={`artifact-${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', border: '1px solid #f1f5f9', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{idx + 1}. {title}</div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#2563eb', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    title={url}
                  >
                    {url}
                  </a>
                </div>
                <Space size={6}>
                  <Button size="small" onClick={() => openArtifactPreview(title, url)}>预览</Button>
                  <a href={url} target="_blank" rel="noreferrer">下载/打开</a>
                </Space>
              </div>
            )
          })}
        </Space>
      </div>
    )
  }

  function formatTime(value) {
    const ts = Number(value || 0)
    if (!ts) return ''
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  function renderExecutionProcess(item) {
    const hasFinalPayload = !!String(item?.rawAnswer || '').trim()
      || !!(item?.intentDecision && typeof item.intentDecision === 'object')
      || (Array.isArray(item?.planSteps) && item.planSteps.length > 0)
      || (Array.isArray(item?.traces) && item.traces.length > 0)
    if (!hasFinalPayload) return null
    const isDirectAnswer = String(item?.intent || '') === 'direct_answer'
      || item?.queryStatements?.route?.mode === 'direct_answer'
    if (isDirectAnswer) return null

    const traces = Array.isArray(item?.traces) ? item.traces : []
    const intentDecision = item?.intentDecision && typeof item.intentDecision === 'object' ? item.intentDecision : null
    const planStepsRaw = Array.isArray(item?.planSteps) ? item.planSteps : []
    const planTrace = traces.find((t) => String(t?.step || '').toLowerCase() === 'plan')
    const actPlanTrace = traces.find((t) => String(t?.step || '').toLowerCase() === 'act_plan')
    const planDetailText = String(planTrace?.detail || '')
    const intentFromTrace = (() => {
      const m = planDetailText.match(/意图[=：]([a-z_]+)/i)
      return m?.[1] ? String(m[1]).trim() : ''
    })()
    const planStepsFromTrace = (() => {
      const m = planDetailText.match(/计划分解=([^\n\r]+)/)
      if (!m?.[1]) return []
      return String(m[1])
        .split(/[；/]/)
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((x, idx) => ({ id: `trace-plan-${idx + 1}`, title: x }))
    })()
    const planSteps = planStepsRaw.length > 0 ? planStepsRaw : planStepsFromTrace
    const executionStages = Array.isArray(item?.executionProtocol?.stages) ? item.executionProtocol.stages : []
    const executionPlanFromTrace = actPlanTrace?.input?.executionPlan && typeof actPlanTrace.input.executionPlan === 'object'
      ? actPlanTrace.input.executionPlan
      : null
    const selectedToolSet = new Set(Array.isArray(item?.selectedTools) ? item.selectedTools.map((x) => String(x || '')) : [])

    const hasTraceStep = (prefix) => traces.some((t) => String(t?.step || '').toLowerCase().startsWith(String(prefix || '').toLowerCase()))
    const doneOrSkipped = (done, skipped = false) => (done ? 'done' : (skipped ? 'skipped' : 'pending'))

    const activeToolTasks = [
      { key: 'db_chat', label: 'DB任务', enabled: selectedToolSet.has('db_chat') || intentDecision?.needDb === true, done: hasTraceStep('observe_db') },
      { key: 'local_kb', label: 'RAG任务', enabled: selectedToolSet.has('local_kb') || intentDecision?.needRag === true, done: hasTraceStep('observe_rag') },
      { key: 'web_search', label: 'WEB任务', enabled: selectedToolSet.has('web_search') || intentDecision?.needWeb === true, done: hasTraceStep('observe_web') },
      { key: 'python_chart_generator', label: '图表任务', enabled: selectedToolSet.has('python_chart_generator'), done: hasTraceStep('observe_tools') },
      { key: 'file_exporter', label: '导出任务', enabled: selectedToolSet.has('file_exporter'), done: hasTraceStep('observe_tools') },
      { key: 'image_gen', label: '图片任务', enabled: selectedToolSet.has('image_gen'), done: hasTraceStep('observe_tools') },
    ].filter((x) => x.enabled)

    const metricDbHits = Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers.length : 0
    const metricRagHits = Array.isArray(item?.evidence?.kbHits) ? item.evidence.kbHits.length : 0
    const metricWebHits = Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits.length : 0
    const dbCompanies = (Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers : [])
      .map((x) => String(x?.companyName || x?.company_name || x?.name || '').trim())
      .filter(Boolean)
    const kbCompanies = Array.from(new Set((Array.isArray(item?.evidence?.kbHits) ? item.evidence.kbHits : [])
      .flatMap((x) => (Array.isArray(x?.supplierCandidates) ? x.supplierCandidates : []))
      .map((x) => String(x || '').trim())
      .filter(Boolean)))
    const webCompanies = Array.from(new Set((Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits : [])
      .flatMap((x) => (Array.isArray(x?.supplierCandidates) ? x.supplierCandidates : []))
      .map((x) => String(x || '').trim())
      .filter(Boolean)))
    const webEnrichNote = String(item?.evidence?.webEnrichNote || '').trim()
    const fusedSuppliers = (Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers : [])
      .map((row) => ({
        name: String(row?.companyName || row?.company_name || row?.name || '').trim(),
        dbScore: Number(row?._matchScore || 0),
        fusedScore: Number(row?._fusedScore || row?._matchScore || 0),
        kbSupport: Number(row?._kbSupportCount || 0),
        webSupport: Number(row?._webSupportCount || 0),
      }))
      .filter((x) => x.name)
      .sort((a, b) => b.fusedScore - a.fusedScore)
    const answerSections = parseAnswerSections(item?.rawAnswer || item?.content || '')
    const promptText = String(item?.systemPrompt || item?.queryStatements?.prompt || '').trim()
    const retrievalSummary = [
      `DB命中供应商: ${dbCompanies.length}`,
      `RAG命中供应商: ${kbCompanies.length}`,
      `WEB命中供应商: ${webCompanies.length}`,
      `融合去重后: ${fusedSuppliers.length}`,
    ].join('\n')
    const stageResult = (stepNo) => executionStages.find((x) => Number(x?.step) === Number(stepNo)) || null

    const dbRequestText = String(item?.queryStatements?.db?.template || executionPlanFromTrace?.dbQuery || '').trim()
    const ragRequestText = String(item?.queryStatements?.rag?.endpoint || executionPlanFromTrace?.ragQuery || '').trim()
    const webProviderText = String(item?.queryStatements?.web?.provider || '').trim()
    const webQueryText = String(item?.queryStatements?.web?.keyword || executionPlanFromTrace?.webQuery || '').trim()
    const needDbTask = selectedToolSet.has('db_chat') || intentDecision?.needDb === true
    const needRagTask = selectedToolSet.has('local_kb') || intentDecision?.needRag === true
    const needWebTask = selectedToolSet.has('web_search') || intentDecision?.needWeb === true
    const requestReady = activeToolTasks.length > 0 && (
      (needDbTask && dbRequestText)
      || (needRagTask && ragRequestText)
      || (needWebTask && webQueryText)
      || hasTraceStep('act_plan')
    )

    const rawDone = {
      s1: true,
      s2: hasTraceStep('plan') || Boolean(intentDecision),
      s3: planSteps.length > 0,
      s4: Boolean(requestReady),
      s5: hasTraceStep('observe_db') || hasTraceStep('observe_rag') || hasTraceStep('observe_web') || hasTraceStep('observe_tools'),
      s6: hasTraceStep('observe_db') || hasTraceStep('observe_rag') || hasTraceStep('observe_web'),
      s7: hasTraceStep('observe_fuse') || hasTraceStep('act_fuse'),
      s8: hasTraceStep('act_llm') || hasTraceStep('observe_llm') || Boolean(stageResult(8)),
      s9: item?.streamDone === true,
    }
    const keysOrdered = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']
    const gatedDone = {}
    for (let i = 0; i < keysOrdered.length; i += 1) {
      const k = keysOrdered[i]
      if (i === 0) gatedDone[k] = rawDone[k]
      else gatedDone[k] = Boolean(rawDone[k] && gatedDone[keysOrdered[i - 1]])
    }
    const firstPendingIdx = keysOrdered.findIndex((k) => !gatedDone[k])
    const stepStatus = {}
    for (let i = 0; i < keysOrdered.length; i += 1) {
      const k = keysOrdered[i]
      if (gatedDone[k]) stepStatus[k] = 'done'
      else if (firstPendingIdx >= 0 && i === firstPendingIdx) stepStatus[k] = 'pending'
      else stepStatus[k] = 'pending'
    }

    const processSteps = [
      { key: 's1', stepNo: 1, title: '用户输入', detail: String(item?.userInput || item?.queryStatements?.db?.keyword || '-').slice(0, 240), status: stepStatus.s1 },
      {
        key: 's2',
        stepNo: 2,
        title: 'LLM语义理解与任务规划',
        detail: '语义解析: 意图=' + String(intentDecision?.intent || item?.intent || intentFromTrace || '-') + '\n任务规划: ' + String(intentDecision?.routeReason || planDetailText || '-'),
        status: stepStatus.s2,
      },
      { key: 's3', stepNo: 3, title: '检索子任务分解', detail: planSteps.length > 0 ? planSteps.map((x, idx) => String(idx + 1) + '. ' + String(x?.title || x?.id || '-')).join('\n') : '', status: stepStatus.s3 },
      {
        key: 's4',
        stepNo: 4,
        title: '发起标准化工具请求',
        detail: [
          activeToolTasks.length > 0 ? ('任务: ' + activeToolTasks.map((x) => x.label).join('、')) : '任务: 无',
          'DB请求: ' + (dbRequestText || '-'),
          'RAG请求: ' + (ragRequestText || '-'),
          'WEB请求: ' + (webProviderText || 'web.searchSupplierSignals') + ' | query=' + (webQueryText || '-'),
        ].join('\n'),
        status: stepStatus.s4,
      },
      { key: 's5', stepNo: 5, title: '工具执行(DB/RAG/WEB)', detail: '', status: stepStatus.s5 },
      { key: 's6', stepNo: 6, title: '返回标准化结果（含 dbHits/ragHits/webHits）', detail: 'dbHits=' + metricDbHits + ' | ragHits=' + metricRagHits + ' | webHits=' + metricWebHits, status: stepStatus.s6 },
      { key: 's7', stepNo: 7, title: '证据整合与去重', detail: '融合候选=' + metricDbHits, status: stepStatus.s7 },
      { key: 's8', stepNo: 8, title: '系统提示词 + 召回上下文交给LLM生成（含 model）', detail: 'model=' + String(item?.model || stageResult(8)?.meta?.model || '-'), status: stepStatus.s8 },
      { key: 's9', stepNo: 9, title: '返回最终结果', detail: '已返回最终答复', status: stepStatus.s9 },
    ]
    const visibleProcessSteps = processSteps.filter((step) => {
      if (step.key === 's3') return Boolean(String(step.detail || '').trim())
      return true
    })

    return (
      <div style={{ marginTop: 10 }}>
        <Collapse
          size="small"
          defaultActiveKey={['s1']}
          items={visibleProcessSteps.map((step, idx) => ({
            key: step.key,
            label: (
              <Space size={8}>
                <Tag color={step.status === 'done' ? 'green' : step.status === 'skipped' ? 'default' : 'blue'}>{step.status}</Tag>
                <span>{idx + 1}. {step.title}</span>
              </Space>
            ),
            children: (
              <div>
                {step.key === 's4' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#0f172a' }}>
                        任务: {activeToolTasks.length > 0 ? activeToolTasks.map((x) => x.label).join('、') : '无'}
                      </div>
                    </div>
                    {(selectedToolSet.has('db_chat') || intentDecision?.needDb === true) ? (
                      <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={dbRequestText ? 'green' : 'blue'}>{dbRequestText ? 'ready' : 'pending'}</Tag>
                          DB请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          template: {dbRequestText || '-'}
                        </div>
                      </div>
                    ) : null}
                    {(selectedToolSet.has('local_kb') || intentDecision?.needRag === true) ? (
                      <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={ragRequestText ? 'green' : 'blue'}>{ragRequestText ? 'ready' : 'pending'}</Tag>
                          RAG请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          query: {ragRequestText || '-'}
                        </div>
                      </div>
                    ) : null}
                    {(selectedToolSet.has('web_search') || intentDecision?.needWeb === true) ? (
                      <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={webQueryText ? 'green' : 'blue'}>{webQueryText ? 'ready' : 'pending'}</Tag>
                          WEB请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          provider: {webProviderText || 'web.searchSupplierSignals'}{'\n'}
                          query: {webQueryText || '-'}
                        </div>
                      </div>
                    ) : null}
                  </Space>
                ) : step.key === 's5' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {activeToolTasks.length > 0 ? activeToolTasks.map((task, tIdx) => {
                      const taskStatus = doneOrSkipped(task.done, false)
                      return (
                        <div key={'tool-task-' + task.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                          <div style={{ fontSize: 12, color: '#0f172a' }}>
                            <Tag color={taskStatus === 'done' ? 'green' : taskStatus === 'skipped' ? 'default' : 'blue'}>{taskStatus}</Tag>
                            {tIdx + 1}. {task.label}
                          </div>
                        </div>
                      )
                    }) : <div style={{ fontSize: 12, color: '#64748b' }}>未选择工具任务</div>}
                    {selectedToolSet.has('db_chat') || intentDecision?.needDb === true ? (
                      <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>DB命中企业（{dbCompanies.length}）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {dbCompanies.length > 0 ? dbCompanies.map((name, i) => <Tag key={`db-company-${i}`} color="blue">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                      </div>
                    ) : null}
                    {selectedToolSet.has('local_kb') || intentDecision?.needRag === true ? (
                      <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>RAG命中企业（{kbCompanies.length}）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {kbCompanies.length > 0 ? kbCompanies.map((name, i) => <Tag key={`kb-company-${i}`} color="purple">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                      </div>
                    ) : null}
                    {selectedToolSet.has('web_search') || intentDecision?.needWeb === true ? (
                      <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>WEB命中企业（{webCompanies.length}）</div>
                        {webEnrichNote ? (
                          <div style={{ fontSize: 12, color: '#166534', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                            {webEnrichNote}
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {webCompanies.length > 0 ? webCompanies.map((name, i) => <Tag key={`web-company-${i}`} color="green">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                      </div>
                    ) : null}
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>调用顺序与结果</div>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {traces
                          .filter((t) => /^(act_|observe_)/i.test(String(t?.step || '')))
                          .map((t, i) => (
                            <div key={`trace-exec-${i}`} style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {i + 1}. {String(t?.step || '-')} | tool={String(t?.tool || '-')}
                              {t?.input ? `\ninput=${JSON.stringify(t.input)}` : ''}
                              {t?.detail ? `\nresult=${String(t.detail)}` : ''}
                            </div>
                          ))}
                      </Space>
                    </div>
                  </Space>
                ) : step.key === 's6' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>DB供应商（{dbCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {fusedSuppliers.filter((x) => x.dbScore > 0).map((x, i) => <Tag key={`s6-db-${i}`} color="blue">{x.name} ({x.dbScore.toFixed(2)})</Tag>)}
                      </div>
                    </div>
                    <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>RAG供应商（{kbCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {kbCompanies.map((name, i) => <Tag key={`s6-kb-${i}`} color="purple">{name}</Tag>)}
                      </div>
                    </div>
                    <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>WEB供应商（{webCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {webCompanies.map((name, i) => <Tag key={`s6-web-${i}`} color="green">{name}</Tag>)}
                      </div>
                    </div>
                  </Space>
                ) : step.key === 's7' ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {fusedSuppliers.map((x, i) => (
                      <div key={`s7-fused-${i}`} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#0f172a' }}>{i + 1}. {x.name}</div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Tag color="green">融合分 {x.fusedScore.toFixed(2)}</Tag>
                          <Tag color="blue">DB {x.dbScore.toFixed(2)}</Tag>
                          <Tag color="purple">KB {x.kbSupport}</Tag>
                          <Tag color="cyan">WEB {x.webSupport}</Tag>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : step.key === 's8' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>提示词</div>
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{promptText || '未显式传入（使用后端默认提示词）'}</div>
                    </div>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>召回上下文摘要</div>
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{retrievalSummary}</div>
                    </div>
                  </Space>
                ) : step.key === 's9' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {answerSections['【结论】'] ? (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>结论</div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{answerSections['【结论】']}</div>
                      </div>
                    ) : null}
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>供应商列表</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {fusedSuppliers.map((x, i) => (
                          <div key={`s9-s-${i}`} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: 6 }}>
                            <div style={{ fontSize: 12 }}>{i + 1}. {x.name}</div>
                            <div style={{ marginTop: 4 }}><Tag color="green">融合分 {x.fusedScore.toFixed(2)}</Tag></div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {answerSections['【候选供应商TopN】'] ? (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>建议</div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{answerSections['【候选供应商TopN】']}</div>
                      </div>
                    ) : null}
                  </Space>
                ) : (
                  <div>
                    {step.detail ? (
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.detail}</div>
                    ) : null}
                    {stageResult(step.stepNo)?.meta && typeof stageResult(step.stepNo).meta === 'object' ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', whiteSpace: 'pre-wrap' }}>
                        {Object.entries(stageResult(step.stepNo).meta).map(([k, v]) => String(k) + ': ' + String(v)).join(' | ')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ),
          }))}
        />

        <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 10 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>最终返回结果</div>
          <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {String(item?.rawAnswer || (item?.streamDone ? item?.content : '') || '暂无结果')}
          </div>
        </div>
      </div>
    )
  }

  async function onSend() {
    const question = String(input || '').trim()
    if (!question || loading) return

    const nextHistory = [...activeMessages, { role: 'user', content: question, ts: Date.now() }]
    patchActiveMessages(nextHistory)
    setInput('')
    setLoading(true)

    try {
      const reportTemplate = templateType !== 'none' && templateFile
        ? {
          type: templateType,
          fileName: String(templateFile.name || ''),
          dataUrl: await fileToDataUrl(templateFile),
        }
        : null

      const pendingAssistant = {
        role: 'assistant',
        content: '执行中，请稍候...',
        rawAnswer: '',
        userInput: question,
        streamDone: false,
        evidence: { suppliers: [], kbHits: [], webHits: [] },
        artifacts: [],
        queryStatements: {},
        traces: [],
        react: { rounds: [] },
        intentDecision: null,
        planSteps: [],
        intent: '',
        traceVersion: '',
        selectedTools: Array.isArray(selectedTools) ? [...selectedTools] : [],
        ts: Date.now(),
      }
      patchActiveMessages([...nextHistory, pendingAssistant])

      await chatPreciseSourcingAgentStream({
        message: question,
        model: selectedModelName,
        systemPrompt: systemPromptEnabled ? systemPrompt : '',
        systemPromptPresetKey: systemPromptEnabled ? systemPromptPresetKey : '',
        kbId: selectedKbIds[0] || '',
        kbIds: selectedKbIds,
        topK: kbTopK,
        dbTopK,
        selectedTools,
        selectedSkills: selectedTools,
        selectedDbTables,
        strictMode,
        temperature,
        fusionWeights: effectiveFusionWeights,
        reportTemplate,
        history: nextHistory.slice(-12),
      }, {
        onTrace: (evt) => {
          const trace = evt?.trace
          if (!trace) return
          patchLastAssistantMessage((last) => {
            const traces = [...(Array.isArray(last?.traces) ? last.traces : []), trace]
            const detail = String(trace?.detail || '')
            let nextIntent = last?.intentDecision && typeof last.intentDecision === 'object' ? { ...last.intentDecision } : null
            let nextPlanSteps = Array.isArray(last?.planSteps) ? [...last.planSteps] : []
            if (String(trace?.step || '').toLowerCase().startsWith('plan')) {
              const intentMatch = detail.match(/意图[=：]([a-z_]+)/i)
              const dbMatch = detail.match(/DB[=：](是|否)/)
              const ragMatch = detail.match(/RAG[=：](是|否)/)
              const webMatch = detail.match(/WEB[=：](是|否)/)
              const planMatch = detail.match(/计划分解=([^\n\r]+)/)
              if (!nextIntent) nextIntent = {}
              if (intentMatch) nextIntent.intent = String(intentMatch[1] || '').trim()
              if (dbMatch) nextIntent.needDb = dbMatch[1] === '是'
              if (ragMatch) nextIntent.needRag = ragMatch[1] === '是'
              if (webMatch) nextIntent.needWeb = webMatch[1] === '是'
              nextIntent.routeReason = detail || nextIntent.routeReason || ''
              if (planMatch?.[1]) {
                const parts = String(planMatch[1])
                  .split(/[；/]/)
                  .map((x) => String(x || '').trim())
                  .filter(Boolean)
                if (parts.length > 0) nextPlanSteps = parts.map((p, idx) => ({ id: `trace-plan-${idx + 1}`, title: p }))
              }
            }
            return {
              ...last,
              traces,
              react: { rounds: [] },
              intentDecision: nextIntent,
              planSteps: nextPlanSteps,
            }
          })
        },
        onHeartbeat: (evt) => {
          patchLastAssistantMessage((last) => ({
            ...last,
            lastHeartbeat: String(evt?.message || '正在执行中，请稍候...'),
          }))
        },
        onDelta: (evt) => {
          const delta = String(evt?.text || '')
          if (!delta) return
          patchLastAssistantMessage((last) => {
            const prev = String(last?.rawAnswer || '')
            const next = `${prev}${delta}`
            return {
              ...last,
              rawAnswer: next,
              content: next,
            }
          })
        },
        onFinal: (data) => {
          const evidence = data?.evidence || {}
          const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : []
          const qs = data?.queryStatements && typeof data.queryStatements === 'object' ? data.queryStatements : {}
          patchLastAssistantMessage((last) => ({
            ...last,
            userInput: question,
            streamDone: true,
            content: String(data?.answer || '未返回内容'),
            rawAnswer: String(data?.answer || ''),
            evidence,
            artifacts,
            queryStatements: qs,
            traces: Array.isArray(data?.traces) ? data.traces : (Array.isArray(last?.traces) ? last.traces : []),
            react: data?.react || { rounds: [] },
            intentDecision: data?.intentDecision && typeof data.intentDecision === 'object' ? data.intentDecision : null,
            planSteps: Array.isArray(data?.planSteps) ? data.planSteps : [],
            intent: String(data?.intent || ''),
            traceVersion: String(data?.traceVersion || ''),
            ts: Date.now(),
          }))
        },
        onEnrich: (data) => {
          const extraWebHits = Array.isArray(data?.webHits) ? data.webHits : []
          const extraSuppliers = Array.isArray(data?.webDerivedSuppliers) ? data.webDerivedSuppliers : []
          const enrichNote = String(data?.note || '').trim()
          patchLastAssistantMessage((last) => {
            const prevEvidence = last?.evidence && typeof last.evidence === 'object' ? last.evidence : { suppliers: [], kbHits: [], webHits: [] }
            const mergedWebHits = [...(Array.isArray(prevEvidence.webHits) ? prevEvidence.webHits : []), ...extraWebHits]
            const dedupWebHits = Array.from(new Map(mergedWebHits.map((x, i) => [String(x?.url || x?.link || x?.title || `row-${i}`), x])).values())
            const mergedDerived = [...(Array.isArray(prevEvidence.webDerivedSuppliers) ? prevEvidence.webDerivedSuppliers : []), ...extraSuppliers]
            const dedupDerived = Array.from(new Set(mergedDerived.map((x) => String(x || '').trim()).filter(Boolean)))
            return {
              ...last,
              content: String(last?.content || ''),
              rawAnswer: String(last?.rawAnswer || ''),
              evidence: {
                ...prevEvidence,
                webHits: dedupWebHits,
                webDerivedSuppliers: dedupDerived,
                webEnrichNote: enrichNote || String(prevEvidence?.webEnrichNote || ''),
              },
              ts: Date.now(),
            }
          })
        },
        onDone: () => {
          patchLastAssistantMessage((last) => ({ ...last, streamDone: true }))
        },
      })
    } catch (error) {
      patchActiveMessages(activeMessages)
      message.error(error.message || '执行失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: showSidebar ? '320px 1fr' : '44px 1fr', gap: 12, height: 'calc(100vh - 130px)', minHeight: 0, overflow: 'hidden' }}>
      {showSidebar ? (
        <Card className="app-elevated-card" style={{ height: '100%', minHeight: 0 }} bodyStyle={{ padding: 12, height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setShowSidebar(false)} />
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space align="center" size={8}>
                  <MessageOutlined style={{ color: '#2563eb' }} />
                  <Text strong style={{ color: '#1d4ed8' }}>精准寻源智能体</Text>
                </Space>
                <Button
                  type="text"
                  size="small"
                  icon={<DeploymentUnitOutlined />}
                  title="查看智能体流程图"
                  onClick={() => setFlowDialogOpen(true)}
                />
              </div>
              <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>当前会话：{currentSession}</div>
            </div>

            <Tabs
              size="small"
              items={[
                {
                  key: 'tool',
                  label: '工具设置',
                  children: (
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                      <div>
                        <Text>选择工具:</Text>
                        <Select
                          mode="multiple"
                          value={selectedTools}
                          onChange={setSelectedTools}
                          options={toolOptions}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="请选择工具"
                          allowClear
                          maxTagCount="responsive"
                        />
                      </div>
                      <div>
                        <Text>模型设置:</Text>
                        <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
                          <Tag color="blue">{selectedModelName || '未设置'}</Tag>
                          <Button
                            size="small"
                            onClick={() => {
                              const providerWithModel = modelProviders.find((p) => {
                                const rows = Array.isArray(p?.fetchedModels) && p.fetchedModels.length > 0 ? p.fetchedModels : (Array.isArray(p?.models) ? p.models : [])
                                return rows.some((m) => String(m?.id || '').trim() === String(selectedModelName || '').trim())
                              })
                              setModelProviderDraft(providerWithModel?.providerName || modelProviders[0]?.providerName || '')
                              setModelDraft(selectedModelName || '')
                              setModelDialogOpen(true)
                            }}
                          >
                            选择模型
                          </Button>
                        </Space>
                      </div>
                      <div>
                        <Text>提示词设置:</Text>
                        <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
                          <Text type="secondary" style={{ maxWidth: 180 }} ellipsis>
                            {promptPreviewText || '未设置'}
                          </Text>
                          <Button
                            size="small"
                            onClick={() => {
                              setPromptDraft(systemPrompt || '')
                              setPromptEnabledDraft(systemPromptEnabled)
                              setPromptPresetKeyDraft(systemPromptPresetKey || 'default')
                              setPromptDialogOpen(true)
                            }}
                          >
                            编辑提示词
                          </Button>
                        </Space>
                      </div>
                      <div>
                        <Text>请选择知识库:</Text>
                        <Select
                          mode="multiple"
                          value={selectedKbIds}
                          onChange={setSelectedKbIds}
                          options={kbOptions}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="请选择知识库"
                          allowClear
                          maxTagCount="responsive"
                        />
                      </div>
                      <div>
                        <Text>请选择数据库（实例与表）:</Text>
                        <div style={{ marginTop: 6, marginBottom: 6, color: '#64748b', fontSize: 12 }}>
                          当前实例：`PostgreSQL(main/public)`
                        </div>
                        <Select
                          mode="multiple"
                          value={selectedDbTables}
                          onChange={setSelectedDbTables}
                          options={DB_OPTIONS}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="可多选数据库表"
                          allowClear
                          maxTagCount="responsive"
                        />
                        <Space size={8} style={{ marginTop: 8 }}>
                          <Button size="small" onClick={onSelectAllDbTables}>全选</Button>
                          <Button size="small" onClick={onClearDbTables}>清空</Button>
                        </Space>
                      </div>
                      <Checkbox checked={strictMode} onChange={(e) => setStrictMode(e.target.checked)}>
                        严格模式（仅保留关键字段命中）
                      </Checkbox>
                      <div>
                        <Text>融合权重:</Text>
                        {activeFusionTools.length === 0 ? (
                          <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
                            请先勾选“数据库检索 / 知识库检索 / 互联网搜索”中的至少一项。
                          </div>
                        ) : activeFusionTools.length === 1 ? (
                          <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', color: '#334155', fontSize: 12 }}>
                            {activeFusionTools[0].label} 已自动设为 3.0（单来源）
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: activeFusionTools.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
                            {activeFusionTools.some((x) => x.key === 'db') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>DB {fusionWeightDb.toFixed(1)}</div>
                                <Slider min={0} max={3} step={0.1} value={fusionWeightDb} onChange={(v) => setFusionWeightDb(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                            {activeFusionTools.some((x) => x.key === 'kb') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>知识库 {fusionWeightKb.toFixed(1)}</div>
                                <Slider min={0} max={3} step={0.1} value={fusionWeightKb} onChange={(v) => setFusionWeightKb(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                            {activeFusionTools.some((x) => x.key === 'web') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>Web {fusionWeightWeb.toFixed(1)}</div>
                                <Slider min={0} max={3} step={0.1} value={fusionWeightWeb} onChange={(v) => setFusionWeightWeb(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 12 }}>
                        <Text>报告模板类型:</Text>
                        <Select value={templateType} onChange={setTemplateType} options={TEMPLATE_TYPE_OPTIONS} style={{ width: '100%', marginTop: 8 }} />
                        <Upload
                          style={{ marginTop: 8 }}
                          beforeUpload={() => false}
                          maxCount={1}
                          showUploadList
                          onChange={onTemplateUpload}
                          disabled={templateType === 'none'}
                          accept={templateType === 'ppt' ? '.ppt,.pptx' : templateType === 'word' ? '.doc,.docx' : '.xls,.xlsx,.csv'}
                        >
                          <Button style={{ marginTop: 8 }} disabled={templateType === 'none'}>
                            上传报告模板
                          </Button>
                        </Upload>
                      </div>
                      <div>
                        <Text>匹配知识条数:</Text>
                        <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                          <div style={{ paddingLeft: 12, fontSize: 15 }}>{kbTopK}</div>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(kbTopK, -1, 1, 20, setKbTopK)}>-</Button>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(kbTopK, 1, 1, 20, setKbTopK)}>+</Button>
                        </div>
                      </div>
                      <div>
                        <Text>匹配数据库条数:</Text>
                        <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                          <div style={{ paddingLeft: 12, fontSize: 15 }}>{dbTopK}</div>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(dbTopK, -1, 1, 50, setDbTopK)}>-</Button>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(dbTopK, 1, 1, 50, setDbTopK)}>+</Button>
                        </div>
                      </div>
                      <div>
                        <Text>Temperature:</Text>
                        <div style={{ marginTop: 4, textAlign: 'right', color: '#1d4ed8', fontSize: 16 }}>{Number(temperature).toFixed(2)}</div>
                        <Slider
                          min={0}
                          max={1}
                          step={0.01}
                          value={temperature}
                          onChange={(v) => setTemperature(Number(v || 0))}
                          tooltip={{ open: false }}
                          styles={{ track: { backgroundColor: '#1d4ed8' }, rail: { backgroundColor: '#bfdbfe' }, handle: { borderColor: '#2563eb' } }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span>0.00</span>
                          <span>1.00</span>
                        </div>
                        <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>
                          Temperature 越低越稳定一致，越高越发散有创意；报告场景建议 0.2~0.7。
                        </div>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'session',
                  label: '会话设置',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">历史会话</Text>
                        <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 6, background: '#fff' }}>
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            {sessions.map((s) => (
                              <Button key={s.name} type={s.name === currentSession ? 'primary' : 'default'} onClick={() => setCurrentSession(s.name)} style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}>
                                {s.name}
                              </Button>
                            ))}
                          </Space>
                        </div>
                      </div>
                      <Space>
                        <Button onClick={onCreateSession}>新建</Button>
                        <Button onClick={onRenameSession}>重命名</Button>
                        <Button onClick={onDeleteSession}>删除</Button>
                      </Space>
                      <div>
                        <Text>当前会话：</Text>
                        <div style={{ marginTop: 8 }}>
                          <Button type="primary" style={{ borderRadius: 10 }}>{currentSession}</Button>
                        </div>
                      </div>
                      <Space>
                        <Button onClick={onExportSession}>导出记录</Button>
                        <Button onClick={() => patchActiveMessages([])}>清空对话</Button>
                      </Space>
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        </Card>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 8 }}>
          <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setShowSidebar(true)} />
        </div>
      )}

      <Card className="app-elevated-card" style={{ height: '100%', minHeight: 0, minWidth: 0, maxWidth: '100%' }} bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, maxWidth: '100%', padding: 12, overflow: 'hidden' }}>
        <div ref={viewportRef} style={{ flex: 1, minHeight: 0, minWidth: 0, maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10, overflowY: 'auto', overflowX: 'hidden' }}>
          {activeMessages.length === 0 ? (
            <Empty description="请输入对话内容开始交流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {activeMessages.map((item, idx) => (
                <Card key={`${item.role}-${idx}`} size="small" style={{ background: item.role === 'user' ? '#eff6ff' : '#f8fafc', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 10, alignItems: 'start', minWidth: 0, maxWidth: '100%' }}>
                    {item.role === 'user' ? (
                      <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#ff6b6b' }} />
                    ) : (
                      <Avatar size={32} src={assistantAvatarSrc} />
                    )}
                    <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Text strong>{item.role === 'user' ? '我' : '精准寻源智能体'}：</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(item?.ts)}</Text>
                      </div>
                      {item.role === 'assistant' ? renderExecutionProcess(item) : null}
                      {item.role === 'assistant' ? renderAssistantResultCard(item) : null}
                      {item.role === 'assistant' ? renderArtifactCard(item) : null}
                      {item.role === 'assistant' ? renderAssistantExtraText(item) : renderMessageContent(item.content)}
                    </div>
                  </div>
                </Card>
              ))}
            </Space>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'end', flexShrink: 0, minWidth: 0, maxWidth: '100%', background: '#fff' }}>
          <Input.TextArea
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="请输入对话内容，换行请使用Shift+Enter。"
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void onSend()
              }
            }}
            style={{ minWidth: 0, maxWidth: '100%' }}
          />
          <Button type="primary" icon={<AppstoreOutlined />} loading={loading} onClick={onSend}>发送</Button>
        </div>
      </Card>

      <Modal
        title="选择模型"
        open={modelDialogOpen}
        onCancel={() => {
          setModelDialogOpen(false)
          setModelTestResult(null)
        }}
        onOk={() => {
          const next = String(modelDraft || '').trim()
          if (!next) {
            message.warning('请选择模型')
            return
          }
          setSelectedModelName(next)
          setModelDialogOpen(false)
          message.success(`已选择模型：${next}`)
        }}
        okText="确定"
        cancelText="取消"
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button
              loading={modelTestLoading}
              onClick={async () => {
                const providerName = String(modelProviderDraft || '').trim()
                const modelName = String(modelDraft || '').trim()
                if (!providerName) {
                  message.warning('请先选择模型供应商')
                  return
                }
                if (!modelName) {
                  message.warning('请先选择模型名称')
                  return
                }
                setModelTestLoading(true)
                setModelTestResult(null)
                try {
                  const result = await testModelProvider(providerName, { model: modelName })
                  const ok = Boolean(result?.ok ?? true)
                  const detail = String(result?.message || result?.detail || result?.status || '')
                  setModelTestResult({ ok, detail: detail || (ok ? '连接正常' : '连接失败') })
                  if (ok) message.success('测试连接成功')
                  else message.error(`测试连接失败：${detail || '未知原因'}`)
                } catch (error) {
                  const detail = String(error?.message || '请求失败')
                  setModelTestResult({ ok: false, detail })
                  message.error(`测试连接失败：${detail}`)
                } finally {
                  setModelTestLoading(false)
                }
              }}
            >
              测试连接
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Text>模型供应商</Text>
            <Select
              showSearch
              value={modelProviderDraft || undefined}
              onChange={(v) => {
                const nextProvider = String(v || '')
                setModelProviderDraft(nextProvider)
                const provider = modelProviders.find((item) => item.providerName === nextProvider)
                const rows = Array.isArray(provider?.fetchedModels) && provider.fetchedModels.length > 0
                  ? provider.fetchedModels
                  : (Array.isArray(provider?.models) ? provider.models : [])
                const firstModel = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)[0] || ''
                setModelDraft(firstModel)
              }}
              options={providerOptions}
              style={{ width: '100%', marginTop: 6 }}
              placeholder="请选择模型供应商"
              optionFilterProp="label"
            />
          </div>
          <div>
            <Text>模型名称</Text>
            <Select
              showSearch
              value={modelDraft || undefined}
              onChange={(v) => setModelDraft(String(v || ''))}
              options={modelNameOptions}
              style={{ width: '100%', marginTop: 6 }}
              placeholder="请选择模型名称"
              optionFilterProp="label"
            />
          </div>
          {modelTestResult ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}>
              <Space size={8} wrap>
                <Tag color={modelTestResult.ok ? 'green' : 'red'}>
                  {modelTestResult.ok ? '连接成功' : '连接失败'}
                </Tag>
                <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(modelTestResult.detail || '')}</Text>
              </Space>
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="编辑提示词"
        open={promptDialogOpen}
        onCancel={() => setPromptDialogOpen(false)}
        onOk={() => {
          setSystemPrompt(String(promptDraft || '').trim())
          setSystemPromptEnabled(promptEnabledDraft)
          setSystemPromptPresetKey(String(promptPresetKeyDraft || 'default'))
          setPromptDialogOpen(false)
          message.success(`提示词已更新（${promptEnabledDraft ? '启用' : '未启用'}）`)
        }}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Text>模板</Text>
            <Space wrap style={{ marginTop: 8 }}>
              {PROMPT_PRESETS.map((item) => (
                <Button
                  key={item.key}
                  size="small"
                  type={promptPresetKeyDraft === item.key ? 'primary' : 'default'}
                  onClick={() => {
                    setPromptPresetKeyDraft(item.key)
                    setPromptDraft(item.prompt)
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Space>
          </div>
          <div>
            <Text>启用提示词</Text>
            <div style={{ marginTop: 8 }}>
              <Checkbox checked={promptEnabledDraft} onChange={(e) => setPromptEnabledDraft(e.target.checked)}>
                启用
              </Checkbox>
            </div>
          </div>
          <Input.TextArea
            rows={8}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="输入系统提示词（多行）"
          />
        </Space>
      </Modal>

      <Modal
        title="智能体流程图"
        open={flowDialogOpen}
        onCancel={() => {
          setFlowDialogOpen(false)
          setFlowTabKey('logic')
        }}
        footer={null}
        width={760}
      >
        <Tabs
          activeKey={flowTabKey}
          onChange={setFlowTabKey}
          items={[
            {
              key: 'logic',
              label: '逻辑流程图',
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, fontSize: 12, color: '#475569' }}>
                    实时配置：工具 {flowConfigSummary.tools}；知识库 {flowConfigSummary.kb}；数据库 {flowConfigSummary.db}；模型 {flowConfigSummary.model}；提示词 {flowConfigSummary.prompt}；模板 {flowConfigSummary.template}
                  </div>
                  <div style={{ ...FLOW_NODE_STYLE, borderColor: '#bfdbfe', background: '#f8fafc' }}>开始：读取用户配置（工具/知识库/数据库/模型/提示词）</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>需求解析：提取关键词、业务约束与目标</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>自动编排：按你已选择的工具决定执行分支</div>
                  <Space wrap size={8}>
                    <Tag color={activeFlowBranches.db ? 'blue' : 'default'}>数据库检索 {activeFlowBranches.db ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.kb ? 'blue' : 'default'}>知识库检索 {activeFlowBranches.kb ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.web ? 'blue' : 'default'}>互联网搜索 {activeFlowBranches.web ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.image ? 'blue' : 'default'}>图片生成 {activeFlowBranches.image ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.chart ? 'blue' : 'default'}>图表生成 {activeFlowBranches.chart ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.export ? 'blue' : 'default'}>文件导出 {activeFlowBranches.export ? '启用' : '未启用'}</Tag>
                  </Space>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>证据融合：去重、相关性排序、风险归纳</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>模型输出：候选供应商 + 风险等级 + 下一步动作 + 查询语句</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>返回前端：答案、结构化结果、可下载产物（如图表/文件）</div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    {flowLogicText}
                  </pre>
                </Space>
              ),
            },
            {
              key: 'sequence',
              label: '时序图',
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#1e40af' }}>数据源层：数据库 / 知识库 / 互联网</div>
                    <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#166534' }}>融合层：证据融合与相关性排序</div>
                    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#5b21b6' }}>决策输出层：模型总结与结果返回</div>
                  </div>
                  <div className="precise-sequence-diagram" style={{ height: 340, borderRadius: 12, border: '1px solid #1f2937', overflow: 'hidden', background: '#2f3136' }}>
                    <CanvasWidget engine={sequenceDiagramEngine} className="precise-sequence-canvas" />
                  </div>
                  <Space wrap size={8}>
                    <Tag color={activeFlowBranches.db ? 'blue' : 'default'}>DB {activeFlowBranches.db ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.kb ? 'blue' : 'default'}>KB {activeFlowBranches.kb ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.web ? 'blue' : 'default'}>WEB {activeFlowBranches.web ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.chart ? 'blue' : 'default'}>图表 {activeFlowBranches.chart ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.export ? 'blue' : 'default'}>导出 {activeFlowBranches.export ? '启用' : '未启用'}</Tag>
                  </Space>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    {flowSequenceText}
                  </pre>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title={`文件预览：${artifactPreviewTitle}`}
        open={artifactPreviewOpen}
        onCancel={() => setArtifactPreviewOpen(false)}
        footer={null}
        width={920}
      >
        {artifactPreviewUrl && /\.html?(\?|$)/i.test(artifactPreviewUrl) ? (
          <iframe
            src={artifactPreviewUrl}
            title={artifactPreviewTitle || 'preview'}
            style={{ width: '100%', height: 520, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
          />
        ) : (
          <Space direction="vertical" size={10}>
            <div>当前文件类型暂不支持内嵌预览，请点击下方链接打开。</div>
            <a href={artifactPreviewUrl} target="_blank" rel="noreferrer">{artifactPreviewUrl}</a>
          </Space>
        )}
      </Modal>
    </div>
  )
}


