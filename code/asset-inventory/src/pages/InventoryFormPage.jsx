import { Button, Card, DatePicker, Form, Input, Select, Space, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { createInventory } from '../api/inventoryApi'

const { Title } = Typography

function InventoryFormPage() {
  const [form] = Form.useForm()

  const handleSubmit = async (values) => {
    try {
      await createInventory({
        ...values,
        checkDate: values.checkDate.format('YYYY-MM-DD'),
      })
      message.success(`提交成功：${values.assetName}`)
      form.resetFields()
    } catch (error) {
      message.error(error.message || '提交失败')
    }
  }

  return (
    <Card>
      <Title level={3}>资产盘点填报</Title>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ checkDate: dayjs(), status: '正常' }}
        onFinish={handleSubmit}
      >
        <Form.Item
          label="资产编码"
          name="assetCode"
          rules={[{ required: true, message: '请输入资产编码' }]}
        >
          <Input placeholder="例如：LTP-2026-0001" />
        </Form.Item>
        <Form.Item
          label="资产名称"
          name="assetName"
          rules={[{ required: true, message: '请输入资产名称' }]}
        >
          <Input placeholder="例如：ThinkPad T14" />
        </Form.Item>
        <Form.Item
          label="所属部门"
          name="department"
          rules={[{ required: true, message: '请选择所属部门' }]}
        >
          <Select
            placeholder="请选择"
            options={[
              { value: '研发中心', label: '研发中心' },
              { value: '财务部', label: '财务部' },
              { value: '市场部', label: '市场部' },
              { value: '人事行政部', label: '人事行政部' },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="责任人"
          name="owner"
          rules={[{ required: true, message: '请输入责任人姓名' }]}
        >
          <Input placeholder="请输入责任人姓名" />
        </Form.Item>
        <Form.Item label="盘点日期" name="checkDate" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="盘点状态" name="status" rules={[{ required: true, message: '请选择状态' }]}>
          <Select
            options={[
              { value: '正常', label: '正常' },
              { value: '闲置', label: '闲置' },
              { value: '损坏', label: '损坏' },
              { value: '遗失', label: '遗失' },
            ]}
          />
        </Form.Item>
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={4} placeholder="可填写位置、设备编号补充信息等" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Space>
            <Button type="primary" htmlType="submit">
              提交盘点
            </Button>
            <Button htmlType="button" onClick={() => form.resetFields()}>
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default InventoryFormPage
