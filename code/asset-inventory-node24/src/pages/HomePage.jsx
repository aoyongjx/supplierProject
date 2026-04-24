import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  FileTextOutlined,
  FundOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Button, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'

const { Title, Paragraph, Text } = Typography

function HomePage() {
  const navigate = useNavigate()

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <Card className="hero-card app-elevated-card">
        <Row gutter={[20, 20]} align="middle">
          <Col xs={24} lg={13}>
            <Tag color="blue">实时盘点分析</Tag>
            <Title level={1} style={{ margin: '10px 0 10px', fontSize: 46, lineHeight: 1.1 }}>
              员工资产数据
              <br />
              <span style={{ color: '#3B82F6' }}>可视化洞察</span>
            </Title>
            <Paragraph style={{ fontSize: 16, maxWidth: 560 }}>
              统一处理资产盘点填报、列表管理与趋势分析，帮助团队快速定位异常资产、追踪盘点状态并提升协同效率。
            </Paragraph>
            <Space wrap>
              <Button type="primary" size="large" icon={<FileTextOutlined />} onClick={() => navigate('/inventories/new')}>
                立即填报
              </Button>
              <Button size="large" icon={<CheckCircleOutlined />} onClick={() => navigate('/inventories')}>
                查看列表
              </Button>
              <Button size="large" icon={<FundOutlined />} onClick={() => navigate('/stocks')}>
                查看K线
              </Button>
              <Button size="large" icon={<CloudSyncOutlined />} onClick={() => navigate('/crawl-management')}>
                自动化采集管理
              </Button>
            </Space>
          </Col>
          <Col xs={24} lg={11}>
            <Card className="hero-metrics">
              <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                <Text strong>盘点趋势（最近 7 天）</Text>
                <div className="hero-chart-line" />
                <Row gutter={12}>
                  <Col span={8}>
                    <Statistic title="今日提交" value={128} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="异常率" value={2.6} suffix="%" />
                  </Col>
                  <Col span={8}>
                    <Statistic title="完成度" value={89} suffix="%" />
                  </Col>
                </Row>
                <Button type="link" onClick={() => navigate('/analytics')} icon={<ArrowRightOutlined />}>
                  查看分析看板
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="本周盘点提交" value={236} suffix="条" prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="覆盖部门" value={15} suffix="个" prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="待处理异常" value={7} suffix="条" prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="在线员工" value={124} suffix="人" prefix={<TeamOutlined />} />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

export default HomePage
