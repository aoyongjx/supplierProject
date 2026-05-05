import { DatabaseOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Slider, Space, Table, Tabs, Tag, Tree, Typography, Upload, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { addKnowledgeBaseText, addKnowledgeBaseWebPage, createKnowledgeBase, deleteKnowledgeBaseDocument, fetchKnowledgeBases, mcpSearch, previewKnowledgeBaseDocument, retryKnowledgeBaseDocument, updateKnowledgeBase, uploadKnowledgeBaseFile } from '../api/knowledgeBaseApi'
import { fetchMcpServices } from '../api/mcpServiceApi'

const { Text, Title } = Typography

const EMBEDDING_MODELS = [
  { label: 'Qwen/Qwen3-VL-Embedding-8B', value: 'Qwen/Qwen3-VL-Embedding-8B' },
  { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
  { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
  { label: 'text-embedding-ada-002', value: 'text-embedding-ada-002' },
]
const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-VL-Embedding-8B'
const SEARCH_TEMPLATES = [
  { label: '自定义', value: 'custom', suffix: '' },
  { label: '新闻动态', value: 'news', suffix: ' 最新 新闻 动态' },
  { label: '财报业绩', value: 'finance', suffix: ' 年报 财报 业绩' },
  { label: '专利技术', value: 'patent', suffix: ' 专利 技术 研发' },
  { label: '供应链客户', value: 'supply', suffix: ' 供应链 客户 合作' },
]
const MCP_SERVICE_DEFAULT_PRIORITY = ['tavily', 'weixin-reader', 'weibo', 'twitter', 'linkedin', 'filesystem']

function statusTag(status = '') {
  const token = String(status || '')
  if (token === 'success') return <Tag color="green">成功</Tag>
  if (token === 'failed') return <Tag color="red">失败</Tag>
  if (token === 'embedding') return <Tag color="gold">向量化中</Tag>
  if (token === 'chunking') return <Tag color="geekblue">分段中</Tag>
  if (token === 'parsing') return <Tag color="cyan">解析中</Tag>
  return <Tag color="default">排队中</Tag>
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const base64 = raw.includes(',') ? raw.split(',').pop() : raw
      resolve(base64 || '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function KnowledgeBaseManagementPage() {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingKbId, setEditingKbId] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('files')
  const [webUrl, setWebUrl] = useState('')
  const [mcpServices, setMcpServices] = useState([])
  const [mcpKeyword, setMcpKeyword] = useState('')
  const [mcpServiceName, setMcpServiceName] = useState('')
  const [searchTemplate, setSearchTemplate] = useState('custom')
  const [mcpOutput, setMcpOutput] = useState('')
  const [mcpSearching, setMcpSearching] = useState(false)
  const [mcpIngesting, setMcpIngesting] = useState(false)
  const [focusDocId, setFocusDocId] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const reload = async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const rows = await fetchKnowledgeBases()
      setItems(rows)
      if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id)
      if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id || '')
    } catch (error) {
      if (!silent) message.error(error.message || '读取知识库失败')
    } finally {
      if (!silent) setRefreshing(false)
    }
  }

  useEffect(() => { reload() }, [])
  useEffect(() => {
    ;(async () => {
      try {
        const rows = await fetchMcpServices()
        setMcpServices(rows)
        const available = (rows || []).filter((item) => item.enabled !== false && item.callable !== false)
        const byPriority = MCP_SERVICE_DEFAULT_PRIORITY
          .map((name) => available.find((item) => String(item.name || '').toLowerCase() === name))
          .find(Boolean)
        const fallback = available[0] || (rows || []).find((item) => item.enabled !== false)
        const defaultServiceName = byPriority?.name || fallback?.name || ''
        if (defaultServiceName) setMcpServiceName(defaultServiceName)
      } catch {
        setMcpServices([])
      }
    })()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => { reload(true) }, 3000)
    return () => clearInterval(timer)
  }, [selectedId])

  useEffect(() => {
    const raw = sessionStorage.getItem('kbFocusDoc')
    if (!raw) return
    try {
      const payload = JSON.parse(raw)
      if (payload?.kbId) setSelectedId(String(payload.kbId))
      if (payload?.docId) setFocusDocId(String(payload.docId))
      if (payload?.sourceType === 'web') setActiveTab('web')
      if (payload?.sourceType === 'file') setActiveTab('files')
      if (payload?.sourceType === 'search') setActiveTab('search')
    } catch {
      // ignore
    } finally {
      sessionStorage.removeItem('kbFocusDoc')
    }
  }, [])

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])
  const onCreate = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const row = await createKnowledgeBase({
        name: String(values.name || '').trim(),
        embeddingModel: values.embeddingModel || '',
        embeddingDimension: Number(values.embeddingDimension || 0) || null,
        topK: Number(values.topK || 10) || 10,
      })
      setOpen(false)
      form.resetFields()
      message.success('知识库已新增，配置已生效')
      await reload(true)
      if (row?.id) setSelectedId(row.id)
    } catch (error) {
      message.error(error.message || '新增知识库失败')
    } finally {
      setSaving(false)
    }
  }

  const onUploadFile = async (file) => {
    if (!selected?.id) {
      message.warning('请先选择知识库')
      return false
    }
    try {
      const contentBase64 = await readAsBase64(file)
      await uploadKnowledgeBaseFile(selected.id, {
        name: file.name,
        mimeType: file.type || '',
        size: Number(file.size || 0),
        contentBase64,
      })
      message.success(`已提交：${file.name}`)
      await reload(true)
    } catch (error) {
      message.error(error.message || `上传失败：${file.name}`)
    }
    return false
  }

  const onOpenEdit = (item, event) => {
    event?.stopPropagation?.()
    setEditingKbId(String(item?.id || ''))
    editForm.setFieldsValue({
      name: item.name || '',
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      embeddingDimension: 1536,
      topK: Number(item.config?.topK || 10) || 10,
    })
    setEditOpen(true)
  }

  const onUpdate = async () => {
    const targetKbId = String(editingKbId || selected?.id || '')
    if (!targetKbId) return
    const values = await editForm.validateFields()
    setEditing(true)
    try {
      await updateKnowledgeBase(targetKbId, {
        name: String(values.name || '').trim(),
        embeddingModel: values.embeddingModel || DEFAULT_EMBEDDING_MODEL,
        embeddingDimension: 1536,
        topK: Number(values.topK || 10) || 10,
      })
      setEditOpen(false)
      setEditingKbId('')
      message.success('知识库已更新')
      await reload(true)
      setSelectedId(targetKbId)
    } catch (error) {
      message.error(error.message || '更新知识库失败')
    } finally {
      setEditing(false)
    }
  }

  const onAddWebPage = async () => {
    if (!selected?.id) return
    const url = String(webUrl || '').trim()
    if (!url) return
    try {
      await addKnowledgeBaseWebPage(selected.id, url)
      setWebUrl('')
      message.success('网页已提交入库')
      await reload(true)
    } catch (error) {
      message.error(error.message || '网页入库失败')
    }
  }

  const onMcpSearch = async () => {
    const rawKeyword = String(mcpKeyword || '').trim()
    const template = SEARCH_TEMPLATES.find((item) => item.value === searchTemplate) || SEARCH_TEMPLATES[0]
    const keyword = `${rawKeyword}${template.suffix || ''}`.trim()
    if (!keyword) return message.warning('请输入检索关键字')
    if (!mcpServiceName) return message.warning('请选择MCP服务')
    setMcpSearching(true)
    try {
      const result = await mcpSearch({ service: mcpServiceName, keyword })
      const line = String(result?.text || '').trim()
      if (!line) return
      setMcpOutput((prev) => (prev ? `${prev}\n${line}` : line))
    } catch (error) {
      message.error(error.message || 'MCP检索失败')
    } finally {
      setMcpSearching(false)
    }
  }

  const onMcpIngest = async () => {
    if (!selected?.id) return message.warning('请先选择知识库')
    const text = String(mcpOutput || '').trim()
    if (!text) return message.warning('没有可入库文本，请先检索')
    setMcpIngesting(true)
    try {
      await addKnowledgeBaseText(selected.id, {
        service: mcpServiceName,
        keyword: mcpKeyword,
        text,
      })
      message.success('已提交入库并开始向量化')
      await reload(true)
    } catch (error) {
      message.error(error.message || '入库失败')
    } finally {
      setMcpIngesting(false)
    }
  }

  const onRetry = async (docId) => {
    if (!selected?.id) return
    try {
      await retryKnowledgeBaseDocument(selected.id, docId)
      message.success('已触发重试')
      await reload(true)
    } catch (error) {
      message.error(error.message || '重试失败')
    }
  }

  const onDeleteDoc = async (docId) => {
    if (!selected?.id) return
    try {
      await deleteKnowledgeBaseDocument(selected.id, docId)
      message.success('已删除')
      await reload(true)
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const onPreviewDoc = async (docId) => {
    if (!selected?.id) return
    setPreviewLoading(true)
    setPreviewOpen(true)
    try {
      const data = await previewKnowledgeBaseDocument(selected.id, docId)
      setPreviewData(data)
    } catch (error) {
      setPreviewData(null)
      message.error(error.message || '预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const treeDataView = items.map((item) => ({
    key: item.id,
    icon: <DatabaseOutlined />,
    isLeaf: true,
    title: (
      <Space size={6}>
        <Text>{item.name}</Text>
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={(event) => onOpenEdit(item, event)}
        />
      </Space>
    ),
  }))

  return (
    <div className="kb-layout">
      <Card className="app-elevated-card kb-tree-pane" styles={{ body: { padding: 12 } }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Button type="text" icon={<PlusOutlined />} onClick={() => setOpen(true)} style={{ justifyContent: 'flex-start' }}>添加</Button>
          <Tree showIcon selectedKeys={selectedId ? [selectedId] : []} treeData={treeDataView} onSelect={(keys) => setSelectedId(String(keys?.[0] || ''))} />
        </Space>
      </Card>

      <Card className="app-elevated-card kb-main-pane" loading={refreshing} styles={{ body: { minHeight: 560 } }}>
        {selected ? (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space size={12} wrap>
              <Title level={4} style={{ margin: 0 }}>{selected.name}</Title>
              <Text className="muted">嵌入模型：{selected.config?.embeddingModel || '未选择'}</Text>
              <Text className="muted">维度：{selected.config?.embeddingDimension || '自动'}</Text>
              <Text className="muted">TopK：{selected.config?.topK || 10}</Text>
            </Space>

            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'files',
                  label: `文件 ${(selected.documents || []).filter((d) => d.sourceType === 'file').length}`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Upload.Dragger multiple beforeUpload={onUploadFile} showUploadList={false}>
                        <p className="ant-upload-drag-icon"><UploadOutlined /></p>
                        <p className="ant-upload-text">拖拽文件到这里，或点击上传</p>
                        <p className="ant-upload-hint" style={{ fontSize: 12 }}>上传后进入：解析 -&gt; 分段 -&gt; 向量化（支持 TXT/MD/HTML/CSV/JSON/XML/PDF）</p>
                      </Upload.Dragger>
                      <Table
                        size="small"
                        rowKey="id"
                        pagination={false}
                        rowClassName={(row) => (row.id === focusDocId ? 'kb-focused-row' : '')}
                        dataSource={(selected.documents || []).filter((d) => d.sourceType === 'file')}
                        columns={[
                          { title: '文件', dataIndex: 'name' },
                          { title: '状态', dataIndex: 'status', width: 120, render: (v) => statusTag(v) },
                          { title: '状态说明', dataIndex: 'errorMessage', width: 220, render: (v, row) => <Text type={v ? 'danger' : 'secondary'}>{v || (row.status === 'success' ? '处理完成' : '-')}</Text> },
                          { title: '分段', dataIndex: 'chunkCount', width: 90 },
                          { title: '向量', dataIndex: 'vectorCount', width: 90 },
                          {
                            title: '操作',
                            width: 220,
                            render: (_, row) => (
                              <Space>
                                {row.status === 'failed' ? (
                                  <Button size="small" icon={<ReloadOutlined />} onClick={() => onRetry(row.id)}>重试</Button>
                                ) : null}
                                <Button size="small" danger onClick={() => onDeleteDoc(row.id)}>删除</Button>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </Space>
                  ),
                },
                {
                  key: 'web',
                  label: `网页 ${(selected.documents || []).filter((d) => d.sourceType === 'web').length}`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="输入网页 URL，例如：https://example.com/page" prefix={<LinkOutlined />} />
                        <Button type="primary" onClick={onAddWebPage}>添加网页</Button>
                      </Space.Compact>
                      <Table
                        size="small"
                        rowKey="id"
                        tableLayout="fixed"
                        pagination={false}
                        rowClassName={(row) => (row.id === focusDocId ? 'kb-focused-row' : '')}
                        dataSource={(selected.documents || []).filter((d) => d.sourceType === 'web')}
                        columns={[
                          {
                            title: '网页',
                            dataIndex: 'url',
                            width: '58%',
                            ellipsis: true,
                            render: (v) => <Text ellipsis={{ tooltip: v }} style={{ display: 'block', maxWidth: '100%' }}>{v}</Text>,
                          },
                          { title: '状态', dataIndex: 'status', width: 120, render: (v) => statusTag(v) },
                          { title: '状态说明', dataIndex: 'errorMessage', width: 220, render: (v, row) => <Text type={v ? 'danger' : 'secondary'}>{v || (row.status === 'success' ? '处理完成' : '-')}</Text> },
                          { title: '分段', dataIndex: 'chunkCount', width: 90 },
                          { title: '向量', dataIndex: 'vectorCount', width: 90 },
                          {
                            title: '操作',
                            width: 260,
                            render: (_, row) => (
                              <Space>
                                <Button size="small" onClick={() => onPreviewDoc(row.id)}>预览</Button>
                                {row.status === 'failed' ? (
                                  <Button size="small" icon={<ReloadOutlined />} onClick={() => onRetry(row.id)}>重试</Button>
                                ) : null}
                                <Button size="small" danger onClick={() => onDeleteDoc(row.id)}>删除</Button>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </Space>
                  ),
                },
                {
                  key: 'search',
                  label: `搜索 ${(selected.documents || []).filter((d) => d.sourceType === 'search').length}`,
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={mcpKeyword}
                          onChange={(e) => setMcpKeyword(e.target.value)}
                          placeholder="检索关键字"
                          style={{ width: '36%' }}
                        />
                        <Select
                          value={searchTemplate}
                          onChange={setSearchTemplate}
                          style={{ width: '18%' }}
                          options={SEARCH_TEMPLATES.map((item) => ({ label: item.label, value: item.value }))}
                        />
                        <Select
                          value={mcpServiceName || undefined}
                          onChange={setMcpServiceName}
                          placeholder="选择MCP服务"
                          style={{ width: '22%' }}
                          options={(mcpServices || []).filter((item) => item.enabled !== false).map((item) => {
                            const name = String(item.name || '').toLowerCase()
                            const exaDisabled = name === 'exa'
                            return ({
                              label: exaDisabled
                                ? `${item.name}（已禁用）`
                                : (item.callable === false ? `${item.name}（不可用）` : item.name),
                            value: item.name,
                            disabled: item.callable === false || exaDisabled,
                            title: item.callableReason || '',
                            })
                          })}
                        />
                        <Button loading={mcpSearching} onClick={onMcpSearch}>检索</Button>
                        <Button type="primary" loading={mcpIngesting} disabled={!String(mcpOutput || '').trim()} onClick={onMcpIngest}>入库+向量化</Button>
                      </Space.Compact>
                      <Input.TextArea
                        value={mcpOutput}
                        onChange={(e) => setMcpOutput(e.target.value)}
                        placeholder="检索结果会不断追加到这里"
                        autoSize={{ minRows: 4, maxRows: 12 }}
                      />
                      <Table
                        size="small"
                        rowKey="id"
                        pagination={false}
                        rowClassName={(row) => (row.id === focusDocId ? 'kb-focused-row' : '')}
                        dataSource={(selected.documents || []).filter((d) => d.sourceType === 'search')}
                        columns={[
                          { title: '搜索记录', dataIndex: 'name' },
                          { title: '状态', dataIndex: 'status', width: 120, render: (v) => statusTag(v) },
                          { title: '状态说明', dataIndex: 'errorMessage', width: 220, render: (v, row) => <Text type={v ? 'danger' : 'secondary'}>{v || (row.status === 'success' ? '处理完成' : '-')}</Text> },
                          { title: '分段', dataIndex: 'chunkCount', width: 90 },
                          { title: '向量', dataIndex: 'vectorCount', width: 90 },
                          {
                            title: '操作',
                            width: 220,
                            render: (_, row) => (
                              <Space>
                                <Button size="small" onClick={() => onPreviewDoc(row.id)}>预览</Button>
                                {row.status === 'failed' ? (
                                  <Button size="small" icon={<ReloadOutlined />} onClick={() => onRetry(row.id)}>重试</Button>
                                ) : null}
                                <Button size="small" danger onClick={() => onDeleteDoc(row.id)}>删除</Button>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        ) : <Empty description="暂无知识库" />}
      </Card>

      <Modal title="添加知识库" open={open} onCancel={() => setOpen(false)} onOk={onCreate} okText="确认" cancelText="取消" confirmLoading={saving}>
        <Form form={form} layout="vertical" initialValues={{ embeddingModel: DEFAULT_EMBEDDING_MODEL, topK: 10 }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="名称" /></Form.Item>
          <Form.Item label="嵌入模型" name="embeddingModel"><Select placeholder="未选择模型" options={EMBEDDING_MODELS} /></Form.Item>
          <Form.Item label="嵌入维度" name="embeddingDimension" initialValue={1536}><InputNumber min={1536} max={1536} style={{ width: '100%' }} disabled /></Form.Item>
          <Form.Item label="请求文档片段数量" name="topK"><Slider min={1} max={50} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="修改知识库" open={editOpen} onCancel={() => { setEditOpen(false); setEditingKbId('') }} onOk={onUpdate} okText="确认" cancelText="取消" confirmLoading={editing}>
        <Form form={editForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="名称" /></Form.Item>
          <Form.Item label="嵌入模型" name="embeddingModel"><Select placeholder="未选择模型" options={EMBEDDING_MODELS} /></Form.Item>
          <Form.Item label="嵌入维度" name="embeddingDimension" initialValue={1536}><InputNumber min={1536} max={1536} style={{ width: '100%' }} disabled /></Form.Item>
          <Form.Item label="请求文档片段数量" name="topK"><Slider min={1} max={50} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="网页预览"
        open={previewOpen}
        width={900}
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}
        onCancel={() => setPreviewOpen(false)}
      >
        {previewLoading ? <Text>加载中...</Text> : (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text strong>{previewData?.name || '-'}</Text>
            <Text type="secondary" ellipsis={{ tooltip: previewData?.url || '' }} style={{ maxWidth: '100%' }}>
              {previewData?.url || ''}
            </Text>
            <Text type="secondary">状态：{previewData?.status || '-'}</Text>
            <Card size="small" title="正文预览（抓取后）">
              <div style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {previewData?.previewText || '暂无预览内容'}
              </div>
            </Card>
            <Card size="small" title="分段预览（前8段）">
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {(previewData?.chunks || []).length === 0 ? (
                  <Text type="secondary">暂无分段记录</Text>
                ) : (previewData.chunks || []).map((item) => (
                  <div key={`${item.chunkIndex}`} style={{ marginBottom: 10 }}>
                    <Text strong>#{item.chunkIndex}</Text>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{item.chunkText}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Space>
        )}
      </Modal>
    </div>
  )
}
