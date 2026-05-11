import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Select, Space, Table, Typography, message } from 'antd'
import { fetchSearchSettings, saveSearchSettings } from '../api/searchSettingsApi'

const { Text } = Typography

const DEFAULT_SITES = [
  'i.gasgoo.com',
  'auto.gasgoo.com',
  'qcgys.com',
  'marklines.com',
  'globalnevs.com',
  'd1ev.com',
  'evpartner.com',
  'ecaigou.com',
]

export default function SearchSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchTool, setSearchTool] = useState('google_ai_overview')
  const [apiKey, setApiKey] = useState('')
  const [sites, setSites] = useState(DEFAULT_SITES)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const data = await fetchSearchSettings()
        if (!mounted) return
        setSearchTool(String(data?.searchTool || 'google_ai_overview'))
        setApiKey(String(data?.apiKey || ''))
        const list = Array.isArray(data?.siteWhitelist) ? data.siteWhitelist : DEFAULT_SITES
        setSites(list.map((x) => String(x || '').trim()).filter(Boolean))
      } catch (error) {
        message.error(`加载搜索配置失败：${error.message || error}`)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const tableData = useMemo(() => sites.map((site, idx) => ({ key: `${idx}`, site })), [sites])

  const onAddEmptySiteRow = () => {
    setSites((prev) => [...prev, ''])
  }

  const onUpdateSite = (index, value) => {
    const next = [...sites]
    next[index] = String(value || '').trim().toLowerCase()
    setSites(next)
  }

  const onDeleteSite = (index) => {
    setSites((prev) => prev.filter((_, idx) => idx !== index))
  }

  const onSave = async () => {
    setSaving(true)
    try {
      const payload = {
        searchTool: String(searchTool || 'google_ai_overview'),
        apiKey: String(apiKey || '').trim(),
        siteWhitelist: Array.from(new Set(sites.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))),
      }
      await saveSearchSettings(payload)
      message.success('搜索配置已保存')
    } catch (error) {
      message.error(`保存搜索配置失败：${error.message || error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="app-elevated-card" loading={loading} title="搜索配置">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Space align="end" size={16} wrap>
            <div>
              <Text strong>搜索工具</Text>
              <div style={{ marginTop: 8 }}>
                <Select
                  style={{ width: 260 }}
                  value={searchTool}
                  options={[{ label: 'Google AI Overview', value: 'google_ai_overview' }, { label: 'SerpApi', value: 'serpapi' }]}
                  onChange={setSearchTool}
                />
              </div>
            </div>
            <div style={{ minWidth: 480, maxWidth: 760, flex: 1 }}>
              <Text strong>API Key</Text>
              <div style={{ marginTop: 8 }}>
                <Input.Password
                  placeholder="请输入 SerpApi API Key（Google AI Overview 同样使用）"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          </Space>
        </div>

        <div>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>搜索网站白名单</Text>
            <Button size="small" onClick={onAddEmptySiteRow}>新增空行</Button>
          </Space>
          <Table
            style={{ marginTop: 10 }}
            size="small"
            pagination={false}
            dataSource={tableData}
            columns={[
              {
                title: '域名',
                dataIndex: 'site',
                key: 'site',
                render: (_value, row, idx) => (
                  <Input
                    value={row.site}
                    onChange={(e) => onUpdateSite(idx, e.target.value)}
                  />
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 120,
                render: (_value, _row, idx) => (
                  <Button danger size="small" onClick={() => onDeleteSite(idx)}>
                    删除
                  </Button>
                ),
              },
            ]}
          />
        </div>

        <div>
          <Button type="primary" loading={saving} onClick={onSave}>
            保存
          </Button>
        </div>
      </Space>
    </Card>
  )
}
