import { EyeOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import {
  Avatar,
  Button,
  Card,
  Drawer,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useMemo, useState } from 'react'

const { Title, Text } = Typography

const initialUsers = [
  { id: 1, name: 'Alice Chen', email: 'alice@seabox.com', role: 'Admin', status: 'Active' },
  { id: 2, name: 'Bob Li', email: 'bob@seabox.com', role: 'Operator', status: 'Active' },
  { id: 3, name: 'Carol Sun', email: 'carol@seabox.com', role: 'Viewer', status: 'Inactive' },
  { id: 4, name: 'David Wang', email: 'david@seabox.com', role: 'Operator', status: 'Active' },
]

function UsersPage() {
  const [users, setUsers] = useState(initialUsers)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)

  const columns = useMemo(
    () => [
      {
        title: 'User',
        dataIndex: 'name',
        key: 'name',
        render: (_, record) => (
          <Space>
            <Avatar icon={<UserOutlined />} />
            <div>
              <div>{record.name}</div>
              <Text type="secondary">{record.email}</Text>
            </div>
          </Space>
        ),
      },
      {
        title: 'Role',
        dataIndex: 'role',
        key: 'role',
        render: (_, record) => (
          <Select
            value={record.role}
            style={{ width: 120 }}
            onChange={(value) =>
              setUsers((prev) => prev.map((item) => (item.id === record.id ? { ...item, role: value } : item)))
            }
            options={[
              { value: 'Admin', label: 'Admin' },
              { value: 'Operator', label: 'Operator' },
              { value: 'Viewer', label: 'Viewer' },
            ]}
          />
        ),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (status) => <Tag color={status === 'Active' ? 'success' : 'default'}>{status}</Tag>,
      },
      {
        title: 'Action',
        key: 'action',
        render: (_, record) => (
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => {
              setCurrentUser(record)
              setDrawerOpen(true)
            }}
          >
            详情
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card className="glass-card">
        <Space orientation="vertical" size={6}>
          <Title level={3} style={{ margin: 0 }}>
            Users
          </Title>
          <Text className="muted">用户列表、角色管理与详情面板</Text>
        </Space>
      </Card>

      <Card className="glass-card table-card" title={<Space><TeamOutlined />用户管理</Space>}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          pagination={{
            current: tablePage,
            pageSize: tablePageSize,
            total: users.length,
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

      <Drawer
        title="用户详情"
        open={drawerOpen}
        width={420}
        onClose={() => setDrawerOpen(false)}
      >
        {currentUser ? (
          <Space orientation="vertical" size={14}>
            <Space>
              <Avatar size={56} icon={<UserOutlined />} />
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {currentUser.name}
                </Title>
                <Text type="secondary">{currentUser.email}</Text>
              </div>
            </Space>
            <Card size="small">
              <p>
                <b>角色：</b>
                {currentUser.role}
              </p>
              <p>
                <b>状态：</b>
                {currentUser.status}
              </p>
              <p>
                <b>最后登录：</b>
                2026-04-20 09:18
              </p>
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  )
}

export default UsersPage
