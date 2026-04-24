import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { setTokens } from '../auth/token'

const { Title, Paragraph } = Typography

function LoginPage() {
  const navigate = useNavigate()

  const handleLogin = async () => {
    const devBypass = (import.meta.env.VITE_AUTH_DEV_BYPASS || 'true') === 'true'
    if (devBypass) {
      setTokens({ accessToken: 'dev', refreshToken: '' })
      message.success('已使用开发环境登录')
      navigate('/', { replace: true })
      return
    }
    try {
      const response = await fetch('/api/auth/login-url')
      const payload = await response.json()
      if (!response.ok || !payload?.data?.loginUrl) {
        throw new Error(payload?.message || '获取登录地址失败')
      }
      window.location.href = payload.data.loginUrl
    } catch (error) {
      message.error(error.message || '登录失败，请先连接公司内网或VPN后重试')
    }
  }

  return (
    <div className="auth-page">
      <Card className="auth-card">
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space>
            <span className="title-icon">
              <SafetyCertificateOutlined />
            </span>
            <Tag color="blue">安全认证</Tag>
          </Space>
          <Title level={3} style={{ margin: 0 }}>
            资产盘点系统登录
          </Title>
          <Paragraph style={{ margin: 0 }}>
            该系统已接入东方金信 Auth 服务。请先登录后访问资产盘点列表和填报功能。
          </Paragraph>
          <Button type="primary" size="large" icon={<LockOutlined />} onClick={handleLogin}>
            使用 Auth 登录
          </Button>
        </Space>
      </Card>
    </div>
  )
}

export default LoginPage
