import { SearchOutlined } from '@ant-design/icons'
import { Button, Col, Empty, Input, InputNumber, Modal, Radio, Row, Select, Slider, Space, Spin, Tag, Tree, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import {
  fetchGasSupplierPortraitSettings,
  fetchGasSupplierProfileDetail,
  fetchGasSupplierProfileOptions,
  fetchGasSupplierProfiles,
  saveGasSupplierPortraitSettings,
} from '../api/gasSupplierProfileApi'
import { buildGasSupplierPortrait, GAS_PORTRAIT_PRESETS, readPortraitSettings, savePortraitSettings } from '../utils/gasSupplierPortrait'

const { Text } = Typography

function GasSupplierPortraitWorkspacePage() {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [modalKeyword, setModalKeyword] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftPresetKey, setDraftPresetKey] = useState('balanced')
  const [draftThresholdByPreset, setDraftThresholdByPreset] = useState({})
  const [draftFieldWeightsByPreset, setDraftFieldWeightsByPreset] = useState({})

  const [profiles, setProfiles] = useState([])
  const [supplyChainTree, setSupplyChainTree] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState()
  const [selectedProfileId, setSelectedProfileId] = useState()
  const [committedProfileId, setCommittedProfileId] = useState()
  const [listLoading, setListLoading] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [portraitSettings, setPortraitSettings] = useState(() => readPortraitSettings())

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const remote = await fetchGasSupplierPortraitSettings()
        if (!remote || typeof remote !== 'object') return
        const presetKey = GAS_PORTRAIT_PRESETS[remote?.presetKey] ? remote.presetKey : (portraitSettings?.presetKey || 'balanced')
        const preset = GAS_PORTRAIT_PRESETS[presetKey] || GAS_PORTRAIT_PRESETS.balanced
        const next = savePortraitSettings({
          presetKey,
          weights: remote?.weights || preset.weights,
          dimensionWeights: remote?.dimensionWeights || preset.dimensionWeights,
          threshold: remote?.threshold || preset.threshold,
          thresholdByPreset: remote?.thresholdByPreset || {},
          fieldWeightsByPreset: remote?.fieldWeightsByPreset || {},
        })
        setPortraitSettings(next)
      } catch {
        // Keep local fallback when remote settings are unavailable.
      }
    }
    loadSettings()
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    setDraftPresetKey(portraitSettings?.presetKey || 'balanced')
    const initial = Object.fromEntries(
      Object.entries(GAS_PORTRAIT_PRESETS).map(([key, preset]) => [key, JSON.parse(JSON.stringify(preset.threshold))]),
    )
    if (portraitSettings?.presetKey && portraitSettings?.threshold) {
      initial[portraitSettings.presetKey] = {
        ...initial[portraitSettings.presetKey],
        ...portraitSettings.threshold,
      }
    }
    if (portraitSettings?.thresholdByPreset && typeof portraitSettings.thresholdByPreset === 'object') {
      Object.entries(portraitSettings.thresholdByPreset).forEach(([key, threshold]) => {
        if (!initial[key]) return
        initial[key] = { ...initial[key], ...(threshold || {}) }
      })
    }
    setDraftThresholdByPreset(initial)
    setDraftFieldWeightsByPreset(
      portraitSettings?.fieldWeightsByPreset && typeof portraitSettings.fieldWeightsByPreset === 'object'
        ? portraitSettings.fieldWeightsByPreset
        : {},
    )
  }, [settingsOpen, portraitSettings])

  useEffect(() => {
    const load = async () => {
      setListLoading(true)
      try {
        const [rows, options] = await Promise.all([
          fetchGasSupplierProfiles({ limit: 5000 }),
          fetchGasSupplierProfileOptions(),
        ])
        setProfiles(Array.isArray(rows) ? rows : [])
        setSupplyChainTree(Array.isArray(options?.supplyChainTree) ? options.supplyChainTree : [])
      } catch (error) {
        message.error(error.message || '加载企业列表失败')
        setProfiles([])
        setSupplyChainTree([])
      } finally {
        setListLoading(false)
      }
    }
    if (!searchOpen) return
    load()
  }, [searchOpen])

  const portrait = useMemo(
    () => buildGasSupplierPortrait(selectedProfile || {}, portraitSettings),
    [selectedProfile, portraitSettings],
  )

  const displayPortrait = useMemo(() => {
    if (selectedProfile) return portrait
    return {
      ...portrait,
      totalScore: 0,
      dimensions: (portrait.dimensions || []).map((item) => ({
        ...item,
        score: 0,
        quality: 0,
        risk: 0,
        activity: 0,
      })),
    }
  }, [selectedProfile, portrait])

  const radarData = useMemo(
    () => (displayPortrait.dimensions || []).map((item) => ({ code: item.code, score: item.score })),
    [displayPortrait],
  )

  const businessCategories = useMemo(() => {
    const dimensions = displayPortrait.dimensions || []
    const weighted = (keys) => {
      const rows = dimensions.filter((item) => keys.includes(item.key))
      if (rows.length === 0) return 0
      const weightSum = rows.reduce((sum, item) => sum + Number(item.weight || 0), 0)
      if (weightSum <= 0) return Math.round(rows.reduce((sum, item) => sum + Number(item.score || 0), 0) / rows.length)
      return Math.round(rows.reduce((sum, item) => sum + Number(item.score || 0) * Number(item.weight || 0), 0) / weightSum)
    }
    const operationResilience = weighted(['d', 'f', 'j', 'k'])
    const growthPotential = weighted(['e', 'h', 'i'])
    const businessExpansion = weighted(['b', 'c', 'g'])
    const groupWeight = (keys) => dimensions
      .filter((item) => keys.includes(item.key))
      .reduce((sum, item) => sum + Number(item.weight || 0), 0)

    const toLevel = (score) => {
      if (score >= 75) return '高'
      if (score >= 50) return '中'
      return '低'
    }

    return [
      {
        key: 'operation-resilience',
        name: '经营韧性',
        desc: '看经营基本盘与合规稳健程度',
        score: operationResilience,
        weight: groupWeight(['d', 'f', 'j', 'k']),
        level: toLevel(operationResilience),
      },
      {
        key: 'growth-potential',
        name: '成长潜力',
        desc: '看资本成长与研发创新能力',
        score: growthPotential,
        weight: groupWeight(['e', 'h', 'i']),
        level: toLevel(growthPotential),
      },
      {
        key: 'business-expansion',
        name: '业务拓展',
        desc: '看供应链匹配与国际化拓展能力',
        score: businessExpansion,
        weight: groupWeight(['b', 'c', 'g']),
        level: toLevel(businessExpansion),
      },
    ]
  }, [displayPortrait])

  const weightedDimensionSummary = useMemo(() => {
    const rows = (displayPortrait.dimensions || []).map((item) => {
      const weight = Number(item.weight || 0)
      const score = Number(item.score || 0)
      const contribution = Math.round(score * (weight / 100) * 10) / 10
      return { ...item, weight, score, contribution }
    })
    const totalContribution = Math.round(rows.reduce((sum, item) => sum + Number(item.contribution || 0), 0) * 10) / 10
    return { rows, totalContribution }
  }, [displayPortrait])

  const keyBusinessMetrics = useMemo(() => {
    const business = selectedProfile?.businessInfo || {}
    const industrial = selectedProfile?.industrialCommercialInfo || {}
    const patents = Array.isArray(selectedProfile?.patentItems) ? selectedProfile.patentItems : []
    const softs = Array.isArray(selectedProfile?.softwareCopyrightItems) ? selectedProfile.softwareCopyrightItems : []
    const tradeCredits = Array.isArray(selectedProfile?.tradeCreditItems) ? selectedProfile.tradeCreditItems : []
    const financings = Array.isArray(selectedProfile?.financingItems) ? selectedProfile.financingItems : []
    const creditLicenses = Array.isArray(selectedProfile?.adminLicenseItems) ? selectedProfile.adminLicenseItems : []
    const gsLicenses = Array.isArray(selectedProfile?.adminLicenseGsItems) ? selectedProfile.adminLicenseGsItems : []
    const courtNotices = Array.isArray(selectedProfile?.courtNoticeItems) ? selectedProfile.courtNoticeItems : []
    const exportCountries = Array.isArray(selectedProfile?.exportCountries) ? selectedProfile.exportCountries : []
    const fitOems = Array.isArray(selectedProfile?.fitOems) ? selectedProfile.fitOems : []
    const productCases = Array.isArray(selectedProfile?.productCaseItems) ? selectedProfile.productCaseItems : []
    const certificates = Array.isArray(selectedProfile?.certificateItems) ? selectedProfile.certificateItems : []
    const equipments = Array.isArray(selectedProfile?.equipmentItems) ? selectedProfile.equipmentItems : []
    const pick = (value) => {
      const text = String(value ?? '').trim()
      return text || '-'
    }
    return {
      b: [
        { label: '人员规模', value: pick(business['人员规模'] || selectedProfile?.employeesCount) },
        { label: '研发人数', value: pick(business['研发人数']) },
        { label: '年销售额', value: pick(business['年销售额']) },
        { label: '配套客户数', value: fitOems.length || 0 },
      ],
      c: [
        { label: '产品案例数', value: productCases.length || 0 },
        { label: '体系认证数', value: certificates.length || 0 },
        { label: '设备数', value: equipments.length || 0 },
      ],
      d: [
        { label: '参保人数', value: pick(industrial['参保人数']) },
        { label: '注册资本', value: pick(industrial['注册资本'] || selectedProfile?.registeredCapital) },
        { label: '经营状态', value: pick(industrial['经营状态']) },
      ],
      e: [{ label: '专利数', value: patents.length || 0 }],
      f: [{ label: '信用中国许可数', value: creditLicenses.length || 0 }],
      g: [
        { label: '贸易信用数', value: tradeCredits.length || 0 },
        { label: '出口国家数', value: exportCountries.length || 0 },
        { label: '年出口额', value: pick(business['年出口额']) },
      ],
      h: [{ label: '融资事件数', value: financings.length || 0 }],
      i: [{ label: '软著数', value: softs.length || 0 }],
      j: [{ label: '司法公告数', value: courtNotices.length || 0 }],
      k: [{ label: '工商许可数', value: gsLicenses.length || 0 }],
    }
  }, [selectedProfile])

  const tooltipMetricsByCode = useMemo(() => {
    const map = {}
    ;(displayPortrait.dimensions || []).forEach((item) => {
      map[item.code] = keyBusinessMetrics[item.key] || []
    })
    return map
  }, [displayPortrait, keyBusinessMetrics])

  const activePreviewPortrait = useMemo(() => {
    const preset = GAS_PORTRAIT_PRESETS[draftPresetKey] || GAS_PORTRAIT_PRESETS.balanced
    const threshold = draftThresholdByPreset[draftPresetKey] || preset.threshold
    return buildGasSupplierPortrait(selectedProfile || {}, {
      presetKey: draftPresetKey,
      weights: preset.weights,
      dimensionWeights: preset.dimensionWeights,
      threshold,
    })
  }, [selectedProfile, draftPresetKey, draftThresholdByPreset])

  const thresholdGroups = useMemo(() => [
    {
      group: '供应链匹配',
      fields: [
        { label: '人员规模', key: 'employees', min: 0, max: 2000, step: 10, tierLabels: ['100以下', '500人', '1000人以上'], anchorValues: [100, 500, 1000] },
        { label: '研发人数', key: 'rd', min: 0, max: 300, step: 1, tierLabels: ['30以下', '80人', '120人以上'], anchorValues: [30, 80, 120] },
        { label: '年销售额（亿）', key: 'salesYi', min: 0, max: 50, step: 1, tierLabels: ['5以下', '20亿', '50亿以上'], anchorValues: [5, 20, 50] },
        { label: '体系认证数', key: 'certCount', min: 0, max: 10, step: 1, tierLabels: ['1以下', '3个', '5个以上'], anchorValues: [1, 3, 5] },
        { label: '配套客户数', key: 'oemCount', min: 0, max: 15, step: 1, tierLabels: ['1以下', '4家', '8家以上'], anchorValues: [1, 4, 8] },
      ],
    },
    {
      group: '配套匹配',
      fields: [
        { label: '产品案例数', key: 'productCaseCount', min: 0, max: 30, step: 1, tierLabels: ['2以下', '6个', '10个以上'], anchorValues: [2, 6, 10] },
        { label: '证书数', key: 'certCount', min: 0, max: 10, step: 1, tierLabels: ['1以下', '3个', '5个以上'], anchorValues: [1, 3, 5] },
        { label: '设备数', key: 'equipmentCount', min: 0, max: 50, step: 1, tierLabels: ['3以下', '10台', '20台以上'], anchorValues: [3, 10, 20] },
      ],
    },
    {
      group: '经营基本盘',
      fields: [
        { label: '工商完整度(%)', key: 'industrialFilledRatio', min: 0, max: 100, step: 1, percentMode: true, tierLabels: ['50%以下', '80%', '90%以上'], anchorValues: [50, 80, 90] },
        { label: '参保人数', key: 'insuredCount', min: 0, max: 2000, step: 10, tierLabels: ['100以下', '500人', '1000人以上'], anchorValues: [100, 500, 1000] },
        { label: '注册资本（亿）', key: 'registeredCapitalYi', min: 0, max: 50, step: 1, tierLabels: ['2以下', '10亿', '20亿以上'], anchorValues: [2, 10, 20] },
      ],
    },
    {
      group: '科研能力(专利)',
      fields: [{ label: '专利数', key: 'patentCount', min: 0, max: 100, step: 1, tierLabels: ['10以下', '50个', '80个以上'], anchorValues: [10, 50, 80] }],
    },
    {
      group: '合规资质(信用中国)',
      fields: [{ label: '信用中国许可数', key: 'licenseCount', min: 0, max: 20, step: 1, tierLabels: ['2以下', '6个', '10个以上'], anchorValues: [2, 6, 10] }],
    },
    {
      group: '国际化能力',
      fields: [
        { label: '贸易信用数', key: 'tradeCreditCount', min: 0, max: 20, step: 1, tierLabels: ['2以下', '8个', '12个以上'], anchorValues: [2, 8, 12] },
        { label: '出口国家数', key: 'exportCountries', min: 0, max: 30, step: 1, tierLabels: ['3以下', '8国', '12国以上'], anchorValues: [3, 8, 12] },
        { label: '年出口额（亿）', key: 'exportYi', min: 0, max: 30, step: 1, tierLabels: ['2以下', '10亿', '20亿以上'], anchorValues: [2, 10, 20] },
      ],
    },
    {
      group: '资本成长性',
      fields: [{ label: '融资事件数', key: 'financingCount', min: 0, max: 20, step: 1, tierLabels: ['2以下', '6次', '10次以上'], anchorValues: [2, 6, 10] }],
    },
    {
      group: '科研能力(软著)',
      fields: [{ label: '软著数', key: 'softCount', min: 0, max: 100, step: 1, tierLabels: ['8以下', '40个', '60个以上'], anchorValues: [8, 40, 60] }],
    },
    {
      group: '合规资质(工商局)',
      fields: [{ label: '工商许可数', key: 'gsLicenseCount', min: 0, max: 20, step: 1, tierLabels: ['2以下', '5个', '8个以上'], anchorValues: [2, 5, 8] }],
    },
  ], [])

  const weightRowIds = useMemo(
    () => thresholdGroups.flatMap((group) => group.fields.map((item) => `${group.group}:${item.key}`)),
    [thresholdGroups],
  )

  const activeDraftFieldWeights = useMemo(
    () => (draftFieldWeightsByPreset?.[draftPresetKey] || {}),
    [draftFieldWeightsByPreset, draftPresetKey],
  )

  const weightTotal = useMemo(
    () => weightRowIds.reduce((sum, id) => sum + Number(activeDraftFieldWeights[id] || 0), 0),
    [activeDraftFieldWeights, weightRowIds],
  )

  useEffect(() => {
    if (!settingsOpen) return
    setDraftFieldWeightsByPreset((prev) => {
      const next = { ...(prev || {}) }
      Object.keys(GAS_PORTRAIT_PRESETS).forEach((presetKey) => {
        if (next[presetKey] && Object.keys(next[presetKey]).length > 0) return
        const base = {}
        const n = weightRowIds.length || 1
        const avg = Math.floor(100 / n)
        let remain = 100 - avg * n
        weightRowIds.forEach((id) => {
          const plus = remain > 0 ? 1 : 0
          base[id] = avg + plus
          if (remain > 0) remain -= 1
        })
        next[presetKey] = base
      })
      return next
    })
  }, [settingsOpen, weightRowIds])

  const activeDraftThreshold = draftThresholdByPreset[draftPresetKey] || GAS_PORTRAIT_PRESETS[draftPresetKey]?.threshold || GAS_PORTRAIT_PRESETS.balanced.threshold

  const updateRangeThreshold = (field, values = []) => {
    const [low, high] = values
    setDraftThresholdByPreset((prev) => ({
      ...prev,
      [draftPresetKey]: {
        ...(prev[draftPresetKey] || {}),
        [field]: {
          ...((prev[draftPresetKey] || {})[field] || {}),
          mid: Number(low),
          good: Number(high),
        },
      },
    }))
  }

  const updateSingleThreshold = (field, value) => {
    const v = Number(value || 0)
    updateRangeThreshold(field, [v, v])
  }

  const valueFromPercent = (item, percent) => {
    const anchors = item.anchorValues || [item.min, (item.min + item.max) / 2, item.max]
    const [a, b, c] = anchors.map((v) => Number(v))
    const p = Math.max(0, Math.min(100, Math.round(Number(percent || 0))))
    if (p <= 50) {
      if (b === a) return b
      const v = a + ((b - a) * p) / 50
      return Number.isInteger(a) && Number.isInteger(b) ? Math.round(v) : v
    }
    if (c === b) return c
    const v = b + ((c - b) * (p - 50)) / 50
    return Number.isInteger(b) && Number.isInteger(c) ? Math.round(v) : v
  }

  const percentFromValue = (item, rawValue) => {
    const anchors = item.anchorValues || [item.min, (item.min + item.max) / 2, item.max]
    const [a, b, c] = anchors.map((v) => Number(v))
    const v = Number(rawValue || 0)
    const vv = Math.max(Math.min(v, c), a)
    if (vv <= b) {
      if (b === a) return 50
      return Math.max(0, Math.min(50, ((vv - a) / (b - a)) * 50))
    }
    if (c === b) return 100
    return Math.max(50, Math.min(100, 50 + ((vv - b) / (c - b)) * 50))
  }

  const formatSliderValue = (item, value) => {
    const numRaw = Number(value ?? 0)
    const integerKeys = new Set([
      'employees', 'rd', 'insuredCount', 'certCount', 'oemCount', 'productCaseCount', 'equipmentCount',
      'patentCount', 'licenseCount', 'tradeCreditCount', 'exportCountries', 'financingCount', 'softCount', 'gsLicenseCount',
    ])
    const num = integerKeys.has(item.key) ? Math.round(numRaw) : Math.round(numRaw * 10) / 10
    if (!Number.isFinite(num)) return ''
    if (item.percentMode) return `${Math.round(num)}%`
    const unitByKey = {
      employees: '人',
      rd: '人',
      insuredCount: '人',
      salesYi: '亿',
      exportYi: '亿',
      registeredCapitalYi: '亿',
      certCount: '个',
      oemCount: '家',
      productCaseCount: '个',
      equipmentCount: '台',
      patentCount: '个',
      licenseCount: '个',
      tradeCreditCount: '个',
      exportCountries: '国',
      financingCount: '次',
      softCount: '个',
      gsLicenseCount: '个',
    }
    const unit = unitByKey[item.key] || ''
    const valueText = Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10)
    return `${valueText}${unit}`
  }

  const snapPercent = (p) => Math.max(0, Math.min(100, Math.round(Number(p || 0))))

  const updateRiskLevel = (level) => {
    const map = {
      low: { mid: 1, high: 3 },
      medium: { mid: 2, high: 5 },
      high: { mid: 3, high: 7 },
    }
    setDraftThresholdByPreset((prev) => ({
      ...prev,
      [draftPresetKey]: {
        ...(prev[draftPresetKey] || {}),
        courtCount: map[level] || map.medium,
      },
    }))
  }

  const currentRiskLevel = useMemo(() => {
    const high = Number(activeDraftThreshold?.courtCount?.high || 5)
    if (high <= 3) return 'low'
    if (high <= 5) return 'medium'
    return 'high'
  }, [activeDraftThreshold])

  const previewRadarData = useMemo(() => {
    // Use stable dimension keys instead of display names to avoid label drift breaking preview updates.
    const groupScoreMap = {}
    const dimensionKeyByGroup = {
      '供应链匹配': 'b',
      '配套匹配': 'c',
      '经营基本盘': 'd',
      '科研能力(专利)': 'e',
      '合规资质(信用中国)': 'f',
      '国际化能力': 'g',
      '资本成长性': 'h',
      '科研能力(软著)': 'i',
      '合规资质(工商局)': 'k',
    }
    thresholdGroups.forEach((group) => {
      let weightedSum = 0
      let weightSum = 0
      group.fields.forEach((item) => {
        const rowId = `${group.group}:${item.key}`
        const rawValue = Number(activeDraftThreshold?.[item.key]?.mid ?? item.min)
        const subScore = snapPercent(percentFromValue(item, rawValue))
        const subWeight = Number(activeDraftFieldWeights[rowId] || 0)
        if (subWeight > 0) {
          weightedSum += subScore * subWeight
          weightSum += subWeight
        }
      })
      const dimKey = dimensionKeyByGroup[group.group]
      if (dimKey) groupScoreMap[dimKey] = weightSum > 0 ? Math.round(weightedSum / weightSum) : 0
    })

    const riskLevelScoreMap = { low: 80, medium: 60, high: 40 }
    groupScoreMap.j = riskLevelScoreMap[currentRiskLevel] ?? 60

    return (activePreviewPortrait.dimensions || []).map((item) => ({
      code: item.code,
      score: groupScoreMap[item.key] ?? item.score ?? 0,
    }))
  }, [thresholdGroups, activeDraftThreshold, activeDraftFieldWeights, currentRiskLevel, activePreviewPortrait])

  const onSelectProfile = async (row) => {
    setDetailLoading(true)
    try {
      const detail = await fetchGasSupplierProfileDetail(row.id)
      setSelectedProfile(detail || null)
      setCommittedProfileId(Number(row.id))
      setSearchKeyword(detail?.companyName || row.companyName || '')
      setModalKeyword('')
      setSearchOpen(false)
    } catch (error) {
      message.error(error.message || '加载企业详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const treeData = useMemo(() => {
    const walk = (list = []) =>
      list.map((item) => ({
        key: String(item.id || item.value),
        title: item.title,
        children: walk(item.children || []),
      }))
    return walk(supplyChainTree)
  }, [supplyChainTree])

  const firstLevelTreeKeys = useMemo(
    () => treeData.map((item) => String(item.key)),
    [treeData],
  )

  const selectedNodeTitle = useMemo(() => {
    if (!selectedNodeId) return '未选择'
    const walk = (list = []) => {
      for (const item of list) {
        const itemId = Number(item.id || item.value)
        if (itemId === Number(selectedNodeId)) return item.title || String(itemId)
        const hit = walk(item.children || [])
        if (hit) return hit
      }
      return ''
    }
    return walk(supplyChainTree) || `节点ID:${selectedNodeId}`
  }, [selectedNodeId, supplyChainTree])

  const selectedNodeWithDescendantIds = useMemo(() => {
    const selectedId = Number(selectedNodeId)
    if (!Number.isInteger(selectedId) || selectedId <= 0) return new Set()
    const ids = new Set()
    const walk = (nodes = []) => {
      for (const node of nodes) {
        const nodeId = Number(node.id || node.value)
        if (!Number.isInteger(nodeId) || nodeId <= 0) continue
        ids.add(nodeId)
        walk(node.children || [])
      }
    }
    const findAndCollect = (nodes = []) => {
      for (const node of nodes) {
        const nodeId = Number(node.id || node.value)
        if (nodeId === selectedId) {
          ids.add(nodeId)
          walk(node.children || [])
          return true
        }
        if (findAndCollect(node.children || [])) return true
      }
      return false
    }
    findAndCollect(supplyChainTree)
    return ids
  }, [selectedNodeId, supplyChainTree])

  const visibleProfiles = useMemo(() => {
    const keyword = modalKeyword.trim().toLowerCase()
    if (!selectedNodeId) return []
    return profiles.filter((item) => {
      const relatedNodeIds = Array.isArray(item.relatedNodeIds) ? item.relatedNodeIds : []
      const normalizedNodeIds = relatedNodeIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
      const singleRelatedNodeId = Number(item.relatedNodeId)
      if (Number.isInteger(singleRelatedNodeId) && singleRelatedNodeId > 0 && !normalizedNodeIds.includes(singleRelatedNodeId)) {
        normalizedNodeIds.push(singleRelatedNodeId)
      }
      const byNode = normalizedNodeIds.some((nodeId) => selectedNodeWithDescendantIds.has(nodeId))
      if (!byNode) return false
      if (!keyword) return true
      const name = String(item.companyName || '').toLowerCase()
      return name.includes(keyword)
    })
  }, [profiles, selectedNodeId, selectedNodeWithDescendantIds, modalKeyword])

  const confirmSelect = async () => {
    const row = visibleProfiles.find((item) => Number(item.id) === Number(selectedProfileId))
    if (!row) {
      message.warning('请先选择一个供应商')
      return
    }
    await onSelectProfile(row)
  }

  return (
    <>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input
          value={searchKeyword}
          placeholder="搜索企业"
          prefix={<SearchOutlined />}
          readOnly
          onClick={() => {
            setSelectedProfileId(selectedProfileId || (selectedProfile?.id ? Number(selectedProfile.id) : undefined))
            setModalKeyword('')
            setSearchOpen(true)
          }}
          style={{ maxWidth: 420 }}
        />
        <Row gutter={12} style={{ width: '100%', height: '76vh' }}>
          <Col span={16} style={{ height: '100%' }}>
            {detailLoading ? (
              <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                <Spin />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                  data={radarData}
                  outerRadius="72%"
                >
                  <PolarGrid stroke="#7dd3fc" />
                  <PolarAngleAxis dataKey="code" tick={{ fill: '#0369a1', fontSize: 12 }} />
                  <Radar dataKey="score" stroke="#0ea5e9" fill="#38bdf8" fillOpacity={0.3} />
                  <RechartsTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const score = Number(payload?.[0]?.value || 0)
                      const metrics = tooltipMetricsByCode[String(label || '')] || []
                      return (
                        <div style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #dbeafe', borderRadius: 8, padding: '8px 10px', minWidth: 220 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: 16, color: '#0f172a', fontWeight: 600 }}>{String(label || '-')}</span>
                            <span style={{ fontSize: 18, color: '#0369a1', fontWeight: 700 }}>{score}</span>
                          </div>
                          <div style={{ marginTop: 6 }}>
                            {metrics.map((item) => (
                              <div key={`${String(label || '')}-${item.label}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, color: '#64748b' }}>{item.label}</span>
                                <span style={{ fontSize: 12, color: '#475569' }}>{String(item.value ?? '-')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </Col>
          <Col span={8} style={{ height: '100%' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, height: '100%', overflow: 'auto' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text strong>评分说明</Text>
                  <Button size="small" onClick={() => setSettingsOpen(true)}>
                    评分设置
                  </Button>
                </div>
                <Text>总分：{displayPortrait.totalScore || 0}</Text>
                <Text type="secondary">
                  当前规则：{displayPortrait.presetLabel || '均衡型'} / 质量{displayPortrait.weights?.quality ?? 0}% 风险{displayPortrait.weights?.risk ?? 0}% 活跃{displayPortrait.weights?.activity ?? 0}%
                </Text>
                <Text type="secondary">业务分类评分（高: 75-100 / 中: 50-74 / 低: 0-49）</Text>
                {businessCategories.map((item) => (
                  <div key={item.key} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <Text strong>{item.name}</Text>
                      <Text>{item.score}（{item.level}，权重{item.weight}%）</Text>
                    </div>
                    <Text type="secondary">{item.desc}</Text>
                  </div>
                ))}
                <Text type="secondary">维度分值与权重折算（折算分合计≈总分）</Text>
                {weightedDimensionSummary.rows.map((item) => (
                  <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Text>{item.code}（{item.weight}%）</Text>
                    <Text>{item.score} × {item.weight}% = {item.contribution}</Text>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px dashed #e5e7eb', paddingTop: 6 }}>
                  <Text strong>折算分合计</Text>
                  <Text strong>{weightedDimensionSummary.totalContribution}</Text>
                </div>

              </Space>
            </div>
          </Col>
        </Row>
      </Space>

      <Modal
        title="选择GAS供应商"
        open={searchOpen}
        width={1180}
        footer={[
          <Button key="cancel" onClick={() => setSearchOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={confirmSelect}>确认选择</Button>,
        ]}
        onCancel={() => setSearchOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8}>
            <Text type="secondary">当前供应链节点：</Text>
            <Tag color={selectedNodeId ? 'blue' : 'default'}>{selectedNodeTitle}</Tag>
          </Space>
          <Input
            autoFocus
            value={modalKeyword}
            placeholder="输入供应商名称搜索"
            prefix={<SearchOutlined />}
            onChange={(event) => setModalKeyword(event.target.value)}
          />
          <Row gutter={12}>
            <Col span={8}>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, minHeight: 420, maxHeight: 420, overflow: 'auto', padding: 8 }}>
                {listLoading ? <Spin /> : (
                  <Tree
                    treeData={treeData}
                    defaultExpandedKeys={firstLevelTreeKeys}
                    selectedKeys={selectedNodeId ? [String(selectedNodeId)] : []}
                    onSelect={(keys) => setSelectedNodeId(keys[0] ? Number(keys[0]) : undefined)}
                  />
                )}
              </div>
            </Col>
            <Col span={16}>
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, minHeight: 420, maxHeight: 420, overflow: 'hidden', padding: 0, background: '#fff' }}>
                {listLoading ? <Spin /> : (
                  selectedNodeId ? (
                    <div style={{ width: '100%', height: 420, overflowY: 'auto', overflowX: 'hidden' }}>
                      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: '28px minmax(220px, 2fr) minmax(120px, 0.9fr) minmax(180px, 1.2fr)', gap: 12, padding: '10px 12px', color: '#6b7280', background: '#fafafa', borderBottom: '1px solid #f0f0f0', fontWeight: 600 }}>
                        <span />
                        <span>供应商名称</span>
                        <span>供应链节点</span>
                        <span>统一社会信用代码</span>
                      </div>
                      <Radio.Group
                        style={{ width: '100%' }}
                        value={selectedProfileId}
                        onChange={(event) => setSelectedProfileId(Number(event.target.value))}
                      >
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          {visibleProfiles.map((item) => (
                            <Radio key={item.id} value={Number(item.id)} style={{ width: '100%', margin: 0, padding: '10px 12px', borderBottom: '1px solid #f5f5f5' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 0.9fr) minmax(180px, 1.2fr)', gap: 12, width: '100%', alignItems: 'center' }}>
                                <span title={item.companyName || `ID:${item.id}`} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '22px', fontWeight: 500 }}>
                                  {item.companyName || `ID:${item.id}`}
                                  {Number(item.id) === Number(committedProfileId) ? (
                                    <Tag color="blue" style={{ marginLeft: 8 }}>已选中</Tag>
                                  ) : null}
                                </span>
                                <span title={item.relatedNodeName || '-'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#475569' }}>{item.relatedNodeName || '-'}</span>
                                <span
                                  title={item.unifiedSocialCreditCode || item.orgCode || item.industrialCommercialInfo?.['统一社会信用代码'] || '-'}
                                  style={{ color: '#0f766e', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                  {item.unifiedSocialCreditCode || item.orgCode || item.industrialCommercialInfo?.['统一社会信用代码'] || '-'}
                                </span>
                              </div>
                            </Radio>
                          ))}
                        </Space>
                      </Radio.Group>
                    </div>
                  ) : (
                    <div style={{ minHeight: 380, display: 'grid', placeItems: 'center' }}>
                      <Empty description="请先选择供应链节点" />
                    </div>
                  )
                )}
              </div>
            </Col>
          </Row>
        </Space>
      </Modal>

      <Modal
        title="GAS供应商评分设置"
        open={settingsOpen}
        width={1480}
        cancelText="取消"
        onCancel={() => setSettingsOpen(false)}
        okText="确定"
        onOk={async () => {
          if (weightTotal !== 100) {
            message.warning('请先将权重合计调整为100%')
            return
          }
          const preset = GAS_PORTRAIT_PRESETS[draftPresetKey] || GAS_PORTRAIT_PRESETS.balanced
          const payload = {
            presetKey: draftPresetKey,
            weights: preset.weights,
            dimensionWeights: preset.dimensionWeights,
            threshold: activeDraftThreshold,
            thresholdByPreset: draftThresholdByPreset,
            fieldWeightsByPreset: draftFieldWeightsByPreset,
          }
          const next = savePortraitSettings(payload)
          try {
            await saveGasSupplierPortraitSettings(payload)
          } catch (error) {
            message.warning(error?.message || '数据库保存失败，已保存在本地浏览器')
          }
          setPortraitSettings(next)
          setSettingsOpen(false)
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap size={10}>
            {Object.entries(GAS_PORTRAIT_PRESETS).map(([key, preset]) => (
              <Button
                key={key}
                type={draftPresetKey === key ? 'primary' : 'default'}
                onClick={() => setDraftPresetKey(key)}
              >
                {preset.label}
              </Button>
            ))}
          </Space>

          <Row gutter={12} align="top">
            <Col span={9}>
              <div style={{ width: '100%', height: 420 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={previewRadarData} outerRadius="78%">
                    <PolarGrid stroke="#7dd3fc" />
                    <PolarAngleAxis dataKey="code" tick={{ fill: '#0369a1', fontSize: 12 }} />
                    <Radar dataKey="score" stroke="#0ea5e9" fill="#38bdf8" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col span={15}>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text strong>评分项设置</Text>
                  <Text type={weightTotal === 100 ? 'secondary' : 'danger'}>权重合计：{weightTotal}%（需等于100%）</Text>
                  {thresholdGroups.map((group) => (
                    <div key={group.group} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                      <Text strong>{group.group}</Text>
                      <div style={{ marginTop: 8 }}>
                        {group.fields.map((item) => {
                          const rowId = `${group.group}:${item.key}`
                          const rawMid = Number(activeDraftThreshold?.[item.key]?.mid ?? item.min)
                          const rawGood = Number(activeDraftThreshold?.[item.key]?.good ?? item.max)
                          const value = [Math.min(rawMid, rawGood), Math.max(rawMid, rawGood)]
                          const sliderPercent = Math.round(percentFromValue(item, value[0]))
                          const viewValue = item.percentMode ? [Math.round(value[0] * 100), Math.round(value[1] * 100)] : value
                          return (
                            <Row key={`${group.group}-${item.key}`} gutter={6} align="middle" style={{ marginTop: 8 }}>
                              <Col span={5}><Text>{item.label}</Text></Col>
                              <Col span={1}></Col>
                              <Col span={11}>
                                <div>
                                  <Slider
                                    min={0}
                                    max={100}
                                    step={1}
                                    tooltip={{
                                      formatter: (val) => {
                                        const p = snapPercent(Number(val))
                                        const mapped = valueFromPercent(item, p)
                                        return formatSliderValue(item, mapped)
                                      },
                                    }}
                                    value={sliderPercent}
                                    onChange={(val) => {
                                      const p = snapPercent(Number(val))
                                      const mapped = valueFromPercent(item, p)
                                      const normalized = item.percentMode ? mapped / 100 : mapped
                                      updateSingleThreshold(item.key, normalized)
                                    }}
                                  />
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginTop: -6 }}>
                                    <span>{item.tierLabels?.[0] || ''}</span>
                                    <span>{item.tierLabels?.[1] || ''}</span>
                                    <span>{item.tierLabels?.[2] || ''}</span>
                                  </div>
                                </div>
                              </Col>
                              <Col span={1}></Col>
                              <Col span={1}></Col>
                              <Col span={5}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                  <Text type="secondary">权重</Text>
                                  <InputNumber
                                    min={0}
                                    max={100}
                                    value={activeDraftFieldWeights[rowId] ?? 0}
                                    formatter={(v) => `${v ?? 0}%`}
                                    parser={(v) => String(v || '').replace('%', '')}
                                    onChange={(v) => {
                                      const next = Number(v || 0)
                                      setDraftFieldWeightsByPreset((prev) => {
                                        const currentPreset = { ...(prev?.[draftPresetKey] || {}) }
                                        const usedByOthers = Object.entries(currentPreset)
                                          .filter(([id]) => id !== rowId)
                                          .reduce((sum, [, val]) => sum + Number(val || 0), 0)
                                        const allowed = Math.max(0, 100 - usedByOthers)
                                        currentPreset[rowId] = Math.min(next, allowed)
                                        return { ...(prev || {}), [draftPresetKey]: currentPreset }
                                      })
                                    }}
                                    style={{ width: 72 }}
                                  />
                                </div>
                              </Col>
                            </Row>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  <Row gutter={8} align="middle">
                    <Col span={6}><Text>司法风险敏感度</Text></Col>
                    <Col span={18}>
                      <Select
                        style={{ width: 220 }}
                        value={currentRiskLevel}
                        onChange={updateRiskLevel}
                        options={[
                          { value: 'low', label: '低' },
                          { value: 'medium', label: '中' },
                          { value: 'high', label: '高' },
                        ]}
                      />
                    </Col>
                  </Row>
                </Space>
              </div>
            </Col>
          </Row>
        </Space>
      </Modal>
    </>
  )
}

export default GasSupplierPortraitWorkspacePage
