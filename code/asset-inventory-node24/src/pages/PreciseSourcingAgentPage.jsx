import { AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Checkbox, Collapse, Empty, Input, Modal, Select, Slider, Space, Tabs, Tag, Typography, Upload, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { chatPreciseSourcingAgent } from '../api/agentApi'
import { fetchKnowledgeBases } from '../api/knowledgeBaseApi'
import { fetchLangchainSessionState, saveLangchainSessionState } from '../api/langchainShellApi'
import { fetchInstalledSkills } from '../api/skillManagementApi'
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
  { label: 'PPT 模板', value: 'ppt' },
  { label: 'Word 模板', value: 'word' },
  { label: 'Excel 模板', value: 'excel' },
]

export default function PreciseSourcingAgentPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)

  const [skills, setSkills] = useState([])
  const [selectedSkills, setSelectedSkills] = useState([])
  const [kbList, setKbList] = useState([])
  const [selectedKbIds, setSelectedKbIds] = useState([])
  const [selectedDbTables, setSelectedDbTables] = useState([])
  const [strictMode, setStrictMode] = useState(false)
  const [templateType, setTemplateType] = useState('ppt')
  const [templateFile, setTemplateFile] = useState(null)
  const [generateCharts, setGenerateCharts] = useState(true)
  const [kbTopK, setKbTopK] = useState(3)
  const [dbTopK, setDbTopK] = useState(10)
  const [temperature, setTemperature] = useState(0.7)

  const [sessions, setSessions] = useState([{ name: 'default', messages: [] }])
  const [currentSession, setCurrentSession] = useState('default')
  const viewportRef = useRef(null)

  useEffect(() => {
    fetchInstalledSkills()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setSkills(list)
      })
      .catch(() => setSkills([]))

    fetchKnowledgeBases()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setKbList(list)
      })
      .catch(() => setKbList([]))

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
    if (!sessionStateHydrated) return
    const timer = window.setTimeout(() => {
      void saveLangchainSessionState({ chatType: 'precise_sourcing', sessions, currentSession }).catch((error) => {
        message.error(error.message || '保存会话失败')
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sessions, currentSession, sessionStateHydrated])

  const skillOptions = useMemo(
    () => (Array.isArray(skills) ? skills.map((item) => ({ label: item.name, value: item.name })) : []),
    [skills],
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

  useEffect(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [activeMessages])

  function patchActiveMessages(nextMessages) {
    setSessions((current) => current.map((item) => (item.name === currentSession ? { ...item, messages: nextMessages } : item)))
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
    return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(text || '')}</div>
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
    const rounds = Array.isArray(item?.react?.rounds) ? item.react.rounds : []
    const traces = Array.isArray(item?.traces) ? item.traces : []
    if (rounds.length === 0 && traces.length === 0) return null
    const panels = rounds.length > 0
      ? rounds.map((round, idx) => ({
        key: `round-${idx + 1}`,
        label: (
          <Space size={8}>
            <Tag color="blue">Round {idx + 1}</Tag>
            <span>Thought → Action → Observation</span>
          </Space>
        ),
        children: (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div><Tag color="purple">Thought</Tag> {round?.thought?.detail || round?.thought?.title || '（无）'}</div>
            <div><Tag color="cyan">Action</Tag> {round?.action?.detail || round?.action?.title || '（无）'}</div>
            {round?.action?.input ? (
              <div style={{ marginLeft: 4 }}>
                <Tag color="geekblue">Action Input</Tag>
                <Typography.Text code style={{ whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(round.action.input, null, 2)}
                </Typography.Text>
              </div>
            ) : null}
            <div><Tag color="gold">Observation</Tag> {round?.observation?.detail || round?.observation?.title || '（无）'}</div>
          </Space>
        ),
      }))
      : traces.map((trace, idx) => ({
        key: `trace-${idx + 1}`,
        label: `${idx + 1}. ${String(trace?.title || trace?.step || 'trace')}`,
        children: <div style={{ whiteSpace: 'pre-wrap' }}>{String(trace?.detail || '')}</div>,
      }))
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ marginBottom: 6, color: '#64748b', fontSize: 12 }}>
          执行过程 {item?.intent ? `(意图: ${item.intent})` : ''}{item?.traceVersion ? ` · 版本: ${item.traceVersion}` : ''}
        </div>
        <Collapse size="small" defaultActiveKey={panels.map((p) => p.key)} items={panels} />
        {Array.isArray(item?.evidence?.suppliers) && item.evidence.suppliers.length > 0 ? (
          <div style={{ marginTop: 10, borderTop: '1px dashed #cbd5e1', paddingTop: 8 }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>DB 命中来源字段（Top 5）</div>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {item.evidence.suppliers.slice(0, 5).map((row, idx) => (
                <div key={`db-hit-${idx}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 12, color: '#334155' }}>{idx + 1}. {String(row?.companyName || row?.company_name || row?.name || '-')}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(Array.isArray(row?._matchFieldScores) ? row._matchFieldScores : []).map((item2) => (
                      <Tag key={`${idx}-${item2?.field}`} color="blue">
                        {String(item2?.field)} ({Number(item2?.score || 0).toFixed(2)})
                      </Tag>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          </div>
        ) : null}
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
      const reportTemplate = templateFile
        ? {
          type: templateType,
          fileName: String(templateFile.name || ''),
          dataUrl: await fileToDataUrl(templateFile),
        }
        : null

      const data = await chatPreciseSourcingAgent({
        message: question,
        kbId: selectedKbIds[0] || '',
        kbIds: selectedKbIds,
        topK: kbTopK,
        dbTopK,
        selectedTools: selectedSkills,
        selectedSkills,
        selectedDbTables,
        strictMode,
        generateCharts,
        temperature,
        reportTemplate,
        history: nextHistory.slice(-12),
      })

      const evidence = data?.evidence || {}
      const metaSummary = `命中统计：知识库 ${Array.isArray(evidence?.kbHits) ? evidence.kbHits.length : 0} 条；数据库 ${Array.isArray(evidence?.suppliers) ? evidence.suppliers.length : 0} 条`
      patchActiveMessages([
        ...nextHistory,
        {
          role: 'assistant',
          content: `${String(data?.answer || '未返回内容')}\n\n---\n${metaSummary}`,
          evidence,
          traces: Array.isArray(data?.traces) ? data.traces : [],
          react: data?.react || { rounds: [] },
          intent: String(data?.intent || ''),
          traceVersion: String(data?.traceVersion || ''),
          ts: Date.now(),
        },
      ])
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
              <Space align="center" size={8}>
                <MessageOutlined style={{ color: '#2563eb' }} />
                <Text strong style={{ color: '#1d4ed8' }}>精准寻源智能体</Text>
              </Space>
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
                        <Text>选择技能:</Text>
                        <Select
                          mode="multiple"
                          value={selectedSkills}
                          onChange={setSelectedSkills}
                          options={skillOptions}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="请选择技能"
                          allowClear
                          maxTagCount="responsive"
                        />
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
                      <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 12 }}>
                        <Text>报告模板类型:</Text>
                        <Select value={templateType} onChange={setTemplateType} options={TEMPLATE_TYPE_OPTIONS} style={{ width: '100%', marginTop: 8 }} />
                        <Upload
                          style={{ marginTop: 8 }}
                          beforeUpload={() => false}
                          maxCount={1}
                          showUploadList
                          onChange={onTemplateUpload}
                          accept={templateType === 'ppt' ? '.ppt,.pptx' : templateType === 'word' ? '.doc,.docx' : '.xls,.xlsx,.csv'}
                        >
                          <Button style={{ marginTop: 8 }}>上传报告模板</Button>
                        </Upload>
                      </div>
                      <Checkbox checked={generateCharts} onChange={(e) => setGenerateCharts(e.target.checked)}>
                        生成图表
                      </Checkbox>
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

      <Card className="app-elevated-card" style={{ height: '100%', minHeight: 0 }} bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: 12, overflow: 'hidden' }}>
        <div ref={viewportRef} style={{ flex: 1, minHeight: 0, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10, overflowY: 'auto', overflowX: 'hidden' }}>
          {activeMessages.length === 0 ? (
            <Empty description="请输入对话内容开始交流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {activeMessages.map((item, idx) => (
                <Card key={`${item.role}-${idx}`} size="small" style={{ background: item.role === 'user' ? '#eff6ff' : '#f8fafc' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 10, alignItems: 'start' }}>
                    {item.role === 'user' ? (
                      <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#ff6b6b' }} />
                    ) : (
                      <Avatar size={32} src={assistantAvatarSrc} />
                    )}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Text strong>{item.role === 'user' ? '我' : '精准寻源智能体'}：</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(item?.ts)}</Text>
                      </div>
                      {item.role === 'assistant' ? renderExecutionProcess(item) : null}
                      {renderMessageContent(item.content)}
                    </div>
                  </div>
                </Card>
              ))}
            </Space>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end', flexShrink: 0, background: '#fff' }}>
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
          />
          <Button type="primary" icon={<AppstoreOutlined />} loading={loading} onClick={onSend}>发送</Button>
        </div>
      </Card>
    </div>
  )
}

