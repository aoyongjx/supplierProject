import {
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BulbOutlined,
  CarOutlined,
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
import { Breadcrumb, Button, Card, Checkbox, ConfigProvider, Divider, Layout, Menu, Modal, Select, Space, Typography, theme } from 'antd'
import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react'
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
import LangchainKnowledgeBasePage from './pages/LangchainKnowledgeBasePage'
import LangchainMcpPage from './pages/LangchainMcpPage'
import LangchainMultiChatPage from './pages/LangchainMultiChatPage'
import LangchainRagChatPage from './pages/LangchainRagChatPage'
import KnowledgeBaseManagementPage from './pages/KnowledgeBaseManagementPage'
import ModelManagementPage from './pages/ModelManagementPage'
import SearchSettingsPage from './pages/SearchSettingsPage'
import LlmWikiPage from './pages/LlmWikiPage'
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
import McpServicesPage from './pages/McpServicesPage'
import SkillManagementPage from './pages/SkillManagementPage'
import PreciseSourcingAgentPage from './pages/PreciseSourcingAgentPage'
import { fetchRecentSessions } from './api/sessionApi'
import { fetchUiStyleSettings, saveUiStyleSettings } from './api/uiStyleSettingsApi'
import { fetchMenuVisibilitySettings, saveMenuVisibilitySettings } from './api/menuVisibilitySettingsApi'
const VectorSearchPage = lazy(() => import('./pages/VectorSearchPage'))

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || '页面渲染失败' }
  }

  componentDidCatch(error) {
    console.error('Route render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="app-elevated-card">
          页面加载失败：{this.state.message}
        </Card>
      )
    }
    return this.props.children
  }
}

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const MENU_VISIBILITY_STORAGE_KEY = 'app-menu-visibility'
const STYLE_PRESET_STORAGE_KEY = 'app-ui-style-preset'
const PALETTE_PRESET_STORAGE_KEY = 'app-ui-palette-preset'
const PRODUCT_TYPE_PRESET_STORAGE_KEY = 'app-ui-product-type-preset'
const CATEGORY_PRESET_STORAGE_KEY = 'app-ui-category-preset'
const SCENARIO_PRESET_STORAGE_KEY = 'app-ui-scenario-preset'
const STYLE_REFERENCE_URL = 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill'
const STYLE_OPTIONS = [
  { value: 'minimalism', label: 'minimalism', desc: '极简风，强调留白与信息密度平衡' },
  { value: 'glassmorphism', label: 'glassmorphism', desc: '玻璃拟态，强调通透与层叠' },
  { value: 'brutalism', label: 'brutalism', desc: '野兽派，强调粗线条与高对比' },
  { value: 'neumorphism', label: 'neumorphism', desc: '新拟物，强调柔和浮雕质感' },
  { value: 'bento-grid', label: 'bento-grid', desc: '模块拼贴，强调卡片化分区' },
  { value: 'claymorphism', label: 'claymorphism', desc: '黏土风，强调圆润体块' },
  { value: 'skeuomorphism', label: 'skeuomorphism', desc: '拟物风，强调真实材质' },
  { value: 'flat-design', label: 'flat-design', desc: '扁平风，强调效率与清晰' },
  { value: 'material-design', label: 'material-design', desc: '材质设计，强调层级与动效' },
  { value: 'cyberpunk', label: 'cyberpunk', desc: '赛博朋克，强调霓虹科技感' },
  { value: 'futurism', label: 'futurism', desc: '未来风，强调流线与科技感' },
  { value: 'retro-futurism', label: 'retro-futurism', desc: '复古未来，强调怀旧科幻融合' },
  { value: 'vaporwave', label: 'vaporwave', desc: '蒸汽波，强调霓虹与怀旧色调' },
  { value: 'dark-academia', label: 'dark-academia', desc: '暗色学院风，强调文艺氛围' },
  { value: 'light-academia', label: 'light-academia', desc: '浅色学院风，强调纸感排版' },
  { value: 'editorial', label: 'editorial', desc: '杂志风，强调大标题与网格' },
  { value: 'swiss-style', label: 'swiss-style', desc: '瑞士风，强调理性网格排版' },
  { value: 'bauhaus', label: 'bauhaus', desc: '包豪斯，强调几何与基础色' },
  { value: 'japanese-minimal', label: 'japanese-minimal', desc: '日式极简，强调克制与秩序' },
  { value: 'scandinavian', label: 'scandinavian', desc: '北欧风，强调自然与简洁' },
  { value: 'wabi-sabi', label: 'wabi-sabi', desc: '侘寂风，强调不完美与留白' },
  { value: 'luxury-modern', label: 'luxury-modern', desc: '现代轻奢，强调高级材质感' },
  { value: 'corporate', label: 'corporate', desc: '企业风，强调专业与稳健' },
  { value: 'startup-saas', label: 'startup-saas', desc: 'SaaS 风，强调增长导向' },
  { value: 'fintech', label: 'fintech', desc: '金融科技风，强调可信与严谨' },
  { value: 'healthcare', label: 'healthcare', desc: '医疗健康风，强调安心与可读' },
  { value: 'edtech', label: 'edtech', desc: '教育科技风，强调层次与互动' },
  { value: 'ecommerce-modern', label: 'ecommerce-modern', desc: '电商现代风，强调转化引导' },
  { value: 'marketplace', label: 'marketplace', desc: '平台风，强调信息组织效率' },
  { value: 'dashboard-analytic', label: 'dashboard-analytic', desc: '分析看板风，强调数据重点' },
  { value: 'command-center', label: 'command-center', desc: '指挥中心风，强调监控态势' },
  { value: 'terminal-ui', label: 'terminal-ui', desc: '终端风，强调工程感交互' },
  { value: 'developer-tool', label: 'developer-tool', desc: '开发者工具风，强调密度与效率' },
  { value: 'ai-assistant', label: 'ai-assistant', desc: 'AI 助手风，强调会话与反馈' },
  { value: 'notion-like', label: 'notion-like', desc: '知识库风，强调文档化组织' },
  { value: 'figma-like', label: 'figma-like', desc: '设计协作风，强调面板结构' },
  { value: 'apple-inspired', label: 'apple-inspired', desc: '苹果风，强调克制与光泽' },
  { value: 'google-inspired', label: 'google-inspired', desc: '谷歌风，强调清爽与可用性' },
  { value: 'microsoft-fluent', label: 'microsoft-fluent', desc: 'Fluent 风，强调层次与柔和' },
  { value: 'github-inspired', label: 'github-inspired', desc: 'GitHub 风，强调工程阅读性' },
  { value: 'dribbble-bold', label: 'dribbble-bold', desc: '展示风，强调视觉冲击' },
  { value: 'behance-portfolio', label: 'behance-portfolio', desc: '作品集风，强调内容陈列' },
  { value: 'newspaper', label: 'newspaper', desc: '报刊风，强调多栏排版' },
  { value: 'storybook', label: 'storybook', desc: '故事叙事风，强调节奏与段落' },
  { value: 'gaming', label: 'gaming', desc: '游戏风，强调动感与层次' },
  { value: 'esports', label: 'esports', desc: '电竞风，强调速度与对抗' },
  { value: 'music-player', label: 'music-player', desc: '音乐风，强调节奏和封面视觉' },
  { value: 'travel-magazine', label: 'travel-magazine', desc: '旅行杂志风，强调场景氛围' },
  { value: 'food-brand', label: 'food-brand', desc: '餐饮品牌风，强调食欲色彩' },
  { value: 'fashion-brand', label: 'fashion-brand', desc: '时尚品牌风，强调高级排版' },
  { value: 'architecture', label: 'architecture', desc: '建筑风，强调结构与留白' },
  { value: 'museum', label: 'museum', desc: '展陈风，强调内容导览' },
  { value: 'nature-organic', label: 'nature-organic', desc: '自然有机风，强调温润配色' },
  { value: 'eco-sustainability', label: 'eco-sustainability', desc: '可持续风，强调绿色价值' },
  { value: 'industrial', label: 'industrial', desc: '工业风，强调硬朗与秩序' },
  { value: 'automotive', label: 'automotive', desc: '汽车风，强调性能与速度' },
  { value: 'space-tech', label: 'space-tech', desc: '航天科技风，强调深空质感' },
  { value: 'biotech', label: 'biotech', desc: '生物科技风，强调精密与洁净' },
  { value: 'quantum', label: 'quantum', desc: '量子科技风，强调抽象结构' },
  { value: 'data-viz', label: 'data-viz', desc: '可视化风，强调图形优先' },
  { value: 'infographic', label: 'infographic', desc: '信息图风，强调解释性' },
  { value: 'one-page-landing', label: 'one-page-landing', desc: '单页落地页风，强调转化路径' },
  { value: 'app-onboarding', label: 'app-onboarding', desc: '引导风，强调新手体验' },
  { value: 'mobile-native', label: 'mobile-native', desc: '原生移动风，强调触控反馈' },
  { value: 'tablet-compact', label: 'tablet-compact', desc: '平板风，强调中密度布局' },
  { value: 'watch-interface', label: 'watch-interface', desc: '可穿戴风，强调极简信息' },
  { value: 'voice-first', label: 'voice-first', desc: '语音优先风，强调少操作' },
]

