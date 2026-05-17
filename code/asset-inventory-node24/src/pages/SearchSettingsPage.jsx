import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Modal, Select, Space, Switch, Table, Typography, message } from 'antd'
import { fetchSearchQuota, fetchSearchSettings, saveSearchSettings, testSearchSettings } from '../api/searchSettingsApi'

const { Text } = Typography

const DEFAULT_SITES = [
  { domain: 'i.gasgoo.com', enabled: true },
  { domain: 'auto.gasgoo.com', enabled: true },
  { domain: 'qcgys.com', enabled: true },
  { domain: 'marklines.com', enabled: true },
  { domain: 'globalnevs.com', enabled: true },
  { domain: 'd1ev.com', enabled: true },
  { domain: 'evpartner.com', enabled: true },
  { domain: 'ecaigou.com', enabled: true },
]

const TOOL_OPTIONS = [
  { label: 'Google AI Overview API', value: 'google_ai_overview' },
  { label: 'Google Search API', value: 'google_search' },
  { label: 'Google Light Search API', value: 'google_light' },
  { label: 'Bing Search API', value: 'bing_search' },
  { label: 'Baidu Search API', value: 'baidu_search' },
  { label: 'DuckDuckGo Search API', value: 'duckduckgo' },
]
const PROVIDER_OPTIONS = [
  { label: 'serpapi', value: 'serpapi' },
  { label: 'serper', value: 'serper' },
]

function normalizeSiteRows(list = []) {
  const raw = Array.isArray(list) ? list : []
  const rows = raw
    .map((item) => (item && typeof item === 'object'
      ? { domain: String(item.domain || '').trim().toLowerCase(), enabled: item.enabled !== false }
      : { domain: String(item || '').trim().toLowerCase(), enabled: true }))
    .filter((item) => item.domain)
  return rows.length > 0 ? rows : DEFAULT_SITES.map((item) => ({ ...item }))
}

