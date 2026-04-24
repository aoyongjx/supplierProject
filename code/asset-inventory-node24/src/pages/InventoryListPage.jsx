import { DeleteOutlined, EditOutlined, PlusOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Button, Card, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { batchDeleteInventories, deleteInventory, fetchInventories } from '../api/inventoryApi'

const { Title } = Typography

function InventoryListPage() {
  const [dataSource, setDataSource] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const navigate = useNavigate()

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await fetchInventories()
      setDataSource(data.map((item) => ({ ...item, key: item.id })))
      setSelectedRowKeys((prev) => prev.filter((id) => data.some((item) => item.id === id)))
    } catch (error) {
      message.error(error.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const total = dataSource.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [dataSource.length, tablePage, tablePageSize])

  const handleDelete = async (id) => {
    try {
      await deleteInventory(id)
      message.success('删除成功')
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

  const columns = useMemo(
    () => [
      { title: '资产编码', dataIndex: 'assetCode', key: 'assetCode' },
      { title: '资产名称', dataIndex: 'assetName', key: 'assetName' },
      { title: '所属部门', dataIndex: 'department', key: 'department' },
      { title: '责任人', dataIndex: 'owner', key: 'owner' },
      { title: '位置', dataIndex: 'location', key: 'location' },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (status) => {
          const colorMap = {
            正常: 'green',
            闲置: 'gold',
            损坏: 'red',
            遗失: 'volcano',
          }
          return <Tag color={colorMap[status] || 'default'}>{status}</Tag>
        },
      },
      { title: '盘点日期', dataIndex: 'checkDate', key: 'checkDate' },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (_, record) => (
          <Space size={2}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/inventories/${record.id}/edit`)}>
              修改
            </Button>
            <Popconfirm
              title="确认删除该资产记录？"
              description={`资产编码：${record.assetCode}`}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [navigate],
  )

  return (
    <Card className="app-elevated-card">
      <Space className="page-titlebar">
        <Space>
          <span className="title-icon">
            <UnorderedListOutlined />
          </span>
          <Title level={3} style={{ margin: 0 }}>
            资产盘点列表
          </Title>
        </Space>
        <Space>
          <Popconfirm
            title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`}
            description="删除后无法恢复，请谨慎操作。"
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleBatchDelete}
            disabled={selectedRowKeys.length === 0}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0}>
              批量删除
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/inventories/new')}>
            新增填报
          </Button>
        </Space>
      </Space>
      <Table
        className="app-data-table"
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{
          current: tablePage,
          pageSize: tablePageSize,
          total: dataSource.length,
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

export default InventoryListPage
