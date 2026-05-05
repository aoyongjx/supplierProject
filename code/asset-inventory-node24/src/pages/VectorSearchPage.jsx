import { Alert, Button, Card, Divider, Drawer, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph3D from 'react-force-graph-3d'
import { UMAP } from 'umap-js'
import { fetchKnowledgeBases, searchKnowledgeBase } from '../api/knowledgeBaseApi'

const { Text, Title } = Typography

function shortText(input = '', limit = 240) {
  const text = String(input || '').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function snippetAroundHit(text = '', tokens = [], radius = 140) {
  const raw = String(text || '')
  if (!raw) return ''
  const normalizedTokens = (Array.isArray(tokens) ? tokens : [])
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  let hitIndex = -1
  let hitToken = ''
  for (const token of normalizedTokens) {
    const idx = raw.toLowerCase().indexOf(token.toLowerCase())
    if (idx >= 0) {
      hitIndex = idx
      hitToken = token
      break
    }
  }
  if (hitIndex < 0) return shortText(raw, radius * 2)
  const start = Math.max(0, hitIndex - radius)
  const end = Math.min(raw.length, hitIndex + hitToken.length + radius)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < raw.length ? '...' : ''
  return `${prefix}${raw.slice(start, end)}${suffix}`
}

function escapeRegExp(text = '') {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHighlightTokens(query = '') {
  const raw = String(query || '').trim()
  if (!raw) return []
  const bySplit = raw.split(/[\s,，。；;、|]+/g).map((item) => item.trim()).filter(Boolean)
  if (bySplit.length > 1) return Array.from(new Set(bySplit.filter((item) => item.length >= 2)))
  const single = bySplit[0] || raw
  const cjkOnly = /^[\u4e00-\u9fff]+$/.test(single)
  if (!cjkOnly) return single.length >= 2 ? [single] : []
  const tokens = new Set()
  if (single.length >= 2) {
    for (let i = 0; i < single.length - 1; i += 1) {
      tokens.add(single.slice(i, i + 2))
    }
  }
  return Array.from(tokens).filter((item) => item.length >= 2)
}

function renderHighlightedText(text = '', query = '') {
  const raw = String(text || '')
  const tokens = buildHighlightTokens(query)
  if (tokens.length === 0) return raw
  const pattern = tokens
    .sort((a, b) => b.length - a.length)
    .map((item) => escapeRegExp(item))
    .join('|')
  if (!pattern) return raw
  const regex = new RegExp(`(${pattern})`, 'gi')
  const parts = raw.split(regex)
  return parts.map((part, index) => {
    if (!part) return null
    const matched = tokens.some((token) => token && part.toLowerCase() === token.toLowerCase())
    if (!matched) return <span key={index}>{part}</span>
    return (
      <mark key={index} style={{ background: '#ffe58f', padding: '0 2px', borderRadius: 3 }}>
        {part}
      </mark>
    )
  })
}

function sourceTypeLabel(type = '') {
  const token = String(type || '').toLowerCase()
  if (token === 'file') return { text: '文件', color: 'blue' }
  if (token === 'web') return { text: '网页', color: 'geekblue' }
  if (token === 'search') return { text: '搜索', color: 'purple' }
  return { text: token || '未知', color: 'default' }
}

function squaredDistance3(a = [], b = []) {
  const size = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < size; i += 1) {
    const diff = Number(a[i] || 0) - Number(b[i] || 0)
    sum += diff * diff
  }
  return sum
}

function buildKnnLinks(points = [], k = 3) {
  const links = []
  const dedupe = new Set()
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const ranked = []
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue
      const other = points[j]
      const d2 = squaredDistance3(current.embedding || [], other.embedding || [])
      ranked.push({ id: other.id, d2 })
    }
    ranked.sort((a, b) => a.d2 - b.d2)
    ranked.slice(0, k).forEach((item) => {
      const pair = [current.id, item.id].sort().join('::')
      if (dedupe.has(pair)) return
      dedupe.add(pair)
      links.push({
        source: current.id,
        target: item.id,
        distanceValue: Math.sqrt(item.d2),
        kind: 'knn',
      })
    })
  }
  return links
}

