import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  batchDeleteInventories,
  deleteInventory,
  fetchInventories,
} from '../api/inventoryApi'

const { Title, Text } = Typography

function TenantsPage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const navigate = useNavigate()

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await fetchInventories()
      setRecords(data.map((item) => ({ ...item, key: item.id })))
    } catch (error) {
      message.error(error.message || '租户列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredData = useMemo(() => {
    return records.filter((item) => {
      const keywordMatched =
        !keyword ||
        item.assetCode?.toLowerCase().includes(keyword.toLowerCase()) ||
        item.assetName?.toLowerCase().includes(keyword.toLowerCase()) ||
        item.owner?.toLowerCase().includes(keyword.toLowerCase())
      const statusMatched = !statusFilter || item.status === statusFilter
      return keywordMatched && statusMatched
    })
  }, [records, keyword, statusFilter])

  useEffect(() => {
    const total = filteredData.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [filteredData.length, tablePage, tablePageSize])

  const handleDelete = async (id) => {
    try {
      await deleteInventory(id)
      message.success('租户记录已删除')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteInventories(selectedRowKeys)
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const columns = [
    { title: 'Tenant ID', dataIndex: 'assetCode', key: 'assetCode' },
    { title: 'Tenant Name', dataIndex: 'assetName', key: 'assetName' },
    { title: 'Admin', dataIndex: 'owner', key: 'owner' },
    { title: 'Department', dataIndex: 'department', key: 'department' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const map = { 正常: 'success', 闲置: 'warning', 损坏: 'error', 遗失: 'volcano' }
        return <Tag color={map[status] || 'default'}>{status}</Tag>
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => navigate(`/tenants/${record.id}/edit`)}>
            修改
          </Button>
          <Popconfirm
            title="确认删除该租户记录？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" icon={<DeleteOutlined />} danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card className="glass-card">
        <Space orientation="vertical" size={6}>
          <Title level={3} style={{ margin: 0 }}>
            Tenants
          </Title>
          <Text className="muted">租户搜索筛选、状态管理与批量操作</Text>
        </Space>
      </Card>

      <Card className="glass-card">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索 Tenant ID / Name / Admin"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 280 }}
            />
            <Select
              allowClear
              value={statusFilter || undefined}
              onChange={(value) => setStatusFilter(value || '')}
              placeholder="状态筛选"
              style={{ width: 160 }}
              options={[
                { value: '正常', label: '正常' },
                { value: '闲置', label: '闲置' },
                { value: '损坏', label: '损坏' },
                { value: '遗失', label: '遗失' },
              ]}
            />
          </Space>
          <Space wrap>
            <Popconfirm
              title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`}
              okText="确认删除"
              cancelText="取消"
              onConfirm={handleBatchDelete}
              disabled={selectedRowKeys.length === 0}
            >
              <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
                批量删除
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tenants/new')}>
              新建租户
            </Button>
          </Space>
        </Space>
      </Card>

      <Card className="glass-card table-card" title={<Space><TeamOutlined />租户列表</Space>}>
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          columns={columns}
          dataSource={filteredData}
          loading={loading}
          pagination={{
            current: tablePage,
            pageSize: tablePageSize,
            total: filteredData.length,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
            onChange: (page, pageSize) => {
              setTablePage(page)
              if (pageSize !== tablePageSize) setTablePageSize(pageSize)
            },
            onShowSizeChange: (_current, size) => {
              setTablePage(1)
              setTablePageSize(size)
            },
            position: ['bottomRight'],
          }}
        />
      </Card>
    </Space>
  )
}

export default TenantsPage
