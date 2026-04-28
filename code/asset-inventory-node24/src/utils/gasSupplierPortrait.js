function clampScore(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asText(value) {
  return String(value || '').trim()
}

function extractNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = asText(value)
  const m = text.match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}

function parseMoneyYi(value) {
  const text = asText(value)
  if (!text) return 0
  const n = extractNumber(text)
  if (/亿/.test(text)) return n
  if (/万/.test(text)) return n / 10000
  if (/千/.test(text)) return n / 10000000
  if (/百/.test(text)) return n / 100000000
  return n / 100000000
}

function scoreByThreshold(value, threshold) {
  if (value >= threshold.good) return 100
  if (value >= threshold.mid) return 70
  if (value > 0) return 40
  return 0
}

function inverseRiskByCount(value, threshold) {
  if (value >= threshold.high) return 20
  if (value >= threshold.mid) return 50
  if (value > 0) return 75
  return 95
}

export const GAS_PORTRAIT_SETTING_STORAGE_KEY = 'gas-portrait-score-settings'

export const GAS_PORTRAIT_PRESETS = {
  balanced: {
    label: '均衡型',
    weights: { quality: 45, risk: 35, activity: 20 },
    dimensionWeights: { b: 18, c: 12, d: 14, e: 12, f: 10, g: 8, h: 10, i: 8, j: 4, k: 4 },
    threshold: {
      employees: { good: 1000, mid: 300 },
      rd: { good: 120, mid: 30 },
      salesYi: { good: 20, mid: 5 },
      certCount: { good: 3, mid: 1 },
      oemCount: { good: 4, mid: 1 },
      exportYi: { good: 10, mid: 2 },
      exportCountries: { good: 8, mid: 3 },
      patentCount: { good: 50, mid: 10 },
      softCount: { good: 40, mid: 8 },
      financingCount: { good: 6, mid: 2 },
      tradeCreditCount: { good: 8, mid: 2 },
      licenseCount: { good: 6, mid: 2 },
      gsLicenseCount: { good: 5, mid: 2 },
      courtCount: { high: 5, mid: 2 },
      industrialFilledRatio: { good: 0.8, mid: 0.5 },
    },
  },
  robust: {
    label: '稳健型（风险优先）',
    weights: { quality: 35, risk: 50, activity: 15 },
    dimensionWeights: { b: 14, c: 10, d: 18, e: 10, f: 12, g: 10, h: 8, i: 6, j: 8, k: 4 },
    threshold: {
      employees: { good: 800, mid: 200 },
      rd: { good: 80, mid: 20 },
      salesYi: { good: 15, mid: 3 },
      certCount: { good: 4, mid: 2 },
      oemCount: { good: 3, mid: 1 },
      exportYi: { good: 8, mid: 1.5 },
      exportCountries: { good: 6, mid: 2 },
      patentCount: { good: 35, mid: 8 },
      softCount: { good: 25, mid: 5 },
      financingCount: { good: 4, mid: 1 },
      tradeCreditCount: { good: 6, mid: 2 },
      licenseCount: { good: 8, mid: 3 },
      gsLicenseCount: { good: 6, mid: 2 },
      courtCount: { high: 3, mid: 1 },
      industrialFilledRatio: { good: 0.85, mid: 0.6 },
    },
  },
  growth: {
    label: '成长型（活跃优先）',
    weights: { quality: 35, risk: 25, activity: 40 },
    dimensionWeights: { b: 16, c: 14, d: 10, e: 14, f: 8, g: 10, h: 14, i: 8, j: 2, k: 4 },
    threshold: {
      employees: { good: 600, mid: 150 },
      rd: { good: 60, mid: 15 },
      salesYi: { good: 10, mid: 2 },
      certCount: { good: 2, mid: 1 },
      oemCount: { good: 5, mid: 2 },
      exportYi: { good: 6, mid: 1 },
      exportCountries: { good: 10, mid: 4 },
      patentCount: { good: 70, mid: 15 },
      softCount: { good: 60, mid: 12 },
      financingCount: { good: 8, mid: 3 },
      tradeCreditCount: { good: 10, mid: 3 },
      licenseCount: { good: 5, mid: 2 },
      gsLicenseCount: { good: 4, mid: 1 },
      courtCount: { high: 6, mid: 2 },
      industrialFilledRatio: { good: 0.75, mid: 0.45 },
    },
  },
}

export function normalizePortraitWeights(input = {}) {
  const quality = Number(input?.quality ?? 45)
  const risk = Number(input?.risk ?? 35)
  const activity = Number(input?.activity ?? 20)
  const sum = quality + risk + activity
  if (!Number.isFinite(sum) || sum <= 0) return { quality: 45, risk: 35, activity: 20 }
  const q = Math.round((quality / sum) * 100)
  const r = Math.round((risk / sum) * 100)
  return { quality: q, risk: r, activity: Math.max(0, 100 - q - r) }
}

