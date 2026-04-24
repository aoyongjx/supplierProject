import { ArrowLeftOutlined, AuditOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Col, DatePicker, Form, Input, Row, Select, Space, Spin, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchInventoryById, submitInventory, updateInventory } from '../api/inventoryApi'

const { Title, Text } = Typography

function InventoryFormPage() {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [originFormData, setOriginFormData] = useState({ checkDate: dayjs(), status: '正常' })
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditMode = useMemo(() => Boolean(id), [id])

  useEffect(() => {
    if (!isEditMode) {
      const defaults = { checkDate: dayjs(), status: '正常' }
      setOriginFormData(defaults)
      form.setFieldsValue(defaults)
      return
    }

    const loadDetail = async () => {
      try {
        setLoading(true)
        const detail = await fetchInventoryById(id)
        const formData = {
          ...detail,
          checkDate: detail?.checkDate ? dayjs(detail.checkDate) : dayjs(),
          status: detail?.status || '正常',
        }
        setOriginFormData(formData)
        form.setFieldsValue(formData)
      } catch (error) {
        message.error(error.message || '加载资产详情失败')
        navigate('/inventories', { replace: true })
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [form, id, isEditMode, navigate])

  const handleSubmit = async (values) => {
    try {
      setSubmitting(true)
      const payload = {
        ...values,
        checkDate: values.checkDate.format('YYYY-MM-DD'),
      }
      if (isEditMode) {
        await updateInventory(id, payload)
        message.success('资产记录修改成功')
      } else {
        await submitInventory(payload)
        message.success('资产盘点提交成功')
        form.resetFields()
        form.setFieldValue('checkDate', dayjs())
        form.setFieldValue('status', '正常')
      }
      navigate('/inventories')
    } catch (error) {
      message.error(error.message || '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="app-elevated-card">
      <Space className="page-titlebar">
        <Space>
          <span className="title-icon">
            <AuditOutlined />
          </span>
          <Title level={3} style={{ margin: 0 }}>
            {isEditMode ? '资产盘点修改' : '资产盘点填报'}
          </Title>
        </Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/inventories')}>
          返回列表
        </Button>
      </Space>
      <Space orientation="vertical" size={4} style={{ marginBottom: 18 }}>
        <Text type="secondary">
          {isEditMode ? '请修改资产信息并保存，保存后将返回盘点列表。' : '请准确填写资产信息，提交后将进入盘点列表。'}
        </Text>
      </Space>

      {loading ? (
        <div style={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
          <Spin />
        </div>
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ checkDate: dayjs(), status: '正常' }}
          onFinish={handleSubmit}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="资产编码" name="assetCode" rules={[{ required: true, message: '请输入资产编码' }]}>
                <Input placeholder="例如：LTP-2026-0001" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="资产名称" name="assetName" rules={[{ required: true, message: '请输入资产名称' }]}>
                <Input placeholder="例如：ThinkPad T14" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="所属部门" name="department" rules={[{ required: true, message: '请选择所属部门' }]}>
                <Select
                  options={[
                    { value: '研发中心', label: '研发中心' },
                    { value: '财务部', label: '财务部' },
                    { value: '市场部', label: '市场部' },
                    { value: '人事行政部', label: '人事行政部' },
                  ]}
                  placeholder="请选择所属部门"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="责任人" name="owner" rules={[{ required: true, message: '请输入责任人' }]}>
                <Input placeholder="请输入责任人姓名" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="资产位置" name="location" rules={[{ required: true, message: '请输入资产位置' }]}>
                <Input placeholder="例如：上海总部 5F A-15" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="盘点日期" name="checkDate" rules={[{ required: true, message: '请选择盘点日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="盘点状态" name="status" rules={[{ required: true, message: '请选择盘点状态' }]}>
                <Select
                  options={[
                    { value: '正常', label: '正常' },
                    { value: '闲置', label: '闲置' },
                    { value: '损坏', label: '损坏' },
                    { value: '遗失', label: '遗失' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="备注" name="remark">
                <Input.TextArea rows={4} placeholder="补充说明，如设备状态、维修情况等" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={submitting}>
                {isEditMode ? '保存修改' : '提交盘点'}
              </Button>
              <Button
                htmlType="button"
                icon={<ReloadOutlined />}
                onClick={() => {
                  form.setFieldsValue(originFormData)
                }}
              >
                重置内容
              </Button>
            </Space>
          </Form.Item>
        </Form>
      )}
    </Card>
  )
}

export default InventoryFormPage
