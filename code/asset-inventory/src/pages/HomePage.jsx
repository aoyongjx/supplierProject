import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'

const { Title, Paragraph, Text } = Typography

function HomePage() {
  const navigate = useNavigate()

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Card>
        <Title level={2}>欢迎使用资产盘点系统</Title>
        <Paragraph>
          该系统用于公司内部员工提交并管理资产盘点信息，请通过左侧菜单进入列表查询和填报页面。
        </Paragraph>
        <Space>
          <Button type="primary" onClick={() => navigate('/inventories/new')}>
            立即填报
          </Button>
          <Button onClick={() => navigate('/inventories')}>查看盘点列表</Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="本月已提交" value={128} suffix="条" />
            <Text type="secondary">最近更新：今天 17:30</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="待补充信息" value={9} suffix="条" />
            <Text type="secondary">请尽快完成填报</Text>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="覆盖部门" value={12} suffix="个" />
            <Text type="secondary">已覆盖总部及分支机构</Text>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

export default HomePage
