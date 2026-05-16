import { Button, Card, Col, Form, Input, List, Modal, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import {
  deleteLlmWikiEntry,
  fetchLlmWikiEntries,
  fetchLlmWikiSettings,
  saveLlmWikiEntry,
  saveLlmWikiSettings,
} from '../api/llmWikiApi'

const { Title, Text } = Typography

function WikiLibraryView() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeEntry, setActiveEntry] = useState(null)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchLlmWikiEntries()
      .then((rows) => {
        if (!alive) return
        const list = Array.isArray(rows) ? rows : []
        setEntries(list)
        setActiveEntry(list[0] || null)
      })
      .catch((error) => {
        message.error(error?.message || '加载Wiki词条失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])
  const filtered = useMemo(() => {
    const kw = String(keyword || '').trim().toLowerCase()
    if (!kw) return entries
    return entries.filter((item) => `${item.title} ${item.category} ${item.content}`.toLowerCase().includes(kw))
  }, [entries, keyword])

  return (
    <Row gutter={12}>
      <Col span={7}>
        <Card className="app-elevated-card" title="词条目录">
          <Input.Search
            allowClear
            placeholder="搜索企业/产品/认证/专题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <List
            style={{ marginTop: 12 }}
            bordered
            loading={loading}
            dataSource={filtered}
            renderItem={(item) => (
              <List.Item
                onClick={() => setActiveEntry(item)}
                style={{ cursor: 'pointer', background: activeEntry?.key === item.key ? '#f0f9ff' : '#fff' }}
              >
                <Space direction="vertical" size={2}>
                  <Text strong>{item.title}</Text>
                  <Text type="secondary">{item.category}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col span={11}>
        <Card className="app-elevated-card" title={activeEntry?.title || '词条详情'}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div>
              <Tag color={activeEntry?.status === '已确认' ? 'green' : 'gold'}>{activeEntry?.status || '-'}</Tag>
              <Tag>{activeEntry?.category || '-'}</Tag>
            </div>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{activeEntry?.content || '请选择词条查看内容。'}</Text>
            <Space>
              <Button type="primary">基于本词条继续问</Button>
              <Button>查看来源</Button>
            </Space>
          </Space>
        </Card>
      </Col>
      <Col span={6}>
        <Card className="app-elevated-card" title="词条信息">
          <Space direction="vertical" size={8}>
            <Text>更新时间：{activeEntry?.updatedAt || '-'}</Text>
            <Text>来源数量：{activeEntry?.sourceCount || 0}</Text>
            <Text>状态：{activeEntry?.status || '-'}</Text>
          </Space>
        </Card>
      </Col>
    </Row>
  )
}

function WikiManageView() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const loadEntries = () => {
    setLoading(true)
    fetchLlmWikiEntries()
      .then((rows) => setEntries(Array.isArray(rows) ? rows : []))
      .catch((error) => message.error(error?.message || '加载词条失败'))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    loadEntries()
  }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    form.setFieldsValue(row)
    setOpen(true)
  }
  const removeRow = (row) => {
    deleteLlmWikiEntry(row.key)
      .then(() => {
        message.success('词条已删除')
        loadEntries()
      })
      .catch((error) => message.error(error?.message || '删除失败'))
  }
  const saveRow = async () => {
    const values = await form.validateFields()
    const payload = editing ? { ...editing, ...values } : { ...values, sourceCount: 1 }
    saveLlmWikiEntry(payload)
      .then(() => {
        message.success(editing ? '词条已更新' : '词条已新增')
        setOpen(false)
        loadEntries()
      })
      .catch((error) => message.error(error?.message || '保存失败'))
  }

  return (
    <Card
      className="app-elevated-card"
      title="Wiki管理"
      extra={<Button type="primary" onClick={openCreate}>新建词条</Button>}
    >
      <Table
        rowKey="key"
        loading={loading}
        dataSource={entries}
        pagination={false}
        columns={[
          { title: '词条名', dataIndex: 'title', key: 'title' },
          { title: '分类', dataIndex: 'category', key: 'category' },
          { title: '状态', dataIndex: 'status', key: 'status' },
          { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt' },
          {
            title: '操作',
            key: 'actions',
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => openEdit(row)}>修改</Button>
                <Button size="small" danger onClick={() => removeRow(row)}>删除</Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? '修改词条' : '新建词条'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={saveRow}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical" form={form}>
          <Form.Item label="词条名" name="title" rules={[{ required: true, message: '请输入词条名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="分类" name="category" rules={[{ required: true, message: '请选择分类' }]}>
            <Select options={[{ label: '企业库', value: '企业库' }, { label: '产品库', value: '产品库' }, { label: '认证库', value: '认证库' }, { label: '专题', value: '专题' }]} />
          </Form.Item>
          <Form.Item label="状态" name="status" initialValue="待确认">
            <Select options={[{ label: '已确认', value: '已确认' }, { label: '待确认', value: '待确认' }]} />
          </Form.Item>
          <Form.Item label="内容" name="content">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

function WikiSettingsView() {
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState({
    enabled: true,
    wikiFirst: true,
    autoWriteback: true,
    db: true,
    rag: true,
    web: false,
    onlyConfirmed: false,
  })
  useEffect(() => {
    setLoading(true)
    fetchLlmWikiSettings()
      .then((cfg) => setSettings(cfg))
      .catch((error) => message.error(error?.message || '加载配置失败'))
      .finally(() => setLoading(false))
  }, [])

  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }))

  return (
    <Card className="app-elevated-card" title="LLM-Wiki 配置">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Row justify="space-between"><Text>启用 LLM-Wiki</Text><Switch checked={settings.enabled} onChange={(v) => update('enabled', v)} /></Row>
        <Row justify="space-between"><Text>查询优先使用 Wiki</Text><Switch checked={settings.wikiFirst} onChange={(v) => update('wikiFirst', v)} /></Row>
        <Row justify="space-between"><Text>自动回写 Wiki（DB/RAG/WEB）</Text><Switch checked={settings.autoWriteback} onChange={(v) => update('autoWriteback', v)} /></Row>
        <Row justify="space-between"><Text>DB 回写</Text><Switch checked={settings.db} onChange={(v) => update('db', v)} /></Row>
        <Row justify="space-between"><Text>RAG 回写</Text><Switch checked={settings.rag} onChange={(v) => update('rag', v)} /></Row>
        <Row justify="space-between"><Text>WEB 回写</Text><Switch checked={settings.web} onChange={(v) => update('web', v)} /></Row>
        <Row justify="space-between"><Text>仅显示已确认词条</Text><Switch checked={settings.onlyConfirmed} onChange={(v) => update('onlyConfirmed', v)} /></Row>
        <Button
          type="primary"
          loading={loading}
          onClick={() => {
            setLoading(true)
            saveLlmWikiSettings(settings)
              .then((next) => {
                setSettings(next)
                message.success('配置已保存')
              })
              .catch((error) => message.error(error?.message || '保存配置失败'))
              .finally(() => setLoading(false))
          }}
        >
          保存配置
        </Button>
      </Space>
    </Card>
  )
}

export default function LlmWikiPage({ view = 'library' }) {
  const titleMap = {
    library: 'LLM-Wiki / Wiki库',
    manage: 'LLM-Wiki / Wiki管理',
    settings: 'LLM-Wiki / 配置',
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Title level={4} style={{ margin: 0 }}>{titleMap[view] || 'LLM-Wiki'}</Title>
        <Text type="secondary">与 Karpathy LLM-Wiki 模式对齐：Raw → Compiled Wiki → Schema。</Text>
      </Card>
      {view === 'library' ? <WikiLibraryView /> : null}
      {view === 'manage' ? <WikiManageView /> : null}
      {view === 'settings' ? <WikiSettingsView /> : null}
    </Space>
  )
}
