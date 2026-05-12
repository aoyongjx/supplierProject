import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
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
  message,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  cancelSupplierCrawlTask,
  executeCrawlEnvActions,
  fetchSupplierCrawlTask,
  importSupplierCrawlTask,
  precheckCrawlEnvironment,
} from '../api/supplyChainApi'
import { createSupplierSourceCrawlTask } from '../api/supplierApi'
import { fetchCodexModels } from '../api/supplyChainApi'
import {
  batchDeleteGASSupplyChainRecords,
  cancelGASSupplyChainSyncTask,
  clearAllGASSupplyChain,
  createGASSupplyChainSyncTask,
  deleteGASSupplyChainRecord,
  fetchGASSupplyChainSyncTask,
  fetchGASSupplyChainRecordDetail,
  fetchGASSupplyChainRecords,
  fetchGASSupplyChainTree,
  importGASSupplyChainSyncTask,
} from '../api/gasSupplyChainApi'
import { CRAWL_SKILL_OPTIONS, DEFAULT_CRAWL_SKILL } from '../constants/crawlSkills'

const { Text } = Typography

const GASGOO_DEFAULT_URL = 'https://i.gasgoo.com/supplier/c-301.html'
const MODE_OPTIONS = [
  { label: '增量', value: 'incremental' },
  { label: '全量', value: 'full' },
]
const WEB_ACCESS_OPTION = [{ label: 'web-access', value: 'web-access' }]
const DEFAULT_ENV_PRECHECK_STEPS = []
const WEB_ACCESS_BOOTSTRAP_STEPS = [
  'web-access 启动：',
  'node "C:\\Users\\aoyon\\.codex\\skills\\web-access\\scripts\\check-deps.mjs"',
  'curl.exe --noproxy "*" http://localhost:3456/targets',
  'Chrome 保持打开 https://i.gasgoo.com/supplier/oem.html（不要关）。',
  'Edge 打开系统页 http://localhost:5173/gas-oems。',
  '点 同步 -> 01提交抓取。',
]
const MIN_COLUMN_WIDTHS = {
  id: 64,
  nodeName: 116,
  parentNode: 128,
  nodeLevel: 68,
  syncedSupplierCount: 92,
  syncedAt: 136,
  actions: 176,
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
    return Boolean(u.hostname)
  } catch {
    return false
  }
}

function collectDescendantIds(nodes, rootId) {
  const idSet = new Set()
  const walk = (items) => {
    for (const item of items || []) {
      if (String(item.id) === String(rootId) || String(item.key) === String(rootId)) {
        const mark = (node) => {
          idSet.add(String(node.id || node.key))
          ;(node.children || []).forEach(mark)
        }
        mark(item)
      } else {
        walk(item.children || [])
      }
    }
  }
  walk(nodes)
  return idSet
}

function normalizeEnvPrecheckPayload(payload = {}, fallbackError = '') {
  const checks = Array.isArray(payload?.checks)
    ? payload.checks
      .map((item) => ({
        name: String(item?.name || ''),
        ready: item?.ready !== false,
        message: String(item?.message || '').trim(),
      }))
      .filter((item) => item.message)
    : []
  const steps = Array.isArray(payload?.steps)
    ? payload.steps.map((item) => String(item || '').trim()).filter(Boolean)
    : DEFAULT_ENV_PRECHECK_STEPS
  const ready = payload?.ready === true
  const summary = ready
    ? '环境检测通过，可执行抓取。'
    : (String(payload?.hint || '').trim() || fallbackError || '环境未就绪，请先按步骤处理。')
  return { ready, checks, steps, summary }
}

function GASSupplyChainPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [treeData, setTreeData] = useState([])
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [expandedTreeKeys, setExpandedTreeKeys] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [detailRecord, setDetailRecord] = useState(null)
  const [panelRatio, setPanelRatio] = useState(24)
  const [keyword, setKeyword] = useState('')
  const [parentKeyword, setParentKeyword] = useState('')
  const [syncModalOpen, setSyncModalOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState(['gpt-5.4'])
  const [selectedModel, setSelectedModel] = useState('gpt-5.4')
  const [selectedMode, setSelectedMode] = useState('full')
  const [syncUrlsText, setSyncUrlsText] = useState(GASGOO_DEFAULT_URL)
  const [syncTask, setSyncTask] = useState(null)
  const [syncTaskLoading, setSyncTaskLoading] = useState(false)
  const [syncImporting, setSyncImporting] = useState(false)
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [supplierNode, setSupplierNode] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState(DEFAULT_CRAWL_SKILL)
  const [supplierUrlsText, setSupplierUrlsText] = useState('')
  const [supplierTask, setSupplierTask] = useState(null)
  const [supplierTaskLoading, setSupplierTaskLoading] = useState(false)
  const [supplierImporting, setSupplierImporting] = useState(false)
  const [envPrecheckLoading, setEnvPrecheckLoading] = useState(false)
  const [envExecuteLoading, setEnvExecuteLoading] = useState(false)
  const [envPrecheckResult, setEnvPrecheckResult] = useState(null)
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const [columnWidths, setColumnWidths] = useState({})
  const splitRef = useRef(null)
  const syncPollRef = useRef(null)
  const syncPollBusyRef = useRef(false)
  const syncTaskSnapshotRef = useRef('')
  const supplierPollRef = useRef(null)
  const supplierPollBusyRef = useRef(false)
  const supplierTaskSnapshotRef = useRef('')
  const loadData = async (nextKeyword = keyword, nextParentKeyword = parentKeyword) => {
    setLoading(true)
    try {
      const [list, treeRes] = await Promise.all([
        fetchGASSupplyChainRecords({ limit: 5000, keyword: nextKeyword, parentKeyword: nextParentKeyword }),
        fetchGASSupplyChainTree(),
      ])
      setRecords((list || []).map((item) => ({ ...item, key: item.id, syncedSupplierCount: Number(item.syncedSupplierCount || 0) })))
      setTreeData(treeRes.roots || [])
      setSelectedRowKeys((prev) => prev.filter((id) => list.some((item) => Number(item.id) === Number(id))))
      setExpandedTreeKeys((prev) => (prev.length > 0 ? prev : (treeRes.roots || []).map((item) => String(item.key || item.id))))
    } catch (error) {
      message.error(error.message || '加载 GAS 供应链失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('', '')
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
    if (supplierPollRef.current) {
      clearInterval(supplierPollRef.current)
      supplierPollRef.current = null
    }
    syncPollBusyRef.current = false
    syncTaskSnapshotRef.current = ''
    supplierPollBusyRef.current = false
    supplierTaskSnapshotRef.current = ''
  }, [])

  const filteredRecords = useMemo(() => {
    if (!selectedTreeId) return records
    const descendants = collectDescendantIds(treeData, selectedTreeId)
    if (descendants.size === 0) return records
    return records.filter((item) => descendants.has(String(item.id)))
  }, [records, treeData, selectedTreeId])

  useEffect(() => {
    const total = filteredRecords.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
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

  const openCreatePage = () => {
    navigate('/gas-supply-chain/new')
  }

  const openEditPage = (record) => {
    const id = Number(record?.id)
    if (!Number.isInteger(id) || id <= 0) {
      message.error('无效记录，无法进入修改页')
      return
    }
    navigate(`/gas-supply-chain/${id}/edit`, {
      state: {
        record: {
          id,
          nodeName: record?.nodeName || '',
          parentId: record?.parentId ?? '',
          parentName: record?.parentName || '',
          nodeLevel: record?.nodeLevel || 1,
          sourceUrl: record?.sourceSiteUrl || record?.sourceUrl || '',
          syncedSupplierCount: Number(record?.syncedSupplierCount || 0),
        },
      },
    })
  }

  const handleDelete = async (id) => {
    try {
      await deleteGASSupplyChainRecord(id)
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteGASSupplyChainRecords(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllGASSupplyChain()
      message.success(`已清空 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      setSelectedTreeId('')
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const openSyncModal = () => {
    setSyncTask(null)
    syncTaskSnapshotRef.current = ''
    setSyncUrlsText(GASGOO_DEFAULT_URL)
    setSelectedMode('full')
    setSyncTaskLoading(false)
    setSyncImporting(false)
    setSyncModalOpen(true)
  }

  const resolveSupplierNodeUrl = (node) => {
    return [node?.nodeUrl, node?.sourceUrl].find((item) => isMeaningfulUrl(item)) || ''
  }

  const resolveSupplierTargetUrl = (node, urlsText) => {
    const nodeUrl = resolveSupplierNodeUrl(node)
    if (nodeUrl) return nodeUrl
    const typedUrls = parseUrlsText(urlsText)
    return typedUrls[0] || ''
  }

  const openSupplierModalByNode = (node) => {
    const resolvedUrl = resolveSupplierNodeUrl(node)
    setSupplierNode(node || null)
    setSupplierUrlsText(resolvedUrl ? `${resolvedUrl}` : '')
    setSupplierTask(null)
    setSupplierTaskLoading(false)
    setSupplierImporting(false)
    setEnvPrecheckResult(null)
    supplierTaskSnapshotRef.current = ''
    setSupplierModalOpen(true)
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
        const latest = await fetchGASSupplyChainSyncTask(taskId)
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
          syncPollBusyRef.current = false
          if (latest.status === 'done') {
            message.success(`GAS 供应链抓取完成，共 ${latest.totalRows || 0} 条节点`)
          } else if (latest.status === 'cancelled') {
            message.warning('GAS 供应链任务已取消')
          } else {
            message.error(latest.errorMessage || 'GAS 供应链抓取失败')
          }
        }
      } catch (error) {
        clearInterval(syncPollRef.current)
        syncPollRef.current = null
        syncPollBusyRef.current = false
        if (String(error?.message || '').includes('任务不存在')) {
          setSyncTask(null)
          message.warning('任务状态已失效（可能服务重启或路由切换），请重新提交抓取。')
          return
        }
        message.error(error.message || '获取 GAS 供应链任务进度失败')
      } finally {
        syncPollBusyRef.current = false
      }
    }, 2200)
  }

  const handleSubmitSync = async () => {
    const urlsText = String(syncUrlsText || '').trim()
    if (!urlsText) {
      message.warning('请填写至少一个 URL')
      return
    }
    setSyncTaskLoading(true)
    try {
      const created = await createGASSupplyChainSyncTask({
        urlsText,
        model: selectedModel,
        skill: 'web-access',
        mode: selectedMode,
      })
      setSyncTask(created)
      syncTaskSnapshotRef.current = ''
      pollSyncTask(created.taskId)
      message.info('任务已创建，正在抓取 GAS 供应链节点...')
    } catch (error) {
      message.error(error.message || '提交 GAS 供应链抓取任务失败')
    } finally {
      setSyncTaskLoading(false)
    }
  }

  const handleImportSync = async () => {
    if (!syncTask?.taskId) {
      message.warning('请先完成抓取')
      return
    }
    setSyncImporting(true)
    try {
      const result = await importGASSupplyChainSyncTask(syncTask.taskId)
      setSyncTask((current) => current ? { ...current, imported: true, importSummary: result } : current)
      message.success(`入库完成：新建 ${result.inserted || 0} 条，覆盖 ${result.updated || 0} 条，合计 ${result.updatedNodes || 0} 条`)
      await loadData()
    } catch (error) {
      if (String(error?.message || '').includes('任务不存在')) {
        setSyncTask(null)
        message.warning('任务已失效，无法入库，请重新提交抓取后再入库。')
      } else {
        message.error(error.message || '入库失败')
      }
    } finally {
      setSyncImporting(false)
    }
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

  const runSupplierEnvPrecheck = async ({ silentSuccess = false } = {}) => {
    const targetUrl = resolveSupplierTargetUrl(supplierNode, supplierUrlsText)
    setEnvPrecheckLoading(true)
    try {
      const raw = await precheckCrawlEnvironment({ skill: selectedSkill, targetUrl })
      const normalized = normalizeEnvPrecheckPayload(raw)
      setEnvPrecheckResult(normalized)
      if (normalized.ready) {
        if (!silentSuccess) message.success('抓取环境检测通过')
      } else {
        message.warning('抓取环境未就绪，请先按步骤处理')
      }
      return normalized
    } catch (error) {
      const normalized = normalizeEnvPrecheckPayload(
        {
          ready: false,
          checks: [{ name: 'precheck-error', ready: false, message: `环境预检失败：${error.message || 'unknown error'}` }],
          steps: DEFAULT_ENV_PRECHECK_STEPS,
        },
        '环境预检异常，请先按步骤检查后再抓取。',
      )
      setEnvPrecheckResult(normalized)
      message.warning('环境预检异常，请先按步骤检查')
      return normalized
    } finally {
      setEnvPrecheckLoading(false)
    }
  }

  const runSupplierEnvExecute = async () => {
    const targetUrl = resolveSupplierTargetUrl(supplierNode, supplierUrlsText)
    if (!targetUrl) {
      message.warning('当前节点未配置有效 URL，请先选择节点或填写 URL')
      return
    }
    setEnvExecuteLoading(true)
    try {
      const result = await executeCrawlEnvActions({ skill: selectedSkill, targetUrl })
      const actionLines = Array.isArray(result?.actions) ? result.actions : []
      for (const action of actionLines) {
        if (action?.success) {
          message.success(String(action?.message || '执行成功'))
        } else {
          message.warning(String(action?.message || '执行失败'))
        }
      }
      const normalized = normalizeEnvPrecheckPayload(result?.precheck || {})
      setEnvPrecheckResult(normalized)
      if (normalized.ready) {
        message.success('执行完成，环境已就绪')
      } else {
        message.warning('执行完成，但环境仍未就绪，请继续按步骤处理')
      }
    } catch (error) {
      const normalized = normalizeEnvPrecheckPayload(
        {
          ready: false,
          checks: [{ name: 'execute-error', ready: false, message: `环境执行失败：${error.message || 'unknown error'}` }],
          steps: DEFAULT_ENV_PRECHECK_STEPS,
        },
        '自动执行失败，请先按步骤处理后再抓取。',
      )
      setEnvPrecheckResult(normalized)
      message.error(error.message || '执行失败')
    } finally {
      setEnvExecuteLoading(false)
    }
  }

  const submitSupplierCrawl = async () => {
    if (!supplierNode?.id) {
      message.warning('请先选择供应链节点')
      return
    }
    const urls = parseUrlsText(supplierUrlsText)
    if (urls.length === 0) {
      message.warning('请填写至少一个有效 URL')
      return
    }
    setSupplierTaskLoading(true)
    try {
      const urlNodeMeta = urls.map((url) => ({
        url,
        nodeId: supplierNode.id,
        nodeName: supplierNode.title || supplierNode.nodeName || '',
        sourceUrl: supplierNode.sourceUrl || supplierNode.nodeUrl || url,
      }))
      const created = await createSupplierSourceCrawlTask({
        nodeName: supplierNode.title || supplierNode.nodeName || '',
        urls,
        urlsText: supplierUrlsText,
        urlNodeMeta,
        model: selectedModel,
        skill: selectedSkill,
        homepageOnly: true,
        crawlMode: 'list',
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
      const result = await importSupplierCrawlTask(supplierTask.taskId, {
        includeProfile: false,
        profileSource: 'gas',
        importTarget: 'gas-supplier',
      })
      setSupplierTask((prev) => (prev ? { ...prev, imported: true, importSummary: result } : prev))
      message.success(
        `入库完成：新建 ${result.inserted || 0} 条，覆盖 ${result.updated || 0} 条，回写节点 ${result.gasSyncedNodeCount || 0} 个`,
      )
      await loadData()
    } catch (error) {
      message.error(error.message || '入库失败')
    } finally {
      setSupplierImporting(false)
    }
  }

  const forceCloseSyncModal = () => {
    setSyncModalOpen(false)
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current)
      syncPollRef.current = null
    }
    syncPollBusyRef.current = false
    syncTaskSnapshotRef.current = ''
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

  const requestCloseSyncModal = () => {
    const status = String(syncTask?.status || '')
    const running = ['pending', 'running', 'cancelling'].includes(status)
    if (!running || !syncTask?.taskId) {
      forceCloseSyncModal()
      return
    }
    Modal.confirm({
      title: '关闭将结束当前同步',
      content: '任务会停止执行。确认关闭并结束当前同步流程吗？',
      okText: '结束任务并关闭',
      cancelText: '继续同步',
      onOk: async () => {
        try {
          await cancelGASSupplyChainSyncTask(syncTask.taskId)
          message.success('已发送结束任务指令')
        } catch (error) {
          message.error(error.message || '结束任务失败')
        } finally {
          forceCloseSyncModal()
        }
      },
    })
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

  const resizeColumn = (key, delta) => {
    setColumnWidths((current) => {
      const baseWidth = Number(current[key] || MIN_COLUMN_WIDTHS[key] || 120)
      const nextWidth = Math.max(56, Math.min(360, baseWidth + delta))
      if (nextWidth === baseWidth) return current
      return { ...current, [key]: nextWidth }
    })
  }

  const handleColumnResizeStart = (key, event) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    let delta = 0
    const onMove = (moveEvent) => {
      delta = moveEvent.clientX - startX
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (delta !== 0) resizeColumn(key, delta)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const renderResizableTitle = (title, key) => (
    <span className="resizable-table-header-inner">
      <span>{title}</span>
      <span className="resizable-table-handle" onMouseDown={(event) => handleColumnResizeStart(key, event)} />
    </span>
  )

  const columns = useMemo(() => [
    {
      title: renderResizableTitle('ID', 'id'),
      dataIndex: 'id',
      minWidth: MIN_COLUMN_WIDTHS.id,
      ...(columnWidths.id ? { width: columnWidths.id } : {}),
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: renderResizableTitle('节点名称', 'nodeName'),
      dataIndex: 'nodeName',
      minWidth: MIN_COLUMN_WIDTHS.nodeName,
      ...(columnWidths.nodeName ? { width: columnWidths.nodeName } : {}),
      ellipsis: true,
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: renderResizableTitle('上级节点', 'parentNode'),
      dataIndex: 'parentId',
      minWidth: MIN_COLUMN_WIDTHS.parentNode,
      ...(columnWidths.parentNode ? { width: columnWidths.parentNode } : {}),
      ellipsis: true,
      render: (_, record) => (record.parentId ? `${record.parentId} - ${record.parentName || ''}` : '-'),
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: renderResizableTitle('层级', 'nodeLevel'),
      dataIndex: 'nodeLevel',
      minWidth: MIN_COLUMN_WIDTHS.nodeLevel,
      ...(columnWidths.nodeLevel ? { width: columnWidths.nodeLevel } : {}),
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: renderResizableTitle('同步企业数', 'syncedSupplierCount'),
      dataIndex: 'syncedSupplierCount',
      minWidth: MIN_COLUMN_WIDTHS.syncedSupplierCount,
      ...(columnWidths.syncedSupplierCount ? { width: columnWidths.syncedSupplierCount } : {}),
      render: (value) => <Tag color={Number(value || 0) > 0 ? 'blue' : 'default'}>{Number(value || 0)}</Tag>,
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: renderResizableTitle('同步时间', 'syncedAt'),
      dataIndex: 'syncedAt',
      minWidth: MIN_COLUMN_WIDTHS.syncedAt,
      ...(columnWidths.syncedAt ? { width: columnWidths.syncedAt } : {}),
      ellipsis: true,
      render: (value) => value || '-',
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
    {
      title: '来源链接',
      dataIndex: 'sourceUrl',
      minWidth: 240,
      ellipsis: true,
      render: (value) => (value ? <div style={{ wordBreak: 'break-all' }}>{value}</div> : '-'),
    },
    {
      title: renderResizableTitle('操作', 'actions'),
      minWidth: MIN_COLUMN_WIDTHS.actions,
      ...(columnWidths.actions ? { width: columnWidths.actions } : {}),
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={async () => {
              try {
                setDetailRecord(await fetchGASSupplyChainRecordDetail(record.id))
              } catch (error) {
                message.error(error.message || '加载详情失败')
              }
            }}
          >
            详情
          </Button>
          <Button size="small" onClick={() => openEditPage(record)}>修改</Button>
          <Popconfirm title="确认删除该节点吗？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
      onHeaderCell: () => ({ className: 'resizable-table-header' }),
    },
  ], [columnWidths])

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Button type="primary" icon={<SyncOutlined />} onClick={openSyncModal}>同步</Button>
            <Button icon={<PlusOutlined />} onClick={openCreatePage}>新增</Button>
            <Popconfirm title="确认清空所有 GAS 供应链节点吗？" okText="清空" cancelText="取消" onConfirm={handleClearAll}>
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
            <Button icon={<ReloadOutlined />} onClick={() => loadData()} loading={loading}>刷新</Button>
            <Input.Search
              allowClear
              placeholder="按节点名称/来源链接搜索"
              style={{ width: 260 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={(value) => {
                const next = String(value || '').trim()
                setKeyword(next)
                loadData(next, parentKeyword)
              }}
            />
            <Input.Search
              allowClear
              placeholder="按上级节点ID/名称搜索"
              style={{ width: 240 }}
              value={parentKeyword}
              onChange={(e) => setParentKeyword(e.target.value)}
              onSearch={(value) => {
                const next = String(value || '').trim()
                setParentKeyword(next)
                loadData(keyword, next)
              }}
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
                  <span>GAS供应链</span>
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
                  setExpandedTreeKeys((prev) => [...new Set([...(prev || []), picked, ...childKeys].filter(Boolean))])
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
                const next = Math.min(36, Math.max(16, startRatio + (delta / rect.width) * 100))
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
              <div className="gas-supply-table-wrap">
              <Table
                rowKey="id"
                className="app-data-table gas-supply-table"
                columns={columns}
                dataSource={filteredRecords}
                loading={loading}
                rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
                pagination={{
                  current: tablePage,
                  pageSize: tablePageSize,
                  total: filteredRecords.length,
                  showSizeChanger: true,
                  pageSizeOptions: ['10', '20', '50', '100'],
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
                  onChange: (page, pageSize) => {
                    setTablePage(Number(page) || 1)
                    setTablePageSize(Math.max(1, Number(pageSize) || 10))
                  },
                  onShowSizeChange: (_current, size) => {
                    setTablePage(1)
                    setTablePageSize(Math.max(1, Number(size) || 10))
                  },
                  position: ['bottomRight'],
                }}
                tableLayout="auto"
                scroll={{ y: 560 }}
              />
              </div>
            </Card>
          </div>
        </div>
      </Card>

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
            <Button key="submit" type="primary" loading={supplierTaskLoading} onClick={submitSupplierCrawl}>01提交抓取</Button>
            <Button key="import" disabled={supplierTask?.status !== 'done'} loading={supplierImporting} onClick={submitSupplierImport}>02提交入库</Button>
            <Button key="close" onClick={requestCloseSupplierModal}>03关闭</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <div style={{ minWidth: 220, flex: 1 }}>
              <Text className="muted">模型</Text>
              <Select
                style={{ width: '100%' }}
                value={selectedModel}
                options={modelOptions.map((item) => ({ label: item, value: item }))}
                onChange={setSelectedModel}
              />
            </div>
            <div style={{ minWidth: 220, flex: 1 }}>
              <Text className="muted">数据爬取技能</Text>
              <Select
                style={{ width: '100%' }}
                value={selectedSkill}
                options={CRAWL_SKILL_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                onChange={(value) => {
                  setSelectedSkill(value)
                  setEnvPrecheckResult(null)
                }}
              />
            </div>
          </Space>
          <Space wrap>
            <Button loading={envPrecheckLoading} onClick={() => runSupplierEnvPrecheck()}>
              检测环境
            </Button>
            <Button loading={envExecuteLoading} onClick={runSupplierEnvExecute}>
              执行
            </Button>
            {envPrecheckResult ? (
              <Tag color={envPrecheckResult.ready ? 'success' : 'warning'}>
                {envPrecheckResult.ready ? '环境就绪' : '环境未就绪'}
              </Tag>
            ) : (
              <Tag>未检测</Tag>
            )}
          </Space>
          {envPrecheckResult ? (
            <Card size="small">
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text>{envPrecheckResult.summary}</Text>
                {envPrecheckResult.checks.map((item, idx) => (
                  <Text key={`${item.name || 'line'}-${idx}`}>检查项：{item.message}</Text>
                ))}
              </Space>
            </Card>
          ) : null}
          <Card size="small">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {WEB_ACCESS_BOOTSTRAP_STEPS.map((line, idx) => (
                <Text key={`bootstrap-${idx}`}>{line}</Text>
              ))}
            </Space>
          </Card>
          <div>
            <Text className="muted">URL 信息（多行）</Text>
            <Input.TextArea rows={5} value={supplierUrlsText} onChange={(e) => setSupplierUrlsText(e.target.value)} placeholder="请输入 URL 列表" />
            <Text type="secondary">默认自动填充当前选中节点的 URL；详情阶段仅抓每家企业首页信息，不抓其他 Tab。</Text>
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
                    入库结果：新建 {supplierTask.importSummary.inserted || 0} 条，覆盖 {supplierTask.importSummary.updated || 0} 条，回写节点 {supplierTask.importSummary.gasSyncedNodeCount || 0} 个
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

      <Modal
        width={760}
        title="同步 GAS 供应链"
        open={syncModalOpen}
        closable={false}
        keyboard={false}
        maskClosable={false}
        onCancel={requestCloseSyncModal}
        footer={(
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button key="submit" type="primary" loading={syncTaskLoading} onClick={handleSubmitSync}>01提交抓取</Button>
            <Button key="import" disabled={syncTask?.status !== 'done'} loading={syncImporting} onClick={handleImportSync}>02提交入库</Button>
            <Button key="close" onClick={requestCloseSyncModal}>03关闭</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <div style={{ minWidth: 220 }}>
              <Text className="muted">模型</Text>
              <Select style={{ width: '100%' }} value={selectedModel} options={modelOptions.map((item) => ({ label: item, value: item }))} onChange={setSelectedModel} />
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
            <Text type="secondary">{`默认值：\`${GASGOO_DEFAULT_URL}\``}</Text>
          </div>
          {syncTask ? (
            <Card size="small" className="app-elevated-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Progress percent={syncTask.progress || 0} />
                <Space wrap>
                  <Tag color={syncTask.status === 'done' ? 'success' : syncTask.status === 'failed' ? 'error' : syncTask.status === 'cancelled' ? 'default' : 'processing'}>
                    状态：{syncTask.status}
                  </Tag>
                  <Tag>模式：{syncTask.mode === 'full' ? '全量' : '增量'}</Tag>
                  <Tag>URL 进度：{syncTask.processedUrls || 0}/{syncTask.totalUrls || 0}</Tag>
                  <Tag>已抓取：{syncTask.totalRows || 0} 条 / 共 {syncTask.estimatedTotalRows || syncTask.totalRows || 0} 条</Tag>
                </Space>
                {syncTask.downloadUrl ? (
                  <a href={syncTask.downloadUrl} target="_blank" rel="noreferrer">
                    <DownloadOutlined />
                    {' '}
                    下载 GAS 供应链 CSV
                  </a>
                ) : null}
                {syncTask.importSummary ? (
                  <Text type="success">
                    入库结果：新建 {syncTask.importSummary.inserted || 0} 条，覆盖 {syncTask.importSummary.updated || 0} 条，
                    一级 {syncTask.importSummary.level1Inserted || 0}/{syncTask.importSummary.level1Updated || 0}，
                    二级 {syncTask.importSummary.level2Inserted || 0}/{syncTask.importSummary.level2Updated || 0}，
                    三级 {syncTask.importSummary.level3Inserted || 0}/{syncTask.importSummary.level3Updated || 0}，
                    四级 {syncTask.importSummary.level4Inserted || 0}/{syncTask.importSummary.level4Updated || 0}，
                    五级 {syncTask.importSummary.level5Inserted || 0}/{syncTask.importSummary.level5Updated || 0}
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

      <Modal title="GAS供应链节点详情" open={Boolean(detailRecord)} footer={null} onCancel={() => setDetailRecord(null)}>
        {detailRecord ? (
          <Space direction="vertical" size={6}>
            <div>ID：{detailRecord.id}</div>
            <div>节点名称：{detailRecord.nodeName}</div>
            <div>上级节点：{detailRecord.parentId ? `${detailRecord.parentId} - ${detailRecord.parentName || ''}` : '-'}</div>
            <div>层级：{detailRecord.nodeLevel}</div>
            <div>同步企业数：{detailRecord.syncedSupplierCount || 0}</div>
            <div>同步时间：{detailRecord.syncedAt || '-'}</div>
            <div>来源链接：{detailRecord.sourceUrl || '-'}</div>
            <div>创建时间：{detailRecord.createdAt || '-'}</div>
            <div>更新时间：{detailRecord.updatedAt || '-'}</div>
          </Space>
        ) : null}
      </Modal>
    </Space>
  )
}

export default GASSupplyChainPage
