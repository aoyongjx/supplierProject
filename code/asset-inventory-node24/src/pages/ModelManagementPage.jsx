import {
  SearchOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  DownOutlined,
  RightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  ToolOutlined,
  VideoCameraOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { Badge, Button, Card, Col, Input, List, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Typography, message, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { createModelProvider, deleteModelProvider, fetchModelProviders, fetchProviderModels, renameModelProvider, testModelProvider, updateModelProvider } from '../api/modelManagementApi'

const { Text, Title } = Typography
const providerTypeOptions = ['OpenAI', 'OpenAI-Response', 'Gemini', 'Anthropic', 'Azure OpenAI', 'New API', 'CherryIN', 'Ollama']
const providerTypeDefaultBaseUrl = {
  OpenAI: 'https://api.openai.com/v1',
  'OpenAI-Response': 'https://api.openai.com/v1',
  Gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  Anthropic: 'https://api.anthropic.com/v1',
  'Azure OpenAI': 'https://{resource}.openai.azure.com/openai/deployments/{deployment}',
  'New API': '',
  CherryIN: '',
  Ollama: 'http://localhost:11434/v1',
}

function maskApiKey(value = '') {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '*'.repeat(text.length)
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(4, text.length - 8))}${text.slice(-4)}`
}

export default function ModelManagementPage() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeName, setActiveName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [testing, setTesting] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameTarget, setRenameTarget] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renameType, setRenameType] = useState('OpenAI')
  const [modelCreateOpen, setModelCreateOpen] = useState(false)
  const [modelCreateValue, setModelCreateValue] = useState('')
  const [modelKeyword, setModelKeyword] = useState('')
  const [modelSearchOpen, setModelSearchOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [expandedModelGroups, setExpandedModelGroups] = useState({})
  const [createForm, setCreateForm] = useState({ providerName: '', providerType: 'OpenAI' })
  const [form, setForm] = useState({ enabled: true, apiKey: '', apiBaseUrl: '' })

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await fetchModelProviders()
      setProviders(rows)
      if ((!activeName || !rows.some((x) => x.providerName === activeName)) && rows[0]?.providerName) {
        setActiveName(rows[0].providerName)
      }
    } catch (error) {
      message.error(error.message || '读取模型配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filteredProviders = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return providers
    return providers.filter((item) => String(item.providerName || '').toLowerCase().includes(kw))
  }, [providers, keyword])

  const activeProvider = useMemo(
    () => providers.find((item) => item.providerName === activeName) || null,
    [providers, activeName],
  )

  useEffect(() => {
    if (!activeProvider) return
    const next = {
      enabled: activeProvider.enabled !== false,
      apiKey: activeProvider.apiKey || '',
      apiBaseUrl: activeProvider.apiBaseUrl || '',
    }
    setForm((prev) => (
      prev.enabled === next.enabled
      && prev.apiKey === next.apiKey
      && prev.apiBaseUrl === next.apiBaseUrl
        ? prev
        : next
    ))
    setExpandedModelGroups({})
  }, [activeProvider])

  const persistActiveProvider = async (patch = {}, successMessage = '') => {
    if (!activeProvider) return null
    const payload = {
      providerType: activeProvider.providerType || 'OpenAI',
      enabled: form.enabled,
      apiKey: String(form.apiKey || '').trim(),
      apiBaseUrl: String(form.apiBaseUrl || '').trim(),
      models: activeProvider.models || [],
      fetchedModels: activeProvider.fetchedModels || [],
      ...patch,
    }
    const updated = await updateModelProvider(activeProvider.providerName, payload)
    setProviders((current) => current.map((item) => (item.providerName === updated.providerName ? updated : item)))
    if (successMessage) message.success(successMessage)
    return updated
  }

  const onTest = async () => {
    if (!activeProvider) return
    setTesting(true)
    try {
      const result = await testModelProvider(activeProvider.providerName, {
        apiKey: String(form.apiKey || '').trim(),
        apiBaseUrl: String(form.apiBaseUrl || '').trim(),
      })
      message.success(`连接成功，检测到 ${Number(result?.count || 0)} 个模型`)
    } catch (error) {
      message.error(error.message || '连接检测失败')
    } finally {
      setTesting(false)
    }
  }

  const onFetchModels = async () => {
    if (!activeProvider) return
    setFetchingModels(true)
    try {
      const updated = await fetchProviderModels(activeProvider.providerName)
      setProviders((current) => current.map((item) => (item.providerName === updated.providerName ? updated : item)))
      message.success(`已获取 ${Array.isArray(updated?.fetchedModels) ? updated.fetchedModels.length : 0} 个模型`)
    } catch (error) {
      message.error(error.message || '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }

  const onSaveProviderConfig = async () => {
    if (!activeProvider) return
    setSavingConfig(true)
    try {
      await persistActiveProvider({}, '保存成功')
    } catch (error) {
      message.error(error.message || '保存失败')
    } finally {
      setSavingConfig(false)
    }
  }

  const persistFetchedModels = async (nextFetchedModels) => {
    if (!activeProvider) return
    const updated = await updateModelProvider(activeProvider.providerName, {
      providerType: activeProvider.providerType || 'OpenAI',
      enabled: form.enabled,
      apiKey: String(form.apiKey || '').trim(),
      apiBaseUrl: String(form.apiBaseUrl || '').trim(),
      models: activeProvider.models || [],
      fetchedModels: nextFetchedModels,
    })
    setProviders((current) => current.map((item) => (item.providerName === updated.providerName ? updated : item)))
  }

  const onCreateProvider = async () => {
    if (!createForm.providerName.trim()) {
      message.warning('请填写供应商名称')
      return
    }
    setCreating(true)
    try {
      const created = await createModelProvider({
        providerName: createForm.providerName.trim(),
        providerType: createForm.providerType || 'OpenAI',
        apiBaseUrl: providerTypeDefaultBaseUrl[createForm.providerType || 'OpenAI'] || '',
        apiKey: '',
        enabled: true,
      })
      setProviders((current) => [...current, created].sort((a, b) => String(a.providerName).localeCompare(String(b.providerName), 'zh-CN')))
      setActiveName(created.providerName)
      setCreateOpen(false)
      setCreateForm({ providerName: '', providerType: 'OpenAI' })
      message.success('已新增模型供应商')
    } catch (error) {
      message.error(error.message || '新增失败')
    } finally {
      setCreating(false)
    }
  }

  const onRenameProvider = async () => {
    if (!renameTarget || !renameValue.trim()) {
      message.warning('请输入新的供应商名称')
      return
    }
    setRenaming(true)
    try {
      const updated = await renameModelProvider(renameTarget, renameValue.trim(), renameType)
      const next = providers.map((x) => (x.providerName === renameTarget ? updated : x))
      setProviders(next)
      if (activeName === renameTarget) setActiveName(updated.providerName)
      setRenameOpen(false)
      message.success('供应商名称已修改')
    } catch (error) {
      message.error(error.message || '修改失败')
    } finally {
      setRenaming(false)
    }
  }

  const groupedModels = useMemo(() => {
    const rows = Array.isArray(activeProvider?.fetchedModels) ? activeProvider.fetchedModels : []
    const groups = new Map()
    const kw = modelKeyword.trim().toLowerCase()
    const resolveGroup = (id = '') => {
      const text = String(id || '')
      if (/^grok-imagine/i.test(text)) return 'grok-imagine'
      if (/^grok-4\.20/i.test(text)) return 'grok-4.20'
      if (/^grok/i.test(text)) return 'Grok'
      const dashIdx = text.indexOf('-')
      return dashIdx > 0 ? text.slice(0, dashIdx) : (text || 'Other')
    }
    const filteredRows = rows.filter((item) => {
      if (!kw) return true
      return String(item?.id || '').toLowerCase().includes(kw)
    })
    for (const item of filteredRows) {
      const key = resolveGroup(item?.id)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }))
  }, [activeProvider?.fetchedModels, modelKeyword])

  const modelFlags = (modelId = '') => {
    const text = String(modelId || '').toLowerCase()
    return {
      video: /(vision|video|vl|imagine|image)/.test(text),
      reasoning: /(reason|think|r1|o1|o3|deep)/.test(text) || /mini/.test(text),
      tool: /(tool|function|coder|fast|mini|chat)/.test(text) || true,
    }
  }

  return (
    <Row gutter={[14, 14]}>
      <Col xs={24} xl={6}>
        <Card
          className="app-elevated-card"
          loading={loading}
          title="模型供应商"
          extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>添加</Button>}
        >
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Input.Search placeholder="搜索供应商" value={keyword} onChange={(e) => setKeyword(e.target.value)} allowClear />
            <List
              dataSource={filteredProviders}
              locale={{ emptyText: '暂无供应商，请点击添加' }}
              renderItem={(item) => (
                <List.Item
                  style={{ cursor: 'pointer', borderRadius: 8, paddingInline: 10, background: item.providerName === activeName ? 'rgba(59,130,246,0.12)' : 'transparent' }}
                >
                  {(() => {
                    const isActive = item.providerName === activeName
                    const effectiveEnabled = isActive ? form.enabled : (item.enabled !== false)
                    return (
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space onClick={() => setActiveName(item.providerName)} style={{ cursor: 'pointer' }}>
                      <Text strong>{item.providerName}</Text>
                    </Space>
                    <Space>
                      <Badge status={effectiveEnabled ? 'success' : 'default'} text={effectiveEnabled ? 'ON' : 'OFF'} />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenameTarget(item.providerName)
                          setRenameValue(item.providerName)
                          setRenameType(item.providerType || 'OpenAI')
                          setRenameOpen(true)
                        }}
                      />
                      <Popconfirm
                        title={`确认删除 ${item.providerName} 吗？`}
                        onConfirm={async () => {
                          try {
                            await deleteModelProvider(item.providerName)
                            const next = providers.filter((x) => x.providerName !== item.providerName)
                            setProviders(next)
                            if (activeName === item.providerName) setActiveName(next[0]?.providerName || '')
                            message.success('已删除模型供应商')
                          } catch (error) {
                            message.error(error.message || '删除失败')
                          }
                        }}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                      </Popconfirm>
                    </Space>
                  </Space>
                    )
                  })()}
                </List.Item>
              )}
            />
          </Space>
        </Card>
      </Col>
      <Col xs={24} xl={18}>
        <Card
          className="app-elevated-card"
          loading={loading}
          title={activeProvider ? `${activeProvider.providerName} 配置` : '模型配置'}
          extra={(
            <Button type="primary" loading={savingConfig} onClick={onSaveProviderConfig} disabled={!activeProvider}>
              保存
            </Button>
          )}
        >
          {!activeProvider ? (
            <Text className="muted">请先新增或选择一个模型供应商。</Text>
          ) : (
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Text strong>启用</Text>
                <Switch
                  checked={form.enabled}
                  onChange={(checked) => {
                    setForm((prev) => ({ ...prev, enabled: checked }))
                  }}
                />
              </Space>
              <div>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong>API 密钥</Text>
                  <Button icon={<CheckCircleOutlined />} loading={testing} onClick={onTest} disabled={!activeProvider}>检测</Button>
                </Space>
                <Input.Password
                  style={{ marginTop: 8 }}
                  value={form.apiKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="输入 API Key，支持多个请用英文逗号分隔"
                />
                <Text type="secondary">预览：{maskApiKey(form.apiKey)}</Text>
              </div>
              <div>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong>API 地址</Text>
                  <Button
                    danger
                    onClick={() => {
                      const next = providerTypeDefaultBaseUrl[activeProvider.providerType || 'OpenAI'] || ''
                      setForm((prev) => ({ ...prev, apiBaseUrl: next }))
                    }}
                  >
                    重置
                  </Button>
                </Space>
                <Input
                  style={{ marginTop: 8 }}
                  value={form.apiBaseUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, apiBaseUrl: e.target.value }))}
                  placeholder="例如 https://api.x.ai/v1"
                />
              </div>

              <div>
              <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space>
                  <Text strong>模型</Text>
                  <Tag>{Array.isArray(activeProvider?.fetchedModels) ? activeProvider.fetchedModels.length : 0}</Tag>
                  <Button type="text" size="small" icon={<ReloadOutlined />} />
                  {modelSearchOpen ? (
                    <Input
                      value={modelKeyword}
                      onChange={(e) => setModelKeyword(e.target.value)}
                      onBlur={() => setModelSearchOpen(false)}
                      placeholder="搜索模型..."
                      suffix={<SearchOutlined />}
                      style={{ width: 250, height: 28 }}
                      autoFocus
                    />
                  ) : (
                    <Button
                      type="text"
                      size="small"
                      icon={<SearchOutlined />}
                      onClick={() => setModelSearchOpen(true)}
                    />
                  )}
                </Space>
                <Space>
                  <Button icon={<ReloadOutlined />} loading={fetchingModels} onClick={onFetchModels} disabled={!activeProvider}>获取模型列表</Button>
                  <Button icon={<PlusOutlined />} onClick={() => setModelCreateOpen(true)} disabled={!activeProvider} />
                  <Tag>{activeProvider.providerType || 'OpenAI'}</Tag>
                  <Tag>共 {Array.isArray(activeProvider.fetchedModels) ? activeProvider.fetchedModels.length : 0} 个</Tag>
                </Space>
              </Space>
                <div style={{ marginTop: 8, maxHeight: 420, overflow: 'auto', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 12, padding: 8 }}>
                  {groupedModels.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'rgba(100,116,139,0.9)', padding: 16 }}>暂无模型，点击“获取模型列表”</div>
                  ) : groupedModels.map((group) => (
                    <div key={group.group} style={{ border: '1px solid rgba(148,163,184,0.25)', borderRadius: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.2)' }}>
                        <Space
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            setCollapsedGroups((prev) => ({ ...prev, [group.group]: !prev[group.group] }))
                          }}
                        >
                          {collapsedGroups[group.group]
                            ? <RightOutlined style={{ fontSize: 10, color: 'rgba(148,163,184,0.95)' }} />
                            : <DownOutlined style={{ fontSize: 10, color: 'rgba(148,163,184,0.95)' }} />}
                          <Text strong>{group.group}</Text>
                        </Space>
                        <Tooltip title="移除整组模型">
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            style={{ width: 20, height: 20, minWidth: 20, padding: 0 }}
                            onClick={async () => {
                              try {
                                const current = Array.isArray(activeProvider?.fetchedModels) ? activeProvider.fetchedModels : []
                                const next = current.filter((x) => {
                                  const id = String(x?.id || '')
                                  if (group.group === 'Grok') return !/^grok/i.test(id) || /^grok-4\.20/i.test(id) || /^grok-imagine/i.test(id)
                                  if (group.group === 'grok-4.20') return !/^grok-4\.20/i.test(id)
                                  if (group.group === 'grok-imagine') return !/^grok-imagine/i.test(id)
                                  return !id.startsWith(`${group.group}-`) && id !== group.group
                                })
                                await persistFetchedModels(next)
                                message.success(`已移除分组 ${group.group}`)
                              } catch (error) {
                                message.error(error.message || '移除整组失败')
                              }
                            }}
                          />
                        </Tooltip>
                      </div>
                      {!collapsedGroups[group.group] ? (
                        <>
                          {(expandedModelGroups[group.group] ? group.items : group.items.slice(0, 80)).map((item) => {
                        const flags = modelFlags(item?.id)
                        return (
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
                            <Text>{item.id}</Text>
                            <Space>
                              {flags.video ? <Tooltip title="视频"><Tag icon={<VideoCameraOutlined />} color="green" /></Tooltip> : null}
                              {flags.reasoning ? <Tooltip title="推理"><Tag icon={<BulbOutlined />} color="blue" /></Tooltip> : null}
                              {flags.tool ? <Tooltip title="工具"><Tag icon={<ToolOutlined />} color="orange" /></Tooltip> : null}
                              <Tooltip title="移除模型">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                                  onClick={async () => {
                                    try {
                                      const current = Array.isArray(activeProvider?.fetchedModels) ? activeProvider.fetchedModels : []
                                      const next = current.filter((x) => String(x?.id) !== String(item.id))
                                      await persistFetchedModels(next)
                                      message.success('模型已移除')
                                    } catch (error) {
                                      message.error(error.message || '移除失败')
                                    }
                                  }}
                                />
                              </Tooltip>
                            </Space>
                          </div>
                        )
                          })}
                          {group.items.length > 80 && !expandedModelGroups[group.group] ? (
                            <div style={{ padding: '6px 12px 10px' }}>
                              <Button
                                type="link"
                                size="small"
                                onClick={() => setExpandedModelGroups((prev) => ({ ...prev, [group.group]: true }))}
                              >
                                展开更多（剩余 {group.items.length - 80} 项）
                              </Button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </Space>
          )}
        </Card>
      </Col>

      <Modal
        title="新增模型供应商"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreateProvider}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Input
            placeholder="供应商名称，例如 Grok"
            value={createForm.providerName}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, providerName: e.target.value }))}
          />
          <Select
            value={createForm.providerType}
            options={providerTypeOptions.map((value) => ({ label: value, value }))}
            onChange={(value) => setCreateForm((prev) => ({ ...prev, providerType: value }))}
          />
        </Space>
      </Modal>
      <Modal
        title="修改供应商名称"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={onRenameProvider}
        confirmLoading={renaming}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="输入新的供应商名称" />
          <Select
            value={renameType}
            options={providerTypeOptions.map((value) => ({ label: value, value }))}
            onChange={(value) => setRenameType(value)}
          />
        </Space>
      </Modal>
      <Modal
        title="新增模型"
        open={modelCreateOpen}
        onCancel={() => setModelCreateOpen(false)}
        onOk={async () => {
          if (!modelCreateValue.trim()) {
            message.warning('请输入模型名称')
            return
          }
          try {
            const current = Array.isArray(activeProvider?.fetchedModels) ? activeProvider.fetchedModels : []
            if (current.some((x) => String(x?.id) === modelCreateValue.trim())) {
              message.warning('模型已存在')
              return
            }
            const next = [...current, { id: modelCreateValue.trim(), object: 'model', ownedBy: activeProvider?.providerName || '' }]
            await persistFetchedModels(next)
            setModelCreateOpen(false)
            setModelCreateValue('')
            message.success('模型已新增')
          } catch (error) {
            message.error(error.message || '新增模型失败')
          }
        }}
        okText="确定"
        cancelText="取消"
      >
        <Input value={modelCreateValue} onChange={(e) => setModelCreateValue(e.target.value)} placeholder="例如 grok-4" />
      </Modal>
    </Row>
  )
}




