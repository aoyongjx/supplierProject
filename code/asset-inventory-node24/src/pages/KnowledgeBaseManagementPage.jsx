import { DatabaseOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Slider, Space, Table, Tabs, Tag, Tree, Typography, Upload, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { addKnowledgeBaseWebPage, createKnowledgeBase, deleteKnowledgeBaseDocument, fetchKnowledgeBases, retryKnowledgeBaseDocument, updateKnowledgeBase, uploadKnowledgeBaseFile } from '../api/knowledgeBaseApi'

const { Text, Title } = Typography

const EMBEDDING_MODELS = [
  { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
  { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
  { label: 'text-embedding-ada-002', value: 'text-embedding-ada-002' },
]

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
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('files')
  const [webUrl, setWebUrl] = useState('')
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
    const timer = setInterval(() => { reload(true) }, 3000)
    return () => clearInterval(timer)
  }, [selectedId])

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
    editForm.setFieldsValue({
      name: item.name || '',
      embeddingModel: item.config?.embeddingModel || '',
      embeddingDimension: 1536,
      topK: Number(item.config?.topK || 10) || 10,
    })
    setEditOpen(true)
  }

  const onUpdate = async () => {
    if (!selected?.id) return
    const values = await editForm.validateFields()
    setEditing(true)
    try {
      await updateKnowledgeBase(selected.id, {
        name: String(values.name || '').trim(),
        embeddingModel: values.embeddingModel || '',
        embeddingDimension: 1536,
        topK: Number(values.topK || 10) || 10,
      })
      setEditOpen(false)
      message.success('知识库已更新')
      await reload(true)
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
                        pagination={false}
                        dataSource={(selected.documents || []).filter((d) => d.sourceType === 'web')}
                        columns={[
                          { title: '网页', dataIndex: 'url', render: (v) => <Text ellipsis={{ tooltip: v }}>{v}</Text> },
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
              ]}
            />
          </Space>
        ) : <Empty description="暂无知识库" />}
      </Card>

      <Modal title="添加知识库" open={open} onCancel={() => setOpen(false)} onOk={onCreate} okText="确认" cancelText="取消" confirmLoading={saving}>
        <Form form={form} layout="vertical" initialValues={{ embeddingModel: '', topK: 10 }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="名称" /></Form.Item>
          <Form.Item label="嵌入模型" name="embeddingModel"><Select allowClear placeholder="未选择模型" options={EMBEDDING_MODELS} /></Form.Item>
          <Form.Item label="嵌入维度" name="embeddingDimension" initialValue={1536}><InputNumber min={1536} max={1536} style={{ width: '100%' }} disabled /></Form.Item>
          <Form.Item label="请求文档片段数量" name="topK"><Slider min={1} max={50} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="修改知识库" open={editOpen} onCancel={() => setEditOpen(false)} onOk={onUpdate} okText="确认" cancelText="取消" confirmLoading={editing}>
        <Form form={editForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="名称" /></Form.Item>
          <Form.Item label="嵌入模型" name="embeddingModel"><Select allowClear placeholder="未选择模型" options={EMBEDDING_MODELS} /></Form.Item>
          <Form.Item label="嵌入维度" name="embeddingDimension" initialValue={1536}><InputNumber min={1536} max={1536} style={{ width: '100%' }} disabled /></Form.Item>
          <Form.Item label="请求文档片段数量" name="topK"><Slider min={1} max={50} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