export function readPortraitSettings() {
  try {
    const raw = localStorage.getItem(GAS_PORTRAIT_SETTING_STORAGE_KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const presetKey = saved?.preset && GAS_PORTRAIT_PRESETS[saved.preset] ? saved.preset : 'balanced'
    const preset = GAS_PORTRAIT_PRESETS[presetKey]
    const weights = normalizePortraitWeights(saved?.weights || preset.weights)
    const dimensionWeights = { ...preset.dimensionWeights, ...(saved?.dimensionWeights || {}) }
    const threshold = {
      ...preset.threshold,
      ...(saved?.threshold || {}),
      employees: { ...preset.threshold.employees, ...(saved?.threshold?.employees || {}) },
      rd: { ...preset.threshold.rd, ...(saved?.threshold?.rd || {}) },
      salesYi: { ...preset.threshold.salesYi, ...(saved?.threshold?.salesYi || {}) },
      patentCount: { ...preset.threshold.patentCount, ...(saved?.threshold?.patentCount || {}) },
      financingCount: { ...preset.threshold.financingCount, ...(saved?.threshold?.financingCount || {}) },
      softCount: { ...preset.threshold.softCount, ...(saved?.threshold?.softCount || {}) },
      courtCount: { ...preset.threshold.courtCount, ...(saved?.threshold?.courtCount || {}) },
    }
    return { presetKey, weights, dimensionWeights, threshold }
  } catch {
    const preset = GAS_PORTRAIT_PRESETS.balanced
    return { presetKey: 'balanced', weights: preset.weights, dimensionWeights: preset.dimensionWeights, threshold: preset.threshold }
  }
}

export function savePortraitSettings(input = {}) {
  const presetKey = input?.presetKey && GAS_PORTRAIT_PRESETS[input.presetKey] ? input.presetKey : 'balanced'
  const preset = GAS_PORTRAIT_PRESETS[presetKey]
  const weights = normalizePortraitWeights(input?.weights || preset.weights)
  const saved = {
    preset: presetKey,
    weights,
    dimensionWeights: input?.dimensionWeights || preset.dimensionWeights,
    threshold: input?.threshold || preset.threshold,
  }
  localStorage.setItem(GAS_PORTRAIT_SETTING_STORAGE_KEY, JSON.stringify(saved))
  return { presetKey, weights, dimensionWeights: saved.dimensionWeights, threshold: saved.threshold }
}

export function buildGasSupplierPortrait(profile = {}, settings = {}) {
  const presetKey = settings?.presetKey && GAS_PORTRAIT_PRESETS[settings.presetKey] ? settings.presetKey : 'balanced'
  const preset = GAS_PORTRAIT_PRESETS[presetKey]
  const weights = normalizePortraitWeights(settings?.weights || preset.weights)
  const t = settings?.threshold || preset.threshold
  const dimensionWeights = settings?.dimensionWeights || preset.dimensionWeights

  const business = profile.businessInfo || {}
  const industrial = profile.industrialCommercialInfo || {}

  const fitOems = asArray(profile.fitOems || business['配套客户'])
  const mainProducts = asArray(profile.mainProductNames || business['主营产品'])
  const exportCountries = asArray(profile.exportCountries || business['出口市场'])
  const patents = asArray(profile.patentItems)
  const softwareCopyrights = asArray(profile.softwareCopyrightItems)
  const courtNotices = asArray(profile.courtNoticeItems)
  const creditLicenses = asArray(profile.adminLicenseItems)
  const gsLicenses = asArray(profile.adminLicenseGsItems)
  const financings = asArray(profile.financingItems)
  const tradeCredits = asArray(profile.tradeCreditItems)
  const productCases = asArray(profile.productCaseItems)
  const certificates = asArray(profile.certificateItems)
  const equipments = asArray(profile.equipmentItems)

  const employeeCount = extractNumber(business['人员规模'])
  const rdCount = extractNumber(business['研发人数'])
  const salesYi = parseMoneyYi(business['年销售额'])
  const exportYi = parseMoneyYi(business['年出口额'])
  const industrialKeys = [
    '法定代表人', '注册资本', '经营状态', '统一社会信用代码', '成立时间', '所属行业', '登记机关', '营业期限',
  ]
  const industrialFilledRatio = industrialKeys.filter((k) => asText(industrial[k]).length > 0).length / industrialKeys.length

  const dimensions = [
    {
      key: 'b',
      code: '供应链匹配',
      quality: clampScore((scoreByThreshold(employeeCount, t.employees) + scoreByThreshold(rdCount, t.rd) + scoreByThreshold(salesYi, t.salesYi) + scoreByThreshold(asArray(business['体系认证']).length || certificates.length, t.certCount)) / 4),
      risk: clampScore((scoreByThreshold(fitOems.length, t.oemCount) + scoreByThreshold(exportCountries.length, t.exportCountries)) / 2),
      activity: clampScore((scoreByThreshold(mainProducts.length, { good: 8, mid: 3 }) + scoreByThreshold(exportYi, t.exportYi)) / 2),
    },
    {
      key: 'c',
      code: '配套匹配',
      quality: clampScore((scoreByThreshold(productCases.length, { good: 6, mid: 2 }) + scoreByThreshold(certificates.length, t.certCount) + scoreByThreshold(equipments.length, { good: 10, mid: 3 })) / 3),
      risk: clampScore((scoreByThreshold(certificates.length, t.certCount) + scoreByThreshold(equipments.length, { good: 8, mid: 2 })) / 2),
      activity: clampScore((scoreByThreshold(productCases.length, { good: 10, mid: 3 }) + scoreByThreshold(equipments.length, { good: 12, mid: 4 })) / 2),
    },
    {
      key: 'd',
      code: '经营基本盘',
      quality: clampScore(scoreByThreshold(industrialFilledRatio, t.industrialFilledRatio)),
      risk: clampScore((industrial['经营状态'] === '存续' ? 95 : 55) + (asText(industrial['统一社会信用代码']) ? 5 : -20)),
      activity: clampScore((scoreByThreshold(extractNumber(industrial['参保人数']), { good: 500, mid: 100 }) + scoreByThreshold(parseMoneyYi(industrial['注册资本']), { good: 10, mid: 2 })) / 2),
    },
    {
      key: 'e',
      code: '科研能力(专利)',
      quality: clampScore(scoreByThreshold(patents.length, t.patentCount)),
      risk: clampScore(45 + Math.min(50, patents.length * 6)),
      activity: clampScore(scoreByThreshold(patents.length, t.patentCount)),
    },
    {
      key: 'f',
      code: '合规资质(信用中国)',
      quality: clampScore(scoreByThreshold(creditLicenses.length, t.licenseCount)),
      risk: clampScore(40 + Math.min(55, creditLicenses.length * 9)),
      activity: clampScore(scoreByThreshold(creditLicenses.length, t.licenseCount)),
    },
    {
      key: 'g',
      code: '国际化能力',
      quality: clampScore(scoreByThreshold(tradeCredits.length, t.tradeCreditCount)),
      risk: clampScore(45 + Math.min(50, tradeCredits.length * 8)),
      activity: clampScore(scoreByThreshold(tradeCredits.length, t.tradeCreditCount)),
    },
    {
      key: 'h',
      code: '资本成长性',
      quality: clampScore(scoreByThreshold(financings.length, t.financingCount)),
      risk: clampScore(55 + Math.min(40, financings.length * 7)),
      activity: clampScore(scoreByThreshold(financings.length, t.financingCount)),
    },
    {
      key: 'i',
      code: '科研能力(软著)',
      quality: clampScore(scoreByThreshold(softwareCopyrights.length, t.softCount)),
      risk: clampScore(50 + Math.min(45, softwareCopyrights.length * 7)),
      activity: clampScore(scoreByThreshold(softwareCopyrights.length, t.softCount)),
    },
    {
      key: 'j',
      code: '司法风险(负向)',
      quality: clampScore(inverseRiskByCount(courtNotices.length, t.courtCount)),
      risk: clampScore(inverseRiskByCount(courtNotices.length, t.courtCount)),
      activity: clampScore(Math.max(0, 70 - courtNotices.length * 12)),
    },
    {
      key: 'k',
      code: '合规资质(工商局)',
      quality: clampScore(scoreByThreshold(gsLicenses.length, t.gsLicenseCount)),
      risk: clampScore(45 + Math.min(50, gsLicenses.length * 8)),
      activity: clampScore(scoreByThreshold(gsLicenses.length, t.gsLicenseCount)),
    },
  ].map((item) => ({
    ...item,
    score: clampScore(
      item.quality * (weights.quality / 100)
      + item.risk * (weights.risk / 100)
      + item.activity * (weights.activity / 100),
    ),
    weight: dimensionWeights[item.key] || 0,
  }))

  const weightSum = dimensions.reduce((sum, item) => sum + item.weight, 0) || 1
  const totalScore = clampScore(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / weightSum)

  return { dimensions, totalScore, presetKey, weights, threshold: t, presetLabel: preset.label }
}
