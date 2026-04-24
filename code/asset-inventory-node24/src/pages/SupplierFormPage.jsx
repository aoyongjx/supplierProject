import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Space, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createSupplier, fetchSupplierDetail, updateSupplier } from '../api/supplierApi'

const { Title, Text } = Typography

function SupplierFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const editId = useMemo(() => {
    const parsed = Number(id)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [id])

  useEffect(() => {
    if (!editId) return
    setLoading(true)
    fetchSupplierDetail(editId)
      .then((detail) => {
        form.setFieldsValue({
          supplierId: String(detail.id || editId),
          companyName: detail.companyName || '',
          remark: detail.remark || '',
          nodeId: detail.nodeId ? String(detail.nodeId) : '',
          nodeName: detail.nodeName || '',
          detailUrl: detail.detailUrl || '',
          listPageUrl: detail.listPageUrl || '',
        })
      })
      .catch((error) => message.error(error.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [editId, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const payload = {
        companyName: values.companyName,
        remark: values.remark || '',
        nodeId: values.nodeId ? Number(values.nodeId) : null,
        nodeName: values.nodeName || '',
        detailUrl: values.detailUrl || '',
        listPageUrl: values.listPageUrl || '',
      }
      if (editId) {
        await updateSupplier(editId, payload)
        message.success('修改成功')
      } else {
        await createSupplier(payload)
        message.success('新增成功')
      }
      navigate('/suppliers')
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>{editId ? '修改供应商' : '新增供应商'}</Title>
            <Text className="muted">{editId ? `记录ID：${editId}` : '创建新供应商记录'}</Text>
          </Space>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/suppliers')}>返回列表</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSubmit}>保存</Button>
          </Space>
        </Space>

        <Form form={form} layout="vertical" style={{ maxWidth: 960 }}>
          <Form.Item name="supplierId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="nodeId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="companyName" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={5} placeholder="主营产品、配套/出口等信息统一放这里" />
          </Form.Item>
          <Form.Item name="nodeName" label="供应链节点名称">
            <Input style={{ width: 360 }} />
          </Form.Item>
          <Form.Item name="detailUrl" label="供应商详情链接">
            <Input />
          </Form.Item>
          <Form.Item name="listPageUrl" label="本页URL">
            <Input />
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}

export default SupplierFormPage
