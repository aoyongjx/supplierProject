import {
  AppstoreOutlined,
  ArrowUpOutlined,
  DatabaseOutlined,
  EyeOutlined,
  RobotOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { Button, Card, Dropdown, Input, Skeleton, Space, Tag, Tooltip, Typography, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { executeCrawlNow } from '../api/crawlExecuteApi'
import { createSession, fetchSessionDetail, sendSessionMessage } from '../api/sessionApi'

const { Text } = Typography

const PROMPT_TEMPLATE = `Prompt：
1、爬取类型：全量/增量
2、映射业务实体：供应商/企业/产品/招标/汽车流通/交易/口碑
3、URLs：https://www.abc.com/...`

const modelOptions = ['gpt-5.4', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1-codex-mini']
const taskOptions = [{ key: 'internet', label: '互联网数据获取' }]
const skillOptions = [
  { key: 'crawl4ai', label: 'Crawl4AI' },
  { key: 'openclaw-grok-search', label: 'openclaw-grok-search' },
  { key: 'vercel:agent-browser', label: 'vercel:agent-browser' },
  { key: 'Playwright', label: 'Playwright（浏览器自动化）' },
  { key: 'playwright-script', label: 'playwright-script' },
]
const directCrawlSkillLabels = new Set(skillOptions.map((item) => item.label))

function toEntriesFromMessages(messages = []) {
  const entries = []
  let current = null
  messages.forEach((msg) => {
    if (msg.role === 'user') {
      current = {
        id: `entry_${msg.id}`,
        question: msg.content,
        runLogs: [],
        result: null,
        error: '',
      }
      entries.push(current)
      return
    }
    if (msg.role === 'assistant' && current) {
      const meta = msg.meta || {}
      if (meta.type === 'crawl_result') {
        current.runLogs = Array.isArray(meta.runLogs) ? meta.runLogs : []
        current.result = meta.result || null
      }
      if (meta.type === 'chat_result') {
        current.runLogs = Array.isArray(meta.runLogs) ? meta.runLogs : []
        current.result = {
          mode: 'chat',
          answer: meta.answer || msg.content || '',
        }
      }
      if (meta.type === 'error') {
        current.error = msg.content || '执行失败'
      }
      if (!meta.type && msg.content) {
        current.result = {
          mode: 'chat',
          answer: msg.content,
        }
      }
    }
  })
  return entries
}

function SessionChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const bodyRef = useRef(null)
  const [selectedTags, setSelectedTags] = useState([])
  const [messageText, setMessageText] = useState('')
  const [promptHint, setPromptHint] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [entries, setEntries] = useState([])
  const [sessionTitle, setSessionTitle] = useState('新会话')
  const sessionId = useMemo(() => {
    const val = Number(id)
    return Number.isInteger(val) && val > 0 ? val : null
  }, [id])

  const injectPrompt = () => setPromptHint(PROMPT_TEMPLATE)

  const addTag = (type, label) => {
    const key = `${type}:${label}`
    setSelectedTags((prev) => (prev.some((item) => item.key === key) ? prev : [...prev, { key, label }]))
    if (type === 'task') injectPrompt()
  }

  const removeTag = (key) => setSelectedTags((prev) => prev.filter((item) => item.key !== key))

  const autoResizeIframe = (iframe) => {
    if (!iframe) return
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) return
      const height = Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
      )
      iframe.style.height = `${Math.max(120, height + 4)}px`
    } catch {}
  }

  const buildIframeHtml = (entry) => {
    const logs = (entry.runLogs || []).map((line) => `<li style="padding:6px 0;border-bottom:1px solid #e2e8f0;">${line}</li>`).join('')
    const result = (() => {
      if (!entry.result) return ''
      if (entry.result.mode === 'chat') {
        return `<div style="margin-top:10px;padding:10px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff;white-space:pre-wrap;">${entry.result.answer || ''}</div>`
      }
      return `<div style="margin-top:10px;padding:10px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff;">
        <div>总数：${entry.result.totalRows || 0}，成功：${entry.result.successRows || 0}，失败：${entry.result.failedRows || 0}</div>
        ${entry.result.fileName ? `<div>文件：${entry.result.fileName}</div>` : ''}
        ${entry.result.downloadUrl ? `<div style="margin-top:6px;"><a href="${entry.result.downloadUrl}" target="_blank" rel="noreferrer">下载结果文件</a></div>` : ''}
      </div>`
    })()
    const error = entry.error
      ? `<div style="margin-top:10px;padding:10px;border:1px solid #fecaca;border-radius:10px;background:#fff1f2;color:#b91c1c;">${entry.error}</div>`
      : ''
    return `<!doctype html><html><head><meta charset="utf-8" />
      <style>body{font-family:"Fira Sans","Segoe UI","Microsoft YaHei",sans-serif;margin:0;padding:12px;color:#0f172a;background:#fff;}ul{margin:0;padding:0;list-style:none;}</style>
      </head><body><ul>${logs}</ul>${result}${error}</body></html>`
  }

  const refreshSession = async (targetId) => {
    if (!targetId) return
    setLoadingSession(true)
    try {
      const detail = await fetchSessionDetail(targetId)
      setSessionTitle(detail.title || '历史会话')
      setEntries(toEntriesFromMessages(detail.messages || []))
    } catch (error) {
      message.error(error.message || '加载会话失败')
    } finally {
      setLoadingSession(false)
    }
  }

  const ensureSession = async (prompt) => {
    if (sessionId) return sessionId
    const created = await createSession({
      firstPrompt: prompt,
      selectedTags,
    })
    const createdId = Number(created.id)
    if (createdId) {
      setSessionTitle(created.title || '新会话')
      navigate(`/sessions/${createdId}`, { replace: true })
      return createdId
    }
    throw new Error('创建会话失败')
  }

  const handleSubmit = async () => {
    const prompt = messageText.trim() || promptHint.trim()
    if (!prompt) {
      message.warning('请先输入会话内容')
      return
    }
    const tempId = `temp_${Date.now()}`
    setEntries((prev) => [...prev, { id: tempId, question: prompt, runLogs: ['请求已发送，等待执行...'], result: null, error: '' }])
    setMessageText('')
    setIsExecuting(true)
    try {
      const sid = await ensureSession(prompt)
      const hasUrl = /https?:\/\/[^\s,，]+/i.test(prompt)
      const selectedTask = selectedTags.some((item) => String(item.key || '').startsWith('task:') && /互联网数据获取/.test(item.label || ''))
      const selectedSkill = selectedTags.some((item) => String(item.key || '').startsWith('skill:') && directCrawlSkillLabels.has(String(item.label || '')))
      const looksLikeCrawl = /爬取|采集|crawl|抓取|抓这个|直接执行/i.test(prompt)
      const shouldCrawl = hasUrl && (selectedTask || selectedSkill || looksLikeCrawl)
      if (shouldCrawl) {
        const result = await executeCrawlNow({ prompt, selectedTags, sessionId: sid })
        setEntries((prev) => prev.map((it) => (it.id === tempId ? {
          ...it,
          runLogs: Array.isArray(result.runLogs) ? result.runLogs : [],
          result: {
            fileName: result.fileName,
            downloadUrl: result.downloadUrl,
            totalRows: result.totalRows,
            successRows: result.successRows,
            failedRows: result.failedRows,
          },
        } : it)))
        message.success(`执行完成，共 ${result.totalRows || 0} 条`)
      } else {
        const result = await sendSessionMessage(sid, { content: prompt, selectedTags })
        setEntries((prev) => prev.map((it) => (it.id === tempId ? {
          ...it,
          runLogs: Array.isArray(result.runLogs) ? result.runLogs : [],
          result: { mode: 'chat', answer: result.answer || '' },
        } : it)))
        message.success('会话已完成')
      }
      await refreshSession(sid)
    } catch (error) {
      setEntries((prev) => prev.map((it) => (it.id === tempId ? { ...it, error: error.message || '执行失败' } : it)))
      message.error(error.message || '执行失败')
    } finally {
      setIsExecuting(false)
    }
  }

  useEffect(() => {
    if (sessionId) refreshSession(sessionId)
    if (!sessionId) {
      setSessionTitle('新会话')
      setEntries([])
    }
  }, [sessionId])

  useEffect(() => {
    if (!bodyRef.current) return
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries, loadingSession])

  return (
    <Card className="app-elevated-card session-chat-shell" bodyStyle={{ padding: 12 }}>
      <div className="session-chat-inner">
        <div className="session-chat-topbar">
          <Space direction="vertical" size={2}>
            <Text strong>{sessionTitle}</Text>
            <Text className="muted">{sessionId ? `会话ID：${sessionId}` : '未保存'}</Text>
          </Space>
          <Button icon={<EyeOutlined />} onClick={() => navigate('/sessions')}>查看历史会话</Button>
        </div>

        <div className="session-chat-body" ref={bodyRef}>
          <div className="session-placeholder">你好，我是默认助手。你可以立刻开始跟我聊天</div>
          {loadingSession ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
          {entries.map((entry) => (
            <Card key={entry.id} size="small" className="session-result-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div><Text strong>问题：</Text><Text>{entry.question}</Text></div>
                <iframe
                  title={`run-result-${entry.id}`}
                  srcDoc={buildIframeHtml(entry)}
                  className="session-run-iframe"
                  sandbox="allow-same-origin"
                  scrolling="no"
                  onLoad={(e) => autoResizeIframe(e.currentTarget)}
                />
              </Space>
            </Card>
          ))}
        </div>

        <div className="session-chat-footer">
          <div className="session-selected-tags">
            <Space wrap>
              {selectedTags.map((item) => (
                <Tag key={item.key} color="blue" closable onClose={(e) => { e.preventDefault(); removeTag(item.key) }} className="session-tag-pill">
                  {item.label}
                </Tag>
              ))}
            </Space>
          </div>
          <div className="session-input-wrapper">
            <Input.TextArea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder={promptHint || '在这里输入消息，按 Enter 发送'}
              className="session-input"
            />
            <Tooltip title="发送">
              <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} className="session-send-btn" loading={isExecuting} onClick={handleSubmit} />
            </Tooltip>
          </div>
          <Space wrap style={{ marginTop: 10 }}>
            <Tooltip title="选择任务（可多选）">
              <Dropdown
                trigger={['click']}
                menu={{
                  items: taskOptions.map((item) => ({ key: item.key, label: item.label })),
                  onClick: ({ key }) => {
                    const selected = taskOptions.find((item) => item.key === key)
                    if (selected) addTag('task', selected.label)
                  },
                }}
              >
                <Button shape="circle" icon={<RobotOutlined />} />
              </Dropdown>
            </Tooltip>
            <Tooltip title="选择模型（下拉）">
              <Dropdown
                trigger={['click']}
                menu={{ items: modelOptions.map((item) => ({ key: item, label: item })), onClick: ({ key }) => addTag('model', String(key)) }}
              >
                <Button shape="circle" icon={<AppstoreOutlined />} />
              </Dropdown>
            </Tooltip>
            <Tooltip title="选择技能（下拉）">
              <Dropdown
                trigger={['click']}
                menu={{
                  items: skillOptions.map((item) => ({ key: item.key, label: item.label })),
                  onClick: ({ key }) => {
                    const selected = skillOptions.find((item) => item.key === key)
                    if (selected) addTag('skill', selected.label)
                  },
                }}
              >
                <Button shape="circle" icon={<ToolOutlined />} />
              </Dropdown>
            </Tooltip>
            <Tooltip title="添加知识库">
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [{ key: 'kb:供应商知识库', label: '供应商知识库' }, { key: 'kb:行业资讯库', label: '行业资讯库' }, { key: 'kb:招投标知识库', label: '招投标知识库' }],
                  onClick: ({ key }) => addTag('kb', String(key).replace('kb:', '')),
                }}
              >
                <Button shape="circle" icon={<DatabaseOutlined />} />
              </Dropdown>
            </Tooltip>
          </Space>
        </div>
      </div>
    </Card>
  )
}

export default SessionChatPage
