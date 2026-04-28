import {
  AppstoreOutlined,
  BarChartOutlined,
  BulbOutlined,
  CloudSyncOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  MessageOutlined,
  HomeOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MoonOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { Breadcrumb, Button, Card, Checkbox, ConfigProvider, Divider, Layout, Menu, Modal, Segmented, Space, Typography, theme } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { clearTokens, getAccessToken } from './auth/token'
import AnalyticsPage from './pages/AnalyticsPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import CrawlManagementPage from './pages/CrawlManagementPage'
import GasOemListPage from './pages/GasOemListPage'
import GasSupplierProfileFormPage from './pages/GasSupplierProfileFormPage'
import GasSupplierProfileListPage from './pages/GasSupplierProfileListPage'
import GasSupplierListPage from './pages/GasSupplierListPage'
import GASSupplyChainPage from './pages/GASSupplyChainPage'
import GASSupplyChainFormPage from './pages/GASSupplyChainFormPage'
import GASIndustryMapPage from './pages/GASIndustryMapPage'
import GasSupplierPortraitPage from './pages/GasSupplierPortraitPage'
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
import GasSupplierPortraitWorkspacePage from './pages/GasSupplierPortraitWorkspacePage'
import { fetchRecentSessions } from './api/sessionApi'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const MENU_VISIBILITY_STORAGE_KEY = 'app-menu-visibility'

function PlaceholderPage({ title }) {
  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={8}>
        <Title level={3} style={{ margin: 0 }}>{title}</Title>
        <Text className="muted">该页面暂未接入，后续可在这里补充实际内容。</Text>
      </Space>
    </Card>
  )
}

const baseMenuGroups = [
  { id: 'home', key: '/', icon: <HomeOutlined />, label: '首页' },
  { id: 'inventories', key: '/inventories', icon: <AppstoreOutlined />, label: '资产盘点列表' },
  { id: 'inventory-form', key: '/inventories/new', icon: <EditOutlined />, label: '资产盘点填报' },
  { id: 'stocks', key: '/stocks', icon: <LineChartOutlined />, label: '股票K线导航' },
  { id: 'analytics', key: '/analytics', icon: <BarChartOutlined />, label: '分析看板' },
  { id: 'crawl-management', key: '/crawl-management', icon: <CloudSyncOutlined />, label: '自动化采集管理' },
  {
    id: 'gys-suppliers',
    key: 'gys-suppliers-menu',
    icon: <TeamOutlined />,
    label: 'GYS供应商管理',
    children: [
      { id: 'supply-chain', key: '/supply-chain', label: 'GYS供应链' },
      { id: 'suppliers', key: '/suppliers', label: 'GYS供应商' },
      { id: 'supplier-profiles', key: '/supplier-profiles', label: 'GYS企业档案' },
    ],
  },
  {
    id: 'gas-suppliers',
    key: 'gas-suppliers-menu',
    icon: <TeamOutlined />,
    label: 'GAS供应商管理',
    children: [
      { id: 'gas-supply-chain', key: '/gas-supply-chain', label: 'GAS供应链' },
      { id: 'gas-suppliers-list', key: '/gas-suppliers', label: 'GAS供应商' },
      { id: 'gas-supplier-profiles', key: '/gas-supplier-profiles', label: 'GAS供应商档案' },
      { id: 'gas-supplier-portrait', key: '/users', label: 'GAS供应商画像' },
      { id: 'gas-oems', key: '/gas-oems', label: 'GAS整车厂' },
      { id: 'gas-industry-map', key: '/gas-industry-map', label: 'GAS产业图谱' },
    ],
  },
]

