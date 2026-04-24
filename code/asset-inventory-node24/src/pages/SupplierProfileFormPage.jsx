import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Select, Space, Table, Tabs, TreeSelect, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createSupplierProfile,
  fetchSupplierProfileDetail,
  fetchSupplierProfileOptions,
  updateSupplierProfile,
} from '../api/supplierProfileApi'

const { Title, Text } = Typography

function buildSupplierTabUrl(urlText, route) {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const mid = String(parsed.searchParams.get('mid') || '').trim()
    if (!mid || !/company\.php$/i.test(parsed.pathname || '')) return ''
    parsed.pathname = `/${route}`
    parsed.search = ''
    parsed.searchParams.set('mid', mid)
    if (route === 'company_news.php') parsed.searchParams.set('catid', '4')
    return parsed.toString()
  } catch {
    return ''
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeEmptyContact() {
  return {
    id: makeId('c'),
    contactPerson: '',
    contactTitle: '',
    phone: '',
    mobile: '',
    email: '',
  }
}

function makeEmptyProduct() {
  return {
    id: makeId('p'),
    name: '',
    model: '',
    application: '',
    material: '',
    advantages: '',
    appearance: '',
    precision: '',
    scenarios: '',
    imageUrl: '',
    parameters: '',
  }
}

function makeEmptyNews() {
  return {
    id: makeId('n'),
    title: '',
    source: '',
    publishDate: '',
    content: '',
  }
}

function SupplierProfileFormPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState([])
  const [contacts, setContacts] = useState([])
  const [newsItems, setNewsItems] = useState([])
  const [oemOptions, setOemOptions] = useState([])
  const [countryOptions, setCountryOptions] = useState([])
  const [certificationOptions, setCertificationOptions] = useState([])
  const [sourceOptions, setSourceOptions] = useState([])
  const [supplyChainTree, setSupplyChainTree] = useState([])

  const editId = useMemo(() => {
    const parsed = Number(id)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [id])
  const isViewMode = Boolean(editId) && !location.pathname.endsWith('/edit')
  const pageTitle = isViewMode ? '查看供应商档案' : (editId ? '修改供应商档案' : '新增供应商档案')
  const websiteValue = Form.useWatch('website', form)
  const introSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_intro.php'), [websiteValue])
  const productSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_goods.php'), [websiteValue])
  const fitSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_goods_parts.php'), [websiteValue])
  const exportSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_goods_export.php'), [websiteValue])
  const certSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_list.php'), [websiteValue])
  const newsSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_news.php'), [websiteValue])
  const contactSourceUrl = useMemo(() => buildSupplierTabUrl(websiteValue, 'company_contact.php'), [websiteValue])

  const renderSourceLink = (url) => (url ? (
    <Text type="secondary">
      来源链接：
      <a href={url} target="_blank" rel="noreferrer">{url}</a>
    </Text>
  ) : null)

  useEffect(() => {
    fetchSupplierProfileOptions()
      .then((data) => {
        setOemOptions(Array.isArray(data?.oemOptions) ? data.oemOptions : [])
        setCountryOptions(Array.isArray(data?.countryOptions) ? data.countryOptions : [])
        setCertificationOptions(Array.isArray(data?.certificationOptions) ? data.certificationOptions : [])
        setSourceOptions(Array.isArray(data?.sourceOptions) ? data.sourceOptions : [])
        setSupplyChainTree(Array.isArray(data?.supplyChainTree) ? data.supplyChainTree : [])
      })
      .catch(() => {
        setOemOptions([])
        setCountryOptions([])
        setCertificationOptions([])
        setSourceOptions([])
        setSupplyChainTree([])
      })
  }, [])

  const nodeNameById = useMemo(() => {
    const map = new Map()
    const walk = (nodes = []) => {
      for (const node of nodes) {
        const value = Number(node?.value || node?.id)
        if (Number.isInteger(value) && value > 0) {
          map.set(value, String(node?.title || '').trim())
        }
        if (Array.isArray(node?.children) && node.children.length > 0) {
          walk(node.children)
        }
      }
    }
    walk(supplyChainTree)
    return map
  }, [supplyChainTree])

  useEffect(() => {
    if (!editId) {
      setContacts([makeEmptyContact()])
      setProducts([])
      setNewsItems([])
      form.setFieldsValue({
        sourceSupplierId: undefined,
        relatedNodeIds: [],
        fitOems: [],
        exportSituation: '',
        certificates: '',
        exportCountries: [],
        certificateItems: [],
      })
      return
    }
    setLoading(true)
    fetchSupplierProfileDetail(editId)
      .then((detail) => {
        form.setFieldsValue({
          sourceSupplierId: undefined,
          relatedNodeIds: Array.isArray(detail.relatedNodeIds)
            ? detail.relatedNodeIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
            : [],
          companyName: detail.companyName || '',
          companyNameEn: detail.companyNameEn || '',
          legalRepresentative: detail.legalRepresentative || '',
          orgCode: detail.orgCode || '',
          registeredCapital: detail.registeredCapital || '',
          establishedDate: detail.establishedDate || '',
          employeesCount: detail.employeesCount || '',
          companyType: detail.companyType || '',
          website: detail.website || '',
          postalCode: detail.postalCode || '',
          address: detail.address || '',
          companyIntro: detail.companyIntro || '',
          fitSituation: detail.fitSituation || '',
          exportSituation: detail.exportSituation || '',
          certificates: detail.certificates || '',
          fitOems: Array.isArray(detail.fitOems) ? detail.fitOems : [],
          exportCountries: Array.isArray(detail.exportCountries) ? detail.exportCountries : [],
          certificateItems: Array.isArray(detail.certificateItems) ? detail.certificateItems : [],
        })
        const nextContacts = Array.isArray(detail.contacts) && detail.contacts.length > 0
          ? detail.contacts
          : (
            detail.contactPerson || detail.contactTitle || detail.phone || detail.mobile || detail.email
              ? [{
                id: makeId('c'),
                contactPerson: detail.contactPerson || '',
                contactTitle: detail.contactTitle || '',
                phone: detail.phone || '',
                mobile: detail.mobile || '',
                email: detail.email || '',
              }]
              : [makeEmptyContact()]
          )
        setContacts(nextContacts)
        setProducts(Array.isArray(detail.products) ? detail.products : [])
        setNewsItems(Array.isArray(detail.newsItems) ? detail.newsItems : [])
      })
      .catch((error) => message.error(error.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [editId, form])

  const updateListField = (setState, rowId, key, value) => {
    setState((prev) => prev.map((item) => (item.id === rowId ? { ...item, [key]: value } : item)))
  }

  const buildInputColumn = (title, dataIndex, setState, width = 160) => ({
    title,
    dataIndex,
    width,
    render: (value, record) => (
      <Input
        value={value}
        disabled={isViewMode}
        onChange={(event) => updateListField(setState, record.id, dataIndex, event.target.value)}
      />
    ),
  })

  const removeRow = (setState, rowId, minOne = false, factory = null) => {
    setState((prev) => {
      const next = prev.filter((item) => item.id !== rowId)
      if (minOne && next.length === 0 && typeof factory === 'function') {
        return [factory()]
      }
      return next
    })
  }

  const handleSubmit = async () => {
    if (isViewMode) {
      navigate('/supplier-profiles')
      return
    }
    try {
      const values = await form.validateFields()
      setLoading(true)
      const payload = {
        relatedNodeIds: Array.isArray(values.relatedNodeIds)
          ? values.relatedNodeIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
          : [],
        relatedNodeNames: Array.isArray(values.relatedNodeIds)
          ? values.relatedNodeIds
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
            .map((item) => nodeNameById.get(item) || '')
            .filter(Boolean)
          : [],
        companyName: values.companyName || '',
        companyNameEn: values.companyNameEn || '',
        legalRepresentative: values.legalRepresentative || '',
        orgCode: values.orgCode || '',
        registeredCapital: values.registeredCapital || '',
        establishedDate: values.establishedDate || '',
        employeesCount: values.employeesCount || '',
        companyType: values.companyType || '',
        website: values.website || '',
        postalCode: values.postalCode || '',
        address: values.address || '',
        companyIntro: values.companyIntro || '',
        fitSituation: values.fitSituation || '',
        exportSituation: values.exportSituation || '',
        certificates: values.certificates || '',
        contacts: contacts,
        products: products,
        fitOems: Array.isArray(values.fitOems) ? values.fitOems : [],
        productFitDetails: [],
        exportCountries: Array.isArray(values.exportCountries) ? values.exportCountries : [],
        certificateItems: Array.isArray(values.certificateItems) ? values.certificateItems : [],
        newsItems: newsItems,
      }
      if (editId) {
        await updateSupplierProfile(editId, payload)
        message.success('修改成功')
      } else {
        await createSupplierProfile(payload)
        message.success('新增成功')
      }
      navigate('/supplier-profiles')
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error.message || '提交失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSourceChange = (sourceId) => {
    const source = sourceOptions.find((item) => Number(item.id) === Number(sourceId))
    if (!source) {
      form.setFieldsValue({ relatedNodeIds: [] })
      return
    }
    const currentIds = Array.isArray(form.getFieldValue('relatedNodeIds')) ? form.getFieldValue('relatedNodeIds') : []
    const sourceNodeId = Number(source.nodeId)
    const nextIds = [...new Set([
      ...currentIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0),
      ...(Number.isInteger(sourceNodeId) && sourceNodeId > 0 ? [sourceNodeId] : []),
    ])]
    const nextValues = {
      sourceSupplierId: source.id,
      relatedNodeIds: nextIds,
    }
    if (!form.getFieldValue('companyName')) nextValues.companyName = source.companyName || ''
    if (!form.getFieldValue('fitSituation')) nextValues.fitSituation = source.fitExport || ''
    if (!form.getFieldValue('website')) nextValues.website = source.detailUrl || source.listPageUrl || ''
    form.setFieldsValue(nextValues)
  }

  const contactColumns = [
    buildInputColumn('联系人', 'contactPerson', setContacts, 150),
    buildInputColumn('职务', 'contactTitle', setContacts, 130),
    buildInputColumn('电话', 'phone', setContacts, 150),
    buildInputColumn('手机', 'mobile', setContacts, 150),
    buildInputColumn('邮箱', 'email', setContacts, 220),
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_, record) => (
        <Button
          danger
          type="link"
          icon={<DeleteOutlined />}
          disabled={isViewMode}
          onClick={() => removeRow(setContacts, record.id, true, makeEmptyContact)}
        >
          删除
        </Button>
      ),
    },
  ]

  const productColumns = [
    buildInputColumn('产品名称', 'name', setProducts, 160),
    buildInputColumn('型号', 'model', setProducts, 120),
    buildInputColumn('应用场景', 'application', setProducts, 160),
    buildInputColumn('外观', 'appearance', setProducts, 180),
    buildInputColumn('精度指标', 'precision', setProducts, 180),
    buildInputColumn('适用场景', 'scenarios', setProducts, 180),
    buildInputColumn('材质', 'material', setProducts, 140),
    buildInputColumn('核心优势', 'advantages', setProducts, 180),
    buildInputColumn('产品参数', 'parameters', setProducts, 220),
    buildInputColumn('图片URL', 'imageUrl', setProducts, 220),
    {
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_, record) => (
        <Button danger type="link" icon={<DeleteOutlined />} disabled={isViewMode} onClick={() => removeRow(setProducts, record.id)}>
          删除
        </Button>
      ),
    },
  ]

  const newsColumns = [
    buildInputColumn('标题', 'title', setNewsItems, 260),
    buildInputColumn('来源', 'source', setNewsItems, 180),
    buildInputColumn('发布时间', 'publishDate', setNewsItems, 140),
    {
      title: '内容',
      dataIndex: 'content',
      width: 420,
      render: (value, record) => (
        <Input.TextArea
          value={value}
          disabled={isViewMode}
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(event) => updateListField(setNewsItems, record.id, 'content', event.target.value)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_, record) => (
        <Button danger type="link" icon={<DeleteOutlined />} disabled={isViewMode} onClick={() => removeRow(setNewsItems, record.id)}>
          删除
        </Button>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'basic',
      label: '基本信息',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title="基本信息">
            <Space size={12} wrap style={{ width: '100%' }}>
              <Form.Item style={{ width: 420, marginBottom: 10 }} name="sourceSupplierId" label="关联供应商来源记录">
                <Select
                  disabled={isViewMode}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="请选择供应商信息来源中的记录"
                  options={sourceOptions.map((item) => ({
                    value: item.id,
                    label: `${item.companyName || '未命名供应商'} ｜ ${item.nodeName || '未绑定节点'}`,
                  }))}
                  onChange={handleSourceChange}
                />
              </Form.Item>
              <Form.Item style={{ width: 480, marginBottom: 10 }} name="relatedNodeIds" label="供应链节点名称">
                <TreeSelect
                  disabled={isViewMode}
                  treeData={supplyChainTree}
                  treeCheckable
                  multiple
                  showSearch
                  placeholder="请选择供应链节点（可多选）"
                  allowClear
                  style={{ width: '100%' }}
                  onChange={(next) => {
                    const ids = Array.isArray(next)
                      ? next.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
                      : []
                    form.setFieldsValue({ relatedNodeIds: ids })
                  }}
                />
              </Form.Item>
              <Form.Item style={{ width: 320, marginBottom: 10 }} name="companyName" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 320, marginBottom: 10 }} name="companyNameEn" label="英文名称">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="legalRepresentative" label="法人代表">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="registeredCapital" label="注册资本">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="orgCode" label="机构代码">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="establishedDate" label="成立日期">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="employeesCount" label="人数">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 220, marginBottom: 10 }} name="companyType" label="企业类型">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 160, marginBottom: 10 }} name="postalCode" label="邮编">
                <Input disabled={isViewMode} />
              </Form.Item>
            </Space>
          </Card>

          <Card
            size="small"
            title="联系我们"
            extra={(
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                disabled={isViewMode}
                onClick={() => setContacts((prev) => [...prev, makeEmptyContact()])}
              >
                新增联系人
              </Button>
            )}
          >
            {renderSourceLink(contactSourceUrl)}
            <Space size={12} wrap style={{ width: '100%', marginBottom: 12 }}>
              <Form.Item style={{ width: 360, marginBottom: 0 }} name="website" label="联系网址">
                <Input disabled={isViewMode} />
              </Form.Item>
              <Form.Item style={{ width: 720, marginBottom: 0 }} name="address" label="联系地址">
                <Input disabled={isViewMode} />
              </Form.Item>
            </Space>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={contacts}
              columns={contactColumns}
              scroll={{ x: 980 }}
            />
          </Card>
        </Space>
      ),
    },
    {
      key: 'intro',
      label: '公司简介',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {renderSourceLink(introSourceUrl)}
          <Form.Item name="companyIntro" label="公司简介" style={{ marginBottom: 0 }}>
            <Input.TextArea disabled={isViewMode} rows={12} />
          </Form.Item>
        </Space>
      ),
    },
    {
      key: 'products',
      label: '重点产品',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {renderSourceLink(productSourceUrl)}
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text className="muted">产品列表支持行内直接维护</Text>
            <Button type="dashed" icon={<PlusOutlined />} disabled={isViewMode} onClick={() => setProducts((prev) => [...prev, makeEmptyProduct()])}>
              新增产品
            </Button>
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={products}
            columns={productColumns}
            scroll={{ x: 2100 }}
          />
        </Space>
      ),
    },
    {
      key: 'fit',
      label: '配套情况',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {renderSourceLink(fitSourceUrl)}
          <Form.Item name="fitOems" label="配套车企（多选）" style={{ marginBottom: 0 }}>
            <Select
              mode="tags"
              disabled={isViewMode}
              options={oemOptions.map((item) => ({ label: item.name, value: item.name }))}
              placeholder="请选择配套车企"
            />
          </Form.Item>
          <Form.Item name="fitSituation" label="配套情况" style={{ marginBottom: 0 }}>
            <Input.TextArea disabled={isViewMode} rows={6} />
          </Form.Item>
        </Space>
      ),
    },
    {
      key: 'export',
      label: '出口情况',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {renderSourceLink(exportSourceUrl)}
          <Form.Item name="exportSituation" label="出口情况" style={{ marginBottom: 0 }}>
            <Input.TextArea disabled={isViewMode} rows={6} />
          </Form.Item>
          <Form.Item name="exportCountries" label="出口国家（多选）" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              disabled={isViewMode}
              options={countryOptions.map((item) => ({ label: item.name, value: item.name }))}
              placeholder="请选择出口国家/地区"
            />
          </Form.Item>
        </Space>
      ),
    },
    {
      key: 'cert',
      label: '企业证书',
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          {renderSourceLink(certSourceUrl)}
          <Form.Item name="certificateItems" label="认证体系（多选）" style={{ marginBottom: 0 }}>
            <Select
              mode="tags"
              disabled={isViewMode}
              options={certificationOptions.map((item) => ({ label: item.name, value: item.name }))}
              placeholder="请选择认证体系"
            />
          </Form.Item>
          <Form.Item name="certificates" label="认证体系详情" style={{ marginBottom: 0 }}>
            <Input.TextArea disabled={isViewMode} rows={6} placeholder="抓取到的认证体系详情会展示在这里" />
          </Form.Item>
        </Space>
      ),
    },
    {
      key: 'news',
      label: '公司新闻',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {renderSourceLink(newsSourceUrl)}
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text className="muted">新闻列表支持新增、删除和行内编辑</Text>
            <Button type="dashed" icon={<PlusOutlined />} disabled={isViewMode} onClick={() => setNewsItems((prev) => [...prev, makeEmptyNews()])}>
              新增新闻
            </Button>
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={newsItems}
            columns={newsColumns}
            scroll={{ x: 1200 }}
          />
        </Space>
      ),
    },
  ]

  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>{pageTitle}</Title>
            <Text className="muted">{editId ? `记录ID：${editId}` : '创建供应商档案'}</Text>
          </Space>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplier-profiles')}>返回列表</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={loading} disabled={isViewMode} onClick={handleSubmit}>
              保存
            </Button>
          </Space>
        </Space>
        <Form form={form} layout="vertical">
          <Tabs items={tabItems} />
        </Form>
      </Space>
    </Card>
  )
}

export default SupplierProfileFormPage
