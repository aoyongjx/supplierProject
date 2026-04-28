import { ArrowLeftOutlined, MinusCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Col, Form, Input, Row, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createSupplierProfile,
  fetchSupplierProfileDetail,
  fetchSupplierProfileOptions,
  updateSupplierProfile,
} from '../api/supplierProfileApi'

const { Title, Text } = Typography

const BUSINESS_FIELDS = ['人员规模', '研发人数', '年销售额', '体系认证', '公司网址', '出口市场']
const INDUSTRIAL_FIELDS = [
  '法定代表人',
  '注册资本',
  '经营状态',
  '实缴资本',
  '统一社会信用代码',
  '成立时间',
  '注册号',
  '纳税人识别号',
  '公司性质',
  '组织机构代码',
  '核准日期',
  '所属行业',
  '所属地',
  '登记机关',
  '曾用名',
  '英文名',
  '人员规模',
  '营业期限',
  '参保人数',
  '注册地址',
]

function normalizeKvFields(input = {}, fields = []) {
  const data = input && typeof input === 'object' ? input : {}
  return fields.reduce((acc, key) => {
    acc[key] = data[key] || ''
    return acc
  }, {})
}

function makeEmptyCustomerItem() {
  return { productName: '', oemNames: [] }
}

function makeEmptyProductCase() {
  return { productName: '', vehicleModel: '', customerName: '', description: '' }
}

function makeEmptyFinancing() {
  return { financingDate: '', round: '', amount: '', investors: '' }
}

function makeEmptyPatent() {
  return {
    patentType: '',
    publicationNo: '',
    publicationDate: '',
    title: '',
    applicationNo: '',
    applicationDate: '',
    inventors: '',
    assignee: '',
    agency: '',
    agent: '',
    legalStatus: '',
    summary: '',
  }
}

function makeEmptyAdminLicense() {
  return { documentNo: '', authority: '', decisionDate: '', content: '', status: '', validUntil: '', category: '', region: '' }
}

function makeEmptyTradeCredit() {
  return {
    customsOffice: '',
    businessType: '',
    registrationDate: '',
    registrationCode: '',
    administrativeRegion: '',
    economicRegion: '',
    creditLevel: '',
    annualReportStatus: '',
    validityPeriod: '',
  }
}

function makeEmptyCourtNotice() {
  return { caseNo: '', hearingDate: '', cause: '', plaintiff: '', defendant: '', court: '', tribunal: '', region: '' }
}

function makeEmptyProductionBase() {
  return { baseName: '', region: '', postalCode: '', address: '', phone: '', mainProducts: '' }
}

function makeEmptyNews() {
  return { title: '', source: '', publishDate: '', content: '' }
}

function ListCard({ title, extra, children }) {
  return (
    <Card size="small" title={title} extra={extra}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {children}
      </Space>
    </Card>
  )
}

function SupplierProfileFormPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [oemOptions, setOemOptions] = useState([])
  const [sourceOptions, setSourceOptions] = useState([])
  const [supplyChainTree, setSupplyChainTree] = useState([])

  const editId = useMemo(() => {
    const parsed = Number(id)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [id])
  const isViewMode = Boolean(editId) && !location.pathname.endsWith('/edit')
  const pageTitle = isViewMode ? '查看供应商档案' : (editId ? '修改供应商档案' : '新增供应商档案')
  const isGasView = location.pathname.startsWith('/gas-supplier-profiles') || location.pathname.startsWith('/gas-suppliers')
  const basePath = isGasView ? '/gas-suppliers' : '/supplier-profiles'
  const profileView = isGasView ? 'gas' : 'gys'

  useEffect(() => {
    fetchSupplierProfileOptions({ view: profileView })
      .then((data) => {
        setOemOptions(Array.isArray(data?.oemOptions) ? data.oemOptions : [])
        setSourceOptions(Array.isArray(data?.sourceOptions) ? data.sourceOptions : [])
        setSupplyChainTree(Array.isArray(data?.supplyChainTree) ? data.supplyChainTree : [])
      })
      .catch(() => {
        setOemOptions([])
        setSourceOptions([])
        setSupplyChainTree([])
      })
  }, [profileView])

  useEffect(() => {
    if (!editId) {
      form.setFieldsValue({
        relatedNodeIds: [],
        companyTags: [],
        mainProductNames: [],
        businessInfo: normalizeKvFields({}, BUSINESS_FIELDS),
        industrialCommercialInfo: normalizeKvFields({}, INDUSTRIAL_FIELDS),
        customerItems: [makeEmptyCustomerItem()],
        productCaseItems: [],
        financingItems: [],
        patentItems: [],
        adminLicenseItems: [],
        tradeCreditItems: [],
        courtNoticeItems: [],
        productionBaseItems: [],
        newsItems: [],
      })
      return
    }
    setLoading(true)
    fetchSupplierProfileDetail(editId, { view: profileView })
      .then((detail) => {
        form.setFieldsValue({
          relatedNodeIds: Array.isArray(detail.relatedNodeIds) ? detail.relatedNodeIds : [],
          profileSource: detail.profileSource || profileView,
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
          companyTags: Array.isArray(detail.companyTags) ? detail.companyTags : [],
          companyIntro: detail.companyIntro || '',
          businessInfo: normalizeKvFields(detail.businessInfo, BUSINESS_FIELDS),
          industrialCommercialInfo: normalizeKvFields(detail.industrialCommercialInfo, INDUSTRIAL_FIELDS),
          mainProductNames: Array.isArray(detail.mainProductNames) ? detail.mainProductNames : [],
          customerItems: Array.isArray(detail.customerItems) && detail.customerItems.length > 0 ? detail.customerItems : [makeEmptyCustomerItem()],
          productCaseItems: Array.isArray(detail.productCaseItems) ? detail.productCaseItems : [],
          financingItems: Array.isArray(detail.financingItems) ? detail.financingItems : [],
          patentItems: Array.isArray(detail.patentItems) ? detail.patentItems : [],
          adminLicenseItems: Array.isArray(detail.adminLicenseItems) ? detail.adminLicenseItems : [],
          tradeCreditItems: Array.isArray(detail.tradeCreditItems) ? detail.tradeCreditItems : [],
          courtNoticeItems: Array.isArray(detail.courtNoticeItems) ? detail.courtNoticeItems : [],
          productionBaseItems: Array.isArray(detail.productionBaseItems) ? detail.productionBaseItems : [],
          newsItems: Array.isArray(detail.newsItems) ? detail.newsItems : [],
        })
      })
      .catch((error) => message.error(error.message || '加载失败'))
      .finally(() => setLoading(false))
  }, [editId, form, profileView])

  const nodeNameById = useMemo(() => {
    const map = new Map()
    const walk = (nodes = []) => {
      for (const node of nodes) {
        const value = Number(node?.value || node?.id)
        if (Number.isInteger(value) && value > 0) map.set(value, String(node?.title || '').trim())
        if (Array.isArray(node?.children) && node.children.length > 0) walk(node.children)
      }
    }
    walk(supplyChainTree)
    return map
  }, [supplyChainTree])

  const handleSourceChange = (sourceId) => {
    const source = sourceOptions.find((item) => Number(item.id) === Number(sourceId))
    if (!source) return
    const currentIds = Array.isArray(form.getFieldValue('relatedNodeIds')) ? form.getFieldValue('relatedNodeIds') : []
    const sourceNodeId = Number(source.nodeId)
    const nextIds = [...new Set([
      ...currentIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0),
      ...(Number.isInteger(sourceNodeId) && sourceNodeId > 0 ? [sourceNodeId] : []),
    ])]
    const nextBusinessInfo = {
      ...normalizeKvFields(form.getFieldValue('businessInfo'), BUSINESS_FIELDS),
      公司网址: form.getFieldValue(['businessInfo', '公司网址']) || source.detailUrl || source.listPageUrl || '',
    }
    form.setFieldsValue({
      relatedNodeIds: nextIds,
      companyName: form.getFieldValue('companyName') || source.companyName || '',
      website: form.getFieldValue('website') || source.detailUrl || source.listPageUrl || '',
      mainProductNames: form.getFieldValue('mainProductNames')?.length ? form.getFieldValue('mainProductNames') : (
        source.mainProducts ? source.mainProducts.split(/[，,；;]/g).map((item) => item.trim()).filter(Boolean) : []
      ),
      businessInfo: nextBusinessInfo,
    })
  }

  const handleSubmit = async () => {
    if (isViewMode) {
      navigate(basePath)
      return
    }
    try {
      const values = await form.validateFields()
      setLoading(true)
      const relatedNodeIds = Array.isArray(values.relatedNodeIds)
        ? values.relatedNodeIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
        : []
      const relatedNodeNames = relatedNodeIds.map((item) => nodeNameById.get(item) || '').filter(Boolean)
      const payload = {
        profileSource: profileView,
        relatedNodeIds,
        relatedNodeNames,
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
        companyTags: Array.isArray(values.companyTags) ? values.companyTags : [],
        companyIntro: values.companyIntro || '',
        businessInfo: values.businessInfo || {},
        industrialCommercialInfo: values.industrialCommercialInfo || {},
        mainProductNames: Array.isArray(values.mainProductNames) ? values.mainProductNames : [],
        customerItems: Array.isArray(values.customerItems) ? values.customerItems : [],
        productCaseItems: Array.isArray(values.productCaseItems) ? values.productCaseItems : [],
        financingItems: Array.isArray(values.financingItems) ? values.financingItems : [],
        patentItems: Array.isArray(values.patentItems) ? values.patentItems : [],
        adminLicenseItems: Array.isArray(values.adminLicenseItems) ? values.adminLicenseItems : [],
        tradeCreditItems: Array.isArray(values.tradeCreditItems) ? values.tradeCreditItems : [],
        courtNoticeItems: Array.isArray(values.courtNoticeItems) ? values.courtNoticeItems : [],
        productionBaseItems: Array.isArray(values.productionBaseItems) ? values.productionBaseItems : [],
        newsItems: Array.isArray(values.newsItems) ? values.newsItems : [],
      }
      if (editId) {
        await updateSupplierProfile(editId, payload, { view: profileView })
        message.success('修改成功')
      } else {
        await createSupplierProfile(payload, { view: profileView })
        message.success('新增成功')
      }
      navigate(basePath)
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  const disabled = isViewMode || loading

  const tabItems = [
    {
      key: 'intro',
      label: 'Tab1 公司简介',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!isGasView ? (
            <ListCard title="顶部标签">
              <Form.Item name="companyTags" style={{ marginBottom: 0 }}>
                <Select
                  mode="tags"
                  disabled={disabled}
                  placeholder="输入如 A股 / 高新技术企业 / 民营企业"
                  tokenSeparators={[',', '，', ';', '；']}
                />
              </Form.Item>
            </ListCard>
          ) : null}
          <ListCard title="公司简介">
            <Form.Item name="companyIntro" style={{ marginBottom: 0 }}>
              <Input.TextArea disabled={disabled} rows={12} placeholder="公司简介" />
            </Form.Item>
          </ListCard>
        </Space>
      ),
    },
    {
      key: 'business',
      label: 'Tab2 业务信息',
      children: (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <ListCard title="业务字段">
            <Row gutter={12}>
              {BUSINESS_FIELDS.map((field) => (
                <Col span={12} key={field}>
                  <Form.Item name={['businessInfo', field]} label={field}>
                    <Input disabled={disabled} />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </ListCard>
          <ListCard title="主营产品">
            <Form.Item name="mainProductNames" style={{ marginBottom: 0 }}>
              <Select
                mode="tags"
                disabled={disabled}
                placeholder="请选择或输入主营产品名称"
                tokenSeparators={[',', '，', ';', '；']}
              />
            </Form.Item>
          </ListCard>
          <ListCard title="配套客户">
            <Form.List name="customerItems">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.map((field, index) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`记录 ${index + 1}`}
                      extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}
                    >
                      <Row gutter={12}>
                        <Col span={10}>
                          <Form.Item name={[field.name, 'productName']} label="产品">
                            <Input disabled={disabled} />
                          </Form.Item>
                        </Col>
                        <Col span={14}>
                          <Form.Item name={[field.name, 'oemNames']} label="车企">
                            <Select
                              mode="multiple"
                              disabled={disabled}
                              options={oemOptions.map((item) => ({ label: item.name, value: item.name }))}
                              placeholder="可多选企业名称"
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                  {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyCustomerItem())}>新增配套客户</Button> : null}
                </Space>
              )}
            </Form.List>
          </ListCard>
        </Space>
      ),
    },
    {
      key: 'cases',
      label: 'Tab3 产品案例',
      children: (
        <Form.List name="productCaseItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  size="small"
                  title={`案例 ${index + 1}`}
                  extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}
                >
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name={[field.name, 'productName']} label="产品"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'vehicleModel']} label="车型"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'customerName']} label="车企"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'description']} label="说明"><Input.TextArea disabled={disabled} rows={3} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyProductCase())}>新增产品案例</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'industrial',
      label: 'Tab4 工商信息',
      children: (
        <Row gutter={12}>
          {INDUSTRIAL_FIELDS.map((field) => (
            <Col span={12} key={field}>
              <Form.Item name={['industrialCommercialInfo', field]} label={field}>
                <Input disabled={disabled} />
              </Form.Item>
            </Col>
          ))}
        </Row>
      ),
    },
    {
      key: 'financing',
      label: 'Tab5 融资信息',
      children: (
        <Form.List name="financingItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`融资 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'financingDate']} label="融资时间"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'round']} label="融资轮次"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'amount']} label="融资金额"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'investors']} label="投资方"><Input.TextArea disabled={disabled} rows={2} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyFinancing())}>新增融资信息</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'patent',
      label: 'Tab6 专利信息',
      children: (
        <Form.List name="patentItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`专利 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'patentType']} label="专利类型"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'publicationNo']} label="公告号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'publicationDate']} label="公告日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'title']} label="名称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'applicationNo']} label="申请号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'applicationDate']} label="申请日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'inventors']} label="发明人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'assignee']} label="专利权人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'agency']} label="代理机构"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'agent']} label="代理人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'legalStatus']} label="法律状态"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'summary']} label="摘要"><Input.TextArea disabled={disabled} rows={3} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyPatent())}>新增专利</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'license',
      label: 'Tab7 行政许可',
      children: (
        <Form.List name="adminLicenseItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`许可 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name={[field.name, 'documentNo']} label="决定文书号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'authority']} label="许可机关"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'decisionDate']} label="决定日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'status']} label="许可状态"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'validUntil']} label="截止日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'category']} label="审批类别"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'region']} label="地域"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'content']} label="许可内容"><Input.TextArea disabled={disabled} rows={3} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyAdminLicense())}>新增行政许可</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'trade',
      label: 'Tab8 进出口信用',
      children: (
        <Form.List name="tradeCreditItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`进出口信用 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name={[field.name, 'customsOffice']} label="注册海关"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'businessType']} label="经营类别"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'registrationDate']} label="注册日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'registrationCode']} label="海关注册编码"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'administrativeRegion']} label="行政地区"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'economicRegion']} label="经济地区"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'creditLevel']} label="信用等级"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'annualReportStatus']} label="年报情况"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'validityPeriod']} label="报关有效期"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyTradeCredit())}>新增进出口信用</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'court',
      label: 'Tab9 开庭公告',
      children: (
        <Form.List name="courtNoticeItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`公告 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name={[field.name, 'caseNo']} label="案号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'hearingDate']} label="开庭时间"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'cause']} label="案由"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={12}><Form.Item name={[field.name, 'plaintiff']} label="原告/申请人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={12}><Form.Item name={[field.name, 'defendant']} label="被告/被申请人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'court']} label="法院"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'tribunal']} label="法庭"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'region']} label="地区"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyCourtNotice())}>新增开庭公告</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'production',
      label: 'Tab10 生产基地',
      children: (
        <Form.List name="productionBaseItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`基地 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={8}><Form.Item name={[field.name, 'baseName']} label="基地名称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'region']} label="地区"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'postalCode']} label="邮编"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={12}><Form.Item name={[field.name, 'phone']} label="电话"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'address']} label="地址"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'mainProducts']} label="主营产品"><Input.TextArea disabled={disabled} rows={2} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyProductionBase())}>新增生产基地</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'news',
      label: 'Tab11 新闻相关',
      children: (
        <Form.List name="newsItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`新闻 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={12}><Form.Item name={[field.name, 'title']} label="标题"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={12}><Form.Item name={[field.name, 'source']} label="来源/链接"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={8}><Form.Item name={[field.name, 'publishDate']} label="发布时间"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'content']} label="内容摘要"><Input.TextArea disabled={disabled} rows={3} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(makeEmptyNews())}>新增新闻</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
  ]
  const gasTabLabelMap = {
    intro: 'A 基本信息',
    business: 'B 业务信息',
    product: 'C 产品案例/体系认证/企业设备',
    industrial: 'D 工商信息',
    patent: 'E 专利信息',
    license: 'F 行政许可（信用中国）',
    trade: 'G 进出口信用',
    financing: 'H 融资信息',
    news: 'I 软件著作权',
    court: 'J 开庭公告',
    base: 'K 行政许可（工商局）',
  }
  const gasTabOrder = ['intro', 'business', 'product', 'industrial', 'patent', 'license', 'trade', 'financing', 'news', 'court', 'base']
  const visibleTabItems = isGasView
    ? gasTabOrder
      .map((key) => tabItems.find((item) => item.key === key))
      .filter(Boolean)
      .map((item) => ({ ...item, label: gasTabLabelMap[item.key] || item.label }))
    : tabItems
  const visibleGasTabItemsWithK = isGasView
    ? [
      ...visibleTabItems.filter((item) => item.key !== 'base'),
      {
        ...(visibleTabItems.find((item) => item.key === 'license') || {}),
        key: 'k_gs',
        label: 'K 行政许可（工商局）',
      },
    ]
    : visibleTabItems

  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>{pageTitle}</Title>
            <Text className="muted">{editId ? `记录ID：${editId}` : '创建供应商档案'}</Text>
          </Space>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(basePath)}>返回列表</Button>
            <Button type="primary" loading={loading} icon={<SaveOutlined />} onClick={handleSubmit}>
              {isViewMode ? '返回' : '保存'}
            </Button>
          </Space>
        </Space>

        <Form form={form} layout="vertical" disabled={loading}>
          <Card size="small" title="基础信息">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="sourceSupplierId" label="关联供应商来源记录">
                  <Select
                    disabled={disabled}
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    placeholder="请选择来源记录"
                    options={sourceOptions.map((item) => ({
                      value: item.id,
                      label: `${item.companyName || '-'} / ${item.nodeName || '-'}`,
                    }))}
                    onChange={handleSourceChange}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="relatedNodeIds" label="关联供应链节点">
                  <Select
                    mode="multiple"
                    disabled={disabled}
                    options={[...nodeNameById.entries()].map(([value, label]) => ({ value, label }))}
                    placeholder="请选择供应链节点"
                  />
                </Form.Item>
              </Col>
              <Col span={8}><Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="companyNameEn" label="英文名称"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="legalRepresentative" label="法定代表人"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="companyType" label="企业类型"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="orgCode" label="统一代码"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="registeredCapital" label="注册资本"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="establishedDate" label="成立时间"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="employeesCount" label="员工人数"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="website" label="详情 URL"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={8}><Form.Item name="postalCode" label="邮编"><Input disabled={disabled} /></Form.Item></Col>
              <Col span={24}><Form.Item name="address" label="地址"><Input disabled={disabled} /></Form.Item></Col>
            </Row>
          </Card>

          <Tabs items={visibleGasTabItemsWithK} />

          {isViewMode && (
            <Space wrap>
              {form.getFieldValue('companyTags')?.map((tag) => <Tag key={tag}>{tag}</Tag>)}
            </Space>
          )}
        </Form>
      </Space>
    </Card>
  )
}

export default SupplierProfileFormPage
