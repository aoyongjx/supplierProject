import { AppstoreOutlined, DeleteOutlined, MessageOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Checkbox, Empty, Input, InputNumber, Modal, Select, Slider, Space, Tabs, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fetchLangchainModels, fetchLangchainTools, sendLangchainChat } from '../api/langchainShellApi'

const { Text } = Typography

export default function LangchainMultiChatPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const [sessions, setSessions] = useState([{ name: 'default', messages: [] }])
  const [currentSession, setCurrentSession] = useState('default')

  const [useAgent, setUseAgent] = useState(true)
  const [useMcp, setUseMcp] = useState(false)
  const [tools, setTools] = useState([])
  const [selectedTools, setSelectedTools] = useState([])

  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [modelPlatform, setModelPlatform] = useState('openai')
  const [modelOptions, setModelOptions] = useState([])
  const [modelName, setModelName] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [systemMessage, setSystemMessage] = useState('')
  const [lastCallMeta, setLastCallMeta] = useState(null)

  useEffect(() => {
    fetchLangchainTools()
      .then((rows) => setTools(rows))
      .catch((error) => message.error(error.message || '加载工具失败'))
    fetchLangchainModels()
      .then((catalog) => {
        const platform = String(catalog?.platform || 'openai')
        const models = Array.isArray(catalog?.models) ? catalog.models : []
        const options = models.map((item) => ({ label: item, value: item }))
        setModelPlatform(platform)
        setModelOptions(options)
        if (options.length > 0) {
          setModelName(String(options[0].value))
        } else {
          setModelName('')
        }
      })
      .catch((error) => message.error(error.message || '加载模型列表失败'))
  }, [])

  const toolOptions = useMemo(
    () => tools.map((item) => ({ label: item.label, value: item.key })),
    [tools],
  )

  const activeSession = useMemo(
    () => sessions.find((s) => s.name === currentSession) || sessions[0],
    [sessions, currentSession],
  )
  const activeMessages = activeSession?.messages || []

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
          id="rename-session-input"
          onPressEnter={() => {
            const inputEl = document.getElementById('rename-session-input')
            if (inputEl) inputEl.blur()
          }}
        />
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-session-input')
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

  async function onSend() {
    const text = String(input || '').trim()
    if (!text || loading) return
    const nextHistory = [...activeMessages, { role: 'user', content: text }]
    patchActiveMessages(nextHistory)
    setInput('')
    setLoading(true)
    try {
      const data = await sendLangchainChat({
        message: text,
        history: nextHistory.slice(-12),
        useAgent,
        useMcp,
        selectedTools,
        model: modelName,
        temperature,
        systemMessage,
      })
      patchActiveMessages([...nextHistory, { role: 'assistant', content: data?.answer || '' }])
      setLastCallMeta(data?.meta || null)
    } catch (error) {
      message.error(error.message || '发送失败')
      patchActiveMessages(activeMessages)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, minHeight: 'calc(100vh - 130px)' }}>
      <Card className="app-elevated-card" bodyStyle={{ padding: 12 }}>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
            <Space align="center" size={8}>
              <MessageOutlined style={{ color: '#2563eb' }} />
              <Text strong style={{ color: '#1d4ed8' }}>多功能对话</Text>
            </Space>
          </div>

          <Tabs
            size="small"
            items={[
              {
                key: 'tool',
                label: '工具设置',
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Checkbox checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)}>启用Agent</Checkbox>
                    <Checkbox checked={useMcp} onChange={(e) => setUseMcp(e.target.checked)} disabled={!useAgent}>使用MCP</Checkbox>
                    <div>
                      <Text type="secondary">选择工具</Text>
                      <Select
                        mode="multiple"
                        value={selectedTools}
                        onChange={setSelectedTools}
                        options={toolOptions}
                        style={{ width: '100%', marginTop: 6 }}
                        placeholder="请选择工具"
                        allowClear
                        maxTagCount="responsive"
                        disabled={!useAgent}
                      />
                    </div>
                  </Space>
                ),
              },
              {
                key: 'session',
                label: '会话设置',
                children: (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
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

      <Card className="app-elevated-card" bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 130px)', padding: 12 }}>
        <div style={{ flex: 1, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10, overflow: 'auto' }}>
          {activeMessages.length === 0 ? (
            <Empty description="请输入对话内容开始交流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {activeMessages.map((item, idx) => (
                <Card key={`${item.role}-${idx}`} size="small" style={{ background: item.role === 'user' ? '#eff6ff' : '#f8fafc' }}>
                  <Text strong>{item.role === 'user' ? '我' : '助手'}：</Text>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{item.content}</div>
                </Card>
              ))}
            </Space>
          )}
        </div>
        {lastCallMeta ? (
          <div style={{ marginTop: 8, padding: '6px 10px', border: '1px dashed #cbd5e1', borderRadius: 8, background: '#f8fafc' }}>
            <Text type="secondary">
              模型核验：请求=`{lastCallMeta.modelRequested || '-'}`
              ，返回=`{lastCallMeta.modelReturned || '-'}`
              ，网关=`{lastCallMeta.apiBase || '-'}`
            </Text>
          </div>
        ) : null}

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'end' }}>
          <Button icon={<SettingOutlined />} onClick={() => setModelConfigOpen(true)} />
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

      <Modal
        title="模型配置"
        open={modelConfigOpen}
        onCancel={() => setModelConfigOpen(false)}
        footer={<Button onClick={() => setModelConfigOpen(false)}>OK</Button>}
        width={760}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <Text>选择模型平台</Text>
              <Select
                style={{ width: '100%', marginTop: 6 }}
                value={modelPlatform}
                onChange={() => null}
                options={[{ label: modelPlatform, value: modelPlatform }]}
              />
            </div>
            <div>
              <Text>选择LLM模型</Text>
              <Select
                style={{ width: '100%', marginTop: 6 }}
                value={modelName}
                onChange={setModelName}
                options={modelOptions}
              />
            </div>
            <div>
              <Text>Temperature</Text>
              <Slider min={0} max={1} step={0.01} value={temperature} onChange={setTemperature} style={{ marginTop: 14 }} />
              <InputNumber min={0} max={1} step={0.01} value={temperature} onChange={(v) => setTemperature(Number(v || 0))} style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <Text>System Message:</Text>
            <Input.TextArea rows={4} value={systemMessage} onChange={(e) => setSystemMessage(e.target.value)} style={{ marginTop: 6 }} />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
