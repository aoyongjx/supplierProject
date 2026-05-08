import { AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Checkbox, Empty, Input, InputNumber, Modal, Select, Slider, Space, Tabs, Typography, Upload, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchLangchainModels,
  fetchLangchainSessionState,
  fetchLangchainTools,
  saveLangchainSessionState,
  sendLangchainChat,
} from '../api/langchainShellApi'
import assistantAvatarSrc from '../assets/chatchat_icon_blue_square_v2.png'

const { Text } = Typography
const { Dragger } = Upload

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
  const [imageModel, setImageModel] = useState('gpt-image-1')
  const [temperature, setTemperature] = useState(0.7)
  const [systemMessage, setSystemMessage] = useState('')
  const [lastCallMeta, setLastCallMeta] = useState(null)
  const [pendingHint, setPendingHint] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewModalImage, setPreviewModalImage] = useState('')
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const messageViewportRef = useRef(null)

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
          const preferred = options.find((item) => String(item.value) === 'gpt-5.4')
          setModelName(String((preferred || options[0]).value))
        } else {
          setModelName('')
        }
      })
      .catch((error) => message.error(error.message || '加载模型列表失败'))
    fetchLangchainSessionState('multi_chat')
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
      void saveLangchainSessionState({ chatType: 'multi_chat', sessions, currentSession }).catch((error) => {
        message.error(error.message || '保存会话失败')
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sessions, currentSession, sessionStateHydrated])

  const toolOptions = useMemo(
    () => tools.map((item) => ({ label: item.label, value: item.key })),
    [tools],
  )

  const activeSession = useMemo(
    () => sessions.find((s) => s.name === currentSession) || sessions[0],
    [sessions, currentSession],
  )
  const activeMessages = activeSession?.messages || []

  useEffect(() => {
    if (!messageViewportRef.current) return
    messageViewportRef.current.scrollTop = messageViewportRef.current.scrollHeight
  }, [activeMessages])

  function renderMessageContent(content) {
    const text = String(content || '')
    const markdownImageMatch = text.match(/!\[[^\]]*]\(([^)]+)\)/)
    const imageUrl = markdownImageMatch?.[1] ? String(markdownImageMatch[1]) : ''
    if (!imageUrl) {
      return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{text}</div>
    }
    const plainText = text.replace(/!\[[^\]]*]\(([^)]+)\)/g, '').trim()
    return (
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        {plainText ? <div style={{ marginBottom: 8 }}>{plainText}</div> : null}
        <img src={imageUrl} alt="generated" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e7eb' }} />
      </div>
    )
  }

  function getMessageImage(item) {
    const imageDataUrl = String(item?.imageDataUrl || '')
    return imageDataUrl.startsWith('data:image/') ? imageDataUrl : ''
  }

  function openImagePreview(url) {
    const value = String(url || '')
    if (!value) return
    setPreviewModalImage(value)
    setPreviewModalOpen(true)
  }

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

  function setPreviewFromFile(file) {
    if (!file) {
      setImageFile(null)
      setImagePreviewUrl('')
      return
    }
    const rawFile = file.originFileObj || file
    setImageFile(rawFile)
    const reader = new FileReader()
    reader.onload = () => setImagePreviewUrl(String(reader.result || ''))
    reader.readAsDataURL(rawFile)
  }

  async function onSend() {
    const text = String(input || '').trim()
    if (!text || loading) return
    const attachedImage = String(imagePreviewUrl || '')
    const isImageGenRequest = useAgent
      && selectedTools.includes('image_gen')
      && !/(不要出图|不用出图|仅文本|只要提示词|不要图片)/i.test(text)
    const nextHistory = [...activeMessages, { role: 'user', content: text, imageDataUrl: attachedImage }]
    patchActiveMessages(nextHistory)
    setInput('')
    setLoading(true)
    setPendingHint(isImageGenRequest ? '正在生成图片，请稍候...' : '正在思考中...')
    try {
      const data = await sendLangchainChat({
        message: text,
        history: nextHistory.slice(-12),
        useAgent,
        useMcp,
        selectedTools,
        model: modelName,
        imageModel,
        temperature,
        systemMessage,
        imageDataUrl: attachedImage,
      })
      patchActiveMessages([...nextHistory, { role: 'assistant', content: data?.answer || '' }])
      setLastCallMeta(data?.meta || null)
      if (attachedImage) {
        setImageFile(null)
        setImagePreviewUrl('')
      }
    } catch (error) {
      message.error(error.message || '发送失败')
      patchActiveMessages(activeMessages)
    } finally {
      setPendingHint('')
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
              <Text strong style={{ color: '#1d4ed8' }}>多功能对话</Text>
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
                    <div>
                      <Text type="secondary">上传图片</Text>
                      <div style={{ marginTop: 6 }}>
                        <Upload
                          accept=".bmp,.jpg,.jpeg,.png"
                          multiple={false}
                          maxCount={1}
                          showUploadList={false}
                          beforeUpload={() => false}
                          onChange={(info) => setPreviewFromFile(info?.file)}
                        >
                          <Button style={{ marginBottom: 10 }}>上传图像</Button>
                        </Upload>
                        <Dragger
                          accept=".bmp,.jpg,.jpeg,.png"
                          multiple={false}
                          maxCount={1}
                          showUploadList={false}
                          beforeUpload={() => false}
                          openFileDialogOnClick={false}
                          onChange={(info) => setPreviewFromFile(info?.file)}
                        >
                          <p style={{ margin: 0 }}>将文件拖拽到这里</p>
                          <p style={{ margin: '6px 0 0', color: '#64748b' }}>仅支持拖拽上传 · 单文件限制 200MB · 支持 BMP、JPG、JPEG、PNG</p>
                        </Dragger>
                      </div>
                      <div style={{ marginTop: 10, color: '#64748b', fontSize: 12 }}>按钮用于点选文件；虚线框用于拖拽上传</div>
                      {imagePreviewUrl ? (
                        <div style={{ marginTop: 10 }}>
                          <img src={imagePreviewUrl} alt="upload-preview" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                        </div>
                      ) : null}
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
                            <Button
                              key={s.name}
                              type={s.name === currentSession ? 'primary' : 'default'}
                              onClick={() => setCurrentSession(s.name)}
                              style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                            >
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
        <div ref={messageViewportRef} style={{ flex: 1, minHeight: 0, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10, overflowY: 'auto', overflowX: 'hidden' }}>
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
                      <Text strong>{item.role === 'user' ? '我' : '助手'}：</Text>
                      {renderMessageContent(item.content)}
                      {item.role === 'user' && getMessageImage(item) ? (
                        <div style={{ marginTop: 8 }}>
                          <img
                            src={getMessageImage(item)}
                            alt="uploaded"
                            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'zoom-in' }}
                            onClick={() => openImagePreview(getMessageImage(item))}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
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
        {loading && pendingHint ? (
          <div style={{ marginTop: 8, padding: '6px 10px', border: '1px solid #dbeafe', borderRadius: 8, background: '#eff6ff' }}>
            <Text type="secondary">{pendingHint}</Text>
          </div>
        ) : null}

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'end', flexShrink: 0, background: '#fff' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
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
            <div>
              <Text>图片模型</Text>
              <Select
                style={{ width: '100%', marginTop: 6 }}
                value={imageModel}
                onChange={setImageModel}
                options={[{ label: 'gpt-image-1', value: 'gpt-image-1' }]}
              />
            </div>
          </div>
          <div>
            <Text>System Message:</Text>
            <Input.TextArea rows={4} value={systemMessage} onChange={(e) => setSystemMessage(e.target.value)} style={{ marginTop: 6 }} />
          </div>
        </Space>
      </Modal>

      <Modal
        title="图片预览"
        open={previewModalOpen}
        onCancel={() => setPreviewModalOpen(false)}
        footer={null}
        width={980}
        centered
      >
        {previewModalImage ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img src={previewModalImage} alt="preview" style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 8 }} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
