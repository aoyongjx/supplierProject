import { PlusOutlined } from '@ant-design/icons'
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd'

const { Paragraph, Text, Title } = Typography

const mcpServices = [
  { name: '@cherry/mcp-auto-install', desc: '自动安装 MCP 服务（测试版），用于快速拉起常用服务。', builtin: true, needConfig: false },
  { name: '@cherry/memory', desc: '基于本地知识增强的长期记忆能力，用于跨会话信息沉淀。', builtin: true, needConfig: true },
  { name: '@cherry/sequentialthinking', desc: '结构化思维链工具，适用于复杂任务拆解与推理。', builtin: true, needConfig: false },
  { name: '@cherry/brave-search', desc: '接入 Brave 搜索 API 的 MCP 服务，提供联网检索能力。', builtin: true, needConfig: true },
  { name: '@cherry/fetch', desc: '用于抓取 URL 页面内容的 MCP 服务，支持结构化抽取。', builtin: true, needConfig: false },
  { name: '@cherry/filesystem', desc: '文件系统 MCP 服务，支持受控目录读写与浏览。', builtin: true, needConfig: true },
]

function ServiceCard({ item }) {
  return (
    <Card className="app-elevated-card capability-card" bodyStyle={{ padding: 16 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="capability-head">
          <Title level={5} style={{ margin: 0 }}>{item.name}</Title>
          <Button type="text" size="small" icon={<PlusOutlined />} className="capability-plus-btn" />
        </div>
        <Paragraph className="muted capability-desc" style={{ margin: 0 }}>
          {item.desc}
        </Paragraph>
        <Space size={8} wrap>
          {item.builtin ? <Tag color="blue">内置</Tag> : null}
          {item.needConfig ? <Tag color="gold">需要配置</Tag> : null}
        </Space>
      </Space>
    </Card>
  )
}

export default function McpServicesPage() {
  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card className="hero-card">
        <Space direction="vertical" size={4}>
          <Title level={4} style={{ margin: 0 }}>MCP服务</Title>
          <Text className="muted">统一管理可用 MCP 服务、配置状态与接入能力。</Text>
        </Space>
      </Card>
      <Row gutter={[12, 12]}>
        {mcpServices.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.name}>
            <ServiceCard item={item} />
          </Col>
        ))}
      </Row>
    </Space>
  )
}

