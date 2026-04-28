import { LinkOutlined, RadarChartOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Row, Col, Select, Space, Spin, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { fetchGasSupplierProfileDetail, fetchGasSupplierProfileOptions, fetchGasSupplierProfiles } from '../api/gasSupplierProfileApi'
import { buildGasSupplierPortrait, readPortraitSettings } from '../utils/gasSupplierPortrait'

const { Title, Text } = Typography

function GasSupplierPortraitPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [supplyChainTree, setSupplyChainTree] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState()
  const [selectedIdA, setSelectedIdA] = useState()
  const [selectedIdB, setSelectedIdB] = useState()
  const [detailA, setDetailA] = useState(null)
  const [detailB, setDetailB] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [portraitSettings] = useState(() => readPortraitSettings())

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchGasSupplierProfiles({ limit: 5000 })
        const options = await fetchGasSupplierProfileOptions()
        const rows = Array.isArray(data) ? data : []
        setProfiles(rows)
        setSupplyChainTree(Array.isArray(options?.supplyChainTree) ? options.supplyChainTree : [])
        if (rows.length > 0) setSelectedIdA(Number(rows[0].id))
      } catch (error) {
        message.error(error.message || '加载GAS供应商档案失败')
        setProfiles([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedIdA && !selectedIdB) return
    const loadDetail = async () => {
      setDetailLoading(true)
      try {
        if (selectedIdA) {
          const dataA = await fetchGasSupplierProfileDetail(selectedIdA)
          setDetailA(dataA || null)
        } else {
          setDetailA(null)
        }
        if (selectedIdB) {
          const dataB = await fetchGasSupplierProfileDetail(selectedIdB)
          setDetailB(dataB || null)
        } else {
          setDetailB(null)
        }
      } catch (error) {
        message.error(error.message || '加载供应商画像详情失败')
        setDetailA(null)
        setDetailB(null)
      } finally {
        setDetailLoading(false)
      }
    }
    loadDetail()
  }, [selectedIdA, selectedIdB])

  const portraitA = useMemo(() => buildGasSupplierPortrait(detailA || {}, portraitSettings), [detailA, portraitSettings])
  const portraitB = useMemo(() => buildGasSupplierPortrait(detailB || {}, portraitSettings), [detailB, portraitSettings])
  const zeroDimensions = useMemo(() => (
    (portraitA.dimensions || []).map((item) => ({ ...item, score: 0, quality: 0, risk: 0, activity: 0 }))
  ), [portraitA.dimensions])

  const nodeOptions = useMemo(() => {
    const flat = []
    const walk = (list = []) => {
      list.forEach((item) => {
        flat.push({ value: Number(item.id || item.value), label: item.title })
        walk(item.children || [])
      })
    }
    walk(supplyChainTree)
    return flat.filter((item) => Number.isInteger(item.value) && item.value > 0)
  }, [supplyChainTree])

  const filteredProfiles = useMemo(() => {
    if (!selectedNodeId) return profiles
    return profiles.filter((item) => {
      const ids = Array.isArray(item.relatedNodeIds) ? item.relatedNodeIds : []
      return ids.map((v) => Number(v)).includes(Number(selectedNodeId))
    })
  }, [profiles, selectedNodeId])

  const columns = [
    { title: '维度', dataIndex: 'code', width: 220, render: (_, row) => `${row.code}` },
    { title: 'A企业综合分', dataIndex: 'scoreA', width: 110 },
    { title: 'B企业综合分', dataIndex: 'scoreB', width: 110 },
    { title: 'A质量/风险/活跃', dataIndex: 'tripleA', width: 210 },
    { title: 'B质量/风险/活跃', dataIndex: 'tripleB', width: 210 },
    {
      title: '操作',
      width: 130,
      render: (_, row) => (
        <Button
          size="small"
          icon={<LinkOutlined />}
          onClick={() => navigate(`/gas-supplier-profiles/${selectedIdA || selectedIdB}?tab=${row.key}`)}
        >
          跳转Tab
        </Button>
      ),
    },
  ]

  const compareRows = useMemo(() => {
    const byKeyA = new Map((portraitA.dimensions || []).map((item) => [item.key, item]))
    const byKeyB = new Map((portraitB.dimensions || []).map((item) => [item.key, item]))
    const keys = [...new Set([...byKeyA.keys(), ...byKeyB.keys()])]
    return keys.map((key) => {
      const a = byKeyA.get(key)
      const b = byKeyB.get(key)
      return {
        key,
        name: a?.name || b?.name || key.toUpperCase(),
        code: a?.code || b?.code || key.toUpperCase(),
        scoreA: a?.score ?? '-',
        scoreB: b?.score ?? '-',
        tripleA: a ? `${a.quality}/${a.risk}/${a.activity}` : '-',
        tripleB: b ? `${b.quality}/${b.risk}/${b.activity}` : '-',
      }
    })
  }, [portraitA, portraitB])

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>GAS供应商画像</Title>
            <Text className="muted">OpenSanctions 作为主干风险画像策略，叠加 GAS 档案维度评分。</Text>
          </Space>
          <Space>
            <Tag color="blue">主干：OpenSanctions</Tag>
            <Select
              showSearch
              allowClear
              style={{ minWidth: 220 }}
              placeholder="先选GAS供应链节点"
              optionFilterProp="label"
              options={nodeOptions}
              value={selectedNodeId}
              onChange={setSelectedNodeId}
            />
            <Select
              showSearch
              style={{ minWidth: 320 }}
              loading={loading}
              value={selectedIdA}
              placeholder="企业A"
              optionFilterProp="label"
              options={filteredProfiles.map((item) => ({ value: Number(item.id), label: `${item.companyName || `ID:${item.id}`} / ${item.relatedNodeName || '-'}` }))}
              onChange={setSelectedIdA}
            />
            <Select
              showSearch
              allowClear
              style={{ minWidth: 320 }}
              loading={loading}
              value={selectedIdB}
              placeholder="企业B（可选，对比）"
              optionFilterProp="label"
              options={filteredProfiles.map((item) => ({ value: Number(item.id), label: `${item.companyName || `ID:${item.id}`} / ${item.relatedNodeName || '-'}` }))}
              onChange={setSelectedIdB}
            />
          </Space>
        </Space>
      </Card>

      <Card className="app-elevated-card" bodyStyle={{ minHeight: 360 }}>
        {detailLoading ? (
          <div style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}><Spin /></div>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small" title={`画像对比：${detailA?.companyName || '未选择'}（总分 ${detailA ? portraitA.totalScore : 0}） vs ${detailB?.companyName || '未选择'}（总分 ${detailB ? portraitB.totalScore : 0}）`}>
              <Row gutter={12}>
                <Col span={12}>
                  <div style={{ width: '100%', height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={detailA ? portraitA.dimensions : zeroDimensions} outerRadius="72%">
                        <PolarGrid stroke="#7dd3fc" />
                        <PolarAngleAxis dataKey="code" tick={{ fill: '#0369a1', fontSize: 12 }} />
                        <Radar dataKey="score" name="企业A综合分" stroke="#0ea5e9" fill="#38bdf8" fillOpacity={0.25} />
                        <RechartsTooltip formatter={(value) => [`${value} 分`, '']} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </Col>
                <Col span={12}>
                  <div style={{ width: '100%', height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={detailB ? portraitB.dimensions : zeroDimensions} outerRadius="72%">
                        <PolarGrid stroke="#bae6fd" />
                        <PolarAngleAxis dataKey="code" tick={{ fill: '#075985', fontSize: 12 }} />
                        <Radar dataKey="score" name="企业B综合分" stroke="#f59e0b" fill="#fcd34d" fillOpacity={0.25} />
                        <RechartsTooltip formatter={(value) => [`${value} 分`, '']} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </Col>
              </Row>
              <Space wrap>
                {(detailA ? portraitA.dimensions : zeroDimensions).map((item) => (
                  <Button key={item.key} icon={<RadarChartOutlined />} onClick={() => navigate(`/gas-supplier-profiles/${selectedIdA || selectedIdB}?tab=${item.key}`)}>
                    {item.code}
                  </Button>
                ))}
              </Space>
            </Card>
            <Table
              rowKey="key"
              columns={columns}
              dataSource={detailA || detailB ? compareRows : zeroDimensions.map((i) => ({
                key: i.key, code: i.code, scoreA: 0, scoreB: 0, tripleA: '0/0/0', tripleB: '0/0/0',
              }))}
              pagination={false}
              size="small"
            />
          </Space>
        )}
      </Card>
    </Space>
  )
}

export default GasSupplierPortraitPage
