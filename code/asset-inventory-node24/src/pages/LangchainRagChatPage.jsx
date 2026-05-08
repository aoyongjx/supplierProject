import { AppstoreOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Checkbox, Empty, Input, Modal, Select, Slider, Space, Tabs, Typography, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchKnowledgeBases, previewKnowledgeBaseDocument } from '../api/knowledgeBaseApi'
import { fetchLangchainSessionState, saveLangchainSessionState, sendLangchainRagChat } from '../api/langchainShellApi'
import assistantAvatarSrc from '../assets/chatchat_icon_blue_square_v2.png'

const { Text } = Typography

export default function LangchainRagChatPage() {
  const [kbList, setKbList] = useState([])
  const [kbId, setKbId] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [topK, setTopK] = useState(3)
  const [historyRounds, setHistoryRounds] = useState(3)
  const [scoreThreshold, setScoreThreshold] = useState(1)
  const [onlySearchResults, setOnlySearchResults] = useState(false)

  const [sessions, setSessions] = useState([{ name: 'default', messages: [] }])
  const [currentSession, setCurrentSession] = useState('default')
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewContent, setPreviewContent] = useState('')
  const [previewHit, setPreviewHit] = useState(null)

  const viewportRef = useRef(null)

  useEffect(() => {
    fetchKnowledgeBases()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setKbList(list)
        if (list[0]?.id) setKbId(String(list[0].id))
      })
      .catch((error) => message.error(error.message || '加载知识库失败'))

    fetchLangchainSessionState('rag_chat')
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
      void saveLangchainSessionState({ chatType: 'rag_chat', sessions, currentSession }).catch((error) => {
        message.error(error.message || '保存会话失败')
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sessions, currentSession, sessionStateHydrated])

  const kbOptions = useMemo(
    () => kbList.map((item) => ({ label: item.name, value: String(item.id) })),
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
          id="rename-rag-session-input"
          onPressEnter={() => {
            const inputEl = document.getElementById('rename-rag-session-input')
            if (inputEl) inputEl.blur()
          }}
        />
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-rag-session-input')
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
    const question = String(input || '').trim()
    if (!question || !kbId || loading) return
    const nextHistory = [...activeMessages, { role: 'user', content: question }]
    patchActiveMessages(nextHistory)
    setInput('')
    setLoading(true)
    try {
      const data = await sendLangchainRagChat({
        kbId,
        question,
        topK,
        historyRounds,
        scoreThreshold,
        onlySearchResults,
        history: nextHistory.slice(-(historyRounds * 2)),
      })
      const hits = Array.isArray(data?.hits) ? data.hits : []
      patchActiveMessages([...nextHistory, { role: 'assistant', content: data?.answer || '', hits }])
    } catch (error) {
      message.error(error.message || 'RAG 查询失败')
      patchActiveMessages(activeMessages)
    } finally {
      setLoading(false)
    }
  }

  function renderMessageContent(text = '') {
    const value = String(text || '')
    return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div>
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function highlightByKeywords(source, hitText) {
    const raw = String(hitText || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ')
      .trim()
    const words = raw
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .sort((a, b) => b.length - a.length)
      .slice(0, 10)

    if (words.length === 0) return escapeHtml(source)

    let html = escapeHtml(source)
    for (const token of words) {
      const safe = escapeHtml(token)
      const reg = new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      let replaced = false
      html = html.replace(reg, (m) => {
        if (replaced) return m
        replaced = true
        return `<mark style="background:#fff59d;padding:0 2px;border-radius:2px;">${m}</mark>`
      })
    }
    return html
  }

  function renderPreviewWithHighlight() {
    const source = String(previewContent || '')
    const hitText = String(previewHit?.content || '').trim()
    if (!source) return '暂无可预览内容'
    if (!hitText) return source

    const index = source.indexOf(hitText)
    if (index < 0) return source

    const ratio = hitText.length / Math.max(source.length, 1)
    if (ratio >= 0.6) {
      const html = highlightByKeywords(source, hitText)
      return <span dangerouslySetInnerHTML={{ __html: html }} />
    }

    const before = escapeHtml(source.slice(0, index))
    const middle = escapeHtml(source.slice(index, index + hitText.length))
    const after = escapeHtml(source.slice(index + hitText.length))
    const html = `${before}<mark style="background:#fff59d;padding:0 2px;border-radius:2px;">${middle}</mark>${after}`
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  }

  async function onPreviewEvidence(item) {
    const nextKbId = Number(item?.kbId || 0)
    const nextDocId = Number(item?.docId || 0)
    setPreviewHit(item || null)
    if (!(nextKbId > 0) || !(nextDocId > 0)) {
      setPreviewTitle(String(item?.source || '证据预览'))
      setPreviewContent(String(item?.content || ''))
      setPreviewOpen(true)
      return
    }
    setPreviewOpen(true)
    setPreviewLoading(true)
    try {
      const payload = await previewKnowledgeBaseDocument(nextKbId, nextDocId)
      setPreviewTitle(String(payload?.title || item?.source || `文档 #${nextDocId}`))
      const text = payload?.content || payload?.text || payload?.preview || ''
      setPreviewContent(String(text || item?.content || ''))
    } catch (error) {
      message.error(error.message || '加载知识库预览失败')
      setPreviewTitle(String(item?.source || `文档 #${nextDocId}`))
      setPreviewContent(String(item?.content || ''))
    } finally {
      setPreviewLoading(false)
    }
  }

  function renderEvidenceList(hits = []) {
    const list = Array.isArray(hits) ? hits : []
    if (list.length === 0) return null
    return (
      <div style={{ marginTop: 10, borderTop: '1px dashed #cbd5e1', paddingTop: 8 }}>
        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>检索证据</div>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {list.map((item, idx) => (
            <div key={`${item?.id || idx}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, color: '#334155' }}>
                {idx + 1}. [{Number(item?.score || 0).toFixed(4)}] {item?.source || '-'}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                命中信息：KB#{item?.kbId || '-'} / Doc#{item?.docId || '-'} / Chunk#{item?.chunkIndex ?? '-'}
              </div>
              <div style={{ marginTop: 6 }}>
                <Space size={8}>
                  <Button size="small" onClick={() => void onPreviewEvidence(item)}>知识库预览</Button>
                  {item?.url ? (
                    <a href={String(item.url)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      打开来源链接
                    </a>
                  ) : null}
                </Space>
              </div>
              {item?.url ? (
                <div style={{ marginTop: 4, fontSize: 12, color: '#64748b', overflowWrap: 'anywhere' }}>
                  {String(item.url)}
                </div>
              ) : null}
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 12, color: '#111827' }}>{item?.content || ''}</div>
            </div>
          ))}
        </Space>
      </div>
    )
  }

  function stepNumber(current, delta, min, max, setter) {
    const next = Math.min(max, Math.max(min, Number(current || 0) + delta))
    setter(next)
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
              <Text strong style={{ color: '#1d4ed8' }}>RAG 对话</Text>
            </Space>
            <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>当前会话：{currentSession}</div>
          </div>

          <Tabs
            size="small"
            items={[
              {
                key: 'rag',
                label: 'RAG 配置',
                children: (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div>
                      <Text>请选择对话模式:</Text>
                      <Select
                        value="知识库问答"
                        options={[{ label: '知识库问答', value: '知识库问答' }]}
                        style={{ width: '100%', marginTop: 8 }}
                        size="middle"
                      />
                    </div>
                    <div>
                      <Text>请选择知识库:</Text>
                      <Select
                        value={kbId || undefined}
                        options={kbOptions}
                        onChange={setKbId}
                        style={{ width: '100%', marginTop: 8 }}
                        size="middle"
                      />
                    </div>
                    <div style={{ borderTop: '1px solid #d9d9d9', marginTop: 4, paddingTop: 12 }}>
                      <Text>历史对话轮数:</Text>
                      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                        <div style={{ paddingLeft: 12, fontSize: 15 }}>{historyRounds}</div>
                        <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(historyRounds, -1, 0, 20, setHistoryRounds)}>-</Button>
                        <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(historyRounds, 1, 0, 20, setHistoryRounds)}>+</Button>
                      </div>
                    </div>
                    <div>
                      <Text>匹配知识条数:</Text>
                      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                        <div style={{ paddingLeft: 12, fontSize: 15 }}>{topK}</div>
                        <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(topK, -1, 1, 20, setTopK)}>-</Button>
                        <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(topK, 1, 1, 20, setTopK)}>+</Button>
                      </div>
                    </div>
                    <div>
                      <Text>知识匹配分数阈值:</Text>
                      <div style={{ marginTop: 4, textAlign: 'right', color: '#1d4ed8', fontSize: 16 }}>{Number(scoreThreshold).toFixed(2)}</div>
                      <Slider
                        min={0}
                        max={2}
                        step={0.01}
                        value={scoreThreshold}
                        onChange={(v) => setScoreThreshold(Number(v || 0))}
                        tooltip={{ open: false }}
                        styles={{ track: { backgroundColor: '#1d4ed8' }, rail: { backgroundColor: '#bfdbfe' }, handle: { borderColor: '#2563eb' } }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                        <span>0.00</span>
                        <span>2.00</span>
                      </div>
                      <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>
                        值越小匹配越严格；值越大召回更多但可能噪声更高（推荐 0.6~1.2）。
                      </div>
                    </div>
                    <Checkbox checked={onlySearchResults} onChange={(e) => setOnlySearchResults(e.target.checked)} style={{ fontSize: 14 }}>
                      仅返回检索结果
                    </Checkbox>
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
                      <Text strong>{item.role === 'user' ? '我' : '助手'}：</Text>
                      {renderMessageContent(item.content)}
                      {item.role === 'assistant' ? renderEvidenceList(item.hits) : null}
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
      <Modal
        title={previewTitle || '知识库预览'}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
        width={880}
      >
        {previewHit ? (
          <div style={{ marginBottom: 8, color: '#64748b', fontSize: 12 }}>
            命中信息：KB#{previewHit?.kbId || '-'} / Doc#{previewHit?.docId || '-'} / Chunk#{previewHit?.chunkIndex ?? '-'} / Score {Number(previewHit?.score || 0).toFixed(4)}
          </div>
        ) : null}
        <div style={{ maxHeight: '56vh', overflowY: 'auto', whiteSpace: 'pre-wrap', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
          {previewLoading ? '正在加载预览内容...' : renderPreviewWithHighlight()}
        </div>
      </Modal>
    </div>
  )
}
