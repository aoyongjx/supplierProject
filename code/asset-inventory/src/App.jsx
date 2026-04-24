import { Layout, Menu, Typography } from 'antd'
import { useMemo } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import InventoryFormPage from './pages/InventoryFormPage'
import InventoryListPage from './pages/InventoryListPage'

const { Header, Content, Sider } = Layout
const { Title, Text } = Typography

const menuItems = [
  { key: '/', label: '首页' },
  { key: '/inventories', label: '资产盘点列表' },
  { key: '/inventories/new', label: '资产盘点填报' },
]

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const selectedKey = useMemo(() => {
    if (location.pathname === '/inventories/new') return '/inventories/new'
    if (location.pathname.startsWith('/inventories')) return '/inventories'
    return '/'
  }, [location.pathname])

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: '#fff', padding: '18px 16px' }}>
          <Title level={4} style={{ margin: 0, color: '#fff' }}>
            资产盘点系统
          </Title>
          <Text style={{ color: 'rgba(255, 255, 255, 0.65)' }}>内部员工使用</Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            公司资产盘点平台
          </Title>
        </Header>
        <Content style={{ margin: 24 }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/inventories" element={<InventoryListPage />} />
            <Route path="/inventories/new" element={<InventoryFormPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default App