const PALETTE_COUNT = 161
const PALETTE_OPTIONS = Array.from({ length: PALETTE_COUNT }, (_, index) => {
  const id = index + 1
  const hueA = (id * 23) % 360
  const hueB = (hueA + 38) % 360
  return {
    value: `palette-${id}`,
    label: `palette-${id}`,
    desc: `主色 ${hueA}° / 强调 ${hueB}°`,
    primary: `hsl(${hueA} 76% 46%)`,
    warning: `hsl(${hueB} 82% 48%)`,
    bgA: `hsl(${hueA} 82% 54% / 0.13)`,
    bgB: `hsl(${hueB} 82% 54% / 0.10)`,
  }
})

const PRODUCT_TYPE_COUNT = 161
const PRODUCT_TYPE_OPTIONS = Array.from({ length: PRODUCT_TYPE_COUNT }, (_, index) => {
  const id = index + 1
  return {
    value: `category-${id}`,
    label: `category-${id}`,
    desc: `产品类型分类 ${id}`,
  }
})

const CATEGORY_OPTIONS = [
  'All', 'SaaS', 'Education', 'Pet Services', 'AI/Chatbot', 'E-commerce', 'Fintech/Crypto', 'Healthcare',
  'Creative', 'Real Estate', 'Gaming', 'Food & Restaurant', 'Fitness', 'Travel', 'NFT/Web3',
  'Beauty/Spa', 'Developer Tools', 'Entertainment', 'Legal', 'Events', 'Other',
]

