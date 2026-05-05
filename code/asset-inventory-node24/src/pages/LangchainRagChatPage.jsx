import { Button, Card, Input, Select, Space, Table, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fetchKnowledgeBases } from '../api/knowledgeBaseApi'
import { sendLangchainRagChat } from '../api/langchainShellApi'

const { Text } = Typography

export default function LangchainRagChatPage() {
  const [kbList, setKbList] = useState([])
  const [kbId, setKbId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [hits, setHits] = useState([])

  useEffect(() => {
    fetchKnowledgeBases()
      .then((rows) => {
        setKbList(rows)
        if (rows[0]?.id) setKbId(String(rows[0].id))
      })
      .catch((error) => message.error(error.message || '加载知识库失败'))
  }, [])

  const options = useMemo(
    () => kbList.map((item) => ({ label: `${item.name}（${item.status}）`, value: String(item.id) })),
    [kbList],
  )

  async function onAsk() {
    const text = String(query || '').trim()
    if (!text || !kbId || loading) return
    setLoading(true)
    setAnswer('')
    setHits([])
    try {
      const data = await sendLangchainRagChat({ kbId, question: text, topK: 8 })
      setAnswer(data?.answer || '')
      setHits(Array.isArray(data?.hits) ? data.hits : [])
    } catch (error) {
      message.error(error.message || 'RAG 查询失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">LangChain RAG 对话（后端接口：`/api/langchain/rag-chat`）</Text>
          <Select value={kbId || undefined} onChange={setKbId} options={options} placeholder="选择知识库" />
          <Input.TextArea rows={4} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入检索问题" />
          <Button type="primary" loading={loading} onClick={onAsk}>检索并回答</Button>
        </Space>
      </Card>

      <Card title="回答" className="app-elevated-card">
        <div style={{ whiteSpace: 'pre-wrap', minHeight: 80 }}>{answer || '暂无回答'}</div>
      </Card>

      <Card title="检索证据" className="app-elevated-card">
        <Table
          rowKey={(row, idx) => `${row?.id || idx}`}
          dataSource={hits}
          pagination={false}
          columns={[
            { title: '相似度', dataIndex: 'score', width: 120, render: (v) => (Number.isFinite(v) ? Number(v).toFixed(4) : '-') },
            { title: '内容', dataIndex: 'content', render: (v) => <div style={{ whiteSpace: 'pre-wrap' }}>{v || '-'}</div> },
            { title: '来源', dataIndex: 'source', width: 220 },
          ]}
        />
      </Card>
    </Space>
  )
}
