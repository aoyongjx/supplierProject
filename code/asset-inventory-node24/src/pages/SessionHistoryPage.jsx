import { DeleteOutlined, EditOutlined, HistoryOutlined, MoreOutlined, PushpinOutlined } from '@ant-design/icons'
import { Button, Card, Dropdown, Input, List, Modal, Pagination, Space, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteSession, fetchSessions, updateSession } from '../api/sessionApi'

const { Title, Text } = Typography

function SessionHistoryPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const offset = useMemo(() => (page - 1) * pageSize, [page, pageSize])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await fetchSessions({ limit: pageSize, offset })
      setSessions(data.list || [])
      setTotal(Number(data.total || 0))
    } catch (error) {
      message.error(error.message || '加载会话失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [page, pageSize])

  const onRename = async () => {
    if (!renaming) return
    const title = renameValue.trim()
    if (!title) {
      message.warning('请输入会话名称')
      return
    }
    try {
      await updateSession(renaming.id, { title })
      message.success('重命名成功')
      setRenaming(null)
      await loadData()
    } catch (error) {
      message.error(error.message || '重命名失败')
    }
  }

  const onPin = async (item) => {
    try {
      await updateSession(item.id, { pinned: !item.pinned })
      message.success(item.pinned ? '已取消置顶' : '已置顶')
      await loadData()
    } catch (error) {
      message.error(error.message || '置顶操作失败')
    }
  }

  const onDelete = async (item) => {
    try {
      await deleteSession(item.id)
      message.success('删除成功')
      await loadData()
    } catch (error) {
      message.error(error.message || '删除失败')
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space direction="vertical" size={2}>
            <Title level={3} style={{ margin: 0 }}>会话历史</Title>
            <Text type="secondary">默认展示所有历史会话，可重命名、置顶、分享、删除。</Text>
          </Space>
          <Button type="primary" icon={<EditOutlined />} onClick={() => navigate('/sessions/new')}>开启一个会话</Button>
        </Space>
      </Card>

      <Card className="app-elevated-card" title={<Space><HistoryOutlined />全部历史会话</Space>}>
        <List
          loading={loading}
          dataSource={sessions}
          renderItem={(item) => (
            <List.Item
              className="session-history-item"
              actions={[
                <Button key="open" type="link" onClick={() => navigate(`/sessions/${item.id}`)}>打开</Button>,
                <Dropdown
                  key="more"
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'rename', icon: <EditOutlined />, label: '重命名' },
                      { key: 'pin', icon: <PushpinOutlined />, label: item.pinned ? '取消置顶' : '置顶' },
                      { key: 'share', label: '分享' },
                      { key: 'delete', icon: <DeleteOutlined />, danger: true, label: '删除' },
                    ],
                    onClick: async ({ key }) => {
                      if (key === 'rename') {
                        setRenaming(item)
                        setRenameValue(item.title)
                        return
                      }
                      if (key === 'pin') {
                        await onPin(item)
                        return
                      }
                      if (key === 'share') {
                        await navigator.clipboard.writeText(`${window.location.origin}/sessions/${item.id}`)
                        message.success('会话链接已复制')
                        return
                      }
                      if (key === 'delete') {
                        await onDelete(item)
                      }
                    },
                  }}
                >
                  <Button icon={<MoreOutlined />} />
                </Dropdown>,
              ]}
            >
              <List.Item.Meta
                title={(
                  <Space>
                    <span>{item.title}</span>
                    {item.pinned ? <Tag color="gold">置顶</Tag> : null}
                  </Space>
                )}
                description={`最近更新：${item.updatedAt} | 消息数：${item.messageCount || 0}`}
              />
            </List.Item>
          )}
        />
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            onChange={(next, nextSize) => {
              setPage(next)
              setPageSize(nextSize)
            }}
          />
        </div>
      </Card>

      <Modal title="重命名会话" open={Boolean(renaming)} onOk={onRename} onCancel={() => setRenaming(null)}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={120} />
      </Modal>
    </Space>
  )
}

export default SessionHistoryPage
