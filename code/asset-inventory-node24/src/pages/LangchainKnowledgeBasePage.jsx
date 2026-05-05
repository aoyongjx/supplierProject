import { Button, Card, Form, Input, Modal, Space, Table, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import { createKnowledgeBase, fetchKnowledgeBases } from '../api/knowledgeBaseApi'

export default function LangchainKnowledgeBasePage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const data = await fetchKnowledgeBases()
      setRows(Array.isArray(data) ? data : [])
    } catch (error) {
      message.error(error.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onCreate() {
    try {
      const values = await form.validateFields()
      await createKnowledgeBase({
        name: values.name,
        description: values.description || '',
      })
      message.success('知识库已创建')
      setOpen(false)
      form.resetFields()
      await load()
    } catch (error) {
      if (error?.errorFields) return
      message.error(error.message || '创建失败')
    }
  }

  return (
    <Card className="app-elevated-card" title="知识库管理（壳层版）" extra={<Button type="primary" onClick={() => setOpen(true)}>新建知识库</Button>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Table
          loading={loading}
          rowKey="id"
          dataSource={rows}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '状态', dataIndex: 'status', width: 120, render: (v) => <Tag color={v === 'ready' ? 'green' : 'orange'}>{v}</Tag> },
            { title: '文档数', dataIndex: 'documentsCount', width: 120 },
            { title: '更新时间', dataIndex: 'updatedAt', width: 180 },
            { title: '描述', dataIndex: 'description' },
          ]}
        />
      </Space>

      <Modal title="新建知识库" open={open} onCancel={() => setOpen(false)} onOk={onCreate} okText="创建" cancelText="取消">
        <Form layout="vertical" form={form}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
