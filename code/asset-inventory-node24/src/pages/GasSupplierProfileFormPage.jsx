import { ArrowLeftOutlined, MinusCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { Button, Card, Col, Form, Input, Row, Select, Space, Tabs, TreeSelect, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  createGasSupplierProfile,
  fetchGasSupplierProfileDetail,
  fetchGasSupplierProfileOptions,
  updateGasSupplierProfile,
} from '../api/gasSupplierProfileApi'

const { Title, Text } = Typography

const INDUSTRIAL_FIELDS = [
  '法定代表人', '注册资本', '经营状态', '实缴资本', '统一社会信用代码', '成立时间', '注册号', '纳税人识别号',
  '公司性质', '组织机构代码', '核准日期', '所属行业', '所属地', '登记机关', '曾用名', '英文名', '人员规模', '营业期限', '参保人数', '注册地址',
]

const BOOL_OPTIONS = [
  { label: '是', value: '是' },
  { label: '否', value: '否' },
]

function normalizeNodeTree(nodes = []) {
  return (nodes || []).map((item) => ({
    value: Number(item.value || item.id),
    title: item.title,
    children: normalizeNodeTree(item.children || []),
  }))
}

function buildNodeNameMap(nodes = []) {
  const map = new Map()
  const walk = (list) => {
    for (const item of list || []) {
      const value = Number(item.value || item.id)
      if (Number.isInteger(value) && value > 0) map.set(value, String(item.title || ''))
      walk(item.children || [])
    }
  }
  walk(nodes)
  return map
}

function normalizeIndustrialInfo(input = {}) {
  const data = input && typeof input === 'object' ? input : {}
  return INDUSTRIAL_FIELDS.reduce((acc, key) => {
    acc[key] = data[key] || ''
    return acc
  }, {})
}

function normalizeIndustrialInfoForForm(detail = {}) {
  const raw = detail?.industrialCommercialInfo && typeof detail.industrialCommercialInfo === 'object'
    ? detail.industrialCommercialInfo
    : {}
  const next = normalizeIndustrialInfo(raw)
  const capitalFromProfile = String(detail?.registeredCapital || '').trim()
  const paidIn = String(next['实缴资本'] || '').trim()
  const reg = String(next['注册资本'] || '').trim()
  if (!reg || reg === '实缴资本' || reg === '注册资本') {
    next['注册资本'] = capitalFromProfile || (paidIn && paidIn !== '实缴资本' ? paidIn : '')
  }
  if (!next['法定代表人'] || next['法定代表人'] === '经营状态' || next['法定代表人'] === '法定代表人') {
    next['法定代表人'] = String(detail?.legalRepresentative || '').trim()
  }
  return next
}

function normalizePatentItemsForForm(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    publishNo: item?.publishNo || item?.publicationNo || '',
    publishDate: item?.publishDate || item?.publicationDate || '',
    name: item?.name || item?.title || '',
  }))
}

function normalizeAdminLicenseItemsForForm(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    permitNo: item?.permitNo || item?.documentNo || '',
    permitName: item?.permitName || item?.category || item?.status || '',
    validFrom: item?.validFrom || item?.decisionDate || '',
    validTo: item?.validTo || item?.validUntil || '',
  }))
}

function normalizeTradeCreditItemsForForm(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    recordDate: item?.recordDate || item?.registrationDate || '',
    category: item?.category || item?.businessType || '',
    content: item?.content || item?.customsOffice || '',
  }))
}

function normalizeLineItems(input = [], key = 'name') {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({ [key]: String(item?.[key] || item || '').trim() }))
    .filter((item) => item[key])
}

function GasSupplierProfileFormPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [sourceOptions, setSourceOptions] = useState([])
  const [oemOptions, setOemOptions] = useState([])
  const [certificationOptions, setCertificationOptions] = useState([])
  const [countryOptions, setCountryOptions] = useState([])
  const [supplyChainTree, setSupplyChainTree] = useState([])

  const editId = useMemo(() => {
    const parsed = Number(id)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [id])
  const isViewMode = Boolean(editId) && !location.pathname.endsWith('/edit')
  const pageTitle = isViewMode ? '查看GAS供应商档案' : (editId ? '修改GAS供应商档案' : '新增GAS供应商档案')
  const nodeNameById = useMemo(() => buildNodeNameMap(supplyChainTree), [supplyChainTree])
  const treeSelectData = useMemo(() => normalizeNodeTree(supplyChainTree), [supplyChainTree])

  useEffect(() => {
    fetchGasSupplierProfileOptions()
      .then((data) => {
        setSourceOptions(Array.isArray(data?.sourceOptions) ? data.sourceOptions : [])
        setOemOptions(Array.isArray(data?.oemOptions) ? data.oemOptions : [])
        setCertificationOptions(Array.isArray(data?.certificationOptions) ? data.certificationOptions : [])
        setCountryOptions(Array.isArray(data?.countryOptions) ? data.countryOptions : [])
        setSupplyChainTree(Array.isArray(data?.supplyChainTree) ? data.supplyChainTree : [])
      })
      .catch(() => {
        setSourceOptions([])
        setOemOptions([])
        setCertificationOptions([])
        setCountryOptions([])
        setSupplyChainTree([])
      })
  }, [])

  useEffect(() => {
    if (!editId) {
      form.setFieldsValue({
        sourceSupplierId: undefined,
        sourceSupplierRef: undefined,
        companyName: '',
        relatedNodeIds: [],
        companyIntro: '',
        supplierProfileUrl: '',
        businessInfo: { 人员规模: '', 研发人数: '', 年销售额: '', 体系认证: [], 公司网址: '', 配套客户: [], 直接出口经验: '', 年出口额: '', 出口市场: [], 主营产品: [] },
        industrialCommercialInfo: normalizeIndustrialInfo({}),
        productCaseItems: [],
        financingItems: [],
        softwareCopyrightItems: [],
        courtNoticeItems: [],
        certificateItems: [],
        equipmentItems: [],
        patentItems: [],
        adminLicenseItems: [],
        adminLicenseGsItems: [],
        tradeCreditItems: [],
      })
      return
    }
    setLoading(true)
    fetchGasSupplierProfileDetail(editId)
      .then((detail) => {
        const business = detail?.businessInfo || {}
        const certifications = Array.isArray(detail?.certificateItems) ? detail.certificateItems : []
        form.setFieldsValue({
          sourceSupplierId: detail?.sourceSupplierId ? Number(detail.sourceSupplierId) : undefined,
          sourceSupplierRef: detail?.sourceSupplierId ? Number(detail.sourceSupplierId) : undefined,
          companyName: detail?.companyName || '',
          relatedNodeIds: Array.isArray(detail?.relatedNodeIds) ? detail.relatedNodeIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0) : [],
          companyIntro: detail?.companyIntro || '',
          supplierProfileUrl: detail?.supplierProfileUrl || detail?.website || '',
          businessInfo: {
            人员规模: business['人员规模'] || detail?.employeesCount || '',
            研发人数: business['研发人数'] || '',
            年销售额: business['年销售额'] || '',
            体系认证: Array.isArray(business['体系认证']) ? business['体系认证'] : certifications,
            公司网址: business['公司网址'] || detail?.website || '',
            配套客户: Array.isArray(detail?.fitOems) ? detail.fitOems : [],
            直接出口经验: business['直接出口经验'] || '',
            年出口额: business['年出口额'] || '',
            出口市场: Array.isArray(detail?.exportCountries) ? detail.exportCountries : [],
            主营产品: Array.isArray(detail?.mainProductNames) ? detail.mainProductNames : [],
          },
          industrialCommercialInfo: normalizeIndustrialInfoForForm(detail),
          productCaseItems: normalizeLineItems((detail?.productCaseItems || []).map((item) => item?.productName || ''), 'productName'),
          financingItems: Array.isArray(detail?.financingItems) ? detail.financingItems : [],
          softwareCopyrightItems: Array.isArray(detail?.softwareCopyrightItems) ? detail.softwareCopyrightItems : [],
          courtNoticeItems: Array.isArray(detail?.courtNoticeItems) ? detail.courtNoticeItems : [],
          certificateItems: certifications.map((item) => ({ name: item })),
          equipmentItems: normalizeLineItems(detail?.equipmentItems || [], 'equipmentName'),
          patentItems: normalizePatentItemsForForm(detail?.patentItems),
          adminLicenseItems: normalizeAdminLicenseItemsForForm(detail?.adminLicenseItems),
          adminLicenseGsItems: Array.isArray(detail?.adminLicenseGsItems) ? detail.adminLicenseGsItems : [],
          tradeCreditItems: normalizeTradeCreditItemsForForm(detail?.tradeCreditItems),
        })
      })
      .catch((error) => message.error(error.message || '加载档案失败'))
      .finally(() => setLoading(false))
  }, [editId, form])

  const disabled = loading || isViewMode

  const handleSourceChange = (sourceSupplierRef) => {
    const selected = sourceOptions.find((item) => Number(item.id) === Number(sourceSupplierRef))
    if (!selected) return
    const currentNodeIds = Array.isArray(form.getFieldValue('relatedNodeIds')) ? form.getFieldValue('relatedNodeIds') : []
    const nodeId = Number(selected.nodeId)
    const nextNodeIds = [...new Set([
      ...currentNodeIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0),
      ...(Number.isInteger(nodeId) && nodeId > 0 ? [nodeId] : []),
    ])]
    form.setFieldsValue({
      sourceSupplierRef: Number(selected.id),
      sourceSupplierId: Number(selected.id),
      companyName: selected.companyName || '',
      supplierProfileUrl: form.getFieldValue('supplierProfileUrl') || selected.detailUrl || '',
      relatedNodeIds: nextNodeIds,
      businessInfo: {
        ...(form.getFieldValue('businessInfo') || {}),
        公司网址: form.getFieldValue(['businessInfo', '公司网址']) || selected.detailUrl || selected.listPageUrl || '',
        主营产品: form.getFieldValue(['businessInfo', '主营产品'])?.length
          ? form.getFieldValue(['businessInfo', '主营产品'])
          : String(selected.mainProducts || '').split(/[，,；;]/g).map((item) => item.trim()).filter(Boolean),
      },
    })
  }

  const submit = async () => {
    if (isViewMode) {
      navigate('/gas-supplier-profiles')
      return
    }
    try {
      const values = await form.validateFields()
      setLoading(true)
      const relatedNodeIds = (Array.isArray(values.relatedNodeIds) ? values.relatedNodeIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
      const relatedNodeNames = relatedNodeIds.map((item) => nodeNameById.get(item) || '').filter(Boolean)
      const businessInfo = values.businessInfo || {}
      const certificateItems = (Array.isArray(values.certificateItems) ? values.certificateItems : [])
        .map((item) => String(item?.name || '').trim())
        .filter(Boolean)
      const equipmentItems = (Array.isArray(values.equipmentItems) ? values.equipmentItems : [])
        .map((item) => ({ equipmentName: String(item?.equipmentName || '').trim() }))
        .filter((item) => item.equipmentName)
      const productCaseItems = (Array.isArray(values.productCaseItems) ? values.productCaseItems : [])
        .map((item) => ({ productName: String(item?.productName || '').trim(), vehicleModel: '', customerName: '', description: '' }))
        .filter((item) => item.productName)
      const patentItems = (Array.isArray(values.patentItems) ? values.patentItems : [])
        .map((item) => ({
          patentType: String(item?.patentType || '').trim(),
          publicationNo: String(item?.publishNo || item?.publicationNo || '').trim(),
          publicationDate: String(item?.publishDate || item?.publicationDate || '').trim(),
          title: String(item?.name || item?.title || '').trim(),
        }))
        .filter((item) => item.patentType || item.publicationNo || item.publicationDate || item.title)
      const adminLicenseItems = (Array.isArray(values.adminLicenseItems) ? values.adminLicenseItems : [])
        .map((item) => ({
          documentNo: String(item?.permitNo || item?.documentNo || '').trim(),
          category: String(item?.permitName || item?.category || '').trim(),
          decisionDate: String(item?.validFrom || item?.decisionDate || '').trim(),
          validUntil: String(item?.validTo || item?.validUntil || '').trim(),
          authority: String(item?.authority || '').trim(),
          content: String(item?.content || '').trim(),
          status: String(item?.status || '').trim(),
          region: String(item?.region || '').trim(),
        }))
        .filter((item) => item.documentNo || item.category || item.decisionDate || item.validUntil || item.authority || item.content || item.status || item.region)
      const tradeCreditItems = (Array.isArray(values.tradeCreditItems) ? values.tradeCreditItems : [])
        .map((item) => ({
          registrationDate: String(item?.recordDate || item?.registrationDate || '').trim(),
          businessType: String(item?.category || item?.businessType || '').trim(),
          content: String(item?.content || '').trim(),
          customsOffice: String(item?.customsOffice || '').trim(),
          registrationCode: String(item?.registrationCode || '').trim(),
          administrativeRegion: String(item?.administrativeRegion || '').trim(),
          economicRegion: String(item?.economicRegion || '').trim(),
          creditLevel: String(item?.creditLevel || '').trim(),
          annualReportStatus: String(item?.annualReportStatus || '').trim(),
          validityPeriod: String(item?.validityPeriod || '').trim(),
        }))
        .filter((item) => item.registrationDate || item.businessType || item.content || item.customsOffice || item.registrationCode || item.administrativeRegion || item.economicRegion || item.creditLevel || item.annualReportStatus || item.validityPeriod)
      const payload = {
        profileSource: 'gas',
        sourceSupplierId: values.sourceSupplierId || null,
        relatedNodeIds,
        relatedNodeNames,
        companyName: values.companyName || '',
        companyIntro: values.companyIntro || '',
        supplierProfileUrl: values.supplierProfileUrl || '',
        website: businessInfo['公司网址'] || '',
        employeesCount: businessInfo['人员规模'] || '',
        fitOems: Array.isArray(businessInfo['配套客户']) ? businessInfo['配套客户'] : [],
        exportCountries: Array.isArray(businessInfo['出口市场']) ? businessInfo['出口市场'] : [],
        mainProductNames: Array.isArray(businessInfo['主营产品']) ? businessInfo['主营产品'] : [],
        certificateItems,
        businessInfo,
        industrialCommercialInfo: values.industrialCommercialInfo || {},
        orgCode: values?.industrialCommercialInfo?.['统一社会信用代码'] || '',
        productCaseItems,
        financingItems: Array.isArray(values.financingItems) ? values.financingItems : [],
        softwareCopyrightItems: Array.isArray(values.softwareCopyrightItems) ? values.softwareCopyrightItems : [],
        courtNoticeItems: Array.isArray(values.courtNoticeItems) ? values.courtNoticeItems : [],
        equipmentItems,
        patentItems,
        adminLicenseItems,
        adminLicenseGsItems: Array.isArray(values.adminLicenseGsItems) ? values.adminLicenseGsItems : [],
        tradeCreditItems,
      }
      if (editId) {
        await updateGasSupplierProfile(editId, payload)
        message.success('修改成功')
      } else {
        await createGasSupplierProfile(payload)
        message.success('新增成功')
      }
      navigate('/gas-supplier-profiles')
    } catch (error) {
      if (!error?.errorFields) message.error(error.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const tabItems = [
    {
      key: 'a',
      label: 'A 基本信息',
      children: (
        <Row gutter={12}>
          <Col span={12}><Form.Item label="公司名称（关联供应商）" name="sourceSupplierRef" rules={[{ required: true, message: '请选择关联供应商' }]}><Select showSearch disabled={disabled} optionFilterProp="label" options={sourceOptions.map((item) => ({ label: `${item.companyName || '-'} / ${item.nodeName || '-'}`, value: Number(item.id) }))} onChange={handleSourceChange} /></Form.Item></Col>
          <Col span={12}><Form.Item label="公司名称" name="companyName" rules={[{ required: true, message: '请填写公司名称' }]}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={12}><Form.Item label="供应链节点" name="relatedNodeIds" rules={[{ required: true, message: '请选择供应链节点' }]}><TreeSelect treeData={treeSelectData} treeNodeFilterProp="title" multiple showSearch allowClear disabled={disabled} /></Form.Item></Col>
          <Col span={24}><Form.Item label="公司简介" name="companyIntro"><Input.TextArea rows={4} disabled={disabled} /></Form.Item></Col>
          <Col span={24}><Form.Item label="供应商档案URL" name="supplierProfileUrl"><Input disabled={disabled} /></Form.Item></Col>
        </Row>
      ),
    },
    {
      key: 'b',
      label: 'B 业务信息',
      children: (
        <Row gutter={12}>
          <Col span={8}><Form.Item label="人员规模" name={['businessInfo', '人员规模']}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={8}><Form.Item label="研发人数" name={['businessInfo', '研发人数']}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={8}><Form.Item label="年销售额" name={['businessInfo', '年销售额']}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={12}><Form.Item label="体系认证（多选）" name={['businessInfo', '体系认证']}><Select mode="multiple" disabled={disabled} options={certificationOptions.map((item) => ({ label: item.name, value: item.name }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="公司网址" name={['businessInfo', '公司网址']}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={12}><Form.Item label="配套客户" name={['businessInfo', '配套客户']}><Select mode="tags" disabled={disabled} tokenSeparators={[',', '，', ';', '；']} options={oemOptions.map((item) => ({ label: item.name, value: item.name }))} /></Form.Item></Col>
          <Col span={6}><Form.Item label="直接出口经验" name={['businessInfo', '直接出口经验']}><Select disabled={disabled} options={BOOL_OPTIONS} /></Form.Item></Col>
          <Col span={6}><Form.Item label="年出口额" name={['businessInfo', '年出口额']}><Input disabled={disabled} /></Form.Item></Col>
          <Col span={12}><Form.Item label="出口市场（多选）" name={['businessInfo', '出口市场']}><Select mode="multiple" disabled={disabled} options={countryOptions.map((item) => ({ label: item.name || item, value: item.name || item }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="主营产品（多选）" name={['businessInfo', '主营产品']}><Select mode="tags" disabled={disabled} tokenSeparators={[',', '，', ';', '；']} /></Form.Item></Col>
        </Row>
      ),
    },
    {
      key: 'c',
      label: 'C 产品案例/体系认证/企业设备',
      children: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Form.List name="productCaseItems">
            {(fields, { add, remove }) => (
              <Card size="small" title="产品案例">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline">
                      <Form.Item name={[field.name, 'productName']} style={{ marginBottom: 0 }}>
                        <Input placeholder="产品名称" disabled={disabled} />
                      </Form.Item>
                      {!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}
                    </Space>
                  ))}
                  {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ productName: '' })}>新增产品案例</Button> : null}
                </Space>
              </Card>
            )}
          </Form.List>
          <Form.List name="certificateItems">
            {(fields, { add, remove }) => (
              <Card size="small" title="体系认证">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline">
                      <Form.Item name={[field.name, 'name']} style={{ marginBottom: 0 }}>
                        <Input placeholder="认证名称" disabled={disabled} />
                      </Form.Item>
                      {!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}
                    </Space>
                  ))}
                  {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ name: '' })}>新增体系认证</Button> : null}
                </Space>
              </Card>
            )}
          </Form.List>
          <Form.List name="equipmentItems">
            {(fields, { add, remove }) => (
              <Card size="small" title="企业设备">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline">
                      <Form.Item name={[field.name, 'equipmentName']} style={{ marginBottom: 0 }}>
                        <Input placeholder="设备名称" disabled={disabled} />
                      </Form.Item>
                      {!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}
                    </Space>
                  ))}
                  {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ equipmentName: '' })}>新增企业设备</Button> : null}
                </Space>
              </Card>
            )}
          </Form.List>
        </Space>
      ),
    },
    { key: 'd', label: 'D 工商信息', children: <Row gutter={12}>{INDUSTRIAL_FIELDS.map((field) => <Col key={field} span={8}><Form.Item label={field} name={['industrialCommercialInfo', field]}><Input disabled={disabled} /></Form.Item></Col>)}</Row> },
    {
      key: 'e',
      label: 'E 专利信息',
      children: (
        <Form.List name="patentItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`专利信息 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'patentType']} label="专利类型"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'publishNo']} label="公开（公告）号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'publishDate']} label="公开（公告）日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'name']} label="名称"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ patentType: '', publishNo: '', publishDate: '', name: '' })}>新增专利信息</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'f',
      label: 'F 行政许可（信用中国）',
      children: (
        <Form.List name="adminLicenseItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`行政许可（信用中国） ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'permitNo']} label="许可文件编号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'permitName']} label="许可文件名称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'validFrom']} label="有效期自"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'validTo']} label="有效期至"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'authority']} label="许可机关"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'content']} label="许可内容"><Input.TextArea rows={2} disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ permitNo: '', permitName: '', validFrom: '', validTo: '', authority: '', content: '' })}>新增行政许可（信用中国）</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'g',
      label: 'G 进出口信用',
      children: (
        <Form.List name="tradeCreditItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`进出口信用 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'recordDate']} label="日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'category']} label="分类"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={12}><Form.Item name={[field.name, 'content']} label="内容"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ recordDate: '', category: '', content: '' })}>新增进出口信用</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'h',
      label: 'H 融资信息',
      children: (
        <Form.List name="financingItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`融资信息 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'financingDate']} label="融资时间"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'round']} label="融资轮次"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'amount']} label="融资金额"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'investors']} label="投资方"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ financingDate: '', round: '', amount: '', investors: '' })}>新增融资信息</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'i',
      label: 'I 软件著作权',
      children: (
        <Form.List name="softwareCopyrightItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`软件著作权 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'softwareName']} label="软件名称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'version']} label="版本号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'releaseDate']} label="发布日期"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'softwareAlias']} label="软件简称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'registrationNo']} label="登记号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'approvalDate']} label="登记批准日期"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ softwareName: '', version: '', releaseDate: '', softwareAlias: '', registrationNo: '', approvalDate: '' })}>新增软件著作权</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'j',
      label: 'J 开庭公告',
      children: (
        <Form.List name="courtNoticeItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`开庭公告 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'caseNo']} label="案号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'hearingDate']} label="开庭时间"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'cause']} label="案由"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'plaintiff']} label="公告人/原告/上诉人/申请人"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'defendant']} label="被告人/被告/被上诉人/被申诉人"><Input disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ caseNo: '', hearingDate: '', cause: '', plaintiff: '', defendant: '' })}>新增开庭公告</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
    {
      key: 'k',
      label: 'K 行政许可（工商局）',
      children: (
        <Form.List name="adminLicenseGsItems">
          {(fields, { add, remove }) => (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" title={`工商局行政许可 ${index + 1}`} extra={!disabled ? <Button type="link" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>删除</Button> : null}>
                  <Row gutter={12}>
                    <Col span={6}><Form.Item name={[field.name, 'permitNo']} label="许可文件编号"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={6}><Form.Item name={[field.name, 'permitName']} label="许可文件名称"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'validFrom']} label="有效期自"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'validTo']} label="有效期至"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={4}><Form.Item name={[field.name, 'authority']} label="许可机关"><Input disabled={disabled} /></Form.Item></Col>
                    <Col span={24}><Form.Item name={[field.name, 'content']} label="许可内容"><Input.TextArea rows={2} disabled={disabled} /></Form.Item></Col>
                  </Row>
                </Card>
              ))}
              {!disabled ? <Button icon={<PlusOutlined />} onClick={() => add({ permitNo: '', permitName: '', validFrom: '', validTo: '', authority: '', content: '' })}>新增工商局行政许可</Button> : null}
            </Space>
          )}
        </Form.List>
      ),
    },
  ]

  return (
    <Card className="app-elevated-card">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space direction="vertical" size={2}>
            <Title level={4} style={{ margin: 0 }}>{pageTitle}</Title>
            <Text className="muted">{editId ? `记录ID：${editId}` : '创建GAS供应商档案'}</Text>
          </Space>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/gas-supplier-profiles')}>返回列表</Button>
            <Button type="primary" loading={loading} icon={<SaveOutlined />} onClick={submit}>{isViewMode ? '返回' : '保存'}</Button>
          </Space>
        </Space>

        <Form form={form} layout="vertical" disabled={loading}>
          <Form.Item name="sourceSupplierId" hidden><Input /></Form.Item>
          <Tabs items={tabItems} />
        </Form>
      </Space>
    </Card>
  )
}

export default GasSupplierProfileFormPage
