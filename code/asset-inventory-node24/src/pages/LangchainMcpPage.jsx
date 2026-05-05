import { Button, Card, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { fetchMcpServices, toggleMcpService } from '../api/mcpServiceApi'

const { Text } = Typography

export default function LangchainMcpPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await fetchMcpServices()
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      message.error(error.message || '加载 MCP 服务失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onToggle(record, checked) {
    try {
      await toggleMcpService(record.name, checked, record.description || '')
      message.success(`${record.name} 已${checked ? '启用' : '停用'}`)
      await load()
    } catch (error) {
      message.error(error.message || '操作失败')
    }
  }

  return (
    <Card className="app-elevated-card" title="MCP 管理（壳层版）" extra={<Button onClick={load}>刷新</Button>}>
      <Text type="secondary">本页通过项目后端 API 管理 MCP 服务，不依赖原生 WebUI。</Text>
      <Table
        style={{ marginTop: 12 }}
        loading={loading}
        rowKey="name"
        dataSource={rows}
        columns={[
          { title: '名称', dataIndex: 'name', width: 260 },
          { title: '类型', dataIndex: 'type', width: 120, render: (v) => <Tag>{v || '-'}</Tag> },
          { title: '状态', dataIndex: 'enabled', width: 120, render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
          {
            title: '开关',
            width: 120,
            render: (_, record) => (
              <Space>
                <Switch checked={Boolean(record.enabled)} onChange={(checked) => onToggle(record, checked)} />
              </Space>
            ),
          },
          { title: '描述', dataIndex: 'description' },
        ]}
      />
    </Card>
  )
}