const CATEGORY_PRESETS = {
  SaaS: { style: 'glassmorphism', palette: 'palette-12', productType: 'category-1', font: '"Inter","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  Education: { style: 'claymorphism', palette: 'palette-29', productType: 'category-2', font: '"Nunito","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  'Pet Services': { style: 'vibrant-block', palette: 'palette-44', productType: 'category-5', font: '"Poppins","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  'AI/Chatbot': { style: 'ai-assistant', palette: 'palette-61', productType: 'category-8', font: '"Space Grotesk","Fira Sans","Segoe UI",sans-serif', mode: 'dark' },
  'E-commerce': { style: 'bento-grid', palette: 'palette-23', productType: 'category-16', font: '"Manrope","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  'Fintech/Crypto': { style: 'cyberpunk', palette: 'palette-77', productType: 'category-21', font: '"IBM Plex Sans","Fira Sans","Segoe UI",sans-serif', mode: 'dark' },
  Healthcare: { style: 'soft-ui-evolution', palette: 'palette-35', productType: 'category-34', font: '"Source Sans 3","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  Creative: { style: 'brutalism', palette: 'palette-99', productType: 'category-58', font: '"Archivo","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  'Real Estate': { style: 'luxury-modern', palette: 'palette-14', productType: 'category-68', font: '"Cormorant Garamond","Fira Sans","Segoe UI",serif', mode: 'light' },
  Gaming: { style: 'hud-sci-fi-fui', palette: 'palette-113', productType: 'category-74', font: '"Rajdhani","Fira Sans","Segoe UI",sans-serif', mode: 'dark' },
  'Food & Restaurant': { style: 'editorial-grid-magazine', palette: 'palette-52', productType: 'category-88', font: '"DM Serif Display","Fira Sans","Segoe UI",serif', mode: 'light' },
  Fitness: { style: 'motion-driven', palette: 'palette-102', productType: 'category-95', font: '"Barlow","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  Travel: { style: 'nature-distilled', palette: 'palette-133', productType: 'category-109', font: '"Lora","Fira Sans","Segoe UI",serif', mode: 'light' },
  'NFT/Web3': { style: 'vaporwave', palette: 'palette-147', productType: 'category-121', font: '"Orbitron","Fira Sans","Segoe UI",sans-serif', mode: 'dark' },
  'Beauty/Spa': { style: 'neumorphism', palette: 'palette-140', productType: 'category-130', font: '"Playfair Display","Fira Sans","Segoe UI",serif', mode: 'light' },
  'Developer Tools': { style: 'terminal-ui', palette: 'palette-7', productType: 'category-142', font: '"Fira Code","Fira Sans","Segoe UI",monospace', mode: 'dark' },
  Entertainment: { style: 'retro-futurism', palette: 'palette-150', productType: 'category-148', font: '"Bebas Neue","Fira Sans","Segoe UI",sans-serif', mode: 'dark' },
  Legal: { style: 'swiss-style', palette: 'palette-4', productType: 'category-154', font: '"Merriweather","Fira Sans","Segoe UI",serif', mode: 'light' },
  Events: { style: 'kinetic-typography', palette: 'palette-120', productType: 'category-159', font: '"Montserrat","Fira Sans","Segoe UI",sans-serif', mode: 'light' },
  Other: { style: 'minimalism', palette: 'palette-1', productType: 'category-161', font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', mode: 'light' },
}

const CATEGORY_SCENARIO_LIBRARY = {
  'SaaS': ['SaaS Analytics Dashboard', 'Sales CRM Platform', 'Customer Support CRM'],
  'Education': ['Educational Platform', 'Online Course Hub', 'Learning Management Suite'],
  'Pet Services': ['Pet Grooming & Spa', 'Veterinary Clinic', 'Pet Boarding Service'],
  'AI/Chatbot': ['AI Chatbot Platform', 'Sustainability Platform', 'Generative Art Platform', 'AI Writing Assistant', 'AI Image Generator'],
  'E-commerce': ['Product Showcase Store', 'Conversion Shop', 'Marketplace Commerce'],
  'Fintech/Crypto': ['Fintech Crypto Dashboard', 'Investment Platform', 'Payment Gateway', 'Crypto Wallet', 'DeFi Yield Platform', 'CEX Trading Platform'],
  'Healthcare': ['Health & Wellness App', 'Telemedicine Platform', 'Mental Health App'],
  'Creative': ['Creative Agency Portfolio', 'Design Studio Showcase', 'Visual Storytelling Site'],
  'Real Estate': ['Real Estate Luxury', 'Property Listing Portal', 'Rental Marketplace'],
  'Gaming': ['Gaming Platform', 'eSports Hub', 'Game Community Portal'],
  'Food & Restaurant': ['Restaurant & Food', 'Chef Booking Platform', 'Online Menu Experience'],
  'Fitness': ['Fitness & Gym App', 'Workout Scheduler', 'Nutrition Tracker'],
  'Travel': ['Travel & Tourism', 'Trip Planner', 'Adventure Booking Platform'],
  'NFT/Web3': ['NFT & Web3 Platform', 'NFT Art Gallery', 'DAO Community Portal'],
  'Beauty/Spa': ['Beauty & Spa Service', 'Skincare Clinic', 'Salon Booking App'],
  'Developer Tools': ['Developer Tools', 'API Docs Platform', 'DevOps Monitoring Console'],
  'Entertainment': ['Music Streaming', 'Video Creator Platform', 'Fan Community App'],
  'Legal': ['Legal Services', 'Case Management Portal', 'Law Firm Website'],
  'Events': ['Wedding & Events', 'Event Ticketing Platform', 'Conference Landing'],
  'Other': ['Veterinary Clinic', 'Medical Clinic Portal', 'Digital Banking App'],
}

function slugifyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function asText(input = '') {
  return String(input ?? '').trim()
}

const CATEGORY_SCENARIOS = Object.entries(CATEGORY_SCENARIO_LIBRARY).flatMap(([category, titles], categoryIndex) => {
  const preset = CATEGORY_PRESETS[category] || CATEGORY_PRESETS.Other
  return titles.map((title, titleIndex) => {
    const mode = titleIndex === 1 ? 'dark' : (preset?.mode || 'light')
    return {
      id: `${slugifyName(category)}-${titleIndex + 1}`,
      category,
      title,
      mode,
      style: preset?.style || 'minimalism',
      palette: `palette-${((categoryIndex * 7 + titleIndex * 3) % PALETTE_COUNT) + 1}`,
      productType: `category-${((categoryIndex * 11 + titleIndex * 5) % PRODUCT_TYPE_COUNT) + 1}`,
      font: preset?.font || '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    }
  })
})

const DEFAULT_UI_SELECTION = {
  stylePreset: 'glassmorphism',
  palettePreset: 'palette-12',
  productTypePreset: 'category-1',
  categoryPreset: 'SaaS',
  mode: 'light',
}

const DEFAULT_SCENARIO = CATEGORY_SCENARIOS.find((item) => item.category === DEFAULT_UI_SELECTION.categoryPreset) || CATEGORY_SCENARIOS[0] || null

function normalizeScenarioId(input = '') {
  const value = asText(input)
  if (!value) return DEFAULT_SCENARIO?.id || ''
  const byId = CATEGORY_SCENARIOS.find((item) => item.id === value)
  if (byId) return byId.id
  const byTitle = CATEGORY_SCENARIOS.find((item) => item.title === value)
  if (byTitle) return byTitle.id
  return DEFAULT_SCENARIO?.id || ''
}

const STYLE_THEME_PRESETS = {
  minimalism: { primary: '#3b82f6', warning: '#f59e0b', radius: 10, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(59,130,246,0.10)', bgB: 'rgba(249,115,22,0.06)' },
  glassmorphism: { primary: '#06b6d4', warning: '#f97316', radius: 16, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(6,182,212,0.14)', bgB: 'rgba(56,189,248,0.10)' },
  brutalism: { primary: '#111827', warning: '#ef4444', radius: 4, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(17,24,39,0.08)', bgB: 'rgba(239,68,68,0.07)' },
  neumorphism: { primary: '#6366f1', warning: '#fb7185', radius: 18, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(99,102,241,0.10)', bgB: 'rgba(244,114,182,0.08)' },
  'bento-grid': { primary: '#2563eb', warning: '#f97316', radius: 14, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(37,99,235,0.11)', bgB: 'rgba(249,115,22,0.08)' },
  claymorphism: { primary: '#0ea5e9', warning: '#fb923c', radius: 20, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(14,165,233,0.12)', bgB: 'rgba(251,146,60,0.09)' },
  'flat-design': { primary: '#2563eb', warning: '#f97316', radius: 10, font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(37,99,235,0.10)', bgB: 'rgba(249,115,22,0.07)' },
  cyberpunk: { primary: '#22d3ee', warning: '#f43f5e', radius: 10, font: '"Fira Code","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(34,211,238,0.14)', bgB: 'rgba(244,63,94,0.10)' },
  editorial: { primary: '#1d4ed8', warning: '#ea580c', radius: 8, font: '"Times New Roman","Songti SC","Fira Sans",serif', bgA: 'rgba(29,78,216,0.08)', bgB: 'rgba(234,88,12,0.06)' },
  corporate: { primary: '#1e40af', warning: '#d97706', radius: 8, font: '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', bgA: 'rgba(30,64,175,0.09)', bgB: 'rgba(217,119,6,0.07)' },
}

function hashStyleName(name) {
  let hash = 0
  for (let index = 0; index < String(name).length; index += 1) {
    hash = ((hash << 5) - hash) + String(name).charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function buildThemeFromName(name) {
  const hash = hashStyleName(name)
  const hueA = hash % 360
  const hueB = (hueA + 72) % 360
  const radius = 8 + (hash % 13)
  return {
    primary: `hsl(${hueA} 75% 46%)`,
    warning: `hsl(${hueB} 80% 48%)`,
    radius,
    font: '"Fira Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    bgA: `hsl(${hueA} 85% 55% / 0.12)`,
    bgB: `hsl(${hueB} 85% 55% / 0.10)`,
  }
}

function resolveStyleTheme(stylePreset) {
  return STYLE_THEME_PRESETS[stylePreset] || buildThemeFromName(stylePreset)
}

function resolveStyleFamily(stylePreset) {
  const value = String(stylePreset || '').toLowerCase()
  if (value.includes('glass') || value.includes('aurora') || value.includes('liquid')) return 'glass'
  if (value.includes('brutal') || value.includes('raw') || value.includes('maximal')) return 'brutal'
  if (value.includes('neumorphism') || value.includes('clay') || value.includes('soft')) return 'soft'
  if (value.includes('cyber') || value.includes('hud') || value.includes('sci-fi') || value.includes('vapor') || value.includes('y2k')) return 'cyber'
  if (value.includes('editorial') || value.includes('swiss') || value.includes('newspaper') || value.includes('magazine')) return 'editorial'
  if (value.includes('bento') || value.includes('dashboard') || value.includes('data')) return 'bento'
  return 'minimal'
}

function resolvePaletteTheme(palettePreset) {
  return PALETTE_OPTIONS.find((item) => item.value === palettePreset) || PALETTE_OPTIONS[0]
}

function resolveProductTypeTheme(productTypePreset) {
  const raw = String(productTypePreset || 'category-1')
  const idText = raw.replace('category-', '')
  const id = Number(idText)
  const safeId = Number.isFinite(id) && id > 0 ? id : 1
  const density = safeId % 3
  const menuRadius = density === 0 ? 8 : density === 1 ? 12 : 16
  const menuGap = density === 0 ? 6 : density === 1 ? 8 : 10
  const tintOpacity = density === 0 ? 0.08 : density === 1 ? 0.12 : 0.16
  return { menuRadius, menuGap, tintOpacity }
}

function pickScenario(category, mode, fallbackId) {
  const scoped = CATEGORY_SCENARIOS.filter((item) => category === 'All' || item.category === category)
  const modeScoped = mode === 'all' ? scoped : scoped.filter((item) => item.mode === mode)
  const list = modeScoped.length > 0 ? modeScoped : scoped
  if (fallbackId) {
    const found = list.find((item) => item.id === fallbackId)
    if (found) return found
  }
  return list[0] || null
}

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
  {
    id: 'agents',
    key: 'agents-menu',
    icon: <TeamOutlined />,
    label: '智能体',
    children: [
      { id: 'agent-precise-sourcing', key: '/agents/precise-sourcing', label: '精准寻源智能体' },
      { id: 'agent-admission-screening', key: '/agents/admission-screening', label: '准入排查智能体' },
      { id: 'agent-realtime-monitoring', key: '/agents/realtime-monitoring', label: '实时监控智能体' },
      { id: 'agent-supplier-dd', key: '/agents/supplier-dd', label: '供应商尽调智能体' },
    ],
  },
  {
    id: 'capability-center',
    key: 'capability-center-menu',
    icon: <SettingOutlined />,
    label: '能力中心',
    children: [
      { id: 'capability-mcp-services', key: '/capability-center/mcp-services', label: 'MCP服务' },
      { id: 'capability-skill-management', key: '/capability-center/skills', label: 'Skill管理' },
      { id: 'capability-knowledge-base', key: '/capability-center/knowledge-base', label: '知识库管理' },
      { id: 'capability-vector-search', key: '/capability-center/vector-search', label: '向量检索' },
      { id: 'capability-model-management', key: '/capability-center/model-management', label: '模型管理' },
      { id: 'capability-search-settings', key: '/capability-center/search-settings', label: '搜索配置' },
      {
        id: 'capability-llm-wiki',
        key: 'capability-llm-wiki-menu',
        label: 'LLM-Wiki',
        children: [
          { id: 'capability-llm-wiki-workbench', key: '/capability-center/llm-wiki/workbench', label: 'Wiki工作台' },
          { id: 'capability-llm-wiki-graph', key: '/capability-center/llm-wiki/graph', label: '关系图谱' },
          { id: 'capability-llm-wiki-compose', key: '/capability-center/llm-wiki/compose', label: '导入与生成' },
          { id: 'capability-llm-wiki-settings', key: '/capability-center/llm-wiki/settings', label: '配置' },
        ],
      },
    ],
  },
  {
    id: 'langchain-dialog',
    key: 'langchain-dialog-menu',
    icon: <MessageOutlined />,
    label: 'Langchain对话',
    children: [
      { id: 'langchain-multi-chat', key: '/langchain-chatchat/multi-chat', label: '多功能对话' },
      { id: 'langchain-rag-chat', key: '/langchain-chatchat/rag-chat', label: 'RAG对话' },
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
  {
    title: '智能体',
    items: [
      { id: 'agents', label: '显示一级菜单' },
      { id: 'agent-precise-sourcing', label: '精准寻源智能体' },
      { id: 'agent-admission-screening', label: '准入排查智能体' },
      { id: 'agent-realtime-monitoring', label: '实时监控智能体' },
      { id: 'agent-supplier-dd', label: '供应商尽调智能体' },
    ],
  },
  {
    title: '能力中心',
    items: [
      { id: 'capability-center', label: '显示一级菜单' },
      { id: 'capability-mcp-services', label: 'MCP服务' },
      { id: 'capability-skill-management', label: 'Skill管理' },
      { id: 'capability-knowledge-base', label: '知识库管理' },
      { id: 'capability-vector-search', label: '向量检索' },
      { id: 'capability-model-management', label: '模型管理' },
      { id: 'capability-search-settings', label: '搜索配置' },
      { id: 'capability-llm-wiki', label: '显示 LLM-Wiki 子菜单' },
      { id: 'capability-llm-wiki-workbench', label: 'LLM-Wiki / Wiki工作台' },
      { id: 'capability-llm-wiki-graph', label: 'LLM-Wiki / 关系图谱' },
      { id: 'capability-llm-wiki-compose', label: 'LLM-Wiki / 导入与生成' },
      { id: 'capability-llm-wiki-settings', label: 'LLM-Wiki / 配置' },
    ],
  },
  {
    title: 'Langchain对话',
    items: [
      { id: 'langchain-dialog', label: '显示一级菜单' },
      { id: 'langchain-multi-chat', label: '多功能对话' },
      { id: 'langchain-rag-chat', label: 'RAG对话' },
    ],
  },
]

function collectMenuIds(items = []) {
  return items.flatMap((item) => [item.id, ...collectMenuIds(item.children || [])])
}

const defaultVisibleMenuIds = collectMenuIds(baseMenuGroups)

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
    if (!next.has('capability-vector-search') && next.has('capability-center')) {
      next.add('capability-vector-search')
    }
    if (!next.has('capability-model-management') && next.has('capability-center')) {
      next.add('capability-model-management')
    }
    if (!next.has('capability-search-settings') && next.has('capability-center')) {
      next.add('capability-search-settings')
    }
    if (!next.has('capability-llm-wiki') && next.has('capability-center')) {
      next.add('capability-llm-wiki')
    }
    if (!next.has('capability-llm-wiki-workbench') && next.has('capability-llm-wiki')) {
      next.add('capability-llm-wiki-workbench')
    }
    if (!next.has('capability-llm-wiki-graph') && next.has('capability-llm-wiki')) {
      next.add('capability-llm-wiki-graph')
    }
    if (!next.has('capability-llm-wiki-compose') && next.has('capability-llm-wiki')) {
      next.add('capability-llm-wiki-compose')
    }
    if (!next.has('capability-llm-wiki-settings') && next.has('capability-llm-wiki')) {
      next.add('capability-llm-wiki-settings')
    }
    if (!next.has('langchain-dialog') && next.has('langchain-chatchat-link')) {
      next.add('langchain-dialog')
    }
    if (!next.has('langchain-multi-chat') && next.has('langchain-dialog')) {
      next.add('langchain-multi-chat')
    }
    if (!next.has('langchain-rag-chat') && next.has('langchain-dialog')) {
      next.add('langchain-rag-chat')
    }
    return defaultVisibleMenuIds.filter((id) => next.has(id))
  } catch {
    return defaultVisibleMenuIds
  }
}

function buildVisibleMenuItems(visibleMenuIds, recentSessions) {
  const visibleSet = new Set(visibleMenuIds)
  const filterMenuTree = (items = []) => items.flatMap((item) => {
    if (!item.children) return visibleSet.has(item.id) ? [{ ...item }] : []
    if (!visibleSet.has(item.id)) return []
    const children = filterMenuTree(item.children)
    if (children.length === 0) return []
    return [{ ...item, children }]
  })
  const staticItems = filterMenuTree(baseMenuGroups)

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
  if (pathname.startsWith('/agents')) return ['agents-menu']
  if (pathname.startsWith('/capability-center/llm-wiki')) return ['capability-center-menu', 'capability-llm-wiki-menu']
  if (pathname.startsWith('/capability-center')) return ['capability-center-menu']
  if (pathname.startsWith('/langchain-chatchat')) {
    return ['langchain-dialog-menu']
  }
  if (pathname.startsWith('/sessions')) return ['sessions-menu']
  return []
}

function normalizeVisibleIds(input) {
  if (!Array.isArray(input)) return []
  const set = new Set(input.map((item) => String(item)))
  if (!set.has('capability-search-settings') && set.has('capability-center')) {
    set.add('capability-search-settings')
  }
  if (!set.has('capability-llm-wiki') && set.has('capability-center')) {
    set.add('capability-llm-wiki')
  }
  if (!set.has('capability-vector-search') && set.has('capability-center')) {
    set.add('capability-vector-search')
  }
  if (!set.has('capability-model-management') && set.has('capability-center')) {
    set.add('capability-model-management')
  }
  if (!set.has('capability-llm-wiki-workbench') && (set.has('capability-llm-wiki') || set.has('capability-center'))) {
    set.add('capability-llm-wiki-workbench')
  }
  if (!set.has('capability-llm-wiki-graph') && (set.has('capability-llm-wiki') || set.has('capability-center'))) {
    set.add('capability-llm-wiki-graph')
  }
  if (!set.has('capability-llm-wiki-compose') && (set.has('capability-llm-wiki') || set.has('capability-center'))) {
    set.add('capability-llm-wiki-compose')
  }
  if (!set.has('capability-llm-wiki-settings') && (set.has('capability-llm-wiki') || set.has('capability-center'))) {
    set.add('capability-llm-wiki-settings')
  }
  if (!set.has('langchain-multi-chat') && set.has('langchain-dialog')) {
    set.add('langchain-multi-chat')
  }
  if (!set.has('langchain-rag-chat') && set.has('langchain-dialog')) {
    set.add('langchain-rag-chat')
  }
  return defaultVisibleMenuIds.filter((id) => set.has(id))
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthed = Boolean(getAccessToken())

  const [mode, setMode] = useState(() => localStorage.getItem('ui-theme') || DEFAULT_UI_SELECTION.mode)
  const [recentSessions, setRecentSessions] = useState([])
  const [visibleMenuIds, setVisibleMenuIds] = useState(readVisibleMenuIds)
  const [menuSettingOpen, setMenuSettingOpen] = useState(false)
  const [menuSaving, setMenuSaving] = useState(false)
  const [savedMenuIds, setSavedMenuIds] = useState(() => normalizeVisibleIds(readVisibleMenuIds()))
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [stylePreset, setStylePreset] = useState(() => localStorage.getItem(STYLE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.stylePreset)
  const [styleDraft, setStyleDraft] = useState(() => localStorage.getItem(STYLE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.stylePreset)
  const [palettePreset, setPalettePreset] = useState(() => localStorage.getItem(PALETTE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.palettePreset)
  const [paletteDraft, setPaletteDraft] = useState(() => localStorage.getItem(PALETTE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.palettePreset)
  const [productTypePreset, setProductTypePreset] = useState(() => localStorage.getItem(PRODUCT_TYPE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.productTypePreset)
  const [productTypeDraft, setProductTypeDraft] = useState(() => localStorage.getItem(PRODUCT_TYPE_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.productTypePreset)
  const [categoryPreset, setCategoryPreset] = useState(() => localStorage.getItem(CATEGORY_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.categoryPreset)
  const [categoryDraft, setCategoryDraft] = useState(() => localStorage.getItem(CATEGORY_PRESET_STORAGE_KEY) || DEFAULT_UI_SELECTION.categoryPreset)
  const [modeDraft, setModeDraft] = useState('all')
  const [scenarioPreset, setScenarioPreset] = useState(() => normalizeScenarioId(localStorage.getItem(SCENARIO_PRESET_STORAGE_KEY)))
  const [scenarioDraft, setScenarioDraft] = useState(() => normalizeScenarioId(localStorage.getItem(SCENARIO_PRESET_STORAGE_KEY)))
  const [openMenuKeys, setOpenMenuKeys] = useState(() => getOpenMenuKeys(window.location.pathname))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    localStorage.setItem('ui-theme', mode)
  }, [mode])

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-style', stylePreset)
    localStorage.setItem(STYLE_PRESET_STORAGE_KEY, stylePreset)
  }, [stylePreset])

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-palette', palettePreset)
    localStorage.setItem(PALETTE_PRESET_STORAGE_KEY, palettePreset)
  }, [palettePreset])

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-product-type', productTypePreset)
    localStorage.setItem(PRODUCT_TYPE_PRESET_STORAGE_KEY, productTypePreset)
  }, [productTypePreset])

  useEffect(() => {
    localStorage.setItem(CATEGORY_PRESET_STORAGE_KEY, categoryPreset)
  }, [categoryPreset])

  useEffect(() => {
    localStorage.setItem(SCENARIO_PRESET_STORAGE_KEY, scenarioPreset)
  }, [scenarioPreset])

  const styleTheme = useMemo(() => resolveStyleTheme(stylePreset), [stylePreset])
  const styleFamily = useMemo(() => resolveStyleFamily(stylePreset), [stylePreset])
  const paletteTheme = useMemo(() => resolvePaletteTheme(palettePreset), [palettePreset])
  const productTypeTheme = useMemo(() => resolveProductTypeTheme(productTypePreset), [productTypePreset])
  const mergedTheme = useMemo(() => ({
    ...styleTheme,
    primary: paletteTheme.primary,
    warning: paletteTheme.warning,
    bgA: paletteTheme.bgA,
    bgB: paletteTheme.bgB,
  }), [styleTheme, paletteTheme])

  const categoryFont = useMemo(() => CATEGORY_PRESETS[categoryPreset]?.font || '', [categoryPreset])
  const scenarioOptions = useMemo(() => {
    const scoped = CATEGORY_SCENARIOS.filter((item) => categoryDraft === 'All' || item.category === categoryDraft)
    if (modeDraft === 'all') return scoped
    const filtered = scoped.filter((item) => item.mode === modeDraft)
    return filtered.length > 0 ? filtered : scoped
  }, [categoryDraft, modeDraft])
  const selectedScenario = useMemo(() => {
    return scenarioOptions.find((item) => item.id === scenarioDraft) || scenarioOptions[0] || null
  }, [scenarioDraft, scenarioOptions])
  const scenarioPreviewList = useMemo(() => {
    return scenarioOptions.map((item) => {
      const palette = resolvePaletteTheme(item.palette)
      return {
        ...item,
        palette,
      }
    })
  }, [scenarioOptions])

  useEffect(() => {
    document.documentElement.style.setProperty('--style-bg-a', mergedTheme.bgA)
    document.documentElement.style.setProperty('--style-bg-b', mergedTheme.bgB)
    document.documentElement.style.setProperty('--primary', mergedTheme.primary)
    document.documentElement.style.setProperty('--accent', mergedTheme.warning)
    document.documentElement.style.setProperty('--style-radius', `${mergedTheme.radius}px`)
    document.documentElement.style.setProperty('--menu-radius', `${productTypeTheme.menuRadius}px`)
    document.documentElement.style.setProperty('--menu-gap', `${productTypeTheme.menuGap}px`)
    document.documentElement.style.setProperty('--sider-tint-opacity', `${productTypeTheme.tintOpacity}`)
  }, [mergedTheme, productTypeTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-style-family', styleFamily)
  }, [styleFamily])

  useEffect(() => {
    if (!isAuthed) return
    fetchRecentSessions(5)
      .then((data) => setRecentSessions(Array.isArray(data) ? data : []))
      .catch(() => setRecentSessions([]))
  }, [isAuthed, location.pathname])

  useEffect(() => {
    if (!isAuthed) return
    fetchUiStyleSettings()
      .then((saved) => {
        if (!saved || typeof saved !== 'object') return
        const nextStyle = asText(saved.stylePreset) || DEFAULT_UI_SELECTION.stylePreset
        const nextPalette = asText(saved.palettePreset) || DEFAULT_UI_SELECTION.palettePreset
        const nextProductType = asText(saved.productTypePreset) || DEFAULT_UI_SELECTION.productTypePreset
        const nextCategory = asText(saved.categoryPreset) || DEFAULT_UI_SELECTION.categoryPreset
        const nextScenario = normalizeScenarioId(saved.scenarioPreset)
        const nextMode = asText(saved.mode)
        setStylePreset(nextStyle)
        setStyleDraft(nextStyle)
        setPalettePreset(nextPalette)
        setPaletteDraft(nextPalette)
        setProductTypePreset(nextProductType)
        setProductTypeDraft(nextProductType)
        setCategoryPreset(nextCategory)
        setCategoryDraft(nextCategory)
        setScenarioPreset(nextScenario)
        setScenarioDraft(nextScenario)
        if (nextMode === 'light' || nextMode === 'dark') {
          setMode(nextMode)
          setModeDraft(nextMode)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed])

  useEffect(() => {
    localStorage.setItem(MENU_VISIBILITY_STORAGE_KEY, JSON.stringify(visibleMenuIds))
  }, [visibleMenuIds])

  useEffect(() => {
    if (!isAuthed) return
    fetchMenuVisibilitySettings()
      .then((saved) => {
        const normalized = normalizeVisibleIds(saved?.visibleMenuIds)
        if (normalized.length > 0) {
          setVisibleMenuIds(normalized)
          setSavedMenuIds(normalized)
          return
        }
        const fallback = normalizeVisibleIds(readVisibleMenuIds())
        setSavedMenuIds(fallback)
      })
      .catch(() => {})
  }, [isAuthed])

  const hasUnsavedMenuChanges = useMemo(
    () => JSON.stringify(normalizeVisibleIds(visibleMenuIds)) !== JSON.stringify(normalizeVisibleIds(savedMenuIds)),
    [visibleMenuIds, savedMenuIds],
  )

  const handleSaveMenuSettings = async () => {
    if (!isAuthed || menuSaving) return
    setMenuSaving(true)
    try {
      const normalized = normalizeVisibleIds(visibleMenuIds)
      await saveMenuVisibilitySettings({ visibleMenuIds: normalized })
      setSavedMenuIds(normalized)
    } catch {
      // ignore persistence error to keep UI responsive
    } finally {
      setMenuSaving(false)
    }
  }

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
    if (location.pathname.startsWith('/agents/precise-sourcing')) return '/agents/precise-sourcing'
    if (location.pathname.startsWith('/agents/admission-screening')) return '/agents/admission-screening'
    if (location.pathname.startsWith('/agents/realtime-monitoring')) return '/agents/realtime-monitoring'
    if (location.pathname.startsWith('/agents/supplier-dd')) return '/agents/supplier-dd'
    if (location.pathname.startsWith('/capability-center/mcp-services')) return '/capability-center/mcp-services'
    if (location.pathname.startsWith('/capability-center/skills')) return '/capability-center/skills'
    if (location.pathname.startsWith('/capability-center/knowledge-base')) return '/capability-center/knowledge-base'
    if (location.pathname.startsWith('/capability-center/vector-search')) return '/capability-center/vector-search'
    if (location.pathname.startsWith('/capability-center/model-management')) return '/capability-center/model-management'
    if (location.pathname.startsWith('/capability-center/search-settings')) return '/capability-center/search-settings'
    if (location.pathname.startsWith('/capability-center/llm-wiki/workbench')) return '/capability-center/llm-wiki/workbench'
    if (location.pathname.startsWith('/capability-center/llm-wiki/graph')) return '/capability-center/llm-wiki/graph'
    if (location.pathname.startsWith('/capability-center/llm-wiki/compose')) return '/capability-center/llm-wiki/compose'
    if (location.pathname.startsWith('/capability-center/llm-wiki/tree/')) return '/capability-center/llm-wiki/workbench'
    if (location.pathname.startsWith('/capability-center/llm-wiki/settings')) return '/capability-center/llm-wiki/settings'
    if (location.pathname.startsWith('/capability-center/llm-wiki/library')) return '/capability-center/llm-wiki/workbench'
    if (location.pathname.startsWith('/capability-center/llm-wiki/manage')) return '/capability-center/llm-wiki/workbench'
    if (location.pathname.startsWith('/langchain-chatchat/multi-chat')) return '/langchain-chatchat/multi-chat'
    if (location.pathname.startsWith('/langchain-chatchat/rag-chat')) return '/langchain-chatchat/rag-chat'
    if (location.pathname.startsWith('/langchain-chatchat/knowledge-base')) return '/langchain-chatchat/knowledge-base'
    if (location.pathname.startsWith('/langchain-chatchat/mcp-management')) return '/langchain-chatchat/mcp-management'
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
    if (location.pathname.startsWith('/agents/precise-sourcing')) return { title: '精准寻源智能体', breadcrumb: ['智能体', '精准寻源智能体'] }
    if (location.pathname.startsWith('/agents/admission-screening')) return { title: '准入排查智能体', breadcrumb: ['智能体', '准入排查智能体'] }
    if (location.pathname.startsWith('/agents/realtime-monitoring')) return { title: '实时监控智能体', breadcrumb: ['智能体', '实时监控智能体'] }
    if (location.pathname.startsWith('/agents/supplier-dd')) return { title: '供应商尽调智能体', breadcrumb: ['智能体', '供应商尽调智能体'] }
    if (location.pathname.startsWith('/capability-center/mcp-services')) return { title: 'MCP服务', breadcrumb: ['能力中心', 'MCP服务'] }
    if (location.pathname.startsWith('/capability-center/skills')) return { title: 'Skill管理', breadcrumb: ['能力中心', 'Skill管理'] }
    if (location.pathname.startsWith('/capability-center/knowledge-base')) return { title: '知识库管理', breadcrumb: ['能力中心', '知识库管理'] }
    if (location.pathname.startsWith('/capability-center/vector-search')) return { title: '向量检索', breadcrumb: ['能力中心', '向量检索'] }
    if (location.pathname.startsWith('/capability-center/model-management')) return { title: '模型管理', breadcrumb: ['能力中心', '模型管理'] }
    if (location.pathname.startsWith('/capability-center/search-settings')) return { title: '搜索配置', breadcrumb: ['能力中心', '搜索配置'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/workbench')) return { title: 'LLM-Wiki / Wiki工作台', breadcrumb: ['能力中心', 'LLM-Wiki', 'Wiki工作台'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/graph')) return { title: 'LLM-Wiki / 关系图谱', breadcrumb: ['能力中心', 'LLM-Wiki', '关系图谱'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/compose')) return { title: 'LLM-Wiki / 导入与生成', breadcrumb: ['能力中心', 'LLM-Wiki', '导入与生成'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/tree/')) return { title: 'LLM-Wiki / Wiki工作台', breadcrumb: ['能力中心', 'LLM-Wiki', 'Wiki工作台'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/settings')) return { title: 'LLM-Wiki / 配置', breadcrumb: ['能力中心', 'LLM-Wiki', '配置'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/library')) return { title: 'LLM-Wiki / Wiki工作台', breadcrumb: ['能力中心', 'LLM-Wiki', 'Wiki工作台'] }
    if (location.pathname.startsWith('/capability-center/llm-wiki/manage')) return { title: 'LLM-Wiki / Wiki工作台', breadcrumb: ['能力中心', 'LLM-Wiki', 'Wiki工作台'] }
    if (location.pathname.startsWith('/langchain-chatchat/multi-chat')) return { title: '多功能对话', breadcrumb: ['Langchain对话', '多功能对话'] }
    if (location.pathname.startsWith('/langchain-chatchat/rag-chat')) return { title: 'RAG对话', breadcrumb: ['Langchain对话', 'RAG对话'] }
    if (location.pathname.startsWith('/langchain-chatchat/knowledge-base')) return { title: '知识库管理', breadcrumb: ['Langchain对话', '知识库管理'] }
    if (location.pathname.startsWith('/langchain-chatchat/mcp-management')) return { title: 'MCP管理', breadcrumb: ['Langchain对话', 'MCP管理'] }
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
          colorPrimary: mergedTheme.primary,
          colorWarning: mergedTheme.warning,
          borderRadius: mergedTheme.radius,
          fontFamily: categoryFont || mergedTheme.font,
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider className="app-sider" breakpoint="lg" collapsedWidth="0">
          <div className="brand-block">
            <Space align="center" size={10}>
              <span className="brand-logo" aria-label="新能源汽车图标">
                <CarOutlined />
              </span>
              <div>
                <Title level={5} style={{ margin: 0 }}>
                  新能源汽车制造供应商高质量数据集
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
                if (typeof key === 'string' && /^https?:\/\//i.test(key)) {
                  window.open(key, '_blank', 'noopener,noreferrer')
                  return
                }
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
                <Button className="app-theme-toggle-pill" icon={<BgColorsOutlined />} onClick={() => setStylePickerOpen(true)}>
                  切换样式
                </Button>
                <Button
                  className="app-theme-toggle-btn"
                  icon={mode === 'light' ? <MoonOutlined /> : <BulbOutlined />}
                  onClick={() => setMode((prev) => (prev === 'light' ? 'dark' : 'light'))}
                >
                  {mode === 'light' ? '深色' : '浅色'}
                </Button>
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
            <RouteErrorBoundary>
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
              <Route path="/agents/precise-sourcing" element={<PreciseSourcingAgentPage />} />
              <Route path="/agents/admission-screening" element={<PlaceholderPage title="准入排查智能体" />} />
              <Route path="/agents/realtime-monitoring" element={<PlaceholderPage title="实时监控智能体" />} />
              <Route path="/agents/supplier-dd" element={<PlaceholderPage title="供应商尽调智能体" />} />
              <Route path="/capability-center/mcp-services" element={<McpServicesPage />} />
              <Route path="/capability-center/skills" element={<SkillManagementPage />} />
              <Route path="/capability-center/knowledge-base" element={<KnowledgeBaseManagementPage />} />
              <Route path="/capability-center/vector-search" element={<Suspense fallback={<Card className="app-elevated-card">加载中...</Card>}><VectorSearchPage /></Suspense>} />
              <Route path="/capability-center/model-management" element={<ModelManagementPage />} />
              <Route path="/capability-center/search-settings" element={<SearchSettingsPage />} />
              <Route path="/capability-center/llm-wiki/workbench" element={<LlmWikiPage view="workbench" />} />
              <Route path="/capability-center/llm-wiki/graph" element={<LlmWikiPage view="graph" />} />
              <Route path="/capability-center/llm-wiki/compose" element={<LlmWikiPage view="manage" />} />
              <Route path="/capability-center/llm-wiki/tree/:section" element={<Navigate replace to="/capability-center/llm-wiki/workbench" />} />
              <Route path="/capability-center/llm-wiki/settings" element={<LlmWikiPage view="settings" />} />
              <Route path="/capability-center/llm-wiki/library" element={<Navigate replace to="/capability-center/llm-wiki/workbench" />} />
              <Route path="/capability-center/llm-wiki/manage" element={<Navigate replace to="/capability-center/llm-wiki/workbench" />} />
              <Route path="/langchain-chatchat/multi-chat" element={<LangchainMultiChatPage />} />
              <Route path="/langchain-chatchat/rag-chat" element={<LangchainRagChatPage />} />
              <Route path="/langchain-chatchat/knowledge-base" element={<LangchainKnowledgeBasePage />} />
              <Route path="/langchain-chatchat/mcp-management" element={<LangchainMcpPage />} />
              <Route path="/sessions" element={<SessionHistoryPage />} />
              <Route path="/sessions/new" element={<SessionChatPage />} />
              <Route path="/sessions/:id" element={<SessionChatPage />} />
              <Route path="*" element={<Navigate replace to="/" />} />
              </Routes>
            </RouteErrorBoundary>
          </Content>
        </Layout>
      </Layout>
      <Modal
        title="选择应用 Style（67 recommendations）"
        open={stylePickerOpen}
        onCancel={() => setStylePickerOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text className="muted">
            参考：
            <a href={STYLE_REFERENCE_URL} target="_blank" rel="noreferrer noopener">
              {STYLE_REFERENCE_URL}
            </a>
          </Text>
          <Text className="muted">Category</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORY_OPTIONS.map((name) => (
              <Button
                key={name}
                size="small"
                type={categoryDraft === name ? 'primary' : 'default'}
                onClick={() => {
                  setCategoryDraft(name)
                  const picked = pickScenario(name, modeDraft)
                  if (picked) {
                    setScenarioDraft(picked.id)
                    setStyleDraft(picked.style)
                    setPaletteDraft(picked.palette)
                    setProductTypeDraft(picked.productType)
                    setModeDraft(picked.mode || 'all')
                  }
                }}
              >
                {name}
              </Button>
            ))}
          </div>
          <Text className="muted">Mode</Text>
          <Space wrap>
            <Button size="small" type={modeDraft === 'all' ? 'primary' : 'default'} onClick={() => setModeDraft('all')}>All Modes</Button>
            <Button size="small" type={modeDraft === 'light' ? 'primary' : 'default'} onClick={() => setModeDraft('light')}>Light</Button>
            <Button size="small" type={modeDraft === 'dark' ? 'primary' : 'default'} onClick={() => setModeDraft('dark')}>Dark</Button>
          </Space>
          <Text className="muted">Scenario</Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
            {scenarioPreviewList.map((item) => (
              <Card
                key={item.id}
                hoverable
                onClick={() => setScenarioDraft(item.id)}
                className="app-elevated-card"
                bodyStyle={{ padding: 10 }}
                style={{
                  cursor: 'pointer',
                  borderColor: selectedScenario?.id === item.id ? 'var(--primary)' : undefined,
                  boxShadow: selectedScenario?.id === item.id ? '0 0 0 1px var(--primary)' : undefined,
                }}
              >
                <div
                  style={{
                    height: 72,
                    borderRadius: 8,
                    marginBottom: 8,
                    background: `linear-gradient(135deg, ${item.palette.primary}, ${item.palette.warning})`,
                  }}
                />
                <Text strong style={{ display: 'block' }}>{item.title}</Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                  {item.category} · {item.mode}
                </Text>
                <Text type="secondary" style={{ display: 'block' }}>
                  {item.style}
                </Text>
              </Card>
            ))}
          </div>
          <Text type="secondary">场景总数：{scenarioOptions.length}</Text>
          <Text type="secondary">{scenarioOptions.length} demos available • {CATEGORY_OPTIONS.length - 1} categories • {CATEGORY_SCENARIOS.filter((item) => item.mode === 'light').length} light • {CATEGORY_SCENARIOS.filter((item) => item.mode === 'dark').length} dark</Text>
          <div style={{ whiteSpace: 'nowrap', overflowX: 'auto', color: 'var(--text-subtle)', fontSize: 13 }}>
            当前样式：{stylePreset} · 当前调色板：{palettePreset} · 当前类别：{categoryPreset} · 当前场景：{CATEGORY_SCENARIOS.find((item) => item.id === scenarioPreset)?.title || DEFAULT_SCENARIO?.title || '-'} · 当前产品类型：{productTypePreset}
          </div>
          <Space>
            <Button
              type="primary"
              onClick={async () => {
                const picked = pickScenario(categoryDraft, modeDraft, selectedScenario?.id)
                if (picked) {
                  setStylePreset(picked.style)
                  setPalettePreset(picked.palette)
                  setProductTypePreset(picked.productType)
                  setCategoryPreset(picked.category)
                  setScenarioPreset(picked.id)
                  setScenarioDraft(picked.id)
                  setStyleDraft(picked.style)
                  setPaletteDraft(picked.palette)
                  setProductTypeDraft(picked.productType)
                  setMode(picked.mode)
                  try {
                    await saveUiStyleSettings({
                      stylePreset: picked.style,
                      palettePreset: picked.palette,
                      productTypePreset: picked.productType,
                      categoryPreset: picked.category,
                      scenarioPreset: picked.id,
                      mode: picked.mode,
                    })
                  } catch {
                    // ignore persistence error to keep UI responsive
                  }
                }
                setStylePickerOpen(false)
              }}
            >
              切换
            </Button>
            <Button
              onClick={async () => {
                const defaultStyle = DEFAULT_UI_SELECTION.stylePreset
                const defaultPalette = DEFAULT_UI_SELECTION.palettePreset
                const defaultCategory = DEFAULT_UI_SELECTION.productTypePreset
                const defaultBizCategory = DEFAULT_UI_SELECTION.categoryPreset
                const firstScenario = pickScenario(defaultBizCategory, DEFAULT_UI_SELECTION.mode) || DEFAULT_SCENARIO
                setStyleDraft(defaultStyle)
                setPaletteDraft(defaultPalette)
                setProductTypeDraft(defaultCategory)
                setCategoryDraft(defaultBizCategory)
                setModeDraft(DEFAULT_UI_SELECTION.mode)
                setStylePreset(defaultStyle)
                setPalettePreset(defaultPalette)
                setProductTypePreset(defaultCategory)
                setCategoryPreset(defaultBizCategory)
                setScenarioPreset(firstScenario?.id || '')
                setScenarioDraft(firstScenario?.id || '')
                setMode(DEFAULT_UI_SELECTION.mode)
                try {
                  await saveUiStyleSettings({
                    stylePreset: defaultStyle,
                    palettePreset: defaultPalette,
                    productTypePreset: defaultCategory,
                    categoryPreset: defaultBizCategory,
                    scenarioPreset: firstScenario?.id || '',
                    mode: DEFAULT_UI_SELECTION.mode,
                  })
                } catch {
                  // ignore persistence error
                }
              }}
            >
              重置默认
            </Button>
            <Button onClick={() => window.open(STYLE_REFERENCE_URL, '_blank', 'noopener,noreferrer')}>打开参考链接</Button>
          </Space>
        </Space>
      </Modal>
      <Modal
        title="菜单权限设置"
        open={menuSettingOpen}
        onCancel={() => setMenuSettingOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <Text type="secondary" style={{ marginRight: 8 }}>
              勾选后立即生效用于预览，点击上角“保存”后才会入库并跨设备生效。
              {hasUnsavedMenuChanges ? '（当前变更未保存）' : '（当前变更已保存）'}
            </Text>
            <Button type="primary" size="small" loading={menuSaving} onClick={handleSaveMenuSettings}>
              保存
            </Button>
          </div>
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
                            if (item.id === 'agent-precise-sourcing' || item.id === 'agent-admission-screening' || item.id === 'agent-realtime-monitoring' || item.id === 'agent-supplier-dd') {
                              set.add('agents')
                            }
                            if (item.id === 'capability-mcp-services' || item.id === 'capability-skill-management' || item.id === 'capability-knowledge-base' || item.id === 'capability-vector-search' || item.id === 'capability-model-management') {
                              set.add('capability-center')
                            }
                            if (item.id === 'langchain-multi-chat' || item.id === 'langchain-rag-chat') {
                              set.add('langchain-dialog')
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
                            if (item.id === 'agents') {
                              set.delete('agent-precise-sourcing')
                              set.delete('agent-admission-screening')
                              set.delete('agent-realtime-monitoring')
                              set.delete('agent-supplier-dd')
                            }
                            if (item.id === 'capability-center') {
                              set.delete('capability-mcp-services')
                              set.delete('capability-skill-management')
                              set.delete('capability-knowledge-base')
                              set.delete('capability-vector-search')
                              set.delete('capability-model-management')
                            }
                            if (item.id === 'langchain-dialog') {
                              set.delete('langchain-multi-chat')
                              set.delete('langchain-rag-chat')
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
