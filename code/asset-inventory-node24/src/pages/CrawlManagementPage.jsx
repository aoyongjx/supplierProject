import {
  AlertOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons'
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import {
  createCrawlTask,
  fetchCrawlTaskDetail,
  fetchCrawlTaskLogs,
  fetchCrawlTaskQuality,
  fetchCrawlTasks,
  retryCrawlTask,
  startCrawlTask,
  stopCrawlTask,
} from '../api/crawlApi'

const { Title, Text } = Typography

function CrawlManagementPage() {
  const [createForm] = Form.useForm()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [currentTask, setCurrentTask] = useState(null)
  const [logs, setLogs] = useState([])
  const [quality, setQuality] = useState(null)
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)

  const loadTasks = async () => {
    try {
      setLoading(true)
      const list = await fetchCrawlTasks({
        keyword,
        status: statusFilter,
      })
      setTasks(list.map((item) => ({ ...item, key: item.id })))
    } catch (error) {
      message.error(error.message || '加载任务失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [keyword, statusFilter])

  useEffect(() => {
    const total = tasks.length
    const maxPage = Math.max(1, Math.ceil(total / tablePageSize))
    if (tablePage > maxPage) setTablePage(maxPage)
  }, [tasks.length, tablePage, tablePageSize])

  const loadTaskDrawer = async (taskId) => {
    try {
      const [detail, logList, qualityReport] = await Promise.all([
        fetchCrawlTaskDetail(taskId),
        fetchCrawlTaskLogs(taskId),
        fetchCrawlTaskQuality(taskId),
      ])
      setCurrentTask(detail)
      setLogs(logList)
      setQuality(qualityReport)
      setDrawerOpen(true)
    } catch (error) {
      message.error(error.message || '加载任务详情失败')
    }
  }

  const handleCreate = async (values) => {
    try {
      setSubmitting(true)
      await createCrawlTask({
        taskName: values.taskName,
        nlCommand: values.nlCommand,
        sourceUrls: values.sourceUrls
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((url) => ({ name: '自定义来源', url })),
        mode: values.mode,
        frequency: values.frequency,
        requestIntervalMs: Number(values.requestIntervalMs),
      })
      message.success('采集任务已创建')
      createForm.resetFields()
      await loadTasks()
    } catch (error) {
      message.error(error.message || '创建任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  const runAction = async (action, taskId, successMessage) => {
    try {
      await action(taskId)
      message.success(successMessage)
      await loadTasks()
      if (drawerOpen && currentTask?.id === taskId) {
        await loadTaskDrawer(taskId)
      }
    } catch (error) {
      message.error(error.message || '操作失败')
    }
  }

  const summary = useMemo(() => {
    const total = tasks.length
    const success = tasks.filter((item) => item.status === 'success').length
    const running = tasks.filter((item) => item.status === 'running').length
    const failed = tasks.filter((item) => item.status === 'failed').length
    return { total, success, running, failed }
  }, [tasks])

  const columns = [
    { title: '任务ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '任务名称', dataIndex: 'taskName', key: 'taskName', ellipsis: true },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      render: (mode) => <Tag>{mode === 'full' ? '全量' : '增量'}</Tag>,
      width: 90,
    },
    {
      title: '频率',
      dataIndex: 'frequency',
      key: 'frequency',
      render: (f) => (f === 'week' ? '每周' : '每日'),
      width: 90,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status) => {
        const colorMap = {
          pending: 'default',
          running: 'processing',
          success: 'success',
          failed: 'error',
          stopped: 'warning',
        }
        return <Tag color={colorMap[status] || 'default'}>{status}</Tag>
      },
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      width: 100,
      render: (v) => `${Number(v || 0).toFixed(2)}%`,
    },
    {
      title: '脏数据率',
      dataIndex: 'dirtyRate',
      key: 'dirtyRate',
      width: 110,
      render: (v) => `${Number(v || 0).toFixed(2)}%`,
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_, record) => (
        <Space size={4} wrap>
          <Button size="small" icon={<PlayCircleOutlined />} onClick={() => runAction(startCrawlTask, record.id, '任务已启动')}>
            启动
          </Button>
          <Button size="small" icon={<StopOutlined />} onClick={() => runAction(stopCrawlTask, record.id, '任务已停止')}>
            停止
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => runAction(retryCrawlTask, record.id, '任务已重跑')}>
            重跑
          </Button>
          <Button size="small" icon={<AlertOutlined />} onClick={() => loadTaskDrawer(record.id)}>
            日志/报告
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card className="app-elevated-card">
        <Space orientation="vertical" size={2}>
          <Title level={3} style={{ margin: 0 }}>
            自动化网络数据采集与爬取管理
          </Title>
          <Text type="secondary">支持自然语言指令、任务调度、异常告警、质量报告与重跑管理。</Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="任务总数" value={summary.total} prefix={<RobotOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="运行中" value={summary.running} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="执行成功" value={summary.success} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="执行失败" value={summary.failed} />
          </Card>
        </Col>
      </Row>

      <Card className="app-elevated-card" title="创建采集任务">
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ mode: 'incremental', frequency: 'day', requestIntervalMs: 1200 }}
          onFinish={handleCreate}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="任务名称" name="taskName" rules={[{ required: true, message: '请输入任务名称' }]}>
                <Input placeholder="例如：新能源供应链日报采集" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="自然语言爬取指令" name="nlCommand">
                <Input placeholder="例如：每天增量采集新能源供应链相关新闻和招投标信息" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="采集模式" name="mode" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: '增量', value: 'incremental' },
                    { label: '全量', value: 'full' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="更新频率" name="frequency" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: '每日', value: 'day' },
                    { label: '每周', value: 'week' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="请求间隔(ms)" name="requestIntervalMs" rules={[{ required: true }]}>
                <Input type="number" min={500} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="数据源地址（每行一个）" name="sourceUrls">
                <Input.TextArea rows={4} placeholder={'https://example-a.com\nhttps://example-b.com'} />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              创建任务
            </Button>
            <Button htmlType="button" onClick={() => createForm.resetFields()}>
              重置
            </Button>
          </Space>
        </Form>
      </Card>

      <Card className="app-elevated-card" title="任务列表">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按任务名称搜索"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 180 }}
            value={statusFilter || undefined}
            onChange={(value) => setStatusFilter(value || '')}
            options={[
              { label: '待执行', value: 'pending' },
              { label: '运行中', value: 'running' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },
              { label: '已停止', value: 'stopped' },
            ]}
          />
        </Space>

        <Table
          className="app-data-table"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          pagination={{
            current: tablePage,
            pageSize: tablePageSize,
            total: tasks.length,
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
        title={currentTask ? `任务详情 #${currentTask.id}` : '任务详情'}
        open={drawerOpen}
        width={680}
        onClose={() => setDrawerOpen(false)}
      >
        {currentTask ? (
          <Space orientation="vertical" style={{ width: '100%' }} size={16}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="任务名称">{currentTask.taskName}</Descriptions.Item>
              <Descriptions.Item label="状态">{currentTask.status}</Descriptions.Item>
              <Descriptions.Item label="模式">{currentTask.mode}</Descriptions.Item>
              <Descriptions.Item label="频率">{currentTask.frequency}</Descriptions.Item>
              <Descriptions.Item label="解析状态">{currentTask.parseStatus}</Descriptions.Item>
              <Descriptions.Item label="解析置信度">{currentTask.parseConfidence}</Descriptions.Item>
              <Descriptions.Item label="合规校验">{currentTask.compliancePassed ? '通过' : '未通过'}</Descriptions.Item>
              <Descriptions.Item label="采集总量">{currentTask.recordsCollected}</Descriptions.Item>
            </Descriptions>

            <Card size="small" title="质量报告">
              {quality ? (
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="总记录">{quality.totalCount}</Descriptions.Item>
                  <Descriptions.Item label="脏数据">{quality.dirtyCount}</Descriptions.Item>
                  <Descriptions.Item label="重复记录">{quality.duplicateCount}</Descriptions.Item>
                  <Descriptions.Item label="缺失必填">{quality.requiredMissingCount}</Descriptions.Item>
                  <Descriptions.Item label="质量校验">{quality.qualityPassed ? '通过' : '不通过'}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Text type="secondary">暂无数据</Text>
              )}
            </Card>

            <Card size="small" title="执行日志">
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                columns={[
                  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
                  { title: '级别', dataIndex: 'level', key: 'level', width: 80 },
                  { title: '尝试', dataIndex: 'attempt', key: 'attempt', width: 70 },
                  { title: '日志内容', dataIndex: 'message', key: 'message' },
                ]}
                dataSource={logs}
              />
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  )
}

export default CrawlManagementPage
