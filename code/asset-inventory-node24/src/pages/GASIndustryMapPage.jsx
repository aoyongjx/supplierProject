import {
  AimOutlined,
  BulbOutlined,
  LinkOutlined,
  MoonOutlined,
  PartitionOutlined,
} from '@ant-design/icons'
import { Button, Card, Empty, Segmented, Select, Space, Spin, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import SpriteText from 'three-spritetext'
import { fetchGASSupplyChainTree } from '../api/gasSupplyChainApi'

const { Title, Text } = Typography

const MODE_OPTIONS = [
  { label: '3D树形分层（可拖拽）', value: '3d-tree' },
  { label: '3D力导关系', value: '3d-force' },
  { label: '2D树形分层（可拖拽）', value: '2d-tree' },
  { label: '2D力导关系', value: '2d-force' },
  { label: 'GraphRAG Visualizer', value: 'graphrag' },
]

function flattenTreeToGraph(roots = []) {
  const nodes = []
  const links = []
  const visited = new Set()

  const walk = (node, parent = null, depth = 1, rootGroup = '') => {
    const id = String(node?.id ?? node?.key ?? `${node?.title || node?.nodeName || ''}-${depth}`)
    if (!id || visited.has(id)) return
    visited.add(id)
    const name = String(node?.title || node?.nodeName || id)
    const level = Number(node?.nodeLevel || depth)
    const groupId = rootGroup || id

    nodes.push({
      id,
      name,
      level: Number.isInteger(level) && level > 0 ? level : depth,
      groupId,
      parentId: parent ? String(parent.id) : '',
      sourceUrl: String(node?.sourceUrl || node?.nodeUrl || ''),
    })
    if (parent?.id) {
      links.push({ source: String(parent.id), target: id })
    }
    for (const child of (node?.children || [])) walk(child, { id }, depth + 1, groupId)
  }

  for (const root of roots || []) walk(root, null, 1, '')
  return { nodes, links }
}

function buildIndexes(graphData) {
  const childrenById = new Map()
  for (const link of graphData.links || []) {
    const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
    const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
    const arr = childrenById.get(sourceId) || []
    arr.push(targetId)
    childrenById.set(sourceId, arr)
  }
  return { childrenById }
}

function collectDescendants(rootId, childrenById) {
  const seen = new Set()
  if (!rootId) return seen
  const queue = [String(rootId)]
  while (queue.length > 0) {
    const current = queue.shift()
    if (seen.has(current)) continue
    seen.add(current)
    const children = childrenById.get(current) || []
    for (const child of children) {
      if (!seen.has(child)) queue.push(child)
    }
  }
  return seen
}

function buildStructuredPositions(nodes = []) {
  const byId = new Map(nodes.map((n) => [String(n.id), n]))
  const roots = nodes
    .filter((n) => !n.parentId || !byId.has(String(n.parentId)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))

  const childrenByParent = new Map()
  for (const item of nodes) {
    if (!item.parentId) continue
    const key = String(item.parentId)
    const arr = childrenByParent.get(key) || []
    arr.push(item)
    childrenByParent.set(key, arr)
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
  }

  const placed = new Map()
  const rootGap = roots.length <= 1 ? 0 : 520

  const placeChildren = (parent, depth) => {
    const children = childrenByParent.get(String(parent.id)) || []
    if (children.length === 0) return
    const spread = Math.min(560, Math.max(160, children.length * 80))
    const step = children.length <= 1 ? 0 : spread / (children.length - 1)
    children.forEach((child, idx) => {
      const x = parent.x + (idx - (children.length - 1) / 2) * step
      const y = parent.y - 175
      const z = parent.z - 140
      const node = { ...child, x, y, z }
      placed.set(String(child.id), node)
      placeChildren(node, depth + 1)
    })
  }

  roots.forEach((root, idx) => {
    const node = {
      ...root,
      x: (idx - (roots.length - 1) / 2) * rootGap,
      y: 240,
      z: 140,
    }
    placed.set(String(root.id), node)
    placeChildren(node, 2)
  })

  let fallback = 0
  for (const item of nodes) {
    if (placed.has(String(item.id))) continue
    placed.set(String(item.id), { ...item, x: -740 + fallback * 44, y: -300, z: -420 })
    fallback += 1
  }
  return [...placed.values()]
}

function getBaseNodeColor(level, isDark) {
  const light = ['#0284C7', '#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD']
  const dark = ['#38BDF8', '#67E8F9', '#7DD3FC', '#93C5FD', '#BAE6FD']
  const palette = isDark ? dark : light
  return palette[(Math.max(1, Number(level || 1)) - 1) % palette.length]
}

function resolveNodeColor(node, selectedId, selectedSet, isDark) {
  const id = String(node?.id || '')
  if (!selectedId) return getBaseNodeColor(node.level, isDark)
  if (id === String(selectedId)) return isDark ? '#FDE047' : '#F59E0B'
  if (selectedSet.has(id)) return isDark ? '#22D3EE' : '#0284C7'
  return isDark ? 'rgba(51,65,85,0.34)' : 'rgba(148,163,184,0.38)'
}

function GASIndustryMapPage() {
  const graph3dRef = useRef(null)
  const graphRagFrameRef = useRef(null)
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [rawGraphData, setRawGraphData] = useState({ nodes: [], links: [] })
  const [graphThemeMode, setGraphThemeMode] = useState('system')
  const [visualMode, setVisualMode] = useState('3d-structured')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [systemTheme, setSystemTheme] = useState(() => (
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  ))
  const [size, setSize] = useState({ width: 980, height: 720 })

  useEffect(() => {
    const htmlNode = document.documentElement
    const observer = new MutationObserver(() => {
      setSystemTheme(htmlNode.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    })
    observer.observe(htmlNode, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      setSize({
        width: Math.max(760, Math.floor(rect.width)),
        height: Math.max(620, Math.floor(window.innerHeight - rect.top - 68)),
      })
    }
    updateSize()
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(el)
    window.addEventListener('resize', updateSize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const tree = await fetchGASSupplyChainTree()
        setRawGraphData(flattenTreeToGraph(tree?.roots || []))
      } catch (error) {
        message.error(error.message || '加载 GAS 产业图谱失败')
        setRawGraphData({ nodes: [], links: [] })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const theme = graphThemeMode === 'system' ? systemTheme : graphThemeMode
  const isDark = theme === 'dark'

  const graphData = useMemo(() => {
    if (visualMode === 'graphrag') return rawGraphData
    const isStructured = visualMode === '3d-tree' || visualMode === '2d-tree'
    const source = isStructured ? {
      nodes: buildStructuredPositions(rawGraphData.nodes || []),
      links: rawGraphData.links || [],
    } : rawGraphData
    if (!visualMode.startsWith('2d')) return source
    return {
      ...source,
      nodes: (source.nodes || []).map((node) => ({
        ...node,
        z: 0,
      })),
    }
  }, [rawGraphData, visualMode])

  const graphRagPayload = useMemo(() => {
    const nodes = (rawGraphData.nodes || []).map((node, index) => ({
      id: String(node.id),
      uuid: String(node.id),
      title: String(node.name || node.id),
      name: String(node.name || node.id),
      type: `L${Number(node.level || 1)}`,
      description: `GAS供应链层级 ${Number(node.level || 1)}`,
      human_readable_id: index + 1,
      text_unit_ids: [],
    }))
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const links = (rawGraphData.links || [])
      .map((link, index) => {
        const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
        const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
        const sourceNode = nodeMap.get(sourceId)
        const targetNode = nodeMap.get(targetId)
        if (!sourceNode || !targetNode) return null
        return {
          id: `gas-rel-${index + 1}`,
          human_readable_id: index + 1,
          source: sourceNode.title,
          target: targetNode.title,
          type: 'RELATED',
          description: `${sourceNode.title} -> ${targetNode.title}`,
          weight: 1,
          combined_degree: 1,
          text_unit_ids: [],
        }
      })
      .filter(Boolean)
    return { nodes, links }
  }, [rawGraphData])

  useEffect(() => {
    if (visualMode !== 'graphrag') return
    if (!graphRagFrameRef.current?.contentWindow) return
    graphRagFrameRef.current.contentWindow.postMessage({
      type: 'graphrag-load-custom-graph',
      graphData: graphRagPayload,
    }, 'http://localhost:3190')
  }, [visualMode, graphRagPayload])

  const indexes = useMemo(() => buildIndexes(graphData), [graphData])
  const selectedSet = useMemo(() => collectDescendants(selectedNodeId, indexes.childrenById), [selectedNodeId, indexes])

  const maxLevel = useMemo(() => (
    graphData.nodes.reduce((max, item) => Math.max(max, Number(item.level || 1)), 1)
  ), [graphData.nodes])

  const fitCamera = () => {
    if (!graph3dRef.current) return
    graph3dRef.current.zoomToFit(700, 80)
    if (visualMode.startsWith('2d')) {
      const controls = graph3dRef.current.controls?.()
      if (controls) {
        controls.enableRotate = false
        controls.enablePan = true
      }
      graph3dRef.current.cameraPosition({ x: 0, y: 0, z: 1100 }, { x: 0, y: 0, z: 0 }, 0)
    } else {
      const controls = graph3dRef.current.controls?.()
      if (controls) controls.enableRotate = true
    }
  }

  const releaseLayout = () => {
    for (const node of graphData.nodes || []) {
      node.fx = undefined
      node.fy = undefined
      node.fz = undefined
    }
    graph3dRef.current?.d3ReheatSimulation?.()
  }

  useEffect(() => {
    if (graphData.nodes.length === 0) return
    const timer = setTimeout(() => fitCamera(), 500)
    return () => clearTimeout(timer)
  }, [graphData, visualMode])

  useEffect(() => {
    if (!graph3dRef.current) return
    const chargeForce = graph3dRef.current.d3Force('charge')
    const linkForce = graph3dRef.current.d3Force('link')
    if (chargeForce?.strength) {
      chargeForce.strength(visualMode.endsWith('force') ? -240 : -150)
    }
    if (linkForce?.distance) {
      linkForce.distance(visualMode.endsWith('force') ? 120 : 180)
    }
  }, [visualMode, graphData.nodes.length, graphData.links.length])

  const handleNodeClick = (node) => {
    const nodeId = String(node?.id || '')
    if (!nodeId) return
    setSelectedNodeId((prev) => (prev === nodeId ? '' : nodeId))
    const nextId = selectedNodeId === nodeId ? '' : nodeId
    if (!nextId) return

    if (graph3dRef.current) {
      const dist = visualMode.startsWith('2d') ? 320 : 220
      const nx = Number(node.x || 0)
      const ny = Number(node.y || 0)
      const nz = Number(node.z || 0)
      graph3dRef.current.cameraPosition(
        visualMode.startsWith('2d')
          ? { x: nx, y: ny, z: dist * 2.8 }
          : { x: nx + dist, y: ny + 90, z: nz + dist },
        { x: nx, y: ny, z: nz },
        900,
      )
    }
  }
  const renderGraph = () => (
    <ForceGraph3D
      ref={graph3dRef}
      width={size.width}
      height={size.height}
      graphData={graphData}
      backgroundColor={isDark ? '#0f172a' : '#f7fbff'}
      d3AlphaDecay={visualMode.endsWith('tree') ? 0.1 : 0.02}
      d3VelocityDecay={0.26}
      cooldownTicks={visualMode.endsWith('tree') ? 40 : 120}
      dagMode={visualMode === '2d-tree' ? 'lr' : visualMode === '3d-tree' ? 'td' : undefined}
      dagLevelDistance={visualMode === '2d-tree' ? 240 : visualMode === '3d-tree' ? 190 : undefined}
      nodeRelSize={8}
      enableNodeDrag
      linkOpacity={0.85}
      linkDirectionalParticles={visualMode.endsWith('force') ? 1 : 0}
      linkDirectionalParticleSpeed={0.0032}
      linkWidth={(link) => {
        const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
        const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
        if (selectedNodeId && selectedSet.has(sourceId) && selectedSet.has(targetId)) return 3.2
        return 2
      }}
      linkColor={(link) => {
        const sourceId = typeof link.source === 'object' ? String(link.source.id) : String(link.source)
        const targetId = typeof link.target === 'object' ? String(link.target.id) : String(link.target)
        if (!selectedNodeId) return isDark ? 'rgba(125,211,252,0.9)' : 'rgba(2,132,199,0.78)'
        if (selectedSet.has(sourceId) && selectedSet.has(targetId)) return isDark ? '#67E8F9' : '#0EA5E9'
        return isDark ? 'rgba(51,65,85,0.3)' : 'rgba(148,163,184,0.38)'
      }}
      nodeColor={(node) => resolveNodeColor(node, selectedNodeId, selectedSet, isDark)}
      nodeVal={(node) => {
        const lv = Number(node.level || 1)
        return 1.2 + Math.max(1, maxLevel - lv) * 0.45
      }}
      nodeLabel={(node) => `${node.name}｜层级 ${node.level}`}
      onNodeClick={handleNodeClick}
      onNodeDrag={(node) => {
        if (visualMode.startsWith('2d')) {
          node.z = 0
          node.fz = 0
        }
      }}
      onNodeDragEnd={(node) => {
        if (!node) return
        node.fx = undefined
        node.fy = undefined
        node.fz = visualMode.startsWith('2d') ? 0 : undefined
      }}
      nodeThreeObjectExtend
      nodeThreeObject={(node) => {
        const shortLabel = String(node.name || '').length > 20
          ? `${String(node.name).slice(0, 20)}…`
          : String(node.name || '')
        const sprite = new SpriteText(`${shortLabel}\nL${node.level}`)
        sprite.color = isDark ? '#dbeafe' : '#1e3a8a'
        sprite.textHeight = Number(node.level || 1) <= 1 ? 8 : 6.2
        sprite.backgroundColor = isDark ? 'rgba(30,41,59,0.72)' : 'rgba(255,255,255,0.88)'
        sprite.padding = 3
        sprite.borderRadius = 4
        sprite.position.set(0, 10, 0)
        return sprite
      }}
    />
  )

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>GAS产业图谱</Title>
            <Text className="muted">支持拖拽、缩放、节点选择高亮子节点与视角跟随。</Text>
          </Space>
          <Space wrap>
            <Tag color="blue">节点 {graphData.nodes.length}</Tag>
            <Tag color="cyan">关系 {graphData.links.length}</Tag>
            <Tag color="orange">层级 {maxLevel}</Tag>
            <Select
              style={{ minWidth: 180 }}
              value={visualMode}
              options={MODE_OPTIONS}
              onChange={setVisualMode}
              placeholder="选择可视化效果"
            />
            <Segmented
              value={graphThemeMode}
              onChange={setGraphThemeMode}
              options={[
                { label: '跟随系统', value: 'system', icon: <PartitionOutlined /> },
                { label: '浅色', value: 'light', icon: <BulbOutlined /> },
                { label: '深色', value: 'dark', icon: <MoonOutlined /> },
              ]}
            />
            <Button icon={<AimOutlined />} onClick={fitCamera}>重置视角</Button>
            <Button onClick={releaseLayout}>释放布局</Button>
            <Button onClick={() => setSelectedNodeId('')}>清除选中</Button>
            {visualMode === 'graphrag' ? (
              <Button
                icon={<LinkOutlined />}
                onClick={() => window.open('http://localhost:3190', '_blank', 'noopener,noreferrer')}
              >
                新窗口打开
              </Button>
            ) : null}
          </Space>
        </Space>
      </Card>

      <Card className="app-elevated-card" bodyStyle={{ padding: 10 }}>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            minHeight: 620,
            borderRadius: 12,
            overflow: 'hidden',
            background: isDark
              ? 'linear-gradient(180deg, #0b1220 0%, #0f172a 52%, #172554 100%)'
              : 'linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 45%, #f8fbff 100%)',
          }}
        >
          {loading ? (
            <div style={{ minHeight: 620, display: 'grid', placeItems: 'center' }}>
              <Spin tip="正在加载图谱数据..." />
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div style={{ minHeight: 620, display: 'grid', placeItems: 'center' }}>
              <Empty description="暂无图谱数据" />
            </div>
          ) : visualMode === 'graphrag' ? (
            <iframe
              ref={graphRagFrameRef}
              title="GraphRAG Visualizer"
              src="http://localhost:3190"
              onLoad={() => {
                if (!graphRagFrameRef.current?.contentWindow) return
                graphRagFrameRef.current.contentWindow.postMessage({
                  type: 'graphrag-load-custom-graph',
                  graphData: graphRagPayload,
                }, 'http://localhost:3190')
              }}
              style={{ width: '100%', minHeight: 620, border: 0, background: 'transparent' }}
            />
          ) : (
            renderGraph()
          )}
        </div>
      </Card>
    </Space>
  )
}

export default GASIndustryMapPage
