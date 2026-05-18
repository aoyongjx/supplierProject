import { Button, Card, Checkbox, Col, Dropdown, Form, Input, List, Modal, Progress, Row, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Tree, Typography, Upload, message } from 'antd'
import { CloseCircleOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  batchDeleteLlmWikiSyncTasks,
  cancelLlmWikiSyncTask,
  clearLlmWikiEntriesBySection,
  deleteLlmWikiSyncTask,
  deleteLlmWikiEntry,
  fetchLlmWikiEntries,
  fetchLlmWikiSectionCounts,
  fetchLlmWikiSettings,
  fetchLlmWikiGraph,
  fetchLlmWikiRawImportItems,
  importLlmWikiObsidianFromPath,
  fetchLlmWikiSyncDbTables,
  fetchLlmWikiSyncRagKbs,
  fetchLlmWikiSyncTasks,
  importLlmWikiRawMaterials,
  exportLlmWikiObsidianToPath,
  previewLlmWikiRawImportItem,
  deleteLlmWikiRawImportItem,
  resyncLlmWikiRawImportItem,
  saveLlmWikiEntry,
  saveLlmWikiSettings,
  syncLlmWikiGraph,
  triggerLlmWikiSync,
} from '../api/llmWikiApi'
import { fetchKnowledgeBases } from '../api/knowledgeBaseApi'

const { Title, Text } = Typography
const WIKI_SECTIONS = ['raw', 'inbox', 'sources', 'entities', 'concepts', 'comparisons', 'overview', 'logs', 'obsidian']
const WIKI_PANEL_HEIGHT = 'calc(100vh - 235px)'
const WIKI_LIST_VIEW_HEIGHT = 'calc(100vh - 285px)'
const WIKI_SECTION_LABELS = {
  raw: '原始资料 RAW',
  inbox: '收件箱 Inbox',
  sources: '来源 Sources',
  entities: '实体 Entities',
  concepts: '概念 Concepts',
  comparisons: '对比 Comparisons',
  overview: '总览 Overview',
  logs: '日志 Logs',
  obsidian: 'Obsidian',
}
const OBSIDIAN_IMPORT_FOLDERS = [
  '01-RAW',
  '02-Inbox',
  '03-Sources',
  '04-Entities',
  '05-Concepts',
  '06-Comparisons',
  '07-Overview',
  '08-Logs',
  '09-Obsidian wiki',
]

function parseWikiLinks(raw = '') {
  const text = String(raw || '')
  const links = []
  const wikiRe = /\[\[([^[\]]+)\]\]/g
  const mdRe = /\[[^\]]*?\]\(([^)]+\.md(?:#[^)]+)?)\)/g
  let match = null
  while ((match = wikiRe.exec(text))) {
    const token = String(match[1] || '').trim()
    if (token) links.push(token)
  }
  while ((match = mdRe.exec(text))) {
    const token = String(match[1] || '').trim()
    if (!token) continue
    const file = token.split('#')[0].split('/').pop() || ''
    const title = file.replace(/\.md$/i, '').trim()
    if (title) links.push(title)
  }
  return links
}

function buildGraphData(entries = [], options = {}) {
  const category = String(options.category || 'all')
  const status = String(options.status || 'all')
  const keyword = String(options.keyword || '').trim().toLowerCase()
  const onlyConfirmed = options.onlyConfirmed === true

  const filtered = entries.filter((item) => {
    if (category !== 'all' && String(item.category || '') !== category) return false
    if (status !== 'all' && String(item.status || '') !== status) return false
    if (onlyConfirmed && String(item.status || '') !== '已确认') return false
    if (!keyword) return true
    const haystack = `${item.title || ''} ${item.content || ''} ${(Array.isArray(item.tags) ? item.tags.join(' ') : '')}`.toLowerCase()
    return haystack.includes(keyword)
  })

  const maxNodes = Math.max(50, Number(options.maxNodes || 260) || 260)
  const enableTagCooccurrence = options.enableTagCooccurrence !== false

  const nodes = filtered.slice(0, maxNodes).map((item) => ({
    id: String(item.key || item.id || item.title || ''),
    title: String(item.title || ''),
    category: String(item.category || '未分类'),
    status: String(item.status || '待确认'),
    sourceCount: Number(item.sourceCount || 0),
    updatedAt: String(item.updatedAt || ''),
    tags: Array.isArray(item.tags) ? item.tags : [],
    content: String(item.content || ''),
    markdown: String(item.markdown || ''),
  })).filter((node) => node.id)

  const idSet = new Set(nodes.map((n) => n.id))
  const titleToId = new Map(nodes.map((n) => [n.title, n.id]))
  const linkWeightMap = new Map()

  for (const node of nodes) {
    const refs = [
      ...parseWikiLinks(node.markdown),
      ...parseWikiLinks(node.content),
    ]
    for (const ref of refs) {
      const targetId = titleToId.get(ref)
      if (!targetId || targetId === node.id) continue
      const pair = node.id < targetId ? `${node.id}::${targetId}` : `${targetId}::${node.id}`
      linkWeightMap.set(pair, (linkWeightMap.get(pair) || 0) + 1)
    }
  }

  if (enableTagCooccurrence) {
    for (let i = 0; i < nodes.length; i += 1) {
      const source = nodes[i]
      const sourceTags = Array.isArray(source.tags) ? source.tags : []
      for (let j = i + 1; j < nodes.length; j += 1) {
        const target = nodes[j]
        const targetTags = Array.isArray(target.tags) ? target.tags : []
        const sharedTag = sourceTags.some((tag) => targetTags.includes(tag))
        if (!sharedTag) continue
        const pair = source.id < target.id ? `${source.id}::${target.id}` : `${target.id}::${source.id}`
        linkWeightMap.set(pair, (linkWeightMap.get(pair) || 0) + 1)
      }
    }
  }

  const links = Array.from(linkWeightMap.entries()).map(([pair, weight]) => {
    const [source, target] = pair.split('::')
    return { source, target, weight }
  }).filter((link) => idSet.has(link.source) && idSet.has(link.target))

  return { nodes, links }
}

function nodeColorByCategory(category = '') {
  const token = String(category || '').toLowerCase()
  if (token.includes('企业')) return '#f59e0b'
  if (token.includes('产品')) return '#38bdf8'
  if (token.includes('认证')) return '#a78bfa'
  if (token.includes('专题')) return '#22c55e'
  if (token.includes('entities')) return '#f59e0b'
  if (token.includes('concepts')) return '#38bdf8'
  if (token.includes('comparisons')) return '#22c55e'
  if (token.includes('overview')) return '#f43f5e'
  return '#94a3b8'
}

function normalizeWikiSection(category = '') {
  const token = String(category || '').toLowerCase()
  if (token.includes('raw') || token.includes('原始')) return 'raw'
  if (token.includes('企业') || token.includes('entities')) return 'entities'
  if (token.includes('产品') || token.includes('concepts') || token.includes('概念')) return 'concepts'
  if (token.includes('认证') || token.includes('sources') || token.includes('来源')) return 'sources'
  if (token.includes('专题') || token.includes('comparisons') || token.includes('对比')) return 'comparisons'
  if (token.includes('overview') || token.includes('总览')) return 'overview'
  if (token.includes('log') || token.includes('日志')) return 'logs'
  if (token.includes('obsidian')) return 'obsidian'
  return 'inbox'
}

function detectRawBucket(entry = {}) {
  const title = String(entry?.title || '').toLowerCase()
  const markdown = String(entry?.markdown || '').toLowerCase()
  const content = String(entry?.content || '').toLowerCase()
  const text = `${title} ${markdown} ${content}`
  if (/\.(png|jpg|jpeg|gif|webp|mp4|mov|avi|mkv|mp3|wav)\b/.test(text) || /视频|图像|图片|媒体|media/.test(text)) return 'media'
  if (/\.(pdf|doc|docx|txt|md)\b/.test(text) || /论文|白皮书|paper|research/.test(text)) return 'papers'
  if (/书|book|专著|isbn/.test(text)) return 'books'
  return 'papers'
}

function toWikiSectionLabel(section = '') {
  const key = String(section || '').toLowerCase()
  return WIKI_SECTION_LABELS[key] || `${section}`
}

function slugifyHeading(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function buildMarkdownToc(markdown = '') {
  const lines = String(markdown || '').split('\n')
  const toc = []
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)\s*$/)
    if (!m) continue
    const level = m[1].length
    const text = String(m[2] || '').trim()
    if (!text) continue
    toc.push({ level, text, id: slugifyHeading(text) })
  }
  return toc
}

function toLogDayKey(text = '') {
  const raw = String(text || '').trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function resolveLogBucket(entry = {}) {
  const tags = Array.isArray(entry?.tags) ? entry.tags.map((x) => String(x).toLowerCase()) : []
  const sourceType = String(entry?.sourceType || '').toLowerCase()
  const title = String(entry?.title || '').toLowerCase()
  const markdown = String(entry?.markdown || '').toLowerCase()
  if (tags.includes('failed') || title.includes('失败') || markdown.includes('失败') || sourceType === 'system') return 'error'
  if (tags.includes('chat') || sourceType === 'chat') return 'session'
  return 'operation'
}

function buildOverviewStats(entries = []) {
  const rows = Array.isArray(entries) ? entries : []
  const bySection = new Map()
  const byStatus = new Map()
  const bySource = new Map()
  let totalSources = 0
  for (const item of rows) {
    const sec = normalizeWikiSection(item?.category)
    bySection.set(sec, (bySection.get(sec) || 0) + 1)
    const status = String(item?.status || '待确认')
    byStatus.set(status, (byStatus.get(status) || 0) + 1)
    const sourceType = String(item?.sourceType || 'manual')
    bySource.set(sourceType, (bySource.get(sourceType) || 0) + 1)
    totalSources += Number(item?.sourceCount || 0) || 0
  }
  const total = rows.length
  const confirmed = byStatus.get('已确认') || 0
  const pending = byStatus.get('待确认') || 0
  const confirmRate = total > 0 ? `${Math.round((confirmed / total) * 100)}%` : '0%'
  const topSection = [...bySection.entries()].sort((a, b) => b[1] - a[1])[0] || ['-', 0]
  const sectionList = WIKI_SECTIONS.map((key) => ({ key, label: toWikiSectionLabel(key), count: bySection.get(key) || 0 }))
  const sourceList = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count }))
  return { total, confirmed, pending, confirmRate, totalSources, topSection, sectionList, sourceList }
}

function pickFirstUrl(text = '') {
  const matched = String(text || '').match(/https?:\/\/[^\s)]+/i)
  return matched ? String(matched[0] || '').trim() : ''
}

