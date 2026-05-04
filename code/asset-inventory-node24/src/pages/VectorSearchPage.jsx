import { Alert, Button, Card, Divider, Input, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fetchKnowledgeBases, searchKnowledgeBase } from '../api/knowledgeBaseApi'

const { Text, Title } = Typography

function shortText(input = '', limit = 240) {
  const text = String(input || '').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function escapeRegExp(text = '') {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHighlightTokens(query = '') {
  const raw = String(query || '').trim()
  if (!raw) return []
  const bySplit = raw.split(/[\s,，。；;、|]+/g).map((item) => item.trim()).filter(Boolean)
  if (bySplit.length > 1) return Array.from(new Set(bySplit.filter((item) => item.length >= 2)))
  const single = bySplit[0] || raw
  const cjkOnly = /^[\u4e00-\u9fff]+$/.test(single)
  if (!cjkOnly) return single.length >= 2 ? [single] : []
  const tokens = new Set()
  if (single.length >= 2) {
    for (let i = 0; i < single.length - 1; i += 1) {
      tokens.add(single.slice(i, i + 2))
    }
  }
  return Array.from(tokens).filter((item) => item.length >= 2)
}

function renderHighlightedText(text = '', query = '') {
  const raw = String(text || '')
  const tokens = buildHighlightTokens(query)
  if (tokens.length === 0) return raw
  const pattern = tokens
    .sort((a, b) => b.length - a.length)
    .map((item) => escapeRegExp(item))
    .join('|')
  if (!pattern) return raw
  const regex = new RegExp(`(${pattern})`, 'gi')
  const parts = raw.split(regex)
  return parts.map((part, index) => {
    if (!part) return null
    const matched = tokens.some((token) => token && part.toLowerCase() === token.toLowerCase())
    if (!matched) return <span key={index}>{part}</span>
    return (
      <mark key={index} style={{ background: '#ffe58f', padding: '0 2px', borderRadius: 3 }}>
        {part}
      </mark>
    )
  })
}

export default function VectorSearchPage() {
  const [knowledgeBases, setKnowledgeBases] = useState([])
  const [loadingKb, setLoadingKb] = useState(false)
  const [searching, setSearching] = useState(false)
  const [kbId, setKbId] = useState('')
  const [query, setQuery] = useState('')
  const [metric, setMetric] = useState('cosine')
  const [topK, setTopK] = useState(20)
  const [result, setResult] = useState(null)
  const [strictKeyword, setStrictKeyword] = useState(true)

  const loadKnowledgeBases = async () => {
    setLoadingKb(true)
    try {
      const rows = await fetchKnowledgeBases()
      setKnowledgeBases(rows)
      if (!kbId && rows[0]?.id) setKbId(rows[0].id)
    } catch (error) {
      message.error(error.message || '读取知识库失败')
    } finally {
      setLoadingKb(false)
    }
  }

  useEffect(() => { loadKnowledgeBases() }, [])

  const onSearch = async () => {
    if (!kbId) return message.warning('请先选择知识库')
    if (!String(query || '').trim()) return message.warning('请输入检索词')
    setSearching(true)
    try {
      const data = await searchKnowledgeBase(kbId, { query, metric, topK, strictKeyword })
      setResult(data)
    } catch (error) {
      message.error(error.message || '向量检索失败')
    } finally {
      setSearching(false)
    }
  }

  const tableData = useMemo(() => (
    Array.isArray(result?.results)
      ? result.results.map((item, index) => ({
        key: `${item.docId}-${item.chunkIndex}-${index}`,
        rank: index + 1,
        docId: item.docId,
        chunkIndex: item.chunkIndex,
        chunkText: item.chunkText,
        cosineDistance: item.cosineDistance,
        euclideanDistance: item.euclideanDistance,
      }))
      : []
  ), [result])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>向量检索工作台</Title>
          <Text type="secondary">语义召回 + 关键词重排。距离值越小，相关性越高。</Text>
          <Space wrap>
            <Select
              loading={loadingKb}
              style={{ width: 320 }}
              placeholder="选择知识库"
              value={kbId || undefined}
              onChange={setKbId}
              options={knowledgeBases.map((item) => ({ label: item.name, value: item.id }))}
            />
            <Select
              style={{ width: 160 }}
              value={metric}
              onChange={setMetric}
              options={[
                { label: '余弦距离', value: 'cosine' },
                { label: '欧式距离', value: 'euclidean' },
              ]}
            />
            <Select
              style={{ width: 120 }}
              value={topK}
              onChange={setTopK}
              options={[10, 20, 30, 50, 100].map((num) => ({ label: `TopK ${num}`, value: num }))}
            />
            <Select
              style={{ width: 190 }}
              value={strictKeyword ? 'strict' : 'loose'}
              onChange={(v) => setStrictKeyword(v === 'strict')}
              options={[
                { label: '严格关键词（推荐）', value: 'strict' },
                { label: '宽松关键词', value: 'loose' },
              ]}
            />
          </Space>
          <Input.TextArea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入检索词，例如：供应商质量认证体系"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <Space>
            <Button type="primary" loading={searching} onClick={onSearch}>开始检索</Button>
            <Button onClick={loadKnowledgeBases}>刷新知识库</Button>
          </Space>
        </Space>
      </Card>

      {result ? (
        <Card className="app-elevated-card">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color="blue">知识库: {result.kbId}</Tag>
              <Tag color="gold">度量: {result.metric === 'euclidean' ? '欧式距离' : '余弦距离'}</Tag>
              <Tag color="green">结果: {result.results?.length || 0}</Tag>
              <Tag>TopK: {result.topK}</Tag>
            </Space>
            <Text type="secondary">查询词：{result.query}</Text>
            {Array.isArray(result.queryTokens) && result.queryTokens.length > 0 ? (
              <Space size={[6, 6]} wrap>
                {result.queryTokens.map((token) => <Tag key={token}>{token}</Tag>)}
              </Space>
            ) : null}
            <Alert
              type="info"
              showIcon
              message="解释说明"
              description="关键词命中数用于重排参考，不代表最终语义分。若结果偏少，可切换为“宽松关键词”。"
            />
            <Divider style={{ margin: '4px 0' }} />
            <Table
              size="small"
              rowKey="key"
              dataSource={tableData}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: '#', dataIndex: 'rank', width: 64 },
                { title: '文档ID', dataIndex: 'docId', width: 180 },
                { title: '片段序号', dataIndex: 'chunkIndex', width: 90 },
                { title: '关键词命中数', dataIndex: 'tokenHits', width: 108, render: (_, row) => `${row.tokenHits || 0}` },
                { title: '余弦距离(越小越相关)', dataIndex: 'cosineDistance', width: 148, render: (v) => Number(v || 0).toFixed(6) },
                { title: '欧式距离(越小越相关)', dataIndex: 'euclideanDistance', width: 148, render: (v) => Number(v || 0).toFixed(6) },
                {
                  title: '命中文本',
                  dataIndex: 'chunkText',
                  render: (v) => (
                    <div
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        padding: 0,
                        lineHeight: 1.6,
                      }}
                    >
                      <Text>{renderHighlightedText(shortText(v, 280), (result?.queryTokens || []).join(' '))}</Text>
                    </div>
                  ),
                },
              ]}
            />
          </Space>
        </Card>
      ) : null}
    </Space>
  )
}
