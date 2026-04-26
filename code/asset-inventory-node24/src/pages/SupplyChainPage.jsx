import {
  ClearOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
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
  Tree,
  Upload,
  message,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  batchDeleteSupplyChainRecords,
  clearAllSupplyChain,
  createSupplierCrawlTask,
  cancelSupplierCrawlTask,
  deleteSupplyChainRecord,
  fetchCodexModels,
  fetchSupplierCrawlTask,
  fetchSupplyChainRecordDetail,
  fetchSupplyChainRecords,
  fetchSupplyChainTree,
  importSupplierCrawlTask,
  importSupplyChainCsv,
} from '../api/supplyChainApi'
import { CRAWL_SKILL_OPTIONS, DEFAULT_CRAWL_SKILL } from '../constants/crawlSkills'

const { Text } = Typography

function collectDescendantIds(nodes, rootId) {
  const idSet = new Set()
  const walk = (items) => {
    for (const item of items) {
      if (String(item.id) === String(rootId)) {
        const markAll = (node) => {
          idSet.add(String(node.id))
          ;(node.children || []).forEach(markAll)
        }
        markAll(item)
      } else {
        walk(item.children || [])
      }
    }
  }
  walk(nodes || [])
  return idSet
}

function parseUrlsText(input) {
  return [...new Set(
    String(input || '')
      .split(/[\n\r;；]+/g)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//i.test(item)),
  )]
}

function isMeaningfulUrl(urlText) {
  try {
    const u = new URL(String(urlText || '').trim())
    if (!u.search && (u.pathname === '/' || u.pathname === '')) return false
    return true
  } catch {
    return false
  }
}

function collectTreeUrlsByNodeId(nodes, targetId) {
  const urlSet = new Set()
  const walk = (items, matched = false) => {
    for (const item of items || []) {
      const currentMatched = matched || String(item.id) === String(targetId) || String(item.key) === String(targetId)
      if (currentMatched) {
        if (item.nodeUrl && isMeaningfulUrl(item.nodeUrl)) urlSet.add(String(item.nodeUrl))
        if (item.sourceUrl && isMeaningfulUrl(item.sourceUrl)) urlSet.add(String(item.sourceUrl))
      }
      walk(item.children || [], currentMatched)
    }
  }
  walk(nodes || [], false)
  return [...urlSet]
}

function SupplyChainPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [treeData, setTreeData] = useState([])
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [expandedTreeKeys, setExpandedTreeKeys] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [importProgress, setImportProgress] = useState(0)
  const [importing, setImporting] = useState(false)
  const [detailRecord, setDetailRecord] = useState(null)
  const [panelRatio, setPanelRatio] = useState(32)
  const [keyword, setKeyword] = useState('')
  const [parentKeyword, setParentKeyword] = useState('')
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [supplierNode, setSupplierNode] = useState(null)
  const [modelOptions, setModelOptions] = useState([])
  const [selectedModel, setSelectedModel] = useState('gpt-5.4')
  const [selectedSkill, setSelectedSkill] = useState(DEFAULT_CRAWL_SKILL)
  const [supplierUrlsText, setSupplierUrlsText] = useState('')
  const [supplierTask, setSupplierTask] = useState(null)
  const [supplierTaskLoading, setSupplierTaskLoading] = useState(false)
  const [supplierImporting, setSupplierImporting] = useState(false)
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const supplierPollRef = useRef(null)
  const supplierPollBusyRef = useRef(false)
  const supplierTaskSnapshotRef = useRef('')
  const splitRef = useRef(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [list, treeRes] = await Promise.all([
        fetchSupplyChainRecords({ limit: 5000, keyword, parentKeyword }),
        fetchSupplyChainTree({}),
      ])
      setRecords(list)
      setTreeData(treeRes.roots || [])
    } catch (error) {
      message.error(error.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
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
    supplierPollBusyRef.current = false
    supplierTaskSnapshotRef.current = ''
  }, [])

  useEffect(() => {
    if (!Array.isArray(treeData) || treeData.length === 0) return
    setExpandedTreeKeys((prev) => {
      if (prev.length > 0) return prev
      return treeData.map((item) => String(item.key || item.id))
    })
  }, [treeData])

  const filteredRecords = useMemo(() => {
    if (!selectedTreeId) return records
    const descendants = collectDescendantIds(treeData, selectedTreeId)
    if (descendants.size === 0) return records
    return records.filter((item) => descendants.has(String(item.id)))
  }, [records, treeData, selectedTreeId])

  useEffect(() => {
    const total = filteredRecords.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) {
      setTablePage(maxPage)
    }
  }, [filteredRecords.length, tablePage, tablePageSize])

  const selectedTreeNode = useMemo(() => {
    if (!selectedTreeId) return null
    const walk = (items) => {
      for (const item of items || []) {
        if (String(item.id) === String(selectedTreeId) || String(item.key) === String(selectedTreeId)) return item
        const found = walk(item.children || [])
        if (found) return found
      }
      return null
    }
    return walk(treeData)
  }, [treeData, selectedTreeId])

  const openDetail = async (id) => {
    try {
      const detail = await fetchSupplyChainRecordDetail(id)
      setDetailRecord(detail)
    } catch (error) {
      message.error(error.message || '加载详情失败')
    }
  }

  const openEditPage = (record) => {
    const id = Number(record?.id)
    if (!Number.isInteger(id) || id <= 0) {
      message.error('无效记录，无法进入修改页')
      return
    }
    navigate(`/supply-chain/${id}/edit`, {
      state: {
        record: {
          id,
          nodeName: record?.nodeName || '',
          parentId: record?.parentId ?? '',
          parentName: record?.parentName || '',
          nodeLevel: record?.nodeLevel || 1,
          sourceUrl: record?.sourceUrl || '',
        },
      },
    })
  }

  const handleDelete = async (id) => {
    try {
      await deleteSupplyChainRecord(id)
      message.success('删除成功')
      setSelectedRowKeys((prev) => prev.filter((item) => Number(item) !== Number(id)))
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择记录')
      return
    }
    try {
      const result = await batchDeleteSupplyChainRecords(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllSupplyChain()
      message.success(`已清空 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      setSelectedTreeId('')
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const doImport = async () => {
    if (!selectedFile) {
      message.warning('请先选择 CSV 文件')
      return
    }
    setImporting(true)
    setImportProgress(10)
    const timer = setInterval(() => {
      setImportProgress((v) => (v >= 90 ? 90 : v + 10))
    }, 180)
    try {
      const csvText = await selectedFile.text()
      const result = await importSupplyChainCsv({
        fileName: selectedFile.name,
        csvText,
      })
      setImportProgress(100)
      message.success(`导入完成：新建 ${result.insertedNodes || 0} 条，覆盖 ${result.updatedNodes || 0} 条`)
      setImportModalOpen(false)
      setSelectedFile(null)
      await loadData()
    } catch (error) {
      message.error(error.message || '导入失败')
    } finally {
      clearInterval(timer)
      setImporting(false)
      setTimeout(() => setImportProgress(0), 400)
    }
  }

  const openSupplierModalByNode = (node) => {
    const urls = collectTreeUrlsByNodeId(treeData, node?.id || node?.key || '')
    const defaultText = urls.length > 0 ? `${urls.join(';\n')};` : ''
    setSupplierNode(node || null)
    setSupplierUrlsText(defaultText)
    setSupplierTask(null)
    supplierTaskSnapshotRef.current = ''
    setSupplierModalOpen(true)
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
    }, 2200)
  }

  const submitSupplierCrawl = async () => {
    if (!supplierNode?.id) {
      message.warning('请先选择供应链节点')
      return
    }
    const urls = parseUrlsText(supplierUrlsText)
    if (urls.length === 0) {
      message.warning('请填写至少一个 URL')
      return
    }
    setSupplierTaskLoading(true)
    try {
      const created = await createSupplierCrawlTask(supplierNode.id, {
        nodeName: supplierNode.title || supplierNode.nodeName || '',
        urls,
        urlsText: supplierUrlsText,
        model: selectedModel,
        skill: selectedSkill,
      })
      setSupplierTask(created)
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
      message.success(`入库完成：新建 ${result.inserted || 0} 条，覆盖 ${result.updated || 0} 条`)
    } catch (error) {
      message.error(error.message || '入库失败')
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

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 88 },
    { title: '节点名称', dataIndex: 'nodeName' },
    {
      title: '上级节点',
      dataIndex: 'parentId',
      render: (_, record) => (record.parentId ? `${record.parentId} - ${record.parentName || ''}` : '-'),
    },
    { title: '节点层级', dataIndex: 'nodeLevel', width: 90 },
    { title: '来源链接', dataIndex: 'sourceUrl', ellipsis: true },
    {
      title: '操作',
      width: 210,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record.id)}>详情</Button>
          <Button size="small" onClick={() => openEditPage(record)}>修改</Button>
          <Popconfirm title="确认删除该节点吗？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setImportModalOpen(true)}>导入CSV入库</Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate('/supply-chain/new')}>新增</Button>
            <Popconfirm title="确认清空所有供应链节点吗？" okText="清空" cancelText="取消" onConfirm={handleClearAll}>
              <Button danger icon={<ClearOutlined />}>清空所有</Button>
            </Popconfirm>
            <Popconfirm
              title={`确认批量删除已选 ${selectedRowKeys.length} 条记录吗？`}
              okText="删除"
              cancelText="取消"
              onConfirm={handleBatchDelete}
              disabled={selectedRowKeys.length === 0}
            >
              <Button danger disabled={selectedRowKeys.length === 0} icon={<DeleteOutlined />}>批量删除</Button>
            </Popconfirm>
            <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
            <Input.Search
              allowClear
              placeholder="按节点名称/来源链接搜索"
              style={{ width: 260 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={loadData}
            />
            <Input.Search
              allowClear
              placeholder="按上级节点ID/名称搜索"
              style={{ width: 240 }}
              value={parentKeyword}
              onChange={(e) => setParentKeyword(e.target.value)}
              onSearch={loadData}
            />
          </Space>
          <div>当前记录：{filteredRecords.length} 条</div>
        </Space>
      </Card>

      <Card className="app-elevated-card">
        <div ref={splitRef} className="supply-split-wrap">
          <div className="supply-split-left" style={{ width: `${panelRatio}%` }}>
            <Card
              size="small"
              title={(
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>新能源汽车制造供应链</span>
                  <Button
                    size="small"
                    type="primary"
                    disabled={!selectedTreeNode}
                    onClick={() => selectedTreeNode && openSupplierModalByNode(selectedTreeNode)}
                  >
                    获取供应商
                  </Button>
                </Space>
              )}
              bodyStyle={{ padding: 8 }}
            >
              <Tree
                treeData={treeData}
                selectedKeys={selectedTreeId ? [selectedTreeId] : []}
                expandedKeys={expandedTreeKeys}
                onExpand={(keys) => setExpandedTreeKeys(keys.map((key) => String(key)))}
                onSelect={(keys, info) => {
                  const picked = String(keys[0] || '')
                  setSelectedTreeId(picked)

                  const childKeys = (info?.node?.children || []).map((item) => String(item.key || item.id))
                  setExpandedTreeKeys((prev) => {
                    const merged = new Set([...(prev || []), picked, ...childKeys].filter(Boolean))
                    return [...merged]
                  })
                }}
                onRightClick={({ event, node }) => {
                  event.preventDefault()
                  const picked = String(node?.key || node?.id || '')
                  if (picked) {
                    setSelectedTreeId(picked)
                  }
                  openSupplierModalByNode(node)
                }}
                height={620}
              />
            </Card>
          </div>
          <div
            className="supply-split-divider"
            onMouseDown={(event) => {
              event.preventDefault()
              const startX = event.clientX
              const startRatio = panelRatio
              const rect = splitRef.current?.getBoundingClientRect()
              if (!rect) return
              const onMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX
                const next = Math.min(55, Math.max(20, startRatio + (delta / rect.width) * 100))
                setPanelRatio(next)
              }
              const onUp = () => {
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          />
          <div className="supply-split-right">
            <Card size="small" title="供应链信息表" bodyStyle={{ padding: 8 }}>
              <Table
                rowKey="id"
                className="app-data-table"
                columns={columns}
                dataSource={filteredRecords}
                loading={loading}
                rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
                pagination={{
                  current: tablePage,
                  pageSize: tablePageSize,
                  total: filteredRecords.length,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
                  onChange: (page, pageSize) => {
                    setTablePage(page)
                    if (pageSize !== tablePageSize) {
                      setTablePageSize(pageSize)
                    }
                  },
                  onShowSizeChange: (_current, size) => {
                    setTablePage(1)
                    setTablePageSize(size)
                  },
                  position: ['bottomRight'],
                }}
                scroll={{ y: 560 }}
              />
            </Card>
          </div>
        </div>
      </Card>

      <Modal title="导入 CSV 入库" open={importModalOpen} onOk={doImport} onCancel={() => setImportModalOpen(false)} confirmLoading={importing}>
        <Upload
          accept=".csv"
          beforeUpload={(file) => { setSelectedFile(file); return false }}
          fileList={selectedFile ? [selectedFile] : []}
          onRemove={() => { setSelectedFile(null); return true }}
        >
          <Button icon={<CloudUploadOutlined />}>选择 CSV 文件</Button>
        </Upload>
        {importProgress > 0 ? <Progress percent={importProgress} style={{ marginTop: 12 }} /> : null}
      </Modal>

      <Modal
        width={760}
        title={`获取供应商 - ${supplierNode?.title || supplierNode?.nodeName || ''}`}
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
            <Button
              key="close"
              onClick={requestCloseSupplierModal}
            >
              03关闭
            </Button>
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
              URL 以分号结尾。示例：
              {' '}
              `https://www.qcgys.com/category.php?cid=107&pid=130&catid=131;`
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
                    入库结果：新建 {supplierTask.importSummary.inserted || 0} 条，覆盖 {supplierTask.importSummary.updated || 0} 条
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

      <Modal title="供应链节点详情" open={Boolean(detailRecord)} footer={null} onCancel={() => setDetailRecord(null)}>
        {detailRecord ? (
          <Space direction="vertical" size={6}>
            <div>ID：{detailRecord.id}</div>
            <div>节点名称：{detailRecord.nodeName}</div>
            <div>上级节点：{detailRecord.parentId ? `${detailRecord.parentId} - ${detailRecord.parentName || ''}` : '-'}</div>
            <div>节点层级：{detailRecord.nodeLevel}</div>
            <div>来源链接：{detailRecord.sourceUrl || '-'}</div>
            <div>创建时间：{detailRecord.createdAt}</div>
            <div>更新时间：{detailRecord.updatedAt}</div>
          </Space>
        ) : null}
      </Modal>
    </Space>
  )
}

export default SupplyChainPage
