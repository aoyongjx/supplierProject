import {
  BarChartOutlined,
  DotChartOutlined,
  FundOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { Card, Col, DatePicker, Row, Space, Statistic, Typography } from 'antd'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const { RangePicker } = DatePicker
const { Title, Text } = Typography

const kpi = [
  { title: 'MRR', value: 468000, suffix: 'CNY', icon: <FundOutlined /> },
  { title: 'ARPU', value: 1887, suffix: 'CNY', icon: <BarChartOutlined /> },
  { title: '转化率', value: 7.4, suffix: '%', icon: <LineChartOutlined /> },
  { title: '留存率', value: 83.2, suffix: '%', icon: <DotChartOutlined /> },
]

const lineData = [
  { name: 'Mon', uv: 120, pv: 240 },
  { name: 'Tue', uv: 138, pv: 221 },
  { name: 'Wed', uv: 152, pv: 262 },
  { name: 'Thu', uv: 163, pv: 281 },
  { name: 'Fri', uv: 172, pv: 305 },
  { name: 'Sat', uv: 160, pv: 289 },
  { name: 'Sun', uv: 177, pv: 329 },
]

const barData = [
  { channel: 'Search', value: 420 },
  { channel: 'Ads', value: 310 },
  { channel: 'Direct', value: 250 },
  { channel: 'Referral', value: 180 },
]

const pieData = [
  { name: 'Enterprise', value: 58 },
  { name: 'SMB', value: 28 },
  { name: 'Startup', value: 14 },
]

function AnalyticsPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card className="glass-card">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space orientation="vertical" size={6}>
            <Title level={3} style={{ margin: 0 }}>
              Analytics
            </Title>
            <Text className="muted">KPI 指标、日期筛选与多图表分析</Text>
          </Space>
          <RangePicker />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {kpi.map((item) => (
          <Col key={item.title} xs={24} sm={12} lg={6}>
            <Card className="glass-card kpi-card">
              <Statistic
                title={item.title}
                value={item.value}
                suffix={item.suffix}
                precision={item.suffix === '%' ? 1 : 0}
                prefix={item.icon}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card className="glass-card" title="周趋势分析">
            <div style={{ height: 320, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="uv" stroke="#3B82F6" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="pv" stroke="#F97316" strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="glass-card" title="渠道分布">
            <div style={{ height: 320, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="channel" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Col>
      </Row>

      <Card className="glass-card" title="客群结构">
        <div style={{ height: 300, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={95} fill="#3B82F6" label />
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </Space>
  )
}

export default AnalyticsPage
