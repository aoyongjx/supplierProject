import { Button, Card, Col, Input, List, Modal, Row, Space, Table, Tag, Typography, message } from 'antd'
import { useMemo, useState } from 'react'
import { chatPreciseSourcingAgent } from '../api/agentApi'

const { Text, Title } = Typography

export default function PreciseSourcingAgentPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState([])
  const [lastRun, setLastRun] = useState(null)
  const [selectedKbHit, setSelectedKbHit] = useState(null)

  const runAgent = async () => {
    const text = String(input || '').trim()
    if (!text) {
      message.warning('请输入寻源需求')
      return
    }
    setLoading(true)
    try {
      const data = await chatPreciseSourcingAgent({ message: text })
      const nextMessages = [
        ...messages,
        { role: 'user', content: text, ts: Date.now() },
        { role: 'assistant', content: data?.answer || '未返回内容', ts: Date.now() + 1 },
      ]
      setMessages(nextMessages)
      setLastRun(data)
      setInput('')
    } catch (error) {
      message.error(error.message || '执行失败')
    } finally {
      setLoading(false)
    }
  }

  const reactLoopItems = useMemo(() => (
    (lastRun?.traces || []).map((item, idx) => ({
      key: `${item.step || 'step'}-${idx}`,
      round: idx + 1,
      type: String(item.step || '').startsWith('think')
        ? 'Thought'
        : String(item.step || '').startsWith('act')
          ? 'Action'
          : String(item.step || '').startsWith('observe')
            ? 'Observation'
            : 'Plan',
      title: item.title || item.step || '-',
      detail: item.detail || '-',
    }))
  ), [lastRun])

  const reactRounds = useMemo(() => {
    const fromServer = Array.isArray(lastRun?.react?.rounds) ? lastRun.react.rounds : []
    if (fromServer.length > 0) return fromServer
    const rounds = []
    let current = null
    reactLoopItems.forEach((item) => {
      if (!current || item.type === 'Thought' || item.type === 'Plan') {
        current = {
          id: rounds.length + 1,
          thought: null,
          action: null,
          observation: null,
          extras: [],
        }
        rounds.push(current)
      }
      if (item.type === 'Thought' || item.type === 'Plan') current.thought = item
      else if (item.type === 'Action') current.action = item
      else if (item.type === 'Observation') current.observation = item
      else current.extras.push(item)
    })
    return rounds
  }, [reactLoopItems])

  const supplierRows = Array.isArray(lastRun?.evidence?.suppliers) ? lastRun.evidence.suppliers : []
  const kbRows = Array.isArray(lastRun?.evidence?.kbHits) ? lastRun.evidence.kbHits : []

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>精准寻源智能体（LangGraph + RAG + DB Tools）</Title>
          <Text type="secondary">对话输入需求，智能体将按“需求解析 → DB检索 → RAG检索 → LLM综合输出”的流程执行，并展示全过程。</Text>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="例如：寻找有储能系统集成经验、具备 IATF16949 认证、华东可配套的供应商"
          />
          <Space>
            <Button type="primary" loading={loading} onClick={runAgent}>发送并执行</Button>
          </Space>
        </Space>
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card className="app-elevated-card" title="对话记录">
            <List
              dataSource={messages}
              locale={{ emptyText: '暂无对话' }}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text strong>{item.role === 'user' ? '你' : '精准寻源智能体'}</Text>
                    <Text>{item.content}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card className="app-elevated-card" title="最终答复" style={{ marginBottom: 16 }}>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
              {String(lastRun?.answer || '暂无答复')}
            </div>
          </Card>
          <Card className="app-elevated-card" title="执行过程">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {reactRounds.length > 0 ? (
                <List
                  size="small"
                  bordered
                  dataSource={reactRounds}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Space>
                          <Tag color="blue">Round {item.id}</Tag>
                          <Tag color="purple">Thought</Tag>
                          <Text>{item.thought?.detail || item.thought?.title || '—'}</Text>
                        </Space>
                        <Space>
                          <Tag color="cyan">Action</Tag>
                          <Text>{item.action?.detail || item.action?.title || '—'}</Text>
                        </Space>
                        <Space>
                          <Tag color="gold">Observation</Tag>
                          <Text type="secondary">{item.observation?.detail || item.observation?.title || '—'}</Text>
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : <Text type="secondary">暂无执行过程</Text>}
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card className="app-elevated-card" title={<Space><span>DB 证据</span><Tag>{supplierRows.length}</Tag></Space>}>
            <Table
              size="small"
              rowKey={(row, idx) => `${row.id || row.source_url || 's'}-${idx}`}
              pagination={{ pageSize: 5 }}
              dataSource={supplierRows}
              columns={[
                { title: '名称', dataIndex: 'name', render: (v) => v || '-' },
                { title: '来源URL', dataIndex: 'source_url', render: (v) => <Text type="secondary">{v || '-'}</Text> },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card className="app-elevated-card" title={<Space><span>RAG 证据</span><Tag>{kbRows.length}</Tag></Space>}>
            <Table
              size="small"
              rowKey={(row, idx) => `${row.docId || 'k'}-${row.chunkIndex || idx}`}
              pagination={{ pageSize: 5 }}
              dataSource={kbRows}
              scroll={{ y: 360, x: 960 }}
              locale={{ emptyText: '暂无 RAG 证据' }}
              onRow={(record) => ({
                onClick: () => setSelectedKbHit(record),
                style: { cursor: 'pointer' },
              })}
              columns={[
                { title: '文档', dataIndex: 'docName', width: 180, render: (_, row) => row.docName || row.docId || '-' },
                { title: '余弦距离', dataIndex: 'cosineDistance', width: 120, render: (v) => Number(v || 0).toFixed(4) },
                {
                  title: '命中文本摘要',
                  dataIndex: 'snippetPreview',
                  render: (_, row) => (
                    <Text type="secondary">
                      {String(row.snippetPreview || row.chunkText || '').slice(0, 140) || '-'}
                    </Text>
                  ),
                },
                {
                  title: '操作',
                  width: 88,
                  render: (_, row) => <Button size="small" onClick={(e) => { e.stopPropagation(); setSelectedKbHit(row) }}>详情</Button>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Modal
        title="RAG 证据详情"
        open={Boolean(selectedKbHit)}
        onCancel={() => setSelectedKbHit(null)}
        onOk={() => setSelectedKbHit(null)}
        width={900}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap>
            <Tag color="blue">{selectedKbHit?.docName || selectedKbHit?.docId || '未知文档'}</Tag>
            <Tag>片段 #{Number(selectedKbHit?.chunkIndex || 0)}</Tag>
            <Tag color="green">余弦距离 {Number(selectedKbHit?.cosineDistance || 0).toFixed(4)}</Tag>
          </Space>
          <Text>{selectedKbHit?.docUrl || '无来源链接'}</Text>
          <Card size="small" title="命中全文">
            <div style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
              {selectedKbHit?.chunkText || '-'}
            </div>
          </Card>
        </Space>
      </Modal>
    </Space>
  )
}