const menuPermissionSections = [
  {
    title: '基础菜单',
    items: [
      { id: 'home', label: '首页' },
      { id: 'inventories', label: '资产盘点列表' },
      { id: 'inventory-form', label: '资产盘点填报' },
      { id: 'stocks', label: '股票K线导航' },
      { id: 'analytics', label: '分析看板' },
      { id: 'crawl-management', label: '自动化采集管理' },
    ],
  },
  {
    title: 'GYS供应商管理',
    items: [
      { id: 'gys-suppliers', label: '显示一级菜单' },
      { id: 'supply-chain', label: 'GYS供应链' },
      { id: 'suppliers', label: 'GYS供应商' },
      { id: 'supplier-profiles', label: 'GYS企业档案' },
    ],
  },
  {
    title: 'GAS供应商管理',
    items: [
      { id: 'gas-suppliers', label: '显示一级菜单' },
      { id: 'gas-supply-chain', label: 'GAS供应链' },
      { id: 'gas-suppliers-list', label: 'GAS供应商' },
      { id: 'gas-supplier-profiles', label: 'GAS供应商档案' },
      { id: 'gas-supplier-portrait', label: 'GAS供应商画像' },
      { id: 'gas-oems', label: 'GAS整车厂' },
      { id: 'gas-industry-map', label: 'GAS产业图谱' },
    ],
  },
]

const defaultVisibleMenuIds = baseMenuGroups.flatMap((item) => [item.id, ...(item.children?.map((child) => child.id) || [])])

function readVisibleMenuIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(MENU_VISIBILITY_STORAGE_KEY) || '[]')
    if (!Array.isArray(saved) || saved.length === 0) return defaultVisibleMenuIds
    const next = new Set(saved)
    // Backward-compat migration: when new menu items are introduced, old local settings may hide them unintentionally.
    if (!next.has('gas-oems') && next.has('gas-suppliers')) {
      next.add('gas-oems')
    }
    if (!next.has('gas-supplier-profiles') && next.has('gas-suppliers')) {
      next.add('gas-supplier-profiles')
    }
    if (!next.has('gas-industry-map') && next.has('gas-suppliers')) {
      next.add('gas-industry-map')
    }
    if (!next.has('gas-supplier-portrait') && next.has('gas-suppliers')) {
      next.add('gas-supplier-portrait')
    }
    return defaultVisibleMenuIds.filter((id) => next.has(id))
  } catch {
    return defaultVisibleMenuIds
  }
}

function buildVisibleMenuItems(visibleMenuIds, recentSessions) {
  const visibleSet = new Set(visibleMenuIds)
  const staticItems = baseMenuGroups.flatMap((item) => {
    if (!item.children) {
      return visibleSet.has(item.id) ? [item] : []
    }
    if (!visibleSet.has(item.id)) return []
    const visibleChildren = item.children.filter((child) => visibleSet.has(child.id))
    if (visibleChildren.length === 0) return []
    return [{ ...item, children: visibleChildren }]
  })

  const sessionChildren = [
    { key: '/sessions/new', icon: <EditOutlined />, label: '开启一个会话' },
    ...recentSessions.slice(0, 5).map((item) => ({
      key: `/sessions/${item.id}`,
      icon: <HistoryOutlined />,
      label: item.title || `会话 ${item.id}`,
    })),
    { key: '/sessions', icon: <HistoryOutlined />, label: '查看更多会话' },
  ]

  return [
    ...staticItems,
    {
      key: 'sessions-menu',
      icon: <MessageOutlined />,
      label: '会话',
      children: sessionChildren,
    },
  ]
}

