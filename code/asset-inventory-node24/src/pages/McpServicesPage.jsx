import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fetchMcpServices, installMcpService, toggleMcpService, uninstallMcpService, updateMcpService } from '../api/mcpServiceApi'

const { Paragraph, Text, Title } = Typography

function parseEnvText(text = '') {
  const env = {}
  String(text || '').split(/\r?\n/g).forEach((line) => {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) return
    const idx = raw.indexOf('=')
    if (idx <= 0) return
    const k = raw.slice(0, idx).trim()
    const v = raw.slice(idx + 1).trim()
    if (k) env[k] = v
  })
  return env
}

function toEnvText(env = {}) {
  if (!env || typeof env !== 'object') return ''
  return Object.entries(env).map(([k, v]) => `${k}=${String(v ?? '')}`).join('\n')
}

export default function McpServicesPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await fetchMcpServices()
      setItems(rows)
    } catch (error) {
      message.error(error.message || '读取MCP服务失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const stat = useMemo(() => {
    const enabledCount = items.filter((item) => item.enabled !== false).length
    return { total: items.length, enabledCount, disabledCount: items.length - enabledCount }
  }, [items])

  const onAdd = () => {
    setEditingName('')
    form.setFieldsValue({
      name: '',
      description: '',
      type: 'stdio',
      url: '',
      command: '',
      envText: '',
    })
    setOpen(true)
  }

  const onEdit = (item) => {
    setEditingName(item.name)
    form.setFieldsValue({
      name: item.name,
      description: item.description || '',
      type: item.type || 'stdio',
      url: item.url || '',
      command: item.command || '',
      envText: toEnvText(item.env),
    })
    setOpen(true)
  }

  const onToggle = async (item, enabled) => {
    try {
      await toggleMcpService(item.name, enabled, item.description || '')
      setItems((current) => current.map((row) => (row.name === item.name ? { ...row, enabled } : row)))
      message.success(enabled ? '已启动' : '已禁用')
    } catch (error) {
      message.error(error.message || '切换状态失败')
    }
  }

  const onUninstall = async (item) => {
    try {
      await uninstallMcpService(item.name)
      setItems((current) => current.filter((row) => row.name !== item.name))
      message.success('已卸载')
    } catch (error) {
      message.error(error.message || '卸载失败')
    }
  }

  const onSave = async () => {
    const values = await form.validateFields()
    const payload = {
      name: String(values.name || '').trim(),
      description: String(values.description || '').trim(),
      type: String(values.type || 'stdio'),
      url: String(values.url || '').trim(),
      command: String(values.command || '').trim(),
      env: parseEnvText(values.envText || ''),
    }
    setSaving(true)
    try {
      if (editingName) {
        await updateMcpService(editingName, payload)
        message.success('已修改')
      } else {
        await installMcpService(payload)
        message.success('已安装')
      }
      setOpen(false)
      await reload()
    } catch (error) {
      message.error(error.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const type = Form.useWatch('type', form)

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card className="hero-card">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Title level={4} style={{ margin: 0 }}>已配置MCP服务</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增MCP服务</Button>
          </Space>
          <Space size={8} wrap>
            <Tag color="blue">总数 {stat.total}</Tag>
            <Tag color="green">启动 {stat.enabledCount}</Tag>
            <Tag color="default">禁用 {stat.disabledCount}</Tag>
          </Space>
          <Text className="muted">数据来源：本机 Codex MCP 配置（真实数据）。支持启动/禁用、修改、卸载。</Text>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        {items.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.name}>
            <Card className="app-elevated-card capability-card" bodyStyle={{ padding: 16 }} loading={loading}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div className="capability-head">
                  <Title level={5} style={{ margin: 0 }}>{item.name}</Title>
                  <Switch
                    checked={item.enabled !== false}
                    checkedChildren="启动"
                    unCheckedChildren="禁用"
                    onChange={(checked) => onToggle(item, checked)}
                  />
                </div>
                <Paragraph className="muted capability-desc" style={{ margin: 0 }}>{item.description || '无说明'}</Paragraph>
                <Space size={8} wrap>
                  <Tag color={item.type === 'http' ? 'geekblue' : 'purple'}>{item.type === 'http' ? 'HTTP' : 'STDIO'}</Tag>
                  <Tag>{item.enabled !== false ? '已启动' : '已禁用'}</Tag>
                </Space>
                <Text code style={{ whiteSpace: 'pre-wrap' }}>安装路径：{item.installPath || '-'}</Text>
                {item.type === 'http' ? <Text code style={{ whiteSpace: 'pre-wrap' }}>URL：{item.url || '-'}</Text> : null}
                {item.type !== 'http' ? <Text code style={{ whiteSpace: 'pre-wrap' }}>命令：{item.command || '-'}</Text> : null}
                <Space size={8}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(item)}>修改</Button>
                  <Popconfirm title="确认卸载该MCP服务吗？" onConfirm={() => onUninstall(item)} okText="卸载" cancelText="取消">
                    <Button size="small" danger icon={<DeleteOutlined />}>卸载</Button>
                  </Popconfirm>
                </Space>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        title={editingName ? '修改MCP服务' : '新增MCP服务'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={onSave}
        okText={editingName ? '保存' : '安装'}
        cancelText="取消"
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'stdio' }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入服务名称' }]}>
            <Input placeholder="例如：filesystem" />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} placeholder="描述该MCP服务用途" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={[{ label: 'STDIO', value: 'stdio' }, { label: 'HTTP', value: 'http' }]} />
          </Form.Item>
          {type === 'http' ? (
            <Form.Item label="URL" name="url" rules={[{ required: true, message: '请输入HTTP URL' }]}>
              <Input placeholder="例如：https://example.com/mcp" />
            </Form.Item>
          ) : (
            <>
              <Form.Item label="命令" name="command" rules={[{ required: true, message: '请输入启动命令' }]}>
                <Input placeholder="例如：npx -y @modelcontextprotocol/server-filesystem C:\\work" />
              </Form.Item>
              <Form.Item label="环境变量" name="envText">
                <Input.TextArea rows={3} placeholder={'每行一个 KEY=VALUE，例如：\nAPI_KEY=xxxx'} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Space>
  )
}

