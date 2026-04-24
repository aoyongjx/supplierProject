import { Spin, Typography, message } from 'antd'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setTokens } from '../auth/token'

const { Text } = Typography

function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const accessToken = params.get('access_token') || ''
    const refreshToken = params.get('refresh_token') || ''
    if (!accessToken) {
      message.error('登录回调缺少 access_token，请重试')
      navigate('/login', { replace: true })
      return
    }
    setTokens({ accessToken, refreshToken })
    message.success('登录成功')
    navigate('/', { replace: true })
  }, [navigate, params])

  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center' }} className="auth-card callback-card">
        <Spin size="large" />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">正在处理登录回调...</Text>
        </div>
      </div>
    </div>
  )
}

export default AuthCallbackPage
