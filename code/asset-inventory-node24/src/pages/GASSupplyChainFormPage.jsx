import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Spin, Tree, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createGASSupplyChainRecord,
  fetchGASSupplyChainRecordDetail,
  fetchGASSupplyChainTree,
  updateGASSupplyChainRecord,
} from '../api/gasSupplyChainApi'

const { Title, Text } = Typography
const GASGOO_DEFAULT_URL = 'https://i.gasgoo.com/supplier/c-301.html'

function findNodeLabel(nodes = [], id) {
  if (!id) return ''
  for (const node of nodes) {
    if (String(node.id) === String(id) || String(node.key) === String(id)) return node.title || ''
    const child = findNodeLabel(node.children || [], id)
    if (child) return child
  }
  return ''
}

function findNodePath(nodes = [], targetId, path = []) {
  for (const node of nodes) {
    const currentId = String(node.id || node.key)
    const currentPath = [...path, currentId]
    if (currentId === String(targetId)) return currentPath
    const childPath = findNodePath(node.children || [], targetId, currentPath)
    if (childPath.length > 0) return childPath
  }
  return []
}

function GASSupplyChainFormPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [treeData, setTreeData] = useState([])
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [selectedParentId, setSelectedParentId] = useState('')
  const [pickerExpandedKeys, setPickerExpandedKeys] = useState([])
  const [pickerSelectedKeys, setPickerSelectedKeys] = useState([])
  const [recordLoading, setRecordLoading] = useState(false)
  const [recordLoadError, setRecordLoadError] = useState('')
  const [treeLoadError, setTreeLoadError] = useState('')

  const editId = useMemo(() => {
    const val = Number(id)
    return Number.isInteger(val) && val > 0 ? val : null
  }, [id])

  const routeRecord = useMemo(() => {
    const record = location.state?.record
    if (!record || Number(record.id) !== Number(editId)) return null
    return record
  }, [location.state, editId])

  useEffect(() => {
    fetchGASSupplyChainTree()
      .then((res) => {
        setTreeData(res.roots || [])
        setTreeLoadError('')
      })
      .catch((error) => {
        const text = error.message || '加载 GAS 供应链树失败'
        setTreeLoadError(text)
        message.error(text)
      })
  }, [])

  useEffect(() => {
    if (!editId) {
      form.setFieldsValue({
        nodeLevel: 1,
        sourceUrl: GASGOO_DEFAULT_URL,
        syncedSupplierCount: 0,
      })
    }
  }, [editId, form])

  useEffect(() => {
    if (!routeRecord) return
    const pid = routeRecord.parentId ? String(routeRecord.parentId) : ''
    setSelectedParentId(pid)
    form.setFieldsValue({
      nodeName: routeRecord.nodeName || '',
      parentId: pid || undefined,
      nodeLevel: Number(routeRecord.nodeLevel || 1),
      sourceUrl: routeRecord.sourceSiteUrl || routeRecord.sourceUrl || '',
      syncedSupplierCount: Number(routeRecord.syncedSupplierCount || 0),
    })
  }, [routeRecord, form])

  useEffect(() => {
    if (!editId) return
    setRecordLoading(true)
    setRecordLoadError('')
    fetchGASSupplyChainRecordDetail(editId)
      .then((detail) => {
        const pid = detail.parentId ? String(detail.parentId) : ''
        setSelectedParentId(pid)
        form.setFieldsValue({
          nodeName: detail.nodeName || '',
          parentId: pid || undefined,
          nodeLevel: Number(detail.nodeLevel || 1),
          sourceUrl: detail.sourceSiteUrl || detail.sourceUrl || '',
          syncedSupplierCount: Number(detail.syncedSupplierCount || 0),
        })
      })
      .catch((error) => {
        const text = error.message || '加载失败'
        setRecordLoadError(text)
        message.error(text)
      })
      .finally(() => setRecordLoading(false))
  }, [editId, form])

  const parentLabel = useMemo(() => findNodeLabel(treeData, selectedParentId), [treeData, selectedParentId])
  const parentDisplay = useMemo(
    () => (selectedParentId ? `${selectedParentId} - ${parentLabel || '(无名称)'}` : ''),
    [selectedParentId, parentLabel],
  )

  const openParentPicker = () => {
    if (selectedParentId) {
      const pathKeys = findNodePath(treeData, selectedParentId)
      setPickerExpandedKeys(pathKeys)
      setPickerSelectedKeys([String(selectedParentId)])
    } else {
      const rootKey = treeData?.[0]?.id ? String(treeData[0].id) : ''
      setPickerExpandedKeys(rootKey ? [rootKey] : [])
      setPickerSelectedKeys([])
    }
    setParentPickerOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const payload = {
        nodeName: values.nodeName,
        parentId: values.parentId ? Number(values.parentId) : null,
        nodeLevel: Number(values.nodeLevel),
        sourceUrl: values.sourceUrl || '',
        syncedSupplierCount: Number(values.syncedSupplierCount || 0),
      }
      if (editId) {
        await updateGASSupplyChainRecord(editId, payload)
        message.success('修改成功')
      } else {
        await createGASSupplyChainRecord(payload)
        message.success('新增成功')
      }
      navigate('/gas-supply-chain')
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>{editId ? '修改 GAS 供应链节点' : '新增 GAS 供应链节点'}</Title>
            <Text className="muted">{editId ? `节点ID：${editId}` : '创建新节点'}</Text>
          </Space>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/gas-supply-chain')}>返回列表</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit}>保存</Button>
          </Space>
        </Space>

        {editId && recordLoading ? <Spin description="正在加载节点详情..." /> : null}
        {recordLoadError ? <Alert type="error" showIcon title="节点详情加载失败" description={recordLoadError} /> : null}
        {treeLoadError ? <Alert type="warning" showIcon title="供应链树加载失败" description={treeLoadError} /> : null}

        <Form form={form} layout="vertical" style={{ maxWidth: 760 }} disabled={recordLoading}>
          <Form.Item name="nodeName" label="节点名称" rules={[{ required: true, message: '请输入节点名称' }]}>
            <Input />
          </Form.Item>

          <Form.Item label="上级节点">
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={parentDisplay} placeholder="请选择上级节点" />
              <Button onClick={openParentPicker}>选择</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="parentId" hidden>
            <Input />
          </Form.Item>
          <Text className="muted">已选上级节点：{selectedParentId ? `${selectedParentId} - ${parentLabel || '(无名称)'}` : '无（顶级节点）'}</Text>

          <Form.Item name="nodeLevel" label="节点层级（1-5级）" rules={[{ required: true, message: '请选择层级' }]}>
            <Select options={[1, 2, 3, 4, 5].map((item) => ({ value: item, label: `${item}级` }))} />
          </Form.Item>

          <Form.Item name="sourceUrl" label="来源链接">
            <Input />
          </Form.Item>

          <Form.Item name="syncedSupplierCount" label="同步企业数">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Space>

      <Modal
        title="选择上级节点"
        open={parentPickerOpen}
        onCancel={() => setParentPickerOpen(false)}
        onOk={() => setParentPickerOpen(false)}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Button
            onClick={() => {
              setSelectedParentId('')
              setPickerSelectedKeys([])
              form.setFieldValue('parentId', undefined)
            }}
          >
            设为顶级节点（无上级）
          </Button>
          <Tree
            treeData={treeData}
            expandedKeys={pickerExpandedKeys}
            selectedKeys={pickerSelectedKeys}
            onExpand={(keys) => setPickerExpandedKeys(keys.map((key) => String(key)))}
            onSelect={(keys, info) => {
              const picked = keys[0] || ''
              setSelectedParentId(String(picked || ''))
              setPickerSelectedKeys(picked ? [String(picked)] : [])
              form.setFieldValue('parentId', picked ? String(picked) : undefined)
              if (info?.node?.nodeLevel) {
                const nextLevel = Math.min(5, Number(info.node.nodeLevel) + 1)
                form.setFieldValue('nodeLevel', nextLevel)
              }
            }}
            height={420}
          />
        </Space>
      </Modal>
    </Card>
  )
}

export default GASSupplyChainFormPage