function WikiWorkbenchHome() {
  const graphRef = useRef(null)
  const markdownRef = useRef(null)
  const [entries, setEntries] = useState([])
  const [keyword, setKeyword] = useState('')
  const [activeEntry, setActiveEntry] = useState(null)
  const [section, setSection] = useState('sources')
  const [expandedKeys, setExpandedKeys] = useState([])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveCategory, setMoveCategory] = useState('entities')
  const [graphScope, setGraphScope] = useState('all')
  const [graphVisible, setGraphVisible] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphSyncing, setGraphSyncing] = useState(false)
  const [exportingObsidian, setExportingObsidian] = useState(false)
  const [exportObsidianOpen, setExportObsidianOpen] = useState(false)
  const [exportObsidianPath, setExportObsidianPath] = useState('E:\\workspaceCodeing\\LLM-wiki')
  const [importObsidianOpen, setImportObsidianOpen] = useState(false)
  const [importingObsidian, setImportingObsidian] = useState(false)
  const [importObsidianPath, setImportObsidianPath] = useState('E:\\workspaceCodeing\\LLM-wiki')
  const [importSelectedFolders, setImportSelectedFolders] = useState(['09-Obsidian wiki'])
  const [graphData, setGraphData] = useState({ nodes: [], links: [] })
  const [activeGraphNodeId, setActiveGraphNodeId] = useState('')
  const [sectionCounts, setSectionCounts] = useState({
    raw: 0,
    inbox: 0,
    sources: 0,
    entities: 0,
    concepts: 0,
    comparisons: 0,
    overview: 0,
    logs: 0,
    obsidian: 0,
  })

  useEffect(() => {
    let alive = true
    Promise.all([fetchLlmWikiEntries(), fetchLlmWikiSectionCounts()])
      .then(([rows, counts]) => {
        if (!alive) return
        const list = Array.isArray(rows) ? rows : []
        setEntries(list)
        setSectionCounts({
          raw: Number(counts?.raw || 0),
          inbox: Number(counts?.inbox || 0),
          sources: Number(counts?.sources || 0),
          entities: Number(counts?.entities || 0),
          concepts: Number(counts?.concepts || 0),
          comparisons: Number(counts?.comparisons || 0),
          overview: Number(counts?.overview || 0),
          logs: Number(counts?.logs || 0),
          obsidian: Number(counts?.obsidian || 0),
        })
        setActiveEntry(list[0] || null)
      })
      .catch((error) => message.error(error?.message || '加载Wiki词条失败'))
    return () => { alive = false }
  }, [])

  const reloadWorkbenchGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const data = await fetchLlmWikiGraph()
      const next = data && typeof data === 'object' ? data : { nodes: [], links: [] }
      const apiGraph = {
        nodes: Array.isArray(next.nodes) ? next.nodes : [],
        links: Array.isArray(next.links) ? next.links : [],
      }
      const fallbackGraph = buildGraphData(entries)
      const resolvedGraph = apiGraph.nodes.length > 0 ? apiGraph : fallbackGraph
      setGraphData(resolvedGraph)
      window.setTimeout(() => {
        graphRef.current?.zoomToFit?.(500, 50)
      }, 180)
    } catch (error) {
      message.error(error?.message || '读取图谱失败')
    } finally {
      setGraphLoading(false)
    }
  }, [entries])

  useEffect(() => {
    if (!graphVisible) return
    reloadWorkbenchGraph()
  }, [graphVisible, reloadWorkbenchGraph])
  const displayGraphData = useMemo(() => {
    let baseGraph = graphData
    if (graphScope === 'all') {
      baseGraph = graphData
    } else {
    const activeSection = String(section || '')
      if (!activeSection || activeSection === 'inbox') {
        baseGraph = graphData
      } else {
        const nodes = (Array.isArray(graphData.nodes) ? graphData.nodes : []).filter((node) => (
          normalizeWikiSection(node?.category) === activeSection
        ))
        if (nodes.length === 0) {
          baseGraph = graphData
        } else {
          const idSet = new Set(nodes.map((x) => String(x.id || '')))
          const links = (Array.isArray(graphData.links) ? graphData.links : []).filter((link) => (
            idSet.has(String(link?.source || '')) && idSet.has(String(link?.target || ''))
          ))
          if (links.length === 0 && nodes.length <= 1) {
            baseGraph = graphData
          } else {
            baseGraph = { nodes, links }
          }
        }
      }
    }

    let currentNodes = Array.isArray(baseGraph?.nodes) ? baseGraph.nodes : []
    let currentLinks = Array.isArray(baseGraph?.links) ? baseGraph.links : []
    if (!graphVisible || !activeEntry?.key || currentNodes.length === 0) return baseGraph

    const selectedId = String(activeEntry.key || '')
    const selectedTitle = String(activeEntry.title || '').trim()
    let selectedNode = currentNodes.find((n) => String(n?.id || '') === selectedId)
      || currentNodes.find((n) => String(n?.title || '').trim() === selectedTitle)
    if (!selectedNode) {
      const fallback = buildGraphData(entries)
      currentNodes = Array.isArray(fallback?.nodes) ? fallback.nodes : []
      currentLinks = Array.isArray(fallback?.links) ? fallback.links : []
      selectedNode = currentNodes.find((n) => String(n?.id || '') === selectedId)
        || currentNodes.find((n) => String(n?.title || '').trim() === selectedTitle)
    }
    if (!selectedNode) return baseGraph

    const selectedNodeId = String(selectedNode.id || '')
    const touchingLinks = currentLinks.filter((link) => {
      const s = String(link?.source || '')
      const t = String(link?.target || '')
      return s === selectedNodeId || t === selectedNodeId
    })
    const nonTagLinks = touchingLinks.filter((x) => String(x?.relationType || '') !== 'tag_cooccurrence')
    const fallbackTagLinks = touchingLinks.filter((x) => String(x?.relationType || '') === 'tag_cooccurrence')
    const sortByWeight = (a, b) => Number(b?.weight || 0) - Number(a?.weight || 0)
    const sortedTouchingLinks = [
      ...nonTagLinks.sort(sortByWeight),
      ...fallbackTagLinks.sort(sortByWeight),
    ]
    const maxNeighborCount = 8
    const neighborIdSet = new Set()
    const focusLinks = []
    for (const link of sortedTouchingLinks) {
      const s = String(link?.source || '')
      const t = String(link?.target || '')
      const other = s === selectedNodeId ? t : s
      if (!other || other === selectedNodeId) continue
      if (!neighborIdSet.has(other) && neighborIdSet.size >= maxNeighborCount) continue
      neighborIdSet.add(other)
      focusLinks.push(link)
    }
    const focusIdSet = new Set([selectedNodeId, ...neighborIdSet])
    const focusNodes = currentNodes.filter((n) => focusIdSet.has(String(n?.id || '')))
    if (focusNodes.length <= 1) return { nodes: [selectedNode], links: [] }
    return { nodes: focusNodes, links: focusLinks }
  }, [graphData, graphScope, section, activeEntry, graphVisible, entries])
  useEffect(() => {
    if (!graphVisible) return
    const nodes = Array.isArray(displayGraphData?.nodes) ? displayGraphData.nodes : []
    if (!nodes.length) return
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit?.(500, 50)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [graphVisible, displayGraphData])
  useEffect(() => {
    if (!graphVisible) return
    const id = String(activeEntry?.key || '')
    const title = String(activeEntry?.title || '').trim()
    const nodes = Array.isArray(displayGraphData?.nodes) ? displayGraphData.nodes : []
    if (!nodes.length) {
      setActiveGraphNodeId('')
      return
    }
    const hit = nodes.find((n) => String(n?.id || '') === id)
      || nodes.find((n) => String(n?.title || '').trim() === title)
    if (!hit) {
      setActiveGraphNodeId('')
      return
    }
    setActiveGraphNodeId(String(hit.id || ''))
    window.requestAnimationFrame(() => {
      const x = Number(hit?.x)
      const y = Number(hit?.y)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        graphRef.current?.centerAt(x, y, 350)
        graphRef.current?.zoom(2.2, 350)
      }
    })
  }, [activeEntry, displayGraphData, graphVisible])
  const treeData = useMemo(() => {
    const kw = String(keyword || '').trim().toLowerCase()
    const expandedSet = new Set((Array.isArray(expandedKeys) ? expandedKeys : []).map((x) => String(x)))
    return WIKI_SECTIONS.map((sec) => {
      const sectionRows = entries
        .filter((item) => {
          if (sec === 'raw') return normalizeWikiSection(item.category) === 'raw'
          return normalizeWikiSection(item.category) === sec
        })
        .filter((item) => {
          if (!kw) return true
          return `${item.title || ''} ${item.content || ''} ${item.markdown || ''}`.toLowerCase().includes(kw)
        })
      const shouldBuildChildren = kw.length > 0 || expandedSet.has(`section:${sec}`)
      let docs = shouldBuildChildren ? sectionRows.map((item) => ({
        key: `doc:${item.key}`,
        title: (item.title || '(未命名词条)'),
        isLeaf: true,
        entry: item,
      })) : []
      if (sec === 'logs' && shouldBuildChildren) {
        const dayMap = new Map()
        for (const row of sectionRows) {
          const day = toLogDayKey(row?.updatedAt)
          if (!dayMap.has(day)) dayMap.set(day, [])
          dayMap.get(day).push(row)
        }
        const dayNodes = [...dayMap.entries()]
          .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
          .map(([day, rows]) => {
            const bucketMap = new Map([
              ['operation', []],
              ['session', []],
              ['error', []],
            ])
            for (const row of rows) {
              const bucket = resolveLogBucket(row)
              if (!bucketMap.has(bucket)) bucketMap.set(bucket, [])
              bucketMap.get(bucket).push(row)
            }
            const bucketNodes = [
              { key: 'operation', label: '操作日志' },
              { key: 'session', label: '会话日志' },
              { key: 'error', label: '错误日志' },
            ]
              .map((bucket) => {
                const list = bucketMap.get(bucket.key) || []
                return {
                  key: `log-bucket:${day}:${bucket.key}`,
                  title: `${bucket.label} (${list.length})`,
                  children: list.map((item) => ({
                    key: `doc:${item.key}`,
                    title: item.title || '(未命名词条)',
                    isLeaf: true,
                    entry: item,
                  })),
                }
              })
            return {
              key: `log-day:${day}`,
              title: `${day} (${rows.length})`,
              children: bucketNodes,
            }
          })
        docs = dayNodes
      }
      if (sec === 'raw' && shouldBuildChildren) {
        const bucketMap = new Map([
          ['papers', []],
          ['books', []],
          ['media', []],
        ])
        for (const row of sectionRows) {
          const bucket = detectRawBucket(row)
          if (!bucketMap.has(bucket)) bucketMap.set(bucket, [])
          bucketMap.get(bucket).push(row)
        }
        docs = [
          { key: 'papers', label: 'papers 论文/文章' },
          { key: 'books', label: 'books 书籍摘录' },
          { key: 'media', label: 'media 图片/视频' },
        ].map((bucket) => {
          const list = bucketMap.get(bucket.key) || []
          return {
            key: `raw-bucket:${bucket.key}`,
            title: `${bucket.label} (${list.length})`,
            children: list.map((item) => ({
              key: `doc:${item.key}`,
              title: item.title || '(未命名词条)',
              isLeaf: true,
              entry: item,
            })),
          }
        })
      }
      const sectionCount = Number(sectionCounts?.[sec] || 0)
      return {
        key: `section:${sec}`,
        title: `${toWikiSectionLabel(sec)} (${sectionCount})`,
        isLeaf: false,
        children: docs,
      }
    })
  }, [entries, keyword, expandedKeys, sectionCounts])
  useEffect(() => {
    const kw = String(keyword || '').trim()
    if (!kw) {
      setExpandedKeys((prev) => (Array.isArray(prev) && prev.length === 0 ? prev : []))
      return
    }
    const target = WIKI_SECTIONS.map((sec) => `section:${sec}`)
    setExpandedKeys((prev) => {
      const prevList = Array.isArray(prev) ? prev.map((x) => String(x)) : []
      if (prevList.length === target.length && prevList.every((x, idx) => x === target[idx])) return prev
      return target
    })
  }, [keyword])
  const tocItems = useMemo(() => buildMarkdownToc(activeEntry?.markdown || activeEntry?.content || ''), [activeEntry])
  const overviewStats = useMemo(() => buildOverviewStats(entries), [entries])
  const entryMeta = useMemo(() => {
    const row = activeEntry && typeof activeEntry === 'object' ? activeEntry : {}
    const sourceMeta = row?.sourceMeta && typeof row.sourceMeta === 'object' ? row.sourceMeta : {}
    const source = String(sourceMeta.url || sourceMeta.source || sourceMeta.link || '').trim()
      || pickFirstUrl(row?.markdown || row?.content || '')
    const author = String(sourceMeta.author || sourceMeta.owner || '').trim()
    const published = String(sourceMeta.publishedAt || sourceMeta.published || '').trim()
    const created = String(row?.createdAt || row?.updatedAt || '').trim()
    const descriptionRaw = String(row?.content || '').replace(/\s+/g, ' ').trim()
    const description = descriptionRaw.length > 160 ? `${descriptionRaw.slice(0, 160)}...` : descriptionRaw
    return {
      title: String(row?.title || '').trim(),
      source,
      author,
      published,
      created,
      description,
      tags: Array.isArray(row?.tags) ? row.tags.filter(Boolean) : [],
    }
  }, [activeEntry])
  const openEntryFromTree = (row) => {
    if (!row) return
    setActiveEntry(row)
    setSection(normalizeWikiSection(row.category))
    if (!graphVisible) setGraphVisible(true)
    reloadWorkbenchGraph()
  }

  const refreshEntries = () => {
    Promise.all([fetchLlmWikiEntries(), fetchLlmWikiSectionCounts()])
      .then(([rows, counts]) => {
        const list = Array.isArray(rows) ? rows : []
        setSectionCounts({
          raw: Number(counts?.raw || 0),
          inbox: Number(counts?.inbox || 0),
          sources: Number(counts?.sources || 0),
          entities: Number(counts?.entities || 0),
          concepts: Number(counts?.concepts || 0),
          comparisons: Number(counts?.comparisons || 0),
          overview: Number(counts?.overview || 0),
          logs: Number(counts?.logs || 0),
          obsidian: Number(counts?.obsidian || 0),
        })
        setEntries(list)
        if (activeEntry?.key) {
          const hit = list.find((x) => x.key === activeEntry.key)
          setActiveEntry(hit || list[0] || null)
        } else {
          setActiveEntry(list[0] || null)
        }
      })
      .catch((error) => message.error(error?.message || '刷新词条失败'))
  }

  const startRename = (entry) => {
    if (!entry) return
    setActiveEntry(entry)
    setRenameTitle(entry.title || '')
    setRenameOpen(true)
  }
  const submitRename = async () => {
    const nextTitle = String(renameTitle || '').trim()
    if (!nextTitle || !activeEntry?.key) return
    await saveLlmWikiEntry({ ...activeEntry, title: nextTitle })
    setRenameOpen(false)
    message.success('重命名成功')
    refreshEntries()
  }
  const startMove = (entry) => {
    if (!entry) return
    setActiveEntry(entry)
    setMoveCategory(normalizeWikiSection(entry.category || 'entities'))
    setMoveOpen(true)
  }
  const submitMove = async () => {
    if (!activeEntry?.key) return
    await saveLlmWikiEntry({ ...activeEntry, category: moveCategory })
    setMoveOpen(false)
    message.success('分类移动成功')
    refreshEntries()
  }
  const removeEntry = async (entry) => {
    if (!entry?.key) return
    await deleteLlmWikiEntry(entry.key)
    message.success('词条已删除')
    refreshEntries()
  }
  const confirmClearSection = (sec) => {
    Modal.confirm({
      title: `确认清空 ${toWikiSectionLabel(sec)} 吗？`,
      content: '该分类下词条会被真正删除，无法恢复。',
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await clearLlmWikiEntriesBySection(sec)
          message.success(`已清空 ${toWikiSectionLabel(sec)}，删除 ${Number(result?.deletedCount || 0)} 条`)
          refreshEntries()
        } catch (error) {
          message.error(error?.message || '清空分类失败')
        }
      },
    })
  }

  const handleExportObsidian = async () => {
    setExportObsidianOpen(true)
  }

  const handleImportObsidian = async () => {
    setImportObsidianOpen(true)
  }

  const submitExportObsidian = async () => {
    if (exportingObsidian) return
    const targetPath = String(exportObsidianPath || '').trim()
    if (!targetPath) {
      message.warning('请填写导出路径')
      return
    }
    setExportingObsidian(true)
    try {
      const result = await exportLlmWikiObsidianToPath(targetPath)
      setExportObsidianOpen(false)
      message.success(`已导出 ${Number(result?.exportedCount || 0)} 条到：${result?.targetPath || targetPath}`)
    } catch (error) {
      message.error(error?.message || '导出 Obsidian 失败')
    } finally {
      setExportingObsidian(false)
    }
  }

  const submitImportObsidian = async () => {
    if (importingObsidian) return
    const rootPath = String(importObsidianPath || '').trim()
    const selectedFolders = Array.isArray(importSelectedFolders) ? importSelectedFolders.map((x) => String(x)).filter(Boolean) : []
    if (!rootPath) {
      message.warning('请填写 Obsidian 根目录')
      return
    }
    if (selectedFolders.length === 0) {
      message.warning('请至少选择一个目录')
      return
    }
    setImportingObsidian(true)
    try {
      const result = await importLlmWikiObsidianFromPath({
        rootPath,
        selectedFolders,
      })
      setImportObsidianOpen(false)
      message.success(`导入完成：新增 ${Number(result?.insertedWiki || 0)}，更新 ${Number(result?.updatedWiki || 0)}，文件 ${Number(result?.fileCount || 0)} 条`)
      refreshEntries()
    } catch (error) {
      message.error(error?.message || '导入 Obsidian 失败')
    } finally {
      setImportingObsidian(false)
    }
  }

  return (
    <Row gutter={12} style={{ height: WIKI_PANEL_HEIGHT }}>
      <Col span={5} style={{ height: '100%', display: 'flex' }}>
        <Card
          className="app-elevated-card wiki-tree-card"
          headStyle={{ minHeight: 'auto', paddingTop: 10, paddingBottom: 10 }}
          title={(
            <div style={{ width: '100%' }}>
              <div style={{ marginBottom: 6 }}>{`知识树 (${Object.values(sectionCounts || {}).reduce((sum, n) => sum + Number(n || 0), 0)})`}</div>
              <Space size={6}>
                <Button size="small" type="primary" onClick={handleExportObsidian} loading={exportingObsidian}>导出</Button>
                <Button size="small" onClick={handleImportObsidian}>导入</Button>
              </Space>
            </div>
          )}
          style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          <Space size={8} style={{ marginBottom: 8 }}>
            <Input.Search
              allowClear
              placeholder="搜索 Wiki 页面..."
              style={{ width: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button size="small" onClick={refreshEntries}>刷新</Button>
          </Space>
          <div style={{ height: '100%', overflowY: 'auto', paddingRight: 6 }}>
          <Tree
            style={{ marginBottom: 10 }}
            treeData={treeData}
            blockNode
            virtual
            expandAction="click"
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(Array.isArray(keys) ? keys : [])}
            selectedKeys={activeEntry?.key ? [`doc:${activeEntry.key}`] : []}
            onSelect={(keys, info) => {
              const infoKey = String(info?.node?.key || '')
              if (infoKey.startsWith('section:')) {
                setSection(infoKey.replace('section:', ''))
                if (!graphVisible) setGraphVisible(true)
                reloadWorkbenchGraph()
                return
              }
              if (Array.isArray(keys) && keys.length > 0) {
                const k = String(keys[0] || '')
                if (k.startsWith('section:')) {
                  setSection(k.replace('section:', ''))
                  if (!graphVisible) setGraphVisible(true)
                  reloadWorkbenchGraph()
                  return
                }
              }
              openEntryFromTree(info?.node?.entry)
            }}
              titleRender={(node) => {
                const entry = node?.entry
                if (!entry) {
                  const nodeKey = String(node?.key || '')
                  if (nodeKey.startsWith('section:')) {
                    const sec = nodeKey.replace('section:', '')
                    return (
                      <Dropdown
                        trigger={['contextMenu']}
                        menu={{
                          items: [{ key: 'clear-section', label: '清空分类' }],
                          onClick: ({ key }) => {
                            if (key !== 'clear-section') return
                            confirmClearSection(sec)
                          },
                        }}
                      >
                        <span style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span>{node.title}</span>
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<CloseCircleOutlined style={{ fontSize: 12 }} />}
                            aria-label={`清空${toWikiSectionLabel(sec)}`}
                            style={{
                              padding: 0,
                              minWidth: 14,
                              width: 14,
                              height: 14,
                              border: 'none',
                              boxShadow: 'none',
                              background: 'transparent',
                              color: '#bfbfbf',
                            }}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              confirmClearSection(sec)
                            }}
                          />
                        </span>
                      </Dropdown>
                    )
                  }
                  return <span>{node.title}</span>
                }
                const label = String(node.title || '')
                const kw = String(keyword || '').trim()
                const idx = kw ? label.toLowerCase().indexOf(kw.toLowerCase()) : -1
                let rendered = label
                if (idx >= 0) {
                  const pre = label.slice(0, idx)
                  const hit = label.slice(idx, idx + kw.length)
                  const post = label.slice(idx + kw.length)
                  rendered = `${pre}[[[${hit}]]]${post}`
                }
                const content = typeof rendered === 'string' && rendered.includes('[[[')
                  ? (() => {
                    const m = rendered.match(/^(.*)\[\[\[(.*)\]\]\](.*)$/)
                    if (!m) return <span>{label}</span>
                    return (
                      <span>
                        {m[1]}
                        <span style={{ background: '#fde68a', borderRadius: 4, padding: '0 2px' }}>{m[2]}</span>
                        {m[3]}
                      </span>
                    )
                  })()
                  : <span>{label}</span>
                return (
                  <Dropdown
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'rename', label: '重命名' },
                        { key: 'move', label: '移动分类' },
                        { key: 'delete', label: '删除词条' },
                      ],
                      onClick: async ({ key }) => {
                        if (key === 'rename') startRename(entry)
                        else if (key === 'move') startMove(entry)
                        else if (key === 'delete') {
                          try { await removeEntry(entry) } catch (error) { message.error(error?.message || '删除失败') }
                        }
                      },
                    }}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        openEntryFromTree(entry)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openEntryFromTree(entry)
                        }
                      }}
                      style={{ display: 'inline-block', width: '100%' }}
                    >
                      {content}
                    </span>
                  </Dropdown>
                )
              }}
            />
          </div>
        </Card>
        <Modal
          title="导出至 Obsidian"
          open={exportObsidianOpen}
          onCancel={() => setExportObsidianOpen(false)}
          footer={(
            <Space>
              <Button onClick={() => setExportObsidianOpen(false)}>关闭</Button>
              <Button type="primary" loading={exportingObsidian} onClick={submitExportObsidian}>导出</Button>
            </Space>
          )}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Text type="secondary">请选择 Obsidian Vault 目录</Text>
            <Input value={exportObsidianPath} onChange={(e) => setExportObsidianPath(e.target.value)} placeholder="例如：E:\\workspaceCodeing\\LLM-wiki" />
          </Space>
        </Modal>
        <Modal
          title="导入 Obsidian"
          open={importObsidianOpen}
          onCancel={() => setImportObsidianOpen(false)}
          footer={(
            <Space>
              <Button onClick={() => setImportObsidianOpen(false)}>关闭</Button>
              <Button type="primary" loading={importingObsidian} onClick={submitImportObsidian}>导入</Button>
            </Space>
          )}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Text type="secondary">请选择 Obsidian 目录（可多选）</Text>
            <Space size={8}>
              <Button size="small" onClick={() => setImportSelectedFolders([...OBSIDIAN_IMPORT_FOLDERS])}>全选</Button>
              <Button size="small" onClick={() => setImportSelectedFolders([])}>清空</Button>
            </Space>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="请选择要导入的目录"
              value={importSelectedFolders}
              options={OBSIDIAN_IMPORT_FOLDERS.map((name) => ({ label: name, value: name }))}
              onChange={(vals) => setImportSelectedFolders(Array.isArray(vals) ? vals.map((x) => String(x)) : [])}
              maxTagCount="responsive"
            />
          </Space>
        </Modal>
      </Col>
      <Col span={11} style={{ height: '100%', display: 'flex' }}>
        <Card
          className="app-elevated-card"
          title={section === 'overview' ? '总览 Overview' : (activeEntry?.title || '文档预览')}
          style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, minHeight: 0 }}
          extra={(
            section === 'overview' ? null : null
          )}
        >
          {section === 'overview' ? (
            <div style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}>
              <Row gutter={[10, 10]}>
                <Col span={8}><Card size="small" title="词条总数">{overviewStats.total}</Card></Col>
                <Col span={8}><Card size="small" title="已确认">{overviewStats.confirmed}</Card></Col>
                <Col span={8}><Card size="small" title="待确认">{overviewStats.pending}</Card></Col>
                <Col span={8}><Card size="small" title="确认率">{overviewStats.confirmRate}</Card></Col>
                <Col span={8}><Card size="small" title="来源累计">{overviewStats.totalSources}</Card></Col>
                <Col span={8}><Card size="small" title="最大分类">{`${overviewStats.topSection[0]} (${overviewStats.topSection[1]})`}</Card></Col>
              </Row>
              <Row gutter={[10, 10]} style={{ marginTop: 6 }}>
                <Col span={12}>
                  <Card size="small" title="分类统计">
                    {overviewStats.sectionList.map((item) => (
                      <Row key={item.key} justify="space-between" style={{ marginBottom: 4 }}>
                        <Text>{item.label}</Text>
                        <Text strong>{item.count}</Text>
                      </Row>
                    ))}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" title="来源类型统计">
                    {overviewStats.sourceList.length === 0 ? <Text type="secondary">暂无来源类型数据</Text> : overviewStats.sourceList.map((item) => (
                      <Row key={item.key} justify="space-between" style={{ marginBottom: 4 }}>
                        <Text>{item.key}</Text>
                        <Text strong>{item.count}</Text>
                      </Row>
                    ))}
                  </Card>
                </Col>
              </Row>
            </div>
          ) : (
            <div ref={markdownRef} style={{ height: '100%', overflowY: 'auto', paddingRight: 8 }}>
              <Card
                size="small"
                style={{ marginBottom: 10 }}
                bodyStyle={{ padding: 10 }}
              >
                <Row gutter={[8, 8]}>
                  <Col span={6}><Text type="secondary">title</Text></Col>
                  <Col span={18}><Text>{entryMeta.title || '暂无值'}</Text></Col>
                  <Col span={6}><Text type="secondary">source</Text></Col>
                  <Col span={18}>
                    {entryMeta.source ? <a href={entryMeta.source} target="_blank" rel="noreferrer">{entryMeta.source}</a> : <Text>暂无值</Text>}
                  </Col>
                  <Col span={6}><Text type="secondary">author</Text></Col>
                  <Col span={18}><Text>{entryMeta.author || '暂无值'}</Text></Col>
                  <Col span={6}><Text type="secondary">published</Text></Col>
                  <Col span={18}><Text>{entryMeta.published || '暂无值'}</Text></Col>
                  <Col span={6}><Text type="secondary">created</Text></Col>
                  <Col span={18}><Text>{entryMeta.created || '暂无值'}</Text></Col>
                  <Col span={6}><Text type="secondary">description</Text></Col>
                  <Col span={18}><Text>{entryMeta.description || '暂无值'}</Text></Col>
                  <Col span={6}><Text type="secondary">tags</Text></Col>
                  <Col span={18}>
                    {entryMeta.tags.length > 0
                      ? entryMeta.tags.map((item) => <Tag key={String(item)}>{String(item)}</Tag>)
                      : <Text>暂无值</Text>}
                  </Col>
                </Row>
              </Card>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => {
                    const text = Array.isArray(children) ? children.join('') : String(children || '')
                    return <h1 id={slugifyHeading(text)}>{children}</h1>
                  },
                  h2: ({ children }) => {
                    const text = Array.isArray(children) ? children.join('') : String(children || '')
                    return <h2 id={slugifyHeading(text)}>{children}</h2>
                  },
                  h3: ({ children }) => {
                    const text = Array.isArray(children) ? children.join('') : String(children || '')
                    return <h3 id={slugifyHeading(text)}>{children}</h3>
                  },
                }}
              >
                {activeEntry?.markdown || activeEntry?.content || '请选择左侧文档进行预览。'}
              </ReactMarkdown>
            </div>
          )}
        </Card>
      </Col>
      <Col span={8} style={{ height: '100%', display: 'flex' }}>
        <Card
          className="app-elevated-card"
          title="关系图谱"
          style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
          extra={(
            <Space>
              <Select
                size="small"
                style={{ width: 110 }}
                value={graphScope}
                options={[
                  { label: '当前目录', value: 'section' },
                  { label: '全量词条', value: 'all' },
                ]}
                onChange={setGraphScope}
              />
              <Button size="small" onClick={() => graphRef.current?.zoomToFit(400)}>适配</Button>
              <Button
                size="small"
                loading={graphSyncing}
                onClick={() => {
                  setGraphSyncing(true)
                  syncLlmWikiGraph()
                    .then((summary) => {
                      message.success(`图谱同步完成：节点 ${Number(summary?.nodeCount || 0)}，关系 ${Number(summary?.edgeCount || 0)}`)
                      if (!graphVisible) setGraphVisible(true)
                      return fetchLlmWikiGraph()
                    })
                    .then((data) => {
                      const next = data && typeof data === 'object' ? data : { nodes: [], links: [] }
                      const apiGraph = {
                        nodes: Array.isArray(next.nodes) ? next.nodes : [],
                        links: Array.isArray(next.links) ? next.links : [],
                      }
                      const fallbackGraph = buildGraphData(entries)
                      const resolvedGraph = apiGraph.nodes.length > 0 ? apiGraph : fallbackGraph
                      setGraphData(resolvedGraph)
                    })
                    .catch((error) => message.error(error?.message || '图谱同步失败'))
                    .finally(() => setGraphSyncing(false))
                }}
              >
                同步
              </Button>
              <Button
                size="small"
                type={graphVisible ? 'default' : 'primary'}
                onClick={() => {
                  if (!graphVisible) setGraphVisible(true)
                  reloadWorkbenchGraph()
                }}
              >
                显示图谱
              </Button>
            </Space>
          )}
          bodyStyle={{ flex: 1, minHeight: 0, padding: 0 }}
        >
          <div style={{ height: '100%', background: '#0b1220', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
            {graphVisible ? (
              <ForceGraph2D
                key={`workbench-graph-${graphScope}-${String(activeEntry?.key || activeEntry?.title || 'none')}`}
                ref={graphRef}
                graphData={displayGraphData}
                backgroundColor="#0b1220"
                linkColor={() => 'rgba(148,163,184,0.3)'}
                nodeColor={(node) => (String(node?.id || '') === activeGraphNodeId ? '#fde047' : nodeColorByCategory(node.category))}
                nodeRelSize={6}
                nodeCanvasObjectMode={(node) => (String(node?.id || '') === activeGraphNodeId ? 'after' : undefined)}
                nodeCanvasObject={(node, ctx, globalScale) => {
                  if (String(node?.id || '') !== activeGraphNodeId) return
                  const label = String(node?.title || '')
                  if (!label) return
                  const fontSize = Math.max(10, 12 / globalScale)
                  ctx.font = `${fontSize}px sans-serif`
                  ctx.fillStyle = '#fef08a'
                  ctx.fillText(label, Number(node.x || 0) + 8, Number(node.y || 0) + 4)
                }}
                nodeLabel={(node) => `${node.title}\n${node.category || ''}`}
                onNodeClick={(node) => {
                  const hit = entries.find((x) => String(x.key) === String(node.id) || String(x.title || '') === String(node.title || ''))
                  if (hit) setActiveEntry(hit)
                }}
              />
            ) : (
              <div style={{ color: '#cbd5e1', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                点击“显示图谱”后再加载关系图谱
              </div>
            )}
            {graphLoading ? (
              <div style={{ position: 'absolute', right: 8, top: 8, color: '#cbd5e1', fontSize: 12 }}>加载中...</div>
            ) : null}
          </div>
        </Card>
      </Col>
      <Modal
        title="重命名词条"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={submitRename}
        okText="保存"
      >
        <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} />
      </Modal>
      <Modal
        title="移动分类"
        open={moveOpen}
        onCancel={() => setMoveOpen(false)}
        onOk={submitMove}
        okText="保存"
      >
        <Select
          style={{ width: '100%' }}
          value={moveCategory}
          options={[
            { label: toWikiSectionLabel('sources'), value: 'sources' },
            { label: toWikiSectionLabel('entities'), value: 'entities' },
            { label: toWikiSectionLabel('concepts'), value: 'concepts' },
            { label: toWikiSectionLabel('comparisons'), value: 'comparisons' },
            { label: toWikiSectionLabel('overview'), value: 'overview' },
            { label: toWikiSectionLabel('logs'), value: 'logs' },
            { label: toWikiSectionLabel('inbox'), value: 'inbox' },
          ]}
          onChange={setMoveCategory}
        />
      </Modal>
    </Row>
  )
}

function WikiGraphView({ entries = [] }) {
  const graphRef = useRef(null)
  const autoFitRef = useRef(false)
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [onlyConfirmed, setOnlyConfirmed] = useState(false)
  const [activeId, setActiveId] = useState('')
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphSyncing, setGraphSyncing] = useState(false)
  const [graphData, setGraphData] = useState({ nodes: [], links: [] })

  const categoryOptions = useMemo(() => {
    const set = new Set(entries.map((x) => String(x.category || '').trim()).filter(Boolean))
    return [{ label: '全部分类', value: 'all' }, ...Array.from(set).map((x) => ({ label: x, value: x }))]
  }, [entries])

  const statusOptions = useMemo(() => {
    const set = new Set(entries.map((x) => String(x.status || '').trim()).filter(Boolean))
    return [{ label: '全部状态', value: 'all' }, ...Array.from(set).map((x) => ({ label: x, value: x }))]
  }, [entries])

  useEffect(() => {
    let alive = true
    setGraphLoading(true)
    fetchLlmWikiGraph({
      category: category === 'all' ? undefined : category,
      status: status === 'all' ? undefined : status,
      keyword,
      onlyConfirmed,
    })
      .then((data) => {
        if (!alive) return
        const next = data && typeof data === 'object' ? data : { nodes: [], links: [] }
        const apiGraph = {
          nodes: Array.isArray(next.nodes) ? next.nodes : [],
          links: Array.isArray(next.links) ? next.links : [],
        }
        const fallbackGraph = buildGraphData(entries, { category, status, keyword, onlyConfirmed })
        const resolvedGraph = apiGraph.nodes.length > 0 ? apiGraph : fallbackGraph
        setGraphData(resolvedGraph)
      })
      .catch((error) => {
        if (!alive) return
        message.error(error?.message || '读取图谱失败')
      })
      .finally(() => {
        if (alive) setGraphLoading(false)
      })
    return () => { alive = false }
  }, [category, status, keyword, onlyConfirmed, entries])

  useEffect(() => {
    const nodeCount = Array.isArray(graphData?.nodes) ? graphData.nodes.length : 0
    if (nodeCount <= 0) {
      autoFitRef.current = false
      return
    }
    const timer = setTimeout(() => {
      graphRef.current?.zoomToFit?.(500, 40)
      autoFitRef.current = true
    }, 180)
    return () => clearTimeout(timer)
  }, [graphData])
  const activeNode = useMemo(() => graphData.nodes.find((x) => x.id === activeId) || null, [graphData, activeId])

  return (
    <Row gutter={12}>
      <Col span={18}>
        <Card
          className="app-elevated-card"
          title="知识图谱"
          extra={(
            <Space wrap>
              <Select size="small" style={{ width: 130 }} value={category} options={categoryOptions} onChange={setCategory} />
              <Select size="small" style={{ width: 120 }} value={status} options={statusOptions} onChange={setStatus} />
              <Input.Search size="small" allowClear placeholder="关键词" style={{ width: 140 }} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <Switch size="small" checked={onlyConfirmed} onChange={setOnlyConfirmed} checkedChildren="仅已确认" unCheckedChildren="全部" />
              <Button size="small" onClick={() => graphRef.current?.zoomToFit(400)}>适配视图</Button>
              <Button
                size="small"
                loading={graphSyncing}
                onClick={() => {
                  setGraphSyncing(true)
                  syncLlmWikiGraph()
                    .then((summary) => {
                      message.success(`图谱同步完成：节点 ${Number(summary?.nodeCount || 0)}，关系 ${Number(summary?.edgeCount || 0)}`)
                      return fetchLlmWikiGraph({
                        category: category === 'all' ? undefined : category,
                        status: status === 'all' ? undefined : status,
                        keyword,
                        onlyConfirmed,
                      })
                    })
                    .then((data) => {
                      const next = data && typeof data === 'object' ? data : { nodes: [], links: [] }
                      const apiGraph = {
                        nodes: Array.isArray(next.nodes) ? next.nodes : [],
                        links: Array.isArray(next.links) ? next.links : [],
                      }
                      const fallbackGraph = buildGraphData(entries, { category, status, keyword, onlyConfirmed })
                      const resolvedGraph = apiGraph.nodes.length > 0 ? apiGraph : fallbackGraph
                      setGraphData(resolvedGraph)
                    })
                    .catch((error) => message.error(error?.message || '图谱同步失败'))
                    .finally(() => setGraphSyncing(false))
                }}
              >
                同步
              </Button>
            </Space>
          )}
          bodyStyle={{ padding: 0 }}
        >
          <div style={{ height: 560, background: '#0b1220', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              backgroundColor="#0b1220"
              cooldownTicks={120}
              d3VelocityDecay={0.35}
              linkColor={() => 'rgba(148,163,184,0.30)'}
              linkWidth={(link) => Math.min(2.2, 0.8 + Number(link.weight || 0) * 0.2)}
              nodeRelSize={5}
              nodeVal={(node) => Math.max(2, Math.min(12, Number(node.sourceCount || 0) + 2))}
              nodeLabel={(node) => `${node.title}\n分类：${node.category}\n状态：${node.status}`}
              nodeColor={(node) => nodeColorByCategory(node.category)}
              onNodeClick={(node) => setActiveId(String(node.id || ''))}
              onEngineStop={() => {
                if (autoFitRef.current) return
                graphRef.current?.zoomToFit?.(450, 40)
                autoFitRef.current = true
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = String(node.title || '')
                const fontSize = 11 / globalScale
                ctx.font = `${fontSize}px sans-serif`
                ctx.fillStyle = nodeColorByCategory(node.category)
                ctx.beginPath()
                ctx.arc(node.x, node.y, Math.max(2, Math.min(6, Number(node.sourceCount || 0) * 0.5 + 2)), 0, 2 * Math.PI, false)
                ctx.fill()
                if (globalScale > 1.8) {
                  ctx.fillStyle = 'rgba(255,255,255,0.85)'
                  ctx.fillText(label, node.x + 4, node.y + 3)
                }
              }}
            />
            {graphLoading ? (
              <div style={{ position: 'absolute', right: 8, top: 8, color: '#cbd5e1', fontSize: 12 }}>加载中...</div>
            ) : null}
          </div>
        </Card>
      </Col>
      <Col span={6}>
        <Card className="app-elevated-card" title="节点详情">
          {activeNode ? (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text strong>{activeNode.title}</Text>
              <Text type="secondary">分类：{activeNode.category}</Text>
              <Text type="secondary">状态：{activeNode.status}</Text>
              <Text type="secondary">来源数：{activeNode.sourceCount}</Text>
              <Text type="secondary">更新时间：{activeNode.updatedAt || '-'}</Text>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{activeNode.content || '-'}</Text>
            </Space>
          ) : (
            <Text type="secondary">点击图谱中的节点查看详情。</Text>
          )}
        </Card>
      </Col>
    </Row>
  )
}

function WikiLibraryView({ initialMode = 'list' }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeEntry, setActiveEntry] = useState(null)
  const [mode, setMode] = useState(initialMode === 'graph' ? 'graph' : 'list')
  useEffect(() => {
    setMode(initialMode === 'graph' ? 'graph' : 'list')
  }, [initialMode])
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
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card" bodyStyle={{ padding: 12 }}>
        <Segmented
          options={[
            { label: '列表视图', value: 'list' },
            { label: '图谱视图', value: 'graph' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Card>
      {mode === 'graph' ? (
        <WikiGraphView entries={entries} />
      ) : (
        <Row gutter={12} style={{ height: WIKI_LIST_VIEW_HEIGHT, overflow: 'hidden' }}>
          <Col span={7} style={{ height: '100%' }}>
            <Card
              className="app-elevated-card"
              title="词条目录"
              style={{ height: WIKI_LIST_VIEW_HEIGHT }}
              bodyStyle={{ height: 'calc(100% - 57px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <Input.Search
                allowClear
                placeholder="搜索企业/产品/认证/专题"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <div style={{ marginTop: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <List
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
              </div>
            </Card>
          </Col>
          <Col span={11} style={{ height: '100%' }}>
            <Card
              className="app-elevated-card"
              title={activeEntry?.title || '词条详情'}
              style={{ height: WIKI_LIST_VIEW_HEIGHT }}
              bodyStyle={{ height: 'calc(100% - 57px)', minHeight: 0, overflowY: 'auto' }}
            >
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
          <Col span={6} style={{ height: '100%' }}>
            <Card
              className="app-elevated-card"
              title="词条信息"
              style={{ height: WIKI_LIST_VIEW_HEIGHT }}
              bodyStyle={{ height: 'calc(100% - 57px)', minHeight: 0, overflowY: 'auto' }}
            >
              <Space direction="vertical" size={8}>
                <Text>更新时间：{activeEntry?.updatedAt || '-'}</Text>
                <Text>来源数量：{activeEntry?.sourceCount || 0}</Text>
                <Text>状态：{activeEntry?.status || '-'}</Text>
              </Space>
            </Card>
          </Col>
        </Row>
      )}
    </Space>
  )
}

function WikiManageView() {
  const [syncing, setSyncing] = useState('')
  const [syncTasks, setSyncTasks] = useState([])
  const [watchTaskIds, setWatchTaskIds] = useState([])
  const [selectedSyncTaskIds, setSelectedSyncTaskIds] = useState([])
  const [dbTaskId, setDbTaskId] = useState('')
  const [ragTaskId, setRagTaskId] = useState('')
  const [dbSyncOpen, setDbSyncOpen] = useState(false)
  const [dbTableOptions, setDbTableOptions] = useState([])
  const [dbSelectedTables, setDbSelectedTables] = useState([])
  const [dbOptionEntity, setDbOptionEntity] = useState(true)
  const [dbOptionConcept, setDbOptionConcept] = useState(true)
  const [dbOptionOverview, setDbOptionOverview] = useState(true)
  const [ragSyncOpen, setRagSyncOpen] = useState(false)
  const [ragKbOptions, setRagKbOptions] = useState([])
  const [ragSelectedKbIds, setRagSelectedKbIds] = useState([])
  const [ragOptionEntity, setRagOptionEntity] = useState(true)
  const [ragOptionConcept, setRagOptionConcept] = useState(true)
  const [ragOptionOverview, setRagOptionOverview] = useState(true)
  const [rawImportOpen, setRawImportOpen] = useState(false)
  const [rawImportBucket, setRawImportBucket] = useState('papers')
  const [rawImportLoading, setRawImportLoading] = useState(false)
  const [rawImportItems, setRawImportItems] = useState([])
  const [papersFileList, setPapersFileList] = useState([])
  const [mediaFileList, setMediaFileList] = useState([])
  const [booksWebUrls, setBooksWebUrls] = useState('')
  const [booksWeChatUrls, setBooksWeChatUrls] = useState('')
  const [booksTexts, setBooksTexts] = useState('')
  const dbTableSelectOptions = useMemo(() => (
    dbTableOptions.map((item) => {
      const text = `PostgreSQL(main/public) / ${item.name}`
      return {
        label: <span title={text}>{text}</span>,
        value: item.name,
        searchText: text,
      }
    })
  ), [dbTableOptions])
  const loadSyncTasks = () => {
    fetchLlmWikiSyncTasks(20)
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setSyncTasks(list)
        const idSet = new Set(list.map((item) => String(item?.id || '')))
        setSelectedSyncTaskIds((prev) => (Array.isArray(prev) ? prev.filter((id) => idSet.has(String(id))) : []))
      })
      .catch((error) => message.error(error?.message || '读取同步任务失败'))
  }
  useEffect(() => {
    loadSyncTasks()
  }, [])
  const syncTaskMap = useMemo(() => {
    const map = new Map()
    for (const item of (Array.isArray(syncTasks) ? syncTasks : [])) {
      map.set(String(item?.id || ''), item)
    }
    return map
  }, [syncTasks])
  const dbTask = dbTaskId ? syncTaskMap.get(String(dbTaskId)) : null
  const ragTask = ragTaskId ? syncTaskMap.get(String(ragTaskId)) : null
  useEffect(() => {
    const dbRunning = String(dbTask?.status || '').toLowerCase() === 'running'
    const ragRunning = String(ragTask?.status || '').toLowerCase() === 'running'
    if (!dbRunning && !ragRunning) return undefined
    const timer = setInterval(() => {
      loadSyncTasks()
    }, 2000)
    return () => clearInterval(timer)
  }, [dbTask?.status, ragTask?.status])
  const buildProgress = (task) => {
    const total = Math.max(0, Number(task?.totalCount || 0) || 0)
    const inserted = Math.max(0, Number(task?.insertedCount || 0) || 0)
    const updated = Math.max(0, Number(task?.updatedCount || 0) || 0)
    const summaryTotal = Math.max(0, Number(task?.summary?.totalCount || 0) || 0)
    const summaryProcessed = Math.max(0, Number(task?.summary?.processed || 0) || 0)
    const totalForDisplay = total > 0 ? total : summaryTotal
    const processedByWrite = inserted + updated
    const processed = Math.max(
      Math.min(totalForDisplay > 0 ? totalForDisplay : processedByWrite, processedByWrite),
      Math.min(totalForDisplay > 0 ? totalForDisplay : summaryProcessed, summaryProcessed),
    )
    const percent = totalForDisplay > 0 ? Math.max(0, Math.min(100, Math.round((processed / totalForDisplay) * 100))) : 0
    const status = String(task?.status || '').toLowerCase()
    const stageProgress = Math.max(0, Math.min(100, Number(task?.summary?.stageProgress || 0) || 0))
    const stage = String(task?.summary?.stage || '')
    const stageMessage = String(task?.summary?.message || '')
    const effectivePercent = totalForDisplay > 0 ? percent : stageProgress
    return {
      total: totalForDisplay,
      inserted,
      updated,
      processed,
      percent: effectivePercent,
      rawPercent: percent,
      stageProgress,
      stage,
      stageMessage,
      running: status === 'running',
      failed: status === 'failed',
      success: status === 'success',
    }
  }
  const dbProgress = buildProgress(dbTask)
  const ragProgress = buildProgress(ragTask)
  const isBooksBucket = rawImportBucket === 'books'
  const resolveDisplayTitle = (record = {}) => {
    const itemType = String(record?.itemType || '').toLowerCase()
    const rawTitle = String(record?.title || '').trim()
    if (itemType === 'file') return String(record?.fileName || rawTitle || '-')
    if (itemType === 'text') {
      const contentText = String(record?.contentText || '').trim()
      const maybeLegacyTitle = /^书籍摘录\s+\d{4}-\d{2}-\d{2}/.test(rawTitle)
      if (!maybeLegacyTitle) return rawTitle || '-'
      const firstLine = contentText.split(/\r?\n/).map((x) => String(x || '').trim()).find(Boolean) || ''
      return firstLine || rawTitle || '-'
    }
    if (itemType !== 'wechat') return rawTitle || '-'
    const isUrlTitle = /^https?:\/\//i.test(rawTitle)
    if (!isUrlTitle) return rawTitle || '-'
    const contentText = String(record?.contentText || '').trim()
    if (!contentText) return rawTitle || '-'
    const lines = contentText.split(/\r?\n/).map((x) => String(x || '').trim()).filter(Boolean)
    for (const line of lines.slice(0, 20)) {
      const heading = line.match(/^#\s+(.+?)\s*$/)
      if (heading?.[1]) return String(heading[1]).trim()
      const meta = line.match(/^(title|标题)\s*[:：]\s*(.+?)\s*$/i)
      if (meta?.[2]) return String(meta[2]).trim()
    }
    return rawTitle || '-'
  }
  const renderEllipsisWithTip = (value) => {
    const text = String(value || '-')
    return (
      <Tooltip title={text}>
        <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
          {text}
        </span>
      </Tooltip>
    )
  }
  const rawItemColumns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: isBooksBucket ? 220 : undefined,
      ellipsis: true,
      render: (_, record) => {
        return renderEllipsisWithTip(resolveDisplayTitle(record))
      },
    },
    { title: '类型', dataIndex: 'itemType', key: 'itemType', width: 80, ellipsis: true, render: (v) => renderEllipsisWithTip(v) },
    ...(rawImportBucket === 'papers'
      ? []
      : [{
          title: '来源',
          key: 'source',
          width: isBooksBucket ? 160 : 220,
          ellipsis: true,
          render: (_, record) => {
            const itemType = String(record?.itemType || '').toLowerCase()
            const sourceUrl = String(record?.sourceUrl || '').trim()
            if (itemType === 'text') return renderEllipsisWithTip('文本')
            if ((itemType === 'wechat' || itemType === 'web') && sourceUrl) return renderEllipsisWithTip(sourceUrl)
            return renderEllipsisWithTip('-')
          },
        }]),
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={String(v) === 'success' ? 'green' : 'gold'}>{String(v) === 'success' ? '成功' : String(v || '-')}</Tag>,
    },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, ellipsis: true, render: (v) => renderEllipsisWithTip(v) },
    {
      title: '操作',
      key: 'actions',
      width: isBooksBucket ? 220 : 120,
      render: (_, record) => (
        <Space size={6}>
          <Button
            size="small"
            onClick={async () => {
              try {
                const detail = await previewLlmWikiRawImportItem(record?.id)
                const mimeType = String(detail?.mimeType || '').toLowerCase()
                const payload = detail?.payloadJson && typeof detail.payloadJson === 'object' ? detail.payloadJson : {}
                const mediaBase64 = String(payload?.contentBase64 || '').trim()
                const mediaUrl = (mediaBase64 && detail?.id)
                  ? `/api/llm-wiki/raw-import/items/${encodeURIComponent(String(detail.id))}/media?t=${encodeURIComponent(String(detail.updatedAt || ''))}`
                  : ''
                const isImage = mediaUrl && mimeType.startsWith('image/')
                const isVideo = mediaUrl && mimeType.startsWith('video/')
                Modal.info({
                  title: detail?.title || '预览',
                  width: 920,
                  okText: '关闭',
                  content: (
                    <div style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                      {isImage ? (
                        <img alt={detail?.title || 'media'} src={mediaUrl} style={{ maxWidth: '100%', maxHeight: 320, marginBottom: 12, borderRadius: 8 }} />
                      ) : null}
                      {isVideo ? (
                        <video controls src={mediaUrl} style={{ maxWidth: '100%', maxHeight: 320, marginBottom: 12, borderRadius: 8 }} />
                      ) : null}
                      {detail?.contentText || '-'}
                    </div>
                  ),
                })
              } catch (error) {
                message.error(error?.message || '预览失败')
              }
            }}
          >
            预览
          </Button>
          {isBooksBucket && ['wechat', 'web'].includes(String(record?.itemType || '').toLowerCase()) && String(record?.sourceUrl || '').trim() ? (
            <Button
              size="small"
              onClick={() => {
                const url = String(record?.sourceUrl || '').trim()
                if (!url) return
                window.open(url, '_blank', 'noopener,noreferrer')
              }}
            >
              打开链接
            </Button>
          ) : null}
          {isBooksBucket || String(record?.status || '').toLowerCase() === 'failed' ? (
            <Button
              size="small"
              type="default"
              onClick={async () => {
                try {
                  setRawImportLoading(true)
                  await resyncLlmWikiRawImportItem(record?.id)
                  message.success('重同步完成')
                  loadRawItems(rawImportBucket)
                  loadSyncTasks()
                } catch (error) {
                  message.error(error?.message || '重同步失败')
                } finally {
                  setRawImportLoading(false)
                }
              }}
            >
              同步
            </Button>
          ) : null}
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: '确认删除这条导入记录吗？',
                content: '会同时删除知识树中由该记录生成的词条。',
                okText: '删除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: async () => {
                  try {
                    setRawImportLoading(true)
                    const result = await deleteLlmWikiRawImportItem(record?.id)
                    message.success(`已删除，联动删除词条 ${Number(result?.deletedWikiCount || 0)} 条`)
                    loadRawItems(rawImportBucket)
                    loadSyncTasks()
                  } catch (error) {
                    message.error(error?.message || '删除失败')
                  } finally {
                    setRawImportLoading(false)
                  }
                },
              })
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]
  const runSync = (sourceType) => {
    const source = String(sourceType || '')
    if (!source) return
    setSyncing(source)
    triggerLlmWikiSync(source, { limit: 200 })
      .then((task) => {
        message.info(`${source.toUpperCase()} 同步任务已启动，正在后台执行`)
        if (task?.id) setWatchTaskIds((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), String(task.id)])))
        loadSyncTasks()
      })
      .catch((error) => message.error(error?.message || `${source} 同步失败`))
      .finally(() => setSyncing(''))
  }
  const handleDeleteSyncTask = async (id) => {
    await deleteLlmWikiSyncTask(id)
    setWatchTaskIds((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x) !== String(id)) : []))
    setSelectedSyncTaskIds((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x) !== String(id)) : []))
    message.success('日志已删除')
    loadSyncTasks()
  }
  const handleBatchDeleteSyncTasks = async () => {
    if (!Array.isArray(selectedSyncTaskIds) || selectedSyncTaskIds.length === 0) {
      message.warning('请先勾选要删除的日志')
      return
    }
    const result = await batchDeleteLlmWikiSyncTasks(selectedSyncTaskIds)
    const selectedSet = new Set(selectedSyncTaskIds.map((x) => String(x)))
    setWatchTaskIds((prev) => (Array.isArray(prev) ? prev.filter((x) => !selectedSet.has(String(x))) : []))
    setSelectedSyncTaskIds([])
    message.success(`已删除 ${Number(result?.deletedCount || 0)} 条日志`)
    loadSyncTasks()
  }
  const handleCancelSyncTask = async (id) => {
    await cancelLlmWikiSyncTask(id)
    message.success('任务已取消')
    loadSyncTasks()
  }
  const openRagSyncDialog = () => {
    setRagSyncOpen(true)
    loadSyncTasks()
    fetchKnowledgeBases()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        const options = list
          .map((item) => ({ label: `${item.name || item.id} (${item.id})`, value: item.id }))
          .filter((x) => String(x.value || '').trim())
        if (options.length > 0) {
          setRagKbOptions(options)
          setRagSelectedKbIds(options.map((x) => x.value))
          return
        }
        fetchLlmWikiSyncRagKbs()
          .then((ragRows) => {
            const ragOptions = ragRows
              .map((item) => ({ label: `${item.name || item.id} (${item.docCount || 0} docs)`, value: item.id }))
              .filter((x) => String(x.value || '').trim())
            setRagKbOptions(ragOptions)
            setRagSelectedKbIds(ragOptions.map((x) => x.value))
            if (ragOptions.length === 0) message.warning('当前没有可用知识库，请先在“知识库管理”导入文档')
          })
          .catch(() => message.warning('知识库列表为空，请先在“知识库管理”导入文档'))
      })
      .catch((error) => message.error(error?.message || '读取知识库失败'))
  }
  const submitRagSync = () => {
    const selectedKbIds = Array.isArray(ragSelectedKbIds) ? ragSelectedKbIds.map((x) => String(x)).filter(Boolean) : []
    if (selectedKbIds.length === 0) {
      message.warning('请至少选择一个知识库')
      return
    }
    setSyncing('rag')
    triggerLlmWikiSync('rag', {
      limit: 200,
      kbIds: selectedKbIds,
      enableEntityExtract: ragOptionEntity,
      enableConceptExtract: ragOptionConcept,
      enableOverview: ragOptionOverview,
    })
      .then((task) => {
        message.info('RAG 同步任务已启动，正在后台执行')
        if (task?.id) {
          const id = String(task.id)
          setRagTaskId(id)
          setWatchTaskIds((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), id])))
        } else {
          const latestRag = (Array.isArray(syncTasks) ? syncTasks : []).find((item) => String(item?.sourceType || '').toLowerCase() === 'rag')
          if (latestRag?.id) setRagTaskId(String(latestRag.id))
        }
        loadSyncTasks()
      })
      .catch((error) => message.error(error?.message || 'RAG 同步失败'))
      .finally(() => setSyncing(''))
  }
  const openDbSyncDialog = () => {
    setDbSyncOpen(true)
    fetchLlmWikiSyncDbTables()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setDbTableOptions(list)
        const names = list.map((x) => x.name).filter(Boolean)
        setDbSelectedTables(names)
      })
      .catch((error) => message.error(error?.message || '读取数据库表失败'))
  }

  const loadRawItems = (bucket = rawImportBucket) => {
    setRawImportLoading(true)
    fetchLlmWikiRawImportItems(bucket, 80)
      .then((rows) => setRawImportItems(Array.isArray(rows) ? rows : []))
      .catch((error) => message.error(error?.message || '读取原始资料列表失败'))
      .finally(() => setRawImportLoading(false))
  }

  const openRawImportDialog = () => {
    setBooksWebUrls('')
    setBooksWeChatUrls('')
    setBooksTexts('')
    setPapersFileList([])
    setMediaFileList([])
    setRawImportOpen(true)
    setRawImportBucket('papers')
    loadRawItems('papers')
  }

  const closeRawImportDialog = () => {
    setRawImportOpen(false)
    setBooksWebUrls('')
    setBooksWeChatUrls('')
    setBooksTexts('')
  }

  const toBase64 = async (inputFile) => {
    const file = inputFile?.originFileObj || inputFile
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error('文件读取失败：无可用文件对象')
    }
    const ab = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(ab)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  const submitRawImport = async () => {
    setRawImportLoading(true)
    try {
      const buildImportSuccessText = (result) => (
        `导入完成：原始 ${Number(result?.rawCount || 0)} 条，Wiki 新增 ${Number(result?.insertedWiki || 0)} 条，更新 ${Number(result?.updatedWiki || 0)} 条`
      )
      if (rawImportBucket === 'papers') {
        if (!Array.isArray(papersFileList) || papersFileList.length === 0) {
          message.warning('请先上传论文/文章文件')
          return
        }
        const papersFiles = await Promise.all(
          papersFileList.map(async (item) => {
            const f = item?.originFileObj || item
            return {
            name: f?.name || item?.name || '',
            mimeType: f?.type || item?.type || '',
            size: Number(f?.size || item?.size || 0),
            contentBase64: await toBase64(item),
            }
          }),
        )
        const result = await importLlmWikiRawMaterials({ bucket: 'papers', papersFiles })
        message.success(buildImportSuccessText(result))
        setPapersFileList([])
      } else if (rawImportBucket === 'media') {
        if (!Array.isArray(mediaFileList) || mediaFileList.length === 0) {
          message.warning('请先上传图片/视频文件')
          return
        }
        const mediaFiles = await Promise.all(
          mediaFileList.map(async (item) => {
            const f = item?.originFileObj || item
            return {
            name: f?.name || item?.name || '',
            mimeType: f?.type || item?.type || '',
            size: Number(f?.size || item?.size || 0),
            contentBase64: await toBase64(item),
            }
          }),
        )
        const result = await importLlmWikiRawMaterials({ bucket: 'media', mediaFiles })
        message.success(buildImportSuccessText(result))
        setMediaFileList([])
      } else {
        if (!booksWebUrls.trim() && !booksWeChatUrls.trim() && !booksTexts.trim()) {
          message.warning('请至少填写一种书籍摘录来源')
          return
        }
        const result = await importLlmWikiRawMaterials({
          bucket: 'books',
          booksWebUrls,
          booksWeChatUrls,
          booksTexts,
        })
        message.success(buildImportSuccessText(result))
        setBooksWebUrls('')
        setBooksWeChatUrls('')
        setBooksTexts('')
      }
      loadRawItems(rawImportBucket)
      loadSyncTasks()
    } catch (error) {
      message.error(error?.message || '原始资料导入失败')
    } finally {
      setRawImportLoading(false)
    }
  }
  const submitDbSync = () => {
    const selectedNames = Array.isArray(dbSelectedTables) ? dbSelectedTables.map((x) => String(x)).filter(Boolean) : []
    if (selectedNames.length === 0) {
      message.warning('请至少选择一个数据库表')
      return
    }
    setSyncing('db')
    triggerLlmWikiSync('db', {
      limit: 200,
      tableNames: selectedNames,
      enableEntityExtract: dbOptionEntity,
      enableConceptExtract: dbOptionConcept,
      enableOverview: dbOptionOverview,
    })
      .then((task) => {
        message.info('DB 同步任务已启动，正在后台执行')
        if (task?.id) {
          const id = String(task.id)
          setDbTaskId(id)
          setWatchTaskIds((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), id])))
        }
        loadSyncTasks()
      })
      .catch((error) => message.error(error?.message || 'DB 同步失败'))
      .finally(() => setSyncing(''))
  }

  return (
    <Card
      className="app-elevated-card"
      title="导入与生成（Wiki知识管理）"
      extra={(
        <Space>
          <Button loading={syncing === 'db'} onClick={openDbSyncDialog}>同步DB</Button>
          <Button loading={syncing === 'rag'} onClick={openRagSyncDialog}>同步RAG</Button>
          <Button onClick={openRawImportDialog}>原始资料导入</Button>
        </Space>
      )}
    >
      <Card size="small" style={{ marginBottom: 12 }} title="同步任务">
        <Space style={{ marginBottom: 8 }}>
          <Button
            danger
            disabled={selectedSyncTaskIds.length === 0}
            onClick={() => {
              Modal.confirm({
                title: `确认删除选中的 ${selectedSyncTaskIds.length} 条日志吗？`,
                okText: '删除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: handleBatchDeleteSyncTasks,
              })
            }}
          >
            删除选中
          </Button>
        </Space>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={syncTasks}
          rowSelection={{
            selectedRowKeys: selectedSyncTaskIds,
            onChange: (keys) => setSelectedSyncTaskIds(Array.isArray(keys) ? keys.map((x) => String(x)) : []),
          }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
            { title: '来源', dataIndex: 'sourceType', key: 'sourceType', width: 90 },
            { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
            { title: '总数', dataIndex: 'totalCount', key: 'totalCount', width: 80 },
            { title: '新增', dataIndex: 'insertedCount', key: 'insertedCount', width: 80 },
            { title: '更新', dataIndex: 'updatedCount', key: 'updatedCount', width: 80 },
            { title: '错误', dataIndex: 'errorMessage', key: 'errorMessage' },
            {
              title: '操作',
              key: 'actions',
              width: 140,
              render: (_, record) => (
                String(record?.status || '').toLowerCase() === 'running'
                  ? (
                    <Button
                      type="link"
                      danger
                      onClick={() => {
                        Modal.confirm({
                          title: '确认取消该运行中的任务吗？',
                          okText: '取消任务',
                          okButtonProps: { danger: true },
                          cancelText: '返回',
                          onOk: async () => { await handleCancelSyncTask(record?.id) },
                        })
                      }}
                    >
                      取消
                    </Button>
                    )
                  : (
                    <Button
                      type="link"
                      danger
                      onClick={() => {
                        Modal.confirm({
                          title: '确认删除这条同步日志吗？',
                          okText: '删除',
                          okButtonProps: { danger: true },
                          cancelText: '取消',
                          onOk: async () => { await handleDeleteSyncTask(record?.id) },
                        })
                      }}
                    >
                      删除
                    </Button>
                    )
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title="同步DB到Wiki"
        open={dbSyncOpen}
        onCancel={() => setDbSyncOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDbSyncOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={syncing === 'db'} onClick={submitDbSync}>同步</Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Text type="secondary">请选择数据库（实例与表）：</Text>
          <Text type="secondary">当前实例：`PostgreSQL(main/public)`</Text>
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="searchText"
            placeholder="可多选数据表"
            style={{ width: '100%' }}
            maxTagCount={1}
            maxTagPlaceholder={(omittedValues) => `+${Array.isArray(omittedValues) ? omittedValues.length : 0}`}
            value={dbSelectedTables}
            options={dbTableSelectOptions}
            onChange={(vals) => setDbSelectedTables(Array.isArray(vals) ? vals.map((x) => String(x)) : [])}
          />
          <Space>
            <Button
              size="small"
              onClick={() => {
                const all = dbTableOptions.map((x) => x.name).filter(Boolean)
                setDbSelectedTables(all)
              }}
            >
              全选
            </Button>
            <Button
              size="small"
              onClick={() => {
                setDbSelectedTables([])
              }}
            >
              清空
            </Button>
          </Space>
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Checkbox checked={dbOptionEntity} onChange={(e) => setDbOptionEntity(e.target.checked === true)}>实体抽取</Checkbox>
              <Checkbox checked={dbOptionConcept} onChange={(e) => setDbOptionConcept(e.target.checked === true)}>概念抽取</Checkbox>
              <Checkbox checked={dbOptionOverview} onChange={(e) => setDbOptionOverview(e.target.checked === true)}>总览生成</Checkbox>
            </Space>
          </div>
          {dbTaskId ? (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                <Text type="secondary">任务ID：{dbTaskId}</Text>
                <Progress
                  percent={dbProgress.percent}
                  status={dbProgress.failed ? 'exception' : (dbProgress.success ? 'success' : 'active')}
                  showInfo
                />
                <Text type="secondary">
                  状态：{String(dbTask?.status || 'running')} · 已处理 {dbProgress.processed}/{dbProgress.total || '?'} · 新增 {dbProgress.inserted} · 更新 {dbProgress.updated}
                </Text>
                {dbProgress.running && dbProgress.total === 0 ? <Text type="secondary">阶段：{dbProgress.stageMessage || dbProgress.stage || 'preparing'}（{dbProgress.stageProgress}%）</Text> : null}
                {dbProgress.failed && dbTask?.errorMessage ? <Text type="danger">{dbTask.errorMessage}</Text> : null}
              </Space>
            </div>
          ) : null}
        </Space>
      </Modal>
      <Modal
        title="同步RAG到Wiki"
        open={ragSyncOpen}
        onCancel={() => setRagSyncOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setRagSyncOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={syncing === 'rag'} onClick={submitRagSync}>同步</Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Text type="secondary">请选择知识库：</Text>
          <Select
            mode="multiple"
            allowClear
            showSearch
            placeholder="可多选知识库"
            style={{ width: '100%' }}
            maxTagCount={1}
            maxTagPlaceholder={(omittedValues) => `+${Array.isArray(omittedValues) ? omittedValues.length : 0}`}
            value={ragSelectedKbIds}
            options={ragKbOptions}
            onChange={(vals) => setRagSelectedKbIds(Array.isArray(vals) ? vals.map((x) => String(x)) : [])}
          />
          <Space>
            <Button size="small" onClick={() => setRagSelectedKbIds(ragKbOptions.map((x) => x.value))}>全选</Button>
            <Button size="small" onClick={() => setRagSelectedKbIds([])}>清空</Button>
          </Space>
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Checkbox checked={ragOptionEntity} onChange={(e) => setRagOptionEntity(e.target.checked === true)}>实体抽取</Checkbox>
              <Checkbox checked={ragOptionConcept} onChange={(e) => setRagOptionConcept(e.target.checked === true)}>概念抽取</Checkbox>
              <Checkbox checked={ragOptionOverview} onChange={(e) => setRagOptionOverview(e.target.checked === true)}>总览生成</Checkbox>
            </Space>
          </div>
          {ragTaskId ? (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                <Text type="secondary">任务ID：{ragTaskId}</Text>
                <Progress
                  percent={ragProgress.percent}
                  status={ragProgress.failed ? 'exception' : (ragProgress.success ? 'success' : 'active')}
                  showInfo
                />
                <Text type="secondary">
                  状态：{String(ragTask?.status || 'running')} · 已处理 {ragProgress.processed}/{ragProgress.total || '?'} · 新增 {ragProgress.inserted} · 更新 {ragProgress.updated}
                </Text>
                {ragProgress.running && ragProgress.total === 0 ? <Text type="secondary">阶段：{ragProgress.stageMessage || ragProgress.stage || 'preparing'}（{ragProgress.stageProgress}%）</Text> : null}
                {ragProgress.failed && ragTask?.errorMessage ? <Text type="danger">{ragTask.errorMessage}</Text> : null}
              </Space>
            </div>
          ) : null}
        </Space>
      </Modal>
      <Modal
        title="原始资料导入"
        width={1240}
        open={rawImportOpen}
        onCancel={closeRawImportDialog}
        footer={[
          <Button key="cancel" onClick={closeRawImportDialog}>关闭</Button>,
          <Button key="ok" type="primary" loading={rawImportLoading} onClick={submitRawImport}>开始导入</Button>,
        ]}
        bodyStyle={{ paddingTop: 12 }}
      >
        <Row gutter={12} style={{ minHeight: 520 }}>
          <Col span={5}>
            <Card
              size="small"
              bodyStyle={{ padding: 10 }}
              style={{ height: 520, borderRadius: 12 }}
            >
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>资料分类</Text>
              <Tree
                selectedKeys={[rawImportBucket]}
                blockNode
                treeData={[
                  { key: 'papers', title: 'papers 论文/文章' },
                  { key: 'books', title: 'books 书籍摘录' },
                  { key: 'media', title: 'media 图片/视频' },
                ]}
                onSelect={(keys) => {
                  const next = Array.isArray(keys) && keys[0] ? String(keys[0]) : 'papers'
                  setRawImportBucket(next)
                  loadRawItems(next)
                }}
              />
            </Card>
          </Col>
          <Col span={19}>
            <Card
              size="small"
              style={{ height: 520, borderRadius: 12 }}
              bodyStyle={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column' }}
              title={rawImportBucket === 'papers' ? 'papers 论文/文章' : rawImportBucket === 'books' ? 'books 书籍摘录' : 'media 图片/视频'}
            >
              {rawImportBucket === 'papers' ? (
                <Space direction="vertical" style={{ width: '100%', flex: 1 }} size={10}>
                  <Upload.Dragger
                    multiple
                    accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    style={{ borderRadius: 12 }}
                    showUploadList={false}
                    beforeUpload={(file) => {
                      const name = String(file?.name || '').toLowerCase()
                      const allowedExtRe = /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|pdf|doc|docx|xls|xlsx|ppt|pptx)$/
                      if (!allowedExtRe.test(name)) {
                        message.warning('papers 仅支持文档格式（不支持图片/视频）')
                        return Upload.LIST_IGNORE
                      }
                      return false
                    }}
                    onChange={({ fileList }) => {
                      setPapersFileList(Array.isArray(fileList) ? fileList : [])
                    }}
                    fileList={papersFileList}
                  >
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>拖拽论文/文章到这里，或点击上传</p>
                    <p style={{ marginTop: 6, color: '#8c8c8c' }}>
                      支持：Word(DOC/DOCX)、Excel(XLS/XLSX)、PPT(PPT/PPTX)、TXT、CSV/TSV、Markdown(MD)、PDF、HTML、JSON、XML；
                      不支持图片/视频（请使用 media 菜单）
                    </p>
                  </Upload.Dragger>
                  {papersFileList.length > 0 ? (
                    <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: '8px 10px', background: '#fafafa' }}>
                      <Text type="secondary">已选择 {papersFileList.length} 个文件：</Text>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {papersFileList.map((f) => (
                          <Tag key={String(f?.uid || f?.name)}>{String(f?.name || '未命名文件')}</Tag>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <Table
                    size="small"
                    loading={rawImportLoading}
                    rowKey="id"
                    pagination={false}
                    dataSource={rawImportItems}
                    columns={rawItemColumns}
                    style={{ flex: 1 }}
                    scroll={{ y: 220 }}
                  />
                </Space>
              ) : null}
              {rawImportBucket === 'books' ? (
                <Space direction="vertical" style={{ width: '100%', flex: 1 }} size={10}>
                  <Input placeholder="网页链接（单行，多个用逗号/分号分隔）" value={booksWebUrls} onChange={(e) => setBooksWebUrls(e.target.value)} />
                  <Input placeholder="公众号链接（单行，多个用逗号/分号分隔）" value={booksWeChatUrls} onChange={(e) => setBooksWeChatUrls(e.target.value)} />
                  <Input.TextArea rows={6} placeholder="文本（多行）" value={booksTexts} onChange={(e) => setBooksTexts(e.target.value)} />
                  <Table
                    size="small"
                    loading={rawImportLoading}
                    rowKey="id"
                    pagination={false}
                    dataSource={rawImportItems}
                    columns={rawItemColumns}
                    style={{ flex: 1 }}
                    tableLayout="fixed"
                    scroll={{ y: 160 }}
                  />
                </Space>
              ) : null}
              {rawImportBucket === 'media' ? (
                <Space direction="vertical" style={{ width: '100%', flex: 1 }} size={10}>
                  <Upload.Dragger
                    multiple
                    accept="image/*,video/*"
                    style={{ borderRadius: 12 }}
                    showUploadList={false}
                    beforeUpload={(file) => {
                      return false
                    }}
                    onChange={({ fileList }) => {
                      setMediaFileList(Array.isArray(fileList) ? fileList : [])
                    }}
                    fileList={mediaFileList}
                  >
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>拖拽图片/视频到这里，或点击上传</p>
                    <p style={{ marginTop: 6, color: '#8c8c8c' }}>支持批量上传，导入后会记录媒体元数据并同步到Wiki</p>
                  </Upload.Dragger>
                  {mediaFileList.length > 0 ? (
                    <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: '8px 10px', background: '#fafafa' }}>
                      <Text type="secondary">已选择 {mediaFileList.length} 个媒体文件：</Text>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {mediaFileList.map((f) => (
                          <Tag key={String(f?.uid || f?.name)}>{String(f?.name || '未命名文件')}</Tag>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <Table
                    size="small"
                    loading={rawImportLoading}
                    rowKey="id"
                    pagination={false}
                    dataSource={rawImportItems}
                    columns={rawItemColumns}
                    style={{ flex: 1 }}
                    scroll={{ y: 220 }}
                  />
                </Space>
              ) : null}
            </Card>
          </Col>
        </Row>
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
  const { section = 'inbox' } = useParams()
  const titleMap = {
    library: 'LLM-Wiki / Wiki工作台',
    workbench: 'LLM-Wiki / Wiki工作台',
    graph: 'LLM-Wiki / 关系图谱',
    manage: 'LLM-Wiki / Wiki管理',
    settings: 'LLM-Wiki / 配置',
    tree: `LLM-Wiki / ${section}`,
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Title level={4} style={{ margin: 0 }}>{titleMap[view] || 'LLM-Wiki'}</Title>
        <Text type="secondary">与 Karpathy LLM-Wiki 模式对齐：Raw → Compiled Wiki → Schema。</Text>
      </Card>
      {view === 'library' || view === 'workbench' ? <WikiWorkbenchHome /> : null}
      {view === 'graph' ? <WikiLibraryView initialMode="graph" /> : null}
      {view === 'tree' ? <WikiLibraryView initialMode="list" /> : null}
      {view === 'manage' ? <WikiManageView /> : null}
      {view === 'settings' ? <WikiSettingsView /> : null}
    </Space>
  )
}
