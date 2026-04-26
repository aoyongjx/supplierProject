import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Card, Input, Popconfirm, Space, Table, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  batchDeleteSupplierProfiles,
  clearAllSupplierProfiles,
  deleteSupplierProfile,
  fetchSupplierProfiles,
} from '../api/supplierProfileApi'

const { Title, Text } = Typography

function SupplierProfileListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [records, setRecords] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const isGasView = location.pathname.startsWith('/gas-supplier-profiles') || location.pathname.startsWith('/gas-suppliers')
  const basePath = isGasView ? '/gas-suppliers' : '/supplier-profiles'
  const profileView = isGasView ? 'gas' : 'gys'

  const loadData = async (nextKeyword = keyword) => {
    try {
      setLoading(true)
      const data = await fetchSupplierProfiles({ limit: 5000, keyword: nextKeyword, view: profileView })
      const safeData = Array.isArray(data) ? data : []
      setRecords(safeData.map((item) => ({ ...item, key: item.id })))
      setSelectedRowKeys((prev) => prev.filter((id) => safeData.some((item) => Number(item.id) === Number(id))))
    } catch (error) {
      message.error(error.message || '加载供应商档案失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData('')
  }, [profileView])

  useEffect(() => {
    const total = records.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [records.length, tablePage, tablePageSize])

  const handleDelete = async (id) => {
    try {
      await deleteSupplierProfile(id, { view: profileView })
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteSupplierProfiles(selectedRowKeys, { view: profileView })
      message.success(`已删除 ${result?.deletedCount || 0} 条记录`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '批量删除失败')
    }
  }

  const handleClearAll = async () => {
    try {
      const result = await clearAllSupplierProfiles({ view: profileView })
      message.success(`已清空全部记录，共 ${result?.deletedCount || 0} 条`)
      setSelectedRowKeys([])
      await loadData()
    } catch (error) {
      message.error(error.message || '清空失败')
    }
  }

  const columns = useMemo(
    () => [
      { title: '供应链节点', dataIndex: 'relatedNodeName', width: 200, ellipsis: true },
      { title: '公司名称', dataIndex: 'companyName', width: 260, ellipsis: true },
      { title: '法人代表', dataIndex: 'legalRepresentative', width: 180, ellipsis: true },
      ...(
        isGasView
          ? []
          : [{
            title: '官网',
            dataIndex: 'website',
            width: 300,
            render: (value) => (value
              ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer">{value}</a>
              : <Text type="secondary">-</Text>
            ),
          }]
      ),
      { title: '更新时间', dataIndex: 'updatedAt', width: 190 },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        render: (_, record) => (
          <Space size={2}>
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`${basePath}/${record.id}`)}>
              查看
            </Button>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`${basePath}/${record.id}/edit`)}>
              修改
            </Button>
            <Popconfirm title="确认删除该档案吗？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [basePath, isGasView, navigate],
  )

  return (
    <Card className="app-elevated-card">
      <Space className="page-titlebar">
        <Space>
          <span className="title-icon">
            <TeamOutlined />
          </span>
          <Title level={3} style={{ margin: 0 }}>
            供应商档案管理
          </Title>
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="按公司名/联系人/联系方式搜索"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => {
              const next = String(value || '').trim()
              setKeyword(next)
              loadData(next)
            }}
          />
          <Popconfirm
            title={`确认批量删除已选 ${selectedRowKeys.length} 条记录吗？`}
            okText="删除"
            cancelText="取消"
            onConfirm={handleBatchDelete}
            disabled={selectedRowKeys.length === 0}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
              批量删除
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`确认清空全部供应商档案吗？当前共 ${records.length} 条`}
            description="该操作不可恢复，请谨慎操作。"
            okText="清空全部"
            cancelText="取消"
            onConfirm={handleClearAll}
            disabled={records.length === 0}
          >
            <Button danger disabled={records.length === 0}>
              清空所有
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`${basePath}/new`)}>
            新增档案
          </Button>
        </Space>
      </Space>

      <Table
        className="app-data-table"
        rowKey="id"
        loading={loading}
        dataSource={records}
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{
          current: tablePage,
          pageSize: tablePageSize,
          total: records.length,
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
  )
}

export default SupplierProfileListPage
