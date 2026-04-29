import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Col, Form, Input, Modal, Popconfirm, Progress, Row, Space, Switch, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fetchInstalledSkills, installSkill, uninstallSkill } from '../api/skillManagementApi'

const { Paragraph, Text, Title } = Typography

const STORAGE_KEY = 'capability-skill-management-data-v1'

const defaultSkills = [
  { name: 'agent-security-boundary', source: 'C:\\Users\\aoyon\\.codex\\skills\\agent-security-boundary', installPath: 'C:\\Users\\aoyon\\.codex\\skills\\agent-security-boundary', description: '外部输入与网络访问的安全边界控制。', enabled: true },
  { name: 'banana-cli', source: 'C:\\Users\\aoyon\\.codex\\skills\\banana-cli', description: '用于创建、管理和导出演示文稿的 CLI 技能。', enabled: true },
  { name: 'codex-auto-memory-runtime', source: 'C:\\Users\\aoyon\\.codex\\skills\\codex-auto-memory-runtime', description: '提供自动回忆与自动沉淀的会话记忆机制。', enabled: true },
  { name: 'ecc-agent-introspection-debugging', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-agent-introspection-debugging', description: '用于代理循环、卡住、偏航时的自省调试流程。', enabled: true },
  { name: 'ecc-api-design', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-api-design', description: 'REST API 设计规范与一致性约束。', enabled: true },
  { name: 'ecc-backend-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-backend-patterns', description: '后端架构与服务实现模式。', enabled: true },
  { name: 'ecc-coding-standards', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-coding-standards', description: '跨项目通用编码规范。', enabled: true },
  { name: 'ecc-cpp-coding-standards', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-cpp-coding-standards', description: '现代 C++ 编码规范与安全约束。', enabled: true },
  { name: 'ecc-cpp-testing', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-cpp-testing', description: 'C++ 测试策略（GoogleTest/CTest）。', enabled: true },
  { name: 'ecc-database-migrations', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-database-migrations', description: '数据库迁移、回滚与零停机变更实践。', enabled: true },
  { name: 'ecc-deep-research', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-deep-research', description: '多源深度检索与引用式研究报告。', enabled: true },
  { name: 'ecc-deployment-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-deployment-patterns', description: '部署流程与 CI/CD 规范。', enabled: true },
  { name: 'ecc-docker-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-docker-patterns', description: 'Docker / Compose 设计与运行实践。', enabled: true },
  { name: 'ecc-documentation-lookup', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-documentation-lookup', description: '优先从文档源查询框架与库 API。', enabled: true },
  { name: 'ecc-e2e-testing', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-e2e-testing', description: '端到端测试策略与防抖实践。', enabled: true },
  { name: 'ecc-eval-harness', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-eval-harness', description: '评测驱动开发（EDD）执行框架。', enabled: true },
  { name: 'ecc-git-workflow', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-git-workflow', description: '分支策略、提交规范与协作流程。', enabled: true },
  { name: 'ecc-golang-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-golang-patterns', description: 'Go 语言工程化模式与惯用法。', enabled: true },
  { name: 'ecc-golang-testing', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-golang-testing', description: 'Go 测试实践（表驱动、benchmark、fuzz）。', enabled: true },
  { name: 'ecc-iterative-retrieval', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-iterative-retrieval', description: '多轮迭代检索与上下文收敛策略。', enabled: true },
  { name: 'ecc-java-coding-standards', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-java-coding-standards', description: 'Java/Spring 项目编码规范。', enabled: true },
  { name: 'ecc-jpa-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-jpa-patterns', description: 'JPA/Hibernate 建模与性能优化模式。', enabled: true },
  { name: 'ecc-karpathy-fusion', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-karpathy-fusion', description: 'Karpathy 约束与 ECC 流程融合层。', enabled: true },
  { name: 'ecc-mcp-server-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-mcp-server-patterns', description: 'MCP Server 设计与实现模式。', enabled: true },
  { name: 'ecc-python-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-python-patterns', description: 'Python 工程化编码模式。', enabled: true },
  { name: 'ecc-python-testing', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-python-testing', description: 'pytest/TDD 测试体系与覆盖率实践。', enabled: true },
  { name: 'ecc-repo-scan', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-repo-scan', description: '仓库资产扫描与模块风险分级。', enabled: true },
  { name: 'ecc-rust-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-rust-patterns', description: 'Rust 语言模式与安全性能实践。', enabled: true },
  { name: 'ecc-rust-testing', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-rust-testing', description: 'Rust 测试体系与质量策略。', enabled: true },
  { name: 'ecc-safety-guard', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-safety-guard', description: '高风险操作前的安全防护规则。', enabled: true },
  { name: 'ecc-search-first', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-search-first', description: '编码前先检索的流程化技能。', enabled: true },
  { name: 'ecc-security-review', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-security-review', description: '安全审查清单与漏洞识别实践。', enabled: true },
  { name: 'ecc-security-scan', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-security-scan', description: '配置与依赖安全扫描技能。', enabled: true },
  { name: 'ecc-springboot-patterns', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-springboot-patterns', description: 'Spring Boot 服务分层与接口模式。', enabled: true },
  { name: 'ecc-springboot-security', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-springboot-security', description: 'Spring Security 与接口安全实践。', enabled: true },
  { name: 'ecc-springboot-tdd', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-springboot-tdd', description: 'Spring Boot 场景的 TDD 实战。', enabled: true },
  { name: 'ecc-springboot-verification', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-springboot-verification', description: '发布前验证闭环（build/lint/test/security）。', enabled: true },
  { name: 'ecc-strategic-compact', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-strategic-compact', description: '策略化上下文压缩建议。', enabled: true },
  { name: 'ecc-tdd-workflow', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-tdd-workflow', description: 'TDD 全流程执行模板。', enabled: true },
  { name: 'ecc-verification-loop', source: 'C:\\Users\\aoyon\\.codex\\skills\\ecc-verification-loop', description: '完整验证闭环技能。', enabled: true },
  { name: 'frontend-design', source: 'C:\\Users\\aoyon\\.codex\\skills\\frontend-design', description: '高质量前端设计与实现技能。', enabled: true },
  { name: 'frontend-slides', source: 'C:\\Users\\aoyon\\.codex\\skills\\frontend-slides', description: 'HTML 动画演示文稿生成技能。', enabled: true },
  { name: 'karpathy-guidelines', source: 'C:\\Users\\aoyon\\.codex\\skills\\karpathy-guidelines', description: '减少 LLM 编码失误的行为准则。', enabled: true },
  { name: 'openclaw-grok-search', source: 'C:\\Users\\aoyon\\.codex\\skills\\openclaw-grok-search', description: '实时联网检索并返回结构化结果。', enabled: true },
  { name: 'playwright-script', source: 'E:\\workspaceCodeing\\.agents\\skills\\playwright-script', description: '浏览器驱动页面抓取与 JSON 输出。', enabled: true },
  { name: 'postgresql-table-design', source: 'C:\\Users\\aoyon\\.codex\\skills\\postgresql-table-design', description: 'PostgreSQL 表设计与约束索引实践。', enabled: true },
  { name: 'pptx', source: 'C:\\Users\\aoyon\\.codex\\skills\\pptx', description: 'PPT 场景通用处理技能。', enabled: true },
  { name: 'pptx-generator', source: 'C:\\Users\\aoyon\\.codex\\skills\\pptx-generator', description: 'PPT 生成、编辑与解析技能。', enabled: true },
  { name: 'search-first', source: 'C:\\Users\\aoyon\\.codex\\skills\\search-first', description: '研发前检索优先策略。', enabled: true },
  { name: 'ui-ux-pro-max', source: 'C:\\Users\\aoyon\\.codex\\skills\\ui-ux-pro-max', description: 'UI/UX 设计知识库与实现指南。', enabled: true },
  { name: 'verification-loop-lite', source: 'C:\\Users\\aoyon\\.codex\\skills\\verification-loop-lite', description: '轻量质量闸门验证流程。', enabled: true },
  { name: 'web-access', source: 'C:\\Users\\aoyon\\.codex\\skills\\web-access', description: '统一处理联网检索与页面交互。', enabled: true },
  { name: 'web-design-guidelines', source: 'C:\\Users\\aoyon\\.codex\\skills\\web-design-guidelines', description: 'Web 界面规范审查技能。', enabled: true },
]

function readSkills() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw) || raw.length === 0) return defaultSkills
    return raw
      .map((item) => ({
        name: String(item?.name || '').trim(),
        source: String(item?.source || '').trim(),
        installPath: String(item?.installPath || item?.source || '').trim(),
        description: String(item?.description || '').trim(),
        enabled: item?.enabled !== false,
      }))
      .filter((item) => item.name)
  } catch {
    return defaultSkills
  }
}

export default function SkillManagementPage() {
  const [skills, setSkills] = useState(readSkills)
  const [open, setOpen] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installLog, setInstallLog] = useState('')
  const [form] = Form.useForm()

  const stat = useMemo(() => {
    const enabledCount = skills.filter((item) => item.enabled).length
    return { total: skills.length, enabledCount, disabledCount: skills.length - enabledCount }
  }, [skills])

  const persist = (next) => {
    setSkills(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  useEffect(() => {
    fetchInstalledSkills()
      .then((items) => {
        const next = items.map((item) => {
          const existed = skills.find((s) => s.name === item.name)
          return {
            name: item.name,
            source: item.source,
            installPath: item.installPath || item.source,
            description: existed?.description || item.description || '技能说明',
            enabled: existed ? existed.enabled !== false : true,
          }
        })
        persist(next)
      })
      .catch((error) => {
        message.error(error.message || '读取技能列表失败')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onAdd = () => {
    setEditingName('')
    setInstalling(false)
    setInstallProgress(0)
    setInstallLog('')
    form.setFieldsValue({ name: '', source: '', installPath: 'C:\\Users\\aoyon\\.codex\\skills', description: '', enabled: true })
    setOpen(true)
  }

  const onEdit = (item) => {
    setEditingName(item.name)
    setInstalling(false)
    setInstallProgress(0)
    setInstallLog('')
    form.setFieldsValue(item)
    setOpen(true)
  }

  const onDelete = async (item) => {
    await uninstallSkill({ name: item.name, source: item.source })
    persist(skills.filter((row) => row.name !== item.name))
    message.success('已卸载')
  }

  const onToggle = (name, enabled) => {
    persist(skills.map((item) => (item.name === name ? { ...item, enabled } : item)))
  }

  const onSave = async () => {
    try {
      const values = await form.validateFields()
      const nextItem = {
        name: String(values.name || '').trim(),
        source: String(values.source || '').trim(),
        installPath: String(values.installPath || '').trim(),
        description: String(values.description || '').trim(),
        enabled: values.enabled !== false,
      }
      if (!nextItem.name) return
      if (!editingName && skills.some((item) => item.name === nextItem.name)) {
        message.error('名称已存在，请使用不同技能名称')
        return
      }
      let next
      if (editingName) {
        next = skills.map((item) => (item.name === editingName ? nextItem : item))
      } else {
        setInstalling(true)
        setInstallProgress(10)
        setInstallLog('正在校验安装参数...')
        await new Promise((resolve) => setTimeout(resolve, 220))
        setInstallProgress(30)
        setInstallLog('正在请求安装服务...')
        const installed = await installSkill({
          name: nextItem.name,
          installPath: nextItem.installPath,
          source: nextItem.source,
          description: nextItem.description,
        })
        setInstallProgress(70)
        setInstallLog('正在写入技能文件并确认安装路径...')
        await new Promise((resolve) => setTimeout(resolve, 180))
        setInstallProgress(90)
        setInstallLog('正在刷新技能列表...')
        next = [{ ...nextItem, source: installed?.source || nextItem.source, installPath: installed?.installPath || nextItem.installPath }, ...skills]
        setInstallProgress(100)
        setInstallLog('安装完成')
      }
      persist(next)
      if (!editingName) {
        await new Promise((resolve) => setTimeout(resolve, 220))
      }
      setOpen(false)
      setInstalling(false)
      setInstallProgress(0)
      setInstallLog('')
      message.success(editingName ? '已更新' : '已安装')
    } catch (error) {
      if (installing) {
        setInstallLog(`安装失败：${error.message || '未知错误'}`)
        setInstallProgress(100)
      }
      if (!error?.errorFields) {
        message.error(error.message || '操作失败')
      }
      setInstalling(false)
    }
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card className="hero-card">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Title level={4} style={{ margin: 0 }}>已安装技能</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>新增技能</Button>
          </Space>
          <Space size={8} wrap>
            <Tag color="blue">总数 {stat.total}</Tag>
            <Tag color="green">启用 {stat.enabledCount}</Tag>
            <Tag color="default">禁用 {stat.disabledCount}</Tag>
          </Space>
          <Text className="muted">字段：名称、来源、说明、安装路径；支持编辑、卸载、启用/禁用。</Text>
        </Space>
      </Card>

      <Row gutter={[12, 12]}>
        {skills.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.name}>
            <Card className="app-elevated-card capability-card" bodyStyle={{ padding: 16 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div className="capability-head">
                  <Title level={5} style={{ margin: 0 }}>{item.name}</Title>
                  <Switch checked={item.enabled} onChange={(value) => onToggle(item.name, value)} checkedChildren="启用" unCheckedChildren="禁用" />
                </div>
                <Paragraph className="muted capability-desc" style={{ margin: 0 }}>{item.description || '无说明'}</Paragraph>
                <Text code style={{ whiteSpace: 'pre-wrap' }}>安装路径：{item.installPath || item.source || '-'}</Text>
                <Space size={8}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(item)}>修改</Button>
                  <Popconfirm title="确认卸载该技能吗？将真实删除目录。" onConfirm={() => onDelete(item)} okText="卸载" cancelText="取消">
                    <Button size="small" danger icon={<DeleteOutlined />}>卸载</Button>
                  </Popconfirm>
                </Space>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        title={editingName ? '修改技能' : '新增技能'}
        open={open}
        onOk={onSave}
        onCancel={() => {
          if (installing) return
          setOpen(false)
        }}
        confirmLoading={installing}
        okButtonProps={{ disabled: installing }}
        cancelButtonProps={{ disabled: installing }}
        okText={editingName ? '保存' : '安装'}
        cancelText="取消"
      >
        {!editingName && (installing || installProgress > 0) ? (
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 12 }}>
            <Progress percent={installProgress} size="small" status={installProgress >= 100 ? 'success' : 'active'} />
            <Text className="muted">{installLog || '准备安装...'}</Text>
          </Space>
        ) : null}
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入技能名称' }]}>
            <Input placeholder="例如：my-skill" />
          </Form.Item>
          <Form.Item label="来源" name="source" rules={[{ required: true, message: '请输入来源路径' }]}>
            <Input placeholder="例如：C:\\Users\\aoyon\\.codex\\skills\\my-skill" />
          </Form.Item>
          <Form.Item label="安装路径" name="installPath" rules={[{ required: true, message: '请输入安装路径' }]}>
            <Input placeholder="例如：C:\\Users\\aoyon\\.codex\\skills" />
          </Form.Item>
          <Form.Item label="说明" name="description" rules={[{ required: true, message: '请输入技能说明' }]}>
            <Input.TextArea rows={3} placeholder="描述该 skill 的用途与边界" />
          </Form.Item>
          <Form.Item label="状态" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