function clusterByDistance(points = [], clusterCount = 4) {
  if (points.length === 0) return new Map()
  const count = Math.min(clusterCount, points.length)
  const centers = points.slice(0, count).map((item) => [...(item.pos || [0, 0, 0])])
  const assignment = new Map()
  for (let iter = 0; iter < 8; iter += 1) {
    points.forEach((point) => {
      let bestIdx = 0
      let bestDist = Number.POSITIVE_INFINITY
      centers.forEach((center, idx) => {
        const d = squaredDistance3(point.pos || [], center)
        if (d < bestDist) {
          bestDist = d
          bestIdx = idx
        }
      })
      assignment.set(point.id, bestIdx)
    })
    for (let c = 0; c < centers.length; c += 1) {
      const members = points.filter((p) => assignment.get(p.id) === c)
      if (members.length === 0) continue
      const next = [0, 0, 0]
      members.forEach((m) => {
        next[0] += Number(m.pos?.[0] || 0)
        next[1] += Number(m.pos?.[1] || 0)
        next[2] += Number(m.pos?.[2] || 0)
      })
      centers[c] = next.map((v) => v / members.length)
    }
  }
  return assignment
}

export default function VectorSearchPage() {
  const navigate = useNavigate()
  const graphRef = useRef(null)
  const [knowledgeBases, setKnowledgeBases] = useState([])
  const [loadingKb, setLoadingKb] = useState(false)
  const [searching2d, setSearching2d] = useState(false)
  const [searching3d, setSearching3d] = useState(false)
  const [kbId, setKbId] = useState('')
  const [query, setQuery] = useState('')
  const [metric, setMetric] = useState('cosine')
  const [topK, setTopK] = useState(20)
  const [result2d, setResult2d] = useState(null)
  const [result3d, setResult3d] = useState(null)
  const [strictKeyword, setStrictKeyword] = useState(true)
  const [graphOpen, setGraphOpen] = useState(false)
  const [activeNode, setActiveNode] = useState(null)
  const [activeRowKey, setActiveRowKey] = useState('')
  const [nodeDetailOpen, setNodeDetailOpen] = useState(false)
  const [clusterFilter, setClusterFilter] = useState('all')

  const recenterGraph = () => {
    if (!graphRef.current || !filteredGraphData.nodes.length) return
    const bbox = graphRef.current?.getGraphBbox?.((node) => node?.nodeType === 'chunk')
      || graphRef.current?.getGraphBbox?.()
    if (!bbox) return
    const minX = Number(bbox.x?.[0] ?? -120)
    const maxX = Number(bbox.x?.[1] ?? 120)
    const minY = Number(bbox.y?.[0] ?? -120)
    const maxY = Number(bbox.y?.[1] ?? 120)
    const minZ = Number(bbox.z?.[0] ?? -120)
    const maxZ = Number(bbox.z?.[1] ?? 120)
    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    }
    const spanX = Math.max(120, maxX - minX)
    const anchoredCenter = {
      x: center.x + spanX * 0.75,
      y: center.y,
      z: center.z,
    }
    const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 180)
    const distance = radius * 2.1
    graphRef.current?.cameraPosition?.(
      { x: anchoredCenter.x, y: anchoredCenter.y, z: anchoredCenter.z + distance },
      anchoredCenter,
      500,
    )
    const controls = graphRef.current?.controls?.()
    if (controls?.target?.set) {
      controls.target.set(anchoredCenter.x, anchoredCenter.y, anchoredCenter.z)
      controls.update?.()
    }
    graphRef.current?.refresh?.()
  }

  const resetViewGraph = () => {
    if (!graphRef.current || !filteredGraphData.nodes.length) return
    const bbox = graphRef.current?.getGraphBbox?.((node) => node?.nodeType === 'chunk')
      || graphRef.current?.getGraphBbox?.()
    if (!bbox) return
    const minX = Number(bbox.x?.[0] ?? -120)
    const maxX = Number(bbox.x?.[1] ?? 120)
    const minY = Number(bbox.y?.[0] ?? -120)
    const maxY = Number(bbox.y?.[1] ?? 120)
    const minZ = Number(bbox.z?.[0] ?? -120)
    const maxZ = Number(bbox.z?.[1] ?? 120)
    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    }
    const spanX = Math.max(120, maxX - minX)
    const anchoredCenter = {
      x: center.x + spanX * 0.75,
      y: center.y,
      z: center.z,
    }
    const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 180)
    const distance = radius * 2.25
    graphRef.current?.cameraPosition?.(
      { x: anchoredCenter.x - distance * 0.45, y: anchoredCenter.y + distance * 0.35, z: anchoredCenter.z + distance },
      anchoredCenter,
      500,
    )
    const controls = graphRef.current?.controls?.()
    if (controls?.target?.set) {
      controls.target.set(anchoredCenter.x, anchoredCenter.y, anchoredCenter.z)
      controls.update?.()
    }
    graphRef.current?.refresh?.()
  }

  const loadKnowledgeBases = async () => {
    setLoadingKb(true)
    try {
      const rows = await fetchKnowledgeBases()
      setKnowledgeBases(rows)
      if (!kbId && rows[0]?.id) setKbId(rows[0].id)
    } catch (error) {
      message.error(error.message || '读取知识库失败')
    } finally {
      setLoadingKb(false)
    }
  }

  useEffect(() => { loadKnowledgeBases() }, [])

  const executeSearch = async () => {
    if (!kbId) return message.warning('请先选择知识库')
    if (!String(query || '').trim()) return message.warning('请输入检索词')
    return await searchKnowledgeBase(kbId, { query, metric, topK, strictKeyword })
  }

  const onSearch = async () => {
    setSearching2d(true)
    try {
      const data = await executeSearch()
      if (data) setResult2d(data)
    } catch (error) {
      message.error(error.message || '向量检索失败')
    } finally {
      setSearching2d(false)
    }
  }

  const onSearch3D = async () => {
    setSearching3d(true)
    try {
      const data = await executeSearch()
      if (data) {
        setResult3d(data)
        setGraphOpen(true)
      }
    } catch (error) {
      message.error(error.message || '3D检索失败')
    } finally {
      setSearching3d(false)
    }
  }

  const tableData = useMemo(() => (
    Array.isArray(result2d?.results)
      ? result2d.results.map((item, index) => ({
        key: `${item.docId}-${item.chunkIndex}-${index}`,
        rank: index + 1,
        kbId: item.kbId,
        docId: item.docId,
        sourceType: item.sourceType,
        docName: item.docName,
        docUrl: item.docUrl,
        chunkIndex: item.chunkIndex,
        chunkText: item.chunkText,
        tokenHits: Number(item.tokenHits || 0),
        phraseHit: Number(item.phraseHit || 0),
        hitTokens: Array.isArray(item.hitTokens) ? item.hitTokens : [],
        cosineDistance: item.cosineDistance,
        euclideanDistance: item.euclideanDistance,
      }))
      : []
  ), [result2d])

  const graphData = useMemo(() => {
    const rows = Array.isArray(result3d?.results) ? result3d.results : []
    if (rows.length === 0) return { nodes: [], links: [] }
    const metricKey = result3d?.metric === 'euclidean' ? 'euclideanDistance' : 'cosineDistance'
    const usableRows = rows.filter((item) => Array.isArray(item.embedding) && item.embedding.length > 0)
    if (usableRows.length === 0) return { nodes: [], links: [] }
    const vectors = [
      { id: 'query-node', embedding: Array.isArray(result3d?.queryVector) ? result3d.queryVector : [] },
      ...usableRows.map((item, index) => ({
        id: `${item.docId}-${item.chunkIndex}-${index}`,
        embedding: item.embedding,
      })),
    ]
    const umap = new UMAP({
      nNeighbors: Math.min(12, Math.max(4, vectors.length - 1)),
      minDist: 0.18,
      nComponents: 3,
      random: Math.random,
    })
    const projected = umap.fit(vectors.map((item) => item.embedding))
    const centroid = [0, 0, 0]
    projected.forEach((p) => {
      centroid[0] += Number(p?.[0] || 0)
      centroid[1] += Number(p?.[1] || 0)
      centroid[2] += Number(p?.[2] || 0)
    })
    centroid[0] /= projected.length
    centroid[1] /= projected.length
    centroid[2] /= projected.length
    const centered = projected.map((p) => [
      (Number(p?.[0] || 0) - centroid[0]) * 140,
      (Number(p?.[1] || 0) - centroid[1]) * 140,
      (Number(p?.[2] || 0) - centroid[2]) * 140,
    ])
    const posMap = new Map(vectors.map((item, idx) => [item.id, centered[idx] || [0, 0, 0]]))
    const queryNode = {
      id: 'query-node',
      label: `查询词: ${result3d?.query || ''}`,
      nodeType: 'query',
      val: 12,
      color: '#1677ff',
      kbId: result3d?.kbId || '',
      query: result3d?.query || '',
      x: posMap.get('query-node')?.[0] || 0,
      y: posMap.get('query-node')?.[1] || 0,
      z: posMap.get('query-node')?.[2] || 0,
    }
    const distances = usableRows.map((item) => Number(item?.[metricKey] || 0)).filter((v) => Number.isFinite(v))
    const minDistance = distances.length ? Math.min(...distances) : 0
    const maxDistance = distances.length ? Math.max(...distances) : 1
    const span = Math.max(1e-6, maxDistance - minDistance)
    const nodes = [queryNode]
    const links = []
    const palette = ['#16a34a', '#f59e0b', '#06b6d4', '#ef4444', '#a855f7', '#14b8a6', '#f97316']
    const projectedRows = usableRows.map((item, index) => ({
      id: `${item.docId}-${item.chunkIndex}-${index}`,
      embedding: item.embedding,
      pos: posMap.get(`${item.docId}-${item.chunkIndex}-${index}`) || [0, 0, 0],
    }))
    const clusterMap = clusterByDistance(projectedRows, 5)
    usableRows.forEach((item, index) => {
      const distance = Number(item?.[metricKey] || 0)
      const normalized = Math.min(1, Math.max(0, (distance - minDistance) / span))
      const nodeId = `${item.docId}-${item.chunkIndex}-${index}`
      const clusterIdx = Number(clusterMap.get(nodeId) || 0)
      const nodeColor = palette[clusterIdx % palette.length]
      nodes.push({
        id: nodeId,
        label: item.docName || item.docId || `片段${index + 1}`,
        nodeType: 'chunk',
        val: 4 + (1 - normalized) * 6,
        color: nodeColor,
        kbId: item.kbId || result3d?.kbId || '',
        docId: item.docId,
        docName: item.docName,
        docUrl: item.docUrl,
        sourceType: item.sourceType,
        chunkIndex: item.chunkIndex,
        chunkText: item.chunkText,
        cosineDistance: item.cosineDistance,
        euclideanDistance: item.euclideanDistance,
        tokenHits: item.tokenHits,
        hitTokens: Array.isArray(item.hitTokens) ? item.hitTokens : [],
        rowKey: `${item.docId}-${item.chunkIndex}-${index}`,
        cluster: clusterIdx + 1,
        x: posMap.get(nodeId)?.[0] || 0,
        y: posMap.get(nodeId)?.[1] || 0,
        z: posMap.get(nodeId)?.[2] || 0,
      })
      links.push({
        source: queryNode.id,
        target: nodeId,
        distanceValue: distance,
        kind: 'query',
        label: `${metricKey === 'euclideanDistance' ? '欧式' : '余弦'}距离: ${distance.toFixed(6)}`,
      })
    })
    buildKnnLinks(projectedRows, Math.min(4, Math.max(2, Math.floor(usableRows.length / 4)))).forEach((item) => {
      links.push({
        ...item,
        label: `邻近距离: ${Number(item.distanceValue || 0).toFixed(4)}`,
      })
    })

    return { nodes, links }
  }, [result3d])

  const filteredGraphData = useMemo(() => {
    const base = (() => {
      if (clusterFilter === 'all') return graphData
      const selected = Number(clusterFilter)
      const visibleNodeIds = new Set(
        graphData.nodes
          .filter((n) => n.nodeType === 'query' || Number(n.cluster) === selected)
          .map((n) => n.id),
      )
      const safeLinks = graphData.links
        .map((l) => ({
          ...l,
          source: typeof l.source === 'object' ? l.source?.id : l.source,
          target: typeof l.target === 'object' ? l.target?.id : l.target,
        }))
      return {
        nodes: graphData.nodes.filter((n) => visibleNodeIds.has(n.id)),
        links: safeLinks.filter((l) => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)),
      }
    })()

    if (!base.nodes.length) return base
    const anchorNodes = base.nodes.some((n) => n.nodeType === 'chunk')
      ? base.nodes.filter((n) => n.nodeType === 'chunk')
      : base.nodes
    const xs = anchorNodes.map((n) => Number(n.x || 0))
    const ys = anchorNodes.map((n) => Number(n.y || 0))
    const zs = anchorNodes.map((n) => Number(n.z || 0))
    const center = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    }
    const nodes = base.nodes.map((n) => ({
      ...n,
      x: Number(n.x || 0) - center.x,
      y: Number(n.y || 0) - center.y,
      z: Number(n.z || 0) - center.z,
    }))
    const links = base.links.map((l) => ({
      ...l,
      source: typeof l.source === 'object' ? l.source?.id : l.source,
      target: typeof l.target === 'object' ? l.target?.id : l.target,
    }))
    return { nodes, links }
  }, [graphData, clusterFilter])

  const filteredTableData = useMemo(() => {
    if (clusterFilter === 'all') return tableData
    const visibleRowKeys = new Set(
      filteredGraphData.nodes
        .filter((n) => n.nodeType === 'chunk')
        .map((n) => n.rowKey),
    )
    return tableData.filter((row) => visibleRowKeys.has(row.key))
  }, [tableData, filteredGraphData, clusterFilter])

  useEffect(() => {
    if (!graphOpen || !graphRef.current || filteredGraphData.nodes.length === 0) return
    const t1 = setTimeout(() => recenterGraph(), 80)
    const t2 = setTimeout(() => recenterGraph(), 420)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [graphOpen, filteredGraphData])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>向量检索工作台</Title>
          <Text type="secondary">语义召回 + 关键词重排。距离值越小，相关性越高。</Text>
          <Space wrap>
            <Select
              loading={loadingKb}
              style={{ width: 320 }}
              placeholder="选择知识库"
              value={kbId || undefined}
              onChange={setKbId}
              options={knowledgeBases.map((item) => ({ label: item.name, value: item.id }))}
            />
            <Select
              style={{ width: 160 }}
              value={metric}
              onChange={setMetric}
              options={[
                { label: '余弦距离', value: 'cosine' },
                { label: '欧式距离', value: 'euclidean' },
              ]}
            />
            <Select
              style={{ width: 120 }}
              value={topK}
              onChange={setTopK}
              options={[10, 20, 30, 50, 100].map((num) => ({ label: `TopK ${num}`, value: num }))}
            />
            <Select
              style={{ width: 190 }}
              value={strictKeyword ? 'strict' : 'loose'}
              onChange={(v) => setStrictKeyword(v === 'strict')}
              options={[
                { label: '严格关键词（推荐）', value: 'strict' },
                { label: '宽松关键词', value: 'loose' },
              ]}
            />
          </Space>
          <Input.TextArea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入检索词，例如：供应商质量认证体系"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <Space>
            <Button type="primary" loading={searching2d} onClick={onSearch}>开始检索</Button>
            <Button loading={searching3d} onClick={onSearch3D}>3D检索</Button>
            <Button onClick={loadKnowledgeBases}>刷新知识库</Button>
          </Space>
        </Space>
      </Card>

      {result2d ? (
        <Card className="app-elevated-card">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color="blue">知识库: {result2d.kbId}</Tag>
              <Tag color="gold">度量: {result2d.metric === 'euclidean' ? '欧式距离' : '余弦距离'}</Tag>
              <Tag color="green">结果: {result2d.results?.length || 0}</Tag>
              <Tag>TopK: {result2d.topK}</Tag>
            </Space>
            <Text type="secondary">查询词：{result2d.query}</Text>
            {Array.isArray(result2d.queryTokens) && result2d.queryTokens.length > 0 ? (
              <Space size={[6, 6]} wrap>
                {result2d.queryTokens.map((token) => <Tag key={token}>{token}</Tag>)}
              </Space>
            ) : null}
            <Alert
              type="info"
              showIcon
              message="解释说明"
              description="关键词命中数用于重排参考，不代表最终语义分。若结果偏少，可切换为“宽松关键词”。"
            />
            <Divider style={{ margin: '4px 0' }} />
            <Table
              size="small"
              rowKey="key"
              dataSource={tableData}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: '#', dataIndex: 'rank', width: 64 },
                {
                  title: '来源',
                  dataIndex: 'docId',
                  width: 200,
                  render: (_, row) => (
                    <Button
                      size="small"
                      onClick={() => {
                        const payload = {
                          kbId: row.kbId || result2d?.kbId,
                          docId: row.docId,
                          sourceType: row.sourceType,
                        }
                        sessionStorage.setItem('kbFocusDoc', JSON.stringify(payload))
                        navigate('/capability-center/knowledge-base')
                      }}
                    >
                      查看来源
                    </Button>
                  ),
                },
                {
                  title: '来源类型',
                  dataIndex: 'sourceType',
                  width: 96,
                  filters: [
                    { text: '文件', value: 'file' },
                    { text: '网页', value: 'web' },
                    { text: '搜索', value: 'search' },
                  ],
                  onFilter: (value, record) => String(record.sourceType || '') === String(value || ''),
                  render: (v) => {
                    const meta = sourceTypeLabel(v)
                    return <Tag color={meta.color}>{meta.text}</Tag>
                  },
                },
                { title: '片段序号', dataIndex: 'chunkIndex', width: 90 },
                { title: '关键词命中数', dataIndex: 'tokenHits', width: 108, render: (_, row) => `${row.tokenHits || 0}` },
                { title: '整句命中', dataIndex: 'phraseHit', width: 90, render: (_, row) => (row.phraseHit ? '是' : '否') },
                {
                  title: '命中词',
                  dataIndex: 'hitTokens',
                  width: 180,
                  render: (_, row) => (
                    <Space size={[4, 4]} wrap>
                      {(row.hitTokens || []).slice(0, 4).map((token) => <Tag key={token}>{token}</Tag>)}
                    </Space>
                  ),
                },
                { title: '余弦距离(越小越相关)', dataIndex: 'cosineDistance', width: 148, render: (v) => Number(v || 0).toFixed(6) },
                { title: '欧式距离(越小越相关)', dataIndex: 'euclideanDistance', width: 148, render: (v) => Number(v || 0).toFixed(6) },
                {
                  title: '命中文本',
                  dataIndex: 'chunkText',
                  render: (v, row) => (
                    <div
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        padding: 0,
                        lineHeight: 1.6,
                      }}
                    >
                      <Text>{renderHighlightedText(snippetAroundHit(v, row.hitTokens, 180), (result2d?.queryTokens || []).join(' '))}</Text>
                    </div>
                  ),
                },
              ]}
            />
          </Space>
        </Card>
      ) : null}
      <Modal
        title="3D向量检索图谱"
        open={graphOpen}
        onCancel={() => setGraphOpen(false)}
        afterOpenChange={(open) => {
          if (!open) return
          setTimeout(() => recenterGraph(), 30)
          setTimeout(() => recenterGraph(), 260)
        }}
        footer={null}
        width={1200}
      >
        {result3d == null || graphData.nodes.length === 0 ? (
          <Alert type="info" showIcon message="暂无可视化数据" description="请先执行检索，或检查知识库是否有向量结果。" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">
              UMAP 3D投影 + kNN邻近连边：颜色代表聚类分组，节点大小代表相关强度。点击节点可查看详情并联动下方结果表。
            </Text>
              <Space size={[8, 8]} wrap>
                <Button size="small" onClick={recenterGraph}>居中</Button>
                <Button size="small" onClick={resetViewGraph}>重置视角</Button>
                <Tag
                  style={{ cursor: 'pointer', borderWidth: clusterFilter === 'all' ? 2 : 1 }}
                  onClick={() => setClusterFilter('all')}
                color="default"
              >
                全部
              </Tag>
              <Tag color="blue">查询节点</Tag>
              <Tag
                style={{ cursor: 'pointer', borderWidth: clusterFilter === '1' ? 2 : 1 }}
                onClick={() => setClusterFilter(clusterFilter === '1' ? 'all' : '1')}
                color="green"
              >
                聚类A
              </Tag>
              <Tag
                style={{ cursor: 'pointer', borderWidth: clusterFilter === '2' ? 2 : 1 }}
                onClick={() => setClusterFilter(clusterFilter === '2' ? 'all' : '2')}
                color="gold"
              >
                聚类B
              </Tag>
              <Tag
                style={{ cursor: 'pointer', borderWidth: clusterFilter === '3' ? 2 : 1 }}
                onClick={() => setClusterFilter(clusterFilter === '3' ? 'all' : '3')}
                color="cyan"
              >
                聚类C
              </Tag>
              <Tag
                style={{ cursor: 'pointer', borderWidth: clusterFilter === '4' ? 2 : 1 }}
                onClick={() => setClusterFilter(clusterFilter === '4' ? 'all' : '4')}
                color="red"
              >
                聚类D
              </Tag>
              <Tag
                style={{ cursor: 'pointer', borderWidth: clusterFilter === '5' ? 2 : 1 }}
                onClick={() => setClusterFilter(clusterFilter === '5' ? 'all' : '5')}
                color="purple"
              >
                聚类E
              </Tag>
              <Tag>粗线：查询关联</Tag>
              <Tag>细线：邻近关系</Tag>
            </Space>
            <div style={{ height: 640, border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden', background: 'radial-gradient(circle at 25% 20%, #1d4ed8 0%, #0b1028 45%, #030617 100%)' }}>
              <ForceGraph3D
                ref={graphRef}
                graphData={filteredGraphData}
                nodeLabel={(node) => {
                  if (node.nodeType === 'query') return node.label
                  return `${node.label}<br/>余弦: ${Number(node.cosineDistance || 0).toFixed(6)}<br/>欧式: ${Number(node.euclideanDistance || 0).toFixed(6)}`
                }}
                linkLabel={(link) => link.label}
                nodeColor={(node) => node.color || '#1677ff'}
                nodeVal={(node) => Number(node.val || 6)}
                linkOpacity={(link) => (link.kind === 'query' ? 0.7 : 0.25)}
                linkDirectionalParticles={(link) => (link.kind === 'query' ? 2 : 0)}
                linkDirectionalParticleSpeed={0.004}
                backgroundColor="rgba(0,0,0,0)"
                enableNodeDrag={false}
                nodeResolution={16}
                cooldownTicks={0}
                warmupTicks={0}
                enableNavigationControls
                linkWidth={(link) => {
                  const d = Number(link.distanceValue || 1)
                  if (link.kind !== 'query') return 0.6
                  return Number.isFinite(d) ? Math.max(0.8, 2.4 - d * 2) : 1
                }}
                onNodeHover={(node) => {
                  const canvas = graphRef.current?.renderer?.()?.domElement
                  if (canvas?.style) canvas.style.cursor = node ? 'pointer' : 'grab'
                }}
                onNodeClick={(node) => {
                  setActiveNode(node)
                  setNodeDetailOpen(true)
                  if (node.rowKey) setActiveRowKey(node.rowKey)
                }}
                onBackgroundClick={() => {
                  setActiveNode(null)
                }}
              />
            </div>
            <Table
              size="small"
              rowKey="key"
              dataSource={filteredTableData}
              pagination={{ pageSize: 6 }}
              rowClassName={(record) => (record.key === activeRowKey ? 'ant-table-row-selected' : '')}
              columns={[
                { title: '#', dataIndex: 'rank', width: 64 },
                { title: '来源', dataIndex: 'docName', width: 220, render: (v) => shortText(v || '-', 30) },
                { title: '片段', dataIndex: 'chunkIndex', width: 90 },
                { title: '余弦距离', dataIndex: 'cosineDistance', width: 130, render: (v) => Number(v || 0).toFixed(6) },
                { title: '欧式距离', dataIndex: 'euclideanDistance', width: 130, render: (v) => Number(v || 0).toFixed(6) },
                { title: '命中摘要', dataIndex: 'chunkText', render: (v) => shortText(v || '-', 90) },
              ]}
              onRow={(record) => ({
                onClick: () => {
                  setActiveRowKey(record.key)
                  const node = filteredGraphData.nodes.find((n) => n.rowKey === record.key)
                  if (node) setActiveNode(node)
                },
              })}
            />
          </Space>
        )}
      </Modal>
      <Drawer
        title={activeNode?.nodeType === 'query' ? '查询节点详情' : '向量节点详情'}
        open={nodeDetailOpen && !!activeNode}
        onClose={() => setNodeDetailOpen(false)}
        width={560}
        placement="right"
        styles={{
          body: {
            background: 'linear-gradient(180deg, #f8fbff 0%, #f1f5ff 100%)',
          },
        }}
      >
        {activeNode ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color="blue">节点: {activeNode.nodeType === 'query' ? '查询' : '片段'}</Tag>
              {activeNode.nodeType !== 'query' ? <Tag color="gold">聚类: {activeNode.cluster || '-'}</Tag> : null}
            </Space>
            <Text><b>名称：</b>{activeNode.label || '-'}</Text>
            {activeNode.nodeType !== 'query' ? (
              <>
                <Text><b>文档ID：</b>{activeNode.docId || '-'}</Text>
                <Text><b>片段序号：</b>{activeNode.chunkIndex ?? '-'}</Text>
                <Text><b>余弦距离：</b>{Number(activeNode.cosineDistance || 0).toFixed(6)}</Text>
                <Text><b>欧式距离：</b>{Number(activeNode.euclideanDistance || 0).toFixed(6)}</Text>
                <Text><b>聚类分组：</b>{activeNode.cluster || '-'}</Text>
                <Text><b>命中数：</b>{activeNode.tokenHits ?? 0}</Text>
                <div
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid #dbeafe',
                    borderRadius: 10,
                    padding: 10,
                    maxHeight: 260,
                    overflow: 'auto',
                    lineHeight: 1.7,
                  }}
                >
                  <Text strong>片段：</Text>
                  <div>
                    {renderHighlightedText(
                      snippetAroundHit(activeNode.chunkText || '', activeNode.hitTokens || [], 320),
                      (activeNode.hitTokens || []).join(' '),
                    )}
                  </div>
                </div>
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      const payload = {
                        kbId: activeNode.kbId || result3d?.kbId,
                        docId: activeNode.docId,
                        sourceType: activeNode.sourceType,
                      }
                      sessionStorage.setItem('kbFocusDoc', JSON.stringify(payload))
                      setNodeDetailOpen(false)
                      setGraphOpen(false)
                      navigate('/capability-center/knowledge-base')
                    }}
                  >
                    查看来源
                  </Button>
                  <Button
                    size="small"
                    disabled={!String(activeNode.docUrl || '').trim()}
                    onClick={() => {
                      const url = String(activeNode.docUrl || '').trim()
                      if (!url) return
                      window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    打开原文链接
                  </Button>
                </Space>
              </>
            ) : (
              <Text><b>查询词：</b>{renderHighlightedText(activeNode.query || '', activeNode.query || '')}</Text>
            )}
          </Space>
        ) : null}
      </Drawer>
    </Space>
  )
}
