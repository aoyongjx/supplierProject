import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Card, Input, List, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  batchDeleteSuppliers,
  cancelSupplierCrawlTask,
  clearAllSuppliers,
  createSupplierSourceCrawlTask,
  deleteSupplier,
  fetchCodexModels,
  fetchSupplierCrawlTask,
  fetchSuppliers,
  importSupplierCrawlTask,
} from '../api/supplierApi'
import { CRAWL_SKILL_OPTIONS, DEFAULT_CRAWL_SKILL } from '../constants/crawlSkills'

const { Title, Text } = Typography

function SupplierListPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [records, setRecords] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [supplierTask, setSupplierTask] = useState(null)
  const [supplierTaskLoading, setSupplierTaskLoading] = useState(false)
  const [supplierImporting, setSupplierImporting] = useState(false)
  const [supplierUrlsText, setSupplierUrlsText] = useState('')
  const [modelOptions, setModelOptions] = useState([])
  const [selectedModel, setSelectedModel] = useState('gpt-5.4')
  const [selectedSkill, setSelectedSkill] = useState(DEFAULT_CRAWL_SKILL)
  const [collectMode, setCollectMode] = useState('selected')
  const [supplierUrlNodeMeta, setSupplierUrlNodeMeta] = useState([])
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const supplierPollRef = useRef(null)
  const supplierPollBusyRef = useRef(false)
  const supplierTaskSnapshotRef = useRef('')

  const loadData = async (nextKeyword = keyword) => {
    try {
      setLoading(true)
      const data = await fetchSuppliers({ limit: 5000, keyword: nextKeyword })
      setRecords((data || []).map((item) => ({ ...item, key: item.id })))
      setSelectedRowKeys((prev) => prev.filter((id) => data.some((item) => Number(item.id) === Number(id))))
    } catch (error) {
      message.error(error.message || '加载供应商失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [])

  useEffect(() => {
    const loadSelections = async () => {
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
    loadSelections()
  }, [])

  useEffect(() => () => {
    if (supplierPollRef.current) {
      clearInterval(supplierPollRef.current)
      supplierPollRef.current = null
    }
  }, [])

  useEffect(() => {
    const total = records.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [records.length, tablePage, tablePageSize])

  const handleDelete = async (id) => {
    try {
      await deleteSupplier(id)
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteSuppliers(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllSuppliers()
      message.success(`已清空供应商信息来源，共 ${result?.deletedCount || 0} 条`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const parseUrlsText = (input) => [...new Set(
    String(input || '')
      .split(/[\n\r;；]+/g)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//i.test(item)),
  )]

  const isMeaningfulUrl = (urlText) => {
    try {
      const u = new URL(String(urlText || '').trim())
      if (!u.search && (u.pathname === '/' || u.pathname === '')) return false
      return true
    } catch {
      return false
    }
  }

  const normalizeListUrl = (urlText) => {
    try {
      const u = new URL(String(urlText || '').trim())
      if (!u.pathname.includes('category.php')) return ''
      // 列表抓取会自动翻页，这里移除页码避免重复任务
      u.searchParams.delete('page')
      return u.toString()
    } catch {
      return ''
    }
  }

  const normalizeAnyUrl = (urlText) => {
    try {
      const u = new URL(String(urlText || '').trim())
      return u.toString()
    } catch {
      return ''
    }
  }

  const isLikelyDetailUrl = (urlText) => {
    try {
      const u = new URL(String(urlText || '').trim())
      const lowerPath = String(u.pathname || '').toLowerCase()
      if (lowerPath.includes('company.php') || lowerPath.includes('supplier') || lowerPath.includes('detail')) return true
      if (u.searchParams.get('mid')) return true
      return false
    } catch {
      return false
    }
  }

  const collectUrlsFromRows = (rows, mode = 'selected') => {
    const set = new Set()
    for (const row of rows || []) {
      if (mode === 'selected') {
        const detailUrl = normalizeAnyUrl(row?.detailUrl)
        if (detailUrl && isLikelyDetailUrl(detailUrl)) {
          set.add(detailUrl)
          continue
        }
        const listUrl = normalizeListUrl(row?.listPageUrl)
        if (listUrl) {
          set.add(listUrl)
          continue
        }
        const fallback = normalizeListUrl(row?.sourceUrl)
        if (fallback) set.add(fallback)
      } else {
        const listUrl = normalizeListUrl(row?.listPageUrl)
        if (listUrl) {
          set.add(listUrl)
          continue
        }
        const fallback = normalizeListUrl(row?.sourceUrl)
        if (fallback) set.add(fallback)
      }
    }
    const urls = [...set].filter((url) => isMeaningfulUrl(url))
    return urls
  }

  const collectUrlNodeMetaFromRows = (rows, mode = 'selected') => {
    const map = new Map()
    for (const row of rows || []) {
      const pushMeta = (rawUrl) => {
        const normalized = mode === 'all' ? normalizeListUrl(rawUrl) : normalizeAnyUrl(rawUrl)
        if (!normalized || !isMeaningfulUrl(normalized)) return
        map.set(normalized, {
          url: normalized,
          nodeId: row?.nodeId || null,
          nodeName: row?.nodeName || '',
          sourceUrl: row?.sourceUrl || '',
        })
      }
      if (mode === 'selected') {
        const detailUrl = normalizeAnyUrl(row?.detailUrl)
        if (detailUrl && isLikelyDetailUrl(detailUrl)) {
          pushMeta(detailUrl)
          continue
        }
        pushMeta(row?.listPageUrl)
        pushMeta(row?.sourceUrl)
      } else {
        pushMeta(row?.listPageUrl)
        pushMeta(row?.sourceUrl)
      }
    }
    return [...map.values()]
  }

  const pollSupplierTask = (taskId) => {
    if (supplierPollRef.current) {
      clearInterval(supplierPollRef.current)
      supplierPollRef.current = null
    }
    supplierPollRef.current = setInterval(async () => {
      if (supplierPollBusyRef.current) return
      supplierPollBusyRef.current = true
      try {
        const latest = await fetchSupplierCrawlTask(taskId)
        const snapshot = [
          latest?.status || '',
          latest?.progress || 0,
          latest?.processedUrls || 0,
          latest?.totalUrls || 0,
          latest?.totalRows || 0,
          Array.isArray(latest?.runLogs) ? latest.runLogs.length : 0,
          latest?.downloadUrl || '',
        ].join('|')
        if (snapshot !== supplierTaskSnapshotRef.current) {
          supplierTaskSnapshotRef.current = snapshot
          setSupplierTask(latest)
        }
        if (latest.status === 'done' || latest.status === 'failed' || latest.status === 'cancelled') {
          clearInterval(supplierPollRef.current)
          supplierPollRef.current = null
          supplierPollBusyRef.current = false
          if (latest.status === 'done') {
            message.success(`供应商抓取完成，共 ${latest.totalRows || 0} 条`)
          } else if (latest.status === 'cancelled') {
            message.warning('抓取任务已取消')
          } else {
            message.error(latest.errorMessage || '抓取失败')
          }
        }
      } catch (error) {
        clearInterval(supplierPollRef.current)
        supplierPollRef.current = null
        supplierPollBusyRef.current = false
        if (String(error?.message || '').includes('任务不存在')) {
          setSupplierTask(null)
          message.warning('抓取任务状态已失效（可能服务重启或路由切换），请重新提交抓取。')
          return
        }
        message.error(error.message || '获取任务进度失败')
      } finally {
        supplierPollBusyRef.current = false
      }
    }, 2000)
  }

  const openSupplierModal = (mode) => {
    const selectedIdSet = new Set(selectedRowKeys.map((item) => Number(item)))
    const targetRows = mode === 'all'
      ? records
      : records.filter((row) => selectedIdSet.has(Number(row.id)))
    if (mode === 'selected' && targetRows.length === 0) {
      message.warning('请先在列表勾选要获取的记录')
      return
    }
    const urls = collectUrlsFromRows(targetRows, mode)
    const urlMeta = collectUrlNodeMetaFromRows(targetRows, mode)
    setCollectMode(mode)
    setSupplierUrlsText(urls.length > 0 ? `${urls.join(';\n')};` : '')
    setSupplierUrlNodeMeta(urlMeta)
    setSupplierTask(null)
    supplierTaskSnapshotRef.current = ''
    setSupplierTaskLoading(false)
    setSupplierImporting(false)
    setSupplierModalOpen(true)
  }

  const submitSupplierCrawl = async () => {
    const rawUrls = parseUrlsText(supplierUrlsText)
    const urls = collectMode === 'all'
      ? [...new Set(rawUrls.map((item) => normalizeListUrl(item)).filter(Boolean))]
      : [...new Set(rawUrls.map((item) => normalizeAnyUrl(item)).filter((item) => isMeaningfulUrl(item)))]
    if (urls.length === 0) {
      if (collectMode === 'all') {
        message.warning('请填写至少一个有效的分类列表 URL（category.php）')
      } else {
        message.warning('请填写至少一个有效 URL')
      }
      return
    }
    setSupplierTaskLoading(true)
    try {
      const created = await createSupplierSourceCrawlTask({
        nodeName: collectMode === 'all' ? '供应商信息来源（全部）' : '供应商信息来源',
        urls,
        urlsText: supplierUrlsText,
        urlNodeMeta: supplierUrlNodeMeta,
        model: selectedModel,
        skill: selectedSkill,
      })
      setSupplierTask(created)
      supplierTaskSnapshotRef.current = ''
      pollSupplierTask(created.taskId)
      message.info('任务已创建，正在抓取供应商信息...')
    } catch (error) {
      message.error(error.message || '提交抓取任务失败')
    } finally {
      setSupplierTaskLoading(false)
    }
  }

  const submitSupplierImport = async () => {
    if (!supplierTask?.taskId) {
      message.warning('请先完成抓取')
      return
    }
    setSupplierImporting(true)
    try {
      const result = await importSupplierCrawlTask(supplierTask.taskId)
      setSupplierTask((prev) => (prev ? { ...prev, imported: true, importSummary: result } : prev))
      message.success(`入库完成：来源新建 ${result.inserted || 0} 条，来源覆盖 ${result.updated || 0} 条，档案新建 ${result.profileInserted || 0} 条，档案覆盖 ${result.profileUpdated || 0} 条`)
      await loadData()
    } catch (error) {
      if (String(error?.message || '').includes('任务不存在')) {
        setSupplierTask(null)
        message.warning('任务已失效，无法入库，请重新提交抓取后再入库。')
      } else {
        message.error(error.message || '入库失败')
      }
    } finally {
      setSupplierImporting(false)
    }
  }

  const forceCloseSupplierModal = () => {
    setSupplierModalOpen(false)
    if (supplierPollRef.current) {
      clearInterval(supplierPollRef.current)
      supplierPollRef.current = null
    }
    supplierPollBusyRef.current = false
    supplierTaskSnapshotRef.current = ''
    setSupplierUrlNodeMeta([])
  }

  const requestCloseSupplierModal = () => {
    const status = String(supplierTask?.status || '')
    const running = ['pending', 'running', 'cancelling'].includes(status)
    if (!running || !supplierTask?.taskId) {
      forceCloseSupplierModal()
      return
    }
    Modal.confirm({
      title: '关闭将结束当前抓取任务',
      content: '任务会停止执行。确认关闭并结束任务吗？',
      okText: '结束任务并关闭',
      cancelText: '继续抓取',
      onOk: async () => {
        try {
          await cancelSupplierCrawlTask(supplierTask.taskId)
          message.success('已发送结束任务指令')
        } catch (error) {
          message.error(error.message || '结束任务失败')
        } finally {
          forceCloseSupplierModal()
        }
      },
    })
  }

  const columns = useMemo(
    () => [
      { title: '供应商名称', dataIndex: 'companyName', width: 220, ellipsis: true },
      { title: '备注', dataIndex: 'remark', ellipsis: true },
      { title: '供应链节点名称', dataIndex: 'nodeName', width: 180, ellipsis: true },
      {
        title: '详情链接',
        dataIndex: 'detailUrl',
        width: 260,
        render: (value) => (value
          ? <a href={value} target="_blank" rel="noreferrer">{value}</a>
          : <Text type="secondary">-</Text>
        ),
      },
      {
        title: '本页URL',
        dataIndex: 'listPageUrl',
        width: 280,
        render: (value) => (value
          ? <a href={value} target="_blank" rel="noreferrer">{value}</a>
          : <Text type="secondary">-</Text>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (_, record) => (
          <Space size={2}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/suppliers/${record.id}/edit`)}>
              修改
            </Button>
            <Popconfirm title="确认删除该供应商吗？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [navigate],
  )

  return (
    <Card className="app-elevated-card">
      <Space className="page-titlebar">
        <Space>
          <span className="title-icon">
            <TeamOutlined />
          </span>
          <Title level={3} style={{ margin: 0 }}>
            供应商信息来源
          </Title>
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="按供应商/节点/产品搜索"
            style={{ width: 260 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
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
            title={`确认清空全部供应商信息来源吗？当前共 ${records.length} 条`}
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/suppliers/new')}>
            新增
          </Button>
          <Button onClick={() => openSupplierModal('selected')}>
            获取供应商档案（选中）
          </Button>
          <Button onClick={() => openSupplierModal('all')}>
            获取供应商档案（All）
          </Button>
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
          current: tablePage,
          pageSize: tablePageSize,
          total: records.length,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          onChange: (page, pageSize) => {
            setTablePage(page)
            if (pageSize !== tablePageSize) setTablePageSize(pageSize)
          },
          onShowSizeChange: (_current, size) => {
            setTablePage(1)
            setTablePageSize(size)
          },
          position: ['bottomRight'],
        }}
      />

      <Modal
        width={760}
        title="获取供应商 - 供应商信息来源"
        open={supplierModalOpen}
        closable={false}
        keyboard={false}
        maskClosable={false}
        onCancel={requestCloseSupplierModal}
        footer={(
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button key="submit" type="primary" loading={supplierTaskLoading} onClick={submitSupplierCrawl}>
              01提交抓取
            </Button>
            <Button
              key="import"
              type="default"
              disabled={supplierTask?.status !== 'done'}
              loading={supplierImporting}
              onClick={submitSupplierImport}
            >
              02提交入库
            </Button>
            <Button key="close" onClick={requestCloseSupplierModal}>03关闭</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <div style={{ minWidth: 300 }}>
              <Text className="muted">模型</Text>
              <Select
                style={{ width: '100%' }}
                value={selectedModel}
                options={(modelOptions.length > 0 ? modelOptions : ['gpt-5.4']).map((item) => ({ label: item, value: item }))}
                onChange={setSelectedModel}
              />
            </div>
            <div style={{ minWidth: 300 }}>
              <Text className="muted">数据爬取技能</Text>
              <Select
                style={{ width: '100%' }}
                value={selectedSkill}
                options={CRAWL_SKILL_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                onChange={setSelectedSkill}
              />
            </div>
          </Space>

          <div>
            <Text className="muted">URL 信息（多行）</Text>
            <Input.TextArea
              rows={5}
              value={supplierUrlsText}
              onChange={(e) => setSupplierUrlsText(e.target.value)}
              placeholder="请输入 URL 列表"
            />
            <Text type="secondary">
              URL 以分号结尾。示例：`https://www.qcgys.com/category.php?cid=107&pid=130&catid=131;`
            </Text>
          </div>

          {supplierTask ? (
            <Card size="small" className="app-elevated-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Progress percent={supplierTask.progress || 0} />
                <Space wrap>
                  <Tag color={supplierTask.status === 'done' ? 'success' : supplierTask.status === 'failed' ? 'error' : 'processing'}>
                    状态：{supplierTask.status}
                  </Tag>
                  <Tag>URL 进度：{supplierTask.processedUrls || 0}/{supplierTask.totalUrls || 0}</Tag>
                  <Tag>已抓取：{supplierTask.totalRows || 0} 条 / 共 {supplierTask.estimatedTotalRows || supplierTask.totalRows || 0} 条</Tag>
                </Space>
                {supplierTask.downloadUrl ? (
                  <a href={supplierTask.downloadUrl} target="_blank" rel="noreferrer">
                    <DownloadOutlined />
                    {' '}
                    下载供应商 CSV
                  </a>
                ) : null}
                {supplierTask.importSummary ? (
                  <Text type="success">
                    入库结果：来源新建 {supplierTask.importSummary.inserted || 0} 条，来源覆盖 {supplierTask.importSummary.updated || 0} 条，档案新建 {supplierTask.importSummary.profileInserted || 0} 条，档案覆盖 {supplierTask.importSummary.profileUpdated || 0} 条
                  </Text>
                ) : null}
                <List
                  size="small"
                  bordered
                  dataSource={supplierTask.runLogs || []}
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

export default SupplierListPage
