import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import {
  Button,
  Cascader,
  Card,
  DatePicker,
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
  Tree,
  TreeSelect,
  Typography,
  message,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { createSupplierSourceCrawlTask, importSupplierCrawlTask, fetchSupplierCrawlTask, cancelSupplierCrawlTask } from '../api/supplierApi'
import { executeCrawlEnvActions, fetchCodexModels, precheckCrawlEnvironment } from '../api/supplyChainApi'
import { fetchGASSupplyChainTree } from '../api/gasSupplyChainApi'
import {
  batchDeleteGasSuppliers,
  clearAllGasSuppliers,
  createGasSupplier,
  deleteGasSupplier,
  fetchGasSupplierDetail,
  fetchGasSuppliers,
  updateGasSupplier,
} from '../api/gasSupplierApi'
import { CRAWL_SKILL_OPTIONS, DEFAULT_CRAWL_SKILL } from '../constants/crawlSkills'
import CHINA_PC_OPTIONS from '../constants/chinaProvinceCity.json'

const { Text, Title } = Typography
const DEFAULT_ENV_PRECHECK_STEPS = []
const WEB_ACCESS_BOOTSTRAP_STEPS = [
  'web-access 启动：',
  'node "C:\\Users\\aoyon\\.codex\\skills\\web-access\\scripts\\check-deps.mjs"',
  'curl.exe --noproxy "*" http://localhost:3456/targets',
  'Chrome 保持打开 https://i.gasgoo.com/supplier/oem.html（不要关）。',
  'Edge 打开系统页 http://localhost:5173/gas-oems。',
  '点 同步 -> 01提交抓取。',
]
const REGION_ALIAS = new Map([
  ['北京', '北京市'],
  ['上海', '上海市'],
  ['天津', '天津市'],
  ['重庆', '重庆市'],
  ['香港', '香港特别行政区'],
  ['澳门', '澳门特别行政区'],
  ['内蒙古', '内蒙古自治区'],
  ['广西', '广西壮族自治区'],
  ['西藏', '西藏自治区'],
  ['宁夏', '宁夏回族自治区'],
  ['新疆', '新疆维吾尔自治区'],
  ['广州', '广州市'],
  ['深圳', '深圳市'],
  ['杭州', '杭州市'],
  ['苏州', '苏州市'],
  ['宁波', '宁波市'],
  ['南京', '南京市'],
  ['无锡', '无锡市'],
  ['常州', '常州市'],
  ['嘉兴', '嘉兴市'],
  ['湖州', '湖州市'],
  ['合肥', '合肥市'],
  ['成都', '成都市'],
  ['武汉', '武汉市'],
  ['长沙', '长沙市'],
  ['西安', '西安市'],
  ['郑州', '郑州市'],
  ['青岛', '青岛市'],
  ['厦门', '厦门市'],
  ['福州', '福州市'],
  ['大连', '大连市'],
  ['沈阳', '沈阳市'],
  ['新余', '新余市'],
])

function normalizeRegionToken(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return REGION_ALIAS.get(text) || text
}

function buildRegionIndexes(options = []) {
  const cascaderOptions = []
  const provinceMap = new Map()
  const cityMap = new Map()
  for (const province of options || []) {
    const provinceName = normalizeRegionToken(province?.name)
    if (!provinceName) continue
    const children = []
    for (const city of province?.children || []) {
      const cityName = normalizeRegionToken(city?.name)
      if (!cityName) continue
      children.push({
        value: cityName,
        label: cityName,
      })
      const linked = cityMap.get(cityName) || []
      if (!linked.includes(provinceName)) linked.push(provinceName)
      cityMap.set(cityName, linked)
    }
    const node = {
      value: provinceName,
      label: provinceName,
      children,
    }
    cascaderOptions.push(node)
    provinceMap.set(provinceName, node)
  }
  return { cascaderOptions, provinceMap, cityMap }
}

function resolveRegionPath(value, regionIndexes) {
  const text = normalizeRegionToken(value)
  if (!text) return []
  const { provinceMap, cityMap } = regionIndexes || {}
  if (!provinceMap || !cityMap) return []

  let selectedProvince = ''
  for (const province of provinceMap.keys()) {
    if (text.includes(province)) {
      selectedProvince = province
      break
    }
  }

  if (selectedProvince) {
    const provinceNode = provinceMap.get(selectedProvince)
    const selectedCity = (provinceNode?.children || []).find((item) => text.includes(item.value))?.value || ''
    return selectedCity ? [selectedProvince, selectedCity] : [selectedProvince]
  }

  const normalized = normalizeRegionToken(text.replace(/省|市|自治区|特别行政区/g, ''))
  if (provinceMap.has(text)) return [text]
  if (provinceMap.has(normalized)) return [normalized]

  if (cityMap.has(text)) return [cityMap.get(text)[0], text]
  if (cityMap.has(normalized)) return [cityMap.get(normalized)[0], normalized]
  return []
}

function stringifyRegionPath(pathValue) {
  if (!Array.isArray(pathValue) || pathValue.length === 0) return ''
  const province = normalizeRegionToken(pathValue[0])
  const city = normalizeRegionToken(pathValue[1])
  if (!province) return city || ''
  if (!city || city === province) return province
  return `${province}${city}`
}

function parseEstablishedDate(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (/^invalid date$/i.test(text)) return null
  const parsed = dayjs(text)
  return parsed.isValid() ? parsed : null
}

function normalizeNodeValue(node) {
  const raw = node?.id ?? node?.key ?? node?.value
  return raw === undefined || raw === null || raw === '' ? '' : String(raw)
}

function buildTreeSelectData(nodes = []) {
  return (nodes || [])
    .map((node) => {
      const value = normalizeNodeValue(node)
      if (!value) return null
      return {
        value,
        title: node?.title || node?.nodeName || value,
        children: buildTreeSelectData(node?.children || []),
      }
    })
    .filter(Boolean)
}

function buildNodeLookup(nodes = [], map = new Map()) {
  for (const node of nodes || []) {
    const value = normalizeNodeValue(node)
    if (!value) continue
    map.set(value, {
      id: value,
      title: String(node?.title || node?.nodeName || value),
      sourceUrl: String(node?.sourceUrl || ''),
      nodeUrl: String(node?.nodeUrl || ''),
    })
    buildNodeLookup(node?.children || [], map)
  }
  return map
}

function parseUrlsText(input) {
  return [...new Set(
    String(input || '')
      .split(/[\n\r,，;；]+/g)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//i.test(item)),
  )]
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

function GasSupplierListPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [records, setRecords] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [treeData, setTreeData] = useState([])
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [expandedTreeKeys, setExpandedTreeKeys] = useState([])
  const [panelRatio, setPanelRatio] = useState(24)
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const splitRef = useRef(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorMode, setEditorMode] = useState('create')
  const [editId, setEditId] = useState(null)
  const [form] = Form.useForm()

  const [crawlModalOpen, setCrawlModalOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gpt-5.4')
  const [modelOptions, setModelOptions] = useState(['gpt-5.4'])
  const [selectedSkill, setSelectedSkill] = useState(DEFAULT_CRAWL_SKILL)
  const [crawlUrlsText, setCrawlUrlsText] = useState('')
  const [crawlTask, setCrawlTask] = useState(null)
  const [crawlTaskLoading, setCrawlTaskLoading] = useState(false)
  const [crawlImporting, setCrawlImporting] = useState(false)
  const [envPrecheckLoading, setEnvPrecheckLoading] = useState(false)
  const [envExecuteLoading, setEnvExecuteLoading] = useState(false)
  const [envPrecheckResult, setEnvPrecheckResult] = useState(null)
  const crawlPollRef = useRef(null)
  const crawlPollBusyRef = useRef(false)
  const crawlTaskSnapshotRef = useRef('')

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
  }, [selectedTreeId, treeData])
  const gasNodeTreeOptions = useMemo(() => buildTreeSelectData(treeData), [treeData])
  const gasNodeLookup = useMemo(() => buildNodeLookup(treeData), [treeData])
  const regionIndexes = useMemo(() => buildRegionIndexes(CHINA_PC_OPTIONS), [])
  const regionCascaderOptions = useMemo(() => regionIndexes.cascaderOptions, [regionIndexes])

  const filteredRecords = useMemo(() => {
    if (!selectedTreeId) return records
    const descendants = collectDescendantIds(treeData, selectedTreeId)
    if (descendants.size === 0) return records
    return records.filter((item) => descendants.has(String(item.gasNodeId)))
  }, [records, treeData, selectedTreeId])
  const selectedSupplierRows = useMemo(() => {
    const selectedKeySet = new Set((selectedRowKeys || []).map((item) => String(item)))
    if (selectedKeySet.size === 0) return []
    return records.filter((item) => selectedKeySet.has(String(item.id)))
  }, [records, selectedRowKeys])
  const selectedDetailUrls = useMemo(() => {
    const list = selectedSupplierRows
      .map((item) => String(item?.detailUrl || '').trim())
      .filter((item) => /^https?:\/\//i.test(item))
    return [...new Set(list)]
  }, [selectedSupplierRows])
  const selectedUrlMetaMap = useMemo(() => {
    const map = new Map()
    for (const row of selectedSupplierRows) {
      const detailUrl = String(row?.detailUrl || '').trim()
      if (!/^https?:\/\//i.test(detailUrl)) continue
      const parsedNodeId = Number(row?.gasNodeId)
      map.set(detailUrl, {
        nodeId: Number.isInteger(parsedNodeId) && parsedNodeId > 0 ? parsedNodeId : null,
        nodeName: String(row?.gasNodeName || '').trim(),
        sourceUrl: String(row?.sourceUrl || row?.detailUrl || '').trim(),
      })
    }
    return map
  }, [selectedSupplierRows])

  useEffect(() => {
    const total = filteredRecords.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [filteredRecords.length, tablePage, tablePageSize])

  const loadData = async (nextKeyword = keyword) => {
    setLoading(true)
    try {
      const nodeId = selectedTreeId ? Number(selectedTreeId) : null
      const [supplierRows, tree] = await Promise.all([
        fetchGasSuppliers({ limit: 5000, keyword: nextKeyword, nodeId: Number.isInteger(nodeId) && nodeId > 0 ? nodeId : undefined }),
        fetchGASSupplyChainTree(),
      ])
      const safeRows = Array.isArray(supplierRows) ? supplierRows : []
      setRecords(safeRows.map((item) => ({ ...item, key: item.id })))
      setTreeData(tree?.roots || [])
      setSelectedRowKeys((prev) => prev.filter((id) => safeRows.some((item) => Number(item.id) === Number(id))))
      setExpandedTreeKeys((prev) => (prev.length > 0 ? prev : (tree?.roots || []).map((item) => String(item.key || item.id))))
    } catch (error) {
      message.error(error.message || '加载GAS供应商失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setTablePage(1)
    loadData('')
  }, [selectedTreeId])

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
    if (crawlPollRef.current) {
      clearInterval(crawlPollRef.current)
      crawlPollRef.current = null
    }
  }, [])

  const openCreate = () => {
    setEditorMode('create')
    setEditId(null)
    form.setFieldsValue({
      gasNodeId: undefined,
      gasNodeName: '',
      companyName: '',
      location: undefined,
      registeredCapital: '',
      establishedDate: null,
      mainProducts: '',
      detailUrl: '',
      sourceUrl: '',
    })
    setEditorOpen(true)
  }

  const openView = async (id) => {
    setEditorMode('view')
    setEditId(id)
    setEditorLoading(true)
    setEditorOpen(true)
    try {
      const detail = await fetchGasSupplierDetail(id)
      const gasNodeId = detail?.gasNodeId ? String(detail.gasNodeId) : undefined
      const regionPath = resolveRegionPath(detail?.location || detail?.region, regionIndexes)
      form.setFieldsValue({
        ...detail,
        gasNodeId,
        location: regionPath.length ? regionPath : undefined,
        establishedDate: parseEstablishedDate(detail?.establishedDate),
        sourceUrl: detail?.sourceUrl || detail?.listPageUrl || '',
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
      const detail = await fetchGasSupplierDetail(id)
      const gasNodeId = detail?.gasNodeId ? String(detail.gasNodeId) : undefined
      const regionPath = resolveRegionPath(detail?.location || detail?.region, regionIndexes)
      form.setFieldsValue({
        ...detail,
        gasNodeId,
        location: regionPath.length ? regionPath : undefined,
        establishedDate: parseEstablishedDate(detail?.establishedDate),
        sourceUrl: detail?.sourceUrl || detail?.listPageUrl || '',
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
      const gasNodeId = values.gasNodeId ? Number(values.gasNodeId) : null
      const gasNodeMeta = values.gasNodeId ? gasNodeLookup.get(String(values.gasNodeId)) : null
      const payload = {
        gasNodeId,
        gasNodeName: gasNodeMeta?.title || String(values.gasNodeName || ''),
        companyName: String(values.companyName || ''),
        location: stringifyRegionPath(values.location),
        registeredCapital: String(values.registeredCapital || ''),
        establishedDate: values.establishedDate ? values.establishedDate.format('YYYY-MM-DD') : '',
        mainProducts: String(values.mainProducts || ''),
        detailUrl: String(values.detailUrl || ''),
        sourceUrl: String(values.sourceUrl || ''),
      }
      setEditorLoading(true)
      if (editorMode === 'create') {
        await createGasSupplier(payload)
        message.success('新增成功')
      } else {
        await updateGasSupplier(editId, payload)
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
      await deleteGasSupplier(id)
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteGasSuppliers(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllGasSuppliers()
      message.success(`已清空 ${result?.deletedCount || 0} 条`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const openCrawlModal = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先在列表中勾选供应商记录')
      return
    }
    if (selectedDetailUrls.length === 0) {
      message.warning('所选记录未包含有效供应商详情URL')
      return
    }
    setCrawlTask(null)
    setEnvPrecheckResult(null)
    crawlTaskSnapshotRef.current = ''
    setCrawlUrlsText(selectedDetailUrls.join('\n'))
    setCrawlModalOpen(true)
  }

  const runSupplierEnvPrecheck = async ({ silentSuccess = false } = {}) => {
    const targetUrl = parseUrlsText(crawlUrlsText)[0] || ''
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
    const targetUrl = parseUrlsText(crawlUrlsText)[0] || ''
    if (!targetUrl) {
      message.warning('请先填写至少一个有效 URL')
      return
    }
    setEnvExecuteLoading(true)
    try {
      const result = await executeCrawlEnvActions({ skill: selectedSkill, targetUrl })
      const actionLines = Array.isArray(result?.actions) ? result.actions : []
      for (const action of actionLines) {
        if (action?.success) message.success(String(action?.message || '执行成功'))
        else message.warning(String(action?.message || '执行失败'))
      }
      const normalized = normalizeEnvPrecheckPayload(result?.precheck || {})
      setEnvPrecheckResult(normalized)
      if (normalized.ready) message.success('执行完成，环境已就绪')
      else message.warning('执行完成，但环境仍未就绪，请继续按步骤处理')
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

  const pollCrawlTask = (taskId) => {
    if (crawlPollRef.current) {
      clearInterval(crawlPollRef.current)
      crawlPollRef.current = null
    }
    crawlPollRef.current = setInterval(async () => {
      if (crawlPollBusyRef.current) return
      crawlPollBusyRef.current = true
      try {
        const latest = await fetchSupplierCrawlTask(taskId)
        const snapshot = [
          latest?.status || '',
          latest?.progress || 0,
          latest?.processedUrls || 0,
          latest?.totalUrls || 0,
          latest?.totalRows || 0,
          Array.isArray(latest?.runLogs) ? latest.runLogs.length : 0,
        ].join('|')
        if (snapshot !== crawlTaskSnapshotRef.current) {
          crawlTaskSnapshotRef.current = snapshot
          setCrawlTask(latest)
        }
        if (latest.status === 'done' || latest.status === 'failed' || latest.status === 'cancelled') {
          clearInterval(crawlPollRef.current)
          crawlPollRef.current = null
          if (latest.status === 'done') message.success(`抓取完成，共 ${latest.totalRows || 0} 条`)
          else if (latest.status === 'cancelled') message.warning('抓取已取消')
          else message.error(latest.errorMessage || '抓取失败')
        }
      } catch (error) {
        clearInterval(crawlPollRef.current)
        crawlPollRef.current = null
        message.error(error.message || '获取抓取进度失败')
      } finally {
        crawlPollBusyRef.current = false
      }
    }, 2200)
  }

  const submitCrawl = async () => {
    const urls = parseUrlsText(crawlUrlsText)
    if (urls.length === 0) {
      message.warning('请填写有效URL')
      return
    }
    setCrawlTaskLoading(true)
    try {
      const fallbackNodeName = String(selectedSupplierRows[0]?.gasNodeName || selectedTreeNode?.title || selectedTreeNode?.nodeName || 'GAS供应商').trim()
      const created = await createSupplierSourceCrawlTask({
        nodeName: fallbackNodeName,
        urls,
        urlsText: crawlUrlsText,
        urlNodeMeta: urls.map((url) => ({
          url,
          nodeId: selectedUrlMetaMap.get(url)?.nodeId ?? null,
          nodeName: selectedUrlMetaMap.get(url)?.nodeName || fallbackNodeName,
          sourceUrl: selectedUrlMetaMap.get(url)?.sourceUrl || url,
        })),
        model: selectedModel,
        skill: selectedSkill,
      })
      setCrawlTask(created)
      pollCrawlTask(created.taskId)
      message.info('抓取任务已创建')
    } catch (error) {
      message.error(error.message || '提交抓取失败')
    } finally {
      setCrawlTaskLoading(false)
    }
  }

  const submitCrawlImport = async () => {
    if (!crawlTask?.taskId) {
      message.warning('请先完成抓取')
      return
    }
    setCrawlImporting(true)
    try {
      const result = await importSupplierCrawlTask(crawlTask.taskId, {
        includeProfile: true,
        profileSource: 'gas',
        importTarget: 'gas-supplier',
      })
      setCrawlTask((prev) => (prev ? { ...prev, imported: true, importSummary: result } : prev))
      message.success(
        `入库完成：供应商新建 ${result.inserted || 0} 条，覆盖 ${result.updated || 0} 条；档案新建 ${result.profileInserted || 0} 条，覆盖 ${result.profileUpdated || 0} 条`,
      )
      await loadData()
      navigate('/gas-supplier-profiles')
    } catch (error) {
      message.error(error.message || '入库失败')
    } finally {
      setCrawlImporting(false)
    }
  }

  const requestCloseCrawlModal = () => {
    const running = ['pending', 'running', 'cancelling'].includes(String(crawlTask?.status || ''))
    if (!running || !crawlTask?.taskId) {
      setCrawlModalOpen(false)
      return
    }
    Modal.confirm({
      title: '关闭将结束当前抓取任务',
      content: '任务会停止执行，确认关闭吗？',
      okText: '结束并关闭',
      cancelText: '继续抓取',
      onOk: async () => {
        try {
          await cancelSupplierCrawlTask(crawlTask.taskId)
          message.success('已发送结束任务指令')
        } catch (error) {
          message.error(error.message || '结束任务失败')
        } finally {
          setCrawlModalOpen(false)
          if (crawlPollRef.current) {
            clearInterval(crawlPollRef.current)
            crawlPollRef.current = null
          }
        }
      },
    })
  }

  const columns = [
    { title: '供应商名称', dataIndex: 'companyName', width: 240, ellipsis: true },
    {
      title: 'GAS供应链节点',
      dataIndex: 'gasNodeName',
      width: 220,
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: '供应商详情URL',
      dataIndex: 'detailUrl',
      width: 360,
      ellipsis: true,
      render: (value) => (value ? <div style={{ wordBreak: 'break-all' }}>{value}</div> : '-'),
    },
    {
      title: '操作',
      width: 200,
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
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space className="page-titlebar">
          <Space>
            <Title level={3} style={{ margin: 0 }}>GAS供应商列表</Title>
          </Space>
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="按供应商/GAS供应链节点/URL搜索"
              style={{ width: 320 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={(value) => {
                const next = String(value || '').trim()
                setKeyword(next)
                setTablePage(1)
                loadData(next)
              }}
            />
            <Button type="primary" icon={<SyncOutlined />} onClick={openCrawlModal} disabled={selectedRowKeys.length === 0}>
              获取供应商档案
            </Button>
            <Button icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
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
              title={`确认清空全部 GAS供应商吗？当前共 ${records.length} 条`}
              description="该操作不可恢复。"
              okText="清空全部"
              cancelText="取消"
              onConfirm={handleClearAll}
              disabled={records.length === 0}
            >
              <Button danger icon={<ClearOutlined />} disabled={records.length === 0}>
                清空所有
              </Button>
            </Popconfirm>
          </Space>
        </Space>
      </Card>

      <Card className="app-elevated-card">
        <div ref={splitRef} className="supply-split-wrap">
          <div className="supply-split-left" style={{ width: `${panelRatio}%` }}>
            <Card size="small" title="GAS供应链节点" bodyStyle={{ padding: 8 }}>
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
            <Card size="small" title={`GAS供应商列表（${filteredRecords.length}）`} bodyStyle={{ padding: 8 }}>
              <Table
                rowKey="id"
                className="app-data-table"
                loading={loading}
                dataSource={filteredRecords}
                columns={columns}
                rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
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
              />
            </Card>
          </div>
        </div>
      </Card>

      <Modal
        title={editorMode === 'create' ? '新增GAS供应商' : editorMode === 'edit' ? '修改GAS供应商' : '查看GAS供应商'}
        open={editorOpen}
        onCancel={() => {
          setEditorOpen(false)
        }}
        onOk={submitEditor}
        okText={editorMode === 'view' ? '关闭' : '保存'}
        cancelText="取消"
        confirmLoading={editorLoading}
        width={900}
      >
        <Form form={form} layout="vertical" disabled={editorMode === 'view' || editorLoading}>
          <Form.Item name="gasNodeName" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="gasNodeId"
            label="GAS供应链节点"
            rules={[{ required: true, message: '请选择GAS供应链节点' }]}
          >
            <TreeSelect
              treeData={gasNodeTreeOptions}
              placeholder="请选择GAS供应链节点"
              allowClear
              showSearch
              treeNodeFilterProp="title"
              onChange={(value) => {
                const node = value ? gasNodeLookup.get(String(value)) : null
                form.setFieldValue('gasNodeName', node?.title || '')
              }}
            />
          </Form.Item>
          <Form.Item name="companyName" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input />
          </Form.Item>
          <Space wrap style={{ width: '100%' }}>
            <Form.Item name="location" label="所在地" style={{ minWidth: 220, flex: 1 }}>
              <Cascader
                allowClear
                showSearch
                changeOnSelect
                placeholder="请选择所在地（省/市）"
                options={regionCascaderOptions}
              />
            </Form.Item>
            <Form.Item name="registeredCapital" label="注册资金" style={{ minWidth: 220, flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="establishedDate" label="成立时间" style={{ minWidth: 220, flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
          </Space>
          <Form.Item name="mainProducts" label="主营产品">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="detailUrl" label="供应商详情URL">
            <Input />
          </Form.Item>
          <Form.Item name="sourceUrl" label="数据来源URL">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        width={760}
        title={`获取供应商档案（已选 ${selectedRowKeys.length} 条）`}
        open={crawlModalOpen}
        closable={false}
        keyboard={false}
        maskClosable={false}
        onCancel={requestCloseCrawlModal}
        footer={(
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button key="submit" type="primary" loading={crawlTaskLoading} onClick={submitCrawl}>01提交抓取</Button>
            <Button key="import" disabled={crawlTask?.status !== 'done'} loading={crawlImporting} onClick={submitCrawlImport}>02提交入库</Button>
            <Button key="close" onClick={requestCloseCrawlModal}>03关闭</Button>
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
            <Input.TextArea rows={5} value={crawlUrlsText} onChange={(e) => setCrawlUrlsText(e.target.value)} placeholder="请输入 URL 列表" />
          </div>
          {crawlTask ? (
            <Card size="small" className="app-elevated-card">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Progress percent={crawlTask.progress || 0} />
                <Space wrap>
                  <Tag color={crawlTask.status === 'done' ? 'success' : crawlTask.status === 'failed' ? 'error' : 'processing'}>
                    状态：{crawlTask.status}
                  </Tag>
                  <Tag>URL 进度：{crawlTask.processedUrls || 0}/{crawlTask.totalUrls || 0}</Tag>
                  <Tag>已抓取：{crawlTask.totalRows || 0} 条</Tag>
                  {crawlTask.downloadUrl ? (
                    <a href={crawlTask.downloadUrl} target="_blank" rel="noreferrer">
                      <DownloadOutlined />
                      <span style={{ marginLeft: 4 }}>下载CSV</span>
                    </a>
                  ) : null}
                </Space>
                {crawlTask.importSummary ? (
                  <Text type="success">
                    入库结果：新建 {crawlTask.importSummary.inserted || 0} 条，覆盖 {crawlTask.importSummary.updated || 0} 条
                  </Text>
                ) : null}
                <List
                  size="small"
                  bordered
                  dataSource={crawlTask.runLogs || []}
                  renderItem={(line) => <List.Item>{line}</List.Item>}
                  style={{ maxHeight: 180, overflowY: 'auto' }}
                />
              </Space>
            </Card>
          ) : null}
        </Space>
      </Modal>
    </Space>
  )
}

export default GasSupplierListPage