export default function SearchSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchTool, setSearchTool] = useState('google_ai_overview')
  const [serviceProvider, setServiceProvider] = useState('serpapi')
  const [apiKey, setApiKey] = useState('')
  const [siteWhitelistEnabled, setSiteWhitelistEnabled] = useState(false)
  const [sites, setSites] = useState(DEFAULT_SITES)
  const [testing, setTesting] = useState(false)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [resultText, setResultText] = useState('')
  const [resultModalOpen, setResultModalOpen] = useState(false)
  const [resultModalTitle, setResultModalTitle] = useState('执行结果')

  const isAiOverview = searchTool === 'google_ai_overview'
  const whitelistEditable = !isAiOverview && siteWhitelistEnabled

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const data = await fetchSearchSettings()
        if (!mounted) return
        const nextTool = String(data?.searchTool || 'google_ai_overview')
        setSearchTool(nextTool)
        setServiceProvider(String(data?.serviceProvider || 'serpapi'))
        setApiKey(String(data?.apiKey || ''))
        setSiteWhitelistEnabled(nextTool === 'google_ai_overview' ? false : data?.siteWhitelistEnabled !== false)
        setSites(normalizeSiteRows(data?.siteWhitelist))
      } catch (error) {
        message.error(`加载搜索配置失败：${error.message || error}`)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (isAiOverview) setSiteWhitelistEnabled(false)
  }, [isAiOverview])

  useEffect(() => {
    if (serviceProvider === 'serper' && searchTool === 'google_ai_overview') {
      setSearchTool('google_search')
    }
  }, [serviceProvider, searchTool])

  const tableData = useMemo(
    () => sites.map((item, idx) => ({ key: `${idx}`, domain: item.domain, enabled: item.enabled !== false })),
    [sites],
  )

  const onAddEmptySiteRow = () => {
    setSites((prev) => [...prev, { domain: '', enabled: true }])
  }

  const onUpdateSite = (index, value) => {
    setSites((prev) => prev.map((item, idx) => (
      idx === index
        ? { ...item, domain: String(value || '').trim().toLowerCase() }
        : item
    )))
  }

  const onToggleSite = (index, enabled) => {
    setSites((prev) => prev.map((item, idx) => (idx === index ? { ...item, enabled: enabled === true } : item)))
  }

  const onDeleteSite = (index) => {
    setSites((prev) => prev.filter((_, idx) => idx !== index))
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const dedup = new Map()
      for (const item of sites) {
        const domain = String(item?.domain || '').trim().toLowerCase()
        if (!domain) continue
        if (!dedup.has(domain)) {
          dedup.set(domain, { domain, enabled: item?.enabled !== false })
          continue
        }
        const current = dedup.get(domain)
        dedup.set(domain, { domain, enabled: Boolean(current?.enabled || item?.enabled) })
      }
      const payload = {
        serviceProvider: String(serviceProvider || 'serpapi'),
        searchTool: String(searchTool || 'google_ai_overview'),
        apiKey: String(apiKey || '').trim(),
        siteWhitelistEnabled: isAiOverview ? false : siteWhitelistEnabled === true,
        siteWhitelist: Array.from(dedup.values()),
      }
      const saved = await saveSearchSettings(payload)
      setServiceProvider(String(saved?.serviceProvider || payload.serviceProvider))
      setSearchTool(String(saved?.searchTool || payload.searchTool))
      setSiteWhitelistEnabled(saved?.searchTool === 'google_ai_overview' ? false : saved?.siteWhitelistEnabled === true)
      setSites(normalizeSiteRows(saved?.siteWhitelist))
      message.success('搜索配置已保存')
    } catch (error) {
      message.error(`保存搜索配置失败：${error.message || error}`)
    } finally {
      setSaving(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    try {
      const data = await testSearchSettings({
        serviceProvider,
        searchTool,
        apiKey: String(apiKey || '').trim(),
        keyword: '汽车供应商',
      })
      const lines = [
        `测试时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `工具: ${String(data?.tool || searchTool)}`,
        `服务商: ${String(data?.serviceProvider || serviceProvider)}`,
        `引擎: ${String(data?.engine || '-')}`,
        `命中数: ${Number(data?.totalHits || 0)}`,
        '',
        '样例结果:',
        ...(Array.isArray(data?.sample) && data.sample.length > 0
          ? data.sample.map((item, idx) => `${idx + 1}. ${String(item?.title || '-')}\n${String(item?.url || '-')}\n${String(item?.snippet || '-')}`)
          : ['(无结果)']),
      ]
      setResultText(lines.join('\n'))
      setResultModalTitle('测试结果')
      setResultModalOpen(true)
      message.success('搜索测试完成')
    } catch (error) {
      setResultText(`测试失败: ${error.message || error}`)
      message.error(`测试失败：${error.message || error}`)
    } finally {
      setTesting(false)
    }
  }

  const onFetchQuota = async () => {
    setQuotaLoading(true)
    try {
      const data = await fetchSearchQuota({
        serviceProvider,
        searchTool,
        apiKey: String(apiKey || '').trim(),
      })
      setResultText([
        `查询时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `工具: ${String(data?.tool || searchTool)}`,
        `服务商: ${String(data?.serviceProvider || serviceProvider)}`,
        '',
        JSON.stringify(data?.quota || data || {}, null, 2),
      ].join('\n'))
      setResultModalTitle('额度查询结果')
      setResultModalOpen(true)
      message.success('额度查询完成')
    } catch (error) {
      setResultText(`额度查询失败: ${error.message || error}`)
      message.error(`额度查询失败：${error.message || error}`)
    } finally {
      setQuotaLoading(false)
    }
  }

  return (
    <Card className="app-elevated-card" loading={loading} title="搜索配置">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Space align="end" size={16} wrap>
            <div>
              <Text strong>服务商</Text>
              <div style={{ marginTop: 8 }}>
                <Select
                  style={{ width: 160 }}
                  value={serviceProvider}
                  options={PROVIDER_OPTIONS}
                  onChange={setServiceProvider}
                />
              </div>
            </div>
            <div>
              <Text strong>搜索工具</Text>
              <div style={{ marginTop: 8 }}>
                <Select
                  style={{ width: 320 }}
                  value={searchTool}
                  options={TOOL_OPTIONS}
                  onChange={setSearchTool}
                />
              </div>
            </div>
            <div style={{ minWidth: 480, maxWidth: 760, flex: 1 }}>
              <Text strong>API Key</Text>
              <div style={{ marginTop: 8 }}>
                <Input.Password
                  placeholder={`请输入 ${serviceProvider} API Key`}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <Space wrap>
                <Button loading={testing} onClick={onTest}>
                  测试
                </Button>
                <Button loading={quotaLoading} onClick={onFetchQuota}>
                  查询额度
                </Button>
              </Space>
            </div>
          </Space>
        </div>

        <div style={{ opacity: isAiOverview ? 0.55 : 1 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Text strong>搜索网站白名单</Text>
              <Switch
                checked={siteWhitelistEnabled}
                disabled={isAiOverview}
                onChange={setSiteWhitelistEnabled}
              />
            </Space>
            <Button size="small" onClick={onAddEmptySiteRow} disabled={!whitelistEditable}>
              新增空行
            </Button>
          </Space>
          <Table
            style={{ marginTop: 10 }}
            size="small"
            pagination={false}
            dataSource={tableData}
            columns={[
              {
                title: '域名',
                dataIndex: 'domain',
                key: 'domain',
                render: (_value, row, idx) => (
                  <Input
                    value={row.domain}
                    onChange={(e) => onUpdateSite(idx, e.target.value)}
                    disabled={!whitelistEditable}
                  />
                ),
              },
              {
                title: '启用',
                key: 'enabled',
                width: 120,
                render: (_value, row, idx) => (
                  <Switch
                    checked={row.enabled}
                    disabled={!whitelistEditable}
                    onChange={(checked) => onToggleSite(idx, checked)}
                  />
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 120,
                render: (_value, _row, idx) => (
                  <Button danger size="small" disabled={!whitelistEditable} onClick={() => onDeleteSite(idx)}>
                    删除
                  </Button>
                ),
              },
            ]}
          />
        </div>

        <div>
          <Space wrap>
            <Button type="primary" loading={saving} onClick={onSave}>
              保存
            </Button>
          </Space>
        </div>

      </Space>
      <Modal
        open={resultModalOpen}
        title={resultModalTitle}
        onCancel={() => setResultModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setResultModalOpen(false)}>
            关闭
          </Button>,
        ]}
        width={900}
      >
        <Input.TextArea
          value={resultText}
          onChange={(e) => setResultText(e.target.value)}
          rows={22}
          style={{ fontFamily: 'Consolas, Menlo, Monaco, monospace' }}
        />
      </Modal>
    </Card>
  )
}
