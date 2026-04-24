import {
  ArrowUpOutlined,
  RiseOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import { Card, Col, Progress, Row, Space, Statistic, Tag, Timeline, Typography } from 'antd'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const { Title, Text } = Typography

const trendData = [
  { month: 'Jan', revenue: 82000 },
  { month: 'Feb', revenue: 91000 },
  { month: 'Mar', revenue: 98000 },
  { month: 'Apr', revenue: 105000 },
  { month: 'May', revenue: 112000 },
  { month: 'Jun', revenue: 127000 },
]

const activities = [
  { text: '华东区租户批量续约完成', time: '2 分钟前', type: 'success' },
  { text: '新增企业租户：蓝海医疗', time: '12 分钟前', type: 'processing' },
  { text: '月度账单任务自动执行成功', time: '35 分钟前', type: 'default' },
  { text: '检测到 1 条高优先级风控告警', time: '1 小时前', type: 'warning' },
]

function DashboardPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card className="glass-card">
        <Space orientation="vertical" size={4}>
          <Title level={3} style={{ margin: 0 }}>
            Dashboard
          </Title>
          <Text className="muted">业务总览与实时经营动态</Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="glass-card kpi-card">
            <Statistic title="本月收入" value={127000} prefix={<WalletOutlined />} suffix="CNY" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="glass-card kpi-card">
            <Statistic title="活跃租户" value={248} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="glass-card kpi-card">
            <Statistic title="续约率" value={92.6} precision={1} prefix={<RiseOutlined />} suffix="%" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="glass-card kpi-card">
            <Statistic title="增长率" value={13.8} precision={1} prefix={<ArrowUpOutlined />} suffix="%" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card className="glass-card" title="收入趋势">
            <div style={{ height: 290, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.52} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                  <XAxis dataKey="month" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3B82F6"
                    strokeWidth={3}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="glass-card" title="活动动态">
            <Timeline
              items={activities.map((item) => ({
                color: item.type === 'warning' ? 'orange' : 'blue',
                content: (
                  <Space orientation="vertical" size={2}>
                    <Space wrap>
                      <Tag color={item.type}>{item.type === 'warning' ? '告警' : '事件'}</Tag>
                      <span>{item.text}</span>
                    </Space>
                    <Text type="secondary">{item.time}</Text>
                  </Space>
                ),
              }))}
            />
            <Progress percent={81} strokeColor="#F97316" />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

export default DashboardPage
