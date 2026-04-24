import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BulbOutlined,
  CloudSyncOutlined,
  EditOutlined,
  MessageOutlined,
  HomeOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MoonOutlined,
  RightOutlined,
  TeamOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { Breadcrumb, Button, ConfigProvider, Layout, Menu, Segmented, Space, Typography, theme } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { clearTokens, getAccessToken } from './auth/token'
import AnalyticsPage from './pages/AnalyticsPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import CrawlManagementPage from './pages/CrawlManagementPage'
import HomePage from './pages/HomePage'
import InventoryFormPage from './pages/InventoryFormPage'
import InventoryListPage from './pages/InventoryListPage'
import LoginPage from './pages/LoginPage'
import SessionChatPage from './pages/SessionChatPage'
import SessionHistoryPage from './pages/SessionHistoryPage'
import StockKlinePage from './pages/StockKlinePage'
import SupplierFormPage from './pages/SupplierFormPage'
import SupplierListPage from './pages/SupplierListPage'
import SupplierProfileFormPage from './pages/SupplierProfileFormPage'
import SupplierProfileListPage from './pages/SupplierProfileListPage'
import SupplyChainPage from './pages/SupplyChainPage'
import SupplyChainFormPage from './pages/SupplyChainFormPage'
import { fetchRecentSessions } from './api/sessionApi'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const baseMenuItems = [
  { key: '/', icon: <HomeOutlined />, label: '首页' },
  { key: '/inventories', icon: <AppstoreOutlined />, label: '资产盘点列表' },
  { key: '/inventories/new', icon: <EditOutlined />, label: '资产盘点填报' },
  { key: '/stocks', icon: <LineChartOutlined />, label: '股票K线导航' },
  { key: '/analytics', icon: <BarChartOutlined />, label: '分析看板' },
  { key: '/crawl-management', icon: <CloudSyncOutlined />, label: '自动化采集管理' },
  { key: '/supply-chain', icon: <ApartmentOutlined />, label: '供应链信息' },
  {
    key: '/suppliers-menu',
    icon: <TeamOutlined />,
    label: '供应商管理',
    children: [
      { key: '/suppliers', label: '供应商信息来源' },
      { key: '/supplier-profiles', label: '供应商档案管理' },
    ],
  },
]

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthed = Boolean(getAccessToken())

  const [mode, setMode] = useState(() => localStorage.getItem('ui-theme') || 'light')
  const [recentSessions, setRecentSessions] = useState([])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    localStorage.setItem('ui-theme', mode)
  }, [mode])

  useEffect(() => {
    if (!isAuthed) return
    fetchRecentSessions(10)
      .then((data) => setRecentSessions(Array.isArray(data) ? data : []))
      .catch(() => setRecentSessions([]))
  }, [isAuthed, location.pathname])

  const menuItems = useMemo(() => {
    const sessionChildren = [
      { key: '/sessions/new', icon: <EditOutlined />, label: '开启一个会话' },
      ...recentSessions.map((item) => ({
        key: `/sessions/${item.id}`,
        icon: <HistoryOutlined />,
        label: item.title || `会话 ${item.id}`,
      })),
      { key: '/sessions', icon: <HistoryOutlined />, label: '查看更多会话' },
    ]
    return [
      ...baseMenuItems,
      {
        key: '/sessions-menu',
        icon: <MessageOutlined />,
        label: '会话',
        children: sessionChildren,
      },
    ]
  }, [recentSessions])

  const selectedKey = useMemo(() => {
    if (location.pathname === '/inventories/new' || /^\/inventories\/\d+\/edit$/.test(location.pathname)) return '/inventories/new'
    if (location.pathname.startsWith('/inventories')) return '/inventories'
    if (location.pathname.startsWith('/stocks')) return '/stocks'
    if (location.pathname.startsWith('/analytics')) return '/analytics'
    if (location.pathname.startsWith('/crawl-management')) return '/crawl-management'
    if (location.pathname.startsWith('/supply-chain')) return '/supply-chain'
    if (location.pathname === '/suppliers/new' || /^\/suppliers\/\d+\/edit$/.test(location.pathname)) return '/suppliers'
    if (location.pathname.startsWith('/suppliers')) return '/suppliers'
    if (location.pathname === '/supplier-profiles/new' || /^\/supplier-profiles\/\d+\/edit$/.test(location.pathname)) return '/supplier-profiles'
    if (/^\/supplier-profiles\/\d+$/.test(location.pathname)) return '/supplier-profiles'
    if (location.pathname.startsWith('/supplier-profiles')) return '/supplier-profiles'
    if (location.pathname.startsWith('/sessions/new')) return '/sessions/new'
    if (/^\/sessions\/\d+$/.test(location.pathname)) return location.pathname
    if (location.pathname.startsWith('/sessions')) return '/sessions'
    return '/'
  }, [location.pathname])

  const pageMeta = useMemo(() => {
    if (location.pathname === '/') return { title: '首页', breadcrumb: ['首页'] }
    if (location.pathname === '/inventories') return { title: '资产盘点列表', breadcrumb: ['资产盘点列表'] }
    if (location.pathname === '/inventories/new') return { title: '资产盘点填报', breadcrumb: ['资产盘点列表', '新建'] }
    if (/^\/inventories\/\d+\/edit$/.test(location.pathname)) return { title: '资产盘点修改', breadcrumb: ['资产盘点列表', '修改'] }
    if (location.pathname.startsWith('/stocks')) return { title: '股票K线导航', breadcrumb: ['股票K线导航'] }
    if (location.pathname.startsWith('/analytics')) return { title: '分析看板', breadcrumb: ['分析看板'] }
    if (location.pathname.startsWith('/crawl-management')) return { title: '自动化采集管理', breadcrumb: ['自动化采集管理'] }
    if (location.pathname === '/supply-chain/new') return { title: '供应链新增', breadcrumb: ['供应链信息', '新增'] }
    if (/^\/supply-chain\/\d+\/edit$/.test(location.pathname)) return { title: '供应链修改', breadcrumb: ['供应链信息', '修改'] }
    if (location.pathname.startsWith('/supply-chain')) return { title: '供应链信息', breadcrumb: ['供应链信息'] }
    if (location.pathname === '/suppliers/new') return { title: '供应商新增', breadcrumb: ['供应商管理', '新增'] }
    if (/^\/suppliers\/\d+\/edit$/.test(location.pathname)) return { title: '供应商修改', breadcrumb: ['供应商管理', '修改'] }
    if (location.pathname.startsWith('/suppliers')) return { title: '供应商信息来源', breadcrumb: ['供应商管理', '供应商信息来源'] }
    if (location.pathname === '/supplier-profiles/new') return { title: '供应商档案新增', breadcrumb: ['供应商管理', '供应商档案管理', '新增'] }
    if (/^\/supplier-profiles\/\d+\/edit$/.test(location.pathname)) return { title: '供应商档案修改', breadcrumb: ['供应商管理', '供应商档案管理', '修改'] }
    if (/^\/supplier-profiles\/\d+$/.test(location.pathname)) return { title: '供应商档案查看', breadcrumb: ['供应商管理', '供应商档案管理', '查看'] }
    if (location.pathname.startsWith('/supplier-profiles')) return { title: '供应商档案管理', breadcrumb: ['供应商管理', '供应商档案管理'] }
    if (location.pathname === '/sessions') return { title: '会话历史', breadcrumb: ['会话', '历史会话'] }
    if (location.pathname === '/sessions/new') return { title: '新会话', breadcrumb: ['会话', '开启一个会话'] }
    if (/^\/sessions\/\d+$/.test(location.pathname)) return { title: '历史会话', breadcrumb: ['会话', '历史会话'] }
    return { title: '首页', breadcrumb: ['首页'] }
  }, [location.pathname])

  if (location.pathname === '/login') {
    if (isAuthed) return <Navigate replace to="/" />
    return <LoginPage />
  }
  if (location.pathname === '/auth/callback') return <AuthCallbackPage />
  if (!isAuthed) return <Navigate replace to="/login" />

  return (
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3B82F6',
          colorWarning: '#F97316',
          borderRadius: 12,
          fontFamily: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider className="app-sider" breakpoint="lg" collapsedWidth="0">
          <div className="brand-block">
            <Space align="center" size={10}>
              <span className="brand-logo">DP</span>
              <div>
                <Title level={5} style={{ margin: 0 }}>
                  DataPulse 资产系统
                </Title>
                <Text className="muted">Asset & Analytics</Text>
              </div>
            </Space>
          </div>
          <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} onClick={({ key }) => navigate(key)} />
        </Sider>
        <Layout>
          <Header className="app-header">
            <div className="app-header-row">
              <div className="app-header-title-wrap">
                <Title level={4} style={{ margin: 0 }}>
                  {pageMeta.title}
                </Title>
                <Breadcrumb
                  className="app-header-breadcrumb"
                  separator={<RightOutlined style={{ fontSize: 11 }} />}
                  items={pageMeta.breadcrumb.map((item) => ({ title: item }))}
                />
              </div>
              <Space wrap>
                <Segmented
                  value={mode}
                  onChange={(value) => setMode(value)}
                  options={[
                    { value: 'light', label: <Space size={4}><BulbOutlined />浅色</Space> },
                    { value: 'dark', label: <Space size={4}><MoonOutlined />深色</Space> },
                  ]}
                />
                <Button
                  icon={<LogoutOutlined />}
                  onClick={() => {
                    clearTokens()
                    navigate('/login')
                  }}
                >
                  退出登录
                </Button>
              </Space>
            </div>
          </Header>
          <Content className={`app-content ${location.pathname.startsWith('/sessions') ? 'app-content-session' : ''}`}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/inventories" element={<InventoryListPage />} />
              <Route path="/inventories/new" element={<InventoryFormPage />} />
              <Route path="/inventories/:id/edit" element={<InventoryFormPage />} />
              <Route path="/stocks" element={<StockKlinePage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/crawl-management" element={<CrawlManagementPage />} />
              <Route path="/supply-chain" element={<SupplyChainPage />} />
              <Route path="/supply-chain/new" element={<SupplyChainFormPage />} />
              <Route path="/supply-chain/:id/edit" element={<SupplyChainFormPage />} />
              <Route path="/suppliers" element={<SupplierListPage />} />
              <Route path="/suppliers/new" element={<SupplierFormPage />} />
              <Route path="/suppliers/:id/edit" element={<SupplierFormPage />} />
              <Route path="/supplier-profiles" element={<SupplierProfileListPage />} />
              <Route path="/supplier-profiles/new" element={<SupplierProfileFormPage />} />
              <Route path="/supplier-profiles/:id" element={<SupplierProfileFormPage />} />
              <Route path="/supplier-profiles/:id/edit" element={<SupplierProfileFormPage />} />
              <Route path="/sessions" element={<SessionHistoryPage />} />
              <Route path="/sessions/new" element={<SessionChatPage />} />
              <Route path="/sessions/:id" element={<SessionChatPage />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
