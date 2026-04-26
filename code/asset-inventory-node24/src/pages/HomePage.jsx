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
            <Tag color="blue">新能源供应商协同</Tag>
            <Title level={1} style={{ margin: '10px 0 10px', fontSize: 46, lineHeight: 1.1 }}>
              新能源汽车制造
              <br />
              <span style={{ color: '#3B82F6' }}>供应商管理驾驶舱</span>
            </Title>
            <Paragraph style={{ fontSize: 16, maxWidth: 560 }}>
              统一管理供应链节点、供应商基础信息与供应商档案，帮助团队更快完成采集、核验、建档与协同跟进。
            </Paragraph>
            <Space wrap>
              <Button type="primary" size="large" icon={<FileTextOutlined />} onClick={() => navigate('/suppliers')}>
                供应商基本信息
              </Button>
              <Button size="large" icon={<CheckCircleOutlined />} onClick={() => navigate('/supplier-profiles')}>
                供应商档案
              </Button>
              <Button size="large" icon={<FundOutlined />} onClick={() => navigate('/supply-chain')}>
                查看供应链
              </Button>
              <Button size="large" icon={<CloudSyncOutlined />} onClick={() => navigate('/crawl-management')}>
                自动化采集管理
              </Button>
            </Space>
          </Col>
          <Col xs={24} lg={11}>
            <Card className="hero-metrics">
              <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                <Text strong>供应商协同概览</Text>
                <div className="hero-chart-line" />
                <Row gutter={12}>
                  <Col span={8}>
                    <Statistic title="今日新增供应商" value={28} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="档案完成率" value={76} suffix="%" />
                  </Col>
                  <Col span={8}>
                    <Statistic title="待跟进节点" value={14} />
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
            <Statistic title="本周新增供应商" value={236} suffix="家" prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="覆盖供应链节点" value={15} suffix="个" prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="待处理档案" value={7} suffix="份" prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="app-elevated-card kpi-card">
            <Statistic title="活跃采集团队" value={124} suffix="人" prefix={<TeamOutlined />} />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

export default HomePage
