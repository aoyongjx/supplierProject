import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import {
  batchDeleteGasOems,
  cancelGasOemSyncTask,
  clearAllGasOems,
  createGasOem,
  createGasOemSyncTask,
  deleteGasOem,
  fetchCodexModels,
  fetchGasOemDetail,
  fetchGasOemSyncTask,
  fetchGasOems,
  importGasOemSyncTask,
  updateGasOem,
} from '../api/gasOemApi'

const { Title, Text } = Typography

const MODE_OPTIONS = [
  { label: '增量', value: 'incremental' },
  { label: '全量', value: 'full' },
]

const WEB_ACCESS_OPTION = [{ label: 'web-access', value: 'web-access' }]
const DEFAULT_SYNC_URL = 'https://i.gasgoo.com/supplier/oem.html'

function parseUrlsText(input) {
  return [...new Set(
    String(input || '')
      .split(/[\n\r;；]+/g)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//i.test(item)),
  )]
}

function GasOemListPage() {
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [records, setRecords] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorMode, setEditorMode] = useState('create')
  const [editId, setEditId] = useState(null)
  const [form] = Form.useForm()

  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [syncTaskLoading, setSyncTaskLoading] = useState(false)
  const [syncImporting, setSyncImporting] = useState(false)
  const [syncTask, setSyncTask] = useState(null)
  const [syncUrlsText, setSyncUrlsText] = useState(DEFAULT_SYNC_URL)
  const [selectedModel, setSelectedModel] = useState('gpt-5.4')
  const [modelOptions, setModelOptions] = useState(['gpt-5.4'])
  const [selectedMode, setSelectedMode] = useState('full')

  const syncPollRef = useRef(null)
  const syncPollBusyRef = useRef(false)
  const syncTaskSnapshotRef = useRef('')

  const loadData = async (nextKeyword = keyword) => {
    setLoading(true)
    try {
      const data = await fetchGasOems({ limit: 5000, keyword: nextKeyword })
      const safeData = Array.isArray(data) ? data : []
      setRecords(safeData)
      setSelectedRowKeys((prev) => prev.filter((id) => safeData.some((item) => Number(item.id) === Number(id))))
    } catch (error) {
      message.error(error.message || '加载GAS整车厂失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [])

  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await fetchCodexModels()
        if (models.length > 0) {
          setModelOptions(models)
          setSelectedModel(models[0])
        }
      } catch {
        setModelOptions(['gpt-5.4'])
      }
    }
    loadModels()
  }, [])

  useEffect(() => () => {
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current)
      syncPollRef.current = null
    }
    syncPollBusyRef.current = false
    syncTaskSnapshotRef.current = ''
  }, [])

  const openCreate = () => {
    setEditorMode('create')
    setEditId(null)
    form.resetFields()
    setEditorOpen(true)
  }

  const openView = async (id) => {
    setEditorMode('view')
    setEditId(id)
    setEditorLoading(true)
    setEditorOpen(true)
    try {
      const detail = await fetchGasOemDetail(id)
      form.setFieldsValue({
        oemName: detail.oemName || '',
        brand: detail.brand || '',
        vehicleModel: detail.vehicleModel || '',
        region: detail.region || '',
        registeredCapital: detail.registeredCapital || '',
        website: detail.website || '',
      })
    } catch (error) {
      message.error(error.message || '加载详情失败')
      setEditorOpen(false)
    } finally {
      setEditorLoading(false)
    }
  }

  const openEdit = async (id) => {
    setEditorMode('edit')
    setEditId(id)
    setEditorLoading(true)
    setEditorOpen(true)
    try {
      const detail = await fetchGasOemDetail(id)
      form.setFieldsValue({
        oemName: detail.oemName || '',
        brand: detail.brand || '',
        vehicleModel: detail.vehicleModel || '',
        region: detail.region || '',
        registeredCapital: detail.registeredCapital || '',
        website: detail.website || '',
      })
    } catch (error) {
      message.error(error.message || '加载详情失败')
      setEditorOpen(false)
    } finally {
      setEditorLoading(false)
    }
  }

  const submitEditor = async () => {
    if (editorMode === 'view') {
      setEditorOpen(false)
      return
    }
    try {
      const values = await form.validateFields()
      setEditorLoading(true)
      if (editorMode === 'create') {
        await createGasOem(values)
        message.success('新增成功')
      } else {
        await updateGasOem(editId, values)
        message.success('修改成功')
      }
      setEditorOpen(false)
      await loadData()
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '保存失败')
    } finally {
      setEditorLoading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteGasOem(id)
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteGasOems(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllGasOems()
      message.success(`已清空 GAS整车厂，共 ${result?.deletedCount || 0} 条`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const openSyncModal = () => {
    setSyncTask(null)
    syncTaskSnapshotRef.current = ''
    setSyncTaskLoading(false)
    setSyncImporting(false)
    setSelectedMode('full')
    setSyncUrlsText(DEFAULT_SYNC_URL)
    setSyncModalOpen(true)
  }

  const pollSyncTask = (taskId) => {
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current)
      syncPollRef.current = null
    }
    syncPollRef.current = setInterval(async () => {
      if (syncPollBusyRef.current) return
      syncPollBusyRef.current = true
      try {
        const latest = await fetchGasOemSyncTask(taskId)
        const snapshot = [
          latest?.status || '',
          latest?.progress || 0,
          latest?.processedUrls || 0,
          latest?.totalUrls || 0,
          latest?.totalRows || 0,
          Array.isArray(latest?.runLogs) ? latest.runLogs.length : 0,
          latest?.downloadUrl || '',
        ].join('|')
        if (snapshot !== syncTaskSnapshotRef.current) {
          syncTaskSnapshotRef.current = snapshot
          setSyncTask(latest)
        }
        if (latest.status === 'done' || latest.status === 'failed' || latest.status === 'cancelled') {
          clearInterval(syncPollRef.current)
          syncPollRef.current = null
          if (latest.status === 'done') {
            message.success(`同步完成，共抓取 ${latest.totalRows || 0} 条`)
          } else if (latest.status === 'cancelled') {
            message.warning('同步任务已取消')
          } else {
            message.error(latest.errorMessage || '同步失败')
          }
        }
      } catch (error) {
        const errorMessage = String(error?.message || '')
        if (errorMessage.includes('任务不存在')) {
          clearInterval(syncPollRef.current)
          syncPollRef.current = null
          setSyncTask(null)
          message.warning('任务状态已失效，请重新提交同步。')
          return
        }
        if (/failed to fetch|networkerror|econnrefused/i.test(errorMessage)) {
          return
        }
        clearInterval(syncPollRef.current)
        syncPollRef.current = null
        message.error(errorMessage || '获取同步进度失败')
      } finally {
        syncPollBusyRef.current = false
      }
    }, 2200)
  }

  const submitSync = async () => {
    const urls = parseUrlsText(syncUrlsText)
    if (urls.length === 0) {
      message.warning('请填写至少一个有效 URL')
      return
    }
    setSyncTaskLoading(true)
    try {
      const created = await createGasOemSyncTask({
        urlsText: syncUrlsText,
        urls,
        model: selectedModel,
        skill: 'web-access',
        mode: selectedMode,
      })
      setSyncTask(created)
      syncTaskSnapshotRef.current = ''
      pollSyncTask(created.taskId)
      message.info('任务已创建，正在同步GAS整车厂...')
    } catch (error) {
      message.error(error.message || '提交同步任务失败')
    } finally {
      setSyncTaskLoading(false)
    }
  }

  const importSync = async () => {
    if (!syncTask?.taskId) {
      message.warning('请先完成抓取')
      return
    }
    setSyncImporting(true)
    try {
      const result = await importGasOemSyncTask(syncTask.taskId)
      setSyncTask((prev) => (prev ? { ...prev, imported: true, importSummary: result } : prev))
      message.success(`入库完成：新建 ${result.inserted || 0} 条，覆盖 ${result.updated || 0} 条`)
      await loadData()
    } catch (error) {
      message.error(error.message || '入库失败')
    } finally {
      setSyncImporting(false)
    }
  }

  const requestCloseSyncModal = () => {
    const status = String(syncTask?.status || '')
    const running = ['pending', 'running', 'cancelling'].includes(status)
    if (!running || !syncTask?.taskId) {
      setSyncModalOpen(false)
      return
    }
    Modal.confirm({
      title: '关闭将结束当前同步',
      content: '任务会停止执行。确认关闭并结束当前同步流程吗？',
      okText: '结束任务并关闭',
      cancelText: '继续同步',
      onOk: async () => {
        try {
          await cancelGasOemSyncTask(syncTask.taskId)
          message.success('已发送结束任务指令')
        } catch (error) {
          message.error(error.message || '结束任务失败')
        } finally {
          setSyncModalOpen(false)
          if (syncPollRef.current) {
            clearInterval(syncPollRef.current)
            syncPollRef.current = null
          }
          syncPollBusyRef.current = false
          syncTaskSnapshotRef.current = ''
        }
      },
    })
  }

  const columns = [
    { title: '车企名称', dataIndex: 'oemName', width: 220, ellipsis: true },
    { title: '品牌', dataIndex: 'brand', width: 180, ellipsis: true },
    { title: '所在地', dataIndex: 'region', width: 160, ellipsis: true },
    { title: '注册资金', dataIndex: 'registeredCapital', width: 160, ellipsis: true },
    {
      title: '操作',
      width: 210,
      render: (_, row) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openView(row.id)}>查看</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row.id)}>修改</Button>
          <Popconfirm title="确认删除该记录吗？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(row.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Card className="app-elevated-card">
      <Space className="page-titlebar">
        <Space>
          <Title level={3} style={{ margin: 0 }}>GAS整车厂</Title>
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="按车企名称/品牌/车型/所在地搜索"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(value) => {
              const next = String(value || '').trim()
              setKeyword(next)
              loadData(next)
            }}
          />
          <Popconfirm
            title={`确认批量删除已选 ${selectedRowKeys.length} 条记录吗？`}
            okText="删除"
            cancelText="取消"
            onConfirm={handleBatchDelete}
            disabled={selectedRowKeys.length === 0}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
              批量删除
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`确认清空全部 GAS整车厂吗？当前共 ${records.length} 条`}
            description="该操作不可恢复。"
            okText="清空全部"
            cancelText="取消"
            onConfirm={handleClearAll}
            disabled={records.length === 0}
          >
            <Button danger disabled={records.length === 0}>
              清空所有
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<SyncOutlined />} onClick={openSyncModal}>同步</Button>
          <Button icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        </Space>
      </Space>

      <Table
        className="app-data-table"
        rowKey="id"
        loading={loading}
        dataSource={records}
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          position: ['bottomRight'],
        }}
      />

      <Modal
        title={editorMode === 'create' ? '新增GAS整车厂' : editorMode === 'edit' ? '修改GAS整车厂' : '查看GAS整车厂'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={submitEditor}
        okText={editorMode === 'view' ? '关闭' : '保存'}
        confirmLoading={editorLoading}
      >
        <Form form={form} layout="vertical" disabled={editorMode === 'view' || editorLoading}>
          <Form.Item name="oemName" label="车企名称" rules={[{ required: true, message: '请输入车企名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input />
          </Form.Item>
          <Form.Item name="vehicleModel" label="车型">
            <Input />
          </Form.Item>
          <Form.Item name="region" label="所在地">
            <Input />
          </Form.Item>
          <Form.Item name="registeredCapital" label="注册资金">
            <Input />
          </Form.Item>
          <Form.Item name="website" label="URL">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        width={760}
        title="同步GAS整车厂"
        open={syncModalOpen}
        closable={false}
        keyboard={false}
        maskClosable={false}
        onCancel={requestCloseSyncModal}
        footer={(
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button key="submit" type="primary" loading={syncTaskLoading} onClick={submitSync}>01提交抓取</Button>
            <Button key="import" disabled={syncTask?.status !== 'done'} loading={syncImporting} onClick={importSync}>02提交入库</Button>
            <Button key="close" onClick={requestCloseSyncModal}>03关闭</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <div style={{ minWidth: 220 }}>
              <Text className="muted">模型</Text>
              <Select
                style={{ width: '100%' }}
                value={selectedModel}
                options={modelOptions.map((item) => ({ label: item, value: item }))}
                onChange={setSelectedModel}
              />
            </div>
            <div style={{ minWidth: 220 }}>
              <Text className="muted">数据爬取技能</Text>
              <Select style={{ width: '100%' }} value="web-access" options={WEB_ACCESS_OPTION} disabled />
            </div>
            <div style={{ minWidth: 180 }}>
              <Text className="muted">同步模式</Text>
              <Select style={{ width: '100%' }} value={selectedMode} options={MODE_OPTIONS} onChange={setSelectedMode} />
            </div>
          </Space>
          <div>
            <Text className="muted">URL 信息（多行）</Text>
            <Input.TextArea rows={5} value={syncUrlsText} onChange={(e) => setSyncUrlsText(e.target.value)} placeholder="请输入 URL 列表" />
            <Text type="secondary">{`默认值：\`${DEFAULT_SYNC_URL}\``}</Text>
          </div>
          {syncTask ? (
            <Card size="small" className="app-elevated-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Progress percent={syncTask.progress || 0} />
                <Space wrap>
                  <Tag color={syncTask.status === 'done' ? 'success' : syncTask.status === 'failed' ? 'error' : syncTask.status === 'cancelled' ? 'default' : 'processing'}>
                    状态：{syncTask.status}
                  </Tag>
                  <Tag>模式：{selectedMode === 'full' ? '全量' : '增量'}</Tag>
                  <Tag>URL 进度：{syncTask.processedUrls || 0}/{syncTask.totalUrls || 0}</Tag>
                  <Tag>已抓取：{syncTask.totalRows || 0} 条</Tag>
                </Space>
                {syncTask.downloadUrl ? (
                  <a href={syncTask.downloadUrl} target="_blank" rel="noreferrer">
                    <DownloadOutlined />
                    {' '}
                    下载GAS整车厂 CSV
                  </a>
                ) : null}
                {syncTask.importSummary ? (
                  <Text type="success">
                    入库结果：新建 {syncTask.importSummary.inserted || 0} 条，覆盖 {syncTask.importSummary.updated || 0} 条
                  </Text>
                ) : null}
                <List
                  size="small"
                  bordered
                  dataSource={syncTask.runLogs || []}
                  renderItem={(line) => <List.Item>{line}</List.Item>}
                  style={{ maxHeight: 180, overflowY: 'auto' }}
                />
              </Space>
            </Card>
          ) : null}
        </Space>
      </Modal>
    </Card>
  )
}

export default GasOemListPage
