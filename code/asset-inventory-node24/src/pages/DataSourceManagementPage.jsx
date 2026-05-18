import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography,
  message,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createDataSource,
  deleteDataSource,
  fetchDataSourceSchema,
  fetchDataSourceTablePreview,
  fetchDataSources,
  runDataSourceSql,
  testDataSourceConnection,
  updateDataSource,
} from '../api/dataSourceApi'

const { Title, Text } = Typography

function DataSourceManagementPage() {
  const [form] = Form.useForm()
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaData, setSchemaData] = useState({ schemas: [] })
  const [selectedTable, setSelectedTable] = useState({ schema: '', table: '' })
  const [tablePreview, setTablePreview] = useState({ columns: [], rows: [] })
  const [previewLoading, setPreviewLoading] = useState(false)
  const [mode, setMode] = useState('browser')
  const [sqlText, setSqlText] = useState('SELECT now() AS current_time')
  const [sqlLoading, setSqlLoading] = useState(false)
  const [sqlResult, setSqlResult] = useState({ columns: [], rows: [], rowCount: 0, elapsedMs: 0 })
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  const schemaTableHostRef = useRef(null)
  const previewTableHostRef = useRef(null)
  const [schemaTableScrollY, setSchemaTableScrollY] = useState(260)
  const [previewTableScrollY, setPreviewTableScrollY] = useState(260)
  const PASSWORD_PLACEHOLDER = '******'

  const renderCellValue = (value) => {
    if (value === null || typeof value === 'undefined') return '-'
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const selectedSource = useMemo(() => sources.find((x) => Number(x.id) === Number(selectedId)) || null, [sources, selectedId])

  const loadSources = async () => {
    setLoading(true)
    try {
      const rows = await fetchDataSources()
      const list = Array.isArray(rows) ? rows : []
      setSources(list)
      if (!selectedId && list[0]?.id) setSelectedId(list[0].id)
      if (selectedId && !list.some((x) => Number(x.id) === Number(selectedId))) {
        setSelectedId(list[0]?.id || null)
      }
    } catch (error) {
      message.error(error?.message || '读取数据源失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSources()
  }, [])

  const loadSchema = async (sourceId) => {
    if (!sourceId) return
    setSchemaLoading(true)
    setSelectedTable({ schema: '', table: '' })
    setTablePreview({ columns: [], rows: [] })
    try {
      const data = await fetchDataSourceSchema(sourceId)
      setSchemaData(data && typeof data === 'object' ? data : { schemas: [] })
    } catch (error) {
      message.error(error?.message || '读取数据库结构失败')
    } finally {
      setSchemaLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedId) return
    loadSchema(selectedId)
  }, [selectedId])

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const resizeTargets = [
      { ref: schemaTableHostRef, setHeight: setSchemaTableScrollY },
      { ref: previewTableHostRef, setHeight: setPreviewTableScrollY },
    ]
    const observers = []
    resizeTargets.forEach(({ ref, setHeight }) => {
      const el = ref.current
      if (!el) return
      const apply = () => {
        const h = el.clientHeight
        // Reserve table header and optional pagination area, then let body fill the rest.
        setHeight(Math.max(120, h - 92))
      }
      apply()
      if (typeof ResizeObserver !== 'undefined') {
        const obs = new ResizeObserver(apply)
        obs.observe(el)
        observers.push(obs)
      }
    })
    return () => observers.forEach((obs) => obs.disconnect())
  }, [mode, selectedTable.table, tablePreview.rows?.length])

  const treeData = useMemo(() => {
    const rows = Array.isArray(schemaData?.schemas) ? schemaData.schemas : []
    return rows.map((schema) => ({
      key: `schema:${schema.schemaName}`,
      title: `${schema.schemaName}(${Array.isArray(schema.tables) ? schema.tables.length : 0})`,
      children: (Array.isArray(schema.tables) ? schema.tables : []).map((table) => ({
        key: `table:${schema.schemaName}.${table.tableName}`,
        title: table.tableName,
        isLeaf: true,
      })),
    }))
  }, [schemaData])

  const openCreate = () => {
    setEditing(null)
    form.setFieldsValue({ dbType: 'postgresql', host: '127.0.0.1', port: 5432, sslEnabled: false })
    setModalOpen(true)
  }

  const openEdit = (target = null) => {
    const source = target || selectedSource
    if (!source) return
    setEditing(source)
    form.setFieldsValue({
      name: source.name,
      dbType: source.dbType || 'postgresql',
      host: source.host,
      port: source.port,
      databaseName: source.databaseName,
      username: source.username,
      password: PASSWORD_PLACEHOLDER,
      sslEnabled: !!source.sslEnabled,
      description: source.description || '',
    })
    setModalOpen(true)
  }

  const handleTest = async () => {
    const payload = await form.validateFields()
    try {
      const result = await testDataSourceConnection(payload)
      message.success(result?.message || '连接测试成功')
    } catch (error) {
      message.error(error?.message || '连接测试失败')
    }
  }

  const submitSource = async () => {
    const values = await form.validateFields()
    const payload = {
      ...values,
      password: editing?.id && values.password === PASSWORD_PLACEHOLDER ? '' : values.password,
    }
    setSaving(true)
    try {
      if (editing?.id) {
        await updateDataSource(editing.id, payload)
        message.success('更新成功')
      } else {
        await createDataSource(payload)
        message.success('保存成功')
      }
      setModalOpen(false)
      await loadSources()
    } catch (error) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const removeSource = async (target = null) => {
    const source = target || selectedSource
    if (!source) return
    setSaving(true)
    try {
      await deleteDataSource(source.id)
      message.success('删除成功')
      await loadSources()
    } catch (error) {
      message.error(error?.message || '删除失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectTree = async (_keys, info) => {
    const key = String(info?.node?.key || '')
    if (!key.startsWith('table:')) return
    const payload = key.replace('table:', '')
    const idx = payload.indexOf('.')
    if (idx <= 0) return
    const schema = payload.slice(0, idx)
    const table = payload.slice(idx + 1)
    setSelectedTable({ schema, table })
    setPreviewLoading(true)
    try {
      const data = await fetchDataSourceTablePreview(selectedId, schema, table)
      setTablePreview(data && typeof data === 'object' ? data : { columns: [], rows: [] })
    } catch (error) {
      message.error(error?.message || '读取表失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  const runSql = async () => {
    if (!selectedId) {
      message.warning('请先选择数据库连接')
      return
    }
    setSqlLoading(true)
    try {
      const result = await runDataSourceSql(selectedId, sqlText)
      setSqlResult(result && typeof result === 'object' ? result : { columns: [], rows: [], rowCount: 0, elapsedMs: 0 })
      message.success('SQL执行成功')
    } catch (error) {
      message.error(error?.message || 'SQL执行失败')
    } finally {
      setSqlLoading(false)
    }
  }

  const previewColumns = useMemo(() => {
    const cols = Array.isArray(tablePreview.columns) ? tablePreview.columns : []
    return cols.map((col) => ({
      title: col.columnName,
      dataIndex: col.columnName,
      key: col.columnName,
      ellipsis: true,
      width: 180,
      render: (value) => renderCellValue(value),
    }))
  }, [tablePreview])

  const sqlColumns = useMemo(() => {
    const cols = Array.isArray(sqlResult.columns) ? sqlResult.columns : []
    return cols.map((col) => ({
      title: col.name,
      dataIndex: col.name,
      key: col.name,
      ellipsis: true,
      width: 180,
      render: (value) => renderCellValue(value),
    }))
  }, [sqlResult])

  const sqlResultScrollY = useMemo(() => Math.max(320, viewportHeight - 360), [viewportHeight])

  return (
    <Row gutter={12} style={{ height: 'calc(100vh - 128px)', minHeight: 'calc(100vh - 128px)', maxHeight: 'calc(100vh - 128px)', overflow: 'hidden' }}>
      <Col span={5} style={{ height: '100%', display: 'flex' }}>
        <Card title="数据库连接" className="app-elevated-card" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }} extra={(
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadSources} loading={loading}>刷新</Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加</Button>
          </Space>
        )}>
          <div style={{ height: '100%', overflowY: 'auto', paddingRight: 6 }}>
            {sources.map((item) => (
              <Card
                key={item.id}
                size="small"
                style={{ marginBottom: 8, borderColor: Number(selectedId) === Number(item.id) ? '#1677ff' : undefined, cursor: 'pointer' }}
                onClick={() => setSelectedId(item.id)}
              >
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                    <Space>
                      <Text strong>{item.name}</Text>
                      <Tag color="blue">PG</Tag>
                    </Space>
                    <Space size={4}>
                      <Tooltip title="编辑">
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedId(item.id)
                            openEdit(item)
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedId(item.id)
                            removeSource(item)
                          }}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.host}:{item.port}/{item.databaseName}</Text>
                </Space>
              </Card>
            ))}
          </div>
        </Card>
      </Col>
      <Col span={19} style={{ height: '100%', display: 'flex' }}>
        <Card className="app-elevated-card" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} title={mode === 'browser' ? '数据库浏览器' : 'SQL执行器'} extra={(
          <Space>
            {mode === 'sql' ? (
              <Button size="small" onClick={() => setMode('browser')}>返回</Button>
            ) : null}
            <Button size="small" type={mode === 'sql' ? 'primary' : 'default'} onClick={() => setMode('sql')}>SQL执行器</Button>
          </Space>
        )}>
          {mode === 'browser' ? (
            <Row gutter={12} style={{ height: '100%' }}>
              <Col span={8} style={{ height: '100%' }}>
                <Card size="small" title="数据库结构" extra={<Button size="small" onClick={() => loadSchema(selectedId)} loading={schemaLoading}>刷新</Button>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Tree treeData={treeData} onSelect={handleSelectTree} />
                </Card>
              </Col>
              <Col span={16} style={{ height: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
                  <Card size="small" title={`表结构 - ${selectedTable.table || '-'}`} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, padding: 12, overflow: 'hidden' }}>
                    <div ref={schemaTableHostRef} style={{ height: '100%', minHeight: 0 }}>
                      <Table
                        size="small"
                        rowKey={(row) => `${row.columnName}`}
                        pagination={false}
                        dataSource={Array.isArray(tablePreview.columns) ? tablePreview.columns : []}
                        columns={[
                          { title: '字段名', dataIndex: 'columnName', key: 'columnName' },
                          { title: '数据类型', dataIndex: 'dataType', key: 'dataType' },
                          { title: '允许NULL', dataIndex: 'isNullable', key: 'isNullable' },
                          { title: '默认值', dataIndex: 'defaultValue', key: 'defaultValue', ellipsis: true },
                        ]}
                        scroll={{ y: schemaTableScrollY }}
                      />
                    </div>
                  </Card>
                  <Card size="small" title={`表数据 - ${selectedTable.table || '-'}`} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0, padding: 12, overflow: 'hidden' }}>
                    <div ref={previewTableHostRef} style={{ height: '100%', minHeight: 0 }}>
                      <Table
                        size="small"
                        loading={previewLoading}
                        rowKey={(_, idx) => `row-${idx}`}
                        pagination={{ pageSize: 10 }}
                        dataSource={Array.isArray(tablePreview.rows) ? tablePreview.rows : []}
                        columns={previewColumns}
                        scroll={{ x: 900, y: previewTableScrollY }}
                      />
                    </div>
                  </Card>
                </div>
              </Col>
            </Row>
          ) : (
            <Row gutter={12} style={{ height: '100%' }}>
              <Col span={12} style={{ height: '100%' }}>
                <Card size="small" title="SQL语句" extra={<Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={runSql} loading={sqlLoading}>执行SQL</Button>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0 }}>
                  <Input.TextArea value={sqlText} onChange={(e) => setSqlText(e.target.value)} style={{ height: '100%' }} placeholder="仅支持 SELECT / WITH / EXPLAIN" />
                </Card>
              </Col>
              <Col span={12} style={{ height: '100%' }}>
                <Card size="small" title="执行结果" extra={<Text type="secondary">{`耗时 ${Number(sqlResult.elapsedMs || 0)}ms，返回 ${Number(sqlResult.rowCount || 0)} 行`}</Text>} style={{ height: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1, minHeight: 0 }}>
                  <Table
                    size="small"
                    loading={sqlLoading}
                    rowKey={(_, idx) => `sql-row-${idx}`}
                    dataSource={Array.isArray(sqlResult.rows) ? sqlResult.rows : []}
                    columns={sqlColumns}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 900, y: sqlResultScrollY }}
                  />
                </Card>
              </Col>
            </Row>
          )}
        </Card>
      </Col>

      <Modal
        title={editing ? '编辑连接' : '添加连接'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submitSource}
        okText="保存"
        confirmLoading={saving}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleTest}>测试连接</Button>
            <OkBtn />
          </Space>
        )}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="连接名称" name="name" rules={[{ required: true, message: '请输入连接名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="数据库类型" name="dbType" rules={[{ required: true }]}>
            <Select options={[{ label: 'PostgreSQL', value: 'postgresql' }]} />
          </Form.Item>
          <Form.Item label="主机地址" name="host" rules={[{ required: true, message: '请输入主机地址' }]}>
            <Input />
          </Form.Item>
          <Row gutter={10}>
            <Col span={12}>
              <Form.Item label="端口" name="port" rules={[{ required: true, message: '请输入端口' }]}>
                <InputNumber style={{ width: '100%' }} min={1} max={65535} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="数据库名" name="databaseName" rules={[{ required: true, message: '请输入数据库名' }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={10}>
            <Col span={12}>
              <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="密码" name="password" rules={editing ? [] : [{ required: true, message: '请输入密码' }]}>
                <Input.Password placeholder={editing ? '留空表示不修改密码' : ''} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="备注" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  )
}

export default DataSourceManagementPage