function getOpenMenuKeys(pathname) {
  if (pathname.startsWith('/supply-chain') || pathname.startsWith('/suppliers') || pathname.startsWith('/supplier-profiles')) {
    return ['gys-suppliers-menu']
  }
  if (pathname.startsWith('/gas-supply-chain') || pathname.startsWith('/gas-suppliers') || pathname.startsWith('/gas-supplier-profiles') || pathname.startsWith('/gas-supplier-portrait') || pathname.startsWith('/users') || pathname.startsWith('/gas-oems') || pathname.startsWith('/gas-industry-map')) {
    return ['gas-suppliers-menu']
  }
  if (pathname.startsWith('/sessions')) return ['sessions-menu']
  return []
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthed = Boolean(getAccessToken())

  const [mode, setMode] = useState(() => localStorage.getItem('ui-theme') || 'light')
  const [recentSessions, setRecentSessions] = useState([])
  const [visibleMenuIds, setVisibleMenuIds] = useState(readVisibleMenuIds)
  const [menuSettingOpen, setMenuSettingOpen] = useState(false)
  const [openMenuKeys, setOpenMenuKeys] = useState(() => getOpenMenuKeys(window.location.pathname))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    localStorage.setItem('ui-theme', mode)
  }, [mode])

  useEffect(() => {
    if (!isAuthed) return
    fetchRecentSessions(5)
      .then((data) => setRecentSessions(Array.isArray(data) ? data : []))
      .catch(() => setRecentSessions([]))
  }, [isAuthed, location.pathname])

  useEffect(() => {
    localStorage.setItem(MENU_VISIBILITY_STORAGE_KEY, JSON.stringify(visibleMenuIds))
  }, [visibleMenuIds])

  const menuItems = useMemo(() => {
    return buildVisibleMenuItems(visibleMenuIds, recentSessions)
  }, [recentSessions, visibleMenuIds])

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
    if (location.pathname.startsWith('/gas-supply-chain')) return '/gas-supply-chain'
    if (location.pathname === '/gas-supplier-profiles/new' || /^\/gas-supplier-profiles\/\d+\/edit$/.test(location.pathname)) return '/gas-supplier-profiles'
    if (/^\/gas-supplier-profiles\/\d+$/.test(location.pathname)) return '/gas-supplier-profiles'
    if (location.pathname.startsWith('/gas-supplier-profiles')) return '/gas-supplier-profiles'
    if (location.pathname.startsWith('/users')) return '/users'
    if (location.pathname.startsWith('/gas-suppliers')) return '/gas-suppliers'
    if (location.pathname.startsWith('/gas-supplier-portrait')) return '/gas-supplier-portrait'
    if (location.pathname.startsWith('/gas-oems')) return '/gas-oems'
    if (location.pathname.startsWith('/gas-industry-map')) return '/gas-industry-map'
    if (location.pathname.startsWith('/sessions/new')) return '/sessions/new'
    if (/^\/sessions\/\d+$/.test(location.pathname)) return location.pathname
    if (location.pathname.startsWith('/sessions')) return '/sessions'
    return '/'
  }, [location.pathname])

  useEffect(() => {
    setOpenMenuKeys((current) => {
      const requiredKeys = getOpenMenuKeys(location.pathname)
      const nextKeys = new Set(current)
      requiredKeys.forEach((key) => nextKeys.add(key))
      return Array.from(nextKeys)
    })
  }, [location.pathname])

  const pageMeta = useMemo(() => {
    if (location.pathname === '/') return { title: '首页', breadcrumb: ['首页'] }
    if (location.pathname === '/inventories') return { title: '资产盘点列表', breadcrumb: ['资产盘点列表'] }
    if (location.pathname === '/inventories/new') return { title: '资产盘点填报', breadcrumb: ['资产盘点列表', '新建'] }
    if (/^\/inventories\/\d+\/edit$/.test(location.pathname)) return { title: '资产盘点修改', breadcrumb: ['资产盘点列表', '修改'] }
    if (location.pathname.startsWith('/stocks')) return { title: '股票K线导航', breadcrumb: ['股票K线导航'] }
    if (location.pathname.startsWith('/analytics')) return { title: '分析看板', breadcrumb: ['分析看板'] }
    if (location.pathname.startsWith('/crawl-management')) return { title: '自动化采集管理', breadcrumb: ['自动化采集管理'] }
    if (location.pathname === '/supply-chain/new') return { title: 'GYS供应链新增', breadcrumb: ['GYS供应商管理', 'GYS供应链', '新增'] }
    if (/^\/supply-chain\/\d+\/edit$/.test(location.pathname)) return { title: 'GYS供应链修改', breadcrumb: ['GYS供应商管理', 'GYS供应链', '修改'] }
    if (location.pathname.startsWith('/supply-chain')) return { title: 'GYS供应链', breadcrumb: ['GYS供应商管理', 'GYS供应链'] }
    if (location.pathname === '/suppliers/new') return { title: 'GYS供应商新增', breadcrumb: ['GYS供应商管理', 'GYS供应商', '新增'] }
    if (/^\/suppliers\/\d+\/edit$/.test(location.pathname)) return { title: 'GYS供应商修改', breadcrumb: ['GYS供应商管理', 'GYS供应商', '修改'] }
    if (location.pathname.startsWith('/suppliers')) return { title: 'GYS供应商', breadcrumb: ['GYS供应商管理', 'GYS供应商'] }
    if (location.pathname === '/supplier-profiles/new') return { title: 'GYS企业档案新增', breadcrumb: ['GYS供应商管理', 'GYS企业档案', '新增'] }
    if (/^\/supplier-profiles\/\d+\/edit$/.test(location.pathname)) return { title: 'GYS企业档案修改', breadcrumb: ['GYS供应商管理', 'GYS企业档案', '修改'] }
    if (/^\/supplier-profiles\/\d+$/.test(location.pathname)) return { title: 'GYS企业档案查看', breadcrumb: ['GYS供应商管理', 'GYS企业档案', '查看'] }
    if (location.pathname.startsWith('/supplier-profiles')) return { title: 'GYS企业档案', breadcrumb: ['GYS供应商管理', 'GYS企业档案'] }
    if (location.pathname === '/gas-supply-chain/new') return { title: 'GAS供应链新增', breadcrumb: ['GAS供应商管理', 'GAS供应链', '新增'] }
    if (/^\/gas-supply-chain\/\d+\/edit$/.test(location.pathname)) return { title: 'GAS供应链修改', breadcrumb: ['GAS供应商管理', 'GAS供应链', '修改'] }
    if (location.pathname.startsWith('/gas-supply-chain')) return { title: 'GAS供应链', breadcrumb: ['GAS供应商管理', 'GAS供应链'] }
    if (location.pathname === '/gas-supplier-profiles/new') return { title: 'GAS供应商档案新增', breadcrumb: ['GAS供应商管理', 'GAS供应商档案', '新增'] }
    if (/^\/gas-supplier-profiles\/\d+\/edit$/.test(location.pathname)) return { title: 'GAS供应商档案修改', breadcrumb: ['GAS供应商管理', 'GAS供应商档案', '修改'] }
    if (/^\/gas-supplier-profiles\/\d+$/.test(location.pathname)) return { title: 'GAS供应商档案查看', breadcrumb: ['GAS供应商管理', 'GAS供应商档案', '查看'] }
    if (location.pathname.startsWith('/gas-supplier-profiles')) return { title: 'GAS供应商档案', breadcrumb: ['GAS供应商管理', 'GAS供应商档案'] }
    if (location.pathname.startsWith('/users')) return { title: 'GAS供应商画像', breadcrumb: ['GAS供应商管理', 'GAS供应商画像'] }
    if (location.pathname.startsWith('/gas-supplier-portrait')) return { title: 'GAS供应商画像', breadcrumb: ['GAS供应商管理', 'GAS供应商画像'] }
    if (location.pathname.startsWith('/gas-suppliers')) return { title: 'GAS供应商', breadcrumb: ['GAS供应商管理', 'GAS供应商'] }
    if (location.pathname.startsWith('/gas-oems')) return { title: 'GAS整车厂', breadcrumb: ['GAS供应商管理', 'GAS整车厂'] }
    if (location.pathname.startsWith('/gas-industry-map')) return { title: 'GAS产业图谱', breadcrumb: ['GAS供应商管理', 'GAS产业图谱'] }
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
              <span className="brand-logo">Ma</span>
              <div>
                <Title level={5} style={{ margin: 0 }}>
                  新能源汽车制造供应商管理
                </Title>
              </div>
            </Space>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={openMenuKeys}
            items={menuItems}
            onOpenChange={(keys) => setOpenMenuKeys(keys)}
            onClick={({ key }) => {
              if (typeof key === 'string' && key.startsWith('/')) {
                navigate(key)
              }
            }}
          />
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
                <Button icon={<SettingOutlined />} onClick={() => setMenuSettingOpen(true)}>
                  菜单设置
                </Button>
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
              <Route path="/gas-supply-chain" element={<GASSupplyChainPage />} />
              <Route path="/gas-supply-chain/new" element={<GASSupplyChainFormPage />} />
              <Route path="/gas-supply-chain/:id/edit" element={<GASSupplyChainFormPage />} />
              <Route path="/gas-suppliers" element={<GasSupplierListPage />} />
              <Route path="/gas-suppliers/new" element={<GasSupplierListPage />} />
              <Route path="/gas-suppliers/:id" element={<GasSupplierListPage />} />
              <Route path="/gas-suppliers/:id/edit" element={<GasSupplierListPage />} />
              <Route path="/gas-supplier-profiles" element={<GasSupplierProfileListPage />} />
              <Route path="/gas-supplier-profiles/new" element={<GasSupplierProfileFormPage />} />
              <Route path="/gas-supplier-profiles/:id" element={<GasSupplierProfileFormPage />} />
              <Route path="/gas-supplier-profiles/:id/edit" element={<GasSupplierProfileFormPage />} />
              <Route path="/users" element={<GasSupplierPortraitWorkspacePage />} />
              <Route path="/gas-supplier-portrait" element={<GasSupplierPortraitPage />} />
              <Route path="/gas-oems" element={<GasOemListPage />} />
              <Route path="/gas-industry-map" element={<GASIndustryMapPage />} />
              <Route path="/sessions" element={<SessionHistoryPage />} />
              <Route path="/sessions/new" element={<SessionChatPage />} />
              <Route path="/sessions/:id" element={<SessionChatPage />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
      <Modal
        title="菜单权限设置"
        open={menuSettingOpen}
        onCancel={() => setMenuSettingOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary">勾选后立即生效，用于控制左侧菜单显示或隐藏。当前设置仅保存在当前浏览器。</Text>
          {menuPermissionSections.map((section, index) => (
            <div key={section.title}>
              {index > 0 ? <Divider style={{ margin: '8px 0 16px' }} /> : null}
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong>{section.title}</Text>
                {section.items.map((item) => {
                  const checked = visibleMenuIds.includes(item.id)
                  return (
                    <Checkbox
                      key={item.id}
                      checked={checked}
                      onChange={(event) => {
                        const nextChecked = event.target.checked
                        setVisibleMenuIds((current) => {
                          const set = new Set(current)
                          if (nextChecked) {
                            set.add(item.id)
                            if (item.id === 'supply-chain' || item.id === 'suppliers' || item.id === 'supplier-profiles') {
                              set.add('gys-suppliers')
                            }
                            if (item.id === 'gas-supply-chain' || item.id === 'gas-suppliers-list' || item.id === 'gas-supplier-profiles' || item.id === 'gas-supplier-portrait' || item.id === 'gas-oems' || item.id === 'gas-industry-map') {
                              set.add('gas-suppliers')
                            }
                          } else {
                            set.delete(item.id)
                            if (item.id === 'gys-suppliers') {
                              set.delete('supply-chain')
                              set.delete('suppliers')
                              set.delete('supplier-profiles')
                            }
                            if (item.id === 'gas-suppliers') {
                              set.delete('gas-supply-chain')
                              set.delete('gas-suppliers-list')
                              set.delete('gas-supplier-profiles')
                              set.delete('gas-supplier-portrait')
                              set.delete('gas-oems')
                              set.delete('gas-industry-map')
                            }
                          }
                          return defaultVisibleMenuIds.filter((id) => set.has(id))
                        })
                      }}
                    >
                      <Space size={8}>
                        {checked ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                        <span>{item.label}</span>
                      </Space>
                    </Checkbox>
                  )
                })}
              </Space>
            </div>
          ))}
        </Space>
      </Modal>
    </ConfigProvider>
  )
}

export default App
