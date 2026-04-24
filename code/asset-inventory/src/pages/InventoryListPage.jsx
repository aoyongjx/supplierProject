import { Button, Card, Space, Table, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getInventories } from '../api/inventoryApi'

const { Title } = Typography

const columns = [
  { title: '资产编码', dataIndex: 'assetCode', key: 'assetCode' },
  { title: '资产名称', dataIndex: 'assetName', key: 'assetName' },
  { title: '所属部门', dataIndex: 'department', key: 'department' },
  { title: '责任人', dataIndex: 'owner', key: 'owner' },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (status) => {
      const color = status === '已确认' ? 'green' : status === '待确认' ? 'gold' : 'red'
      return <Tag color={color}>{status}</Tag>
    },
  },
  { title: '更新时间', dataIndex: 'updateTime', key: 'updateTime' },
]

function InventoryListPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [dataSource, setDataSource] = useState([])

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const data = await getInventories()
        setDataSource(data.map((item) => ({ ...item, key: item.id })))
      } catch (error) {
        message.error(error.message || '获取列表失败')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  return (
    <Card>
      <Space
        align="center"
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
      >
        <Title level={3} style={{ margin: 0 }}>
          资产盘点列表
        </Title>
        <Button type="primary" onClick={() => navigate('/inventories/new')}>
          新增填报
        </Button>
      </Space>
      <Table
        dataSource={dataSource}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
    </Card>
  )
}

export default InventoryListPage
